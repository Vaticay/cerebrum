// Priority search queue — Pro members skip the line when the system is busy.
//
// Cloudflare Workers are stateless isolates, so there is no true in-process
// queue. This is a D1-backed concurrency semaphore: every /api/search run
// holds one slot for its lifetime. When all slots are taken, non-Pro
// requests get a 429 with Retry-After while Pro requests proceed.
//
// Numbers: MAX_CONCURRENT_SEARCHES total slots, of which PRO_RESERVED are
// held back for Pro. Standard users (anonymous/free/lite) may only occupy
// up to MAX - PRO_RESERVED.
//
// Honest limitation: the counter is approximate across edge colos (D1
// replication lag), same as the shared rate limiter. It is a priority
// signal, not a hard distributed lock. Slots self-heal: a crashed worker
// leaks its slot, but any acquire after 120s of silence resets the
// counter, so a leak can never wedge the system permanently.

export const MAX_CONCURRENT_SEARCHES = 20;
export const PRO_RESERVED_SLOTS = 4;
export const STALE_SLOT_MS = 120000;

let tableReady = null;
export function ensureSlotTable(env) {
  if (!env || !env.DB) return Promise.resolve(false);
  if (!tableReady) {
    tableReady = env.DB.exec(
      "CREATE TABLE IF NOT EXISTS search_slots (" +
        "k TEXT PRIMARY KEY, " +
        "n INTEGER NOT NULL DEFAULT 0, " +
        "expires_at INTEGER NOT NULL DEFAULT 0)"
    ).then(
      () => true,
      (e) => { tableReady = null; throw e; }
    );
  }
  return tableReady;
}

/**
 * Try to take a search slot.
 * @returns {Promise<{allowed: boolean, priority: "pro"|"standard", active: number}>}
 * Fail-open: any DB problem allows the search (priority is a feature,
 * not a gate — it must never 500 a search).
 */
export async function acquireSearchSlot(env, isPro) {
  const fallback = { allowed: true, priority: isPro ? "pro" : "standard", active: 0 };
  try {
    if (!env || !env.DB) return fallback;
    await ensureSlotTable(env);
    const now = Date.now();
    // Self-heal: no acquire in STALE_SLOT_MS means every holder crashed.
    try {
      await env.DB.prepare("UPDATE search_slots SET n = 0 WHERE k = 'active' AND expires_at < ?")
        .bind(now - STALE_SLOT_MS).run();
    } catch (cbErr) { console.error("[Cerebrum] searchPriority.js acquireSearchSlot: stale reset:", cbErr); }
    await env.DB.prepare(
      "INSERT INTO search_slots (k, n, expires_at) VALUES ('active', 1, ?) " +
      "ON CONFLICT(k) DO UPDATE SET n = n + 1, expires_at = ?"
    ).bind(now, now).run();
    const row = await env.DB.prepare("SELECT n FROM search_slots WHERE k = 'active'").first();
    const active = (row && row.n) || 1;
    const cap = isPro ? MAX_CONCURRENT_SEARCHES : MAX_CONCURRENT_SEARCHES - PRO_RESERVED_SLOTS;
    if (active > cap) {
      // Over capacity for this tier — give the slot back.
      try {
        await env.DB.prepare("UPDATE search_slots SET n = MAX(n - 1, 0) WHERE k = 'active'").run();
      } catch (cbErr) { console.error("[Cerebrum] searchPriority.js acquireSearchSlot: release on deny:", cbErr); }
      return { allowed: false, priority: isPro ? "pro" : "standard", active };
    }
    return { allowed: true, priority: isPro ? "pro" : "standard", active };
  } catch (cbErr) {
    console.error("[Cerebrum] searchPriority.js acquireSearchSlot:", cbErr);
    return fallback;
  }
}

/** Release a held slot. Never throws. */
export async function releaseSearchSlot(env) {
  try {
    if (!env || !env.DB) return;
    await env.DB.prepare("UPDATE search_slots SET n = MAX(n - 1, 0) WHERE k = 'active'").run();
  } catch (cbErr) {
    console.error("[Cerebrum] searchPriority.js releaseSearchSlot:", cbErr);
  }
}

// ── Denial observability ────────────────────────────────────────────────
// Daily counters of how often the queue actually denied a standard search.
// Exposed in the 429 body (denialsToday) and search _diag so the priority
// feature's real-world bite is measurable instead of assumed.

let denialTableReady = null;
export function ensureDenialTable(env) {
  if (!env || !env.DB) return Promise.resolve(false);
  if (!denialTableReady) {
    denialTableReady = env.DB.exec(
      "CREATE TABLE IF NOT EXISTS search_denials (" +
        "day TEXT PRIMARY KEY, " +
        "denials INTEGER NOT NULL DEFAULT 0)"
    ).then(
      () => true,
      (e) => { denialTableReady = null; throw e; }
    );
  }
  return denialTableReady;
}

function utcDay(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Record one queue denial. Never throws. Returns today's denial count. */
export async function recordSlotDenial(env) {
  try {
    if (!env || !env.DB) return 0;
    await ensureDenialTable(env);
    const day = utcDay(Date.now());
    await env.DB.prepare(
      "INSERT INTO search_denials (day, denials) VALUES (?, 1) " +
      "ON CONFLICT(day) DO UPDATE SET denials = denials + 1"
    ).bind(day).run();
    const row = await env.DB.prepare("SELECT denials FROM search_denials WHERE day = ?").bind(day).first();
    return (row && row.denials) || 1;
  } catch (cbErr) {
    console.error("[Cerebrum] searchPriority.js recordSlotDenial:", cbErr);
    return 0;
  }
}

/** Today's + last-7-days denial counts. Never throws. */
export async function getDenialStats(env) {
  const fallback = { today: 0, last7d: 0 };
  try {
    if (!env || !env.DB) return fallback;
    await ensureDenialTable(env);
    const weekAgo = utcDay(Date.now() - 6 * 86400000);
    const r = await env.DB.prepare(
      "SELECT day, denials FROM search_denials WHERE day >= ? ORDER BY day DESC"
    ).bind(weekAgo).all();
    const rows = (r && r.results) || [];
    const today = utcDay(Date.now());
    return {
      today: (rows.find((x) => x.day === today) || { denials: 0 }).denials || 0,
      last7d: rows.reduce((s, x) => s + (x.denials || 0), 0),
    };
  } catch (cbErr) {
    console.error("[Cerebrum] searchPriority.js getDenialStats:", cbErr);
    return fallback;
  }
}
