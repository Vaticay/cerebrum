/**
 * Citation export writers — BibTeX, RIS, CSV, and the Zotero item
 * builder — for Cerebrum paper records.
 *
 * Plain JS module — no React, no DOM — so it can be unit-tested in
 * plain node (tests/citation-export-data.mjs), following the same
 * monolith split as src/importCitations.js and src/exportExcel.js.
 * Moved out of CerebrumApp.jsx on 2026-11-06 with the site debug
 * exports fix; the writers' output shapes are unchanged except for
 * the data defects below.
 *
 * The 2026-11-06 defect (exports audit, catalog 1, 2, 4): the served
 * source record used to carry no doi field at all (the DOI lived only
 * inside the URL) and authors only as the display string ("Dong J et
 * al."), so every writer faithfully exported empty DOIs and a fake
 * author named "Dong J et al.". The server now serves doi and
 * authorsFull alongside the display fields (toSourceEntry in
 * functions/api/search.js), and every writer here resolves the real
 * values through citationDoiOf / citationAuthorNames:
 *   - the DOI comes from the record's doi field, with the doi.org URL
 *     mined as a backstop for records saved before the field existed;
 *   - the author list comes from authorsFull when the record carries
 *     it, and the display string is only a last resort, with a
 *     trailing "et al." treated as what it is (a marker, not a name).
 * A record that genuinely has no DOI exports an empty DOI field.
 */

/* The record's DOI as the bare identifier, or "". Same normalization
 * the app applies everywhere (normalizeSourceDoi in CerebrumApp.jsx,
 * doiOf in exportExcel.js): strip a doi.org prefix and trailing
 * punctuation, then require the 10.registrant shape. */
