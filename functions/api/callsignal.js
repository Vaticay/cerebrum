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

import { getSessionUser, isBlockedPair } from "../lib/authHelpers.js";
import { checkRateLimit } from "../lib/rateLimit.js";

const ALLOWED_ORIGINS = [
  "https://askcerebrum.org",
  "https://www.askcerebrum.org",
  "https://cerebrum-2pz.pages.dev",
];
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.cerebrum-2pz\.pages\.dev$/i;
function originAllowed(request) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return true;
  return ALLOWED_ORIGINS.some((o) => origin === o) || PAGES_PREVIEW_RE.test(origin);
}
function corsFor(request) {
  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin =
    ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin) ? reqOrigin : "https://askcerebrum.org";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

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
  const cors = corsFor(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!originAllowed(request)) {
    return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers: cors });
  }
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "Call signaling is not available right now." }), { status: 200, headers: cors });
  }

  const user = await getSessionUser(request, env);
  if (!user) {
    return new Response(JSON.stringify({ error: "Sign in required." }), { status: 401, headers: cors });
  }
  const clientIP = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";

  try {
    if (request.method === "GET") {
      if (!(await checkRateLimit(env, `call-signal-get:${user.id}:${clientIP}`, GET_LIMIT, WINDOW_MS))) {
        return new Response(JSON.stringify({ error: "Too many requests." }), { status: 429, headers: { ...cors, "Retry-After": "10" } });
      }
      const url = new URL(request.url);
      const threadId = (url.searchParams.get("threadId") || "").trim();
      const clientId = (url.searchParams.get("clientId") || "").trim().slice(0, MAX_CLIENT_ID_LEN);
      const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
      if (!threadId || !clientId) {
        return new Response(JSON.stringify({ error: "Missing threadId or clientId." }), { status: 400, headers: cors });
      }
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
      if (!(await checkRateLimit(env, `call-signal-post:${user.id}:${clientIP}`, POST_LIMIT, WINDOW_MS))) {
        return new Response(JSON.stringify({ error: "Too many requests." }), { status: 429, headers: { ...cors, "Retry-After": "10" } });
      }
      const body = await request.json().catch(() => ({}));
      const threadId = (body.threadId || "").toString().trim();
      const clientId = (body.clientId || "").toString().trim().slice(0, MAX_CLIENT_ID_LEN);
      const type = (body.type || "").toString().trim();
      if (!threadId || !clientId || !ALLOWED_TYPES.has(type)) {
        return new Response(JSON.stringify({ error: "Invalid request." }), { status: 400, headers: cors });
      }
      let payloadStr;
      try {
        payloadStr = JSON.stringify(body.payload != null ? body.payload : {});
      } catch {
        return new Response(JSON.stringify({ error: "Invalid payload." }), { status: 400, headers: cors });
      }
      if (payloadStr.length > MAX_PAYLOAD_JSON_LEN) {
        return new Response(JSON.stringify({ error: "Payload too large." }), { status: 413, headers: cors });
      }
      const authorized = await authorizeThread(env, user.id, threadId);
      if (!authorized) {
        return new Response(JSON.stringify({ error: "Not authorized for this call." }), { status: 403, headers: cors });
      }
      const now = Date.now();
      await env.DB.prepare(
        "INSERT INTO call_signals (thread_id, sender_id, client_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(threadId, user.id, clientId, type, payloadStr, now).run();
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
    return new Response(JSON.stringify({ error: "Call signaling is temporarily unavailable." }), { status: 200, headers: cors });
  }
}
