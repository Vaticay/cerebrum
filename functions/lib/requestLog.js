/**
 * functions/lib/requestLog.js — request IDs, structured JSON logging, and
 * per-tenant LLM token / spend accounting (nuance #30).
 *
 * Three jobs, one module, because they share the request-scoped context:
 *
 *  1. REQUEST IDS. getRequestId(request) returns the caller's X-Request-ID
 *     when it is present and well-formed (client-generated ids let a caller
 *     correlate their own logs), otherwise mints a fresh one. The middleware
 *     (functions/_middleware.js) stamps it onto the request headers so every
 *     one of the 16 route files can read it with reqId(request), and echoes
 *     it back on the response. attachRequestId(response, requestId) returns
 *     a new Response with the header set.
 *
 *  2. STRUCTURED LOGS. jsonLog(level, event, fields) emits one JSON line to
 *     the platform log. Cloudflare's dashboard can filter JSON logs, so a
 *     single structured line beats five console.log lines scattered across
 *     the request. Nothing secret goes in fields — use safeErr-shaped
 *     one-liners; the helper redacts the obvious secret patterns.
 *
 *  3. TOKEN / SPEND ACCOUNTING. recordLlmUsage(env, { userId, model,
 *     promptChars, completionChars, promptTokens, completionTokens })
 *     appends one row to the llm_usage D1 table (lazily created) and bumps
 *     an in-memory + D1 spend counter. getTenantSpend(env, userId) returns
 *     { tokens, estCostUsd, calls } for the current UTC month. Cost is
 *     estimated from a small per-model price table; unknown models use the
 *     fallback rate and say so. These numbers are OPERATOR telemetry, not
 *     billing truth — the billed surface is Stripe, and this never feeds a
 *     charge.
 *
 * ERROR TRACKING PLUG-IN (the "where does the DSN go" answer):
 * reportError(env, err, context) checks env.SENTRY_DSN. When set, it POSTs
 * a minimal Sentry envelope (fetch, fire-and-forget, 5s timeout) — no SDK
 * needed in a Worker. When unset, the error goes to jsonLog at "error"
 * level. See docs/observability.md for the three symptom alarms built on
 * top of these logs.
 */

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    try { return crypto.randomUUID(); } catch { /* fall through */ }
  }
  const b = new Uint8Array(16);
  (crypto.getRandomValues || ((x) => { for (let i = 0; i < x.length; i++) x[i] = Math.floor(Math.random() * 256); return x; }))(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Mint or reuse a request id for this request. */
export function getRequestId(request) {
  try {
    const incoming = request && request.headers && request.headers.get("X-Request-ID");
    if (incoming && REQUEST_ID_RE.test(incoming)) return incoming;
  } catch { /* ignore */ }
  return uuid();
}

/**
 * The request id for a Pages Functions context: the middleware-stamped id
 * when present (so handler logs correlate with the middleware's
 * request_start/request_end lines), else the request header, else new.
 */
export function contextRequestId(context) {
  try {
    const stamped = context && context.data && context.data.requestId;
    if (stamped && REQUEST_ID_RE.test(stamped)) return stamped;
  } catch { /* ignore */ }
  return getRequestId(context && context.request);
}

/** Read the id the middleware stamped (same as getRequestId, semantic alias). */
export function reqId(request) {
  return getRequestId(request);
}

/** Return a copy of `response` with X-Request-ID set. */
export function attachRequestId(response, requestId) {
  if (!response || !requestId) return response;
  const headers = new Headers(response.headers || {});
  headers.set("X-Request-ID", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Headers object carrying the request id — merge into route responses. */
export function requestIdHeaders(requestId) {
  return requestId ? { "X-Request-ID": requestId } : {};
}

const SECRET_PATTERNS = [
  /api[_-]?key\s*[:=]\s*[^\s&;"']+/gi,
  /(?:token|secret|password|bearer)\s*[:=]\s*[^\s&;"']+/gi,
  /sk-[A-Za-z0-9_-]{8,}/g,
  /Authorization:\s*[^\s]+/gi,
];

function scrub(value) {
  if (typeof value === "string") {
    let s = value.slice(0, 2000);
    for (const re of SECRET_PATTERNS) s = s.replace(re, "[redacted]");
    return s;
  }
  if (value && typeof value === "object") {
    if (Array.isArray(value)) return value.slice(0, 50).map(scrub);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/key|token|secret|password|auth|cookie/i.test(k)) out[k] = "[redacted]";
      else out[k] = scrub(v);
      if (Object.keys(out).length > 40) break;
    }
    return out;
  }
  return value;
}

/**
 * One structured log line: { ts, level, event, requestId, ...fields }.
 * level: "debug" | "info" | "warn" | "error".
 */
export function jsonLog(level, event, fields) {
  const rec = {
    ts: new Date().toISOString(),
    level: String(level || "info"),
    event: String(event || "log"),
    ...(fields && typeof fields === "object" ? scrub(fields) : {}),
  };
  const line = JSON.stringify(rec);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  return rec;
}

/**
 * Error tracking plug-in. Set env.SENTRY_DSN to a Sentry DSN to forward
 * errors there; otherwise they land in the structured platform log only.
 * Fire-and-forget with a short timeout — error reporting must never slow
 * or fail the request it reports on.
 */
export async function reportError(env, err, context) {
  const dsn = env && env.SENTRY_DSN;
  const payload = {
    event: "error",
    message: String((err && err.message) || err || "unknown").slice(0, 500),
    ...(context || {}),
  };
  if (!dsn) {
    jsonLog("error", "error", payload);
    return { sent: false, reason: "no_dsn" };
  }
  try {
    const m = String(dsn).match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
    if (!m) { jsonLog("error", "error", { ...payload, dsn: "malformed" }); return { sent: false, reason: "bad_dsn" }; }
    const [, publicKey, host, projectId] = m;
    const envelope =
      JSON.stringify({ event_id: uuid().replace(/-/g, ""), dsn }) + "\n" +
      JSON.stringify({ type: "event" }) + "\n" +
      JSON.stringify({
        event_id: uuid().replace(/-/g, ""),
        timestamp: Date.now() / 1000,
        level: "error",
        logger: "cerebrum",
        exception: { values: [{ type: (err && err.name) || "Error", value: payload.message }] },
        contexts: { cerebrum: scrub(context || {}) },
      }) + "\n";
    const ctl = new AbortController();
    const t = setTimeout(() => { try { ctl.abort(); } catch {} }, 5000);
    try {
      await fetch(`https://${host}/api/${projectId}/envelope/`, {
        method: "POST",
        headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${publicKey}` },
        body: envelope,
        signal: ctl.signal,
      });
    } finally { clearTimeout(t); }
    jsonLog("error", "error", { ...payload, sentry: true });
    return { sent: true };
  } catch (e) {
    jsonLog("error", "error", { ...payload, sentryFailed: String((e && e.message) || e).slice(0, 120) });
    return { sent: false, reason: "send_failed" };
  }
}

/* ── per-tenant LLM token + spend accounting ─────────────────────────── */

// USD per 1M tokens, blended prompt/completion. Order-of-magnitude right
// for the free/cheap models this product actually calls; the table exists
// so the operator can see WHICH model drove a spend spike, not to invoice.
const MODEL_PRICE_PER_MTOK = [
  [/nemotron-3-ultra/i, 0.60],
  [/nemotron-3-super|gemma-4-31b|inkling(?!-small)/i, 0.20],
  [/gemma-4-26b|nex-n2.5-pro|ling-3.0/i, 0.10],
  [/inkling-small|nex-n2.5-mini|lfm-2.5|north-mini|dots-3/i, 0.05],
];

export function estimateCostUsd(model, totalTokens) {
  const name = String(model || "");
  let rate = 0.05; // fallback: cheapest tier; labeled as estimate
  for (const [re, r] of MODEL_PRICE_PER_MTOK) {
    if (re.test(name)) { rate = r; break; }
  }
  return (Number(totalTokens) || 0) * (rate / 1e6);
}

/** ~4 chars per token; the same heuristic the cost docs describe. */
export function estimateTokensFromChars(chars) {
  return Math.ceil(Math.max(0, Number(chars) || 0) / 4);
}

let usageTableReady = null;
function ensureUsageTable(db) {
  if (!usageTableReady) {
    usageTableReady = db.exec(
      "CREATE TABLE IF NOT EXISTS llm_usage (" +
        "user_id TEXT NOT NULL, " +
        "period_key TEXT NOT NULL, " +
        "model TEXT NOT NULL, " +
        "calls INTEGER NOT NULL DEFAULT 0, " +
        "prompt_tokens INTEGER NOT NULL DEFAULT 0, " +
        "completion_tokens INTEGER NOT NULL DEFAULT 0, " +
        "est_cost_usd REAL NOT NULL DEFAULT 0, " +
        "updated_at INTEGER NOT NULL, " +
        "PRIMARY KEY (user_id, period_key, model))"
    ).then(() => true, (e) => { usageTableReady = null; throw e; });
  }
  return usageTableReady;
}

export function monthKey(nowMs) {
  const d = new Date(nowMs == null ? Date.now() : nowMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// In-isolate accumulator so spend is visible even when D1 is unbound
// (local dev) — D1 remains the durable record.
const memoryUsage = new Map(); // `${userId}:${period}:${model}` -> { calls, promptTokens, completionTokens, cost }

function memoryKey(userId, period, model) {
  return [userId, period, model].join("|");
}

/**
 * Record one LLM call's token usage for a tenant. Never throws — telemetry
 * must not break the request it measures.
 */
export async function recordLlmUsage(env, { userId, model, promptTokens, completionTokens, promptChars, completionChars }) {
  try {
    const uid = String(userId || "anonymous");
    const period = monthKey();
    const mdl = String(model || "unknown").slice(0, 120);
    const pt = promptTokens != null ? Math.max(0, Math.round(promptTokens)) : estimateTokensFromChars(promptChars || 0);
    const ct = completionTokens != null ? Math.max(0, Math.round(completionTokens)) : estimateTokensFromChars(completionChars || 0);
    const cost = estimateCostUsd(mdl, pt + ct);
    const k = memoryKey(uid, period, mdl);
    const prev = memoryUsage.get(k) || { calls: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    prev.calls += 1; prev.promptTokens += pt; prev.completionTokens += ct; prev.cost += cost;
    memoryUsage.set(k, prev);
    if (env && env.DB && typeof env.DB.prepare === "function") {
      await ensureUsageTable(env.DB);
      await env.DB.prepare(
        "INSERT INTO llm_usage (user_id, period_key, model, calls, prompt_tokens, completion_tokens, est_cost_usd, updated_at) " +
          "VALUES (?, ?, ?, 1, ?, ?, ?, ?) " +
          "ON CONFLICT(user_id, period_key, model) DO UPDATE SET " +
          "calls = llm_usage.calls + 1, " +
          "prompt_tokens = llm_usage.prompt_tokens + excluded.prompt_tokens, " +
          "completion_tokens = llm_usage.completion_tokens + excluded.completion_tokens, " +
          "est_cost_usd = llm_usage.est_cost_usd + excluded.est_cost_usd, " +
          "updated_at = excluded.updated_at"
      ).bind(uid, period, mdl, pt, ct, cost, Date.now()).run();
    }
    return { userId: uid, model: mdl, promptTokens: pt, completionTokens: ct, estCostUsd: cost };
  } catch (e) {
    jsonLog("warn", "llm_usage_record_failed", { error: String((e && e.message) || e).slice(0, 160) });
    return null;
  }
}

/** This UTC month's totals for one tenant (D1 when available, else memory). */
export async function getTenantSpend(env, userId) {
  const uid = String(userId || "anonymous");
  const period = monthKey();
  const totals = { userId: uid, period, calls: 0, promptTokens: 0, completionTokens: 0, estCostUsd: 0, byModel: [] };
  try {
    if (env && env.DB && typeof env.DB.prepare === "function") {
      await ensureUsageTable(env.DB);
      const rows = await env.DB.prepare(
        "SELECT model, calls, prompt_tokens, completion_tokens, est_cost_usd FROM llm_usage WHERE user_id = ? AND period_key = ?"
      ).bind(uid, period).all();
      for (const r of (rows && rows.results) || []) {
        totals.calls += r.calls | 0;
        totals.promptTokens += r.prompt_tokens | 0;
        totals.completionTokens += r.completion_tokens | 0;
        totals.estCostUsd += Number(r.est_cost_usd) || 0;
        totals.byModel.push({ model: r.model, calls: r.calls | 0, tokens: (r.prompt_tokens | 0) + (r.completion_tokens | 0), estCostUsd: Number(r.est_cost_usd) || 0 });
      }
      return totals;
    }
  } catch (e) {
    jsonLog("warn", "llm_spend_read_failed", { error: String((e && e.message) || e).slice(0, 160) });
  }
  for (const [k, v] of memoryUsage) {
    const [u, p] = k.split("|");
    if (u === uid && p === period) {
      totals.calls += v.calls;
      totals.promptTokens += v.promptTokens;
      totals.completionTokens += v.completionTokens;
      totals.estCostUsd += v.cost;
    }
  }
  return totals;
}
