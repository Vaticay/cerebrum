/**
 * Citation import — the reverse of the Library's RIS/BibTeX export
 * (toRIS/toBibTeX in CerebrumApp.jsx).
 *
 * Plain JS module — no React, no DOM — so it can be unit-tested in plain
 * node and imported by the app without dragging anything extra into the
 * bundle.
 *
 * Supported inputs — the formats Zotero, Mendeley and most reference
 * managers export:
 *   - BibTeX (.bib): @article, @book, @inproceedings, @incollection,
 *     @proceedings, @misc, @phdthesis, @mastersthesis, @techreport, @manual
 *   - RIS (.ris): TY/AU/A1/TI/T1/JO/JF/PY/Y1/DO/UR
 *
 * Paper shape matches the library's saved papers:
 *   { authors (string), title, journal, year, url, doi, type }
 *
 * Every parser returns { papers, errors }: malformed entries are reported
 * as error strings, never thrown, so a partial parse still imports the
 * entries that did read cleanly.
 *
 * Honest limitations, surfaced in the import UI:
 *   - RIS/BibTeX exports don't carry abstracts, so imported papers arrive
 *     without them.
 *   - LaTeX in BibTeX values (accents, braces) is decoded on a
 *     best-effort basis.
 */

const MAX_PAPERS = 500;

const BIBTEX_TYPE_LABELS = {
  article: "journal-article",
  book: "book",
  booklet: "other",
  inbook: "book-chapter",
  incollection: "book-chapter",
  inproceedings: "proceedings-article",
  conference: "proceedings-article",
  manual: "report",
  mastersthesis: "dissertation",
  misc: "other",
  phdthesis: "dissertation",
  proceedings: "proceedings",
  techreport: "report",
  unpublished: "other",
};

const RIS_TYPE_LABELS = {
  JOUR: "journal-article",
  MGZN: "journal-article",
  BOOK: "book",
  CHAP: "book-chapter",
  CONF: "proceedings-article",
  THES: "dissertation",
  DISS: "dissertation",
  RPRT: "report",
  ELEC: "webpage",
  GEN: "other",
  DATA: "dataset",
  PAT: "patent",
  SER: "serial",
  NEWS: "news-article",
  BLOG: "blog-post",
  COMP: "software",
  ADVS: "other",
  ART: "artwork",
  CASE: "other",
  CTLG: "other",
  EJOUR: "journal-article",
  EBOOK: "book",
  ECHAP: "book-chapter",
  GOVDOC: "report",
  HEAR: "other",
  ICOMM: "other",
  JFULL: "journal-article",
  LEGAL: "other",
  MAP: "other",
  MUSIC: "other",
  PAMP: "other",
  SLIDE: "other",
  SOUND: "other",
  STAND: "other",
  UNBILL: "other",
  UNPB: "other",
  VIDEO: "other",
};

/* ── Small helpers ─────────────────────────────────────────────────── */

function clean(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}

function normalizeDoi(v) {
  const d = clean(v)
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/[.,;:!?)\]]+$/, "");
  return /^10\.\d{4,9}\/\S+$/i.test(d) ? d : "";
}

function safeUrl(v) {
  const u = clean(v);
  return /^https?:\/\//i.test(u) ? u : "";
}

function yearOf(v) {
  const m = clean(v).match(/(19|20)\d{2}/);
  return m ? m[0] : "";
}

/* LaTeX accent decoding for BibTeX values — best effort. Handles the
   common commands (\"u, \'e, \^o, \~n, \c{c}, \ae, \ss, ...) and strips
   any leftover braces. */
const LATEX_ACCENTS = {
  '"': { a: "ä", A: "Ä", e: "ë", E: "Ë", i: "ï", I: "Ï", o: "ö", O: "Ö", u: "ü", U: "Ü", y: "ÿ", Y: "Ÿ" },
  "'": { a: "á", A: "Á", e: "é", E: "É", i: "í", I: "Í", o: "ó", O: "Ó", u: "ú", U: "Ú", y: "ý", Y: "Ý", c: "ć", C: "Ć", n: "ń", N: "Ń", s: "ś", S: "Ś", z: "ź", Z: "Ź" },
  "`": { a: "à", A: "À", e: "è", E: "È", i: "ì", I: "Ì", o: "ò", O: "Ò", u: "ù", U: "Ù" },
  "^": { a: "â", A: "Â", e: "ê", E: "Ê", i: "î", I: "Î", o: "ô", O: "Ô", u: "û", U: "Û" },
  "~": { a: "ã", A: "Ã", n: "ñ", N: "Ñ", o: "õ", O: "Õ" },
  "c": { c: "ç", C: "Ç", s: "ş", S: "Ş" },
  "v": { s: "š", S: "Š", c: "č", C: "Č", z: "ž", Z: "Ž", n: "ň", r: "ř", R: "Ř", d: "ď", t: "ť", e: "ě" },
  "u": { a: "ă", A: "Ă", g: "ğ", G: "Ğ" },
  "H": { o: "ő", O: "Ő", u: "ű", U: "Ű" },
  ".": { z: "ż", Z: "Ż" },
  "=": { a: "ā", A: "Ā", e: "ē", E: "Ē", i: "ī", I: "Ī", o: "ō", O: "Ō", u: "ū", U: "Ū" },
  "k": { a: "ą", A: "Ą", e: "ę", E: "Ę" },
  "r": { a: "å", A: "Å" },
  "b": { o: "o̱" },
  "d": { h: "ḥ", H: "Ḥ", s: "ṣ", t: "ṭ", z: "ẓ" },
};

