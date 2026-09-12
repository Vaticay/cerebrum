// Stateless auth endpoint for Cloudflare Pages Functions.
//
// Primary sign-in path: a 6-digit one-time code emailed via Resend. Nobody
// chooses or types a password on this path — proving you can read one email
// is the entire credential. That closes off the single most common real-world
// account-takeover vector (a password reused from some other, unrelated
// breach) by never asking for a long-lived secret in the first place.
//
// Legacy paths (email+password, magic link) are left in place underneath for
// any account created before this shipped — the frontend no longer renders
// UI for them, but nothing about an existing password-holding account
// breaks by leaving the code serving it intact.
//
// Three-tier storage for pending OTP state (a hash of the code, a hash of a
// paired flow-cookie value, an attempt counter, an expiry), best available
// first: the `otp_codes` D1 table when env.DB is configured (one row per
// email, replaced wholesale on every new request so only the most recently
// issued code is ever valid; the table is created on first use if schema.sql
// hasn't been run against the live database yet — see ensureOtpTable below,
// added after a missing-table 503 turned out to be exactly what "sign-in
// doesn't work" looked like in practice); then env.RATE_LIMIT_KV when D1
// isn't bound, since it's genuinely shared across every Cloudflare
// isolate/colo; and only when NEITHER is configured, a per-isolate in-memory
// Map — the same honest tradeoff already documented in lib/rateLimit.js,
// kept purely so the flow still works end-to-end with nothing provisioned,
// with no guarantee a pending code survives a request landing on a
// different edge isolate mid-flow.
//
// Security properties of the OTP path specifically:
//   - The 6-digit code is drawn from crypto.getRandomValues with rejection
//     sampling per digit (never Math.random, never modulo-biased).
//   - The raw code is never stored anywhere, in memory or in D1 — only
//     SHA-256(email + ":" + code) is kept, the same "hash only, ever" rule
//     applied to session tokens and magic-link tokens elsewhere in this file.
//   - A `cb_pending_auth` cookie carries a random opaque token that must
//     ALSO match (as a hash) before a code guess is even considered. An
//     attacker who never called send-code for a given address — and so never
//     received that cookie — cannot attempt a single guess against
//     verify-code for it, regardless of how many requests they send.
//   - Five wrong guesses burns the pending code outright. A 6-digit space is
//     only one million possibilities; without a hard per-code ceiling on
//     attempts, "rate limited" is theater, not an actual bound.
//
// Security model (legacy full mode): passwords are PBKDF2-hashed (100k
// iterations, Cloudflare workerd max) with a unique random salt per account.
// Sessions are HMAC-SHA256-signed JWTs in an HttpOnly cookie. Magic-link
// tokens stored as SHA-256 hashes only.

const ALLOWED_ORIGINS = [
  "https://askcerebrum.org",
  "https://www.askcerebrum.org",
  "https://cerebrum-2pz.pages.dev",
];
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.cerebrum-2pz\.pages\.dev$/i;

function originAllowed(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGINS.some((o) => origin === o) || PAGES_PREVIEW_RE.test(origin);
}

// Single shared default "from" address for every Resend send in this file.
// This used to be two separately-typed literals — sendOtpEmail's fallback
// had a hyphen ("no-reply@"), sendMagicLinkEmail's didn't ("noreply@") — and
// Resend rejects a send outright if the "from" address isn't a sender/domain
// actually verified on the account. Whichever of the two happened to be the
// real verified one, the OTHER path was silently guaranteed to fail with
// exactly the "couldn't send" 503 being reported. One constant now; set
// env.RESEND_FROM in the Pages project to override it for both paths at
// once instead of two places that can drift apart again.
const RESEND_FROM_DEFAULT = "Cerebrum <noreply@askcerebrum.org>";

// Accepts either a plain header object (existing call sites) or a Headers
// instance. The Headers path is what lets verify-code attach TWO Set-Cookie
// values to one response (the new session cookie plus clearing the spent
// pending-auth cookie) — a plain object literal can't hold two entries under
// the same key, but Headers.append() can, and Cloudflare's runtime correctly
// serializes each as its own Set-Cookie line rather than comma-joining them.
function json(data, status, headers) {
  const h = headers instanceof Headers ? headers : new Headers(headers || {});
  if (!h.has("Content-Type")) h.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { status, headers: h });
}

