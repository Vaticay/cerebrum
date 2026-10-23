/**
 * Wave 3 Lane S3 (2026-10-23, logic audit Stage 3, scoring and
 * gating). Pins for the class repairs:
 *   L3-1 one score, one producer (tier merges dedupe on paper
 *     identity, tier fallback records carry the unscored
 *     provenance flag instead of a fabricated relevance).
 *   L3-3 separate scales (component ranges published in one
 *     place and consistent; the gate reads the topical
 *     component alone; phrase bonuses share one declared
 *     combined component).
 *   L3-4 calibrated topical floor (25, from the labeled sets)
 *     with the near floor band judged by the rescue's second
 *     independent topical test.
 *   L3-6 learned papers carry no invented score.
 *   L3-7 filters are monotone, remove only; the stamped
 *     verdict binds at the choke point with no exception.
 *   L3-8 validator judges from the full usable abstract,
 *     explicit verdicts required, fail open labeled, no
 *     reject all override.
 *   L3-9 one organism identity, whole token matching.
 *   L3-10 the organism anchor satisfies one concept, never
 *     the whole standard.
 *   L3-11 one judged concept set, recorded; the single
 *     concept rule adds the subject serve requirement.
 *   L3-12 rerank reorders only inside the citable set; both
 *     orderings recorded.
 *   L3-13 gating inputs are deterministic: a live marked
 *     lookup is recomputed from the shipped tables at the
 *     gate, unmarked lookups pass through.
 *   L3-14 one missing relevance rule: typed absence in the
 *     confidence line, the verdict guard, and the rerank.
 *   L3-15 dead enforcement blocks are gone.
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 *
 * Run with: node tests/scoring-gating-w3.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
const search = await import(join(root, "functions/api/search.js"));
const { semanticRerank } = await import(join(root, "functions/lib/semanticRerank.js"));

const {
  SCORE_COMPONENT_RANGES, TOPICAL_GATE_FLOOR, combineScoreComponents,
  paperGateScore, paperTopicalScore, paperRelevanceValue, paperRelevance,
  paperIsUnscored, paperIsCitable, conceptGateContext, citationGateStandard,
  gateJudgedConcepts, subjectEngagingRescue, applyRelevanceGate,
  topicOverlapFilter, programmaticValidationPasses, llmValidatePapers,
  resolveQueryOrganism, textMentionsAnyNeedle, anchorCarriesPaper,
  buildDynLookup, gateDynLookup, buildDeterministicFallbackGroups,
  centralContentTerms, buildConfidenceLine, guardSettledVerdict,
  VALIDATION_DID_NOT_RUN_STATEMENT,
} = search;

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    failures.push(name + ": " + (e && e.message));
    console.log("  ✗ " + name + "\n      " + (e && e.message));
  }
}
function group(name) { console.log("\n" + name); }

const OIL_Q = "if baby black soldier flies eat used cooking oil from restaurants do they turn out healthy";
const OIL_PAPER = {
  title: "Waste oil substrates reshape the black soldier fly larval gut microbiome and biomass composition during bioconversion",
  abstract: "Black soldier fly larvae (BSFL) are generalist decomposers with promise for converting agricultural and food-processing by-products into value-added bioproducts, but BSFL performance on lipid-rich waste oil streams and the role of the gut microbiome in this process remain unclear. Here, we evaluated BSFL bioconversion of a standard chicken feed diet supplemented with three chemically distinct waste oils: acidulated vegetable oil (AVO), pork grease (PG), and used cooking oil (UCO). Larval performance, bioconversion rate, gut microbiome composition, total protein and fat content, and fatty-acid profiles were measured across bioconversion.",
};

// ═══════════════════════════════════════════════════════════
group("L3-3 — component ranges are published, consistent, and bounded");

await test("the declared maxima equal the sums of the declared parts", () => {
  const t = SCORE_COMPONENT_RANGES.topical;
  const tSum = t.coreCoverage[1] + t.titleHits[1] + t.phraseBonusesCombined[1] + t.peripheral[1] + t.organism[1];
  assert.equal(tSum, t.max, "topical parts sum past the declared topical max");
  const q = SCORE_COMPONENT_RANGES.quality;
  const qSum = q.abstract[1] + q.citationsPerYear[1] + q.recency[1] + q.journal[1] + q.predatory[1] + q.studyWeight[1] + q.intentBonus[1] + q.rigor[1];
  assert.equal(qSum, q.max, "quality parts sum past the declared quality max");
});

await test("property: random component sets never sum past the declared ranges", () => {
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 500; i++) {
    const tp = {
      coreCoverage: rnd() * 90, titleHits: rnd() * 40,
      phraseBonus: rnd() * 60, phraseTitleBonus: rnd() * 60,
      peripheral: rnd() * 9, organism: -5 + rnd() * 34,
    };
    const qp = {
      abstractPoints: rnd() * 16, citationsPerYearPoints: rnd() * 24,
      recencyPoints: rnd() * 20, journalPoints: rnd() * 28,
      predatoryPoints: -36 + rnd() * 36, studyWeightPoints: -8 + rnd() * 32,
      intentBonusPoints: rnd() * 24, rigorPoints: rnd() * 20,
    };
    const out = combineScoreComponents(tp, qp);
    assert.ok(out.topical <= SCORE_COMPONENT_RANGES.topical.max, "topical exceeded its range: " + out.topical);
    assert.ok(out.topical >= SCORE_COMPONENT_RANGES.topical.min, "topical below its range: " + out.topical);
    assert.ok(out.quality <= SCORE_COMPONENT_RANGES.quality.max, "quality exceeded its range: " + out.quality);
    assert.ok(out.quality >= SCORE_COMPONENT_RANGES.quality.min, "quality below its range: " + out.quality);
    assert.ok(out.phraseCombined <= SCORE_COMPONENT_RANGES.topical.phraseBonusesCombined[1],
      "the two phrase bonuses together exceeded their combined component: " + out.phraseCombined);
  }
});

await test("the gate score is the topical component, never the blended relevance", () => {
  assert.equal(paperGateScore({ topicalScore: 20, relevance: 95 }), 20);
  assert.equal(paperGateScore({ matchScore: 33, relevance: 95 }), 33);
  assert.equal(paperGateScore({ relevance: 95 }), 95, "a record with only blended relevance keeps it as its gate reading");
  assert.equal(paperGateScore({}), null, "a record with no score reads as a typed absence");
  assert.equal(paperTopicalScore({ topicalScore: 12, matchScore: 30 }), 12);
});

// ═══════════════════════════════════════════════════════════
group("L3-1 — one score, one producer");

await test("tier merges dedupe on paper identity and tier fallbacks carry no fabricated relevance (source pins)", () => {
  assert.ok(src.includes("dedupeShelfByIdentity([...scored, ...relaxed1])"),
    "the first tier merge does not dedupe on paper identity");
  assert.ok(src.includes("dedupeShelfByIdentity([...scored, ...relaxed1, ...relaxed2])"),
    "the second tier merge does not dedupe on paper identity");
  const wIdx = src.indexOf("const withScorerScore");
  const wBody = src.slice(wIdx, wIdx + 2600);
  assert.ok(wBody.includes("_unscored: true"), "the tier fallback record does not carry the unscored provenance flag");
  assert.ok(wBody.includes("relevance: null"), "the tier fallback record still receives a tier number as relevance");
  const aIdx = src.indexOf("for (const p of scoredFinal)");
  const aBody = src.slice(aIdx, aIdx + 700);
  assert.ok(aBody.includes("_unscored"), "the relevance assignment loop does not exempt unscored records");
});

await test("a paper cannot occupy the shelf twice: the handler relevance assignment keeps one reading per record", () => {
  // The assignment loop's unscored exemption is behavioral:
  // a flagged record keeps relevance null (a typed absence),
  // so no consumer can read two values for one paper.
  const rec = { title: "x", _unscored: true, _tierScore: 20 };
  assert.equal(paperRelevance(rec), -1);
  assert.equal(paperRelevanceValue(rec), null);
  assert.equal(paperIsUnscored(rec), true);
});

// ═══════════════════════════════════════════════════════════
group("L3-4 — calibrated topical floor and the near floor band");

await test("the topical gate floor is the calibrated 25, and coverage is verbosity invariant in the scorer (source pin)", () => {
  assert.equal(TOPICAL_GATE_FLOOR, 25);
  assert.ok(src.includes("Math.max(bestPhraseCoverage, overallCoverage)"),
    "core coverage still picks whichever single coverage measure the question's phrasing happens to favor");
});

await test("the band gets the second independent test, not the point threshold alone", () => {
  const inBand = { ...OIL_PAPER, topicalScore: TOPICAL_GATE_FLOOR - 5 };
  const ctx = conceptGateContext([inBand], OIL_Q, null);
  assert.equal(subjectEngagingRescue(inBand, ctx), true, "the subject engaging in band paper is not rescued");
  assert.equal(paperIsCitable(inBand, 1, ctx), true, "the in band paper that passes the second test is not citable");
  const belowBand = { ...OIL_PAPER, topicalScore: TOPICAL_GATE_FLOOR - 11 };
  assert.equal(paperIsCitable(belowBand, 1, conceptGateContext([belowBand], OIL_Q, null)), false,
    "a paper below the band became citable on the standard alone");
  const junk = {
    title: "Soil desiccation cracks in ophthalmology patients",
    abstract: "A study of soil desiccation cracks observed in a clinic garden and eye surface dryness in patients attending an ophthalmology service in a dry season.",
    topicalScore: TOPICAL_GATE_FLOOR - 5,
  };
  assert.equal(paperIsCitable(junk, 1, conceptGateContext([junk], OIL_Q, null)), false,
    "an in band paper failing the second test became citable");
});

// ═══════════════════════════════════════════════════════════
group("L3-6 — learned papers carry no invented score");

await test("the learned record mapping stamps provenance and no numbers (source pins)", () => {
  const idx = src.indexOf("learnedPapers = rows.results.map");
  assert.ok(idx > 0, "the learned record mapping was not found");
  const body = src.slice(idx, idx + 500);
  assert.ok(body.includes("_unscored: true"), "learned records do not carry the unscored flag");
  assert.ok(body.includes("_learned: true"), "learned records lost their learned marker");
  assert.ok(!/score: 95|relevance: 95|contentHits: 99/.test(body),
    "learned records still carry invented numbers: " + body.slice(0, 200));
});

await test("an unscored learned shaped record is judged on the standard alone", () => {
  const rec = { ...OIL_PAPER, _learned: true, _unscored: true };
  assert.equal(paperRelevance(rec), -1, "a number was read off the learned record");
  assert.equal(paperIsCitable(rec, 1, conceptGateContext([rec], OIL_Q, null)), true,
    "the on point learned record was discarded by a threshold it never had");
});

// ═══════════════════════════════════════════════════════════
group("L3-7 — filters are monotone, remove only");

await test("the topic filter returns empty when its test empties the set, grouped and singleton", () => {
  const junk = {
    title: "Quantum dot synthesis in colloidal suspension",
    abstract: "Quantum dots were synthesized in colloidal suspension and their optical spectra recorded across temperatures.",
    url: "https://example.com/w3-quantum",
  };
  const q = "why do some plants fold their leaves when you touch them";
  assert.deepEqual(topicOverlapFilter(q, [junk]), [], "a failing singleton was resurrected");
  const out = topicOverlapFilter(q, [junk, { ...junk, url: "https://example.com/w3-quantum-2" }]);
  assert.deepEqual(out, [], "a failing pool was resurrected");
});

await test("the composition returns empty when the organism pass empties it", () => {
  const q = "Hermetia illucens gut microbiome";
  const contaminants = ["Mealworm", "Cricket"].map((name, i) => ({
    title: name + " gut microbiome survey",
    abstract: "The gut microbiome of the " + name.toLowerCase() + " was profiled. Intestinal bacteria were catalogued across individuals.",
    url: "https://example.com/w3-contam-" + i,
  }));
  assert.deepEqual(programmaticValidationPasses(q, contaminants, null), [],
    "an emptied organism pass restored papers");
});

await test("the stamped verdict binds at the choke point with no all stamped exception (source pin)", () => {
  assert.ok(src.includes("evidencePapers = evidencePapers.filter((p) => !(p && p._filteredReason && !p.thinEvidence))"),
    "the choke point stamped filter is missing or weakened");
});

// ═══════════════════════════════════════════════════════════
group("L3-8 — the validator judges the full abstract, on explicit verdicts");

const VAL_Q = "does vitamin d help you fight off colds";
const VAL_PAPERS = () => ([
  {
    title: "Vitamin D and the common cold: a trial of cholecalciferol",
    abstract: "Background sentence one about vitamin D and respiratory infections in adults. " +
      "Background sentence two about seasonal variation in vitamin D levels and colds. ".repeat(6) +
      "DECIDING SENTENCE: cholecalciferol cut cold incidence by a third in deficient adults.",
    journal: "Lancet", year: 2021,
  },
  {
    title: "Vitamin D supplementation and respiratory infection rates",
    abstract: "Vitamin D supplementation was tested against respiratory infection rates in a pooled analysis of trials, finding fewer colds in deficient participants taking daily cholecalciferol.",
    journal: "BMJ", year: 2020,
  },
]);

await test("the validator prompt carries the full usable abstract, past character 350", async () => {
  let seen = "";
  const callImpl = async (messages) => {
    seen = JSON.stringify(messages);
    return { text: JSON.stringify([{ id: 1, verdict: "RELEVANT" }, { id: 2, verdict: "RELEVANT" }]), via: "test" };
  };
  const diag = {};
  const out = await llmValidatePapers(VAL_Q, VAL_PAPERS(), "tok", null, {}, diag, callImpl, null);
  assert.equal(out.length, 2);
  assert.ok(seen.includes("DECIDING SENTENCE"), "the validator judged from a truncated abstract");
  assert.equal(diag.llmUnvalidated, undefined, "a complete validated run was labeled unvalidated");
});

await test("a missing verdict is a stage failure: fail open, labeled incomplete", async () => {
  const callImpl = async () => ({ text: JSON.stringify([{ id: 1, verdict: "RELEVANT" }]), via: "test" });
  const diag = {};
  const out = await llmValidatePapers(VAL_Q, VAL_PAPERS(), "tok", null, {}, diag, callImpl, null);
  assert.equal(out.length, 2, "an incomplete verdict set silently dropped the unjudged paper");
  assert.equal(diag.llmValidationIncomplete, true, "the incomplete stage was not recorded");
  assert.equal(diag.llmUnvalidated, true, "the fail open was not labeled unvalidated");
});

await test("an entry with no verdict field is a stage failure, not a default relevant", async () => {
  const callImpl = async () => ({ text: JSON.stringify([{ id: 1 }, { id: 2, verdict: "RELEVANT" }]), via: "test" });
  const diag = {};
  const out = await llmValidatePapers(VAL_Q, VAL_PAPERS(), "tok", null, {}, diag, callImpl, null);
  assert.equal(out.length, 2);
  assert.equal(diag.llmValidationIncomplete, true);
});

await test("an explicit reject all returns empty: no override resurrects two papers", async () => {
  const callImpl = async () => ({ text: JSON.stringify([{ id: 1, verdict: "IRRELEVANT" }, { id: 2, verdict: "IRRELEVANT" }]), via: "test" });
  const diag = {};
  const out = await llmValidatePapers(VAL_Q, VAL_PAPERS(), "tok", null, {}, diag, callImpl, null);
  assert.deepEqual(out, [], "the reject all override resurrected papers");
});

await test("no leg at all fails open labeled, and the answer statement exists in plain words", async () => {
  const diag = {};
  const out = await llmValidatePapers(VAL_Q, VAL_PAPERS(), null, null, {}, diag, null, null);
  assert.equal(out.length, 2, "a leg less run dropped papers");
  assert.equal(diag.llmUnvalidated, true, "a leg less run was not labeled unvalidated");
  assert.ok(typeof VALIDATION_DID_NOT_RUN_STATEMENT === "string" && VALIDATION_DID_NOT_RUN_STATEMENT.length > 20);
  assert.ok(!/[-–—]/.test(VALIDATION_DID_NOT_RUN_STATEMENT), "the statement carries a dash character");
  assert.ok(src.includes("validationDiag.llmUnvalidated"), "the handler never reads the unvalidated label for the answer");
});

// ═══════════════════════════════════════════════════════════
group("L3-9 and L3-10 — one organism identity; the anchor satisfies one concept");

await test("the identity resolves both directions: binomial carries the common name and back", () => {
  const byBinomial = resolveQueryOrganism("does Hermetia illucens eat plastic");
  assert.ok(byBinomial.names.has("black soldier fly"), "the binomial form did not resolve the common name");
  assert.ok(byBinomial.names.has("hermetia"), "the binomial form did not resolve the genus");
  const byCommon = resolveQueryOrganism("what do black soldier fly larvae eat");
  assert.ok(byCommon.names.has("hermetia illucens") || byCommon.names.has("hermetia"),
    "the common name form did not resolve the binomial side");
});

await test("whole token matching: a substring inside an unrelated word is not a mention", () => {
  assert.equal(textMentionsAnyNeedle("capital flows in therapy markets", ["apis"]), false);
  assert.equal(textMentionsAnyNeedle("apis mellifera colonies were surveyed", ["apis"]), true);
  assert.equal(textMentionsAnyNeedle("black soldier fly larvae were fed", ["black soldier fly"]), true);
  assert.equal(textMentionsAnyNeedle("black flies and soldier beetles", ["black soldier fly"]), false);
});

await test("a paper naming the anchor organism once, engaging no second concept, is not carried", () => {
  const tilapia = {
    title: "Tilapia growth on insect meal diets",
    abstract: "Tilapia were fed diets containing Hermetia illucens meal as a protein source. Growth, feed conversion, and survival of the tilapia were recorded over eight weeks of feeding.",
    topicalScore: 10,
  };
  // The anchor question names the organism in its singular
  // common name form, the form the organism table keys on.
  const anchorQ = "do black soldier fly larvae turn out healthy eating used cooking oil";
  const ctx = conceptGateContext([tilapia, OIL_PAPER], anchorQ, null);
  assert.ok(ctx.anchorNeedles.length > 0, "control: the anchor needles did not resolve for the organism question");
  assert.equal(anchorCarriesPaper(tilapia, ctx), false, "the anchor alone carried a paper engaging nothing else");
  assert.equal(anchorCarriesPaper(OIL_PAPER, ctx), true, "the anchor plus a second concept did not carry");
  assert.equal(paperIsCitable(tilapia, 1, ctx), false, "the anchor only paper became citable");
});

// ═══════════════════════════════════════════════════════════
group("L3-11 — one judged set, recorded; the single concept rule adds a requirement");

await test("the standard records its judged concept set once", () => {
  const std = citationGateStandard("why is the sky blue", null);
  assert.ok(Array.isArray(std.judgedConcepts), "the standard does not record its judged set");
  assert.deepEqual(gateJudgedConcepts(std), std.judgedConcepts, "the judged set is recomputed instead of read from the record");
});

await test("single concept: abstract engagement through the concept's own vocabulary, or the subject in the title", () => {
  const q = "why do some plants fold their leaves when you touch them";
  const std = citationGateStandard(q, null);
  const onPoint = {
    title: "Thigmonastic leaf movement in Mimosa pudica",
    abstract: "Leaflets fold within seconds of mechanical stimulation. Turgor changes in the pulvinus drive the movement.",
  };
  const termSharer = {
    title: "Touch receptors in mammalian skin",
    abstract: "How touch receptors signal pressure is reviewed, with no plant material anywhere in the discussion of leaves and skin.",
  };
  assert.equal(search.paperClearsCitationGate(onPoint, std), true, "the on point paper no longer clears");
  assert.equal(search.paperClearsCitationGate(termSharer, std), false, "the word sharing paper clears on shared words alone");
});

// ═══════════════════════════════════════════════════════════
group("L3-12 and L3-13 — rerank inside the citable set; deterministic gating inputs");

await test("the gather reranks only the citable subset and records both orderings (source pins)", () => {
  assert.ok(src.includes("citableFlags"), "the rerank partition is not computed from the citable set");
  assert.ok(src.includes("rerankOrderings"), "the two orderings are not recorded");
  assert.ok(src.includes("funnel.rerankOrderings"), "the funnel does not carry the orderings");
});

await test("a live marked lookup is recomputed deterministically at the gate; an unmarked one passes through", () => {
  const q = "why do some plants fold their leaves when you touch them";
  const groups = [{ term: "leaves", alternates: ["leaflets", "foliage"] }];
  groups.via = "openrouter";
  const live = buildDynLookup(groups);
  assert.equal(live._liveModelVia, "openrouter", "the live provenance mark was not recorded");
  const gated = gateDynLookup(q, live);
  const det = buildDynLookup(buildDeterministicFallbackGroups(q, centralContentTerms(q)));
  assert.deepEqual([...gated.keys()].sort(), [...det.keys()].sort(),
    "the gate did not recompute the deterministic lookup for a live marked input");
  const unmarked = buildDynLookup([{ term: "leaves", alternates: ["leaflets"] }]);
  assert.equal(gateDynLookup(q, unmarked), unmarked, "an unmarked lookup no longer passes through");
});

// ═══════════════════════════════════════════════════════════
group("L3-14 — missing relevance is a typed absence everywhere");

await test("the confidence line names the absence instead of averaging in a 50", () => {
  const papers = [{ title: "a" }, { title: "b" }, { title: "c" }];
  const out = buildConfidenceLine(papers, { status: "supported", conflictCount: 0 }, {});
  assert.ok(out.factors.some((f) => /no relevance scores available/.test(f)),
    "the absence was not named: " + JSON.stringify(out.factors));
  assert.ok(!out.factors.some((f) => /mean relevance 50\/100/.test(f)), "a 50 was substituted for missing relevance");
  const scored = [{ title: "a", relevance: 80 }, { title: "b", relevance: 80 }, { title: "c", relevance: 80 }];
  const out2 = buildConfidenceLine(scored, { status: "supported", conflictCount: 0 }, {});
  assert.ok(out2.factors.some((f) => /mean relevance 80\/100/.test(f)), "the scored mean changed: " + JSON.stringify(out2.factors));
});

await test("the verdict guard names the absence instead of reading it as zero", () => {
  const verdict = { status: "settled", conflictCount: 0, summary: "x" };
  const rec = { ...OIL_PAPER, _unscored: true };
  const ctx = conceptGateContext([rec], OIL_Q, null);
  const out = guardSettledVerdict(verdict, [rec], ctx);
  assert.equal(out.guarded, true, "an unscored cited set passed the guard on a substituted number");
  assert.equal(out.reason, "no relevance scores in the cited set");
});

await test("the rerank leaves an unscored paper's blend a typed absence", async () => {
  const env = {
    AI: {
      run: async (model, input) => ({
        data: input.text.map((t) => t.toLowerCase().includes("unscored paper") ? [0, 1] : [1, 0]),
      }),
    },
  };
  const papers = [
    { title: "Scored paper on cold remedies", abstract: "A scored paper about cold remedies and vitamin d.", score: 80 },
    { title: "Unscored paper on cold remedies", abstract: "An unscored paper about cold remedies and vitamin d." },
  ];
  const out = await semanticRerank(env, "cold remedies", papers, {});
  assert.equal(out.semanticApplied, true);
  const unscored = out.papers.find((p) => p.title.startsWith("Unscored"));
  assert.equal(unscored.keywordScore, null, "a missing keyword score was substituted in the rerank");
  assert.equal(unscored.blendedScore, null, "a blend was computed from a substituted number");
  const scored = out.papers.find((p) => p.title.startsWith("Scored"));
  assert.equal(scored.keywordScore, 80);
});

// ═══════════════════════════════════════════════════════════
group("L3-15 — dead enforcement is gone");

await test("no disabled enforcement block and no reject all resurrection remain (source pins)", () => {
  assert.ok(!src.includes("if (false &&"), "a disabled enforcement block is still in the file");
  assert.ok(!src.includes("survivors.slice(0, 2)"), "the reject all override is still in the file");
  const tIdx = src.indexOf("export function topicOverlapFilter");
  const tBody = src.slice(tIdx, tIdx + 6000);
  assert.ok(!tBody.includes("slice(0, 3)"), "the topic filter still restores a top 3");
});

console.log("\nscoring-gating-w3: " + passed + " passed, " + failures.length + " failed");
if (failures.length > 0) {
  for (const f of failures) console.log("  FAILED: " + f);
  process.exit(1);
}
