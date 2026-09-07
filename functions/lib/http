/**
 * Canonical HTTP / CORS / origin layer for every Cerebrum API route.
 *
 * WHY THIS FILE EXISTS
 * Fourteen endpoint files each carried their own copy of ALLOWED_ORIGINS, the
 * preview-domain regex, an originAllowed() helper and an inline CORS object.
 * The copies had already drifted: auth.js's originAllowed took a string while
 * every other copy took a Request, and three files (config.js, image.js,
 * report.js) built CORS headers but never actually rejected a disallowed
 * origin. A security control that exists in fourteen places is a security
 * control that is enforced in eleven of them.
 *
 * SECURITY INVARIANTS ENFORCED HERE
 *
 * 1. Origin allowlist. Exact matches plus this project's own Pages preview
 *    subdomains. Previews are included because they are how changes get
 *    reviewed, but note they are credentialed origins against the production
 *    API — PREVIEW_ORIGINS_ENABLED lets an operator turn that off.
 *
 * 2. A missing Origin header is NOT automatically trusted on state-changing
 *    requests. Browsers omit Origin on same-origin GETs, so treating "no
 *    Origin" as allowed is correct for reads and wrong for writes: it is
 *    exactly what a non-browser client sends. requireTrustedOrigin() therefore
 *    demands a real, allowlisted Origin (or a same-origin Sec-Fetch-Site) on
 *    anything that mutates state. Cookies are SameSite=Lax, so this is defence
 *    in depth rather than the only CSRF control — but Lax alone does not cover
 *    top-level cross-site POSTs from forms, which this does.
 *
 * 3. Responses never echo an origin that was not allowlisted. The fallback is
 *    the canonical production origin, and Vary: Origin is always set so a
 *    shared cache can never serve one origin's CORS headers to another.
 */

/** Canonical production origin. Single source of truth. */
export const CANONICAL_ORIGIN = "https://askcerebrum.org";

const ALLOWED_ORIGINS = [
  "https://askcerebrum.org",
  "https://www.askcerebrum.org",
  "https://cerebrum-2pz.pages.dev",
];

/**
 * Scoped to this project's own preview subdomains. The historical bug here was
 * `origin.endsWith(".pages.dev")`, which trusts every free Cloudflare Pages
 * site on the internet — anyone can deploy one. Keep the project name anchored.
 */
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.cerebrum-2pz\.pages\.dev$/i;

/**
 * Local development origins.
 *
 * SECURITY: this is gated on the URL the request was actually made TO, not on
 * a header, an environment variable, or a missing binding. `http://localhost`
 * is only trusted when this Worker is itself being served from localhost —
 * which cannot be true on askcerebrum.org or on a *.pages.dev preview, since
 * those are reached over a public hostname. An attacker cannot make our
 * production host answer to `localhost`.
 *
 * This is what lets `wrangler pages dev` work without anyone hand-editing an
 * allowlist to test, which is how a temporary "just for testing" origin ends
 * up shipped.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLocalRequest(request) {
  try {
    return LOCAL_HOSTS.has(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

function isLocalOrigin(origin) {
  try {
    const u = new URL(origin);
    return (u.protocol === "http:" || u.protocol === "https:") && LOCAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function previewsEnabled(env) {
  // Defaults to on. An operator who wants production to trust only the three
  // exact origins sets PREVIEW_ORIGINS=off.
  return String((env && env.PREVIEW_ORIGINS) || "").trim().toLowerCase() !== "off";
}

/** Is this origin string one we trust? Empty string is never trusted here. */
export function isAllowedOrigin(origin, env, request) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Only when we are ourselves running locally. See isLocalRequest.
  if (request && isLocalRequest(request) && isLocalOrigin(origin)) return true;
  return previewsEnabled(env) && PAGES_PREVIEW_RE.test(origin);
}

/**
 * CORS headers for a response. Always safe to call: an unrecognised origin
 * gets the canonical origin back, which the browser will reject, rather than
 * a reflected attacker-controlled value.
 *
 * `credentials` defaults to true because every authenticated route needs it;
 * pass false on genuinely public endpoints so a stray cookie is never sent.
 */
export function corsHeaders(request, env, { credentials = true, methods = "GET, POST, OPTIONS" } = {}) {
  const origin = (request && request.headers.get("Origin")) || "";
  const allowed = isAllowedOrigin(origin, env, request);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": allowed ? origin : CANONICAL_ORIGIN,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    // API responses are per-user and must never land in a shared cache.
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  if (credentials && allowed) headers["Access-Control-Allow-Credentials"] = "true";
  return headers;
}

/**
 * Read-path origin gate. A missing Origin is permitted, because same-origin
 * GETs legitimately omit it and reads are not CSRF-able in a way cookies make
 * dangerous. Use requireTrustedOrigin for anything that writes.
 */
