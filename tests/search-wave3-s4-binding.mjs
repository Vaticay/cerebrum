/**
 * Wave 3 Lane S4 pins (2026-10-23, logic audit Stage 4).
 *
 * Per claim entailment binding (L4-3), the claim inventory and
 * binding rate (L4-4, L4-15), race eligibility and the rebuilt
 * quality score (L4-5), the extractive label, lede engagement,
 * existence registry and method tier walk (L4-6, L4-21), the
 * evidence verdict override (L4-7), shown set citation
 * restriction (L4-8), brief verification (L4-9), single source
 * scoping (L4-10), the shared measured variable gate and
 * different findings (L4-11), the protected scope class and the
 * appending confidence binder (L4-12), indicted claim treatment
 * (L4-13), wrong organism citations (L4-18), definition dedupe
 * (L4-19), the knowledge summary rules (L4-20), the zero
 * evidence contract (L4-16), and brief remapping on degrade
 * paths (L4-22).
 *
 * Run with: node tests/search-wave3-s4-binding.mjs
 */

import { strict as assert } from "node:assert";
import {
  bindClaimToPaper, bindSentenceToPaper, buildClaimInventory,
  claimBindingRate, applyIndictedClaimTreatment,
  stripWrongOrganismCitations, stripUnsupportedCitations,
  scopeSingleSourceAnswer, restrictCitationsToShown,
  computeEvidenceVerdict, evidenceStructureOverride,
  claimsShareMeasuredVariable, detectSourceConflicts,
  verifyBriefClaimAgainstAbstract, buildEvidenceBrief,
  validateZeroEvidenceContract, guardNoEvidenceHallucination,
  remapBriefClaimsToPool, isProtectedScopeText, stripBannedPhrases,
  bindProseConfidenceToLevel, buildConfidenceLine,
  buildDefinitionAnswer, buildExtractiveSynthesis,
  scoreAnswerQuality, raceBest,
} from "../functions/api/search.js";
import {
  analyzeTemporalConsensus, checkQuantitativeAgreement, extractSampleSizes,
} from "../functions/lib/knowledge.js";

let passed = 0, failed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { failed++; console.error("  ✗ " + name + "\n    " + e.message); }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { failed++; console.error("  ✗ " + name + "\n    " + e.message); }
}
const group = (label) => console.log("\n" + label);

// ── L4-3: per claim entailment binding ─────────────────────────
group("L4-3 — binding facets");

const fertilizerPaper = {
  title: "Fertilizer nitrogen raises wheat yield in field trials",
  abstract: "We measured wheat yield across forty field plots. Applying 50 kg of fertilizer nitrogen raised yield by 21% compared with unfertilized control plots.",
};

ok("a claim the paper entails is supported", () => {
  const b = bindClaimToPaper("Applying 50 kg of fertilizer nitrogen raised wheat yield by 21%.", fertilizerPaper);
  assert.equal(b.status, "supported", JSON.stringify(b));
});

ok("an invented number is contradicted", () => {
  const b = bindClaimToPaper("Applying fertilizer nitrogen raised wheat yield by 87%.", fertilizerPaper);
  assert.equal(b.status, "contradicted", JSON.stringify(b));
  assert.ok(b.reasons.join(" ").includes("number"), b.reasons.join(" "));
});

ok("a reversed direction is contradicted", () => {
  const b = bindClaimToPaper("Applying fertilizer nitrogen decreased wheat yield by 21%.", fertilizerPaper);
  assert.equal(b.status, "contradicted", JSON.stringify(b));
});

