/**
 * Answer integrity lane (2026-10-21). Pins the four defects the
 * Oct 20 audit batch measured on live AI answers (audit M1, M2,
 * M3 and H3):
 *
 *   1. Fact check ran on 0 of 4 AI answers: the reserve was
 *      consumed before the stage (2 budget skips), and the deep
 *      tiers' own caps let one slow tier burn the whole stage
 *      (2 "nothing to verify" after timeouts). The zero network
 *      light tier also sat behind the same budget gate as the
 *      deep stage, so it never ran either, and the shipped
 *      confidence gate counted a mechanical flags panel as a
 *      check that ran.
 *   2. Confidence labels ignored evidence class: Strong
 *      shipped on one narrative review plus two case reports.
 *   3. The shipped source list inflated the cited set: 14
 *      listed, 3 cited, uncited filler included.
 *   4. Synthesis resilience was one family deep in the rescue
 *      paths: the rescue wave existed only inside the Groq
 *      provider's presence, and the delayed rescue could put
 *      two legs of one family in both seats.
 *
 * Run with: node tests/search-answer-integrity.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
const clientSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const search = await import(join(root, "functions/api/search.js"));

const {
  buildConfidenceLine, calibrateConfidenceScore,
  evidenceClassOfPaper, bestEvidenceClass,
  factCheckActuallyChecked, factCheckSupport,
  FACT_CHECK_RESERVE_MS, FACT_CHECK_TIER_CAP_MS, FACT_CHECK_DID_NOT_RUN_STATEMENT,
  synthesisDeadlineFor, deepFactCheck, createSubrequestLedger,
  planDelayedRescue, resetLegHealth, recordLegOutcome,
  splitShippedSources, remapCitationMarkers, remapFactCheckIndices,
  labelUncitedSources,
  isUniversalNegativeText, isFieldLevelGeneralizationText,
  isSystematicOrSurveyPaper, systematicSourceCoversClaim,
  applyUniversalClaimRuleToClaims, applyUniversalClaimRule,
  scopeExistenceAnswer, answerAssertsRetrievalNegative,
  RETRIEVAL_NEGATIVE_STATEMENT, deDash, parseDeepFactCheckJSON,
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

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function chatRes(content) {
  return jsonRes({ choices: [{ message: { content } }] });
}

// ═══════════════════════════════════════════════════════════
group("Defect 2 — confidence is tied to the cited evidence class");

// Papers with every surface signal maxed: relevance, recency,
// abstracts, journal type, settled verdict, a landed check.
// Only the evidence class varies between the sets below.
const THIS_YEAR = new Date().getFullYear();
function strongPaper(extra) {
  return {
    title: "Honey and wound healing outcomes in a controlled setting",
    abstract: "A study of honey applied to wounds, measuring healing time across treatment and control groups with full follow up and reported effect sizes.",
    relevance: 92,
    type: "journal",
    year: THIS_YEAR,
    semanticScore: 82,
    ...extra,
  };
}
const STRONG_CTX = { factCheckChecked: true, support: { supported: 3, checked: 3 } };

await test("the class ladder reads the study type data papers already carry", () => {
  assert.equal(evidenceClassOfPaper({ studyTypeKey: "SYSTEMATIC_REVIEW" }).rank, 4);
  assert.equal(evidenceClassOfPaper({ studyTypeKey: "RCT" }).rank, 3);
  assert.equal(evidenceClassOfPaper({ studyTypeKey: "COHORT" }).rank, 2);
  assert.equal(evidenceClassOfPaper({ studyTypeKey: "CASE_REPORT" }).rank, 1);
  assert.equal(evidenceClassOfPaper({ studyTypeKey: "NARRATIVE_REVIEW" }).rank, 1);
  // No key: the classifier over title and abstract decides.
  assert.equal(evidenceClassOfPaper({
    title: "Honey for acute and chronic wounds",
    abstract: "This systematic review and meta-analysis pooled randomized trials of honey dressings.",
  }).rank, 4, "a systematic review must not be read as the narrative review it is not");
  assert.equal(evidenceClassOfPaper({
    title: "A case report of honey dressing on a split skin graft",
    abstract: "We present a single patient whose graft was dressed with honey.",
  }).rank, 1);
  // An ordinary primary paper with no EBM markers is mid ladder,
  // never bottom: bench and field work is not case level evidence.
  assert.equal(evidenceClassOfPaper({
    title: "Larvae reared on used cooking oil: growth and gut microbes",
    abstract: "Larvae were fed diets containing used cooking oil and growth was measured over fourteen days.",
  }).rank, 2);
  assert.equal(bestEvidenceClass([]), null);
  assert.equal(bestEvidenceClass([{ studyTypeKey: "CASE_REPORT" }, { studyTypeKey: "RCT" }]).rank, 3,
    "the best class in the set is the rule, not the average");
});

await test("Strong is impossible when the cited set's best class is case level, regardless of count", () => {
  const bottomSet = [
    strongPaper({ studyTypeKey: "NARRATIVE_REVIEW" }),
    strongPaper({ studyTypeKey: "CASE_REPORT" }),
    strongPaper({ studyTypeKey: "CASE_REPORT" }),
  ];
  const conf = buildConfidenceLine(bottomSet, { status: "settled" }, STRONG_CTX);
  assert.equal(conf.level, "thin", "three case level papers shipped above thin: " + conf.line);
  assert.ok(conf.score <= 45, "the class cap did not bind the score: " + conf.score);
  assert.ok(conf.line.startsWith("Low confidence"), "the line does not read as the level: " + conf.line);
  assert.ok(conf.line.includes("weakest evidence class"), "the line does not name the class reason: " + conf.line);
  // Count cannot rescue it: eight bottom class papers, same rule.
  const eight = Array.from({ length: 8 }, () => strongPaper({ studyTypeKey: "CASE_REPORT" }));
  const conf8 = buildConfidenceLine(eight, { status: "settled" }, STRONG_CTX);
  assert.equal(conf8.level, "thin", "eight case level papers shipped above thin");
  // Calibration keeps the cap binding, so the object and the
  // shipped line cannot drift apart downstream.
  const calibrated = calibrateConfidenceScore(conf, { strippedCitations: 0, totalCitations: 3, integrityFlags: 0 });
  assert.equal(calibrated.level, "thin", "calibration lifted the class cap");
  assert.ok(calibrated.line.startsWith("Low confidence"), "the calibrated line disagrees with its level");
});

await test("the same signals with a top class paper in the set are not class capped", () => {
  const mixedSet = [
    strongPaper({ studyTypeKey: "SYSTEMATIC_REVIEW" }),
    strongPaper({ studyTypeKey: "CASE_REPORT" }),
    strongPaper({ studyTypeKey: "CASE_REPORT" }),
    strongPaper({}),
    strongPaper({}),
  ];
  const conf = buildConfidenceLine(mixedSet, { status: "settled" }, STRONG_CTX);
  assert.equal(conf.level, "strong", "a systematic review in the set was class capped: " + conf.line);
  assert.ok(conf.line.startsWith("Strong confidence"), "the line does not read as the level: " + conf.line);
  const primarySet = Array.from({ length: 5 }, () => strongPaper({}));
  const confPrimary = buildConfidenceLine(primarySet, { status: "settled" }, STRONG_CTX);
  assert.equal(confPrimary.level, "strong", "ordinary primary papers were class capped: " + confPrimary.line);
});

// ═══════════════════════════════════════════════════════════
group("Defect 1 — fact check budget path and the did not run statement");

await test("the reserve is 8,000 ms and synthesis still holds it back up front", () => {
  assert.equal(FACT_CHECK_RESERVE_MS, 8000);
  const now = 1000000;
  const deadline = now + 19000;
  assert.equal(synthesisDeadlineFor(now, deadline, true), deadline - 2500 - FACT_CHECK_RESERVE_MS);
  assert.equal(synthesisDeadlineFor(now, deadline, false), deadline - 2500);
});

await test("a slow first deep tier cannot burn the whole stage: the light tiers still fire inside the budget", async () => {
  const VERDICT = JSON.stringify({ claims: [
    { claim: "Air molecules scatter blue light", source_index: 1, quote: "Air molecules scatter short wavelength blue light", status: "supported", justification: "The source states the claim directly." },
    { claim: "The sky appears blue", source_index: 1, quote: "the sky appears blue", status: "supported", justification: "The source states the claim directly." },
  ] });
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("generativelanguage.googleapis.com")) {
      // The Gemini tier hangs until its own timer aborts it:
      // the fleet saturation shape from the audit batch.
      return new Promise((_, reject) => {
        const signal = opts && opts.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    }
    if (u.includes("openrouter.ai")) return chatRes(VERDICT);
    return jsonRes({});
  };
  try {
    const ledger = createSubrequestLedger();
    const trace = [];
    const t0 = Date.now();
    const claims = await deepFactCheck(
      "Air molecules scatter blue light [1]. The sky appears blue [1].",
      [{ title: "Rayleigh scattering and the colour of the sky", abstract: "Air molecules scatter short wavelength blue light far more strongly than longer wavelengths, and the sky appears blue." }],
      { GEMINI_KEY: "lane-b-gemini", OPENROUTER_KEY: "lane-b-or" },
      ledger, trace, Date.now() + FACT_CHECK_RESERVE_MS
    );
    const elapsed = Date.now() - t0;
    assert.ok(claims && claims.length === 2, "no tier landed after the first tier hung: " + JSON.stringify(trace));
    assert.ok(trace.some((t) => t.tier === "gemini" && t.outcome === "timeout"), "the hung tier is not traced as a timeout: " + JSON.stringify(trace));
    assert.ok(trace.some((t) => t.tier === "openrouter" && t.outcome === "ok"), "the last tier never fired inside the budget: " + JSON.stringify(trace));
    assert.ok(elapsed < FACT_CHECK_RESERVE_MS, "the stage outlived its own budget: " + elapsed + " ms");
    assert.ok(FACT_CHECK_TIER_CAP_MS * 3 <= FACT_CHECK_RESERVE_MS,
      "three tier slices no longer fit inside the stage budget");
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("factCheckActuallyChecked: a flags only panel is not a check that ran", () => {
  const flagsOnly = {
    overall: "partly", mode: "claims",
    summary: "Checked cited claims against their papers: 2 claims share almost no vocabulary with the paper cited.",
    claims: [
      { claim: "Some flagged sentence", status: "unsupported", kind: "alignment", note: "flag" },
      { claim: "Another flagged sentence", status: "unsupported", kind: "stripped", note: "flag" },
    ],
  };
  assert.equal(factCheckSupport(flagsOnly), null, "the flags panel produced a support count");
  assert.equal(factCheckActuallyChecked(flagsOnly), false,
    "the flags panel counted as a check that ran (the probe 9 hole)");
  const deepResult = {
    overall: "supported", mode: "claims",
    claims: [{ claim: "A checked claim", status: "supported", note: "quote" }],
  };
  assert.equal(factCheckActuallyChecked(deepResult), true);
  const traceResult = {
    overall: "traced", mode: "extractive", checked: true,
    claims: [{ claim: "A traced claim", status: "traced" }],
  };
  assert.equal(factCheckActuallyChecked(traceResult), true,
    "the extractive wording trace stopped counting as a check that ran");
  assert.equal(factCheckActuallyChecked(null), false);
  assert.equal(factCheckActuallyChecked({ claims: [] }), false);
});

await test("the handler wires the light tier outside the deep gate and states plainly when no check ran", () => {
  assert.ok(src.includes("factCheckTermsTried"), "the terms tried bookkeeping is missing");
  const deepGateIdx = src.indexOf("const deepClaims = await deepFactCheck(");
  const lightIdx = src.indexOf("LIGHT TIER OUTSIDE THE BUDGET GATE");
  assert.ok(deepGateIdx > 0 && lightIdx > deepGateIdx, "the light tier does not stand after the deep stage");
  assert.ok(src.includes("factCheckChecked: factCheckActuallyChecked(factCheckResult)"),
    "the confidence gate does not ask the one helper");
  const stmtIdx = src.indexOf("FACT_CHECK_DID_NOT_RUN_STATEMENT", src.indexOf("export const FACT_CHECK_DID_NOT_RUN_STATEMENT") + 10);
  assert.ok(stmtIdx > 0, "the did not run statement is never used in the handler");
  assert.ok(!/[—–-]/.test(FACT_CHECK_DID_NOT_RUN_STATEMENT),
    "the statement carries a dash character: " + FACT_CHECK_DID_NOT_RUN_STATEMENT);
  assert.ok(FACT_CHECK_DID_NOT_RUN_STATEMENT.includes("fact check did not run"),
    "the statement does not say plainly that the fact check did not run");
});

// ═══════════════════════════════════════════════════════════
group("Defect 3 — shipped sources are the cited set only");

await test("splitShippedSources: sources equals the cited set, uncited ship as further reading, markers remap", () => {
  const labeled = labelUncitedSources([
    { title: "Cited first", url: "https://doi.org/10.1/a" },
    { title: "Uncited pony paper from 1974", url: "https://doi.org/10.1/b", year: 1974 },
    { title: "Cited second", url: "https://doi.org/10.1/c" },
    { title: "Uncited tail paper", url: "https://doi.org/10.1/d" },
  ], "The finding holds [1] and replicates [3].");
  assert.equal(labeled.filter((s) => !s.uncited).length, 2, "fixture: the labeled cited set is not 2");
  const split = splitShippedSources(labeled, "The finding holds [1] and replicates [3].");
  assert.deepEqual(split.sources.map((s) => s.title), ["Cited first", "Cited second"],
    "the shipped sources are not exactly the cited set");
  assert.deepEqual(split.furtherReading.map((s) => s.title),
    ["Uncited pony paper from 1974", "Uncited tail paper"],
    "the uncited papers did not ship as further reading");
  assert.equal(split.answer, "The finding holds [1] and replicates [2].",
    "citation markers were not remapped to the shipped list: " + split.answer);
  // Every marker in the shipped answer resolves inside the
  // shipped sources: the client contract.
  for (const m of split.answer.matchAll(/\[(\d+)\]/g)) {
    const n = parseInt(m[1], 10);
    assert.ok(n >= 1 && n <= split.sources.length, "marker [" + n + "] resolves outside the shipped sources");
  }
});

await test("splitShippedSources: multi citation brackets remap, and a fully cited list is untouched", () => {
  const labeled = labelUncitedSources([
    { title: "A" }, { title: "B" }, { title: "C" },
  ], "Together [1] [2] [3] they show it.");
  const withGap = splitShippedSources(
    [{ title: "A" }, { title: "B", uncited: true }, { title: "C" }],
    "Together [1, 3] they show it."
  );
  assert.equal(withGap.answer, "Together [1, 2] they show it.", "a multi marker bracket did not remap: " + withGap.answer);
  assert.equal(withGap.sources.length, 2);
  assert.equal(withGap.furtherReading.length, 1);
  const full = splitShippedSources(labeled, "Together [1] [2] [3] they show it.");
  assert.equal(full.answer, "Together [1] [2] [3] they show it.", "a fully cited answer was rewritten");
  assert.equal(full.sources.length, 3);
  assert.equal(full.furtherReading.length, 0);
  assert.equal(remapCitationMarkers("see [9] and [2]", new Map([[2, 1]])), "see [9] and [1]",
    "an unmapped marker was rewritten or a mapped one was not");
});

await test("remapFactCheckIndices rewrites the panel's source references through the same map", () => {
  const fc = {
    overall: "partly", mode: "claims", summary: "Checked 1 claim against the cited sources: 0 supported.",
    claims: [{ claim: "A claim resting on [3]", status: "thin", note: "\"a quote\" [3] . the reason" }],
  };
  const out = remapFactCheckIndices(fc, new Map([[1, 1], [3, 2]]));
  assert.equal(out.claims[0].claim, "A claim resting on [2]");
  assert.equal(out.claims[0].note, "\"a quote\" [2] . the reason");
  assert.equal(fc.claims[0].claim, "A claim resting on [3]", "the original object was mutated");
});

await test("the handler and the client both ship the split contract", () => {
  assert.ok(src.includes("sources: shippedSplit.sources"), "the fresh response does not ship the cited set as sources");
  assert.ok(src.includes("furtherReading: shippedSplit.furtherReading"), "the fresh response does not ship furtherReading");
  assert.ok(src.includes("furtherReading: earlySplit.furtherReading"), "the early cache serve does not ship furtherReading");
  assert.ok(src.includes("furtherReading: laterSplit.furtherReading"), "the late cache serve does not ship furtherReading");
  assert.ok(clientSrc.includes("data.furtherReading"), "the client never reads the furtherReading field");
  assert.ok(clientSrc.includes("sources: responseSources"), "the turn does not present cited first, further reading after");
});

// ═══════════════════════════════════════════════════════════
group("Defect 4 — an independent leg is attempted before the request degrades");

const T0 = 1_700_000_000_000;
const GROQ_429 = "groq:openai/gpt-oss-120b: HTTP 429 . {\"error\":{\"message\":\"Rate limit reached for model in organization\"}}";

await test("planDelayedRescue: the second seat goes to a different provider family when one is eligible", () => {
  resetLegHealth();
  const attempts = [{ wave: 1, model: "groq:openai/gpt-oss-120b", ok: false, error: GROQ_429 }];
  const plan = planDelayedRescue(attempts, {
    rosterLabels: ["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b", "gemini:gemini-3.8-flash"],
    preferredLabel: "groq:openai/gpt-oss-120b",
    nowMs: T0,
    requestDeadlineMs: T0 + 120000,
  });
  assert.equal(plan.action, "wait");
  assert.deepEqual(plan.chosen, ["groq:openai/gpt-oss-120b", "gemini:gemini-3.8-flash"],
    "the delayed rescue seats are not independent: " + JSON.stringify(plan.chosen));
});

await test("planDelayedRescue: with no independent leg eligible, the best tracked same family leg keeps the seat", () => {
  resetLegHealth();
  recordLegOutcome("groq:qwen/qwen3.8-27b", true, null, T0);
  recordLegOutcome("groq:qwen/qwen3.8-27b", true, null, T0);
  const attempts = [{ wave: 1, model: "groq:openai/gpt-oss-120b", ok: false, error: GROQ_429 }];
  const plan = planDelayedRescue(attempts, {
    rosterLabels: ["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b", "groq:qwen/qwen3.8-27b"],
    preferredLabel: "groq:openai/gpt-oss-120b",
    nowMs: T0,
    requestDeadlineMs: T0 + 120000,
  });
  assert.equal(plan.action, "wait");
  assert.deepEqual(plan.chosen, ["groq:openai/gpt-oss-120b", "groq:qwen/qwen3.8-27b"],
    "the all one family fallback changed: " + JSON.stringify(plan.chosen));
});

await test("the rescue wave roster is no longer nested inside the Groq provider's presence", () => {
  assert.ok(!src.includes("if (groqProvider) {"), "the rescue wave is still gated on the Groq provider alone");
  assert.ok(src.includes("const rescueCall = groqProvider ? callCompat(groqProvider) : null;"),
    "the rescue call is not built conditionally per family");
  assert.ok(src.includes("...(rescueCall ? [{ label: \"groq:openai/gpt-oss-120b\""),
    "the Groq rescue legs are not conditional on their own family");
  assert.ok(src.includes("if (rescueCall || cfBound || token) {"),
    "the rescue does not fire on whichever family is available");
});

// ══════════════════════════════════════════════════════════════════════════
group("Answer integrity repair (2026-10-22) — universal claims and retrieval scope");

/* The owner's exported answer, 2026-10-22. To an existence
   question, the short answer asserted a field wide negative
   resting on ONE cited primary paper (a thermophilic consortium
   study), and the claim check shipped "supports 1 of 1 checked
   claim": it had verified the negative against that one paper,
   which indeed does not perform the comparison. One paper not
   doing X cannot support "no paper does X". The fixtures below
   reproduce that exact case shape. */