export function readOriginAllowed(request, env) {
  const origin = (request && request.headers.get("Origin")) || "";
  if (!origin) return true;
  return isAllowedOrigin(origin, env, request);
}

/**
 * Write-path origin gate. Returns true only when the request demonstrably
 * came from one of our own pages.
 *
 * Sec-Fetch-Site is checked first because it is set by the browser and cannot
 * be spoofed by page script; `same-origin` covers the case where a same-origin
 * POST legitimately carries no Origin header. Anything else must present an
 * allowlisted Origin. A non-browser client (curl, a script) sends neither and
 * is refused — which is the point: state-changing calls are for our own UI.
 */
export function requireTrustedOrigin(request, env) {
  const origin = (request && request.headers.get("Origin")) || "";
  if (origin) return isAllowedOrigin(origin, env, request);
  const site = (request && request.headers.get("Sec-Fetch-Site")) || "";
  return site === "same-origin";
}

/** JSON response with the right headers. */
export function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(headers || {}) },
  });
}

/**
 * Sanitized error response.
 *
 * The `code` is a stable machine-readable category the UI can branch on. The
 * `message` is written for a person. Neither ever carries an exception
 * message, a SQL fragment, a provider response body, an environment variable
 * name or a stack — those go to console.error, which is operator-only.
 */
export function errorResponse(status, code, message, headers) {
  return json({ error: message, code }, status, headers);
}

/** Standard 429 with Retry-After. */
export function tooManyRequests(headers, retryAfterSeconds = 30) {
  return json(
    { error: "You're doing that very quickly. Give it a few seconds and try again.", code: "rate_limited" },
    429,
    { ...(headers || {}), "Retry-After": String(retryAfterSeconds) }
  );
}

/** Standard 401. Identical text everywhere so it is never an oracle. */
export function unauthorized(headers) {
  return errorResponse(401, "unauthenticated", "Sign in first.", headers);
}

/** Standard 403 for a failed origin check. */
export function forbiddenOrigin(headers) {
  return errorResponse(403, "origin_not_allowed", "Request blocked.", headers);
}

/**
 * Parse a JSON body with a hard byte ceiling.
 *
 * Two separate protections. Content-Length is checked first so an oversized
 * request is refused before it is buffered — but Content-Length is
 * client-supplied and may be absent on a chunked body, so the text is read and
 * measured too. `request.json()` on its own will happily buffer a body of any
 * size into a Worker's memory, which is a free denial-of-service.
 *
 * Returns { ok: true, body } or { ok: false, response }.
 */
export async function readJsonBody(request, headers, maxBytes = 1_000_000) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared && declared > maxBytes) {
    return { ok: false, response: errorResponse(413, "body_too_large", "That request is too large.", headers) };
  }
  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: errorResponse(400, "unreadable_body", "Couldn't read that request.", headers) };
  }
  if (text.length > maxBytes) {
    return { ok: false, response: errorResponse(413, "body_too_large", "That request is too large.", headers) };
  }
  try {
    const parsed = JSON.parse(text || "{}");
    // `null` is valid JSON, so JSON.parse succeeds and every downstream
    // destructure throws. Normalise it to an object here once instead of
    // guarding at each call site.
    return { ok: true, body: parsed && typeof parsed === "object" ? parsed : {} };
  } catch {
    return { ok: false, response: errorResponse(400, "invalid_json", "Couldn't read that request.", headers) };
  }
}

/**
 * The client IP, for rate limiting only.
 *
 * X-Forwarded-For is deliberately NOT consulted. It is client-settable, so
 * honouring it lets anyone rotate their own rate-limit bucket by changing a
 * header — which turns the limiter off. On Cloudflare, CF-Connecting-IP is set
 * by the edge and cannot be spoofed. Off Cloudflare there is no trustworthy
 * source, and every such caller shares one bucket, which is the safe failure.
 */
export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

/**
 * A rate-limit key that does not persist a raw IP address.
 *
 * The limiter's storage is keyed by whatever it is handed, and those rows are
 * long-lived. Storing `search:203.0.113.7` builds a durable log of who called
 * what. Hashing under a server secret keeps the bucket stable for the window
 * while making the stored key non-reversible, and rotating IP_HASH_SECRET
 * invalidates the whole history.
 *
 * Falls back to a build-constant salt when no secret is set: still not
 * plaintext, but an operator should set IP_HASH_SECRET.
 */
export async function privacyKey(prefix, value, env) {
  const secret = (env && (env.IP_HASH_SECRET || env.JWT_SECRET)) || "cerebrum-default-key-salt";
  const data = new TextEncoder().encode(`${secret}:${prefix}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // 80 bits is far beyond enough to avoid collisions between rate-limit
  // buckets and keeps the stored rows small.
  return `${prefix}:${hex.slice(0, 20)}`;
}
