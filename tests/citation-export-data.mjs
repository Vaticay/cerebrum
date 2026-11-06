/**
 * Citation export data tests: the 2026-11-06 site debug exports fix.
 *
 * The exports audit (~/workspace/cerebrum-site-debug-nov06/exports/
 * report.md, catalog 1, 2, 3, 4, 7) proved that every citation writer
 * faithfully exported a stripped record: the served source carried no
 * doi field at all (the DOI lived only inside the URL) and authors
 * only as the display string ("Dong J et al."), so BibTeX, RIS, CSV,
 * Excel, and the Zotero send all shipped empty DOIs and a fake author
 * named "Dong J et al.". The fix serves doi and authorsFull alongside
 * the display fields (toSourceEntry in functions/api/search.js) and
 * routes every writer through src/citationExport.js.
 *
 * Unit tests against the real modules, plus source assertions for the
 * parts that live inside the CerebrumApp.jsx monolith and the search
 * worker (neither is importable in plain node). No server, no network.
 * Run with: node tests/citation-export-data.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  citationDoiOf,
  citationAuthorNames,
  citationAuthorsText,
  toRIS,
  toBibTeX,
  toCSV,
  zoteroItemOf,
} = await import(join(root, "src/citationExport.js"));
const { parseBibTeX, parseRIS, importCitations } = await import(join(root, "src/importCitations.js"));

const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const searchSrc = readFileSync(join(root, "functions/api/search.js"), "utf8");
const excelSrc = readFileSync(join(root, "src/exportExcel.js"), "utf8");

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

/* The first source of the audit lane's real production search
   ("does sleep help memory stick", 2026-11-06, saved as
   live-search.json in the exports evidence folder), in the shape the
   server serves since this fix: the display fields exactly as the
   live response carried them, plus the two additive fields. The DOI
   is the one the live record itself carries; authorsFull is the full
   list in the Europe PMC authorString style the fetchers store
   (Dong J, Zhan X, Sun H, Li Y, Chen R, Wang H). */
const LIVE_SOURCE = {
  title: "Olfactory dysfunction is associated with cognitive impairment in patients with obstructive sleep apnea: a cross-sectional study.",
  url: "https://doi.org/10.1007/s00405-021-07194-6",
  journal: "European archives of oto-rhino-laryngology : official journal of the European Federation of Oto-Rhino-Laryngological Societies (EUFOS) : affiliated with the German Society for Oto-Rhino-Laryngology - Head and Neck Surgery",
  authors: "Dong J et al.",
  year: "2022",
  citations: null,
  relevance: 73,
  type: "Journal",
  tldr: null,
  retracted: false,
  concern: false,
  updateType: null,
  thinEvidence: false,
  doi: "10.1007/s00405-021-07194-6",
  authorsFull: "Dong J, Zhan X, Sun H, Li Y, Chen R, Wang H",
};

/* The same live record as it arrived BEFORE the fix: no doi field,
   the DOI only inside the URL, authors only the display string. The
   writers must still recover the DOI from the URL, and must never
   present the truncation marker as an author. */
const LEGACY_SOURCE = { ...LIVE_SOURCE };
delete LEGACY_SOURCE.doi;
delete LEGACY_SOURCE.authorsFull;

/* A record that genuinely has no DOI anywhere. */
const NO_DOI_SOURCE = {
  title: "A paper with no DOI",
  authors: "Solo A",
  authorsFull: "Solo A, Helper B",
  journal: "Journal of Examples",
  year: "2019",
  url: "https://example.com/papers/123",
  type: "Journal",
};

// ══════════════════════════════════════════════════════════════════════
group("Served payload: the additive fields exist at the source");

await test("toSourceEntry serves doi from recordDoiOf and authorsFull from _allAuthors", () => {
  assert.ok(
    searchSrc.includes('doi: recordDoiOf(paper) || "",'),
    "served source record carries no doi field"
  );
  assert.ok(
    searchSrc.includes('authorsFull: String((paper && paper._allAuthors) || "").trim(),'),
    "served source record carries no authorsFull field"
  );
});