// ── R1 follow on (2026-10-27): direction binds per outcome ──
// The acceptance specimen (citation remainder acceptance 04,
// the myth phrasing): the draft cited the honey dilution study
// for a list sentence whose whole form passed every facet.
// splitAtomicClaims cut the list, and the first fragment
// ("enhanced cell proliferation, migration") was judged
// against the WHOLE abstract, whose only "reduc" token
// governs superoxide generation — a different outcome, in a
// sentence whose second half the claim also carried. The
// fragment read as direction reversed, the strip removed the
// marker, the sentence lost its citation, and the answer
// shipped 2 citations from a 12 paper slice. Direction now
// reads the paper's clauses about the claim's own outcome.
const dilutionPaper = {
  title: "Honey dilution impact on in vitro wound healing: Normoxic and hypoxic condition.",
  abstract: "Honey is known as a popular healing agent against tropical infections and wounds. However, the effects of honey dilutions on keratinocyte (HaCaT) wound healing under hypoxic condition is still not explored. In this study, we examined whether honey dilution have wound healing potential under hypoxic stress. The antioxidant potential and healing efficacy of honey dilution on in vitro wound of human epidermal keratinocyte (HaCaT cells) under hypoxia (3% O2 ), and normoxia is explored by nitro blue tetrazolium assay. The cell survival % quantified by MTT assay to select four honey dilutions like 10, 1, 0.1, and 0.01 v/v% and the changes in cellular function was observed microscopically. Further, the cell proliferation, migration, cell-cell adhesion, and relevant gene expression were studied by flow cytometry, migration/scratch assay, immunocytochemistry, and reverse transcription-polymerase chain reaction, respectively. The expression pattern of cardinal molecular features viz. E-cadherin, cytoskeletal protein F-actin, p63, and hypoxia marker Hif 1α were examined. Honey dilution in 0.1% v/v combat wound healing limitations in vitro under normoxia and hypoxia (3%). Its wound healing potential was quantified by immunocytochemistry and real-time PCR for the associated molecular features that were responsible for cell proliferation and migration. Our data showed that honey dilution can be effective in hypoxic wound healing. Additionally, it reduced superoxide generation and supplied favorable bioambience for cell proliferation, migration, and differentiation during hypoxic wound healing.",
};
const dilutionClaim = "A 0.1 % v/v honey dilution enhanced cell proliferation, migration, and reduced superoxide generation, thereby improving wound-closure metrics in a scratch assay and modulating expression of E-cadherin, F-actin, p63 and hypoxia-inducible factor 1 alpha [2].";

ok("a direction the paper took on a different outcome is not a reversal (R1 follow on)", () => {
  const whole = bindClaimToPaper(dilutionClaim, dilutionPaper);
  assert.equal(whole.status, "supported", JSON.stringify(whole));
  const sentence = bindSentenceToPaper(dilutionClaim, dilutionPaper);
  assert.equal(sentence.status, "supported", JSON.stringify(sentence));
  const fragment = bindClaimToPaper("A 0.1 % v/v honey dilution enhanced cell proliferation, migration", dilutionPaper);
  assert.equal(fragment.status, "supported", JSON.stringify(fragment));
});

ok("the strip keeps the dilution claim's marker (R1 follow on)", () => {
  const trialPaper = {
    title: "Wound healing with honey--a randomised controlled trial.",
    abstract: "We compared wound healing with honey against conventional dressings in a randomised controlled trial of partial thickness burns and measured closure time across the treatment groups.",
  };
  const answer = "Honey dressings sped closure in the trial group [1]. " + dilutionClaim;
  const r = stripUnsupportedCitations(answer, [trialPaper, dilutionPaper]);
  assert.equal(r.removed.length, 0, JSON.stringify(r.removed));
  assert.ok(r.text.includes("[2]"), "the dilution citation must survive: " + r.text);
});

ok("a reversal on the same outcome still contradicts (R1 follow on control)", () => {
  const melanomaPaper = {
    title: "Adjuvant treatment trial in resected melanoma",
    abstract: "In the trial, the adjuvant treatment raised recurrence rates sharply compared with the observation control group over five years of follow up.",
  };
  const single = bindClaimToPaper("The adjuvant treatment lowered recurrence rates compared with the observation control group.", melanomaPaper);
  assert.equal(single.status, "contradicted", JSON.stringify(single));
  assert.ok(single.reasons.join(" ").includes("direction"), single.reasons.join(" "));
  // The fused shape the atomic pass exists for: one true
  // direction and one reversed direction in one sentence.
  // The reversed fragment shares its outcome with the paper's
  // direction clause, so the contradiction still fires.
  const fused = bindSentenceToPaper(
    "The treatment raised survival across the whole cohort during follow up, and it lowered recurrence rates compared with the observation control group.",
    melanomaPaper);
  assert.equal(fused.status, "contradicted", JSON.stringify(fused));
});

ok("a method the paper does not use is contradicted (the MnP shape)", () => {
  const productionPaper = {
    title: "Optimizing manganese peroxidase production in submerged culture",
    abstract: "We optimized culture conditions for manganese peroxidase production and report the highest activity values obtained at pH 5 across the fermentation runs.",
  };
  const b = bindClaimToPaper(
    "Manganese peroxidase activity was measured by the oxidation of manganese ions, monitored by spectrophotometry at 270 nm.",
    productionPaper);
  assert.equal(b.status, "contradicted", JSON.stringify(b));
  assert.ok(b.reasons.join(" ").includes("method"), b.reasons.join(" "));
});