const OWNER_QUERY = "Are there any primary research papers that compares the ratio of metagenomics to metatranscriptomics reads of organisms in order to get a sense of abundance:relative gene expression?";
const OWNER_CLAIM = "No primary research paper in the supplied literature directly compares the ratio of metagenomics to metatranscriptomics reads of organisms to infer abundance relative gene expression";
const xiaLike = {
  title: "Metagenomics of a thermophilic bacterial consortium for cellulose degradation",
  abstract: "A thermophilic consortium was enriched on cellulose. Community composition was profiled by 16S sequencing and metagenomic reads.",
  year: 2014, type: "Journal Article", source: "pubmed", journal: "PLoS ONE", relevance: 61,
};
const systematicSurvey = {
  title: "Systematic review of paired metagenome and metatranscriptome read ratio studies",
  abstract: "This systematic review surveys primary studies that compare metagenomics reads with metatranscriptomics reads of organisms to infer abundance and relative gene expression, and catalogues the ratio methods used.",
  year: 2023, type: "Systematic Review", source: "pubmed", journal: "Nucleic Acids Research", relevance: 88,
};

await test("the universal negative detector matches the flagged shapes and spares specifics and caveats", () => {
  assert.equal(isUniversalNegativeText(OWNER_CLAIM), true, "owner claim not detected");
  assert.equal(isUniversalNegativeText("The retrieved literature does not contain any study that reports both data types from the same samples"), true);
  assert.equal(isUniversalNegativeText("No study has measured this enzyme in soil samples"), true);
  assert.equal(isUniversalNegativeText(RETRIEVAL_NEGATIVE_STATEMENT), false, "the canonical honest form must not flag itself");
  assert.equal(isUniversalNegativeText("That is not proof that none exists."), false, "a caveat denying the assertion flagged");
  assert.equal(isUniversalNegativeText("None of the patients in the cohort developed antibodies."), false, "a within study finding flagged");
  assert.equal(isUniversalNegativeText("The trial found no significant difference in survival between arms."), false, "an ordinary negative finding flagged");
  assert.equal(isUniversalNegativeText("Xia et al. describe a consortium enriched on cellulose [1]."), false);
  assert.equal(isFieldLevelGeneralizationText("The literature consistently shows that sleep restriction impairs working memory."), true);
  assert.equal(isFieldLevelGeneralizationText("One 2019 trial showed that sleep restriction impairs working memory."), false);
});

