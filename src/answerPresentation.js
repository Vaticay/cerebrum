/**
 * answerPresentation.js — shared presentation rules for an answer as an
 * argument (2026-10-23, Wave 3 Lane S7, logic audit Stage 7).
 *
 * Pure helpers, no React, no browser APIs, so the client, the PDF and
 * print paths, and the node tests all read the same definitions:
 *
 *   L7-4  one section label list and one glued heading splitter
 *   L7-6  the cited and further reading partition of a source list
 *   L7-7  the answer's own sections, in its own order, as plain text
 *   L7-8  one synthesisMode byline mapping for every surface
 *   L7-11 every derived statistic carries the name of its set
 *   L7-17 one title renderer: full, or word boundary truncation
 *   L7-18 the one approved absence phrasing for the gap finder
 *   L7-19 one coverage count: indexes that answered, not attempted
 *   L7-3  the shipped confidence invariant checker (band table)
 *
 * Copy in this file carries no dash characters, per the standing rule.
 */

/* L7-4 (2026-10-23): the section labels the synthesis is asked to use.
   This list mirrors the client's SECTION_LABELS in CerebrumApp.jsx and
   the server list in functions/api/search.js; all three must stay the
   same list, because binder, stripper, renderer and exporter all split
   glued headings through it. */
export const SECTION_LABELS = [
  "Summary", "The short answer", "What the research shows", "Where researchers disagree",
  "Where the studies disagree", "How solid is this", "What this does not establish",
  "What would change this", "Core synthesis", "Evidence and mechanisms", "Divergent findings and gaps",
  "Methodological confidence", "Key evidence", "What we know", "Bottom line",
  "What changed", "Limitations", "Methods",
];

const HEADING_MAX = 70;

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Split a heading line that carries glued body text after a known
   section label. Returns { head, body }; head is empty when the line
   is not a known label carrying body text. */
export function splitGluedHeadingText(line) {
  const t = String(line == null ? "" : line).trim();
  if (!t) return { head: "", body: "" };
  if (t.length <= HEADING_MAX) return { head: t, body: "" };
  for (const label of SECTION_LABELS) {
    const re = new RegExp("^" + escapeRe(label) + "\\b[\\s:.?\u2014-]*", "i");
    const m = t.match(re);
    if (m) {
      const body = t.slice(m[0].length).trim();
      if (body) return { head: label, body };
    }
  }
  return { head: "", body: t };
}

/* The answer's own sections in its own order (L7-7, 2026-10-23).
   A glued heading contributes its label as the heading and its glued
   remainder as the first body line, so no section text is dropped.
   Returns [{ heading, lines }] with a null heading for the preamble. */
export function answerSectionsInOrder(answer) {
  const sections = [];
  let cur = { heading: null, lines: [] };
  for (const raw of String(answer || "").split("\n")) {
    const hm = raw.match(/^#{1,3}\s+(.*)$/);
    if (hm) {
      sections.push(cur);
      const split = splitGluedHeadingText(hm[1].trim());
      if (split.head && split.body) {
        cur = { heading: split.head, lines: [split.body] };
      } else {
        cur = { heading: hm[1].trim(), lines: [] };
      }
    } else {
      cur.lines.push(raw);
    }
  }
  sections.push(cur);
  return sections;
}

/* Plain text of a markdown fragment: style markers removed, spacing
   from the source text preserved exactly (L7-10 class, 2026-10-23).
   Exporters carry this text; they never retokenise it. */
export function plainTextOf(text) {
  return String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\W)\*([^*\n]+)\*/g, "$1$2")
    .replace(/_([^_\n]+)_/g, "$1");
}

export function answerPlainTextPreserved(answer) {
  const parts = [];
  for (const sec of answerSectionsInOrder(answer)) {
    if (sec.heading) parts.push(plainTextOf(sec.heading));
    for (const ln of sec.lines) parts.push(plainTextOf(ln));
  }
  return parts.join("\n").replace(/[ \t]+\n/g, "\n").trim();
}

export const whitespaceNormalised = (s) => String(s || "").replace(/\s+/g, " ").trim();

/* L7-6 (2026-10-23): the cited and further reading partition. A source
   flagged uncited is further reading on every surface, never evidence
   the answer rests on. */
export function partitionSources(sources) {
  const list = Array.isArray(sources) ? sources : [];
  const cited = [];
  const further = [];
  list.forEach((s, i) => {
    const entry = { source: s, index: i + 1 };
    if (s && s.uncited) further.push(entry);
    else cited.push(entry);
  });
  return { cited, further, total: list.length };
}

export function sourceCountsLabel(sources) {
  const { cited, further } = partitionSources(sources);
  let label = `${cited.length} cited paper${cited.length === 1 ? "" : "s"}`;
  if (further.length > 0) label += ` · ${further.length} further reading`;
  return label;
}

/* L7-8 and L7-11 (2026-10-23): one synthesisMode mapping. Every export
   and print byline and framing sentence comes from here, the same
   mapping the on screen byline uses. Unrecorded modes default to the
   weakest wording, which claims no synthesis at all. */
export function synthesisByline(mode) {
  switch (mode) {
    case "ai":
      return { tag: "AI synthesized", byline: "Synthesized by Cerebrum", framing: "Written by AI from the cited papers." };
    case "extractive":
      return { tag: "Drafted from sources", byline: "Drafted from sources", framing: "Assembled from the cited papers. No AI synthesis ran for this answer." };
    case "none":
      return { tag: "Synthesis unavailable", byline: "Synthesis unavailable", framing: "No AI synthesis ran for this answer." };
    default:
      return { tag: "Generated by Cerebrum", byline: "Generated by Cerebrum", framing: "How this answer was produced was not recorded." };
  }
}

