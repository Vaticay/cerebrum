/**
 * textUtils.js — pure text, citation, and formatting utilities.
 *
 * Extracted from CerebrumApp.jsx (monolith split, 2026-10-07).
 * No React state, no DOM, no side effects (except React.createElement in
 * renderCleanTitle). Safe to import anywhere, including tests.
 */

import React from "react";

/* Pass 6: Zotero failures reach the user as plain sentences, never a raw
   fetch/HTTP error string. Shared by the evidence view's inline form and
   the conversation-level send. */
export function zoteroErrorMessage(e) {
  const raw = String(e && e.message || "");
  if (/401|403|forbidden|unauthorized/i.test(raw)) return "That API key or user ID looks wrong: double-check them in your Zotero account settings.";
  if (/network|fetch|failed to fetch/i.test(raw)) return "Couldn't reach Zotero. Check your connection and try again.";
  return "Couldn't save to Zotero right now. Try again in a moment.";
}
// Paper metadata (title, authors, journal) comes from external scholarly APIs
// — several of which (Zenodo, DOAJ, CORE, BASE, OpenAIRE) index self-deposited
// records with no HTML sanitization on the backend. Any of those fields can
// contain raw markup. This MUST be applied before anything derived from them
// is passed to dangerouslySetInnerHTML, or a maliciously-titled "paper" could
// run arbitrary script in every visitor's browser on this origin.
export function escapeHtml(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Upstream entities can still reach the answer body itself: the model copies
// strings like "&#x2009;" verbatim out of source abstracts into its prose.
// Decoded at render so readers never see raw entities. Rendered as React
// text children (never innerHTML), so decoding cannot introduce markup.
export const HTML_NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", thinsp: " ", ensp: " ", emsp: " ",
  ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  trade: "™", reg: "®", copy: "©", deg: "°",
};
export function decodeHtmlEntities(s) {
  return String(s == null ? "" : s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, ent) => {
    if (ent[0] === "#") {
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code < 0x110000) {
        try { return String.fromCodePoint(code); } catch { return m; }
      }
      return m;
    }
    const named = HTML_NAMED_ENTITIES[ent.toLowerCase()];
    return named !== undefined ? named : m;
  });
}

// v33: some upstream scholarly metadata (Crossref/PubMed/OpenAlex title
// fields, in particular) carries basic HTML formatting for chemical
// formulas and species/genus names — "CO<sub>2</sub> capture", "<i>E.
// coli</i> biofilms". Every title in this app rendered as a plain React
// text child, which is safe (React auto-escapes string children) but shows
// the literal tag characters to the reader instead of the subscript/italic
// they're meant to convey — the "<sub>0.5</sub>" bug this fixes. The fix is
// deliberately NOT dangerouslySetInnerHTML on raw title text — that would
// hand an upstream API this app doesn't control a way to run arbitrary
// HTML/script in every visitor's browser. Instead this parses ONLY four
// whitelisted, well-known-safe formatting tags into real React elements;
// everything else in the string — including any other tag-like substring —
// is emitted as a plain string segment, which React renders as an inert
// text node exactly like before, never as markup.
export const TITLE_SAFE_TAG_RE = /<(sub|sup|i|b)>([^<]*)<\/\1>/gi;
export function renderCleanTitle(raw) {
  const title = raw || "";
  if (!/<(sub|sup|i|b)>/i.test(title)) return title;
  const parts = [];
  let last = 0, m, key = 0;
  TITLE_SAFE_TAG_RE.lastIndex = 0;
  while ((m = TITLE_SAFE_TAG_RE.exec(title))) {
    if (m.index > last) parts.push(title.slice(last, m.index));
    parts.push(React.createElement(m[1].toLowerCase(), { key: key++ }, m[2]));
    last = TITLE_SAFE_TAG_RE.lastIndex;
  }
  if (last < title.length) parts.push(title.slice(last));
  return parts;
}

/* Plain-text twin of renderCleanTitle: for aria-labels and other string
   contexts. renderCleanTitle returns an ARRAY of React nodes when safe
   tags are present, which stringifies to "[object Object]" inside a
   template literal — this strips the tags instead. */
export function cleanTitleText(raw) {
  return String(raw || "").replace(/<\/?(sub|sup|i|b)>/gi, "");
}

/* Investigation titles are the user's own raw questions — "tempretures",
   "explain the phyla in BSFL gut". Display tidies them: trim, collapse
   whitespace, capitalise the first letter. The stored value is untouched
   (rename edits the real thing), so this is presentation only, applied
   everywhere an investigation title is shown. */
