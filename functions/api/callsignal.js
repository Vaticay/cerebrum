// Commit 50 — WebRTC signaling relay for VideoHuddle's own peer-to-peer
// calling. This replaces embedding Jitsi's free public server (meet.jit.si),
// which as of August 24, 2023 requires its first participant to authenticate
// via Google/GitHub/Facebook before a room "starts" — a permanent policy
// change on Jitsi's own server (not anything this app's client code could
// configure around) that surfaced as the "no moderators have yet arrived,
// please log-in" wall inside the embed. See the block comment above
// VideoHuddle in src/main.jsx for the full root-cause writeup.
//
// What this endpoint actually does: relay a handful of small JSON messages
// (SDP offer/answer, ICE candidates, hello/bye) between the two browsers in
// a call so their own RTCPeerConnections can find each other. No media ever
// passes through here or through any Cerebrum server — once the two
// browsers' peer connections are up, audio/video flows directly between
// them (or through a STUN-negotiated path; see functions/api/ice-servers.js).
//
// This is polling-based, not a WebSocket/Durable Object relay — deliberately.
// A Durable Object would need its own class deployed as a *separate*
// Cloudflare Worker (Cloudflare does not allow a Durable Object class to be
// deployed from inside a Pages project — https://developers.cloudflare.com/
// pages/functions/bindings/), which would mean asking for a second deploy
// pipeline (Wrangler CLI, its own dashboard binding) on top of the
// GitHub-web-UI paste-and-deploy flow this whole project uses. Polling
// through the D1 database already in use everywhere else costs a few
// hundred milliseconds of extra call-setup latency (the "Connecting…"
// spinner runs a little longer) in exchange for zero new infrastructure —
// an honest, deliberate trade, not an oversight.
//
// Security posture: unlike the old meet.jit.si rooms (whose own comments in
// this codebase admitted "no access control of their own beyond the room
// name being unguessable"), this endpoint requires a real signed-in session
// AND thread membership AND that the two participants haven't blocked each
// other — strictly more access control than what it replaces, not less.

import { corsHeaders, readOriginAllowed, requireTrustedOrigin, forbiddenOrigin, clientIp, privacyKey, readJsonBody } from "../lib/http.js";
import { getSessionUser, isBlockedPair, ensureSocialTables } from "../lib/authHelpers.js";
import { checkRateLimit } from "../lib/rateLimit.js";


// Generous relative to search/videos endpoints: a single call's connection
// setup alone posts a handful of messages (hello, one offer or answer, a
// handful of trickled ICE candidates) and polls every ~800ms while
// connecting, so a real call can easily produce 60-120 requests/minute
// across both directions without anything being wrong.
const POST_LIMIT = 240;
const GET_LIMIT = 240;
const WINDOW_MS = 60000;

// "ring" (Commit 54) is the caller's repeating "I am calling you" heartbeat.
// It is a signal like any other rather than its own endpoint because it is
// scoped, authorized and cleaned up on exactly the same terms as the rest of
// a call's traffic — and because leaving it off this list is precisely what
// made the first attempt at ringing fail silently: every heartbeat POST came
// back 400 and no row was ever written.
const ALLOWED_TYPES = new Set(["hello", "offer", "answer", "ice", "bye", "ring"]);
const MAX_PAYLOAD_JSON_LEN = 8000; // SDP blobs are a few KB; ICE candidates are tiny
const MAX_CLIENT_ID_LEN = 100;
// Thread ids are server-minted short strings; an unbounded one is either a
// bug or a probe, and it is interpolated into SQL binds everywhere below.
const MAX_THREAD_ID_LEN = 128;

/* Pure input validation, exported so tests can exercise it without a DB.
 * Returns { ok: true, ...fields } or { ok: false, code, message }. */
export function validateSignalGet(params) {
  const threadId = (params.get("threadId") || "").trim();
  const clientId = (params.get("clientId") || "").trim().slice(0, MAX_CLIENT_ID_LEN);
  const since = parseInt(params.get("since") || "0", 10) || 0;
  if (!threadId || !clientId) {
    return { ok: false, code: "missing_params", message: "Missing threadId or clientId." };
  }
  if (threadId.length > MAX_THREAD_ID_LEN) {
    return { ok: false, code: "invalid_thread", message: "Invalid request." };
  }
  return { ok: true, threadId, clientId, since: Math.max(0, since) };
}

