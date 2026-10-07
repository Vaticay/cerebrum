/**
 * raceBest tests — quality-over-speed model racing.
 *
 * raceBest replaces Promise.any in the synthesis waves: instead of taking
 * the FASTEST successful leg, it waits for the first success, gives other
 * legs a short grace window, and picks the highest-quality answer via
 * scoreAnswerQuality.
 *
 * Run with: node tests/race-best.mjs
 */

import { strict as assert } from "node:assert";
import { raceBest, scoreAnswerQuality } from "../functions/api/search.js";

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// A high-quality answer: long, cited, structured
const GOOD_ANSWER = `## The short answer

CRISPR gene editing corrects the sickle cell mutation in hematopoietic stem cells [1][2]. Clinical trials show 92% of patients (n = 45) achieved transfusion independence at 12 months (p < 0.001) [1]. In contrast, earlier approaches using viral vectors had lower engraftment rates [3].

## Mechanism

The Cas9 nuclease creates a double-strand break at the HBB locus, and homology-directed repair inserts the corrected sequence [2]. However, off-target effects remain a concern in 3-5% of edited cells [4].

## Key numbers

- 92% transfusion independence (n = 45, 12-month follow-up)
- 3-5% off-target rate in edited cell populations`;

// A low-quality answer: short, no citations, no structure
const BAD_ANSWER = "CRISPR is a gene editing tool. It works pretty well for sickle cell I think.";

// --- scoreAnswerQuality sanity ---
ok("scoreAnswerQuality: good answer outscores bad answer", () => {
  const good = scoreAnswerQuality(GOOD_ANSWER, "does CRISPR cure sickle cell");
  const bad = scoreAnswerQuality(BAD_ANSWER, "does CRISPR cure sickle cell");
  assert.ok(good > bad, `good=${good} should beat bad=${bad}`);
  assert.ok(good > 60, `good answer should score well, got ${good}`);
});

ok("scoreAnswerQuality: empty answer scores 0", () => {
  assert.equal(scoreAnswerQuality("", "q"), 0);
  assert.equal(scoreAnswerQuality(null, "q"), 0);
});

// --- raceBest core behavior ---
await okAsync("raceBest: picks best quality, not fastest", async () => {
  // Bad answer arrives first (fast), good answer arrives during grace window
  const calls = [
    delay(10).then(() => ({ answer: BAD_ANSWER, model: "fast-small" })),
    delay(100).then(() => ({ answer: GOOD_ANSWER, model: "slow-strong" })),
  ];
  const winner = await raceBest(calls, "does CRISPR cure sickle cell", 500);
  assert.equal(winner.model, "slow-strong", "should pick the better answer, not the faster one");
  assert.ok(winner.raceBestScore > 0, "winner should carry raceBestScore");
  assert.equal(winner.raceBestPool, 2, "pool should reflect 2 finishers");
});

await okAsync("raceBest: single leg resolves directly", async () => {
  const winner = await raceBest(
    [delay(10).then(() => ({ answer: GOOD_ANSWER, model: "only" }))],
    "q", 500
  );
  assert.equal(winner.model, "only");
});

await okAsync("raceBest: all fail → AggregateError", async () => {
  const calls = [
    delay(10).then(() => { throw new Error("boom1"); }),
    delay(20).then(() => { throw new Error("boom2"); }),
  ];
  let threw = null;
  try { await raceBest(calls, "q", 500); }
  catch (e) { threw = e; }
  assert.ok(threw, "should throw");
  assert.ok(threw instanceof AggregateError, "should be AggregateError like Promise.any");
  assert.equal(threw.errors.length, 2, "should carry both errors");
});

await okAsync("raceBest: empty calls → AggregateError", async () => {
  let threw = null;
  try { await raceBest([], "q", 500); }
  catch (e) { threw = e; }
  assert.ok(threw instanceof AggregateError, "should be AggregateError");
});

await okAsync("raceBest: stops early at maxFinishers", async () => {
  // 5 legs, maxFinishers=2: should resolve after 2 successes without waiting for grace
  const t0 = Date.now();
  const calls = Array.from({ length: 5 }, (_, i) =>
    delay(10 + i * 10).then(() => ({ answer: GOOD_ANSWER, model: "m" + i }))
  );
  const winner = await raceBest(calls, "q", 10000, 2);
  const elapsed = Date.now() - t0;
  assert.ok(winner, "should resolve");
  assert.ok(elapsed < 1000, `should stop early at maxFinishers, took ${elapsed}ms`);
  assert.ok(winner.raceBestPool >= 2, "pool should have ≥2");
});

await okAsync("raceBest: late success after grace still resolves with first", async () => {
  // Only one leg succeeds, slowly — grace expires, it still wins
  const winner = await raceBest(
    [delay(50).then(() => ({ answer: GOOD_ANSWER, model: "slow" }))],
    "q", 500
  );
  assert.equal(winner.model, "slow");
});

await okAsync("raceBest: mixed success/failure picks best success", async () => {
  const calls = [
    delay(10).then(() => { throw new Error("fail"); }),
    delay(20).then(() => ({ answer: BAD_ANSWER, model: "bad" })),
    delay(60).then(() => ({ answer: GOOD_ANSWER, model: "good" })),
  ];
  const winner = await raceBest(calls, "q", 500);
  assert.equal(winner.model, "good");
});

console.log(`\n${passed} passed`);