export function tidyQuestionTitle(raw) {
  const t = String(raw == null ? "" : raw).trim().replace(/\s+/g, " ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

// Identity key for a source used across dedup / save / pin state. Was
// `(s.title || "").toLowerCase()` in half a dozen places — when two distinct
// sources both lack a title (not uncommon: some Zenodo/CORE/BASE records
// have no title field), they collapse to the same key "". That meant the
// second untitled source silently disappeared from dedup (bug), and toggling
// save/pin on one untitled source affected every other untitled source's
// state (bug). Falling back to `url` before giving up keeps two different
// untitled papers distinct in the overwhelmingly common case where they at
// least have different URLs.
export function sourceKey(s) {
  // DOI first when present: the backend dedupes on DOI-vs-title key
  // intersection, so the frontend key must agree or the same paper (one
  // record with a DOI, one without) accumulates as two entries in the
  // cumulative source list. Title is normalized the same way the backend
  // does (case/punctuation/whitespace-insensitive) so both ends collapse
  // the same pairs.
  if (!s) return "";
  const doi = String(s.doi || s.DOI || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase().replace(/\/+$/, "").trim().replace(/[.,;:!?)\]]+$/, "");
  if (/^10\.\d{4,9}\//.test(doi)) return "doi:" + doi;
  const t = String(s.title || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  if (t) return "title:" + t;
  return "url:" + String(s.url || "").toLowerCase().trim();
}

/* Every key a source record carries, strongest first — the frontend mirror
 * of the backend\u2019s paperDedupeKeys(). Two records are the same source
 * when ANY key intersects, which is what catches \u201cseen with DOI on one
 * turn, seen without on the next\u201d. Used by the cumulative source
 * accumulator; sourceKey() (single strongest key) remains for save/pin
 * identity. */
export function sourceKeys(s) {
  const keys = [];
  const push = (k) => { if (k && !keys.includes(k)) keys.push(k); };
  if (s) {
    const doi = String(s.doi || s.DOI || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase().replace(/\/+$/, "").trim().replace(/[.,;:!?)\]]+$/, "");
    if (/^10\.\d{4,9}\//.test(doi)) push("doi:" + doi);
    const t = String(s.title || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
    if (t) push("title:" + t);
    const u = String(s.url || "").toLowerCase().trim();
    if (u) push("url:" + u);
  }
  return keys.length ? keys : [""];
}

// Only allow http(s) URLs into href/target=_blank. Paper URLs come from
// external, self-deposited scholarly metadata (Zenodo, DOAJ, CORE, BASE,
// OpenAIRE) with no guarantee they're sane — a "javascript:" or "data:" URL
// in that field would execute when clicked. Defense in depth alongside the
// HTML-escaping fix in BibEntry.
export function safeHref(url) {
  const u = (url || "").trim();
  return /^https?:\/\//i.test(u) ? u : "#";
}

/* Pass 4 — plain-text export helper. Answers are stored as markdown; the
   TXT export needs readable prose, not fences and hashes. This strips the
   common constructs (fences, headings, emphasis, links, list markers) and
   leaves everything else verbatim — it never invents or reorders content. */
export function stripMarkdown(md) {
  return String(md || "")
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ""))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Every video object search.js/videos.js hands back already carries a
// pre-validated 11-character id (see videos.js's YT_ID_RE check on the
// piped/invidious path) — prefer that directly and only fall back to
// parsing it out of the stored watch/shorts/youtu.be URL for anything
// older or from a path that didn't set `id`. Returns null rather than a
// guess when nothing usable is found, so a caller never embeds garbage.
export const YT_ID_RE = /^[\w-]{11}$/;
export function getYouTubeId(v) {
  if (v && v.id && YT_ID_RE.test(v.id)) return v.id;
  const url = (v && v.url) || "";
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/);
  return m ? m[1] : null;
}

/* Journal-name display casing.
   Venue names arrive from a dozen APIs with a dozen casings — "Frontiers
   in Genome Editing" from one, "frontiers in genome editing" from
   another. An all-lowercase venue in a citation list reads as a data bug
   even when the paper is real, so normalize the unambiguous cases:
   all-lowercase (or all-uppercase) names get title-cased with small words
   kept low. Anything already mixed-case ("Nature", "eLife", "PLOS ONE")
   is trusted as-is — the API knew better than we do. A short dictionary
   pins the stylings title-casing would mangle. */
export const JOURNAL_STYLE = {
  "plos one": "PLOS ONE", "pnas": "PNAS", "jama": "JAMA", "bmj": "BMJ",
  "elife": "eLife", "peerj": "PeerJ", "biorxiv": "bioRxiv",
  "medrxiv": "medRxiv", "arxiv": "arXiv", "f1000research": "F1000Research",
  "ssrn": "SSRN",
};
export const JOURNAL_SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "per", "the", "to", "v", "v.", "via", "vs", "vs."]);
/* Names that are indexes, aggregators, or repositories — not publication
   venues. They arrive in the journal slot when an API has no real venue
   (a `publisher` of "eScholarship, University of California", a bare
   "CORE"), and rendering them as the venue misleads. Drop them; every
   display site already handles an empty venue gracefully. */
