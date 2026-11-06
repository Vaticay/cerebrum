/**
 * BSF4 serve engagement fix (2026-11-06, gate family
 * diagnosis, ~/workspace/cerebrum-gate-family-diagnosis-nov06/
 * report.md).
 *
 * The proven defect: an engagement asymmetry between the
 * citation gate and the subject serve. Lane D (2026-11-05)
 * taught the GATE that "used cooking oil" and "scraps" are
 * one concept stated twice (CONCEPT_GROUP_FAMILIES, one
 * authored entry): engaging either counts the family's
 * concepts as engaged. The serve never got that accounting:
 * citedSetEngagesSubject counted only a direct subjectHit
 * on the subject concept's own vocabulary, and the rebuild
 * pool (subjectEngagingEvidence) applied the same test. On
 * three traced draws (raw-verify on 65d346f, raw-w1 on
 * f23dfbe, raw-w2 on 693be2f; three different winners, cited
 * 3 each) the gate cleared three on topic papers, synthesis
 * won, and the serve then refused the whole run:
 * subjectServe {fired: true, cited: 3, subject: "used
 * cooking oil"}, replaced by no results.
 *
 * The fix mirrors the gate's family accounting into the two
 * serve tests, keyed on conceptGroupFamilyOf
 * (paperEngagesSubjectFamily): when the subject flagged
 * concept belongs to an authored family and at least two
 * judged concepts belong to it (the gate's own present
 * count), a paper engages the subject when it engages ANY
 * judged concept of the family. Nothing else changes: no
 * family membership, byte identical behaviour; the gate,
 * its concept counting, and the invented term guards are
 * untouched. The rejected forms stay rejected — loosening
 * the subject test globally, and swapping BSF4's subject
 * to "scraps".
 *
 * Papers are shaped from the traced records (the verify
 * draw's cited three, the raw-final positive control), in
 * the standing mismatched language style: questions the way
 * a person asks, papers the way papers are written.
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  citationGateStandard, gateJudgedConcepts, paperClearsCitationGate,
  centralConceptHits, conceptGroupFamilyOf, paperEngagesSubjectFamily,
  citedSetEngagesSubject, subjectEngagingEvidence,
  buildDynLookup, buildDeterministicFallbackGroups, centralContentTerms,
} = await import(join(root, "functions/api/search.js"));

const dynFor = (q) => buildDynLookup(buildDeterministicFallbackGroups(q, centralContentTerms(q)));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  PASS", name);
  } catch (e) {
    failures.push(name + ": " + String(e && e.message || e).split("\n").slice(0, 3).join(" | "));
    console.log("  FAIL", name, "-", String(e && e.message || e).split("\n")[0]);
  }
}
function group(label) { console.log("\n== " + label); }

/* ── The traced shapes ─────────────────────────────────── */
const BSF4_Q = "used cooking oil mixed in for the fly babies that eat our scraps, do they put on weight or get sick";
// The verify draw's cited three: each speaks the scraps
// phrasing (food waste, organic waste), none the oil
// concept's own vocabulary.
const ONE_HEALTH = {
  title: "Applying a One Health framework to food waste valorisation: insights from black soldier fly larvae bioconversion",
  abstract: "Food waste is a growing burden for cities, and black soldier fly larvae can convert it into protein and fat. We review how larvae reared on food waste streams perform, which pathogens survive the process, and what safety checks the resulting feed needs before it reaches animals.",
};
const COMPOSITION = {
  title: "Effect of food waste composition on growth and nutritional value of black soldier fly larvae",
  abstract: "Black soldier fly larvae were reared on food waste mixtures of varying composition. Larval growth rate, survival, and protein and fat content were measured across diets. Larvae on mixed food waste gained weight steadily, and no diet produced signs of illness beyond slower growth on the driest mixture.",
};
const GENETICS = {
  title: "Genetics, age, and diet influence gut bacterial communities and performance of black soldier fly larvae (Hermetia illucens)",
  abstract: "The black soldier fly (Hermetia illucens) is a promising insect for the bioconversion of organic waste. Here, two black soldier fly lines were raised on ten diets based on agricultural byproducts and food waste, and the gut bacterial communities and larval performance were measured. Genetics, age, and diet all influenced the composition of the gut bacterial communities, and diet quality affected larval growth and survival on the waste based diets.",
};
// The raw-final positive control: speaks the oil vocabulary
// directly, engaged the subject before this fix existed.
const BLENDED = {
  title: "Impact of blended used cooking oil-kitchen waste on the bio-recycler, black soldier fly larvae",
  abstract: "Used cooking oil was blended with kitchen waste and fed to black soldier fly larvae. Larval weight gain, survival, and lipid content were measured against a control diet. Larvae on the blended oil diet gained weight and showed no increase in mortality.",
};
const CHANT = {
  title: "Byzantine chant in medieval antiphoners",
  abstract: "A study of chant notation in medieval antiphoners and the scribes who copied them.",
};
// Engages exactly one judged concept, and it is NOT a
// family concept ("mixed"); family credit must not leak
// onto non family engagements.
const MIXED_ONLY = {
  title: "Mixed intercropping systems for smallholder farms",
  abstract: "Mixed cropping patterns were compared with sole cropping on small farms over three seasons. Mixed stands used land more evenly across the season, and total yield per hectare rose when the mixed plots were sown early.",
};
const TRACED_THREE = [ONE_HEALTH, COMPOSITION, GENETICS];