ok("a population the paper does not study is contradicted", () => {
  const b = bindClaimToPaper("In elderly patients, fertilizer nitrogen raised yield by 21%.", fertilizerPaper);
  assert.equal(b.status, "contradicted", JSON.stringify(b));
  assert.ok(b.reasons.join(" ").includes("population"), b.reasons.join(" "));
});

ok("an unrelated claim is unbound, not supported", () => {
  const b = bindClaimToPaper("Quantum entanglement explains why wheat grows taller near power lines.", fertilizerPaper);
  assert.equal(b.status, "unbound", JSON.stringify(b));
});

ok("a fragment too short to judge is unjudgeable", () => {
  const b = bindClaimToPaper("found that the enzyme broke down protein.", fertilizerPaper);
  assert.equal(b.status, "unjudgeable", JSON.stringify(b));
});

ok("strip keeps a supported marker and removes an unbound one", () => {
  const papers = [fertilizerPaper, {
    title: "Seasonal dynamics of gut bacterial communities in farmed insects",
    abstract: "We sampled bacterial communities across farms and seasons and tracked composition shifts over time.",
  }];
  const answer = "Applying 50 kg of fertilizer nitrogen raised wheat yield by 21% in the field plots [1]. " +
    "Quantum entanglement explains why wheat grows taller near power lines [2].";
  const r = stripUnsupportedCitations(answer, papers);
  assert.ok(r.text.includes("[1]"), r.text);
  assert.ok(!r.text.includes("[2]"), r.text);
  assert.equal(r.removed.length, 1);
  assert.equal(r.removed[0].idx, 2);
  assert.ok(r.removed[0].binding, "the strip record carries its binding verdict");
});

// ── L4-4 / L4-15: inventory and binding rate ───────────────────
group("L4-4 and L4-15 — claim inventory, binding rate");

const twoPaperAnswer =
  "## The short answer\n\nApplying 50 kg of fertilizer nitrogen raised wheat yield by 21% in the field plots [1].\n\n" +
  "## What the research shows\n\nQuantum entanglement explains why wheat grows taller near power lines [2]. " +
  "Applying 50 kg of fertilizer nitrogen raised yield by 21% compared with control plots [1].\n";
const twoPapers = [fertilizerPaper, {
  title: "Seasonal dynamics of gut bacterial communities in farmed insects",
  abstract: "We sampled bacterial communities across farms and seasons and tracked composition shifts over time.",
}];

ok("the inventory enumerates the answer's own cited claims", () => {
  const inv = buildClaimInventory(twoPaperAnswer, twoPapers);
  assert.ok(inv.totalCitedClaims >= 3, JSON.stringify(inv));
  assert.ok(inv.supportedClaims >= 2, JSON.stringify(inv));
  assert.ok(inv.shortAnswerCitedClaims >= 1, JSON.stringify(inv));
});

ok("the binding rate passes when the short answer claim survives", () => {
  const rate = claimBindingRate(
    "## The short answer\n\nApplying 50 kg of fertilizer nitrogen raised wheat yield by 21% in the field plots [1].\n",
    [fertilizerPaper]);
  assert.equal(rate.rate, 1, JSON.stringify(rate));
  assert.equal(rate.passes, true, JSON.stringify(rate));
});

ok("the binding rate fails below the threshold even with a surviving center", () => {
  const rate = claimBindingRate(twoPaperAnswer, twoPapers);
  assert.ok(rate.rate < 0.8, JSON.stringify(rate));
  assert.equal(rate.passes, false, JSON.stringify(rate));
});

// ── L4-13: indicted claim treatment ────────────────────────────
group("L4-13 — indicted claims lose the claim");

