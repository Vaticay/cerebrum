// Vote endpoint: POST /api/vote
// Body: { answerId: "xxx", vote: "up" | "down" }
// Updates the score in the answer cache. Upvoted answers get served faster
// to future users. Downvoted answers get excluded from the cache.
//
// This endpoint writes to a cache that's served to EVERY future visitor once
// score >= 2 (see /api/search's D1 answer cache read), so it's a meaningful
// abuse target: unauthenticated vote flooding can poison what other users see
// as a "verified" cached answer, or bury a good one.
//
// Security posture, tightened after audit:
//   - Signed-in session REQUIRED. Anonymous voting let anyone with a script
//     mint unlimited votes; votes are now charged to an account, and one
//     account gets one vote per answer (recorded in answer_votes, keyed by
//     answer_id + user_id). Repeating the same vote is idempotent; flipping
//     it moves the score by two.
//   - Write-path origin gate (requireTrustedOrigin): state-changing calls
//     are for our own UI. Cookies are SameSite=Lax, this is defence in depth.
//   - Rate limits are keyed by a hashed per-user key (and a second, looser
//     per-IP cap), never by a raw IP string or a client-spoofable header.

import {
  corsHeaders, requireTrustedOrigin, forbiddenOrigin, errorResponse,
  tooManyRequests, unauthorized, json, readJsonBody, clientIp, privacyKey,
} from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { getSessionUser } from "../lib/authHelpers.js";

const RATE_LIMIT = 30;         // votes
const RATE_WINDOW_MS = 60000;  // per minute
const MAX_ANSWER_ID_LEN = 100;

let _voteTableEnsured = false;
async function ensureVoteTable(env) {
  if (_voteTableEnsured) return;
  // One row per (answer, user): the PRIMARY KEY is what makes "one account,
  // one vote" structural rather than a convention the code has to remember.
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS answer_votes (answer_id TEXT NOT NULL, user_id TEXT NOT NULL, vote TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (answer_id, user_id))"
  );
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_answer_votes_user ON answer_votes(user_id)");
  _voteTableEnsured = true;
}

/* Pure input validation, exported so tests can exercise it without a DB.
 * Returns { ok: true, answerId, vote } or { ok: false, code, message }. */
export function validateVote(body) {
  const b = body && typeof body === "object" ? body : {};
  const answerId = typeof b.answerId === "string" ? b.answerId.trim() : "";
  const vote = b.vote;
  if (!answerId || answerId.length > MAX_ANSWER_ID_LEN || (vote !== "up" && vote !== "down")) {
    return { ok: false, code: "invalid_vote", message: "Need answerId and vote (up/down)." };
  }
  return { ok: true, answerId, vote };
}

/* Score delta for the cached answer given the voter's previous vote:
 *   no previous vote -> +1 / -1
 *   same vote again  -> 0 (idempotent repeat)
 *   flipped vote     -> +/-2 (undo the old vote, apply the new one) */
export function voteDelta(previous, vote) {
  const dir = vote === "up" ? 1 : -1;
  if (!previous) return dir;
  if (previous === vote) return 0;
  return 2 * dir;
}