await test("the exact case: one non systematic source cannot support the universal negative", () => {
  const deepClaims = [{
    claim: OWNER_CLAIM, status: "supported", sourceIndex: 1,
    quote: "Community composition was profiled by 16S sequencing and metagenomic reads",
    justification: "The cited paper does not compare metagenome to metatranscriptome read ratios.",
  }];
  const corrected = applyUniversalClaimRuleToClaims(deepClaims, [xiaLike]);
  assert.notEqual(corrected, deepClaims, "the rule did not fire on the exact case shape");
  assert.equal(corrected[0].status, "unsupported", "universal negative still supported by one primary paper");
  assert.equal(corrected[0].kind, "universal");
  assert.match(corrected[0].justification, /Requires systematic evidence/);
  // The finished panel object recounts: supports 0 of 1, never 1 of 1.
  const panel = {
    overall: "supported", mode: "claims",
    summary: "Checked 1 claim against the cited sources: 1 supported, 0 thin, 0 unsupported.",
    claims: [{ claim: OWNER_CLAIM, status: "supported", note: "\"Community composition was profiled\" [1] . The paper does not do this." }],
  };
  const ruled = applyUniversalClaimRule(panel, [xiaLike]);
  assert.equal(ruled.claims[0].status, "unsupported");
  assert.equal(ruled.overall, "unsupported");
  assert.equal(ruled.summary, "Checked 1 claim against the cited sources: 0 supported, 0 thin, 1 unsupported.");
  assert.deepEqual(factCheckSupport(ruled), { checked: 1, supported: 0 });
});

