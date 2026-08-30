// Shared crypto/session helpers for the account system (functions/api/auth.js
// and functions/api/data.js both import from here). Kept as its own module
// for the same reason knowledge.js is: it's self-contained logic that
// shouldn't have to be re-read/re-reasoned-about every time the endpoints
// that use it change.
//
// Everything here follows one rule: nothing secret is ever stored in a form
// that's useful if the database leaks. Passwords are salted+PBKDF2-hashed.
// Session tokens and magic-link tokens are only ever stored as a SHA-256
// hash of the value that's actually in the cookie/email — the raw value
// exists nowhere except in transit to the one browser that holds it.

// 100,000 is not a security choice — it's Cloudflare's workerd runtime's hard
// ceiling on crypto.subtle.deriveBits('PBKDF2', ...): anything above 100,000
// iterations throws "NotSupportedError: Pbkdf2 failed: iteration counts above
// 100000 are not supported" on every single call, unconditionally, in every
// environment. This used to be set to 210,000 (a number that predates this
// account system ever running on Cloudflare and was never actually valid
// here) which meant every signup/login/set-password call was guaranteed to
// throw — this was very likely the exact cause of "error when signing in or
// signing up or anything." 100,000 is the maximum this platform allows a
// single request to spend on PBKDF2; the real security backstop here is the
// unique random salt per account plus the fact that only a hash is ever
// stored (see the file-level comment above) — see the Privacy page for the
// full, honest wording of this tradeoff.
const PBKDF2_ITERATIONS = 100000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const MAGIC_LINK_TTL_MS = 1000 * 60 * 15; // 15 minutes

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes.buffer;
}

// URL-safe base64, no padding — used for cookie/link tokens so they never
// need percent-encoding.
function toBase64Url(buf) {
  let s = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes.buffer);
}

export async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

export async function hashPassword(password) {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = toHex(saltBytes.buffer);
  const hash = await pbkdf2Hex(password, salt);
  return { hash, salt };
}

export async function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const hash = await pbkdf2Hex(password, salt);
  return timingSafeEqual(hash, expectedHash);
}

async function pbkdf2Hex(password, saltHex) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return toHex(bits);
}

// Plain === on hashes is a (very minor, hash-length) timing side-channel;
// this compares in constant time relative to string length instead.
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Exported for callers outside this module that need the same constant-time
// comparison against a pair of hex digests — e.g. auth.js's OTP verification,
// which compares a freshly-computed SHA-256 hex digest against the one
// stored for a pending sign-in code.
export function timingSafeEqualHex(a, b) {
  return timingSafeEqual(a, b);
}