await test("the display fields the renderer uses are untouched beside them", () => {
  const entry = searchSrc.slice(searchSrc.indexOf("const toSourceEntry"), searchSrc.indexOf("let sourceList"));
  for (const field of ["title,", "url,", "journal,", "authors,", "year,", "citations,"]) {
    assert.ok(entry.includes(field), `toSourceEntry lost the display field ${field}`);
  }
});

await test("follow up reuse keeps authorsFull alive across the round trip", () => {
  assert.ok(
    searchSrc.includes("_allAuthors: s._allAuthors || s.authorsFull || s.authors || \"\","),
    "follow up reuse drops authorsFull back to the display string"
  );
});

// ══════════════════════════════════════════════════════════════════════
group("Live shape: the writers emit the DOI and the full author list");

await test("citationDoiOf and citationAuthorNames resolve the live record", () => {
  assert.equal(citationDoiOf(LIVE_SOURCE), "10.1007/s00405-021-07194-6");
  assert.deepEqual(citationAuthorNames(LIVE_SOURCE), ["Dong J", "Zhan X", "Sun H", "Li Y", "Chen R", "Wang H"]);
  assert.equal(citationAuthorsText(LIVE_SOURCE), "Dong J, Zhan X, Sun H, Li Y, Chen R, Wang H");
});

await test("BibTeX carries the doi field and every author, and no et al. author", () => {
  const bib = toBibTeX([LIVE_SOURCE]);
  assert.ok(bib.includes("doi = {10.1007/s00405-021-07194-6}"), bib);
  assert.ok(bib.includes("author = {Dong J and Zhan X and Sun H and Li Y and Chen R and Wang H}"), bib);
  assert.ok(!bib.includes("et al."), bib);
});

await test("RIS carries one AU line per author and the DO line", () => {
  const ris = toRIS([LIVE_SOURCE]);
  assert.ok(ris.includes("DO  - 10.1007/s00405-021-07194-6"), ris);
  assert.equal((ris.match(/^AU  - /gm) || []).length, 6, ris);
  assert.ok(ris.includes("AU  - Dong J"), ris);
  assert.ok(ris.includes("AU  - Wang H"), ris);
  assert.ok(!ris.includes("et al."), ris);
});

await test("CSV carries the full authors and the doi in their columns", () => {
  const csv = toCSV([LIVE_SOURCE]);
  const row = csv.split("\n")[1];
  assert.ok(row.includes('"Dong J, Zhan X, Sun H, Li Y, Chen R, Wang H"'), row);
  assert.ok(row.includes('"10.1007/s00405-021-07194-6"'), row);
  assert.ok(!row.includes("et al."), row);
});

await test("the Zotero item carries the DOI key and the full creators", () => {
  const item = zoteroItemOf(LIVE_SOURCE);
  assert.equal(item.DOI, "10.1007/s00405-021-07194-6");
  assert.deepEqual(
    item.creators.map((c) => c.name),
    ["Dong J", "Zhan X", "Sun H", "Li Y", "Chen R", "Wang H"]
  );
  assert.ok(item.creators.every((c) => c.creatorType === "author"));
});

await test("Cerebrum's own .bib reimports with the DOI and authors intact", () => {
  const { papers, errors } = importCitations(toBibTeX([LIVE_SOURCE]));
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(papers.length, 1);
  assert.equal(papers[0].doi, "10.1007/s00405-021-07194-6");
  assert.equal(papers[0].authors, "Dong J, Zhan X, Sun H, Li Y, Chen R, Wang H");
});

await test("the RIS export reimports with the DOI intact", () => {
  const { papers, errors } = parseRIS(toRIS([LIVE_SOURCE]));
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(papers[0].doi, "10.1007/s00405-021-07194-6");
});

// ══════════════════════════════════════════════════════════════════════
group("Legacy and honest empty shapes");

await test("a pre fix record still yields its DOI from the doi.org URL", () => {
  assert.equal(citationDoiOf(LEGACY_SOURCE), "10.1007/s00405-021-07194-6");
  const bib = toBibTeX([LEGACY_SOURCE]);
  assert.ok(bib.includes("doi = {10.1007/s00405-021-07194-6}"), bib);
  const item = zoteroItemOf(LEGACY_SOURCE);
  assert.equal(item.DOI, "10.1007/s00405-021-07194-6");
});

