/**
 * Answer-instrument tests: the QueryAutopsy funnel, the AnswerArc era
 * grouping, and the OpenQuestions gap extraction.
 *
 * Unit tests against the real modules — no server, no database, no network.
 * Everything asserted here is deterministic: the same turn data must always
 * produce the same lines, and nothing may be invented.
 *
 * Run with: node tests/answer-insights.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

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
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

function group(name) {
  console.log(`\n${name}`);
}

const {
  sanitizeFunnel,
  funnelStages,
  funnelExclusions,
  splitAnswerSections,
  extractCitedIndices,
  groupSourcesIntoEras,
  disagreementCitedIndices,
  annotateEras,
  describeEra,
  describeConvergence,
  extractOpenQuestions,
  isCoveredByAnswer,
  classifyVennPapers,
} = await import(join(root, "src/answerInsights.js"));

// ══════════════════════════════════════════════════════════════════════════
group("Retrieval funnel — _funnel attachment (backend)");

const searchSrc = await readFile(join(root, "functions/api/search.js"), "utf8");

await test("_funnel ships exactly the six numbers, nothing else", () => {
  assert.match(searchSrc, /_funnel: \(\(\) => \{/, "_funnel IIFE missing from the response");
  for (const k of ["gathered", "deduped", "excludedWeak", "excludedNonEnglish", "excludedRetracted", "cited"]) {
    assert.ok(new RegExp(`\\b${k}:`).test(searchSrc), `_funnel missing key ${k}`);
  }
});

await test("_funnel is numbers-only — no error text or provider internals", () => {
  const start = searchSrc.indexOf("_funnel: (() => {");
  assert.ok(start > 0, "_funnel block not found");
  const block = searchSrc.slice(start, searchSrc.indexOf("})(),", start));
  assert.ok(!/error|message|stack|provider|apiKey|token/i.test(block.replace(/excludedNonEnglish/g, "")),
    "non-numeric content inside the _funnel block");
  assert.ok(!/_diag\.(?!funnel)/.test(block), "_funnel leaks raw _diag beyond the funnel counters");
});

await test("_funnel degrades to null when retrieval never ran", () => {
  assert.match(searchSrc, /if \(!f \|\| typeof f\.gathered !== "number"\) return null/,
    "_funnel does not null out when the funnel counters are absent");
});

await test("gatherPapers counts the funnel at every dedup site", () => {
  assert.match(searchSrc, /funnel\.gathered\+\+/, "gathered is never counted");
  assert.match(searchSrc, /funnel\.deduped = merged\.length/, "deduped is never recorded");
  assert.match(searchSrc, /funnel\.ranked = scoredFinal\.length/, "ranked is never recorded");
  assert.match(searchSrc, /funnel\.nonEnglishInner\+\+/, "inner language filter is never counted");
  assert.match(searchSrc, /excludedNonEnglishOuter = papers\.length - englishOnly\.length/,
    "outer English filter is never counted");
});

await test("sanitizeFunnel accepts a well-formed payload", () => {
  const f = sanitizeFunnel({ gathered: 120, deduped: 90, excludedWeak: 70, excludedNonEnglish: 3, excludedRetracted: 0, cited: 8 });
  assert.deepEqual(f, { gathered: 120, deduped: 90, excludedWeak: 70, excludedNonEnglish: 3, excludedRetracted: 0, cited: 8 });
});

await test("sanitizeFunnel rejects missing or non-numeric payloads", () => {
  assert.equal(sanitizeFunnel(null), null);
  assert.equal(sanitizeFunnel(undefined), null);
  assert.equal(sanitizeFunnel("120"), null);
  assert.equal(sanitizeFunnel({ gathered: 120, deduped: 90 }), null, "partial payload accepted");
  assert.equal(sanitizeFunnel({ gathered: "many", deduped: 90, excludedWeak: 0, excludedNonEnglish: 0, excludedRetracted: 0, cited: 1 }), null);
});

await test("sanitizeFunnel floors and clamps numbers", () => {
  const f = sanitizeFunnel({ gathered: 12.7, deduped: -4, excludedWeak: 0, excludedNonEnglish: 0, excludedRetracted: 0, cited: 3 });
  assert.equal(f.gathered, 12);
  assert.equal(f.deduped, 0);
});

await test("funnelStages derives the ranked stage deterministically", () => {
  const stages = funnelStages({ gathered: 100, deduped: 80, excludedWeak: 60, excludedNonEnglish: 2, excludedRetracted: 0, cited: 8 });
  assert.deepEqual(stages.map((s) => [s.label, s.count]), [
    ["Gathered", 100], ["Deduped", 80], ["Ranked", 20], ["Cited", 8],
  ]);
});

await test("funnelExclusions counts duplicates as gathered minus deduped", () => {
  const rows = funnelExclusions({ gathered: 100, deduped: 80, excludedWeak: 60, excludedNonEnglish: 2, excludedRetracted: 0, cited: 8 });
  assert.equal(rows.find((r) => r.reason === "Duplicates").count, 20);
  assert.equal(rows.find((r) => r.reason === "Weak match").count, 60);
  assert.equal(rows.find((r) => r.reason === "Non-English").count, 2);
  const retracted = rows.find((r) => r.reason === "Retracted");
  assert.equal(retracted.count, 0);
  assert.ok(/never silently dropped/.test(retracted.note), "retracted row must say what happens instead");
});

// ══════════════════════════════════════════════════════════════════════════
group("AnswerArc — era grouping");

const arcSources = (years, extra = {}) =>
  years.map((y, i) => ({ title: `Paper ${i} (${y})`, year: String(y), journal: "J", relevance: 50 + (i % 10), citations: extra.citations ? extra.citations[i] : 0, ...extra.perSource?.[i] }));

await test("groups a real year span into three chronological eras", () => {
  const eras = groupSourcesIntoEras(arcSources([1998, 2001, 2005, 2012, 2018, 2024]));
  assert.ok(eras && eras.length === 3, `expected 3 eras, got ${eras && eras.length}`);
  assert.deepEqual(eras.map((e) => e.name), ["Foundations", "Building", "Current"]);
  assert.ok(eras[0].papers.every((p) => p.year <= eras[1].papers[0].year), "eras not chronological");
});

await test("fewer than 2 distinct years hides the toggle (returns null)", () => {
  assert.equal(groupSourcesIntoEras(arcSources([2020, 2020, 2020])), null);
  assert.equal(groupSourcesIntoEras(arcSources([2020])), null);
  assert.equal(groupSourcesIntoEras([]), null);
  assert.equal(groupSourcesIntoEras([{ title: "No year", year: "" }]), null);
});

await test("anchor is the top-cited paper when citation counts exist", () => {
  const srcs = arcSources([2001, 2002, 2003], { citations: [5, 400, 12] });
  const eras = groupSourcesIntoEras(srcs);
  // 2002 lands in the Building era — its anchor must be the 400-citation paper.
  const era2002 = eras.find((e) => e.papers.some((p) => p.year === 2002));
  assert.ok(era2002, "no era contains 2002");
  assert.ok(era2002.anchor.source.title.includes("Paper 1"), `wrong anchor: ${era2002.anchor.source.title}`);
  assert.equal(era2002.anchorCitations, 400);
});

await test("anchor falls back to relevance with no citation data", () => {
  const srcs = arcSources([2000, 2001, 2002, 2010, 2011, 2012]);
  srcs.forEach((s) => { s.citations = 0; });
  srcs[1].relevance = 99; // the 2001 paper, inside Foundations
  const eras = groupSourcesIntoEras(srcs);
  const era = eras.find((e) => e.name === "Foundations");
  assert.ok(era && era.papers.length === 3, "test setup wrong");
  assert.ok(era.anchor.source.title.includes("Paper 1"), `anchor is not the most relevant paper: ${era.anchor.source.title}`);
  assert.equal(era.anchorCitations, null);
  const line = describeEra(era, false);
  assert.ok(/highest relevance match/.test(line), `line does not disclose the fallback: ${line}`);
});

await test("era line follows the deterministic format", () => {
  const eras = groupSourcesIntoEras(arcSources([1998, 2000, 2015, 2020], { citations: [10, 3, 50, 7] }));
  const line = describeEra(eras[0], true);
  assert.match(line, /^\d{4}(–\d{4})? · \d+ papers? · anchored by .+ \(\d+ citations?\) · \d+ back core claims — based on cited sources only\.$/);
});

await test("single-paper eras are labeled honestly", () => {
  const eras = groupSourcesIntoEras(arcSources([1998, 1999, 2024]));
  const single = eras.find((e) => e.papers.length === 1);
  assert.ok(single, "expected a single-paper era");
  assert.ok(/\b1 paper\b/.test(describeEra(single, false)), "single-paper era not labeled as 1 paper");
});

await test("fact-check claims map to eras with first-evidence years", () => {
  const srcs = arcSources([1999, 2005, 2015, 2021]);
  const eras = groupSourcesIntoEras(srcs);
  const factCheck = {
    mode: "claims",
    claims: [
      { claim: "X improves Y [1][2]", status: "supported", note: "" },
      { claim: "Z harms W [4]", status: "supported", note: "" },
    ],
  };
  const out = annotateEras(eras, { factCheck, sources: srcs });
  assert.ok(out.eras[0].claimCount >= 1, "foundations era got no claims");
  assert.equal(out.eras[0].claimFirstYear, 1999);
  const line = describeEra(out.eras[0], true);
  assert.ok(/first evidence for a core claim appears in 1999/.test(line), `missing first-evidence clause: ${line}`);
});

await test("disagreement-cited papers flag their era as contested", () => {
  const srcs = arcSources([1999, 2005, 2015, 2021]);
  const eras = groupSourcesIntoEras(srcs);
  const answer = "## The short answer\nFine.\n\n## What the research shows\nStuff.\n\n## Where researchers disagree\nSome say X [3], others say Y [4].\n\n## How solid is this?\nOkay.";
  const idx = disagreementCitedIndices(answer, srcs.length);
  assert.deepEqual(idx, [3, 4]);
  const out = annotateEras(eras, { factCheck: null, disagreementIndices: idx, sources: srcs });
  const contested = out.eras.filter((e) => e.disagreementCount > 0);
  assert.ok(contested.length > 0, "no era flagged contested");
  assert.ok(/cited in disagreements/.test(describeEra(contested[0], false)));
});

await test("convergence read compares the newest era against older work", () => {
  const srcs = arcSources([1999, 2000, 2020, 2021]);
  const eras = groupSourcesIntoEras(srcs);
  const factCheck = {
    mode: "claims",
    claims: [
      { claim: "A [3]", status: "supported", note: "" },
      { claim: "B [4]", status: "supported", note: "" },
      { claim: "C [1]", status: "supported", note: "" },
    ],
  };
  const out = annotateEras(eras, { factCheck, sources: srcs });
  assert.ok(out.convergence, "no convergence computed");
  assert.equal(out.convergence.supportedTotal, 3);
  assert.equal(out.convergence.supportedRecent, 2);
  const line = describeConvergence(out.convergence, out.eras[out.eras.length - 1]);
  assert.ok(/^67% of supported claims cite the Current era/.test(line), `unexpected convergence line: ${line}`);
  assert.ok(/based on cited sources only/.test(line), "convergence line not hedged");
});

await test("no supported claims means no convergence line", () => {
  const srcs = arcSources([1999, 2021]);
  const eras = groupSourcesIntoEras(srcs);
  const out = annotateEras(eras, { factCheck: { mode: "claims", claims: [] }, sources: srcs });
  assert.equal(out.convergence, null);
  assert.equal(describeConvergence(null, out.eras[1]), null);
});

// ══════════════════════════════════════════════════════════════════════════
group("OpenQuestions — gap extraction");

const oqSources = [
  { title: "Alpha study", year: "2019" },
  { title: "Beta trial", year: "2021" },
  { title: "Gamma review", year: "2023" },
];

const oqAnswer = [
  "## The short answer",
  "Yes, with caveats [1].",
  "",
  "## What the research shows",
  "The effect is real [1][2].",
  "",
  "## Where researchers disagree",
  "Whether the effect persists beyond six months remains unclear [2]. No studies have tested this in adolescents.",
  "",
  "## How solid is this?",
  "The mechanism is still unknown, and long-term safety data are not yet available [3].",
  "",
  "## What would change this",
  "A null result in a large trial.",
].join("\n");

await test("gap sentences are extracted from sections 3-4 with quotes", () => {
  const cards = extractOpenQuestions(oqAnswer, null, oqSources, null);
  assert.ok(cards.length >= 3, `expected >=3 gap cards, got ${cards.length}`);
  const unclear = cards.find((c) => /remains unclear/.test(c.question));
  assert.ok(unclear, "remains-unclear sentence not extracted");
  assert.ok(unclear.sourceSentence.includes("[2]"), "source sentence lost its citations");
  assert.deepEqual(unclear.startWith.map((e) => e.n), [2], "entry papers wrong");
  assert.equal(unclear.startWith[0].title, "Beta trial");
  const noStudies = cards.find((c) => /No studies have tested/.test(c.question));
  assert.ok(noStudies, "no-studies sentence not extracted");
  assert.ok(/no studies/i.test(noStudies.whyOpen), "why-open does not reflect the pattern");
});

await test("map mode's 'What is still open' section is mined", () => {
  const answer = "## The landscape\nField.\n\n## The major lines of work\nLines.\n\n## What is still open\nThe causal mechanism remains unclear [1].\n\n## Where to start reading\nRead [1].";
  const cards = extractOpenQuestions(answer, null, oqSources, null);
  assert.ok(cards.some((c) => /remains unclear/.test(c.question) && /What is still open/.test(c.sourceLabel)),
    "map-mode gap section not mined");
});

await test("thin and unsupported claims become single-study fragility cards", () => {
  const factCheck = {
    mode: "claims",
    claims: [
      { claim: "X cures Y [1]", status: "supported", note: "" },
      { claim: "X prevents Z [2]", status: "thin", note: "one small trial [2]" },
      { claim: "X reverses aging", status: "unsupported", note: "no source states this" },
    ],
  };
  const cards = extractOpenQuestions("## A\nNothing hedged here at all, just a plain answer with no gaps.", factCheck, oqSources, null);
  const fragile = cards.filter((c) => c.kind === "fragile");
  assert.equal(fragile.length, 2, `expected 2 fragile cards, got ${fragile.length}`);
  assert.ok(/Single-study claim/.test(fragile[0].whyOpen), "thin claim not labeled single-study");
  assert.ok(/reaches past its sources/.test(fragile[1].whyOpen), "unsupported claim mislabeled");
  assert.ok(!cards.some((c) => /X cures Y/.test(c.question)), "supported claim leaked into gaps");
});

await test("terms-mode fact-checks never produce gap cards", () => {
  const factCheck = { mode: "terms", claims: [{ claim: "BRCA1", status: "thin", note: "" }] };
  const cards = extractOpenQuestions("## A\nA plain answer.", factCheck, oqSources, null);
  assert.equal(cards.length, 0, "terms-mode check produced a gap card");
});

await test("uncovered query-plan angles become cards; covered ones do not", () => {
  const answer = "## A\nDiet influences the gut microbiome through fiber fermentation [1].";
  const selfReasoning = {
    subQuestions: [
      "How does diet influence the gut microbiome?",
      "What are the quantum implications for Martian geology?",
    ],
  };
  const cards = extractOpenQuestions(answer, null, oqSources, selfReasoning);
  const angles = cards.filter((c) => c.kind === "angle");
  assert.equal(angles.length, 1, `expected 1 uncovered angle, got ${angles.length}`);
  assert.ok(/Martian/.test(angles[0].question), "wrong angle surfaced");
  assert.ok(/query plan/i.test(angles[0].sourceLabel), "angle source not labeled");
});

await test("isCoveredByAnswer is deterministic and conservative", () => {
  assert.equal(isCoveredByAnswer("How does diet influence the gut microbiome?", "diet influences the gut microbiome through fiber"), true);
  assert.equal(isCoveredByAnswer("What are the quantum implications for Martian geology?", "diet influences the gut"), false);
  assert.equal(isCoveredByAnswer("???", "anything"), true, "judgment-free input must not invent a gap");
});

await test("no gaps anywhere means no cards (the button hides)", () => {
  const cards = extractOpenQuestions("## A\nA plain, settled answer with none of the hedge patterns.", null, oqSources, null);
  assert.deepEqual(cards, []);
});

await test("cards are deduplicated and capped", () => {
  const answer = "## A\nX.\n\n## B\nY.\n\n## C\n" +
    Array.from({ length: 10 }, (_, i) => `Point ${i} remains unclear [1].`).join(" ") +
    "\n\n## D\n" + Array.from({ length: 10 }, (_, i) => `Other ${i} is still unknown [2].`).join(" ");
  const cards = extractOpenQuestions(answer, null, oqSources, null);
  assert.ok(cards.length <= 6, `cap exceeded: ${cards.length}`);
  const keys = cards.map((c) => c.question.toLowerCase());
  assert.equal(new Set(keys).size, keys.length, "duplicate cards emitted");
});

await test("every card quotes its source sentence", () => {
  const cards = extractOpenQuestions(oqAnswer, null, oqSources, null);
  assert.ok(cards.length > 0);
  for (const c of cards) {
    assert.ok(c.sourceSentence && c.sourceSentence.length >= 40, "card missing its source quote");
    assert.ok(c.question && c.whyOpen && c.whatWouldCloseIt, "card missing a required field");
    assert.ok(Array.isArray(c.startWith), "card missing entry papers array");
  }
});

// ══════════════════════════════════════════════════════════════════════════
group("Frontend wiring — the three instruments");

const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");

await test("turn carries the instrument payloads from the response", () => {
  assert.match(appSrc, /_resolver: data\._resolver \|\| null/, "_resolver not passed to the turn");
  assert.match(appSrc, /_selfReasoning: data\._selfReasoning \|\| null/, "_selfReasoning not passed to the turn");
  assert.match(appSrc, /_funnel: data\._funnel \|\| null/, "_funnel not passed to the turn");
});

await test("query autopsy drawer is funnel-first with demoted sections", () => {
  assert.match(appSrc, /function QueryAutopsy/, "QueryAutopsy component missing");
  assert.match(appSrc, /How this was built/, "autopsy entry link missing");
  assert.match(appSrc, /onShowAutopsy=\{setAutopsyTurn\}/, "autopsy opener not wired to TurnRow");
  for (const kicker of ["01 · Retrieval funnel", "02 · Query reading", "03 · Exclusions", "04 · Synthesis", "05 · Stress test", "06 · Evidence structure"]) {
    assert.ok(appSrc.includes(kicker), `autopsy section missing: ${kicker}`);
  }
  assert.match(appSrc, /not recorded for this answer/, "autopsy missing its honest degrade");
  assert.match(appSrc, /<ModalChrome drawer/, "autopsy not on the shared drawer chrome");
  // The funnel hero comes before query reading in the file.
  assert.ok(appSrc.indexOf("01 · Retrieval funnel") < appSrc.indexOf("02 · Query reading"),
    "funnel is not the first autopsy section");
});

await test("timeline modal is Arc-only with year-strips in era headers", () => {
  assert.match(appSrc, /function LiteratureTimeline/, "LiteratureTimeline missing");
  assert.ok(!/\["plot", "Plot"\]/.test(appSrc), "Plot|Arc toggle still present");
  assert.match(appSrc, /<AnswerArc turn=\{turn\}/, "AnswerArc not rendered in the timeline modal");
  assert.match(appSrc, /function EraYearStrip/, "EraYearStrip missing");
  assert.match(appSrc, /turn=\{timelineSources\}/, "timeline no longer receives the turn");
  assert.match(appSrc, /<ModalChrome label="The arc of this literature"/, "timeline not on the shared modal chrome");
});

await test("open-questions button renders only when gaps surface", () => {
  assert.match(appSrc, /function OpenQuestions/, "OpenQuestions component missing");
  // The entry point moved from the toolbar into the labeled More menu, but
  // the gate is unchanged: the item is only built when gaps surfaced.
  assert.match(appSrc, /openQuestions\.length > 0 \? \[\{\s*\n?\s*id: "openquestions"/, "open-questions menu item not gated on gaps found");
  assert.match(appSrc, /No open questions surfaced in this literature/, "honest empty state missing");
  assert.match(appSrc, /extractOpenQuestions\(t\.answer, t\.factCheck, t\.sources, t\._selfReasoning\)/,
    "gap extraction not fed from the turn");
});

// ══════════════════════════════════════════════════════════════════
group("Venn classification — where each cited paper stands");

const VENN_SOURCES = [
  { title: "Paper A" }, { title: "Paper B" }, { title: "Paper C" },
  { title: "Paper D" }, { title: "Paper E" },
];

await test("supported claims land in agree", () => {
  const r = classifyVennPapers({
    answer: "", sources: VENN_SOURCES,
    factCheck: { claims: [{ claim: "X works [1][2]", status: "supported" }] },
  });
  assert.deepEqual(r.agree, [1, 2]);
  assert.deepEqual(r.disagree, []);
  assert.deepEqual(r.middle, []);
  assert.deepEqual(r.unclear, [3, 4, 5]);
});

await test("unsupported, thin, and contradicted claims land in disagree", () => {
  const r = classifyVennPapers({
    answer: "", sources: VENN_SOURCES,
    factCheck: { claims: [
      { claim: "X fails [1]", status: "unsupported" },
      { claim: "Y unclear [2]", status: "thin" },
      { claim: "Z refuted [3]", status: "contradicted" },
    ] },
  });
  assert.deepEqual(r.disagree, [1, 2, 3]);
  assert.deepEqual(r.agree, []);
  assert.deepEqual(r.unclear, [4, 5]);
});

await test("partly and mixed claims land in the middle", () => {
  const r = classifyVennPapers({
    answer: "", sources: VENN_SOURCES,
    factCheck: { claims: [
      { claim: "X maybe [1]", status: "partly" },
      { claim: "Y mixed [2]", status: "mixed" },
    ] },
  });
  assert.deepEqual(r.middle, [1, 2]);
  assert.deepEqual(r.unclear, [3, 4, 5]);
});

await test("a paper both supporting a claim and contested moves to the middle", () => {
  const r = classifyVennPapers({
    answer: "## Where researchers disagree\nHowever [1] found the opposite.",
    sources: VENN_SOURCES,
    factCheck: { claims: [{ claim: "X works [1]", status: "supported" }] },
  });
  assert.deepEqual(r.middle, [1]);
  assert.deepEqual(r.agree, []);
  assert.deepEqual(r.disagree, []);
});

await test("papers with no signal stay unclear, never placed", () => {
  const r = classifyVennPapers({ answer: "Plain text.", sources: VENN_SOURCES, factCheck: null });
  assert.deepEqual(r.agree, []);
  assert.deepEqual(r.disagree, []);
  assert.deepEqual(r.middle, []);
  assert.deepEqual(r.unclear, [1, 2, 3, 4, 5]);
});

await test("citation indices are bounded and every paper lands exactly once", () => {
  const r = classifyVennPapers({
    answer: "Disagreement: [9] is contested, and [0] is not a citation.",
    sources: VENN_SOURCES,
    factCheck: { claims: [{ claim: "All of it [1][2][3][4][5][6]", status: "supported" }] },
  });
  const all = [...r.agree, ...r.disagree, ...r.middle, ...r.unclear].sort((a, b) => a - b);
  assert.deepEqual(all, [1, 2, 3, 4, 5]);
  for (const n of all) assert.ok(n >= 1 && n <= 5, `out-of-range index ${n}`);
});

await test("empty sources classify to empty regions", () => {
  assert.deepEqual(classifyVennPapers({ answer: "", sources: [], factCheck: null }),
    { agree: [], disagree: [], middle: [], unclear: [] });
});

// ══════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
