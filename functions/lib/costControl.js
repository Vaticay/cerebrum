/**
 * functions/lib/costControl.js — per-tenant token budgets and cheap-model-
 * first routing (nuance #33).
 *
 * THE PROBLEM
 * The free tier caps AI *answers* (15/5 days), but nothing caps the *tokens*
 * inside one answer. A single adversarial or pathological request — a 2000-
 * char query expanded against 40 papers, long history, vision input — can
 * burn more inference than a hundred normal ones, and the budget check
 * happens AFTER the LLM call, when the money is already spent.
 *
 * THE SHAPE
 * - checkTokenBudget(env, userId, estimatedTokens): enforced BEFORE any LLM
 *   call. Reads the tenant's monthly token budget from D1 (tenant_budgets,
 *   lazily created); when the estimate would exceed the remaining budget,
 *   returns { allowed: false } and logs the rejection (jsonLog "warn",
 *   event "budget_rejected") — the caller then degrades to the non-LLM
 *   path instead of calling the provider. Budgets default per tier
 *   (DEFAULT_BUDGETS); an operator can raise/lower one row without a
 *   deploy. Free-tier anonymous callers share one conservative pool.
 * - spendTokens(env, userId, tokens): atomically consumes from the budget
 *   (single UPDATE with a guard, so concurrent requests can't overspend).
 * - pickModelFor(complexity): cheap-model-first routing. "low" (short
 *   factual question, few sources) → the small model; "high" (long,
 *   ambiguous, contradiction-heavy) → the primary. classifyComplexity()
 *   scores the request so the router isn't guessing.
 * - estimatePromptTokens(text): the ~4 chars/token heuristic, shared with
 *   requestLog.
 *
 * Budgets are monthly (UTC). They are cost guardrails, not entitlements:
 * the AI-answer counts in proEntitlement.js remain the user-facing quota.
 */

import { jsonLog, estimateTokensFromChars, monthKey } from "./requestLog.js";

/** Monthly token budgets per tier. Tunable per tenant via tenant_budgets. */
export const DEFAULT_BUDGETS = {
  pro: 4_000_000,      // ~$20 ARPU headroom at blended cheap-model rates
  lite: 1_200_000,
  free: 300_000,
  anonymous: 60_000,   // shared pool across all anonymous callers
};

const CHEAP_MODEL = "nex-agi/nex-n2.5-mini:free";
const PRIMARY_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

let budgetTableReady = null;
function ensureBudgetTable(db) {
  if (!budgetTableReady) {
    budgetTableReady = db.exec(
      "CREATE TABLE IF NOT EXISTS tenant_budgets (" +
        "user_id TEXT NOT NULL, " +
        "period_key TEXT NOT NULL, " +
        "token_cap INTEGER NOT NULL, " +
        "used_tokens INTEGER NOT NULL DEFAULT 0, " +
        "updated_at INTEGER NOT NULL, " +
        "PRIMARY KEY (user_id, period_key))"
    ).then(() => true, (e) => { budgetTableReady = null; throw e; });
  }
  return budgetTableReady;
}

/** Fail open: without D1 there is no durable ledger, so budgets can't be enforced. */
function d1(db) {
  return db && typeof db.prepare === "function" ? db : null;
}

/** Tier string → default cap. Unknown tiers get the anonymous cap. */
export function defaultCapForTier(tier) {
  return DEFAULT_BUDGETS[tier] ?? DEFAULT_BUDGETS.anonymous;
}

async function readBudgetRow(db, userId, period, fallbackCap) {
  if (!d1(db)) return { token_cap: fallbackCap, used_tokens: 0, ephemeral: true };
  await ensureBudgetTable(db);
  const row = await db.prepare(
    "SELECT token_cap, used_tokens FROM tenant_budgets WHERE user_id = ? AND period_key = ?"
  ).bind(userId, period).first();
  if (row) return { token_cap: row.token_cap | 0, used_tokens: row.used_tokens | 0, ephemeral: false };
  await db.prepare(
    "INSERT OR IGNORE INTO tenant_budgets (user_id, period_key, token_cap, used_tokens, updated_at) VALUES (?, ?, ?, 0, ?)"
  ).bind(userId, period, fallbackCap, Date.now()).run();
  return { token_cap: fallbackCap, used_tokens: 0, ephemeral: false };
}

/**
 * Enforced BEFORE the LLM call. Returns
 * { allowed, remaining, cap, used, reason }.
 * Logs every rejection — a budget rejection is an operator-visible event,
 * not a silent fallback.
 */