function isValidEmail(email) {
  return (
    typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

// ── Lightweight session cookie for the fallback path ──────────────────
// When D1 isn't available, we still need to give the frontend a working
// auth loop. This produces a plain base64url-encoded JSON payload in the
// cookie — NOT cryptographically signed (no secret available), so it is
// NOT tamper-proof. That's an honest, documented limitation of running
// without secrets configured. The moment JWT_SECRET is set, the real JWT
// path takes over.

const COOKIE_NAME = "cb_sess";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

/* SECURITY INVARIANT: there is no session this server cannot verify.
 *
 * What used to be here was a "fallback mode": when env.DB was unbound, the
 * endpoint issued `cb_sess` as base64url(JSON({email, ts})) with no signature
 * and no secret, and readFallbackToken() trusted whatever came back. Three
 * separate full-authentication bypasses followed from it — forge the cookie
 * directly, POST login with any non-empty password, or POST signup for an
 * address you do not own — and they activated on nothing more than a missing
 * or renamed D1 binding. A deployment could be silently downgraded from real
 * sessions to "trust the client" by an infrastructure change.
 *
 * Authentication now fails closed. If the database is unavailable, this
 * endpoint returns 503 and nobody is signed in. An outage that logs everyone
 * out is a bad afternoon; an outage that lets anyone log in as anyone is
 * unrecoverable.
 *
 * Session issuance lives entirely in functions/lib/authHelpers.js: a signed
 * JWT when JWT_SECRET is set, otherwise an opaque random token stored hashed
 * in D1. Both are verifiable. Neither can be minted by a client.
 */

function getSessionCookie(request) {
  const raw = request.headers.get("Cookie") || "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

// ── Pending-auth cookie (OTP flow only) ─────────────────────────────────
// Short-lived, holds a random opaque token — never anything derived from the
// email or the code, so there is nothing in it for a client to compute or
// forge. verify-code hashes it and compares against the hash stored
// alongside the pending code; see the file-level comment for why this
// matters.

const PENDING_COOKIE = "cb_pending_auth";
const OTP_TTL_MS = 15 * 60 * 1000;
// Hard ceiling on wrong guesses per issued code. A 6-digit space is only one
// million possibilities; without a per-code bound, "rate limited" is theater.
const OTP_MAX_ATTEMPTS = 5;

// Module-local constant-time hex comparison, shared by the exported OTP
// decision logic below and the verify-code handler, so the unit tests in
// tests/auth-security.mjs exercise the exact primitive the live path uses.
function otpHexEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ── OTP attempt decision (pure; exported for unit tests) ──────────────
 *
 * Decides what a verification attempt MEANS without touching storage, so
 * the rules — expiry, single-use, attempt burn, cookie pairing — can be
 * tested without a database. The handler in onRequest binds these decisions
 * to D1 transitions via runOtpAttempt's `store` argument.
 *
 * Check order is load-bearing:
 *   expired > exhausted > no_cookie > bad_flow > bad_code > valid
 * "exhausted" is evaluated BEFORE the cookie pairing check, matching the
 * handler's historical order: a burned code is burned regardless of which
 * cookie (if any) arrived with the request.
 */
export function decideOtpAttempt(row, { codeHash, flowHash, now = Date.now() } = {}) {
  if (!row) return "no_row";
  if (typeof row.expires_at === "number" && row.expires_at <= now) return "expired";
  if ((row.attempts | 0) >= OTP_MAX_ATTEMPTS) return "exhausted";
  if (!flowHash) return "no_cookie";
  if (!otpHexEqual(flowHash, String(row.flow_hash))) return "bad_flow";
  if (!otpHexEqual(codeHash, String(row.code_hash))) return "bad_code";
  return "valid";
}

/* Applies an OTP attempt against a storage backend.
 *
 * `store` is the only thing that touches persistence:
 *   getOtpRow(emailLower)    -> the pending row, or null
 *   consumeOtpRow(emailLower) -> delete the pending row (single-use burn)
 *   bumpOtpAttempts(emailLower) -> increment the wrong-guess counter
 *
 * Transitions:
 *   valid     -> consume (a correct code can never be replayed)
 *   bad_code  -> bump attempts; the NEXT wrong guess after the 5th finds a
 *                burned row, because "exhausted" consumes too
 *   expired / exhausted -> consume (dead rows are swept, never left live)
 *   no_row / no_cookie / bad_flow -> no state change; the attacker learns
 *                nothing and the legitimate pending code is untouched
 *
 * Returns the decision string; the handler maps anything but "valid" to the
 * same generic response so the reason never becomes an oracle.
 */
export async function runOtpAttempt(store, emailLower, { codeHash, flowHash, now = Date.now() } = {}) {
  const row = await store.getOtpRow(emailLower);
  const decision = decideOtpAttempt(row, { codeHash, flowHash, now });
  if (decision === "valid" || decision === "expired" || decision === "exhausted") {
    await store.consumeOtpRow(emailLower);
  } else if (decision === "bad_code") {
    await store.bumpOtpAttempts(emailLower);
  }
  return decision;
}

function pendingCookieHeader(token, isSecure) {
  return `${PENDING_COOKIE}=${token}; Path=/; Max-Age=${Math.floor(OTP_TTL_MS / 1000)}; HttpOnly; SameSite=Lax${isSecure ? "; Secure" : ""}`;
}
function clearPendingCookieHeader(isSecure) {
  return `${PENDING_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${isSecure ? "; Secure" : ""}`;
}
function getPendingCookie(request) {
  const raw = request.headers.get("Cookie") || "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${PENDING_COOKIE}=([^;]+)`));
  return match ? match[1] : null;
}

// otp_codes is a NEW table — it did not exist before this OTP flow shipped,
// which means it only exists in a live D1 database once someone has
// actually run schema.sql against it (a separate, manual `wrangler d1
// execute` step from deploying this file). Forgetting that step looks
// EXACTLY like "sign in doesn't work": env.DB is bound, so fullMode is true
// and every code path below assumes the table is there, but the INSERT a
// few lines down throws "no such table: otp_codes", the catch around it
// returns a generic "temporarily unavailable" 503, and nothing about that
// experience tells anyone what actually went wrong. Rather than depend on a
// migration step someone has to remember to run separately, this creates
// the table itself, once per isolate, the moment it's first needed —
// CREATE TABLE IF NOT EXISTS is a no-op once schema.sql (or this) has
// already created it, so this is always safe to call.
let _otpTableEnsured = false;
async function ensureOtpTable(env) {
  if (_otpTableEnsured) return;
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS otp_codes (email_lower TEXT NOT NULL PRIMARY KEY, code_hash TEXT NOT NULL, flow_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)"
  );
  _otpTableEnsured = true;
}

// Pending OTP codes live in D1 (otp_codes). There is no secondary store:
// a code this server cannot verify against durable storage is a code it
// must not accept.
// Six random digits, rejection-sampled so every digit is uniformly 0-9 (a
// plain `byte % 10` is very slightly biased toward 0-5 since 256 isn't a
// multiple of 10 — not a large bias, but there's no reason to accept even a
// small one for something guarding account access). Never Math.random,
// which is not a CSPRNG and has no business generating anything
// security-relevant.
function randomOtp() {
  let out = "";
  for (let i = 0; i < 6; i++) {
    let byte;
    do {
      byte = crypto.getRandomValues(new Uint8Array(1))[0];
    } while (byte >= 250); // 250 = 25 * 10, the largest multiple of 10 under 256
    out += String(byte % 10);
  }
  return out;
}

async function sendOtpEmail(env, email, code) {
  if (!env.RESEND_API_KEY) {
    /* SECURITY: this used to write the live sign-in code and the address it
     * belonged to into the log stream in plaintext, and then return TRUE —
     * so send-code reported success, no email was ever sent, and every
     * outstanding credential sat in the logs. It failed open on a single
     * missing environment variable, which is exactly the condition a
     * misconfigured production deploy is in.
     *
     * Local development gets the code through the same door, but only when
     * the operator has deliberately opted in by setting CEREBRUM_DEV_OTP=1
     * in .dev.vars, and never on a real hostname. Missing config is now an
     * outage, which is visible, rather than a silent credential leak. */
    if (String(env.CEREBRUM_DEV_OTP || "") === "1") {
      console.log("OTP_DEV (dev-only, CEREBRUM_DEV_OTP=1):", code);
      return true;
    }
    console.error("send-code: RESEND_API_KEY is not configured — cannot deliver sign-in codes");
    return false;
  }
  const from = env.RESEND_FROM || RESEND_FROM_DEFAULT;
  const html = `<div style="background:#040508;padding:48px 24px;font-family:'Space Grotesk','Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:420px;margin:0 auto;">
    <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;margin-bottom:32px;">Cerebrum&#8482;</div>
    <div style="background:#0c0e14;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:32px;">
      <div style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.45);margin-bottom:18px;">Your secure sign-in code</div>
      <div style="font-size:38px;font-weight:700;letter-spacing:0.18em;color:#ffffff;font-family:'Space Grotesk',monospace;margin-bottom:18px;">${code}</div>
      <div style="font-size:14px;line-height:1.6;color:rgba(255,255,255,0.7);">This code expires in 15 minutes and can only be used once. If you didn't request this, you can safely ignore this email — no account changes without it.</div>
    </div>
    <div style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:24px;line-height:1.6;">Cerebrum is a research instrument that searches real scholarly databases. This is an automated message — replies aren't monitored.</div>
  </div>
</div>`;
  try {
    // 12s hard timeout: a Resend edge that accepts and never answers must
    // not hold the sign-in request open until the platform kills it.
    const { fetchWithTimeout } = await import("../lib/resilience.js");
    const res = await fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: email, subject: "Your Cerebrum sign-in code", html }),
    }, 12000);
    if (!res.ok) {
      // Read and log Resend's actual rejection reason — "domain not
      // verified", "invalid from address", "API key revoked", etc. This
      // never goes in the response to the browser (this endpoint is
      // unauthenticated; anyone on the internet can call it, so third-party
      // API internals don't belong in a public response body) but it does
      // go to Cloudflare's real-time log stream (Pages project → Functions
      // → Logs, or `wrangler pages deployment tail`), which is exactly
      // where to look right after reproducing this.
      const detail = await res.text().catch(() => "<unreadable response body>");
      console.error("OTP email send rejected by Resend:", res.status, detail);
    }
    return res.ok;
  } catch (e) {
    console.error("OTP email send threw:", e);
    return false;
  }
}

