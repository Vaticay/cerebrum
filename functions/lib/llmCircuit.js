/**
 * functions/lib/llmCircuit.js — LLM circuit breaker, capped backoff with
 * jitter, Retry-After honoring, and the provider → cached → non-LLM fallback
 * ladder (nuance #24).
 *
 * THE PROBLEM
 * Every LLM leg in this codebase used to fail the same way: one attempt,
 * one timeout, give up — or worse, unbounded retries that turned a sick
 * provider into a self-inflicted DDoS on our own request budget. A provider
 * having a bad five minutes should not cost us five minutes of retries per
 * request, and a 400 (our bug) should never be retried at all.
 *
 * THE SHAPE
 * - isTransientError(err): ONLY 429 / 5xx / timeouts / network aborts are
 *   retried. 400/401/403/404/422 and "empty completion" (the model answered,
 *   badly) are permanent — retrying them burns money for nothing.
 * - withBackoff(fn, opts): capped exponential backoff with full jitter,
 *   honoring Retry-After (seconds or HTTP-date) when the error carries one.
 *   maxAttempts is small (default 3 total attempts); the cap keeps the worst
 *   case bounded so the request-level deadline in search.js stays honest.
 * - CircuitBreaker: per-provider state machine. CLOSED → after
 *   failureThreshold CONSECUTIVE failures, OPEN for openTimeoutMs (calls
 *   fail fast with CircuitOpenError, no network touched) → HALF_OPEN lets
 *   one probe through; success closes, failure re-opens. Success resets the
 *   consecutive-failure count. getBreaker(name) is the shared per-isolate
 *   registry so every call site for one provider shares one breaker.
 * - runWithFallbacks(steps): the fallback ladder. steps is
 *   [{ name, run }] — e.g. provider call, cached answer, extractive
 *   non-LLM answer. First success wins; every failure is logged with its
 *   step name. Never throws: if everything fails, returns
 *   { ok: false, error } so the caller can degrade honestly.
 *
 * Clock injection: pass { now: () => ms } in breaker options for tests.
 */

export class CircuitOpenError extends Error {
  constructor(provider, retryInMs) {
    super(`circuit open for ${provider}; retry in ${Math.ceil(retryInMs / 1000)}s`);
    this.name = "CircuitOpenError";
    this.provider = provider;
    this.retryInMs = retryInMs;
  }
}

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const TIMEOUT_PATTERNS = [/timeout/i, /timed out/i, /abort/i, /econnreset/i, /enotfound/i, /socket hang up/i, /network/i, /fetch failed/i, /temporarily unavailable/i, /overloaded/i];

/** True only for failures where "try again shortly" is meaningful. */
export function isTransientError(err) {
  if (!err) return false;
  const status = err.status ?? err.statusCode ?? statusFromMessage(err.message);
  if (status != null) {
    if (TRANSIENT_STATUS.has(status)) return true;
    if (status >= 400 && status < 500) return false; // 400/401/403/404/422: our bug or bad input — never retry
    if (status >= 500) return true;
    return false;
  }
  const msg = String((err && err.message) || err || "");
  return TIMEOUT_PATTERNS.some((re) => re.test(msg));
}

function statusFromMessage(message) {
  const m = String(message || "").match(/HTTP\s+(\d{3})/i);
  return m ? Number(m[1]) : null;
}

/**
 * Milliseconds the caller should wait per the error's Retry-After, or null.
 * Accepts err.retryAfterMs, err.retryAfter (seconds), or a raw header value.
 */
export function retryAfterMs(err) {
  if (!err) return null;
  if (typeof err.retryAfterMs === "number" && err.retryAfterMs >= 0) return Math.min(err.retryAfterMs, 120000);
  const raw = err.retryAfter ?? err.retry_after ?? (err.headers && typeof err.headers.get === "function" && err.headers.get("retry-after"));
  if (raw == null) return null;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return Math.min(Number(s) * 1000, 120000);
  const dateMs = Date.parse(s);
  if (!Number.isNaN(dateMs)) return Math.max(0, Math.min(dateMs - Date.now(), 120000));
  return null;
}

/** Full jitter: uniform in [0, delay]. Avoids thundering-herd retries. */
export function jitteredDelay(attempt, baseMs, capMs, rand = Math.random) {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(rand() * exp);
}

/**
 * Run fn() with capped exponential backoff + jitter on TRANSIENT failures
 * only. Honors Retry-After (takes precedence over the computed delay, still
 * capped). Resolves fn's value; rejects with the last error when attempts
 * are exhausted or the error is permanent.
 *
 * opts: { maxAttempts=3, baseMs=400, capMs=5000, rand, onRetry }
 */
