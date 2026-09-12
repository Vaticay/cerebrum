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

import { corsHeaders, readOriginAllowed, errorResponse, tooManyRequests, unauthorized, forbiddenOrigin, clientIp, privacyKey } from "../lib/http.js";
import { getSessionUser } from "../lib/authHelpers.js";
import { checkRateLimit } from "../lib/rateLimit.js";

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env, { methods: "GET, OPTIONS" });
  if (!readOriginAllowed(request, env)) return forbiddenOrigin(cors);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") {
    return errorResponse(405, "method_not_allowed", "Method not allowed.", cors);
  }

  /* SECURITY: this endpoint mints TURN relay credentials, and it used to do so
   * for anyone at all — no session check, no rate limit, and an origin gate
   * that returns true when the Origin header is absent (which is what curl
   * sends). `curl https://askcerebrum.org/api/iceservers` returned working
   * credentials. TURN relay is metered bandwidth on the operator's account, so
   * that was an open tap on someone else's bill, and the static
   * TURN_USERNAME/TURN_CREDENTIAL path handed out long-lived shared secrets
   * from the environment rather than a minted, expiring credential.
   *
   * Credentials are for calls, and calls require an account. Sign-in is now
   * required, and the budget is charged to the account rather than the IP so
   * it cannot be reset by changing networks. */
  const user = await getSessionUser(request, env).catch(() => null);
  if (!user) return unauthorized(cors);

  const rlKey = await privacyKey("ice", user.id, env);
  if (!(await checkRateLimit(env, rlKey, 20, 60000))) {
    return tooManyRequests(cors, 30);
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

  /* ------------------------------------------------------------------
     Commit 85 — calls ring, connect signalling, and then never establish
     media.

     That failure shape is diagnostic. If the ring arrives and
     /api/callsignal is returning 200 with a rising `since` cursor, then
     offer, answer and ICE candidates are all crossing the wire correctly —
     the handshake is fine and the problem is the media path. Two ordinary
     consumer endpoints (an iPhone on a carrier network and a machine
     behind a home router) frequently have no direct path between them:
     carrier-grade NAT on the mobile side means STUN can discover an
     address but nothing can dial into it. The call then needs a relay, and
     if the relay is unreachable ICE simply runs out of candidate pairs and
     the connection sits at "connecting" until it fails.

     The fallback this shipped with was Metered's free openrelay.metered.ca
     with the public "openrelayproject" credentials. That service has been
     progressively locked behind an account and an API key, so those
     credentials no longer reliably authenticate — a TURN server that 401s
     produces exactly this symptom, because the browser reports the failure
     only through onicecandidateerror, which nothing was listening to.

     So: Cloudflare's own Realtime TURN is now the first choice, minted
     server-side as short-lived credentials. It is the right relay for this
     project — same platform, same dashboard, no third party, and TURN is
     only used at all when a direct path could not be found. Set two
     variables in Pages → Settings → Variables and Secrets:

       TURN_KEY_ID          the TURN key's ID
       TURN_KEY_API_TOKEN   its API token  (mark as a Secret)

     Create the key at Cloudflare dashboard → Realtime → TURN Keys. It is
     metered at $0.05 per real-time GB relayed, which for one-to-one calls
     is fractions of a cent apiece, and nothing is billed for calls that
     connect directly — which is most of them.
     ------------------------------------------------------------------ */
  /* Commit 90 — "relay":"none" was one answer to three different
     questions: no key configured, a key configured but rejected, or the
     mint call never completing. Those need three different fixes and the
     payload could not tell them apart, so the first live attempt at this
     produced a dead end. `reason` now says which one it is. It carries no
     secret material — only whether each variable is present, and the HTTP
     status Cloudflare replied with. */
  let relayReason = "not-configured";
  const haveId = typeof env.TURN_KEY_ID === "string" && env.TURN_KEY_ID.trim().length > 0;
  const haveToken = typeof env.TURN_KEY_API_TOKEN === "string" && env.TURN_KEY_API_TOKEN.trim().length > 0;
  if (haveId !== haveToken) relayReason = haveId ? "missing-TURN_KEY_API_TOKEN" : "missing-TURN_KEY_ID";

  if (haveId && haveToken) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      let res;
      try {
        res = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID.trim())}/credentials/generate-ice-servers`,
          {
            method: "POST",
            headers: {
              // .trim() is load-bearing: copying a token out of the dashboard
              // very often brings a trailing newline with it, and a Bearer
              // header with a newline in it is rejected as malformed.
              "Authorization": `Bearer ${env.TURN_KEY_API_TOKEN.trim()}`,
              "Content-Type": "application/json",
            },
            // Short-lived on purpose: these reach the browser, so a leaked
            // pair is worth an hour of relay, not forever.
            body: JSON.stringify({ ttl: 3600 }),
          }
        );
      } finally { clearTimeout(t); }
      if (!res) {
        relayReason = "mint-no-response";
      } else if (!res.ok) {
        // 401/403 => the token is wrong or has no Realtime permission.
        // 404 => the key id is wrong. Both are worth saying out loud.
        relayReason = "mint-http-" + res.status;
      }
      if (res && res.ok) {
        const data = await res.json();
        if (!data || !Array.isArray(data.iceServers) || !data.iceServers.length) relayReason = "mint-empty";
        if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
          // Cloudflare returns its own STUN entries alongside TURN; keep
          // the STUN block above too so a single provider being blocked on
          // a given network cannot stop candidate gathering outright.
          // Validate before serving: a malformed entry (no urls) makes
          // RTCPeerConnection throw on the client.
          for (const entry of data.iceServers) {
            if (entry && Array.isArray(entry.urls) && entry.urls.length) iceServers.push(entry);
          }
          return new Response(JSON.stringify({ iceServers, relay: "cloudflare" }), { status: 200, headers: cors });
        }
      }
    } catch (e) {
      relayReason = "mint-threw";
    }
  }

  if (env.TURN_URLS && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
    /* Operator-configured static TURN. Note the trade being made: these are
     * long-lived shared credentials read straight from the environment, so
     * every signed-in caller receives the same username and secret and can
     * keep using them after they stop being a user. Cloudflare's minted
     * credentials above are time-limited and per-request, which is why they
     * are tried first. If you configure this path, treat TURN_CREDENTIAL as a
     * rotating secret rather than a permanent one. An empty URL list (e.g.
     * TURN_URLS set to whitespace) is not a usable server entry, so it
     * falls through to the last-resort branch instead of being served. */
    const urls = env.TURN_URLS.split(",").map((s) => s.trim()).filter(Boolean);
    if (urls.length) {
      iceServers.push({ urls, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
      return new Response(JSON.stringify({ iceServers, relay: "static" }), { status: 200, headers: cors });
    }
  }

  /* No relay is configured. Say so in the payload rather than silently
     serving STUN-only ICE and letting the call fail as a mystery — the
     client uses this to tell the caller what is actually wrong instead of
     "couldn't establish a connection". The Open Relay entry stays as a
     last resort because when it does work it is better than nothing, but
     it is explicitly no longer treated as a working relay. */
  iceServers.push({
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  });
  return new Response(JSON.stringify({ iceServers, relay: "none", reason: relayReason }), { status: 200, headers: cors });
}