export function validateSignalPost(body) {
  const b = body && typeof body === "object" ? body : {};
  const threadId = (b.threadId || "").toString().trim();
  const clientId = (b.clientId || "").toString().trim().slice(0, MAX_CLIENT_ID_LEN);
  const type = (b.type || "").toString().trim();
  if (!threadId || !clientId || !ALLOWED_TYPES.has(type)) {
    return { ok: false, code: "invalid_request", message: "Invalid request." };
  }
  if (threadId.length > MAX_THREAD_ID_LEN) {
    return { ok: false, code: "invalid_thread", message: "Invalid request." };
  }
  let payloadStr;
  try {
    payloadStr = JSON.stringify(b.payload != null ? b.payload : {});
  } catch {
    return { ok: false, code: "invalid_payload", message: "Invalid payload." };
  }
  if (payloadStr.length > MAX_PAYLOAD_JSON_LEN) {
    return { ok: false, code: "payload_too_large", message: "Payload too large." };
  }
  return { ok: true, threadId, clientId, type, payloadStr };
}
const SIGNAL_TTL_MS = 10 * 60 * 1000; // 10 minutes — a call's signaling is long done well before this

// Confirms the requester is a real participant of the thread and, for a DM,
// isn't blocked by (or blocking) the other participant. Returns the list of
// other participant user_ids on success, or null if access should be denied.
async function authorizeThread(env, userId, threadId) {
  const membership = await env.DB.prepare(
    "SELECT 1 FROM thread_participants WHERE thread_id = ? AND user_id = ?"
  ).bind(threadId, userId).first();
  if (!membership) return null;
  const others = await env.DB.prepare(
    "SELECT user_id FROM thread_participants WHERE thread_id = ? AND user_id != ?"
  ).bind(threadId, userId).all();
  const otherIds = (others.results || []).map((r) => r.user_id);
  for (const otherId of otherIds) {
    if (await isBlockedPair(env, userId, otherId)) return null;
  }
  return otherIds;
}

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!readOriginAllowed(request, env)) {
    return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers: cors });
  }
  if (!env.DB) {
    // Commit 70 — this returned 200 with an error body, so every caller's
    // `res.ok` check passed and a ring heartbeat that recorded nothing
    // reported success. Settings -> System status probes this endpoint the
    // same way, which is how it could show "live" while calls did not work
    // at all. An unavailable dependency is a 503.
    return new Response(JSON.stringify({ error: "Call signaling is not available right now." }), { status: 503, headers: cors });
  }

  const user = await getSessionUser(request, env);
  if (!user) {
    return new Response(JSON.stringify({ error: "Sign in required." }), { status: 401, headers: cors });
  }
  /* Rate-limit budgets are charged to the account (hashed under a server
   * secret) rather than a raw IP string — and clientIp() deliberately
   * ignores the client-settable X-Forwarded-For, which the old code
   * consulted first and which let anyone rotate their own bucket. */
  const ip = clientIp(request);

  try {
    // Commit 70 — this endpoint reads and writes call_signals,
    // thread_participants and user_blocks, and was the ONLY endpoint
    // touching them that never ran the self-healing schema. It worked
    // whenever some earlier request in the same isolate had already run
    // ensureSocialTables via /api/data — and threw a 500 on the INSERT when
    // it hadn't. That is exactly the shape of "calling works sometimes":
    // an isolate whose first request is a ring heartbeat has no tables.
    // Memoized after the first real call, so this costs nothing. Inside the
    // try so a schema failure reports as an error rather than an uncaught
    // throw.
    await ensureSocialTables(env);

    if (request.method === "GET") {
      const rlKey = await privacyKey("call-signal-get", `${user.id}:${ip}`, env);
      if (!(await checkRateLimit(env, rlKey, GET_LIMIT, WINDOW_MS))) {
        return new Response(JSON.stringify({ error: "Too many requests." }), { status: 429, headers: { ...cors, "Retry-After": "10" } });
      }
      const vg = validateSignalGet(new URL(request.url).searchParams);
      if (!vg.ok) {
        return new Response(JSON.stringify({ error: vg.message }), { status: vg.code === "payload_too_large" ? 413 : 400, headers: cors });
      }
      const { threadId, clientId, since } = vg;
      const authorized = await authorizeThread(env, user.id, threadId);
      if (!authorized) {
        return new Response(JSON.stringify({ error: "Not authorized for this call." }), { status: 403, headers: cors });
      }
      const rows = await env.DB.prepare(
        "SELECT id, sender_id, client_id, type, payload, created_at FROM call_signals WHERE thread_id = ? AND id > ? AND client_id != ? ORDER BY id ASC LIMIT 200"
      ).bind(threadId, since, clientId).all();
      // client_id is included so the client can fall back to it as a
      // tie-break when deciding who sends the SDP offer, for the edge case
      // where both sides' user ids come back identical or missing (e.g.
      // someone testing a call against their own account in two tabs) —
      // see the role-assignment comment in VideoHuddle in src/main.jsx.
      const messages = (rows.results || []).map((r) => {
        let payload = null;
        try { payload = JSON.parse(r.payload); } catch { payload = null; }
        return { id: r.id, sender_id: r.sender_id, client_id: r.client_id, type: r.type, payload, created_at: r.created_at };
      });
      return new Response(JSON.stringify({ messages }), { status: 200, headers: cors });
    }

    if (request.method === "POST") {
      const rlKey = await privacyKey("call-signal-post", `${user.id}:${ip}`, env);
      if (!(await checkRateLimit(env, rlKey, POST_LIMIT, WINDOW_MS))) {
        return new Response(JSON.stringify({ error: "Too many requests." }), { status: 429, headers: { ...cors, "Retry-After": "10" } });
      }
      // Hard byte ceiling on the body: readJsonBody refuses an oversized
      // request before it is buffered (a client-supplied Content-Length can
      // lie, so the text is measured too).
      const parsed = await readJsonBody(request, cors, 64_000);
      if (!parsed.ok) return parsed.response;
      const vp = validateSignalPost(parsed.body);
      if (!vp.ok) {
        const status = vp.code === "payload_too_large" ? 413 : 400;
        return new Response(JSON.stringify({ error: vp.message }), { status, headers: cors });
      }
      const { threadId, clientId, type, payloadStr } = vp;
      const authorized = await authorizeThread(env, user.id, threadId);
      if (!authorized) {
        return new Response(JSON.stringify({ error: "Not authorized for this call." }), { status: 403, headers: cors });
      }
      const now = Date.now();
      try {
        await env.DB.prepare(
          "INSERT INTO call_signals (thread_id, sender_id, client_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(threadId, user.id, clientId, type, payloadStr, now).run();
      } catch (e) {
        // The old code echoed the database's exception message to the
        // client, verbatim — a D1 error string names tables and constraints.
        // Log it for the operator, return a generic message.
        console.error("call-signal insert failed:", e);
        return new Response(JSON.stringify({
          error: "Couldn't record the call signal. Please try again.",
        }), { status: 500, headers: cors });
      }
      // Opportunistic cleanup, scoped to this thread — cheap (indexed on
      // thread_id) and keeps the table from growing unbounded without
      // needing a cron trigger this project doesn't otherwise have.
      await env.DB.prepare("DELETE FROM call_signals WHERE thread_id = ? AND created_at < ?")
        .bind(threadId, now - SIGNAL_TTL_MS).run().catch(() => {});
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
    }

    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: cors });
  } catch (e) {
    console.error("Cerebrum call-signal endpoint error:", e);
    /* Returned HTTP 200 on a total failure, so every `res.ok` check on the
     * client treated a broken signalling channel as a working one — which is
     * precisely the "the call rings and never connects" symptom. 503 is the
     * truth and the client can act on it. */
    return new Response(JSON.stringify({ error: "Call signaling is temporarily unavailable.", code: "signal_unavailable" }), { status: 503, headers: cors });
  }
}
