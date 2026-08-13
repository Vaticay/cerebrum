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

const ALLOWED_ORIGINS = [
  "https://askcerebrum.org",
  "https://www.askcerebrum.org",
  "https://cerebrum-2pz.pages.dev",
];
// Scoped to OUR Pages project's preview subdomains only. Bug fix: this used
// to be `origin.endsWith(".pages.dev")`, which trusts every free Cloudflare
// Pages site on the internet — anyone can deploy one and get an origin that
// passes — completely defeating the allowlist. Matches search.js's fix.
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.cerebrum-2pz\.pages\.dev$/i;
function originAllowed(request) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return true; // same-origin / non-browser client
  return ALLOWED_ORIGINS.some((o) => origin === o) || PAGES_PREVIEW_RE.test(origin);
}

// Same lightweight per-isolate sliding-window limiter used in search.js.
const RATE_BUCKET = new Map();
const RATE_LIMIT = 30;         // votes
const RATE_WINDOW_MS = 60000;  // per minute
function rateLimit(ip) {
  const now = Date.now();
  const rec = RATE_BUCKET.get(ip) || [];
  const recent = rec.filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  RATE_BUCKET.set(ip, recent);
  if (RATE_BUCKET.size > 5000) {
    for (const [k, v] of RATE_BUCKET) {
      if (v.every((t) => now - t > RATE_WINDOW_MS)) RATE_BUCKET.delete(k);
    }
  }
  return recent.length <= RATE_LIMIT;
}

export async function onRequest(context) {
  const { request, env } = context;

  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin =
    ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin)
      ? reqOrigin
      : "https://askcerebrum.org";
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: cors });
  }

  if (!originAllowed(request)) {
    return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers: cors });
  }

  const clientIP =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown";
  if (!rateLimit(clientIP)) {
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
    const { answerId, vote } = body;

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
    return new Response(
      JSON.stringify({ error: e.message || "Vote failed" }),
      { status: 500, headers: cors }
    );
  }
}