export function citationDoiOf(source) {
  const s = source || {};
  const fromField = String(s.doi || s.DOI || "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/\/+$/, "").trim().replace(/[.,;:!?)\]]+$/, "");
  if (/^10\.\d{4,9}\//.test(fromField)) return fromField;
  const m = String(s.url || "").match(/doi\.org\/(.+)$/i);
  if (m && m[1]) {
    const fromUrl = m[1].replace(/\/+$/, "").trim().replace(/[.,;:!?)\]]+$/, "");
    if (/^10\.\d{4,9}\//i.test(fromUrl)) return fromUrl;
  }
  return "";
}

/* Split a stored author value into individual names. Stored shapes
 * in the wild: an array (tolerated, as in exportExcel), a comma
 * separated full name list ("John Doe, Jane Smith" — the shape the
 * citation importer stores and authorsFull carries), a BibTeX " and "
 * separated list, and the legacy display string ("Dong J et al."),
 * whose "et al." is a truncation marker, never a person. */
function splitAuthorList(value) {
  if (Array.isArray(value)) {
    return value.map((a) => String(a == null ? "" : a).trim()).filter(Boolean);
  }
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return [];
  const parts = /\s+and\s+/i.test(raw) ? raw.split(/\s+and\s+/i) : raw.split(",");
  return parts
    .map((a) => a.replace(/\s+et\s+al\.?$/i, "").trim())
    .filter((a) => a && !/^et\s+al\.?$/i.test(a));
}

/* The record's full author list as individual names: authorsFull
 * first, the display string only when nothing fuller exists. */
export function citationAuthorNames(source) {
  const s = source || {};
  const fuller = splitAuthorList(s.authorsFull != null ? s.authorsFull : s.allAuthors);
  if (fuller.length) return fuller;
  return splitAuthorList(s.authors);
}

/* The full author list as one comma separated string, for the
 * formats that carry authors in a single field (CSV). */
export function citationAuthorsText(source) {
  return citationAuthorNames(source).join(", ");
}

export function toRIS(sources) {
  // RIS is one tag per line; a stray newline inside a value would split
  // it into a phantom tag, so values are flattened before they go in.
  const risClean = (v) => String(v == null ? "" : v).replace(/\s*\n\s*/g, " ").trim();
  return (sources || []).map((s) => {
    const authors = citationAuthorNames(s);
    const lines = ["TY  - JOUR"];
    authors.forEach((a) => lines.push(`AU  - ${risClean(a)}`));
    if (s.title) lines.push(`TI  - ${risClean(s.title)}`);
    if (s.journal) lines.push(`JO  - ${risClean(s.journal)}`);
    if (s.year) lines.push(`PY  - ${risClean(s.year)}`);
    const doi = citationDoiOf(s);
    if (doi) lines.push(`DO  - ${risClean(doi)}`);
    if (s.url) lines.push(`UR  - ${risClean(s.url)}`);
    lines.push("ER  - ");
    return lines.join("\n");
  }).join("\n");
}
// BibTeX field values sit inside braces, so a raw brace or backslash in
// a title ends the field early and corrupts the whole entry, and the
// LaTeX special characters print wrong. Escape in a single pass so the
// replacements are never rescanned. The url and doi fields are read
// almost verbatim by url aware styles, so only the structural
// characters are escaped there.
const BIB_ESCAPES = { "\\": "\\textbackslash{}", "&": "\\&", "%": "\\%", "$": "\\$", "#": "\\#", "_": "\\_", "{": "\\{", "}": "\\}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" };
const BIB_REF_ESCAPES = { "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}" };
function bibEsc(v) { return String(v == null ? "" : v).replace(/[\\&%$#_{}~^]/g, (c) => BIB_ESCAPES[c]); }
function bibRefEsc(v) { return String(v == null ? "" : v).replace(/[\\{}]/g, (c) => BIB_REF_ESCAPES[c]); }
export function toBibTeX(sources) {
  return (sources || []).map((s, i) => {
    const fields = [];
    /* BibTeX grammar: authors are separated by " and ", never by
       commas — a comma separated list written verbatim reads back as
       ONE author in Last, First form (the round trip collapse the
       exports audit proved: "John Doe, Jane Smith" reimported as
       "Jane Smith John Doe"). Emit each name on its own, joined by
       " and ", from the full author list. */
    const authors = citationAuthorNames(s);
    if (authors.length) fields.push(`  author = {${authors.map((a) => bibEsc(a)).join(" and ")}}`);
    if (s.title) fields.push(`  title = {${bibEsc(s.title)}}`);
    if (s.journal) fields.push(`  journal = {${bibEsc(s.journal)}}`);
    if (s.year) fields.push(`  year = {${bibEsc(s.year)}}`);
    const doi = citationDoiOf(s);
    if (doi) fields.push(`  doi = {${bibRefEsc(doi)}}`);
    if (s.url) fields.push(`  url = {${bibRefEsc(s.url)}}`);
    return `@article{cerebrum${s.year || ""}_${i + 1},\n${fields.join(",\n")}\n}`;
  }).join("\n\n");
}
export function toCSV(sources) {
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const header = ["n", "authors", "title", "journal", "year", "type", "doi", "url"];
  const rows = (sources || []).map((s, i) => (
    [i + 1, citationAuthorsText(s), s.title, s.journal, s.year, s.type, citationDoiOf(s), s.url].map(esc).join(",")
  ));
  return [header.join(","), ...rows].join("\n");
}

/* One Zotero API item for a source record: full author list as
 * creators, and the DOI under its Zotero key. The old inline builder
 * in CerebrumApp.jsx split the display string and carried no DOI key
 * at all, so even a paper that had a DOI lost it on the way to
 * Zotero (exports audit, catalog 1). */
export function zoteroItemOf(s) {
  const src = s || {};
  const item = {
    itemType: "journalArticle",
    title: src.title || "",
    creators: citationAuthorNames(src).map((name) => ({ creatorType: "author", name })),
    publicationTitle: src.journal || "",
    date: String(src.year || ""),
    url: src.url || "",
  };
  const doi = citationDoiOf(src);
  if (doi) item.DOI = doi;
  return item;
}
