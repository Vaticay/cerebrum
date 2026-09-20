/**
 * functions/lib/aiCacheStats.js — hit/miss counters for the D1 AI-call
 * cache (nuance #29).
 *
 * The answer cache in search.js is the single biggest cost lever in the
 * product (a hit skips retrieval AND synthesis), but until now nobody
 * measured whether it was working. These counters make the hit rate a
 * number the operator can watch: recordCacheHit / recordCacheMiss at each
 * cache read, getCacheStats for the ratio, resetCacheStats for tests.
 *
 * Backed by D1 (ai_cache_stats, lazily created) with an in-isolate memory
 * fallback when D1 is unbound. Increments are INSERT ... ON CONFLICT
 * upserts — atomic per statement, which is the same honesty level as the
 * rate limiter (see rateLimit.js): good enough for telemetry.
 */

import { jsonLog } from "./requestLog.js";

let tableReady = null;
function ensureTable(db) {
  if (!tableReady) {
    tableReady = db.exec(
      "CREATE TABLE IF NOT EXISTS ai_cache_stats (" +
        "cache TEXT NOT NULL PRIMARY KEY, " +
        "hits INTEGER NOT NULL DEFAULT 0, " +
        "misses INTEGER NOT NULL DEFAULT 0, " +
        "updated_at INTEGER NOT NULL)"
    ).then(() => true, (e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

const memoryStats = new Map(); // cache -> { hits, misses }

function memRecord(cache, hit) {
  const s = memoryStats.get(cache) || { hits: 0, misses: 0 };
  if (hit) s.hits += 1; else s.misses += 1;
  memoryStats.set(cache, s);
  return s;
}

async function d1Record(db, cache, hit) {
  await ensureTable(db);
  const col = hit ? "hits" : "misses";
  await db.prepare(
    `INSERT INTO ai_cache_stats (cache, hits, misses, updated_at) VALUES (?, 0, 0, ?) ` +
      `ON CONFLICT(cache) DO UPDATE SET ${col} = ai_cache_stats.${col} + 1, updated_at = excluded.updated_at`
  ).bind(cache, Date.now()).run();
}

/** Record a cache lookup outcome. Never throws. */
export async function recordCacheLookup(env, cache, hit) {
  const name = String(cache || "answer");
  try {
    if (env && env.DB && typeof env.DB.prepare === "function") {
      await d1Record(env.DB, name, !!hit);
    } else {
      memRecord(name, !!hit);
    }
  } catch (e) {
    jsonLog("warn", "cache_stats_failed", { cache: name, error: String((e && e.message) || e).slice(0, 120) });
    memRecord(name, !!hit);
  }
}

export const recordCacheHit = (env, cache) => recordCacheLookup(env, cache, true);
export const recordCacheMiss = (env, cache) => recordCacheLookup(env, cache, false);

/** { hits, misses, hitRate } — hitRate null when no lookups yet. */
export async function getCacheStats(env, cache) {
  const name = String(cache || "answer");
  let hits = 0, misses = 0;
  try {
    if (env && env.DB && typeof env.DB.prepare === "function") {
      await ensureTable(env.DB);
      const row = await env.DB.prepare("SELECT hits, misses FROM ai_cache_stats WHERE cache = ?").bind(name).first();
      if (row) { hits = row.hits | 0; misses = row.misses | 0; }
    } else {
      const s = memoryStats.get(name);
      if (s) { hits = s.hits; misses = s.misses; }
    }
  } catch (e) {
    jsonLog("warn", "cache_stats_read_failed", { cache: name, error: String((e && e.message) || e).slice(0, 120) });
  }
  const total = hits + misses;
  return { cache: name, hits, misses, hitRate: total > 0 ? hits / total : null };
}

/** For tests. */
export function resetCacheStats() {
  memoryStats.clear();
}