export async function onRequest(context) {
  const { request, env } = context;

  const cors = corsHeaders(request, env, { methods: "POST, OPTIONS" });
  if (request.method === "OPTIONS") {
    if (!requireTrustedOrigin(request, env)) return forbiddenOrigin(cors);
    return new Response(null, { status: 204, headers: cors });
  }
  if (!requireTrustedOrigin(request, env)) return forbiddenOrigin(cors);
  if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "Method not allowed.", cors);

  /* Votes move a shared cache other people read. An unauthenticated caller
   * has no identity to charge abuse to, so sign-in is required. */
  const user = await getSessionUser(request, env).catch(() => null);
  if (!user) return unauthorized(cors);

  if (!env.DB) return errorResponse(503, "db_unavailable", "Voting is temporarily unavailable.", cors);

  const rlUser = await privacyKey("vote-user", user.id, env);
  if (!(await checkRateLimit(env, rlUser, RATE_LIMIT, RATE_WINDOW_MS))) return tooManyRequests(cors, 30);
  // Second, looser per-IP cap so one network cannot multiply the per-user
  // budget by minting accounts. privacyKey hashes the IP under a server
  // secret instead of persisting it raw (and clientIp() deliberately
  // ignores the client-settable X-Forwarded-For).
  const rlIp = await privacyKey("vote-ip", clientIp(request), env);
  if (!(await checkRateLimit(env, rlIp, RATE_LIMIT * 4, RATE_WINDOW_MS))) return tooManyRequests(cors, 30);

  const parsed = await readJsonBody(request, cors, 16_000);
  if (!parsed.ok) return parsed.response;
  const v = validateVote(parsed.body);
  if (!v.ok) return errorResponse(400, v.code, v.message, cors);

  try {
    await ensureVoteTable(env);
    const dir = v.vote === "up" ? 1 : -1;

    // Atomic vote application (2026-10-16, audit finding 13). The old
    // shape read the previous vote, computed the delta in memory, then
    // wrote the vote row and the score as separate statements: two
    // concurrent requests from one account could both read "no
    // previous vote", both compute a full delta, and both apply it,
    // while the vote table ended with one row. Now the delta is
    // computed inside SQL from the vote row as it stands when the
    // statement runs (the same cases voteDelta documents: no previous
    // vote gives dir, a repeat gives 0, a flip gives 2 * dir), and
    // the score update, the paper signal, and the vote row write run
    // as ONE D1 batch. A D1 batch is a single transaction, so no
    // other request can interleave between the delta read inside the
    // first statements and the vote write in the last one. The score
    // and paper statements must stay BEFORE the vote write: their
    // delta expressions read the previous vote.
    const deltaCase =
      "CASE WHEN NOT EXISTS (SELECT 1 FROM prev) THEN " + dir +
      " WHEN (SELECT vote FROM prev) = ? THEN 0 ELSE " + (2 * dir) + " END";
    const scoreStmt = env.DB.prepare(
      "WITH prev AS (SELECT vote FROM answer_votes WHERE answer_id = ? AND user_id = ?), " +
      "d AS (SELECT " + deltaCase + " AS delta) " +
      "UPDATE answer_cache SET score = score + (SELECT delta FROM d) " +
      "WHERE answer_id = ? AND (SELECT delta FROM d) <> 0"
    ).bind(v.answerId, user.id, v.vote, v.answerId);

    // Extend the learning signal to paper-level: look up which query this
    // answer belongs to, and nudge every paper attached to it in paper_cache.
    // Upvotes confirm (2 per score point), downvotes decay (1 per score
    // point, floored at 0) so a bad match doesn't stay force-included
    // forever. A flipped vote applies the net delta, never double-counts.
    // The confirm transform of the same SQL delta: positive deltas
    // double, negative deltas pass through.
    const paperStmt = env.DB.prepare(
      "WITH prev AS (SELECT vote FROM answer_votes WHERE answer_id = ? AND user_id = ?), " +
      "d AS (SELECT " + deltaCase + " AS delta) " +
      "UPDATE paper_cache SET times_confirmed = MAX(0, times_confirmed + " +
      "(SELECT CASE WHEN delta > 0 THEN delta * 2 ELSE delta END FROM d)) " +
      "WHERE query_key = (SELECT query_key FROM answer_cache WHERE answer_id = ?) " +
      "AND (SELECT delta FROM d) <> 0"
    ).bind(v.answerId, user.id, v.vote, v.answerId);

    // The vote row write runs last in the batch, and only actually
    // changes the row when the vote is new or flipped, so repeating
    // the same vote stays a true no op, created_at included.
    const voteStmt = env.DB.prepare(
      "INSERT INTO answer_votes (answer_id, user_id, vote, created_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(answer_id, user_id) DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at " +
      "WHERE answer_votes.vote <> excluded.vote"
    ).bind(v.answerId, user.id, v.vote, Date.now());

    let scoreResult;
    if (typeof env.DB.batch === "function") {
      const results = await env.DB.batch([scoreStmt, paperStmt, voteStmt]);
      scoreResult = results && results[0];
    } else {
      // A DB binding without batch (test doubles): the same
      // statements in the same order. The score delta is still
      // computed inside its single statement, never in memory.
      scoreResult = await scoreStmt.run();
      await paperStmt.run();
      await voteStmt.run();
    }

    // changed reports what the score update actually did: its change
    // count. An answer id with no cache row touches zero rows and now
    // honestly reports changed false, even though the vote itself was
    // recorded. A repeat vote also touches zero rows (delta 0 is
    // excluded by the WHERE above), preserving idempotent reporting.
    const scoreChanges = scoreResult && scoreResult.meta ? scoreResult.meta.changes : 0;
    return json({ ok: true, answerId: v.answerId, vote: v.vote, changed: scoreChanges > 0 }, 200, cors);
  } catch (e) {
    // Raw exception messages can leak D1 driver/schema detail on a genuine
    // database failure. Log server-side, return a generic message.
    console.error("Cerebrum vote endpoint error:", e);
    return errorResponse(500, "vote_failed", "Vote failed. Please try again.", cors);
  }
}
