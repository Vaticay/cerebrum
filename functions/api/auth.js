// Account endpoint: GET /api/auth (who am I) and POST /api/auth (everything
// else, action-multiplexed in the body). One file instead of eight separate
// routes for signup/login/logout/magic-link-request/magic-link-verify/
// set-password/delete-account — same CORS/rate-limit/session logic would
// otherwise be duplicated eight times, and every one of those duplicates is
// a place a security fix could get applied to seven files and missed in the
// eighth.
//
// Security model, in one place so it's easy to audit against the actual
// code below: passwords are never stored, only a per-user-salted PBKDF2
// hash (see functions/lib/auth.js — 210k iterations, OWASP's 2023 minimum).
// Session and magic-link tokens are stored only as a SHA-256 hash of the
// value that actually goes out in the cookie/email; the raw value is never
// written to the database, so a full D1 export is useless for logging in as
// anyone. The session cookie is HttpOnly (invisible to any JS on the page,
// including a successful XSS) + SameSite=Lax + Secure in production.
// Deleting an account is a real, immediate, cascading delete — not a
// soft-delete flag — across every table that could reference the user.
//
// Known, deliberate scope limit: there is no email-verification step on
// password signup (an account can be created with an email you don't own,
// though you could never receive a magic link or password-reset to it).
// Flagged here rather than silently shipped as if it were handled.

