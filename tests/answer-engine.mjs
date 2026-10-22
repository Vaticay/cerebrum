/**
 * Answer-engine overhaul regressions (v6.3).
 *
 * From a real production failure on the query "Why does soil crack into
 * patterns as it dries?":
 *   1. Bibliography items 1 and 2 were the SAME paper — one record with a
 *      DOI, one without. Single-key dedupe never matched them.
 *   2. Wave-4 printed the same claim twice with [1] and [2].
 *   3. Wave-4's lede was keyword soup: "The 12 sources below converge on
 *      crack and patterns and soil."
 *   4. Irrelevant papers (glaucoma surgery, EMI shielding) were cited.
 *   5. Answer said 12 sources; Sources panel said 11.
 *
 * Unit tests against the real exports (no server, no network) plus
 * structural assertions over both source files.
 *
 * Run with: node tests/answer-engine.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import {
  dedupePapers,
  normalizePaperTitle,
  applyRelevanceGate,
  paperRelevance,
  RELEVANCE_FLOOR,
  fingerprintClaim,
  buildExtractiveSynthesis,
  assessExtractionQuality,
  isWellFormedClaim,
  // NEXT-GEN resilience pipeline (v7.0)
  runStage,
  extractPaperClaims,
  detectSourceConflicts,
  verifyExtractiveAlignment,
  postCheckAIAlignment,
  stripUnsupportedCitations,
  reattachAuthorCitations,
  extractBinomial,
  buildEvidenceGaps,
  buildConfidenceLine,
  buildCoverageNote,
  buildFalsificationBullets,
  deriveReformulations,
  detectAmbiguity,
  buildNoResultsPayload,
  renderNoResultsAnswer,
  retrievalStrategiesTried,
  labelUncitedSources,
  // Prompt-leak guard (2026-09-12 incident)
  isPromptLeak,
  assertValidProviderText,
  // Answer cleanup: leaked meta commentary strip (paragraph aware)
  stripLeakedMetaCommentary,
} from "../functions/api/search.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];
// Every test() call registers a promise; the suite awaits ALL of them
// before printing the tally. (Without this, a synchronously-failing test
// records its failure before the async continuations of the passing tests
// run, and process.exit(1) murders the rest — the tally lies.)
const pending = [];

function test(name, fn) {
  pending.push((async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failures.push({ name, error: e });
      console.log(`  ✗ ${name}\n      ${String(e && e.message || e).split("\n")[0]}`);
    }
  })());
}

function group(name) {
  console.log(`\n${name}`);
}

const searchSrc = await readFile(join(root, "functions/api/search.js"), "utf8");
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const apiSrc = await readFile(join(root, "functions/api/search.js"), "utf8");
// sourceKeys was extracted to src/textUtils.js in the monolith split (2e45fa4);
// the accumulator behavior in CerebrumApp.jsx is unchanged.
const textUtilsSrc = await readFile(join(root, "src/textUtils.js"), "utf8").catch(() => "");

// ══════════════════════════════════════════════════════════════════════════
group("dedupePapers — multi-key identity (the [1]/[2] duplicate)");

test("same paper, one record with DOI and one without, dedupes to one", () => {
  const withDoi = {
    title: "Desiccation cracking of soils: an experimental study",
    doi: "10.1016/j.enggeo.2020.105412",
    url: "https://doi.org/10.1016/j.enggeo.2020.105412",
  };
  const withoutDoi = {
    title: "Desiccation cracking of soils: An experimental study.",
    url: "https://www.sciencedirect.com/science/article/pii/S0013795220304120",
  };
  const out = dedupePapers([withDoi, withoutDoi]);
  assert.equal(out.length, 1);
});

test("DOI field vs DOI embedded in URL dedupes", () => {
  const a = { title: "X", doi: "10.1000/xyz123", url: "https://publisher.org/paper" };
  const b = { title: "X", url: "https://doi.org/10.1000/xyz123" };
  assert.equal(dedupePapers([a, b]).length, 1);
});

test("DOI with trailing citation punctuation matches the clean DOI", () => {
  const a = { title: "X", doi: "10.1000/xyz123." };
  const b = { title: "X", doi: "10.1000/xyz123" };
  assert.equal(dedupePapers([a, b]).length, 1);
});

test("arXiv v1 vs v2, and /abs/ vs /pdf/, are one preprint", () => {
  const a = { title: "X", url: "https://arxiv.org/abs/2401.12345v1" };
  const b = { title: "X", url: "https://arxiv.org/pdf/2401.12345v2" };
  assert.equal(dedupePapers([a, b]).length, 1);
});

test("PMID field vs PubMed URL dedupes", () => {
  const a = { title: "X", pmid: "12345678" };
  const b = { title: "X", url: "https://pubmed.ncbi.nlm.nih.gov/12345678/" };
  assert.equal(dedupePapers([a, b]).length, 1);
});

test("two genuinely different papers both survive", () => {
  const a = { title: "Soil cracking under desiccation", doi: "10.1000/aaa" };
  const b = { title: "Microbial activity in drying soils", doi: "10.1000/bbb" };
  assert.equal(dedupePapers([a, b]).length, 2);
});

test("order is preserved: first record wins", () => {
  const a = { title: "Soil cracking", doi: "10.1000/aaa", journal: "J1" };
  const b = { title: "Soil cracking", journal: "J2" };
  const out = dedupePapers([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].journal, "J1");
});

test("records with no identifiers at all are kept, never dropped blindly", () => {
  const a = { abstract: "Something without any identifiers." };
  assert.equal(dedupePapers([a]).length, 1);
});

// ── Title twins (2026-10-14, fifth panel, Job 2d) ──────────────
// The panel shipped "Stomach Upset" (Scientific American, 2017)
// and "Stomach upset" (New Scientist, 2007) side by side: same
// story, two outlets, different years and different DOIs, so the
// year based core rule and the title key rule both let the pair
// through — outlet copies of one wire story mint their own DOIs.
// The twin rule merges on the normalized main title when the
// surnames do not conflict and the abstracts are compatible.
// The DOI evidence grades compatibility: differing DOIs on both
// sides demand abstract proof, while a non conflicting DOI lets
// a missing abstract or an equal year carry the merge; the core
// rule above keeps its own DOI veto untouched.
const WIRE_ABSTRACT =
  "A stomach upset after a rich meal is usually harmless and settles within a day. " +
  "Doctors advise small sips of water, rest, and bland food until the stomach calms, " +
  "and warn that vomiting with fever or blood needs urgent care from a clinician.";

test("title twins: same title, different outlets, years and DOIs collapse to one", () => {
  const a = {
    title: "Stomach Upset", doi: "10.1000/sa2017", year: 2017,
    journal: "Scientific American", authors: "Smith J", abstract: WIRE_ABSTRACT,
  };
  const b = {
    title: "Stomach upset", doi: "10.1000/ns2007", year: 2007,
    journal: "New Scientist", authors: "Smith, John",
    abstract: WIRE_ABSTRACT.replace("usually harmless", "generally harmless"),
  };
  const out = dedupePapers([a, b]);
  assert.equal(out.length, 1, "the wire copy pair shipped twice");
  assert.equal(out[0].journal, "Scientific American", "the first record must win");
});

test("title twins: a conflicting first author surname keeps both records", () => {
  const a = {
    title: "Stomach Upset", doi: "10.1000/sa2017", year: 2017,
    authors: "Smith J", abstract: WIRE_ABSTRACT,
  };
  const b = {
    title: "Stomach upset", doi: "10.1000/ns2007", year: 2007,
    authors: "Jones A", abstract: WIRE_ABSTRACT,
  };
  assert.equal(dedupePapers([a, b]).length, 2,
    "same title with different authors is two works, not a twin");
});

test("title twins: disjoint abstracts keep both records", () => {
  const a = {
    title: "Stomach Upset", doi: "10.1000/sa2017", year: 2017,
    authors: "Smith J", abstract: WIRE_ABSTRACT,
  };
  const b = {
    title: "Stomach upset", doi: "10.1000/qc2007", year: 2007,
    authors: "Smith J",
    abstract: "Quantum error correction thresholds for surface codes under realistic noise models, with simulations of logical qubit lifetimes across lattice sizes.",
  };
  assert.equal(dedupePapers([a, b]).length, 2,
    "same title and author with unrelated abstracts is not one work");
});

test("title twins: a missing abstract merges only when the DOIs do not conflict", () => {
  const a = {
    title: "Stomach Upset", doi: "10.1000/sa2017", year: 2017,
    authors: "Smith J", abstract: WIRE_ABSTRACT,
  };
  // No DOI on the abstract less record: nothing vetoes, and a
  // missing abstract cannot disprove the twin.
  const b = { title: "Stomach upset", year: 2007, authors: "Smith J", url: "https://www.newscientist.com/article/stomach-upset" };
  assert.equal(dedupePapers([a, b]).length, 1);
  // The same shape with a DIFFERENT DOI on the abstract less
  // record stays two: two different DOIs on one title are two
  // papers unless the abstracts prove otherwise (the answer
  // package suite's pinned contract).
  const c = { title: "Stomach upset", doi: "10.1000/ns2007", year: 2007, authors: "Smith J" };
  assert.equal(dedupePapers([a, c]).length, 2);
});

test("normalizePaperTitle is case/punctuation/whitespace insensitive", () => {
  assert.equal(
    normalizePaperTitle("Soil Cracking: Patterns, Mechanisms!"),
    normalizePaperTitle("soil   cracking patterns mechanisms")
  );
});

// ══════════════════════════════════════════════════════════════════════════
group("applyRelevanceGate — the citation floor");

test("RELEVANCE_FLOOR is 50 (strong + top of partial survive)", () => {
  // Lowered from 60 to 50 on 2026-10-11 (650bad1) for multi-concept
  // queries; the floor value is deliberate, not drift.
  assert.equal(RELEVANCE_FLOOR, 50);
});

test("papers at or above 50 survive; below 50 never enter synthesis", () => {
  const papers = [
    { title: "A", relevance: 82 },
    { title: "B", relevance: 50 },
    { title: "C", relevance: 49.9 },
    { title: "D", relevance: 45 },
    { title: "E", relevance: 12 },
  ];
  const out = applyRelevanceGate(papers);
  assert.deepEqual(out.map((p) => p.title), ["A", "B"]);
});

test("missing, null, NaN, or non-numeric relevance counts as below the floor", () => {
  const papers = [
    { title: "A" },
    { title: "B", relevance: null },
    { title: "C", relevance: NaN },
    { title: "D", relevance: "high" },
    { title: "E", relevance: 90 },
  ];
  const out = applyRelevanceGate(papers);
  assert.deepEqual(out.map((p) => p.title), ["E"]);
});

test("paperRelevance returns -1 for unscored papers, the number otherwise", () => {
  assert.equal(paperRelevance({}), -1);
  assert.equal(paperRelevance({ relevance: null }), -1);
  assert.equal(paperRelevance({ relevance: 72 }), 72);
});

// ══════════════════════════════════════════════════════════════════════════
group("buildExtractiveSynthesis — Wave-4 never repeats, never soups");

const SOIL_ABSTRACT =
  "We found that desiccation crack spacing increased linearly with layer thickness across 34 experiments. " +
  "Crack patterns showed that polygonal networks formed in 89% of samples dried below 12% moisture. " +
  "The study demonstrated that tensile stress exceeded 45 kPa before failure in all tested clays.";

function soilPaper(extra = {}) {
  return {
    title: "Desiccation cracking of clay soils: pattern formation",
    journal: "Geotechnique",
    year: "2021",
    abstract: SOIL_ABSTRACT,
    relevance: 85,
    ...extra,
  };
}

function fingerprintAll(text) {
  return text
    .split("\n")
    .map((l) => l.replace(/^[-#\s*]+/, "").trim())
    .filter(Boolean)
    .map(fingerprintClaim)
    .filter(Boolean);
}

test("duplicate records of one paper yield each claim exactly once", () => {
  const dup = soilPaper({ doi: "10.1000/soil1", url: "https://doi.org/10.1000/soil1" });
  const dupNoDoi = soilPaper({ url: "https://publisher.org/soil1" });
  delete dupNoDoi.doi;
  const other = {
    title: "Evaporation rates in drying soils",
    journal: "Soil Science",
    year: "2019",
    abstract:
      "We measured that evaporation rates declined 3-fold as the surface crust formed over 12 days. " +
      "Results showed crust thickness reached 4 mm in 76% of columns.",
    relevance: 78,
  };
  const md = buildExtractiveSynthesis([dup, dupNoDoi, other], []);
  assert.ok(md, "expected a synthesis");
  const fps = fingerprintAll(md);
  assert.equal(new Set(fps).size, fps.length, "a claim was emitted more than once");
});

test("the lede is real prose, not glued keywords", () => {
  const md = buildExtractiveSynthesis([soilPaper()], []);
  assert.ok(md, "expected a synthesis");
  assert.doesNotMatch(md, /converge on/i, "keyword-soup lede survived");
  const firstLine = md.split("\n").find((l) => l.trim() && !l.startsWith("#"));
  assert.ok(firstLine && /\[\d+\]/.test(firstLine), "lede carries no citation: " + firstLine);
  assert.ok(!/ and .* and /.test(firstLine.split(".")[0]), "lede still glues terms with 'and'");
});

test("citations are 1-based and never exceed the source count", () => {
  const md = buildExtractiveSynthesis([soilPaper(), soilPaper({ title: "Other study" })], []);
  const nums = [...md.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10));
  assert.ok(nums.length > 0, "no citations emitted at all");
  for (const n of nums) {
    assert.ok(n >= 1 && n <= 2, `citation [${n}] out of bounds for 2 sources`);
  }
});

test("empty pool returns null (caller falls through to the honest message)", () => {
  assert.equal(buildExtractiveSynthesis([], []), null);
  assert.equal(buildExtractiveSynthesis([{ title: "" }], []), null);
});

// ── Extraction honesty gate (2026-10-07) ────────────────────────────
// When the cited papers can't support an honest "short answer", the
// extractive path must list the papers instead of stitching confident BS.
group("honesty gate — weak extractions get the honest answer, not stitched BS");

function tangentialPaper(extra = {}) {
  return {
    title: "Tsetse fly gut symbiont population dynamics",
    journal: "J Insect Sci",
    year: "2020",
    abstract:
      "We found that tsetse fly gut symbiont density increased 3-fold after blood meals. " +
      "Results showed significant variation across 41 sampled flies.",
    relevance: 38,
    ...extra,
  };
}

test("assessExtractionQuality flags zero strong papers", () => {
  const items = [
    { p: tangentialPaper(), findings: ["We found that tsetse fly gut symbiont density increased 3-fold after blood meals."], titleClaim: "Tsetse fly gut symbiont population dynamics", hasFindings: true },
    { p: tangentialPaper({ relevance: 42 }), findings: ["Results showed significant variation across 41 sampled flies."], titleClaim: "Tsetse fly gut symbiont population dynamics", hasFindings: true },
  ];
  const q = assessExtractionQuality(items, { query: "does sleep deprivation impair memory" });
  assert.equal(q.ok, false, "expected the gate to trip");
  assert.ok(q.reasons.length >= 2, "expected strength + addressing reasons, got: " + JSON.stringify(q.reasons));
  assert.equal(q.stats.strong, 0);
});

test("assessExtractionQuality passes strong on-topic papers", () => {
  const items = [
    { p: soilPaper(), findings: ["We found that desiccation crack spacing increased linearly with layer thickness across 34 experiments."], titleClaim: "Desiccation cracking of clay soils", hasFindings: true },
  ];
  const q = assessExtractionQuality(items, { query: "desiccation cracking in clay soils" });
  assert.equal(q.ok, true, "gate tripped on a good extraction: " + JSON.stringify(q.reasons));
});

test("assessExtractionQuality skips checks with no query and no scores", () => {
  const items = [
    { p: { title: "Something" }, findings: ["We found things."], titleClaim: "Something", hasFindings: true },
  ];
  const q = assessExtractionQuality(items, {});
  assert.equal(q.ok, true, "gate tripped without query or scores: " + JSON.stringify(q.reasons));
});

test("weak papers yield the honest answer, never a stitched short answer", () => {
  const md = buildExtractiveSynthesis(
    [tangentialPaper(), tangentialPaper({ title: "Spruce budworm outbreak cycles", relevance: 33 })],
    [],
    { query: "does sleep deprivation impair memory" }
  );
  assert.ok(md, "expected an answer, got null");
  assert.match(md, /Couldn't find a direct answer/, "not the honest answer");
  assert.doesNotMatch(md, /## The short answer/, "stitched a short answer from tangential papers");
  assert.match(md, /\[1\]/, "closest papers not listed");
  assert.match(md, /\[2\]/, "second paper not listed");
});

test("weak extraction still names why and offers reformulations", () => {
  const md = buildExtractiveSynthesis([tangentialPaper()], [], { query: "does sleep deprivation impair memory" });
  assert.match(md, /Why the evidence falls short/, "missing reasons section");
  assert.match(md, /Try asking it this way/, "missing reformulations");
});

test("weak extraction is honest about the gate reason", () => {
  const gated = buildExtractiveSynthesis([tangentialPaper()], [], {
    query: "does sleep deprivation impair memory",
    aiGateReason: "signin-required",
  });
  assert.match(gated, /Sign in to use your free AI answers/, "wrong closing line for gated users");
  assert.doesNotMatch(gated, /sign in for AI-synthesized answers/, "old paywall tease survived");
  const failed = buildExtractiveSynthesis([tangentialPaper()], [], {
    query: "does sleep deprivation impair memory",
    aiGateReason: null,
  });
  assert.match(failed, /providers were temporarily unavailable/, "wrong closing line for provider failure");
});

test("strong on-topic papers still get the five-section synthesis", () => {
  const md = buildExtractiveSynthesis([soilPaper()], [], { query: "desiccation cracking in clay soils" });
  assert.ok(md, "expected a synthesis");
  // The five-section lede heading is "## Summary" (renamed from
  // "## Executive Summary" on 2026-10-14 at Dusty's order).
  assert.match(md, /## Summary/, "good extraction lost the full synthesis");
});

test("name search is exempt from the topicality gate", () => {
  const papers = [{
    title: "Foraging ecology of black-legged kittiwakes",
    journal: "Ecology",
    year: "2020",
    // Third person since 2026-10-14: this fixture's finding sentence
    // used to read "We found that...", and the extractive first
    // person screen (answer package defect 4) now drops such
    // sentences, which starved the paper before the gate exemption
    // this test exists to prove could even be reached.
    abstract: "Foraging trip duration increased 2-fold during chick rearing across the tracked colonies. Results were significant.",
    relevance: 30,
  }];
  const md = buildExtractiveSynthesis(papers, [], { query: "Jane Smith", isNameSearch: true });
  assert.ok(md, "expected a synthesis");
  assert.match(md, /## Summary/, "name search wrongly gated");
});

test("follow-up mode is exempt from the query-addressing check", () => {
  const md = buildExtractiveSynthesis([soilPaper()], [], { query: "tell me more", isFollowupMode: true });
  assert.ok(md, "expected a synthesis");
  assert.match(md, /## Summary/, "follow-up wrongly gated on phrasing");
});

test("title-only papers cannot support a short answer", () => {
  const papers = [{
    title: "A study of things",
    journal: "J",
    year: "2020",
    abstract: "No abstract available.",
    relevance: 70,
  }];
  const md = buildExtractiveSynthesis(papers, [], { query: "a study of things" });
  assert.ok(md, "expected an answer");
  assert.match(md, /Couldn't find a direct answer/, "title-only extraction stitched an answer");
});

test("fingerprintClaim normalizes case, bold, citations, punctuation", () => {
  assert.equal(
    fingerprintClaim("Soil **cracks** widened 32% [1]."),
    fingerprintClaim("soil cracks widened 32%.")
  );
  assert.equal(
    fingerprintClaim("Desiccation crack spacing increased [2]."),
    fingerprintClaim("desiccation crack spacing increased!")
  );
  assert.notEqual(
    fingerprintClaim("Crack spacing increased."),
    fingerprintClaim("Crack depth increased.")
  );
});

// ══════════════════════════════════════════════════════════════════════════
group("structural — the gate and the counts are wired end to end");

test("selection binds every cited paper individually; the cascade never promotes into the cited set", () => {
  // Corrected contract (2026-10-14, sixth panel, wave seven, Job
  // 1a), superseding the 2026-10-12 cascade pin below in history:
  // the guaranteed evidence cascade admitted the top 3 ranked
  // papers into the cited set flagged thinEvidence whenever the
  // gated pool ran short, and the panel measured the result —
  // cited papers at relevance 10, 24, 26, 45 against a floor of
  // 50. Selection now computes the citable set per paper through
  // paperIsCitable (citation gate standard AND relevance floor),
  // orders it by concept coverage as before, and an empty citable
  // set is the serve gate's no evidence state. Name search and
  // follow-up modes stay exempt (handled by their own branch).
  assert.ok(searchSrc.includes("citablePapers = papers.filter((p, i) => paperIsCitable(p, i + 1, gateCtx));"), "per paper citable selection missing");
  assert.ok(searchSrc.includes("const citedPool = orderCitedSliceByCoverage(citablePapers, query, _dynForValidation);"), "citable pool not coverage ordered");
  assert.ok(searchSrc.includes("evidencePapers = citedPool.slice(0, maxEvidence);"), "citable papers not selected");
  assert.ok(searchSrc.includes("serveGateNoEvidence = citablePapers.length === 0;"), "empty citable set must raise the serve gate");
  assert.ok(!searchSrc.includes("p.thinEvidence = true"), "cascade thinEvidence stamping still present");
  assert.ok(!searchSrc.includes("evidencePapers = orderCitedSliceByCoverage(ranked, query, _dynForValidation).slice(0, 3)"), "cascade top-3 promotion still present");
  assert.ok(!searchSrc.includes("papers.slice(0, 8)"), "old ungated top-8 fallback still present");
});

test("synthesis layer re-applies the gate after validation (supplementary fetches)", () => {
  assert.ok(searchSrc.includes("evidencePapers = applyRelevanceGate(evidencePapers)"));
});

test("withheld count is reported in the answer envelope", () => {
  assert.ok(searchSrc.includes("relevanceGatedOut"), "relevanceGatedOut missing from search.js");
  // PIN UPDATED (2026-10-16, finding 5): the anchor was the late
  // cache serve's trust builder call ("sources: sourceList,") —
  // the only occurrence in the file, used as a proxy for the
  // envelope below it. The late serve now pairs the stored
  // answer with its own stored source list (the builder takes
  // storedLateSources; the envelope ships
  // laterTrust.labeledSources), so the anchor moves to the
  // envelope itself. The contract — the withheld count ships in
  // the response — is unchanged.
  // PIN UPDATED (2026-10-21, answer integrity lane): the late
  // serve now ships the shipped source split (laterSplit), so
  // the anchor moves to the split's own sources field. The
  // contract — the withheld count ships in the response — is
  // unchanged.
  const envIdx = searchSrc.indexOf("sources: laterSplit.sources,");
  assert.ok(envIdx > 0 && searchSrc.indexOf("relevanceGatedOut", envIdx) > 0,
    "relevanceGatedOut not in the response envelope");
});

test("CITE_RULES bans repeated claims and keyword-soup openings", () => {
  assert.ok(searchSrc.includes("Each distinct finding appears ONCE in the answer"));
  assert.ok(searchSrc.includes("never a keyword summary"));
});

test("Sources panel shows the current turn's sources, not the cumulative list", () => {
  assert.ok(appSrc.includes("const activeTurnSources = useMemo("), "panel not turn-scoped");
  assert.ok(appSrc.includes("<span>Sources</span><span style={S.srcCount}>{panelSources.length}</span>"),
    "panel header still counts allSources");
  assert.ok(appSrc.includes("aria-label={`Sources${panelSources.length"),
    "mobile FAB aria-label still counts allSources");
  assert.ok(appSrc.includes(">{panelSources.length}</span>"), "mobile FAB badge still counts allSources");
});

test("turns carry the withheld count and the bibliography states it", () => {
  assert.ok(appSrc.includes("relevanceGatedOut: data.relevanceGatedOut || 0"), "turn missing relevanceGatedOut");
  assert.ok(appSrc.includes("gatedOut = 0"), "Bibliography missing gatedOut prop");
  assert.ok(appSrc.includes("too tangential to this question to cite"), "withheld note missing");
});

test("frontend accumulator dedupes on intersecting multi-keys", () => {
  const hasSourceKeys = appSrc.includes("function sourceKeys(s)") || textUtilsSrc.includes("function sourceKeys(s)");
  assert.ok(hasSourceKeys, "sourceKeys missing");
  assert.ok(appSrc.includes("keys.some((k) => seenKeys.has(k))"), "accumulator not multi-key");
});

// ══════════════════════════════════════════════════════════════════════════
group("NEXT-GEN — runStage: every stage degrades, none throws");

test("runStage returns the value on success and records health", async () => {
  const health = [];
  const r = await runStage("s", async () => 42, { timeoutMs: 1000, health });
  assert.equal(r.ok, true);
  assert.equal(r.value, 42);
  assert.equal(health.length, 1);
  assert.equal(health[0].name, "s");
  assert.equal(health[0].ok, true);
});

test("runStage times out a hung stage and returns the fallback", async () => {
  const health = [];
  const r = await runStage("hung", () => new Promise(() => {}), {
    timeoutMs: 50, fallback: "FB", health,
  });
  assert.equal(r.ok, false);
  assert.equal(r.value, "FB");
  assert.equal(health[0].ok, false);
});

test("runStage converts a throw into a fallback, never a rejection", async () => {
  const r = await runStage("boom", async () => { throw new Error("kaput"); }, {
    timeoutMs: 1000, fallback: [],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.value, []);
});

// ══════════════════════════════════════════════════════════════════════════
group("NEXT-GEN — no-results: an intelligent terminal state, never a dead end");

test("zero papers yields whatWasTried, likelyReasons, reformulations", () => {
  const p = buildNoResultsPayload({
    query: "Why does soil crack into patterns as it dries?",
    sourcesQueried: [
      { source: "OpenAlex", ok: true, count: 0 },
      { source: "PubMed", ok: false, count: 0 },
    ],
    rungsTried: ["exact-term matching (4 narrowing rungs)", "synonym + MeSH expansion (6 queries)"],
    gatedOut: 0,
    gatedExamples: [],
  });
  assert.ok(p.whatWasTried.length >= 2, "whatWasTried too thin");
  assert.ok(p.whatWasTried.some((w) => /1 of 2 databases didn't respond|didn't respond/.test(w) || /2 scientific databases/.test(w)));
  assert.ok(p.likelyReasons.length === 3, "expected 3 likely reasons, got " + p.likelyReasons.length);
  assert.ok(Array.isArray(p.reformulations));
});

test("gated-out papers are named honestly in the no-results payload", () => {
  const p = buildNoResultsPayload({
    query: "quantum soil entanglement",
    sourcesQueried: [{ source: "OpenAlex", ok: true, count: 3 }],
    rungsTried: [],
    gatedOut: 3,
    gatedExamples: ["Quantum coherence in earthworms"],
  });
  assert.ok(p.whatWasTried.some((w) => /cited none/i.test(w) && /3 candidate/.test(w)));
  assert.ok(p.whatWasTried.some((w) => /Quantum coherence in earthworms/.test(w)), "closest example not named");
  assert.ok(p.likelyReasons[0].includes("on-topic enough to cite"));
});

test("renderNoResultsAnswer never guesses at the science", () => {
  const p = buildNoResultsPayload({ query: "xyzzy quux", sourcesQueried: [], rungsTried: [], gatedOut: 0 });
  const md = renderNoResultsAnswer("xyzzy quux", p);
  assert.match(md, /## No citable literature surfaced/);
  assert.match(md, /### What was tried/);
  assert.match(md, /### Most likely reasons/);
  assert.doesNotMatch(md, /Unable To Synthesize|Momentarily At Capacity/);
});

test("deriveReformulations builds concrete alternatives from the question", () => {
  const rs = deriveReformulations("Why does soil crack into polygonal patterns as it dries?");
  assert.ok(rs.length >= 2 && rs.length <= 3, "expected 2-3 reformulations, got " + rs.length);
  for (const r of rs) {
    assert.ok(r.label && r.query, "reformulation missing label/query");
    assert.notEqual(r.query.toLowerCase(), "why does soil crack into polygonal patterns as it dries?");
  }
  // At least one strategy must be visible: broaden (drops a word) or rephrase.
  const qs = rs.map((r) => r.query.toLowerCase());
  assert.ok(qs.some((x) => x.split(/\s+/).length < 9) || rs.some((r) => /literature's wording|Broaden/.test(r.label)),
    "no genuine broadening/rephrasing strategy: " + JSON.stringify(rs));
});

// ══════════════════════════════════════════════════════════════════════════
group("NEXT-GEN — query intelligence: ambiguity is surfaced, never silent");

test("bare 'depression' is ambiguous with concrete interpretations", () => {
  const a = detectAmbiguity("What causes depression?");
  assert.equal(a.ambiguous, true);
  assert.ok(a.interpretations.length >= 2);
  for (const i of a.interpretations) {
    assert.ok(i.label && i.query && i.query.length > 10, "interpretation not actionable");
  }
});

test("'depression' with psychiatric context resolves itself", () => {
  const a = detectAmbiguity("How do SSRIs treat depression?");
  assert.equal(a.ambiguous, false);
  assert.equal(a.resolvedAs, "Depressive disorders (psychiatry)");
});

test("unambiguous science questions stay unambiguous", () => {
  assert.equal(detectAmbiguity("Why does soil crack into patterns as it dries?").ambiguous, false);
  assert.equal(detectAmbiguity("").ambiguous, false);
});

test("'sleep deprivation impairs memory' resolves to human memory, not ambiguous", () => {
  const a = detectAmbiguity("does sleep deprivation impair memory");
  assert.equal(a.ambiguous, false);
  assert.equal(a.resolvedAs, "Human memory");
  const b = detectAmbiguity("how does ram affect computer memory");
  assert.equal(b.ambiguous, false);
  assert.equal(b.resolvedAs, "Computer memory");
});

// ══════════════════════════════════════════════════════════════════════════
group("NEXT-GEN — disagreement intelligence: computed, not defaulted");

const INC_PAPER = {
  title: "Fertilizer X increases wheat yield",
  abstract: "We found that fertilizer X increased wheat yield by 34% across 12 field trials. Results showed significant improvement.",
  year: "2020",
};
const DEC_PAPER = {
  title: "Fertilizer X decreases wheat yield",
  abstract: "We found that fertilizer X decreased wheat yield by 21% across 9 field trials. Results showed significant decline.",
  year: "2021",
};
const AGREE_PAPER = {
  title: "Fertilizer X improves wheat yield further",
  abstract: "We found that fertilizer X increased wheat yield by 28% in replicated trials. Results confirmed the improvement.",
  year: "2022",
};

test("opposing findings on the same topic produce a real divide", () => {
  const { conflicts, verdict } = detectSourceConflicts([INC_PAPER, DEC_PAPER]);
  assert.ok(conflicts.length >= 1, "no conflict detected");
  assert.equal(verdict.status, "divided");
  assert.equal(verdict.conflictCount, conflicts.length);
  const c = conflicts[0];
  assert.ok(c.claimA && c.claimB && c.idxA !== c.idxB, "conflict shape wrong");
  assert.ok(c.sourceA && c.sourceB, "conflict missing source titles");
});

test("consistent sources produce a computed settled verdict", () => {
  const { conflicts, verdict } = detectSourceConflicts([INC_PAPER, AGREE_PAPER, INC_PAPER]);
  assert.equal(conflicts.length, 0);
  assert.equal(verdict.status, "settled");
  assert.match(verdict.summary, /No opposing findings were detected/);
  assert.match(verdict.summary, /cited sources checked/);
});

test("fewer than 3 sources yields thin, not a false consensus", () => {
  const { verdict } = detectSourceConflicts([INC_PAPER]);
  assert.equal(verdict.status, "thin");
  assert.match(verdict.summary, /not a consensus/);
});

test("extractPaperClaims returns finding-dense sentences deterministically", () => {
  const c1 = extractPaperClaims(INC_PAPER, 2);
  const c2 = extractPaperClaims(INC_PAPER, 2);
  assert.deepEqual(c1, c2);
  assert.ok(c1.length > 0 && c1[0].length > 20);
});

// ══════════════════════════════════════════════════════════════════════════
group("NEXT-GEN — claim-level integrity");

test("extractive claims align to their cited papers", () => {
  const p1 = soilPaper();
  const p2 = soilPaper({ title: "Evaporation and crust formation in drying soils", abstract: "We measured evaporation decline as crusts formed." });
  const md = buildExtractiveSynthesis([p1, p2], []);
  const res = verifyExtractiveAlignment(md, [p1, p2]);
  assert.equal(res.mode, "extractive");
  assert.ok(res.checked, "nothing was checked");
  assert.equal(res.claims.filter((c) => c.status === "unsupported").length, 0,
    "aligned claims flagged: " + JSON.stringify(res.claims.filter((c) => c.status !== "supported")));
});

test("out-of-bounds citations are flagged unsupported", () => {
  const res = verifyExtractiveAlignment(
    "## The short answer\n\nDesiccation cracking widens measurably as the soil surface dries out [9].",
    [soilPaper()]
  );
  assert.ok(res.claims.some((c) => c.status === "unsupported" && /only 1 source/.test(c.note)));
});

test("postCheckAIAlignment flags near-zero-overlap claims, spares paraphrase", () => {
  const papers = [INC_PAPER, DEC_PAPER];
  const legit = "Fertilizer X increased wheat yield by about a third across a dozen field trials [1].";
  const fabricated = "Quantum entanglement explains why wheat grows taller near power lines [2].";
  const r1 = postCheckAIAlignment(legit, papers);
  assert.equal(r1.issues.length, 0, "legit paraphrase flagged: " + JSON.stringify(r1.issues));
  const r2 = postCheckAIAlignment(fabricated, papers);
  assert.equal(r2.issues.length, 1, "fabricated claim not flagged");
  assert.equal(r2.issues[0].idx, 2);
});

test("uncited bibliography entries are labeled, not implied as support", () => {
  const out = labelUncitedSources(
    [{ title: "A" }, { title: "B" }],
    "Findings show X [1]."
  );
  assert.equal(out[0].uncited, undefined);
  assert.equal(out[1].uncited, true);
  assert.match(out[1].uncitedReason, /further reading/);
});

// ── stripUnsupportedCitations: the false trace is removed, the prose stays ──

test("stripUnsupportedCitations removes the marker but keeps the sentence", () => {
  const papers = [INC_PAPER, soilPaper()];
  const r = stripUnsupportedCitations(
    "Quantum entanglement explains why wheat grows taller near power lines [2].",
    papers
  );
  assert.equal(r.removed.length, 1, "false citation not stripped");
  assert.equal(r.removed[0].idx, 2);
  assert.ok(!/\[\d+\]/.test(r.text), "marker left behind: " + r.text);
  assert.match(r.text, /Quantum entanglement explains why wheat grows taller/);
});

test("stripUnsupportedCitations keeps citations the paper actually supports", () => {
  const papers = [INC_PAPER, soilPaper()];
  const legit = "Fertilizer X increased wheat yield by about a third across a dozen field trials [1].";
  const r = stripUnsupportedCitations(legit, papers);
  assert.equal(r.removed.length, 0, "legit citation stripped: " + JSON.stringify(r.removed));
  assert.equal(r.text, legit);
});

test("stripUnsupportedCitations keeps a marker on a sentence naming the paper's author", () => {
  const papers = [
    { title: "Honeydew chemistry shapes ant attendance", abstract: "We tracked how sugar composition in aphid honeydew changed ant behaviour across colonies and seasons.", authors: "van Neerbos F" },
    { title: "Seasonal dynamics of gut bacterial communities in farmed insects", abstract: "We sampled bacterial communities across farms and seasons and tracked composition shifts over time.", authors: "Chiang YR" },
  ];
  // The sentence shares essentially no vocabulary with paper 2's title
  // or abstract, so only the author guard can save this marker. This is
  // the exact shape that left a named author's claim uncited in
  // production while the paper sat flagged unused.
  const r = stripUnsupportedCitations(
    "Chiang et al. found that the enzyme broke down dietary protein in the midgut [2].",
    papers
  );
  assert.equal(r.removed.length, 0, "author named citation stripped: " + JSON.stringify(r.removed));
  assert.match(r.text, /\[2\]/);
});

test("reattachAuthorCitations attaches the named author's paper number", () => {
  const papers = [
    { title: "Honeydew chemistry shapes ant attendance", abstract: "We tracked how sugar composition in aphid honeydew changed ant behaviour across colonies and seasons.", authors: "van Neerbos F" },
    { title: "Cathepsin activity in larval gut tissue", abstract: "Expression of a cysteine protease was measured across gut regions.", authors: "Chiang YR" },
  ];
  const out = reattachAuthorCitations(
    "Chiang et al. measured expression of the cysteine protease in larval guts. Other work looked at honeydew chemistry [1].",
    papers
  );
  assert.match(out, /larval guts \[2\]\./, "marker not attached: " + out);
  assert.match(out, /honeydew chemistry \[1\]\./, "existing citation disturbed: " + out);
});

test("reattachAuthorCitations leaves ambiguous surnames and cited sentences alone", () => {
  const papers = [
    { title: "Soil carbon under wheat", abstract: "Soil carbon rose under wheat rotations in long term field plots.", authors: "Smith J" },
    { title: "River sediment transport", abstract: "Sediment transport rates were gauged across flood events.", authors: "Smith A" },
  ];
  const ambiguous = "Smith et al. reported higher values across every site.";
  assert.equal(reattachAuthorCitations(ambiguous, papers), ambiguous);
  const cited = "Smith et al. reported higher soil carbon under wheat [1].";
  assert.equal(reattachAuthorCitations(cited, [papers[0]]), cited);
});

test("extractBinomial does not mistake a topic phrase for a species", () => {
  // "Bayesian statistics" fits the Genus species shape exactly. Read as
  // a binomial it gated evidence on the phrase and italicized it
  // through the whole answer in production.
  assert.equal(extractBinomial("What are the advantages of Bayesian statistics vs p-value statistics?"), null);
  assert.equal(extractBinomial("How does population dynamics shape fisheries?"), null);
});

test("rescue wave builds its second leg on a live Groq model", () => {
  // llama-3.3-70b-versatile is deprecated for this key tier and
  // returned HTTP 404 in production legs, which silently left the
  // last resort rescue racing a single model.
  assert.ok(!searchSrc.includes('rescueCall("meta-llama/llama-3.3-70b-versatile"'), "rescue still calls the retired Groq model");
  assert.ok(searchSrc.includes('rescueCall("openai/gpt-oss-20b"'), "rescue second leg missing");
});

test("extractBinomial does not mistake question words for a species", () => {
  // Live failure (2026-10-13): "Has anyone assayed..." extracted the
  // phantom binomial {Has, anyone} . sentence-initial capitalization
  // made "Has" look like a genus and "anyone" is in neither STOPWORDS
  // nor the non-taxonomic sets. The paper gate's binomial branch then
  // required every candidate to contain the word "anyone", deleting
  // the real shelf (43 of 46 papers in the live funnel) and leaving
  // only junk that printed it. Auxiliaries, modals, interrogatives,
  // and pronouns are closed classes: they can never fill either slot
  // of a Latin binomial, in either position.
  assert.equal(extractBinomial("Has anyone assayed digestive enzymes in whole gut preparations from insects without isolating the enzymes?"), null);
  assert.equal(extractBinomial("How can a frog turn into ice all winter and not die?"), null);
  assert.equal(extractBinomial("Can black soldier fly maggots eat leftover fryer grease?"), null);
  assert.equal(extractBinomial("Do black soldier fly maggots eat leftover fryer grease?"), null);
  // Rejecting the phantom pair must not end the scan: a real binomial
  // later in the same question is still found.
  const after = extractBinomial("Has the gut microbiome of Drosophila melanogaster been studied?");
  assert.ok(after && after.full === "Drosophila melanogaster", "real binomial after a question opener missed: " + JSON.stringify(after));
  const afterHow = extractBinomial("Studies show how enzymes in the gut of Tenebrio molitor respond to diet");
  assert.ok(afterHow && afterHow.full === "Tenebrio molitor", "real binomial after a function word missed: " + JSON.stringify(afterHow));
});

test("extractBinomial still finds real species names", () => {
  const b = extractBinomial("How does diet change the gut microbiome of Hermetia illucens larvae?");
  assert.ok(b && b.full === "Hermetia illucens", "real binomial missed: " + JSON.stringify(b));
  const later = extractBinomial("Compare the microbial diversity in Hermetia illucens larvae");
  assert.ok(later && later.full === "Hermetia illucens", "later binomial missed: " + JSON.stringify(later));
});

test("stripUnsupportedCitations evaluates each marker independently", () => {
  const papers = [INC_PAPER, soilPaper()];
  // [1] is false here (soil claim on the wheat paper), [2] is true.
  const r = stripUnsupportedCitations(
    "Desiccation cracking widens measurably as the clay surface dries out [1]. " +
    "Crack spacing narrows as desiccation proceeds in the clay samples [2].",
    papers
  );
  assert.equal(r.removed.length, 1);
  assert.equal(r.removed[0].idx, 1);
  assert.match(r.text, /\[2\]/, "true citation was stripped too: " + r.text);
});

test("stripUnsupportedCitations never touches out-of-range markers", () => {
  const r = stripUnsupportedCitations("Something happened [9].", [INC_PAPER]);
  assert.equal(r.removed.length, 0);
  assert.equal(r.text, "Something happened [9].");
});

test("stripUnsupportedCitations spares papers with no usable text and short sentences", () => {
  const noText = [{ title: "", abstract: "" }];
  const r1 = stripUnsupportedCitations("A completely unrelated assertion about quantum tunneling [1].", noText);
  assert.equal(r1.removed.length, 0, "judged a paper with nothing to compare");
  const r2 = stripUnsupportedCitations("Wheat up [1].", [INC_PAPER]);
  assert.equal(r2.removed.length, 0, "judged a fragment");
});

test("stripUnsupportedCitations counts numbers and units as shared vocabulary", () => {
  const papers = [{ title: "Dose response", abstract: "A dose of 50 mg reduced symptoms in the treatment group." }];
  const r = stripUnsupportedCitations("The dose was 50 mg [1] and symptoms fell.", papers);
  assert.equal(r.removed.length, 0, "numeric match stripped: " + JSON.stringify(r.removed));
});

// ══════════════════════════════════════════════════════════════════════════
group("NEXT-GEN — computed gaps, confidence, coverage");

test("thin evidence yields thin confidence and honest gaps", () => {
  const gaps = buildEvidenceGaps({ papers: [INC_PAPER], sourcesQueried: null, relevanceGatedOut: 0 });
  assert.ok(gaps.some((g) => /Only 1 source/.test(g)));
  const conf = buildConfidenceLine([INC_PAPER], { status: "thin" });
  assert.equal(conf.level, "thin");
  assert.match(conf.line, /provisional/);
});

test("strong consensus reads differently from thin evidence", () => {
  // Corrected fixture (2026-10-22, logic audit L6-3): the bare
  // papers score 71, which the old banding read as strong only
  // because strong started at 60. The documented band table
  // (CONFIDENCE_BANDS: strong at 75 and up) reads 71 as
  // moderate, so the strong case here carries the signals a
  // strong label has to earn: relevance, journal type, recency,
  // and a semantic match.
  const many = [INC_PAPER, AGREE_PAPER, INC_PAPER, AGREE_PAPER, INC_PAPER, AGREE_PAPER]
    .map((p) => ({ ...p, relevance: 90, type: "Journal", semanticScore: 80, year: 2025 }));
  const strong = buildConfidenceLine(many, { status: "settled" });
  const thin = buildConfidenceLine([INC_PAPER], { status: "thin" });
  assert.equal(strong.level, "strong");
  assert.notEqual(strong.line, thin.line);
});

test("divided evidence yields moderate, provisional confidence", () => {
  const conf = buildConfidenceLine([INC_PAPER, DEC_PAPER], { status: "divided", conflictCount: 1 });
  assert.equal(conf.level, "moderate");
  assert.match(conf.line, /provisional/);
});

test("coverage note names the failure honestly, null when all answered", () => {
  assert.equal(buildCoverageNote([{ source: "A", ok: true }, { source: "B", ok: true }]), null);
  assert.equal(buildCoverageNote(null), null);
  const note = buildCoverageNote([
    { source: "OpenAlex", ok: true }, { source: "PubMed", ok: false }, { source: "arXiv", ok: false },
  ]);
  assert.match(note, /2 of 3 databases didn't respond/);
  assert.match(note, /built from the 1 that did/);
});

test("falsification bullets are concrete and state-derived", () => {
  const b = buildFalsificationBullets({
    papers: [INC_PAPER],
    verdict: { status: "divided", conflicts: [{ idxA: 1, idxB: 2, topic: "wheat yield" }] },
    newestYear: 2010,
  });
  assert.ok(b.length >= 2 && b.length <= 4);
  assert.ok(b.some((x) => /\[1\] against \[2\]/.test(x)), "division not addressed");
  assert.ok(b.some((x) => /post-2010/.test(x)), "staleness not addressed");
});

test("retrievalStrategiesTried names what ran, nothing more", () => {
  const s = retrievalStrategiesTried({ rungs: [{}, {}], conceptExpanded: ["a", "b"], nlFallback: 5 });
  assert.ok(s.some((x) => /exact-term/.test(x)));
  assert.ok(s.some((x) => /MeSH/.test(x)));
  assert.deepEqual(retrievalStrategiesTried(null), []);
});

// ══════════════════════════════════════════════════════════════════════════
group("NEXT-GEN — structured answers on every path");

test("extractive synthesis emits the shared five-section structure", () => {
  const md = buildExtractiveSynthesis([soilPaper(), INC_PAPER], [], {
    sourcesQueried: [{ source: "A", ok: true }],
    relevanceGatedOut: 2,
    ambiguity: { ambiguous: false, interpretations: [] },
  });
  for (const h of ["## Summary", "## What the research shows", "## Where researchers disagree", "## How solid is this?", "## What would change this"]) {
    assert.ok(md.includes(h), "missing section: " + h);
  }
  assert.match(md, /Drafted directly from the sources/);
});

test("ambiguous questions get an honest note in the extractive answer", () => {
  const md = buildExtractiveSynthesis([soilPaper()], [], {
    ambiguity: { ambiguous: true, term: "depression", interpretations: [{ label: "A" }, { label: "B" }] },
  });
  assert.match(md, /ambiguous/);
});

// ══════════════════════════════════════════════════════════════════════════
group("NEXT-GEN — structural: the dead ends are gone");

test("no 'Unable To Synthesize' or 'Momentarily At Capacity' state remains", () => {
  assert.ok(!searchSrc.includes("Unable To Synthesize"), "dead-end state still present");
  assert.ok(!searchSrc.includes("Momentarily At Capacity"), "dead-end state still present");
});

test("top-level catch returns a 200 degraded research response, not a 5xx", () => {
  // The catch builds a no-results payload and answers 200.
  // Window widened 2000 → 3000 (2026-10-14): the stage health
  // aggregate hook now sits between the payload build and the
  // return in this catch; the shape being pinned is unchanged.
  const catchIdx = searchSrc.indexOf("top-level error:");
  assert.ok(catchIdx > 0);
  const after = searchSrc.slice(catchIdx, catchIdx + 3000);
  assert.ok(after.includes('status: 200'), "catch no longer answers 200");
  assert.ok(after.includes('responseKind: "no-results"'), "catch not shaped as no-results");
  assert.ok(!after.includes("status = 500") && !after.includes("status = 503"), "5xx statuses still present");
});

test("synthesis waves respect an overall deadline with Wave-4 fallback", () => {
  assert.ok(searchSrc.includes("synthesisDeadline"), "no synthesis deadline");
  assert.ok(searchSrc.includes("Date.now() < synthesisDeadline"), "deadline not enforced on waves");
});

test("retrieval and validation run inside the stage runner", () => {
  assert.ok(searchSrc.includes('runStage("retrieval"'), "retrieval not staged");
  assert.ok(searchSrc.includes('runStage(\n        "validation"') || searchSrc.includes('"validation",'), "validation not staged");
});

test("the evidence-trace promise is not contradicted by prompts", () => {
  assert.ok(!searchSrc.includes("then answer from your knowledge"), "RULE 7 still contradicts the trace promise");
  assert.ok(!searchSrc.includes("say so briefly and answer from your knowledge"), "retry prompt still contradicts the trace promise");
});

test("response envelope carries the NEXT-GEN instruments", () => {
  for (const f of ["responseKind", "noResults:", "disagreementVerdict", "evidenceGaps", "confidence", "coverageNote", "ambiguity", "degraded:", "stageHealth:"]) {
    assert.ok(searchSrc.includes(f), "envelope missing: " + f);
  }
});

test("turns carry every NEXT-GEN instrument from the response", () => {
  for (const f of ["noResults: data.noResults", "disagreementVerdict: data.disagreementVerdict", "evidenceGaps: Array.isArray(data.evidenceGaps)", "confidence: data.confidence", "coverageNote: data.coverageNote", "ambiguity: data.ambiguity", "degraded: !!data.degraded", "stageHealth: Array.isArray(data.stageHealth)"]) {
    assert.ok(appSrc.includes(f), "turn missing: " + f);
  }
});

test("FactCheck renders the mechanical extractive check honestly", () => {
  assert.ok(appSrc.includes('fc.mode === "extractive"'), "extractive mode not handled");
  assert.ok(appSrc.includes("for shared wording and"), "extractive receipt copy missing");
  assert.ok(appSrc.includes("The rest of the answer was not claim checked."), "receipt scope line missing");
  assert.ok(appSrc.includes("assembled without AI"), "extractive caveat missing");
});

test("'NOT CHECKED' is gone; empty states say what is actually true", () => {
  assert.ok(!appSrc.includes('"NOT CHECKED"'), "NOT CHECKED still present");
  assert.ok(appSrc.includes("No scientific claims to verify."), "honest empty state missing");
});

test("disagreement fallback uses the computed verdict, not a default", () => {
  assert.ok(appSrc.includes("t.disagreementVerdict"), "verdict not read");
  // Kickers are normal case now (the caps purge): "Thin evidence".
  assert.ok(appSrc.includes('"Thin evidence"'), "thin kicker missing");
  assert.ok(!appSrc.includes('kicker="NO CLEAR DIVIDE"'), "default NO CLEAR DIVIDE still present");
});

test("coverage failures render the backend's explicit note", () => {
  assert.ok(appSrc.includes("t.coverageNote"), "coverageNote not rendered");
});

test("no-results turns get one-tap reformulations and ambiguity picks", () => {
  assert.ok(appSrc.includes("Try a rephrasing"), "reformulation chips missing");
  assert.ok(appSrc.includes("t.noResults.reformulations"), "reformulations not read from turn");
});

test("uncited bibliography entries are labeled further reading", () => {
  assert.ok(appSrc.includes("source.uncited"), "uncited flag not read");
  assert.ok(appSrc.includes("Further reading: not cited above"), "further-reading label missing");
});

test("degraded pipeline states are visible, not silent", () => {
  assert.ok(appSrc.includes("t.degraded"), "degraded flag not read");
  assert.ok(appSrc.includes("07 · Pipeline health"), "autopsy health section missing");
});

test("connection-failure panel offers rephrasing, not just retry", () => {
  const idx = appSrc.indexOf('kicker="Connection failed"');
  assert.ok(idx > 0);
  assert.ok(appSrc.indexOf("QueryRetryForm", idx) > 0 && appSrc.indexOf("QueryRetryForm", idx) < idx + 1200,
    "no rephrase form on the connection-failure panel");
});

// ══════════════════════════════════════════════════════════════════════════
// Prompt-leak guard (2026-09-12 incident): a provider leg echoed the system
// prompt ("We need to answer: … Must bold at least 4 key terms … banned
// phrases … UNCITABLE …") instead of writing the answer — and it PASSED the
// **bold** formatting gate, because the model bolded its planning terms.
// The leak guard must reject instruction-echo even when formatting looks
// right, while legitimate scientific prose passes untouched.
// ══════════════════════════════════════════════════════════════════════════

const LEAKED_PLANNING_SAMPLE = `We need to answer: How do mRNA vaccines trigger immunity?
Strict formatting: sections: The short answer / What the research shows.
I must bold at least 4 key terms in the answer.
Banned phrases include "further research is needed" and "plays a crucial role".
Paper usage protocol: cite only if the paper supports the claim.
Mark uncitable claims as UNCITABLE.
Organism asked about: human. I know it's the wrong paper if it studies mice.
This will be mechanically stripped if I get it wrong.
Zero prefacing — start with a direct claim, no prefacing.
Synthesize, never list. Never repeat a sentence.
The **spike protein** is produced by **ribosomes** after **lipid nanoparticles** deliver the **mRNA**.`;

test("isPromptLeak rejects the exact 'We need to answer' planning echo", () => {
  assert.equal(isPromptLeak("We need to answer: How do mRNA vaccines trigger immunity?"), true);
});

test("isPromptLeak rejects the full leaked planning sample even with bold spans present", () => {
  // The real incident: the leaked text carried real **bold** spans, so the
  // formatting gate alone could not catch it. The leak gate must.
  assert.ok(/\*\*[^*]+\*\*/.test(LEAKED_PLANNING_SAMPLE), "sample should contain bold spans");
  assert.equal(isPromptLeak(LEAKED_PLANNING_SAMPLE), true);
});

