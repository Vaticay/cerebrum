// Commit 50 — tells VideoHuddle's RTCPeerConnection which STUN/TURN servers
// to use. Kept as its own tiny endpoint (rather than a hardcoded client-side
// constant) for one reason: TURN needs credentials, and credentials must
// never sit in client-side JS — so the moment TURN is configured, it has to
// come from the server.
//
// Ships today with just a public STUN server (Google's, free, no signup,
// no credentials) — this alone lets most home/mobile networks connect
// directly, peer to peer. STUN cannot help two callers who are BOTH behind
// a restrictive/symmetric NAT (common on some corporate or hotel Wi-Fi);
// only a TURN relay fixes that, at the cost of running (or paying for) one.
//
// To turn TURN on later, set these three Cloudflare Pages environment
// variables/secrets — no code changes needed, this file already reads them:
//   TURN_URLS        comma-separated, e.g. "turn:turn.example.com:3478"
//   TURN_USERNAME
//   TURN_CREDENTIAL
// Cloudflare's own Realtime TURN service (developers.cloudflare.com/realtime/
// turn/) is a natural fit since this project already lives on Cloudflare —
// it's free when paired with their SFU, or metered standalone — but any TURN
// provider's credentials work here the same way.

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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsFor(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!originAllowed(request)) {
    return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers: cors });
  }
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: cors });
  }

  // Several STUN servers, not one. STUN discovery is a single UDP probe and
  // any one provider can be blocked, rate-limited or simply down on a given
  // network; listing a few costs nothing (the browser races them) and
  // removes a single point of failure from the step that has to succeed
  // before a call can even be attempted.
  const iceServers = [
    { urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun.cloudflare.com:3478",
    ] },
  ];

  if (env.TURN_URLS && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
    // Operator-configured TURN always wins: it's the one with a known owner,
    // known capacity and a support path.
    iceServers.push({
      urls: env.TURN_URLS.split(",").map((s) => s.trim()).filter(Boolean),
      username: env.TURN_USERNAME,
      credential: env.TURN_CREDENTIAL,
    });
  } else {
    // Commit 56 — a public TURN fallback, because "no TURN configured" was
    // not a theoretical limitation: STUN alone only works when at least one
    // side's NAT is permissive enough to accept an inbound path. Two people
    // on ordinary consumer networks — home Wi-Fi to phone LTE, or anything
    // behind carrier-grade NAT — routinely have no such path, and the call
    // fails at ICE with both sides showing a connecting spinner. That is
    // the reported "we still can't connect."
    //
    // Open Relay is a free, no-signup TURN service run by Metered for
    // exactly this case. Being honest about what this is: it is a shared
    // public relay with no capacity guarantee and no SLA, so it is the
    // FALLBACK, listed after STUN (which the browser still prefers, since
    // ICE only relays when a direct path can't be found) and superseded the
    // moment TURN_URLS is set. Port 443 over TCP/TLS is included because
    // that is the variant that survives restrictive corporate and campus
    // firewalls, which block UDP wholesale.
    iceServers.push({
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    });
  }
  return new Response(JSON.stringify({ iceServers }), { status: 200, headers: cors });
}
