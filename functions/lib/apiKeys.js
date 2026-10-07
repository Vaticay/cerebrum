// Pro API keys — minimal viable API access for Pro members.
//
// A Pro user can mint up to MAX_KEYS_PER_USER bearer keys (`cbk_…`) from
// Settings. Keys authenticate /api/search via `Authorization: Bearer cbk_…`
// and are treated as the owning user: the same AI gate, the same quota
// metering, the same pipeline. A key only works while its owner is Pro —
// downgrade or cancel and every key 403s until Pro is restored.
//
// Only the sha256 hash is stored. The raw key is shown exactly once, at
// creation. Revocation is a timestamp, not a delete, so audit history
// survives.

import { randomToken, sha256Hex } from "./authHelpers.js";

export const API_KEY_PREFIX = "cbk_";
export const MAX_KEYS_PER_USER = 5;
export const API_KEY_RATE_LIMIT = 60; // requests
export const API_KEY_RATE_WINDOW_MS = 60000; // per minute

let tableReady = null;
export function ensureApiKeyTable(env) {
  if (!env || !env.DB) return Promise.resolve(false);
  if (!tableReady) {
    tableReady = env.DB.exec(
      "CREATE TABLE IF NOT EXISTS api_keys (" +
        "id TEXT PRIMARY KEY, " +
        "user_id TEXT NOT NULL, " +
        "key_hash TEXT NOT NULL UNIQUE, " +
        "key_prefix TEXT NOT NULL, " +
        "name TEXT NOT NULL DEFAULT '', " +
        "created_at INTEGER NOT NULL, " +
        "last_used_at INTEGER, " +
        "revoked_at INTEGER" +
        "); " +
        "CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id); " +
        "CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);"
    ).then(
      () => true,
      (e) => { tableReady = null; throw e; }
    );
  }
  return tableReady;
}

