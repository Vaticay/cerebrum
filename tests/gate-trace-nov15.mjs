/**
 * Gate trace lane (2026-11-15): the abstract less rescue gap.
 *
 * The Nov 15 live batch's citation gate family grew from one
 * specimen to five no results. The trace of SLT4 ("people say the
 * white stuff on chips is bad for your heart, but is the problem
 * the salt itself or just junk food in general") found its shelf
 * of 25 cleared in two steps: the programmatic passes dropped 21
 * on one group touches (their reasons reproduced exactly), and
 * the one survivor — "Hypertension, Dietary Salt Intake, and the
 * Role of the Thiazide-Sensitive Sodium Chloride Transporter
 * NCCT" — cleared the citation standard itself (the live
 * gateAudit records standard true) and died on the floor alone:
 * topical gate score 23.857 against the floor of 25, inside the
 * subject engaging rescue's near miss band (15 to 24... the band
 * reads to the floor). Its record carried no abstract, and the
 * rescue demanded an engagement IN THE ABSTRACT on top of the
 * standard's verdict — a condition the standard itself waives
 * for abstract less papers (the 2026-10-21 amendment: the title
 * is the only claim there is). Reproduced at unit level with the
 * live scores and the live model expansion groups: abstract less,
 * the rescue returns false; with the abstract the same record
 * returns true. The fix judges an abstract less paper's title
 * engagement in the abstract's place inside the rescue, exactly
 * as the gate does. Papers with abstracts are untouched.
 *
 * Run with: node tests/gate-trace-nov15.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const search = await import(join(root, "functions/api/search.js"));
const {
  buildDynLookup, conceptGateContext, citationGateStandard,
  paperClearsCitationGate, paperIsCitable, subjectEngagingRescue,
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
function group(name) {
  console.log(`\n${name}`);
}

const SLT4_Q = "people say the white stuff on chips is bad for your heart, but is the problem the salt itself or just junk food in general";

// The live model expansion groups the Nov 15 SLT4 draw carried,
// exactly as its record shows them.
function liveSlt4Dyn() {
  const groups = [
    { term: "white stuff", alternates: ["refined flour", "white flour", "all-purpose flour", "plain flour"], _liveModel: true },
    { term: "chips", alternates: ["potato chips", "crisps", "fried potato slices", "potato crisps"], _liveModel: true },
    { term: "salt", alternates: ["sodium chloride", "table salt", "nacl", "salt content", "blood pressure", "serum sodium"], _liveModel: true },
    { term: "junk food", alternates: ["processed food", "high-calorie food", "energy-dense food", "fast food", "waist circumference", "lipid profile"], _liveModel: true },
    { term: "bad", alternates: ["bads"] },
    { term: "but", alternates: ["buts"] },
    { term: "say", alternates: [] },
    { term: "problem", alternates: [] },
  ];
  groups.via = "groq";
  return buildDynLookup(groups);
}

const NCCT_TITLE = "Hypertension, Dietary Salt Intake, and the Role of the Thiazide-Sensitive Sodium Chloride Transporter NCCT";
// The paper's real abstract, as Europe PMC serves it (fetched
// 2026-11-15 for this trace).
const NCCT_ABSTRACT = "A high salt intake in industrialized countries is an important cardiovascular risk factor. It remains at typically twice the maximum recommended levels of 5-6 g/day, and halving this would have enormous public health benefit in preventing stroke and cardiovascular disease. Salt homeostasis can also be affected pharmacologically by diuretic drugs that target mechanisms within the distal kidney nephron to cause salt wasting. Indeed, thiazide-type diuretics are among the most widely used agents in the management of hypertension and work by blocking NCCT, the NaCl-transporter in the distal nephron. The biology of this membrane transporter was not previously well understood until the discovery of the molecular basis of a rare familial form of hypertension called Gordon syndrome (pseudohypoaldosteronism type 2, PHAII). This has established that the NCCT transporter is dynamically regulated in the kidney by WNK kinases and a signaling cascade using a second kinase called SPAK. Common polymorphisms in the SPAK gene have recently been shown to affect blood pressure in human cohorts and removing its function lowers blood pressure in mice. The SPAK-deficient mouse actually has a phenotype reminiscent of Gitelman syndrome. This suggests that specific inhibitors of SPAK kinase may provide a novel class of diuretic drugs to lower blood pressure through salt wasting. The expectation is that SPAK inhibitors would mimic the on-target effects of thiazides but not their adverse off-target effects. An antihypertensive drug that could lower blood pressure with the efficacy of a thiazide without producing metabolic side effects such as hyperuricaemia or impaired glucose tolerance is therapeutically very attractive. It also exemplifies how data coming from the rare monogenic hypertension syndromes can together with genome-wide association studies in hypertension deliver novel druggable targets.";

// The live record's shape: the scores the gateAudit recorded
// (topical 23.857, relevance 28) and no abstract.
const ncctAbstractless = () => ({
  title: NCCT_TITLE,
  abstract: "",
  topicalScore: 23.857142857142858,
  relevance: 28,
  score: 28,
});

group("SLT4 specimen — the abstract less near miss the rescue could not see");

await test("the specimen clears the citation standard itself", () => {
  const dyn = liveSlt4Dyn();
  const std = citationGateStandard(SLT4_Q, dyn);
  assert.equal(paperClearsCitationGate(ncctAbstractless(), std), true,
    "the specimen no longer clears the standard the live gateAudit recorded as true");
});

await test("an abstract less in band paper the standard clears is rescued and citable", () => {
  const paper = ncctAbstractless();
  const ctx = conceptGateContext([paper], SLT4_Q, liveSlt4Dyn());
  assert.equal(subjectEngagingRescue(paper, ctx), true,
    "the abstract less near miss is still refused by the rescue");
  assert.equal(paperIsCitable(paper, 1, ctx), true,
    "the abstract less near miss is still not citable");
});

await test("the same record with its abstract is citable, as before", () => {
  const paper = { ...ncctAbstractless(), abstract: NCCT_ABSTRACT };
  const ctx = conceptGateContext([paper], SLT4_Q, liveSlt4Dyn());
  assert.equal(paperIsCitable(paper, 1, ctx), true,
    "the abstract carrying record regressed");
});

await test("below the band, an abstract less paper stays out", () => {
  const paper = { ...ncctAbstractless(), topicalScore: 14 };
  const ctx = conceptGateContext([paper], SLT4_Q, liveSlt4Dyn());
  assert.equal(subjectEngagingRescue(paper, ctx), false, "a below band paper was rescued");
  assert.equal(paperIsCitable(paper, 1, ctx), false, "a below band paper became citable");
});

await test("an abstract less paper that fails the standard stays out", () => {
  const paper = {
    title: "Microwave drying of potato chips: combined effects of geometrical shape and drying kinetics",
    abstract: "",
    topicalScore: 20,
    relevance: 30,
    score: 30,
  };
  const ctx = conceptGateContext([paper], SLT4_Q, liveSlt4Dyn());
  assert.equal(subjectEngagingRescue(paper, ctx), false,
    "a paper failing the standard was rescued on its title alone");
  assert.equal(paperIsCitable(paper, 1, ctx), false,
    "a paper failing the standard became citable");
});

await test("a paper WITH an abstract still needs the abstract engagement the rescue always required", () => {
  // Title engages the heart concept; the abstract engages one
  // judged concept once and no second one (written without the
  // question's framing words). The pre fix rule for abstract
  // carrying papers is unchanged: total under two, or nothing in
  // the abstract, means no rescue.
  const paper = {
    title: NCCT_TITLE,
    abstract: "Sodium transport in the distal tubule was measured in a cohort of adults with hypertension. Transporter expression tracked dietary sodium across the cohort.",
    topicalScore: 20,
    relevance: 30,
    score: 30,
  };
  const ctx = conceptGateContext([paper], SLT4_Q, liveSlt4Dyn());
  assert.equal(subjectEngagingRescue(paper, ctx), false,
    "an abstract carrying paper with thin engagement was rescued under the new branch");
});

await test("cap verdicts are never rescued, abstract less or not", () => {
  const base = ncctAbstractless();
  const ctx = conceptGateContext([base], SLT4_Q, liveSlt4Dyn());
  assert.equal(paperIsCitable({ ...base, roleInverted: true }, 1, ctx), false,
    "a role inverted abstract less paper was rescued");
  assert.equal(paperIsCitable({ ...base, unverifiableAbstract: true }, 1, ctx), false,
    "an unverifiable abstract less paper was rescued");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