/* L7-11 (2026-10-23): statistics over a named set only. The set name
   prints beside the numbers, so a reader can tell which papers the
   years, journals and citation total were computed over. */
export function namedSetStats(entries, setName) {
  const list = Array.isArray(entries) ? entries : [];
  const years = list.map((e) => Number(e.source && e.source.year)).filter((y) => y > 1500);
  const journals = new Set(list.map((e) => String((e.source && e.source.journal) || "").trim()).filter(Boolean));
  const citations = list.reduce((sum, e) => sum + (Number(e.source && e.source.citations) || 0), 0);
  return {
    setName,
    count: list.length,
    earliestYear: years.length ? Math.min(...years) : null,
    latestYear: years.length ? Math.max(...years) : null,
    journalCount: journals.size,
    combinedCitations: citations,
  };
}

export function describeNamedSetStats(stats) {
  if (!stats || stats.count === 0) return `No papers in the ${stats ? stats.setName : "named"} set.`;
  const bits = [`${stats.count} paper${stats.count === 1 ? "" : "s"} in the ${stats.setName} set`];
  if (stats.earliestYear !== null && stats.latestYear !== null) {
    bits.push(stats.earliestYear === stats.latestYear ? `from ${stats.earliestYear}` : `from ${stats.earliestYear} to ${stats.latestYear}`);
  }
  if (stats.journalCount > 0) bits.push(`across ${stats.journalCount} journal${stats.journalCount === 1 ? "" : "s"}`);
  bits.push(`with ${stats.combinedCitations} combined citations in that set`);
  return bits.join(", ") + ".";
}

/* L7-19 (2026-10-23): one coverage count. Only indexes whose entry is
   marked ok answered; attempted indexes that failed never count as
   retrieval sources. */
export function indexesAnswered(sourcesQueried) {
  const list = Array.isArray(sourcesQueried) ? sourcesQueried : [];
  return { attempted: list.length, answered: list.filter((x) => x && x.ok).length };
}

export function indexesSentence(sourcesQueried) {
  const { attempted, answered } = indexesAnswered(sourcesQueried);
  if (attempted === 0) return "";
  return `from ${answered} of ${attempted} indexes`;
}

/* L7-17 (2026-10-23): one title renderer. Full title, or truncation at
   a word boundary with an ellipsis marker. Never a mid word cut. */
export function renderTitleText(title, max = 120) {
  const s = String(title || "Untitled").replace(/\s+/g, " ").trim() || "Untitled";
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > 40 ? cut.slice(0, sp) : cut).trim() + "\u2026";
}

export function normalizedTitleKey(title) {
  return String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function dedupeByTitle(items, titleOf) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const key = normalizedTitleKey(titleOf ? titleOf(item) : item);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(item);
  }
  return out;
}

/* L7-18 (2026-10-23): the one approved absence phrasing for the gap
   finder. It states what the checks did, never what the literature is. */
export const NO_GAPS_PHRASE = "No gaps were detected by these checks.";

/* L7-9 (2026-10-23): the only disagreement status words a client
   surface may display are the ones the server ships. */
export const DISAGREEMENT_STATUS_WORDS = ["divided", "settled", "thin"];

export function disagreementKicker(verdict) {
  if (!verdict || !DISAGREEMENT_STATUS_WORDS.includes(verdict.status)) return "No verdict";
  return verdict.status.toUpperCase();
}

/* L7-3 (2026-10-23): the shipped answer invariant. The level word may
   never contradict the support fraction printed in the same line.
   Band table: a fraction below one half may carry at most thin; a
   fraction below one may carry at most moderate; a full fraction may
   carry any level. This checker is the client side surface for the
   band repair that ships server side in buildConfidenceLine. */
export const CONFIDENCE_BANDS = [
  { maxFractionExclusive: 0.5, maxLevel: "thin" },
  { maxFractionExclusive: 1, maxLevel: "moderate" },
  { maxFractionExclusive: Infinity, maxLevel: "strong" },
];
const LEVEL_RANK = { thin: 0, moderate: 1, strong: 2 };

export function confidenceInvariant(confidence) {
  if (!confidence || typeof confidence !== "object") return { ok: true, reason: "no confidence object" };
  const level = confidence.level;
  const line = String(confidence.line || "");
  const m = line.match(/supports\s+(\d+)\s+of\s+(\d+)\s+checked claims?/i);
  if (!m || !(level in LEVEL_RANK)) return { ok: true, reason: "no support fraction in the line" };
  const supported = Number(m[1]);
  const checked = Number(m[2]);
  if (checked <= 0) return { ok: true, reason: "no checked claims" };
  const fraction = supported / checked;
  const band = CONFIDENCE_BANDS.find((b) => fraction < b.maxFractionExclusive) || CONFIDENCE_BANDS[CONFIDENCE_BANDS.length - 1];
  const ok = LEVEL_RANK[level] <= LEVEL_RANK[band.maxLevel];
  return {
    ok,
    reason: ok
      ? `level ${level} fits support ${supported} of ${checked}`
      : `level ${level} contradicts support ${supported} of ${checked}; the band allows at most ${band.maxLevel}`,
    fraction,
    maxLevel: band.maxLevel,
  };
}
