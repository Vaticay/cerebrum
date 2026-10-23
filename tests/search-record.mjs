/**
 * Search record + coverage disclosure tests (trust release, 2026-10-13).
 *
 * No AI literature tool ships a stable, exportable, re runnable record
 * of a search, and the published critiques fault every major tool on
 * reproducibility and on coverage honesty. buildSearchRecord and
 * buildCoverage in functions/api/search.js productize the diagnostics
 * Cerebrum already computes (diag.sourceOutcomes, diag.funnel, the
 * frozen source list, the synthesis model) into a compact record plus
 * a per answer coverage disclosure.
 *
 * These tests pin the record's shape, the null contract (return null
 * when retrieval never ran, never invent), year plausibility filtering,
 * cited flag derivation, funnel conversion from the internal diag
 * shape, and the client's rendering: the coverage sentence, the Search
 * record disclosure, and its Copy record and Download record actions.
 * No network, no DOM: the server builders are imported directly and the
 * client is pinned by source, the suite style used across this repo.
 *
 * Run with: node tests/search-record.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildSearchRecord, buildCoverage, buildCachedServeTrust, mintSearchRecordId, storeSearchRecord, applyRecordStoreOutcome } = await import(join(root, "functions/api/search.js"));
const recordRoute = await import(join(root, "functions/record/[id].js"));
const searchSrc = readFileSync(join(root, "functions/api/search.js"), "utf8");
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const recordRouteSrc = readFileSync(join(root, "functions/record/[id].js"), "utf8");

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

// A complete, realistic run record input: diag carries the internal
// funnel shape (gathered, deduped, ranked, nonEnglishInner) exactly as
// gatherPapers records it, and the sources are the labeled final list.
const FULL_INPUT = {
  question: "does zorblaxin affect quixotase activity",
  askedAt: new Date("2026-10-13T14:00:00.000Z"),
  diag: {
    structuredQuery: "(zorblaxin OR \"zorb extract\") AND (quixotase OR quixotase activity)",
    conceptExpanded: ["zorblaxin quixotase", "zorb extract quixotase activity"],
    llmExpanded: [{ term: "zorblaxin", alternates: ["zorb extract", "zorblaxin metabolite"] }],
    rungs: [
      { terms: ["zorblaxin", "quixotase"], got: 71, perSource: [] },
      { terms: ["zorblaxin"], got: 12, perSource: [] },
    ],
    topicMemoryRecall: ["zorblaxin quixotase activity assay"],
    relaxedBoolean: { query: "(\"zorblaxin\" OR \"zorb extract\") AND (quixotase OR activity)", count: 4 },
    questionDecomposition: [{ aspect: "mechanism", query: "zorblaxin quixotase mechanism" }],
    sourceOutcomes: [
      { source: "europePMC", ok: true, count: 40 },
      { source: "pubmed", ok: true, count: 31 },
      { source: "openAlex", ok: false, count: 0 },
    ],
    funnel: { gathered: 88, deduped: 61, ranked: 12, nonEnglishInner: 2 },
  },
  synthesisModel: "groq:openai/gpt-oss-120b",
  sources: [
    { title: "Zorblaxin inhibits quixotase in vitro", authors: "Zorblax A, Quixote B", journal: "Journal of Zorblaxin Studies", year: 2021, url: "https://doi.org/10.1000/abc123", uncited: false },
    { title: "Quixotase kinetics in leaf tissue", authors: [{ name: "Leaf C" }, { name: "Stem D" }], journal: "Leaf Tissue Quarterly", year: 2016, doi: "10.2000/xyz789", uncited: false },
    { title: "A review of zorblaxin chemistry", year: 2019, url: "https://example.org/review", uncited: true },
  ],
};

// ═══════════════════════════════════════════════════════════════════
group("buildSearchRecord: shape");

await test("assembles the full record from diag, funnel and sources", () => {
  const rec = buildSearchRecord(FULL_INPUT);
  assert.ok(rec, "record must not be null for a completed retrieval");
  // Version 2 (2026-10-13 record completeness pass): sources carry
  // authors and journal, and the record carries the executed query
  // set. The pin moves with the deliberate version bump.
  assert.equal(rec.version, 2);
  assert.equal(rec.askedAt, "2026-10-13T14:00:00.000Z");
  assert.equal(rec.question, FULL_INPUT.question);
  assert.equal(rec.structuredQuery, FULL_INPUT.diag.structuredQuery);
  assert.deepEqual(rec.conceptQueries, FULL_INPUT.diag.conceptExpanded);
  assert.deepEqual(rec.llmExpansion, FULL_INPUT.diag.llmExpanded);
  // Yield and corpus ride each entry (2026-10-23, L2-1): the
  // count named for what it counts, and the distinct database
  // behind the slot.
  assert.deepEqual(rec.databases, [
    { source: "europePMC", ok: true, count: 40, yield: 40, corpus: "Europe PMC" },
    { source: "pubmed", ok: true, count: 31, yield: 31, corpus: "PubMed" },
    { source: "openAlex", ok: false, count: 0, yield: 0, corpus: "OpenAlex" },
  ]);
  assert.equal(rec.synthesisModel, "groq:openai/gpt-oss-120b");
  assert.equal(rec.sources.length, 3);
});

await test("converts the internal diag funnel to the public shape", () => {
  // Corrected contract (2026-10-13 honesty pass): funnel cited is the
  // count of cited flags on the source list. FULL_INPUT labels two
  // sources cited and one uncited, so the old expectation of 3 pinned
  // the defective whole list count.
  const rec = buildSearchRecord(FULL_INPUT);
  assert.deepEqual(rec.funnel, {
    gathered: 88,
    deduped: 61,
    excludedWeak: 49,
    excludedWeakTitles: [],
    excludedNonEnglish: 2,
    excludedRetracted: 0,
    cited: 2,
    // The four counts named for what they count (2026-10-23, L2-10).
    counts: { arrivals: 88, distinct: 61, shelf: 12, citable: 2 },
  });
});

await test("accepts the public _funnel shape directly", () => {
  const rec = buildSearchRecord({
    question: "q",
    funnel: { gathered: 10, deduped: 8, excludedWeak: 3, excludedNonEnglish: 1, excludedRetracted: 0, cited: 2 },
    sources: [{ title: "A", year: 2020 }, { title: "B", year: 2022 }],
  });
  assert.deepEqual(rec.funnel, { gathered: 10, deduped: 8, excludedWeak: 3, excludedWeakTitles: [], excludedNonEnglish: 1, excludedRetracted: 0, cited: 2, counts: { arrivals: 10, distinct: 8, shelf: 5, citable: 2 } });
  assert.equal(rec.databases, null, "no outcome list means databases stay null, not invented");
});

await test("record is JSON safe and carries no abstracts or answer text", () => {
  const rec = buildSearchRecord({ ...FULL_INPUT, answer: "the answer body [1]" });
  const round = JSON.parse(JSON.stringify(rec));
  assert.deepEqual(round, rec);
  assert.ok(!("answer" in rec), "record must not carry the answer text");
  for (const s of rec.sources) assert.ok(!("abstract" in s), "record sources must not carry abstracts");
});

await test("askedAt accepts epoch ms and ISO strings, normalizing both", () => {
  const a = buildSearchRecord({ ...FULL_INPUT, askedAt: Date.parse("2026-10-13T14:00:00.000Z") });
  assert.equal(a.askedAt, "2026-10-13T14:00:00.000Z");
  const b = buildSearchRecord({ ...FULL_INPUT, askedAt: "2026-10-13T14:00:00.000Z" });
  assert.equal(b.askedAt, "2026-10-13T14:00:00.000Z");
});

// ═══════════════════════════════════════════════════════════════════
group("buildSearchRecord: null when retrieval never ran");

await test("null for empty, missing, and sourceless inputs", () => {
  assert.equal(buildSearchRecord(null), null);
  assert.equal(buildSearchRecord(undefined), null);
  assert.equal(buildSearchRecord({}), null);
  assert.equal(buildSearchRecord({ question: "anything" }), null);
  assert.equal(buildSearchRecord({ question: "q", sources: [{ title: "A", year: 2020 }] }), null,
    "a source list alone is not a retrieval record");
  assert.equal(buildSearchRecord({ diag: { rungs: [] } }), null);
});

await test("never throws on malformed input", () => {
  assert.equal(buildSearchRecord({ diag: "junk", funnel: 42, sources: "nope" }), null);
  const rec = buildSearchRecord({ funnel: { gathered: 5, deduped: 5 }, sources: [null, 42, { title: "Real", year: 2020 }] });
  assert.ok(rec, "a funnel with junk source entries still records");
  assert.equal(rec.sources.length, 3);
  assert.equal(rec.sources[2].title, "Real");
});

// ═══════════════════════════════════════════════════════════════════
group("buildSearchRecord: sources, years, cited flags");

await test("sources are numbered in order with doi or url identifiers", () => {
  const rec = buildSearchRecord(FULL_INPUT);
  assert.deepEqual(rec.sources.map((s) => s.n), [1, 2, 3]);
  assert.equal(rec.sources[0].doi, "10.1000/abc123", "doi parsed out of the doi.org url");
  assert.equal(rec.sources[0].url, "https://doi.org/10.1000/abc123");
  assert.equal(rec.sources[1].doi, "10.2000/xyz789", "doi taken from the doi field");
  assert.equal(rec.sources[2].doi, null);
  assert.equal(rec.sources[2].url, "https://example.org/review");
  for (const s of rec.sources) assert.ok(s.doi || s.url, "every source carries an identifier");
});

await test("cited flags follow the uncited labels on the final list", () => {
  const rec = buildSearchRecord(FULL_INPUT);
  assert.deepEqual(rec.sources.map((s) => s.cited), [true, true, false]);
});

await test("record funnel, coverage, and source flags use one cited definition", () => {
  const sources = Array.from({ length: 12 }, (_, i) => ({
    title: `Paper ${i + 1}`,
    year: 2020 + (i % 3),
    uncited: i >= 3,
  }));
  const input = {
    funnel: { gathered: 95, deduped: 90, excludedWeak: 20, excludedNonEnglish: 0, excludedRetracted: 0, cited: 12 },
    sources,
    answer: "The answer cites the first three papers [1][2][3].",
  };
  const rec = buildSearchRecord(input);
  const cov = buildCoverage(input);
  assert.equal(rec.funnel.cited, 3, "record funnel counted the whole source list");
  assert.equal(cov.cited, 3, "coverage cited disagrees with the source flags");
  assert.equal(cov.furtherReading, 9);
  assert.equal(rec.sources.filter((s) => s.cited).length, 3);
});

await test("markers that appear only in a Sources bibliography do not cite", () => {
  const input = {
    funnel: { gathered: 9, deduped: 9, excludedWeak: 0, excludedNonEnglish: 0, excludedRetracted: 0, cited: 3 },
    sources: [{ title: "A", year: 2020 }, { title: "B", year: 2021 }, { title: "C", year: 2022 }],
    answer:
      "The first paper reports a detailed experimental result that supports this claim [1].\n\n" +
      "### Sources\n\n- **A** [1]\n- **B** [2]\n- **C** [3]",
  };
  const rec = buildSearchRecord(input);
  const cov = buildCoverage(input);
  assert.deepEqual(rec.sources.map((s) => s.cited), [true, false, false]);
  assert.equal(rec.funnel.cited, 1);
  assert.equal(cov.cited, 1);
  assert.equal(cov.furtherReading, 2);
});

await test("cited flags derive from the answer markers when labels are absent", () => {
  const rec = buildSearchRecord({
    funnel: { gathered: 9, deduped: 9, excludedWeak: 0, excludedNonEnglish: 0, excludedRetracted: 0, cited: 3 },
    sources: [{ title: "A", year: 2020 }, { title: "B", year: 2021 }, { title: "C", year: 2022 }],
    answer: "The finding holds [2] and replicates [1].\n\nRelated papers found\n[3] listed there does not count.",
  });
  assert.deepEqual(rec.sources.map((s) => s.cited), [true, true, false],
    "the Related papers append must not count as citing, matching labelUncitedSources");
});

await test("implausible years become null, plausible years survive as numbers", () => {
  const rec = buildSearchRecord({
    funnel: { gathered: 6, deduped: 6 },
    sources: [
      { title: "string year", year: "2021" },
      { title: "no year text", year: "n/a" },
      { title: "three digits", year: 999 },
      { title: "five digits", year: 12000 },
      { title: "missing", year: null },
      { title: "fractional", year: 2020.5 },
    ],
  });
  assert.deepEqual(rec.sources.map((s) => s.year), [2021, null, null, null, null, null]);
});

// ═══════════════════════════════════════════════════════════════════
group("buildSearchRecord: authors, journal, and the executed query set (v2)");

await test("sources carry authors and journal in the shapes the response uses", () => {
  const rec = buildSearchRecord(FULL_INPUT);
  assert.equal(rec.sources[0].authors, "Zorblax A, Quixote B", "string authors pass through");
  assert.equal(rec.sources[0].journal, "Journal of Zorblaxin Studies");
  assert.equal(rec.sources[1].authors, "Leaf C, Stem D", "array authors join by name");
  assert.equal(rec.sources[1].journal, "Leaf Tissue Quarterly");
  assert.equal(rec.sources[2].authors, null, "no author information stays null, never invented");
  assert.equal(rec.sources[2].journal, null);
});

await test("the executed query set recovers rungs and reformulations from diag", () => {
  const rec = buildSearchRecord(FULL_INPUT);
  assert.deepEqual(rec.executedQueries, [
    { kind: "rung", query: "zorblaxin quixotase" },
    { kind: "rung", query: "zorblaxin" },
    { kind: "concept", query: "zorblaxin quixotase" },
    { kind: "concept", query: "zorb extract quixotase activity" },
    { kind: "recall", query: "zorblaxin quixotase activity assay" },
    { kind: "relaxed", query: "(\"zorblaxin\" OR \"zorb extract\") AND (quixotase OR activity)" },
    { kind: "aspect", query: "zorblaxin quixotase mechanism" },
  ]);
});

await test("the executed query set is capped and deduped within a kind", () => {
  const rungs = Array.from({ length: 40 }, (_, i) => ({ terms: [`term${i}`], got: 0, perSource: [] }));
  rungs.push({ terms: ["term0"], got: 0, perSource: [] });
  const rec = buildSearchRecord({
    funnel: { gathered: 5, deduped: 5 },
    diag: { rungs },
    sources: [{ title: "A", year: 2020 }],
  });
  assert.equal(rec.executedQueries.length, 24, "long fallback chains cannot bloat the record");
  assert.equal(rec.executedQueries.filter((q) => q.query === "term0").length, 1, "duplicate rung strings collapse");
});

await test("no diag query traces means executedQueries stays null, not invented", () => {
  const rec = buildSearchRecord({
    funnel: { gathered: 5, deduped: 5 },
    sources: [{ title: "A", year: 2020 }],
  });
  assert.equal(rec.executedQueries, null);
});

await test("authors, journal, and executed queries ride along while flags, funnel, and coverage agree", () => {
  const sources = Array.from({ length: 12 }, (_, i) => ({
    title: `Paper ${i + 1}`,
    authors: `Author ${i + 1}`,
    journal: "Journal of Record Completeness",
    year: i < 3 ? 2020 + i : 1990 + i,
    uncited: i >= 3,
  }));
  const input = {
    funnel: { gathered: 95, deduped: 90, excludedWeak: 20, excludedNonEnglish: 0, excludedRetracted: 0, cited: 12 },
    diag: { rungs: [{ terms: ["zorblaxin", "quixotase"], got: 40, perSource: [] }] },
    sources,
    answer: "The answer cites the first three papers [1][2][3].",
  };
  const rec = buildSearchRecord(input);
  const cov = buildCoverage(input);
  assert.equal(rec.funnel.cited, 3);
  assert.equal(cov.cited, 3);
  assert.equal(rec.sources.filter((s) => s.cited).length, 3);
  assert.equal(rec.sources[0].authors, "Author 1");
  assert.equal(rec.sources[0].journal, "Journal of Record Completeness");
  assert.deepEqual(rec.executedQueries, [{ kind: "rung", query: "zorblaxin quixotase" }]);
  // The uncited entries carry the outlying years (1993 and earlier);
  // the coverage span must come from the cited set alone.
  assert.equal(cov.earliestYear, 2020);
  assert.equal(cov.latestYear, 2022);
});

// ═══════════════════════════════════════════════════════════════════
group("buildCoverage: the disclosure counts");

await test("computes gathered, deduped, cited split, databases and year span", () => {
  const cov = buildCoverage(FULL_INPUT);
  assert.deepEqual(cov, {
    gathered: 88,
    deduped: 61,
    cited: 2,
    furtherReading: 1,
    databasesAnswered: 2,
    databasesTotal: 3,
    earliestYear: 2016,
    latestYear: 2021,
  });
});

await test("year span comes from the cited set, never widened by uncited outliers", () => {
  // One denominator rule: the span describes the answer's evidence.
  // Uncited entries from 1998 and 2024 must not stretch a span the
  // cited papers (2019, 2021) do not support.
  const cov = buildCoverage({
    funnel: { gathered: 9, deduped: 9, excludedWeak: 0, excludedNonEnglish: 0, excludedRetracted: 0, cited: 2 },
    sources: [
      { title: "Cited older", year: 2019, uncited: false },
      { title: "Cited newer", year: 2021, uncited: false },
      { title: "Uncited outlier old", year: 1998, uncited: true },
      { title: "Uncited outlier new", year: 2024, uncited: true },
    ],
  });
  assert.equal(cov.cited, 2);
  assert.equal(cov.earliestYear, 2019);
  assert.equal(cov.latestYear, 2021);
});

await test("with nothing cited the span describes the gathered shelf instead", () => {
  const cov = buildCoverage({
    funnel: { gathered: 4, deduped: 4, excludedWeak: 0, excludedNonEnglish: 0, excludedRetracted: 0, cited: 0 },
    sources: [
      { title: "Shelf A", year: 1998, uncited: true },
      { title: "Shelf B", year: 2024, uncited: true },
    ],
  });
  assert.equal(cov.cited, 0);
  assert.equal(cov.earliestYear, 1998);
  assert.equal(cov.latestYear, 2024);
});

await test("year span skips implausible years instead of widening to junk", () => {
  const cov = buildCoverage({
    funnel: { gathered: 4, deduped: 4 },
    sources: [
      { title: "A", year: 999 },
      { title: "B", year: "n/a" },
      { title: "C", year: 2018 },
      { title: "D", year: 12000 },
    ],
  });
  assert.equal(cov.earliestYear, 2018);
  assert.equal(cov.latestYear, 2018);
});

await test("unknown counts stay null so the client renders only real numbers", () => {
  const cov = buildCoverage({ sources: [{ title: "A", year: 2020, uncited: false }] });
  assert.equal(cov.gathered, null);
  assert.equal(cov.deduped, null);
  assert.equal(cov.databasesAnswered, null);
  assert.equal(cov.databasesTotal, null);
  assert.equal(cov.cited, 1);
  assert.equal(cov.earliestYear, 2020);
});

await test("null when there is nothing to disclose", () => {
  assert.equal(buildCoverage(null), null);
  assert.equal(buildCoverage({}), null);
  assert.equal(buildCoverage({ question: "q" }), null);
});

// ═══════════════════════════════════════════════════════════════════
group("server wiring: the response carries both fields");

await test("the handler assembles _coverage and _record from the builders", () => {
  assert.match(searchSrc, /_coverage: coverageDisclosure/, "response does not ship _coverage");
  assert.match(searchSrc, /_record: searchRecord/, "response does not ship _record");
  assert.match(searchSrc, /const coverageDisclosure = buildCoverage\(/, "coverage not built by buildCoverage");
  assert.match(searchSrc, /const searchRecord = buildSearchRecord\(/, "record not built by buildSearchRecord");
  assert.match(searchSrc, /diag\.structuredQuery = booleanQuery/, "the boolean query actually searched is not recorded on diag");
});

// ═══════════════════════════════════════════════════════════════════
group("client: coverage sentence and Search record disclosure");

await test("the turn carries _coverage and _record off the response", () => {
  assert.match(appSrc, /_coverage: data\._coverage \|\| null/, "turn does not carry _coverage");
  assert.match(appSrc, /_record: data\._record \|\| null/, "turn does not carry _record");
});

await test("the coverage sentence is built from _coverage in plain words", () => {
  assert.match(appSrc, /function coverageSentence\(coverage\)/, "coverageSentence helper missing");
  assert.match(appSrc, /This answer rests on /, "sentence does not open with the rests on wording");
  assert.match(appSrc, /more as further reading/, "sentence omits the further reading clause");
  assert.match(appSrc, /drawn from \$\{gathered\} paper/, "sentence omits the gathered clause");
  assert.match(appSrc, /SearchRecordPanel/, "the panel component is missing");
  assert.match(appSrc, /<SearchRecordPanel t=\{t\} P=\{P\} \/>/, "the panel is not rendered in the turn");
});

await test("the disclosure shows the record in readable sections", () => {
  assert.match(appSrc, /<span className="cb-kicker">Search record<\/span>/, "disclosure is not titled Search record");
  for (const label of ["Question", "When", "How it searched", "Databases", "Funnel", "Model", "Sources"]) {
    assert.ok(appSrc.includes(`"${label}"`) || appSrc.includes(`>${label}<`), `section ${label} missing from the panel`);
  }
});

await test("copy and download actions build Markdown from _record client side", () => {
  assert.match(appSrc, /function searchRecordMarkdown\(record\)/, "searchRecordMarkdown helper missing");
  assert.match(appSrc, /# Search record/, "markdown does not open with the record heading");
  assert.match(appSrc, /Copy record/, "Copy record action missing");
  assert.match(appSrc, /Download record/, "Download record action missing");
  assert.match(appSrc, /copyToClipboard\(searchRecordMarkdown\(record\), "Search record copied"\)/, "copy action does not copy the markdown");
  assert.match(appSrc, /download\("cerebrum-search-record\.md", searchRecordMarkdown\(record\)\)/, "download action does not download the markdown file");
  assert.match(appSrc, /Record as JSON/, "markdown does not close with the record itself as JSON");
});

await test("the panel renders nothing without _coverage or _record", () => {
  assert.match(appSrc, /if \(!sentence && !record\) return null;/, "empty state guard missing");
});

await test("the printed PDF carries no manufactured methods table; the coverage sentence lives on the record", () => {
  // Updated 2026-10-19 (design audit H14): the old PDF imposed a
  // Methods section built from diagnostics, and the coverage row rode
  // inside it. H14 deletes the manufactured structure; the PDF prints
  // the answer's own blocks. The coverage sentence stays computed for
  // the Search record panel and its exports, which is where the
  // honesty disclosure belongs.
  assert.match(appSrc, /const sentence = coverage \? coverageSentence\(coverage\) : "";/, "the record panel no longer computes the coverage sentence");
  assert.ok(!appSrc.includes("mrows"), "the manufactured PDF methods table is back");
});

await test("new user visible copy carries no dash characters", () => {
  // The standing house rule: no dashes of any kind in user visible copy.
  // Check the literal strings the new helpers and panel render.
  const start = appSrc.indexOf("function coverageSentence");
  const end = appSrc.indexOf("function AnswerDiagnostics");
  assert.ok(start > 0 && end > start, "could not isolate the new client block");
  const block = appSrc.slice(start, end);
  // Prose-like literals only: template interpolations are stripped, and
  // a literal counts as copy when it reads like words (contains a space,
  // or opens a Markdown heading, or starts a capitalized phrase). Code
  // values with no spaces (locales, class names, filenames, Intl option
  // values like 2-digit) are not copy and are skipped on purpose.
  const literals = [...block.matchAll(/"([^"\n]*)"|`([^`\n]*)`/g)]
    .map((m) => (m[1] != null ? m[1] : m[2]).replace(/\$\{[^}]*\}/g, ""))
    .filter((s) => /[A-Za-z]/.test(s) && !/var\(--|https?:/.test(s))
    .filter((s) => s.includes(" ") || s.startsWith("#") || /^[A-Z]/.test(s.trim()));
  const withDash = literals.filter((s) => s.includes("-") || s.includes("–") || s.includes("—"));
  assert.deepEqual(withDash, [], `copy strings containing dashes: ${withDash.join(" | ")}`);
});

// ═══════════════════════════════════════════════════════════════════
group("client: the record's readable half carries the v2 fields");

await test("the markdown sources print authors and journal when the record has them", () => {
  const mdAt = appSrc.indexOf("function searchRecordMarkdown");
  const panelAt = appSrc.indexOf("function SearchRecordPanel");
  assert.ok(mdAt > 0 && panelAt > mdAt, "could not isolate searchRecordMarkdown");
  const md = appSrc.slice(mdAt, panelAt);
  // Conditional on the record carrying the fields: absent authors or
  // journal print nothing, never a placeholder standing in for them.
  assert.match(md, /if \(s\.authors\) line \+= " · " \+ s\.authors;/, "markdown does not print authors per source");
  assert.match(md, /if \(s\.journal\) line \+= " · " \+ s\.journal;/, "markdown does not print journal per source");
  const sourcesAt = md.indexOf('lines.push("## Sources")');
  const jsonAt = md.indexOf('lines.push("## Record as JSON")');
  assert.ok(sourcesAt > 0 && jsonAt > sourcesAt, "sources section must sit above the JSON dump");
  const sourcesBlock = md.slice(sourcesAt, jsonAt);
  assert.ok(sourcesBlock.includes("s.authors") && sourcesBlock.includes("s.journal"),
    "authors and journal must print in the readable sources list, not only in the JSON");
});

await test("the markdown carries an executed queries section in prose, above the JSON dump", () => {
  const mdAt = appSrc.indexOf("function searchRecordMarkdown");
  const panelAt = appSrc.indexOf("function SearchRecordPanel");
  const md = appSrc.slice(mdAt, panelAt);
  const sectionAt = md.indexOf('lines.push("## Executed queries")');
  assert.ok(sectionAt > 0, "markdown has no executed queries section");
  const jsonAt = md.indexOf('lines.push("## Record as JSON")');
  assert.ok(sectionAt < jsonAt, "the executed queries section must sit above the JSON dump");
  assert.match(md, /record\.executedQueries/, "the section does not read the executed query set");
  assert.match(md, /EXECUTED_QUERY_KIND_LABELS\[q\.kind\]/, "the section does not name each query by kind");
  const labelsAt = appSrc.indexOf("const EXECUTED_QUERY_KIND_LABELS");
  assert.ok(labelsAt > 0, "the kind label map is missing");
  const labels = appSrc.slice(labelsAt, labelsAt + 400);
  for (const kind of ["rung", "concept", "recall", "relaxed", "aspect"]) {
    assert.ok(labels.includes(`${kind}:`), `kind label missing for ${kind}`);
  }
  // A record without the set says so in words rather than printing an
  // empty section or an invented list.
  assert.ok(md.includes("The individual queries that ran were not recorded for this search."),
    "the section has no honest fallback when the set was not recorded");
});

await test("the panel source rows show authors and journal too", () => {
  const panelAt = appSrc.indexOf("function SearchRecordPanel");
  const endAt = appSrc.indexOf("function AnswerDiagnostics");
  assert.ok(panelAt > 0 && endAt > panelAt, "could not isolate SearchRecordPanel");
  const panel = appSrc.slice(panelAt, endAt);
  assert.match(panel, /\(s\.authors \|\| s\.journal\) \? \(/, "panel rows do not gate on the record carrying authors or journal");
  assert.ok(panel.includes("s.authors") && panel.includes("s.journal"),
    "panel source rows must print authors and journal, not only title and year");
});

// ═══════════════════════════════════════════════════════════════════
group("cached serves carry recomputed trust artifacts (wave two part two, 2026-10-13)");

// Both cache return paths used to ship the bare answer: no funnel,
// no coverage, no record, no confidence, no stage health. The trust
// features switched off exactly where repeat traffic lands. The
// standing rule: a cached answer is served with its trust artifacts
// recomputed under current rules; the answer text changes only
// where a stored extractive body's baked confidence line is bound
// to the recomputed level (sixth panel follow up, 2026-10-14).
// These fixtures run the exact builder both cache returns
// call, on the exact payload shape the cache stores (answer text +
// source list), and the pipeline smoke suite runs the early return
// end to end through the handler.
const STORED_AT = Date.parse("2026-10-12T09:30:00.000Z");
const STORED_ANSWER =
  "Wood frogs survive freezing because ice forms in the spaces outside their cells while glucose floods the tissues and protects them [1]. " +
  "The heart stops entirely for the duration and restarts when the frog thaws [2].";
const STORED_SOURCES = [
  { title: "Freeze tolerance in the wood frog", authors: "Storey KB, Storey JM", journal: "Journal of Experimental Biology", year: 2021, relevance: 92, abstract: "Wood frogs tolerate the freezing of up to two thirds of their body water, with ice confined to extracellular spaces.", url: "https://doi.org/10.1000/frog1" },
  { title: "Glucose as a cryoprotectant in a freeze tolerant frog", authors: "Costanzo JP", journal: "Cryobiology", year: 2019, relevance: 88, abstract: "Glucose accumulates in the tissues of frozen frogs and acts as a colligative cryoprotectant during thaw recovery.", url: "https://doi.org/10.1000/frog2" },
  { title: "Winter ecology of northern amphibians", authors: "Pinder AW", journal: "Amphibia Notes", year: 2015, relevance: 40, abstract: "A general survey of overwintering strategies across northern amphibian species and their habitats.", url: "https://doi.org/10.1000/frog3" },
];

await test("a cached serve rebuilds coverage, funnel, and record from the stored payload", () => {
  const trust = buildCachedServeTrust({
    answer: STORED_ANSWER,
    sources: STORED_SOURCES,
    question: "can wood frogs survive being frozen",
    askedAt: STORED_AT,
    degraded: false,
  });
  // The cited set is recovered from the answer's own markers: the
  // third stored source was never cited and is flagged, exactly as
  // the live path flags it.
  assert.equal(trust.labeledSources.length, 3);
  assert.ok(!trust.labeledSources[0].uncited && !trust.labeledSources[1].uncited);
  assert.equal(trust.labeledSources[2].uncited, true);
  // The funnel is the honest partial: the cited count the payload
  // proves, null for every count the original run produced but the
  // cache did not store.
  assert.deepEqual(trust.funnel, {
    gathered: null, deduped: null, excludedWeak: null, excludedWeakTitles: null,
    excludedNonEnglish: null, excludedRetracted: null, cited: 2,
  });
  // Coverage denominators stay on the cited set: the uncited 2015
  // paper must not stretch the year span.
  assert.equal(trust.coverage.cited, 2);
  assert.equal(trust.coverage.furtherReading, 1);
  assert.equal(trust.coverage.gathered, null);
  assert.equal(trust.coverage.databasesTotal, null);
  assert.equal(trust.coverage.databasesAnswered, null);
  assert.equal(trust.coverage.earliestYear, 2019);
  assert.equal(trust.coverage.latestYear, 2021);
  // The record: frozen sources with cited flags, the store time as
  // askedAt, and honestly null retrieval detail and model.
  assert.ok(trust.record, "a cached serve must carry a record");
  assert.equal(trust.record.version, 2);
  assert.equal(trust.record.question, "can wood frogs survive being frozen");
  assert.equal(trust.record.askedAt, new Date(STORED_AT).toISOString());
  assert.equal(trust.record.synthesisModel, null);
  assert.equal(trust.record.databases, null);
  assert.equal(trust.record.funnel, null);
  assert.equal(trust.record.executedQueries, null);
  assert.deepEqual(trust.record.sources.map((s) => s.cited), [true, true, false]);
  assert.equal(trust.record.sources[0].authors, "Storey KB, Storey JM");
  // The served body rides along as `answer`. Corrected contract
  // (2026-10-14, sixth panel follow up): this pin used to assert
  // the builder carries no answer at all, under the wave two rule
  // that a cache serve never touches the text — the rule that let
  // a stored extractive body's baked line disagree with the
  // recomputed level. The builder now returns the body with its
  // baked span bound to that level; this payload has no baked
  // span, so it must come through byte for byte.
  assert.equal(trust.answer, STORED_ANSWER,
    "a stored body with no baked span must come through byte identical");
});

await test("a cached serve keeps stored further reading tail entries uncited, with counts agreeing", () => {
  // A stored source list carrying further reading tail entries
  // (appended after the evidence entries, already stamped uncited
  // by the live path's labeling) must recompute consistently: the
  // tail stays further reading in the shipped labels, in coverage,
  // and in the record, and the year span stays on the cited pair.
  const stored = [
    ...STORED_SOURCES.slice(0, 2),
    { title: "Antifreeze proteins in overwintering frogs", authors: "Duman JG", journal: "Cryobiology", year: 2015, relevance: 61, url: "https://doi.org/10.1000/frog4", uncited: true, uncitedReason: "Not cited in the answer . listed for further reading." },
    { title: "Hibernation physiology of temperate anurans", authors: "Pinder AW", journal: "Amphibia Notes", year: 2012, relevance: 55, url: "https://doi.org/10.1000/frog5", uncited: true, uncitedReason: "Not cited in the answer . listed for further reading." },
  ];
  const trust = buildCachedServeTrust({
    answer: STORED_ANSWER,
    sources: stored,
    question: "can wood frogs survive being frozen",
    askedAt: STORED_AT,
    degraded: false,
  });
  assert.equal(trust.labeledSources.length, 4);
  assert.deepEqual(trust.labeledSources.map((s) => !!s.uncited), [false, false, true, true]);
  assert.equal(trust.funnel.cited, 2, "the funnel cited count stays the evidence pair");
  assert.equal(trust.coverage.cited, 2);
  assert.equal(trust.coverage.furtherReading, 2, "the stored tail counts as further reading, not cited");
  assert.equal(trust.coverage.earliestYear, 2019, "tail years must not widen the cited set's span");
  assert.equal(trust.coverage.latestYear, 2021);
  assert.deepEqual(trust.record.sources.map((s) => s.cited), [true, true, false, false]);
});

await test("a cached serve's confidence is recomputed under current caps, not served as stored", () => {
  const trust = buildCachedServeTrust({
    answer: STORED_ANSWER,
    sources: STORED_SOURCES,
    question: "can wood frogs survive being frozen",
    askedAt: STORED_AT,
    degraded: false,
  });
  // The cited papers are strong (mean relevance 90), but no fact
  // check ran on a cache serve, so the current unchecked cap (59)
  // binds . the same cap a live unchecked answer gets.
  assert.equal(trust.confidence.score, 59);
  assert.equal(trust.confidence.cap, 59);
  assert.match((trust.confidence.capReasons || []).join(" "), /fact checking did not check/);
  assert.equal(trust.confidence.verdictStatus, null);
});

// ── Cached serve baked line parity (sixth panel follow up,
// 2026-10-14): the ship gate binds a fresh extractive shipment's
// baked confidence line to the shipped level, but the cached
// serve recomputed the level for a stored answer and shipped the
// stored body untouched, so the body versus object disagreement
// the gate prevents crossed here instead. The stored payload
// below is an extractive shipment: a wide, recent shelf its
// builder saw before the claim check ran, a baked Moderate line,
// and the trace sentence the pipeline appended to the same
// paragraph. The payload's own fact check is the provenance
// trace — the only check that ran on the original run.
const BAKED_STORED_SOURCES = Array.from({ length: 8 }, (_, i) => ({
  title: "Infant gut colonization study " + (i + 1),
  authors: "Researcher " + (i + 1),
  journal: "Journal of Infant Microbiology",
  year: 2025,
  relevance: 90,
  type: "journal article",
  abstract: "A cohort study of how the infant gut community assembles across the first year of life, with feeding mode and delivery mode recorded for every participant.",
  url: "https://doi.org/10.1000/gut" + (i + 1),
}));
const BAKED_STORED_ANSWER =
  "## Summary\n\n" +
  "Germs in the gut change across the first year of life [1], and feeding shapes which germs take hold [2]. " +
  "The gut community steadies as solid foods arrive [3], and delivery mode leaves an early mark [4]. " +
  "By the first birthday the community looks more adult [5], though it keeps changing [6]. " +
  "Antibiotic courses interrupt the pattern [7], and recovery takes weeks [8].\n\n" +
  "## How solid is this?\n\n" +
  "Moderate confidence: this answer rests on 8 cited sources. " +
  "No opposing findings were detected among them, but the evidence base is not broad enough for a stronger claim. " +
  "Confidence is capped because the answer was assembled from source excerpts. " +
  "The wording of 6 of 7 cited claims traces to the papers they cite. A wording trace is not a verification.\n\n" +
  "- Only 8 sources cleared the relevance bar. Treat this as a starting point, not a settled answer.\n" +
  "- 3 more papers were found but withheld: they didn't clear the relevance bar for this question.\n\n" +
  "## What would change this\n\n" +
  "- A direct replication in a second cohort.\n";
// The stored fact check carries the vocabulary a payload stored
// under current rules carries (wave eight round two): the trace's
// claims are "traced" and its overall is "traced" — the builder
// only asks the object's kind, so this fixture doubles as the
// record of what the corrected producer writes.
const STORED_PROVENANCE_CHECK = {
  mode: "extractive",
  checkKind: "provenance",
  checked: true,
  overall: "traced",
  claims: Array.from({ length: 7 }, (_, i) => ({
    claim: "Stored claim " + (i + 1),
    status: i < 6 ? "traced" : "thin",
    note: "The claim's wording traces to the cited paper's title/abstract.",
  })),
};

await test("a cached extractive serve binds its baked line to the recomputed level, provenance cap included", () => {
  const trust = buildCachedServeTrust({
    answer: BAKED_STORED_ANSWER,
    sources: BAKED_STORED_SOURCES,
    question: "what happens to a baby's gut germs in the first year",
    askedAt: STORED_AT,
    degraded: false,
    factCheck: STORED_PROVENANCE_CHECK,
    synthesisMode: "extractive",
  });
  assert.equal(trust.funnel.cited, 8, "the stored markers cite all eight sources");
  // The provenance cap binds the recomputed level: the shelf
  // alone would carry the unchecked cap (59, moderate), but the
  // only check the payload carries is the wording trace, which
  // verified nothing — the same thin a fresh run of this answer
  // ships.
  assert.equal(trust.confidence.level, "thin");
  assert.equal(trust.confidence.cap, 45);
  assert.match((trust.confidence.capReasons || []).join(" "), /traced claim wording/);
  // The body agrees with the object: the baked Moderate
  // assertion is replaced by the recomputed line, in place, and
  // the trace sentence, the non asserting remainder, and the
  // gap bullets survive.
  assert.ok(trust.answer !== BAKED_STORED_ANSWER, "the baked body shipped unbound");
  assert.ok(!trust.answer.includes("Moderate confidence"),
    "the baked Moderate assertion shipped over a thin level: " + trust.answer);
  assert.ok(trust.answer.includes(trust.confidence.line),
    "the recomputed line does not stand where the baked assertion stood: " + trust.answer);
  assert.ok(trust.answer.includes("The wording of 6 of 7 cited claims traces to the papers they cite."),
    "the appended trace sentence was harmed: " + trust.answer);
  assert.ok(trust.answer.includes("No opposing findings were detected among them"),
    "the baked line's non asserting remainder was removed: " + trust.answer);
  assert.ok(trust.answer.includes("- Only 8 sources cleared the relevance bar."),
    "the section's gap bullets were removed: " + trust.answer);
});

await test("a cached extractive serve already at the recomputed level passes byte identical", () => {
  // No stored fact check: the recomputed level is the unchecked
  // moderate, which is exactly what the baked line asserts, so
  // the builder and the serve agree and nothing may move.
  const trust = buildCachedServeTrust({
    answer: BAKED_STORED_ANSWER,
    sources: BAKED_STORED_SOURCES,
    question: "what happens to a baby's gut germs in the first year",
    askedAt: STORED_AT,
    degraded: false,
    synthesisMode: "extractive",
  });
  assert.equal(trust.confidence.level, "moderate");
  assert.equal(trust.answer, BAKED_STORED_ANSWER,
    "a baked line at the recomputed level was rewritten");
});

await test("a stored AI answer is not bound by the extractive span pass", () => {
  // The payload is recorded as an AI answer: its prose was the
  // prose binder's charge on the fresh run, and the baked span
  // pass is extractive only, exactly as at the ship gate. The
  // provenance cap still binds its recomputed level (the cap is
  // mode independent, as on a fresh run), but the body ships
  // byte for byte.
  const trust = buildCachedServeTrust({
    answer: BAKED_STORED_ANSWER,
    sources: BAKED_STORED_SOURCES,
    question: "what happens to a baby's gut germs in the first year",
    askedAt: STORED_AT,
    degraded: false,
    factCheck: STORED_PROVENANCE_CHECK,
    synthesisMode: "ai",
  });
  assert.equal(trust.confidence.level, "thin");
  assert.equal(trust.answer, BAKED_STORED_ANSWER,
    "a stored AI answer's body was rewritten by the extractive span pass");
});

await test("the later cache path recomputes against this run's real retrieval", () => {
  // The second cache return sits AFTER retrieval: the served source
  // list is this run's, so the funnel, coverage, and record carry
  // this run's real numbers . with cited still re-derived from the
  // SERVED pair (the stored answer's markers against this list).
  const trust = buildCachedServeTrust({
    answer: STORED_ANSWER,
    sources: STORED_SOURCES,
    question: "can wood frogs survive being frozen",
    askedAt: new Date("2026-10-13T15:00:00.000Z"),
    diag: {
      rungs: [{ terms: ["wood", "frog", "freeze"], got: 9, perSource: [] }],
      llmQueries: ["wood frog freeze tolerance survival"],
      funnel: { gathered: 42, deduped: 20, ranked: 3, nonEnglishInner: 1 },
      sourceOutcomes: [
        { source: "europePMC", ok: true, count: 30 },
        { source: "openAlex", ok: false, count: 0 },
      ],
    },
    databases: [
      { source: "europePMC", ok: true, count: 30 },
      { source: "openAlex", ok: false, count: 0 },
    ],
    funnel: { gathered: 42, deduped: 20, excludedWeak: 17, excludedNonEnglish: 1, excludedRetracted: 2 },
    degraded: false,
  });
  // Real retrieval counts survive; cited is the served pair's count.
  assert.equal(trust.funnel.gathered, 42);
  assert.equal(trust.funnel.excludedWeak, 17);
  assert.equal(trust.funnel.excludedRetracted, 2);
  assert.equal(trust.funnel.cited, 2);
  assert.equal(trust.coverage.databasesTotal, 2);
  assert.equal(trust.coverage.databasesAnswered, 1);
  assert.equal(trust.coverage.gathered, 42);
  // The record carries this run's databases, funnel, and the queries
  // retrieval actually ran (rung + rescue) . and still no model,
  // because the cache does not store who wrote the stored answer.
  assert.ok(trust.record);
  assert.equal(trust.record.synthesisModel, null);
  assert.equal(trust.record.funnel.gathered, 42);
  assert.equal(trust.record.funnel.cited, 2);
  assert.deepEqual(trust.record.databases.map((d) => d.source), ["europePMC", "openAlex"]);
  assert.deepEqual(
    trust.record.executedQueries.map((e) => e.kind), ["rung", "rescue"]);
  // Both cache returns ship the artifacts (handler wiring, pinned by
  // source like the rest of this suite's client pins).
  assert.ok(searchSrc.includes("_record: earlyTrust.record"), "the early cache return does not ship the record");
  assert.ok(searchSrc.includes("_record: laterTrust.record"), "the later cache return does not ship the record");
  assert.ok(searchSrc.includes("stageHealth: publicStageHealth(stageHealth)") && searchSrc.includes("_funnel: laterTrust.funnel"),
    "the later cache return does not ship funnel and serialized stage health");
});

await test("the record gate stays shut for non cache callers and for empty cache payloads", () => {
  // Without cachedServe, sources alone never made a record before
  // and must not start: no funnel and no databases still means no
  // search to record.
  assert.equal(buildSearchRecord({
    question: "q", sources: STORED_SOURCES, answer: STORED_ANSWER,
  }), null);
  // A cache serve with no stored sources has nothing to stand on.
  assert.equal(buildSearchRecord({
    question: "q", sources: [], answer: "", cachedServe: true,
  }), null);
});

// ═══════════════════════════════════════════════════════════════════
group("executed queries — the record reads everything retrieval ran (wave two part two, 2026-10-13)");

// Live records showed exactly one rung entry even on runs where the
// LLM rescue, clause fanouts, and the raw fallback had executed: the
// diag held those query strings at assembly, and the builder never
// read them. (For the plain question shapes the panel probed, diag
// genuinely holds only the rung set at assembly . the ladder breaks
// after rung 1 at 8+ papers and every other producer is gated on low
// counts . so one rung entry there is the honest count, not a
// builder defect. What WAS a defect is everything below.)

await test("rescue, clause, raw, and secondary queries reach the record with their kinds", () => {
  const rec = buildSearchRecord({
    question: "can wood frogs survive being frozen",
    askedAt: new Date("2026-10-13T14:00:00.000Z"),
    diag: {
      rungs: [{ terms: ["wood", "frog", "freeze"], got: 3, perSource: [] }],
      llmQueries: ["wood frog freeze tolerance survival", "frog frozen heart restart thaw"],
      clauseQueries: ["heart restart thaw"],
      rawFallbackQuery: "Rana sylvatica can wood frogs survive being frozen",
      secondaryOrganismQueries: ["Lithobates clamitans freeze heart"],
      funnel: { gathered: 9, deduped: 7, ranked: 3 },
      sourceOutcomes: [{ source: "europePMC", ok: true, count: 9 }],
    },
    sources: [{ title: "Freeze tolerance in the wood frog", year: 2021, uncited: false }],
    answer: "Wood frogs survive freezing [1].",
  });
  assert.ok(rec && Array.isArray(rec.executedQueries), "record must carry executed queries");
  const byKind = (kind) => rec.executedQueries.filter((e) => e.kind === kind).map((e) => e.query);
  assert.deepEqual(byKind("rung"), ["wood frog freeze"]);
  assert.deepEqual(byKind("rescue"), ["wood frog freeze tolerance survival", "frog frozen heart restart thaw"]);
  assert.deepEqual(byKind("clause"), ["heart restart thaw"]);
  assert.deepEqual(byKind("raw"), ["Rana sylvatica can wood frogs survive being frozen"]);
  assert.deepEqual(byKind("secondary"), ["Lithobates clamitans freeze heart"]);
});

await test("retrieval records the executed strings on the diag at the sites that run them", () => {
  assert.ok(searchSrc.includes("diag.rawFallbackQuery = rawQ"),
    "the raw fallback's executed query is not recorded");
  assert.ok(searchSrc.includes("diag.clauseQueries"),
    "clause fanout term lists are not recorded");
  assert.ok(searchSrc.includes("diag.secondaryOrganismQueries"),
    "secondary organism queries are not recorded");
  assert.ok(!searchSrc.includes("diag.questionDecomposition = decomp.aspects.map"),
    "decomposition still records aspects whose searches may never run");
});

// ═══════════════════════════════════════════════════════════════════
group("record identity: permanent id, permalink, and persistence (2026-10-13)");

// The rescore's record finding: the record had no permanent ID or
// URL, was stored nowhere addressable, and could not be cited or
// reopened. The contract now: the handler mints a random id at the
// one assembly point, buildSearchRecord stamps it (plus the absolute
// permalink) only when a caller passes it, and the handler stores
// the record under that id. An id is a promise the page exists, so
// nothing is stamped that nobody stored: cache serves, whose records
// are recomputed per serve and stored nowhere, carry no id at all.

await test("a caller passed recordId is stamped with its absolute permalink", () => {
  const rec = buildSearchRecord({ ...FULL_INPUT, recordId: "r_0123456789abcdef0123456789abcdef" });
  assert.equal(rec.id, "r_0123456789abcdef0123456789abcdef");
  assert.equal(rec.url, "https://askcerebrum.org/record/r_0123456789abcdef0123456789abcdef");
});

await test("no recordId means no id and no url keys, the pre permalink shape", () => {
  const rec = buildSearchRecord(FULL_INPUT);
  assert.ok(!("id" in rec), "record without a caller id must not gain one");
  assert.ok(!("url" in rec), "record without a caller id must not gain a url");
});

await test("a malformed recordId is ignored rather than stamped into a URL", () => {
  for (const bad of ["has spaces in it", "a/b", "", "short", "x".repeat(200), 42, null]) {
    const rec = buildSearchRecord({ ...FULL_INPUT, recordId: bad });
    assert.ok(!("id" in rec), `recordId ${JSON.stringify(bad)} must not stamp`);
  }
});

await test("minted ids are r_ prefixed, high entropy, and unique per mint", () => {
  const a = mintSearchRecordId();
  const b = mintSearchRecordId();
  assert.match(a, /^r_[0-9a-f]{32}$/);
  assert.match(b, /^r_[0-9a-f]{32}$/);
  assert.notEqual(a, b, "two runs must never mint the same record id");
});

function fakeRecordDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, binds: null };
      calls.push(call);
      return {
        bind(...args) { call.binds = args; return { run: async () => ({}) }; },
        run: async () => ({}),
      };
    },
  };
}

await test("storeSearchRecord creates the table on first use and stores the record under its id", async () => {
  const db = fakeRecordDb();
  const rec = buildSearchRecord({ ...FULL_INPUT, recordId: "r_0123456789abcdef0123456789abcdef" });
  assert.equal(await storeSearchRecord({ DB: db }, rec), true);
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0].sql, /CREATE TABLE IF NOT EXISTS search_records/);
  assert.match(db.calls[1].sql, /INSERT OR IGNORE INTO search_records/);
  assert.equal(db.calls[1].binds[0], rec.id);
  assert.equal(db.calls[1].binds[1], rec.question);
  assert.equal(db.calls[1].binds[2], rec.askedAt);
  assert.deepEqual(JSON.parse(db.calls[1].binds[3]), JSON.parse(JSON.stringify(rec)),
    "the stored JSON is the record itself, id and permalink included");
});

await test("storeSearchRecord never rejects: no database, no id, and a throwing database all return false", async () => {
  const rec = buildSearchRecord({ ...FULL_INPUT, recordId: "r_0123456789abcdef0123456789abcdef" });
  assert.equal(await storeSearchRecord({}, rec), false);
  assert.equal(await storeSearchRecord(null, rec), false);
  const noIdDb = fakeRecordDb();
  assert.equal(await storeSearchRecord({ DB: noIdDb }, buildSearchRecord(FULL_INPUT)), false,
    "a record with no id has no address to store under");
  assert.equal(noIdDb.calls.length, 0, "an id less record must not touch the database");
  const throwingDb = { prepare() { throw new Error("storage is down"); } };
  assert.equal(await storeSearchRecord({ DB: throwingDb }, rec), false,
    "a storage failure is a false return, never a rejected promise on the answer path");
});

await test("the handler mints, stamps, and stores at the one assembly point", () => {
  assert.match(searchSrc, /const searchRecordId = mintSearchRecordId\(\)/, "the handler does not mint a record id");
  assert.match(searchSrc, /recordId: searchRecordId/, "the minted id is not passed to buildSearchRecord");
  assert.match(searchSrc, /storeSearchRecord\(env, searchRecord, ledger\)/, "the record is not stored under its id");
  // Corrected contract (2026-10-13, third rescore fix): this pin
  // used to assert the store rides waitUntil off the response path.
  // That fire and forget shape is the defect the panel proved (2 of
  // 3 issued record links dead): the store's result was never read,
  // so a failed store shipped a permalink that 404'd. The store is
  // now awaited, retried once on failure, and its outcome stamped
  // onto the shipped record.
  assert.match(searchSrc, /let recordStored = await storeSearchRecord\(env, searchRecord, ledger\)/,
    "the store is not awaited, so its outcome cannot be known when the permalink is issued");
  assert.match(searchSrc, /if \(!recordStored\) \{\s*recordStored = await storeSearchRecord\(env, searchRecord, ledger\);\s*\}/,
    "a failed store is not retried exactly once");
  assert.match(searchSrc, /applyRecordStoreOutcome\(searchRecord, recordStored\)/,
    "the store outcome is not stamped onto the shipped record");
  assert.ok(!searchSrc.includes("waitUntil(storedRecord)"), "the store still rides waitUntil unread");
});

await test("a cached serve's recomputed record carries no id and no permalink", () => {
  // The honesty rule for cache serves: the record is rebuilt on
  // serve and stored nowhere, so it must neither claim the original
  // run's id nor mint one whose page would 404.
  const trust = buildCachedServeTrust({
    answer: STORED_ANSWER,
    sources: STORED_SOURCES,
    question: "can wood frogs survive being frozen",
    askedAt: STORED_AT,
    degraded: false,
  });
  assert.ok(trust.record, "a cached serve still carries a record");
  assert.ok(!("id" in trust.record), "a recomputed cache record must not carry an id");
  assert.ok(!("url" in trust.record), "a recomputed cache record must not carry a permalink");
});

// ═══════════════════════════════════════════════════════════════════
group("record store reliability: an issued permalink cannot be silently dead (third rescore fix, 2026-10-13)");

// The panel followed 3 issued record links and found 2 dead, in both
// HTML and JSON forms, rechecked after a delay. The store swallowed
// every failure into a false return nobody read, and the response
// stamped id and permalink regardless. The contract now: the table
// create is memoized per database and awaited before the insert, the
// store returns a real verdict, the handler retries once, and a
// record that could not be stored ships with stored false and no
// permalink claim anywhere, while its data still ships.

function fakeTableGateDb() {
  // A database where the table genuinely does not exist until the
  // CREATE lands on THIS database: an insert that arrives first is
  // the D1 "no such table" hard error, not a soft miss.
  let tableExists = false;
  const calls = [];
  const runFor = (sql) => async () => {
    if (/CREATE TABLE/.test(sql)) { tableExists = true; return {}; }
    if (/INSERT/.test(sql)) {
      if (!tableExists) throw new Error("no such table: search_records");
      return {};
    }
    return {};
  };
  return {
    calls,
    prepare(sql) {
      calls.push(sql);
      return {
        bind() { return { run: runFor(sql) }; },
        run: runFor(sql),
      };
    },
  };
}

await test("the memoized create lands before the insert, and runs once per database", async () => {
  const db = fakeTableGateDb();
  const rec = buildSearchRecord({ ...FULL_INPUT, recordId: "r_0123456789abcdef0123456789abcdef" });
  assert.equal(await storeSearchRecord({ DB: db }, rec), true,
    "a store whose insert would fail without the table must land, create first");
  assert.equal(db.calls.length, 2);
  assert.match(db.calls[0], /CREATE TABLE IF NOT EXISTS search_records/);
  assert.match(db.calls[1], /INSERT OR IGNORE INTO search_records/);
  assert.equal(await storeSearchRecord({ DB: db }, rec), true);
  assert.equal(db.calls.length, 3, "a second store on the same database must not repeat the create");
  assert.match(db.calls[2], /INSERT OR IGNORE INTO search_records/);
});

function fakeFlakyDb() {
  // The first insert attempt fails (a transient lock), later ones land.
  let insertAttempts = 0;
  return {
    get insertAttempts() { return insertAttempts; },
    prepare(sql) {
      const run = async () => {
        if (/INSERT/.test(sql)) {
          insertAttempts++;
          if (insertAttempts === 1) throw new Error("database is locked");
        }
        return {};
      };
      return { bind() { return { run }; }, run };
    },
  };
}

await test("one fresh retry absorbs a transient insert failure, in the handler's exact shape", async () => {
  const db = fakeFlakyDb();
  const rec = buildSearchRecord({ ...FULL_INPUT, recordId: "r_0123456789abcdef0123456789abcdef" });
  let stored = await storeSearchRecord({ DB: db }, rec);
  if (!stored) stored = await storeSearchRecord({ DB: db }, rec);
  assert.equal(stored, true, "the retried store must land");
  assert.equal(db.insertAttempts, 2, "exactly one retry, never a loop");
});

function fakeAlwaysDownDb() {
  const run = async () => { throw new Error("storage is down"); };
  return { prepare() { return { bind() { return { run }; }, run }; } };
}

await test("a store that always fails resolves false, and the outcome withdraws the permalink only", async () => {
  const rec = buildSearchRecord({ ...FULL_INPUT, recordId: "r_0123456789abcdef0123456789abcdef" });
  let stored = await storeSearchRecord({ DB: fakeAlwaysDownDb() }, rec);
  if (!stored) stored = await storeSearchRecord({ DB: fakeAlwaysDownDb() }, rec);
  assert.equal(stored, false, "a store that always fails is a false verdict, never a rejection");
  const shaped = applyRecordStoreOutcome(rec, stored);
  assert.equal(shaped.stored, false);
  assert.ok(!("url" in shaped), "an unstored record must not carry a permalink");
  assert.ok(!("id" in shaped), "an unstored record must not carry the id a consumer could rebuild a permalink from");
  // The record data itself still ships; only the permalink claim changed.
  assert.equal(shaped.question, FULL_INPUT.question);
  assert.equal(shaped.sources.length, 3);
  assert.equal(shaped.funnel.gathered, 88);
});

await test("a stored outcome stamps stored true and keeps the permalink", async () => {
  const rec = buildSearchRecord({ ...FULL_INPUT, recordId: "r_0123456789abcdef0123456789abcdef" });
  const shaped = applyRecordStoreOutcome(rec, true);
  assert.equal(shaped.stored, true);
  assert.equal(shaped.id, "r_0123456789abcdef0123456789abcdef");
  assert.equal(shaped.url, "https://askcerebrum.org/record/r_0123456789abcdef0123456789abcdef");
});

// ═══════════════════════════════════════════════════════════════════
group("buildSearchRecord: the run health verdict (2026-10-14)");

await test("a stage list with a failed stage stamps degraded true and names the stage", () => {
  const rec = buildSearchRecord({
    ...FULL_INPUT,
    stageHealth: [
      { name: "retrieval", ok: true, ms: 900 },
      { name: "synthesis", ok: false, ms: 4000 },
      { name: "fact-check", ok: null, skipReason: "nothing to verify", ms: 3 },
    ],
  });
  assert.equal(rec.degraded, true);
  assert.deepEqual(rec.failedStages, ["synthesis"], "only ok false stages are named; a skipped stage is not a failure");
});

await test("an all healthy stage list stamps degraded false with no failed stages", () => {
  const rec = buildSearchRecord({
    ...FULL_INPUT,
    stageHealth: [{ name: "retrieval", ok: true }, { name: "synthesis", ok: true }],
  });
  assert.equal(rec.degraded, false);
  assert.deepEqual(rec.failedStages, []);
});

await test("the caller's degraded expression outranks the stage list, and no signal stays null", () => {
  const forced = buildSearchRecord({
    ...FULL_INPUT,
    degraded: true,
    stageHealth: [{ name: "retrieval", ok: true }],
  });
  assert.equal(forced.degraded, true, "the no results terminal state must label its record degraded even with healthy stages");
  assert.deepEqual(forced.failedStages, []);
  const silent = buildSearchRecord(FULL_INPUT);
  assert.equal(silent.degraded, null, "no stage list and no verdict means unknown, never a fabricated false");
  assert.equal(silent.failedStages, null);
});

// ═══════════════════════════════════════════════════════════════════
group("public record page: functions/record/[id].js");

const ROUTE_RECORD = {
  version: 2,
  id: "r_0123456789abcdef0123456789abcdef",
  url: "https://askcerebrum.org/record/r_0123456789abcdef0123456789abcdef",
  askedAt: "2026-10-13T14:00:00.000Z",
  question: "can wood frogs survive being frozen",
  structuredQuery: "(wood frog) AND (freeze tolerance)",
  conceptQueries: null,
  executedQueries: [{ kind: "rung", query: "wood frog freeze" }],
  llmExpansion: null,
  databases: [
    { source: "europePMC", ok: true, count: 40 },
    { source: "openAlex", ok: false, count: 0 },
  ],
  funnel: { gathered: 88, deduped: 61, excludedWeak: 49, excludedNonEnglish: 2, excludedRetracted: 0, cited: 1 },
  synthesisModel: "groq:openai/gpt-oss-120b",
  sources: [
    { n: 1, title: "Freeze tolerance in the wood frog", authors: "Storey KB, Storey JM", journal: "Journal of Experimental Biology", year: 2021, doi: "10.1000/frog1", url: "https://doi.org/10.1000/frog1", cited: true },
    { n: 2, title: "Winter ecology of northern amphibians", authors: null, journal: null, year: 2015, doi: null, url: "https://example.org/winter", cited: false },
  ],
};
const routeDbWith = (row) => ({ prepare: () => ({ bind: () => ({ first: async () => row }) }) });
const routeCall = (id, env, suffix = "") => recordRoute.onRequestGet({
  request: new Request("https://askcerebrum.org/record/" + id + suffix),
  env,
  params: { id },
});

await test("the page renders the record's readable half from the stored JSON", async () => {
  const res = await routeCall(ROUTE_RECORD.id, { DB: routeDbWith({ record: JSON.stringify(ROUTE_RECORD) }) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  const html = await res.text();
  assert.ok(html.includes("can wood frogs survive being frozen"), "question missing from the page");
  assert.ok(html.includes("Permanent link: "), "permalink line missing");
  assert.ok(html.includes("https://askcerebrum.org/record/" + ROUTE_RECORD.id), "permalink address missing");
  assert.ok(html.includes("Search rung: wood frog freeze"), "executed queries missing or unlabelled");
  assert.ok(html.includes("europePMC: 40 papers returned"), "database outcomes missing");
  assert.ok(html.includes("openAlex: did not respond"), "a silent database must read as no response");
  assert.ok(html.includes("Gathered: 88"), "funnel missing");
  assert.ok(html.includes("Freeze tolerance in the wood frog"), "source list missing");
  assert.ok(html.includes("Storey KB, Storey JM"), "source authors missing");
  assert.ok(html.includes("cited in the answer"), "cited mark missing");
  assert.ok(html.includes("further reading"), "further reading mark missing");
  assert.ok(html.includes("Rerun this search"), "rerun action missing");
  assert.ok(html.includes("/?q=can%20wood%20frogs%20survive%20being%20frozen"), "rerun link does not carry the question");
  assert.ok(html.includes("?format=json"), "the page does not say how to get the JSON");
});

await test("the funnel's final source list line counts the source list, not the cited set", async () => {
  // ROUTE_RECORD discriminates the two sets on purpose: funnel.cited
  // is 1 while the final source list holds 2 entries. The label names
  // the final source list, so the number must be 2, counted from the
  // list itself (2026-10-14 verdict correctness pass). The client's
  // Markdown export of the same record follows the same rule.
  const res = await routeCall(ROUTE_RECORD.id, { DB: routeDbWith({ record: JSON.stringify(ROUTE_RECORD) }) });
  const html = await res.text();
  assert.ok(html.includes("In the final source list: 2"),
    "the page printed the cited count under the source list label");
  assert.ok(!html.includes("In the final source list: 1"),
    "the page still prints funnel.cited under the source list label");
  assert.match(recordRouteSrc, /In the final source list: " \+ num\(Array\.isArray\(record\.sources\) \? record\.sources\.length : null\)/,
    "the record page does not count the source list itself");
  const mdAt = appSrc.indexOf("function searchRecordMarkdown");
  const panelAt = appSrc.indexOf("function SearchRecordPanel");
  const md = appSrc.slice(mdAt, panelAt);
  assert.match(md, /In the final source list: " \+ \(Array\.isArray\(record\.sources\) \? record\.sources\.length/,
    "the Markdown export does not count the source list itself");
  assert.ok(!md.includes('"In the final source list: " + f.cited'),
    "the Markdown export still prints f.cited under the source list label");
});

await test("the page escapes stored text instead of emitting it as markup", async () => {
  const hostile = {
    ...ROUTE_RECORD,
    question: "can frogs <script>alert(1)</script> freeze",
    sources: [{ n: 1, title: "A <b>bold</b> claim & an \"quoted\" one", year: 2020, doi: null, url: null, cited: true }],
  };
  const res = await routeCall(ROUTE_RECORD.id, { DB: routeDbWith({ record: JSON.stringify(hostile) }) });
  const html = await res.text();
  assert.ok(!html.includes("<script>alert(1)</script>"), "stored question reached the page as live markup");
  assert.ok(html.includes("&lt;script&gt;"), "stored question was not escaped");
  assert.ok(html.includes("A &lt;b&gt;bold&lt;/b&gt; claim &amp; an &quot;quoted&quot; one"), "stored title was not escaped");
});

await test("a degraded record labels itself at the top of its page and names the failed stages", async () => {
  const degraded = {
    ...ROUTE_RECORD,
    degraded: true,
    failedStages: ["synthesis", "fact-check"],
  };
  const res = await routeCall(ROUTE_RECORD.id, { DB: routeDbWith({ record: JSON.stringify(degraded) }) });
  const html = await res.text();
  assert.ok(html.includes("This search ran degraded: part of the pipeline did not complete"),
    "degraded record carries no banner");
  assert.ok(html.includes("failed stages: synthesis, fact-check"), "the banner does not name the failed stages");
  assert.ok(html.indexOf("This search ran degraded") < html.indexOf("<h2>Question</h2>"),
    "the banner belongs at the top of the page, before the record body");
});

await test("a healthy record shows no health note, and a legacy record states only what it knows", async () => {
  const healthy = { ...ROUTE_RECORD, degraded: false, failedStages: [] };
  const healthyHtml = await (await routeCall(ROUTE_RECORD.id, { DB: routeDbWith({ record: JSON.stringify(healthy) }) })).text();
  assert.ok(!healthyHtml.includes("ran degraded"), "a healthy record was labelled degraded");
  assert.ok(!healthyHtml.includes("predates run health recording"), "a healthy record got the legacy note");
  // ROUTE_RECORD itself is the legacy shape: no degraded field, and
  // a synthesis model that ran, so no note of either kind.
  const legacyHtml = await (await routeCall(ROUTE_RECORD.id, { DB: routeDbWith({ record: JSON.stringify(ROUTE_RECORD) }) })).text();
  assert.ok(!legacyHtml.includes("ran degraded"), "a legacy record was labelled degraded on no evidence");
  assert.ok(!legacyHtml.includes("No AI synthesis model ran"), "a legacy record whose model ran got the no synthesis note");
  const legacyExtractive = { ...ROUTE_RECORD, synthesisModel: null };
  const extractiveHtml = await (await routeCall(ROUTE_RECORD.id, { DB: routeDbWith({ record: JSON.stringify(legacyExtractive) }) })).text();
  assert.ok(extractiveHtml.includes("No AI synthesis model ran for this answer: it was assembled from source excerpts."),
    "a legacy extractive record does not state its one known health fact");
  assert.ok(extractiveHtml.includes("predates run health recording"),
    "the legacy note does not disclose that no fuller verdict was stored");
  assert.ok(!extractiveHtml.includes("ran degraded"),
    "the legacy note must not claim the degraded verdict it cannot know");
});

await test("the budget line renders the record's own ledger, and only then", async () => {
  const withLedger = {
    ...ROUTE_RECORD,
    ledger: {
      used: 41, limit: 50, remaining: 9, refused: 3,
      byStage: { ratelimit: 3, retrieval: 19, synthesis: 8, validation: 5, cache: 1 },
    },
  };
  const html = await (await routeCall(ROUTE_RECORD.id, { DB: routeDbWith({ record: JSON.stringify(withLedger) }) })).text();
  assert.ok(html.includes("Subrequests: 41 used of a limit of 50."), "budget total missing or wrong");
  assert.ok(html.includes("Largest spends: retrieval 19, synthesis 8, validation 5, ratelimit 3, cache 1."),
    "stage spends missing, unsorted, or not capped at five");
  assert.ok(html.includes("3 grants were refused at the budget ceiling."), "refusals not stated when nonzero");
  const noRefusals = { ...withLedger, ledger: { ...withLedger.ledger, refused: 0 } };
  const htmlNoRefusals = await (await routeCall(ROUTE_RECORD.id, { DB: routeDbWith({ record: JSON.stringify(noRefusals) }) })).text();
  assert.ok(!htmlNoRefusals.includes("refused at the budget ceiling"), "a refusal line printed when nothing was refused");
  const bareHtml = await (await routeCall(ROUTE_RECORD.id, { DB: routeDbWith({ record: JSON.stringify(ROUTE_RECORD) }) })).text();
  assert.ok(bareHtml.includes("Budget counts were not recorded for this search."),
    "a record without a ledger must say so, not print zeros");
  assert.ok(!bareHtml.includes("Subrequests:"), "a record without a ledger printed a budget total");
});

await test("?format=json returns the stored record JSON verbatim", async () => {
  const stored = JSON.stringify(ROUTE_RECORD);
  const res = await routeCall(ROUTE_RECORD.id, { DB: routeDbWith({ record: stored }) }, "?format=json");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  assert.equal(await res.text(), stored);
});

await test("an unknown id, a malformed id, and a missing database all get the honest 404 page", async () => {
  const unknown = await routeCall(ROUTE_RECORD.id, { DB: routeDbWith(null) });
  assert.equal(unknown.status, 404);
  assert.ok((await unknown.text()).includes("No search record lives at this address"), "404 page does not say the record is not there");
  const malformed = await routeCall("not a real id", { DB: routeDbWith({ record: "{}" }) });
  assert.equal(malformed.status, 404, "a malformed id must never reach the database");
  const noDb = await routeCall(ROUTE_RECORD.id, {});
  assert.equal(noDb.status, 404, "no database means no record, stated as a 404");
  const throwing = await routeCall(ROUTE_RECORD.id, { DB: { prepare() { throw new Error("no table yet"); } } });
  assert.equal(throwing.status, 404, "a table that does not exist yet is a missing record, not a 500");
});

await test("the rerun action stashes the baseline under the app's own sessionStorage key", () => {
  // The page and the app must agree on the key byte for byte, or the
  // comparison silently never happens. Both sides are pinned to the
  // same literal here.
  assert.ok(recordRouteSrc.includes('"cb_record_baseline_v1"'), "the record page writes a different baseline key than the app reads");
  assert.ok(appSrc.includes('const RECORD_BASELINE_KEY = "cb_record_baseline_v1"'), "the app's baseline key changed");
  assert.ok(recordRouteSrc.includes("Anyone with this link can read this record"), "the page does not state its shareable by design posture");
});

// ═══════════════════════════════════════════════════════════════════
group("client: permalink, rerun, and the record diff");

await test("the Markdown export prints the permalink when the record carries one", () => {
  const mdAt = appSrc.indexOf("function searchRecordMarkdown");
  const panelAt = appSrc.indexOf("function SearchRecordPanel");
  const md = appSrc.slice(mdAt, panelAt);
  assert.match(md, /if \(record\.url\)/, "the export does not gate the permalink on the record carrying one");
  assert.match(md, /lines\.push\("Permanent link: " \+ record\.url\)/, "the export does not print the permalink");
});

await test("the panel shows the permalink with a copy action, and says when there is none", () => {
  const panelAt = appSrc.indexOf("function SearchRecordPanel");
  const endAt = appSrc.indexOf("function AnswerDiagnostics");
  const panel = appSrc.slice(panelAt, endAt);
  // Corrected contract (2026-10-13, third rescore fix): the absence
  // line now splits by cause. A cache serve's record was never store
  // attempted and keeps "No permanent link was stored"; a live run
  // whose store failed (stored false, permalink withdrawn server
  // side) must say the record could not be saved, in the panel and
  // in the Markdown export alike.
  // Frontend audit (same day): when the URL exists the row renders it
  // as a real anchor (it used to print as untappable plain text), so
  // the row's shape is now a ternary on record.url; the absence split
  // below it is unchanged and still pinned.
  assert.match(panel, /sectionRow\("Link", record\.url \? \(/,
    "the panel does not render the link row from the stored URL");
  assert.ok(panel.includes('<a href={record.url}'), "the permalink is not a real link");
  assert.ok(panel.includes('record.stored === false'), "the panel does not split the link absence by the store outcome");
  assert.ok(panel.includes("This record could not be saved, so it has no permanent link."),
    "the panel does not say a failed store could not be saved");
  assert.ok(panel.includes("No permanent link was stored for this record."),
    "the panel lost the cache serve's honest absence line");
  const mdAt = appSrc.indexOf("function searchRecordMarkdown");
  const md = appSrc.slice(mdAt, panelAt);
  assert.match(md, /record\.stored === false/, "the Markdown export does not read the store outcome");
  assert.ok(md.includes("This record could not be saved, so it has no permanent link."),
    "the Markdown export does not say a failed store could not be saved");
  assert.match(panel, /copyToClipboard\(record\.url, "Record link copied"\)/, "no copy action for the permalink");
  assert.ok(panel.includes("Copy link"), "Copy link action missing");
});

await test("the panel's rerun stashes its record as baseline and asks the question again", () => {
  const panelAt = appSrc.indexOf("function SearchRecordPanel");
  const endAt = appSrc.indexOf("function AnswerDiagnostics");
  const panel = appSrc.slice(panelAt, endAt);
  assert.ok(panel.includes("Rerun this search"), "Rerun this search action missing from the panel");
  assert.match(panel, /stashRecordBaseline\(record, t && t\.confidence\)/, "the rerun does not stash the baseline with the turn's confidence");
  assert.match(panel, /new CustomEvent\("cb:rerun-record", \{ detail: \{ question: record\.question \} \}\)/,
    "the rerun does not dispatch the rerun event with the question");
  assert.match(appSrc, /window\.addEventListener\("cb:rerun-record", rerunRecord\)/, "the app shell does not listen for the rerun event");
  assert.match(appSrc, /askRef\.current\?\.\(q\)/, "the rerun listener does not ask the question");
});

await test("ask() consumes a matching baseline onto the fresh turn and drops a mismatched one", () => {
  assert.match(appSrc, /sessionStorage\.getItem\(RECORD_BASELINE_KEY\)/, "ask does not read the baseline stash");
  assert.match(appSrc, /sessionStorage\.removeItem\(RECORD_BASELINE_KEY\)/, "ask does not consume the stash");
  assert.match(appSrc, /parsedBaseline\.question\.trim\(\)\.toLowerCase\(\) === question\.trim\(\)\.toLowerCase\(\)/,
    "the baseline is not gated on the asked question matching");
  assert.match(appSrc, /_record: data\._record \|\| null, recordBaseline,/, "the fresh turn does not carry the baseline");
  assert.match(appSrc, /t\.recordBaseline/, "the panel does not read the baseline off the turn");
  assert.match(appSrc, /<RecordComparison baseline=\{baseline\} record=\{record\} confidence=\{t && t\.confidence\} P=\{P\} \/>/,
    "the comparison is not rendered in the fresh panel");
});

function liftDiff() {
  const fnAt = appSrc.indexOf("function diffSearchRecords(baseline, fresh) {");
  assert.ok(fnAt > 0, "diffSearchRecords is missing from CerebrumApp.jsx");
  const fnSrc = appSrc.slice(fnAt, appSrc.indexOf("\n}", fnAt) + 2);
  return new Function(`${fnSrc}; return diffSearchRecords;`)();
}

const DIFF_BASE = {
  question: "can wood frogs survive being frozen",
  askedAt: "2026-10-12T09:30:00.000Z",
  databases: [{ source: "europePMC", ok: true, count: 30 }, { source: "pubmed", ok: true, count: 20 }],
  funnel: { gathered: 40, deduped: 30, excludedWeak: 10, excludedNonEnglish: 0, excludedRetracted: 0, cited: 1 },
  sources: [
    { n: 1, title: "Freeze tolerance in the wood frog", doi: "10.1000/frog1", url: "https://doi.org/10.1000/frog1", year: 2021, cited: true },
    { n: 2, title: "Winter ecology of northern amphibians", doi: "10.1000/frog2", url: "https://doi.org/10.1000/frog2", year: 2015, cited: false },
  ],
  confidenceLine: "Moderate confidence: two databases answered and one paper is cited.",
};

await test("identical records diff to nothing and report unchanged", () => {
  const diffSearchRecords = liftDiff();
  const fresh = JSON.parse(JSON.stringify(DIFF_BASE));
  const d = diffSearchRecords(DIFF_BASE, fresh);
  assert.equal(d.comparable, true);
  assert.equal(d.unchanged, true);
  assert.deepEqual(d.addedSources, []);
  assert.deepEqual(d.removedSources, []);
  assert.equal(d.citedDelta, 0);
  assert.equal(d.gatheredDelta, 0);
  assert.equal(d.databasesDelta, 0);
  assert.deepEqual(d.notes, []);
  assert.equal(d.confidenceLineBefore, DIFF_BASE.confidenceLine);
  assert.equal(d.confidenceLineAfter, DIFF_BASE.confidenceLine);
});

await test("an added and a removed source are named, and the count deltas are real", () => {
  const diffSearchRecords = liftDiff();
  const fresh = {
    ...DIFF_BASE,
    databases: [{ source: "europePMC", ok: true, count: 44 }],
    funnel: { ...DIFF_BASE.funnel, gathered: 57, cited: 2 },
    sources: [
      { n: 1, title: "Winter ecology of northern amphibians", doi: "10.1000/frog2", url: "https://doi.org/10.1000/frog2", year: 2015, cited: true },
      { n: 2, title: "Glucose as a cryoprotectant in a freeze tolerant frog", doi: "10.1000/frog3", url: "https://doi.org/10.1000/frog3", year: 2019, cited: true },
    ],
  };
  const d = diffSearchRecords(DIFF_BASE, fresh);
  assert.equal(d.comparable, true);
  assert.equal(d.unchanged, false);
  assert.deepEqual(d.addedSources.map((s) => s.title), ["Glucose as a cryoprotectant in a freeze tolerant frog"]);
  assert.deepEqual(d.removedSources.map((s) => s.title), ["Freeze tolerance in the wood frog"]);
  assert.equal(d.citedBefore, 1);
  assert.equal(d.citedAfter, 2);
  assert.equal(d.citedDelta, 1);
  assert.equal(d.gatheredDelta, 17);
  assert.equal(d.databasesDelta, -1);
});

await test("source identity matches on any shared key: DOI, URL, or normalized title", () => {
  const diffSearchRecords = liftDiff();
  // Multi key identity, the bibliography dedupe's own rule: entries
  // are the same paper when ANY key intersects. The first version of
  // this diff used a single key by precedence (DOI, else URL, else
  // title), which could never match a paper whose baseline entry
  // carried a DOI and whose fresh entry did not. The pin now covers
  // exactly that cross shape.
  const fresh = {
    ...DIFF_BASE,
    sources: [
      { n: 1, title: "Freeze tolerance in the wood frog, revised title", doi: "10.1000/FRog1", url: null, year: 2021, cited: true },
      { n: 2, title: "  winter ecology of northern amphibians ", doi: null, url: null, year: 2015, cited: false },
    ],
  };
  const d = diffSearchRecords(DIFF_BASE, fresh);
  assert.deepEqual(d.addedSources, [], "a retitled record with the same DOI must not read as a new source");
  assert.deepEqual(d.removedSources, [], "a paper matched on its title alone must not read as removed");
});

await test("missing fields degrade to honest notes, never a crash or a fabricated zero", () => {
  const diffSearchRecords = liftDiff();
  const noRecord = diffSearchRecords(DIFF_BASE, null);
  assert.equal(noRecord.comparable, false);
  assert.ok(noRecord.notes[0].includes("no record"), "a missing record is not named in the notes");
  assert.equal(noRecord.citedDelta, null);
  const thin = diffSearchRecords({ question: "q" }, { question: "q", sources: [], funnel: null, databases: null });
  assert.equal(thin.comparable, true, "two thin records still compare, with notes");
  assert.ok(thin.notes.some((n) => n.includes("no source list")), "the missing source list is not named");
  assert.equal(thin.citedBefore, null, "a missing source list is null, not zero");
  assert.equal(thin.citedAfter, 0, "an empty recorded list is a real zero");
  assert.equal(thin.gatheredDelta, null);
  assert.ok(thin.notes.some((n) => n.includes("confidence line is missing")),
    "a missing confidence line is named instead of compared");
  assert.equal(thin.confidenceLineBefore, null);
});

// ═══════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
