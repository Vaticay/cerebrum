/**
 * Aggregate stage health (2026-10-14, infrastructure wave): the
 * fleet alarm's data layer in functions/lib/stageHealthAggregate.js.
 *
 * The defect this answers: stageHealth was assembled per request
 * and shipped to the client but never persisted or aggregated
 * server side, so a fleet wide synthesis outage was invisible
 * until a human probed (third rescore, Infrastructure).
 *
 * Pins:
 *  - the writer rolls one request's stageHealth into the right
 *    hourly bucket: ran records count total, ok false counts
 *    failed, a non boolean ok (the fact check's did not run null)
 *    counts skipped and never touches the ok rate;
 *  - a second request in the same hour accumulates onto the same
 *    rows, and a request in the next hour starts a new bucket;
 *  - the read surface returns the window with per stage ok rates;
 *  - a bucket with a failing majority reads as failing (the stage
 *    lands in `alarms`) once the minimum sample is met, and never
 *    below it; a healthy stage never alarms;
 *  - the writer never throws: a broken store, or no store, just
 *    records nothing;
 *  - wiring: search.js fires the writer at its response assembly
 *    and on its total failure path, and the founder only stats
 *    surface reads the aggregate back.
 *
 * Run with: node tests/stage-health-aggregate.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  recordStageHealthAggregate,
  readStageHealthAggregate,
  buildStageHealthIncrements,
  evaluateStageHealthAlarm,
  stageHealthBucketStart,
  STAGE_HEALTH_BUCKET_MS,
  STAGE_HEALTH_MIN_SAMPLE,
} = await import(join(root, "functions/lib/stageHealthAggregate.js"));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
function group(name) {
  console.log(`\n${name}`);
}

/* A fake D1 that actually applies the module's statements to a
 * Map, so the writer and reader are exercised end to end. It
 * understands exactly the statement shapes the module issues:
 * the bucket upsert, the prune delete, and the window select. */
function makeFakeDb() {
  const rows = new Map(); // "stage|bucket" -> {stage, bucket, total, failed, skipped}
  const key = (stage, bucket) => stage + "|" + bucket;
  const apply = (sql, args) => {
    if (sql.startsWith("CREATE TABLE")) return { success: true };
    if (sql.startsWith("INSERT INTO stage_health_buckets")) {
      const [stage, bucket, total, failed, skipped] = args;
      const k = key(stage, bucket);
      const cur = rows.get(k) || { stage, bucket, total: 0, failed: 0, skipped: 0 };
      cur.total += total; cur.failed += failed; cur.skipped += skipped;
      rows.set(k, cur);
      return { success: true };
    }
    if (sql.startsWith("DELETE FROM stage_health_buckets")) {
      for (const [k, r] of rows) if (r.bucket < args[0]) rows.delete(k);
      return { success: true };
    }
    throw new Error("fake D1 does not know this statement: " + sql.slice(0, 60));
  };
  const makeStmt = (sql) => {
    const s = {
      _args: [],
      bind(...a) { s._args = a; return s; },
      run: async () => apply(sql, s._args),
      all: async () => {
        if (!sql.startsWith("SELECT stage, bucket")) throw new Error("fake D1: unexpected select");
        return { results: [...rows.values()].filter((r) => r.bucket >= s._args[0]).map((r) => ({ ...r })) };
      },
    };
    return s;
  };
  return {
    rows,
    exec: async () => ({}),
    prepare: (sql) => makeStmt(sql),
    batch: async (stmts) => { for (const s of stmts) await s.run(); return stmts.map(() => ({ success: true })); },
  };
}

// A stageHealth array in the production shape (mirrors the saved
// live probes): retrieval fine, validation and synthesis failed,
// the fact check did not run (ok null), disagreement fine.
const PROBE_HEALTH = [
  { name: "retrieval", ok: true, ms: 2876 },
  { name: "validation", ok: false, ms: 88 },
  { name: "synthesis", ok: false, ms: 12666 },
  { name: "fact-check", ok: null, ms: 0 },
  { name: "disagreement", ok: true, ms: 0 },
];
const T0 = Date.UTC(2026, 9, 14, 10, 23, 0); // inside the 10:00 hour bucket