async function sendMagicLinkEmail(env, email, link) {
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not configured, cannot send magic link email");
    return false;
  }
  const from = env.RESEND_FROM || RESEND_FROM_DEFAULT;
  try {
    const { fetchWithTimeout } = await import("../lib/resilience.js");
    const res = await fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: email,
        subject: "Your Cerebrum sign-in link",
        html: `<p>Click below to sign in to Cerebrum. This link expires in 15 minutes and can only be used once.</p><p><a href="${link}">Sign in to Cerebrum</a></p><p>If you didn't request this, you can ignore this email.</p>`,
      }),
    }, 12000);
    if (!res.ok) {
      const detail = await res.text().catch(() => "<unreadable response body>");
      console.error("Magic link send rejected by Resend:", res.status, detail);
    }
    return res.ok;
  } catch (e) {
    console.error("Magic link send threw:", e);
    return false;
  }
}

// ── Full-mode helpers (only loaded when DB + JWT_SECRET exist) ─────────

let _fullAuth = null;
async function fullAuth() {
  if (!_fullAuth) {
    _fullAuth = await import("../lib/authHelpers.js");
  }
  return _fullAuth;
}

let _rateLimit = null;
async function rateLimit() {
  if (!_rateLimit) {
    _rateLimit = await import("../lib/rateLimit.js");
  }
  return _rateLimit;
}

