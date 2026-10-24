/**
 * Race budget tests (2026-10-23, race budget lane).
 *
 * From the live burnout probe: wave 1 legs were recorded as
 * "timed out" at ms 1 while carrying roughly 8,500 ms per leg
 * timeouts, because the per leg clamp read the request budget
 * and the wave's outer race timer read the synthesis deadline,
 * which the pre synthesis stages had already consumed. The
 * rescue wave then ran 12,000 ms legs with no deadline and
 * spent the fact check's reserved window, so the check
 * skipped as no-time and the answer shipped unchecked.
 *
 * These tests pin the repaired arithmetic: a wave fires only
 * into a viable window, every leg timeout is clamped to that
 * window, and the rescue deadline never touches the fact
 * check reserve.
 *
 * Run with: node tests/race-budget.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  MIN_WAVE_WINDOW_MS,
  FACT_CHECK_RESERVE_MS,
  synthesisDeadlineFor,
  synthesisWindowMs,
  waveWindowViable,
  waveLegTimeoutMs,
  rescueDeadlineFor,
} = await import(join(root, "functions/api/search.js"));
const src = await readFile(join(root, "functions/api/search.js"), "utf8");

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

ok("the minimum wave window is the standard capped leg time", () => {
  assert.equal(MIN_WAVE_WINDOW_MS, 3000);
  assert.equal(waveWindowViable(2999), false);
  assert.equal(waveWindowViable(3000), true);
  assert.equal(waveWindowViable(0), false);
});

ok("the probe arithmetic: at the synthesis deadline the window is 1 ms and not viable", () => {
  const t0 = 1000000;
  const requestDeadline = t0 + 19000;
  const deadline = synthesisDeadlineFor(t0, requestDeadline, true);
  assert.equal(deadline, t0 + 8500, "synthesis deadline moved");
  assert.equal(synthesisWindowMs(deadline, t0 + 8499), 1);
  assert.equal(waveWindowViable(synthesisWindowMs(deadline, t0 + 8499)), false,
    "a 1 ms window still counts as viable, so wave 1 would fire legs to die at 1 ms");
  assert.equal(synthesisWindowMs(deadline, t0 + 9000), 0, "a passed deadline must clamp at zero, never go negative");
});

ok("a leg timeout is clamped to the synthesis window, not the request budget", () => {
  // The probe's legs carried 8,501 ms (the request budget clamp)
  // into a 1 ms window. The window clamp reads the window first.
  assert.equal(waveLegTimeoutMs(8501, 1), 1);
  assert.equal(waveLegTimeoutMs(10000, 9000), 9000);
  assert.equal(waveLegTimeoutMs(3000, 9000), 3000, "a leg under the window keeps its own timeout");
  assert.equal(waveLegTimeoutMs(10000, 0), 0, "no window means no leg timeout at all");
});

ok("the rescue deadline leaves exactly the fact check reserve behind it", () => {
  const requestDeadline = 1000000 + 19000;
  assert.equal(FACT_CHECK_RESERVE_MS, 8000);
  assert.equal(rescueDeadlineFor(requestDeadline, true), requestDeadline - FACT_CHECK_RESERVE_MS,
    "with the check on, the rescue may not spend the check's window");
  assert.equal(rescueDeadlineFor(requestDeadline, false), requestDeadline - 2500,
    "with the check off, the rescue keeps only the assembly reserve behind it");
  // The rescue's one allowance over the synthesis deadline is
  // the assembly reserve, and nothing more.
  const synth = synthesisDeadlineFor(1000000, requestDeadline, true);
  assert.equal(rescueDeadlineFor(requestDeadline, true) - synth, 2500);
});

ok("the handler wires the window rules into every wave and the rescue", () => {
  assert.ok(src.includes("wave 1 not fired, only "), "wave 1 has no named skip for a closed window");
  assert.ok(src.includes("waveLegTimeoutMs(clampLegTimeout(isProSearch || answerLength === \"long\" ? 14000 : 10000), synthesisWindowMs(synthesisDeadline, Date.now()))"),
    "wave 1 leg timeouts are not clamped to the synthesis window");
  assert.ok(src.includes("waveLegTimeoutMs(clampLegTimeout(isProSearch || answerLength === \"long\" ? 12000 : 8000), synthesisWindowMs(synthesisDeadline, Date.now()))"),
    "wave 2 leg timeouts are not clamped to the synthesis window");
  assert.ok(src.includes("waveLegTimeoutMs(clampLegTimeout(6000), synthesisWindowMs(synthesisDeadline, Date.now()))"),
    "wave 3 leg timeouts are not clamped to the synthesis window");
  assert.ok(src.includes("rescueDeadlineFor(requestDeadline, !!(settings && settings.factCheck))"),
    "the rescue deadline is not derived from the request deadline and the fact check setting");
  assert.ok(src.includes("rescue not fired: only "), "the rescue has no named skip for a closed window");
  assert.ok(src.includes("rescue-deadline: rescue exceeded its window before the fact check reserve"),
    "the rescue race has no outer deadline before the fact check reserve");
  assert.ok(src.includes("waveLegTimeoutMs(12000, rescueWindowMs)"),
    "rescue leg timeouts are not clamped to the rescue window");
});

ok("the fact check honesty contract is untouched", () => {
  // A skipped check must still read as a skipped check: the
  // admission gate, the no-time trace, and the reserve sized
  // deadline handed to deepFactCheck all stay as they were.
  assert.ok(src.includes("msLeft() > FACT_CHECK_RESERVE_MS && !factCheckBudgetSkipped"),
    "the fact check admission gate changed");
  assert.ok(src.includes("the stage needs more than its stage budget (FACT_CHECK_RESERVE_MS) of request budget and less remained"),
    "the no-time trace wording changed");
  assert.ok(src.includes("deepFactCheck(answer, evidencePapers, env, ledger, factCheckTrace, Date.now() + FACT_CHECK_RESERVE_MS, {"),
    "the fact check deadline changed");
});

console.log("\nrace-budget: " + passed + " passed");