// ═══════════════════════════════════════════════════════════════
group("increments — one request, counted honestly");

await test("ran, failed, and did not run land in separate counters", () => {
  const inc = buildStageHealthIncrements(PROBE_HEALTH, T0);
  const byStage = new Map(inc.map((r) => [r.stage, r]));
  assert.equal(byStage.get("retrieval").total, 1);
  assert.equal(byStage.get("retrieval").failed, 0);
  assert.equal(byStage.get("synthesis").total, 1);
  assert.equal(byStage.get("synthesis").failed, 1);
  // The did not run fact check is not a run: total stays 0, so it
  // cannot dilute the ok rate; it is visible as skipped instead.
  assert.equal(byStage.get("fact-check").total, 0);
  assert.equal(byStage.get("fact-check").skipped, 1);
  for (const r of inc) assert.equal(r.bucket, stageHealthBucketStart(T0));
});

await test("junk records are ignored, not counted", () => {
  const inc = buildStageHealthIncrements([null, {}, { name: 7 }, { name: "x", ok: true }], T0);
  assert.equal(inc.length, 1);
  assert.equal(inc[0].stage, "x");
});

// ═══════════════════════════════════════════════════════════════
group("the writer — right buckets, accumulating, silent on failure");

await test("the writer increments the right buckets and a second request accumulates", async () => {
  const db = makeFakeDb();
  assert.equal(await recordStageHealthAggregate({ DB: db }, PROBE_HEALTH, T0), true);
  const bucket = stageHealthBucketStart(T0);
  const synth = db.rows.get("synthesis|" + bucket);
  assert.deepEqual(
    { total: synth.total, failed: synth.failed, skipped: synth.skipped },
    { total: 1, failed: 1, skipped: 0 }
  );
  const fc = db.rows.get("fact-check|" + bucket);
  assert.deepEqual(
    { total: fc.total, failed: fc.failed, skipped: fc.skipped },
    { total: 0, failed: 0, skipped: 1 }
  );
  // A healthy follow up in the same hour accumulates onto the row.
  assert.equal(await recordStageHealthAggregate({ DB: db }, [
    { name: "synthesis", ok: true, ms: 900 },
  ], T0 + 60000), true);
  const synth2 = db.rows.get("synthesis|" + bucket);
  assert.equal(synth2.total, 2);
  assert.equal(synth2.failed, 1);
  // The next hour starts a fresh bucket.
  assert.equal(await recordStageHealthAggregate({ DB: db }, [
    { name: "synthesis", ok: true, ms: 900 },
  ], T0 + STAGE_HEALTH_BUCKET_MS), true);
  assert.equal(db.rows.get("synthesis|" + (bucket + STAGE_HEALTH_BUCKET_MS)).total, 1);
});

await test("the writer charges the ledger per platform attempt, record store style", async () => {
  // The ledger must count what the platform counts even for post
  // response bookkeeping: a cold binding pays the table ensure
  // plus the batch (2), a warm binding pays the batch alone (1).
  const db = makeFakeDb();
  const charges = [];
  const ledger = { spendBinding: (label, n) => charges.push([label, n]) };
  await recordStageHealthAggregate({ DB: db }, PROBE_HEALTH, T0, ledger);
  assert.deepEqual(charges, [["health", 1], ["health", 1]]);
  charges.length = 0;
  await recordStageHealthAggregate({ DB: db }, PROBE_HEALTH, T0 + 1000, ledger);
  assert.deepEqual(charges, [["health", 1]]);
});

await test("the writer never throws: broken store and no store both record nothing", async () => {
  const broken = { DB: { prepare() { throw new Error("store down"); }, exec: async () => ({}) } };
  assert.equal(await recordStageHealthAggregate(broken, PROBE_HEALTH, T0), false);
  assert.equal(await recordStageHealthAggregate({}, PROBE_HEALTH, T0), false);
  assert.equal(await recordStageHealthAggregate({ DB: makeFakeDb() }, [], T0), false);
});