await test("a systematic survey whose scope covers the claim may carry it", () => {
  assert.equal(isSystematicOrSurveyPaper(systematicSurvey), true);
  assert.equal(isSystematicOrSurveyPaper(xiaLike), false);
  assert.equal(systematicSourceCoversClaim(systematicSurvey, OWNER_CLAIM), true);
  assert.equal(systematicSourceCoversClaim(xiaLike, OWNER_CLAIM), false);
  const claims = [{ claim: OWNER_CLAIM, status: "supported", sourceIndex: 2, quote: "q", justification: "j" }];
  const out = applyUniversalClaimRuleToClaims(claims, [xiaLike, systematicSurvey]);
  assert.equal(out, claims, "the systematic exception did not hold");
  // A systematic review on an unrelated topic standing elsewhere in the answer does not qualify.
  const offTopic = { ...systematicSurvey, title: "Systematic review of honey for wound healing", abstract: "Trials of honey dressings for burns and ulcers." };
  const claims2 = [{ claim: OWNER_CLAIM, status: "supported", sourceIndex: 1, quote: "q", justification: "j" }];
  const out2 = applyUniversalClaimRuleToClaims(claims2, [xiaLike, offTopic]);
  assert.equal(out2[0].status, "unsupported", "an off scope systematic review carried the claim");
});

