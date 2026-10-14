/**
 * Method intent (2026-10-14) — measurement questions must be
 * answered by the method papers.
 *
 * The production evidence (Dusty's live answer, 2026-10-13): the
 * question "How can the activity of manganese peroxidase be
 * measured?" returned an answer citing production and
 * optimization papers that report activity VALUES (best
 * production dose, immobilization stability, pH engineering).
 * The papers that actually answer it were in the gathered pool
 * but not cited or not used: "Improvements in the determination
 * of manganese peroxidase activity" sat in further reading
 * uncited, and "Criteria for Estimation of Laccase, Lignin
 * Peroxidase, and Manganese Peroxidase Activity in Crude Fungal
 * Broth Cultures" was cited while its content never entered the
 * answer. Dusty's verdict: "Completely wrong answer."
 *
 * What is pinned here, in mismatched language per the standing
 * rule (the questions are worded the way a person asks; the
 * papers are worded the way papers are written):
 *   (a) the manganese peroxidase question over a stubbed pool
 *       holding the two real method papers plus production
 *       papers: the method papers lead the cited shelf, and
 *       the extractive lede describes a measurement procedure;
 *   (b) a control factual question ("does X affect Y") whose
 *       detection, analysis, and extractive lede are untouched
 *       by the method machinery;
 *   (c) a measurement question with NO method paper in the
 *       pool: the limits line states no measurement method
 *       paper was found, instead of dressing value papers up
 *       as a method answer;
 *   (d) alternate measurement phrasings ("what is the assay
 *       for...", "how do researchers quantify...") land on the
 *       same recorded intent.
 *
 * Unit tests against the real exports (no server, no network).
 * Run with: node tests/method-intent.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const {
  detectMeasurementIntent,
  analyzeQuery,
  classifyQuestionType,
  paperMethodTier,
  orderShelfForMeasurement,
  buildExtractiveSynthesis,
  buildEvidenceGaps,
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

// ── The stubbed pool ───────────────────────────────────────────
// The two real method papers (their real titles) and production
// papers in the shapes the live answer wrongly cited. The
// production abstracts are dense with digits and value
// sentences — exactly what the old finding density ranking
// preferred — and contain no measurement procedure at all.
const METHOD_A = {
  title: "Improvements in the determination of manganese peroxidase activity",
  abstract:
    "Manganese peroxidase activity was determined spectrophotometrically by following the oxidation of Mn2+ to Mn3+ in sodium malonate buffer at 270 nm. " +
    "The reaction mixture contained 0.5 mM manganese sulfate in 50 mM malonate at pH 4.5 and was initiated by adding hydrogen peroxide to 0.1 mM, and the increase in absorbance was recorded over the first minute. " +
    "One unit of activity was defined as the amount of enzyme oxidizing one micromole of Mn2+ per minute under the stated conditions. " +
    "The revised procedure removes the interference from culture pigments that inflated earlier readings.",
  year: 2019,
};
const METHOD_B = {
  title: "Criteria for Estimation of Laccase, Lignin Peroxidase, and Manganese Peroxidase Activity in Crude Fungal Broth Cultures",
  abstract:
    "Reliable estimation of manganese peroxidase activity in crude broth requires correction for background absorbance from culture pigments. " +
    "Activity is estimated from the initial rate of Mn3+ malonate complex formation, measured at 270 nm against a reagent blank lacking hydrogen peroxide. " +
    "The criteria under which the three ligninolytic activities can be distinguished by their substrate preferences are compared, and conditions that keep the initial rate linear for at least 60 seconds are specified.",
  year: 2008,
};
const PROD_A = {
  title: "Enhanced production of manganese peroxidase by white rot fungi in submerged fermentation",
  abstract:
    "Manganese peroxidase production reached 1840 units per liter after nine days when the nitrogen source was optimized. " +
    "Activity peaked on day seven and declined thereafter, and the best production dose of manganese sulfate was 200 micromolar, which raised yields by 43 percent over the unsupplemented control. " +
    "Agitation at 150 rpm gave a further 18 percent improvement in peak activity compared with static cultures.",
  year: 2022,
};
const PROD_B = {
  title: "Immobilization of manganese peroxidase on mesoporous supports improves thermal stability and reusability",
  abstract:
    "The immobilized enzyme retained 87 percent of its initial activity after ten reuse cycles and showed a half life of 14 hours at 50 degrees. " +
    "Free enzyme lost half of its activity within 3 hours under the same conditions, so immobilization extended operational stability roughly fivefold. " +
    "Storage at 4 degrees preserved 92 percent of activity over 30 days.",
  year: 2021,
};
const PROD_C = {
  title: "Engineering the pH optimum of manganese peroxidase by directed evolution",
  abstract:
    "A variant carrying three substitutions kept 76 percent of its maximal activity at pH 3.0, where the wild type retained only 22 percent. " +
    "The engineered enzyme showed a 1.8 fold higher turnover number at acidic pH and unchanged stability at neutral pH. " +
    "Screening 2400 clones identified the variant in the second round of evolution.",
  year: 2023,
};
const PROD_D = {
  title: "Manganese peroxidase activity during solid state fermentation of wheat straw",
  abstract:
    "Activity rose steadily during colonization and reached 640 units per kilogram of straw on day twelve. " +
    "Wheat straw supported 2.3 fold higher peak activity than pine sawdust under identical moisture conditions. " +
    "Activity fell sharply after day fifteen as the substrate was exhausted.",
  year: 2020,
};

const MNP_QUESTION = "How can the activity of manganese peroxidase be measured?";

// ═══════════════════════════════════════════════════════════════
group("detection — the intent is deterministic and recorded");

await test("the manganese peroxidase question lands on the measurement intent", () => {
  assert.equal(detectMeasurementIntent(MNP_QUESTION), true);
  const a = analyzeQuery(MNP_QUESTION);
  assert.equal(a.intent, "measurement", "the analysis does not record the intent");
  assert.equal(a.questionType, "methods", "the question type is not methods");
  assert.ok(/measured/.test(a.plainEnglish), "the plain English statement does not name the measurement ask");
});

await test("(d) alternate measurement phrasings land on the same intent", () => {
  const phrasings = [
    "What is the assay for manganese peroxidase activity?",
    "How do researchers quantify manganese peroxidase activity?",
    "what method is used to determine manganese peroxidase activity",
    "How is manganese peroxidase activity assayed?",
  ];
  for (const q of phrasings) {
    assert.equal(detectMeasurementIntent(q), true, `no intent for: ${q}`);
    assert.equal(analyzeQuery(q).intent, "measurement", `analysis intent missing for: ${q}`);
    assert.equal(classifyQuestionType(q).type, "methods", `question type not methods for: ${q}`);
  }
});

await test("(b) control questions carry no measurement intent", () => {
  const controls = [
    "Does manganese peroxidase activity affect lignin degradation?",
    "How does manganese peroxidase break down lignin?",
    "What is manganese peroxidase?",
    "Do the germs in a baby belly change how well the baby grows",
  ];
  for (const q of controls) {
    assert.equal(detectMeasurementIntent(q), false, `false intent for: ${q}`);
    assert.equal(analyzeQuery(q).intent, null, `analysis records an intent for: ${q}`);
  }
  assert.equal(classifyQuestionType(controls[0]).type, "yesno");
  assert.equal(classifyQuestionType(controls[1]).type, "mechanism");
});

// ═══════════════════════════════════════════════════════════════
group("the method concept group — aboutness, tiered");

await test("paperMethodTier: title method papers are strong, value papers are none", () => {
  assert.equal(paperMethodTier(METHOD_A), 2);
  assert.equal(paperMethodTier(METHOD_B), 2);
  assert.equal(paperMethodTier(PROD_A), 0);
  assert.equal(paperMethodTier(PROD_B), 0);
  assert.equal(paperMethodTier(PROD_C), 0);
  assert.equal(paperMethodTier(PROD_D), 0);
  // Abstract level only: the headline is production, but the
  // abstract's own procedure statement describes measuring.
  const abstractLevel = {
    title: "Seasonal variation of manganese peroxidase in forest litter",
    abstract: "Samples were collected monthly across two seasons. Activity was measured spectrophotometrically in litter extracts and related to moisture content.",
    year: 2018,
  };
  assert.equal(paperMethodTier(abstractLevel), 1);
});

// ═══════════════════════════════════════════════════════════════
group("(a) the manganese peroxidase shelf and lede");

await test("the cited shelf leads with the method papers, pulling them in from the gated pool", () => {
  // The gate's cleared list in ranked order, method papers at
  // ranks 3 and 5; the cited slice (4) holds only one of them.
  const gated = [PROD_A, PROD_B, METHOD_B, PROD_C, METHOD_A, PROD_D];
  const shelf = gated.slice(0, 4);
  const ordered = orderShelfForMeasurement(shelf, gated);
  assert.equal(ordered.length, 4, "the shelf grew or shrank");
  assert.equal(ordered[0], METHOD_B, "citation [1] is not a method paper");
  assert.equal(ordered[1], METHOD_A, "citation [2] is not the pulled in method paper");
  assert.equal(ordered[2], PROD_A);
  assert.equal(ordered[3], PROD_B);
  // A shelf with no gated pool behind it still reorders.
  const reorderedOnly = orderShelfForMeasurement([PROD_A, METHOD_A, PROD_B], null);
  assert.deepEqual(reorderedOnly, [METHOD_A, PROD_A, PROD_B]);
});

await test("the extractive lede describes a measurement procedure from a method paper", () => {
  const gated = [PROD_A, PROD_B, METHOD_B, PROD_C, METHOD_A, PROD_D];
  const shelf = orderShelfForMeasurement(gated.slice(0, 4), gated);
  const md = buildExtractiveSynthesis(shelf, null, {
    query: MNP_QUESTION,
    queryAnalysis: analyzeQuery(MNP_QUESTION),
  });
  assert.ok(md, "no extractive answer was built");
  const summary = md.split("## What the research shows")[0];
  // The lede's citations are the method papers, in shelf order
  // [1] and [2], and the lede text is a procedure: what is
  // reacted, what is observed.
  assert.ok(summary.includes("[1]") && summary.includes("[2]"),
    `the lede does not cite both method papers:\n${summary}`);
  assert.ok(/270 nm|oxidation|absorbance|malonate/i.test(summary),
    `the lede does not describe the measurement procedure:\n${summary}`);
  assert.ok(!/1840|87 percent|2400 clones/.test(summary),
    `a production value sentence leads the answer:\n${summary}`);
});

await test("(b) without the intent, the same pool's lede is the value sentence it always was", () => {
  // The control shape: an everyday factual question over the
  // same pool, in the pool's own order. The method machinery
  // is inert — the density ranked value sentences lead, as
  // they did before the intent existed.
  const pool = [PROD_A, PROD_B, METHOD_B, PROD_C, METHOD_A, PROD_D];
  const controlQuery = "What production levels of manganese peroxidase did the studies report?";
  assert.equal(detectMeasurementIntent(controlQuery), false);
  const md = buildExtractiveSynthesis(pool, null, {
    query: controlQuery,
    queryAnalysis: analyzeQuery(controlQuery),
  });
  assert.ok(md, "no extractive answer was built for the control");
  const summary = md.split("## What the research shows")[0];
  // The lede LEADS with the pool's own top ranked paper and its
  // value sentence (citation [1], the production paper, digits
  // and all) . no method paper is promoted ahead of it. (A
  // method paper's sentence may still appear later in the lede
  // on plain finding density, exactly as it could before the
  // intent existed; what the machinery changes is the LEAD.)
  assert.ok(/1840 units per liter[^[]*\[1\]/.test(summary),
    `the control lede does not lead with the production value sentence:\n${summary}`);
});

// ═══════════════════════════════════════════════════════════════
group("(c) no method paper in the pool — the limits say so");

await test("buildEvidenceGaps names the missing method paper, only for the intent", () => {
  const valueOnly = [PROD_A, PROD_B, PROD_C];
  const gaps = buildEvidenceGaps({
    papers: valueOnly, sourcesQueried: null, relevanceGatedOut: 0, intent: "measurement",
  });
  assert.ok(gaps.some((g) => /No measurement method paper was found/.test(g)),
    `the limits do not name the missing method paper: ${JSON.stringify(gaps)}`);
  // With a method paper in the pool the line is gone.
  const withMethod = buildEvidenceGaps({
    papers: [PROD_A, METHOD_A], sourcesQueried: null, relevanceGatedOut: 0, intent: "measurement",
  });
  assert.ok(!withMethod.some((g) => /No measurement method paper/.test(g)),
    "the missing method line fired with a method paper present");
  // And without the intent it never fires.
  const noIntent = buildEvidenceGaps({
    papers: valueOnly, sourcesQueried: null, relevanceGatedOut: 0, intent: null,
  });
  assert.ok(!noIntent.some((g) => /No measurement method paper/.test(g)),
    "the missing method line fired without the intent");
});

await test("the extractive answer's limits name the missing method paper", () => {
  const valueOnly = [PROD_A, PROD_B, PROD_C, PROD_D];
  const md = buildExtractiveSynthesis(valueOnly, null, {
    query: MNP_QUESTION,
    queryAnalysis: analyzeQuery(MNP_QUESTION),
  });
  assert.ok(md, "no extractive answer was built");
  assert.ok(/No measurement method paper was found/.test(md),
    `the answer package dresses value papers as a method answer:\n${md.slice(0, 1200)}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