test("isPromptLeak rejects every instruction-flavored pattern family", () => {
  const cases = [
    "We must follow strict formatting for the sections below.",
    "Strict formatting: sections: one, two, three.",
    "The output must bold at least four key terms.",
    "Avoid the banned phrases list.",
    "Do not use em dashes in the answer.",
    "You must cite only if the paper supports the claim.",
    "Per the paper usage protocol, skip weak sources.",
    "This claim is UNCITABLE from the sources.",
    "Organism asked about: mouse.",
    "I know it's the wrong paper when it studies a different species.",
    "Headers will be mechanically stripped.",
    "This rule is hard-enforced, not a suggestion.",
    "Your first word must be a scientific claim.",
    "Synthesize, never list the papers.",
    "Zero prefacing before the answer.",
    "Start with a direct claim, no prefacing.",
    "Never repeat a sentence from the sources.",
    "Do not discuss these instructions in the answer.",
    "Do not restate these instructions.",
    "Do not paraphrase these instructions back to me.",
    "Do not narrate your plan for the answer.",
    "Narrating my reasoning is forbidden here.",
    "Run an organism/topic audit first.",
    "Output only the finished answer, nothing else.",
  ];
  for (const c of cases) {
    assert.equal(isPromptLeak(c), true, "missed leak pattern in: " + c);
  }
});