await test("field level generalizations rest on more than one source or fall", () => {
  const claim = "The literature consistently shows that honey speeds wound healing";
  const single = [{ claim, status: "supported", sourceIndex: 1, quote: "q", justification: "j" }];
  assert.equal(applyUniversalClaimRuleToClaims(single, [xiaLike])[0].status, "unsupported");
  const multi = [{ claim, status: "supported", quote: "q", justification: "j" }];
  assert.equal(applyUniversalClaimRuleToClaims(multi, [xiaLike, systematicSurvey]), multi,
    "a multi source generalization was corrected");
  // The provenance wording trace never claimed support and is untouched.
  const prov = { overall: "supported", mode: "terms", summary: "s", claims: [{ claim: "doxycycline", status: "supported", note: "" }] };
  assert.equal(applyUniversalClaimRule(prov, [xiaLike]), prov);
});

await test("the scope guard rewrites an AI existence answer to the retrieval statement", () => {
  const answer = [
    "## The short answer", "",
    "No primary research paper in the supplied literature directly compares the ratio of metagenomics to metatranscriptomics reads of organisms to infer abundance relative gene expression [1].", "",
    "## What the research shows", "",
    "Xia et al. (2014) describe a thermophilic consortium enriched on cellulose. The available study does not present a per organism read count ratio.", "",
    "## Where researchers disagree", "",
    "The retrieved literature does not contain any study that reports both data types from the same samples, so no disagreement can be identified from it.",
  ].join("\n");
  const out = scopeExistenceAnswer(answer, OWNER_QUERY);
  assert.ok(out.includes(RETRIEVAL_NEGATIVE_STATEMENT), "canonical retrieval statement missing");
  assert.ok(!out.includes("No primary research paper"), "the field wide negative survived");
  assert.ok(!out.includes("does not contain any study"), "the disagreement restatement survived");
  assert.ok(out.includes("The available study does not present a per organism read count ratio."),
    "a statement about one specific paper was rewritten");
  assert.ok(out.includes(RETRIEVAL_NEGATIVE_STATEMENT + " [1]"), "the citation was dropped from the rewritten sentence");
  // L4-2: the gate is not existence shape limited. A content
  // question's answer asserting the same negative is rewritten
  // too, and a negative a retrieved systematic survey supports
  // within its scope stands.
  const contentOut = scopeExistenceAnswer(answer, "what is the ratio of metagenome to metatranscriptome reads");
  assert.ok(contentOut.includes(RETRIEVAL_NEGATIVE_STATEMENT), "a content question's universal negative was not scoped");
  const clean = "Fungi secrete enzymes that break lignin into smaller fragments [1].";
  assert.equal(scopeExistenceAnswer(clean, "how do fungi break down lignin"), clean,
    "an answer with no universal negative was rewritten");
  assert.equal(scopeExistenceAnswer("Yes. Franzosa et al. report paired ratios [1].", OWNER_QUERY),
    "Yes. Franzosa et al. report paired ratios [1].", "a positive answer was rewritten");
  const surveyBacked = "## The short answer\n\nNo primary research paper in the supplied literature directly compares the ratio of metagenomics to metatranscriptomics reads of organisms to infer abundance relative gene expression [1].";
  assert.equal(scopeExistenceAnswer(surveyBacked, OWNER_QUERY, [systematicSurvey]), surveyBacked,
    "a systematic survey backed negative was rewritten");
});