group("The traced precondition — the gate credits what the serve refused");

await test("BSF4: the gate clears all three traced papers and none records a direct subject hit", () => {
  const std = citationGateStandard(BSF4_Q, null);
  const judged = gateJudgedConcepts(std);
  const subj = judged.find((c) => c && c.subject);
  assert.ok(subj && subj.term === "used cooking oil", "the traced subject did not resolve: " + judged.map((c) => c.term).join(","));
  for (const p of TRACED_THREE) {
    assert.equal(paperClearsCitationGate(p, std), true, "the gate no longer clears a traced paper: " + p.title);
    assert.equal(centralConceptHits(p, judged).subjectHit, false, "a traced paper now records a direct subject hit, so this file no longer proves the family path: " + p.title);
  }
});

group("The fix — family engagement at the serve");

await test("BSF4: the traced cited set engages the subject (the owed pin)", () => {
  const r = citedSetEngagesSubject(TRACED_THREE, new Set([1, 2, 3]), BSF4_Q, null);
  assert.equal(r.judged, true, "the serve did not judge the traced set");
  assert.equal(r.subjectTerm, "used cooking oil", "the subject term moved: " + r.subjectTerm);
  assert.equal(r.engaged, true, "the traced cited set still does not engage the subject: " + JSON.stringify(r));
});

await test("BSF4: each traced paper engages on family credit alone", () => {
  for (const p of TRACED_THREE) {
    const r = citedSetEngagesSubject([p], new Set([1]), BSF4_Q, null);
    assert.equal(r.engaged, true, "a traced paper does not engage on family credit: " + p.title);
  }
});

await test("BSF4: paperEngagesSubjectFamily reads the pair, and only the pair", () => {
  const std = citationGateStandard(BSF4_Q, null);
  const judged = gateJudgedConcepts(std);
  const subj = judged.find((c) => c && c.subject);
  for (const p of TRACED_THREE) {
    assert.equal(paperEngagesSubjectFamily(p, judged, subj), true, "family engagement missing: " + p.title);
  }
  assert.equal(paperEngagesSubjectFamily(CHANT, judged, subj), false, "the chant paper engages the family");
  assert.equal(paperEngagesSubjectFamily(MIXED_ONLY, judged, subj), false, "a non family concept engagement counts as family engagement");
  assert.equal(paperEngagesSubjectFamily(ONE_HEALTH, judged, null), false, "a missing subject concept engages");
  assert.equal(paperEngagesSubjectFamily(ONE_HEALTH, [subj], subj), false, "a lone family concept in the judged set counts (the gate requires two present)");
});

await test("BSF4: the rebuild pool carries the family papers and nothing else new", () => {
  const r = subjectEngagingEvidence([...TRACED_THREE, CHANT, BLENDED], BSF4_Q, null);
  assert.equal(r.judged, true, "the rebuild pool was not judged");
  assert.deepEqual(r.papers.map((p) => p.title),
    [...TRACED_THREE, BLENDED].map((p) => p.title),
    "the rebuild pool is wrong: " + JSON.stringify(r.papers.map((p) => p.title)));
});