export const JOURNAL_DENYLIST = new Set([
  "core", "base", "openaire", "openalex", "semantic scholar", "crossref",
  "europe pmc", "europepmc", "pubmed", "pmc", "doaj", "web",
  "escholarship", "escholarship, university of california",
]);
export function formatJournalName(raw) {
  const j = String(raw || "").trim();
  if (!j) return j;
  const low = j.toLowerCase().replace(/\s+/g, " ");
  if (JOURNAL_DENYLIST.has(low)) return "";
  if (/[a-z]/.test(j) && /[A-Z]/.test(j)) return j; // already cased: trust it
  if (JOURNAL_STYLE[low]) return JOURNAL_STYLE[low];
  if (low.startsWith("plos ")) return "PLOS " + low.slice(5).replace(/\b\w/g, (c) => c.toUpperCase());
  if (low.startsWith("ieee ")) return "IEEE " + formatJournalName(low.slice(5));
  return low.split(/\s+/).map((w, i) =>
    (i > 0 && JOURNAL_SMALL_WORDS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)
  ).join(" ");
}
/* Citation counts are a quality signal with a shelf life. "0 citations"
   on a paper published this year is expected, not informative — but on a
   ten-year-old paper it is a genuine red flag, and distinct from a count
   the APIs never returned. So: positive counts always show; an honest
   zero shows only when the paper is old enough that zero means something;
   otherwise nothing renders, and unknown stays unknown. */
export function formatCitationCount(citations, year, noun) {
  if (typeof citations !== "number" || citations < 0) return "";
  if (citations > 0) return `${citations.toLocaleString()} ${noun}${citations === 1 ? "" : "s"}`;
  const y = parseInt(year, 10);
  if (y && y <= new Date().getFullYear() - 2) return `0 ${noun}s`;
  return "";
}
export function formatCitation(source, style, index) {
  const s = source || {};
  const authors = s.authors || "";
  const title = s.title || "Untitled";
  const journal = formatJournalName(s.journal || "");
  const year = s.year || "n.d.";
  const url = s.url || "";
  // v28 fix: every style below used to unconditionally append ". " after
  // `authors` — fine when authors is a plain name list ("Smith J, Doe A"),
  // but the backend's own authors string sometimes already ends in "et
  // al." (already period-terminated), so blindly appending another "."
  // produced "et al.." — a real, visible double-period, not a one-off.
  // Trim first, then only add a period if one isn't already there.
  const authorsPart = (() => {
    const a = authors.trim();
    if (!a) return "";
    return (a.endsWith(".") ? a : a + ".") + " ";
  })();
  /* Commit 95 — the same double period, one field over.
     v28 fixed it for the author string and stopped there. Titles have
     exactly the same problem and it is far more visible: PubMed ships a
     great many titles already terminated with a full stop ("...Gut
     Microbiome Functions."), and every style below appends its own, so
     real bibliographies were rendering "Functions.." on most entries.
     Same treatment, applied to the two fields that can arrive
     pre-terminated. */
  const endPunct = (v) => {
    const t = String(v || "").trim();
    if (!t) return t;
    return /[.!?]$/.test(t) ? t : t + ".";
  };
  const titleDot = endPunct(title);
  const journalDot = endPunct(journal);
  switch (style) {
    case "vancouver": {
      const parts = [`${index}. ${authorsPart}${titleDot}`];
      if (journal) parts.push(` ${journalDot}`);
      parts.push(` ${year}.`);
      return parts.join("");
    }
    case "apa": {
      return `${authorsPart}(${year}). ${titleDot} ${journal ? "*" + journal + "*." : ""}`.trim();
    }
    case "mla": {
      return `${authorsPart}"${titleDot}" *${journal || "n.p."}*, ${year}${url ? ", " + url : ""}.`;
    }
    case "chicago": {
      return `${authorsPart}${year}. "${titleDot}" *${journal || "n.p."}*.`;
    }
    case "bibtex": {
      // Bug: this built the key from `year`, which defaults to the literal
      // string "n.d." above, producing a malformed key like "cerebrumn.d._1"
      // (periods aren't valid in a BibTeX citekey). The OTHER BibTeX
      // generator in this file, toBibTeX() above, already gets this right —
      // `cerebrum${s.year || ""}_${i+1}` — so the two exports disagreed for
      // any undated source. Match that convention here.
      const key = "cerebrum" + (s.year || "") + "_" + index;
      const fields = [];
      if (authors) fields.push(`  author = {${authors}}`);
      if (title) fields.push(`  title = {${title}}`);
      if (journal) fields.push(`  journal = {${journal}}`);
      if (year && year !== "n.d.") fields.push(`  year = {${year}}`);
      if (url) fields.push(`  url = {${url}}`);
      return `@article{${key},\n${fields.join(",\n")}\n}`;
    }
    default:
      return `${index}. ${authors} ${titleDot} ${journal} ${year}.`;
  }
}

export function formatBibliography(sources, style) {
  return (sources || [])
    .map((s, i) => formatCitation(s, style, i + 1))
    .join(style === "bibtex" ? "\n\n" : "\n\n");
}