import {
  hashPassword,
  verifyPassword,
  isValidEmail,
  randomToken,
  sha256Hex,
  sessionCookieHeader,
  clearSessionCookieHeader,
  readSessionCookie,
  getSessionUser,
  createSession,
  destroySessionByToken,
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

// Two independent limiters, both now backed by the shared KV-aware
// checkRateLimit (see functions/lib/rateLimit.js) instead of a per-isolate
// Map: one per-IP (blunt abuse throttle across every action), one per-email
// specifically for login/magic-request (so credential stuffing against one
// account can't just be spread across many IPs to dodge the IP-level limit).
// The per-email limiter in particular is exactly the kind of check that
// NEEDS to be real across the whole edge, not per-isolate — a distributed
// credential-stuffing attempt against one email address is the textbook case
// for spreading requests across regions specifically to dodge a limiter that
// only counts within one isolate's memory.

async function sendMagicLinkEmail(env, email, link) {
  if (!env.RESEND_API_KEY) {
    console.error("Cerebrum auth: RESEND_API_KEY not configured, cannot send magic link email");
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
        html: `<p>Click below to sign in to Cerebrum. This link expires in 15 minutes and can only be used once.</p><p><a href="${link}">Sign in to Cerebrum</a></p><p>If you didn't request this, you can ignore this email — no account changes were made.</p>`,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error("Cerebrum auth: magic link send failed", e);
    return false;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const isSecure = url.protocol === "https:";

  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin =
    ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin) ? reqOrigin : "https://askcerebrum.org";
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!originAllowed(request)) return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers: cors });
  if (!env.DB) return new Response(JSON.stringify({ error: "Accounts are not configured on this deployment." }), { status: 503, headers: cors });

  const clientIP = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  if (!(await checkRateLimit(env, `authip:${clientIP}`, 40, 60000))) {
    return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment." }), { status: 429, headers: { ...cors, "Retry-After": "30" } });
  }

  // GET — "who am I", used on every app load to restore session state.
  if (request.method === "GET") {
    try {
      const user = await getSessionUser(request, env);
      return new Response(JSON.stringify({ user }), { status: 200, headers: cors });
    } catch (e) {
      console.error("Cerebrum auth GET error:", e);
      return new Response(JSON.stringify({ user: null }), { status: 200, headers: cors });
    }
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: cors });
  }

  const body = await request.json().catch(() => ({}));
  const action = body && typeof body.action === "string" ? body.action : "";

  try {
    if (action === "signup") {
      const email = (body.email || "").trim();
      const password = body.password || "";
      if (!isValidEmail(email)) return new Response(JSON.stringify({ error: "Enter a valid email address." }), { status: 400, headers: cors });
      if (typeof password !== "string" || password.length < 8 || password.length > 200) {
        return new Response(JSON.stringify({ error: "Password must be at least 8 characters." }), { status: 400, headers: cors });
      }
      const emailLower = email.toLowerCase();
      const existing = await env.DB.prepare("SELECT id FROM users WHERE email_lower = ?").bind(emailLower).first();
      if (existing) return new Response(JSON.stringify({ error: "An account with that email already exists." }), { status: 409, headers: cors });

      const { hash, salt } = await hashPassword(password);
      const id = newId("u");
      const now = Date.now();
      await env.DB.prepare(
        "INSERT INTO users (id, email, email_lower, password_hash, password_salt, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).bind(id, email, emailLower, hash, salt, now, now).run();

      const token = await createSession(env, id);
      return new Response(JSON.stringify({ user: { id, email } }), {
        status: 200,
        headers: { ...cors, "Set-Cookie": sessionCookieHeader(token, isSecure) },
      });
    }

    if (action === "login") {
      const email = (body.email || "").trim();
      const password = body.password || "";
      const emailLower = email.toLowerCase();
      if (!(await checkRateLimit(env, `login:${emailLower}`, 10, 15 * 60000))) {
        return new Response(JSON.stringify({ error: "Too many attempts for this account. Try again later." }), { status: 429, headers: cors });
      }
      const row = await env.DB.prepare("SELECT id, email, password_hash, password_salt FROM users WHERE email_lower = ?").bind(emailLower).first();
      // Same generic error whether the email doesn't exist or the password
      // is wrong — telling them apart is exactly how account enumeration
      // attacks work.
      const genericError = () => new Response(JSON.stringify({ error: "Incorrect email or password." }), { status: 401, headers: cors });
      if (!row || !row.password_hash) return genericError();
      const ok = await verifyPassword(password, row.password_salt, row.password_hash);
      if (!ok) return genericError();

      await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(Date.now(), row.id).run();
      const token = await createSession(env, row.id);
      return new Response(JSON.stringify({ user: { id: row.id, email: row.email } }), {
        status: 200,
        headers: { ...cors, "Set-Cookie": sessionCookieHeader(token, isSecure) },
      });
    }

    if (action === "logout") {
      const token = readSessionCookie(request);
      if (token) await destroySessionByToken(env, token);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...cors, "Set-Cookie": clearSessionCookieHeader(isSecure) } });
    }

    if (action === "magic-request") {
      const email = (body.email || "").trim();
      if (!isValidEmail(email)) return new Response(JSON.stringify({ error: "Enter a valid email address." }), { status: 400, headers: cors });
      const emailLower = email.toLowerCase();
      if (!(await checkRateLimit(env, `magic:${emailLower}`, 5, 15 * 60000))) {
        return new Response(JSON.stringify({ error: "Too many link requests for this email. Try again later." }), { status: 429, headers: cors });
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
        // Not an account-enumeration leak: this is a server misconfiguration
        // (no RESEND_API_KEY, or Resend itself rejected the send), the same
        // for literally every email address, not specific to this one.
        return new Response(JSON.stringify({ error: "Couldn't send the sign-in email right now. Please try again shortly." }), { status: 503, headers: cors });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
    }

    if (action === "magic-verify") {
      const token = body.token || "";
      if (!token || typeof token !== "string") return new Response(JSON.stringify({ error: "Missing or invalid link." }), { status: 400, headers: cors });
      const tokenHash = await sha256Hex(token);
      const row = await env.DB.prepare("SELECT * FROM magic_links WHERE token_hash = ?").bind(tokenHash).first();
      if (!row || row.used_at || row.expires_at < Date.now()) {
        return new Response(JSON.stringify({ error: "This sign-in link is invalid or has expired. Request a new one." }), { status: 400, headers: cors });
      }
      await env.DB.prepare("UPDATE magic_links SET used_at = ? WHERE token_hash = ?").bind(Date.now(), tokenHash).run();

      let user = await env.DB.prepare("SELECT id, email FROM users WHERE email_lower = ?").bind(row.email_lower).first();
      if (!user) {
        const id = newId("u");
        const now = Date.now();
        // Magic-link-only account: no password set yet. The person can add
        // one later from Settings if they want a second way in.
        await env.DB.prepare(
          "INSERT INTO users (id, email, email_lower, password_hash, password_salt, created_at, last_login_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)"
        ).bind(id, row.email_lower, row.email_lower, now, now).run();
        user = { id, email: row.email_lower };
      } else {
        await env.DB.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(Date.now(), user.id).run();
      }

      const sessionToken = await createSession(env, user.id);
      return new Response(JSON.stringify({ user }), {
        status: 200,
        headers: { ...cors, "Set-Cookie": sessionCookieHeader(sessionToken, isSecure) },
      });
    }

    if (action === "set-password") {
      const current = await getSessionUser(request, env);
      if (!current) return new Response(JSON.stringify({ error: "Sign in first." }), { status: 401, headers: cors });
      const password = body.password || "";
      if (typeof password !== "string" || password.length < 8 || password.length > 200) {
        return new Response(JSON.stringify({ error: "Password must be at least 8 characters." }), { status: 400, headers: cors });
      }
      const { hash, salt } = await hashPassword(password);
      await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(hash, salt, current.id).run();
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
    }

    if (action === "delete-account") {
      const current = await getSessionUser(request, env);
      if (!current) return new Response(JSON.stringify({ error: "Sign in first." }), { status: 401, headers: cors });
      // Real, immediate, cascading delete — every table that can reference
      // this user_id is cleared in the same request. Nothing soft-deleted.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM user_saved_sources WHERE user_id = ?").bind(current.id),
        env.DB.prepare("DELETE FROM user_collections WHERE user_id = ?").bind(current.id),
        env.DB.prepare("DELETE FROM user_history WHERE user_id = ?").bind(current.id),
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(current.id),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(current.id),
      ]);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...cors, "Set-Cookie": clearSessionCookieHeader(isSecure) } });
    }

    return new Response(JSON.stringify({ error: "Unknown action." }), { status: 400, headers: cors });
  } catch (e) {
    console.error("Cerebrum auth endpoint error:", action, e);
    return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), { status: 500, headers: cors });
  }
}