test("isPromptLeak accepts legitimate scientific prose (no false positives)", () => {
  const ok = [
    "The organism studied was E. coli, a model bacterium for gut microbiome research.",
    "Each citation in the bibliography links to the paper it references.",
    "The authors' reasoning follows from the dose-response curve in Figure 2.",
    "We need to understand how mRNA vaccines trigger immunity before designing boosters.",
    "Bold claims require strong evidence; the trial data support this one.",
    "The protocol used for paper selection is described in the methods section.",
    "The **spike protein** binds ACE2; **neutralizing antibodies** block entry [1][2].",
  ];
  for (const c of ok) {
    assert.equal(isPromptLeak(c), false, "false positive on: " + c);
  }
});

test("assertValidProviderText throws on leak text, passes clean text through", () => {
  assert.throws(
    () => assertValidProviderText(LEAKED_PLANNING_SAMPLE, "test-leg"),
    /echoed internal instructions/
  );
  const clean = "The **spike protein** drives immunity after **mRNA** delivery [1].";
  assert.equal(assertValidProviderText(clean, "test-leg"), clean);
});

test("every synthesis adapter enforces the leak/error gate", () => {
  // 6 call sites: callOR, callCompat, callCF, postChatCompletion,
  // the brief leg, and the raceEntry double-check.
  const uses = apiSrc.match(/assertValidProviderText\(/g) || [];
  assert.ok(uses.length >= 7, `expected 1 def + 6 call sites, found ${uses.length}`);
});

test("synthesis adapters keep the abort armed through the body read", () => {
  // 2026-09-12 root cause of "search is still taking too long": the abort
  // was disarmed (clearTimeout) the moment response HEADERS arrived, but a
  // slow model trickles its BODY for tens of seconds — a 550B leg won a
  // production wave at 53s with a "12s timeout". The timeout must bound the
  // whole operation: no clearTimeout between fetch() and r.json(), and the
  // disarm must live in a finally.
  // 2026-09-20: the adapters gained thin circuit-breaker wrappers
  // (callOR/callCompat); the abort-armed fetch bodies live in the Inner
  // functions, which is what this test pins.
  for (const fnName of ["const callORInner = ", "const callCompatInner = "]) {
    const start = apiSrc.indexOf(fnName);
    assert.ok(start > 0, fnName + "not found");
    // Strip line comments so the check sees code, not prose about the fix.
    const body = apiSrc.slice(start, start + 4000).replace(/\/\/[^\n]*/g, "");
    const fetchIdx = body.indexOf("await fetch(");
    const jsonIdx = body.indexOf("await r.json()");
    assert.ok(fetchIdx > 0 && jsonIdx > fetchIdx, fnName + ": fetch/json structure changed");
    assert.ok(
      !body.slice(fetchIdx, jsonIdx).includes("clearTimeout"),
      fnName + " disarms the timeout before the body is read (header-only timeout)"
    );
    assert.ok(body.includes("finally"), fnName + ": timeout should be disarmed in finally");
  }
});

test("pre-work fetchers keep the abort armed through the body read", () => {
  // 2026-09-12: selfReason's header-only 5s timeout let the 550B trickle
  // its body for 50s+ — the unaccounted ~51s in the 78s all-fail query.
  // Same whole-operation rule as the synthesis adapters, applied to
  // selfReason, llmGenerateSearchQueries, getJSON, getText.
  for (const fnName of [
    "async function selfReason(",
    "async function llmGenerateSearchQueries(",
    "async function getJSON(",
    "async function getText(",
  ]) {
    const start = apiSrc.indexOf(fnName);
    assert.ok(start > 0, fnName + " not found");
    // Strip line comments so the check sees code, not prose about the fix.
    const body = apiSrc.slice(start, start + 6000).replace(/\/\/[^\n]*/g, "");
    const fetchIdx = body.indexOf("await fetch(");
    assert.ok(fetchIdx > 0, fnName + ": fetch structure changed");
    // Find the body-read: r.json(), res.json(), res.text()
    const readIdx = Math.min(
      ...["await r.json()", "await res.json()", "await res.text()"]
        .map((s) => { const i = body.indexOf(s, fetchIdx); return i < 0 ? Infinity : i; })
    );
    assert.ok(readIdx < Infinity && readIdx > fetchIdx, fnName + ": body-read structure changed");
    assert.ok(
      !body.slice(fetchIdx, readIdx).includes("clearTimeout"),
      fnName + " disarms the timeout before the body is read (header-only timeout)"
    );
    assert.ok(body.includes("finally"), fnName + ": timeout should be disarmed in finally");
  }
});

test("synthesis deadline is derived from the global request budget", () => {
  // 2026-09-12: a flat 90s synthesisDeadline was incompatible with the
  // 20s end-to-end ceiling. It must now derive from requestDeadline.
  // PIN UPDATED (2026-10-14, wave sixteen): the derivation now
  // runs through synthesisDeadlineFor, which subtracts the
  // 2,500 ms assembly reserve and, when the request carries
  // the fact check, the check's reserved window
  // (FACT_CHECK_RESERVE_MS) from the same request deadline.
  // The contract this pin protects (the deadline derives from
  // the global request budget) is unchanged; its shape moved.
  assert.ok(
    apiSrc.includes("synthesisDeadlineFor(Date.now(), requestDeadline") &&
    apiSrc.includes("requestDeadlineMs - 2500"),
    "synthesisDeadline must derive from requestDeadline"
  );
  assert.ok(
    !apiSrc.includes("const synthesisDeadline = Date.now() + 90000;"),
    "flat 90s synthesis deadline must be gone"
  );
  // Fastpath must race concurrently with wave 1 (no sequential await).
  // CORRECTED CONTRACT (2026-10-13, subrequest ledger): wave legs are
  // built as descriptors and fired through fireWaveLegs, which funnels
  // every selected leg through guardedRaceEntry (the park check) at
  // fire time. The fastpath is a wave 0 descriptor at the head of the
  // wave 1 descriptor array . still concurrent, still guarded, still
  // recorded in the attempt trail like every other leg.
  const fpIdx = apiSrc.indexOf('label: "fastpath:" + fastpathModel');
  assert.ok(fpIdx > 0, "concurrent fastpath not found");
  const fpBlock = apiSrc.slice(fpIdx, fpIdx + 800);
  assert.ok(fpBlock.includes("wave: 0"), "fastpath descriptor should carry wave 0");
  assert.ok(fpBlock.includes("w1Abort.signal"), "fastpath descriptor should fire with the wave 1 abort signal");
  // PIN UPDATED (2026-10-16, finding 12): fireWaveLegs forwards
  // the race state as a fourth argument (see fleet-hardening).
  assert.ok(apiSrc.includes("guardedRaceEntry(d.wave, d.label, d.fire, raceState)"), "fireWaveLegs should funnel legs through guardedRaceEntry");
  // Wave 1 must include the fastpath descriptor in its race.
  assert.ok(apiSrc.includes("const wave1Calls = fireWaveLegs(["), "wave 1 should race through the budget planner");
  // Waves 2/3 must be budget-gated.
  assert.ok(apiSrc.includes("msLeft() > 6000"), "wave 2 budget gate missing");
  assert.ok(apiSrc.includes("msLeft() > 4000"), "wave 3 budget gate missing");
});

group("Wave-4 deterministic fallback — 2026-09-15 incident regressions");

// The incident: a weak brief model emitted a damaged "atomic claim" and it
// shipped verbatim with a citation — "representing a 4-fivefold increase
// relative to the anterior region (p ConclusionsCollectively, our findings
// define ...". The integrity gate must reject it; the answer must fall back
// to the intact regex-extracted sentence.
const MANGLED_BRIEF_CLAIM =
  "representing a 4-fivefold increase relative to the anterior region (p " +
  "ConclusionsCollectively, our findings define a compartmentalized " +
  "Dismissing-then-Recruiting strategy for microbiome assembly in BSFL, " +
  "which is associated with the structuring of functional symbiont " +
  "communities for efficient lignocellulose bioconversion.";
const CLEAN_ABSTRACT_SENTENCE =
  "Concurrently, host glycosylation-related genes (C1galt1, GlcAT-P, FUT8/11) " +
  "were significantly upregulated in the posterior midgut (17-19 TPM), " +
  "representing a 4- to 5-fold increase relative to the anterior region (p < 0.05).";

test("isWellFormedClaim rejects the mangled brief claim from the incident", () => {
  assert.equal(isWellFormedClaim(MANGLED_BRIEF_CLAIM), false, "mangled claim passed the gate");
  assert.equal(isWellFormedClaim("EMBL-1) is able to maintain a part of insect gut biological activity."), false, "unbalanced-paren fragment passed the gate");
  assert.equal(isWellFormedClaim("representing a 4-fivefold increase relative to the anterior region"), false, "unterminated fragment passed the gate");
});

test("isWellFormedClaim accepts intact sentences with p-values and quantities", () => {
  assert.equal(isWellFormedClaim(CLEAN_ABSTRACT_SENTENCE), true, "clean sentence failed the gate");
  assert.equal(isWellFormedClaim("Crack spacing increased linearly with layer thickness across 34 experiments."), true);
});

test("damaged brief claims fall back to intact abstract sentences", () => {
  const paper = {
    title: "Compartmentalized microbiome assembly in black soldier fly larvae",
    abstract: CLEAN_ABSTRACT_SENTENCE + " Conclusions: Collectively, our findings define a compartmentalized strategy for microbiome assembly in BSFL.",
  };
  const claims = extractPaperClaims(paper, 3, [MANGLED_BRIEF_CLAIM]);
  assert.ok(claims.length > 0, "no claims extracted at all");
  for (const c of claims) {
    assert.doesNotMatch(c, /ConclusionsCollectively/, "mangled brief claim shipped: " + c);
    assert.doesNotMatch(c, /fivefold/, "mangled fold expression shipped: " + c);
    assert.ok(isWellFormedClaim(c), "emitted claim fails the integrity gate: " + c);
  }
  assert.ok(claims.some((c) => c.includes("4- to 5-fold")), "intact sentence did not survive: " + JSON.stringify(claims));
});

function incidentPapers() {
  // 8 PVC-degradation papers first (broad "degradation" vocabulary overlap),
  // then 4 on-substrate lignocellulose papers — mirrors the incident layout.
  const papers = [];
  for (let i = 1; i <= 8; i++) {
    papers.push({
      title: "PVC biodegradation by mealworm gut bacteria " + i,
      journal: "J Hazard Mater",
      year: "2022",
      abstract: "We show that PVC film lost " + (10 + i) + "% mass in 30 days in mealworm guts. Depolymerization enzymes were upregulated 3-fold (p < 0.01).",
    });
  }
  for (let i = 9; i <= 12; i++) {
    papers.push({
      title: "Lignocellulose conversion by insect gut symbionts " + i,
      journal: "Biotechnol Biofuels",
      year: "2023",
      abstract: "Termite gut symbionts released " + (30 + i) + "% of fermentable sugars from lignocellulose within 48 hours. Cellulase activity rose 5-fold (p < 0.001).",
    });
  }
  return papers;
}
const INCIDENT_QUERY = "How does the insect gut microbiome degrade lignocellulose?";

test("every source count in the answer derives from the cited pool", () => {
  const md = buildExtractiveSynthesis(incidentPapers(), [], { query: INCIDENT_QUERY });
  assert.ok(md, "expected a synthesis");
  const disagree = md.match(/among the (\d+) cited sources checked/);
  const conf = md.match(/(\d+) cited sources/);
  assert.ok(disagree, "disagreement source count missing");
  assert.ok(conf, "confidence source count missing");
  assert.equal(disagree[1], conf[1], `count mismatch: disagree=${disagree[1]} confidence=${conf[1]}`);
  // 2026-10-14 (wave eight arbitration): the count was 8 under
  // the old standard, when the PVC papers cleared on gut plus
  // degradation group touches and the drift demotion merely
  // reordered them inside the pool. Under the wave eight
  // citation standard they engage one central term (gut) and
  // never enter the excerpt pool, so the cited pool is the 4
  // on substrate papers. The contract — every count derives
  // from the cited pool and the counts agree — is unchanged.
  assert.equal(disagree[1], "4", "expected the 4 cited sources, got " + disagree[1]);
  const nums = [...md.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10));
  for (const n of nums) assert.ok(n >= 1 && n <= 12, `citation [${n}] out of bounds`);
});

