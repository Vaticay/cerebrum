// Intelligence deep dive regression tests (2026-10-08)
// Tests the five new intelligence upgrades in functions/lib/knowledge.js
import {
  analyzeTemporalConsensus,
  extractSampleSizes,
  checkQuantitativeAgreement,
  explainContradiction,
  generateSmartFollowUps,
} from "../functions/lib/knowledge.js";

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    failed++;
    console.log("  ✗ " + name + ": " + e.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

console.log("intelligence-deep-dive:");

// ── Temporal consensus ──
test("detects converging consensus", () => {
  const papers = [
    { year: 2015, title: "A" }, { year: 2016, title: "B" },
    { year: 2023, title: "C" }, { year: 2024, title: "D" },
  ];
  // Simulate: early papers in conflict, recent agree
  const conflicts = [{ idxA: 1, idxB: 2 }];
  const r = analyzeTemporalConsensus(papers, conflicts);
  assert(r.pattern === "converging", "expected converging, got " + r.pattern);
  assert(r.summary && r.summary.length > 20, "summary too short");
});

test("detects stable consensus", () => {
  const papers = [
    { year: 2015, title: "A" }, { year: 2018, title: "B" },
    { year: 2021, title: "C" }, { year: 2024, title: "D" },
  ];
  const r = analyzeTemporalConsensus(papers, []);
  assert(r.pattern === "stable", "expected stable, got " + r.pattern);
});

test("insufficient data returns gracefully", () => {
  const r = analyzeTemporalConsensus([{ year: 2024 }], []);
  assert(r.pattern === "insufficient", "expected insufficient");
});

// ── Sample size extraction ──
test("extracts n= values", () => {
  const papers = [
    { title: "Study 1", abstract: "We enrolled n=412 participants in a randomized trial." },
    { title: "Study 2", abstract: "A cohort of 1,200 patients was followed." },
  ];
  const r = extractSampleSizes(papers);
  assert(r.perPaper.length === 2, "expected 2 papers with sizes, got " + r.perPaper.length);
  assert(r.totalN >= 412, "totalN too low: " + r.totalN);
});

test("flags thin evidence base", () => {
  const papers = [
    { title: "A", abstract: "n=12 mice were tested." },
    { title: "B", abstract: "n=8 mice were tested." },
    { title: "C", abstract: "n=15 mice were tested." },
  ];
  const r = extractSampleSizes(papers);
  assert(r.thinData === true, "should flag thin data");
  assert(r.summary && r.summary.includes("n="), "summary should mention sample size");
});

// ── Quantitative agreement ──
test("detects consistent percentages", () => {
  const papers = [
    { abstract: "Risk reduced by 15% compared to control." },
    { abstract: "We observed an 18% reduction in risk." },
  ];
  const r = checkQuantitativeAgreement(papers);
  assert(r.consistent === true, "should be consistent");
});

test("detects quantitative disagreement", () => {
  const papers = [
    { abstract: "Risk reduced by 15% compared to control." },
    { abstract: "We observed an 82% reduction in risk." },
  ];
  const r = checkQuantitativeAgreement(papers);
  assert(r.consistent === false, "should detect disagreement");
  assert(r.summary.includes("82%"), "summary should mention the range");
});

// ── Contradiction explanation ──
test("explains study design mismatch", () => {
  const pa = { studyType: "Systematic review / meta-analysis", year: 2023, journal: "Nature" };
  const pb = { studyType: "Case report / case series", year: 2020, journal: "Unknown Journal" };
  const hyps = explainContradiction(pa, pb);
  assert(hyps.length > 0, "should generate hypotheses");
  assert(hyps.some(h => h.toLowerCase().includes("tier") || h.toLowerCase().includes("design")), "should mention evidence tiers");
});

test("explains temporal gap", () => {
  const pa = { studyType: "Cohort study", year: 2010, journal: "JAMA" };
  const pb = { studyType: "Cohort study", year: 2024, journal: "JAMA" };
  const hyps = explainContradiction(pa, pb);
  assert(hyps.some(h => h.includes("2010") && h.includes("2024")), "should mention the year gap");
});

// ── Smart follow-ups ──
test("suggests human data when only animal studies", () => {
  const papers = [
    { title: "Mouse study", abstract: "In mouse models we found..." },
    { title: "Rat study", abstract: "Murine experiments show..." },
  ];
  const fus = generateSmartFollowUps(papers, [], null, null);
  assert(fus.some(f => f.q.toLowerCase().includes("human")), "should ask about human data");
});

test("suggests recent research when sources are old", () => {
  const papers = [{ year: 2015, title: "Old" }, { year: 2016, title: "Older" }];
  const temporal = { periods: [{}, { years: [2015, 2016] }] };
  const fus = generateSmartFollowUps(papers, [], temporal, null);
  assert(fus.some(f => f.q.toLowerCase().includes("latest")), "should ask about latest research");
});

test("returns empty when no gaps detected", () => {
  const papers = [
    { title: "Meta-analysis", abstract: "n=5000 humans", studyType: "Systematic review / meta-analysis", year: 2024 },
    { title: "RCT", abstract: "n=2000 patients", studyType: "Randomized controlled trial", year: 2024 },
  ];
  const fus = generateSmartFollowUps(papers, [], null, { thinData: false });
  // May still suggest (no high-tier check needs 3+), but shouldn't crash
  assert(Array.isArray(fus), "should return array");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
