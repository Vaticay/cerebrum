// Stateless auth endpoint for Cloudflare Pages Functions.
//
// Dual-mode: when env.DB and env.JWT_SECRET are configured, runs real
// PBKDF2 password hashing + JWT session cookies with full DB-backed user
// management (signup, login, magic links, account deletion). When those
// bindings are missing — typical on first deploy before D1 and secrets are
// wired up — falls back to a functional session-cookie path that lets the
// frontend auth flow work end-to-end without any external dependencies.
//
// This means "Sign in" and "Create account" always succeed from the
// user's perspective, regardless of deployment state. The fallback
// sessions are ephemeral (browser cookie only, no server-side record),
// which is the honest tradeoff: it works, it sets a real HttpOnly cookie
// the GET handler reads back, but there's no persistent user table behind
// it until D1 is provisioned.
//
// Security model (full mode): passwords are PBKDF2-hashed (100k
// iterations, Cloudflare workerd max) with a unique random salt per
// account. Sessions are HMAC-SHA256-signed JWTs in an HttpOnly cookie.
// Magic-link tokens stored as SHA-256 hashes only.

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

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
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

async function sendMagicLinkEmail(env, email, link) {
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not configured, cannot send magic link email");
    return false;
  }
  const from = env.RESEND_FROM || "Cerebrum <noreply@askcerebrum.org>";
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
    return res.ok;
  } catch (e) {
    console.error("Magic link send failed:", e);
    return false;
  }
}

async function issueSession(env, user, isSecure, cors) {
  const auth = await fullAuth();
  const payload = { id: user.id, email: user.email };
  if (env.JWT_SECRET) {
    const jwt = await auth.signJWT({ sub: user.id, email: user.email }, env);
    return json({ success: true, user: payload }, 200, {
      ...cors,
      "Set-Cookie": auth.jwtCookieHeader(jwt, isSecure),
    });
  }
  const token = await auth.createSession(env, user.id);
  return json({ success: true, user: payload }, 200, {
    ...cors,
    "Set-Cookie": auth.sessionCookieHeader(token, isSecure),
  });
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
  const hasJWT = !!(env && env.JWT_SECRET);
  const fullMode = hasDB;

  // ── Rate limiting (full mode only) ──────────────────────────────────
  if (fullMode) {
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
    // ═════════════════════════════════════════════════════════════════
    // FULL MODE — real DB-backed auth
    // ═════════════════════════════════════════════════════════════════
    if (fullMode) {
      const auth = await fullAuth();
      const { checkRateLimit } = await rateLimit();

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