await test("the display string's et al. is a marker, never an exported author", () => {
  assert.deepEqual(citationAuthorNames(LEGACY_SOURCE), ["Dong J"]);
  assert.ok(!toBibTeX([LEGACY_SOURCE]).includes("et al."));
  assert.ok(!toRIS([LEGACY_SOURCE]).includes("et al."));
  assert.ok(!toCSV([LEGACY_SOURCE]).includes("et al."));
});

await test("a record with no DOI exports honestly empty DOI fields", () => {
  assert.equal(citationDoiOf(NO_DOI_SOURCE), "");
  assert.ok(!toBibTeX([NO_DOI_SOURCE]).includes("doi ="), toBibTeX([NO_DOI_SOURCE]));
  assert.ok(!toRIS([NO_DOI_SOURCE]).includes("DO  -"), toRIS([NO_DOI_SOURCE]));
  const item = zoteroItemOf(NO_DOI_SOURCE);
  assert.ok(!("DOI" in item), "Zotero item gained an empty DOI key");
  assert.deepEqual(item.creators.map((c) => c.name), ["Solo A", "Helper B"]);
});

await test("array authors are tolerated, matching the exportExcel contract", () => {
  const s = { ...NO_DOI_SOURCE, authorsFull: ["Array Author A", "Array Author B"] };
  assert.deepEqual(citationAuthorNames(s), ["Array Author A", "Array Author B"]);
  assert.ok(toRIS([s]).includes("AU  - Array Author A"));
});

// ══════════════════════════════════════════════════════════════════════
group("BibTeX round trip: the gen2 collapse stays fixed (catalog 4)");

await test("an imported two author paper re exports as two authors and reimports whole", () => {
  // The audit lane's gen2.mjs proof, as a regression test: import a
  // real .bib entry, export it again, import the export.
  const first = importCitations(`@article{x, author = {Doe, John and Smith, Jane}, title = {Two author paper}, journal = {J}, year = {2020}, doi = {10.1000/xyz123}}`);
  assert.equal(first.papers.length, 1, JSON.stringify(first.errors));
  assert.equal(first.papers[0].authors, "John Doe, Jane Smith");
  const bib2 = toBibTeX(first.papers);
  assert.ok(bib2.includes("author = {John Doe and Jane Smith}"), bib2);
  const second = importCitations(bib2);
  assert.equal(second.papers.length, 1, JSON.stringify(second.errors));
  assert.equal(second.papers[0].authors, "John Doe, Jane Smith");
  assert.equal(second.papers[0].doi, "10.1000/xyz123");
});

await test("a stored comma separated author list is never written verbatim into BibTeX", () => {
  const bib = toBibTeX([{ title: "T", authors: "John Doe, Jane Smith", year: "2020" }]);
  assert.ok(!bib.includes("author = {John Doe, Jane Smith}"), bib);
  assert.ok(bib.includes("author = {John Doe and Jane Smith}"), bib);
  const back = parseBibTeX(bib);
  assert.equal(back.papers[0].authors, "John Doe, Jane Smith");
});

// ══════════════════════════════════════════════════════════════════════
group("Excel: full authors, DOI backstop, and the stance pairing (catalog 1, 3)");

await test("exportExcel prefers authorsFull and mines the DOI from the URL as a backstop", () => {
  assert.ok(excelSrc.includes("paper.authorsFull != null ? paper.authorsFull : paper.authors"),
    "the Authors cell does not prefer authorsFull");
  assert.ok(excelSrc.includes("match(/doi\\.org\\/(.+)$/i)"), "doiOf lost the URL backstop");
});

await test("the Bibliography builds stances from the same filtered list it exports", () => {
  assert.ok(
    appSrc.includes("const citedEntries = (sources || []).map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => !(s && s.uncited));"),
    "the cited entries filter moved; recheck the stance pairing by hand"
  );
  assert.ok(
    appSrc.includes("const stances = relOf ? citedEntries.map(({ n }) => relWord[relOf(n)] || \"\") : undefined;"),
    "stances are not built from the filtered cited list"
  );
  assert.ok(
    appSrc.includes("exportTopPapersExcel(citedEntries.map(({ s }) => s), { accent, stances })"),
    "the workbook call no longer pairs the filtered papers with the filtered stances"
  );
});

