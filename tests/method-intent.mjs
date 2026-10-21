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
 * Second pass (2026-10-14): the first fixture's method abstracts
 * used the textbook register (determined, spectrophotometrically,
 * absorbance), which the builder's procedure vocabulary already
 * named — so the lede test passed while the LIVE answer, whose
 * method papers phrase the procedure in the plain readout
 * register (read, followed, recorded, wavelength, cuvette,
 * blank), still led with value sentences: claim selection
 * inside a paper ranked by finding density alone, so a method
 * paper's own digit dense value sentence filled its findings
 * slots and the tier first lede order had nothing procedure
 * shaped to promote. Scenario (a) now carries that harder
 * shape: procedure sentences in the readout register only, a
 * tempting recovery value sentence inside one method paper,
 * and the tier 1 indicator paper from the live specimen in
 * the pool. The pinned behavior: the builder partitions a
 * method paper's findings procedure first (procedure scores
 * floored at zero), and the shipped lede and findings are the
 * procedure.
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
// The method abstracts are written in the plain readout
// register on purpose (second pass): the procedure is what was
// read, followed, or recorded, at a wavelength, in a cuvette,
// against a blank — none of the textbook verbs (determined,
// spectrophotometrically, absorbance) the first vocabulary
// named. METHOD_A also carries the temptation the live answer
// fell for: a digit dense recovery sentence (98 percent, two
// finding hint words) that outscores every procedure sentence
// on raw finding density.
const METHOD_A = {
  title: "Improvements in the determination of manganese peroxidase activity",
  abstract:
    "Manganese peroxidase activity was read from the rise of the Mn3+ malonate complex at 270 nm, followed in a quartz cuvette against a water blank. " +
    "The sample sat in 50 mM malonate buffer at pH 4.5, and 10 millilitres were drawn into the cuvette once the trace settled at the working wavelength. " +
    "The first reading was taken 30 seconds after the peroxide went in, and the slope of the trace over the next minute gave the initial rate. " +
    "Recoveries of manganese peroxidase activity came back higher with the new broth, with 98 percent of the added enzyme found again after one hour.",
  year: 2019,
};
const METHOD_B = {
  title: "Criteria for Estimation of Laccase, Lignin Peroxidase, and Manganese Peroxidase Activity in Crude Fungal Broth Cultures",
  abstract:
    "Crude broth carries pigments that lift the reading at 270 nm, so every sample was read against a blank of the same broth with the enzyme heat killed. " +
    "Manganese peroxidase activity was followed at a wavelength of 270 nm in a 1 cm quartz cuvette, and the extinction was recorded every 30 seconds for three minutes. " +
    "The three activities are told apart by what each one acts on first, and the trace stays straight for at least 60 seconds under the stated conditions.",
  year: 2008,
};
// The live specimen's source 3: a soil paper whose abstract
// mentions the activity "measured as an indicator" — tier 1,
// in the pool, never the lede of a measurement answer while
// method papers exist.
const INDICATOR = {
  title: "Soil microbial activity after rewetting of dry grassland soils",
  abstract:
    "Microbial activity was measured as an indicator of recovery in grassland soils brought back from drought. " +
    "Respiration climbed 2.1 fold over the dry control within the first day of rewetting, then settled back toward baseline within a week.",
  year: 2017,
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

await test("(d2) the Oct 20 audit's plain phrasings land on the same intent (2026-10-21, Lane A)", () => {
  // Both audit phrasings returned intent null live: neither
  // carries a listed measurement verb. One names the assay
  // "test" and the quantity "active"; the other pairs "check"
  // with "working" and never names the enzyme at all.
  const phrasings = [
    "what test tells you how active manganese peroxidase is in a sample",
    "how do lab people actually check if the fungi enzyme that breaks down wood is working",
  ];
  for (const q of phrasings) {
    assert.equal(detectMeasurementIntent(q), true, `no intent for: ${q}`);
    assert.equal(analyzeQuery(q).intent, "measurement", `analysis intent missing for: ${q}`);
  }
  // Controls the new patterns must not swallow: a bare how does
  // it work mechanism ask and a how question with no check verb
  // and no working or active outcome word.
  for (const q of ["how does a steam engine work", "how do bees make honey"]) {
    assert.equal(detectMeasurementIntent(q), false, `false intent for: ${q}`);
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
  // The indicator paper: no method title, but its abstract
  // states the activity was measured (as an indicator) — tier 1.
  assert.equal(paperMethodTier(INDICATOR), 1);
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
  // Second pass shape: the ranked pool holds the method papers
  // at ranks 3 and 5, the tier 1 indicator paper at rank 2,
  // and production papers around them; the cited slice is 6,
  // so the indicator and production papers sit in the
  // builder's pool alongside the method papers.
  const gated = [PROD_A, INDICATOR, METHOD_B, PROD_C, METHOD_A, PROD_D];
  const shelf = orderShelfForMeasurement(gated.slice(0, 6), gated);
  assert.equal(shelf[0], METHOD_B, "citation [1] is not a method paper");
  assert.equal(shelf[1], METHOD_A, "citation [2] is not a method paper");
  const md = buildExtractiveSynthesis(shelf, null, {
    query: MNP_QUESTION,
    queryAnalysis: analyzeQuery(MNP_QUESTION),
  });
  assert.ok(md, "no extractive answer was built");
  const summary = md.split("## What the research shows")[0];
  // The lede's citations are the method papers [1] and [2],
  // and the lede text is the procedure in the readout
  // register: what was read or followed, at what wavelength,
  // in a cuvette, against a blank.
  assert.ok(summary.includes("[1]") && summary.includes("[2]"),
    `the lede does not cite both method papers:\n${summary}`);
  assert.ok(/270 nm/.test(summary) && /malonate/i.test(summary),
    `the lede does not describe the measurement procedure:\n${summary}`);
  assert.ok(/cuvette|blank/i.test(summary) && /\b(read|followed|recorded)\b/i.test(summary),
    `the lede is not in the procedure register:\n${summary}`);
  // No value sentence leads: not the production values, and
  // not the recovery value sentence hiding inside the method
  // paper itself (the first pass's blind spot).
  assert.ok(!/1840|640 units|98 percent/.test(summary),
    `a value sentence leads the answer:\n${summary}`);
  // The method papers' findings in the body are their
  // procedure sentences too — claim selection inside the
  // paper follows the shelf's tier order, so the recovery
  // sentence never becomes the paper's finding at all.
  const body = md.split("## What the research shows")[1] || "";
  // (The papers' other procedure sentences sit in the lede;
  // the body carries the ones the lede did not take.)
  assert.ok(/cuvette/.test(body) && /blank|wavelength/.test(body),
    `the method papers' findings are not their procedure sentences:\n${body.slice(0, 900)}`);
  assert.ok(!/98 percent/.test(md),
    `the method paper's recovery value sentence entered the answer:\n${md.slice(0, 1200)}`);
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
