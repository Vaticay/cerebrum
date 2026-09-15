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
// This version prefers the D1 database (`env.DB`) as a genuinely shared
// counter across every isolate/colo, and falls back to the old in-memory
// behavior only when that binding isn't configured — so a deployment without
// D1 still works exactly as before, rather than breaking.
//
// Why D1 and not Workers KV: the limiter used to write one KV key per
// request, and KV's free tier allows only 1,000 writes per day — normal
// traffic exhausted that in hours ("KV limit hit" in the dashboard). D1's
// free tier allows 100,000 rows written per day, roughly 100x the headroom,
// and the database was already bound for the answer cache and OTP codes, so
// this adds no new infrastructure.
//
// Honest limitation, stated plainly rather than implied: this D1-backed
// counter is a fixed-window read-then-write, not an atomic increment.
// Under a genuine burst (many requests for the same key landing on different
// edge colos within the same D1 replication window), a handful of requests
// can be under-counted and slip through slightly over the stated limit.
// That's a real, bounded imprecision, not a silent no-op — it is still a
// strict, meaningful improvement over the previous per-isolate Map, which
// provided no real cross-edge bound at all. Closing the gap completely would
// need a Durable Object (one single strongly-consistent instance per key),
// which is the right next step if this ever needs to be airtight rather than
// "very hard to casually exceed" — flagged in the project doc as a deliberate
// scope line for this pass, not an oversight.

const memoryBuckets = new Map();

function checkMemory(key, limit, windowMs) {
  const now = Date.now();
  const rec = memoryBuckets.get(key) || [];
  let recent = rec.filter((t) => now - t < windowMs);
  recent.push(now);
  // A hot key on a long window would otherwise accumulate timestamps
  // without bound, making every later filter() call O(all-time hits).
  // The limiter only needs to know whether the count exceeds `limit`, so
  // keep at most limit+1 entries — enough to answer the question exactly.
  const cap = Math.max(limit + 1, 1);
  if (recent.length > cap) recent = recent.slice(-cap);
  memoryBuckets.set(key, recent);
  if (memoryBuckets.size > 8000) {
    for (const [k, v] of memoryBuckets) {
      if (v.every((t) => now - t > windowMs)) memoryBuckets.delete(k);
    }
  }
  return recent.length <= limit;
}

// Lazily created once per isolate; a failure resets the flag so the next
// request retries instead of caching a broken state forever.
let tableReady = null;
function ensureTable(db) {
  if (!tableReady) {
    tableReady = db
      .exec(
        "CREATE TABLE IF NOT EXISTS rate_limits (" +
          "k TEXT PRIMARY KEY, " +
          "count INTEGER NOT NULL, " +
          "expires_at INTEGER NOT NULL)"
      )
      .then(
        () => true,
        (e) => {
          tableReady = null;
          throw e;
        }
      );
  }
  return tableReady;
}

async function checkD1(db, key, limit, windowMs) {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const dbKey = `rl:${key}:${bucket}`;
  // Headroom past the window itself so a bucket can't expire mid-window and
  // quietly reset the count to zero for stragglers still inside it.
  const expiresAt = now + windowMs + 30000;
  try {
    await ensureTable(db);
    const row = await db
      .prepare("SELECT count FROM rate_limits WHERE k = ?")
      .bind(dbKey)
      .first();
    const count = row ? row.count | 0 : 0;
    // Already at the limit: reject WITHOUT writing. Under abuse this is the
    // hot path, and skipping the write both saves D1 write budget and keeps
    // the counter from growing without bound on a hammered key.
    if (count >= limit) return false;
    await db
      .prepare(
        "INSERT INTO rate_limits(k, count, expires_at) VALUES (?, 1, ?) " +
          "ON CONFLICT(k) DO UPDATE SET count = rate_limits.count + 1, " +
          "expires_at = excluded.expires_at"
      )
      .bind(dbKey, expiresAt)
      .run();
    // Prune dead buckets probabilistically — every request doing a DELETE
    // would double the write budget for no benefit.
    if (Math.random() < 0.01) {
      await db
        .prepare("DELETE FROM rate_limits WHERE expires_at < ?")
        .bind(now)
        .run()
        .catch(() => {});
    }
    return true;
  } catch (e) {
    // D1 failure (transient error, table issue): fail open to the in-memory
    // check for this one call rather than blocking every request on an
    // infrastructure hiccup unrelated to the actual client.
    console.error("Cerebrum rateLimit: D1 failed, falling back to memory for this call", e);
    return checkMemory(key, limit, windowMs);
  }
}

/**
 * Returns true if the request identified by `key` is still within `limit`
 * requests per `windowMs` milliseconds, and records this request against
 * that count. Returns false if the caller should be rejected (429).
 *
 * `key` should already be scoped to whatever you're actually limiting — e.g.
 * `search:${ip}` or `login:${emailLower}` — since all callers across every
 * endpoint share the same D1 table/in-memory map.
 */
export async function checkRateLimit(env, key, limit, windowMs) {
  if (env && env.DB && typeof env.DB.prepare === "function") {
    return checkD1(env.DB, key, limit, windowMs);
  }
  return checkMemory(key, limit, windowMs);
}