export async function withBackoff(fn, opts = {}) {
  const { maxAttempts = 3, baseMs = 400, capMs = 5000, rand = Math.random, onRetry = null } = opts;
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const transient = isTransientError(err);
      const last = attempt === maxAttempts - 1;
      if (!transient || last) throw err;
      const after = retryAfterMs(err);
      const delay = after != null ? after : jitteredDelay(attempt, baseMs, capMs, rand);
      if (onRetry) { try { onRetry({ attempt, delayMs: delay, error: err }); } catch {} }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export const BREAKER_CLOSED = "closed";
export const BREAKER_OPEN = "open";
export const BREAKER_HALF_OPEN = "half_open";

/**
 * Per-provider circuit breaker. State machine, fully unit-testable:
 *
 *   closed --(failureThreshold consecutive failures)--> open
 *   open --(openTimeoutMs elapses)--> half_open (next call is the probe)
 *   half_open --(probe succeeds)--> closed | (probe fails)--> open
 *
 * A success in closed state resets the consecutive-failure counter.
 */
export class CircuitBreaker {
  constructor(name, opts = {}) {
    this.name = String(name || "provider");
    this.failureThreshold = Math.max(1, opts.failureThreshold ?? 5);
    this.openTimeoutMs = Math.max(1000, opts.openTimeoutMs ?? 60000);
    this.now = opts.now || (() => Date.now());
    this.state = BREAKER_CLOSED;
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this.halfOpenInFlight = false;
    this.lastFailure = null;
  }

  /** Can a call go out right now? OPEN → no (fail fast). */
  allowRequest() {
    if (this.state === BREAKER_CLOSED) return true;
    if (this.state === BREAKER_OPEN) {
      if (this.now() - this.openedAt >= this.openTimeoutMs) {
        this.state = BREAKER_HALF_OPEN;
        // The transition itself grants the single probe — mark it in flight
        // NOW, or the next allowRequest() would grant a second one.
        this.halfOpenInFlight = true;
        return true;
      }
      return false;
    }
    // half_open: exactly one probe at a time; the rest fail fast.
    if (this.halfOpenInFlight) return false;
    this.halfOpenInFlight = true;
    return true;
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    this.lastFailure = null;
    if (this.state !== BREAKER_CLOSED) {
      this.state = BREAKER_CLOSED;
      this.halfOpenInFlight = false;
    }
  }

  recordFailure(err) {
    this.consecutiveFailures += 1;
    this.lastFailure = err ? String((err && err.message) || err).slice(0, 200) : "unknown";
    if (this.state === BREAKER_HALF_OPEN) {
      this.open();
      return;
    }
    if (this.consecutiveFailures >= this.failureThreshold) this.open();
  }

  open() {
    this.state = BREAKER_OPEN;
    this.openedAt = this.now();
    this.halfOpenInFlight = false;
  }

  msUntilRetry() {
    if (this.state !== BREAKER_OPEN) return 0;
    return Math.max(0, this.openedAt + this.openTimeoutMs - this.now());
  }

  snapshot() {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      msUntilRetry: this.msUntilRetry(),
      lastFailure: this.lastFailure,
    };
  }
}

const breakerRegistry = new Map();

/** Shared per-isolate breaker per provider name. */
export function getBreaker(name, opts = {}) {
  const key = String(name || "default");
  let b = breakerRegistry.get(key);
  if (!b) {
    b = new CircuitBreaker(key, opts);
    breakerRegistry.set(key, b);
  }
  return b;
}

/** For tests: drop the registry. */
export function resetBreakers() {
  breakerRegistry.clear();
}

/**
 * One guarded LLM call: breaker gate → withBackoff (transient-only,
 * Retry-After-honoring) → record outcome on the breaker.
 *
 * fn receives the attempt index. Rejects with CircuitOpenError when the
 * breaker is open (fail fast, no network), or with the last error.
 */
export async function callWithCircuit(breaker, fn, retryOpts = {}) {
  const b = typeof breaker === "string" ? getBreaker(breaker) : breaker;
  if (!b.allowRequest()) throw new CircuitOpenError(b.name, b.msUntilRetry());
  try {
    const value = await withBackoff(fn, retryOpts);
    b.recordSuccess();
    return value;
  } catch (err) {
    // Only failures that actually reached the provider count toward the
    // breaker. A permanent 400 is our bug, not provider sickness — it
    // must not trip the circuit for everyone else.
    if (isTransientError(err) || /timeout/i.test(String((err && err.message) || ""))) {
      b.recordFailure(err);
    }
    throw err;
  }
}

/**
 * The fallback ladder: [{ name, run }]. Tries each step in order; the first
 * success wins. Logs every failure with its step name (operator-visible,
 * sanitized). Never throws — returns { ok, step, value } or
 * { ok: false, error } so the caller degrades honestly instead of 500ing.
 *
 * Intended order: provider (LLM) → cached answer → non-LLM extractive.
 */
export async function runWithFallbacks(steps, { log = null } = {}) {
  const failures = [];
  for (const step of steps || []) {
    try {
      const value = await step.run();
      if (value === undefined || value === null) throw new Error("empty result");
      return { ok: true, step: step.name, value };
    } catch (err) {
      const msg = String((err && err.message) || err).slice(0, 200);
      failures.push({ step: step.name, error: msg });
      if (log) { try { log("warn", "fallback_step_failed", { step: step.name, error: msg }); } catch {} }
    }
  }
  return { ok: false, error: failures.length ? failures[failures.length - 1].error : "no steps", failures };
}
