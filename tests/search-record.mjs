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
const { buildSearchRecord, buildCoverage } = await import(join(root, "functions/api/search.js"));
const searchSrc = readFileSync(join(root, "functions/api/search.js"), "utf8");
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");

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
    sourceOutcomes: [
      { source: "europePMC", ok: true, count: 40 },
      { source: "pubmed", ok: true, count: 31 },
      { source: "openAlex", ok: false, count: 0 },
    ],
    funnel: { gathered: 88, deduped: 61, ranked: 12, nonEnglishInner: 2 },
  },
  synthesisModel: "groq:openai/gpt-oss-120b",
  sources: [
    { title: "Zorblaxin inhibits quixotase in vitro", year: 2021, url: "https://doi.org/10.1000/abc123", uncited: false },
    { title: "Quixotase kinetics in leaf tissue", year: 2016, doi: "10.2000/xyz789", uncited: false },
    { title: "A review of zorblaxin chemistry", year: 2019, url: "https://example.org/review", uncited: true },
  ],
};

// ═══════════════════════════════════════════════════════════════════
group("buildSearchRecord: shape");

await test("assembles the full record from diag, funnel and sources", () => {
  const rec = buildSearchRecord(FULL_INPUT);
  assert.ok(rec, "record must not be null for a completed retrieval");
  assert.equal(rec.version, 1);
  assert.equal(rec.askedAt, "2026-10-13T14:00:00.000Z");
  assert.equal(rec.question, FULL_INPUT.question);
  assert.equal(rec.structuredQuery, FULL_INPUT.diag.structuredQuery);
  assert.deepEqual(rec.conceptQueries, FULL_INPUT.diag.conceptExpanded);
  assert.deepEqual(rec.llmExpansion, FULL_INPUT.diag.llmExpanded);
  assert.deepEqual(rec.databases, [
    { source: "europePMC", ok: true, count: 40 },
    { source: "pubmed", ok: true, count: 31 },
    { source: "openAlex", ok: false, count: 0 },
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
    excludedNonEnglish: 2,
    excludedRetracted: 0,
    cited: 2,
  });
});

await test("accepts the public _funnel shape directly", () => {
  const rec = buildSearchRecord({
    question: "q",
    funnel: { gathered: 10, deduped: 8, excludedWeak: 3, excludedNonEnglish: 1, excludedRetracted: 0, cited: 2 },
    sources: [{ title: "A", year: 2020 }, { title: "B", year: 2022 }],
  });
  assert.deepEqual(rec.funnel, { gathered: 10, deduped: 8, excludedWeak: 3, excludedNonEnglish: 1, excludedRetracted: 0, cited: 2 });
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

await test("the printed PDF methods carry the coverage sentence", () => {
  assert.match(appSrc, /const coverageLine = coverageSentence\(t\._coverage\);/, "PDF methods do not compute the coverage line");
  assert.match(appSrc, /mrows\.push\(\["Coverage", coverageLine\]\)/, "PDF methods do not print the coverage row");
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
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
