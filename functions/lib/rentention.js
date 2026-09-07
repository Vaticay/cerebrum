/**
 * Data retention.
 *
 * Before this file, nothing in the search-side database was ever deleted.
 * `answer_cache`, `paper_cache`, `query_intelligence` and `topic_memory` had
 * `created_at` columns that were written and never read; `call_signals` was
 * pruned only for a thread that happened to receive another write; expired
 * `otp_codes` and used `magic_links` accumulated forever. The Privacy page
 * described retention periods that no code implemented.
 *
 * A retention policy that exists only in prose is not a retention policy.
 *
 * WHY OPPORTUNISTIC AND NOT A CRON
 * This project has no scheduled worker. Rather than describe a cleanup job
 * that does not exist, the sweep runs on a small fraction of ordinary
 * requests, inside `waitUntil`, so it never delays a response. That is less
 * precise than a cron and it is honest about being so: rows outlive their
 * window by a little, and the tables stay bounded.
 *
 * Every statement here is scoped by a timestamp. None of them can delete a
 * live row, so a sweep firing at a bad moment is harmless.
 */

/** How long each kind of data may live. */
export const RETENTION = {
  /** Cached answers to non-sensitive questions. */
  answerCacheMs: 30 * 24 * 60 * 60 * 1000,
  /** Papers learned as good matches for a question. */
  paperCacheMs: 90 * 24 * 60 * 60 * 1000,
  /** Resolver hints. No user text — only machine-generated search terms. */
  queryIntelligenceMs: 90 * 24 * 60 * 60 * 1000,
  /** Topic co-occurrence statistics. */
  topicMemoryMs: 180 * 24 * 60 * 60 * 1000,
  /** WebRTC offer/answer/ICE fragments. Useless once a call is connected. */
  callSignalsMs: 10 * 60 * 1000,
  /** Expired one-time sign-in codes. */
  otpMs: 60 * 60 * 1000,
  /** Magic links, used or expired. */
  magicLinkMs: 24 * 60 * 60 * 1000,
  /** Expired sessions. */
  sessionsMs: 0, // deleted on their own expires_at
  /** Rate-limit counters. */
  rateLimitMs: 0, // deleted on their own reset_at
};

/**
 * Probability that any given request performs the sweep.
 *
 * At even modest traffic this fires many times an hour, which is ample for
 * windows measured in days. Low enough that the added D1 cost is noise.
 */
const SWEEP_PROBABILITY = 0.01;

export function shouldSweep() {
  return Math.random() < SWEEP_PROBABILITY;
}

/**
 * Delete everything past its window.
 *
 * Each statement is independent and independently caught: a table that does
 * not exist on this deployment must not stop the others being swept. Failures
 * are logged rather than swallowed, because a sweep that silently stopped
 * working looks exactly like one that is working.
 */
export async function sweepExpiredData(env) {
  if (!env || !env.DB) return { swept: 0, failed: [] };
  const now = Date.now();
  const statements = [
    ["answer_cache",       "DELETE FROM answer_cache WHERE created_at < ?",       now - RETENTION.answerCacheMs],
    ["paper_cache",        "DELETE FROM paper_cache WHERE created_at < ?",        now - RETENTION.paperCacheMs],
    ["query_intelligence", "DELETE FROM query_intelligence WHERE created_at < ?", now - RETENTION.queryIntelligenceMs],
    ["topic_memory",       "DELETE FROM topic_memory WHERE updated_at < ?",       now - RETENTION.topicMemoryMs],
    ["call_signals",       "DELETE FROM call_signals WHERE created_at < ?",       now - RETENTION.callSignalsMs],
    ["otp_codes",          "DELETE FROM otp_codes WHERE expires_at < ?",          now - RETENTION.otpMs],
    ["magic_links",        "DELETE FROM magic_links WHERE expires_at < ?",        now - RETENTION.magicLinkMs],
    ["sessions",           "DELETE FROM sessions WHERE expires_at < ?",           now],
    ["rate_limits",        "DELETE FROM rate_limits WHERE reset_at < ?",          now],
  ];

  /* Historical raw_query rows are NOT cleared automatically.
   *
   * Rows written before this deploy still contain users' question text. The
   * obvious move is to null them here, and that is deliberately not what
   * happens: an automatic irreversible delete of existing production data,
   * shipped inside an unrelated change, is not a decision code should make on
   * an operator's behalf. It is also unrecoverable if the count turns out to
   * be surprising, or if the column is doing something nobody documented.
   *
   * The operator runs the purge explicitly, once, after looking at what is
   * there. See docs/RAW_QUERY_CLEANUP.md for the audit and purge steps, and
   * set RAW_QUERY_PURGE=1 to enable it here.
   *
   * Meanwhile the rows are already expiring on the normal 90-day window
   * above, so doing nothing still drains them — it just takes a quarter. */
  if (String((env && env.RAW_QUERY_PURGE) || "") === "1") {
    statements.push(["query_intelligence_raw", "UPDATE query_intelligence SET raw_query = NULL WHERE raw_query IS NOT NULL", null]);
  }

  let swept = 0;
  const failed = [];
  for (const [label, sql, bound] of statements) {
    try {
      const stmt = env.DB.prepare(sql);
      const res = bound === null ? await stmt.run() : await stmt.bind(bound).run();
      swept += (res && res.meta && res.meta.changes) || 0;
    } catch (e) {
      failed.push(label);
      console.error("retention sweep failed for", label, e && e.message);
    }
  }
  if (failed.length) console.error("retention sweep incomplete:", failed.join(","));
  return { swept, failed };
}

/**
 * Fire-and-forget sweep for a request handler.
 * Uses waitUntil where available so the response is never delayed.
 */
export function maybeSweep(context) {
  try {
    if (!shouldSweep()) return;
    const p = sweepExpiredData(context.env);
    if (context.waitUntil) context.waitUntil(p);
  } catch (e) {
    console.error("maybeSweep:", e && e.message);
  }
}