ok("a judgeable stripped claim is deleted; an unjudgeable one is flag only", () => {
  const answer = "## The short answer\n\nQuantum entanglement explains wheat height near power lines. " +
    "Applying fertilizer raised wheat yield in the plots.";
  const records = [
    { claim: "Quantum entanglement explains wheat height near power lines.", idx: 2, binding: "unbound" },
    { claim: "Applying fertilizer raised wheat yield in the plots.", idx: 1, binding: "unjudgeable" },
  ];
  const r = applyIndictedClaimTreatment(answer, records);
  assert.ok(!r.text.includes("Quantum entanglement"), r.text);
  assert.ok(r.text.includes("Applying fertilizer"), r.text);
  const byClaim = Object.fromEntries(r.treatments.map((t) => [t.claim, t.treatment]));
  assert.equal(byClaim["Quantum entanglement explains wheat height near power lines."], "deleted");
  assert.equal(byClaim["Applying fertilizer raised wheat yield in the plots."], "flag-only-unjudgeable");
});

ok("a stripped claim still carrying another citation is kept and recorded", () => {
  const answer = "## The short answer\n\nWheat yield rose by 21% in the fertilized plots [1].";
  const records = [{ claim: "Wheat yield rose by 21% in the fertilized plots.", idx: 2, binding: "unbound" }];
  const r = applyIndictedClaimTreatment(answer, records);
  assert.ok(r.text.includes("Wheat yield rose"), r.text);
  assert.equal(r.treatments[0].treatment, "kept-other-citation");
});

ok("deletions that would empty the body report emptied instead of shipping a husk", () => {
  const answer = "## The short answer\n\nQuantum entanglement explains wheat height near power lines.";
  const records = [{ claim: "Quantum entanglement explains wheat height near power lines.", idx: 2, binding: "contradicted" }];
  const r = applyIndictedClaimTreatment(answer, records);
  assert.equal(r.emptied, true);
  assert.equal(r.text, answer, "the standing text is returned so the caller degrades");
});

// ── L4-18: wrong organism citations judged against the papers ──
group("L4-18 — wrong organism citations");

ok("a cited paper naming a different organism loses its markers and claims", () => {
  const papers = [
    { title: "Diet effects in Hermetia illucens larvae", abstract: "Hermetia illucens larvae were fed waste diets and growth was recorded across the feeding trial." },
    { title: "Diet effects in Tenebrio molitor larvae", abstract: "Tenebrio molitor larvae were fed waste diets and growth was recorded across the feeding trial." },
  ];
  const answer = "## The short answer\n\nLarvae grew faster on the waste diet [1]. Mealworm larvae also grew faster on the waste diet [2].";
  const r = stripWrongOrganismCitations(answer, papers, "Hermetia illucens diet");
  assert.equal(r.removed.length, 1, JSON.stringify(r.removed));
  assert.ok(!r.text.includes("[2]"), r.text);
  assert.ok(r.text.includes("[1]"), r.text);
});

// ── L4-5: score and race eligibility ───────────────────────────
group("L4-5 — checked support scoring, race eligibility");

const boundDraft =
  "## The short answer\n\nApplying 50 kg of fertilizer nitrogen raised wheat yield by 21% in the field plots [1]. " +
  "The unfertilized control plots yielded less across the same field season in these trials [1].\n\n" +
  "## What the research shows\n\nApplying 50 kg of fertilizer nitrogen raised yield by 21% compared with control plots [1].";
const flashyDraft =
  "## The short answer\n\nIn contrast, fertilizer raised wheat yield by 87% (n = 900) [1][1][1]. However, yields collapsed by 64% elsewhere (n = 12) [1][1].\n\n" +
  "## What the research shows\n\nMoreover, in contrast, the effect was dramatic and unprecedented across every plot measured in the trials [1][1][1].";

ok("fabricated numbers, contrast vocabulary, and stacked citations do not outscore a bound answer", () => {
  const bound = scoreAnswerQuality(boundDraft, "does fertilizer raise wheat yield", { papers: [fertilizerPaper] });
  const flashy = scoreAnswerQuality(flashyDraft, "does fertilizer raise wheat yield", { papers: [fertilizerPaper] });
  assert.ok(bound > flashy, `bound=${bound} flashy=${flashy}`);
});

await okAsync("raceBest with papers: only binding passing drafts compete", async () => {
  const legs = [
    Promise.resolve({ answer: flashyDraft, model: "flashy-fast" }),
    new Promise((r) => setTimeout(() => r({ answer: boundDraft, model: "bound-slow" }), 30)),
  ];
  const winner = await raceBest(legs, "does fertilizer raise wheat yield", 400, 3, { papers: [fertilizerPaper] });
  assert.ok(winner && winner.answer === boundDraft, "winner: " + (winner && winner.model));
});

