// Reference Check core (2026-11-06, Scite audit wave, ballot
// decision 6: DOI list first). Pure parsing, metadata extraction,
// the editorial concern ordering, and a batched resolver with an
// injectable fetch, so every rule is unit testable without any
// network. The endpoint in functions/api/refcheck.js is a thin
// shell over this module.
//
// What one check answers per reference, and nothing more:
//   - Bibliography integrity: does the DOI resolve at Crossref,
//     and what paper does it actually name (title, authors, year,
//     journal straight from the Crossref work record).
//   - Publication integrity: the retraction and editorial notice
//     verdict from functions/lib/retraction.js, under that module's
//     multi signal rule, stated there and nowhere else. This module
//     never invents a second rule; it feeds the same three channels
//     (Crossref updated by, Europe PMC plus PubMed types, OpenAlex)
//     into combineRetractionSignals.
//   - Reception tallies are NOT resolved here: the client asks the
//     existing /api/tallies for the resolved DOIs, exactly the way
//     the answer bibliography already does.
//
// No claim level matching (whether a reference supports the
// sentence that cites it) and no PDF input in this wave: both are
// later steps on the ballot, named as such, not silently absent.

import { normalizeRetractionDoi, crossrefNotices, pubmedSignal, openAlexSignal, combineRetractionSignals } from "./retraction.js";

// A DOI anywhere inside a pasted reference line. The pattern is
// deliberately the loose half: normalizeRetractionDoi applies the
// strict shape check and trims the trailing punctuation a citation
// leaves behind (periods, closing brackets, commas).
const DOI_IN_LINE = /10\.\d{4,9}\/[^\s"'<>]+/;

export function extractDoiFromLine(line) {
  const m = String(line || "").match(DOI_IN_LINE);
  if (!m) return null;
  return normalizeRetractionDoi(m[0]);
}

// Split pasted text into one entry per non empty line. Duplicate
// DOIs collapse to their first line (a bibliography that lists a
// paper twice gets one verdict, shown once); lines without a DOI
// never collapse, each is its own unchecked entry.
export function parseReferenceLines(text) {
  const out = [];
  const seenDoi = new Set();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const doi = extractDoiFromLine(line);
    if (doi) {
      if (seenDoi.has(doi)) continue;
      seenDoi.add(doi);
    }
    out.push({ line, doi });
  }
  return out;
}

function crossrefYear(message) {
  const parts = (message && (message.issued || message.published || message["published-print"] || message["published-online"] || message.created)) || null;
  const dp = parts && Array.isArray(parts["date-parts"]) ? parts["date-parts"][0] : null;
  const y = Array.isArray(dp) ? Number(dp[0]) : NaN;
  return Number.isFinite(y) && y > 0 ? y : null;
}

function crossrefAuthors(message) {
  const list = message && Array.isArray(message.author) ? message.author : [];
  const names = [];
  for (const a of list) {
    if (!a || typeof a !== "object") continue;
    if (a.name) { names.push(String(a.name)); continue; }
    const family = String(a.family || "").trim();
    const given = String(a.given || "").trim();
    if (!family && !given) continue;
    const initials = given.split(/[\s.]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase()).join("");
    names.push(initials ? `${family} ${initials}` : family);
  }
  return names.join(", ");
}

// One Crossref work message to the display metadata a reference
// row shows. Every field is the record's own value or null; a
// missing field renders as absent, never as a guess.
export function crossrefMeta(message) {
  if (!message || typeof message !== "object") return null;
  const title = Array.isArray(message.title) ? String(message.title[0] || "").trim() : "";
  const journal = Array.isArray(message["container-title"]) ? String(message["container-title"][0] || "").trim() : "";
  return {
    title: title || null,
    authors: crossrefAuthors(message) || null,
    year: crossrefYear(message),
    journal: journal || null,
  };
}

// The editorial concern ordering, Scite's verified shape: notices
// first, most concerning first. Settled retraction (two or more
// channels) leads. A reference that does not resolve follows: it
// is a bibliography failure a reader must fix before anything
// subtler matters. Then a single channel retraction report, an
// expression of concern, a correction, a clean resolution, and
// finally the ones no channel could answer for.
export const CONCERN_TIERS = {
  retracted: 0,
  unresolved: 1,
  reported: 2,
  concern: 3,
  corrected: 4,
  none: 5,
  unknown: 6,
};

// The status key a result carries, joining bibliography integrity
// with the retraction verdict: a parsed DOI that Crossref cannot
// find is "unresolved" whatever the other channels said (they had
// nothing to answer about), and a line with no DOI is "unresolved"
// with doi null.
export function refCheckStatus({ doi = null, resolves = false, verdict = null } = {}) {
  if (!doi) return "unresolved";
  if (!resolves) return "unresolved";
  const s = verdict && verdict.status ? verdict.status : "unknown";
  if (s === "retracted" || s === "reported" || s === "concern" || s === "corrected" || s === "none") return s;
  return "unknown";
}

