// Stateless JWT auth endpoint.
//
// Security model: passwords are PBKDF2-hashed (100k iterations, Cloudflare's
// max) with a unique random salt per account — the raw password never touches
// storage. Sessions are HMAC-SHA256-signed JWTs carried in an HttpOnly cookie;
// the server never stores session state, so a full D1 export yields zero
// session tokens. Magic-link tokens are stored as SHA-256 hashes; the raw
// value exists only in the email link. The session cookie is HttpOnly
// (invisible to JS, including a successful XSS) + SameSite=Lax + Secure in
// production.
//
// env.JWT_SECRET is required for JWT signing — a 256-bit+ random string set
// in Cloudflare environment variables. When absent, falls back to DB-backed
// sessions (legacy path) so existing deployments keep working.
//
// Known, deliberate scope limit: there is no email-verification step on
// password signup. Flagged here rather than silently shipped.

import {
  hashPassword,
  verifyPassword,
  isValidEmail,
  randomToken,
  sha256Hex,
  signJWT,
  jwtCookieHeader,
  sessionCookieHeader,
  clearSessionCookieHeader,
  readSessionCookie,
  getSessionUser,
  createSession,
  newId,
  MAGIC_LINK_TTL,
} from "../lib/auth.js";
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

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

async function sendMagicLinkEmail(env, email, link) {
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not configured, cannot send magic link email");
    return false;
  }
  const from = env.RESEND_FROM || "Cerebrum <noreply@askcerebrum.org>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: email,
        subject: "Your Cerebrum sign-in link",
        html: `<p>Click below to sign in to Cerebrum. This link expires in 15 minutes and can only be used once.</p><p><a href="${link}">Sign in to Cerebrum</a></p><p>If you didn't request this, you can ignore this email.</p>`,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error("Magic link send failed:", e);
    return false;
  }
}

