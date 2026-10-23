/**
 * Confidence and evidence class remainder (2026-10-23, full
 * process repair Wave 3, Lane S6, logic audit Stage 6).
 *
 * Pins the Stage 6 items the confidence lane (L6-3, L6-10,
 * L6-11, in the base) did not close:
 *
 *   L6-2 (Critical). The label is a function of the support
 *   record: any countable refused claim caps below strong, a
 *   supported share under one half caps at thin, a checked
 *   count under 2 caps below strong, and the level and the
 *   line's ratio are rendered from the same computed object.
 *   Terms mode presence checks never enter the support count.
 *
 *   L6-16. Caps read the proven class of the folded set: an
 *   unclassified paper cannot lift a bottom class set, a mostly
 *   bottom class set caps at moderate, and a purely
 *   unclassified set keeps the ordinary primary reading.
 *
 *   L6-5. The score is an evidence score only (design class,
 *   study breadth, support, disagreement). Retrieval quality
 *   is reported separately on the return value, missing inputs
 *   are excluded and renormalized, never defaulted upward.
 *
 *   L6-6. The cited set is scored folded to the study level:
 *   duplicating a study cannot raise the score, and padding
 *   with bottom class studies cannot raise it either.
 *
 *   L6-7. The answer label is capped by the backing of its
 *   central claim, read through the existing central claim
 *   machinery (shortAnswerCentralClaim plus the check's own
 *   claim linkage). Marker only backing caps nothing.
 *
 *   L6-8. The headline itself is gated at ship time through
 *   the existing scope gate (scopeExistenceAnswer extended,
 *   not a second gate): universal and unqualified headline
 *   claims and single source field generalizations stand only
 *   with a supporting checked claim or a covering systematic
 *   source, and are otherwise downgraded in wording.
 *
 *   L6-9. Cached serves derive every builder input from the
 *   stored envelope signals (verdict, support, answer kind),
 *   at parity with a fresh computation on the same signals.
 *
 *   L6-12. Confidence is recomputed from the final cited set
 *   as the last assembly step when the text moved after the
 *   first computation (handler ordering, source pinned).
 *
 *   L6-13. The settled verdict guard and the zero support
 *   serve apply by answer content, not request type (handler
 *   conditions, source pinned, plus the guard's own behavior).
 *
 *   L6-14. The definition tier is inside the thin capped tier
 *   list, closed against the full answerTier set.
 *
 *   L6-15. The client autopsy panel prints the confidence line
 *   alone, one vocabulary (client source pinned).
 *
 * Run with: node tests/confidence-evidence-remainder.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const search = await import(join(root, "functions/api/search.js"));

const {
  buildConfidenceLine, calibrateConfidenceScore,
  factCheckSupport, factCheckUnsupportedCount, factCheckKind,
  evidenceClassCapping, dedupeToStudies,
  centralClaimBacking, shortAnswerCentralClaim,
  scopeExistenceAnswer, buildCachedServeTrust,
  THIN_CAPPED_TIERS,
  SINGLE_SOURCE_SCOPE_SENTENCE, UNIVERSAL_SCOPE_SENTENCE,
  HEADLINE_YES_DOWNGRADE, HEADLINE_NO_DOWNGRADE,
  RETRIEVAL_NEGATIVE_STATEMENT,
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

const Y = new Date().getFullYear();
const ABSTRACT = "A full abstract with enough wording to count as accessible support for the claims the answer makes, with methods and results reported in detail.";
function rctPaper(i, extra = {}) {
  return {
    title: "Randomized controlled trial of intervention " + i,
    abstract: ABSTRACT, relevance: 90, year: Y, type: "Journal",
    authors: "Author" + i + " A", studyTypeKey: "RCT", semanticScore: 80,
    ...extra,
  };
}
function strongShelf(n = 6) {
  return Array.from({ length: n }, (_, i) => rctPaper(i + 1));
}
const SETTLED = { status: "settled" };
const RANK = { thin: 0, moderate: 1, strong: 2 };

// ═══════════════════════════════════════════════════════════
group("L6-2 — the label is a function of the support record");

function panel(claims) {
  return { mode: "claims", checked: true, claims };
}

await test("a supported share under one half caps at thin (the after/04 shape)", () => {
  const fc = panel([
    { claim: "Claim one holds", status: "supported", sourceIndex: 1 },
    { claim: "Claim two holds", status: "thin", sourceIndex: 2 },
    { claim: "Claim three holds", status: "unsupported", sourceIndex: 3 },
  ]);
  const support = factCheckSupport(fc);
  assert.deepEqual(support, { supported: 1, checked: 3 });
  const conf = buildConfidenceLine(strongShelf(), SETTLED, {
    factCheckChecked: true, support, supportUnsupported: factCheckUnsupportedCount(fc),
  });
  assert.equal(conf.level, "thin", "1 of 3 supported shipped above thin: " + conf.line);
  assert.ok(conf.line.includes("supports 1 of 3 checked claims"), "the line lost the ratio: " + conf.line);
  // Level and ratio come from the same computed object.
  assert.deepEqual(conf.support, { supported: 1, checked: 3 });
});

await test("any countable refused claim caps below strong", () => {
  const fc = panel([
    { claim: "Claim one holds", status: "supported", sourceIndex: 1 },
    { claim: "Claim two holds", status: "supported", sourceIndex: 2 },
    { claim: "Claim three holds", status: "unsupported", sourceIndex: 3 },
  ]);
  const conf = buildConfidenceLine(strongShelf(), SETTLED, {
    factCheckChecked: true, support: factCheckSupport(fc),
    supportUnsupported: factCheckUnsupportedCount(fc),
  });
  assert.equal(conf.level, "moderate", "a refused claim shipped strong: " + conf.line);
  assert.ok(conf.score <= 74, "the below strong cap did not bind: " + conf.score);
  assert.ok(conf.line.includes("left 1 checked claim unsupported"), "the line does not name the refusal: " + conf.line);
});

await test("a one claim denominator caps below strong (the after/11 shape)", () => {
  const conf = buildConfidenceLine(strongShelf(), SETTLED, {
    factCheckChecked: true, support: { supported: 1, checked: 1 }, supportUnsupported: 0,
  });
  assert.equal(conf.level, "moderate", "1 of 1 shipped strong: " + conf.line);
  assert.ok(conf.line.includes("too few to carry a stronger label"), "the line does not name the small denominator: " + conf.line);
});

await test("a full support record at a real denominator leaves strong reachable", () => {
  const conf = buildConfidenceLine(strongShelf(), SETTLED, {
    factCheckChecked: true, support: { supported: 3, checked: 3 }, supportUnsupported: 0,
  });
  assert.equal(conf.level, "strong", "a clean record was capped: " + conf.line);
});

await test("terms mode presence checks never enter the support count", () => {
  const terms = {
    mode: "terms", checkKind: "terms", checked: true,
    claims: [{ claim: "BSFL", status: "supported" }, { claim: "HPLC", status: "unsupported" }],
  };
  assert.equal(factCheckKind(terms), "terms");
  assert.equal(factCheckSupport(terms), null, "a name presence mark became claim support");
  assert.equal(factCheckUnsupportedCount(terms), null, "a name presence mark became a refused claim");
  const conf = buildConfidenceLine(strongShelf(), SETTLED, {
    factCheckChecked: false, aiAnswer: true,
    support: factCheckSupport(terms), supportUnsupported: factCheckUnsupportedCount(terms),
  });
  assert.ok(!(conf.capReasons || []).some((r) => /claim check supports|checked claim/.test(r)),
    "a terms panel fired a support cap: " + JSON.stringify(conf.capReasons));
  assert.ok(!conf.line.includes("claim check supports"), "the line claims support from name presence: " + conf.line);
});

await test("the calibrated shipped pair still agrees after the support caps", () => {
  const fc = panel([
    { claim: "Claim one holds", status: "supported", sourceIndex: 1 },
    { claim: "Claim two holds", status: "unsupported", sourceIndex: 2 },
    { claim: "Claim three holds", status: "unsupported", sourceIndex: 3 },
  ]);
  const conf = buildConfidenceLine(strongShelf(), SETTLED, {
    factCheckChecked: true, support: factCheckSupport(fc),
    supportUnsupported: factCheckUnsupportedCount(fc),
  });
  const shipped = calibrateConfidenceScore(conf, { integrityFlags: 1 });
  const prefix = { strong: "Strong confidence", moderate: "Moderate confidence", thin: "Low confidence" }[shipped.level];
  assert.ok(shipped.line.startsWith(prefix), "line and level disagree after calibration: " + shipped.line);
  assert.equal(shipped.line, search.confidenceLineText(shipped.level, shipped.lineParts),
    "the shipped line is not the renderer output at the shipped level");
});

// ═══════════════════════════════════════════════════════════
group("L6-16 — caps read the proven class and the set composition");

function unclassifiedPaper(i) {
  return {
    title: "Larvae reared on used cooking oil substrates " + i,
    abstract: "Larvae were fed diets containing used cooking oil and growth was measured over fourteen days.",
    relevance: 88, year: Y, type: "Journal", authors: "Field" + i + " B",
  };
}

await test("an unclassified paper cannot lift a bottom class set out of the thin cap", () => {
  const set = [
    rctPaper(1, { studyTypeKey: "CASE_REPORT", title: "A case report of a rare reaction 1" }),
    rctPaper(2, { studyTypeKey: "NARRATIVE_REVIEW", title: "A narrative review of rare reactions 2" }),
    unclassifiedPaper(3),
  ];
  assert.equal(evidenceClassCapping(set[2]).rank, 1, "the unclassified paper does not count as bottom for capping");
  assert.equal(evidenceClassCapping(set[2]).classified, false);
  const conf = buildConfidenceLine(set, SETTLED, {
    factCheckChecked: true, support: { supported: 3, checked: 3 }, supportUnsupported: 0,
  });
  assert.equal(conf.level, "thin", "one unclassified paper defeated the class cap: " + conf.line);
  assert.ok(conf.line.includes("weakest evidence class"), "the class reason is not named: " + conf.line);
});

await test("a purely unclassified set keeps the ordinary primary reading", () => {
  const set = [unclassifiedPaper(1), unclassifiedPaper(2), unclassifiedPaper(3)];
  const conf = buildConfidenceLine(set, SETTLED, {
    factCheckChecked: true, support: { supported: 3, checked: 3 }, supportUnsupported: 0,
  });
  assert.equal(conf.level, "strong", "ordinary primary papers were class capped: " + conf.line);
});

await test("a mostly bottom class set caps at moderate even with a mid class paper present", () => {
  const set = [
    rctPaper(1, { studyTypeKey: "CASE_REPORT", title: "A case report of a rare reaction 1" }),
    rctPaper(2, { studyTypeKey: "CASE_REPORT", title: "A case report of a rare reaction 2" }),
    rctPaper(3, { studyTypeKey: "CASE_REPORT", title: "A case report of a rare reaction 3" }),
    rctPaper(4, { studyTypeKey: "COHORT", title: "A cohort study of the same reaction 4" }),
    unclassifiedPaper(5),
  ];
  const conf = buildConfidenceLine(set, SETTLED, {
    factCheckChecked: true, support: { supported: 3, checked: 3 }, supportUnsupported: 0,
  });
  assert.equal(conf.level, "moderate", "a mostly case level set shipped above moderate: " + conf.line);
  assert.ok(conf.line.includes("most of the cited studies are case level"), "the composition reason is not named: " + conf.line);
});

// ═══════════════════════════════════════════════════════════
group("L6-5 — the score is evidence only; retrieval is reported separately");

await test("missing inputs are excluded, never defaulted upward", () => {
  const bare = [1, 2, 3, 4].map((i) => ({
    title: "Randomized controlled trial of intervention " + i,
    abstract: ABSTRACT, studyTypeKey: "RCT", authors: "Author" + i + " A",
  }));
  const conf = buildConfidenceLine(bare, null, {});
  assert.equal(conf.retrieval.avgRelevance, null, "a missing relevance field was defaulted into a mean");
  assert.equal(conf.retrieval.newestYear, null, "a missing year was defaulted");
  assert.equal(conf.retrieval.semanticAvg, null);
  assert.equal(conf.level, "strong",
    "class and breadth alone should carry this set: " + conf.score + " / " + conf.line);
  assert.ok(!conf.factors.some((f) => /mean relevance|semantic match|newest source/.test(f)),
    "a retrieval signal still pays evidence points: " + JSON.stringify(conf.factors));
  assert.ok(conf.retrievalFactors.length > 0, "retrieval quality is not reported at all");
});

await test("retrieval signals do not move the evidence score", () => {
  const base = strongShelf(4);
  const hi = buildConfidenceLine(base.map((p) => ({ ...p, relevance: 95, semanticScore: 95 })), SETTLED, {});
  const lo = buildConfidenceLine(base.map((p) => ({ ...p, relevance: 45, semanticScore: 20 })), SETTLED, {});
  assert.equal(hi.score, lo.score, "relevance or semantic match moved the evidence score");
  const journal = buildConfidenceLine(base, SETTLED, {});
  const preprint = buildConfidenceLine(base.map((p) => ({ ...p, type: "Preprint" })), SETTLED, {});
  assert.equal(journal.score, preprint.score, "venue type still pays evidence points");
  const old = buildConfidenceLine(base.map((p) => ({ ...p, year: 2001 })), SETTLED, {});
  assert.equal(journal.score, old.score, "recency still pays evidence points");
  assert.equal(lo.retrieval.avgRelevance, 45, "the retrieval report lost the relevance mean");
});

await test("no pseudo precise confidence reaches the line at any level", () => {
  for (const conf of [
    buildConfidenceLine(strongShelf(6), SETTLED, { factCheckChecked: true, support: { supported: 3, checked: 3 }, supportUnsupported: 0 }),
    buildConfidenceLine(strongShelf(3), { status: "divided", conflictCount: 1 }, {}),
    buildConfidenceLine(strongShelf(1), { status: "thin" }, {}),
  ]) {
    assert.ok(!/\/100/.test(conf.line), "the line shows a score: " + conf.line);
    assert.ok(!/score/i.test(conf.line), "the line mentions a score: " + conf.line);
  }
});

// ═══════════════════════════════════════════════════════════
group("L6-6 — the set is scored folded to the study level");

await test("duplicating a study cannot raise the score", () => {
  const base = [rctPaper(1), rctPaper(2), rctPaper(3)];
  const dup = [...base, { ...base[0] }];
  assert.equal(dedupeToStudies(base).length, 3);
  assert.equal(dedupeToStudies(dup).length, 3, "the same study counted twice");
  const a = buildConfidenceLine(base, SETTLED, { factCheckChecked: true, support: { supported: 3, checked: 3 }, supportUnsupported: 0 });
  const b = buildConfidenceLine(dup, SETTLED, { factCheckChecked: true, support: { supported: 3, checked: 3 }, supportUnsupported: 0 });
  assert.equal(b.score, a.score, "a duplicate record raised the score");
  assert.equal(b.level, a.level);
});

await test("a preprint and journal version of one work fold to one study", () => {
  const pre = { title: "Honey dressings for venous ulcers", authors: "Smith J, Doe A", url: "https://doi.org/10.1000/pre1", abstract: ABSTRACT };
  const pub = { title: "Honey dressings for venous ulcers", authors: "Smith J, Doe A", url: "https://doi.org/10.1000/pub9", abstract: ABSTRACT };
  assert.equal(dedupeToStudies([pre, pub]).length, 1, "one study entered as two");
  const other = { title: "Honey dressings for venous ulcers", authors: "Roe K, Poe L", url: "https://doi.org/10.1000/other", abstract: ABSTRACT };
  assert.equal(dedupeToStudies([pre, other]).length, 2, "a different study was folded away on title alone");
});

await test("padding with bottom class studies cannot raise the level", () => {
  const base = [rctPaper(1), rctPaper(2), rctPaper(3)];
  const padded = [...base,
    rctPaper(7, { studyTypeKey: "CASE_REPORT", title: "A case report of a rare reaction 7" }),
    rctPaper(8, { studyTypeKey: "CASE_REPORT", title: "A case report of a rare reaction 8" }),
    rctPaper(9, { studyTypeKey: "CASE_REPORT", title: "A case report of a rare reaction 9" })];
  const ctx = { factCheckChecked: true, support: { supported: 3, checked: 3 }, supportUnsupported: 0 };
  const a = buildConfidenceLine(base, SETTLED, ctx);
  const b = buildConfidenceLine(padded, SETTLED, ctx);
  assert.ok(b.score <= a.score, "padding raised the score: " + a.score + " to " + b.score);
  assert.ok(RANK[b.level] <= RANK[a.level], "padding raised the level");
});

await test("adding an independent study of equal class can raise the score", () => {
  const ctx = { factCheckChecked: true };
  const one = buildConfidenceLine([rctPaper(1)], SETTLED, ctx);
  const two = buildConfidenceLine([rctPaper(1), rctPaper(2)], SETTLED, ctx);
  assert.ok(two.score > one.score, "a second independent trial earned nothing");
});

// ═══════════════════════════════════════════════════════════
group("L6-7 — the label is capped by the central claim's backing");

const CENTRAL_TEXT = "Honey dressings speed wound healing in chronic ulcers";
const CENTRAL_ANSWER =
  "## The short answer\n\n" + CENTRAL_TEXT + " [1].\n\n" +
  "## What the research shows\n\n" +
  "Several trials report healing times and infection outcomes across treatment and comparison groups [2].\n";

function centralPanel(status, sourceIndex) {
  return panel([{ claim: CENTRAL_TEXT, status, sourceIndex }]);
}

await test("centralClaimBacking reads the checked claim's own papers", () => {
  const pool = [rctPaper(1, { studyTypeKey: "CASE_REPORT", title: "A case report of honey dressing 1" }), rctPaper(2)];
  const backing = centralClaimBacking(CENTRAL_ANSWER, centralPanel("supported", 1), pool);
  assert.ok(backing && backing.checked, "the checked central claim was not found");
  assert.equal(backing.paperCount, 1);
  assert.equal(backing.bestCappingRank, 1);
  assert.equal(backing.bestCappingClassified, true);
});

await test("a central claim resting on case level evidence caps the answer at thin", () => {
  const pool = [rctPaper(1, { studyTypeKey: "CASE_REPORT", title: "A case report of honey dressing 1" }), rctPaper(2), rctPaper(3)];
  const conf = buildConfidenceLine(pool, SETTLED, {
    factCheckChecked: true, support: { supported: 3, checked: 3 }, supportUnsupported: 0,
    centralBacking: centralClaimBacking(CENTRAL_ANSWER, centralPanel("supported", 1), pool),
  });
  assert.equal(conf.level, "thin", "the set label exceeded the lead claim's backing: " + conf.line);
  assert.ok(conf.line.includes("the claim the answer leads with rests on"), "the central reason is not named: " + conf.line);
});

await test("a refused central claim caps the answer at thin", () => {
  const pool = strongShelf(3);
  const conf = buildConfidenceLine(pool, SETTLED, {
    factCheckChecked: true, support: { supported: 2, checked: 3 }, supportUnsupported: 1,
    centralBacking: centralClaimBacking(CENTRAL_ANSWER, centralPanel("unsupported", 1), pool),
  });
  assert.equal(conf.level, "thin", "a refused lead claim shipped above thin: " + conf.line);
  assert.ok(conf.line.includes("the claim the answer leads with was not supported"), "the refusal reason is not named: " + conf.line);
});

await test("a central claim backed only by unclassified papers caps at moderate", () => {
  const pool = [unclassifiedPaper(1), rctPaper(2), rctPaper(3)];
  const conf = buildConfidenceLine(pool, SETTLED, {
    factCheckChecked: true, support: { supported: 3, checked: 3 }, supportUnsupported: 0,
    centralBacking: centralClaimBacking(CENTRAL_ANSWER, centralPanel("supported", 1), pool),
  });
  assert.equal(conf.level, "moderate", "unproven backing carried a strong label: " + conf.line);
  assert.ok(conf.line.includes("could not be placed in an evidence class"), "the unclassified reason is not named: " + conf.line);
});

await test("marker only backing caps nothing (no checked linkage, no invented cap)", () => {
  const pool = strongShelf(3);
  const backing = centralClaimBacking(CENTRAL_ANSWER, null, pool);
  assert.ok(backing && backing.checked === false, "marker only backing read as checked");
  const conf = buildConfidenceLine(pool, SETTLED, {
    factCheckChecked: true, support: { supported: 3, checked: 3 }, supportUnsupported: 0,
    centralBacking: backing,
  });
  assert.equal(conf.level, "strong", "marker only backing capped the label: " + conf.line);
});

// ═══════════════════════════════════════════════════════════
group("L6-8 — the headline gate at ship time");

const GATE_POOL = [
  { title: "Honey dressings for venous ulcers", abstract: ABSTRACT, authors: "Smith J" },
  { title: "Honey for burns", abstract: ABSTRACT, authors: "Doe A" },
];
const EMPTY_CHECK = panel([]);

await test("a bare yes lead with no supporting checked claim is downgraded", () => {
  const answer = "## The short answer\n\nYes, honey dressings always speed healing in every chronic ulcer case [1].\n";
  const out = scopeExistenceAnswer(answer, "does honey help ulcers", GATE_POOL, { factCheck: EMPTY_CHECK });
  assert.ok(out.includes(HEADLINE_YES_DOWNGRADE), "the bare yes lead shipped unqualified: " + out);
  assert.ok(!out.includes("always speed healing"), "the unqualified claim survived: " + out);
});

await test("a bare no lead with no supporting checked claim is downgraded", () => {
  const answer = "## The short answer\n\nNo, honey dressings never help any chronic ulcer case at all [1].\n";
  const fc = panel([{ claim: "An unrelated claim about burns", status: "supported", sourceIndex: 2 }]);
  const out = scopeExistenceAnswer(answer, "does honey help ulcers", GATE_POOL, { factCheck: fc });
  assert.ok(out.includes(HEADLINE_NO_DOWNGRADE) || out.includes(RETRIEVAL_NEGATIVE_STATEMENT),
    "the bare no lead shipped unqualified: " + out);
});

await test("a supporting checked claim lets the lead stand", () => {
  const lead = "Yes, honey dressings speed healing in chronic ulcer cases";
  const answer = "## The short answer\n\n" + lead + " [1].\n";
  const fc = panel([{ claim: lead, status: "supported", sourceIndex: 1 }]);
  const out = scopeExistenceAnswer(answer, "does honey help ulcers", GATE_POOL, { factCheck: fc });
  assert.equal(out, answer, "a supported lead was downgraded: " + out);
});

await test("an unqualified universal affirmative lead is downgraded without support", () => {
  const answer = "## The short answer\n\nAll chronic ulcer patients heal faster with honey dressings on every ward [1].\n";
  const out = scopeExistenceAnswer(answer, "does honey help ulcers", GATE_POOL, { factCheck: EMPTY_CHECK });
  assert.ok(out.includes(UNIVERSAL_SCOPE_SENTENCE), "the universal lead shipped unqualified: " + out);
});

await test("a single source field generalization is scoped; a multi source one stands", () => {
  const body = "## What the research shows\n\nThe literature consistently shows that honey speeds wound healing in ulcers [1].\n";
  const scoped = scopeExistenceAnswer(body, "does honey help ulcers", GATE_POOL, { factCheck: EMPTY_CHECK });
  assert.ok(scoped.includes(SINGLE_SOURCE_SCOPE_SENTENCE), "the single source generalization shipped unscoped: " + scoped);
  const multi = "## What the research shows\n\nThe literature consistently shows that honey speeds wound healing in ulcers [1][2].\n";
  const stands = scopeExistenceAnswer(multi, "does honey help ulcers", GATE_POOL, { factCheck: EMPTY_CHECK });
  assert.equal(stands, multi, "a multi source generalization was scoped: " + stands);
});

await test("the pre check run keeps its negative only scope (headline shapes wait for the check)", () => {
  const answer = "## The short answer\n\nYes, honey dressings always speed healing in every chronic ulcer case [1].\n";
  const out = scopeExistenceAnswer(answer, "does honey help ulcers", GATE_POOL);
  assert.equal(out, answer, "the pre check gate rewrote a headline shape it cannot judge yet");
});

// ═══════════════════════════════════════════════════════════
group("L6-9 — cached serves derive every builder input from the stored signals");

const CACHE_ANSWER =
  "Wood frogs survive being frozen for weeks, with ice only outside their cells [1]. " +
  "Their hearts stop while frozen and restart after the thaw [2]. " +
  "Glucose builds up in their tissues and protects cells during the thaw [3].";
const CACHE_SOURCES = [1, 2, 3].map((i) => ({
  title: "Freeze tolerance study " + i, authors: "Frog" + i + " F",
  journal: "Cryobiology", year: Y, relevance: 92, type: "Journal",
  abstract: ABSTRACT, studyTypeKey: "RCT",
  url: "https://doi.org/10.1000/frog" + i,
}));

function freshLevelForStoredSignals({ verdict = null, factCheck = null, mode = null }) {
  const cited = CACHE_SOURCES;
  let conf = buildConfidenceLine(cited, verdict, {
    degraded: false, extractive: false,
    factCheckChecked: factCheck ? search.factCheckActuallyChecked(factCheck) : false,
    aiAnswer: mode === "ai",
    support: factCheck ? factCheckSupport(factCheck) : null,
    supportUnsupported: factCheck ? factCheckUnsupportedCount(factCheck) : null,
    provenanceOnly: factCheckKind(factCheck) === "provenance",
    existenceNegative: false,
    centralBacking: centralClaimBacking(CACHE_ANSWER, factCheck, CACHE_SOURCES),
  });
  conf = calibrateConfidenceScore(conf, {
    strippedCitations: 0, totalCitations: 3,
    integrityFlags: search.integrityFlagCount(factCheck),
  });
  return conf.level;
}

await test("parity: a stored divided verdict and zero support check cap the cached serve exactly as fresh", () => {
  const factCheck = panel([
    { claim: "Wood frogs survive being frozen for weeks", status: "unsupported", sourceIndex: 1 },
    { claim: "Their hearts stop while frozen", status: "unsupported", sourceIndex: 2 },
  ]);
  const verdict = { status: "divided", conflictCount: 1 };
  const trust = buildCachedServeTrust({
    answer: CACHE_ANSWER, sources: CACHE_SOURCES, question: "can wood frogs survive being frozen",
    degraded: false, factCheck, synthesisMode: "ai", disagreementVerdict: verdict,
  });
  const fresh = freshLevelForStoredSignals({ verdict, factCheck, mode: "ai" });
  assert.equal(trust.confidence.level, "thin", "the cached serve escaped the stored signals: " + JSON.stringify(trust.confidence));
  assert.ok(RANK[trust.confidence.level] <= RANK[fresh],
    "cached level " + trust.confidence.level + " exceeds fresh level " + fresh);
  assert.equal(trust.confidence.verdictStatus, "divided", "the stored verdict never reached the builder");
});

await test("parity: a stored settled verdict with full support reaches the fresh level", () => {
  const factCheck = panel([
    { claim: "Wood frogs survive being frozen for weeks", status: "supported", sourceIndex: 1 },
    { claim: "Their hearts stop while frozen", status: "supported", sourceIndex: 2 },
    { claim: "Glucose builds up in their tissues", status: "supported", sourceIndex: 3 },
  ]);
  const verdict = { status: "settled", conflictCount: 0 };
  const trust = buildCachedServeTrust({
    answer: CACHE_ANSWER, sources: CACHE_SOURCES, question: "can wood frogs survive being frozen",
    degraded: false, factCheck, synthesisMode: "ai", disagreementVerdict: verdict,
  });
  const fresh = freshLevelForStoredSignals({ verdict, factCheck, mode: "ai" });
  assert.equal(trust.confidence.level, fresh,
    "cached " + trust.confidence.level + " differs from fresh " + fresh + " on identical stored signals");
});

await test("the stored answer kind is derived: an unchecked stored AI answer takes the AI cap, an unrecorded one does not", () => {
  const aiTrust = buildCachedServeTrust({
    answer: CACHE_ANSWER, sources: CACHE_SOURCES, question: "can wood frogs survive being frozen",
    degraded: false, synthesisMode: "ai",
  });
  assert.equal(aiTrust.confidence.level, "thin",
    "a stored unchecked AI answer took the weaker cap: " + JSON.stringify(aiTrust.confidence));
  const legacyTrust = buildCachedServeTrust({
    answer: CACHE_ANSWER, sources: CACHE_SOURCES, question: "can wood frogs survive being frozen",
    degraded: false,
  });
  assert.equal(legacyTrust.confidence.level, "moderate",
    "an unrecorded payload changed its established unchecked band: " + JSON.stringify(legacyTrust.confidence));
});

await test("both live cache call sites pass the stored verdict to the builder", () => {
  assert.ok(/disagreementVerdict: earlyTrustSignals \? earlyTrustSignals\.disagreementVerdict/.test(src),
    "the early cache serve does not pass the stored verdict");
  assert.ok(/disagreementVerdict: laterTrustSignals \? laterTrustSignals\.disagreementVerdict/.test(src),
    "the late cache serve does not pass the stored verdict");
});

// ═══════════════════════════════════════════════════════════
group("L6-12 — confidence is computed last, from the final cited set");

await test("the handler recomputes after the binders when the text moved", () => {
  const snapshotAt = src.indexOf("const answerAtConfidenceBuild = answer;");
  const recomputeAt = src.indexOf("CONFIDENCE LAST (2026-10-23, logic audit L6-12)");
  const firstBindAt = src.indexOf("bindProseConfidenceToLevel(answer, confidence.level");
  assert.ok(snapshotAt > 0, "the pre binding snapshot is missing");
  assert.ok(recomputeAt > snapshotAt, "the recompute does not follow the first computation");
  assert.ok(firstBindAt > snapshotAt && recomputeAt > firstBindAt,
    "the recompute does not stand after the prose binder");
  const block = src.slice(recomputeAt, recomputeAt + 4000);
  assert.ok(block.includes("labelUncitedSources(sourceList, answer)"),
    "the recompute does not re derive the cited set from the final text");
  assert.ok(block.includes("buildConfidenceLine(finalCited, disagreementVerdict"),
    "the recompute does not rebuild the confidence from the final set");
});

// ═══════════════════════════════════════════════════════════
group("L6-13 — honesty guards apply by answer content, not request type");

await test("the settled verdict guard condition is the resolved standard, not the request type", () => {
  assert.ok(src.includes("verdictGateStandardResolved"), "the narrower guard condition is missing");
  const guardAt = src.indexOf("const verdictGateStandardResolved");
  const block = src.slice(guardAt, guardAt + 3000);
  assert.ok(block.includes("citedEvidencePapers.length > 0 && verdictGateStandardResolved"),
    "the guard does not run on the resolved standard condition");
  assert.ok(!/disagreementVerdict\.status === "settled"\s*&& citedEvidencePapers\.length > 0 && !isNameSearch/.test(src),
    "the old path based verdict guard exemption is still standing");
});

await test("the zero support serve has no followup exemption", () => {
  assert.ok(src.includes("if (aiOK && useEvidence && factCheckResult && factCheckAttempted)"),
    "the zero support serve condition changed shape unexpectedly");
  assert.ok(!src.includes("aiOK && useEvidence && !isFollowupMode && factCheckResult"),
    "the followup exemption is still standing on the zero support serve");
});

// ═══════════════════════════════════════════════════════════
group("L6-14 — the tier list is closed against the full answerTier set");

await test("definition is thin capped, research is not", () => {
  assert.deepEqual([...THIN_CAPPED_TIERS].sort(), ["background", "definition", "limited", "weak"]);
  const conf = buildConfidenceLine(strongShelf(4), SETTLED, {
    extractive: true, tier: "definition", factCheckChecked: true,
    support: { supported: 3, checked: 3 }, supportUnsupported: 0,
  });
  assert.equal(conf.level, "thin", "a definition answer escaped to a higher band: " + conf.line);
  assert.ok(conf.line.includes("definition assembled from source excerpts"), "the definition reason is not named: " + conf.line);
  const research = buildConfidenceLine(strongShelf(4), SETTLED, {
    tier: "research", factCheckChecked: true, support: { supported: 3, checked: 3 }, supportUnsupported: 0,
  });
  assert.equal(research.level, "strong", "the ordinary research tier was tier capped: " + research.line);
});

// ═══════════════════════════════════════════════════════════
group("L6-15 — the client renders one confidence vocabulary");

await test("the autopsy panel prints the line alone", () => {
  assert.ok(!appSrc.includes("Confidence · {t.confidence.level}"),
    "the autopsy panel still prefixes the internal level word");
  assert.ok(appSrc.includes("One vocabulary (2026-10-23, logic audit L6-15)"),
    "the one vocabulary fix is not in the client");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
