/**
 * Citation-import tests: src/importCitations.js.
 *
 * The reverse of the Library's export: BibTeX and RIS parsing, format
 * detection, identity keys, and library merging. Unit tests against the
 * real module — no server, no network.
 * Run with: node tests/import-citations.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  parseBibTeX,
  parseRIS,
  detectCitationFormat,
  importCitations,
  citationIdentity,
  mergeCitationPapers,
} = await import(join(root, "src/importCitations.js"));

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

// ══════════════════════════════════════════════════════════════════════
group("BibTeX parsing");

await test("parses a basic @article with all fields", () => {
  const { papers, errors } = parseBibTeX(`@article{jiang2017,
  author = {Jiang, F. and Doudna, J. A.},
  title = {CRISPR-Cas9 structures and mechanisms},
  journal = {Annual Review of Biophysics},
  year = {2017},
  doi = {10.1146/annurev-biophys-062215-010822},
  url = {https://www.annualreviews.org/content/journals/10.1146/annurev-biophys-062215-010822}
}`);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(papers.length, 1);
  const p = papers[0];
  assert.equal(p.title, "CRISPR-Cas9 structures and mechanisms");
  assert.equal(p.authors, "F. Jiang, J. A. Doudna");
  assert.equal(p.journal, "Annual Review of Biophysics");
  assert.equal(p.year, "2017");
  assert.equal(p.doi, "10.1146/annurev-biophys-062215-010822");
  assert.ok(p.url.startsWith("https://"), p.url);
  assert.equal(p.type, "journal-article");
});

await test("@book uses publisher and maps to book type", () => {
  const { papers } = parseBibTeX(`@book{doe2020handbook,
  author = {Doe, Jane},
  title = {A Handbook of Examples},
  publisher = {Example Press},
  year = 2020
}`);
  assert.equal(papers.length, 1);
  assert.equal(papers[0].type, "book");
  assert.equal(papers[0].journal, "Example Press");
  assert.equal(papers[0].year, "2020");
});

await test("@inproceedings uses booktitle and maps to proceedings-article", () => {
  const { papers } = parseBibTeX(`@inproceedings{smith2019,
  author = {Smith, A. and Jones, B.},
  title = {Attention is all you need, revisited},
  booktitle = {Proceedings of NeurIPS},
  year = {2019}
}`);
  assert.equal(papers[0].type, "proceedings-article");
  assert.equal(papers[0].journal, "Proceedings of NeurIPS");
});

await test("@misc maps to other", () => {
  const { papers } = parseBibTeX(`@misc{anon2021, title = {Some web thing}, year = {2021}}`);
  assert.equal(papers[0].type, "other");
});

await test("nested braces and case-protection in titles are stripped", () => {
  const { papers } = parseBibTeX(`@article{x, title = {{CRISPR}-{Cas9} editing in {E}. coli}, year = {2020}}`);
  assert.equal(papers[0].title, "CRISPR-Cas9 editing in E. coli");
});

await test("LaTeX accents are decoded best-effort", () => {
  const { papers } = parseBibTeX(`@article{x,
  author = {M\\"uller, J. and Garc\\'ia, M. and Fran\\c{c}ois, P.},
  title = {Na\\"ive Bayes on caf\\'es},
  year = {2021}
}`);
  assert.equal(papers[0].authors, "J. Müller, M. García, P. François");
  assert.equal(papers[0].title, "Naïve Bayes on cafés");
});

await test("quoted values, bare numbers, and #-concatenation parse", () => {
  const { papers } = parseBibTeX(`@article{x,
  title = "A quoted title",
  year = 2018,
  journal = {J. } # {Testing}
}`);
  assert.equal(papers[0].title, "A quoted title");
  assert.equal(papers[0].year, "2018");
  assert.equal(papers[0].journal, "J. Testing");
});

await test("year falls back to the date field", () => {
  const { papers } = parseBibTeX(`@article{x, title = {T}, date = {2019-05-01}}`);
  assert.equal(papers[0].year, "2019");
});

await test("doi URL prefix is stripped and a missing url is derived from the DOI", () => {
  const { papers } = parseBibTeX(`@article{x, title = {T}, doi = {https://doi.org/10.1000/xyz123}}`);
  assert.equal(papers[0].doi, "10.1000/xyz123");
  assert.equal(papers[0].url, "https://doi.org/10.1000/xyz123");
});

await test("entries without a title are skipped with an error, not thrown", () => {
  const { papers, errors } = parseBibTeX(`@article{nope, author = {Nobody}, year = {2020}}
@article{ok, title = {Real title}, year = {2021}}`);
  assert.equal(papers.length, 1);
  assert.equal(papers[0].title, "Real title");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no title/i);
});

await test("an unbalanced entry reports an error but later entries still parse", () => {
  const { papers, errors } = parseBibTeX(`@article{broken, title = {Missing brace, year = {2020}}
@article{fine, title = {Still here}, year = {2021}}`);
  assert.equal(papers.length, 1);
  assert.equal(papers[0].title, "Still here");
  assert.ok(errors.length >= 1, "expected an error for the broken entry");
});

await test("empty input gives a clear error", () => {
  const { papers, errors } = parseBibTeX("   \n  ");
  assert.equal(papers.length, 0);
  assert.ok(errors.length >= 1);
});

await test("garbage with no @entries gives a clear error", () => {
  const { papers, errors } = parseBibTeX("just some random text, no bibtex here");
  assert.equal(papers.length, 0);
  assert.ok(errors.length >= 1);
});

// ══════════════════════════════════════════════════════════════════════
group("RIS parsing");

const RIS_TWO = `TY  - JOUR
AU  - Jiang, F.
AU  - Doudna, J. A.
TI  - CRISPR-Cas9 structures and mechanisms
JO  - Annual Review of Biophysics
PY  - 2017
DO  - 10.1146/annurev-biophys-062215-010822
UR  - https://www.annualreviews.org/content/journals/10.1146/annurev-biophys-062215-010822
ER  -

TY  - BOOK
A1  - Doe, Jane
T1  - A Handbook of Examples
Y1  - 2020
ER  - `;

await test("parses JOUR and BOOK records with AU/A1 and TI/T1 variants", () => {
  const { papers, errors } = parseRIS(RIS_TWO);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(papers.length, 2);
  assert.equal(papers[0].authors, "Jiang, F., Doudna, J. A.");
  assert.equal(papers[0].title, "CRISPR-Cas9 structures and mechanisms");
  assert.equal(papers[0].journal, "Annual Review of Biophysics");
  assert.equal(papers[0].year, "2017");
  assert.equal(papers[0].doi, "10.1146/annurev-biophys-062215-010822");
  assert.equal(papers[0].type, "journal-article");
  assert.equal(papers[1].type, "book");
  assert.equal(papers[1].authors, "Doe, Jane");
  assert.equal(papers[1].year, "2020");
});

await test("JF is accepted as the journal tag and Y1 dates give the year", () => {
  const { papers } = parseRIS(`TY  - JOUR
JF  - Cell
Y1  - 2019/05/01/
TI  - A paper
ER  - `);
  assert.equal(papers[0].journal, "Cell");
  assert.equal(papers[0].year, "2019");
});

await test("TY CONF maps to proceedings-article, unknown TY maps to other", () => {
  const { papers } = parseRIS(`TY  - CONF
TI  - Conference paper
ER  -

TY  - WEIRD
TI  - Something odd
ER  - `);
  assert.equal(papers[0].type, "proceedings-article");
  assert.equal(papers[1].type, "other");
});

await test("a record without a title is skipped with an error; others still parse", () => {
  const { papers, errors } = parseRIS(`TY  - JOUR
AU  - Nobody
ER  -

TY  - JOUR
TI  - Kept
ER  - `);
  assert.equal(papers.length, 1);
  assert.equal(papers[0].title, "Kept");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no title/i);
});

await test("doi.org URLs in DO are normalized and UR falls back to the DOI link", () => {
  const { papers } = parseRIS(`TY  - JOUR
TI  - T
DO  - https://doi.org/10.1000/xyz123
ER  - `);
  assert.equal(papers[0].doi, "10.1000/xyz123");
  assert.equal(papers[0].url, "https://doi.org/10.1000/xyz123");
});

await test("non-HTTP URLs are rejected", () => {
  const { papers } = parseRIS(`TY  - JOUR
TI  - T
UR  - javascript:alert(1)
ER  - `);
  assert.equal(papers[0].url, "");
});

await test("garbage with no TY/ER lines gives a clear error", () => {
  const { papers, errors } = parseRIS("hello world\nnot a ris file");
  assert.equal(papers.length, 0);
  assert.ok(errors.length >= 1);
});

await test("empty input gives a clear error", () => {
  const { papers, errors } = parseRIS("");
  assert.equal(papers.length, 0);
  assert.ok(errors.length >= 1);
});

// ══════════════════════════════════════════════════════════════════════
group("Format detection and combined entry point");

await test("detects bibtex, ris, and neither", () => {
  assert.equal(detectCitationFormat("@article{x, title={T}}"), "bibtex");
  assert.equal(detectCitationFormat("TY  - JOUR\nTI  - T\nER  - "), "ris");
  assert.equal(detectCitationFormat("nothing here"), null);
  assert.equal(detectCitationFormat(""), null);
});

await test("importCitations routes bibtex and ris automatically", () => {
  const b = importCitations("@article{x, title = {T}, year = {2020}}");
  assert.equal(b.format, "bibtex");
  assert.equal(b.papers.length, 1);
  const r = importCitations("TY  - JOUR\nTI  - T\nER  - ");
  assert.equal(r.format, "ris");
  assert.equal(r.papers.length, 1);
});

await test("importCitations rejects an unrecognized file with a helpful error", () => {
  const { format, papers, errors } = importCitations("<?xml version=\"1.0\"?><nothing/>");
  assert.equal(format, null);
  assert.equal(papers.length, 0);
  assert.ok(errors[0].match(/BibTeX.*RIS|RIS.*BibTeX/i), errors[0]);
});

// ══════════════════════════════════════════════════════════════════════
group("Identity and merge");

await test("citationIdentity matches DOIs across bare and URL forms", () => {
  const a = citationIdentity({ doi: "10.1000/XYZ123", title: "Whatever", year: "2020" });
  const b = citationIdentity({ DOI: "https://doi.org/10.1000/xyz123", title: "Different", year: "1999" });
  assert.equal(a, b);
  assert.ok(a.startsWith("doi:"));
});

await test("citationIdentity falls back to title+year, case and punctuation insensitive", () => {
  const a = citationIdentity({ title: "CRISPR–Cas9: structures & mechanisms!", year: "2017" });
  const b = citationIdentity({ title: "crispr cas9 structures mechanisms", year: "2017" });
  assert.equal(a, b);
});

await test("mergeCitationPapers dedupes by DOI against the existing library", () => {
  const existing = [{ title: "Old", doi: "10.1000/abc", year: "2020" }];
  const incoming = [
    { title: "Same paper", DOI: "https://doi.org/10.1000/ABC", year: "2020" },
    { title: "Brand new", year: "2021" },
  ];
  const { merged, added, skipped } = mergeCitationPapers(existing, incoming);
  assert.equal(added, 1);
  assert.equal(skipped, 1);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].title, "Brand new");
  assert.ok(merged[1].savedAt, "new paper should carry savedAt");
});

await test("mergeCitationPapers dedupes by title+year when there is no DOI", () => {
  const existing = [{ title: "A study of things", year: "2019" }];
  const incoming = [{ title: "a study of things!", year: "2019" }, { title: "A study of things", year: "2020" }];
  const { merged, added, skipped } = mergeCitationPapers(existing, incoming);
  assert.equal(added, 1, "different year is a different paper");
  assert.equal(skipped, 1);
  assert.equal(merged.length, 2);
});

await test("mergeCitationPapers collapses duplicates inside the incoming batch", () => {
  const { merged, added, skipped } = mergeCitationPapers([], [
    { title: "Dup", year: "2022" },
    { title: "Dup", year: "2022" },
  ]);
  assert.equal(added, 1);
  assert.equal(skipped, 1);
  assert.equal(merged.length, 1);
});

await test("round trip: toBibTeX-style output re-imports", () => {
  // Mirrors the app's own BibTeX export shape.
  const exported = "@article{cerebrum2021_1,\n  author = {Smith, A.},\n  title = {Exported paper},\n  journal = {J Test},\n  year = {2021},\n  url = {https://example.com/p}\n}";
  const { papers, errors } = parseBibTeX(exported);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(papers[0].title, "Exported paper");
  assert.equal(papers[0].authors, "A. Smith");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
