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
