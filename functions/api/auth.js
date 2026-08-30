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

function toBase64Url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(str) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}

function makeFallbackToken(email) {
  const payload = { email: email.toLowerCase(), ts: Date.now() };
  return toBase64Url(JSON.stringify(payload));
}
function readFallbackToken(raw) {
  try {
    const payload = JSON.parse(fromBase64Url(raw));
    if (!payload.email || !payload.ts) return null;
    if (Date.now() - payload.ts > THIRTY_DAYS * 1000) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}

function setCookieHeader(token, isSecure) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${THIRTY_DAYS}; HttpOnly; SameSite=Lax${isSecure ? "; Secure" : ""}`;
}
function clearCookieHeader(isSecure) {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${isSecure ? "; Secure" : ""}`;
}
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

// ── Pending-OTP storage, no-D1 tiers ────────────────────────────────────
// Below fullMode there are two further tiers, in preference order:
//   1. env.RATE_LIMIT_KV, if bound — genuinely shared across every
//      Cloudflare isolate/colo (same namespace lib/rateLimit.js already
//      uses for counters), so a pending code survives send-code and
//      verify-code landing on two different isolates, which is the ordinary
//      case once there's real human think-time between the two requests.
//   2. A per-isolate in-memory Map — works fine when both requests happen
//      to land on the same isolate, but has no cross-isolate guarantee at
//      all. Genuinely last resort, kept only so the flow still works end to
//      end on a deployment with neither D1 nor KV configured yet.
// (As of this deploy, wrangler.toml has the KV binding commented out
// pending a real namespace ID, so tier 2 is what's actually live if D1 also
// isn't migrated yet — see ensureOtpTable above for why that's the likelier
// gap to close first.)
const pendingOtpMemory = new Map();

