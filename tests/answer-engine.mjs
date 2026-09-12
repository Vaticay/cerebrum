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
  // NEXT-GEN resilience pipeline (v7.0)
  runStage,
  extractPaperClaims,
  detectSourceConflicts,
  verifyExtractiveAlignment,
  postCheckAIAlignment,
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

test("normalizePaperTitle is case/punctuation/whitespace insensitive", () => {
  assert.equal(
    normalizePaperTitle("Soil Cracking: Patterns, Mechanisms!"),
    normalizePaperTitle("soil   cracking patterns mechanisms")
  );
});

// ══════════════════════════════════════════════════════════════════════════
group("applyRelevanceGate — the citation floor");

test("RELEVANCE_FLOOR is 60 (strong + top of partial survive)", () => {
  assert.equal(RELEVANCE_FLOOR, 60);
});

test("papers at or above 60 survive; below 60 never enter synthesis", () => {
  const papers = [
    { title: "A", relevance: 82 },
    { title: "B", relevance: 60 },
    { title: "C", relevance: 59.9 },
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

test("selection applies the gate with NO ungated top-8 fallback", () => {
  assert.ok(searchSrc.includes("applyRelevanceGate(papers).slice(0, maxEvidence)"));
  assert.ok(!searchSrc.includes("papers.slice(0, 8)"), "ungated fallback still present");
});

test("synthesis layer re-applies the gate after validation (supplementary fetches)", () => {
  assert.ok(searchSrc.includes("evidencePapers = applyRelevanceGate(evidencePapers)"));
});

test("withheld count is reported in the answer envelope", () => {
  assert.ok(searchSrc.includes("relevanceGatedOut"), "relevanceGatedOut missing from search.js");
  const envIdx = searchSrc.indexOf("sources: sourceList,");
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
  assert.ok(appSrc.includes("function sourceKeys(s)"), "sourceKeys missing");
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
  assert.match(verdict.summary, /consistent/);
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
  const many = [INC_PAPER, AGREE_PAPER, INC_PAPER, AGREE_PAPER, INC_PAPER, AGREE_PAPER];
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
  for (const h of ["## The short answer", "## What the research shows", "## Where researchers disagree", "## How solid is this?", "## What would change this"]) {
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
  const catchIdx = searchSrc.indexOf("top-level error:");
  assert.ok(catchIdx > 0);
  const after = searchSrc.slice(catchIdx, catchIdx + 2000);
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
  assert.ok(appSrc.includes("shares real vocabulary with the paper"), "extractive copy missing");
  assert.ok(appSrc.includes("assembled without AI"), "extractive caveat missing");
});

test("'NOT CHECKED' is gone; empty states say what is actually true", () => {
  assert.ok(!appSrc.includes('"NOT CHECKED"'), "NOT CHECKED still present");
  assert.ok(appSrc.includes("No scientific claims to verify."), "honest empty state missing");
});

test("disagreement fallback uses the computed verdict, not a default", () => {
  assert.ok(appSrc.includes("t.disagreementVerdict"), "verdict not read");
  assert.ok(appSrc.includes('"THIN EVIDENCE"'), "thin kicker missing");
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
  assert.ok(appSrc.includes("Further reading — not cited above"), "further-reading label missing");
});

test("degraded pipeline states are visible, not silent", () => {
  assert.ok(appSrc.includes("t.degraded"), "degraded flag not read");
  assert.ok(appSrc.includes("07 · Pipeline health"), "autopsy health section missing");
});

test("connection-failure panel offers rephrasing, not just retry", () => {
  const idx = appSrc.indexOf('kicker="CONNECTION FAILED"');
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

// ══════════════════════════════════════════════════════════════════════════
await Promise.all(pending);
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
