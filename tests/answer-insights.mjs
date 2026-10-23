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
import { readFileSync } from "node:fs";

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
  // 2026-10-13 (trust release): the funnel IIFE was hoisted into a single
  // publicFunnel const above the response so _coverage and _record ship
  // the identical numbers; the response field is now `_funnel: publicFunnel`.
  // The contract is unchanged: exactly these six keys, computed in one place.
  assert.match(searchSrc, /const publicFunnel = \(\(\) => \{/, "publicFunnel IIFE missing above the response");
  assert.match(searchSrc, /_funnel: publicFunnel/, "_funnel does not ship publicFunnel");
  const start = searchSrc.indexOf("const publicFunnel = (() => {");
  const block = searchSrc.slice(start, searchSrc.indexOf("})();", start));
  for (const k of ["gathered", "deduped", "excludedWeak", "excludedNonEnglish", "excludedRetracted", "cited"]) {
    // Shorthand (`gathered,`) and keyed (`cited:`) entries both count: the
    // original pin matched `key:` anywhere in the file, which the funnel
    // literal's shorthand properties satisfied only by accident.
    assert.ok(new RegExp(`\\b${k}\\s*[:,]`).test(block), `_funnel missing key ${k}`);
  }
});

await test("_funnel is numbers-only — no error text or provider internals", () => {
  const start = searchSrc.indexOf("const publicFunnel = (() => {");
  assert.ok(start > 0, "_funnel block not found");
  const block = searchSrc.slice(start, searchSrc.indexOf("})();", start));
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
  // Pin updated 2026-10-23 (L7-15): era names are neutral; year alone never makes an era Foundations.
  assert.deepEqual(eras.map((e) => e.name), ["Earliest", "Middle", "Most recent"]);
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
  // 2002 lands in the Middle era — its anchor must be the 400-citation paper.
  const era2002 = eras.find((e) => e.papers.some((p) => p.year === 2002));
  assert.ok(era2002, "no era contains 2002");
  assert.ok(era2002.anchor.source.title.includes("Paper 1"), `wrong anchor: ${era2002.anchor.source.title}`);
  assert.equal(era2002.anchorCitations, 400);
});

await test("anchor falls back to relevance with no citation data", () => {
  const srcs = arcSources([2000, 2001, 2002, 2010, 2011, 2012]);
  srcs.forEach((s) => { s.citations = 0; });
  srcs[1].relevance = 99; // the 2001 paper, inside Earliest (pin updated 2026-10-23, L7-15)
  const eras = groupSourcesIntoEras(srcs);
  const era = eras.find((e) => e.name === "Earliest");
  assert.ok(era && era.papers.length === 3, "test setup wrong");
  assert.ok(era.anchor.source.title.includes("Paper 1"), `anchor is not the most relevant paper: ${era.anchor.source.title}`);
  assert.equal(era.anchorCitations, null);
  const line = describeEra(era, false);
  assert.ok(/highest relevance match/.test(line), `line does not disclose the fallback: ${line}`);
});

await test("era line follows the deterministic format", () => {
  const eras = groupSourcesIntoEras(arcSources([1998, 2000, 2015, 2020], { citations: [10, 3, 50, 7] }));
  const line = describeEra(eras[0], true);
  assert.match(line, /^\d{4}( to \d{4})? · \d+ papers? · anchored by .+ \(\d+ citations?\) · \d+ back core claims, based on cited sources only\.$/);
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
  // Pin updated 2026-10-19 (S2 / M19): the convergence line states
  // counts, never a percentage — 2 of 3 printed as 67% was pseudo
  // precision. The supported counts themselves stay pinned above.
  // Pin updated 2026-10-23 (L7-15): the newest era is Most recent, not Current.
  assert.ok(/^2 of 3 supported claims cite the Most recent era/.test(line), `unexpected convergence line: ${line}`);
  assert.ok(!/%/.test(line), "convergence line still carries a percentage");
  assert.ok(/based on cited sources only/.test(line), "convergence line not hedged");
});

await test("no supported claims means no convergence line", () => {
  const srcs = arcSources([1999, 2021]);
  const eras = groupSourcesIntoEras(srcs);
  const out = annotateEras(eras, { factCheck: { mode: "claims", claims: [] }, sources: srcs });
  assert.equal(out.convergence, null);
  assert.equal(describeConvergence(null, out.eras[1]), null);
});