export async function checkTokenBudget(env, userId, estimatedTokens, tier = "anonymous") {
  const uid = String(userId || "anonymous");
  const est = Math.max(0, Math.ceil(Number(estimatedTokens) || 0));
  const requestId = undefined;
  try {
    const db = env && env.DB;
    const period = monthKey();
    const row = await readBudgetRow(db, uid, period, defaultCapForTier(tier));
    const remaining = Math.max(0, row.token_cap - row.used_tokens);
    if (est > remaining) {
      jsonLog("warn", "budget_rejected", {
        requestId,
        userId: uid,
        tier,
        estimatedTokens: est,
        remaining,
        cap: row.token_cap,
      });
      return { allowed: false, remaining, cap: row.token_cap, used: row.used_tokens, reason: "token_budget_exceeded" };
    }
    return { allowed: true, remaining, cap: row.token_cap, used: row.used_tokens, reason: null };
  } catch (e) {
    // Fail open on ledger errors: a broken budget table must not take
    // search offline. The rejection path above is the enforcement; this
    // catch is the "can't even read the ledger" path.
    jsonLog("warn", "budget_check_failed_open", { userId: uid, error: String((e && e.message) || e).slice(0, 160) });
    return { allowed: true, remaining: Infinity, cap: Infinity, used: 0, reason: "ledger_unavailable" };
  }
}

/**
 * Atomically consume tokens AFTER a successful call. The UPDATE guards on
 * the cap so concurrent requests can't drive used_tokens past it.
 * Returns the new used total (best effort).
 */
export async function spendTokens(env, userId, tokens) {
  const uid = String(userId || "anonymous");
  const n = Math.max(0, Math.ceil(Number(tokens) || 0));
  if (n === 0) return 0;
  try {
    const db = d1(env && env.DB);
    if (!db) return 0;
    const period = monthKey();
    await ensureBudgetTable(db);
    await db.prepare(
      "UPDATE tenant_budgets SET used_tokens = used_tokens + ?, updated_at = ? " +
        "WHERE user_id = ? AND period_key = ? AND used_tokens + ? <= token_cap"
    ).bind(n, Date.now(), uid, period, n).run();
    const row = await db.prepare(
      "SELECT used_tokens FROM tenant_budgets WHERE user_id = ? AND period_key = ?"
    ).bind(uid, period).first();
    return row ? row.used_tokens | 0 : 0;
  } catch (e) {
    jsonLog("warn", "budget_spend_failed", { userId: uid, error: String((e && e.message) || e).slice(0, 160) });
    return 0;
  }
}

/** Operator override: set one tenant's cap for the current month. */
export async function setTenantCap(env, userId, tokenCap) {
  const db = d1(env && env.DB);
  if (!db) throw new Error("no_db");
  await ensureBudgetTable(db);
  const period = monthKey();
  await db.prepare(
    "INSERT INTO tenant_budgets (user_id, period_key, token_cap, used_tokens, updated_at) VALUES (?, ?, ?, 0, ?) " +
      "ON CONFLICT(user_id, period_key) DO UPDATE SET token_cap = excluded.token_cap, updated_at = excluded.updated_at"
  ).bind(String(userId), period, Math.max(0, Math.round(tokenCap)), Date.now()).run();
  return { userId: String(userId), period, tokenCap };
}

/* ── cheap-model-first routing ───────────────────────────────────────── */

/**
 * Score request complexity 0..1 from cheap, request-local signals.
 * Short factual question + few sources → low; long/ambiguous/multi-part +
 * many sources → high. This is a heuristic router, not a classifier — it
 * only decides which free model to try first.
 */
export function classifyComplexity({ queryLength = 0, historyTurns = 0, sourceCount = 0, ambiguous = false, multiPart = false } = {}) {
  let s = 0;
  if (queryLength > 400) s += 0.25; else if (queryLength > 140) s += 0.1;
  if (historyTurns > 4) s += 0.15; else if (historyTurns > 0) s += 0.05;
  if (sourceCount > 20) s += 0.25; else if (sourceCount > 10) s += 0.1;
  if (ambiguous) s += 0.2;
  if (multiPart) s += 0.15;
  return Math.min(1, Math.max(0, s));
}

/** "low" → cheap model first; "high" → primary. Threshold 0.35. */
export function pickModelFor(complexityScore) {
  return complexityScore >= 0.35 ? PRIMARY_MODEL : CHEAP_MODEL;
}

export { CHEAP_MODEL, PRIMARY_MODEL };

/**
 * One-call convenience for an LLM leg: estimate → budget-check →
 * { ok, model } or { ok: false, reason }. The caller routes to the
 * non-LLM fallback when ok is false.
 */
export async function authorizeLlmCall(env, { userId, tier, promptChars, complexity }) {
  const estimated = estimateTokensFromChars(promptChars || 0) + 2000; // + headroom for the completion
  const budget = await checkTokenBudget(env, userId, estimated, tier);
  if (!budget.allowed) return { ok: false, reason: budget.reason, budget };
  const model = pickModelFor(classifyComplexity(complexity || {}));
  return { ok: true, model, estimatedTokens: estimated, budget };
}