await test("a retrieval negative answer is capped low whatever the shelf looks like", () => {
  assert.equal(answerAssertsRetrievalNegative("Short answer: " + RETRIEVAL_NEGATIVE_STATEMENT, OWNER_QUERY), true);
  assert.equal(answerAssertsRetrievalNegative("None of the retrieved papers report this practice directly.", OWNER_QUERY), true);
  assert.equal(answerAssertsRetrievalNegative("Yes, paired ratios are reported [1].", OWNER_QUERY), false);
  const strong = [0, 1, 2].map((i) => ({
    title: "Paper " + i, year: 2025, type: "Journal Article", source: "pubmed", relevance: 92,
  }));
  const ctx = { support: { supported: 3, checked: 3 }, factCheckChecked: true, claimExtractionRatio: 1 };
  const plain = buildConfidenceLine(strong, { status: "settled" }, ctx);
  assert.equal(plain.level, "strong", "fixture shelf is not strong: " + plain.level);
  const capped = buildConfidenceLine(strong, { status: "settled" }, { ...ctx, existenceNegative: true });
  assert.ok(capped.score <= 45, "retrieval negative not capped: " + capped.score);
  assert.ok(["thin", "low"].includes(capped.level), "capped level is not low band: " + capped.level);
  assert.ok(capped.capReasons.some((r) => /not proof that no paper exists/.test(r)),
    "cap reason missing: " + JSON.stringify(capped.capReasons));
});

