// Aggregate stage health — the fleet alarm's data layer.
//
// stageHealth is assembled per request in functions/api/search.js and
// shipped to the client, but until now nothing persisted or aggregated
// it server side (third rescore, Infrastructure): when the whole
// synthesis fleet went down, the only signal was a console line in the
// Cloudflare dashboard logs and a human happening to probe. This
// module rolls each completed search's stage outcomes into hourly D1
// buckets (one row per stage per hour: runs, failures, did not runs),
// and reads the trailing window back with the alarm evaluated, on the
// founder only operator surface (functions/api/llm/stats.js).
//
// What an operator reads as an outage: a stage lands in `alarms` when,
// over the trailing window (the current and previous hour buckets,
// combined so a fresh hour is not blind), at least
// STAGE_HEALTH_MIN_SAMPLE of its runs actually ran AND its ok rate is
// below STAGE_HEALTH_ALARM_OK_RATE — a failing majority. For the
// synthesis stage that shape means the fleet is down or daily capped
// fleet wide, not one bad question: page a human. Below the minimum
// sample the window says nothing either way, and a stage whose runs
// mostly did not run (skipped) shows up in `skipped`, never diluted
// into the ok rate.
//
// The write side is post response bookkeeping in the record store's
// pattern, exactly: search.js fires it via waitUntil after the
// response is assembled, so it never delays the response and never
// draws on any stage's funding (every stage has closed by then,
// and the response's own _ledger snapshot is already taken). Like
// storeSearchRecord it still charges the request's ledger object
// per platform attempt — the memoized table ensure on a cold
// binding, plus one for the batch — because a ledger must count
// what the platform counts, and those charges land after the
// snapshot, visible in the operator diag. Every failure inside
// the writer is swallowed: a broken aggregate must never break,
// delay, or degrade a search. It feeds on fresh pipeline
// completions (plus the pipeline's top level catch, whose
// synthetic "request" record is the total failure signal); cache
// serves do not feed it, so the rates describe the pipeline
// itself.

export const STAGE_HEALTH_BUCKET_MS = 60 * 60 * 1000;
export const STAGE_HEALTH_WINDOW_BUCKETS = 2;
export const STAGE_HEALTH_MIN_SAMPLE = 5;
export const STAGE_HEALTH_ALARM_OK_RATE = 0.5;

export function stageHealthBucketStart(nowMs) {
  return Math.floor(nowMs / STAGE_HEALTH_BUCKET_MS) * STAGE_HEALTH_BUCKET_MS;
}

/* Pure: one request's stageHealth array → the bucket increments for
 * it. A record counts toward `total` only when the stage actually
 * ran (ok true or false); a non boolean ok (the fact check's "did
 * not run" null, or a missing field) counts as `skipped` so a stage
 * that never ran cannot dilute or inflate the ok rate. */
export function buildStageHealthIncrements(stageHealth, nowMs = Date.now()) {
  const bucket = stageHealthBucketStart(nowMs);
  const byStage = new Map();
  for (const rec of Array.isArray(stageHealth) ? stageHealth : []) {
    if (!rec || typeof rec.name !== "string" || !rec.name) continue;
    let row = byStage.get(rec.name);
    if (!row) {
      row = { stage: rec.name, bucket, total: 0, failed: 0, skipped: 0 };
      byStage.set(rec.name, row);
    }
    if (rec.ok === true) row.total += 1;
    else if (rec.ok === false) { row.total += 1; row.failed += 1; }
    else row.skipped += 1;
  }
  return [...byStage.values()];
}

/* The bookkeeping funding lane (2026-10-14, fifth panel, Job 1):
 * this writer is post assembly bookkeeping, so its charges tally
 * into the invocation total through the ledger's bookkeeping lane
 * (spendBookkeeping: counted, never refused) when the ledger
 * provides it — under the wave five hard total cap the plain
 * binding charge threw at exactly the cap inside this writer's
 * own catch, and capped runs silently wrote no health bucket.
 * Ledger shaped objects carrying only spendBinding (test fakes)
 * keep the old charge. Mirrors chargeBookkeeping in
 * functions/api/search.js; duplicated here rather than imported
 * to keep the lib free of a cycle back into the API module. */
function chargeHealth(ledger, n = 1) {
  if (!ledger) return;
  if (typeof ledger.spendBookkeeping === "function") ledger.spendBookkeeping("health", n);
  else if (typeof ledger.spendBinding === "function") ledger.spendBinding("health", n);
}

// Lazily created once per DB binding (the search record store's
// ensureSearchRecordsTable pattern): memoized in a WeakMap, a
// failed create clears its own memo entry so the next write
// retries, and the CREATE is charged to the triggering request's
// ledger when one is passed — it is a real platform call.
const tableReadyByDb = new WeakMap();
function ensureTable(db, ledger = null) {
  let ready = tableReadyByDb.get(db);
  if (!ready) {
    chargeHealth(ledger, 1);
    ready = (async () => {
      await db.prepare(
        "CREATE TABLE IF NOT EXISTS stage_health_buckets (" +
          "stage TEXT NOT NULL, " +
          "bucket INTEGER NOT NULL, " +
          "total INTEGER NOT NULL DEFAULT 0, " +
          "failed INTEGER NOT NULL DEFAULT 0, " +
          "skipped INTEGER NOT NULL DEFAULT 0, " +
          "PRIMARY KEY (stage, bucket))"
      ).run();
    })();
    tableReadyByDb.set(db, ready);
    ready.catch(() => {
      if (tableReadyByDb.get(db) === ready) tableReadyByDb.delete(db);
    });
  }
  return ready;
}