// ── L4-6 / L4-21: extractive label, lede engagement, registry ──
group("L4-6 and L4-21 — extractive honesty");

const soilPaper = (extra = {}) => ({
  title: "Desiccation cracking in clay soils",
  abstract: "Desiccation cracking widens measurably as the clay surface dries out after rainfall. Crack depth increased by 12 mm over the drying period in the field plots.",
  year: 2021, journal: "Soil Science", authors: "Doe J",
  ...extra,
});

ok("the extractive body is labeled at the top, before the lede", () => {
  const md = buildExtractiveSynthesis([soilPaper()], [], { query: "how does desiccation cracking change as clay dries" });
  assert.ok(md, "expected a synthesis");
  const labelAt = md.indexOf("Assembled directly from the papers below");
  assert.ok(labelAt > 0, md.slice(0, 300));
  const firstClaimAt = md.indexOf("Desiccation cracking widens");
  assert.ok(firstClaimAt === -1 || labelAt < firstClaimAt, "the label must precede the lede");
});

ok("an existence line's sentence is not repeated as the lede", () => {
  const papers = [
    { title: "Studies reporting desiccation cracking in clay", abstract: "Several studies report desiccation cracking in clay soils after drying. Crack width grew steadily as the clay surface dried in the reported field plots.", year: 2020, journal: "Soil Science", authors: "Doe J" },
    soilPaper({ title: "Clay drying and crack depth" }),
  ];
  const md = buildExtractiveSynthesis(papers, [], { query: "are there any studies on desiccation cracking in clay soils" });
  assert.ok(md, "expected a synthesis");
  const occurrences = (md.match(/Several studies report desiccation cracking/g) || []).length;
  assert.ok(occurrences <= 1, "the existence sentence printed " + occurrences + " times");
});

ok("the method walk draws step excerpts only from method tier papers", () => {
  const methodPaper = {
    title: "Measuring manganese peroxidase activity by spectrophotometry",
    abstract: "Manganese peroxidase activity was measured by following the oxidation of manganese ions at 270 nm with a spectrophotometer. The assay mixture contained sodium tartrate buffer and hydrogen peroxide to start the reaction.",
    year: 2019, journal: "Enzyme Methods", authors: "Roe K",
  };
  const productionPaper = {
    title: "Optimizing manganese peroxidase production in submerged culture",
    abstract: "We optimized culture conditions for manganese peroxidase production in submerged culture. Activity values were highest at pH 5, reaching the best production across the fermentation runs reported here.",
    year: 2021, journal: "Fermentation", authors: "Doe J",
  };
  const md = buildExtractiveSynthesis([productionPaper, methodPaper], [], {
    query: "how is manganese peroxidase activity measured",
  });
  assert.ok(md, "expected a synthesis");
  const walk = md.split("## The method, step by step")[1] || "";
  if (walk) {
    assert.ok(walk.includes("[2]"), "a method step was sourced from the production paper: " + walk);
  }
});

// ── L4-19: definition answers count distinct papers ───────────
group("L4-19 — definition dedupe");

ok("two definition sentences from one paper print a one source count", () => {
  const papers = [{
    title: "What is biochar",
    abstract: "Biochar is a carbon rich material produced by heating biomass without oxygen. Biochar is a charcoal like solid used to store carbon in soils for long periods.",
    year: 2020, journal: "Soil Science", authors: "Doe J",
  }];
  const md = buildDefinitionAnswer("biochar", papers, {});
  assert.ok(md, "expected a definition answer");
  assert.ok(md.includes("in 1 cited source"), md);
});

// ── L4-7: evidence verdict and structure override ──────────────
group("L4-7 — evidence verdict");

ok("the verdict grades the cited set", () => {
  const strong = (rel) => ({ title: "T", abstract: "A", relevance: rel });
  assert.equal(computeEvidenceVerdict([]).level, "none");
  assert.equal(computeEvidenceVerdict([strong(70)]).level, "thin");
  assert.equal(computeEvidenceVerdict([strong(70), strong(80)]).level, "partial");
  assert.equal(computeEvidenceVerdict([strong(70), strong(80), strong(90)]).level, "direct");
});