test("drifted-substrate papers cannot dominate a lignocellulose answer", () => {
  const md = buildExtractiveSynthesis(incidentPapers(), [], { query: INCIDENT_QUERY });
  assert.ok(md, "expected a synthesis");
  const cited = [...new Set([...md.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10)))];
  assert.ok(cited.some((n) => n >= 9), "no lignocellulose paper (9-12) was cited: " + cited.join(","));
  // The lede ("The short answer") must open on-substrate, not on PVC.
  const lede = md.split("## What the research shows")[0];
  assert.doesNotMatch(lede, /PVC film lost/, "lede opens on a drifted PVC finding");
  assert.ok(/lignocellulose|Cellulase/i.test(lede), "lede carries no on-substrate finding");
});

test("withheld count is distinguished from retrieved-but-uncited count", () => {
  const md = buildExtractiveSynthesis(incidentPapers(), [], { query: INCIDENT_QUERY, relevanceGatedOut: 4 });
  assert.ok(md, "expected a synthesis");
  // 2026-10-14 (wave eight arbitration): the uncited line
  // ("4 of the 12 relevant papers aren't cited") keyed on the
  // old pool of 12 admitted papers with 8 cited. Under the
  // wave eight standard the admitted pool is the 4 on
  // substrate papers and all 4 are cited, so no uncited line
  // is owed — and none may be invented. The withheld line,
  // the distinction this test exists to pin, still prints
  // with its own count.
  assert.ok(!/aren't cited in this summary/.test(md), "uncited-count line appeared though every admitted paper is cited");
  assert.ok(/4 more papers were found but withheld/.test(md), "relevance-gated line missing");
});

test("falsification section has no generic filler; honest when empty", () => {
  const md = buildExtractiveSynthesis(incidentPapers(), [], { query: INCIDENT_QUERY });
  assert.ok(md, "expected a synthesis");
  assert.doesNotMatch(md, /well-powered replication/, "generic falsification filler survived");
  const falsSection = md.split("## What would change this")[1].split("*Drafted directly")[0];
  assert.ok(/No specific falsification test is derivable/.test(falsSection), "honest empty-falsification line missing");
});

test("buildFalsificationBullets never emits the generic replication bullet", () => {
  const bullets = buildFalsificationBullets({ papers: incidentPapers(), verdict: { status: "settled", conflicts: [] }, newestYear: 2023 });
  assert.ok(!bullets.some((b) => /well-powered replication|direct measurement study finding no effect/.test(b)), "generic bullet emitted: " + JSON.stringify(bullets));
});

// ── 2026-10-08 correctness deep dive regressions ──
// From Dusty's production photos: first-person plagiarism, fake precision,
// paywalled copy, and contradictory verdict signals.

group("Correctness deep dive — Dusty's production defects");

test("confidence line never shows a pseudo-precise /100 score", () => {
  // Standing rule: never claim a precise score without evidence.
  // "8 sources agree" does not equal 99/100.
  const many = [INC_PAPER, AGREE_PAPER, INC_PAPER, AGREE_PAPER, INC_PAPER, AGREE_PAPER, INC_PAPER, AGREE_PAPER];
  const strong = buildConfidenceLine(many, { status: "settled" });
  assert.doesNotMatch(strong.line, /\/100/, "confidence line shows pseudo-precise score: " + strong.line);
  assert.match(strong.line, /Strong confidence/, "level missing");
  assert.match(strong.line, /8 cited sources/, "real basis (cited source count) missing");
  const thin = buildConfidenceLine([INC_PAPER], { status: "thin" });
  assert.doesNotMatch(thin.line, /\/100/, "thin line shows pseudo-precise score");
});

test("extractive closing never teases a paywall on correctness", () => {
  const md = buildExtractiveSynthesis(incidentPapers(), [], { query: INCIDENT_QUERY, aiGateReason: "signin-required" });
  assert.doesNotMatch(md, /sign in for AI-synthesized answers/, "paywall tease survived");
  const capped = buildExtractiveSynthesis(incidentPapers(), [], { query: INCIDENT_QUERY, aiGateReason: "free-cap" });
  assert.doesNotMatch(capped, /you've used this period's free AI answers\. The papers above are listed/, "old paywall copy survived");
});

test("synthesis prompt bans first-person research claims", async () => {
  // Dusty's photo: "Our findings on genetic diversity revealed..." — the AI
  // presenting papers' findings as its own. The prompt must ban this explicitly.
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  assert.match(src, /RULE 8: NEVER CLAIM THE RESEARCH AS YOUR OWN/, "first-person ban rule missing from prompt");
  assert.match(src, /our findings.*our results.*we found/s, "banned first-person phrases not listed");
});

test("synthesis prompt requires abbreviation expansion on first use", async () => {
  // Dusty's photo: "Increased SD concentration..." with SD never defined.
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  assert.match(src, /RULE 9: ABBREVIATIONS EXPANDED ON FIRST USE/, "abbreviation rule missing from prompt");
});

test("synthesis prompt requires complete headings", async () => {
  // Dusty's photo: "Microbiome · Gut · Black" cut off mid-phrase.
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  assert.match(src, /RULE 10: HEADINGS ARE COMPLETE PHRASES/, "heading completeness rule missing from prompt");
});

test("synthesis prompt opens with the direct answer, never teach first", async () => {
  // Panel 2026-10-13: PERSONALITY said TEACH FIRST (orient the reader for
  // 2-3 sentences before reporting findings) while RULE 1, the required
  // structure, and CITE_RULES in the same assembled prompt all demanded a
  // direct claim in the first sentence. One rule survives: the direct
  // answer opens, teaching follows inside the answer.
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  assert.match(src, /ANSWER FIRST, THEN TEACH/, "answer-first rule missing from PERSONALITY");
  assert.match(src, /Your FIRST WORD must begin a direct scientific claim/, "RULE 1 direct-claim opener missing");
  assert.match(src, /The FIRST sentence must directly answer the question asked/, "structure direct-answer rule missing");
  assert.ok(!src.includes("TEACH FIRST"), "defeated teach-first instruction still in the prompt");
  assert.ok(!src.includes("Before reporting findings, orient the reader"), "defeated orientation-before-findings text still in the prompt");
});

test("synthesis prompts ground strictly in the papers; background is marked, never a finding", async () => {
  // Panel 2026-10-13: CONTEXT_BASE told the model to extend seamlessly with
  // its broader knowledge ("Your knowledge IS the ceiling . papers are
  // evidence anchors, not limits") while CITE_RULES demanded strict
  // grounding in the abstracts, and the synthesis branch prompts restated
  // the permissive side ("YOUR KNOWLEDGE IS PRIMARY", the thin-evidence
  // "answer from your own scientific knowledge", the web branch's "mention
  // the general findings"). Every copy is resolved to the strict side:
  // claims come from the retrieved papers; general background may orient
  // only where plainly marked as background, never as a finding and never
  // carrying a citation. The honesty pass existence rule is pinned here
  // too, so resolving the contradiction cannot quietly weaken it.
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  for (const defeated of [
    "then seamlessly extend with your broader knowledge",
    "Your knowledge IS the ceiling",
    "papers are evidence anchors, not limits",
    "YOUR KNOWLEDGE IS PRIMARY",
    "Papers ANCHOR your answer but are NOT the ceiling",
    "then answer from knowledge",
    "then answer from your own",
    "mention the general findings",
    "Give a COMPLETE answer using your scientific knowledge",
  ]) {
    assert.ok(!src.includes(defeated), "defeated permissive phrasing still in a prompt: " + defeated);
  }
  assert.match(src, /THE PAPERS ARE THE EVIDENCE BASE/, "branch prompt missing the strict grounding rule");
  assert.match(src, /ZERO-HALLUCINATION GROUNDING/, "strict grounding rule missing from CITE_RULES");
  assert.match(src, /answer only what the sources support/, "gap handling must stop at what the sources support");
  // Honesty pass existence rule, preserved exactly:
  assert.match(src, /None of the papers retrieved here report X/, "bounded existence wording missing");
  assert.match(src, /NEVER write 'the literature does not report X'/, "literature-wide existence ban missing");
  assert.match(src, /None of the retrieved/, "deterministic existence line must stay bounded to the retrieved set");
});

test("synthesis prompts teach facts with citations as support; paper framing is reserved for provenance", async () => {
  // Dusty 2026-10-13: answers came back as paper based responses (reports
  // about papers) instead of factual teachings supported by the papers.
  // The diagnosis: VOICE RULE 8 mandated report framing ("Always
  // attribute: 'the authors found', 'the study reports'...") and no copy
  // anywhere stated the teaching frame. Every synthesis prompt copy now
  // carries the rule in so many words: claims phrased as facts about the
  // world, explained plainly; citations attach as support; paper framing
  // is reserved for disagreement, a single weak source, and methods the
  // reader must weigh. Grounding is untouched (see the strict grounding
  // pin above, existence rule included).
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  // Main prompt (PERSONALITY, VOICE RULE 2B, CITE_RULES, structure):
  assert.match(src, /TEACH THE ANSWER, DO NOT REPORT THE LITERATURE/, "PERSONALITY missing the teaching rule");
  assert.match(src, /RULE 2B: TEACH, DO NOT REPORT/, "VOICE missing RULE 2B");
  assert.match(src, /The default sentence frame is the fact itself/, "fact-first frame rule missing");
  assert.match(src, /citation is the warranty/, "citations-as-support rule missing");
  assert.match(src, /reserved for the few places provenance itself is the information/, "provenance reservation missing from PERSONALITY");
  assert.match(src, /TEACHING FRAME: the citation is the warranty, not the subject/, "CITE_RULES missing the teaching frame");
  // Branch copies carry it too (main STEP 2, compact, bulletproof,
  // enforcer, both retries, the additional papers digest):
  assert.match(src, /Teach those findings as facts about the world, explained plainly, not as reports about papers/, "main branch STEP 2 missing the teaching frame");
  assert.match(src, /Teach the answer as plain facts about the world, the way a knowledgeable assistant explains it/, "compact prompt missing the teaching frame");
  assert.match(src, /Teach plainly: findings stated as facts about the world/, "bulletproof prompt missing the teaching frame");
  assert.match(src, /TEACH, DO NOT REPORT: phrase claims as facts about the world/, "enforcer missing the teaching frame");
  assert.match(src, /TEACH, DO NOT REPORT: phrase claims as facts about the world, explained plainly, with citations as support/, "quality retry missing the teaching frame");
  assert.match(src, /Teach plainly: state findings as facts about the world/, "no-citation retry missing the teaching frame");
  assert.match(src, /State what the paper establishes as a plain fact about the world in one sentence/, "digest branch still asks for report-style findings");
  assert.ok((src.match(/[Pp]aper framing only where provenance matters/g) || []).length >= 2, "provenance reservation must ride in the branch copies too");
  // The defeated report-style instructions are gone:
  assert.ok(!src.includes("Always attribute:"), "RULE 8 still mandates attribution framing");
  assert.ok(!src.includes("State the key finding in one sentence with the citation"), "digest branch still uses the report-style finding instruction");
});

test("extractive fallback frame: answer line first, excerpts labeled, no report frame", async () => {
  // The limited tier opened with "## What the sources say" and narrated
  // the pipeline's own process ("N of the papers above had abstracts
  // detailed enough to draw findings from... The sentences below are
  // the ones that speak to the question most closely"), and the weak
  // answer explained itself under "Why this isn't a summary". All of
  // it made the fallback read as a report about papers. The corrected
  // contract: the honest answer line leads, quoted passages sit under
  // Supporting evidence labeled as quotations, and headings describe
  // the evidence, not the document.
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  assert.ok(!src.includes('"## What the sources say'), "limited tier still emits the report frame heading");
  assert.ok(!src.includes("had abstracts detailed enough to draw findings from"), "limited tier still narrates its own process");
  assert.ok(!src.includes("speak to the question most closely"), "limited tier narration survived");
  assert.ok(!src.includes("Why this isn't a summary"), "weak answer still uses the self referential heading");
  assert.ok(!src.includes("stitching together sentences"), "weak answer still narrates the pipeline's choice");
  assert.ok(!src.includes("answering a different question confidently"), "weak answer constraint lead still narrates the pipeline's choice");
  assert.match(src, /## The short answer/, "limited tier must lead under The short answer");
  assert.match(src, /### Supporting evidence/, "limited tier must present passages under Supporting evidence");
  assert.match(src, /Passages quoted from the papers/, "limited tier must label its passages as quotations");
  assert.match(src, /Why the evidence falls short/, "weak answer reasons heading must describe the evidence");
});

test("extractive venue lines never print a raw year value", async () => {
  // The "2015.0" artifact: the extractive venue lines interpolated p.year
  // verbatim, so a float string year from a source printed as "2015.0".
  // All three venue sites now route through extractiveYearText.
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  assert.ok(!src.includes("[p.journal, p.year]"), "weak/background venue still prints the raw year");
  assert.ok(!src.includes("[it.p.journal, it.p.year]"), "extractive venue still prints the raw year");
  assert.ok((src.match(/extractiveYearText\(/g) || []).length >= 4, "extractiveYearText definition and its three call sites must exist");
});

group("stripLeakedMetaCommentary — leaks stripped, paragraphs kept (2026-10-14)");

// The cleanup used to collapse every run of 2+ whitespace to one
// space after stripping, which flattened every paragraph break in
// the shipped AI answer (the depth wave found it; the client's
// heading repair partially masked it downstream). The strip must
// keep doing its one job — leaked enforcement asides never ship —
// while the model's paragraph structure survives: horizontal
// whitespace collapses, 3+ newlines cap at one blank line, single
// newlines stay.
test("a multi paragraph model answer ships with its paragraphs intact", () => {
  const model = [
    "## Summary",
    "",
    "Diet changes reshape the gut community in black soldier fly larvae [1]. The microbial community shifts within days of a diet switch.",
    "",
    "A second paragraph opens here",
    "and continues on the next line.",
    "",
    "- Larvae on bran carried more Lactobacillus [2]",
    "- Larvae on oil carried fewer taxa overall [3]",
  ].join("\n");
  const out = stripLeakedMetaCommentary(model);
  assert.ok(out.includes("## Summary\n\nDiet changes reshape"),
    "the heading's paragraph break was flattened");
  assert.ok(out.includes("diet switch.\n\nA second paragraph opens here"),
    "the paragraph break between body paragraphs was flattened");
  assert.ok(out.includes("opens here\nand continues"),
    "a single newline inside a paragraph must survive");
  assert.ok(out.includes("Lactobacillus [2]\n- Larvae on oil"),
    "list lines keep their single newlines");
});

test("horizontal whitespace collapses and 3+ newlines cap at a blank line", () => {
  const messy = "Words   with\truns\tof   space.\n\n\n\nNext paragraph after a gap.";
  const out = stripLeakedMetaCommentary(messy);
  assert.equal(out, "Words with runs of space.\n\nNext paragraph after a gap.");
});

test("a leaked enforcement aside is stripped and the paragraphs around it survive", () => {
  const leaked = [
    "The gut community tracks the diet closely [1].",
    "",
    "[MECHANICAL ENFORCEMENT NOTE: the banned phrase below will be stripped to comply with the rules]",
    "",
    "That is why diet trials report shifts within a single instar [2].",
  ].join("\n");
  const out = stripLeakedMetaCommentary(leaked);
  assert.ok(!/MECHANICAL/i.test(out), "the leaked aside shipped");
  assert.ok(!/banned phrase/i.test(out), "the leaked aside shipped");
  assert.ok(out.includes("closely [1].\n\nThat is why diet trials"),
    "stripping the aside must not fuse the surrounding paragraphs");
});

test("empty and leak only inputs stay safe", () => {
  assert.equal(stripLeakedMetaCommentary(""), "");
  assert.equal(stripLeakedMetaCommentary(null), null);
  assert.equal(
    stripLeakedMetaCommentary("[enforcement note: this will be removed]"),
    "",
    "an answer that is only a leak strips to empty, never ships the leak");
});

// ══════════════════════════════════════════════════════════════════════════
await Promise.all(pending);
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