/**
 * Record one completed request's stage outcomes. Never throws and
 * never returns a rejected promise: false means "not recorded" and
 * the caller does not care. One batched write however many stages
 * reported (a batch is one bound service call). When a ledger is
 * passed it is charged per platform attempt BEFORE the attempt —
 * the cold ensure and the batch — through the bookkeeping lane
 * (see chargeHealth above), so the invocation's ledger total
 * still equals the platform's and the charge itself can never be
 * the reason the write fails.
 */
export async function recordStageHealthAggregate(env, stageHealth, nowMs = Date.now(), ledger = null) {
  try {
    if (!env || !env.DB || typeof env.DB.prepare !== "function") return false;
    const rows = buildStageHealthIncrements(stageHealth, nowMs);
    if (!rows.length) return false;
    const db = env.DB;
    await ensureTable(db, ledger);
    const stmts = rows.map((r) =>
      db
        .prepare(
          "INSERT INTO stage_health_buckets (stage, bucket, total, failed, skipped) VALUES (?, ?, ?, ?, ?) " +
            "ON CONFLICT(stage, bucket) DO UPDATE SET " +
            "total = total + excluded.total, failed = failed + excluded.failed, skipped = skipped + excluded.skipped"
        )
        .bind(r.stage, r.bucket, r.total, r.failed, r.skipped)
    );
    // Prune week old buckets probabilistically — the rate limiter's
    // 1% pattern; it rides inside the same batch, so it costs no
    // extra platform call. Rows are tiny either way (a handful of
    // stages per hour); this just keeps the table bounded forever.
    if (Math.random() < 0.01) {
      stmts.push(
        db.prepare("DELETE FROM stage_health_buckets WHERE bucket < ?")
          .bind(nowMs - 7 * 24 * STAGE_HEALTH_BUCKET_MS)
      );
    }
    if (typeof db.batch === "function") {
      chargeHealth(ledger, 1);
      await db.batch(stmts);
    } else {
      for (const s of stmts) {
        chargeHealth(ledger, 1);
        await s.run();
      }
    }
    return true;
  } catch (e) {
    console.error("Cerebrum stageHealthAggregate: write failed, swallowed by design", e);
    return false;
  }
}

/* Pure: bucket rows → per stage window totals with the alarm
 * evaluated. Rows outside the trailing window are ignored. */
export function evaluateStageHealthAlarm(rows, nowMs = Date.now()) {
  const cur = stageHealthBucketStart(nowMs);
  const windowStarts = new Set();
  for (let i = 0; i < STAGE_HEALTH_WINDOW_BUCKETS; i++) {
    windowStarts.add(cur - i * STAGE_HEALTH_BUCKET_MS);
  }
  const byStage = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    // No bitwise coercion on bucket: it is a ms epoch and | 0
    // would truncate it to 32 bits.
    if (!r || typeof r.stage !== "string" || !windowStarts.has(Number(r.bucket))) continue;
    let s = byStage.get(r.stage);
    if (!s) {
      s = { stage: r.stage, total: 0, failed: 0, skipped: 0 };
      byStage.set(r.stage, s);
    }
    s.total += r.total | 0;
    s.failed += r.failed | 0;
    s.skipped += r.skipped | 0;
  }
  const stages = [...byStage.values()]
    .map((s) => {
      const okRate = s.total > 0 ? (s.total - s.failed) / s.total : null;
      const alarm =
        s.total >= STAGE_HEALTH_MIN_SAMPLE &&
        okRate !== null &&
        okRate < STAGE_HEALTH_ALARM_OK_RATE;
      return { ...s, okRate, alarm };
    })
    .sort((a, b) => a.stage.localeCompare(b.stage));
  return {
    windowBuckets: STAGE_HEALTH_WINDOW_BUCKETS,
    minSample: STAGE_HEALTH_MIN_SAMPLE,
    alarmOkRate: STAGE_HEALTH_ALARM_OK_RATE,
    stages,
    alarms: stages.filter((s) => s.alarm).map((s) => s.stage),
  };
}

/**
 * Read the trailing window for the operator surface. Returns the
 * evaluated shape plus the raw rows, or null when there is no
 * database or the read failed (the surface then reports null
 * rather than a fabricated healthy zero).
 */
export async function readStageHealthAggregate(env, nowMs = Date.now()) {
  try {
    if (!env || !env.DB || typeof env.DB.prepare !== "function") return null;
    const cur = stageHealthBucketStart(nowMs);
    const oldest = cur - (STAGE_HEALTH_WINDOW_BUCKETS - 1) * STAGE_HEALTH_BUCKET_MS;
    const res = await env.DB
      .prepare(
        "SELECT stage, bucket, total, failed, skipped FROM stage_health_buckets " +
          "WHERE bucket >= ? ORDER BY stage, bucket"
      )
      .bind(oldest)
      .all();
    const rows = (res && res.results) || [];
    return { bucketStart: cur, ...evaluateStageHealthAlarm(rows, nowMs), rows };
  } catch (e) {
    console.error("Cerebrum stageHealthAggregate: read failed", e);
    return null;
  }
}
