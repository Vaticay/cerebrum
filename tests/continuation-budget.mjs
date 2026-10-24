/**
 * Continuation budget tests (2026-10-23, continuation lane).
 *
 * The two unfinished parts of the owner's "Fix all three now"
 * order, measured by the first continuation's acceptance batch:
 *
 *   Part 1 — retrieval latency eats the synthesis window. On
 *   the owner's burnout question retrieval ran 7,076 ms of the
 *   19,000 ms request budget, synthesis opened with about
 *   685 ms against its 8,500 ms deadline (under the 3,000 ms
 *   wave minimum), no wave fired, and the extractive fallback
 *   served. Retrieval now runs under retrievalDeadlineFor: a
 *   bounded slice derived from the synthesis deadline, early
 *   enough that validation and prep fit and wave 1 still
 *   opens with a viable window.
 *
 *   Part 2 — post winner work eats the fact check reserve.
 *   On probe 3 the winner landed at 3,111 ms inside a
 *   6,726 ms synthesis stage; the citation repair race (the
 *   one post winner race gated on the request budget alone)
 *   spent the difference and the claim check skipped as
 *   no-time. The repair's close is now bounded by
 *   retryCloseWindowMs so the race ends with the fact check
 *   reserve intact whenever the request carries the check.
 *
 * Run with: node tests/continuation-budget.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  MIN_WAVE_WINDOW_MS,
  FACT_CHECK_RESERVE_MS,
  RETRY_RACE_CLOSE_MS,
  RETRY_RESERVE_MARGIN_MS,
  MIN_RETRY_CLOSE_MS,
  POST_RETRIEVAL_PREP_MS,
  MIN_RETRIEVAL_SLICE_MS,
  synthesisDeadlineFor,
  retrievalDeadlineFor,
  effectiveRetrievalDeadlineMs,
  settleByDeadline,
  retryCloseWindowMs,
} = await import(join(root, "functions/api/search.js"));
const src = await readFile(join(root, "functions/api/search.js"), "utf8");

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

// ── Part 1: the retrieval slice ─────────────────────────────

ok("the slice leaves a viable wave window plus the prep allowance before the synthesis deadline", () => {
  const t0 = 1000000;
  const requestDeadline = t0 + 19000;
  const synth = synthesisDeadlineFor(t0, requestDeadline, true);
  const slice = retrievalDeadlineFor(t0, requestDeadline, true);
  assert.equal(synth, t0 + 8500, "synthesis deadline moved");
  assert.equal(slice, synth - MIN_WAVE_WINDOW_MS - POST_RETRIEVAL_PREP_MS);
  assert.equal(slice, t0 + 4000, "with the check on, retrieval's slice ends at 4,000 ms");
  assert.ok(POST_RETRIEVAL_PREP_MS >= 1195, "the prep allowance must cover the slowest measured validation (1,195 ms)");
});

ok("with the check off the slice grows by exactly the reserve", () => {
  const t0 = 1000000;
  const requestDeadline = t0 + 19000;
  assert.equal(retrievalDeadlineFor(t0, requestDeadline, false), t0 + 12000);
  assert.equal(
    retrievalDeadlineFor(t0, requestDeadline, false) - retrievalDeadlineFor(t0, requestDeadline, true),
    FACT_CHECK_RESERVE_MS
  );
});

ok("the probe 1 reconstruction: a 7,076 ms retrieval can no longer happen inside the slice", () => {
  // Probe 1's retrieval ended at 7,076 ms and synthesis opened
  // with ~685 ms. Under the slice the gather returns at its
  // deadline (4,000 ms from request start at the latest, plus
  // its own floor), so even with the full prep allowance spent
  // the window synthesis opens with is at least the wave
  // minimum the race budget lane set.
  const t0 = 1000000;
  const slice = retrievalDeadlineFor(t0, t0 + 19000, true);
  const windowAtWave1 = synthesisDeadlineFor(t0, t0 + 19000, true) - (slice + POST_RETRIEVAL_PREP_MS);
  assert.equal(windowAtWave1, MIN_WAVE_WINDOW_MS);
});

ok("the effective deadline floors a gather whose slice already passed, and passes null through", () => {
  const start = 5000000;
  assert.equal(effectiveRetrievalDeadlineMs(start - 60000, start), start + MIN_RETRIEVAL_SLICE_MS,
    "a stale slice must still give the primary rung its floor");
  assert.equal(effectiveRetrievalDeadlineMs(start + 4000, start), start + 4000);
  assert.equal(effectiveRetrievalDeadlineMs(null, start), null, "no deadline named means no slice");
  assert.equal(effectiveRetrievalDeadlineMs(undefined, start), null);
});

await okAsync("settleByDeadline returns what settled and names the cut for what did not", async () => {
  const slow = new Promise((r) => setTimeout(() => r("slow"), 600));
  const out = await settleByDeadline([Promise.resolve("fast"), slow, Promise.reject(new Error("boom"))], Date.now() + 120);
  assert.equal(out[0].status, "fulfilled");
  assert.equal(out[0].value, "fast");
  assert.equal(out[1].status, "rejected");
  assert.match(out[1].reason.message, /retrieval deadline/, "a cut source must be recorded as cut by the slice, not as an ordinary failure");
  assert.equal(out[2].status, "rejected");
  assert.equal(out[2].reason.message, "boom", "a real failure keeps its own reason");
});

await okAsync("settleByDeadline with no deadline is plain allSettled, and a passed deadline cuts at once", async () => {
  const out = await settleByDeadline([Promise.resolve(1), Promise.reject(new Error("x"))], null);
  assert.deepEqual(out.map((o) => o.status), ["fulfilled", "rejected"]);
  const cut = await settleByDeadline([new Promise((r) => setTimeout(() => r(1), 300))], Date.now() - 1);
  assert.equal(cut[0].status, "rejected");
  assert.match(cut[0].reason.message, /retrieval deadline/);
});

ok("the handler wires the slice into the gather, the guarantee, and the stage backstop", () => {
  assert.ok(src.includes("retrievalDeadlineFor(requestT0, requestDeadline, !!(settings && settings.factCheck))"),
    "the retrieval deadline is not derived from the request landmarks");
  assert.ok(src.includes("deadlineMs: retrievalDeadlineMs,"),
    "a gather call does not receive the slice");
  assert.ok(src.includes("timeoutMs: Math.max(3000, retrievalDeadlineMs - Date.now() + 1000)"),
    "the retrieval stage backstop is not derived from the slice");
  assert.ok(src.includes("effectiveRetrievalDeadlineMs(opts && opts.deadlineMs, _searchStart)"),
    "the gather does not resolve its effective deadline");
  assert.ok(src.includes("diag.retrievalSliceMs"), "the slice is not on the gather diag");
});

// ── Part 2: the repair close against the reserve ────────────

ok("with the check off the repair close is the standard close, unchanged", () => {
  assert.equal(retryCloseWindowMs(19000, false), RETRY_RACE_CLOSE_MS);
  assert.equal(retryCloseWindowMs(9001, false), RETRY_RACE_CLOSE_MS);
});

ok("the probe 3 reconstruction: a repair fired at the winner's position now ends with the reserve intact", () => {
  // Probe 3 at the repair's fire point had about 10,889 ms of
  // request budget left. The old close let the race run the
  // full 5,000 and close at 5,889 left — under the 8,000 the
  // admission gate requires, hence no-time. The bounded close
  // ends the race with the reserve plus margin still standing.
  const left = 10889;
  const close = retryCloseWindowMs(left, true);
  assert.equal(close, left - FACT_CHECK_RESERVE_MS - RETRY_RESERVE_MARGIN_MS);
  assert.ok(left - close > FACT_CHECK_RESERVE_MS, "the gate's strict inequality must hold after the race closes");
});

ok("the close clamps at the standard close and floors at zero at the reserve edge", () => {
  assert.equal(retryCloseWindowMs(19000, true), RETRY_RACE_CLOSE_MS);
  assert.equal(retryCloseWindowMs(FACT_CHECK_RESERVE_MS + RETRY_RESERVE_MARGIN_MS, true), 0);
  assert.equal(retryCloseWindowMs(0, true), 0);
  assert.ok(MIN_RETRY_CLOSE_MS < RETRY_RACE_CLOSE_MS, "the stand down floor must sit under the standard close");
  // The stand down point: with the check on, the repair fires
  // only when the bounded close still gives a leg a real
  // chance — from 9,750 ms left upward.
  assert.ok(retryCloseWindowMs(9750, true) >= MIN_RETRY_CLOSE_MS);
  assert.ok(retryCloseWindowMs(9749, true) < MIN_RETRY_CLOSE_MS);
});

ok("the citation repair carries the bounded close and the fact check gate is untouched", () => {
  assert.ok(src.includes("retryCloseWindowMs(msLeft(), !!(settings && settings.factCheck))"),
    "the citation repair does not compute its bounded close");
  assert.ok(src.includes('plannedRetryRace(retryMsgs2, maxTokens, 12000, "citation", [], closeMs)'),
    "the citation repair race does not receive the bounded close");
  assert.ok(src.includes("if (closeMs < MIN_RETRY_CLOSE_MS) return null;"),
    "the repair has no stand down for a close with no real chance");
  assert.ok(src.includes("msLeft() > FACT_CHECK_RESERVE_MS && !factCheckBudgetSkipped"),
    "the fact check admission gate changed");
  assert.ok(src.includes('if (!hasCitations && msLeft() > 9000)'),
    "the probe 17 request budget gate on the pre strip repair changed");
  assert.ok(src.includes("!citationRetryAttempted && msLeft() > 9000"),
    "the probe 17 request budget gate on the post strip repair changed");
});

console.log("\ncontinuation-budget: " + passed + " passed");