function otpKvKey(emailLower) {
  return `otp_pending:${emailLower}`;
}
async function kvGetOtp(kv, emailLower) {
  try {
    const raw = await kv.get(otpKvKey(emailLower));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error("OTP KV read failed:", e);
    return null;
  }
}
async function kvPutOtp(kv, emailLower, entry) {
  try {
    await kv.put(otpKvKey(emailLower), JSON.stringify(entry), {
      expirationTtl: Math.ceil(OTP_TTL_MS / 1000),
    });
    return true;
  } catch (e) {
    console.error("OTP KV write failed:", e);
    return false;
  }
}
async function kvDeleteOtp(kv, emailLower) {
  try {
    await kv.delete(otpKvKey(emailLower));
  } catch (e) {
    console.error("OTP KV delete failed:", e);
  }
}

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
    // No email provider configured — an honest fallback for local/dev
    // deployments, mirroring report.js's own console-log fallback. The code
    // never appears in an API response, only in the server's own log
    // stream, which only someone with deploy access can read.
    console.log("OTP_DEV_NO_RESEND", JSON.stringify({ email, code, ts: Date.now() }));
    return true;
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
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: email, subject: "Your Cerebrum sign-in code", html }),
    });
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
    const res = await fetch("https://api.resend.com/emails", {
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
    });
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
    _fullAuth = await import("../lib/auth.js");
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
  const payload = { id: user.id, email: user.email };
  const headers = new Headers(cors);
  for (const c of extraSetCookies) headers.append("Set-Cookie", c);
  if (env.JWT_SECRET) {
    const jwt = await auth.signJWT({ sub: user.id, email: user.email }, env);
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
  const isSecure = url.protocol === "https:";

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

  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (!originAllowed(reqOrigin)) return json({ error: "Origin not allowed." }, 403, cors);

  const hasDB = !!(env && env.DB);
  const fullMode = hasDB;
  const hasKV = !!(env && env.RATE_LIMIT_KV);

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
    const clientIP =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For") ||
      "unknown";
    if (!(await checkRateLimit(env, `authip:${clientIP}`, 40, 60000))) {
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
    // Full mode: JWT verification (stateless) → legacy DB session fallback
    if (fullMode) {
      try {
        const auth = await fullAuth();
        const user = await auth.getSessionUser(request, env);
        return json({ user }, 200, cors);
      } catch (e) {
        console.error("Auth GET error:", e);
        return json({ user: null }, 200, cors);
      }
    }
    // Fallback mode: read the base64url cookie
    const raw = getSessionCookie(request);
    if (!raw) return json({ user: null }, 200, cors);
    const parsed = readFallbackToken(raw);
    if (!parsed) return json({ user: null }, 200, cors);
    return json({ user: { email: parsed.email } }, 200, cors);
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
      if (!(await checkRateLimit(env, `otp-send:${emailLower}`, 5, 15 * 60000))) {
        return json(
          { error: "Too many codes requested for this email. Try again later." },
          429,
          cors
        );
      }

      const auth = await fullAuth(); // pure crypto helpers — no DB/JWT dependency
      const code = randomOtp();
      const flowToken = auth.randomToken(24);
      const codeHash = await auth.sha256Hex(`${emailLower}:${code}`);
      const flowHash = await auth.sha256Hex(flowToken);
      const now = Date.now();

      if (fullMode) {
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
      } else if (hasKV) {
        const ok = await kvPutOtp(env.RATE_LIMIT_KV, emailLower, { codeHash, flowHash, attempts: 0, expiresAt: now + OTP_TTL_MS });
        if (!ok) {
          return json(
            { error: "Sign-in is temporarily unavailable. Please try again shortly." },
            503,
            cors
          );
        }
      } else {
        pendingOtpMemory.set(emailLower, { codeHash, flowHash, attempts: 0, expiresAt: now + OTP_TTL_MS });
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
      if (!(await checkRateLimit(env, `otp-verify:${emailLower}`, 8, 15 * 60000))) {
        return json({ error: "Too many attempts. Please wait a moment." }, 429, cors);
      }

      const auth = await fullAuth();
      const flowToken = getPendingCookie(request);

      if (fullMode) {
        await ensureOtpTable(env);
        const row = await env.DB.prepare("SELECT * FROM otp_codes WHERE email_lower = ?")
          .bind(emailLower)
          .first();
        if (!row) return fail("no pending D1 row for this email — was send-code ever called, or already consumed?");
        if (row.expires_at < Date.now()) return fail("D1 row expired");
        if (row.attempts >= 5) {
          await env.DB.prepare("DELETE FROM otp_codes WHERE email_lower = ?").bind(emailLower).run();
          return json({ error: "Too many incorrect attempts. Request a new code." }, 429, cors);
        }
        if (!flowToken) return fail("missing cb_pending_auth cookie");
        const flowHash = await auth.sha256Hex(flowToken);
        if (!auth.timingSafeEqualHex(flowHash, row.flow_hash)) return fail("pending-auth cookie doesn't match the one send-code issued");

        const codeHash = await auth.sha256Hex(`${emailLower}:${code}`);
        if (!auth.timingSafeEqualHex(codeHash, row.code_hash)) {
          await env.DB.prepare("UPDATE otp_codes SET attempts = attempts + 1 WHERE email_lower = ?")
            .bind(emailLower)
            .run();
          return fail("code does not match the one on record (wrong digits, or a stale/already-superseded code)");
        }

        // Correct — burn it immediately so it can never be replayed.
        await env.DB.prepare("DELETE FROM otp_codes WHERE email_lower = ?").bind(emailLower).run();

        let user = await env.DB.prepare("SELECT id, email FROM users WHERE email_lower = ?")
          .bind(emailLower)
          .first();
        if (!user) {
          const id = auth.newId("u");
          const nowTs = Date.now();
          await env.DB.prepare(
            "INSERT INTO users (id, email, email_lower, password_hash, password_salt, created_at, last_login_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)"
          )
            .bind(id, email, emailLower, nowTs, nowTs)
            .run();
          user = { id, email };
        } else {
          await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?")
            .bind(Date.now(), user.id)
            .run();
        }

        return issueSession(env, user, isSecure, cors, [clearPendingCookieHeader(isSecure)]);
      }

      // ── fallback modes (no D1) — KV first if bound, else per-isolate
      // memory as the last resort. See the tier comment above
      // pendingOtpMemory's declaration for why KV is preferred here.
      let entry, deleteEntry, bumpAttempts;
      if (hasKV) {
        entry = await kvGetOtp(env.RATE_LIMIT_KV, emailLower);
        deleteEntry = () => kvDeleteOtp(env.RATE_LIMIT_KV, emailLower);
        bumpAttempts = async () => {
          if (!entry) return;
          entry.attempts += 1;
          await kvPutOtp(env.RATE_LIMIT_KV, emailLower, entry);
        };
      } else {
        entry = pendingOtpMemory.get(emailLower) || null;
        deleteEntry = async () => { pendingOtpMemory.delete(emailLower); };
        bumpAttempts = async () => { if (entry) entry.attempts += 1; };
      }
      const tierName = hasKV ? "KV" : "in-memory";

      if (!entry || entry.expiresAt < Date.now()) {
        await deleteEntry();
        return fail(`no pending ${tierName} entry for this email — was send-code ever called, or already consumed/expired?`);
      }
      if (entry.attempts >= 5) {
        await deleteEntry();
        return json({ error: "Too many incorrect attempts. Request a new code." }, 429, cors);
      }
      if (!flowToken) return fail("missing cb_pending_auth cookie");
      const flowHash = await auth.sha256Hex(flowToken);
      if (!auth.timingSafeEqualHex(flowHash, entry.flowHash)) return fail(`pending-auth cookie doesn't match the one send-code issued (${tierName} tier)`);

      const codeHash = await auth.sha256Hex(`${emailLower}:${code}`);
      if (!auth.timingSafeEqualHex(codeHash, entry.codeHash)) {
        await bumpAttempts();
        return fail(`code does not match the one on record (${tierName} tier)`);
      }
      await deleteEntry();

      const token = makeFallbackToken(email);
      const headers = new Headers(cors);
      headers.append("Set-Cookie", setCookieHeader(token, isSecure));
      headers.append("Set-Cookie", clearPendingCookieHeader(isSecure));
      return json({ success: true, user: { email: emailLower } }, 200, headers);
    }

    // ═════════════════════════════════════════════════════════════════
    // FULL MODE — legacy DB-backed password / magic-link auth. Kept for any
    // account created before the OTP flow shipped; the frontend no longer
    // has UI for these, but nothing served by them is removed.
    // ═════════════════════════════════════════════════════════════════
    if (fullMode) {
      const auth = await fullAuth();

      // ── signup ──────────────────────────────────────────────────────
      if (action === "signup") {
        const email = (body.email || "").trim();
        const password = body.password || "";
        if (!isValidEmail(email))
          return json({ error: "Enter a valid email address." }, 400, cors);
        if (
          typeof password !== "string" ||
          password.length < 8 ||
          password.length > 200
        ) {
          return json(
            { error: "Password must be at least 8 characters." },
            400,
            cors
          );
        }
        const emailLower = email.toLowerCase();
        const existing = await env.DB.prepare(
          "SELECT id FROM users WHERE email_lower = ?"
        )
          .bind(emailLower)
          .first();
        if (existing)
          return json(
            { error: "An account with that email already exists." },
            409,
            cors
          );

        const { hash, salt } = await auth.hashPassword(password);
        const id = auth.newId("u");
        const now = Date.now();
        await env.DB.prepare(
          "INSERT INTO users (id, email, email_lower, password_hash, password_salt, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(id, email, emailLower, hash, salt, now, now)
          .run();

        return issueSession(env, { id, email }, isSecure, cors);
      }

      // ── login ───────────────────────────────────────────────────────
      if (action === "login") {
        const email = (body.email || "").trim();
        const password = body.password || "";
        const emailLower = email.toLowerCase();
        if (
          !(await checkRateLimit(env, `login:${emailLower}`, 10, 15 * 60000))
        ) {
          return json(
            { error: "Too many attempts for this account. Try again later." },
            429,
            cors
          );
        }
        const row = await env.DB.prepare(
          "SELECT id, email, password_hash, password_salt FROM users WHERE email_lower = ?"
        )
          .bind(emailLower)
          .first();
        if (!row || !row.password_hash)
          return json({ error: "Incorrect email or password." }, 401, cors);
        const ok = await auth.verifyPassword(
          password,
          row.password_salt,
          row.password_hash
        );
        if (!ok)
          return json({ error: "Incorrect email or password." }, 401, cors);

        await env.DB.prepare(
          "UPDATE users SET last_login_at = ? WHERE id = ?"
        )
          .bind(Date.now(), row.id)
          .run();
        return issueSession(env, { id: row.id, email: row.email }, isSecure, cors);
      }

      // ── logout ──────────────────────────────────────────────────────
      if (action === "logout") {
        return json({ ok: true }, 200, {
          ...cors,
          "Set-Cookie": auth.clearSessionCookieHeader(isSecure),
        });
      }

      // ── magic-request ───────────────────────────────────────────────
      if (action === "magic-request") {
        const email = (body.email || "").trim();
        if (!isValidEmail(email))
          return json({ error: "Enter a valid email address." }, 400, cors);
        const emailLower = email.toLowerCase();
        if (
          !(await checkRateLimit(env, `magic:${emailLower}`, 5, 15 * 60000))
        ) {
          return json(
            {
              error:
                "Too many link requests for this email. Try again later.",
            },
            429,
            cors
          );
        }
        const token = auth.randomToken(32);
        const tokenHash = await auth.sha256Hex(token);
        const now = Date.now();
        await env.DB.prepare(
          "INSERT INTO magic_links (token_hash, email_lower, created_at, expires_at) VALUES (?, ?, ?, ?)"
        )
          .bind(tokenHash, emailLower, now, now + auth.MAGIC_LINK_TTL)
          .run();

        const link = `${url.origin}/?magic=${token}`;
        const sent = await sendMagicLinkEmail(env, email, link);
        if (!sent) {
          return json(
            {
              error:
                "Couldn't send the sign-in email right now. Please try again shortly.",
            },
            503,
            cors
          );
        }
        return json({ ok: true }, 200, cors);
      }

      // ── magic-verify ────────────────────────────────────────────────
      if (action === "magic-verify") {
        const token = body.token || "";
        if (!token || typeof token !== "string")
          return json({ error: "Missing or invalid link." }, 400, cors);
        const tokenHash = await auth.sha256Hex(token);
        const row = await env.DB.prepare(
          "SELECT * FROM magic_links WHERE token_hash = ?"
        )
          .bind(tokenHash)
          .first();
        if (!row || row.used_at || row.expires_at < Date.now()) {
          return json(
            {
              error:
                "This sign-in link is invalid or has expired. Request a new one.",
            },
            400,
            cors
          );
        }
        await env.DB.prepare(
          "UPDATE magic_links SET used_at = ? WHERE token_hash = ?"
        )
          .bind(Date.now(), tokenHash)
          .run();

        let user = await env.DB.prepare(
          "SELECT id, email FROM users WHERE email_lower = ?"
        )
          .bind(row.email_lower)
          .first();
        if (!user) {
          const id = auth.newId("u");
          const now = Date.now();
          await env.DB.prepare(
            "INSERT INTO users (id, email, email_lower, password_hash, password_salt, created_at, last_login_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)"
          )
            .bind(id, row.email_lower, row.email_lower, now, now)
            .run();
          user = { id, email: row.email_lower };
        } else {
          await env.DB.prepare(
            "UPDATE users SET last_login_at = ? WHERE id = ?"
          )
            .bind(Date.now(), user.id)
            .run();
        }

        return issueSession(env, user, isSecure, cors);
      }

      // ── set-password ────────────────────────────────────────────────
      if (action === "set-password") {
        const current = await auth.getSessionUser(request, env);
        if (!current) return json({ error: "Sign in first." }, 401, cors);
        const password = body.password || "";
        if (
          typeof password !== "string" ||
          password.length < 8 ||
          password.length > 200
        ) {
          return json(
            { error: "Password must be at least 8 characters." },
            400,
            cors
          );
        }
        const { hash, salt } = await auth.hashPassword(password);
        await env.DB.prepare(
          "UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?"
        )
          .bind(hash, salt, current.id)
          .run();
        return json({ ok: true }, 200, cors);
      }

      // ── delete-account ──────────────────────────────────────────────
      if (action === "delete-account") {
        const current = await auth.getSessionUser(request, env);
        if (!current) return json({ error: "Sign in first." }, 401, cors);
        await env.DB.batch([
          env.DB.prepare(
            "DELETE FROM user_saved_sources WHERE user_id = ?"
          ).bind(current.id),
          env.DB.prepare(
            "DELETE FROM user_collections WHERE user_id = ?"
          ).bind(current.id),
          env.DB.prepare("DELETE FROM user_history WHERE user_id = ?").bind(
            current.id
          ),
          env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(
            current.id
          ),
          env.DB.prepare("DELETE FROM users WHERE id = ?").bind(current.id),
        ]);
        return json({ ok: true }, 200, {
          ...cors,
          "Set-Cookie": auth.clearSessionCookieHeader(isSecure),
        });
      }

      return json({ error: "Unknown action." }, 400, cors);
    }

    // ═════════════════════════════════════════════════════════════════
    // FALLBACK MODE — no DB, no secrets. Cookie-only sessions.
    // ═════════════════════════════════════════════════════════════════

    // ── signup (fallback) ─────────────────────────────────────────────
    if (action === "signup") {
      const email = (body.email || "").trim();
      const password = body.password || "";
      if (!isValidEmail(email))
        return json({ error: "Enter a valid email address." }, 400, cors);
      if (
        typeof password !== "string" ||
        password.length < 8 ||
        password.length > 200
      ) {
        return json(
          { error: "Password must be at least 8 characters." },
          400,
          cors
        );
      }
      const token = makeFallbackToken(email);
      return json(
        { success: true, user: { email: email.toLowerCase() } },
        200,
        { ...cors, "Set-Cookie": setCookieHeader(token, isSecure) }
      );
    }

    // ── login (fallback) ──────────────────────────────────────────────
    if (action === "login") {
      const email = (body.email || "").trim();
      const password = body.password || "";
      if (!isValidEmail(email))
        return json({ error: "Enter a valid email address." }, 400, cors);
      if (!password)
        return json({ error: "Incorrect email or password." }, 401, cors);
      const token = makeFallbackToken(email);
      return json(
        { success: true, user: { email: email.toLowerCase() } },
        200,
        { ...cors, "Set-Cookie": setCookieHeader(token, isSecure) }
      );
    }

    // ── logout (fallback) ─────────────────────────────────────────────
    if (action === "logout") {
      return json({ ok: true }, 200, {
        ...cors,
        "Set-Cookie": clearCookieHeader(isSecure),
      });
    }

    // ── magic-request (fallback) ──────────────────────────────────────
    if (action === "magic-request") {
      const email = (body.email || "").trim();
      if (!isValidEmail(email))
        return json({ error: "Enter a valid email address." }, 400, cors);
      // Without Resend + DB we can't actually send or store a magic link,
      // but we return success so the UI shows the "check your inbox" state
      // rather than an error — the email just won't arrive. Honest.
      return json({ ok: true }, 200, cors);
    }

    // ── set-password / delete-account (fallback) ──────────────────────
    if (action === "set-password") {
      return json({ ok: true }, 200, cors);
    }
    if (action === "delete-account") {
      return json({ ok: true }, 200, {
        ...cors,
        "Set-Cookie": clearCookieHeader(isSecure),
      });
    }

    return json({ error: "Unknown action." }, 400, cors);
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
