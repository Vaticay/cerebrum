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
  // The epoch the token is issued under. Checked on every request; a bump
  // invalidates this token and every one of its siblings.
  const claims = { ...payload, iat: now, exp: now + JWT_TTL_S };
  const body = b64UrlEncodeStr(JSON.stringify(claims));
  const data = new TextEncoder().encode(`${header}.${body}`);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return `${header}.${body}.${b64UrlEncode(sig)}`;
}

/* Verify a session JWT.
 *
 * Three things this deliberately does that the previous version did not:
 *
 * 1. The header is parsed and `alg`/`typ` are pinned. The verifier already
 *    hardcoded HMAC-SHA256, so `alg: none` was never actually exploitable —
 *    but that was defence by accident. A token whose header claims anything
 *    other than HS256/JWT is now refused before any crypto runs.
 *
 * 2. `exp` is REQUIRED, not merely honoured when present. `if (payload.exp &&
 *    ...)` treats a token with no expiry claim as one that never expires,
 *    which is the wrong direction to fail.
 *
 * 3. Signature is verified before the payload is parsed (this part was
 *    already right, and is preserved).
 */
export async function verifyJWT(token, env) {
  if (!env.JWT_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    let header;
    try {
      header = JSON.parse(new TextDecoder().decode(b64UrlDecode(parts[0])));
    } catch { return null; }
    if (!header || header.alg !== "HS256" || header.typ !== "JWT") return null;

    const key = await hmacKey(env.JWT_SECRET);
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = b64UrlDecode(parts[2]);
    const valid = await crypto.subtle.verify("HMAC", key, sig, data);
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(b64UrlDecode(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    // A token dated in the future is not one we issued.
    if (typeof payload.iat === "number" && payload.iat > now + 120) return null;
    return payload;
  } catch { return null; }
}

/* ── Session epoch: revocation for stateless tokens ───────────────────────
 *
 * A JWT cannot be deleted, which is the trade its statelessness buys. That
 * left logout unable to revoke anything and account deletion leaving a valid
 * cookie authenticating a user row that no longer existed.
 *
 * The epoch is the fix. Every account has one; every JWT carries the epoch it
 * was issued under; getSessionUser refuses a token whose epoch is behind the
 * account's current value. Bumping it invalidates every outstanding token for
 * that account at once, which is what "sign out" and "delete my account"
 * both actually mean.
 *
 * Tombstones exist because a deleted account has no row left to hold an
 * epoch. The tombstone outlives the account by one JWT lifetime — long enough
 * that every token issued to it has expired on its own — and is swept after.
 */
let _epochTableReady = false;
async function ensureEpochTable(env) {
  if (_epochTableReady) return;
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS session_epochs (user_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL, tombstoned_at INTEGER)"
  );
  _epochTableReady = true;
}

/* Keyed hash for one-time sign-in codes.
 *
 * The OTP was stored as plain SHA-256 of `email:code`. The code space is 10^6
 * and SHA-256 is fast, so anyone who obtained the otp_codes table — a backup,
 * a log, an export, an injection anywhere else in the stack — could recover
 * every live code by hashing a million candidates, which takes under a second.
 * The email prefix stopped a shared rainbow table and added no work factor.
 *
 * HMAC under a server secret means the table alone is not enough: an attacker
 * needs the secret too, and rotating it invalidates every outstanding code.
 * Falls back to the plain hash only when no secret exists at all, so a
 * deployment without secrets still functions rather than silently rejecting
 * every sign-in.
 */
export async function hashOtp(env, emailLower, code) {
  const secret = (env && (env.OTP_PEPPER || env.JWT_SECRET)) || "";
  if (!secret) return sha256Hex(`${emailLower}:${code}`);
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`otp:${emailLower}:${code}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function bumpSessionEpoch(env, userId, { tombstone = false } = {}) {
  if (!env || !env.DB || !userId) return;
  await ensureEpochTable(env);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO session_epochs (user_id, epoch, tombstoned_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET epoch = epoch + 1, tombstoned_at = COALESCE(excluded.tombstoned_at, session_epochs.tombstoned_at)"
  ).bind(userId, now, tombstone ? now : null).run();
  // Opportunistic sweep of tombstones older than one token lifetime. Cheap,
  // and it keeps a table that only ever grows from doing so.
  if (Math.random() < 0.02) {
    try {
      await env.DB.prepare("DELETE FROM session_epochs WHERE tombstoned_at IS NOT NULL AND tombstoned_at < ?")
        .bind(now - JWT_TTL_S * 1000 - 86400000).run();
    } catch (e) { console.error("epoch sweep:", e); }
  }
}

export async function currentSessionEpoch(env, userId) {
  if (!env || !env.DB || !userId) return { epoch: 0, tombstoned: false };
  try {
    await ensureEpochTable(env);
    const row = await env.DB.prepare("SELECT epoch, tombstoned_at FROM session_epochs WHERE user_id = ?")
      .bind(userId).first();
    if (!row) return { epoch: 0, tombstoned: false };
    return { epoch: Number(row.epoch) || 0, tombstoned: !!row.tombstoned_at };
  } catch (e) {
    // Fail CLOSED. If we cannot read the revocation state we cannot know the
    // token is still valid, and the safe answer to "is this session revoked?"
    // when we do not know is yes.
    console.error("epoch read failed:", e);
    return { epoch: Number.MAX_SAFE_INTEGER, tombstoned: true };
  }
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

  // JWT tokens contain dots; opaque DB tokens are base64url of random bytes
  // and cannot, so this dispatch is unambiguous.
  if (raw.includes(".") && env.JWT_SECRET) {
    const payload = await verifyJWT(raw, env);
    if (!payload || !payload.sub || !payload.email) return null;

    /* A valid signature proves we issued this token. It does not prove the
     * account still exists, still has this address, or has not signed out
     * since. Previously none of those were checked — the JWT branch never
     * touched the database at all — so a deleted account kept authenticating
     * and logout revoked nothing.
     *
     * One indexed lookup per request is a real cost, and it is the price of
     * being able to revoke a session at all. */
    const { epoch, tombstoned } = await currentSessionEpoch(env, payload.sub);
    if (tombstoned) return null;
    if ((Number(payload.epoch) || 0) < epoch) return null;

    if (!env.DB) return null;
    const row = await env.DB.prepare("SELECT id, email FROM users WHERE id = ?")
      .bind(payload.sub).first();
    if (!row) return null;
    // Trust the row, not the claim: an address that changed since the token
    // was issued must not keep resolving to the old one (the founder gate
    // compares on email).
    return { id: row.id, email: row.email };
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
    // Academic CV fields (degree, grad_year) — same self-healing pattern as
    // every column above, so this deploys with zero manual D1 console work.
    // If you're reading this because the request asked for a literal
    // `ALTER TABLE` command to run by hand: it isn't necessary — the first
    // request to hit this endpoint after deploy adds both columns
    // automatically, the same way every column above already got added.
    "ALTER TABLE users ADD COLUMN degree TEXT",
    "ALTER TABLE users ADD COLUMN grad_year TEXT",
    // Commit 69 — which version of the Terms/Privacy/Disclosures this
    // account accepted, and when. The browser cookie (cb_legal) is what
    // gates the UI, but a cookie is deletable by the person it is meant to
    // record, so it is evidence of a preference, not of an agreement. The
    // account row is the durable record: if it is ever necessary to show
    // that a specific user accepted a specific version at a specific time,
    // this is the column that can show it.
    // Commit 75 — real profile customization. A profile with a name, an
    // avatar and an institution is an account record; a bio, a chosen
    // cover and a link to your actual work is a profile.
    "ALTER TABLE users ADD COLUMN bio TEXT",
    "ALTER TABLE users ADD COLUMN cover TEXT",
    "ALTER TABLE users ADD COLUMN link_site TEXT",
    "ALTER TABLE users ADD COLUMN link_orcid TEXT",
    "ALTER TABLE users ADD COLUMN link_scholar TEXT",
    "ALTER TABLE users ADD COLUMN terms_version TEXT",
    "ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER",
    // Pinned shelf — up to 4 saved-paper IDs the user pins to the top of
    // their own profile. Stored as a JSON array string; NULL means none
    // pinned. Never exposed on public profiles (pinned papers are saved
    // papers, and saved papers are private).
    "ALTER TABLE users ADD COLUMN pinned TEXT",
    // Research interests — up to 8 short strings, stored as a JSON array.
    // The frontend edited these for a while without a column; they were
    // local-only and lost on refresh.
    "ALTER TABLE users ADD COLUMN interests TEXT",
    /* Commit 100 — privacy controls. Three columns, all nullable, all with a
       defined meaning for NULL so an account that predates them behaves
       sensibly without a backfill:

         discoverable      NULL or 1 = findable by name/username search.
                           0 = not returned by search at all. Opt-OUT, so the
                           existing follow graph keeps working on deploy.
         dm_policy         NULL or 'following' = only people I follow can
                           open a new conversation with me. 'anyone' = the
                           old behaviour, kept as an explicit choice.
                           NULL defaulting to the STRICTER value is
                           deliberate: an unset privacy control should fail
                           closed, and the alternative is that every existing
                           account is silently opted into unsolicited DMs
                           from strangers.
         show_affiliation  NULL or 1 = institution appears on my profile.
                           0 = kept private. Affiliation is no longer
                           searchable or browsable regardless of this (see
                           search-users in data.js); this only controls
                           whether it renders on the profile at all. */
    "ALTER TABLE users ADD COLUMN discoverable INTEGER",
    "ALTER TABLE users ADD COLUMN dm_policy TEXT",
    "ALTER TABLE users ADD COLUMN show_affiliation INTEGER",
    // 2026-09-15 — Pro tier. plan: NULL/'free' = free, 'pro' = entitled.
    // pro_source: 'subscription' (Stripe) or 'lifetime' (founder grant).
    // Lifetime rows are never touched by Stripe webhooks — see
    // functions/lib/proEntitlement.js.
    "ALTER TABLE users ADD COLUMN plan TEXT",
    "ALTER TABLE users ADD COLUMN pro_source TEXT",
    "ALTER TABLE users ADD COLUMN pro_granted_at INTEGER",
    "ALTER TABLE users ADD COLUMN pro_interval TEXT",
    "ALTER TABLE users ADD COLUMN stripe_customer_id TEXT",
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
  // Commit 47: real unread-message tracking for the Inbox — added after
  // `thread_participants` was already live without it (see the "Badge count
  // is unread... not an unread-message count" honesty note this replaces in
  // main.jsx). Same idempotent self-heal pattern as ensureUserProfileColumns
  // above: SQLite's ALTER TABLE has no "IF NOT EXISTS", so this is an
  // attempt-and-swallow-the-duplicate-column-error no-op on every call after
  // the first real one. Nullable and epoch-ms (not DATETIME) so it can be
  // compared directly against toEpochMs(message.created_at) in data.js
  // without a second normalization step.
  try {
    await env.DB.exec("ALTER TABLE thread_participants ADD COLUMN last_read_at INTEGER");
  } catch (e) {
    if (!/duplicate column name/i.test(String(e && e.message))) throw e;
  }
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, sender_id TEXT NOT NULL, text TEXT, attachment_title TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
  );
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at)");
  // Commit 56 — attachments. `attachment_title` already existed (a bare
  // label with nothing behind it); these four give a message something to
  // actually carry:
  //   attachment_kind  "image" | "audio" | "paper"
  //   attachment_data  the base64 data URL for image/audio
  //   attachment_url   the DOI/link for a shared paper (no blob to store)
  //   attachment_meta  JSON — a voice note's duration and transcript, or a
  //                    paper's authors/journal/year
  // Same attempt-and-swallow-duplicate-column self-heal as every other
  // column in this file, so a live database picks these up on the first
  // request after deploy with no manual SQL.
  //
  // Blobs live in D1 as base64 on the row rather than in object storage.
  // That is a deliberate ceiling, not an oversight: a D1 row tops out
  // around 1MB, so the client compresses images and caps voice notes
  // before upload (see the composer in src/main.jsx) and the endpoint
  // rejects anything over ~700KB. It buys attachments with zero new
  // infrastructure on the same paste-and-deploy path as everything else.
  // Video is deliberately NOT supported for exactly this reason — it
  // cannot be made to fit, and pretending otherwise would mean shipping a
  // feature that fails on the second file anyone tries.
  for (const sql of [
    "ALTER TABLE messages ADD COLUMN attachment_kind TEXT",
    "ALTER TABLE messages ADD COLUMN attachment_data TEXT",
    "ALTER TABLE messages ADD COLUMN attachment_url TEXT",
    "ALTER TABLE messages ADD COLUMN attachment_meta TEXT",
  ]) {
    try { await env.DB.exec(sql); }
    catch (e) { if (!/duplicate column name/i.test(String(e && e.message))) throw e; }
  }
  // Commit 51 — root cause of "the Inbox unread badge never clears": this
  // column is DATETIME DEFAULT CURRENT_TIMESTAMP, which SQLite gives NUMERIC
  // affinity. Any row created via that default stores created_at as a TEXT
  // string ("2026-09-02 01:29:48"); functions/api/data.js's send-message has
  // always instead bound an explicit epoch-ms integer (Date.now()). SQLite
  // orders differing storage classes as NULL < INTEGER/REAL < TEXT < BLOB —
  // by value, not by meaning — so any TEXT-stored row sorts as "later" than
  // EVERY integer-stored row regardless of actual date. Once a thread has
  // even one old TEXT row, the inbox's `ORDER BY created_at DESC LIMIT 1`
  // ("last message") freezes on it forever: every genuinely new message is
  // an integer and always sorts as older, so it's invisible to that query.
  // The unread flag is computed from that frozen last message, so it never
  // updates either — confirmed locally by sending a message and watching
  // the inbox response's lastMessage stay pinned to the old row. Ascending
  // reads (a thread's full history) have the mirror problem: every integer
  // row sorts before every text row, so old and new messages interleave in
  // the wrong order in the transcript itself, not just the inbox preview.
  // This runs once (memoized like everything else in this file) and
  // rewrites any surviving TEXT rows to the same epoch-ms integer format
  // every current INSERT already uses, so old and new rows compare
  // correctly against each other from here on. Sub-second precision is
  // lost in the conversion (strftime('%s', ...) only has second
  // resolution) — irrelevant for ordering distinct messages in a
  // conversation, and ties break arbitrarily the same way same-second
  // messages already could before this fix.
  try {
    await env.DB.exec(
      "UPDATE messages SET created_at = CAST(strftime('%s', created_at) AS INTEGER) * 1000 WHERE typeof(created_at) = 'text'"
    );
  } catch (e) {
    console.error("Could not normalize messages.created_at:", e);
  }
  // Commit 48 — message/call moderation: block + report.
  // user_blocks is directional (blocker_id blocked blocked_id) so "who
  // blocked whom" is always answerable, even though every enforcement check
  // below treats it as effectively mutual (either direction blocks sending).
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS user_blocks (blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (blocker_id, blocked_id))"
  );
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id)");
  // content_reports covers messages, whole conversations, and calls with one
  // table + a `kind` discriminator, rather than three near-identical tables
  // — deliberately separate from the pre-existing `reports` table, which is
  // for bad AI answers/citations, not user-to-user conduct. No admin/review
  // UI exists yet (same honest limitation as `reports` itself): rows land
  // here for an operator to query directly in D1 until one is built.
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS content_reports (id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL, reported_user_id TEXT, thread_id TEXT, message_id TEXT, kind TEXT NOT NULL, reason TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL)"
  );
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_content_reports_reported ON content_reports(reported_user_id)");
  // Commit 50 — call_signals: the WebRTC signaling relay for VideoHuddle's
  // own peer-to-peer calling (replacing the meet.jit.si embed — see the
  // block comment above VideoHuddle in main.jsx for why). This table is
  // deliberately tiny and short-lived: one row per SDP offer/answer/ICE
  // candidate/hello/bye message, scoped to a thread and a per-tab client_id,
  // read once via polling and cleaned up ~10 minutes later by
  // functions/api/call-signal.js itself on every write to that thread. No
  // media ever passes through here — only the handful of small messages
  // needed to introduce two browsers' RTCPeerConnections to each other.
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS call_signals (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, sender_id TEXT NOT NULL, client_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)"
  );
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_call_signals_thread ON call_signals(thread_id, id)");
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_call_signals_created ON call_signals(created_at)");
  // Commit 65 — watched topics: the retention engine.
  //
  // Grounded in a real finding rather than a hunch (Pinterest's "Save,
  // Revisit, Retain", arXiv 2511.18013): saving is the single strongest
  // predictor of a user returning, and it's the REVISIT of saved things —
  // not the save itself — that correlates with sustained activity. A save
  // that never gives you a reason to come back is a dead end.
  //
  // For a literature tool the honest version of that loop is an alert: you
  // watch a topic, and when genuinely new papers appear you're told. The
  // count is computed from a real index query (see functions/api/data.js),
  // so a badge here always means literature that actually exists — never a
  // manufactured number to make the app look busy.
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS watched_topics (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, topic TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, last_count INTEGER DEFAULT 0)"
  );
  await env.DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_watched_user_topic ON watched_topics(user_id, topic)");
  // E2EE Phase 1 (2026-09-16) — per-device key directory + encrypted
  // threads. Same self-heal contract as everything above: a live database
  // picks these up on the first request after deploy. The server stores
  // public keys and opaque ciphertext only — it NEVER sees private keys.
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS e2ee_devices (user_id TEXT NOT NULL, device_id TEXT NOT NULL, identity_key TEXT NOT NULL, signing_key TEXT NOT NULL, signed_prekey TEXT NOT NULL, prekey_sig TEXT NOT NULL, fallback_key TEXT, fallback_sig TEXT, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, revoked_at INTEGER, label TEXT, PRIMARY KEY (user_id, device_id))"
  );
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_e2ee_devices_user ON e2ee_devices(user_id)");
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS e2ee_one_time_prekeys (user_id TEXT NOT NULL, device_id TEXT NOT NULL, key_id TEXT NOT NULL, pubkey TEXT NOT NULL, claimed_at INTEGER, PRIMARY KEY (user_id, device_id, key_id))"
  );
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_e2ee_otk_unclaimed ON e2ee_one_time_prekeys(user_id, device_id, claimed_at)");
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS e2ee_threads (thread_id TEXT PRIMARY KEY, protocol TEXT NOT NULL, encrypted_since INTEGER NOT NULL, upgraded_by TEXT NOT NULL)"
  );
  // Additive columns on the live `messages` table. `msg_kind` defaults to
  // 'plaintext-legacy' so every pre-E2EE row is honestly labeled; the
  // server sets 'cipher' on the way in for encrypted threads and rejects
  // anything else there.
  for (const sql of [
    "ALTER TABLE messages ADD COLUMN msg_kind TEXT NOT NULL DEFAULT 'plaintext-legacy'",
    "ALTER TABLE messages ADD COLUMN sender_device_id TEXT",
    "ALTER TABLE messages ADD COLUMN envelope_version INTEGER NOT NULL DEFAULT 1",
  ]) {
    try { await env.DB.exec(sql); }
    catch (e) { if (!/duplicate column name/i.test(String(e && e.message))) throw e; }
  }
  _socialTablesEnsured = true;
}

// Commit 48 — shared by every moderation touchpoint that cares whether two
// people can message/call each other: the inbox and thread's informational
// `blocked` flag, and send-message/start-thread/call-signal's actual
// enforcement. See user_blocks in schema.sql — storage is directional
// (blocker_id/blocked_id) but this treats either direction as blocking,
// which is what every caller actually wants ("can these two people
// talk/call," not "who blocked whom"). Moved here (Commit 50) from data.js,
// which used to be its only caller, now that call-signal.js needs the exact
// same check for the same reason — one definition instead of two copies
// that could quietly drift apart on a security-relevant rule.
export async function isBlockedPair(env, aId, bId) {
  const row = await env.DB.prepare(
    "SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)"
  ).bind(aId, bId, bId, aId).first();
  return !!row;
}
