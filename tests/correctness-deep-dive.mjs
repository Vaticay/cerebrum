/**
 * Correctness deep dive — end-to-end verification (2026-10-08).
 *
 * From Dusty's production photos of a BSFL gut microbiome answer:
 *   1. First-person plagiarism: "Our findings on genetic diversity revealed..."
 *   2. Undefined abbreviation: "Increased SD concentration..." (SD never defined)
 *   3. Naked "disputed" label with no explanation
 *   4. Truncated heading: "Microbiome · Gut · Black"
 *   5. Fake precision: "Strong confidence (99/100): 8 sources point the same way"
 *   6. Contradictory signals: "No clear signal" + "1 conflicting claim pair" + "supports 8, contests 0"
 *   7. Truncated evidence map claim cut mid-sentence
 *   8. Paywalled free-tier copy: "sign in for AI-synthesized answers"
 *
 * Each test below feeds mock data through the real pipeline functions and
 * asserts the defect class is closed. If any of these fail, the defect is back.
 *
 * Run with: node tests/correctness-deep-dive.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];
const pending = [];

function test(name, fn) {
  pending.push((async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failures.push({ name, error: e });
      console.log(`  ✗ ${name}\n      ${e.message.split("\n")[0]}`);
    }
  })());
}

function group(name) {
  console.log(`\n${name}`);
}

// ── Mock data: mirrors Dusty's BSFL photo ─────────────────────────────
const BSFL_PAPERS = Array.from({ length: 8 }, (_, i) => ({
  title: `BSFL gut microbiome paper ${i + 1}`,
  year: 2020 + (i % 4),
  type: "journal",
  relevance: 75,
  semanticScore: 65,
  abstract: "Amplicon 16S rRNA sequencing of the black soldier fly larvae gut metagenome reveals high variability.",
}));

const BSFL_CONFLICTS = [
  { idxA: 6, idxB: 2, claimA: "SD concentration reduces diversity", claimB: "SD concentration increases diversity", sourceA: "Paper 6", sourceB: "Paper 2" },
];

const { buildConfidenceLine, buildExtractiveSynthesis } = await import("../functions/api/search.js");
const { classifyVennPapers } = await import("../src/answerInsights.js");

// ── Defect 1: First-person plagiarism ─────────────────────────────────
group("Defect 1 — first-person research claims");

test("prompt bans first-person research claims with a hard rule", async () => {
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  assert.match(src, /RULE 8: NEVER CLAIM THE RESEARCH AS YOUR OWN/, "Rule 8 missing");
  for (const phrase of ["our findings", "we found", "our results", "in our study", "we observed"]) {
    assert.ok(src.includes(`'${phrase}'`), `banned phrase '${phrase}' not listed in Rule 8`);
  }
});

test("prompt instructs attribution to the papers, not the self", async () => {
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  assert.match(src, /the authors found.*the study reports.*their data show/s, "attribution guidance missing");
});

test("quality gate heavily penalizes first-person research claims", async () => {
  const { scoreAnswerQuality } = await import("../functions/api/search.js");
  const bad = "## The short answer\n\nOur findings on genetic diversity revealed slight variation [1][2]. We found that SD concentration matters.";
  const good = "## The short answer\n\nThe authors' findings on genetic diversity revealed slight variation [1][2]. The study reports that standard deviation (SD) concentration matters.";
  const badScore = scoreAnswerQuality(bad, "test");
  const goodScore = scoreAnswerQuality(good, "test");
  assert.ok(badScore < goodScore - 20, `first-person not penalized: bad=${badScore} good=${goodScore}`);
  assert.ok(badScore < 35, `first-person answer should trigger regeneration threshold: ${badScore}`);
});

test("quality gate penalizes undefined abbreviations", async () => {
  const { scoreAnswerQuality } = await import("../functions/api/search.js");
  const bad = "## The short answer\n\nIncreased SD concentration in the diet led to reduced diversity [1]. The BSFL gut was sampled.";
  const good = "## The short answer\n\nIncreased standard deviation (SD) concentration in the diet led to reduced diversity [1]. The black soldier fly larvae (BSFL) gut was sampled.";
  const badScore = scoreAnswerQuality(bad, "test");
  const goodScore = scoreAnswerQuality(good, "test");
  assert.ok(badScore < goodScore, `undefined abbreviations not penalized: bad=${badScore} good=${goodScore}`);
});

// ── Defect 2: Undefined abbreviations ────────────────────────────────
group("Defect 2 — undefined abbreviations");

test("prompt requires abbreviation expansion on first use", async () => {
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  assert.match(src, /RULE 9: ABBREVIATIONS EXPANDED ON FIRST USE/, "Rule 9 missing");
  assert.match(src, /standard deviation \(SD\)/, "expansion example missing");
  assert.match(src, /NEVER use a bare abbreviation/, "bare-abbreviation ban missing");
});

// ── Defect 3: Naked "disputed" label ─────────────────────────────────
group("Defect 3 — naked disputed label");

test("buildEvidenceMap never emits a naked disputed label", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // The old code: label: contested ? "disputed" : null
  assert.doesNotMatch(src, /label: contested \? "disputed"/, "naked disputed label still emitted");
  // The disagreement verdict still renders with its summary elsewhere
  assert.match(src, /Disagreement — \{t\.disagreementVerdict\.status\}/, "verdict summary display missing");
});

// ── Defect 4: Truncated headings ──────────────────────────────────────
group("Defect 4 — truncated headings");

test("prompt requires complete heading phrases", async () => {
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  assert.match(src, /RULE 10: HEADINGS ARE COMPLETE PHRASES/, "Rule 10 missing");
  assert.match(src, /Microbiome · Gut · Black.*FAILED heading/s, "truncation example missing");
});

// ── Defect 5: Fake precision confidence ──────────────────────────────
group("Defect 5 — fake 99/100 precision");

test("confidence line has no pseudo-precise score at any level", () => {
  const strong = buildConfidenceLine(BSFL_PAPERS, { status: "settled" });
  const moderate = buildConfidenceLine(BSFL_PAPERS.slice(0, 4), { status: "divided", conflictCount: 1 });
  const thin = buildConfidenceLine(BSFL_PAPERS.slice(0, 1), { status: "thin" });
  for (const [name, conf] of [["strong", strong], ["moderate", moderate], ["thin", thin]]) {
    assert.doesNotMatch(conf.line, /\/100/, `${name} line shows /100: ${conf.line}`);
    assert.doesNotMatch(conf.line, /\(\d+\/\d+\)/, `${name} line shows parenthesized score`);
  }
});

test("confidence line states the real basis", () => {
  const conf = buildConfidenceLine(BSFL_PAPERS, { status: "settled" });
  assert.match(conf.line, /8 sources/, "source count missing from line");
  assert.match(conf.line, /Strong confidence/, "level missing from line");
  // The numeric score stays available internally for calibration
  assert.ok(typeof conf.score === "number", "internal score missing");
});

// ── Defect 6: Contradictory verdict signals ──────────────────────────
group("Defect 6 — contradictory verdict signals");

test("conflicted papers are visible in the Venn, not hidden in agree", () => {
  const venn = classifyVennPapers({
    answer: "Diversity drops with dose [6][2].",
    sources: BSFL_PAPERS.map((p) => ({ title: p.title })),
    factCheck: { claims: [] },
    conflicts: BSFL_CONFLICTS,
  });
  assert.ok(venn.middle.includes(6) && venn.middle.includes(2), "conflicted papers not in middle");
  assert.ok(!venn.agree.includes(6) && !venn.agree.includes(2), "conflicted papers still in agree");
});

test("every paper lands in exactly one Venn region", () => {
  const venn = classifyVennPapers({
    answer: "Diversity drops with dose [1][2][3].",
    sources: BSFL_PAPERS.map((p) => ({ title: p.title })),
    factCheck: { claims: [] },
    conflicts: BSFL_CONFLICTS,
  });
  const all = [...venn.agree, ...venn.disagree, ...venn.middle, ...venn.unclear];
  assert.equal(all.length, 8, "not all papers placed");
  assert.equal(new Set(all).size, 8, "a paper is in two regions");
});

// ── Defect 7: Truncated evidence map claims ──────────────────────────
group("Defect 7 — truncated evidence map claims");

test("EvidenceMap truncates at word boundaries and expands", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // Old code: r.text.slice(0, 180).trimEnd() — cuts mid-word
  assert.doesNotMatch(src, /r\.text\.slice\(0, 180\)\.trimEnd\(\)/, "mid-word slice still present");
  assert.match(src, /truncateWords/, "word-boundary truncation missing");
  assert.match(src, /lastIndexOf\(" "\)/, "word-boundary logic missing");
  assert.match(src, /show less.*more|more.*show less/s, "expand/collapse missing");
});

// ── Defect 8: Paywalled free-tier copy ────────────────────────────────
group("Defect 8 — paywalled free-tier copy");

test("no paywall tease on correctness in any fallback", () => {
  for (const reason of ["signin-required", "free-cap", "lite-cap"]) {
    const md = buildExtractiveSynthesis(
      [{ title: "T", abstract: "Abstract with enough words to pass the gate for testing purposes here." }],
      [],
      { query: "test", aiGateReason: reason }
    );
    assert.doesNotMatch(md, /sign in for AI-synthesized answers/i, `paywall tease for ${reason}`);
    assert.doesNotMatch(md, /Assembled without AI/i, `shaming copy for ${reason}`);
  }
});

test("fallback copy is honest about what the summary is", () => {
  const md = buildExtractiveSynthesis(
    [{ title: "T", abstract: "Abstract with enough words to pass the gate for testing purposes here." }],
    [],
    { query: "test", aiGateReason: "signin-required" }
  );
  assert.match(md, /assembled from the sources below/i, "honest description missing");
});

// ══════════════════════════════════════════════════════════════════════════
await Promise.all(pending);
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