export function isValidEmail(email) {
  return typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// --- Session cookie plumbing -------------------------------------------

const COOKIE_NAME = "cb_sess";

export function sessionCookieHeader(token, secure) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearSessionCookieHeader(secure) {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function readSessionCookie(request) {
  const raw = request.headers.get("Cookie") || "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

// --- JWT plumbing (stateless sessions) ------------------------------------

const JWT_TTL_S = 60 * 60 * 24 * 30; // 30 days

function b64UrlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64UrlEncodeStr(str) { return b64UrlEncode(new TextEncoder().encode(str)); }
function b64UrlDecode(str) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const raw = atob(s);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signJWT(payload, env) {
  if (!env.JWT_SECRET) throw new Error("JWT_SECRET not configured");
  const key = await hmacKey(env.JWT_SECRET);
  const header = b64UrlEncodeStr(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + JWT_TTL_S };
  const body = b64UrlEncodeStr(JSON.stringify(claims));
  const data = new TextEncoder().encode(`${header}.${body}`);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return `${header}.${body}.${b64UrlEncode(sig)}`;
}

export async function verifyJWT(token, env) {
  if (!env.JWT_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const key = await hmacKey(env.JWT_SECRET);
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = b64UrlDecode(parts[2]);
    const valid = await crypto.subtle.verify("HMAC", key, sig, data);
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64UrlDecode(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export function jwtCookieHeader(jwt, secure) {
  return `${COOKIE_NAME}=${jwt}; Path=/; Max-Age=${JWT_TTL_S}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

// Looks up the current user from the request's session cookie.
// Tries JWT verification first (stateless, no DB call). Falls back to
// legacy DB session lookup for backward compatibility with older tokens.
// Returns null (not a throw) for "not logged in."
export async function getSessionUser(request, env) {
  const raw = readSessionCookie(request);
  if (!raw) return null;

  // JWT tokens contain dots; legacy session tokens don't.
  if (raw.includes(".") && env.JWT_SECRET) {
    const payload = await verifyJWT(raw, env);
    if (payload && payload.sub && payload.email) {
      return { id: payload.sub, email: payload.email };
    }
    return null;
  }

  // Legacy DB session fallback
  if (!env.DB) return null;
  await ensureSessionTables(env);
  const tokenHash = await sha256Hex(raw);
  const row = await env.DB.prepare(
    `SELECT s.user_id AS id, s.expires_at AS expires_at, u.email AS email
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`
  ).bind(tokenHash).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    try { await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run(); } catch {}
    return null;
  }
  return { id: row.id, email: row.email };
}

export async function createSession(env, userId) {
  await ensureSessionTables(env);
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(tokenHash, userId, now, now + SESSION_TTL_MS).run();
  return token;
}

export async function destroySessionByToken(env, token) {
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export function newId(prefix) {
  return `${prefix}_${randomToken(12).replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}${Date.now().toString(36)}`;
}

export const MAGIC_LINK_TTL = MAGIC_LINK_TTL_MS;

// ══════════════════════════════════════════════════════════════════════
// Multiplayer Academic Network — schema self-healing
// ══════════════════════════════════════════════════════════════════════
// Rewritten after seeing the actual live schema, which differs from the
// first guess in real ways: `follows.following_id` not `target_id`,
// `accolades.badge_type`/`granted_at` not `badge_key`/`awarded_at`,
// `accolades`/`messages` both use a TEXT PRIMARY KEY id with no
// autoincrement (every INSERT must supply its own id via newId() below —
// omitting it inserts NULL into a PRIMARY KEY column and fails), and
// `messages` has an `attachment_title` column this code wasn't using at
// all. Every query in functions/api/auth.js and functions/api/data.js that
// touches these tables now matches these exact names. CREATE TABLE IF NOT
// EXISTS below is a no-op against the live tables (they already exist) —
// it only matters for a fresh database that hasn't run schema.sql yet, and
// is written to produce this exact shape so that path stays consistent
// with what's actually live.
//
// The live `users` table is missing four columns this codebase's OTP and
// legacy-password logic depend on: `email_lower` (every lookup in this
// file keys off it for case-insensitive matching), `password_hash` /
// `password_salt` (legacy password accounts), and `last_login_at`. Adding
// them is safe — all four are nullable, so it doesn't fight the live
// table's existing NOT NULL/UNIQUE constraints on `email` and `username` —
// but `email_lower` then needs a one-time backfill for any row that
// predates the column, which the UPDATE below does unconditionally (a
// no-op once every row already has it set).
//
// What none of this can self-heal: a column that already exists under an
// incompatible type or constraint. If something 500s after this deploys
// with a "no such column" or constraint error this file doesn't already
// account for, that's the live schema still not matching — the fix is to
// see the actual `PRAGMA table_info(...)` output and adjust to it, not to
// guess again.

let _userColumnsEnsured = false;
export async function ensureUserProfileColumns(env) {
  if (_userColumnsEnsured) return;
  // SQLite's ALTER TABLE ADD COLUMN has no "IF NOT EXISTS" — the only way
  // to make it idempotent is to attempt it and swallow the specific
  // "column already exists" failure, so this stays a no-op on every call
  // after the first real one.
  const alters = [
    "ALTER TABLE users ADD COLUMN username TEXT",
    "ALTER TABLE users ADD COLUMN name TEXT",
    "ALTER TABLE users ADD COLUMN affiliation TEXT",
    "ALTER TABLE users ADD COLUMN email_lower TEXT",
    "ALTER TABLE users ADD COLUMN password_hash TEXT",
    "ALTER TABLE users ADD COLUMN password_salt TEXT",
    "ALTER TABLE users ADD COLUMN last_login_at INTEGER",
    "ALTER TABLE users ADD COLUMN avatar_base64 TEXT",
  ];
  for (const sql of alters) {
    try {
      await env.DB.exec(sql);
    } catch (e) {
      if (!/duplicate column name/i.test(String(e && e.message))) throw e;
    }
  }
  // One-time backfill for any row that existed before email_lower did.
  // Safe to run every time — WHERE email_lower IS NULL makes it a no-op
  // once every row has it.
  await env.DB.exec("UPDATE users SET email_lower = LOWER(email) WHERE email_lower IS NULL");
  // Best-effort uniqueness on the backfilled column — wrapped separately
  // and non-fatal because retrofitting a unique index onto data that
  // predates it CAN fail (two existing rows whose emails differ only by
  // case), and a failed index shouldn't take the whole request down when
  // the actual account data underneath it is still fine to use.
  try {
    await env.DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(email_lower)");
  } catch (e) {
    console.error("Could not create unique index on users.email_lower (likely pre-existing case-duplicate rows):", e);
  }
  _userColumnsEnsured = true;
}

let _sessionTablesEnsured = false;
export async function ensureSessionTables(env) {
  if (_sessionTablesEnsured) return;
  // Only reached by the legacy DB-session path (issueSession's non-JWT
  // branch) and the legacy magic-link actions — but reached unconditionally
  // by createSession() below whenever JWT_SECRET isn't configured, so a
  // missing `sessions` table would otherwise take down the very last step
  // of sign-in after everything else already succeeded.
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)"
  );
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)");
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS magic_links (token_hash TEXT NOT NULL PRIMARY KEY, email_lower TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)"
  );
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links(email_lower)");
  _sessionTablesEnsured = true;
}

let _socialTablesEnsured = false;
export async function ensureSocialTables(env) {
  if (_socialTablesEnsured) return;
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS follows (follower_id TEXT NOT NULL, following_id TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (follower_id, following_id))"
  );
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id)");
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS accolades (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, badge_type TEXT NOT NULL, granted_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
  );
  // Not part of the live table's own definition, but additive — CREATE
  // INDEX doesn't require touching a table's original CREATE statement, so
  // this still gets us idempotent badge-granting (INSERT OR IGNORE) even
  // though the live schema didn't define this constraint itself.
  await env.DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_accolades_user_badge ON accolades(user_id, badge_type)");
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
  );
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS thread_participants (thread_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (thread_id, user_id))"
  );
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_thread_participants_user ON thread_participants(user_id)");
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, sender_id TEXT NOT NULL, text TEXT, attachment_title TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
  );
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at)");
  _socialTablesEnsured = true;
}