export function orderRefCheckResults(results) {
  return (results || [])
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ta = CONCERN_TIERS[a.r.status] != null ? CONCERN_TIERS[a.r.status] : 6;
      const tb = CONCERN_TIERS[b.r.status] != null ? CONCERN_TIERS[b.r.status] : 6;
      return ta - tb || a.i - b.i;
    })
    .map(({ r }) => r);
}

// Batched resolution for parsed entries. fetchWithStatus(url) must
// return { status, json } or null on any transport failure; it is
// injectable for tests. Cost for N distinct DOIs: N Crossref calls
// (one per work; the same response yields resolution, metadata and
// the Crossref notice channel), one Europe PMC lite call, one
// PubMed esummary call, one OpenAlex call.
// Returns results in INPUT order; ordering is the caller's step
// (orderRefCheckResults), so a caller can also show input order.
export async function resolveReferenceChecks(entries, fetchWithStatus) {
  const list = Array.isArray(entries) ? entries : [];
  const dois = [...new Set(list.map((e) => e && e.doi).filter(Boolean))];
  const crossrefBy = {};   // doi -> { resolves, meta, notices }
  const openalexBy = {};
  const epmcBy = {};

  const crossrefCalls = dois.map(async (doi) => {
    const r = await fetchWithStatus("https://api.crossref.org/works/" + encodeURIComponent(doi));
    if (r && r.status === 404) { crossrefBy[doi] = { resolves: false, meta: null, notices: null }; return; }
    if (r && r.status === 200 && r.json && r.json.message) {
      crossrefBy[doi] = { resolves: true, meta: crossrefMeta(r.json.message), notices: crossrefNotices(r.json.message) };
      return;
    }
    // Any other outcome (rate limit, outage, malformed body): the
    // channel could not answer. Resolution stays unproven, which
    // the verdict layer reads as unknown, never as unresolved.
    crossrefBy[doi] = { resolves: null, meta: null, notices: null };
  });

  const openalexCall = (async () => {
    if (!dois.length) return;
    const filter = dois.map((d) => encodeURIComponent(d)).join("|");
    const r = await fetchWithStatus(`https://api.openalex.org/works?filter=doi:${filter}&select=id,doi,is_retracted&per-page=${Math.min(100, dois.length + 5)}`);
    const results = r && r.json && Array.isArray(r.json.results) ? r.json.results : [];
    for (const w of results) {
      const doi = normalizeRetractionDoi(w && w.doi);
      const sig = openAlexSignal(w);
      if (doi && sig) openalexBy[doi] = sig;
    }
  })();

  const epmcCall = (async () => {
    if (!dois.length) return;
    const q = dois.map((d) => `DOI:"${d}"`).join(" OR ");
    const r = await fetchWithStatus(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&resultType=lite&pageSize=${Math.min(100, dois.length + 5)}`);
    const results = r && r.json && r.json.resultList && Array.isArray(r.json.resultList.result) ? r.json.resultList.result : [];
    const pmidToDoi = {};
    for (const row of results) {
      const doi = normalizeRetractionDoi(row && row.doi);
      if (doi && row.pmid) pmidToDoi[String(row.pmid)] = doi;
    }
    const pmids = Object.keys(pmidToDoi);
    if (!pmids.length) return;
    const s = await fetchWithStatus(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmids.join(",")}&retmode=json`);
    const result = s && s.json && s.json.result && typeof s.json.result === "object" ? s.json.result : {};
    for (const pmid of pmids) {
      const sig = pubmedSignal(result[pmid]);
      if (sig) epmcBy[pmidToDoi[pmid]] = sig;
    }
  })();

  await Promise.allSettled([...crossrefCalls, openalexCall, epmcCall]);

  return list.map((entry) => {
    const doi = entry && entry.doi ? entry.doi : null;
    const line = entry && entry.line ? entry.line : "";
    if (!doi) {
      return { line, doi: null, resolves: false, meta: null, verdict: null, status: "unresolved" };
    }
    const cx = crossrefBy[doi] || { resolves: null, meta: null, notices: null };
    const verdict = combineRetractionSignals({
      crossref: cx.notices != null ? { notices: cx.notices } : null,
      europepmc: epmcBy[doi] || null,
      openalex: openalexBy[doi] || null,
    });
    let status;
    if (cx.resolves === false) status = "unresolved";
    else if (cx.resolves === true) status = refCheckStatus({ doi, resolves: true, verdict });
    else if (verdict.status === "retracted" || verdict.status === "reported" || verdict.status === "concern" || verdict.status === "corrected") status = verdict.status;
    else status = "unknown";
    return { line, doi, resolves: cx.resolves, meta: cx.meta, verdict, status };
  });
}