// Issue a session credential (JWT when JWT_SECRET is configured, legacy
// DB session otherwise) and return the Response with the cookie set.
async function issueSession(env, user, isSecure, cors) {
  const payload = { id: user.id, email: user.email };
  if (env.JWT_SECRET) {
    const jwt = await signJWT({ sub: user.id, email: user.email }, env);
    return json({ user: payload }, 200, { ...cors, "Set-Cookie": jwtCookieHeader(jwt, isSecure) });
  }
  // Legacy fallback: DB-backed sessions
  const token = await createSession(env, user.id);
  return json({ user: payload }, 200, { ...cors, "Set-Cookie": sessionCookieHeader(token, isSecure) });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const isSecure = url.protocol === "https:";

  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin =
    ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin) ? reqOrigin : "https://askcerebrum.org";
  const cors = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!originAllowed(request)) return json({ error: "Origin not allowed." }, 403, cors);

  // JWT auth works without DB; only actions that write user data need it.
  const needsDB = request.method === "POST";
  if (needsDB && !env.DB) {
    return json({ error: "Accounts are not configured on this deployment." }, 503, cors);
  }

  const clientIP = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  if (!(await checkRateLimit(env, `authip:${clientIP}`, 40, 60000))) {
    return json({ error: "Too many requests. Please wait a moment." }, 429, { ...cors, "Retry-After": "30" });
  }

  // ── GET — stateless session check ──────────────────────────────────────
  if (request.method === "GET") {
    try {
      const user = await getSessionUser(request, env);
      return json({ user }, 200, cors);
    } catch (e) {
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
    // ── signup ────────────────────────────────────────────────────────────
    if (action === "signup") {
      const email = (body.email || "").trim();
      const password = body.password || "";
      if (!isValidEmail(email)) return json({ error: "Enter a valid email address." }, 400, cors);
      if (typeof password !== "string" || password.length < 8 || password.length > 200) {
        return json({ error: "Password must be at least 8 characters." }, 400, cors);
      }
      const emailLower = email.toLowerCase();
      const existing = await env.DB.prepare("SELECT id FROM users WHERE email_lower = ?").bind(emailLower).first();
      if (existing) return json({ error: "An account with that email already exists." }, 409, cors);

      const { hash, salt } = await hashPassword(password);
      const id = newId("u");
      const now = Date.now();
      await env.DB.prepare(
        "INSERT INTO users (id, email, email_lower, password_hash, password_salt, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(id, email, emailLower, hash, salt, now, now).run();

      return issueSession(env, { id, email }, isSecure, cors);
    }

    // ── login ─────────────────────────────────────────────────────────────
    if (action === "login") {
      const email = (body.email || "").trim();
      const password = body.password || "";
      const emailLower = email.toLowerCase();
      if (!(await checkRateLimit(env, `login:${emailLower}`, 10, 15 * 60000))) {
        return json({ error: "Too many attempts for this account. Try again later." }, 429, cors);
      }
      const row = await env.DB.prepare("SELECT id, email, password_hash, password_salt FROM users WHERE email_lower = ?").bind(emailLower).first();
      // Same generic error for missing email and wrong password — account
      // enumeration defense.
      if (!row || !row.password_hash) return json({ error: "Incorrect email or password." }, 401, cors);
      const ok = await verifyPassword(password, row.password_salt, row.password_hash);
      if (!ok) return json({ error: "Incorrect email or password." }, 401, cors);

      await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(Date.now(), row.id).run();
      return issueSession(env, { id: row.id, email: row.email }, isSecure, cors);
    }

    // ── logout ────────────────────────────────────────────────────────────
    if (action === "logout") {
      // JWT is stateless — clearing the cookie is the logout. No DB call
      // needed (and no session row to delete when running in JWT mode).
      return json({ ok: true }, 200, { ...cors, "Set-Cookie": clearSessionCookieHeader(isSecure) });
    }

    // ── magic-request ─────────────────────────────────────────────────────
    if (action === "magic-request") {
      const email = (body.email || "").trim();
      if (!isValidEmail(email)) return json({ error: "Enter a valid email address." }, 400, cors);
      const emailLower = email.toLowerCase();
      if (!(await checkRateLimit(env, `magic:${emailLower}`, 5, 15 * 60000))) {
        return json({ error: "Too many link requests for this email. Try again later." }, 429, cors);
      }
      const token = randomToken(32);
      const tokenHash = await sha256Hex(token);
      const now = Date.now();
      await env.DB.prepare(
        "INSERT INTO magic_links (token_hash, email_lower, created_at, expires_at) VALUES (?, ?, ?, ?)"
      ).bind(tokenHash, emailLower, now, now + MAGIC_LINK_TTL).run();

      const link = `${url.origin}/?magic=${token}`;
      const sent = await sendMagicLinkEmail(env, email, link);
      if (!sent) {
        return json({ error: "Couldn't send the sign-in email right now. Please try again shortly." }, 503, cors);
      }
      return json({ ok: true }, 200, cors);
    }

    // ── magic-verify ──────────────────────────────────────────────────────
    if (action === "magic-verify") {
      const token = body.token || "";
      if (!token || typeof token !== "string") return json({ error: "Missing or invalid link." }, 400, cors);
      const tokenHash = await sha256Hex(token);
      const row = await env.DB.prepare("SELECT * FROM magic_links WHERE token_hash = ?").bind(tokenHash).first();
      if (!row || row.used_at || row.expires_at < Date.now()) {
        return json({ error: "This sign-in link is invalid or has expired. Request a new one." }, 400, cors);
      }
      await env.DB.prepare("UPDATE magic_links SET used_at = ? WHERE token_hash = ?").bind(Date.now(), tokenHash).run();

      let user = await env.DB.prepare("SELECT id, email FROM users WHERE email_lower = ?").bind(row.email_lower).first();
      if (!user) {
        const id = newId("u");
        const now = Date.now();
        await env.DB.prepare(
          "INSERT INTO users (id, email, email_lower, password_hash, password_salt, created_at, last_login_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)"
        ).bind(id, row.email_lower, row.email_lower, now, now).run();
        user = { id, email: row.email_lower };
      } else {
        await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(Date.now(), user.id).run();
      }

      return issueSession(env, user, isSecure, cors);
    }

    // ── set-password ──────────────────────────────────────────────────────
    if (action === "set-password") {
      const current = await getSessionUser(request, env);
      if (!current) return json({ error: "Sign in first." }, 401, cors);
      const password = body.password || "";
      if (typeof password !== "string" || password.length < 8 || password.length > 200) {
        return json({ error: "Password must be at least 8 characters." }, 400, cors);
      }
      const { hash, salt } = await hashPassword(password);
      await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(hash, salt, current.id).run();
      return json({ ok: true }, 200, cors);
    }

    // ── delete-account ────────────────────────────────────────────────────
    if (action === "delete-account") {
      const current = await getSessionUser(request, env);
      if (!current) return json({ error: "Sign in first." }, 401, cors);
      // Real, immediate, cascading delete across every table.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM user_saved_sources WHERE user_id = ?").bind(current.id),
        env.DB.prepare("DELETE FROM user_collections WHERE user_id = ?").bind(current.id),
        env.DB.prepare("DELETE FROM user_history WHERE user_id = ?").bind(current.id),
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(current.id),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(current.id),
      ]);
      return json({ ok: true }, 200, { ...cors, "Set-Cookie": clearSessionCookieHeader(isSecure) });
    }

    return json({ error: "Unknown action." }, 400, cors);
  } catch (e) {
    console.error("Auth endpoint error:", action, e);
    const hint = action ? ` (${action})` : "";
    return json({ error: `Something went wrong${hint}. Please try again.`, code: "INTERNAL_ERROR" }, 500, cors);
  }
}