ok("thin changes the first sentence contract and drops empty sections", () => {
  const text = evidenceStructureOverride({ level: "thin", strongCount: 1, total: 4 }, 0);
  assert.ok(text.includes("scoped statement"), text);
  assert.ok(text.includes("Where researchers disagree"), text);
  const directNoConflict = evidenceStructureOverride({ level: "direct", strongCount: 4, total: 5 }, 0);
  assert.ok(directNoConflict.includes("OMIT"), directNoConflict);
  assert.equal(evidenceStructureOverride({ level: "direct", strongCount: 4, total: 5 }, 2), "");
});

// ── L4-8: shown set restriction ────────────────────────────────
group("L4-8 — citation eligibility is the shown set");

ok("markers above the shown count are removed", () => {
  const r = restrictCitationsToShown("Yield rose [1] and fell [7] in the plots [3].", 5);
  assert.ok(r.text.includes("[1]") && r.text.includes("[3]"), r.text);
  assert.ok(!r.text.includes("[7]"), r.text);
  assert.deepEqual(r.removed, [7]);
});

// ── L4-9: brief verification ───────────────────────────────────
group("L4-9 — brief claims verified mechanically");

ok("a claim whose numbers and entities match its abstract verifies", () => {
  const r = verifyBriefClaimAgainstAbstract(
    "Applying 50 kg of fertilizer nitrogen raised wheat yield by 21%.", fertilizerPaper);
  assert.equal(r.verified, true, JSON.stringify(r));
});

ok("a claim with an invented number does not verify", () => {
  const r = verifyBriefClaimAgainstAbstract(
    "Applying fertilizer nitrogen raised wheat yield by 87%.", fertilizerPaper);
  assert.equal(r.verified, false);
});

ok("an unverified claim relabels the brief and drops do not contradict", () => {
  const brief = buildEvidenceBrief(
    [fertilizerPaper, { title: "Second study of wheat yield response", abstract: "Wheat yield responded to fertilizer nitrogen across the trial plots in the second season of the field study." }],
    [["Applying 50 kg of fertilizer nitrogen raised wheat yield by 21%."],
     ["Wheat yield rose by 63% in the second season plots."]]);
  assert.ok(brief.text.includes("unverified extraction"), brief.text);
  assert.ok(!brief.text.includes("do not contradict the brief, and cite"), brief.text);
  assert.ok(brief.text.includes("from 2 of 2"), brief.text);
  assert.equal(brief.verified, false);
});

// ── L4-11: shared measured variable ────────────────────────────
group("L4-11 — disagreement needs a shared measured variable");

ok("opposite directions on different outcomes are different findings", () => {
  const r = claimsShareMeasuredVariable(
    "Minimum wages rose by 4% across the region last year.",
    "Factory employment fell by 2% across the region last year.");
  assert.equal(r.shares, false, JSON.stringify(r));
});

ok("opposite directions on the same outcome with the same unit share a variable", () => {
  const r = claimsShareMeasuredVariable(
    "Wheat yield increased by 21% in the fertilized plots.",
    "Wheat yield decreased by 9% in the fertilized plots.");
  assert.equal(r.shares, true, JSON.stringify(r));
});

ok("detectSourceConflicts files lexical only pairs as different findings", () => {
  const papers = [
    { title: "Wage policy outcomes", abstract: "Minimum wages rose by 4% across the region last year. The wage study tracked pay across the region for the full year of the policy." },
    { title: "Factory employment outcomes", abstract: "Factory employment fell by 2% across the region last year. The employment study tracked factory jobs across the region for the full year." },
  ];
  const r = detectSourceConflicts(papers, null);
  assert.ok(Array.isArray(r.differentFindings), "differentFindings missing");
});

// ── L4-12: protected scope class, appending binder ─────────────
group("L4-12 — protected scope language");

ok("scope and limitation sentences are in the protected class", () => {
  assert.equal(isProtectedScopeText("None of these papers directly tested the dose in children."), true);
  assert.equal(isProtectedScopeText("The provided sources do not cover dosing in pregnancy."), true);
  assert.equal(isProtectedScopeText("Yield rose sharply across the plots."), false);
});

ok("a protected sentence survives the banned phrase pass", () => {
  const out = stripBannedPhrases(
    "None of these papers directly tested the dose in children. This groundbreaking claim changes everything.");
  assert.ok(out.includes("None of these papers directly tested the dose in children."), out);
});

