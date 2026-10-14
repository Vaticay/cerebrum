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
// `ledger` is the search handler's subrequest ledger (optional; other
// endpoints pass nothing): every D1 execution below is a bound service
// call and is charged to it, including this exec on the cold request
// that triggers it.
let tableReady = null;
function ensureTable(db, ledger) {
  if (!tableReady) {
    if (ledger) ledger.spendBinding("ratelimit", 1);
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

async function checkD1(db, key, limit, windowMs, ledger) {
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const dbKey = `rl:${key}:${bucket}`;
  // Headroom past the window itself so a bucket can't expire mid-window and
  // quietly reset the count to zero for stragglers still inside it.
  const expiresAt = now + windowMs + 30000;
  try {
    await ensureTable(db, ledger);
    if (ledger) ledger.spendBinding("ratelimit", 1);
    const row = await db
      .prepare("SELECT count FROM rate_limits WHERE k = ?")
      .bind(dbKey)
      .first();
    const count = row ? row.count | 0 : 0;
    // Already at the limit: reject WITHOUT writing. Under abuse this is the
    // hot path, and skipping the write both saves D1 write budget and keeps
    // the counter from growing without bound on a hammered key.
    if (count >= limit) return false;
    if (ledger) ledger.spendBinding("ratelimit", 1);
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
      if (ledger) ledger.spendBinding("ratelimit", 1);
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
export async function checkRateLimit(env, key, limit, windowMs, ledger = null) {
  if (env && env.DB && typeof env.DB.prepare === "function") {
    return checkD1(env.DB, key, limit, windowMs, ledger);
  }
  return checkMemory(key, limit, windowMs);
}

/**
 * The in memory check on its own, exported for callers whose durable
 * check could not run AT ALL — their own code around the limiter
 * threw (key derivation, a malformed binding) before checkRateLimit
 * could reach its internal D1 to memory fallback. Such a caller
 * fails bounded on this per isolate limiter instead of failing open
 * with no limit at all. Same bucket store the fallback above uses,
 * so a key counts the same whichever path served the request.
 */
export function checkRateLimitMemoryOnly(key, limit, windowMs) {
  return checkMemory(key, limit, windowMs);
}

/**
 * Run SEVERAL limit checks for one request as two batched D1 calls
 * (2026-10-14, overhead audit). The search handler gates every
 * request on a sustained AND a burst check back to back; run
 * sequentially through checkD1 that was five platform subrequests
 * on a cold isolate (table ensure + a SELECT and an upsert per
 * check) — the live _ledger probe on build e69b53d showed
 * "ratelimit 5" in a request whose synthesis then starved. A
 * db.batch is ONE platform call however many statements it
 * carries, so the batched shape is: ensure (cold only, as before)
 * + one batch carrying every check's count SELECT + one batch
 * carrying the increments for the checks that passed.
 *
 * `checks` is [{ key, limit, windowMs }] in enforcement order.
 * Returns the index of the first failed check, or -1 when every
 * check passed. Decisions are IDENTICAL to running checkRateLimit
 * sequentially in the same order:
 *   - a check fails iff its stored bucket count has reached its
 *     limit, and a failed check is never written (the pinned
 *     contract: limited traffic does not grow the counter);
 *   - checks short circuit as the sequential calls did — once a
 *     check fails, later checks are never WRITTEN, so their counts
 *     do not move. Their counts were read in the same read batch;
 *     a read cannot change any decision;
 *   - the 1% expired bucket prune rides the write batch, rolled
 *     per written check exactly where the sequential path rolls
 *     it (after that check's increment, on allowed traffic only —
 *     a request whose checks all fail prunes nothing, as before).
 * If the batched path errors anywhere, it falls back to the
 * sequential per check calls, which carry their own charges and
 * their own memory fallback — same fail open shape as today.
 */
export async function checkRateLimitBatch(env, checks, ledger = null) {
  const list = Array.isArray(checks) ? checks : [];
  if (!list.length) return -1;
  const sequential = async () => {
    for (let i = 0; i < list.length; i++) {
      const ok = await checkRateLimit(env, list[i].key, list[i].limit, list[i].windowMs, ledger);
      if (!ok) return i;
    }
    return -1;
  };
  if (!env || !env.DB || typeof env.DB.prepare !== "function" || typeof env.DB.batch !== "function") {
    return sequential();
  }
  const db = env.DB;
  const now = Date.now();
  const items = list.map(({ key, limit, windowMs }) => {
    const bucket = Math.floor(now / windowMs);
    return {
      dbKey: `rl:${key}:${bucket}`,
      limit,
      expiresAt: now + windowMs + 30000,
    };
  });
  try {
    await ensureTable(db, ledger);
    if (ledger) ledger.spendBinding("ratelimit", 1);
    const readResults = await db.batch(items.map((it) =>
      db.prepare("SELECT count FROM rate_limits WHERE k = ?").bind(it.dbKey)));
    let firstFailure = -1;
    const writes = [];
    for (let i = 0; i < items.length; i++) {
      const rows = readResults && readResults[i] && readResults[i].results;
      const count = rows && rows[0] ? rows[0].count | 0 : 0;
      if (count >= items[i].limit) { firstFailure = i; break; }
      writes.push(db.prepare(
        "INSERT INTO rate_limits(k, count, expires_at) VALUES (?, 1, ?) " +
          "ON CONFLICT(k) DO UPDATE SET count = rate_limits.count + 1, " +
          "expires_at = excluded.expires_at"
      ).bind(items[i].dbKey, items[i].expiresAt));
      if (Math.random() < 0.01) {
        writes.push(db.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(now));
      }
    }
    if (writes.length) {
      if (ledger) ledger.spendBinding("ratelimit", 1);
      await db.batch(writes);
    }
    return firstFailure;
  } catch (e) {
    // Batched path unavailable — the sequential checks decide.
    console.error("Cerebrum rateLimit: batch failed, falling back to sequential checks", e);
    return sequential();
  }
}
