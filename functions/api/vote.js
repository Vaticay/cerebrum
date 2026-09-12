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
    const existing = await env.DB.prepare(
      "SELECT vote FROM answer_votes WHERE answer_id = ? AND user_id = ?"
    ).bind(v.answerId, user.id).first();
    const previous = existing ? existing.vote : null;
    const delta = voteDelta(previous, v.vote);

    if (delta === 0) {
      // Idempotent: the same vote twice changes nothing and reports that.
      return json({ ok: true, answerId: v.answerId, vote: v.vote, changed: false }, 200, cors);
    }

    await env.DB.prepare(
      "INSERT OR REPLACE INTO answer_votes (answer_id, user_id, vote, created_at) VALUES (?, ?, ?, ?)"
    ).bind(v.answerId, user.id, v.vote, Date.now()).run();
    await env.DB.prepare(
      "UPDATE answer_cache SET score = score + ? WHERE answer_id = ?"
    ).bind(delta, v.answerId).run();

    // Extend the learning signal to paper-level: look up which query this
    // answer belongs to, and nudge every paper attached to it in paper_cache.
    // Upvotes confirm (2 per score point), downvotes decay (1 per score
    // point, floored at 0) so a bad match doesn't stay force-included
    // forever. A flipped vote applies the net delta, never double-counts.
    try {
      const row = await env.DB.prepare(
        "SELECT query_key FROM answer_cache WHERE answer_id = ?"
      ).bind(v.answerId).first();
      if (row && row.query_key) {
        const confirmDelta = delta > 0 ? delta * 2 : delta;
        await env.DB.prepare(
          "UPDATE paper_cache SET times_confirmed = MAX(0, times_confirmed + ?) WHERE query_key = ?"
        ).bind(confirmDelta, row.query_key).run();
      }
    } catch {}

    return json({ ok: true, answerId: v.answerId, vote: v.vote, changed: true }, 200, cors);
  } catch (e) {
    // Raw exception messages can leak D1 driver/schema detail on a genuine
    // database failure. Log server-side, return a generic message.
    console.error("Cerebrum vote endpoint error:", e);
    return errorResponse(500, "vote_failed", "Vote failed. Please try again.", cors);
  }
}
