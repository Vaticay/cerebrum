/**
 * Expansion coverage tests (2026-10-22, logic audit L1-1, L1-2, L1-11).
 *
 * L1-1: a partial model expansion used to certify full coverage,
 * because the deterministic fallback ran only when the model
 * returned zero groups and nothing compared the returned groups
 * against the question's central concepts. Coverage is now a
 * computed state: expansionCentralConcepts derives the concepts
 * from the existing central term machinery, computeExpansionCoverage
 * marks each covered or uncovered per source, and
 * resolveExpansionCoverage runs the fallback per uncovered
 * concept and records whatever stays uncovered.
 *
 * L1-2: the validator's alphabet test deleted digit bearing
 * alternates ("6 hours", "14 days"), an alternate list over six
 * discarded the whole group, and a group under two surviving
 * alternates was dropped. Alternates are now validated by shape
 * with digits, units, symbols and abbreviations allowed, oversized
 * lists are trimmed, and single alternate groups survive when the
 * term itself is a stated quantity constraint.
 *
 * L1-11: concepts past the four group cap were dropped silently
 * at every layer. Past the per source caps, a concept is now
 * represented as a plain term group inside the total budget of
 * EXPANSION_TOTAL_GROUP_BUDGET, or recorded as uncovered and cut
 * in the coverage state that buildSearchRecord carries.
 *
 * No network: every function under test is deterministic.
 *
 * Run with: node tests/expansion-coverage.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  validateExpansionGroups,
  buildDeterministicFallbackGroups,
  buildSearchRecord,
  expansionCentralConcepts,
  computeExpansionCoverage,
  resolveExpansionCoverage,
  EXPANSION_TOTAL_GROUP_BUDGET,
} = await import(join(root, "functions/api/search.js"));

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

// The Oct 21 sleep probes, verbatim. Probe 6 spells "sleep" as a
// standalone word; probe 14 is the audit's L1-1 instance, whose
// shipped expansion held groups for only "two weeks" and
// "worse thinking".
const SLEEP_Q6 = "what happens to your brain if you only sleep six hours every night for two weeks straight";
const SLEEP_Q14 = "does sleeping only six hours a night for two weeks make you worse at thinking";
const PARTIAL_MODEL_GROUPS = [
  { term: "two weeks", alternates: ["14 days", "fortnight"] },
  { term: "worse thinking", alternates: ["cognitive impairment", "cognitive decline"] },
];

// ═══════════════════════════════════════════════════════════════════
group("L1-2 — the validator no longer deletes quantities by alphabet");

await test("audit example: a sleep group with a numeric alternate survives", () => {
  const out = validateExpansionGroups(
    [{ term: "sleep", alternates: ["sleep restriction", "6 hours"] }],
    SLEEP_Q6
  );
  assert.deepEqual(out, [{ term: "sleep", alternates: ["sleep restriction", "6 hours"] }]);
});

await test("audit example: a two weeks group with a numeric alternate survives", () => {
  const out = validateExpansionGroups(
    [{ term: "two weeks", alternates: ["14 days", "fortnight"] }],
    SLEEP_Q6
  );
  assert.deepEqual(out, [{ term: "two weeks", alternates: ["14 days", "fortnight"] }]);
});

await test("a numeric dose alternate survives validation", () => {
  const out = validateExpansionGroups(
    [{ term: "six hours", alternates: ["6 hours", "sleep restriction"] }],
    SLEEP_Q6
  );
  assert.deepEqual(out, [{ term: "six hours", alternates: ["6 hours", "sleep restriction"] }]);
});

await test("a digit bearing term stated in the question survives", () => {
  const digitQ = "does sleeping only 6 hours a night for 2 weeks make you worse at thinking";
  const out = validateExpansionGroups(
    [{ term: "6 hours", alternates: ["six hours", "sleep restriction"] }],
    digitQ
  );
  assert.deepEqual(out, [{ term: "6 hours", alternates: ["six hours", "sleep restriction"] }]);
});

await test("a single alternate group survives when the term is a stated quantity constraint", () => {
  const out = validateExpansionGroups(
    [{ term: "six hours", alternates: ["6 hours"] }],
    SLEEP_Q6
  );
  assert.deepEqual(out, [{ term: "six hours", alternates: ["6 hours"] }]);
});

await test("a single alternate group still drops when the term is no stated constraint", () => {
  const out = validateExpansionGroups(
    [{ term: "zorblaxin", alternates: ["zorb extract"] }],
    "does zorblaxin affect quixotase activity"
  );
  assert.deepEqual(out, []);
});

await test("an over cap alternate list is trimmed, not discarded", () => {
  const out = validateExpansionGroups(
    [{
      term: "zorblaxin",
      alternates: ["alt one", "alt two", "alt three", "alt four", "alt five", "alt six", "alt seven"],
    }],
    "does zorblaxin affect quixotase activity"
  );
  assert.equal(out.length, 1, "the group was discarded instead of trimmed");
  assert.deepEqual(out[0].alternates,
    ["alt one", "alt two", "alt three", "alt four", "alt five", "alt six"]);
});

await test("abbreviations and unit bearing alternates survive, junk still drops", () => {
  const out = validateExpansionGroups(
    [{ term: "zorblaxin", alternates: ["mg/dl dosing", "zorblaxin!!", "zorb extract"] }],
    "does zorblaxin affect quixotase activity"
  );
  assert.deepEqual(out, [{ term: "zorblaxin", alternates: ["mg/dl dosing", "zorb extract"] }]);
});

// ═══════════════════════════════════════════════════════════════════
group("L1-1 — coverage is a computed state, decided per concept");

await test("the sleep question's central concepts include sleep, the dose and the duration", () => {
  const terms = expansionCentralConcepts(SLEEP_Q14).map((c) => c.term);
  assert.ok(terms.includes("sleeping"), `sleep concept missing: ${terms}`);
  assert.ok(terms.includes("six hours"), `dose concept missing: ${terms}`);
  assert.ok(terms.includes("two weeks"), `duration concept missing: ${terms}`);
  assert.ok(terms.includes("thinking"), `outcome concept missing: ${terms}`);
});

await test("partial model coverage is marked partial, concept by concept", () => {
  const cov = computeExpansionCoverage(SLEEP_Q14, PARTIAL_MODEL_GROUPS);
  assert.ok(cov.covered.some((c) => c.term === "two weeks" && c.via === "model"),
    `two weeks not marked model covered: ${JSON.stringify(cov)}`);
  assert.ok(cov.covered.some((c) => c.term === "thinking" && c.via === "model"),
    `thinking not marked model covered: ${JSON.stringify(cov)}`);
  assert.ok(cov.covered.some((c) => c.term === "sleeping" && c.via === "hand"),
    `sleeping not marked hand covered: ${JSON.stringify(cov)}`);
  assert.ok(cov.uncovered.includes("six hours"),
    `the dose reads as covered when no source covered it: ${JSON.stringify(cov)}`);
});

await test("partial model coverage triggers a per concept fallback for the dose", () => {
  const res = resolveExpansionCoverage(SLEEP_Q14, PARTIAL_MODEL_GROUPS);
  assert.ok(res.fallbackGroups.length > 0,
    "no fallback ran on a partial model result");
  assert.ok(res.fallbackGroups.some((g) => g.term === "six hours"),
    `the dose got no fallback group: ${JSON.stringify(res.fallbackGroups)}`);
  const dose = res.coverage.covered.find((c) => c.term === "six hours");
  assert.ok(dose && dose.via === "fallback",
    `the dose is not recorded as fallback covered: ${JSON.stringify(res.coverage)}`);
  const sleep = res.coverage.covered.find((c) => c.term === "sleeping");
  assert.ok(sleep, `sleep is absent from the decided coverage: ${JSON.stringify(res.coverage)}`);
  assert.ok(!res.coverage.uncovered.includes("six hours")
    && !res.coverage.uncovered.includes("sleeping"),
    `a decided concept is still listed uncovered: ${JSON.stringify(res.coverage)}`);
  assert.ok(res.groups.length > PARTIAL_MODEL_GROUPS.length,
    "the merged groups are just the partial model groups again");
});

await test("a concept no source covers is recorded uncovered, never silently absent", () => {
  // Eleven central concepts and a total budget of eight groups:
  // the tail cannot all be represented, so it must be recorded.
  const q = "does zorblaxin affect quixotase perchlorate vanadate molybdate tungstate arsenate chromate selenate activity";
  const res = resolveExpansionCoverage(q, []);
  assert.equal(res.groups.length, EXPANSION_TOTAL_GROUP_BUDGET,
    `expected the total budget of groups, got ${res.groups.length}`);
  assert.ok(res.coverage.uncovered.length > 0,
    `over budget concepts vanished instead of being recorded: ${JSON.stringify(res.coverage)}`);
  assert.deepEqual(res.coverage.cut, res.coverage.uncovered,
    "the cut set does not name the uncovered tail concepts");
  for (const term of res.coverage.uncovered) {
    assert.ok(res.coverage.central.includes(term),
      `uncovered term ${term} is not one of the derived central concepts`);
  }
});

await test("fallback with an explicit larger limit emits past the default cap of four", () => {
  const terms = ["zorblaxin", "quixotase", "wobble", "tremor", "fluxion", "selenate"];
  const capped = buildDeterministicFallbackGroups("q", terms);
  assert.equal(capped.length, 4, "the default fallback cap moved");
  const widened = buildDeterministicFallbackGroups("q", terms, { limit: 6 });
  assert.equal(widened.length, 6, "the explicit limit was not honored");
});

// ═══════════════════════════════════════════════════════════════════
group("L1-11 — concepts past the cap are represented or recorded");

await test("the probe 10 question's oil concept gets a group past the model cap", () => {
  // After probe 10 shipped two model groups ("baby flies" and
  // "garbage") and the oil concept had no group at all.
  const q = "can baby flies that eat garbage live off the oil left over from frying food";
  const model = [
    { term: "baby flies", alternates: ["larvae", "fly larvae"] },
    { term: "garbage", alternates: ["waste", "refuse"] },
  ];
  const res = resolveExpansionCoverage(q, model);
  assert.ok(res.coverage.central.includes("oil"),
    `oil is not a derived central concept: ${JSON.stringify(res.coverage.central)}`);
  assert.ok(res.groups.some((g) => g.term === "oil"),
    `oil has no group after coverage resolution: ${JSON.stringify(res.groups)}`);
  assert.ok(!res.coverage.uncovered.includes("oil"),
    "oil is recorded uncovered while a group for it shipped");
});

await test("the uncovered set is recorded in the search record", () => {
  const q = "does zorblaxin affect quixotase perchlorate vanadate molybdate tungstate arsenate chromate selenate activity";
  const res = resolveExpansionCoverage(q, []);
  const rec = buildSearchRecord({
    question: q,
    diag: {
      expansionCoverage: res.coverage,
      llmExpanded: res.groups,
      funnel: { gathered: 10, deduped: 8, ranked: 3 },
      sourceOutcomes: [{ source: "europePMC", ok: true, count: 5 }],
    },
    sources: [{ title: "A paper", year: 2020 }],
  });
  assert.ok(rec, "record must not be null for a completed retrieval");
  assert.ok(rec.expansionCoverage, "the record carries no expansion coverage");
  assert.deepEqual(rec.expansionCoverage.uncovered, res.coverage.uncovered);
  assert.deepEqual(rec.expansionCoverage.cut, res.coverage.cut);
  assert.deepEqual(rec.expansionCoverage.central, res.coverage.central);
  assert.ok(rec.expansionCoverage.uncovered.length > 0,
    "the record hides the uncovered tail");
});

// ═══════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
