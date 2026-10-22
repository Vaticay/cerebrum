/**
 * Confidence bands, compounding caps, and calibration flag
 * wiring (2026-10-22, full process repair, logic audit Lane 6).
 *
 * Pins three proven errors in the confidence stage:
 *
 *   L6-3. The shipped banding made strong start at score 60
 *   while the code's own header documented strong at 75 and up,
 *   moderate 50 to 74, thin under 50. Oct 21 after/04 recomputed
 *   to 63 and after/11 to 69 under the shipped builder; both
 *   shipped Strong from inside the documented moderate band.
 *   The fix is one band table, CONFIDENCE_BANDS, consumed by
 *   the builder and by calibration through the shared
 *   confidenceLevelForScore, so the thresholds cannot drift
 *   apart again.
 *
 *   L6-10. Honesty caps took the minimum only, so independent
 *   defects never compounded. Oct 21 after/13 shipped Moderate
 *   with three cap reasons in its own line (extractive,
 *   degraded, unchecked; each a 59 cap alone). Each independent
 *   cap beyond the first now drops the ceiling one band.
 *
 *   L6-11. calibrateConfidenceScore subtracts up to 20 points
 *   for integrity flags, but both live call sites passed a
 *   literal integrityFlags: 0, one beside a comment promising a
 *   next pass that never existed. Both sites now pass
 *   integrityFlagCount of the fact check object they hold.
 *
 * Item 4 of the same batch, the honey wound answers, is pinned
 * at the bottom: the saved Oct 21 records show the thin labels
 * came from the unchecked and provenance caps working as
 * designed on answers whose fact check genuinely never ran,
 * while the evidence side of the builder credits the honey sets
 * fully (systematic review class, strong band scores). No
 * confidence change was made for honey; the test keeps the
 * diagnosis honest.
 *
 * Run with: node tests/confidence-bands.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
const search = await import(join(root, "functions/api/search.js"));

const {
  CONFIDENCE_BANDS,
  confidenceLevelForScore,
  confidenceCapOneBandLower,
  buildConfidenceLine,
  calibrateConfidenceScore,
  integrityFlagCount,
  bestEvidenceClass,
} = search;

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
function group(name) { console.log(`\n${name}`); }

const THIS_YEAR = new Date().getFullYear();
function strongPapers(n) {
  return Array.from({ length: n }, (_, i) => ({
    title: "Controlled study of a measured effect " + (i + 1),
    abstract: "A full abstract with enough wording to count as accessible support for the claims the answer makes, with methods and results reported in detail.",
    relevance: 85,
    year: THIS_YEAR,
    type: "Journal",
  }));
}

// ═══════════════════════════════════════════════════════════
group("L6-3 — one band table, documented edges");

await test("the table states the documented bands once", () => {
  assert.deepEqual(CONFIDENCE_BANDS, [
    { level: "strong", min: 75 },
    { level: "moderate", min: 50 },
    { level: "thin", min: 0 },
  ]);
  assert.equal((src.match(/CONFIDENCE_BANDS = \[/g) || []).length, 1,
    "the band table is defined more than once");
  assert.ok(!/score < 60/.test(src),
    "a leftover copy of the old 60 point strong threshold is still in the file");
});

await test("band edges: 49 thin, 50 and 74 moderate, 75 strong", () => {
  assert.equal(confidenceLevelForScore(0), "thin");
  assert.equal(confidenceLevelForScore(49), "thin");
  assert.equal(confidenceLevelForScore(50), "moderate");
  assert.equal(confidenceLevelForScore(74), "moderate");
  assert.equal(confidenceLevelForScore(75), "strong");
  assert.equal(confidenceLevelForScore(100), "strong");
});

await test("the shipped bug points 60, 63, and 69 are moderate, not strong", () => {
  // 63 and 69 are the recomputed scores of Oct 21 after/04 and
  // after/11, which shipped Strong under the old banding.
  assert.equal(confidenceLevelForScore(60), "moderate");
  assert.equal(confidenceLevelForScore(63), "moderate");
  assert.equal(confidenceLevelForScore(69), "moderate");
  assert.equal(confidenceLevelForScore(59), "moderate",
    "59 sits inside the documented moderate band, 50 to 74");
});

await test("caps and verdict status bind through the same function", () => {
  assert.equal(confidenceLevelForScore(90, 59), "moderate");
  assert.equal(confidenceLevelForScore(90, 45), "thin");
  assert.equal(confidenceLevelForScore(90, null, "divided"), "moderate");
  assert.equal(confidenceLevelForScore(90, null, "thin"), "moderate");
  assert.equal(confidenceLevelForScore(90, null, "settled"), "strong");
});

await test("builder and calibration derive the same level for every score", () => {
  const parts = { n: 6, status: null, sides: null, conflictCount: 0, avgRelevance: 80, capReasons: [], supClause: "" };
  for (let s = 0; s <= 100; s++) {
    const conf = {
      level: confidenceLevelForScore(s), score: s,
      line: "placeholder", lineParts: parts,
      verdictStatus: null, cap: null, capReasons: [], factors: [],
    };
    const cal = calibrateConfidenceScore(conf, {});
    assert.equal(cal.level, confidenceLevelForScore(s),
      "calibration banding disagrees with the table at score " + s);
  }
});

await test("one band drop moves a ceiling exactly one band", () => {
  assert.equal(confidenceCapOneBandLower(100), 74);
  assert.equal(confidenceCapOneBandLower(70), 49);
  assert.equal(confidenceCapOneBandLower(59), 49);
  assert.equal(confidenceCapOneBandLower(45), 45, "a thin band cap cannot drop further");
});

// ═══════════════════════════════════════════════════════════
group("L6-10 — independent honesty caps compound");

await test("a single 59 cap keeps its established moderate band", () => {
  const conf = buildConfidenceLine(strongPapers(6), { status: "settled" }, {
    extractive: true, factCheckChecked: true,
  });
  assert.equal(conf.level, "moderate");
  assert.ok(conf.score <= 59, "single cap did not bind: " + conf.score);
  assert.deepEqual(conf.capReasons, ["the answer was assembled from source excerpts"]);
});

await test("two stacked 59 caps force the thin band", () => {
  const conf = buildConfidenceLine(strongPapers(6), { status: "settled" }, {
    extractive: true, degraded: true, factCheckChecked: true,
  });
  assert.equal(conf.level, "thin", "two independent caps shipped above thin: " + conf.line);
  assert.ok(conf.score <= 49, "compounded ceiling did not bind the score: " + conf.score);
  assert.ok(conf.line.startsWith("Low confidence"), "line disagrees with level: " + conf.line);
});

await test("the after/13 shape: extractive, degraded, and unchecked reads thin with all three reasons named", () => {
  const conf = buildConfidenceLine(strongPapers(6), { status: "settled" }, {
    extractive: true, degraded: true, factCheckChecked: false,
  });
  assert.equal(conf.capReasons.length, 3, "expected three cap reasons: " + conf.capReasons.join(" | "));
  assert.equal(conf.level, "thin",
    "the three defect shape that shipped Moderate on Oct 21 still ships above thin");
  assert.ok(conf.line.startsWith("Low confidence"), "line disagrees with level: " + conf.line);
  for (const fragment of ["assembled from source excerpts", "pipeline degraded", "did not check any claims"]) {
    assert.ok(conf.line.includes(fragment), "line lost a cap reason: " + fragment);
  }
  // The compounded cap survives calibration, the last word
  // before shipping.
  const shipped = calibrateConfidenceScore(conf, {});
  assert.equal(shipped.level, "thin", "calibration lifted the compounded cap");
  assert.ok(shipped.line.startsWith("Low confidence"));
});

await test("stacking on a thin grade cap stays thin and never errors", () => {
  const conf = buildConfidenceLine(strongPapers(6), { status: "settled" }, {
    tier: "limited", factCheckChecked: false, aiAnswer: true,
  });
  assert.equal(conf.level, "thin");
  assert.ok(conf.score <= 45, "thin grade caps compounded below their floor: " + conf.score);
});

// ═══════════════════════════════════════════════════════════
group("L6-11 — the calibration integrity penalty is wired");

await test("integrityFlagCount reads the finished fact check object", () => {
  assert.equal(integrityFlagCount(null), 0);
  assert.equal(integrityFlagCount({}), 0);
  assert.equal(integrityFlagCount({ claims: [] }), 0);
  // The Oct 21 after/09 shape: a flags only panel with one
  // stripped claim.
  assert.equal(integrityFlagCount({ claims: [
    { claim: "x", status: "unsupported", kind: "stripped" },
  ] }), 1);
  assert.equal(integrityFlagCount({ claims: [
    { claim: "a", status: "unsupported", kind: "alignment" },
    { claim: "b", status: "unsupported", kind: "demoted" },
    { claim: "c", status: "unsupported" },
    { claim: "d", status: "supported", kind: "stripped" },
    { claim: "e", status: "thin", kind: "alignment" },
  ] }), 2, "only unsupported claims carrying a flag kind count");
});

await test("no call site passes a literal zero flag count anymore", () => {
  assert.ok(!/integrityFlags: 0/.test(src),
    "a calibration call site still passes integrityFlags: 0");
  assert.ok(/integrityFlags: integrityFlagCount\(factCheckResult\)/.test(src),
    "the main assembly does not wire the finished fact check object into calibration");
  assert.ok(/integrityFlags: integrityFlagCount\(input && input\.factCheck\)/.test(src),
    "the cached serve does not wire its stored fact check into calibration");
  assert.ok(!/applied on next pass/.test(src),
    "the dead next pass comment is still standing");
});

await test("a flagged answer's level actually drops through calibration", () => {
  const parts = { n: 9, status: null, sides: null, conflictCount: 0, avgRelevance: 88, capReasons: [], supClause: "" };
  const base = {
    level: "strong", score: 80,
    line: "placeholder", lineParts: parts,
    verdictStatus: null, cap: null, capReasons: [], factors: [],
  };
  const clean = calibrateConfidenceScore(base, { integrityFlags: 0 });
  assert.equal(clean.level, "strong", "an unflagged answer lost its band: " + clean.score);
  const flaggedFactCheck = { claims: [
    { claim: "a", status: "unsupported", kind: "alignment" },
    { claim: "b", status: "unsupported", kind: "stripped" },
  ] };
  const flagged = calibrateConfidenceScore(base, {
    integrityFlags: integrityFlagCount(flaggedFactCheck),
  });
  assert.equal(flagged.score, 70, "two flags should cost ten points: " + flagged.score);
  assert.equal(flagged.level, "moderate",
    "a flagged answer kept the strong band: " + flagged.level + " / " + flagged.score);
  assert.ok(flagged.line.startsWith("Moderate confidence"),
    "the shipped line did not follow the dropped level: " + flagged.line);
  // One flag is enough at the strong boundary itself.
  const edge = calibrateConfidenceScore({ ...base, score: 75 }, { integrityFlags: 1 });
  assert.equal(edge.level, "moderate", "one flag at score 75 did not drop the level");
});

// ═══════════════════════════════════════════════════════════
group("Item 4 — honey: the confidence stage credits the evidence; the thin labels trace to caps on unchecked answers");

const HONEY_PAPERS = [
  { title: "Honey dressing for diabetic foot ulcers: a systematic review and meta-analysis of randomized controlled trials", relevance: 89 },
  { title: "Clinical and Postoperative Applications of Manuka Honey in Wound Healing: An Evidence-Based Review", relevance: 76 },
  { title: "Topical Application of Manuka Honey for the Treatment of Non-Healing Venous Leg Ulcers", relevance: 70 },
  { title: "Manuka honey as a natural remedy for diabetic foot ulcers: efficacy compared with silver-based dressing", relevance: 82 },
  { title: "Egyptian fennel honey as a potential sustainable and economical alternative to manuka honey: a multi-parameter comparative study", relevance: 68 },
  { title: "Botanical Origin-Dependent Phytochemical Profiles and Pharmaceutical Properties of Medical-Grade Honeys", relevance: 67 },
].map((p) => ({
  ...p,
  abstract: "A study of honey applied to wounds, measuring healing time and infection outcomes across treatment and comparison groups with follow up reported.",
  year: THIS_YEAR,
  type: "Journal",
}));

await test("the after/08 honey set earns top evidence class and a strong band score when a check has run", () => {
  assert.equal(bestEvidenceClass(HONEY_PAPERS).rank, 4,
    "the systematic review in the honey set was not read as top class");
  const conf = buildConfidenceLine(HONEY_PAPERS, { status: "settled" }, {
    factCheckChecked: true, support: { supported: 3, checked: 3 },
  });
  assert.equal(conf.level, "strong",
    "the honey evidence was understated by the builder: " + conf.score + " / " + conf.line);
});

await test("the shipped honey thin label is the unchecked cap on an answer whose check never ran, exactly as recorded", () => {
  // Oct 21 after/08 and after/16 carry factCheck: null and ship
  // the cap reason "the claim check did not run on this
  // answer". That cap is the designed honesty rule for an
  // unchecked AI answer; the confidence stage is not the defect.
  const conf = buildConfidenceLine(HONEY_PAPERS, { status: "settled" }, {
    factCheckChecked: false, aiAnswer: true,
  });
  assert.equal(conf.level, "thin");
  assert.deepEqual(conf.capReasons, ["the claim check did not run on this answer"]);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