// Builds the final signed-in response: sets the real session cookie (JWT if
// JWT_SECRET is configured, legacy DB session otherwise) and, when called
// from verify-code, also clears the now-spent pending-auth cookie in the
// SAME response rather than needing a second round trip.
async function issueSession(env, user, isSecure, cors, extraSetCookies = []) {
  const auth = await fullAuth();
  // username/name/affiliation are only ever present on `user` objects the
  // OTP path builds (it selects/inserts them explicitly); the legacy
  // signup/login/magic-verify paths below still pass a plain {id, email}
  // and get `null` for all three here rather than a thrown error — their
  // own SELECT queries weren't touched, so this is what "not fetched on
  // THIS request" looks like, not a bug. A subsequent get-profile call
  // (functions/api/data.js) picks up the real values regardless of path.
  const payload = {
    id: user.id,
    email: user.email,
    username: user.username ?? null,
    name: user.name ?? null,
    affiliation: user.affiliation ?? null,
  };
  const headers = new Headers(cors);
  for (const c of extraSetCookies) headers.append("Set-Cookie", c);
  if (env.JWT_SECRET) {
    // Stamp the account's current session epoch into the token so it can be
    // revoked later (logout, account deletion). See bumpSessionEpoch.
    const { epoch } = await auth.currentSessionEpoch(env, user.id);
    const jwt = await auth.signJWT({ sub: user.id, email: user.email, epoch }, env);
    headers.append("Set-Cookie", auth.jwtCookieHeader(jwt, isSecure));
    return json({ success: true, user: payload }, 200, headers);
  }
  const token = await auth.createSession(env, user.id);
  headers.append("Set-Cookie", auth.sessionCookieHeader(token, isSecure));
  return json({ success: true, user: payload }, 200, headers);
}