/* The audit lane's workbook proof (xlsxrun/run.mjs) as a regression
   test: three sources, the middle one uncited with stance Mentions,
   exported filtered. "Cited paper two" must wear its own stance,
   Contradicts in the proof's vocabulary (the app's relWord maps the
   same relation to "Contests"; the pairing is what is pinned here),
   and each row must carry the full authors and the DOI. Skips
   cleanly when exceljs is not installed (bare worktrees carry no
   node_modules; the export-excel suite owns the full workbook
   contract in a dependency complete run). */
let workbookMod = null;
try {
  workbookMod = await import(join(root, "src/exportExcel.js"));
} catch (e) {
  console.log(`  (workbook test skipped: ${e.code || e.message})`);
}
if (workbookMod) {
  await test("workbook rows keep each cited paper's own stance, authors, and DOI", async () => {
    const sources = [
      { title: "Cited paper one", authors: "Dong J et al.", authorsFull: "Dong J, Zhan X", journal: "J1", year: "2022", url: "https://doi.org/10.1007/s00405-021-07194-6", doi: "10.1007/s00405-021-07194-6", citations: 12 },
      { title: "Uncited middle paper", authors: "Hanff AM et al.", authorsFull: "Hanff AM, Other B", journal: "J2", year: "2025", url: "https://example.com/x", citations: 3, uncited: true },
      { title: "Cited paper two", authors: "Hattori M et al.", authorsFull: "Hattori M, Second C", journal: "J3", year: "2023", url: "https://doi.org/10.2000/abc-def", doi: "10.2000/abc-def", citations: 7 },
    ];
    const relWord = { 1: "Supports", 2: "Mentions", 3: "Contradicts" };
    // Mirror the shipped call shape: entries carry their full list
    // citation number, stances resolve per paper through that number.
    const citedEntries = sources.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => !(s && s.uncited));
    const stances = citedEntries.map(({ n }) => relWord[n] || "");
    const { workbook, count } = await workbookMod.buildPapersWorkbook(
      citedEntries.map(({ s }) => s),
      { stances, title: "T", subtitle: "S" }
    );
    assert.equal(count, 2);
    const ws = workbook.getWorksheet("Top papers");
    const row1 = ws.getRow(6);
    assert.equal(row1.getCell(2).value, "Cited paper one");
    assert.equal(row1.getCell(3).value, "Dong J, Zhan X");
    assert.equal(row1.getCell(6).value.text, "10.1007/s00405-021-07194-6");
    assert.equal(row1.getCell(8).value, "Supports");
    const row2 = ws.getRow(7);
    assert.equal(row2.getCell(2).value, "Cited paper two");
    assert.equal(row2.getCell(3).value, "Hattori M, Second C");
    assert.equal(row2.getCell(6).value.text, "10.2000/abc-def");
    assert.equal(row2.getCell(8).value, "Contradicts",
      "Cited paper two inherited the uncited middle paper's stance");
  });
}

// ══════════════════════════════════════════════════════════════════════
group("Zotero: the send and the dialog agree (catalog 1, 7)");

await test("saveToZotero builds its items through zoteroItemOf", () => {
  assert.ok(appSrc.includes("const items = sources.map((s) => zoteroItemOf(s));"),
    "saveToZotero no longer routes through zoteroItemOf");
  assert.ok(appSrc.includes('import { toRIS, toBibTeX, toCSV, zoteroItemOf } from "./citationExport.js";'),
    "the citation writers are not imported from the shared module");
});

await test("the dialog counts the cited set it actually sends", () => {
  assert.ok(appSrc.includes("const zoteroCitedCount = (sources || []).filter((x) => !(x && x.uncited)).length;"),
    "the dialog count is not the cited count");
  assert.ok(appSrc.includes("Send these {zoteroCitedCount} cited sources"),
    "the dialog copy does not use the cited count");
  assert.ok(appSrc.includes("Save {zoteroCitedCount}"),
    "the dialog button does not use the cited count");
  assert.ok(!appSrc.includes("Send these {sources.length} sources"),
    "the dialog still promises the full source count");
});

// ══════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