const LATEX_COMMANDS = {
  ae: "æ", AE: "Æ", oe: "œ", OE: "Œ", ss: "ß", aa: "å", AA: "Å",
  o: "ø", O: "Ø", l: "ł", L: "Ł", ij: "ĳ", IJ: "Ĳ", dh: "ð", DH: "Ð", th: "þ", TH: "Þ",
};

function decodeBibTeXRaw(raw) {
  let s = String(raw == null ? "" : raw);
  // \"u and \"{u} style accents
  s = s.replace(/\\(["'`^~cvuH.=kbrd])\{?([A-Za-z])\}?/g, (m, acc, ch) => {
    const table = LATEX_ACCENTS[acc];
    return (table && table[ch]) || ch;
  });
  // \ae \ss \o style commands
  s = s.replace(/\\(ae|AE|oe|OE|ss|aa|AA|o|O|l|L|ij|IJ|dh|DH|th|TH)\b/g, (m, cmd) => LATEX_COMMANDS[cmd] || m);
  // Em/en dashes, tildes, escaped specials
  s = s.replace(/---/g, "—").replace(/--/g, "–").replace(/~/g, " ").replace(/\\([&%$#_])/g, "$1");
  // Strip any leftover grouping braces
  s = s.replace(/[{}]/g, "");
  return s;
}

/* Full decode + whitespace collapse for a finished field value. */
function decodeBibTeXValue(raw) {
  return clean(decodeBibTeXRaw(raw));
}

/* BibTeX authors come as "Last, First and Last2, First2". The library
   stores a plain "First Last, First2 Last2" string. */
function bibtexAuthors(raw) {
  return clean(raw)
    .split(/\s+and\s+/i)
    .map((name) => {
      const n = name.trim();
      if (!n) return "";
      if (n.includes(",")) {
        const parts = n.split(",");
        const last = parts.shift().trim();
        const first = parts.join(",").trim();
        return clean(first ? `${first} ${last}` : last);
      }
      return n;
    })
    .filter(Boolean)
    .join(", ");
}

/* RIS authors are already "Last, First" per AU tag — keep as written. */
function risAuthors(list) {
  return list.map(clean).filter(Boolean).join(", ");
}

/* ── Format detection ──────────────────────────────────────────────── */

export function detectCitationFormat(text) {
  if (!text || !String(text).trim()) return null;
  const src = String(text);
  const bibIdx = src.search(/@\s*[A-Za-z]+\s*[{]/);
  const risMatch = src.match(/^\s*TY\s+-/m);
  if (bibIdx !== -1 && risMatch) {
    return bibIdx < risMatch.index ? "bibtex" : "ris";
  }
  if (bibIdx !== -1) return "bibtex";
  if (risMatch) return "ris";
  return null;
}

/* ── BibTeX ────────────────────────────────────────────────────────── */

/* Split a .bib file into raw entries. Unbalanced entries are reported
   and skipped without losing the entries that came before or after. */
function splitBibTeXEntries(src) {
  const entries = [];
  const errors = [];
  // Strip full-line comments (% at line start, per BibTeX convention).
  const text = src.split(/\r?\n/).filter((l) => !/^\s*%/.test(l)).join("\n");
  const re = /@([A-Za-z]+)\s*([{(])/g;
  let m;
  while ((m = re.exec(text))) {
    const entryType = m[1].toLowerCase();
    const openCh = m[2];
    const closeCh = openCh === "{" ? "}" : ")";
    let depth = 0;
    let end = -1;
    for (let i = m.index + m[0].length - 1; i < text.length; i++) {
      const ch = text[i];
      if (ch === openCh) depth++;
      else if (ch === closeCh) {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) {
      errors.push(`Entry ${entries.length + 1} (@${entryType}) is missing its closing brace, so it was skipped. The entries before it still imported.`);
      // Resume scanning after this point: the next @-entry may still be fine.
      re.lastIndex = m.index + m[0].length;
      continue;
    }
    entries.push({ type: entryType, body: text.slice(m.index + m[0].length, end) });
    re.lastIndex = end + 1;
  }
  return { entries, errors };
}

/* Parse the field list of one entry body (everything after the
   citation key). Values may be {braced}, "quoted", bare tokens, or
   #-concatenations of those. */
function parseBibTeXFields(body) {
  const fields = {};
  // Find the end of the citation key: first top-level comma.
  let depth = 0;
  let inQuote = false;
  let keyEnd = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"' && body[i - 1] !== "\\") inQuote = !inQuote;
    else if (!inQuote && ch === "{") depth++;
    else if (!inQuote && ch === "}") depth--;
    else if (!inQuote && depth === 0 && ch === ",") { keyEnd = i; break; }
  }
  const rest = keyEnd === -1 ? "" : body.slice(keyEnd + 1);

  // Split into field chunks on top-level commas.
  const chunks = [];
  depth = 0; inQuote = false;
  let cur = "";
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === '"' && rest[i - 1] !== "\\") { inQuote = !inQuote; cur += ch; }
    else if (!inQuote && ch === "{") { depth++; cur += ch; }
    else if (!inQuote && ch === "}") { depth--; cur += ch; }
    else if (!inQuote && depth === 0 && ch === ",") { chunks.push(cur); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) chunks.push(cur);

  for (const chunk of chunks) {
    const eq = chunk.indexOf("=");
    if (eq === -1) continue;
    const name = clean(chunk.slice(0, eq)).toLowerCase();
    if (!name) continue;
    fields[name] = parseBibTeXValue(chunk.slice(eq + 1).trim());
  }
  return fields;
}

function parseBibTeXValue(raw) {
  // Handle #-concatenation: month = jan # { 2020 }
  const parts = [];
  let depth = 0;
  let inQuote = false;
  let cur = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"' && raw[i - 1] !== "\\") { inQuote = !inQuote; cur += ch; }
    else if (!inQuote && ch === "{") { depth++; cur += ch; }
    else if (!inQuote && ch === "}") { depth--; cur += ch; }
    else if (!inQuote && depth === 0 && ch === "#") { parts.push(cur); cur = ""; }
    else cur += ch;
  }
  parts.push(cur);
  // Join first, clean once: concatenation is literal in BibTeX, so
  // `{J. } # { Testing }` must keep the space between the parts.
  return clean(parts.map((p) => {
    const t = p.trim();
    if (t.startsWith("{") && t.endsWith("}") && t.length >= 2) return decodeBibTeXRaw(t.slice(1, -1));
    if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
      return t.slice(1, -1).replace(/\\"/g, '"');
    }
    return decodeBibTeXRaw(t);
  }).join(""));
}

export function parseBibTeX(text) {
  const papers = [];
  const errors = [];
  const src = String(text == null ? "" : text);
  if (!src.trim()) {
    return { papers, errors: ["The file is empty. Pick a .bib file exported from Zotero, Mendeley, or another reference manager."] };
  }
  const { entries, errors: splitErrors } = splitBibTeXEntries(src);
  errors.push(...splitErrors);
  if (!entries.length && !errors.length) {
    return { papers, errors: ["No BibTeX entries were found. Make sure the file has entries like @article{...}."] };
  }
  entries.forEach((entry, i) => {
    const n = i + 1;
    try {
      const f = parseBibTeXFields(entry.body);
      const title = clean(f.title);
      if (!title) {
        errors.push(`Entry ${n} (@${entry.type}) has no title, so it was skipped.`);
        return;
      }
      const doi = normalizeDoi(f.doi);
      const url = safeUrl(f.url) || (doi ? `https://doi.org/${doi}` : "");
      papers.push({
        authors: bibtexAuthors(f.author || ""),
        title,
        journal: clean(f.journal || f.booktitle || f.publisher || ""),
        year: yearOf(f.year || f.date || ""),
        url,
        doi,
        type: BIBTEX_TYPE_LABELS[entry.type] || "other",
      });
    } catch (e) {
      errors.push(`Entry ${n} (@${entry.type}) could not be read and was skipped.`);
    }
    if (papers.length >= MAX_PAPERS) {
      errors.push(`The file has more than ${MAX_PAPERS} entries. Only the first ${MAX_PAPERS} were read.`);
      return;
    }
  });
  return { papers, errors };
}

/* ── RIS ───────────────────────────────────────────────────────────── */

function parseRisLine(line) {
  const m = line.match(/^([A-Z0-9]{2})\s*-\s?(.*)$/);
  if (!m) return null;
  return { tag: m[1], value: m[2] == null ? "" : m[2].replace(/\s+$/, "") };
}

export function parseRIS(text) {
  const papers = [];
  const errors = [];
  const src = String(text == null ? "" : text);
  if (!src.trim()) {
    return { papers, errors: ["The file is empty. Pick a .ris file exported from Zotero, Mendeley, or another reference manager."] };
  }
  const lines = src.split(/\r?\n/);
  const records = [];
  let current = null;
  let lastTag = null;
  let sawRecord = false;

  const flush = () => {
    if (current) { records.push(current); current = null; }
    lastTag = null;
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    const parsed = parseRisLine(line);
    if (!parsed) {
      // Possible continuation of the previous tag's value.
      if (current && lastTag) {
        const arr = current.tags[lastTag];
        if (arr && arr.length) arr[arr.length - 1] += " " + line.trim();
      }
      continue;
    }
    const { tag, value } = parsed;
    if (tag === "TY") {
      flush();
      current = { tags: {} };
      sawRecord = true;
      lastTag = "TY";
      (current.tags.TY = current.tags.TY || []).push(clean(value));
    } else if (tag === "ER") {
      sawRecord = true;
      flush();
    } else if (current) {
      (current.tags[tag] = current.tags[tag] || []).push(value);
      lastTag = tag;
    } else if (tag !== "TY") {
      // Tags before any TY line: ignore.
    }
  }
  flush();

  if (!sawRecord) {
    return { papers, errors: ["No RIS records were found. Make sure the file has TY and ER lines, like a Zotero or Mendeley RIS export."] };
  }

  records.forEach((rec, i) => {
    const n = i + 1;
    const tags = rec.tags;
    const first = (k) => (tags[k] && tags[k].length ? clean(tags[k][0]) : "");
    const all = (k) => (tags[k] || []).map(clean).filter(Boolean);
    const title = first("TI") || first("T1");
    if (!title) {
      errors.push(`Record ${n} has no title (TI), so it was skipped.`);
      return;
    }
    const doi = normalizeDoi(first("DO"));
    const url = safeUrl(first("UR")) || (doi ? `https://doi.org/${doi}` : "");
    const ty = first("TY").toUpperCase();
    papers.push({
      authors: risAuthors([...all("AU"), ...all("A1"), ...all("A2"), ...all("A3"), ...all("A4")]),
      title,
      journal: first("JO") || first("JF"),
      year: yearOf(first("PY") || first("Y1")),
      url,
      doi,
      type: RIS_TYPE_LABELS[ty] || "other",
    });
    if (papers.length >= MAX_PAPERS) {
      errors.push(`The file has more than ${MAX_PAPERS} records. Only the first ${MAX_PAPERS} were read.`);
      return;
    }
  });
  return { papers, errors };
}

/* ── Combined entry point ──────────────────────────────────────────── */

export function importCitations(text) {
  const src = String(text == null ? "" : text);
  const format = detectCitationFormat(src);
  if (format === "bibtex") return { format, ...parseBibTeX(src) };
  if (format === "ris") return { format, ...parseRIS(src) };
  return {
    format: null,
    papers: [],
    errors: ["This file doesn't look like BibTeX (.bib) or RIS (.ris). Export your library from Zotero or Mendeley in one of those formats and try again."],
  };
}

/* ── Dedup + merge ─────────────────────────────────────────────────── */

/* Identity key for a paper: DOI first, then title+year, then URL.
   Mirrors the library's own dedup (DOI, then title). */
export function citationIdentity(p) {
  if (!p) return "";
  const doi = normalizeDoi(p.doi || p.DOI);
  if (doi) return "doi:" + doi.toLowerCase();
  const t = clean(p.title).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  if (t) return "title:" + t + "|year:" + clean(p.year);
  const u = safeUrl(p.url || "").toLowerCase();
  if (u) return "url:" + u;
  return "";
}

/* Merge incoming papers into the existing library. Duplicates — by DOI,
   or by title+year when there is no DOI — are skipped, and duplicates
   inside the incoming batch collapse to one. New papers get a savedAt
   timestamp like papers saved from investigations. */
export function mergeCitationPapers(existing, incoming) {
  const seen = new Set((existing || []).map(citationIdentity).filter(Boolean));
  const merged = [...(existing || [])];
  let added = 0;
  let skipped = 0;
  for (const p of incoming || []) {
    const k = citationIdentity(p);
    if (!k || seen.has(k)) { skipped++; continue; }
    seen.add(k);
    merged.push({ ...p, savedAt: p.savedAt || Date.now() });
    added++;
  }
  return { merged, added, skipped };
}