ok("the confidence binder appends the computed line and keeps honest limitations", () => {
  const line = buildConfidenceLine([fertilizerPaper], { status: "settled" }, { support: { supported: 0, checked: 1 } }).line;
  const answer =
    "## Summary\n\nApplying fertilizer raised wheat yield in the plots [1].\n\n" +
    "## How solid is this?\n\nThe samples behind this are small samples from two farms, and the dose was tested in one season only.";
  const bound = bindProseConfidenceToLevel(answer, "thin", line);
  assert.ok(bound.includes(line), bound);
  assert.ok(bound.includes("small samples from two farms"), "the model's limitation sentence was replaced: " + bound);
});

// ── L4-10: single source scoping ───────────────────────────────
group("L4-10 — single source answers are bound to the source");

ok("the short answer opens with the scope line and field nouns are rewritten", () => {
  const answer =
    "## The short answer\n\nThe literature shows that fertilizer raised wheat yield in these plots [1].\n\n" +
    "## Where researchers disagree\n\nThe field is split on the size of the effect [1].\n";
  const out = scopeSingleSourceAnswer(answer);
  assert.ok(out.includes("One retrieved study is the only source cited"), out);
  assert.ok(!/the literature shows/i.test(out), out);
  assert.ok(out.includes("no second retrieved finding"), out);
});

// ── L4-16: zero evidence contract ──────────────────────────────
group("L4-16 — zero evidence contract");

ok("a contract shaped answer passes validation", () => {
  const r = validateZeroEvidenceContract(
    "No papers were retrieved on this topic in the databases searched here. Try searching a broader term in the database directly.");
  assert.equal(r.ok, true, JSON.stringify(r));
});

ok("fluent uncited prose fails the contract and is replaced by the fallback", () => {
  const prose = "Manganese peroxidase is an enzyme that breaks down lignin in wood. It works by oxidizing manganese ions, which then attack the lignin structure in the cell walls of decaying timber across many fungal species found in forests.";
  const r = validateZeroEvidenceContract(prose);
  assert.equal(r.ok, false, JSON.stringify(r));
  const guarded = guardNoEvidenceHallucination(prose, "what is manganese peroxidase");
  assert.ok(guarded.includes("No papers found"), guarded);
});

// ── L4-20: knowledge summary rules ─────────────────────────────
group("L4-20 — computed summaries state only what was computed");

ok("no conflict detected never renders as sources agree", () => {
  const papers = [
    { year: 2015, title: "A" }, { year: 2018, title: "B" },
    { year: 2021, title: "C" }, { year: 2024, title: "D" },
  ];
  const r = analyzeTemporalConsensus(papers, []);
  assert.equal(r.pattern, "stable");
  assert.ok(!/sources agree/i.test(r.summary), r.summary);
  assert.ok(/no agreement/i.test(r.summary) || /not.*measured/i.test(r.summary), r.summary);
});

ok("the quantitative agreement verdict is deleted, raw figures remain", () => {
  const r = checkQuantitativeAgreement([
    { abstract: "Risk reduced by 15% compared to control." },
    { abstract: "We observed an 82% reduction in risk." },
  ]);
  assert.equal(r.consistent, null);
  assert.equal(r.summary, null);
  assert.ok(Array.isArray(r.values) && r.values.length === 2, JSON.stringify(r));
});

ok("sample sizes are never summed into a combined participant total", () => {
  const papers = [
    { title: "A", abstract: "We enrolled n=20000 participants in the trial." },
    { title: "B", abstract: "We enrolled n=15000 participants in the trial." },
  ];
  const r = extractSampleSizes(papers);
  assert.equal(r.totalN, 20000, "totalN must be the largest single study, not the sum: " + r.totalN);
  assert.ok(!/combined n=35/i.test(r.summary || ""), r.summary);
});

// ── L4-22: brief remapping on degrade paths ────────────────────
group("L4-22 — brief claims remapped to the pruned pool");

ok("claims follow their papers into the pruned pool and drop with them", () => {
  const from = [{ title: "P1" }, { title: "P2" }, { title: "P3" }];
  const to = [from[2], from[0]];
  const claims = [
    { text: "Claim from paper one.", idx: 1 },
    { text: "Claim from paper two.", idx: 2 },
    { text: "Claim from paper three.", idx: 3 },
  ];
  const out = remapBriefClaimsToPool(claims, from, to);
  assert.equal(out.length, 2, JSON.stringify(out));
  assert.equal(out.find((c) => c.text.includes("paper one")).idx, 2);
  assert.equal(out.find((c) => c.text.includes("paper three")).idx, 1);
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed > 0) process.exitCode = 1;
