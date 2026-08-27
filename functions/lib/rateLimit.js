// Shared rate limiter for every Pages Function in this project.
//
// Until now, search.js/vote.js/tts.js/videos.js/data.js/auth.js each hand-rolled
// their OWN copy of a sliding-window counter as a plain module-level `Map`.
// Besides the duplication (six near-identical copies to keep in sync, and a
// security fix applied to five of them and missed in the sixth is exactly how
// a real gap slips through), that pattern has a structural limit that no
// amount of copy-pasting fixes: a `Map` is per-isolate memory. Cloudflare runs
// a project across many isolates spread over many edge colos, each with its
// own independent copy of that Map — so "20 requests per minute" was never a
// real global cap, only a per-isolate one. A client distributed across a
// handful of regions (or simply lucky enough to keep landing on a fresh
// isolate) could exceed the stated limit by whatever multiple of isolates it
// hit, with no code-visible sign that the cap wasn't real.
//
// This version prefers a Workers KV namespace (`env.RATE_LIMIT_KV`) as a
// genuinely shared counter across every isolate/colo, and falls back to the
// old in-memory behavior only when that binding isn't configured yet — so a
// deployment that hasn't added the KV namespace to wrangler.toml (see the
// comment there) still works exactly as before, rather than breaking.
//
// Honest limitation, stated plainly rather than implied: this KV-backed
// counter is a fixed-window read-then-write, not an atomic increment — KV has
// no native atomic counter primitive. Under a genuine burst (many requests
// for the same key landing on different edge colos within the same
// KV-propagation window, typically well under a second), a handful of
// requests can be under-counted and slip through slightly over the stated
// limit. That's a real, bounded imprecision, not a silent no-op — it is still
// a strict, meaningful improvement over the previous per-isolate Map, which
// provided no real cross-edge bound at all. Closing the gap completely would
// need a Durable Object (one single strongly-consistent instance per key),
// which is the right next step if this ever needs to be airtight rather than
// "very hard to casually exceed" — flagged in the project doc as a deliberate
// scope line for this pass, not an oversight.

const memoryBuckets = new Map();

function checkMemory(key, limit, windowMs) {
  const now = Date.now();
  const rec = memoryBuckets.get(key) || [];
  const recent = rec.filter((t) => now - t < windowMs);
  recent.push(now);
  memoryBuckets.set(key, recent);
  if (memoryBuckets.size > 8000) {
    for (const [k, v] of memoryBuckets) {
      if (v.every((t) => now - t > windowMs)) memoryBuckets.delete(k);
    }
  }
  return recent.length <= limit;
}

async function checkKV(kv, key, limit, windowMs) {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const bucket = Math.floor(Date.now() / windowMs);
  const kvKey = `rl:${key}:${bucket}`;
  let count = 0;
  try {
    const existing = await kv.get(kvKey);
    count = existing ? parseInt(existing, 10) || 0 : 0;
  } catch (e) {
    // KV read failure (rare transient error): fail open to the in-memory
    // check for this one call rather than blocking every request on an
    // infrastructure hiccup unrelated to the actual client.
    console.error("Cerebrum rateLimit: KV read failed, falling back to memory for this call", e);
    return checkMemory(key, limit, windowMs);
  }
  if (count >= limit) return false;
  try {
    // expirationTtl needs a little headroom past the window itself so a
    // bucket doesn't expire mid-window and quietly reset the count to zero
    // for stragglers still inside it.
    await kv.put(kvKey, String(count + 1), { expirationTtl: windowSeconds + 30 });
  } catch (e) {
    // Write failed but the read already told us we're under the limit —
    // allow this one request through; the count just won't reflect it.
    console.error("Cerebrum rateLimit: KV write failed", e);
  }
  return true;
}

/**
 * Returns true if the request identified by `key` is still within `limit`
 * requests per `windowMs` milliseconds, and records this request against
 * that count. Returns false if the caller should be rejected (429).
 *
 * `key` should already be scoped to whatever you're actually limiting — e.g.
 * `search:${ip}` or `login:${emailLower}` — since all callers across every
 * endpoint share the same KV namespace/in-memory map.
 */
export async function checkRateLimit(env, key, limit, windowMs) {
  if (env && env.RATE_LIMIT_KV) {
    return checkKV(env.RATE_LIMIT_KV, key, limit, windowMs);
  }
  return checkMemory(key, limit, windowMs);
}