await test("BSF4: the positive control is unchanged (direct engagement, as before)", () => {
  const std = citationGateStandard(BSF4_Q, null);
  const judged = gateJudgedConcepts(std);
  assert.equal(centralConceptHits(BLENDED, judged).subjectHit, true, "the control no longer hits directly");
  const r = citedSetEngagesSubject([BLENDED], new Set([1]), BSF4_Q, null);
  assert.equal(r.engaged, true, "the positive control no longer engages");
});

await test("BSF4: papers engaging no family concept still refuse", () => {
  for (const p of [CHANT, MIXED_ONLY]) {
    const r = citedSetEngagesSubject([p], new Set([1]), BSF4_Q, null);
    assert.equal(r.judged, true);
    assert.equal(r.engaged, false, "a no family engagement paper now engages the subject: " + p.title);
  }
  const pool = subjectEngagingEvidence([CHANT, MIXED_ONLY], BSF4_Q, null);
  assert.deepEqual(pool.papers, [], "the rebuild pool admits no family engagement papers");
});

/* ── Blast radius: the standing refusals sit outside any
 * authored family, so the changed test cannot reach them ── */
group("Blast radius — no family, no change");

await test("grocery: the checkout subject belongs to no family and the junk cited set still refuses", () => {
  const q = "which line at the grocery store checkout moves the fastest";
  const dyn = dynFor(q);
  const std = citationGateStandard(q, dyn);
  const judged = gateJudgedConcepts(std);
  const subj = judged.find((c) => c && c.subject);
  assert.ok(subj, "the grocery subject did not resolve");
  assert.equal(conceptGroupFamilyOf(subj), -1, "the grocery subject joined a family");
  const review = {
    title: "Digital transformation in retail and grocery: a systematic review",
    abstract: "Digital transformation is reshaping retail and grocery organisations. This review synthesises studies of digital strategy, store operations, checkout technology adoption, and customer experience in supermarkets and grocery chains, and discusses implications for retail managers working through digital change in the store estate and at the checkout.",
    year: "2023", citations: 640,
  };
  assert.equal(paperEngagesSubjectFamily(review, judged, subj), false, "family engagement fired on the grocery question");
  const r = citedSetEngagesSubject([review], new Set([1]), q, dyn);
  assert.equal(r.judged, true);
  assert.equal(r.engaged, false, "the grocery cited set now engages the subject");
});

await test("wave seventeen true subject: the creatine subject belongs to no family and its pins stand", () => {
  const q = "does the powder guys take for muscles make your hair fall out";
  const dyn = buildDynLookup([
    { term: "powder", alternates: ["supplement powder", "creatine"] },
    { term: "hair", alternates: ["hair loss", "baldness"] },
    { term: "muscles", alternates: ["muscle mass", "strength training"] },
  ]);
  const std = citationGateStandard(q, dyn);
  const judged = gateJudgedConcepts(std);
  for (const c of judged) {
    assert.equal(conceptGroupFamilyOf(c), -1, "a creatine judged concept joined a family: " + c.term);
  }
  const hairOil = {
    title: "A randomised trial of herbal hair oil for scalp and hair care",
    abstract: "We evaluated a herbal hair oil preparation in adults with dry scalp. Participants applied the oil twice weekly for twelve weeks and reported changes in hair shedding, scalp comfort, and hair shine on standardised questionnaires administered at a dermatology clinic.",
  };
  const serve = citedSetEngagesSubject([hairOil], new Set([1]), q, dyn);
  assert.equal(serve.engaged, false, "the hair oil trial engages the creatine subject");
});