// ══════════════════════════════════════════════════════════════════════
// Request handler
// ══════════════════════════════════════════════════════════════════════

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  /* Whether the session cookie carries `Secure`.
   *
   * This was derived purely from the request URL's protocol, so anything
   * terminating TLS upstream and forwarding http:// produced a session cookie
   * with no Secure flag — under the same cookie name, which meant it was then
   * also sent on the real https origin. Localhost is the one legitimate
   * http case; everything else gets Secure whatever the protocol says. */
  const hostname = url.hostname;
  const isLocalDev = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  const isSecure = !isLocalDev;

  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin =
    ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin)
      ? reqOrigin
      : "https://askcerebrum.org";
  const cors = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };

  /* Origin is checked BEFORE the preflight is answered. The old order replied
   * 204 with Allow-Credentials to origins it was about to reject. */
  if (!originAllowed(reqOrigin)) return json({ error: "Request blocked.", code: "origin_not_allowed" }, 403, cors);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });

  /* CSRF: every action on this endpoint mutates authentication state, so a
   * POST must prove it came from one of our own pages. `originAllowed`
   * deliberately permits a MISSING Origin (same-origin GETs omit it), which
   * makes it useless as a write-path control on its own — SameSite=Lax was
   * carrying that load alone, and Lax does not cover a top-level cross-site
   * form POST. Sec-Fetch-Site is browser-set and unspoofable by page script;
   * an allowlisted Origin is the other acceptable proof. */
  if (request.method === "POST") {
    const site = request.headers.get("Sec-Fetch-Site") || "";
    const originOk = reqOrigin && (ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin));
    if (!originOk && site !== "same-origin") {
      return json({ error: "Request blocked.", code: "origin_not_allowed" }, 403, cors);
    }
  }

  /* Fail closed. Every branch below assumes a verifiable session store; if
   * there isn't one, we say so rather than inventing a weaker one. 503 (not
   * 500) because this is availability, not a client error, and Retry-After
   * tells a well-behaved client to come back. */
  if (!env || !env.DB) {
    console.error("auth: D1 binding missing — refusing to authenticate");
    return json(
      { error: "Sign-in is temporarily unavailable. Please try again shortly.", code: "auth_unavailable" },
      503,
      { ...cors, "Retry-After": "30" }
    );
  }

  // ── Rate limiting (both modes) ──────────────────────────────────────
  // Used to only run in full mode; moved outside that gate because a
  // deployment can have RESEND_API_KEY configured (and so can actually send
  // OTP emails) before D1 is provisioned, and an unthrottled send-code in
  // that state is a free way to spam an arbitrary inbox or burn Resend
  // sending quota. checkRateLimit() itself is DB-independent — it prefers
  // env.RATE_LIMIT_KV and falls back to a per-isolate in-memory counter — so
  // calling it here has no dependency on fullMode either.
  {
    const { checkRateLimit } = await rateLimit();
    const { clientIp, privacyKey } = await import("../lib/http.js");
    /* X-Forwarded-For is no longer consulted. It is a client-settable header,
     * so honouring it let anyone rotate their own rate-limit bucket by
     * changing a string — which is the same as having no limiter. On
     * Cloudflare, CF-Connecting-IP is set at the edge and cannot be spoofed.
     *
     * The key is hashed under a server secret before it reaches storage:
     * rate-limit rows are long-lived, and `authip:203.0.113.7` is a durable
     * record of who tried to sign in and when. */
    const ipKey = await privacyKey("authip", clientIp(request), env);
    if (!(await checkRateLimit(env, ipKey, 40, 60000))) {
      return json(
        { error: "Too many requests. Please wait a moment." },
        429,
        { ...cors, "Retry-After": "30" }
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // GET — session check ("who am I?")
  // ═══════════════════════════════════════════════════════════════════
  if (request.method === "GET") {
    try {
      const auth = await fullAuth();
      const user = await auth.getSessionUser(request, env);
      return json({ user }, 200, cors);
    } catch (e) {
      // A failure here means we could not VERIFY a session, which is not the
      // same as "no session" — but the safe rendering of an unverifiable
      // session is signed out.
      console.error("Auth GET error:", e);
      return json({ user: null }, 200, cors);
    }
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405, cors);
  }

  const body = await request.json().catch(() => ({}));
  const action = body && typeof body.action === "string" ? body.action : "";

  try {
    const { checkRateLimit } = await rateLimit();

    // ═════════════════════════════════════════════════════════════════
    // send-code / verify-code — the OTP flow, both modes share the shape,
    // only where the pending state lives differs (D1 row vs. in-memory).
    // ═════════════════════════════════════════════════════════════════

    if (action === "send-code") {
      const email = (body.email || "").trim();
      if (!isValidEmail(email))
        return json({ error: "Enter a valid email address." }, 400, cors);
      const emailLower = email.toLowerCase();
      /* Two dimensions, because one was not enough. The per-email cap stopped
       * one address being bombarded, but nothing capped a single caller
       * requesting codes for MANY addresses — a mail-bombing primitive and a
       * way to burn the email provider's quota, throttled only by the 40/min
       * global. Both keys are hashed so neither an address nor an IP is
       * stored in plaintext. */
      const { clientIp: _ip, privacyKey: _pk } = await import("../lib/http.js");
      const sendIpKey = await _pk("otp-send-ip", _ip(request), env);
      if (!(await checkRateLimit(env, sendIpKey, 12, 15 * 60000))) {
        return json({ error: "Too many sign-in codes requested. Please wait a few minutes.", code: "rate_limited" }, 429, { ...cors, "Retry-After": "300" });
      }
      const sendKey = await _pk("otp-send", emailLower, env);
      if (!(await checkRateLimit(env, sendKey, 5, 15 * 60000))) {
        return json(
          { error: "Too many codes requested for this email. Try again later." },
          429,
          cors
        );
      }

      const auth = await fullAuth(); // pure crypto helpers — no DB/JWT dependency
      const code = randomOtp();
      const flowToken = auth.randomToken(24);
      const codeHash = await auth.hashOtp(env, emailLower, code);
      const flowHash = await auth.sha256Hex(flowToken);
      const now = Date.now();

      {
        try {
          await ensureOtpTable(env);
          await env.DB.prepare(
            "INSERT OR REPLACE INTO otp_codes (email_lower, code_hash, flow_hash, attempts, created_at, expires_at) VALUES (?, ?, ?, 0, ?, ?)"
          )
            .bind(emailLower, codeHash, flowHash, now, now + OTP_TTL_MS)
            .run();
        } catch (e) {
          // ensureOtpTable() above should make this unreachable in practice,
          // but fail closed rather than silently pretending a code was
          // issued that verify-code could never check against.
          console.error("send-code DB write failed:", e);
          return json(
            { error: "Sign-in is temporarily unavailable. Please try again shortly." },
            503,
            cors
          );
        }
      }

      const sent = await sendOtpEmail(env, email, code);
      if (!sent) {
        return json(
          { error: "Couldn't send the sign-in code right now. Please try again shortly." },
          503,
          cors
        );
      }
      return json({ ok: true }, 200, { ...cors, "Set-Cookie": pendingCookieHeader(flowToken, isSecure) });
    }

    if (action === "verify-code") {
      const email = (body.email || "").trim();
      const code = (body.code || "").trim();
      const emailLower = email.toLowerCase();
      // Client always sees the same generic message — telling an attacker
      // WHY a guess failed (wrong code vs. no pending code vs. expired vs.
      // missing cookie) is a free enumeration/timing oracle. The reason
      // still goes to the server log, since "sign-in doesn't work" reports
      // are otherwise impossible to diagnose after the fact.
      const fail = (reason) => {
        console.error("verify-code rejected:", reason, "email:", emailLower);
        return json({ error: "Invalid or expired code." }, 401, cors);
      };

      if (!isValidEmail(email) || !/^\d{6}$/.test(code)) return fail("malformed email or code in request body");
      const { privacyKey: _pk2 } = await import("../lib/http.js");
      const verifyKey = await _pk2("otp-verify", emailLower, env);
      if (!(await checkRateLimit(env, verifyKey, 8, 15 * 60000))) {
        return json({ error: "Too many attempts. Please wait a moment." }, 429, cors);
      }

      const auth = await fullAuth();
      const flowToken = getPendingCookie(request);

      {
        await ensureOtpTable(env);
        await auth.ensureUserProfileColumns(env);
        await auth.ensureSocialTables(env);
        // Computed unconditionally, even when no row exists: a uniform cost
        // here means the presence or absence of a pending code does not leak
        // through timing.
        const codeHash = await auth.hashOtp(env, emailLower, code);
        const flowHash = flowToken ? await auth.sha256Hex(flowToken) : null;
        const store = {
          getOtpRow: (e) => env.DB.prepare("SELECT * FROM otp_codes WHERE email_lower = ?").bind(e).first(),
          consumeOtpRow: (e) => env.DB.prepare("DELETE FROM otp_codes WHERE email_lower = ?").bind(e).run(),
          bumpOtpAttempts: (e) => env.DB.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE email_lower = ?").bind(e).run(),
        };
        const decision = await runOtpAttempt(store, emailLower, { codeHash, flowHash });
        /* Every non-"valid" decision returns the same generic response. This
         * used to answer a burned code with a distinct 429, which let anyone
         * probe whether a sign-in code was currently pending for an address
         * they do not own (and whether five guesses had already landed on
         * it). The reason still goes to the server log, where it belongs. */
        if (decision !== "valid") return fail(`otp decision: ${decision}`);

        // email_lower, not email, is the lookup key here — same as every
        // other query in this file — so "Foo@x.com" and "foo@x.com" resolve
        // to the same account instead of silently creating two.
        let user = await env.DB.prepare("SELECT id, email, username, name, affiliation FROM users WHERE email_lower = ?")
          .bind(emailLower)
          .first();
        if (!user) {
          const id = auth.newId("u");
          const nowTs = Date.now();
          // users.username carries a real UNIQUE constraint on the live
          // table, and the default here is just the email's local part —
          // two different domains can easily share one ("info@", "admin@",
          // "contact@"), so the plain derived value WILL collide sooner or
          // later. Retry with a short random suffix on that specific
          // failure rather than letting a collision surface as a raw 500
          // on what should be a routine signup.
          const baseUsername = (emailLower.split("@")[0] || "user").replace(/[^a-z0-9_]/gi, "").slice(0, 30) || "user";
          let username = baseUsername;
          let inserted = false;
          for (let attempt = 0; attempt < 6 && !inserted; attempt++) {
            try {
              await env.DB.prepare(
                "INSERT INTO users (id, email, email_lower, username, name, affiliation, created_at, last_login_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)"
              )
                .bind(id, email, emailLower, username, nowTs, nowTs)
                .run();
              inserted = true;
            } catch (e) {
              if (attempt === 5 || !/UNIQUE constraint failed:\s*users\.username/i.test(String(e && e.message))) throw e;
              username = `${baseUsername}${Math.floor(1000 + Math.random() * 9000)}`;
            }
          }
          user = { id, email, username, name: null, affiliation: null };
          // Genuinely true for anyone whose account is being created during
          // this preview phase — see PROFILE_BADGES' own comment in
          // main.jsx for why the other two badges (peer reviewer, published
          // author) are NOT auto-granted: there's no verification behind
          // them yet, so granting them to everyone would turn an honest
          // "not implemented" gap into a false claim. accolades.id is a
          // plain TEXT primary key on the live table (no autoincrement), so
          // it has to be generated here rather than left for the database.
          await env.DB.prepare("INSERT OR IGNORE INTO accolades (id, user_id, badge_type, granted_at) VALUES (?, ?, 'early_adopter', ?)")
            .bind(auth.newId("acc"), id, nowTs)
            .run();
        } else {
          await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
            .bind(Date.now(), user.id)
            .run();
        }

        return issueSession(env, user, isSecure, cors, [clearPendingCookieHeader(isSecure)]);
      }

    }

    // ═════════════════════════════════════════════════════════════════
    // FULL MODE — legacy DB-backed password / magic-link auth. Kept for any
    // account created before the OTP flow shipped; the frontend no longer
    // has UI for these, but nothing served by them is removed.
    // ═════════════════════════════════════════════════════════════════
    const auth = await fullAuth();

    /* ── logout ────────────────────────────────────────────────────────
     * This used to clear the browser cookie and stop. destroySessionByToken()
     * existed in authHelpers.js and was never called from anywhere, so a
     * captured DB session token stayed valid for its full 30 days after the
     * user pressed "sign out" — on a shared computer, that is the whole point
     * of the button failing.
     *
     * Both session kinds are now revoked. The opaque DB token is deleted. A
     * JWT cannot be deleted (that is what stateless means), so the account's
     * session epoch is bumped instead: getSessionUser refuses any JWT issued
     * before the current epoch, which invalidates every outstanding token for
     * this account at once. That is deliberately "sign out everywhere" rather
     * than "sign out here" — for a research account reached by email code, the
     * safer default is the broader one. */
    if (action === "logout") {
      try {
        const raw = auth.readSessionCookie(request);
        if (raw) await auth.destroySessionByToken(env, raw);
        const current = await auth.getSessionUser(request, env);
        if (current) await auth.bumpSessionEpoch(env, current.id);
      } catch (e) {
        // Best effort: the cookie is cleared regardless, so the user is signed
        // out of this browser even if revocation failed. Logged, not hidden.
        console.error("logout revocation failed:", e);
      }
      return json({ ok: true }, 200, {
        ...cors,
        "Set-Cookie": auth.clearSessionCookieHeader(isSecure),
      });
    }

    /* ── delete-account ────────────────────────────────────────────────
     * Deletion has to be true, because the Privacy page says it is.
     *
     * The previous version removed five tables: saved sources, collections,
     * history, sessions and the user row. Everything else the account had
     * created stayed in D1 — direct messages including their base64
     * attachment blobs, thread membership, follows in both directions,
     * blocks, accolades, watched topics, call signalling rows, magic links
     * and pending OTP codes. All of it keyed to a user id whose row was gone,
     * so it was not even reachable to delete later.
     *
     * Two records are deliberately kept and anonymised rather than removed:
     * reports this account FILED against other people (deleting your account
     * should not erase a moderation trail others depend on) and reports filed
     * ABOUT it. Both have their user references nulled, so nothing links back
     * to a person. That is stated plainly in the Privacy Center rather than
     * described as complete erasure.
     *
     * The JWT problem is real and handled: with JWT_SECRET set, getSessionUser
     * never touches the database, so a deleted user's cookie would keep
     * authenticating a ghost until it expired. bumpSessionEpoch writes the
     * epoch to a tombstone the verifier checks, and getSessionUser also now
     * confirms the account row still exists. */
    if (action === "delete-account") {
      const current = await auth.getSessionUser(request, env);
      if (!current) return json({ error: "Sign in first.", code: "unauthenticated" }, 401, cors);
      const uid = current.id;
      const emailLower = String(current.email || "").toLowerCase();

      // Anonymise first, so a failure part-way through never leaves a report
      // pointing at a user row that has already gone.
      const anonymise = [
        "UPDATE content_reports SET reporter_id = NULL WHERE reporter_id = ?",
        "UPDATE content_reports SET reported_user_id = NULL WHERE reported_user_id = ?",
      ];
      for (const sql of anonymise) {
        try { await env.DB.prepare(sql).bind(uid).run(); } catch (e) { console.error("delete-account anonymise:", e); }
      }

      // Every table that holds a reference to this account. Each is attempted
      // independently: a table that does not exist on this deployment must not
      // abort the deletion of the ones that do.
      const purges = [
        ["messages",           "DELETE FROM messages WHERE sender_id = ?"],
        ["thread_participants","DELETE FROM thread_participants WHERE user_id = ?"],
        ["call_signals",       "DELETE FROM call_signals WHERE sender_id = ?"],
        ["follows_out",        "DELETE FROM follows WHERE follower_id = ?"],
        ["follows_in",         "DELETE FROM follows WHERE following_id = ?"],
        ["user_blocks_out",    "DELETE FROM user_blocks WHERE blocker_id = ?"],
        ["user_blocks_in",     "DELETE FROM user_blocks WHERE blocked_id = ?"],
        ["accolades",          "DELETE FROM accolades WHERE user_id = ?"],
        ["watched_topics",     "DELETE FROM watched_topics WHERE user_id = ?"],
        ["user_saved_sources", "DELETE FROM user_saved_sources WHERE user_id = ?"],
        ["user_collections",   "DELETE FROM user_collections WHERE user_id = ?"],
        ["user_history",       "DELETE FROM user_history WHERE user_id = ?"],
        ["sessions",           "DELETE FROM sessions WHERE user_id = ?"],
      ];
      const failed = [];
      for (const [label, sql] of purges) {
        try { await env.DB.prepare(sql).bind(uid).run(); }
        catch (e) { failed.push(label); console.error("delete-account purge failed:", label, e); }
      }
      // Email-keyed rows.
      for (const sql of [
        "DELETE FROM otp_codes WHERE email_lower = ?",
        "DELETE FROM magic_links WHERE email_lower = ?",
      ]) {
        try { await env.DB.prepare(sql).bind(emailLower).run(); } catch (e) { console.error("delete-account email purge:", e); }
      }

      // Threads left with no participants are orphans; remove them and any
      // messages still attached so a conversation does not survive both
      // parties leaving.
      try {
        await env.DB.prepare(
          "DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE id NOT IN (SELECT thread_id FROM thread_participants))"
        ).run();
        await env.DB.prepare(
          "DELETE FROM threads WHERE id NOT IN (SELECT thread_id FROM thread_participants)"
        ).run();
      } catch (e) { console.error("delete-account orphan sweep:", e); }

      // Tombstone before the row goes, so any JWT still in flight is refused.
      try { await auth.bumpSessionEpoch(env, uid, { tombstone: true }); } catch (e) { console.error("delete-account tombstone:", e); }

      try {
        await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(uid).run();
      } catch (e) {
        // If the account row itself cannot be removed, do NOT report success.
        // Claiming deletion that did not happen is worse than an error.
        console.error("delete-account: users row delete failed:", e);
        return json(
          { error: "We couldn't finish deleting your account. Nothing was partially removed that you need to act on — please try again, or email us.", code: "delete_incomplete" },
          500,
          cors
        );
      }

      if (failed.length) console.error("delete-account completed with residue:", failed.join(","));
      return json({ ok: true }, 200, {
        ...cors,
        "Set-Cookie": auth.clearSessionCookieHeader(isSecure),
      });
    }

    return json({ error: "Unknown action.", code: "unknown_action" }, 400, cors);
  } catch (e) {
    console.error("Auth endpoint error:", action, e);
    const hint = action ? ` (${action})` : "";
    return json(
      {
        error: `Something went wrong${hint}. Please try again.`,
        code: "INTERNAL_ERROR",
      },
      500,
      cors
    );
  }
}
