import { corsHeaders, readOriginAllowed, requireTrustedOrigin, forbiddenOrigin, clientIp, privacyKey } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";

// Vote endpoint: POST /api/vote
// Body: { answerId: "xxx", vote: "up" | "down" }
// Updates the score in the answer cache. Upvoted answers get served faster
// to future users. Downvoted answers get excluded from the cache.
//
// This endpoint writes to a cache that's served to EVERY future visitor once
// score >= 2 (see /api/search's D1 answer cache read), so it's a meaningful
// abuse target: unauthenticated vote flooding can poison what other users see
// as a "verified" cached answer, or bury a good one. Previously this endpoint
// reflected any Origin header back unconditionally (no allowlist, unlike
// /api/search) and had no rate limiting at all, so any third-party site could
// script arbitrary up/down votes against guessed or scraped answerIds.


const RATE_LIMIT = 30;         // votes
const RATE_WINDOW_MS = 60000;  // per minute

export async function onRequest(context) {
  const { request, env } = context;

  const cors = corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: cors });
  }

  if (!readOriginAllowed(request, env)) {
    return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers: cors });
  }

  const clientIP =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown";
  if (!(await checkRateLimit(env, `vote:${clientIP}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }),
      { status: 429, headers: { ...cors, "Retry-After": "30" } }
    );
  }

  if (!env.DB) {
    return new Response(
      JSON.stringify({ error: "Database not configured" }),
      { status: 503, headers: cors }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    // Bug: a request body of the literal 4 bytes `null` is valid JSON, so
    // `.json()` resolves (not rejects) to `null` and the `.catch()` above
    // never fires — the destructure below then threw on `null`, and the raw
    // V8 message ("Cannot destructure property 'answerId' of 'null'...")
    // was echoed straight to the client via the catch block's `e.message`.
    const { answerId, vote } = body || {};

    if (!answerId || typeof answerId !== "string" || answerId.length > 100 || (vote !== "up" && vote !== "down")) {
      return new Response(
        JSON.stringify({ error: "Need answerId and vote (up/down)" }),
        { status: 400, headers: cors }
      );
    }

    const delta = vote === "up" ? 1 : -1;

    await env.DB.prepare(
      "UPDATE answer_cache SET score = score + ? WHERE answer_id = ?"
    ).bind(delta, answerId).run();

    // Extend the learning signal to paper-level: look up which query this
    // answer belongs to, and nudge every paper attached to it in paper_cache.
    // Downvotes decay a paper's confirmation count so a bad match doesn't
    // stay force-included forever; upvotes strengthen it further.
    try {
      const row = await env.DB.prepare(
        "SELECT query_key FROM answer_cache WHERE answer_id = ?"
      ).bind(answerId).first();
      if (row && row.query_key) {
        if (vote === "up") {
          await env.DB.prepare(
            "UPDATE paper_cache SET times_confirmed = times_confirmed + 2 WHERE query_key = ?"
          ).bind(row.query_key).run();
        } else {
          await env.DB.prepare(
            "UPDATE paper_cache SET times_confirmed = MAX(0, times_confirmed - 1) WHERE query_key = ?"
          ).bind(row.query_key).run();
        }
      }
    } catch {}

    return new Response(
      JSON.stringify({ ok: true, answerId, vote }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    // Bug: this echoed the raw exception message to the client, which could
    // leak D1 driver/schema detail (column/table names) on a genuine
    // database failure. Log server-side, return a generic message.
    console.error("Cerebrum vote endpoint error:", e);
    return new Response(
      JSON.stringify({ error: "Vote failed" }),
      { status: 500, headers: cors }
    );
  }
}