function newKeyId() {
  return "ak_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

/**
 * Mint a new API key for a Pro user. Returns the raw key exactly once —
 * callers must display it immediately because it is never stored.
 */
export async function createApiKey(env, userId, name) {
  await ensureApiKeyTable(env);
  const existing = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL"
  ).bind(userId).first();
  if ((existing && existing.n || 0) >= MAX_KEYS_PER_USER) {
    const err = new Error("key_limit");
    err.code = "key_limit";
    throw err;
  }
  const raw = API_KEY_PREFIX + randomToken(24);
  const keyHash = await sha256Hex(raw);
  const id = newKeyId();
  const now = Date.now();
  const cleanName = String(name || "").trim().slice(0, 60) || "Untitled key";
  await env.DB.prepare(
    "INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, userId, keyHash, raw.slice(0, 11), cleanName, now).run();
  return { id, key: raw, keyPrefix: raw.slice(0, 11), name: cleanName, createdAt: now };
}

export async function listApiKeys(env, userId) {
  await ensureApiKeyTable(env);
  const rows = await env.DB.prepare(
    "SELECT id, key_prefix AS keyPrefix, name, created_at AS createdAt, last_used_at AS lastUsedAt " +
    "FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC"
  ).bind(userId).all();
  return (rows && rows.results) || [];
}

export async function revokeApiKey(env, userId, keyId) {
  await ensureApiKeyTable(env);
  const res = await env.DB.prepare(
    "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
  ).bind(Date.now(), keyId, userId).run();
  return (res && res.meta && res.meta.changes || 0) > 0;
}

/**
 * Resolve `Authorization: Bearer cbk_…` to { keyId, userId }.
 * Returns null for missing/malformed/revoked keys. Touches last_used_at
 * on success (best-effort: a failed touch never fails auth).
 */
export async function resolveApiKey(request, env) {
  try {
    const authz = request.headers.get("Authorization") || "";
    const m = /^Bearer\s+(cbk_[A-Za-z0-9_-]{20,})$/i.exec(authz.trim());
    if (!m) return null;
    if (!env || !env.DB) return null;
    await ensureApiKeyTable(env);
    const keyHash = await sha256Hex(m[1]);
    const row = await env.DB.prepare(
      "SELECT id, user_id AS userId FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL"
    ).bind(keyHash).first();
    if (!row) return null;
    try {
      await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
        .bind(Date.now(), row.id).run();
    } catch (cbErr) { console.error("[Cerebrum] apiKeys.js resolveApiKey: last_used_at touch:", cbErr); }
    return { keyId: row.id, userId: row.userId };
  } catch (cbErr) {
    console.error("[Cerebrum] apiKeys.js resolveApiKey:", cbErr);
    return null;
  }
}

// ── Per-key usage dashboard ─────────────────────────────────────────────
// Daily aggregate counters per key: calls and errors (non-2xx / degraded
// pipeline outcomes). No query content is stored — counts only.

let usageTableReady = null;
export function ensureUsageTable(env) {
  if (!env || !env.DB) return Promise.resolve(false);
  if (!usageTableReady) {
    usageTableReady = env.DB.exec(
      "CREATE TABLE IF NOT EXISTS api_key_usage (" +
        "key_id TEXT NOT NULL, " +
        "day TEXT NOT NULL, " +
        "calls INTEGER NOT NULL DEFAULT 0, " +
        "errors INTEGER NOT NULL DEFAULT 0, " +
        "PRIMARY KEY (key_id, day)" +
        "); " +
        "CREATE INDEX IF NOT EXISTS idx_api_key_usage_day ON api_key_usage(day);"
    ).then(
      () => true,
      (e) => { usageTableReady = null; throw e; }
    );
  }
  return usageTableReady;
}

function utcDay(ts) {
  return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Record one API-key-authenticated request. Never throws — usage
 * accounting must never fail the request it measures. Callers should
 * run this via waitUntil so it never delays the response.
 */
export async function recordApiKeyUsage(env, keyId, isError) {
  try {
    if (!env || !env.DB || !keyId) return;
    await ensureUsageTable(env);
    const day = utcDay(Date.now());
    await env.DB.prepare(
      "INSERT INTO api_key_usage (key_id, day, calls, errors) VALUES (?, ?, 1, ?) " +
      "ON CONFLICT(key_id, day) DO UPDATE SET calls = calls + 1, errors = errors + ?"
    ).bind(keyId, day, isError ? 1 : 0, isError ? 1 : 0).run();
  } catch (cbErr) {
    console.error("[Cerebrum] apiKeys.js recordApiKeyUsage:", cbErr);
  }
}

/**
 * Per-key usage stats for one user's keys: totals plus a 7-day window.
 * Ownership is enforced by joining api_keys on user_id — a user can only
 * ever see their own keys' numbers.
 */
export async function getApiKeyUsage(env, userId) {
  try {
    if (!env || !env.DB || !userId) return [];
    await ensureUsageTable(env);
    await ensureApiKeyTable(env);
    const weekAgo = utcDay(Date.now() - 6 * 86400000);
    const keys = await listApiKeys(env, userId);
    const out = [];
    for (const k of keys) {
      let total = null;
      let recent = [];
      try {
        total = await env.DB.prepare(
          "SELECT COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(errors), 0) AS errors " +
          "FROM api_key_usage WHERE key_id = ?"
        ).bind(k.id).first();
        const r = await env.DB.prepare(
          "SELECT day, calls, errors FROM api_key_usage WHERE key_id = ? AND day >= ? ORDER BY day DESC"
        ).bind(k.id, weekAgo).all();
        recent = (r && r.results) || [];
      } catch (cbErr) { console.error("[Cerebrum] apiKeys.js getApiKeyUsage:", cbErr); }
      const today = utcDay(Date.now());
      const todayRow = recent.find((x) => x.day === today);
      out.push({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        totalCalls: (total && total.calls) || 0,
        totalErrors: (total && total.errors) || 0,
        calls7d: recent.reduce((s, x) => s + (x.calls || 0), 0),
        errors7d: recent.reduce((s, x) => s + (x.errors || 0), 0),
        callsToday: (todayRow && todayRow.calls) || 0,
        daily: recent.map((x) => ({ day: x.day, calls: x.calls || 0, errors: x.errors || 0 })),
      });
    }
    return out;
  } catch (cbErr) {
    console.error("[Cerebrum] apiKeys.js getApiKeyUsage:", cbErr);
    return [];
  }
}