await test("deDash maps the model's Unicode compound hyphens to ASCII at the ship point", () => {
  const out = deDash("a cellulose\u2011degrading consortium with read\u2011ratios");
  assert.equal(out, "a cellulose-degrading consortium with read-ratios");
  assert.ok(!out.includes("\u2011"), "U+2011 survived deDash");
  assert.equal(deDash("soft\u00ADhyphen"), "softhyphen", "soft hyphen not dropped");
  assert.ok(src.includes("applyUniversalClaimRule(factCheckResult, evidencePapers)"), "panel backstop not wired");
  assert.ok(src.includes("scopeExistenceAnswer(answer, query, evidencePapers)"), "scope guard not wired in the handler");
  assert.ok(src.includes("applyUniversalClaimRuleToClaims(attributed, evidencePapers)"), "deep construction does not apply the rule");
  assert.ok(src.includes("UNIVERSAL CLAIMS RULE"), "deep fact check prompt lacks the universal claims rule");
});

await test("the rule lives in the prompts that actually serve, not only the full prompt (L4-1)", () => {
  // The full prompt is assembled but no serving leg fires with
  // it: waves 1 and 2 and both rescues race on compactMessages,
  // wave 3 on bulletproofMessages. A safeguard present only in
  // the full prompt (or in the enforcer appended to it) is dead
  // code. Both serving systems must carry the canonical negative.
  const canonical = "I could not find one in the papers retrieved here. That is not proof that none exists.";
  const compactStart = src.indexOf("const compactSystem");
  const compactEnd = src.indexOf("const compactUser", compactStart);
  assert.ok(compactStart > 0 && compactEnd > compactStart, "compact system not found");
  assert.ok(src.slice(compactStart, compactEnd).includes(canonical),
    "the compact prompt (waves 1 and 2, rescues) lacks the existence rule");
  const bpStart = src.indexOf("const bulletproofSystem");
  const bpEnd = src.indexOf("const bulletproofUserContent", bpStart);
  assert.ok(bpStart > 0 && bpEnd > bpStart, "bulletproof system not found");
  assert.ok(src.slice(bpStart, bpEnd).includes(canonical),
    "the bulletproof prompt (wave 3) lacks the existence rule");
  assert.ok(src.includes("callOR(m, compactMessages") || src.includes("compactMessages, maxTokens"),
    "wave legs no longer fire on the compact prompt this test assumes");
  assert.ok(src.includes("bulletproofMessages"), "wave 3 no longer fires on the bulletproof prompt this test assumes");
});

await test("claim type is assigned by code at extraction, before any verdict is read (L5-2)", () => {
  const raw = JSON.stringify({ claims: [
    { claim: OWNER_CLAIM, status: "supported", justification: "The cited paper does not perform this comparison.", quote: "q", source_index: 1 },
    { claim: "Chung et al. counted DNA and RNA reads per taxon", status: "supported", justification: "Stated in the abstract.", quote: "q", source_index: 1 },
  ] });
  const claims = parseDeepFactCheckJSON(raw);
  assert.ok(Array.isArray(claims) && claims.length === 2, "parser did not return both claims");
  assert.equal(claims[0].kind, "universal", "the universal negative was not typed at extraction");
  assert.equal(claims[1].kind, undefined, "an ordinary claim was typed universal");
  // And the typed claim still cannot be ratified by the
  // checker's own supported verdict against a single source.
  const ruled = applyUniversalClaimRuleToClaims(claims, [xiaLike]);
  assert.equal(ruled[0].status, "unsupported");
  assert.equal(ruled[1].status, "supported");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
