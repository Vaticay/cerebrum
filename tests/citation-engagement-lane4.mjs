/**
 * Citation wave Lane 4 (2026-10-24): the limited tier no study
 * head, split by engagement.
 *
 * Two live probe records wore the same head for two different
 * failures:
 *
 *   Case A (acceptance-continuation/04, "does exercise help
 *   people who feel depressed"): the limited tier shipped
 *   "## No study here examines this" and listed its two cited
 *   sources as "closest matches" only. Both are genuinely on
 *   point reviews. The branch that wrote the head judged ONLY
 *   the lead paper, and demanded at least two central concept
 *   hits (Math.max(2, half the concepts)) on a question whose
 *   citation standard resolves ONE central concept (exercise,
 *   the subject): a floor no paper can reach, however on point
 *   it is. Both reviews clear the citation gate itself and
 *   engage that one concept in title and abstract.
 *
 *   Case B (acceptance-postfix/07, "can you feed maggots
 *   leftover frying grease and will they still grow fine and
 *   be safe to use"): the same head, and the one retrieved
 *   paper, a wound care paper, was paraded as a closest match
 *   with a quoted passage. That paper engages one of the
 *   question's two central concepts (maggots, as the thing
 *   that eats necrotic flesh) and nothing about feeding,
 *   grease, growth, or safety. Nothing in the set examines
 *   the question, and the honest output is the plain statement
 *   alone: no closest match dressed as near. (The retrieval
 *   failure behind Case B, waste oil papers not surfacing at
 *   all, is a standing gap this lane does not touch.)
 *
 * Fixtures are the real papers from the records, with their
 * real abstracts: the scoping review's from its PMC record,
 * the Martinsen review's from the publisher text, and the
 * wound paper's the sentence the live record itself quotes
 * from it. Relevance values are the records' own, and they
 * matter: all three sit under the extractive strength bar, so
 * the extractive quality gate fails and the answers are built
 * by the limited tier, exactly as on the live probes. The
 * expansion groups are the records' own, carried the way the
 * handler carries them; gating recomputes its standard from
 * the shipped tables, as it does live.
 *
 * Pins:
 *   1. Unit: the exercise standard resolves one central
 *      concept; both reviews clear the citation gate and
 *      engage it. The maggot standard resolves two central
 *      concepts; the wound paper engages only one.
 *   2. Exercise end to end: the limited tier answer presents
 *      the reviews as real sources (short answer from their
 *      passages, a Sources list, the assembled from sources
 *      closing) with no no study head and no closest match.
 *   3. Maggot end to end: the limited tier answer is the
 *      plain nothing on point statement, naming what was
 *      tried, with no closest match section, no retrieved
 *      title, and no quoted passage.
 *
 * Run with: node tests/citation-engagement-lane4.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const search = await import(join(root, "functions/api/search.js"));
const {
  buildExtractiveSynthesis, getLastExtractiveTier,
  citationGateStandard, paperClearsCitationGate, centralConceptHits,
  buildDynLookup, gateDynLookup,
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

const EXERCISE_Q = "does exercise help people who feel depressed";
const MAGGOT_Q = "can you feed maggots leftover frying grease and will they still grow fine and be safe to use";

// The expansion groups the live records carried, exactly as
// their records show them (live model legs).
function liveDyn(groups) {
  const g = groups.map((x) => ({ ...x, _liveModel: true }));
  g.via = "groq";
  return buildDynLookup(g);
}
const exerciseDyn = () => liveDyn([
  { term: "exercise", alternates: ["physical activity", "physical exercise", "physical training", "exercise intervention", "exercise program", "depression score"] },
  { term: "feel depressed", alternates: ["experience depression", "report depressive symptoms", "have depressive feelings", "suffer from depression", "display depressive mood"] },
]);
const maggotDyn = () => liveDyn([
  { term: "feed", alternates: ["provide nutrition", "supply food", "feed with", "administer diet"] },
  { term: "maggots", alternates: ["fly larvae", "larvae", "diptera larvae", "maggot larvae"] },
  { term: "leftover frying grease", alternates: ["used cooking oil", "spent frying oil", "recycled frying oil", "waste frying oil"] },
  { term: "grow", alternates: ["larval weight", "growth rate", "survival rate", "microscope", "controlled experiment", "randomized trial"] },
  { term: "fine", alternates: ["fines"] },
  { term: "safe", alternates: [] },
]);

const PASCOE = () => ({
  title: "Physical activity and exercise in youth mental health promotion: a scoping review",
  journal: "BMJ Open Sport & Exercise Medicine", year: 2020, relevance: 54,
  abstract: "This scoping review examined the breadth and outcomes of controlled trials testing the effect of physical activity and exercise interventions across all mental health outcomes for mental health promotion and indicated prevention studies in young people. The literature search was conducted using 'Evidence Finder'. Thirty publications were included. Available evidence suggested that interventions of varying intensity may lead to a reduction in depression symptoms and that moderate-to-vigorous-intensity and light-intensity interventions may reduce anxiety symptoms. Effects of physical activity/exercise interventions on additional mental health outcomes were also shown; however, the number of studies was small, indicating a limited evidence base. Robust research regarding the effects of physical activity/exercise on mental health promotion and as an indicated prevention strategy in young people is lacking. The available evidence suggests that physical activity/exercise is a promising mental health promotion and early intervention strategy and warrants further investigation.",
});
const MARTINSEN = () => ({
  title: "Physical activity in the prevention and treatment of anxiety and depression",
  journal: "Nordic Journal of Psychiatry", year: 2008, relevance: 43,
  abstract: "Anxiety and depressive disorders are major public health problems, and desirable changes in lifestyle, such as physical exercise, can have great potential in prevention and treatment. There is growing evidence that physically active people are at a reduced risk of developing depression, and that exercise interventions are associated with significant benefits for patients with mild to moderate forms of depression as well as in reducing anxiety. These findings have led to the proposal that exercise may serve as an alternative or a supplement to traditional forms of therapy. This paper will present a broad overview of research involving the efficacy of exercise as means to prevent and treat depression and anxiety, and related issues regarding dosage and compliance. Finally, exercise will be discussed in the frame of cognitive-behavioural theory.",
});
const WOUND = () => ({
  title: "Fly larvae for wound management: A maggot makeover",
  journal: "New South Wales Public Health Bulletin", year: 2004, relevance: 57,
  abstract: "Maggots of certain fly species feed on necrotic flesh, and through this debriding activity can assist the healing of chronic soft-tissue wounds (such as pressure and venous stasis ulcers, diabetic foot infections, and postoperative wounds) that are resistant to surgical or antibiotic intervention.",
});

// ═══════════════════════════════════════════════════════════════════
group("the standards behind the two records");

await test("the exercise question resolves one central concept, and both reviews engage it and clear the gate", () => {
  const std = citationGateStandard(EXERCISE_Q, gateDynLookup(EXERCISE_Q, exerciseDyn()));
  assert.equal((std.centralConcepts || []).length, 1,
    "the exercise standard does not resolve exactly one central concept: " +
    JSON.stringify((std.centralConcepts || []).map((c) => c.term)));
  assert.equal(std.centralConcepts[0].term, "exercise");
  assert.equal(std.centralConcepts[0].subject, true, "the one concept is not the subject");
  for (const p of [PASCOE(), MARTINSEN()]) {
    assert.equal(paperClearsCitationGate(p, std), true,
      "a review the live answer cited does not clear the citation gate: " + p.title);
    const hits = centralConceptHits(p, std.centralConcepts);
    assert.equal(hits.total, 1, "the review does not engage the one central concept: " + p.title);
    assert.equal(hits.subjectHit, true, "the review does not engage the subject: " + p.title);
  }
});

await test("the maggot question resolves two central concepts, and the wound paper engages only one", () => {
  const std = citationGateStandard(MAGGOT_Q, gateDynLookup(MAGGOT_Q, maggotDyn()));
  assert.deepEqual((std.centralConcepts || []).map((c) => c.term), ["maggots", "grease"],
    "the maggot standard does not resolve the two concepts the record shows");
  const hits = centralConceptHits(WOUND(), std.centralConcepts);
  assert.equal(hits.total, 1, "the wound paper engages more of the question than the record shows");
});

// ═══════════════════════════════════════════════════════════════════
group("Case A — on point reviews in the picked set ship as real sources");

await test("the exercise answer has no no study head and no closest match, and cites both reviews", () => {
  const md = buildExtractiveSynthesis([PASCOE(), MARTINSEN()], null,
    { query: EXERCISE_Q, dynLookup: exerciseDyn() });
  assert.ok(md, "no answer at all");
  assert.equal(getLastExtractiveTier(), "limited", "the answer did not come from the limited tier");
  assert.ok(!md.includes("No study here examines this"), "the no study head shipped over on point papers:\n" + md);
  assert.ok(!md.includes("No retrieved study examines"), "the no study statement shipped:\n" + md);
  assert.ok(!md.includes("Closest match"), "a cited review was dressed as a closest match:\n" + md);
  assert.ok(md.startsWith("## The short answer"), "the limited tier's real sources frame did not ship:\n" + md);
  assert.ok(md.includes("### Sources"), "no Sources section:\n" + md);
  assert.ok(md.includes("Physical activity and exercise in youth mental health promotion: a scoping review"),
    "the scoping review is not presented as a source:\n" + md);
  assert.ok(md.includes("Physical activity in the prevention and treatment of anxiety and depression"),
    "the Martinsen review is not presented as a source:\n" + md);
  assert.ok(md.includes("[1]") && md.includes("[2]"), "the passages are not cited to both papers:\n" + md);
  assert.ok(md.includes("Assembled from the sources above without AI interpretation"),
    "the assembled from sources closing is missing:\n" + md);
});

// ═══════════════════════════════════════════════════════════════════════════
group("Case B — an off point paper in the picked set ships as nothing on point");

await test("the maggot answer is the plain statement alone, with no closest match dressed as near", () => {
  const md = buildExtractiveSynthesis([WOUND()], null,
    { query: MAGGOT_Q, dynLookup: maggotDyn() });
  assert.ok(md, "no answer at all");
  assert.equal(getLastExtractiveTier(), "limited", "the answer did not come from the limited tier");
  assert.ok(md.includes("## No study here examines this"), "the plain head is missing:\n" + md);
  assert.ok(md.includes("No retrieved study examines \"" + MAGGOT_Q + "\""),
    "the plain statement is missing:\n" + md);
  assert.ok(md.includes("retrieved 1 paper"), "the statement does not name what was tried:\n" + md);
  assert.ok(!md.includes("Closest match"), "the wound paper was dressed as a closest match:\n" + md);
  assert.ok(!md.includes("Fly larvae for wound management"),
    "the wound paper's title was presented as a match:\n" + md);
  assert.ok(!md.includes("necrotic flesh"), "the wound paper's passage was quoted as near answering:\n" + md);
  assert.ok(!/\[\d+\]/.test(md), "the statement carries a citation to a paper it says does not examine the question:\n" + md);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