// ═══════════════════════════════════════════════════════════════
group("the read surface and the alarm");

await test("the read surface returns the window with ok rates", async () => {
  const db = makeFakeDb();
  const env = { DB: db };
  for (let i = 0; i < 4; i++) await recordStageHealthAggregate(env, PROBE_HEALTH, T0 + i * 1000);
  await recordStageHealthAggregate(env, [{ name: "synthesis", ok: true, ms: 5 }], T0 + 5000);
  const out = await readStageHealthAggregate(env, T0 + 6000);
  assert.ok(out, "no aggregate read back");
  const synth = out.stages.find((s) => s.stage === "synthesis");
  assert.equal(synth.total, 5);
  assert.equal(synth.failed, 4);
  assert.equal(synth.okRate, 0.2);
  const retrieval = out.stages.find((s) => s.stage === "retrieval");
  assert.equal(retrieval.okRate, 1);
});

await test("a failing majority reads as failing once the minimum sample is met", () => {
  const rows = [
    { stage: "synthesis", bucket: stageHealthBucketStart(T0), total: 6, failed: 4, skipped: 0 },
    { stage: "retrieval", bucket: stageHealthBucketStart(T0), total: 6, failed: 1, skipped: 0 },
  ];
  const out = evaluateStageHealthAlarm(rows, T0);
  assert.deepEqual(out.alarms, ["synthesis"]);
  assert.equal(out.stages.find((s) => s.stage === "retrieval").alarm, false);
});

await test("below the minimum sample, even a total failure does not alarm", () => {
  const rows = [
    { stage: "synthesis", bucket: stageHealthBucketStart(T0), total: STAGE_HEALTH_MIN_SAMPLE - 1, failed: STAGE_HEALTH_MIN_SAMPLE - 1, skipped: 0 },
  ];
  const out = evaluateStageHealthAlarm(rows, T0);
  assert.deepEqual(out.alarms, []);
  assert.equal(out.stages[0].okRate, 0);
});

await test("the window reaches into the previous hour and no further", async () => {
  const db = makeFakeDb();
  const env = { DB: db };
  const prev = T0 - STAGE_HEALTH_BUCKET_MS;
  for (let i = 0; i < STAGE_HEALTH_MIN_SAMPLE; i++) {
    await recordStageHealthAggregate(env, [{ name: "synthesis", ok: false, ms: 1 }], prev + i * 1000);
  }
  const out = await readStageHealthAggregate(env, T0);
  assert.deepEqual(out.alarms, ["synthesis"], "previous hour failures fell out of the window");
  const later = await readStageHealthAggregate(env, T0 + 2 * STAGE_HEALTH_BUCKET_MS);
  assert.deepEqual(later.alarms, [], "stale buckets still alarming two hours on");
  assert.equal(later.stages.length, 0);
});

// ═══════════════════════════════════════════════════════════════
group("wiring — the pipeline feeds it, the operator surface reads it");

await test("search.js fires the writer at assembly and on the total failure path", () => {
  const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
  assert.ok(src.includes('import { recordStageHealthAggregate } from "../lib/stageHealthAggregate.js";'),
    "the writer is not imported");
  assert.ok(src.includes("recordStageHealthAggregate(env, stageHealth, Date.now(), ledger)"),
    "the assembly hook is missing");
  assert.ok(src.includes('recordStageHealthAggregate(env, [{ name: "request", ok: false }], Date.now(), ledger)'),
    "the total failure hook is missing");
});

await test("the founder only stats surface carries the aggregate", () => {
  const src = readFileSync(join(root, "functions/api/llm/stats.js"), "utf8");
  assert.ok(src.includes("readStageHealthAggregate(env)"), "stats does not read the aggregate");
  assert.ok(src.includes("stageHealth,"), "stats does not ship the stageHealth field");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
