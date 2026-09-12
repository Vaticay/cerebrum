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
} from "../functions/api/search.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}\n      ${e.message.split("\n")[0]}`);
  }
}

function group(name) {
  console.log(`\n${name}`);
}

const searchSrc = await readFile(join(root, "functions/api/search.js"), "utf8");
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");

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
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