await test("BSF2 and BSF3: the traced refusal subjects belong to no authored family", () => {
  // The traced resolutions (the serve records' own subjects):
  // BSF2's "cousin" and BSF3's "chip", both bare side words.
  // BSF3's judged set DOES carry the scraps concept (family
  // 0) — the pin is that family accounting keys on the
  // SUBJECT's family, and neither subject has one, so the
  // changed test cannot reach either refusal.
  const cases = [
    ["can kitchen scraps and old chip fat feed the grubs that turn rubbish into chicken feed", "chip"],
  ];
  for (const [q, term] of cases) {
    const dyn = dynFor(q);
    const std = citationGateStandard(q, dyn);
    const judged = gateJudgedConcepts(std);
    const subj = judged.find((c) => c && c.subject);
    assert.ok(subj && subj.term === term,
      "the traced subject did not resolve for: " + q + " (got " + (subj && subj.term) + ")");
    assert.equal(conceptGroupFamilyOf(subj), -1,
      "the refusal subject joined a family (" + subj.term + ") for: " + q);
    assert.equal(paperEngagesSubjectFamily(GENETICS, judged, subj), false,
      "family engagement fired for: " + q);
  }
  // 2026-11-06 (gathering losses fix) witness update for the
  // BSF2 case above: its traced subject was "cousin", a
  // fallback singleton that gated only because the hand table
  // resolved ONE curated group for the question (insect). The
  // gathering fix puts "grease" in the waste oil group, so the
  // hand table now resolves two (insect, waste oil) and the
  // gate precedence rule (2026-10-13, gateDynLookup) counts
  // fallback groups for nothing — the cousin subject no
  // longer resolves at all, and the subject serve does not
  // judge the question. That subject refused every cited set
  // indiscriminately (no paper on the question's real topic
  // engages "cousin" either), so its loss is the precedence
  // rule working, not a refusal weakened: the gate still
  // judges the question on its real concepts. The blast
  // radius claim this test exists for is unchanged and is
  // what is pinned here: no judged concept of the question
  // belongs to an authored family, and family engagement
  // cannot fire.
  const q2 = "my cousin raises those black compost flies for chicken feed, can the little white worms just eat the grease left over from a fish fry";
  const dyn2 = dynFor(q2);
  const judged2 = gateJudgedConcepts(citationGateStandard(q2, dyn2));
  const subj2 = judged2.find((c) => c && c.subject);
  assert.equal(subj2, undefined,
    "the BSF2 question gained a subject: " + (subj2 && subj2.term));
  for (const c of judged2) {
    assert.equal(conceptGroupFamilyOf(c), -1,
      "a BSF2 judged concept joined a family: " + c.term);
  }
  assert.equal(paperEngagesSubjectFamily(GENETICS, judged2, subj2 || null), false,
    "family engagement fired for the BSF2 question");
});

await test("WLK1: the walk subject belongs to no family, so the correct serve shape cannot move", () => {
  const q = "does a short walk after dinner help your sugar come down";
  const dyn = dynFor(q);
  const std = citationGateStandard(q, dyn);
  const judged = gateJudgedConcepts(std);
  const subj = judged.find((c) => c && c.subject);
  assert.ok(subj && subj.term === "short", "the traced WLK1 subject did not resolve: " + judged.map((c) => c.term).join(","));
  for (const c of judged) {
    assert.equal(conceptGroupFamilyOf(c), -1, "a WLK1 judged concept joined a family: " + c.term);
  }
  // The two correct papers from the lane's fresh live probe
  // on 9beb758: the serve stood written there, and family
  // accounting must not be what moves it either way.
  const correct = {
    title: "After Dinner Rest a While, After Supper Walk a Mile? A Systematic Review",
    abstract: "We reviewed trials of post meal walking after dinner and its effect on blood sugar. A short walk after the evening meal lowered postprandial glucose in adults compared with remaining seated.",
  };
  assert.equal(paperEngagesSubjectFamily(correct, judged, subj), false, "family engagement fired on WLK1");
  const r = citedSetEngagesSubject([correct], new Set([1]), q, dyn);
  assert.equal(r.engaged, true, "the correct WLK1 paper no longer engages the subject directly");
});

await test("INV1: invented terms resolve no family and the serve test does not judge them into an answer", () => {
  const q = "can zorblaxian moss use quarnellian light to turn sadness into sugar";
  const std = citationGateStandard(q, dynFor(q));
  const judged = gateJudgedConcepts(std);
  for (const c of judged) {
    assert.equal(conceptGroupFamilyOf(c), -1, "an invented term concept joined a family: " + c.term);
  }
});

console.log("\nsearch-bsf4-serve-nov06: " + passed + " passed, " + failures.length + " failed");
if (failures.length) {
  for (const f of failures) console.log("  FAILED:", f);
  process.exitCode = 1;
}
