/**
 * Groundbreaking intelligence regression tests (2026-10-08).
 *
 * Dusty: "Make sure the search intelligence is GROUND breaking and innovative."
 * Three mechanical (not prompt-wish) implementations:
 * 1. Question decomposition: "why/how" questions split into aspect sub-queries
 * 2. Evidence strength ranking: study design + journal + sample + velocity
 * 3. Contradiction-first queries: targeted high-tier searches for disputes
 *
 * Run with: node tests/groundbreaking-intelligence.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const knowledge = await import(join(root, "functions/lib/knowledge.js"));

const { decomposeQuestion, rankByEvidenceStrength, buildContradictionQueries } = knowledge;

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}\n    ${e.message.split("\n")[0]}`);
  }
}

console.log("\nQuestion decomposition");

test("why question decomposes into aspect sub-queries", () => {
  const r = decomposeQuestion(
    "Why does soil crack into patterns as it dries?",
    ["soil", "crack", "pattern", "dry"]
  );
  assert.ok(r.decomposed, "should decompose");
  assert.ok(r.subQueries.length >= 2, "should produce 2+ sub-queries, got " + r.subQueries.length);
  assert.ok(r.aspects.length >= 2, "should have 2+ aspects");
  const aspectNames = r.aspects.map((a) => a.aspect);
  assert.ok(aspectNames.includes("mechanism"), "should include mechanism aspect");
});

test("how question decomposes", () => {
  const r = decomposeQuestion(
    "How do vaccines train the immune system?",
    ["vaccine", "train", "immune", "system"]
  );
  assert.ok(r.decomposed, "should decompose");
  assert.ok(r.subQueries.length >= 2, "should produce 2+ sub-queries");
});

test("what-is question does NOT decompose", () => {
  const r = decomposeQuestion(
    "What is the capital of France?",
    ["capital", "france"]
  );
  assert.ok(!r.decomposed, "factual lookup should not decompose");
  assert.equal(r.subQueries.length, 0);
});

test("too few terms does NOT decompose", () => {
  const r = decomposeQuestion("Why soil?", ["soil"]);
  assert.ok(!r.decomposed, "single term should not decompose");
});

test("empty query does NOT decompose", () => {
  const r = decomposeQuestion("", []);
  assert.ok(!r.decomposed);
});

console.log("\nEvidence strength ranking");

const MOCK_PAPERS = [
  {
    title: "Single observational study of soil cracking",
    abstract: "We observed cracks in n=30 soil samples. The cracks were polygonal.",
    journal: "Unknown Regional Journal",
    year: "2024",
    citations: 2,
  },
  {
    title: "Systematic review and meta-analysis of desiccation cracking in clay soils",
    abstract: "This systematic review and meta-analysis synthesized 47 studies with n=12500 participants. We found consistent evidence.",
    journal: "Nature",
    year: "2023",
    citations: 150,
  },
  {
    title: "Randomized controlled trial of soil amendments on crack formation",
    abstract: "In this randomized controlled trial with n=800 plots, we tested amendments.",
    journal: "Soil Biology",
    year: "2022",
    citations: 45,
  },
];

test("meta-analysis in Nature outranks single observational study", () => {
  const r = rankByEvidenceStrength(MOCK_PAPERS);
  assert.ok(r.summary, "should produce a summary");
  assert.equal(r.top3[0].paper.title, MOCK_PAPERS[1].title, "meta-analysis should rank first");
  assert.ok(r.top3[0].strength > r.top3[2].strength, "strength should differentiate");
});

test("ranking includes explanatory signals", () => {
  const r = rankByEvidenceStrength(MOCK_PAPERS);
  assert.ok(r.top3[0].signals.length > 0, "should explain the ranking");
  const signalText = r.top3[0].signals.join(" ");
  assert.ok(/meta-analysis|systematic/i.test(signalText), "should mention study design");
});

test("empty papers returns null summary", () => {
  const r = rankByEvidenceStrength([]);
  assert.equal(r.summary, null);
  assert.equal(r.top3.length, 0);
});

console.log("\nContradiction-first queries");

test("builds adjudication queries for conflicts", () => {
  const conflicts = [
    { topic: "soil crack spacing", idxA: 1, idxB: 2 },
  ];
  const qs = buildContradictionQueries(conflicts, ["soil", "crack", "spacing"]);
  assert.ok(qs.length >= 1, "should build at least 1 query");
  assert.ok(qs[0].query.includes("systematic review") || qs[0].query.includes("meta-analysis"),
    "first query should seek high-tier evidence, got: " + qs[0].query);
  assert.equal(qs[0].purpose, "adjudicate");
});

test("no conflicts returns empty", () => {
  assert.deepEqual(buildContradictionQueries([], ["soil"]), []);
  assert.deepEqual(buildContradictionQueries(null, ["soil"]), []);
});

test("no terms returns empty", () => {
  assert.deepEqual(buildContradictionQueries([{ topic: "x" }], []), []);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