await test("provenance traced claims never feed the convergence read", () => {
  // The extractive wording trace's claims carry status "traced"
  // (seventh panel, wave eight round two): the answer's wording
  // was traced to those papers, which is not support. A run whose
  // only check is the trace must produce no convergence read at
  // all — counting traces as supported claims would state a
  // recency share for a verification that never ran.
  const srcs = arcSources([1999, 2000, 2020, 2021]);
  const eras = groupSourcesIntoEras(srcs);
  const factCheck = {
    mode: "extractive",
    checkKind: "provenance",
    claims: [
      { claim: "A [3]", status: "traced", note: "" },
      { claim: "B [4]", status: "traced", note: "" },
      { claim: "C [1]", status: "traced", note: "" },
    ],
  };
  const out = annotateEras(eras, { factCheck, sources: srcs });
  assert.equal(out.convergence, null,
    "traced claims fed the supported claims convergence read");
  assert.equal(out.claimsTotal, 3, "the trace's claims still count as checked claims");
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
  assert.ok(/Single study claim/.test(fragile[0].whyOpen), "thin claim not labeled single study");
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

await test("the traced status renders as a trace everywhere the panel reads statuses", () => {
  // Seventh panel, wave eight round two: a provenance claim's
  // status is "traced", and every client surface that turns a
  // status into words or a stamp must know the word — the fact
  // check panel's row label, the calibration stamp, and the
  // panel's own pass counting (a trace passes as "traced", never
  // as "supported" and never as a failure).
  assert.match(appSrc, /c\.status === "traced" \? "Traced to the cited paper's wording"/,
    "the fact check panel has no honest label for a traced claim");
  assert.match(appSrc, /ev\.status === "traced" \? "Traced to the cited paper's wording"/,
    "the calibration stamp has no honest label for a traced paragraph");
  assert.match(appSrc, /const passStatus = isExtractive \? "traced" : "supported";/,
    "the fact check panel does not key its pass status on the check's kind");
  assert.match(appSrc, /traced: 1, supported: 2/,
    "the evidence map does not rank the traced status");
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
  // Wave seven: the arc is a media surface, so its chrome carries
  // the media opt in; the pin follows the corrected shape.
  assert.match(appSrc, /<ModalChrome media label="The arc of this literature"/, "timeline not on the shared modal chrome");
});

await test("open-questions button renders only when gaps surface", () => {
  assert.match(appSrc, /function OpenQuestions/, "OpenQuestions component missing");
  // The entry point moved from the toolbar into the labeled More menu, but
  // the gate is unchanged: the item is only built when gaps surfaced.
  assert.match(appSrc, /openQuestions\.length > 0 \? \[\{\s*\n?\s*id: "openquestions"/, "open-questions menu item not gated on gaps found");
  // Pin updated 2026-10-23 (L7-18): the empty state uses the one
  // approved absence phrasing, held as NO_GAPS_PHRASE in the shared
  // presentation module and rendered by the empty state.
  assert.match(appSrc, /NO_GAPS_PHRASE/, "empty state does not use the approved absence phrasing");
  const presSrc = readFileSync(join(root, "src/answerPresentation.js"), "utf8");
  assert.match(presSrc, /No gaps were detected by these checks/, "approved absence phrasing missing");
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

await test("traced claims place nothing: a wording trace is not a stance", () => {
  // A provenance trace means the answer's wording comes from the
  // paper. It says where the words came from, not what the paper
  // concludes, so it can never count the paper as a supporter.
  const r = classifyVennPapers({
    answer: "", sources: VENN_SOURCES,
    factCheck: { mode: "extractive", claims: [{ claim: "X works [1][2]", status: "traced" }] },
  });
  assert.deepEqual(r.agree, []);
  assert.deepEqual(r.disagree, []);
  assert.deepEqual(r.middle, []);
  assert.deepEqual(r.unclear, [1, 2, 3, 4, 5]);
});

await test("only contradicted claims land in disagree; thin qualifies and unsupported places nothing", () => {
  const r = classifyVennPapers({
    answer: "", sources: VENN_SOURCES,
    factCheck: { claims: [
      { claim: "X fails [1]", status: "unsupported" },
      { claim: "Y unclear [2]", status: "thin" },
      { claim: "Z refuted [3]", status: "contradicted" },
    ] },
  });
  assert.deepEqual(r.disagree, [3]);
  assert.deepEqual(r.middle, [2]);
  assert.deepEqual(r.agree, []);
  assert.deepEqual(r.unclear, [1, 4, 5]);
});

await test("a paper number mentioned in a checker note inherits no stance", () => {
  const r = classifyVennPapers({
    answer: "", sources: VENN_SOURCES,
    factCheck: { claims: [
      { claim: "X works", status: "supported", note: "\"quote\" [2]. Compare paper [3] on this point." },
    ] },
  });
  assert.deepEqual(r.agree, []);
  assert.deepEqual(r.disagree, []);
  assert.deepEqual(r.middle, []);
  assert.deepEqual(r.unclear, [1, 2, 3, 4, 5]);
});

await test("structured claim indices place papers without any note text", () => {
  const r = classifyVennPapers({
    answer: "", sources: VENN_SOURCES,
    factCheck: { claims: [
      { claim: "X works", status: "supported", cites: [2] },
      { claim: "Y fails", status: "contradicted", sourceIndex: 4 },
    ] },
  });
  assert.deepEqual(r.agree, [2]);
  assert.deepEqual(r.disagree, [4]);
  assert.deepEqual(r.unclear, [1, 3, 5]);
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

await test("papers in a literature conflict pair move to middle, not agree", () => {
  // 2026-10-08: Dusty's photo showed "supports 8, contests 0" alongside
  // "1 conflicting claim pair" — a contradiction. Conflicted papers must
  // be visible as contested, not cleanly supporting.
  const r = classifyVennPapers({
    answer: "Gut diversity drops with dose [1][2].",
    sources: VENN_SOURCES,
    factCheck: { claims: [] },
    conflicts: [{ idxA: 1, idxB: 2, claimA: "X", claimB: "Y" }],
  });
  assert.deepEqual(r.middle, [1, 2], "conflicted papers not moved to middle");
  assert.ok(!r.agree.includes(1) && !r.agree.includes(2), "conflicted papers still in agree");
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

await test("papers cited in the answer body stay unclear without a stance signal", () => {
  // Citation is use, not stance. The soil cracking shape (body
  // citations, no fact check claims, an uncited disagreement
  // section) used to read as unanimous support; every paper is
  // unclassified, so every paper stays in unclear.
  const r = classifyVennPapers({
    answer: "## The short answer\nCracks form as soil dries [1][2].\n## What the research shows\nTensile stress drives it [2][3].\n## Where researchers disagree\nNo clear divide on timing.",
    sources: [{ title: "A" }, { title: "B" }, { title: "C" }],
    factCheck: null,
  });
  assert.deepEqual(r.agree, []);
  assert.deepEqual(r.disagree, []);
  assert.deepEqual(r.middle, []);
  assert.deepEqual(r.unclear, [1, 2, 3]);
});

await test("a paper cited only in the disagreement section lands in the middle", () => {
  const r = classifyVennPapers({
    answer: "## The short answer\nCracks form as soil dries.\n## Where researchers disagree\nBut [2] reports otherwise.",
    sources: [{ title: "A" }, { title: "B" }],
    factCheck: null,
  });
  assert.deepEqual(r.agree, []);
  assert.deepEqual(r.disagree, []);
  assert.deepEqual(r.middle, [2]);
  assert.deepEqual(r.unclear, [1]);
});

await test("a paper cited in both the body and the disagreement section lands in the middle", () => {
  const r = classifyVennPapers({
    answer: "## The short answer\nCracks form [1][2].\n## Where researchers disagree\nBut [2] reports otherwise.",
    sources: [{ title: "A" }, { title: "B" }],
    factCheck: null,
  });
  assert.deepEqual(r.agree, []);
  assert.deepEqual(r.disagree, []);
  assert.deepEqual(r.middle, [2]);
  assert.deepEqual(r.unclear, [1]);
});

await test("fact-check status places its paper; a body citation alone places nothing", () => {
  const r = classifyVennPapers({
    answer: "Cracks form [1][2].",
    sources: [{ title: "A" }, { title: "B" }],
    factCheck: { claims: [{ claim: "Cracks form [2]", status: "contradicted" }] },
  });
  assert.deepEqual(r.agree, []);
  assert.deepEqual(r.disagree, [2]);
  assert.deepEqual(r.unclear, [1]);
});

// ══════════════════════════════════════════════════════════════════
group("Honesty pass — cited denominators, fallback rules, and fact check coverage");

const backend = await import(join(root, "functions/api/search.js"));
const {
  buildConfidenceLine: backendConfidence,
  buildDisagreementVerdict: backendVerdict,
  buildExtractiveSynthesis: backendExtractive,
  labelUncitedSources: backendLabelUncited,
  verifyExtractiveAlignment: backendVerifyAlignment,
  publicConfidence: backendPublicConfidence,
  factCheckSupport: backendFactCheckSupport,
  publicStageHealth: backendPublicStageHealth,
  runStage: backendRunStage,
} = backend;

const strongCitedPapers = Array.from({ length: 12 }, (_, i) => ({
  title: `Cited paper ${i + 1}`,
  abstract: "A detailed abstract reports a measured result with enough supporting detail for the answer.",
  year: 2025,
  relevance: 90,
  type: "Journal",
  semanticScore: 80,
}));

await test("disagreement verdict counts only the cited set it was given", () => {
  const settled = backendVerdict([], 3);
  assert.equal(settled.status, "settled");
  assert.match(settled.summary, /3 cited sources checked/);
  assert.match(settled.summary, /does not show that every cited source agrees/);
  const thin = backendVerdict([], 2);
  assert.equal(thin.status, "thin");
  assert.match(thin.summary, /only 2 cited sources could be checked/);
  assert.match(thin.summary, /not a consensus/);
});

await test("confidence rests on cited papers (never calls them support) and caps degraded or unchecked answers", () => {
  // Corrected contract (2026-10-14 verdict correctness pass): this pin
  // used to assert the line "12 cited sources support this answer".
  // Citation is use, not agreement . the line now rests on the cited
  // count and claims support only from fact check claim verdicts.
  const clean = backendConfidence(strongCitedPapers, { status: "settled" }, { factCheckChecked: true });
  assert.equal(clean.level, "strong");
  // Pin change (2026-10-23, logic audit L6-5): the score used to
  // read 100 here because most of its points paid for retrieval
  // and packaging (count, relevance, venue type, recency,
  // abstracts, semantic match). The evidence only score reads
  // this set as class rank 2 of 4 with full study breadth and a
  // settled verdict: 84, still the strong band. The level
  // contract below is unchanged.
  assert.equal(clean.score, 84);
  assert.match(clean.line, /this answer rests on 12 cited sources/);
  assert.ok(!/cited sources? support this answer/.test(clean.line),
    "line must not call cited papers supporting");

  const degraded = backendConfidence(strongCitedPapers, { status: "settled" }, { degraded: true, factCheckChecked: true });
  assert.ok(degraded.score <= 59, `degraded answer was not capped: ${degraded.score}`);
  assert.equal(degraded.level, "moderate");
  assert.match(degraded.line, /Confidence is capped/);

  const unchecked = backendConfidence(strongCitedPapers, { status: "settled" }, { factCheckChecked: false });
  assert.ok(unchecked.score <= 59, `unchecked answer was not capped: ${unchecked.score}`);
  assert.notEqual(unchecked.level, "strong");

  const limited = backendConfidence(strongCitedPapers, { status: "settled" }, { tier: "limited", factCheckChecked: true });
  assert.ok(limited.score <= 45, `limited answer was not capped: ${limited.score}`);
  assert.equal(limited.level, "thin");

  const lowRelevance = backendConfidence(
    strongCitedPapers.map((p) => ({ ...p, relevance: 30 })),
    { status: "settled" },
    { factCheckChecked: true }
  );
  assert.ok(lowRelevance.score <= 45, `low relevance answer was not capped: ${lowRelevance.score}`);
  assert.equal(lowRelevance.level, "thin");
});

await test("handler wires verdict and confidence to the cited subset", () => {
  assert.match(searchSrc, /detectSourceConflicts\(citedConflictPapers, citedBriefClaims\)/,
    "disagreement detection does not read the cited subset");
  assert.match(searchSrc, /buildConfidenceLine\(citedEvidencePapers, disagreementVerdict/,
    "confidence does not read the cited subset");
  assert.match(searchSrc, /cited: labeledSources\.filter\(\(s\) => s && !s\.uncited\)\.length/,
    "handler funnel cited does not count cited flags");
});

await test("bibliography markers in a fallback Sources list do not cite papers", () => {
  const out = backendLabelUncited(
    [{ title: "A" }, { title: "B" }, { title: "C" }],
    "The first paper reports a detailed experimental result that supports this claim [1].\n\n" +
    "### Sources\n\n- **A** [1]\n- **B** [2]\n- **C** [3]"
  );
  assert.equal(out[0].uncited, undefined);
  assert.equal(out[1].uncited, true);
  assert.equal(out[2].uncited, true);
});

await test("deterministic existence rule answers yes from a direct retrieved report", () => {
  const md = backendExtractive(
    [{
      title: "Digestive enzyme activity in whole gut homogenates of adult cockroaches",
      abstract:
        "Researchers ground whole insect guts and assayed digestive enzyme activity in the resulting homogenate without purifying the enzymes. " +
        "Activity remained measurable in the crude preparation across repeated samples.",
      year: 2023,
      journal: "J Test",
      relevance: 90,
    }],
    null,
    { query: "Do researchers ever just grind up insect intestines and test the juice for enzymes?" }
  );
  assert.ok(md, "expected a deterministic answer");
  assert.match(md, /Yes\. At least one retrieved paper reports this practice directly/);
  assert.match(md, /\[1\]/);
});

await test("deterministic existence rule scopes a negative to the retrieved papers", () => {
  const md = backendExtractive(
    [
      {
        title: "Insect gut microbiome survey",
        abstract: "Researchers sequenced bacterial communities from insect intestines and compared taxa across several diets and host species.",
        year: 2022,
        journal: "J Test",
        relevance: 35,
      },
      {
        title: "Purified enzyme kinetics in vitro",
        abstract: "Purified enzymes were isolated from insect tissue and their kinetics were measured in vitro under controlled conditions.",
        year: 2021,
        journal: "J Test",
        relevance: 35,
      },
    ],
    null,
    { query: "Do researchers ever just grind up insect intestines and test the juice for enzymes?" }
  );
  assert.ok(md, "expected a deterministic answer");
  assert.match(md, /None of the retrieved papers report this practice directly/);
  assert.doesNotMatch(md, /No researchers ever|No studies exist|does not exist in the literature/);
});

await test("fact check alignment covers the limited fallback section and stops at Sources", () => {
  const paper = {
    title: "Desiccation cracking in clay soils",
    abstract: "Desiccation cracking was observed in clay soil samples under controlled drying conditions.",
    year: 2023,
  };
  const res = backendVerifyAlignment(
    "## What the sources say\n\n" +
    "Desiccation cracking was observed in clay soil samples under controlled drying conditions [1].\n\n" +
    "### Sources\n\n- **Desiccation cracking in clay soils** [1]",
    [paper]
  );
  assert.equal(res.checked, true);
  assert.equal(res.claims.length, 1, "bibliography line was treated as a second claim");
  // Corrected contract (2026-10-14, seventh panel, wave eight
  // round two): the copied sentence's claim carries "traced" —
  // the alignment check is the provenance wording trace, and its
  // pass word is the trace's own, never "supported".
  assert.equal(res.claims[0].status, "traced");
});

await test("fact check alignment covers Summary and reports zero checked claims honestly", () => {
  const paper = {
    title: "Desiccation cracking in clay soils",
    abstract: "Desiccation cracking was observed in clay soil samples under controlled drying conditions.",
    year: 2023,
  };
  const checked = backendVerifyAlignment(
    "## Summary\n\nDesiccation cracking was observed in clay soil samples under controlled drying conditions [1].",
    [paper]
  );
  assert.equal(checked.checked, true);
  assert.equal(checked.claims.length, 1);
  // Answers stored before the 2026-10-14 rename carry the old
  // "## Executive Summary" lede; the checker still covers that
  // section name so a stored answer's lede claims stay checked.
  const legacy = backendVerifyAlignment(
    "## Executive Summary\n\nDesiccation cracking was observed in clay soil samples under controlled drying conditions [1].",
    [paper]
  );
  assert.equal(legacy.checked, true);
  assert.equal(legacy.claims.length, 1);
  const empty = backendVerifyAlignment(
    "## What the sources say\n\nA short paragraph with no citation marker at all.",
    [paper]
  );
  assert.equal(empty.checked, false);
  // Corrected contract (2026-10-14, sixth panel, Job 1): the
  // extractive check is a wording trace, so its empty summary
  // speaks of tracing, not checking.
  assert.match(empty.summary, /No cited claims were found to trace/);
  // Pin updated 2026-10-13 (wave two part two) to the corrected
  // contract, not weakened: the old pin banned the literal
  // `name: "fact-check", ok: true` anywhere in the source, which was
  // free to assert only because the old pushes computed ok inline
  // (and computed it WRONG for this case: ok false on nothing to
  // verify, which degraded healthy answers). The invariant this pin
  // protects is unchanged . the stage may report ok true ONLY when
  // claims were actually checked . and is now pinned at the guard of
  // each of the two pushes, with the unchecked case an explicit skip.
  assert.equal((searchSrc.match(/name: "fact-check", ok: true/g) || []).length, 2,
    "expected exactly two fact check ok pushes, one per path");
  assert.match(searchSrc, /if \(aligned\.checked\) \{\s*factCheckResult = aligned;\s*stageHealth\.push\(\{ name: "fact-check", ok: true,/,
    "the extractive fact check push is not guarded by aligned.checked");
  assert.match(searchSrc, /if \(fcChecked\) \{\s*stageHealth\.push\(\{ name: "fact-check", ok: true,/,
    "the AI fact check push is not guarded by fcChecked");
  assert.match(searchSrc, /name: "fact-check", ok: null, skipReason: "nothing to verify"/,
    "an unchecked fact check must record a skip, never a healthy or failed stage");
});

// ══════════════════════════════════════════════════════════════════
group("Verdict correctness — support, shipped shapes, and stage reasons (2026-10-14)");

await test("support counts come from fact check claim verdicts, never citation counts", () => {
  assert.deepEqual(
    backendFactCheckSupport({ claims: [{ status: "supported" }, { status: "unsupported" }, { status: "thin" }, { status: "supported" }] }),
    { supported: 2, checked: 4 });
  assert.equal(backendFactCheckSupport(null), null);
  assert.equal(backendFactCheckSupport({ claims: [] }), null);
  assert.equal(backendFactCheckSupport({ overall: "supported" }), null);

  // With check data, the strong line says what the check supports.
  const withCheck = backendConfidence(strongCitedPapers, { status: "settled" },
    { factCheckChecked: true, support: { supported: 9, checked: 10 } });
  assert.equal(withCheck.level, "strong");
  assert.match(withCheck.line, /The claim check supports 9 of 10 checked claims/);
  assert.ok(!/cited sources? support/.test(withCheck.line),
    "line must not describe cited papers as supporting");

  // Without check data the line claims no support at all.
  const noCheck = backendConfidence(strongCitedPapers, { status: "settled" }, { factCheckChecked: true });
  assert.match(noCheck.line, /this answer rests on 12 cited sources/);
  assert.ok(!/support/.test(noCheck.line), "line claims support with no check behind it");
});

await test("divided confidence line states the split, not a tautology", () => {
  const papers5 = strongCitedPapers.slice(0, 5);
  const verdict = backendVerdict([
    { idxA: 1, idxB: 2 }, { idxA: 3, idxB: 2 },
  ], 5);
  assert.equal(verdict.status, "divided");
  const conf = backendConfidence(papers5, verdict, { factCheckChecked: true });
  assert.equal(conf.level, "moderate");
  assert.match(conf.line, /split on 2 points: 2 cited sources appear on one side and 1 on the other/);
  assert.ok(!/cited sources are cited/.test(conf.line), "the tautology must stay gone");
  // A hand built verdict without sides still gets a meaningful line.
  const bare = backendConfidence(papers5, { status: "divided", conflictCount: 2 }, { factCheckChecked: true });
  assert.match(bare.line, /genuinely split on 2 points/);
  assert.ok(!/are cited, and they split/.test(bare.line), "the old divided wording must stay gone");
});

await test("the numeric confidence score and its factors never ship", () => {
  const full = {
    level: "strong", line: "Strong confidence: this answer rests on 12 cited sources.",
    score: 87, factors: ["12 cited sources (+15)"], cap: 59, capReasons: ["x"],
    rawScore: 92, calibrated: true, calibrationAdjustments: ["y"], verdictStatus: "settled",
  };
  const pub = backendPublicConfidence(full);
  assert.deepEqual(pub, { level: "strong", line: "Strong confidence: this answer rests on 12 cited sources." });
  assert.deepEqual(Object.keys(pub).sort(), ["level", "line"]);
  assert.equal(backendPublicConfidence(null), null);
  // Every ship point serializes through publicConfidence.
  assert.match(searchSrc, /confidence: publicConfidence\(confidence\)/,
    "main response ships the raw confidence object");
  assert.match(searchSrc, /confidence: publicConfidence\(earlyTrust\.confidence\)/,
    "early cache serve ships the raw confidence object");
  assert.match(searchSrc, /confidence: publicConfidence\(laterTrust\.confidence\)/,
    "later cache serve ships the raw confidence object");
});

await test("cached serves resolve an unrecorded mode to extractive, never AI", () => {
  // Corrected contract (2026-10-14, seventh panel, wave eight
  // round two): the stored payload now records the mode that
  // produced the answer, and both cache serves ship the recorded
  // mode when the payload carries one. What this pin protects is
  // unchanged — an UNRECORDED mode resolves to the extractive
  // wording, never to AI — and it now lives in the fallback each
  // serve applies to its stored signals.
  assert.equal((searchSrc.match(/\(earlyTrustSignals && earlyTrustSignals\.synthesisMode\) \|\| "extractive"|\(laterTrustSignals && laterTrustSignals\.synthesisMode\) \|\| "extractive"/g) || []).length, 2,
    "both cached serves must resolve an unrecorded mode to extractive");
  assert.match(appSrc, /synthesisMode: data\.synthesisMode \|\| "extractive"/,
    "the turn default for a missing mode must be extractive");
  assert.ok(!/synthesisMode: data\.synthesisMode \|\| "ai"/.test(appSrc),
    "a missing mode must never default to AI");
});

await test("a null fact check renders as did not run, never as nothing to verify", () => {
  assert.ok(appSrc.includes('"Check did not run"'),
    "the did not run kicker is missing from the fact check section");
  assert.ok(appSrc.includes('state === "empty" ? "Nothing to verify"'),
    "Nothing to verify must be gated to the ran-empty state");
  assert.ok(!appSrc.includes('kicker={t.factCheck && t.factCheck.error ? "Check failed" : "Nothing to verify"}'),
    "the old unconditional Nothing to verify kicker must stay gone");
});

await test("every failed stage record ships a skipReason (builder sweep)", async () => {
  // The audited shape: a bare retrieval failure with no reason.
  const swept = backendPublicStageHealth([
    { name: "retrieval", ok: false, ms: 12 },
    { name: "validation", ok: false, ms: 3, skipReason: "no leg answered" },
    { name: "synthesis", ok: false, ms: 9, skipReason: "all legs failed" },
    { name: "fact-check", ok: null, ms: 1, skipReason: "nothing to verify" },
    { name: "retrieval", ok: true, ms: 5 },
  ]);
  for (const s of swept) {
    if (s.ok === false) {
      assert.ok(typeof s.skipReason === "string" && s.skipReason.length > 0,
        `stage ${s.name} shipped failed with no skipReason`);
    }
  }
  // Builders' own reasons survive verbatim; only the bare failure gains one.
  assert.equal(swept[0].skipReason, "stage failed");
  assert.equal(swept[1].skipReason, "no leg answered");
  assert.equal(swept[2].skipReason, "all legs failed");
  assert.equal(swept[3].skipReason, "nothing to verify");
  assert.ok(!("skipReason" in swept[4]), "a healthy stage must not gain a reason");

  // The runStage builders (retrieval, validation) record their reason
  // at the source: a throw is a failure with a reason, a timeout is
  // named as a timeout.
  const failHealth = [];
  const failRun = await backendRunStage("retrieval", async () => { throw new Error("boom"); }, { health: failHealth });
  assert.equal(failRun.ok, false);
  assert.equal(failHealth[0].ok, false);
  assert.equal(failHealth[0].skipReason, "stage failed");
  const slowHealth = [];
  const slowRun = await backendRunStage("retrieval", () => new Promise(() => {}), { health: slowHealth, timeoutMs: 5 });
  assert.equal(slowRun.ok, false);
  assert.equal(slowHealth[0].skipReason, "stage timed out");
});

// ══════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
