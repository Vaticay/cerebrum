/**
 * lib/resilience.js — shared reliability primitives for the media endpoints.
 *
 * Philosophy: the app must NEVER present a failure to the user. Every
 * outbound call gets an explicit timeout, every provider failure degrades
 * to a placeholder rather than a 500, every input is validated before it
 * touches a network call, and nothing server-internal ever leaves the
 * building inside an error body.
 *
 * Conventions here intentionally mirror functions/lib/http.js (which owns
 * CORS/origin/rate-limit conventions): this file owns timeouts, fallbacks,
 * safe error text, and the consistent {ok, error:{code,message}} response
 * shape used by the media endpoints.
 */

import { json } from "./http.js";

/* ── timeouts ────────────────────────────────────────────────────────── */

/**
 * Bound a promise to `ms` milliseconds; reject on timeout.
 *
 * Used for things that don't accept an AbortSignal (env.AI.run), where a
 * rejecting timer race is the only way to stop waiting on a stalled model.
 * The timer is always cleared once the promise settles so workers never
 * hold a pending timeout past the request's useful life.
 */
export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout:${label || "op"}:${ms}ms`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * fetch() with an explicit AbortController timeout, every time.
 *
 * Nothing in this codebase should call bare fetch() against a third party:
 * a provider that accepts the connection and never answers must not hold
 * a Worker open until the platform kills the request. Returns the Response;
 * throws (or aborts) on timeout.
 */
export async function fetchWithTimeout(url, options, ms) {
  const ctl = new AbortController();
  let timer;
  // Belt and suspenders: the AbortSignal stops a cooperative fetch, and the
  // rejecting race stops even a fetch that ignores the signal. A hanging
  // upstream must never hold a request open indefinitely.
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { ctl.abort(); } catch { /* ignore */ }
      reject(new Error(`timeout:fetch:${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([
      fetch(url, { ...(options || {}), signal: ctl.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/* ── graceful degradation ────────────────────────────────────────────── */

/**
 * Never let a provider failure become an endpoint failure.
 *
 * Resolves to the promise's value, or to `fallback` on ANY error — timeout,
 * HTTP failure, parse error, anything. The error is logged server-side
 * (operator-only) through the sanitized safeErr(), never re-thrown.
 */
export async function neverFail(promise, fallback, label) {
  try {
    return await promise;
  } catch (e) {
    if (label) console.error(`[resilience] ${label} failed:`, safeErr(e));
    return fallback;
  }
}

/**
 * Race providers so the fastest HEALTHY answer wins.
 *
 * Each leg is wrapped so a fast REJECTION can never win the race — only
 * the first successful settlement does. If every leg fails, or nobody
 * answers within `timeoutMs`, resolve `fallback` (default undefined) so
 * callers never hang and never throw.
 */
export function raceFirst(legs, { timeoutMs = 8000, label = "race", fallback = undefined } = {}) {
  const neverSettling = new Promise(() => {});
  const wrapped = legs.map((leg) =>
    Promise.resolve(leg).then(
      // First SUCCESS wins. A null/undefined settlement or a fast rejection
      // is treated as "this leg is out" — it must never win the race.
      (value) => (value === undefined || value === null ? neverSettling : value),
      () => neverSettling
    )
  );
  return withTimeout(Promise.race(wrapped), timeoutMs, label)
    .then((v) => (v === undefined ? fallback : v))
    .catch(() => fallback);
}

/* ── safe error text ─────────────────────────────────────────────────── */

/**
 * Strip everything that must never leave the server from an exception:
 * stack frames, API keys / tokens, credentials, internal hostnames that
 * came along for the ride. Returns a short one-line string safe to log
 * server-side and, for expected failures, safe to show a person.
 */
export function safeErr(e) {
  const msg = String((e && e.message) || e || "unknown error");
  return msg
    .split("\n")[0] // first line only — drops stack frames wholesale
    .replace(/api[_-]?key\s*[:=]\s*[^\s&;"']+/gi, "api_key=[redacted]")
    .replace(/(?:token|secret|password|bearer)\s*[:=]\s*[^\s&;"']+/gi, "$1=[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/AKIA[0-9A-Z]{16}/g, "[redacted]")
    .replace(/\/\/[^/@\s:]+:[^/@\s]+@/g, "//[redacted]@") // credentials in URLs
    .slice(0, 200);
}

/* ── consistent response shape ───────────────────────────────────────── */

/**
 * Success: { ok: true, ...data }. The extra `ok` is additive — callers that
 * only read their payload field (videos, image) are unaffected.
 */
export function jsonOk(data, headers) {
  return json({ ok: true, ...(data || {}) }, 200, headers);
}

/**
 * Failure: { ok: false, error: { code, message } }.
 *
 * `code` is a stable machine-readable category the UI can branch on;
 * `message` is written for a person. Neither ever carries safeErr() output
 * from an unexpected failure — those log server-side; the client gets the
 * static message passed in.
 */
export function jsonError(status, code, message, headers) {
  return json({ ok: false, error: { code, message } }, status, headers);
}

/* ── input validation ────────────────────────────────────────────────── */

/**
 * Coerce to a trimmed string with a hard length cap. Returns "" for
 * anything non-textual. Applied BEFORE any processing (CPU work) or any
 * network call, so a hostile field size can never buy CPU time or a long
 * outbound URL.
 */
export function clampText(value, max) {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * A URL the endpoint is willing to forward to a client or fetch itself:
 * http(s) only, parseable, no embedded credentials. data:, javascript:,
 * file:, and credential-bearing URLs are never legitimate results.
 */
export function isSafeUrl(u) {
  if (typeof u !== "string" || !u) return false;
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (!parsed.hostname) return false;
  return true;
}

/**
 * Require https for anything rendered to the page (mixed-content safe).
 */
export function isSafeHttpsUrl(u) {
  return isSafeUrl(u) && String(u).toLowerCase().startsWith("https://");
}
