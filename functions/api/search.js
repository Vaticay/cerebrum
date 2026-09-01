// Cerebrum backend - Cloudflare Pages Function.
// Full rewrite for stability. Queries 14 scholarly databases in parallel,
// races video proxies, synthesizes answers with sanitization.

// Domain-knowledge module: controlled-vocabulary query expansion, evidence-
// hierarchy classification, journal-quality signals, predatory-publisher
// detection, and deterministic entity extraction. See functions/lib/knowledge.js
// for the full rationale — kept as a separate module because it's almost
// entirely reference data, not orchestration logic, and grows independently
// of how search.js fetches/merges/ranks.
import {
  expandViaMesh,
  classifyStudyType,
  scoreJournalTier,
  predatoryPenalty,
  extractEntities,
  classifyResearchIntent,
  intentEvidenceBonus,
  detectStatisticalRigor,
  verifyAnswerAgainstSources,
} from "../lib/knowledge.js";
import { checkRateLimit } from "../lib/rateLimit.js";

// ============ CORE UTILITIES ============

function stripTags(s) {
  return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function decodeInverted(inv) {
  if (!inv) return "";
  const words = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) words[p] = word;
  }
  return words.join(" ").replace(/\s+/g, " ").trim();
}

// Canonical dedup key for a paper. Prefer the DOI — extracted from `url`,
// which every source stores as "https://doi.org/<doi>" — because DOI is
// authoritative: two different source APIs (e.g. Crossref and OpenAlex) can
// return the EXACT same work with slightly different title strings (a
// trailing period, a subtitle, whitespace or HTML-entity differences), and a
// plain normalized-title dedup misses that, letting the same paper appear
// twice in the final bibliography under two different citation numbers.
// Falls back to a normalized title (lowercased, whitespace-collapsed,
// trailing punctuation stripped) only when no DOI is present.
function paperDedupeKey(p) {
  const url = (p && p.url) || "";
  // DOI is the strongest unique identifier
  const doiMatch = url.match(/doi\.org\/(.+)$/i);
  if (doiMatch && doiMatch[1]) {
    return "doi:" + doiMatch[1].toLowerCase().replace(/\/+$/, "").trim();
  }
  // PMID from PubMed/Europe PMC URLs is a strong secondary identifier
  const pmidMatch = url.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i) ||
                    url.match(/europepmc\.org\/article\/med\/(\d+)/i);
  if (pmidMatch && pmidMatch[1]) {
    return "pmid:" + pmidMatch[1];
  }
  // PMC IDs
  const pmcMatch = url.match(/ncbi\.nlm\.nih\.gov\/pmc\/articles\/(PMC\d+)/i);
  if (pmcMatch && pmcMatch[1]) {
    return "pmc:" + pmcMatch[1].toLowerCase();
  }
  // arXiv IDs
  const arxivMatch = url.match(/arxiv\.org\/abs\/([\d.]+)/i);
  if (arxivMatch && arxivMatch[1]) {
    return "arxiv:" + arxivMatch[1];
  }
  // Normalized title fallback
  const title = ((p && p.title) || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/, "");
  return title ? "title:" + title : "";
}

// v34: a raw wwPDB structure deposit got synthesized into an answer and cited
// with the same weight as a peer-reviewed paper — a real, reported failure,
// not a hypothetical one. Every per-source fetcher above now asks its own API
// to exclude datasets up front (OpenAlex's `filter`, Crossref's `filter`,
// Semantic Scholar's `publicationTypes`), but an upstream filter silently
// failing, changing shape, or simply not existing for a given source (DOAJ,
// PLOS, CORE, BASE, openAIRE, PMC full text, Zenodo, the raw PubMed path...)
// must never be the ONLY thing standing between a dataset record and the
// sidebar. This is the single choke point every paper from every source
// passes through, right after dedup, regardless of which fetcher produced it
// or whether that fetcher's own filter worked. Two independent signals are
// checked because either one alone can be wrong: a source's own `_rawType`
// can be missing/blank for a real paper (checking type alone would produce
// false negatives that let junk through), while a URL substring alone could
// theoretically collide with an unrelated domain (checking URL alone risks a
// false positive) — requiring neither be BOTH present keeps this a pure
// reject list, never a stricter allowlist that could accidentally exclude a
// legitimate paper this file doesn't know how to positively recognize.
// Exported so the blocklist itself is inspectable/testable from outside this
// module, not just the filter function it feeds. osf.io hosts both genuine
// preprints and non-paper project artifacts (data, code, protocols) under the
// same domain, so it's blocked wholesale; clinicaltrials.gov is a trial
// *registry* entry, not a published result; data.mendeley.com is Mendeley's
// dataset repository, a distinct product from the Mendeley reference manager
// and not covered by the plain "mendeley" substring on purpose (that would
// over-block). "posted-content" is Crossref's own type label for preprints/
// conference content — already covered by this project's dedicated
// biorxiv/medrxiv fetchers, so excluding the Crossref-typed duplicates here
// costs nothing real. "peer-review" is Crossref's type for a standalone
// review report (e.g. an F1000-style open review), not the paper it reviews.
// "grant" is funding-record metadata that sometimes rides along in these
// APIs — never an actual publication.
export const BLOCKED_DOMAINS = ["wwpdb.org", "zenodo", "dryad", "figshare", "osf.io", "clinicaltrials.gov", "data.mendeley.com"];
export const BLOCKED_TYPES = ["dataset", "component", "posted-content", "peer-review", "grant"];
function isNonLiterature(p) {
  const url = ((p && p.url) || "").toLowerCase();
  if (BLOCKED_DOMAINS.some((m) => url.includes(m))) return true;
  // `_rawType` is the machine-readable type a fetcher captured straight off
  // its API (e.g. OpenAlex's "dataset", Crossref's "component", Semantic
  // Scholar's "Dataset" inside its publicationTypes array) — check it as a
  // whole-word match so "dataset" doesn't also swallow an unrelated type
  // string that merely contains those letters as a substring.
  const rawType = ((p && p._rawType) || "").toLowerCase();
  if (rawType && BLOCKED_TYPES.some((m) => new RegExp("\\b" + m + "\\b").test(rawType))) return true;
  // Some code paths (see the two display-only classifiers elsewhere in this
  // file) already compute a human-facing `p.type` of "Dataset" from journal
  // name patterns before this filter ever runs on them again later (e.g. a
  // cached/re-scored record). Honor that too rather than only trusting the
  // freshly-fetched `_rawType`.
  if ((p && p.type || "").toLowerCase() === "dataset") return true;
  return false;
}

// v6.4: D1's answer_cache and paper_cache tables key rows off the literal
// normalized query text, with NO awareness that the retrieval/filtering
// pipeline itself changes over time. That made the caches "immune" to
// bugfixes: a query that once returned a wrong-topic paper (e.g. an
// off-field maize genomics paper cited for an insect-microbiome question)
// would have that paper permanently written into paper_cache as a
// "confirmed" result and force-re-injected at max relevance on every future
// identical query, FOREVER — completely independent of how good the live
// retrieval/filtering logic later became. Re-asking "the same thing" kept
// reproducing the exact same bad paper even after the underlying filters
// were fixed, because the fix never touched already-cached/learned rows.
//
// Fix: fold a schema version into the cache key itself. Bump
// CACHE_SCHEMA_VERSION any time the retrieval, filtering, or paper-learning
// logic changes in a way that could change which papers/answers are
// correct — old rows simply stop matching (they're never deleted, just
// orphaned) and every query starts learning fresh under the new pipeline.
const CACHE_SCHEMA_VERSION = "v7";
function versionedCacheKey(rawQuery) {
  return (
    CACHE_SCHEMA_VERSION +
    "::" +
    (rawQuery || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

// Standard headers every outbound request should carry. Several free scholarly
// APIs (Crossref, OpenAlex, Europe PMC) route "polite" traffic — identifiable
// requests with a User-Agent and mailto — to a faster, higher-quota pool than
// anonymous ones. Anonymous requests can be silently deprioritized or rate-
// limited to unusable levels. This alone can be the difference between "zero
// papers" and "papers returned".
const POLITE_UA =
  "Cerebrum/1.0 (askcerebrum.org; a free scientific literature search; mailto:contact@askcerebrum.org)";

// v37: default lowered from 6500ms — with `retries = 1`, a single slow
// source could cost up to 2x this before giving up (one attempt, one
// retry), and every rung in gatherPapers()'s ladder waits on the SLOWEST
// source in that rung via Promise.allSettled. 4000ms still gives a normal
// scholarly API response plenty of room; it just stops one sluggish source
// from setting the pace for an entire rung. Call sites that already pass
// their own explicit timeout (a few sources needed more headroom, tuned in
// an earlier round) are untouched — this only changes the shared default.
async function getJSON(url, headers = {}, timeoutMs = 4000, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": POLITE_UA, Accept: "application/json", ...headers },
        signal: c.signal,
        cf: { cacheTtl: 60, cacheEverything: true },
      });
      clearTimeout(t);
      if (res.status === 429) { await res.text().catch(() => {}); throw new Error("HTTP 429 rate-limited"); }
      // Retry on 502/503/504 — transient upstream failures that often self-heal
      if (res.status >= 502 && res.status <= 504 && attempt < retries) {
        await res.text().catch(() => {});
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      // Draining a response body we're about to discard isn't optional
      // cleanup — workerd tracks unconsumed streams per isolate, and this
      // helper alone fans out to five-plus scholarly APIs per search, every
      // one of which can 429/403/500. Abandoning those bodies unread has a
      // real, documented failure mode (a "stalled HTTP response... canceled
      // to prevent deadlock" warning from the runtime); it doesn't have a
      // literal "6 connections" ceiling or a fixed freeze duration the way
      // it's sometimes described, but consuming-or-discarding every body
      // before throwing is real defensive practice for a fan-out this wide.
      if (!res.ok) { await res.text().catch(() => {}); throw new Error("HTTP " + res.status); }
      return res.json();
    } catch (e) {
      clearTimeout(t);
      // Retry on abort (timeout) if we have attempts left
      if (attempt < retries && (e.name === "AbortError" || (e.message && e.message.includes("502")))) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

async function getText(url, headers = {}, timeoutMs = 4000, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": POLITE_UA, ...headers },
        signal: c.signal,
        cf: { cacheTtl: 60, cacheEverything: true },
      });
      clearTimeout(t);
      if (res.status === 429) { await res.text().catch(() => {}); throw new Error("HTTP 429 rate-limited"); }
      if (res.status >= 502 && res.status <= 504 && attempt < retries) {
        await res.text().catch(() => {});
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      if (!res.ok) { await res.text().catch(() => {}); throw new Error("HTTP " + res.status); }
      return res.text();
    } catch (e) {
      clearTimeout(t);
      if (attempt < retries && (e.name === "AbortError" || (e.message && e.message.includes("502")))) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}


// Check if a DOI has been retracted or has expressions of concern.
// Uses Crossref's crossmark data, which is authoritative. Keyless.
// Returns { retracted: bool, concern: bool, updateType: string|null }.
async function checkRetraction(doi) {
  if (!doi) return { retracted: false, concern: false, updateType: null };
  try {
    const clean = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
    const res = await getJSON(
      "https://api.crossref.org/works/" + encodeURIComponent(clean),
      {},
      2500
    );
    const msg = res && res.message;
    if (!msg) return { retracted: false, concern: false, updateType: null };
    // Crossref uses `update-to` to indicate this work has been retracted/corrected
    const updates = msg["update-to"] || [];
    let retracted = false, concern = false, updateType = null;
    for (const u of updates) {
      const t = (u.type || "").toLowerCase();
      if (t.includes("retract")) { retracted = true; updateType = "retraction"; }
      else if (t.includes("concern")) { concern = true; updateType = updateType || "expression-of-concern"; }
      else if (t.includes("correct")) { updateType = updateType || "correction"; }
    }
    return { retracted, concern, updateType };
  } catch {
    return { retracted: false, concern: false, updateType: null };
  }
}

// Flag the top N papers with retraction/concern status. Runs in parallel with a
// short timeout so it never blocks the answer. Papers without a DOI are skipped.
async function flagRetractions(papers, topN = 8) {
  const targets = papers.slice(0, topN).filter((p) => {
    const doi = extractDoi(p.url);
    return !!doi;
  });
  await Promise.allSettled(targets.map(async (p) => {
    const doi = extractDoi(p.url);
    const flag = await checkRetraction(doi);
    if (flag.retracted) p.retracted = true;
    if (flag.concern) p.concern = true;
    if (flag.updateType) p.updateType = flag.updateType;
  }));
}

function extractDoi(url) {
  if (!url) return "";
  const m = url.match(/10\.\d{4,9}\/[^\s#?]+/);
  return m ? m[0] : "";
}

// ============ AI RESPONSE CLEANER ============
// Strips chain-of-thought leakage, meta-monologues, and robotic openings.
// When we have NO sources, the model sometimes invents a full reference list
// anyway — prompt instructions are not a reliable guard against this. This
// strips every citation artifact mechanically so a fabricated bibliography can
// never reach the user. Also used to remove citations that point past the end
// of a real source list (e.g. the model writes [7] when only 4 sources exist).
function stripFabricatedCitations(text, sourceCount) {
  if (!text) return text;
  let t = text;

  // 0. Normalize Markdown-link citations back to bare brackets so downstream
  //    logic sees `[1]` not `[1](#ref-1)`.
  t = t.replace(/\[(\d+)\]\((?:https?:\/\/|#)[^\s)]+\)/g, "[$1]");

  // 0a. REMOVED — this used to try to catch a model writing "networks 12"
  //     instead of "networks [1][2]" (adjacent citation numbers merged into
  //     plain digits with no brackets). It never actually caught that: the
  //     real failure mode has NO space between the word and the digits
  //     ("networks12"), but this regex required `\s+` (at least one space)
  //     to match at all — so in practice it only ever fired on ordinary
  //     numbers in ordinary prose, silently mangling real data in every
  //     answer that stated a temperature, dose, sample size, or duration:
  //     "reared at 27 degrees Celsius for 14 days" became
  //     "reared at[2][7] degrees Celsius for[1][4] days" whenever both
  //     numbers happened to be ≤ the source count. Pure harm, zero benefit,
  //     confirmed by direct testing — removed rather than "fixed" because
  //     there's no way to distinguish a genuinely merged citation-digit
  //     artifact from an ordinary number without far more context than a
  //     regex has here, and the failure mode it targeted has never actually
  //     been observed doing what the comment describes.

  // 0b. Strip any "References:" / "Sources:" / "Bibliography:" section the
  //     model appended, regardless of sourceCount. We render the real
  //     bibliography separately from the answer, so ANY inline references
  //     block the model writes is either a duplicate (when it matches) or a
  //     fabrication (when it doesn't) — either way, remove it.
  t = t.replace(/\n[-—]{2,}\s*\n/g, "\n\n");
  t = t.replace(/\n\s*(references|sources|bibliography|citations|works cited)\s*:?\s*\n[\s\S]*$/i, "").trim();

  // 0c. Headerless trailing citation block. Model writes a numbered list of
  //     citations at the bottom WITHOUT a "References:" header — just:
  //     "1 Deng, L., & Yan, W. (2012). ..."
  //     Detect lines starting with a digit and a Name-comma-Initial pattern,
  //     and strip from the first such line if it lands in the tail of the
  //     answer.
  const linesForCite = t.split(/\n/);
  const citationLineRe = /^\s*\d{1,3}\.?\s+[A-Z][A-Za-zöäüéèçñ\-']+,\s+[A-Z]\./;
  let firstCiteLine = -1;
  for (let i = 0; i < linesForCite.length; i++) {
    if (citationLineRe.test(linesForCite[i])) { firstCiteLine = i; break; }
  }
  if (firstCiteLine !== -1) {
    const cutoff = linesForCite.slice(0, firstCiteLine).join("\n").length;
    if (cutoff > t.length * 0.35) {
      t = linesForCite.slice(0, firstCiteLine).join("\n").trimEnd();
    }
  }

  // 1. Remove any trailing "References:" / "Sources:" / "Bibliography:" block.
  //    These are almost always fabricated when sourceCount is 0.
  if (sourceCount === 0) {
    t = t.replace(/\n\s*(references|sources|bibliography|citations|works cited)\s*:?[\s\S]*$/i, "");

    // 1b. Headerless bibliography. Model writes references at the end WITHOUT
    //     a "References:" header — as free-standing citation lines. Detect any
    //     line that starts with "Lastname, X. ... (YYYY)." and strip from the
    //     first such line onward if it lands in the tail of the answer.
    const lines = t.split(/\n/);
    // Match: "Lastname, A." or "Lastname, A. B." (with optional & or comma
    // authors after), then anywhere on the line a "(YYYY)." — this catches
    // APA-style entries whether the title is on the same line or a wrap.
    const apaStart = /^\s*[A-Z][A-Za-zöäüéèçñ\-']+,\s+[A-Z]\.(?:\s?[A-Z]\.)?(?:\s*,\s*(?:&|and)?\s*[A-Z][A-Za-zöäüéèçñ\-']+,\s+[A-Z]\.(?:\s?[A-Z]\.)?)*.*\(\d{4}\)/;
    let firstBibLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (apaStart.test(lines[i])) { firstBibLine = i; break; }
    }
    if (firstBibLine !== -1) {
      // Only strip if it's in the last ~third of the answer (avoid killing a
      // legitimate in-body author reference).
      const cutoffChars = lines.slice(0, firstBibLine).join("\n").length;
      if (cutoffChars > t.length * 0.4) {
        t = lines.slice(0, firstBibLine).join("\n").trimEnd();
      }
    }
  }

  // 2. Strip bracketed citation markers that have no matching source.
  t = t.replace(/\[(\d{1,3})\]/g, (m, n) => {
    const idx = parseInt(n, 10);
    if (sourceCount === 0) return "";          // nothing to cite
    if (idx < 1 || idx > sourceCount) return ""; // dangling reference
    return m;                                    // valid, keep
  });

  if (sourceCount === 0) {
    // 3. Strip author-year parentheticals: (Smith, 2020), (Smith & Jones 2019),
    //    (Smith et al., 2021). Only when we have no sources at all — with real
    //    sources these could legitimately appear inside a quoted title.
    t = t.replace(/\((?:[A-Z][A-Za-z\-']+(?:,| &| and|\set al\.?)?[\s,]*){1,4}\d{4}[a-z]?\)/g, "");

    // 3b. Strip freestanding APA-style reference lines. The model sometimes
    //     appends "Author, A. B. (2020). Title. Journal, 12(3), 45-67." at the
    //     end even with brackets forbidden. These are always fabricated when
    //     sourceCount is 0. Run iteratively so multiple back-to-back
    //     references all get removed, not just the first.
    const refPattern = /(?:[A-Z][a-zA-Z\-']+,\s+[A-Z]\.(?:\s*[A-Z]\.)*(?:,\s*(?:&\s+)?[A-Z][a-zA-Z\-']+,\s+[A-Z]\.(?:\s*[A-Z]\.)*)*)\s*\(\d{4}[a-z]?\)\.\s*[^.]{5,120}?\.(?:\s*[^.]{3,80}?,\s*\d+(?:\(\d+\))?,\s*\d+[-–]\d+\.)?/g;
    for (let pass = 0; pass < 6; pass++) {
      const before = t;
      t = t.replace(refPattern, "");
      if (t === before) break;
    }
    // "Smith et al. (2021)" style inline
    t = t.replace(/\b[A-Z][a-zA-Z\-']+\s+et\s+al\.\s*\(\d{4}[a-z]?\)/g, "");
    // Bare "According to Author (2019),"
    t = t.replace(/(?:^|\s)According to\s+[A-Z][a-zA-Z\-']+(?:\s+(?:and|&)\s+[A-Z][a-zA-Z\-']+)?\s*\(\d{4}[a-z]?\)\s*,\s*/gi, " ");

    // 4. Strip superscript-style numeric refs left dangling after words.
    // Bug: `|` has lower precedence than the surrounding group, so this used
    // to parse as three independent alternatives \u2014 `([a-z])\s*\u00b9` OR `\u00b2` OR
    // `[\u2070-\u2079]` \u2014 not "a letter followed by any superscript digit." The last
    // two alternatives matched a bare superscript character ANYWHERE with no
    // captured group, so "$1" became an empty string: "10\u00b2 cells" -> "10
    // cells" (two orders of magnitude silently lost), "E=mc\u00b2 famous
    // equation" -> "E=mc famous equation". Fixed by putting every superscript
    // character in ONE character class inside the alternative.
    t = t.replace(/([a-z])\s*[\u00b9\u00b2\u00b3\u2070-\u2079]/g, "$1");

    // 5. Strip PROSE-form invented references. With no retrieved papers the
    //    model still writes things like "a 2002 study published in the Journal
    //    of Biological Chemistry reported that..." — no brackets, so the
    //    citation stripper above misses it, but it is entirely fabricated.
    //    We remove the attribution clause and keep the claim, so the sentence
    //    survives as a general statement instead of a fake citation.
    const proseRefs = [
      // "a 2019 study published in Nature reported that" / "...found that"
      /\b(?:a|an|one)\s+\d{4}\s+(?:study|paper|article|report|review|analysis)\s+(?:published\s+)?(?:in\s+(?:the\s+)?(?:journal\s+)?[A-Z][A-Za-z&.\s]{2,60}?\s+)?(?:reported|found|showed|demonstrated|revealed|concluded|suggested)\s+that\s+/gi,
      // "a study published in the journal Science reported that"
      /\b(?:a|an|one)\s+(?:study|paper|article|report|review)\s+published\s+in\s+(?:the\s+)?(?:journal\s+)?[A-Z][A-Za-z&.\s]{2,60}?\s+(?:reported|found|showed|demonstrated|revealed|concluded|suggested)\s+that\s+/gi,
      // "according to a 2018 paper in Cell,"
      /\baccording\s+to\s+(?:a|an|the)\s+(?:\d{4}\s+)?(?:study|paper|article|report|review)\s+(?:published\s+)?in\s+(?:the\s+)?(?:journal\s+)?[A-Z][A-Za-z&.\s]{2,60}?,\s*/gi,
      // "research published in PNAS in 2020 showed"
      /\bresearch\s+published\s+in\s+(?:the\s+)?(?:journal\s+)?[A-Z][A-Za-z&.\s]{2,60}?(?:\s+in\s+\d{4})?\s+(?:reported|found|showed|demonstrated|revealed)\s+(?:that\s+)?/gi,
    ];
    for (const re of proseRefs) {
      t = t.replace(re, (m) => {
        // Keep the sentence readable: "For instance, X" rather than a fragment.
        return "";
      });
    }
    // Capitalize any sentence left starting lowercase after a removal.
    t = t.replace(/(^|[.!?]\s+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
  }

  // 5. Tidy the punctuation left behind by removals.
  t = t.replace(/[ \t]{2,}/g, " ");
  t = t.replace(/\s+([.,;:!?])/g, "$1");
  t = t.replace(/([.,;:])\1+/g, "$1");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

// Force any close-but-wrong variant of a name (e.g. "Sahoy" for "Saho") back
// to the exact form the user searched. Free AI models routinely hallucinate
// name variants; this is a hard post-processing correction so the user never
// sees "Sahoy" when they typed "Saho".
function correctNameVariants(text, canonicalName) {
  if (!text || !canonicalName) return text;
  const tokens = canonicalName.trim().split(/\s+/);
  let out = text;
  for (const token of tokens) {
    if (token.length < 3) continue;
    // Match a word that starts with the token's first 3 chars and has similar
    // length (within +/- 2 chars). Catches "Sahoy", "Sahon", "Sahoes" etc.
    const stem = token.slice(0, 3);
    const min = Math.max(3, token.length - 1);
    const max = token.length + 3;
    // Build a regex that finds words starting with stem, length min..max,
    // that are NOT the canonical token itself.
    const re = new RegExp(`\\b(${stem}[a-zA-Z]{${min - 3},${max - 3}})\\b`, "g");
    out = out.replace(re, (match) => {
      if (match.toLowerCase() === token.toLowerCase()) return match;
      // Preserve original capitalization
      return token.charAt(0).toUpperCase() + token.slice(1);
    });
  }
  return out;
}


function cleanAIResponse(raw) {
  if (!raw) return "";
  let c = raw;

  // 1. XML reasoning tags (multiple formats used by different models)
  c = c.replace(/<think>[\s\S]*?<\/think>/gi, "");
  c = c.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  c = c.replace(/<internal>[\s\S]*?<\/internal>/gi, "");
  c = c.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "");
  c = c.replace(/<planning>[\s\S]*?<\/planning>/gi, "");

  // 2. Code fences wrapping entire response
  c = c.replace(/^```(?:markdown)?\s*\n([\s\S]*?)\n```\s*$/i, "$1");

  // 3. System meta-talk
  c = c.replace(/^\s*User Safety:\s*safe\.?\s*/gim, "");
  c = c.replace(/^\s*\[?(Safety|Content|Compliance)\s*(Rating|Check|Assessment)[:\s]*\w+\]?\s*/gim, "");

  // 4. Kill meta-planning opening paragraphs (EXPANDED in v6.0)
  const badOpeners = [
    /^the user is asking/i,
    /^the user wants/i,
    /^the user('s)? question/i,
    /^let me review/i,
    /^let me check/i,
    /^let me think/i,
    /^let me analyze/i,
    /^let me examine/i,
    /^let me look at/i,
    /^i need to provide/i,
    /^i'll write/i,
    /^i will now/i,
    /^i will provide/i,
    /^i will analyze/i,
    /^let's analyze/i,
    /^let's examine/i,
    /^let's look at/i,
    /^let's review/i,
    /^here is a summary of the papers/i,
    /^here is (a|the|my) (comprehensive|detailed|thorough)/i,
    /^here is what (we|the|i) know/i,
    /^first,? i'll/i,
    /^first,? let me/i,
    /^first,? let's/i,
    /^okay,? let me/i,
    /^to answer this/i,
    /^to address this/i,
    /^to respond to/i,
    /^now we need to/i,
    /^now,? let me/i,
    /^based on the (provided|available|given) (sources|papers|literature|research|evidence)/i,
    /^the (provided|available|given) (sources|papers|literature|research|evidence)/i,
    /^looking at the (provided|available|given)/i,
    /^after (reviewing|examining|analyzing|reading)/i,
    /^having (reviewed|examined|analyzed|read)/i,
    /^upon (reviewing|examining|analyzing|reading)/i,
    /^the research (shows|indicates|suggests|demonstrates)/i,
    /^the (available )?literature (shows|indicates|suggests|demonstrates)/i,
    /^several studies/i,
    /^the available evidence/i,
    /^recent research/i,
    /^according to the sources/i,
  ];

  // Strip self-introductions and acknowledgement filler
  c = c.replace(/^\s*(that'?s (correct|right)[,.]?\s*)?(cerebrum here|as cerebrum|i'?m cerebrum|this is cerebrum)[,.!]?\s*/i, "");
  c = c.replace(/^\s*(great|good|excellent|interesting|wonderful|fantastic)\s+question[,.!]?\s*/i, "");
  c = c.replace(/^\s*(sure|certainly|absolutely|of course|indeed)[,.!]\s*/i, "");
  c = c.replace(/^\s*that'?s (correct|right|a great|an excellent|an interesting)[,.]\s+/i, "");
  c = c.replace(/^\s*thank you for (your|the|this)\s+/i, "");
  const paras = c.split(/\n{2,}/);
  while (paras.length > 1) {
    const first = paras[0].trim();
    if (badOpeners.some((re) => re.test(first))) {
      paras.shift();
    } else {
      break;
    }
  }
  c = paras.join("\n\n").trim();

  // 5. Kill single-line prefix artifacts
  c = c.replace(/^(here is the answer|here's the answer|here's my (analysis|response|answer))[:\.]?\s*/i, "").trim();
  c = c.replace(/^(to summarize|to sum up|in short)[,:]?\s*/i, "").trim();

  // 6. Strip "Paper 1 discusses...Paper 2 discusses..." robotic patterns from the opening
  c = c.replace(/^(paper\s+\d+[:\s][^\n]+\n+){2,}/i, "").trim();
  // Also catch "Source [1] discusses..." patterns
  c = c.replace(/^(source\s+\[\d+\][:\s][^\n]+\n+){2,}/i, "").trim();

  // 7. Strip trailing filler conclusions (v6.0)
  // Many free models add a "In conclusion, further research is needed" paragraph
  c = c.replace(/\n\n(In conclusion|In summary|To conclude|To summarize|Overall),?\s+[^\n]+$/i, "").trim();

  // 8. Strip disclaimer/caveat paragraphs (v7.0)
  // Free models frequently append caveats like "It's important to note that..."
  // or "Please consult a healthcare professional" at the end
  c = c.replace(/\n\n(?:It(?:'s| is) (?:important|worth|crucial) to (?:note|mention|emphasize) that|Please (?:note|consult|be aware)|Note: |Disclaimer:)[^\n]+$/i, "").trim();

  // 9. Strip numbered source recap blocks at end (v7.0)
  // Some models append "Sources used: [1] Title, [2] Title..." at the end
  c = c.replace(/\n\n(?:Sources? (?:used|cited|referenced|consulted):?\s*\n(?:\s*\[?\d+\]?[^\n]+\n?)+)$/i, "").trim();

  // 10. Strip "I hope this helps" / "Let me know if you" closers (v7.0)
  c = c.replace(/\n\n?(?:I hope this (?:helps|answers|provides|clarifies)|Let me know if you (?:have|need|want|would like)|Feel free to (?:ask|reach|let me know)|Happy to (?:elaborate|explain|help))[^\n]*$/i, "").trim();

  return c;
}

// Standard italicized Latin phrases in scientific writing. Deliberately a
// short, conservative list of set idioms rather than anything guessed —
// each of these is essentially universal style-guide convention (Chicago,
// AMA, CSE) with no real ambiguity, unlike "et al." (whose italicization
// is style-dependent) or gene symbols (whose italic/roman convention
// depends on species and on whether it's the gene or its product — a
// wrong guess there is worse than no guess).
const LATIN_SCI_PHRASES = [
  "in vivo", "in vitro", "ex vivo", "in situ", "in utero", "ex situ",
  "in silico", "de novo", "a priori", "a posteriori", "post hoc",
  "ad libitum", "in toto", "sensu stricto", "sensu lato",
];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Deterministic italics safety net. RULE 6 in the system prompt already
// instructs the model to italicize species names and these Latin terms
// with markdown underscores, and it complies most of the time — but "most
// of the time" isn't good enough for formatting a reader uses to tell a
// genus+species name apart from an ordinary word at a glance, so this
// repairs whatever the model forgot.
//
// Deliberately narrow on the species side: it only italicizes the EXACT
// name(s) this pipeline has already validated as real for this query
// (extractBinomial()'s output, already gating which papers even count as
// evidence above) — never a blind regex guess over "Capitalized lowercase"
// bigrams in free text, which is exactly the kind of heuristic that would
// mislabel "New York" or "Nature Communications" as a species name. That
// means the guarantee is strongest for species-targeted queries; a species
// mentioned only in passing in an answer about some other topic still
// depends on the model following RULE 6 on its own, same as before.
//
// Must run AFTER stripFabricatedCitations/verifyAnswerAgainstSources/
// deepFactCheck/extractLiteratureConflicts have already read the answer —
// wrapping a word in "_..._" turns the underscore into a \w character
// sitting directly against it, which erases the \b boundary a bare-word
// match would have relied on. Run this any earlier and it would silently
// break exactly the term-matching those passes do against the answer text.
function italicizeScientificTerms(text, query) {
  if (!text) return text;
  // Split out anything already formatted (bold/italic/code/citation) or a
  // fenced code block, and only touch the plain-prose segments in between.
  // Prevents double-wrapping something the model already italicized
  // ("__E. coli__") and guarantees citation markers like "[1]" are never
  // touched.
  const SPAN_RE = /(```[\s\S]*?```|`[^`\n]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|\[\d+\])/g;
  const parts = text.split(SPAN_RE);

  // Recomputed fresh from the query rather than threaded in as a shared
  // variable — this gets called from more than one return path in
  // onRequest, including an early cache-hit that returns before the
  // pipeline's own `speciesSearch` local is ever assigned. extractBinomial()
  // is cheap and pure, so recomputing it here is simpler and safer than
  // trying to keep every call site's scope straight.
  const speciesSearch = extractBinomial(query || "");
  const namePatterns = [];
  if (speciesSearch && speciesSearch.full) {
    namePatterns.push(speciesSearch.full);
    const g = speciesSearch.genus;
    const sp = speciesSearch.species;
    if (g && g.length > 1 && sp) {
      // Abbreviated form scientists actually write on second reference —
      // "Escherichia coli" then "E. coli" — with or without the space
      // after the period.
      namePatterns.push(g[0] + "\\.\\s?" + escapeRegExp(sp));
    }
  }

  return parts
    .map((part, i) => {
      // Odd indices are the spans captured by SPAN_RE above — already
      // formatted or a citation number. Leave them exactly as-is.
      if (i % 2 === 1) return part;
      let out = part;
      for (const pattern of namePatterns) {
        const body = pattern.includes("\\.") ? pattern : escapeRegExp(pattern).replace(/ /g, "\\s+");
        const re = new RegExp("\\b(" + body + ")\\b", "g");
        out = out.replace(re, (m) => "_" + m + "_");
      }
      for (const phrase of LATIN_SCI_PHRASES) {
        const re = new RegExp("\\b(" + phrase.replace(/ /g, "\\s+") + ")\\b", "gi");
        out = out.replace(re, (m) => "_" + m + "_");
      }
      return out;
    })
    .join("");
}

// ============ QUERY LOGIC ============

// ---- TERM SPECIFICITY ----
// Not every word in a question carries equal search weight. In
// "What types of enzymes do insects have to degrade plastic compounds, and how
// do gut microbes capitalize from them?" the words that actually identify the
// topic are enzymes / insects / plastic / gut / microbes. Words like types,
// compounds, capitalize are scientific filler — they appear in millions of
// papers and matching them proves nothing.
//
// Requiring a flat percentage of ALL terms was rejecting correct papers for
// verbose questions (a real Nature Communications paper on waxworm saliva
// enzymes scored 22% and got dropped). We now separate CORE terms from
// PERIPHERAL ones and gate only on CORE coverage.
// Words that describe INTENT rather than TOPIC. High-value in conversation
// ("papers that CAUTION against"), useless as search anchors. If we let these
// dominate the anchor list, the actual domain terms get pushed off the top.
const INTENT_WORDS = new Set([
  "raise", "raises", "raising", "argue", "argues", "arguing", "suggest", "suggests",
  "caution", "cautions", "warn", "warns", "warning", "critique", "critiques",
  "review", "reviews", "reviewing", "discuss", "discusses", "discussing",
  "papers", "paper", "article", "articles", "study", "studies", "work", "works",
  "recommend", "recommends", "propose", "proposes", "consider", "considers",
  "using", "used", "use", "uses", "usage", "applying", "apply",
  "about", "regarding", "concerning", "against", "with", "without",
  "against", "toward", "towards", "on",
  "turning", "turn", "turned", "turns", "convert", "converting", "converted",
  "transform", "transforming", "transformed", "make", "making", "create", "creating",
  "produce", "producing", "produced", "into", "from",
]);

// Common misspellings and variants of scientific terms. Search engines don't
// autocorrect — a typo returns zero. This runs before term extraction so the
// canonical spelling reaches the API.
const SPELLING_CORRECTIONS = {
  "occurance": "occurrence", "occurances": "occurrences",
  "co-occurance": "co-occurrence", "cooccurance": "co-occurrence",
  "cooccurrence": "co-occurrence",
  "seperate": "separate", "recieve": "receive", "acheive": "achieve",
  "definately": "definitely", "occured": "occurred",
  "flourescent": "fluorescent", "flourescence": "fluorescence",
  "phylogenic": "phylogenetic", "millenia": "millennia",
  "existance": "existence", "concious": "conscious",
  "genomewide": "genome-wide", "genemwide": "genome-wide",
  "microbiom": "microbiome",
  "decomp": "decomposition", "biodegredation": "biodegradation",
  "photosythesis": "photosynthesis", "photosynthisis": "photosynthesis",
  "mitocondria": "mitochondria", "mitocondrial": "mitochondrial",
  "enviroment": "environment", "enviromental": "environmental",
  "resistnace": "resistance", "resistence": "resistance",
  "palstic": "plastic", "platsic": "plastic",
  "anlaysis": "analysis", "anaylsis": "analysis",
  "calicification": "calcification", "calcificaiton": "calcification",
  "neruon": "neuron", "nuerotransmitter": "neurotransmitter",
  "protien": "protein", "protiens": "proteins",
  "bateria": "bacteria", "baterium": "bacterium",
  "symbotic": "symbiotic",
  "metabalic": "metabolic", "metablism": "metabolism",
  "pathogensis": "pathogenesis", "carcinognesis": "carcinogenesis",
  // Neuroscience & psychology
  "nueron": "neuron", "nueral": "neural", "nuerological": "neurological",
  "serotonin": "serotonin", "seratonin": "serotonin",
  "dopamine": "dopamine", "dopamin": "dopamine",
  "alzheimers": "alzheimer's", "alzheimr": "alzheimer",
  "parkinsons": "parkinson's", "parkinons": "parkinson",
  "schizophrnia": "schizophrenia", "scizophrenia": "schizophrenia",
  "epilepsey": "epilepsy",
  // Genetics & genomics
  "chromosone": "chromosome", "chromosones": "chromosomes",
  "alelle": "allele", "aleles": "alleles",
  "epigentic": "epigenetic", "epigenitics": "epigenetics",
  "trancsription": "transcription", "transcripton": "transcription",
  "replicaiton": "replication", "replicaton": "replication",
  "homologus": "homologous", "homologue": "homolog",
  // Immunology & medicine
  "immunodeficency": "immunodeficiency", "immunedeficiency": "immunodeficiency",
  "inflamation": "inflammation", "inflamatory": "inflammatory",
  "antibioitc": "antibiotic", "antibioitcs": "antibiotics",
  "anitmicrobial": "antimicrobial",
  "vaccien": "vaccine", "vacine": "vaccine",
  "theraputic": "therapeutic", "therapuetics": "therapeutics",
  "hemorrhage": "hemorrhage", "haemorrage": "hemorrhage",
  "anaemia": "anemia",
  // Chemistry & biochemistry
  "catalyist": "catalyst", "cataylst": "catalyst",
  "sythesis": "synthesis", "syntehsis": "synthesis",
  "chromatograhy": "chromatography", "chromotography": "chromatography",
  "spectroscpy": "spectroscopy", "spetroscopy": "spectroscopy",
  "stoichimoetry": "stoichiometry", "stoichometry": "stoichiometry",
  "thermodynamcis": "thermodynamics", "thermodynmics": "thermodynamics",
  "equilbrium": "equilibrium", "equilibirum": "equilibrium",
  // Ecology & evolution
  "biodiveristy": "biodiversity", "biodivsersity": "biodiversity",
  "phylogentic": "phylogenetic", "phylogeny": "phylogeny",
  "symboisis": "symbiosis", "symbiois": "symbiosis",
  "mutualsim": "mutualism", "commensalism": "commensalism",
  "adapation": "adaptation", "adaptaion": "adaptation",
  "extinciton": "extinction", "extincton": "extinction",
  "sedimentation": "sedimentation", "sedimention": "sedimentation",
  // Cell biology
  "mitotsis": "mitosis", "meitosis": "meiosis",
  "apoptsis": "apoptosis", "apooptosis": "apoptosis",
  "endocytsis": "endocytosis", "exocytsis": "exocytosis",
  "cytoplam": "cytoplasm", "cytoplsm": "cytoplasm",
  "ribosome": "ribosome", "ribsome": "ribosome",
  // Physiology
  "homeostatsis": "homeostasis", "homeostais": "homeostasis",
  "metabolsim": "metabolism",
  "angiogenisis": "angiogenesis",
  "atherosclersis": "atherosclerosis", "atheriosclerosis": "atherosclerosis",
  // Microbiology
  "baterical": "bacterial", "bactiria": "bacteria",
  "pathogneic": "pathogenic", "pathognic": "pathogenic",
  "virulance": "virulence", "virlence": "virulence",
  "antibitoic": "antibiotic", "anitbiotic": "antibiotic",
  "biofilm": "biofilm", "biofim": "biofilm",
  // Common general scientific typos
  "hypotheiss": "hypothesis", "hypothsis": "hypothesis",
  "experiement": "experiment", "expiriment": "experiment",
  "laborotory": "laboratory", "labratory": "laboratory",
  "phenomonon": "phenomenon", "phenomemon": "phenomenon",
  "quantatative": "quantitative", "quanitative": "quantitative",
  "qualatative": "qualitative", "qualitatve": "qualitative",
  "signifcant": "significant", "signficant": "significant",
  "concentraiton": "concentration", "concentartion": "concentration",
  "tempurature": "temperature", "temperture": "temperature",
  "moleclue": "molecule", "molecuel": "molecule",
  "algorithem": "algorithm", "algorithim": "algorithm",
};

// Multi-word scientific terms that must be preserved as a phrase. Users type
// them variably — "co occurrence", "co-occurrence", "cooccurrence" — but all
// should become the canonical hyphenated form for search.
const SCIENTIFIC_COMPOUNDS = [
  [/\bco[\s-]?occurr?ence[s]?\b/gi, "co-occurrence"],
  [/\bmachine[\s-]?learning\b/gi, "machine-learning"],
  [/\bdeep[\s-]?learning\b/gi, "deep-learning"],
  [/\bgene[\s-]?expression\b/gi, "gene-expression"],
  [/\bwhole[\s-]?genome\b/gi, "whole-genome"],
  [/\bhigh[\s-]?throughput\b/gi, "high-throughput"],
  [/\bnext[\s-]?generation\b/gi, "next-generation"],
  [/\bcell[\s-]?free\b/gi, "cell-free"],
  [/\bsingle[\s-]?cell\b/gi, "single-cell"],
  [/\bloss[\s-]?of[\s-]?function\b/gi, "loss-of-function"],
  [/\bgain[\s-]?of[\s-]?function\b/gi, "gain-of-function"],
  [/\bin[\s-]?vivo\b/gi, "in-vivo"],
  [/\bin[\s-]?vitro\b/gi, "in-vitro"],
  [/\bin[\s-]?silico\b/gi, "in-silico"],
  [/\bdouble[\s-]?stranded?\b/gi, "double-stranded"],
  [/\bsingle[\s-]?stranded?\b/gi, "single-stranded"],
  [/\blong[\s-]?non[\s-]?coding\b/gi, "long-non-coding"],
  [/\banti[\s-]?microbial\b/gi, "antimicrobial"],
  [/\banti[\s-]?biotic\b/gi, "antibiotic"],
  [/\banti[\s-]?fungal\b/gi, "antifungal"],
  [/\banti[\s-]?viral\b/gi, "antiviral"],
  [/\banti[\s-]?oxidant\b/gi, "antioxidant"],
  [/\banti[\s-]?inflammatory\b/gi, "anti-inflammatory"],
  [/\bmulti[\s-]?drug\b/gi, "multidrug"],
  [/\bmulti[\s-]?omics\b/gi, "multi-omics"],
  [/\bcrispr[\s-]?cas9?\b/gi, "CRISPR-Cas9"],
  [/\bopen[\s-]?access\b/gi, "open-access"],
  [/\blong[\s-]?term\b/gi, "long-term"],
  [/\bshort[\s-]?term\b/gi, "short-term"],
  [/\bdose[\s-]?response\b/gi, "dose-response"],
  [/\bex[\s-]?vivo\b/gi, "ex-vivo"],
  [/\bde[\s-]?novo\b/gi, "de-novo"],
  [/\bgut[\s-]?brain\b/gi, "gut-brain"],
  [/\bblood[\s-]?brain[\s-]?barrier\b/gi, "blood-brain-barrier"],
  [/\bhost[\s-]?pathogen\b/gi, "host-pathogen"],
  [/\bstructure[\s-]?activity\b/gi, "structure-activity"],
  [/\bgenome[\s-]?editing\b/gi, "genome-editing"],
  [/\bstem[\s-]?cell\b/gi, "stem-cell"],
];

// Preprocess a raw query BEFORE term extraction. Fixes typos, joins scientific
// compounds, so downstream code sees the canonical form.
function preprocessQuery(raw) {
  let q = " " + (raw || "").toLowerCase() + " ";
  // Binomial typo correction before anything else — fixes voice-dictation
  // mangling like "Hermetia illucens" -> "Hermia illusions" so the organism
  // detector below (which needs the correct spelling) actually recognizes
  // the species instead of silently falling through to a generic keyword
  // search across every field that happens to mention "microbiome".
  q = " " + correctBinomialTypos(q.trim()) + " ";
  // Spelling correction FIRST — otherwise a misspelled half of a compound
  // ("co occurance") won't match the compound pattern (which expects the
  // correct spelling).
  const words = q.split(/(\s+)/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^a-z-]/g, "");
    if (w && SPELLING_CORRECTIONS[w]) {
      words[i] = words[i].replace(w, SPELLING_CORRECTIONS[w]);
    }
  }
  q = words.join("");
  // Then join scientific compounds so "co occurrence" becomes "co-occurrence".
  for (const [re, canonical] of SCIENTIFIC_COMPOUNDS) {
    q = q.replace(re, canonical);
  }
  // Scientific paraphrase: rewrite natural-language concepts into proper
  // search terminology. "turning air into ethanol" should search for
  // "CO2 ethanol conversion", not "air ethanol".
  const PARAPHRASES = [
    [/turning\s+air\s+into/gi, "CO2 conversion to"],
    [/air\s+(?:to|into)\s+(ethanol|fuel|methanol|plastic)/gi, "CO2 conversion to $1"],
    [/(ethanol|fuel|methanol)\s+from\s+air/gi, "$1 from CO2 atmospheric carbon capture"],
    [/cure\s+(?:for\s+)?cancer/gi, "cancer treatment therapy"],
    [/cure\s+(?:for\s+)?alzheimer/gi, "Alzheimer disease treatment therapy"],
    [/global\s+warming/gi, "climate change anthropogenic warming"],
    [/how\s+(?:does|do)\s+(.+?)\s+work/gi, "$1 mechanism"],
    [/what\s+causes?\s+(.+?)(?:\?|$)/gi, "$1 etiology mechanism cause"],
    // Plant biology
    [/not\s+need\s+(?:it|photosynthesis|sunlight|light)/gi, "non-photosynthetic heterotrophic mycoheterotrophic parasitic"],
    [/without\s+(?:photosynthesis|sunlight|light)/gi, "non-photosynthetic heterotrophic"],
    // Ecology / evolution
    [/(?:go|went)\s+extinct/gi, "extinction cause"],
    [/why\s+(?:do|did)\s+dinosaurs?\s+(?:go|die)/gi, "dinosaur extinction Cretaceous-Paleogene"],
    // Medicine / disease
    [/cure\s+(?:for\s+)?diabetes/gi, "diabetes treatment therapy glycemic control"],
    [/cure\s+(?:for\s+)?parkinson/gi, "Parkinson disease treatment therapy neuroprotection"],
    [/cure\s+(?:for\s+)?depression/gi, "major depressive disorder treatment antidepressant therapy"],
    [/side\s+effects?\s+of\s+(.+?)(?:\?|$)/gi, "$1 adverse effects toxicity safety"],
    [/is\s+(.+?)\s+safe/gi, "$1 safety toxicity adverse effects"],
    // Nutrition / biochemistry
    [/(?:good|bad)\s+(?:for\s+)?(?:your?\s+)?health/gi, "health effects benefits risks"],
    [/what\s+(?:does|do)\s+(.+?)\s+do\s+(?:to|in|for)\s+(?:the\s+)?body/gi, "$1 physiological effects mechanism of action"],
    [/how\s+is\s+(.+?)\s+made/gi, "$1 biosynthesis production pathway"],
    // Genetics
    [/gene\s+for\s+(.+?)(?:\?|$)/gi, "$1 genetic basis gene locus"],
    [/is\s+(.+?)\s+(?:hereditary|genetic|inherited)/gi, "$1 heritability genetic predisposition inheritance"],
    // Neuroscience
    [/how\s+(?:does|do)\s+(?:the\s+)?brain\s+(.+?)(?:\?|$)/gi, "brain $1 neural mechanism neuroscience"],
    [/what\s+happens?\s+(?:to|in)\s+(?:the\s+)?brain\s+(?:when|during)\s+(.+?)(?:\?|$)/gi, "brain $1 neural activity neurophysiology"],
    // Microbiology
    [/(?:good|beneficial)\s+bacteria/gi, "probiotic commensal microbiome beneficial microbiota"],
    [/(?:bad|harmful)\s+bacteria/gi, "pathogenic bacteria virulence infection"],
    [/superbugs?/gi, "antimicrobial resistance multidrug-resistant bacteria"],
    // Environment
    [/(?:save|saving)\s+(?:the\s+)?(?:planet|earth|environment)/gi, "environmental conservation sustainability"],
    [/clean\s+energy/gi, "renewable energy solar wind sustainable"],
    [/greenhouse\s+gas(?:es)?/gi, "greenhouse gas emissions CO2 methane climate"],
  ];
  for (const [re, repl] of PARAPHRASES) {
    q = q.replace(re, repl);
  }
  return q.trim();
}

const GENERIC_SCIENCE_WORDS = new Set([
  "types", "type", "kinds", "kind", "sort", "sorts", "form", "forms",
  "compound", "compounds", "substance", "substances", "material", "materials",
  "capitalize", "utilize", "utilise", "leverage", "involve", "involves",
  "process", "processes", "method", "methods", "approach", "approaches",
  "effect", "effects", "impact", "impacts", "influence", "role", "roles",
  "function", "functions", "mechanism", "mechanisms", "system", "systems",
  "factor", "factors", "level", "levels", "amount", "amounts", "rate", "rates",
  "result", "results", "outcome", "outcomes", "finding", "findings",
  "study", "studies", "research", "paper", "papers", "article", "articles",
  "analysis", "data", "evidence", "review", "reviews", "report", "reports",
  "different", "various", "several", "many", "much", "high", "low", "large",
  "small", "new", "novel", "recent", "current", "important", "significant",
  "possible", "potential", "specific", "general", "common", "main", "major",
  "help", "helps", "make", "makes", "made", "get", "gets", "give", "gives",
  "produce", "produces", "produced", "production",
  "related", "associated", "based", "including", "such", "well", "known",
  "information", "info", "detail", "details", "aspect", "aspects",
  "question", "answer", "example", "examples", "case", "cases",
  "air", "water", "light", "heat", "cold", "food", "plant", "plants",
  "time", "life", "cell", "cells", "model", "models", "group", "groups",
]);

// Concept equivalence groups. If a query term is in a group, a paper matching
// ANY member of that group satisfies the term. This is what lets a question
// about "plastic" find a paper that only ever says "polyethylene", and a
// question about "insects" find one that says "Galleria mellonella".
const CONCEPT_GROUPS = [
  ["plastic", "plastics", "polymer", "polymers", "polyethylene", "polystyrene",
   "polypropylene", "polyurethane", "pvc", "pet", "ldpe", "hdpe", "microplastic",
   "microplastics", "nanoplastic", "nanoplastics", "polyolefin"],
  ["insect", "insects", "larva", "larvae", "larval", "worm", "worms", "caterpillar",
   "grub", "mealworm", "waxworm", "galleria", "tenebrio", "hermetia", "zophobas",
   "beetle", "moth", "fly", "arthropod", "arthropods", "entomological"],
  ["microbe", "microbes", "microbial", "microbiome", "microbiota", "bacteria",
   "bacterial", "bacterium", "gut flora", "microflora", "symbiont", "symbionts",
   "microorganism", "microorganisms"],
  ["enzyme", "enzymes", "enzymatic", "oxidase", "oxidases", "hydrolase",
   "hydrolases", "esterase", "esterases", "cutinase", "lipase", "protease",
   "depolymerase", "oxidoreductase", "oxidoreductases", "phenoloxidase",
   "laccase", "peroxidase"],
  ["degrade", "degradation", "degrading", "biodegradation", "biodegrade",
   "breakdown", "depolymerization", "depolymerisation", "catabolism",
   "decompose", "decomposition", "oxidation", "oxidize", "oxidise", "oxidative"],
  ["gut", "intestinal", "intestine", "digestive", "midgut", "hindgut", "foregut",
   "gastrointestinal", "alimentary", "crop", "proventriculus",
   "peritrophic membrane", "alimentary canal", "digestive tract"],
  ["saliva", "salivary", "secretion", "secretions", "oral", "labial"],
  ["cancer", "tumour", "tumor", "carcinoma", "neoplasm", "oncology", "malignant"],
  // Split from a single overly-broad ["gene","genes","genetic","genomic",
  // "genome","transcript","transcriptome"] group. That group let a query
  // term "genetic" (e.g. from "mobile genetic elements") count ANY paper
  // mentioning "genome" or "transcriptome" as a match — which is how a
  // canine reference-genome paper, a bovine genome-annotation paper, and a
  // maize single-cell atlas all scored as relevant to a question about
  // insect-microbe mobile genetic elements. "Gene-level", "genome-level",
  // and "transcript-level" are related but genuinely different research
  // topics/methods; conflating them causes false-topic query expansion.
  ["gene", "genes", "genetic"],
  ["genome", "genomic", "genomics"],
  ["transcript", "transcripts", "transcriptome", "transcriptomic"],
  // The ACTUAL concept behind "mobile genetic elements" — transposons,
  // plasmids, phages/prophages, insertion sequences, integrons. Without
  // this, "genetic" (from "mobile genetic elements") had no correct
  // concept group to expand into and fell back to the generic gene group
  // above, or worse, the old conflated genome/transcriptome group.
  ["transposon", "transposons", "transposable element", "transposable elements",
   "plasmid", "plasmids", "horizontal gene transfer", "prophage", "prophages",
   "insertion sequence", "insertion sequences", "integron", "integrons",
   "conjugative transposon", "mobile genetic element", "mobile genetic elements",
   "bacteriophage", "bacteriophages", "phage", "phages"],
  ["protein", "proteins", "proteomic", "peptide", "peptides", "polypeptide"],
  ["climate", "warming", "temperature", "thermal", "heat"],
  ["neuron", "neurons", "neural", "neuronal", "brain", "cortical", "cerebral"],
  // Ecology / environment
  ["ecology", "ecological", "ecosystem", "ecosystems", "community", "communities",
   "biodiversity", "species richness", "assemblage"],
  ["network", "networks", "co-occurrence", "cooccurrence", "interaction",
   "interactions", "graph", "connectivity", "modularity"],
  ["soil", "soils", "edaphic", "rhizosphere", "pedosphere", "substrate"],
  ["ocean", "oceanic", "marine", "sea", "seawater", "pelagic", "benthic"],
  ["coral", "corals", "reef", "reefs", "calcification", "bleaching"],
  ["forest", "forests", "woodland", "canopy", "tree", "trees", "silviculture"],
  // Molecular biology
  ["mutation", "mutations", "variant", "variants", "polymorphism", "snp", "indel"],
  ["expression", "transcription", "regulation", "promoter", "enhancer", "silencer"],
  ["antibody", "antibodies", "immunoglobulin", "antigen", "epitope"],
  ["vaccine", "vaccines", "vaccination", "immunization", "adjuvant"],
  ["virus", "viruses", "viral", "virology", "pathogen", "infection", "infectious"],
  // Chemistry
  ["nanoparticle", "nanoparticles", "nanostructure", "nanomaterial", "quantum dot"],
  ["catalyst", "catalysts", "catalysis", "catalytic", "photocatalyst", "electrocatalyst"],
  // Decomposition / decay
  // Chemical conversion / synthesis
  ["ethanol", "ethyl alcohol", "bioethanol", "alcohol", "fermentation"],
  ["co2", "carbon dioxide", "carbon capture", "atmospheric carbon", "carbon fixation"],
  ["conversion", "synthesis", "catalysis", "electrochemical", "electrolysis",
   "reduction", "oxidation", "transformation"],
  ["decomposition", "decompose", "decay", "necrobiome", "cadaver", "carcass",
   "putrefaction", "autolysis", "bloat", "rupture"],
  // Photosynthesis / plant energy
  ["photosynthesis", "photosynthetic", "chloroplast", "chlorophyll", "light reactions",
   "dark reactions", "calvin cycle", "rubisco", "carbon fixation", "thylakoid",
   "photosystem", "photoautotroph", "c3", "c4", "cam"],
  // Parasitic / heterotrophic plants
  ["parasitic", "parasite", "mycoheterotroph", "mycoheterotrophic", "holoparasite",
   "hemiparasite", "heterotroph", "heterotrophic", "non-photosynthetic",
   "achlorophyllous"],
  // Abundance / diversity (common ecological measures)
  ["abundance", "diversity", "richness", "composition", "community structure",
   "alpha diversity", "beta diversity", "evenness", "dominance"],
  // Evolution / adaptation
  ["evolution", "evolutionary", "phylogenetic", "phylogeny", "adaptation",
   "selection", "speciation", "divergence", "convergent"],
  // Immunology
  ["immune", "immunity", "innate immunity", "adaptive immunity", "inflammatory",
   "inflammation", "cytokine", "chemokine", "lymphocyte"],
  // Stem cells & regeneration
  ["stem cell", "stem cells", "pluripotent", "multipotent", "ipsc", "ips cell",
   "embryonic stem cell", "progenitor", "differentiation", "reprogramming"],
  // Epigenetics
  ["epigenetic", "epigenetics", "methylation", "histone", "chromatin",
   "acetylation", "imprinting", "epigenome", "chromatin remodeling"],
  // Drug / pharmacology
  ["drug", "drugs", "pharmaceutical", "pharmacological", "therapeutic",
   "therapy", "treatment", "medication", "compound", "inhibitor"],
  // Apoptosis / cell death
  ["apoptosis", "apoptotic", "programmed cell death", "necrosis", "necroptosis",
   "pyroptosis", "ferroptosis", "autophagy", "autophagic", "cell death"],
  // Metabolism
  ["metabolism", "metabolic", "metabolite", "metabolites", "metabolome",
   "glycolysis", "krebs cycle", "tca cycle", "oxidative phosphorylation",
   "fatty acid oxidation", "beta oxidation"],
  // Aging / senescence
  ["aging", "ageing", "senescence", "senescent", "longevity", "lifespan",
   "telomere", "telomerase", "gerontology"],
  // Biofilm / microbial community
  ["biofilm", "biofilms", "quorum sensing", "planktonic", "sessile",
   "extracellular polymeric substance", "eps", "biofouling"],
  // Antibiotic resistance
  ["antibiotic resistance", "antimicrobial resistance", "amr", "multidrug resistant",
   "mdr", "drug resistant", "beta-lactamase", "efflux pump", "resistance gene"],
  // CRISPR & gene editing
  ["crispr", "cas9", "cas12", "cas13", "gene editing", "genome editing",
   "guide rna", "sgrna", "base editing", "prime editing"],
  // Microscopy / imaging
  ["microscopy", "microscope", "imaging", "fluorescence", "confocal",
   "electron microscopy", "sem", "tem", "super-resolution", "cryo-em"],
  // Bioinformatics / computation
  ["bioinformatics", "computational biology", "sequence analysis", "alignment",
   "phylogenetics", "homology", "blast", "pipeline", "annotation"],
  // Diabetes / metabolic disease
  ["diabetes", "diabetic", "insulin", "glucose", "glycemic", "hyperglycemia",
   "type 2 diabetes", "type 1 diabetes", "insulin resistance", "metabolic syndrome"],
  // Cardiovascular
  ["cardiovascular", "cardiac", "heart", "myocardial", "coronary",
   "atherosclerosis", "hypertension", "ischemia", "arrhythmia"],
  // Respiratory
  ["lung", "lungs", "pulmonary", "respiratory", "airway", "alveolar",
   "bronchial", "asthma", "copd", "pneumonia"],
  // Gut-brain axis
  ["gut-brain", "gut brain axis", "microbiome brain", "enteric nervous system",
   "vagus nerve", "psychobiotic", "neuroinflammation"],
  // Food science / nutrition
  ["nutrition", "nutritional", "dietary", "diet", "nutrient", "nutrients",
   "bioavailability", "fortification", "supplementation", "nutraceutical"],
];

// Build a fast lookup: term -> the full set of equivalent terms
const CONCEPT_LOOKUP = (() => {
  const map = new Map();
  for (const group of CONCEPT_GROUPS) {
    const set = new Set(group);
    for (const t of group) map.set(t, set);
  }
  return map;
})();

// Score how specific/informative a term is. Higher = more worth gating on.
function termSpecificity(term) {
  if (GENERIC_SCIENCE_WORDS.has(term)) return 0.15;
  // Intent verbs ("raise", "caution", "using") describe what the user WANTS
  // but not what the paper is ABOUT. Score below the anchor threshold so they
  // never dominate the top-4 rung.
  if (INTENT_WORDS.has(term)) return 0.2;
  let score = 0.5;
  // Longer words are usually more technical
  if (term.length >= 10) score += 0.3;
  else if (term.length >= 7) score += 0.2;
  else if (term.length <= 4) score -= 0.1;
  // Being part of a known concept group means it's a real topic anchor
  if (CONCEPT_LOOKUP.has(term)) score += 0.35;
  // Scientific morphology markers
  if (/(ase|ome|itis|osis|genic|troph|phyll|plast|cyte|blast|lysis|philic|phobic)$/.test(term)) score += 0.3;
  // Short technical identifiers are highly specific despite being short:
  // gene/protein names (p53, tau, myc), acronyms (mRNA, TNF, PCR), and
  // alphanumeric designators (CD4, IL6, BRCA1). Without this, a query like
  // "p53 mutations in glioma" would treat p53 as filler.
  if (/\d/.test(term) && /[a-z]/.test(term)) score += 0.4;   // alphanumeric: p53, il6, cd4
  if (SYNONYMS[term]) score += 0.4;                            // known scientific acronym
  if (term.length <= 5 && !COMMON_SHORT_WORDS.has(term)) score += 0.25;
  return Math.min(1, score);
}

// Short everyday words that should NOT get the "short technical term" boost.
const COMMON_SHORT_WORDS = new Set([
  "have", "them", "make", "made", "take", "give", "come", "know", "think",
  "want", "need", "find", "show", "tell", "work", "call", "keep", "help",
  "good", "bad", "best", "worst", "more", "less", "many", "much", "very",
  "also", "even", "just", "only", "well", "back", "down", "over", "same",
  "like", "than", "then", "when", "what", "does", "did", "was", "were",
  "any", "all", "some", "each", "both", "few", "own", "such", "why", "how",
]);


const SYNONYMS = {
  // Molecular biology
  bsfl: ["black soldier fly larvae", "hermetia illucens"],
  bsf: ["black soldier fly", "hermetia illucens"],
  "black soldier fly": ["hermetia illucens"],
  "black soldier fly larvae": ["hermetia illucens"],
  "black soldier fly larva": ["hermetia illucens"],
  "fruit fly": ["drosophila melanogaster"],
  "house mouse": ["mus musculus"],
  "lab rat": ["rattus norvegicus"],
  "lab mouse": ["mus musculus"],
  "roundworm": ["caenorhabditis elegans"],
  "zebrafish": ["danio rerio"],
  "honey bee": ["apis mellifera"],
  "honey bees": ["apis mellifera"],
  "honeybee": ["apis mellifera"],
  "honeybees": ["apis mellifera"],
  "baker's yeast": ["saccharomyces cerevisiae"],
  "brewer's yeast": ["saccharomyces cerevisiae"],
  "e coli": ["escherichia coli"],
  "e. coli": ["escherichia coli"],
  "staph": ["staphylococcus aureus"],
  "mrsa": ["methicillin-resistant staphylococcus aureus"],
  "tb": ["mycobacterium tuberculosis"],
  "malaria": ["plasmodium falciparum"],
  crispr: ["clustered regularly interspaced short palindromic repeats", "cas9", "gene editing"],
  pcr: ["polymerase chain reaction"],
  qpcr: ["quantitative pcr", "real-time pcr", "rt-pcr", "quantitative polymerase chain reaction"],
  "rt-pcr": ["reverse transcription pcr", "qpcr", "real-time pcr"],
  dna: ["deoxyribonucleic acid"],
  rna: ["ribonucleic acid"],
  mrna: ["messenger rna", "messenger ribonucleic acid"],
  sirna: ["small interfering rna"],
  mirna: ["microrna", "micro rna"],
  utr: ["untranslated region"],
  orf: ["open reading frame"],
  gwas: ["genome wide association study", "genome-wide association"],
  qtl: ["quantitative trait loci", "quantitative trait locus"],
  snp: ["single nucleotide polymorphism"],
  // Cell biology
  ros: ["reactive oxygen species", "oxidative stress", "free radicals"],
  er: ["endoplasmic reticulum"],
  atp: ["adenosine triphosphate"],
  ecm: ["extracellular matrix"],
  tcr: ["t cell receptor"],
  bcr: ["b cell receptor"],
  mhc: ["major histocompatibility complex", "hla"],
  hla: ["human leukocyte antigen", "mhc"],
  llps: ["liquid liquid phase separation", "biomolecular condensate"],
  // Biochemistry
  // "PET" is a genuinely ambiguous acronym across fields — polyethylene
  // terephthalate in materials/environmental science, positron emission
  // tomography in neuroscience/oncology imaging. This used to be declared
  // as two separate object keys ("pet" and later "pet" again down in the
  // neuroscience section) — since both compiled to the exact same object
  // key, the second silently clobbered the first at evaluation time and
  // "polyethylene terephthalate" was permanently unreachable (any
  // microplastics-related query using the bare acronym "PET" got zero
  // benefit from this entry). Merged into one entry with both expansions;
  // both are OR'd into the search either way, so this costs nothing and
  // fixes the data loss.
  pet: ["polyethylene terephthalate", "positron emission tomography"],
  pe: ["polyethylene"],
  pp: ["polypropylene"],
  nad: ["nicotinamide adenine dinucleotide"],
  fad: ["flavin adenine dinucleotide"],
  // Immunology
  car: ["chimeric antigen receptor"],
  "car-t": ["chimeric antigen receptor t cell", "car t cell therapy"],
  tnf: ["tumor necrosis factor"],
  il: ["interleukin"],
  ifn: ["interferon"],
  // Neuroscience
  gaba: ["gamma aminobutyric acid"],
  nmda: ["n-methyl-d-aspartate"],
  ltp: ["long term potentiation"],
  ltd: ["long term depression"],
  fmri: ["functional magnetic resonance imaging", "functional mri"],
  eeg: ["electroencephalography", "electroencephalogram"],
  // Microbiology
  cfu: ["colony forming units", "colony forming unit"],
  otu: ["operational taxonomic unit"],
  asv: ["amplicon sequence variant"],
  "16s": ["16s rrna", "16s ribosomal rna", "16s rdna"],
  // Ecology
  npp: ["net primary productivity", "net primary production"],
  lai: ["leaf area index"],
  ndvi: ["normalized difference vegetation index"],
  // Medicine
  bmi: ["body mass index"],
  bp: ["blood pressure"],
  ldl: ["low density lipoprotein"],
  hdl: ["high density lipoprotein"],
  copd: ["chronic obstructive pulmonary disease"],
  nafld: ["non-alcoholic fatty liver disease"],
  nsaid: ["nonsteroidal anti-inflammatory drug"],
  ssri: ["selective serotonin reuptake inhibitor"],
  ace: ["angiotensin converting enzyme"],
  // Common method terms
  elisa: ["enzyme-linked immunosorbent assay"],
  "western blot": ["immunoblot", "protein blot"],
  "flow cytometry": ["facs", "fluorescence activated cell sorting"],
  facs: ["flow cytometry", "fluorescence activated cell sorting"],
  "mass spec": ["mass spectrometry", "ms", "proteomics"],
  rnaseq: ["rna sequencing", "rna-seq", "transcriptomics"],
  "rna-seq": ["rna sequencing", "rnaseq", "transcriptomics"],
  chipseq: ["chip-seq", "chromatin immunoprecipitation sequencing"],
  atacseq: ["atac-seq", "assay for transposase accessible chromatin"],
  metabolomics: ["metabolome", "metabolite profiling"],
  proteomics: ["proteome", "protein profiling", "mass spectrometry"],
  metagenomics: ["metagenomic", "shotgun sequencing", "microbiome sequencing"],
  // Additional organisms
  "thale cress": ["arabidopsis thaliana"],
  "arabidopsis": ["arabidopsis thaliana"],
  "nematode": ["caenorhabditis elegans"],
  "corn": ["zea mays", "maize"],
  "maize": ["zea mays"],
  "rice": ["oryza sativa"],
  "wheat": ["triticum aestivum"],
  "tobacco": ["nicotiana tabacum"],
  "tomato": ["solanum lycopersicum"],
  "potato": ["solanum tuberosum"],
  "soybean": ["glycine max"],
  "cotton": ["gossypium hirsutum"],
  "silkworm": ["bombyx mori"],
  "mosquito": ["aedes aegypti", "anopheles gambiae"],
  "frog": ["xenopus laevis"],
  "chicken": ["gallus gallus"],
  "pig": ["sus scrofa"],
  "cow": ["bos taurus"],
  "sheep": ["ovis aries"],
  "dog": ["canis lupus familiaris"],
  "cat": ["felis catus"],
  "chimpanzee": ["pan troglodytes"],
  "rhesus macaque": ["macaca mulatta"],
  // Additional technique acronyms
  "cryo-em": ["cryo-electron microscopy", "cryogenic electron microscopy"],
  "nmr": ["nuclear magnetic resonance", "nuclear magnetic resonance spectroscopy"],
  "xrd": ["x-ray diffraction", "x-ray crystallography"],
  "sem": ["scanning electron microscopy", "scanning electron microscope"],
  "tem": ["transmission electron microscopy", "transmission electron microscope"],
  "afm": ["atomic force microscopy", "atomic force microscope"],
  "spd": ["severe plastic deformation"],
  "hplc": ["high performance liquid chromatography"],
  "gc-ms": ["gas chromatography mass spectrometry"],
  "lc-ms": ["liquid chromatography mass spectrometry"],
  "icp-ms": ["inductively coupled plasma mass spectrometry"],
  "xps": ["x-ray photoelectron spectroscopy"],
  // Clinical / medical acronyms
  "rct": ["randomized controlled trial", "randomised controlled trial"],
  "icu": ["intensive care unit"],
  "cbc": ["complete blood count"],
  "ct scan": ["computed tomography"],
  "mri": ["magnetic resonance imaging"],
  "pet scan": ["positron emission tomography"],
  "ecg": ["electrocardiogram", "electrocardiography"],
  "ekg": ["electrocardiogram", "electrocardiography"],
  "gfr": ["glomerular filtration rate"],
  "hba1c": ["glycated hemoglobin", "hemoglobin a1c"],
  "alt": ["alanine aminotransferase", "alanine transaminase"],
  "ast": ["aspartate aminotransferase", "aspartate transaminase"],
  "crp": ["c-reactive protein"],
  "esr": ["erythrocyte sedimentation rate"],
  "psa": ["prostate specific antigen"],
  // Bioinformatics
  "pdb": ["protein data bank"],
  "go": ["gene ontology"],
  "kegg": ["kyoto encyclopedia of genes and genomes"],
  "ncbi": ["national center for biotechnology information"],
  // Ecology & environment
  "gis": ["geographic information system", "geospatial"],
  "enso": ["el nino southern oscillation"],
  "ipcc": ["intergovernmental panel on climate change"],
  "epa": ["environmental protection agency"],
  // Genetics & genomics (additional)
  "wgs": ["whole genome sequencing"],
  "wes": ["whole exome sequencing"],
  "ngs": ["next generation sequencing", "next-generation sequencing"],
  "scrnaseq": ["single cell rna sequencing", "single-cell rna-seq"],
  "chip": ["chromatin immunoprecipitation"],
  "talen": ["transcription activator-like effector nuclease"],
  "zfn": ["zinc finger nuclease"],
  "ipsc": ["induced pluripotent stem cell", "induced pluripotent stem cells"],
  "esc": ["embryonic stem cell", "embryonic stem cells"],
  // Neuroscience (additional)
  "tms": ["transcranial magnetic stimulation"],
  "tdcs": ["transcranial direct current stimulation"],
  "meg": ["magnetoencephalography"],
  // "pet" (positron emission tomography) is merged into the single "pet"
  // entry up in the Biochemistry section above — see the comment there.
  "bbb": ["blood brain barrier", "blood-brain barrier"],
  "csf": ["cerebrospinal fluid"],
  "cns": ["central nervous system"],
  "pns": ["peripheral nervous system"],
  "ans": ["autonomic nervous system"],
};

// Every two-word Latin binomial this app already knows about (derived from
// SYNONYMS' values, so it stays in sync automatically as that list grows).
// NOTE: this MUST be defined after SYNONYMS above, not before — it reads
// SYNONYMS at module-evaluation time.
const KNOWN_BINOMIALS = [...new Set(
  Object.values(SYNONYMS).flat().filter((s) => /^[a-z]+ [a-z]+$/i.test(s))
)];

// A NARROWER, hand-curated subset of KNOWN_BINOMIALS restricted to entries
// that are genuinely organism species names. KNOWN_BINOMIALS above is fine
// for typo-correction (correctBinomialTypos gates on length >= 5 AND a close
// fuzzy match on BOTH words, which a generic phrase like "gene editing"
// virtually never survives), but it also picks up non-organism two-word
// SYNONYMS values purely because they happen to be two lowercase words —
// "gene editing" (from crispr), "mass spectrometry", "flow cytometry", etc.
// Anything doing a bare membership check for "is this actually a species" —
// like the multi-organism comparison detection below — must use this list
// instead, or a query mentioning CRISPR alongside a real organism triggers a
// bogus extra search for "Gene editing" as if it were a second species.
const ORGANISM_BINOMIALS = new Set([
  "hermetia illucens", "drosophila melanogaster", "mus musculus",
  "rattus norvegicus", "caenorhabditis elegans", "danio rerio",
  "saccharomyces cerevisiae", "escherichia coli", "staphylococcus aureus",
  "mycobacterium tuberculosis", "plasmodium falciparum", "apis mellifera",
  // Plants
  "arabidopsis thaliana", "oryza sativa", "zea mays", "triticum aestivum",
  "nicotiana tabacum", "solanum lycopersicum", "solanum tuberosum",
  "glycine max", "gossypium hirsutum",
  // Insects & invertebrates
  "bombyx mori", "aedes aegypti", "anopheles gambiae", "tenebrio molitor",
  "zophobas morio", "galleria mellonella", "tribolium castaneum",
  "manduca sexta", "spodoptera frugiperda", "locusta migratoria",
  // Vertebrate model organisms
  "xenopus laevis", "xenopus tropicalis", "gallus gallus", "sus scrofa",
  "bos taurus", "ovis aries", "canis lupus familiaris", "felis catus",
  "pan troglodytes", "macaca mulatta", "oryzias latipes",
  // Microorganisms
  "bacillus subtilis", "pseudomonas aeruginosa", "salmonella typhimurium",
  "vibrio cholerae", "clostridioides difficile", "helicobacter pylori",
  "streptococcus pneumoniae", "candida albicans", "aspergillus niger",
  "neurospora crassa", "schizosaccharomyces pombe",
]);

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

// Correct voice-dictation / typo mangling of a known scientific binomial —
// e.g. "Hermetia illucens" transcribed as "Hermia illusions" — by finding
// two ADJACENT query words that are each independently close (within ~1 edit
// per 3 characters) to a known genus and species word. Deliberately requires
// BOTH words to match: a single fuzzy word match alone is far too easy to
// collide with an unrelated real English word ("illusions" is a real word on
// its own — a lone match would corrupt a genuine query about, say, optical
// illusions — but "genus-shaped word" immediately followed by
// "species-shaped word", both close to a real binomial, is a strong signal
// nothing else produces by coincidence).
function correctBinomialTypos(query) {
  const toks = query.split(/\s+/);
  const clean = toks.map((t) => t.toLowerCase().replace(/[^a-z]/g, ""));
  for (const binomial of KNOWN_BINOMIALS) {
    const [genus, species] = binomial.split(" ");
    if (genus.length < 5 || species.length < 5) continue; // too short to fuzzy-match safely
    // ceil, not floor: floor(8/3)=2 rejects the actual repro case ("illusions"
    // is edit-distance 3 from "illucens") — verified numerically against the
    // real voice-dictation mangling this function exists to catch.
    const gThresh = Math.max(1, Math.ceil(genus.length / 3));
    const sThresh = Math.max(1, Math.ceil(species.length / 3));
    for (let i = 0; i + 1 < clean.length; i++) {
      const w1 = clean[i], w2 = clean[i + 1];
      if (w1.length < 4 || w2.length < 4) continue;
      const dG = levenshtein(w1, genus), dS = levenshtein(w2, species);
      // Already an exact match — leave the original text (and the user's own
      // capitalization) untouched. Rewriting a correctly-typed "Hermetia
      // illucens" down to a lowercase canonical form served no purpose here
      // and had a real side effect: it stripped the capitalization that
      // extractBinomial() elsewhere relies on to recognize a deliberately-
      // typed scientific name.
      if (dG === 0 && dS === 0) continue;
      if (dG <= gThresh && dS <= sThresh) {
        const before = toks.slice(0, i).join(" ");
        const after = toks.slice(i + 2).join(" ");
        return [before, genus + " " + species, after].filter(Boolean).join(" ");
      }
    }
  }
  return query;
}

function expansionsFor(tokens) {
  const out = [];
  // Check individual tokens
  for (const t of tokens) {
    const key = t.toLowerCase();
    if (SYNONYMS[key]) out.push(...SYNONYMS[key]);
  }
  // Also check multi-word phrases (e.g. "black soldier fly" is 3 tokens but
  // one SYNONYMS key). Without this, common-name organism queries never
  // resolve to their scientific name during expansion.
  const joined = tokens.join(" ").toLowerCase();
  for (const key of Object.keys(SYNONYMS)) {
    if (key.includes(" ") && joined.includes(key)) {
      out.push(...SYNONYMS[key]);
    }
  }
  return [...new Set(out)]; // deduplicate
}

const ORGANISM_PHRASES = [
  "black soldier fly larvae",
  "black soldier fly",
  "hermetia illucens",
  // Comparison queries ("BSFL vs honey bee gut microbiome") are the most
  // common real-world use case that names a second organism alongside BSFL,
  // so it's the first one wired in below. See the multi-organism retrieval
  // block in gatherPapers() for how a second named organism gets its own
  // search pass instead of being silently dropped.
  "honey bee",
  "honey bees",
  // Additional organisms that users commonly search by common name
  "fruit fly", "fruit flies",
  "lab rat", "lab mouse",
  "guinea pig",
  "house mouse",
  "baker's yeast", "brewer's yeast",
  "thale cress",
  "rhesus macaque",
  "zebra fish", "zebrafish",
  "roundworm", "nematode",
  "silk worm", "silkworm",
  "mealworm", "meal worm",
  "wax worm", "waxworm",
];
const ORGANISM_WORDS = new Set([
  "black", "soldier", "fly", "larvae", "larva", "larval", "hermetia", "illucens",
  "honey", "bee", "bees", "honeybee", "honeybees", "apis", "mellifera",
  "fruit", "flies", "drosophila", "melanogaster",
  "mouse", "mice", "mus", "musculus",
  "rat", "rats", "rattus", "norvegicus",
  "zebrafish", "danio", "rerio",
  "roundworm", "nematode", "caenorhabditis", "elegans",
  "silkworm", "bombyx", "mori",
  "mealworm", "tenebrio", "molitor",
  "waxworm", "galleria", "mellonella",
  "mosquito", "aedes", "aegypti", "anopheles", "gambiae",
  "arabidopsis", "thaliana",
  "yeast", "saccharomyces", "cerevisiae",
]);

function splitOrganismTopic(query) {
  const q = query.toLowerCase();
  const toks = q.split(/\s+/).filter((t) => t.length > 2);
  const exp = expansionsFor(toks);
  const orgPhrases = new Set(exp);
  for (const phrase of ORGANISM_PHRASES) {
    if (q.includes(phrase)) {
      orgPhrases.add(phrase);
      // Also resolve the phrase to its scientific name immediately
      const syns = SYNONYMS[phrase] || [];
      for (const s of syns) orgPhrases.add(s);
    }
  }
  for (const t of toks) {
    if (SYNONYMS[t]) {
      orgPhrases.add(t);
      // Add expansions of individual tokens too
      for (const s of (SYNONYMS[t] || [])) orgPhrases.add(s);
    }
  }
  const topic = toks.filter((t) => !ORGANISM_WORDS.has(t) && !SYNONYMS[t]);
  return {
    orgPhrases: [...orgPhrases],
    topic,
    hasOrganism: orgPhrases.size > 0,
  };
}

function buildStructuredQuery(query) {
  // If the query names a scientific binomial, wrap it in quotes so search engines
  // treat it as a required phrase. This is what prevents "Populus deltoides"
  // papers from swamping a "Populus angustifolia" search.
  const bin = extractBinomial(query);
  if (bin) {
    // Extract the other topic words (not the binomial itself)
    const rest = query.toLowerCase().replace(new RegExp(bin.full, "gi"), "").replace(/\s+/g, " ").trim();
    const restTerms = rest.split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
    if (restTerms.length) {
      return '"' + bin.full + '" AND (' + restTerms.join(" OR ") + ')';
    }
    return '"' + bin.full + '"';
  }
  const { orgPhrases, topic, hasOrganism } = splitOrganismTopic(query);
  if (hasOrganism && (topic.length || !orgPhrases.length)) {
    // Resolve common names to scientific names for the boolean query.
    // "black soldier fly" alone is 3 common English words — PubMed will
    // match papers about black spruce or soldier beetles. The scientific
    // name as a quoted phrase is unambiguous.
    const resolvedOrg = new Set();
    for (const phrase of orgPhrases) {
      const syns = SYNONYMS[phrase.toLowerCase()] || [];
      const sciRaw = syns.find((s) => /^[a-z]+ [a-z]+$/i.test(s) && s.split(" ").length === 2);
      if (sciRaw) {
        const parts = sciRaw.split(" ");
        resolvedOrg.add(parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase() + " " + parts[1].toLowerCase());
      }
      // Always keep the original phrase too for broader recall
      resolvedOrg.add(phrase);
    }
    const orgStr = [...resolvedOrg]
      .map((e) => (e.includes(" ") ? '"' + e + '"' : e))
      .join(" OR ");
    if (topic.length) {
      return "(" + orgStr + ") AND (" + topic.join(" OR ") + ")";
    }
    return orgStr;
  }
  if (hasOrganism) {
    return orgPhrases
      .map((e) => (e.includes(" ") ? '"' + e + '"' : e))
      .join(" OR ");
  }

  // ---- Natural-language questions ----
  // Previously this returned the query verbatim. A question like "What types of
  // enzymes do insects have to degrade plastic compounds, and how do gut
  // microbes capitalize from them?" became a 9-word string, which PubMed and
  // Europe PMC treat as an implicit AND across every word. No paper contains
  // all nine, so retrieval returned ZERO and the answer fell back to the
  // model's memory — which is where the invented studies came from.
  //
  // Instead: keep only the most topic-bearing terms, expand each with its
  // concept group as an OR set, and AND the groups together. That turns the
  // question into (enzyme OR oxidase OR hydrolase...) AND (plastic OR
  // polyethylene OR PET...) AND (insect OR larvae OR Galleria...), which
  // actually retrieves the relevant literature.
  //
  // Split on hyphens as well as whitespace. A query like "insect-microbe
  // associations" previously kept "insect-microbe" as ONE opaque token that
  // matched neither the "insect" concept group nor the "microbe" one — so it
  // scored no better than an unrelated word, while "genetic" (a real,
  // single-word CONCEPT_LOOKUP hit) won the anchor race instead and dragged
  // in unrelated genome/transcriptome papers. Splitting "insect-microbe" into
  // "insect" + "microbe" lets both halves hit their correct concept groups.
  const qTerms = query
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (!qTerms.length) return query;

  const ranked = qTerms
    .map((t) => ({ t, spec: termSpecificity(t) }))
    .sort((a, b) => b.spec - a.spec);
  // Two to four anchors. More than four AND-ed groups over-constrains again.
  const anchors = ranked.filter((x) => x.spec >= 0.5).slice(0, 4).map((x) => x.t);
  if (anchors.length < 2) {
    // Not enough specific terms to build groups — OR the best few so we still
    // get recall rather than an over-narrow AND.
    return ranked.slice(0, 4).map((x) => x.t).join(" OR ");
  }

  const groups = anchors.map((t) => {
    const set = CONCEPT_LOOKUP.get(t);
    if (!set) return t;
    // Cap expansion so the request URL stays reasonable, and keep the original
    // term first so it carries the most weight in relevance-ranked engines.
    const members = [t, ...[...set].filter((m) => m !== t)].slice(0, 7);
    return "(" + members.map((m) => (m.includes(" ") ? '"' + m + '"' : m)).join(" OR ") + ")";
  });
  return groups.join(" AND ");
}

const STOPWORDS = new Set([
  "what","whats","how","does","do","did","is","are","was","were","the","a","an",
  "of","in","on","for","to","and","or","with","by","about","tell","me","explain",
  "why","when","where","which","who","can","you","please","give","show","find",
  "search","look","up","that","this","these","those","it","its","work","works",
  "happen","happens","mean","means","between","into","from","as","at","be","been",
  "get","got","i","my","we","our","use","used","using","there","their","they",
  "responding","respond","level","levels","basis","role","effect","effects",
  "each","every","change","changes","through","throughout","section","sections",
  "different","part","parts","type","types","kind","example","within",
  "some","other","most","many","much","very","just","also","still","really",
  "would","could","should","might","may","will","shall","must","need",
]);

function cleanQuery(raw) {
  // Strip potential prompt injection attempts
  let sanitized = raw
    .replace(/\b(ignore|disregard|forget)\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?|context)\b/gi, "")
    .replace(/\b(system|assistant|user)\s*:/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<[^>]+>/g, "")
    .slice(0, 500); // Hard cap query length

  const cleaned = sanitized
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .join(" ")
    .trim();
  return cleaned || raw.trim().slice(0, 500);
}

// ============ SCHOLARLY DATABASE SOURCES ============
// Each source returns [] on any failure, never throws. Timeouts keep them fast.

async function europePMC(query, limit = 8) {
  // Trust the query we were given. The retrieval ladder passes progressively
  // simpler forms — if this function silently rebuilds them, the ladder can't
  // work. Only fall back to the structured/organism forms if the given query
  // returns nothing.
  const runSearch = async (qs) => {
    const url =
      "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
      new URLSearchParams({
        query: qs,
        resultType: "core",
        pageSize: String(limit),
        format: "json",
        sort: "relevance",
      });
    const data = await getJSON(url);
    return data && data.resultList && data.resultList.result ? data.resultList.result : [];
  };
  try {
    let rows = await runSearch(query);
    if (!rows.length) {
      const structured = buildStructuredQuery(query);
      if (structured && structured !== query) {
        rows = await runSearch(structured);
      }
    }
    if (!rows.length) {
      const { orgPhrases, hasOrganism } = splitOrganismTopic(query);
      if (hasOrganism) {
        rows = await runSearch(
          orgPhrases.map((e) => (e.includes(" ") ? '"' + e + '"' : e)).join(" OR ")
        );
      }
    }
    return rows
      .filter((r) => r.title)
      .map((r) => ({
        title: r.title || "Untitled",
        url: r.doi
          ? "https://doi.org/" + r.doi
          : "https://europepmc.org/article/" + r.source + "/" + r.id,
        year: r.pubYear || "",
        citations: typeof r.citedByCount === "number" ? r.citedByCount : null,
        authors: r.authorString || "",
        _allAuthors: r.authorString || "",
        journal: r.journalTitle || "Europe PMC",
        abstract: stripTags(r.abstractText),
        pmcid: r.pmcid || (r.source === "PMC" ? r.id : "") || "",
        // Europe PMC is not a major dataset-leak vector — it indexes literature,
        // not deposits — but `pubType`/`pubTypeList.pubType` are on the record
        // when present, so carry them through for the universal reject filter
        // (isNonLiterature, below) to inspect defense-in-depth rather than
        // trusting this source blindly just because it's usually clean.
        _rawType: (r.pubTypeList && Array.isArray(r.pubTypeList.pubType) ? r.pubTypeList.pubType.join(",") : "") || r.pubType || "",
      }));
  } catch {
    return [];
  }
}

function firstMatch(block, re) {
  const m = block.match(re);
  return m ? m[1] : "";
}

function parsePubmedXML(xmlText) {
  const arts = xmlText.match(/<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/g) || [];
  return arts.map((a) => {
    const pmid = firstMatch(a, /<PMID[^>]*>(\d+)<\/PMID>/);
    const title = stripTags(
      firstMatch(a, /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)
    );
    const absParts = a.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g) || [];
    const abstract = stripTags(absParts.join(" "));
    const journal = stripTags(
      firstMatch(a, /<Title>([\s\S]*?)<\/Title>/) ||
        firstMatch(a, /<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/)
    );
    const year = firstMatch(a, /<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/);
    const authorBlocks = a.match(/<Author\b[\s\S]*?<\/Author>/g) || [];
    const names = authorBlocks
      .map((b) => {
        const last = firstMatch(b, /<LastName>([\s\S]*?)<\/LastName>/);
        const ini = firstMatch(b, /<Initials>([\s\S]*?)<\/Initials>/);
        return [last, ini].filter(Boolean).join(" ");
      })
      .filter(Boolean);
    const authors =
      names.length > 1 ? names[0] + " et al." : names[0] || "";
    const doi = firstMatch(a, /<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/);
    return {
      title: title || "Untitled",
      url: doi
        ? "https://doi.org/" + doi
        : "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/",
      year,
      citations: null,
      authors,
      journal: journal || "PubMed",
      abstract,
      pmid,
    };
  });
}

async function pubmed(query, limit = 10, apiKey = "") {
  const keyParam = apiKey ? "&api_key=" + apiKey : "";
  const tool = "&tool=cerebrum&email=contact@askcerebrum.org" + keyParam;
  try {
    let ids = [];

    const esUrl = (t) =>
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" +
      new URLSearchParams({
        db: "pubmed",
        term: t,
        retmax: String(limit),
        retmode: "json",
        sort: "relevance",
      }) +
      tool;

    // Try the query we were given first (the ladder is calibrated for it).
    const es = await getJSON(esUrl(query)).catch(() => null);
    ids = (es && es.esearchresult && es.esearchresult.idlist) || [];

    // Fallback ladder: structured, then organism-focused
    if (!ids.length) {
      const structured = buildStructuredQuery(query);
      if (structured && structured !== query) {
        const es2 = await getJSON(esUrl(structured)).catch(() => null);
        ids = (es2 && es2.esearchresult && es2.esearchresult.idlist) || [];
      }
    }
    if (!ids.length) {
      const { orgPhrases, hasOrganism } = splitOrganismTopic(query);
      if (hasOrganism) {
        const orgOnly = orgPhrases
          .map((e) => (e.includes(" ") ? '"' + e + '"' : e))
          .join(" OR ");
        const es3 = await getJSON(esUrl(orgOnly)).catch(() => null);
        ids = (es3 && es3.esearchresult && es3.esearchresult.idlist) || [];
      }
    }
    if (!ids.length) return [];

    const idStr = ids.join(",");
    const [xml, summaryJson] = await Promise.all([
      getText(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?" +
          new URLSearchParams({ db: "pubmed", id: idStr, retmode: "xml" }) +
          tool
      ).catch(() => ""),
      getJSON(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?" +
          new URLSearchParams({ db: "pubmed", id: idStr, retmode: "json" }) +
          tool
      ).catch(() => null),
    ]);

    const fetched = xml ? parsePubmedXML(xml) : [];
    const byPmid = new Map(fetched.map((p) => [p.pmid, p]));
    const sumResult = (summaryJson && summaryJson.result) || {};
    const merged = [];
    for (const pmid of ids) {
      const s = sumResult[pmid];
      let rec = byPmid.get(pmid) || null;
      if (s && !rec) {
        rec = {
          title: s.title || "Untitled",
          url: "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/",
          year: (s.pubdate || "").slice(0, 4),
          citations: null,
          authors:
            (s.authors || []).slice(0, 1).map((a) => a.name).join("") +
            ((s.authors || []).length > 1 ? " et al." : ""),
          journal: s.fulljournalname || s.source || "PubMed",
          abstract: "",
          pmid,
        };
      } else if (rec && s) {
        if (!rec.year && s.pubdate) rec.year = (s.pubdate || "").slice(0, 4);
        if (!rec.authors && s.authors)
          rec.authors =
            s.authors.slice(0, 1).map((a) => a.name).join("") +
            (s.authors.length > 1 ? " et al." : "");
      }
      if (rec && rec.title) merged.push(rec);
    }
    // Include any fetched not already merged
    for (const p of fetched) {
      if (!merged.some((m) => m.pmid === p.pmid)) merged.push(p);
    }
    return merged;
  } catch {
    return [];
  }
}

// Looks like a scientific binomial (Genus species): 2+ words, first capitalized,
// second lowercase, italic-ish structure. Examples: "Populus angustifolia",
// "populus angustifolia", "P. angustifolia", "Hermetia illucens".
// Returns {binomial: "populus angustifolia", genus, species} or null.
// Detects a Latin binomial nomenclature (genus + species) inside a query.
// e.g. "Populus angustifolia", "populus angustifolia", "Hermetia illucens"
// Returns the binomial object, or null. Used to enforce strict species matching:
// searches for one species must NOT surface papers about a sibling species in the
// same genus (huge source of false positives in taxonomic queries).
function extractBinomial(raw) {
  const s = raw.trim();
  // Common non-taxonomic word pairs that fit the pattern
  const commonNonTaxonomic = new Set([
    "black soldier", "climate change", "gene expression", "cell division",
    "protein folding", "public health", "food security", "human genome",
    "narrow leafed", "cotton wood", "peer reviewed", "open source",
  ]);
  // Iterate through ALL matches, pick the first that looks taxonomic. This
  // means "Evolution of narrow leafed cotton wood trees Populus angustifolia"
  // correctly finds "Populus angustifolia" (title-cased), not "narrow leafed".
  const re = /\b([A-Z][a-z]{2,}|[a-z]{3,})\s+([a-z]{3,})\b/g;
  const hasTaxMarker = /\b(species|genus|subsp\.|var\.|cultivar|strain|clade|sp\.)\b/i.test(s);
  let m;
  while ((m = re.exec(s)) !== null) {
    const test = m[0].toLowerCase();
    if (commonNonTaxonomic.has(test)) continue;
    // Reject ordinary English words even when sentence-initial capitalization
    // makes them LOOK taxonomic. Without this guard, every question starting
    // "Can you...", "Compare the...", "Does the..." etc. (i.e. nearly every
    // question a user types) matches the FIRST word pair, is treated as a
    // genus+species, and permanently hijacks organism detection before the
    // regex ever reaches the real binomial later in the sentence. This was a
    // live production bug: "Compare the microbial diversity ... in Hermetia
    // illucens ..." returned {genus:"Compare", species:"the"} and searched
    // every engine for the literal phrase "Compare the" instead of the
    // organism, then passed its own broken species-gate because "the"
    // appears in virtually every abstract ever written.
    if (STOPWORDS.has(m[1].toLowerCase()) || STOPWORDS.has(m[2].toLowerCase())) continue;
    const looksTaxonomic = /^[A-Z]/.test(m[1]) || hasTaxMarker;
    if (!looksTaxonomic) continue;
    const genus = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    return { genus, species: m[2], full: genus + " " + m[2] };
  }
  return null;
}

// Looks like a person's name: 2-3 capitalized-word tokens, all letters.
// Used to trigger author-specific search paths.
function looksLikePersonName(raw) {
  const s = raw.trim();
  if (!s) return false;
  // If it's a Latin binomial, it's NOT a person name (Populus angustifolia matches
  // the shape of "Firstname Lastname" but is not a person).
  if (extractBinomial(raw)) return false;
  const toks = s.split(/\s+/);
  if (toks.length < 2 || toks.length > 4) return false;
  // Each token: only letters (allow hyphens/apostrophes), starts with uppercase in original
  const isNamey = toks.every((t) => /^[A-Z][a-zA-Z'\-]+\.?$/.test(t) || /^[A-Z]\.?$/.test(t));
  // Reject obvious topic-word starts like "How" "What"
  const q = ["how", "what", "why", "when", "where", "who", "which", "does", "is", "are", "can", "the"];
  if (q.includes(toks[0].toLowerCase())) return false;
  return isNamey;
}

// Words that are NEVER person surnames or first names, even though they might
// appear capitalized in a query. Used to filter out topic words when hunting
// for a name embedded inside a longer sentence.
const NAME_STOPWORDS = new Set([
  "BSFL", "DNA", "RNA", "CRISPR", "PCR", "PhD", "MD", "UTK", "MIT", "NIH",
  "USA", "UK", "US", "EU", "FDA", "CDC", "WHO", "NASA", "The", "This", "That",
  "These", "Those", "Black", "Soldier", "Fly", "Larvae",
]);

// Try to extract a person's name from ANY query, even if wrapped in extra words.
// Classifies whether a user's message is a NEW topic search, a FOLLOW-UP
// about the previous answer, or a CORRECTION to a prior fact. This decides
// whether to fire a fresh scholarly search or reuse the previous turn's
// sources and just re-prompt the AI with the new user turn.
//
// Signals for FOLLOW-UP: pronouns/deictics referring back ("that paper",
// "this study", "the finding", "it", "they"), agreement/refinement openers
// ("yes", "actually", "no it's", "wait", "you said"), meta comments about
// the previous answer ("the main point was", "you missed", "focus on"),
// or short messages (<= 8 words) that don't introduce new proper nouns.
//
// Signals for CORRECTION: explicit corrections ("that's wrong", "actually
// she's at", "not X but Y", "you got X wrong", "correction:"), or a
// short message negating something in the previous answer.
//
// Signals for NEW: introduces a new proper noun or Latin binomial not in
// history, starts with a fresh question word ("what/how/why/when/where"),
// or is long enough (>10 words) with clear new topic content.
function classifyIntent(query, history) {
  const q = (query || "").trim();
  if (!q) return { kind: "new" };
  const lc = q.toLowerCase();
  const wc = q.split(/\s+/).length;
  const hasHistory = Array.isArray(history) && history.length > 0;
  if (!hasHistory) return { kind: "new" };

  // Explicit correction phrases
  const correctionPatterns = [
    /^(that|this|it)['']?s\s+(wrong|incorrect|not right|false)/i,
    /^(actually|no,?\s+it['']?s|no,?\s+they['']?re|correction[:,])/i,
    /you\s+(got|had|were)\s+(that|this|it)\s+wrong/i,
    /^wrong\b/i,
    /^not\s+\w+,?\s+(it['']?s|they['']?re|but)\s+/i,
    /\bthat['']?s\s+not\s+(right|correct|true|him|her|them)/i,
    /\bnot\s+\w+\s+but\s+/i,
    /you\s+(said|mentioned|wrote)\s+.+\s+(but|however|actually)\s+/i,
  ];
  for (const re of correctionPatterns) {
    if (re.test(q)) return { kind: "correction" };
  }

  // Follow-up indicators
  const followupOpeners = /^(yes|no|but|and|so|okay|ok|right|hmm|well|wait|hey)\b/i;
  const backReferences = /\b(that\s+(papers?|stud(?:y|ies)|research|works?|findings?|results?|authors?|persons?|one)|this\s+(papers?|stud(?:y|ies)|research|works?|findings?|results?)|the\s+(papers?|stud(?:y|ies)|research|works?|findings?|results?|authors?|persons?|one|main\s+point|main\s+finding|sources?|citations?|references?)|it|its|they|them|their|he|she|his|her|him)\b/i;
  const metaAboutPrevious = /\b(you\s+(said|mentioned|wrote|missed|forgot|focused|talked)|main\s+point|main\s+finding|focus\s+on|more\s+about|tell\s+me\s+more|expand|elaborate|clarify|what\s+about|and\s+what|what\s+does|what\s+did|explain\s+more|dig\s+deeper|go\s+deeper|where\s+(are|were)\s+the\s+(papers?|sources?|stud(?:y|ies)|citations?|references?)|show\s+me\s+the\s+(papers?|sources?|citations?)|list\s+the\s+(papers?|sources?|citations?)|what\s+(papers?|sources?|citations?)\s+(did|do|were|are))\b/i;
  const shortReply = wc <= 8;

  const hasBackRef = backReferences.test(q);
  const isFollowupOpener = followupOpeners.test(q);
  const isMeta = metaAboutPrevious.test(q);

  // Check whether the message introduces significant new proper nouns
  // (capitalized words the history doesn't contain). If it does, it's likely
  // a new topic even if it also has pronouns.
  const historyText = history
    .map((t) => (t && t.content) || "")
    .join(" ")
    .toLowerCase();
  const newProperNouns = q
    .split(/\s+/)
    .filter((w) => /^[A-Z][a-z]{2,}$/.test(w))
    .filter((w) => !historyText.includes(w.toLowerCase()));
  const introducesNewTopic = newProperNouns.length >= 2; // 2+ new capitalized words = probably new topic

  if (introducesNewTopic) return { kind: "new" };

  // `meta: true` marks the highest-confidence followup signal — the user is
  // explicitly commenting on the PREVIOUS turn ("you forgot...", "you
  // missed...", "focus on...", "tell me more"), not stating a new topic.
  // Downstream, this is used to stop a cruder word-overlap heuristic from
  // overriding this classification just because the complaint's wording
  // happens to share few words with the original query — which it usually
  // will, since "you forgot to provide BSFL papers" is ABOUT the omission,
  // not a restatement of the topic.
  if (isMeta || (hasBackRef && (isFollowupOpener || shortReply))) {
    return { kind: "followup", meta: isMeta };
  }
  if (isFollowupOpener && shortReply) return { kind: "followup", meta: false };

  return { kind: "new" };
}

// E.g. "Reese Sahos studies on BSFL" -> "Reese Saho".
// Handles possessive forms (drops trailing 's or s when followed by a possessive
// context word like "studies", "papers", "research").
// Handles middle initials (Reese J Saho, Reese J. Saho).
// Returns the canonical name or null if nothing looks like a name.
function extractPersonNameFromQuery(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // If the query IS itself just a clean name, return it
  if (looksLikePersonName(s)) return s;

  // Otherwise, scan the query for a run of 2-3 name-shaped tokens.
  const toks = s.split(/\s+/);
  const isNameToken = (t) => {
    if (!t) return false;
    if (/^[A-Z]\.?$/.test(t)) return true;
    if (!/^[A-Z][a-zA-Z'\-]+$/.test(t)) return false;
    if (NAME_STOPWORDS.has(t)) return false;
    if (t.length >= 3 && t === t.toUpperCase()) return false;
    return true;
  };

  // Words that indicate the preceding word is a person's name in possessive form.
  const possessiveContext = new Set([
    "studies", "study", "papers", "paper", "research", "work", "works",
    "publications", "publication", "findings", "finding", "results", "result",
    "experiments", "experiment", "thesis", "dissertation", "articles", "article",
    "lab", "group", "team", "hypothesis", "theory", "approach", "method",
    "methods", "data", "dataset",
  ]);

  let bestName = null;
  for (let i = 0; i < toks.length; i++) {
    if (!isNameToken(toks[i])) continue;
    for (let len = 4; len >= 2; len--) {
      if (i + len > toks.length) continue;
      const chunk = toks.slice(i, i + len);
      // Middle initial can't be the LAST token
      if (/^[A-Z]\.?$/.test(chunk[chunk.length - 1])) continue;
      // First and last must be full words (2+ chars)
      if (chunk[0].length < 2 || chunk[chunk.length - 1].length < 2) continue;
      if (chunk.every(isNameToken)) {
        bestName = { toks: chunk, endIdx: i + len };
        break;
      }
    }
    if (bestName) break;
  }
  if (!bestName) return null;

  // Now apply possessive stripping on the last name token, using the word
  // AFTER the name as context to decide.
  const nextWord = (toks[bestName.endIdx] || "").toLowerCase().replace(/[.,;:?!]/g, "");
  const nameToks = bestName.toks.slice();
  const last = nameToks[nameToks.length - 1];

  if (/'s$/i.test(last)) {
    // "Saho's" — always safe to strip
    nameToks[nameToks.length - 1] = last.replace(/'s$/i, "");
  } else if (/s'$/i.test(last)) {
    nameToks[nameToks.length - 1] = last.replace(/s'$/i, "");
  } else if (
    // "Sahos studies" — trailing bare 's' followed by a possessive context word
    /[a-z]s$/.test(last) &&
    last.length > 3 &&
    !/ss$/i.test(last) &&
    possessiveContext.has(nextWord)
  ) {
    nameToks[nameToks.length - 1] = last.slice(0, -1);
  }
  return nameToks.join(" ");
}

// Direct bioRxiv API: pulls up to 100 recent preprints and filters by author
// name. Only finds someone if their preprint is public on bioRxiv itself. Not
// mirrored through OpenAlex or PubMed, so this catches things those miss.
async function biorxivDirectAuthor(fullName) {
  return preprintServerAuthor("biorxiv", fullName);
}
async function medrxivDirectAuthor(fullName) {
  return preprintServerAuthor("medrxiv", fullName);
}
async function preprintServerAuthor(server, fullName) {
  try {
    // bioRxiv/medRxiv have a "details" API but no search-by-author endpoint.
    // We use the interval endpoint to pull the last 6 months of preprints (up
    // to ~1000 items) and filter locally by author. Rough but works for
    // finding early-career researchers whose one preprint isn't indexed yet.
    const now = new Date();
    const six = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    const iso = (d) => d.toISOString().slice(0, 10);
    const url = "https://api.biorxiv.org/details/" + server + "/" + iso(six) + "/" + iso(now) + "/0";
    const data = await getJSON(url, {}, 5000);
    const items = (data && data.collection) || [];
    const nameLC = fullName.toLowerCase();
    const tokens = nameLC.split(/\s+/).filter(Boolean);
    const hits = items.filter((it) => {
      const auths = (it.authors || "").toLowerCase();
      return tokens.every((t) => auths.includes(t));
    });
    return hits.slice(0, 10).map((it) => ({
      title: it.title || "Untitled",
      // Bug: when a preprint has no DOI yet, the old fallback re-used the
      // same falsy `it.doi` inside the "no DOI" branch, producing a dead
      // link like ".../content/undefined". Fall back to a search link built
      // from the title instead, which always resolves to something useful.
      url: it.doi
        ? "https://doi.org/" + it.doi
        : "https://www.biorxiv.org/search/" + encodeURIComponent(it.title || fullName),
      year: (it.date || "").slice(0, 4),
      citations: null,
      authors: it.authors || "",
      journal: server === "biorxiv" ? "bioRxiv (preprint)" : "medRxiv (preprint)",
      abstract: it.abstract || "",
    }));
  } catch {
    return [];
  }
}

// Generic web search fallback via a keyless search index. Used only when
// scholarly + author + wiki all come up empty, so we never return "nothing."
async function genericWebSearch(query) {
  try {
    // Wikipedia opensearch: fast, no auth, returns page titles and short descriptions
    const url =
      "https://en.wikipedia.org/w/api.php?" +
      new URLSearchParams({
        action: "opensearch",
        search: query,
        limit: "5",
        namespace: "0",
        format: "json",
        origin: "*",
      });
    const data = await getJSON(url, {}, 4000);
    if (!Array.isArray(data) || data.length < 4) return [];
    const [, titles, descs, urls] = data;
    const out = [];
    for (let i = 0; i < titles.length; i++) {
      if (!descs[i] || !urls[i]) continue;
      out.push({
        title: titles[i],
        url: urls[i],
        year: "",
        citations: null,
        authors: "Wikipedia",
        journal: "Wikipedia",
        abstract: descs[i],
        source: "web",
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function openAlex(query, limit = 10, key = "") {
  try {


    const params = new URLSearchParams({
      search: query,
      // Ask OpenAlex to only hand back actual literature in the first place —
      // don't rely on the post-fetch reject filter alone to do this work. The
      // pipe is OpenAlex's own OR syntax for multiple values on one filter
      // field (the exact mechanism `biorxiv()` above already trusts for
      // `type:preprint`); "article" is OpenAlex's label for a journal article.
      // A dataset deposit, a component record, a book chapter etc. never
      // matches either arm and is dropped server-side before it costs us a
      // slot in `limit`.
      filter: "type:article|preprint",
      sort: "relevance_score:desc",
      per_page: String(limit),
      select:
        "title,doi,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships,ids,type",
      mailto: "contact@askcerebrum.org",
    });
    if (key) params.set("api_key", key);
    const data = await getJSON("https://api.openalex.org/works?" + params);
    return (data.results || [])
      .map((w) => {
        const first =
          (w.authorships && w.authorships[0] && w.authorships[0].author && w.authorships[0].author.display_name) || "";
        const rawPmcid = (w.ids && w.ids.pmcid) || "";
        const pmcid = rawPmcid.replace(/^https?:\/\/.*?\/(PMC\d+)$/i, "$1").replace(/[^0-9]/g, "");
        return {
          title: w.title || "Untitled",
          url:
            w.doi ||
            (w.primary_location && (w.primary_location.landing_page_url || w.primary_location.pdf_url)) ||
            "",
          year: w.publication_year || "",
          citations: typeof w.cited_by_count === "number" ? w.cited_by_count : null,
          authors:
            w.authorships && w.authorships.length > 1
              ? first + " et al."
              : first,
          // Full author list preserved for downstream filtering (e.g. did a
          // specific researcher actually write this paper?). Display uses
          // `authors` (short); logic uses `_allAuthors` (full).
          _allAuthors: (w.authorships || [])
            .map((a) => (a && a.author && a.author.display_name) || "")
            .filter(Boolean)
            .join(", "),
          journal:
            (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) ||
            "OpenAlex",
          abstract: decodeInverted(w.abstract_inverted_index),
          pmcid: pmcid || "",
          // Belt-and-suspenders: the `filter` above should mean this is
          // always "article" or "preprint" already, but the universal
          // post-fetch reject filter (isNonLiterature) re-checks it anyway —
          // an upstream filter param silently failing should never be the
          // only thing standing between a dataset record and the sidebar.
          _rawType: w.type || "",
        };
      })
      .filter((p) => p.title);
  } catch {
    return [];
  }
}

async function crossref(query, limit = 8) {
  try {
    const url =
      "https://api.crossref.org/works?" +
      new URLSearchParams({
        query,
        rows: String(limit),
        // Crossref's `type` vocabulary doesn't have a literal "preprint"
        // value — preprints deposited there are typed "posted-content", which
        // also covers things like conference abstracts, so filtering it in
        // here would let non-literature back in through the side door.
        // Preprints are already covered by the dedicated `biorxiv()`/
        // `medrxiv()` fetchers elsewhere in the ladder, so this fetcher is
        // scoped to its strongest, unambiguous signal: real journal articles.
        filter: "type:journal-article",
        select:
          "title,author,container-title,published,DOI,abstract,is-referenced-by-count,type",
      }) +
      "&mailto=contact@askcerebrum.org";
    const data = await getJSON(url);
    const items = (data && data.message && data.message.items) || [];
    return items
      .map((it) => ({
        title: Array.isArray(it.title) ? it.title[0] : it.title || "Untitled",
        url: it.DOI ? "https://doi.org/" + it.DOI : "",
        year:
          (it.published &&
            it.published["date-parts"] &&
            it.published["date-parts"][0] &&
            it.published["date-parts"][0][0]) ||
          "",
        citations:
          typeof it["is-referenced-by-count"] === "number"
            ? it["is-referenced-by-count"]
            : null,
        authors:
          (it.author || [])
            .slice(0, 1)
            .map((a) => ((a.given || "") + " " + (a.family || "")).trim())
            .join("") + ((it.author || []).length > 1 ? " et al." : ""),
        _allAuthors: (it.author || [])
          .map((a) => ((a.given || "") + " " + (a.family || "")).trim())
          .filter(Boolean)
          .join(", "),
        journal: Array.isArray(it["container-title"])
          ? it["container-title"][0]
          : it["container-title"] || "Crossref",
        abstract: stripTags(it.abstract || ""),
        _rawType: it.type || "",
      }))
      .filter((p) => p.title);
  } catch {
    return [];
  }
}

async function arxiv(query, limit = 6) {
  try {
    const url =
      "https://export.arxiv.org/api/query?" +
      new URLSearchParams({
        search_query: "all:" + query,
        max_results: String(limit),
        sortBy: "relevance",
      });
    const xml = await getText(url);
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    return entries
      .map((e) => {
        const g = (re) => {
          const m = e.match(re);
          return m ? m[1].trim() : "";
        };
        const title = stripTags(g(/<title>([\s\S]*?)<\/title>/));
        const summary = stripTags(g(/<summary>([\s\S]*?)<\/summary>/));
        const id = g(/<id>([\s\S]*?)<\/id>/);
        const published = g(/<published>(\d{4})/);
        const authorNames = (e.match(/<name>([\s\S]*?)<\/name>/g) || []).map(
          (a) => a.replace(/<\/?name>/g, "").trim()
        );
        return {
          title: title || "arXiv paper",
          url: id,
          year: published || "",
          citations: null,
          authors:
            authorNames.length > 1
              ? authorNames[0] + " et al."
              : authorNames[0] || "",
          _allAuthors: authorNames.join(", "),
          journal: "arXiv",
          abstract: summary,
        };
      })
      .filter((p) => p.title);
  } catch {
    return [];
  }
}

// Semantic Scholar's own `publicationTypes` enum includes a literal
// "Dataset" value alongside real literature types — asking for everything
// EXCEPT Dataset (rather than an allowlist of just "JournalArticle") keeps
// reviews, meta-analyses, conference papers, and case reports in the mix
// instead of silently narrowing the source the way a tight allowlist would.
const S2_LITERATURE_TYPES = [
  "JournalArticle",
  "Review",
  "MetaAnalysis",
  "CaseReport",
  "ClinicalTrial",
  "Conference",
  "Study",
  "Book",
  "BookSection",
].join(",");

async function semanticScholar(query, limit = 8) {
  try {
    const url =
      "https://api.semanticscholar.org/graph/v1/paper/search?" +
      new URLSearchParams({
        query,
        limit: String(limit),
        publicationTypes: S2_LITERATURE_TYPES,
        fields:
          "title,abstract,tldr,year,citationCount,authors,venue,externalIds,openAccessPdf,url,publicationTypes",
      });
    const data = await getJSON(url);
    return ((data && data.data) || [])
      .filter((r) => r.title)
      .map((r) => {
        const doi = r.externalIds && r.externalIds.DOI;
        return {
          title: r.title || "Untitled",
          url: doi
            ? "https://doi.org/" + doi
            : (r.openAccessPdf && r.openAccessPdf.url) || r.url || "",
          year: r.year || "",
          citations: typeof r.citationCount === "number" ? r.citationCount : null,
          authors:
            (r.authors || []).slice(0, 1).map((a) => a.name).join("") +
            ((r.authors || []).length > 1 ? " et al." : ""),
          _allAuthors: (r.authors || []).map((a) => a.name).filter(Boolean).join(", "),
          journal: r.venue || "Semantic Scholar",
          abstract: r.abstract || "",
          tldr: (r.tldr && r.tldr.text) || "",
          // `publicationTypes` comes back as an array (can be null/empty for
          // sparsely-catalogued records) — flatten to a comma string so the
          // universal reject filter can pattern-match it the same way it
          // matches every other source's `_rawType`.
          _rawType: Array.isArray(r.publicationTypes) ? r.publicationTypes.join(",") : "",
        };
      });
  } catch {
    return [];
  }
}

async function doaj(query, limit = 6) {
  try {
    const url =
      "https://doaj.org/api/search/articles/" +
      encodeURIComponent(query) +
      "?pageSize=" +
      limit;
    const data = await getJSON(url);
    return ((data && data.results) || [])
      .map((r) => {
        const b = r.bibjson || {};
        const doiId = (b.identifier || []).find((x) => x.type === "doi");
        const link = (b.link || [])[0];
        return {
          title: b.title || "Untitled",
          url: doiId ? "https://doi.org/" + doiId.id : (link && link.url) || "",
          year: b.year || "",
          citations: null,
          authors:
            (b.author || []).slice(0, 1).map((a) => a.name).join("") +
            ((b.author || []).length > 1 ? " et al." : ""),
          journal: (b.journal && b.journal.title) || "DOAJ",
          abstract: stripTags(b.abstract || ""),
        };
      })
      .filter((p) => p.title);
  } catch {
    return [];
  }
}

async function biorxiv(query, limit = 6) {
  try {
    const params = new URLSearchParams({
      search: query,
      filter: "type:preprint",
      sort: "relevance_score:desc",
      per_page: String(limit),
      select:
        "title,doi,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships",
      mailto: "contact@askcerebrum.org",
    });
    const data = await getJSON("https://api.openalex.org/works?" + params);
    const out = [];
    for (const w of (data.results || [])) {
      if (!w.title) continue;
      const first =
        (w.authorships && w.authorships[0] && w.authorships[0].author && w.authorships[0].author.display_name) || "";
      out.push({
        title: w.title,
        url:
          w.doi ||
          (w.primary_location && w.primary_location.landing_page_url) ||
          "",
        year: w.publication_year || "",
        citations: typeof w.cited_by_count === "number" ? w.cited_by_count : null,
        authors:
          w.authorships && w.authorships.length > 1
            ? first + " et al."
            : first,
        journal:
          (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) ||
          "Preprint",
        abstract: decodeInverted(w.abstract_inverted_index),
      });
    }
    return out;
  } catch {
    return [];
  }
}

// v34: Zenodo hosts a mix of genuine papers, posters, presentations, and raw
// data/software deposits, with no clean way to tell them apart from this
// endpoint's response alone — which is exactly the ambiguity that let a raw
// dataset get cited as if it were literature. The new hard-reject filter
// (isNonLiterature, in paperDedupeKey's neighborhood above) treats any
// zenodo.org URL as non-literature across the board, per explicit direction,
// so every result this function returns is now discarded downstream before
// it can reach an answer. Left in place rather than removed — deleting it
// (and its entry in `sourceNames`/the "14 databases" this app advertises)
// is a bigger, riskier change than the data-quality bug actually required,
// and this comment is here so the next person who notices "zenodo never
// shows results" understands why without re-deriving it.
async function zenodo(query, limit = 4) {
  try {
    const url =
      "https://zenodo.org/api/records?" +
      new URLSearchParams({ q: query, size: String(limit), sort: "mostrecent" });
    const data = await getJSON(url);
    return ((data && data.hits && data.hits.hits) || [])
      .map((r) => {
        const md = r.metadata || {};
        return {
          title: md.title || "Untitled",
          url:
            r.doi_url ||
            (md.doi ? "https://doi.org/" + md.doi : "") ||
            (r.links && r.links.self_html) ||
            "",
          year: (md.publication_date || "").slice(0, 4),
          citations: null,
          authors:
            (md.creators || []).slice(0, 1).map((a) => a.name).join("") +
            ((md.creators || []).length > 1 ? " et al." : ""),
          journal: "Zenodo",
          abstract: stripTags(md.description || ""),
        };
      })
      .filter((p) => p.title);
  } catch {
    return [];
  }
}

async function plos(query, limit = 6) {
  try {
    const url =
      "https://api.plos.org/search?" +
      new URLSearchParams({
        q: query,
        fl: "id,title_display,author_display,journal,publication_date,abstract",
        wt: "json",
        rows: String(limit),
      });
    const data = await getJSON(url);
    return ((data && data.response && data.response.docs) || [])
      .map((d) => ({
        title: Array.isArray(d.title_display)
          ? d.title_display[0]
          : d.title_display || "Untitled",
        url: d.id ? "https://doi.org/" + d.id : "",
        year: (d.publication_date || "").slice(0, 4),
        citations: null,
        authors:
          (d.author_display || []).slice(0, 1).join("") +
          ((d.author_display || []).length > 1 ? " et al." : ""),
        journal: d.journal || "PLOS",
        abstract: stripTags(
          Array.isArray(d.abstract) ? d.abstract.join(" ") : d.abstract || ""
        ),
      }))
      .filter((p) => p.title);
  } catch {
    return [];
  }
}

// ---- ADDITIONAL SCHOLARLY APIs ----

async function coreSearch(query, limit = 8) {
  try {
    const url = "https://api.core.ac.uk/v3/search/works?" +
      new URLSearchParams({ q: query, limit: String(limit) });
    const data = await getJSON(url, {}, 6000);
    return ((data && data.results) || []).filter((r) => r.title).map((r) => ({
      title: r.title || "Untitled",
      url: r.doi ? "https://doi.org/" + r.doi : (r.downloadUrl || ""),
      year: r.yearPublished ? String(r.yearPublished) : "",
      citations: null,
      authors: (r.authors || []).map((a) => a.name || "").slice(0, 1).join("") + ((r.authors || []).length > 1 ? " et al." : ""),
      _allAuthors: (r.authors || []).map((a) => a.name || "").join(", "),
      journal: r.publisher || "CORE",
      abstract: stripTags((r.abstract || "").slice(0, 1500)),
    }));
  } catch { return []; }
}

async function baseSearch(query, limit = 8) {
  try {
    const url = "https://api.base-search.net/cgi-bin/BaseHttpSearchInterface.fcgi?" +
      new URLSearchParams({ func: "PerformSearch", query: query, format: "json", hits: String(limit) });
    const data = await getJSON(url, {}, 6000);
    return ((data && data.response && data.response.docs) || []).filter((d) => d.dctitle).map((d) => ({
      title: Array.isArray(d.dctitle) ? d.dctitle[0] : (d.dctitle || "Untitled"),
      url: (Array.isArray(d.dcidentifier) ? d.dcidentifier.find((u) => (u||"").startsWith("http")) : d.dcidentifier) || "",
      year: Array.isArray(d.dcyear) ? d.dcyear[0] : (d.dcyear || ""),
      citations: null,
      authors: Array.isArray(d.dcperson) ? d.dcperson.slice(0,1).join("") + (d.dcperson.length > 1 ? " et al." : "") : (d.dcperson || ""),
      _allAuthors: Array.isArray(d.dcperson) ? d.dcperson.join(", ") : (d.dcperson || ""),
      journal: Array.isArray(d.dcsource) ? d.dcsource[0] : (d.dcsource || "BASE"),
      abstract: stripTags(Array.isArray(d.dcdescription) ? d.dcdescription.join(" ").slice(0,1500) : (d.dcdescription || "").slice(0,1500)),
    }));
  } catch { return []; }
}

async function pmcFullText(query, limit = 8) {
  try {
    const url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
      new URLSearchParams({ query: '(BODY:"' + query + '")', resultType: "core", pageSize: String(limit), format: "json", sort: "relevance" });
    const data = await getJSON(url, {}, 6000);
    return ((data && data.resultList && data.resultList.result) || []).filter((r) => r.title).map((r) => ({
      title: r.title || "Untitled",
      url: r.doi ? "https://doi.org/" + r.doi : "https://europepmc.org/article/" + r.source + "/" + r.id,
      year: r.pubYear || "",
      citations: typeof r.citedByCount === "number" ? r.citedByCount : null,
      authors: r.authorString || "",
      _allAuthors: r.authorString || "",
      journal: r.journalTitle || "PMC",
      abstract: stripTags(r.abstractText),
    }));
  } catch { return []; }
}

async function openAire(query, limit = 8) {
  try {
    const url = "https://api.openaire.eu/search/publications?" +
      new URLSearchParams({ keywords: query, size: String(limit), format: "json" });
    const data = await getJSON(url, {}, 6000);
    const results = data?.response?.results?.result || [];
    return results.filter((r) => r?.metadata?.["oaf:entity"]?.["oaf:result"]?.title).map((r) => {
      const m = r.metadata["oaf:entity"]["oaf:result"];
      const t = typeof m.title === "string" ? m.title : (m.title?.["$"] || "Untitled");
      const creators = Array.isArray(m.creator) ? m.creator : (m.creator ? [m.creator] : []);
      const names = creators.map((c) => c?.["$"] || "").filter(Boolean);
      const pids = Array.isArray(m.pid) ? m.pid : (m.pid ? [m.pid] : []);
      const doi = pids.find((p) => p?.["@classid"] === "doi");
      // Bug: dateofacceptance comes back as {"$": "2021-04-01"} (same shape as
      // title/description above), not a plain string. Calling .slice() on
      // that object threw on every single result, and since this whole
      // .map() runs inside the function's own try/catch, the exception was
      // silently swallowed and openAire() always returned [] — this source
      // never actually contributed a single paper. Unwrap it like the other
      // OAI-PMH-shaped fields already do.
      const acceptDate = typeof m.dateofacceptance === "string" ? m.dateofacceptance : (m.dateofacceptance?.["$"] || "");
      return {
        title: t, url: doi ? "https://doi.org/" + doi["$"] : "",
        year: acceptDate.slice(0,4), citations: null,
        authors: names.slice(0,1).join("") + (names.length > 1 ? " et al." : ""),
        _allAuthors: names.join(", "),
        journal: m.journal?.["$"] || "OpenAIRE",
        abstract: stripTags((typeof m.description === "string" ? m.description : (m.description?.["$"] || "")).slice(0,1500)),
      };
    }).filter((p) => p.title && p.title !== "Untitled");
  } catch { return []; }
}


async function wikipedia(query, limit = 2) {
  try {
    const searchUrl =
      "https://en.wikipedia.org/w/api.php?" +
      new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: query,
        srlimit: String(limit),
        format: "json",
        origin: "*",
      });
    const sdata = await getJSON(searchUrl, {}, 4000);
    const hits = (sdata && sdata.query && sdata.query.search) || [];
    const out = [];
    for (const h of hits) {
      const title = h.title;
      try {
        const exUrl =
          "https://en.wikipedia.org/w/api.php?" +
          new URLSearchParams({
            action: "query",
            prop: "extracts",
            exintro: "1",
            explaintext: "1",
            titles: title,
            format: "json",
            origin: "*",
          });
        const ex = await getJSON(exUrl, {}, 4000);
        const pages = (ex && ex.query && ex.query.pages) || {};
        const page = Object.values(pages)[0] || {};
        const extract = (page.extract || "").replace(/\s+/g, " ").trim();
        if (extract) {
          out.push({
            title: title + " (Wikipedia)",
            url:
              "https://en.wikipedia.org/wiki/" +
              encodeURIComponent(title.replace(/ /g, "_")),
            year: "",
            citations: null,
            authors: "Wikipedia contributors",
            journal: "Wikipedia",
            abstract: extract.slice(0, 1500),
            isEncyclopedia: true,
          });
        }
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

async function duckduckgo(query) {
  try {
    const url =
      "https://api.duckduckgo.com/?" +
      new URLSearchParams({
        q: query,
        format: "json",
        no_html: "1",
        skip_disambig: "1",
      });
    const data = await getJSON(url, {}, 4000);
    const abstract = ((data && data.AbstractText) || "").trim();
    if (!abstract) return [];
    return [
      {
        title: (data.Heading || query) + " (" + (data.AbstractSource || "Web") + ")",
        url: data.AbstractURL || "",
        year: "",
        citations: null,
        authors: data.AbstractSource || "Web",
        journal: data.AbstractSource || "Web",
        abstract: abstract.slice(0, 1200),
        isEncyclopedia: true,
      },
    ];
  } catch {
    return [];
  }
}

// ============ VIDEO SEARCH ============
// Races multiple public Piped/Invidious instances. If one works, we use it.
// Instance list is refreshed with known-working ones and rotated randomly.

const VIDEO_INSTANCES = [
  { type: "piped", url: "https://pipedapi.kavin.rocks" },
  { type: "piped", url: "https://api.piped.projectsegfau.lt" },
  { type: "piped", url: "https://pipedapi.adminforge.de" },
  { type: "piped", url: "https://pipedapi.reallyaweso.me" },
  { type: "piped", url: "https://pipedapi.leptons.xyz" },
  { type: "piped", url: "https://pipedapi.ducks.party" },
  { type: "piped", url: "https://pipedapi.r4fo.com" },
  { type: "piped", url: "https://pipedapi.us.projectsegfau.lt" },
  { type: "piped", url: "https://pipedapi.drgns.space" },
  { type: "piped", url: "https://pipedapi.orsi.uk" },
  { type: "invidious", url: "https://invidious.nerdvpn.de" },
  { type: "invidious", url: "https://inv.nadeko.net" },
  { type: "invidious", url: "https://iv.ggtyler.dev" },
  { type: "invidious", url: "https://invidious.privacyredirect.com" },
  { type: "invidious", url: "https://invidious.f5.si" },
  { type: "invidious", url: "https://inv.tux.pizza" },
  { type: "invidious", url: "https://invidious.perennialte.ch" },
  { type: "invidious", url: "https://invidious.jing.rocks" },
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function tryVideoInstance(inst, query, timeoutMs) {
  const qs = encodeURIComponent(query + " lecture explained");
  const url =
    inst.type === "piped"
      ? inst.url + "/search?q=" + qs + "&filter=videos"
      : inst.url + "/api/v1/search?q=" + qs + "&type=video";

  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: c.signal,
      headers: { "User-Agent": "Mozilla/5.0 Cerebrum" },
    });
    clearTimeout(t);
    if (!res.ok) { await res.text().catch(() => {}); throw new Error("HTTP " + res.status); }
    const data = await res.json();

    // Normalize shape between Piped and Invidious
    const items = Array.isArray(data) ? data : data.items || [];
    if (!items.length) throw new Error("empty");

    const seen = new Set();
    const out = [];
    for (const item of items) {
      let vId = "";
      if (item.videoId) vId = item.videoId;
      else if (item.url && item.url.indexOf("/watch?v=") !== -1)
        vId = item.url.replace(/^.*\/watch\?v=/, "").split("&")[0];
      if (!vId || seen.has(vId)) continue;
      seen.add(vId);
      const title = item.title || "Video";
      const author =
        item.author ||
        item.uploaderName ||
        item.uploader ||
        item.channel ||
        "Channel";
      out.push({
        title,
        url: "https://www.youtube.com/watch?v=" + vId,
        author,
        thumbnail: "https://i.ytimg.com/vi/" + vId + "/hqdefault.jpg",
        id: vId,
      });
      if (out.length >= 6) break;
    }
    if (!out.length) throw new Error("no valid items");
    return out;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

// Direct YouTube search via HTML scrape. YouTube embeds a JSON payload
// (ytInitialData) in the HTML of its search results page. This works from
// Cloudflare Workers because YouTube doesn't block Cloudflare IPs the way
// the community Piped/Invidious instances do. Keyless, free, and reliable.
async function youtubeDirectSearch(query, limit = 6) {
  const url =
    "https://www.youtube.com/results?" +
    new URLSearchParams({ search_query: query + " lecture explained" });
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const res = await fetch(url, {
      signal: c.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const html = await res.text();

    // Extract ytInitialData JSON blob
    const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
    if (!m) return [];
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      return [];
    }

    // Navigate the nested structure to find video results
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents || [];
    const out = [];
    const seen = new Set();

    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const v = item?.videoRenderer;
        if (!v || !v.videoId) continue;
        if (seen.has(v.videoId)) continue;
        seen.add(v.videoId);

        const title =
          v.title?.runs?.map((r) => r.text).join("") ||
          v.title?.simpleText ||
          "Video";
        const author =
          v.ownerText?.runs?.[0]?.text ||
          v.longBylineText?.runs?.[0]?.text ||
          "Channel";
        // High-quality thumbnail
        const thumbs = v.thumbnail?.thumbnails || [];
        const thumbnail =
          thumbs[thumbs.length - 1]?.url ||
          "https://i.ytimg.com/vi/" + v.videoId + "/hqdefault.jpg";

        out.push({
          title,
          url: "https://www.youtube.com/watch?v=" + v.videoId,
          author,
          thumbnail,
          id: v.videoId,
        });
        if (out.length >= limit) return out;
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchVideos(query, maxMs = 3000) {
  const cleaned = cleanQuery(query) || query;

  // Wrap everything in a hard time cap so this never blocks the answer.
  const timedRace = new Promise((resolve) => setTimeout(() => resolve([]), maxMs));

  const doFetch = async () => {
    // TIER 1: Direct YouTube (works from Cloudflare, keyless).
    const direct = await youtubeDirectSearch(cleaned, 6).catch(() => []);
    if (direct.length) return direct;

    // TIER 2: Proxies
    const shuffled = shuffle(VIDEO_INSTANCES);
    const batchSize = 4;
    for (let i = 0; i < shuffled.length; i += batchSize) {
      const batch = shuffled.slice(i, i + batchSize);
      const promises = batch.map((inst) => tryVideoInstance(inst, cleaned, 2000));
      try {
        const result = await Promise.any(promises);
        if (result && result.length) return result;
      } catch {}
    }
    return [];
  };

  return Promise.race([doFetch(), timedRace]);
}

// ============ LLM-POWERED QUERY GENERATION ============
// When mechanical term extraction fails (wrong vocabulary, too narrow, user
// phrased it colloquially), ask a fast LLM to generate the search queries a
// scientist would actually type into PubMed. This is the "make it think like
// Claude" fix — mechanical string manipulation can never match an LLM's
// understanding of what the user actually needs.
//
// Returns an array of 3-5 search query strings optimized for scholarly databases.
// Falls back to empty array on any failure (timeout, rate limit, etc).
async function llmGenerateSearchQueries(rawQuery, token) {
  if (!token) return [];
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000); // 5s max — this runs in parallel
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, "HTTP-Referer": "https://askcerebrum.org", "X-Title": "Cerebrum" },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat-v3-0324:free",
        temperature: 0.1,
        max_tokens: 300,
        messages: [{
          role: "system",
          content: "You are a scientific literature search specialist. Given a user's question, generate 4-6 PubMed/Google Scholar search queries that would find the most relevant papers. Rules:\n" +
            "- Use proper scientific terminology (binomial names, technical terms)\n" +
            "- Each query should be 3-7 words, no boolean operators\n" +
            "- Include the scientific name if an organism is mentioned (e.g. 'black soldier fly' → 'Hermetia illucens')\n" +
            "- Vary vocabulary across queries (one might say 'microbiome', another 'microbiota', another 'bacterial community')\n" +
            "- At least one query should be broad (just organism + general topic)\n" +
            "- At least one query should be very specific (exact mechanism/process)\n" +
            "- Output ONLY a JSON array of strings, nothing else. No markdown, no explanation."
        }, {
          role: "user",
          content: rawQuery
        }]
      }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    // Parse JSON array from response
    const clean = txt.replace(/```json|```/g, "").trim();
    try {
      const arr = JSON.parse(clean);
      if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === "string") {
        return arr.slice(0, 6).map(s => s.trim()).filter(s => s.length > 3 && s.length < 100);
      }
    } catch {}
    // Fallback: try to extract lines
    return clean.split("\n").map(l => l.replace(/^[\d\.\-\*\s"]+|"$/g, "").trim()).filter(s => s.length > 3 && s.length < 100).slice(0, 6);
  } catch {
    return [];
  }
}

// ============ LLM-POWERED PAPER VALIDATION ============
// Before sending papers to the answer LLM, verify each one actually addresses
// the user's question. This prevents the #1 failure mode: the AI confidently
// citing a tsetse fly paper as if it's about BSF gut microbiome.
// Returns filtered array of papers that are genuinely relevant.
// ============ ORGANISM-AWARE PAPER HARD-FILTER ============
// Programmatic pre-filter that runs BEFORE the LLM validator. This catches
// the most obvious wrong-organism contamination with zero latency and zero
// API cost. The LLM validator then runs on the survivors for nuanced cases.
//
// The key insight: if the user asks about "BSFL microbiome" (Hermetia illucens),
// a paper whose title+abstract contains "millipede" / "Diplopoda" / "Julida"
// but NEVER mentions "Hermetia" or "black soldier fly" is categorically wrong.
// No LLM judgment needed — it's a hard taxonomic mismatch.

// Common organism names that, if found in a paper but NOT in the query,
// indicate the paper is about the WRONG organism. Each entry maps to taxa
// that would be a clear mismatch for queries about other organisms.
const CONTAMINANT_ORGANISMS = [
  // Arthropods that are NOT black soldier fly
  { patterns: [/\bmillipede/i, /\bdiplopoda/i, /\bjulida\b/i, /\bmyriapod/i], label: "millipede" },
  { patterns: [/\bcentipede/i, /\bchilopoda/i], label: "centipede" },
  { patterns: [/\bcockroach/i, /\bblattodea/i, /\bperiplaneta/i, /\bblattella/i], label: "cockroach" },
  { patterns: [/\btsetse/i, /\bglossina\b/i], label: "tsetse fly" },
  { patterns: [/\bmosquito/i, /\banopheles\b/i, /\baedes\b/i, /\bculex\b/i], label: "mosquito" },
  { patterns: [/\bsilkworm/i, /\bbombyx\b/i], label: "silkworm" },
  { patterns: [/\bspruce budworm/i, /\bchoristoneura/i], label: "spruce budworm" },
  { patterns: [/\bcricket/i, /\bacheta\b/i, /\bgryllus\b/i], label: "cricket" },
  { patterns: [/\bmealworm/i, /\btenebrio\b/i], label: "mealworm" },
  { patterns: [/\bwaxworm/i, /\bgalleria\b/i], label: "waxworm" },
  { patterns: [/\btermite/i, /\bisoptera/i, /\breticulitermes/i], label: "termite" },
  { patterns: [/\bbeetle\b/i, /\bcoleoptera/i], label: "beetle" },
  { patterns: [/\bbutterfly/i, /\blepidoptera/i, /\bmonarch\b/i], label: "butterfly" },
  { patterns: [/\bant\b/i, /\bformicidae/i], label: "ant" },
  // Vertebrates
  { patterns: [/\btilapia\b/i, /\boreochromis\b/i], label: "tilapia" },
  { patterns: [/\bsalmon\b/i, /\bsalmo\b/i, /\boncorhynchus/i], label: "salmon" },
  { patterns: [/\bshrimp\b/i, /\bpenaeus\b/i, /\blitopenaeus/i], label: "shrimp" },
  { patterns: [/\bpoultry\b/i, /\bbroiler/i, /\bgallus\b/i], label: "poultry" },
  { patterns: [/\bswine\b/i, /\bpig\b/i, /\bsus scrofa/i, /\bporcine/i], label: "swine" },
];

// Map common names / abbreviations to their scientific genus for matching
const QUERY_ORGANISM_IDENTIFIERS = {
  "bsfl": ["hermetia", "black soldier fly"],
  "bsf": ["hermetia", "black soldier fly"],
  "black soldier fly": ["hermetia"],
  "honey bee": ["apis"],
  "honeybee": ["apis"],
  "fruit fly": ["drosophila"],
  "zebrafish": ["danio"],
  "roundworm": ["caenorhabditis", "c. elegans"],
  "e. coli": ["escherichia"],
  "e coli": ["escherichia"],
};

function programmaticPaperFilter(rawQuery, papers) {
  if (!papers.length) return papers;
  const qLower = rawQuery.toLowerCase();

  // Step 1: Identify what organism the USER is asking about
  const queryOrganisms = new Set();
  for (const [name, identifiers] of Object.entries(QUERY_ORGANISM_IDENTIFIERS)) {
    if (qLower.includes(name)) {
      identifiers.forEach(id => queryOrganisms.add(id.toLowerCase()));
      queryOrganisms.add(name.toLowerCase());
    }
  }
  // Also detect any binomial in the query
  const qBinomial = extractBinomial(rawQuery);
  if (qBinomial) {
    queryOrganisms.add(qBinomial.genus.toLowerCase());
    queryOrganisms.add(qBinomial.full.toLowerCase());
  }

  // If we can't identify a specific organism query, skip this filter
  if (queryOrganisms.size === 0) return papers;

  // Step 2: For each paper, check if it's about a DIFFERENT organism
  return papers.filter(p => {
    const haystack = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();

    // First check: does the paper mention the TARGET organism at all?
    const mentionsTarget = [...queryOrganisms].some(org => haystack.includes(org));

    // If it doesn't even mention the target organism, flag it
    if (!mentionsTarget) {
      // Check if it mentions a KNOWN contaminant organism
      for (const contam of CONTAMINANT_ORGANISMS) {
        const mentionsContam = contam.patterns.some(re => re.test(haystack));
        // Is this contaminant organism NOT what the user asked about?
        const contamIsTarget = [...queryOrganisms].some(org =>
          contam.label.toLowerCase().includes(org) || org.includes(contam.label.toLowerCase())
        );
        if (mentionsContam && !contamIsTarget) {
          // Paper is about a contaminant organism and doesn't mention target → REJECT
          p._filteredReason = `Paper is about ${contam.label}, not the queried organism`;
          return false;
        }
      }
    }

    // Special check for "fed with X" papers — e.g., tilapia fed BSFL is about
    // tilapia nutrition, NOT about BSFL biology/microbiome
    if (queryOrganisms.has("hermetia") || queryOrganisms.has("black soldier fly") || qLower.includes("bsfl") || qLower.includes("bsf")) {
      // If the query is about BSFL microbiome/biology but the paper is about
      // another animal FED with BSFL, it's tangential at best
      const isBSFLBiologyQuery = /\b(microbiome|microbiota|gut\s*(bacteria|flora|microb)|larva[el]?\s*(gut|microb|digest)|digest|metab|enzyme|proteome|transcriptome|genome|gene\s*express)/i.test(rawQuery);
      if (isBSFLBiologyQuery) {
        // Check if paper is about feeding BSFL TO another animal
        const fedPattern = /\b(fed\s+(with\s+)?|diet(ary)?\s+(contain|includ|supplement)|meal\s+(from|replac)|as\s+(feed|protein\s+source)|fish\s+meal\s+replac|feed\s+(ingredient|formul|additive))/i.test(haystack);
        const aboutOtherAnimal = CONTAMINANT_ORGANISMS.some(c =>
          c.patterns.some(re => re.test(haystack)) && !([...queryOrganisms].some(org => c.label.toLowerCase().includes(org)))
        );
        if (fedPattern && aboutOtherAnimal && !mentionsTarget) {
          p._filteredReason = "Paper is about feeding BSFL to another animal, not BSFL biology";
          return false;
        }
        // Even if it mentions BSFL, if the primary subject is clearly another animal
        // (title starts with the other animal's name), downgrade significantly
        const titleLower = (p.title || "").toLowerCase();
        for (const contam of CONTAMINANT_ORGANISMS) {
          if (contam.patterns.some(re => re.test(titleLower)) && fedPattern) {
            // Title mentions a non-target animal + feeding context → likely wrong focus
            if (!(titleLower.includes("hermetia") || titleLower.includes("black soldier fly") || titleLower.includes("bsf"))) {
              p._filteredReason = `Paper primarily about ${contam.label} fed with BSFL`;
              return false;
            }
          }
        }
      }
    }

    return true;
  });
}

// ============ v6.3: GENERAL TOPIC-OVERLAP FILTER ============
// programmaticPaperFilter() above is organism-specific — it only engages
// when the query names a specific organism (BSFL, honeybee, etc.), and
// no-ops entirely for topic-only queries. That's the gap that let a canine
// reference-genome paper, a bovine genome-annotation paper, a maize
// single-cell atlas, a human oncology single-cell paper, and a human
// sleep/andrology paper ALL score as relevant to "insect-microbe or
// animal-microbe associations regulated by mobile genetic elements" — a
// query that never named a specific organism, so the organism gate above
// never fired, and every one of those papers happened to hit the (formerly
// overly-broad) "genetic" concept group via mentioning "genome" somewhere.
//
// This filter is organism-agnostic: it extracts the query's own core/anchor
// terms (same termSpecificity + CONCEPT_LOOKUP machinery used for search
// query construction) and requires a paper to share at least ONE of them
// (or a concept-equivalent) in its title/abstract. A paper about a
// completely different field shares essentially nothing with the query's
// actual anchor concepts, regardless of which specific unrelated field it's
// in — so this generalizes far better than hardcoding a list of "bad
// fields" the way CONTAMINANT_ORGANISMS does for organisms.
function topicOverlapFilter(rawQuery, papers) {
  if (!papers.length) return papers;

  const qLower = rawQuery.toLowerCase();
  const qTerms = qLower
    .replace(/[^\w\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (!qTerms.length) return papers;

  const rankedQ = qTerms
    .map((t) => ({ t, spec: termSpecificity(t) }))
    .sort((a, b) => b.spec - a.spec);
  // Core anchors: specificity >= 0.5, same bar used elsewhere in this file.
  // If nothing clears that bar (very generic query), fall back to the top 3
  // so this filter still has SOMETHING to gate on rather than skipping.
  let coreQTerms = rankedQ.filter((x) => x.spec >= 0.5).map((x) => x.t);
  if (coreQTerms.length === 0) coreQTerms = rankedQ.slice(0, 3).map((x) => x.t);
  // Cap at 6 — beyond that we're just testing filler.
  coreQTerms = coreQTerms.slice(0, 6);

  // Build the set of acceptable strings per core term: the term itself plus
  // every member of its concept group (so "microbe" also accepts a paper
  // that only ever says "microbiome" or "symbiont").
  const acceptSetsRaw = coreQTerms.map((t) => {
    const group = CONCEPT_LOOKUP.get(t);
    return group || new Set([t]);
  });

  // v6.4: CONCEPT_GROUPS also contains multi-word phrases (e.g. "mobile
  // genetic element", "horizontal gene transfer") registered under their
  // FULL phrase as the CONCEPT_LOOKUP key. Single-word query tokenization
  // above can never produce that multi-word key, so a query that says
  // "mobile genetic elements" was silently unable to ever activate that
  // concept group — the words "mobile"/"genetic"/"elements" only ever
  // looked themselves up individually ("genetic" alone resolves to the much
  // narrower gene/genes/genetic group). Directly scan the raw query text
  // for any multi-word phrase from CONCEPT_GROUPS and pull in its group too.
  for (const group of CONCEPT_GROUPS) {
    for (const phrase of group) {
      if (phrase.indexOf(" ") !== -1 && qLower.includes(phrase)) {
        acceptSetsRaw.push(new Set(group));
        break;
      }
    }
  }

  // v6.4: dedupe accept-sets that are literally the same concept-group
  // object (multiple query terms mapping to one group, e.g. "gene" and
  // "genetic" both hitting gene/genes/genetic) so it counts as ONE concept,
  // not two — otherwise the "require 2+" check below is trivially satisfied
  // by two words from the very same idea.
  const seenSetRefs = new Set();
  const acceptSets = [];
  for (const s of acceptSetsRaw) {
    if (!seenSetRefs.has(s)) { seenSetRefs.add(s); acceptSets.push(s); }
  }

  const survivors = papers.filter((p) => {
    const hay = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
    const hitCount = acceptSets.filter((set) => {
      for (const term of set) if (hay.includes(term)) return true;
      return false;
    }).length;
    if (hitCount === 0) {
      p._filteredReason = "Paper shares none of the query's core topic terms — likely a different research field entirely";
      return false;
    }
    // v6.4: a compound/multi-concept query (e.g. "insect-microbe
    // associations regulated by mobile genetic elements" — organism +
    // microbe + mechanism, genuinely distinct concepts) needs a paper to
    // touch a real MAJORITY of its distinct concepts, not just a flat two.
    // Tested against the live failure this was built for: a maize
    // insect-resistance-gene paper naturally shares exactly TWO concepts
    // with that query ("insect" + "gene/genetic") purely because those
    // words are common in plant-breeding literature too, without the paper
    // ever discussing microbes, symbiosis, or mobile genetic elements — a
    // flat "requires 2" bar let it through untouched. Requiring roughly
    // half of the query's distinct concepts (floor of 2 once there are 2+)
    // means a paper has to genuinely engage with most of what the question
    // is actually asking about, not just coincidentally share a couple of
    // common words from a totally different field.
    const required = acceptSets.length >= 2 ? Math.max(2, Math.ceil(acceptSets.length / 2)) : 1;
    if (hitCount < required) {
      p._filteredReason = `Paper only shares ${hitCount} of the query's ${acceptSets.length} distinct core topic concepts (needs ${required}) — likely coincidental keyword overlap from a different research field`;
      return false;
    }
    return true;
  });

  // If this filter would eliminate every paper (e.g. the query's own anchor
  // extraction was itself off), don't blank the result set — fall back to
  // whatever scored best originally rather than returning zero evidence.
  if (survivors.length === 0) return papers.slice(0, 3);
  return survivors;
}

// ============ LLM PAPER VALIDATION (v6.0 — DRAMATICALLY STRENGTHENED) ============
// The previous validator was too lenient — it used a single vague prompt and
// accepted any paper the LLM didn't explicitly reject. This version:
// 1. Runs programmatic hard-filters FIRST (zero cost, catches obvious mismatches)
// 2. Uses a MUCH more specific LLM prompt with organism-awareness
// 3. Requires explicit relevance scoring, not just YES/NO
// 4. Handles up to 15 papers (not just 10)
// 5. Has TWO-PASS validation for organism-specific queries

async function llmValidatePapers(rawQuery, papers, token) {
  if (!papers.length) return papers;

  // PASS 1A: Organism-specific hard-filter (free, instant)
  let survivors = programmaticPaperFilter(rawQuery, papers);

  // If programmatic filter removed everything, keep at least the top-scored original papers
  if (survivors.length === 0 && papers.length > 0) {
    survivors = papers.slice(0, 3);
  }

  // PASS 1B: General topic-overlap filter (free, instant) — catches
  // off-topic-field contamination that PASS 1A can't see because it only
  // engages for organism-named queries.
  survivors = topicOverlapFilter(rawQuery, survivors);

  // PASS 2: LLM validation on survivors.
  // v6.4: this cap used to be 15, but evidencePapers can hold up to 20
  // candidates (maxEvidence when wantsMorePapers is true) — meaning the
  // single most rigorous check in the whole pipeline (an LLM actually
  // reading each abstract and judging relevance) was silently skipped
  // exactly when there were the MOST candidates to sift through, i.e.
  // exactly when a programmatic keyword filter is most likely to let
  // something off-topic slip past. Raised to match the true max so
  // validation always has a chance to run; the 7s AbortController timeout
  // below already bounds worst-case latency regardless of paper count.
  if (!token || survivors.length > 20) return survivors;

  // Detect the primary organism from the query for the LLM prompt
  const qLower = rawQuery.toLowerCase();
  let targetOrganism = "";
  for (const [name, identifiers] of Object.entries(QUERY_ORGANISM_IDENTIFIERS)) {
    if (qLower.includes(name)) {
      targetOrganism = identifiers[0] || name;
      break;
    }
  }
  const qBinomial = extractBinomial(rawQuery);
  if (qBinomial && !targetOrganism) targetOrganism = qBinomial.full;

  const organismClause = targetOrganism
    ? `\n\nCRITICAL — ORGANISM GATE: The user is asking about "${targetOrganism}". ` +
      `A paper MUST be specifically about this organism (or directly about its biology/ecology/microbiome) to score RELEVANT. ` +
      `Papers about DIFFERENT organisms (even related ones) that don't study ${targetOrganism} specifically = IRRELEVANT. ` +
      `Papers about feeding ${targetOrganism} TO other animals (e.g., fish/poultry fed with insect meal) are about the OTHER animal's nutrition, NOT about ${targetOrganism} biology = IRRELEVANT unless the query specifically asks about ${targetOrganism} as feed.`
    : "";

  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 7000);
    const paperList = survivors.map((p, i) =>
      `[${i + 1}] "${p.title}" (${p.journal || "unknown"}, ${p.year || "n/a"})\nAbstract: ${(p.abstract || "").slice(0, 350)}`
    ).join("\n\n");
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, "HTTP-Referer": "https://askcerebrum.org", "X-Title": "Cerebrum" },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat-v3-0324:free",
        temperature: 0,
        max_tokens: 400,
        messages: [{
          role: "system",
          content: "You are a strict scientific paper relevance validator. For EACH paper, determine if it DIRECTLY addresses the user's specific question.\n\n" +
            "Scoring rules:\n" +
            "- RELEVANT: Paper is directly about the specific organism/topic/mechanism asked about\n" +
            "- TANGENTIAL: Paper is related but about a different organism, different mechanism, or only touches the topic indirectly (e.g., paper about feeding insect X to fish Y when the question is about insect X's own biology)\n" +
            "- IRRELEVANT: Paper is about a completely different organism or topic\n\n" +
            "DEFAULT TO REJECTION. A paper must EARN its RELEVANT score — don't be generous.\n" +
            "A paper that studies organism A and only MENTIONS organism B in passing is NOT relevant to a query about organism B.\n" +
            "A paper about organism A's gut microbiome is NOT evidence for organism B's gut microbiome, even if A and B are both insects." +
            organismClause +
            "\n\nOutput ONLY a JSON array of objects: [{\"id\": 1, \"verdict\": \"RELEVANT\"}, {\"id\": 2, \"verdict\": \"TANGENTIAL\"}, ...]. No markdown fences, no explanation."
        }, {
          role: "user",
          content: "Scientific question: " + rawQuery + "\n\nPapers to evaluate:\n" + paperList
        }]
      }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return survivors;
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    try {
      const parsed = JSON.parse(txt.replace(/```json|```/g, "").trim());
      if (Array.isArray(parsed) && parsed.length > 0) {
        const validIds = new Set();
        const tangentialIds = new Set();
        for (const entry of parsed) {
          const id = typeof entry === "number" ? entry : (entry.id || entry.number || entry.n);
          const verdict = typeof entry === "string" ? "RELEVANT" : (entry.verdict || entry.score || "RELEVANT");
          const idNum = typeof id === "number" ? id : parseInt(id, 10);
          if (isNaN(idNum)) continue;
          if (/^relevant$/i.test(verdict)) validIds.add(idNum);
          else if (/^tangential$/i.test(verdict)) tangentialIds.add(idNum);
          // IRRELEVANT papers are simply not added
        }
        // Keep RELEVANT papers as-is, mark TANGENTIAL ones with a flag
        const filtered = survivors.filter((p, i) => {
          const num = i + 1;
          if (validIds.has(num)) return true;
          if (tangentialIds.has(num)) {
            p._tangential = true;
            // Only keep tangential papers if we don't have enough relevant ones
            return validIds.size < 3;
          }
          return false;
        });
        // Only use filtered if it kept at least 1 paper
        if (filtered.length > 0) return filtered;
        // If LLM rejected everything but we had survivors, keep top 2
        return survivors.slice(0, 2);
      }
    } catch {}
    // If LLM returned something unparseable, still try the simple array format
    try {
      const simple = JSON.parse(txt.replace(/```json|```/g, "").trim());
      if (Array.isArray(simple) && simple.every(n => typeof n === "number")) {
        const validSet = new Set(simple);
        const filtered = survivors.filter((_, i) => validSet.has(i + 1));
        if (filtered.length > 0) return filtered;
      }
    } catch {}
    return survivors;
  } catch {
    return survivors;
  }
}

// ════════════════════════════════════════════════════════════════════════
// DEEP FACT-CHECK (LLM claim-by-claim verification)
//
// verifyAnswerAgainstSources() in knowledge.js is deterministic and free —
// it stays as the always-on baseline and the fallback here — but it can only
// check whether a NAMED ENTITY (a drug, gene, pathway) shows up somewhere in
// the source text. It can't tell you whether a specific CLAIM the answer
// makes is actually what a specific source says, which is what a fact-check
// panel implies it's doing. This is the real version of that: an LLM call
// that reads the drafted answer, pulls out several of its concrete claims,
// and checks each one against a quote from the specific source it's
// supposedly grounded in.
//
// Two tiers, tried in order, because this runs on every answer with fact-
// check enabled and can't be allowed to make the response noticeably slower
// or to ever hard-fail the request:
//   1. Workers AI (env.AI, same binding/models the answer-generation
//      fallback ladder already trusts) — no per-request network egress cost,
//      usually fast, tried first with a short timeout.
//   2. OpenRouter (deepseek/deepseek-chat-v3-0324:free) — tried only if tier
//      1 didn't produce usable JSON, with a slightly longer timeout since
//      it's now the only remaining shot before giving up.
// If both fail (missing binding/key, timeout, or a response that doesn't
// parse into at least a couple of usable claims), this returns null and the
// caller falls back to verifyAnswerAgainstSources — fact-check degrades to
// the simpler heuristic instead of the panel disappearing or the request
// failing.
//
// NOT reusing callOR/callCF from the answer-generation stage on purpose:
// both run their output through cleanAIResponse() (strips code fences and
// markdown formatting meant for PROSE, not JSON) and reject anything under
// minAnswerLen (150+ chars) — a short, valid JSON object like
// {"claims":[...]} can be well under that floor and would be thrown away as
// "too short" before this function ever saw it.
const DEEP_FACT_CHECK_SYSTEM_PROMPT =
  "You are a rigorous scientific fact-checker. You will be given an AI-generated answer and the numbered " +
  "sources it was supposed to be grounded in. Your job: extract 3 to 5 of the answer's most specific, checkable " +
  "claims and verify each one directly against the source text.\n\n" +
  "For EACH claim:\n" +
  "1. Quote the claim (or paraphrase tightly) as the answer states it.\n" +
  "2. Identify which numbered source it's supposed to come from (use the [N] markers in the answer if present, " +
  "otherwise the source whose content is the closest match).\n" +
  "3. Quote the exact sentence or phrase from that source's abstract that supports (or fails to support) the claim. " +
  "If nothing in the source supports it, say so explicitly instead of inventing a quote.\n" +
  '4. Assign a status: "supported" (the source quote directly backs the claim), "thin" (the source is related/adjacent ' +
  "but doesn't directly state this specific claim — a reasonable inference, not a stated finding), or " +
  '"unsupported" (the source doesn\'t contain anything resembling this claim).\n' +
  "5. Write a DEEP, multi-sentence (3-4 full sentences minimum) methodological justification: WHY that status — " +
  "what exactly the quote does or doesn't establish, what specific gap exists between the claim's wording and the " +
  "source's actual finding if it's thin, or precisely what would need to be true in the source for this to count " +
  "as supported if it's unsupported. A one-line restatement of the status word is not acceptable — write like a " +
  "peer reviewer explaining their verdict to another scientist, not like a label.\n\n" +
  "Be genuinely critical. A claim that overgeneralizes a single small study, cites a mechanism the abstract only " +
  "speculates about, or states a number the source doesn't contain should be marked thin or unsupported, not waved " +
  "through as supported.\n\n" +
  "Output ONLY this JSON shape — no markdown fences, no commentary before or after:\n" +
  '{"claims": [{"claim": "...", "source_index": 1, "quote": "...", "status": "supported", "justification": "..."}]}';

function buildFactCheckSourceBlock(papers) {
  return papers
    .slice(0, 20)
    .map((p, i) => `[${i + 1}] ${p.title || "Untitled"}\nAbstract: ${(p.abstract || "(no abstract available)").slice(0, 600)}`)
    .join("\n\n");
}

function parseDeepFactCheckJSON(raw) {
  const txt = (raw || "").replace(/```json|```/g, "").trim();
  // Models occasionally wrap the object in a sentence or two despite the
  // instruction not to — grab the outermost {...} span rather than requiring
  // the whole string to be pure JSON.
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(txt.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.claims)) return null;
  const VALID_STATUS = new Set(["supported", "thin", "unsupported"]);
  const claims = parsed.claims
    .map((c) => {
      const claim = String((c && c.claim) || "").trim().slice(0, 400);
      const status = VALID_STATUS.has((c && c.status || "").toLowerCase()) ? c.status.toLowerCase() : null;
      const justification = String((c && c.justification) || "").trim().slice(0, 900);
      const quote = String((c && c.quote) || "").trim().slice(0, 400);
      const sourceIndex = Number.isFinite(c && c.source_index) ? c.source_index : null;
      if (!claim || !status || !justification) return null;
      return { claim, status, justification, quote, sourceIndex };
    })
    .filter(Boolean);
  // Fewer than 2 usable claims isn't the "3-5 rigorous claims" this is meant
  // to produce — treat it as a failed attempt so the caller falls back to
  // the deterministic heuristic instead of showing a near-empty panel.
  if (claims.length < 2) return null;
  return claims;
}

async function deepFactCheck(answer, papers, env) {
  if (!answer || !papers || papers.length === 0) return null;
  const sourceBlock = buildFactCheckSourceBlock(papers);
  const userContent =
    "ANSWER TO FACT-CHECK:\n" + answer.slice(0, 4000) +
    "\n\nSOURCES (numbered to match any [N] citation markers in the answer above):\n" + sourceBlock;
  const messages = [
    { role: "system", content: DEEP_FACT_CHECK_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  // Tier 1: Workers AI — no external network egress, tried first.
  //
  // This whole function runs AFTER the main answer already exists, entirely
  // on the response's critical path (the client waits for it before seeing
  // anything) — factCheck defaults to ON for every account (src/main.jsx,
  // `useState(true)`), so this isn't an opt-in cost some users pay, it was a
  // tax on nearly every search. At the original 9s+12s tier timeouts, a
  // request where tier 1 timed out or (an 8B model asked to emit strict JSON)
  // returned something unparseable paid up to ~21s here alone, stacked on
  // top of the paper-gathering budget and the answer-generation wave(s) —
  // easily the largest single contributor to "search is long" once those
  // earlier stages were already tightened. Halving both ceilings caps the
  // worst case at ~11s; the fallback for a tier that misses its window is
  // still the free, zero-network verifyAnswerAgainstSources() heuristic
  // below, not a blank panel, so a faster miss costs nuance on that one
  // response, not correctness.
  if (env.AI && typeof env.AI.run === "function") {
    try {
      const out = await Promise.race([
        env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", { messages, max_tokens: 1900 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 5000)),
      ]);
      const claims = parseDeepFactCheckJSON((out && out.response) || "");
      if (claims) return claims;
    } catch {
      // Fall through to tier 2.
    }
  }

  // Tier 2: OpenRouter — only reached if Workers AI is unavailable, timed
  // out, or returned something that didn't parse into usable claims.
  if (env.OPENROUTER_KEY) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 6000);
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.OPENROUTER_KEY, "HTTP-Referer": "https://askcerebrum.org", "X-Title": "Cerebrum" },
        body: JSON.stringify({ model: "deepseek/deepseek-chat-v3-0324:free", temperature: 0, max_tokens: 1900, messages }),
        signal: c.signal,
      });
      clearTimeout(t);
      if (r.ok) {
        const j = await r.json();
        const claims = parseDeepFactCheckJSON(j?.choices?.[0]?.message?.content || "");
        if (claims) return claims;
      } else {
        await r.text().catch(() => {});
      }
    } catch {
      // Both tiers failed — caller falls back to verifyAnswerAgainstSources.
    }
  }
  return null;
}


// ============ ANSWER QUALITY ENGINE (v6.0) ============
// Post-generation processing that catches and fixes the most common
// quality failures from free-tier models:
// 1. Repetitive paragraphs (entire sections copy-pasted)
// 2. Banned phrases that the model ignored in the prompt
// 3. Source-listing patterns ("Paper 1 found X. Paper 2 found Y.")
// 4. Excessive verbosity and filler
// 5. Wrong-organism citations (the AI knows it's wrong but cites anyway)

const BANNED_PHRASES_RE = [
  /\bfurther research is needed\b/gi,
  /\bfurther research is necessary\b/gi,
  /\bfurther research is required\b/gi,
  /\bfurther research is warranted\b/gi,
  /\bfurther (studies|investigation|understanding) (is|are) (needed|necessary|required|warranted)\b/gi,
  /\bmore research is needed\b/gi,
  /\bplays a (critical|crucial|vital|pivotal|key|important|significant) role\b/gi,
  /\bit is (important|worth|critical|crucial) to note\b/gi,
  /\bit should be noted\b/gi,
  /\bit is worth mentioning\b/gi,
  /\bin recent years\b/gi,
  /\ba growing body of evidence\b/gi,
  /\bsheds? light on\b/gi,
  /\bpaves? the way for\b/gi,
  /\bthe exact mechanism remains unclear\b/gi,
  /\bwhile the provided sources do not directly\b/gi,
  /\bnone of these papers directly\b/gi,
  /\balthough this study does not specifically\b/gi,
  /\bin conclusion\b/gi,
  /\bin summary\b/gi,
  // Bug: `\boverall,?\s` matched "overall" ANYWHERE, not just as a
  // sentence-opening filler ("Overall, further work is needed") — it also
  // silently deleted "overall" from real clinical/scientific terms like
  // "overall survival" and "overall response rate" (standard oncology
  // endpoints, not filler), changing what the sentence claims. Now only
  // matches the sentence-starter usage (must be followed by a comma).
  /^overall,\s*/gim,
  /\bit is clear that\b/gi,
  /\bholistic understanding\b/gi,
  /\bholistic approach\b/gi,
  /\bmultifaceted\b/gi,
  /\bunderscore(s)? the (importance|need|significance)\b/gi,
  /\bhighlight(s)? the (importance|need|significance)\b/gi,
  /\bthe (landscape|field) of\b/gi,
  /\bin the realm of\b/gi,
  /\bat the forefront of\b/gi,
  /\ba testament to\b/gi,
  /\bin the context of\b/gi,
  /\bthis underscores\b/gi,
  /\bwarrants further investigation\b/gi,
  /\bopens (?:up )?new avenues\b/gi,
  /\bremains (?:an )?area of active (?:research|investigation|study)\b/gi,
  /\bhold(?:s)? great promise\b/gi,
  /\bhas garnered (?:significant |considerable |increasing )?(?:attention|interest)\b/gi,
  /\bhas emerged as a promising\b/gi,
  /\bhas attracted (?:significant |considerable |growing )?(?:attention|interest)\b/gi,
  /\btaken together,?\s*/gi,
  /\bcollectively,?\s+these (?:findings|results|studies|data)\b/gi,
  /\bnotwithstanding,?\s*/gi,
  /\bin light of (?:the (?:above|foregoing)|these findings)\b/gi,
  /\bparadigm shift\b/gi,
  /\bgame[\s-]?changer\b/gi,
  /\bcutting[\s-]?edge\b/gi,
  /\bstate[\s-]?of[\s-]?the[\s-]?art\b/gi,
  /\bgroundbreaking\b/gi,
  /\brevolutionary\b/gi,
  /\bpioneering\b/gi,
  /\bunprecedented\b/gi,
  /\bit (?:is|remains) (?:imperative|essential|crucial) (?:to|that)\b/gi,
  /\bthe (?:present|current) (?:review|study) (?:aims|seeks) to\b/gi,
];

// Detect and remove repetitive content: paragraphs or sentences that
// appear more than once (common with free-tier models that "loop")
function deduplicateContent(text) {
  if (!text) return text;

  // Split into paragraphs
  const paragraphs = text.split(/\n{2,}/);
  if (paragraphs.length < 2) return text;

  // Pass 1: Remove exact duplicate paragraphs
  const seen = new Set();
  let deduped = [];
  for (const para of paragraphs) {
    const normalized = para.trim().toLowerCase().replace(/\s+/g, " ");
    if (normalized.length < 20) { deduped.push(para); continue; } // Keep short lines
    if (seen.has(normalized)) continue; // Skip exact duplicate
    seen.add(normalized);
    deduped.push(para);
  }

  // Pass 2: Remove near-duplicate paragraphs (>80% overlap)
  const final = [];
  for (let i = 0; i < deduped.length; i++) {
    const current = deduped[i].trim().toLowerCase().replace(/\s+/g, " ");
    if (current.length < 30) { final.push(deduped[i]); continue; }
    // Depends only on `i`, not `j` — hoisted out of the inner loop below.
    // It was being rebuilt (re-splitting and re-hashing every word in the
    // paragraph) on every single `j` iteration, an easy O(n) waste that
    // becomes O(n^2) total work across the whole pass for no reason.
    const currentWords = new Set(current.split(/\s+/));
    let isDupe = false;
    for (let j = 0; j < i; j++) {
      const prev = deduped[j].trim().toLowerCase().replace(/\s+/g, " ");
      if (prev.length < 30) continue;
      // Check if >80% of current paragraph's words appear in a previous one
      const prevWords = new Set(prev.split(/\s+/));
      let overlap = 0;
      for (const w of currentWords) { if (prevWords.has(w)) overlap++; }
      const overlapRatio = overlap / currentWords.size;
      if (overlapRatio > 0.80 && currentWords.size > 10) {
        isDupe = true;
        break;
      }
    }
    if (!isDupe) final.push(deduped[i]);
  }

  // Pass 3: Remove duplicate sentences within paragraphs
  const result = final.map(para => {
    const sentences = para.split(/(?<=[.!?])\s+/);
    if (sentences.length < 2) return para;
    const seenSentences = new Set();
    const uniqueSentences = [];
    for (const sent of sentences) {
      const norm = sent.trim().toLowerCase().replace(/\s+/g, " ");
      if (norm.length < 15) { uniqueSentences.push(sent); continue; }
      if (seenSentences.has(norm)) continue;
      seenSentences.add(norm);
      uniqueSentences.push(sent);
    }
    return uniqueSentences.join(" ");
  });

  return result.join("\n\n");
}

// Some weaker/free-tier models, when told (via the per-turn "MECHANICAL
// ENFORCEMENT" instruction — see buildMessages' `enforcer` string) that
// their answer is checked for banned phrases, occasionally narrate that
// fact into the visible answer instead of just silently complying — e.g.
// a bracketed aside like "[MECHANICAL ENFORCEMENT NOTE: the last sentence
// will be stripped for containing a banned phrase...]" landing verbatim in
// what the user reads. Real citations in this app are ALWAYS a bare number
// in brackets ([1], [2][3]...) — never prose — so a bracketed span that
// contains enforcement/meta vocabulary is unambiguously a leak, not a
// citation and not legitimate scientific bracket notation (concentration
// notation like [Ca2+] or isotope labels like [14C] never contain these
// words), so this is safe to strip outright rather than trying to
// enumerate every way a model might phrase the leak.
function stripLeakedMetaCommentary(text) {
  if (!text) return text;
  let cleaned = text.replace(
    /\[[^\[\]]{0,400}?\b(mechanical(?:ly)?(?: enforcement)?|post-?processed?|banned phrase|will be (?:stripped|revised|removed)|to comply with (?:the )?rules?|enforcement note)\b[^\[\]]{0,400}?\]/gi,
    ""
  );
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return cleaned;
}

// Strip banned phrases from the answer
function stripBannedPhrases(text) {
  if (!text) return text;
  let cleaned = text;
  for (const re of BANNED_PHRASES_RE) {
    // Reset the regex's lastIndex for global regexes
    re.lastIndex = 0;
    cleaned = cleaned.replace(re, (match) => {
      // Some of these are mid-sentence — try to clean up gracefully
      return "";
    });
  }
  // Clean up artifacts from removal: double spaces, orphaned commas, etc.
  cleaned = cleaned.replace(/\s{2,}/g, " ");
  cleaned = cleaned.replace(/,\s*,/g, ",");
  cleaned = cleaned.replace(/\.\s*\./g, ".");
  cleaned = cleaned.replace(/\s+\./g, ".");
  cleaned = cleaned.replace(/\s+,/g, ",");
  cleaned = cleaned.replace(/^\s*[,;]\s*/gm, "");
  // Remove sentences that became empty or near-empty after stripping
  cleaned = cleaned.replace(/(?:^|\.\s+)[A-Z][a-z]{0,3}\s*\.(?=\s|$)/g, ".");
  return cleaned.trim();
}

// Detect source-listing patterns and flag them
// Returns a score: 0 = good synthesis, 100 = pure source-listing
function detectSourceListing(text) {
  if (!text) return 0;
  const patterns = [
    /\bsource \[\d+\] (discusses|examines|explores|investigates|reports|found|shows|demonstrates)/gi,
    /\baccording to \[\d+\]/gi,
    /\b(the|a) study (by|in|from) \[\d+\]/gi,
    /\bpaper \[\d+\] (found|showed|demonstrated|reported|examined|investigated)/gi,
    /\b\[\d+\] (found|showed|demonstrated|reported|examined|investigated|suggests?|indicates?)/gi,
    /\b(the|a) (first|second|third|fourth|fifth|sixth|seventh) (study|paper|source|article)/gi,
    /\b(study|paper) \d+ (found|showed|reported)/gi,
    /^[\s-]*\[?\d+\]?\s*[\w\s]+(found|showed|demonstrated|reported)/gim,
  ];
  let listingScore = 0;
  for (const re of patterns) {
    re.lastIndex = 0;
    const matches = text.match(re);
    if (matches) listingScore += matches.length * 15;
  }
  return Math.min(100, listingScore);
}

// Detect wrong-organism acknowledgment — when the AI KNOWS a paper is about
// the wrong organism but cites it anyway. This is the "millipede in BSFL query" bug.
function detectWrongOrganismCitations(text) {
  const patterns = [
    /this study was conducted on (\w+),?\s*not\b/gi,
    /this (paper|study|research) (is|was) (about|on|conducted on) (\w+),?\s*(rather than|not|instead of)\b/gi,
    /although (this|the) (study|paper|research) (focused|focuses) on (\w+)\b/gi,
    /while (this|the) (study|paper|research) (examined|investigat|studied) (\w+),?\s*(not|rather than|instead of)\b/gi,
    /(\w+) (rather than|instead of|not) [A-Z][a-z]+ [a-z]+/g,
    /however,?\s*this (study|paper) (was|is) (conducted|performed|done) (on|in|with) (\w+)/gi,
  ];
  const violations = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      violations.push(m[0]);
    }
  }
  return violations;
}

// Master post-processing function — runs ALL quality passes
function postProcessAnswer(rawAnswer) {
  if (!rawAnswer) return rawAnswer;

  let answer = rawAnswer;

  // 1. Strip any leaked meta-commentary about the enforcement system itself
  // (see stripLeakedMetaCommentary for why this runs first — junk like this
  // can otherwise confuse the dedup/banned-phrase passes below).
  answer = stripLeakedMetaCommentary(answer);

  // 2. Deduplicate repetitive content
  answer = deduplicateContent(answer);

  // 3. Strip banned phrases
  answer = stripBannedPhrases(answer);

  // 3. Remove wrong-organism acknowledgment passages
  // If the AI says "this study was about millipedes, not Hermetia" — that
  // entire passage should be removed, because the paper shouldn't have
  // been cited at all
  const wrongOrgViolations = detectWrongOrganismCitations(answer);
  if (wrongOrgViolations.length > 0) {
    for (const violation of wrongOrgViolations) {
      // Remove the sentence containing this violation
      const escaped = violation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sentenceRe = new RegExp('[^.!?]*' + escaped + '[^.!?]*[.!?]\\s*', 'gi');
      answer = answer.replace(sentenceRe, '');
    }
  }

  // 4. Clean up any artifacts
  answer = answer.replace(/\n{3,}/g, "\n\n").trim();

  return answer;
}

// Extract conflicting claims from the answer text.
// Scans for hedge phrases, contrastive conjunctions, and citation-backed
// opposing claims. Returns an array of { claimA, claimB, sourceA, sourceB }
// objects. Lightweight regex heuristic — not an LLM call — so it runs in
// under a millisecond and costs nothing.
function extractLiteratureConflicts(answer, sources) {
  const conflicts = [];
  if (!answer || !sources || sources.length < 2) return conflicts;

  // Pattern 1: "however" / "in contrast" / "conversely" / "on the other hand"
  // bridging two cited claims, e.g. "Smith et al. [1] found X, however Jones
  // et al. [3] reported Y"
  const contrastRe = /\[(\d+)\][^.]*?(?:found|showed|reported|demonstrated|observed|suggested|concluded)[^.]*?[.;,]\s*(?:however|in contrast|conversely|on the other hand|yet|but|whereas|while|although|despite this|nonetheless|nevertheless)[,]?\s*(?:[^[]*?)\[(\d+)\][^.]*?(?:found|showed|reported|demonstrated|observed|suggested|concluded|indicated)[^.]*?\./gi;
  let m;
  while ((m = contrastRe.exec(answer)) !== null) {
    const idxA = parseInt(m[1], 10) - 1;
    const idxB = parseInt(m[2], 10) - 1;
    if (idxA >= 0 && idxA < sources.length && idxB >= 0 && idxB < sources.length && idxA !== idxB) {
      // Extract the two halves around the contrastive conjunction
      const fullMatch = m[0];
      const splitRe = /(?:however|in contrast|conversely|on the other hand|yet|but|whereas|while|although|despite this|nonetheless|nevertheless)/i;
      const halves = fullMatch.split(splitRe);
      if (halves.length >= 2) {
        conflicts.push({
          claimA: halves[0].replace(/\[\d+\]/g, "").replace(/[,;]\s*$/, "").trim(),
          claimB: halves[1].replace(/\[\d+\]/g, "").replace(/^\s*,?\s*/, "").replace(/\.\s*$/, "").trim(),
          sourceA: sources[idxA].title || `Source ${idxA + 1}`,
          sourceB: sources[idxB].title || `Source ${idxB + 1}`,
          idxA: idxA + 1,
          idxB: idxB + 1,
        });
      }
    }
  }

  // Pattern 2: explicit "conflicting" / "contradictory" / "inconsistent"
  // language near citation brackets
  const conflictTermRe = /(?:conflict(?:ing|s)?|contradict(?:ory|s|ed)?|inconsisten(?:t|cy|cies)|disagree(?:s|ment)?|at odds|opposing|diverge(?:nt|s)?)\s+(?:with\s+)?[^.]*?\[(\d+)\][^.]*?\[(\d+)\][^.]*?\./gi;
  while ((m = conflictTermRe.exec(answer)) !== null) {
    const idxA = parseInt(m[1], 10) - 1;
    const idxB = parseInt(m[2], 10) - 1;
    if (idxA >= 0 && idxA < sources.length && idxB >= 0 && idxB < sources.length && idxA !== idxB) {
      const alreadyFound = conflicts.some((c) => (c.idxA === idxA + 1 && c.idxB === idxB + 1) || (c.idxA === idxB + 1 && c.idxB === idxA + 1));
      if (!alreadyFound) {
        const sentence = m[0].replace(/\[\d+\]/g, "").trim();
        conflicts.push({
          claimA: sentence,
          claimB: "",
          sourceA: sources[idxA].title || `Source ${idxA + 1}`,
          sourceB: sources[idxB].title || `Source ${idxB + 1}`,
          idxA: idxA + 1,
          idxB: idxB + 1,
        });
      }
    }
  }

  // Pattern 3: "X found A [1]... Y found B [2]" without explicit contrast
  // words but with opposing qualifiers (increase vs decrease, positive vs
  // negative, effective vs ineffective, etc.)
  const opposites = [
    ["increas", "decreas"], ["improv", "worsen"], ["positive", "negative"],
    ["effective", "ineffective"], ["beneficial", "detrimental"], ["higher", "lower"],
    ["upregulat", "downregulat"], ["promot", "inhibit"], ["enhanc", "reduc"],
    ["support", "refut"], ["confirm", "challeng"],
  ];
  const citeSentences = answer.split(/(?<=\.)\s+/).filter((s) => /\[\d+\]/.test(s));
  for (let i = 0; i < citeSentences.length; i++) {
    for (let j = i + 1; j < Math.min(i + 4, citeSentences.length); j++) {
      const si = citeSentences[i].toLowerCase();
      const sj = citeSentences[j].toLowerCase();
      for (const [a, b] of opposites) {
        if ((si.includes(a) && sj.includes(b)) || (si.includes(b) && sj.includes(a))) {
          const refI = citeSentences[i].match(/\[(\d+)\]/);
          const refJ = citeSentences[j].match(/\[(\d+)\]/);
          if (refI && refJ) {
            const idxA = parseInt(refI[1], 10) - 1;
            const idxB = parseInt(refJ[1], 10) - 1;
            if (idxA >= 0 && idxA < sources.length && idxB >= 0 && idxB < sources.length && idxA !== idxB) {
              const alreadyFound = conflicts.some((c) => (c.idxA === idxA + 1 && c.idxB === idxB + 1) || (c.idxA === idxB + 1 && c.idxB === idxA + 1));
              if (!alreadyFound) {
                conflicts.push({
                  claimA: citeSentences[i].replace(/\[\d+\]/g, "").trim(),
                  claimB: citeSentences[j].replace(/\[\d+\]/g, "").trim(),
                  sourceA: sources[idxA].title || `Source ${idxA + 1}`,
                  sourceB: sources[idxB].title || `Source ${idxB + 1}`,
                  idxA: idxA + 1,
                  idxB: idxB + 1,
                });
              }
            }
          }
        }
      }
    }
  }

  // Cap at 5 to keep the response lean
  return conflicts.slice(0, 5);
}

// Score the overall quality of an answer (0-100, higher = better)
function scoreAnswerQuality(answer, query) {
  if (!answer) return 0;
  let score = 50; // Start at neutral

  // Length check
  if (answer.length < 100) score -= 20;
  else if (answer.length > 300) score += 10;

  // Banned phrases penalty
  let bannedCount = 0;
  for (const re of BANNED_PHRASES_RE) {
    re.lastIndex = 0;
    const matches = answer.match(re);
    if (matches) bannedCount += matches.length;
  }
  score -= bannedCount * 8;

  // Source-listing penalty
  const listingScore = detectSourceListing(answer);
  score -= listingScore * 0.3;

  // Repetition penalty — count unique vs total paragraphs
  const paras = answer.split(/\n{2,}/).filter(p => p.trim().length > 20);
  if (paras.length > 1) {
    const uniqueParas = new Set(paras.map(p => p.trim().toLowerCase().replace(/\s+/g, " ")));
    const repetitionRatio = 1 - (uniqueParas.size / paras.length);
    score -= repetitionRatio * 40;
  }

  // Wrong-organism penalty
  const wrongOrg = detectWrongOrganismCitations(answer);
  score -= wrongOrg.length * 15;

  // Bonus for good synthesis markers
  if (/\bconsistent(ly)? (with|across)\b/i.test(answer)) score += 3;
  if (/\bin contrast\b/i.test(answer)) score += 3;
  if (/\bhowever\b/i.test(answer)) score += 2; // Nuanced reasoning
  if (/\bconversely\b/i.test(answer)) score += 2;
  if (/\b\d+%|\bp\s*[<>=]\s*0\.\d/i.test(answer)) score += 5; // Quantitative data
  if (/\bn\s*=\s*\d/i.test(answer)) score += 3; // Sample sizes
  if (/_([\w.]+\s+[\w]+)_/i.test(answer)) score += 3; // Italicized species names
  if (/\b(in vitro|in vivo|ex vivo|in silico)\b/i.test(answer)) score += 2; // Study design mention
  if (/\bmeta-analysis\b/i.test(answer)) score += 2;
  if (/\b(preprint|bioRxiv|medRxiv|arXiv)\b/i.test(answer)) score += 3; // Preprint flagging
  if (/\bk[Dd]a\b/.test(answer)) score += 2; // Proper scientific units
  if (/\bμ[MmLl]\b/.test(answer)) score += 2;
  if (/\b°C\b/.test(answer)) score += 1;

  // Citation density bonus — good answers cite multiple sources per claim
  const citMatches = answer.match(/\[\d+\]/g);
  const citCount = citMatches ? citMatches.length : 0;
  if (citCount >= 5 && citCount <= 30) score += 5;
  else if (citCount >= 3) score += 3;
  // Too many citations per paragraph is a listing pattern
  if (citCount > 40) score -= 5;

  // Multi-source synthesis bonus: [N][M] back-to-back = good synthesis
  const multiCiteMatches = answer.match(/\[\d+\]\[\d+\]/g);
  if (multiCiteMatches && multiCiteMatches.length >= 2) score += 5;

  return Math.max(0, Math.min(100, score));
}


// ============ LLM QUERY INTELLIGENCE ("THE BRAIN") ============
// The conversational intelligence core. Instead of rigid regex-based intent
// classification, we use a fast LLM call to UNDERSTAND what the user actually
// means in context. This is what makes follow-ups like "where are the papers",
// "tell me more about that enzyme", or "what about in humans?" work naturally.
//
// Runs in parallel with initial setup so it adds near-zero latency. Falls back
// to the regex-based classifyIntent() if the LLM call fails or times out.

const QUERY_RESOLVER_PROMPT =
  "You are a query-understanding module for Cerebrum, a scientific literature search engine. " +
  "Your job is to understand what the user ACTUALLY wants, given their message and conversation context.\n\n" +
  "Respond with ONLY a JSON object — no markdown fences, no explanation:\n" +
  '{\n  "intent": "<one of the types below>",\n  "needs_search": true/false,\n' +
  '  "resolved_query": "<effective search query, or empty string if no search needed>",\n' +
  '  "topic": "<the main scientific topic being discussed across the conversation>",\n' +
  '  "reasoning": "<one sentence: why you classified it this way>"\n}\n\n' +
  "INTENT TYPES:\n" +
  '- "new_search": A brand-new scientific question unrelated to the conversation so far.\n' +
  '- "followup_deeper": Wants more depth on the SAME topic. ("tell me more", "expand on that", "what\'s the mechanism?")\n' +
  '- "followup_related": A related but different angle. ("what about in humans?" after discussing mice)\n' +
  '- "followup_broader": Wants the topic covered more broadly. ("what about other organisms?", "how does this apply more generally?")\n' +
  '- "correction": Correcting a mistake in the previous answer.\n' +
  '- "meta_question": Asking ABOUT the conversation or existing results — NOT requesting new information. ' +
  'Examples: "where are the papers", "what sources did you use", "can you list the citations", "summarize that", "what did you just say".\n' +
  '- "source_request": Explicitly asking for MORE/NEW/ADDITIONAL papers. ("find more papers", "any other studies")\n' +
  '- "conversational": Greetings, thanks, jokes, personal questions, off-topic chat.\n\n' +
  "CRITICAL RULES:\n" +
  '1. "where are the papers" / "show me the sources" / "what papers did you find" / "list the references" = meta_question. ' +
  "The user wants you to PRESENT the sources already cited. needs_search: false.\n" +
  '2. "find more papers" / "get more studies" / "any other research on this" = source_request. needs_search: true. ' +
  "resolved_query = the original topic.\n" +
  '3. "tell me more" / "go deeper" / "elaborate" = followup_deeper. needs_search: true. ' +
  "resolved_query = the original topic + the specific angle they're asking about.\n" +
  "4. If the message contains pronouns (he/she/it/they/that/this) without clear referents, resolve them from history.\n" +
  '5. Short vague messages ("yes", "ok", "and?", "so?", "continue") after a previous answer = followup_deeper.\n' +
  "6. If the current message lacks scientific terms but the conversation has an active topic, " +
  "resolved_query should include that topic's key terms.\n" +
  "7. For followup_deeper and followup_related, ALWAYS include the main topic in resolved_query " +
  "even if the user didn't repeat it.\n" +
  '8. A message that ONLY asks about papers/sources/citations without specifying "more" or "new" = meta_question, NOT source_request.\n\n' +
  "SCIENTIFIC VOCABULARY — how to build resolved_query:\n" +
  "You have the working vocabulary of MeSH (Medical Subject Headings), SNOMED CT, and OpenAlex Concepts behind you. " +
  "Before writing resolved_query, mentally map the user's plain-language question onto that controlled vocabulary:\n" +
  '9. Expand every acronym and abbreviation to its full term the FIRST time it would matter for retrieval ' +
  '("MI" -> "myocardial infarction", "CRISPR" -> "CRISPR gene editing", "GWAS" -> "genome-wide association study"). ' +
  "If you are not confident what an acronym expands to, leave it as-is rather than guessing.\n" +
  "10. Prefer the precise controlled-vocabulary term over a vague everyday phrase when they clearly mean the same thing " +
  '("heart attack" -> "myocardial infarction", "high blood pressure" -> "hypertension"), but do not invent jargon for a ' +
  "concept that has no standard synonym — an ordinary plain-English query is often already correct.\n" +
  '11. resolved_query MUST stay a plain, natural phrase — a string of terms, not a search expression. ' +
  "Do NOT include boolean operators (AND/OR/NOT), parentheses, quotation marks, wildcards, or field-syntax of any kind. " +
  "The terms in resolved_query are fanned out afterward to a dozen different literature databases that each parse " +
  "boolean/field syntax differently (some support it, most treat it as literal text and return nothing) — that fan-out " +
  "layer is responsible for building each database's own correctly-formed query FROM your plain terms, so anything " +
  "resembling a search expression here breaks retrieval instead of improving it.";


async function llmResolveQuery(query, history, prevSources, token) {
  if (!token) return null;

  const recentHistory = (history || []).slice(-8);
  const historyText = recentHistory
    .map((t) => {
      const role = t.role === "user" ? "User" : "Cerebrum";
      const content = String(t.content || "").slice(0, 400);
      return role + ": " + content;
    })
    .join("\n");

  const sourceList = (prevSources || [])
    .slice(0, 6)
    .map((s, i) => "[" + (i + 1) + '] "' + (s.title || "Untitled") + '"')
    .join("\n");

  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 4000);
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "HTTP-Referer": "https://askcerebrum.org",
        "X-Title": "Cerebrum",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat-v3-0324:free",
        temperature: 0,
        max_tokens: 250,
        messages: [
          { role: "system", content: QUERY_RESOLVER_PROMPT },
          {
            role: "user",
            content:
              "CONVERSATION:\n" +
              (historyText || "(no history)") +
              "\n\nSOURCES ALREADY CITED:\n" +
              (sourceList || "(none)") +
              '\n\nCURRENT MESSAGE: "' +
              query +
              '"',
          },
        ],
      }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) { await r.text().catch(() => {}); return null; }
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    try {
      const clean = txt.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      if (parsed && typeof parsed.intent === "string") return parsed;
    } catch {}
    return null;
  } catch {
    return null;
  }
}


// Build a rich, compact summary of the conversation for the answer LLM.
// This gives the model much better context than just raw history turns,
// enabling it to write responses that feel like a continuous conversation.
function buildConversationContext(history, prevSources) {
  if (!Array.isArray(history) || !history.length) return null;

  const userQuestions = [];
  const assistantHighlights = [];
  const allEntities = new Set();

  for (const turn of history) {
    const content = String(turn.content || "").trim();
    if (!content) continue;

    if (turn.role === "user" && content.length > 3) {
      userQuestions.push(content.slice(0, 200));
      const bin = extractBinomial(content);
      if (bin) allEntities.add(bin.full);
      // Extract capitalized terms that might be entities
      content.split(/\s+/).forEach((w) => {
        if (w.length > 4 && /^[A-Z][a-z]/.test(w) && !STOPWORDS.has(w.toLowerCase())) {
          allEntities.add(w);
        }
      });
    }

    if (turn.role === "assistant" && content.length > 20) {
      const firstSent = content.split(/[.!?]\s/)[0];
      if (firstSent && firstSent.length > 10 && firstSent.length < 200) {
        assistantHighlights.push(firstSent.slice(0, 150));
      }
    }
  }

  const sourceTitles = (prevSources || [])
    .slice(0, 8)
    .map((s, i) => "[" + (i + 1) + "] " + (s.title || "Untitled") + " (" + (s.year || "n/a") + ")");

  const entities = [...allEntities].slice(0, 15);
  const summary =
    userQuestions.length > 0
      ? "The user has asked " +
        userQuestions.length +
        ' question(s). Their investigation started with "' +
        userQuestions[0].slice(0, 100) +
        '"' +
        (userQuestions.length > 1
          ? ' and most recently asked "' + userQuestions[userQuestions.length - 1].slice(0, 100) + '"'
          : "") +
        (entities.length > 0
          ? ". Key entities discussed: " + entities.slice(0, 8).join(", ")
          : "") +
        "."
      : null;

  return { userQuestions, assistantHighlights, entities, sourceTitles, turnCount: history.length, summary };
}


// Answer meta-questions (questions about the conversation itself, like "where
// are the papers" or "what sources did you use"). These don't need a new search
// — they need the LLM to reference the EXISTING conversation and sources.
async function answerMetaQuestion(query, history, prevSources, conversationCtx, env) {
  const token = env.OPENROUTER_KEY;
  if (!token) return null;

  const sourceList = (prevSources || [])
    .map(
      (s, i) =>
        "[" + (i + 1) + '] "' + (s.title || "Untitled") + '" — ' +
        (s.authors || "Unknown") + ", " + (s.journal || "Unknown") +
        ", " + (s.year || "n/a") +
        (s.url ? "\n    URL: " + s.url : "")
    )
    .join("\n");

  const historyText = (history || [])
    .slice(-6)
    .map((t) => {
      const role = t.role === "user" ? "User" : "Cerebrum";
      return role + ": " + String(t.content || "").slice(0, 600);
    })
    .join("\n\n");

  const ctxNote = conversationCtx && conversationCtx.summary ? "\n\nCONVERSATION SUMMARY: " + conversationCtx.summary : "";

  const messages = [
    {
      role: "system",
      content:
        "You are Cerebrum, a scientific research engine built by Vaticay. " +
        "The user is asking a question about your PREVIOUS response or the sources you already found. " +
        "Answer based on the conversation history and source list below.\n\n" +
        "RULES:\n" +
        "- Reference specific papers by their citation number [1], [2], etc.\n" +
        '- If they ask "where are the papers" or "what sources", list the papers you cited with brief descriptions of what each one covers.\n' +
        '- If they ask to "summarize" or "recap", give a concise summary of what you\'ve discussed.\n' +
        "- If they ask about specific claims, reference which paper(s) supported them.\n" +
        "- Be conversational and direct — don't re-search, don't apologize, don't hedge.\n" +
        "- If there are no previous sources, say so honestly and offer to search for them.\n" +
        "- Keep species names italicized: _E. coli_, _H. illucens_.\n" +
        "- Bold **key terms** for readability.\n" +
        "- NEVER fabricate papers or citations. Only reference what's in the source list below.\n\n" +
        "CONVERSATION SO FAR:\n" +
        (historyText || "(first message)") +
        "\n\nSOURCES PREVIOUSLY CITED:\n" +
        (sourceList || "(no sources cited yet)") +
        ctxNote,
    },
    { role: "user", content: query },
  ];

  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 10000);
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "HTTP-Referer": "https://askcerebrum.org",
        "X-Title": "Cerebrum",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat-v3-0324:free",
        temperature: 0.3,
        max_tokens: 1200,
        messages,
      }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    if (txt.length > 20) return cleanAIResponse(txt);
    return null;
  } catch {
    return null;
  }
}


// Self-reasoning chain: before the main search, the system reasons about what
// to search for and why. This is the "asks itself things" capability — the system
// decomposes complex questions, identifies sub-questions, and plans the most
// effective search strategy. The reasoning output enriches both the search
// queries and the final answer's system prompt.
async function selfReason(query, history, token) {
  if (!token) return null;

  const historyText = (history || [])
    .slice(-4)
    .map((t) =>
      (t.role === "user" ? "User" : "Cerebrum") + ": " + String(t.content || "").slice(0, 200)
    )
    .join("\n");

  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "HTTP-Referer": "https://askcerebrum.org",
        "X-Title": "Cerebrum",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat-v3-0324:free",
        temperature: 0.1,
        max_tokens: 420,
        messages: [
          {
            role: "system",
            content:
              // This is Cerebrum Intelligence — the reasoning pass that runs
              // before a single database is queried. Its job is to think
              // about the question the way a genuinely excellent scientist
              // would before going to the literature: not "what keywords
              // match this," but "what is actually being asked, what would
              // change my mind, and what's the rival explanation I'd need to
              // rule out." That framing — thinking about disconfirming
              // evidence and alternative hypotheses up front, not just
              // confirming ones — is what separates a genuinely rigorous
              // first pass from a keyword-extraction pass wearing a lab coat.
              "You are Cerebrum Intelligence — the reasoning core of Cerebrum, a scientific literature search engine that queries 14 scholarly " +
              "databases in parallel. Before a single database is queried, you think about the question the way an exceptional, first-principles " +
              "scientist would: not pattern-matching to keywords, but asking what is ACTUALLY being asked, what would distinguish a right answer " +
              "from a plausible-but-wrong one, and what rival explanation a rigorous person would need to rule out before accepting the obvious one.\n\n" +
              "Think step by step, silently, then output ONLY a JSON object — no prose before or after it:\n" +
              "{\n" +
              '  "sub_questions": ["2-4 specific sub-questions that together fully cover what\'s being asked"],\n' +
              '  "search_strategy": "one sentence describing the best search approach",\n' +
              '  "key_terms": ["5-8 specific scientific search terms, using proper nomenclature — include MeSH terms, gene names, pathway names where applicable"],\n' +
              '  "expected_fields": ["which scientific fields/disciplines are relevant"],\n' +
              '  "complexity": "simple" | "moderate" | "complex" | "multi_domain",\n' +
              '  "needs_comparison": false,\n' +
              '  "organisms": ["any specific organisms to search for, using binomial names"],\n' +
              '  "temporal_focus": "any" | "recent" | "historical" | "longitudinal",\n' +
              '  "alternative_explanations": ["1-3 rival explanations or confounds a rigorous answer needs to address or rule out, if any apply — empty array if the question genuinely has none (don\'t invent one just to fill this)"],\n' +
              '  "what_would_change_the_answer": "one sentence: what finding, if the literature reported it, would flip or substantially qualify the obvious answer — forces genuine engagement with uncertainty instead of false confidence",\n' +
              '  "answer_approach": "one sentence on how to structure the answer for maximum clarity"\n' +
              "}",
          },
          {
            role: "user",
            content:
              (historyText ? "Conversation context:\n" + historyText + "\n\n" : "") +
              'Current question: "' + query + '"',
          },
        ],
      }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    try {
      return JSON.parse(txt.replace(/```json|```/g, "").trim());
    } catch {}
    return null;
  } catch {
    return null;
  }
}


// ============ VISION: IMAGE COMPREHENSION ============
// Lets a user attach an image (a figure from a paper, a screenshot of a
// chart, a photo of a specimen, a diagram from a textbook) alongside their
// question. Rather than threading image bytes through the entire 7000-line
// retrieval/ranking/answer pipeline below — which only knows how to work
// with plain text — this runs ONE vision-capable LLM call up front that
// converts the image into a precise text description, which then flows into
// the exact same pipeline as if the user had typed that description
// themselves. Every downstream system (MeSH expansion, organism detection,
// evidence scoring, citation synthesis) works unmodified because as far as
// it's concerned, it's still just looking at text.
async function describeImage(dataUrl, question, token) {
  if (!token || !dataUrl) return null;
  const visionModels = [
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.2-11b-vision-instruct:free",
    "qwen/qwen2.5-vl-32b-instruct:free",
  ];
  for (const model of visionModels) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 9000);
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
          "HTTP-Referer": "https://askcerebrum.org",
          "X-Title": "Cerebrum",
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 500,
          messages: [
            {
              role: "system",
              content:
                "You are the vision module of a scientific literature search engine. A user attached an image alongside a question. " +
                "Describe, with scientific precision, exactly what the image shows — a chart's axes and the trend it depicts, a diagram's " +
                "labeled structures, a specimen's identifying morphological features, a table's key figures, an equation, a gel/blot's bands. " +
                "Read and transcribe any text, numbers, axis labels, or captions visible in the image verbatim. Do NOT speculate about what " +
                "isn't visible. Do NOT answer the user's question — only describe the image. Be dense and factual, not conversational.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: question ? `The user's question: "${question}". Describe this image.` : "Describe this image." },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
        signal: c.signal,
      });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = await r.json();
      const txt = (j?.choices?.[0]?.message?.content || "").trim();
      if (txt && txt.length > 10) return txt.slice(0, 2000);
    } catch {
      // try next model
    }
  }
  return null;
}

// D1-backed query intelligence: check if we've seen a similar query before
// and know its resolved form. This makes the system faster over time — cached
// resolutions are instant and don't need an LLM call.
async function checkQueryIntelligence(queryKey, db) {
  if (!db) return null;
  try {
    const row = await db
      .prepare(
        "SELECT resolved_query, intent, topic, entities, success_count " +
        "FROM query_intelligence WHERE query_hash = ? AND success_count >= 1 LIMIT 1"
      )
      .bind(queryKey)
      .first();
    if (row && row.resolved_query) {
      return {
        resolved_query: row.resolved_query,
        intent: row.intent,
        topic: row.topic,
        entities: row.entities ? JSON.parse(row.entities) : [],
        confidence: Math.min(row.success_count / 3, 1), // 3+ successes = full confidence
      };
    }
  } catch {}
  return null;
}

// Store a successful query resolution for future use
async function storeQueryIntelligence(queryKey, rawQuery, resolvedQuery, intent, topic, entities, db) {
  if (!db || !queryKey) return;
  try {
    await db
      .prepare(
        "INSERT INTO query_intelligence (query_hash, raw_query, resolved_query, intent, topic, entities, success_count, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, 1, ?) " +
        "ON CONFLICT(query_hash) DO UPDATE SET " +
        "success_count = success_count + 1, resolved_query = excluded.resolved_query, updated_at = excluded.created_at"
      )
      .bind(queryKey, rawQuery.slice(0, 500), resolvedQuery.slice(0, 500), intent, topic || "", JSON.stringify(entities || []), Date.now())
      .run();
  } catch {}
}

// Store topic co-occurrence data for smarter related-query suggestions
async function updateTopicMemory(topic, searchTerms, paperCount, db) {
  if (!db || !topic) return;
  const topicKey = topic.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!topicKey) return;
  try {
    await db
      .prepare(
        "INSERT INTO topic_memory (topic_key, related_terms, best_search_terms, avg_paper_count, search_count, updated_at) " +
        "VALUES (?, ?, ?, ?, 1, ?) " +
        "ON CONFLICT(topic_key) DO UPDATE SET " +
        "search_count = search_count + 1, " +
        "avg_paper_count = (avg_paper_count * search_count + excluded.avg_paper_count) / (search_count + 1), " +
        "best_search_terms = CASE WHEN excluded.avg_paper_count > avg_paper_count THEN excluded.best_search_terms ELSE best_search_terms END, " +
        "updated_at = excluded.updated_at"
      )
      .bind(topicKey, JSON.stringify([]), JSON.stringify(searchTerms || []), paperCount || 0, Date.now())
      .run();
  } catch {}
}

// Read topic_memory to enrich search queries with previously successful terms.
// This is the READ side of the topic_memory system — previously write-only.
// When a user searches for a topic we've seen before, we can supplement their
// query with the search terms that produced the most results last time.
async function recallTopicMemory(topic, db) {
  if (!db || !topic) return null;
  const topicKey = topic.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!topicKey) return null;
  try {
    const row = await db
      .prepare(
        "SELECT best_search_terms, avg_paper_count, search_count " +
        "FROM topic_memory WHERE topic_key = ? AND search_count >= 2 LIMIT 1"
      )
      .bind(topicKey)
      .first();
    if (row && row.best_search_terms) {
      try {
        const terms = JSON.parse(row.best_search_terms);
        if (Array.isArray(terms) && terms.length > 0) {
          return {
            bestTerms: terms,
            avgPaperCount: row.avg_paper_count || 0,
            searchCount: row.search_count || 0,
          };
        }
      } catch {}
    }
  } catch {}
  return null;
}


// Hard ceiling on gatherPapers' TOTAL wall-clock time, not any single
// fetch. Every individual upstream call already has its own AbortController
// timeout (4s-12s, tuned per API — see europePMC/pubmed/openAlex/etc. below)
// so no single fetch hangs indefinitely; the real source of the reported
// 60s+ latency is that this function tries up to six fallback stages
// SEQUENTIALLY when a hard query keeps coming back thin (the rung loop,
// then rawFallback, concept-expansion, memory fallback, NL fallback, and
// relaxed fallback — each gated on "did the last stage return enough
// results yet"), and their individual timeouts stack: several 7-12s stages
// back to back easily clears 60s for a query that's thin at every stage.
// Shortening the individual per-API timeouts (as originally proposed)
// would've fixed nothing about that stacking and would have made every
// well-behaved slower API — the ones the 7s/9s/12s timeouts were
// specifically tuned for — drop results it currently retrieves just fine.
// The actual fix is a shared deadline across the whole ladder: once this
// much wall-clock time has elapsed, stop trying additional fallback
// stages and synthesize from whatever's already been gathered, rather
// than let a thin query march through every remaining stage regardless.
const GATHER_PAPERS_BUDGET_MS = 20000;
async function gatherPapers(rawQuery, opts) {
  const _searchStart = Date.now();
  const _budgetLeft = () => GATHER_PAPERS_BUDGET_MS - (Date.now() - _searchStart) > 0;
  // Wrap the entire function so ANY thrown error still returns a diagnostic
  // rather than being swallowed by the outer .catch and losing all context.
  const _outerDiag = { entered: true, phase: "start", rawQuery: (rawQuery || "").slice(0, 200) };
  try {
  const openAlexKey = (opts && opts.openAlexKey) || "";
  const ncbiKey = (opts && opts.ncbiKey) || "";
  const limit = (opts && opts.limit) || 25;
  _outerDiag.phase = "cleaned_query"; const query = cleanQuery(preprocessQuery(rawQuery)); _outerDiag.cleanedQuery = query.slice(0, 200);
  // A resolved person name from conversation history (pronoun follow-up like
  // "he has papers from UTK") takes priority over re-detecting from rawQuery.
  const resolvedPersonName = opts && opts.resolvedPersonName;
  // Detect a person name embedded ANYWHERE in the query, not just when the
  // query IS a name. This catches "Reese Sahos studies on BSFL" -> "Reese Saho".
  const embeddedName = extractPersonNameFromQuery(rawQuery);
  const isNameQuery = !!resolvedPersonName || !!embeddedName;
  const effectiveName = resolvedPersonName || embeddedName || rawQuery.trim();
  // Run typo-correction BEFORE binomial extraction, not just on the separate
  // `query` variable below. Previously this used rawQuery verbatim, so a
  // voice-dictation typo like "Hermia illusions" still LOOKED taxonomic
  // (capitalized two-word pair) and got captured as `binomial` — which takes
  // priority over the properly-typo-corrected/SYNONYMS-resolved organism
  // detection below, silently reintroducing the exact bug the typo-corrector
  // exists to fix. correctBinomialTypos() only rewrites genuine typos (see
  // its own exact-match skip) so a correctly-typed binomial like "Escherichia
  // coli" or "Populus angustifolia" is untouched and still detected here.
  const binomial = extractBinomial(correctBinomialTypos(rawQuery));

  // AUTHOR QUERY: single clean path. Query the primary sources directly (they
  // have the freshest data — aggregators lag weeks to months), extract the
  // FULL author list from each result, filter by actual name-token membership,
  // deduplicate, and return. No layered fallbacks, no walls. If truly nothing
  // matches, the endpoint responds with helpful suggestions rather than dumping
  // unrelated papers or throwing up an "author not confirmed" screen.
  _outerDiag.phase = "name_check_done"; _outerDiag.isNameQuery = isNameQuery;
  if (isNameQuery) {
    _outerDiag.phase = "author_branch";
    const nameLower = effectiveName.toLowerCase();
    const nameTokens = nameLower.split(/\s+/).filter((t) => t.length > 1);
    // Build a quoted-phrase query for the full name and also a broader OR of
    // first+last for sources that don't handle quoted phrases well.
    const quoted = '"' + effectiveName + '"';

    // Primary source parallel fetch. Each source returns papers with a full
    // author list in _allAuthors (this is the bug that was previously silently
    // dropping real matches — the strict filter was checking a truncated field).
    const results = await Promise.allSettled([
      europePMC(quoted, 25),                        // best full-text index for biomed
      openAlex(quoted, 25, openAlexKey),            // cross-disciplinary
      crossref(quoted, 15),                         // DOI-registered works
      arxiv(effectiveName, 15),                     // physics/CS/quantitative bio
      semanticScholar(quoted, 15),                  // includes preprints
      biorxivDirectAuthor(effectiveName),           // fresh biology preprints
      medrxivDirectAuthor(effectiveName),           // fresh medical preprints
    ]);

    const merged = [];
    const seenTitles = new Set();
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const p of (r.value || [])) {
        // Check the FULL author list, not the truncated `authors` display.
        const authorHay = (p._allAuthors || p.authors || "").toLowerCase();
        if (!authorHay) continue;
        // Require every token of the searched name to appear somewhere in
        // the paper's actual author string. This is the correct filter and
        // works because we now capture the full author list.
        const hit = nameTokens.every((t) => authorHay.includes(t));
        if (!hit) continue;
        const titleKey = (p.title || "").toLowerCase().trim();
        if (!titleKey || seenTitles.has(titleKey)) continue;
        // Hard reject: a PDB deposit or Zenodo/Dryad/Figshare record isn't a
        // publication just because it happens to list the searched author —
        // see isNonLiterature() for why this can't be left to the per-source
        // fetchers' own upstream filters alone.
        if (isNonLiterature(p)) continue;
        seenTitles.add(titleKey);
        // Every per-source fetcher above already runs its abstract text
        // through stripTags(), but never its title — a gap invisible for the
        // overwhelming majority of papers, whose titles are plain text, but
        // Crossref (and anything that mirrors Crossref metadata) genuinely
        // returns raw embedded JATS/MathML markup for titles containing
        // mathematical notation, e.g. a real title arriving as literal
        // `Proximity effect and <mml:math xmlns:mml="...">...</mml:math>-wave
        // superconductivity`. Left unstripped, that XML rendered verbatim in
        // the bibliography AND was fed straight into the AI evidence block —
        // needless bloat at best, and a plausible reason a model produces a
        // malformed/garbled response (failing the format checks below and
        // registering as just another "failed" attempt) at worst. One choke
        // point here covers every source instead of patching each fetcher.
        merged.push({ ...p, authorMatch: effectiveName, title: stripTags(p.title || "") || "Untitled", journal: stripTags(p.journal || "") || p.journal || "" });
      }
    }

    // Score and type
    _outerDiag.phase = "scoring"; const scored = merged.map((p) => {
      const j = (p.journal || "").toLowerCase();
      let type = "Journal";
      if (/preprint|biorxiv|medrxiv|arxiv/.test(j)) type = "Preprint";
      else if (/zenodo|datacite|figshare|dryad/.test(j)) type = "Dataset";
      return {
        ...p,
        score: 10,
        contentHits: 1,
        contentCoverage: 1,
        organismPresent: true,
        relevance: 100,
        type,
      };
    });

    // Sort: most-cited first (proxy for career impact); recent second when ties
    scored.sort((a, b) => {
      const ac = a.citations || 0, bc = b.citations || 0;
      if (bc !== ac) return bc - ac;
      const ay = parseInt(a.year, 10) || 0, by = parseInt(b.year, 10) || 0;
      return by - ay;
    });

    if (scored.length) return { papers: scored };

    // Truly no papers matched by author. Signal that so the endpoint can
    // respond with helpful suggestions (not a wall, not unrelated papers).
    return { papers: [], noResults: true };
  }

  _outerDiag.phase = "before_ladder";
  // ============ RETRIEVAL LADDER ============
  // The retrieval system that has to work right or nothing else matters.
  //
  // Design principles (each learned from a real production failure):
  //
  // 1. EVERY ENGINE GETS ITS OWN QUERY DIALECT.
  //    Europe PMC and PubMed parse boolean. OpenAlex, Crossref, Semantic
  //    Scholar, DOAJ, PLOS, Zenodo treat "(a OR b)" as literal text → zero.
  //    arXiv needs "all:x AND all:y". Sending one string to all ten is the
  //    single mistake that caused the longest outage in this project.
  //
  // 2. CONCEPT EXPANSION ONLY WHERE IT'S SAFE.
  //    Europe PMC and PubMed handle OR-expanded groups well. For the plain-
  //    keyword engines, we send ONLY the bare anchor terms — no parens, no
  //    "OR", no boolean operators of any kind. These engines do fuzzy/semantic
  //    matching internally; our OR-expansion was fighting their own relevance
  //    algorithm and reducing recall.
  //
  // 3. THE LADDER LOOSENS PROGRESSIVELY.
  //    4 anchors → 3 → 2 → 1. Stop at the first rung that returns ≥5 papers.
  //    Then also search any sub-clauses of a compound question.
  //
  // 4. THE RAW QUERY IS ALWAYS THE FINAL FALLBACK.
  //    If no rung worked, we try the user's original query verbatim. Some
  //    engines do NLP-level understanding of natural language; our anchor
  //    extraction sometimes loses information they would have caught.

  // ORGANISM INJECTION: detect the organism FIRST so we can strip its common-
  // name words from the ranked terms. Without this, "black", "soldier", "fly"
  // fill rung slots that should hold "microbial", "abundance", "midgut" — and
  // the duplicate check sees "black" in the rung and skips injecting the
  // scientific name entirely.
  const orgInfo = splitOrganismTopic(query);

  // Build a set of all words that are part of the organism's common name(s).
  // These must be EXCLUDED from the ranked topic terms — they get replaced by
  // the quoted scientific name.
  const orgFragments = new Set();
  if (orgInfo.hasOrganism) {
    for (const phrase of orgInfo.orgPhrases) {
      for (const w of phrase.toLowerCase().split(/\s+/)) {
        if (w.length > 2) orgFragments.add(w);
      }
    }
    // Also add all words from ORGANISM_WORDS
    for (const w of ORGANISM_WORDS) orgFragments.add(w);
  }

  // Split on hyphens too — see the matching comment in buildStructuredQuery()
  // above qTerms. Without this, "insect-microbe"/"animal-microbe" never hit
  // the "insect"/"microbe" concept groups and lose the anchor race to
  // unrelated single words like "genetic" that happen to hit a (previously
  // overly broad) concept group by coincidence.
  const ranked = query
    .split(/[\s-]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t) && !orgFragments.has(t))
    .map((t) => ({ t, spec: termSpecificity(t) }))
    .sort((a, b) => b.spec - a.spec)
    .map((x) => x.t);
  let organismTerm = null;
  if (binomial) {
    organismTerm = '"' + binomial.full + '"';
  } else if (orgInfo.hasOrganism && orgInfo.orgPhrases.length) {
    // Resolve to the SCIENTIFIC NAME, properly capitalized and quoted.
    // Previous bugs: (1) regex was case-sensitive so lowercase SYNONYMS values
    // like "hermetia illucens" never matched; (2) fell back to bare common name
    // "black soldier fly" which search engines split into 3 common words.
    // (3) a phrase that IS ALREADY a binomial (e.g. "hermetia illucens",
    // matched directly via ORGANISM_PHRASES rather than through a common-name
    // SYNONYMS key) was never included here — SYNONYMS["hermetia illucens"]
    // is undefined, since it's only ever a dictionary VALUE, never a KEY — so
    // a query that names the scientific name directly, alongside some OTHER
    // organism's common name, could resolve to the wrong organism entirely.
    const expanded = orgInfo.orgPhrases.flatMap((p) =>
      ORGANISM_BINOMIALS.has(p.toLowerCase()) ? [p] : (SYNONYMS[p.toLowerCase()] || [])
    );
    // Case-INSENSITIVE binomial detection, then capitalize properly
    const sciRaw = expanded.find((e) => /^[a-z]+ [a-z]+$/i.test(e) && e.split(" ").length === 2);
    if (sciRaw) {
      // Proper binomial capitalization: "Hermetia illucens"
      const parts = sciRaw.split(" ");
      const sciName = parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase() + " " + parts[1].toLowerCase();
      organismTerm = '"' + sciName + '"';
    } else if (expanded.length) {
      // Non-binomial expansion (e.g. acronym → full name)
      organismTerm = '"' + expanded[0] + '"';
    } else {
      // Last resort: quote the detected phrase itself
      organismTerm = '"' + orgInfo.orgPhrases[0] + '"';
    }
  }

  // MULTI-ORGANISM COMPARISON: `organismTerm` above is a single value — the
  // first organism found — but a comparison query ("Hermetia illucens vs
  // honey bee", "BSFL and honeybee gut microbiome") names TWO. Without this,
  // the entire retrieval ladder below only ever searches for whichever
  // organism happened to win the single pick, and the other is silently
  // dropped from every source query. Collect every distinct scientific name
  // detected (properly capitalized, same resolution rules as organismTerm
  // above) so a later block can fire one extra, engine-dialect-correct
  // search pass per additional organism.
  const allOrganismSciNames = (() => {
    // Restrict to KNOWN_BINOMIALS specifically, not just "any two-word
    // SYNONYMS value" — SYNONYMS has plenty of non-organism two-word entries
    // (e.g. "crispr" expands to, among other things, "gene editing"), and
    // this list drives real extra network calls per entry, so a shape-only
    // regex here would fire a bogus supplementary search for "Gene editing"
    // as if it were a second organism whenever a query mentioned CRISPR
    // alongside a real species.
    const raw = orgInfo.orgPhrases.flatMap((p) => {
      if (ORGANISM_BINOMIALS.has(p.toLowerCase())) return [p];
      return (SYNONYMS[p.toLowerCase()] || []).filter((e) => ORGANISM_BINOMIALS.has(e.toLowerCase()));
    });
    if (binomial) raw.push(binomial.full.toLowerCase());
    const capitalized = raw.map((sciRaw) => {
      const parts = sciRaw.split(" ");
      return parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase() + " " + parts[1].toLowerCase();
    });
    return [...new Set(capitalized)];
  })();
  const primaryOrganismName = organismTerm ? organismTerm.replace(/"/g, "") : null;
  const secondaryOrganisms = allOrganismSciNames.filter((n) => n !== primaryOrganismName).slice(0, 2);

  const booleanQuery = buildStructuredQuery(query);
  const arxivQuery = (terms) => terms.map((t) => "all:" + t).join(" AND ");

  // Progressive rungs, most-precise first.
  // If we detected an organism, prepend it to EVERY rung so the organism
  // is always part of the search, no matter how loose the topic terms get.
  let rungs = [
    ranked.slice(0, 4),
    ranked.slice(0, 3),
    ranked.slice(0, 2),
    ranked.slice(0, 1),
  ].filter((r) => r.length > 0);
  if (!rungs.length) rungs.push([query]);

  if (organismTerm) {
    // Organism words were already stripped from `ranked`, so no rung can
    // contain organism fragments. Unconditionally prepend the quoted
    // scientific name to every rung.
    //
    // Previous bug: the duplicate check used
    //   organismTerm.includes(rungWord)
    // which meant "black" (in "black soldier fly") counted as "organism
    // present" → injection was skipped → search ran without the species.
    rungs = rungs.map((rung) => [organismTerm, ...rung]);
  }

  // The fanout sends the RIGHT syntax to EACH engine. This is the most
  // important function in the entire codebase — if it sends the wrong format
  // to any engine, that engine silently returns zero and the user sees
  // "no papers found".
  const fanout = (terms, useBoolean) => {
    // For organism queries: build queries that force organism AND topic together.
    // The organism term is quoted so search engines treat it as a phrase.
    // Since organism-word fragments are already stripped from `ranked`, the
    // only organism element in `terms` is the quoted scientific name itself.
    const orgQuoted = organismTerm || "";
    const topicTerms = orgQuoted
      ? terms.filter((t) => t !== orgQuoted)
      : terms;
    const topicStr = topicTerms.join(" ");

    // Boolean engines (EPMC, PubMed): organism AND topic using boolean syntax
    const boolQ = useBoolean
      ? (orgQuoted ? orgQuoted + " AND (" + (topicStr || query) + ")" : booleanQuery)
      : (orgQuoted ? orgQuoted + " " + topicStr : terms.join(" "));
    // Plain-keyword engines: combined string (organism + topic together)
    const bare = orgQuoted ? orgQuoted.replace(/"/g, "") + " " + topicStr : terms.join(" ");
    // arXiv: prefix each term with "all:" and join with " AND "
    const arxTerms = orgQuoted
      ? [orgQuoted.replace(/"/g, ""), ...topicTerms]
      : terms;
    const arx = arxTerms.map((t) => "all:" + t).join(" AND ");

    return [
      europePMC(boolQ, 12),
      pubmed(boolQ, 12, ncbiKey),
      openAlex(bare, 12, openAlexKey),
      crossref(bare, 10),
      arxiv(arx, 8),
      semanticScholar(bare, 10),
      doaj(bare, 8),
      biorxiv(bare, 8),
      zenodo(bare, 6),
      plos(bare, 8),
      // Additional high-value sources (4 new)
      coreSearch(bare, 8),
      baseSearch(bare, 8),
      pmcFullText(bare, 6),
      openAire(bare, 6),
    ];
  };

  // Multi-part question detection.
  const clauses = rawQuery
    .split(/\s*(?:,\s*)?\band\b\s+(?=how|what|why|when|where|which|do|does|can|is|are)|\s*[;?]\s*/i)
    .map((c) => c.trim())
    .filter((c) => c.split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase())).length >= 2);

  const subQueries = clauses.length > 1
    ? clauses.map((c) =>
        c.toLowerCase().replace(/[^\w\s-]/g, " ").split(/\s+/)
          .filter((t) => t.length > 2 && !STOPWORDS.has(t))
          .map((t) => ({ t, spec: termSpecificity(t) }))
          .sort((a, b) => b.spec - a.spec)
          .slice(0, 3).map((x) => x.t)
      ).filter((arr) => arr.length >= 2)
    : [];

  _outerDiag.phase = "ladder_start";
  let results = [];
  const diag = { rungs: [], sourceOutcomes: null };
  const sourceNames = ["europePMC","pubmed","openAlex","crossref","arxiv","semanticScholar","doaj","biorxiv","zenodo","plos","CORE","BASE","pmcFullText","openAire"];

  let accumulated = [];
  for (let i = 0; i < rungs.length; i++) {
    const rungResults = await Promise.allSettled(fanout(rungs[i], i === 0));
    accumulated = accumulated.concat(rungResults);
    const perSource = rungResults.map((r, idx) => ({
      source: sourceNames[idx],
      status: r.status,
      count: r.status === "fulfilled" ? (r.value || []).length : 0,
      error: r.status === "rejected" ? String(r.reason && r.reason.message || r.reason).slice(0, 120) : null,
    }));
    const got = perSource.reduce((n, x) => n + x.count, 0);
    diag.rungs.push({ terms: rungs[i], got, perSource });
    diag.sourceOutcomes = perSource;
    // Total accumulated across all rungs so far, not just this rung alone —
    // this is what should gate whether we keep loosening the query.
    const totalAccumulated = accumulated.reduce(
      (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
    );
    // Budget check here too, not just at each later fallback stage — a
    // query with many loosening rungs can burn the whole budget in this
    // loop alone before ever reaching the stages below.
    if (totalAccumulated >= 8 || !_budgetLeft()) break;
  }
  results = accumulated;

  // FINAL FALLBACK: if no rung returned enough, try the raw user query
  // verbatim. Some engines (especially Semantic Scholar and Europe PMC) have
  // surprisingly good NLP that handles natural-language questions better than
  // our extracted anchors.
  const totalSoFar = results.reduce(
    (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
  );
  if (totalSoFar < 8 && _budgetLeft()) {
    // Include organism name in the raw fallback so we find species-specific papers
    const rawQ = organismTerm
      ? organismTerm.replace(/"/g, "") + " " + query
      : query;
    const rawFallback = await Promise.allSettled([
      europePMC(rawQ, 12),
      semanticScholar(rawQ, 10),
      openAlex(rawQ, 10, openAlexKey),
    ]);
    results = results.concat(rawFallback);
    diag.rawFallback = rawFallback.map((r, i) => ({
      source: ["europePMC","semanticScholar","openAlex"][i],
      count: r.status === "fulfilled" ? (r.value || []).length : 0,
    }));
  }

  // ═══════════════════════════════════════════════════════════════
  // CONCEPT-EXPANDED FALLBACK: if we STILL have too few papers, the problem
  // is vocabulary mismatch — the user's words don't match how papers phrase
  // it. Expand each topic term through CONCEPT_GROUPS to find synonyms the
  // papers actually use.
  //
  // Example: user writes "microbial abundance" → papers say "bacterial
  // diversity", "microbiota composition", "16S rRNA community".
  // The concept expansion turns "microbial" into "bacteria OR microbiome
  // OR microbiota" — which is how the paper is indexed.
  //
  // This runs IN PARALLEL with the raw fallback check above (no extra
  // latency) by launching immediately and only using results if needed.
  // ═══════════════════════════════════════════════════════════════
  const totalAfterRaw = results.reduce(
    (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
  );
  if (totalAfterRaw < 8 && _budgetLeft()) {
    // Build synonym-expanded queries from concept groups
    const topicTermsForExpansion = ranked.slice(0, 3);
    const expandedQueries = new Set();

    for (const term of topicTermsForExpansion) {
      const group = CONCEPT_LOOKUP.get(term);
      if (group) {
        // Pick 2-3 synonyms from the concept group that aren't the original term
        const alts = [...group].filter((g) => g !== term && g.length > 3).slice(0, 3);
        for (const alt of alts) {
          const q = organismTerm
            ? organismTerm.replace(/"/g, "") + " " + alt + " " + topicTermsForExpansion.filter((t) => t !== term).join(" ")
            : alt + " " + topicTermsForExpansion.filter((t) => t !== term).join(" ");
          expandedQueries.add(q.trim());
        }
      }
    }

    // Also try the organism alone (broadest possible) if we have one
    if (organismTerm) {
      expandedQueries.add(organismTerm.replace(/"/g, ""));
      // Organism + each individual topic term
      for (const term of topicTermsForExpansion.slice(0, 2)) {
        expandedQueries.add(organismTerm.replace(/"/g, "") + " " + term);
        // Also try concept-expanded version
        const group = CONCEPT_LOOKUP.get(term);
        if (group) {
          const alt = [...group].find((g) => g !== term && g.length > 3);
          if (alt) expandedQueries.add(organismTerm.replace(/"/g, "") + " " + alt);
        }
      }
    }

    // MeSH-style expansion: CONCEPT_LOOKUP above is search.js's own hand-
    // built synonym table and only covers terms someone thought to add. The
    // controlled-vocabulary table in knowledge.js is the complementary,
    // much broader net — plain-language phrasing ("heart attack", "sugar
    // disease") mapped to how MEDLINE actually indexes it ("myocardial
    // infarction", "diabetes mellitus"). Run it against the ORIGINAL query,
    // not the already-stripped `query`/`ranked` terms, since it matches on
    // multi-word phrases that term-splitting would have destroyed.
    const meshSyns = expandViaMesh(rawQuery).slice(0, 4);
    for (const syn of meshSyns) {
      const q = organismTerm ? organismTerm.replace(/"/g, "") + " " + syn : syn;
      expandedQueries.add(q.trim());
    }

    // Fire expanded queries in parallel across the most reliable engines
    const expandedArr = [...expandedQueries].slice(0, 6);
    if (expandedArr.length) {
      const expandedResults = await Promise.allSettled(
        expandedArr.flatMap((eq) => [
          europePMC(eq, 8),
          semanticScholar(eq, 6),
          openAlex(eq, 6, openAlexKey),
        ])
      );
      results = results.concat(expandedResults);
      diag.conceptExpanded = expandedArr;
      diag.conceptExpandedCount = expandedResults.reduce(
        (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TOPIC MEMORY RECALL: if concept expansion didn't help enough, check
  // if we've seen this topic before and have previously successful search
  // terms cached in D1. This is the READ side of topic_memory — previously
  // it was write-only, never consulted during search.
  // ═══════════════════════════════════════════════════════════════
  const totalAfterConcept = results.reduce(
    (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
  );
  if (totalAfterConcept < 5 && opts.db && _budgetLeft()) {
    const topicForRecall = orgInfo.hasOrganism
      ? orgInfo.orgPhrases[0] + " " + ranked.slice(0, 3).join(" ")
      : ranked.slice(0, 4).join(" ");
    const recalled = await recallTopicMemory(topicForRecall, opts.db).catch(() => null);
    if (recalled && recalled.bestTerms && recalled.bestTerms.length > 0) {
      const recalledQueries = recalled.bestTerms.slice(0, 4);
      const memResults = await Promise.allSettled(
        recalledQueries.flatMap((eq) => [
          europePMC(eq, 8),
          semanticScholar(eq, 6),
        ])
      );
      results = results.concat(memResults);
      diag.topicMemoryRecall = recalledQueries;
      diag.topicMemoryCount = memResults.reduce(
        (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // NATURAL LANGUAGE FALLBACK: if STILL nearly empty, send the user's
  // ORIGINAL unprocessed question to Semantic Scholar and Europe PMC.
  // These engines have good NLP — sometimes the raw human phrasing works
  // better than any term extraction. This is the "ask it like you'd ask
  // a person" fallback.
  // ═══════════════════════════════════════════════════════════════
  const totalAfterExpand = results.reduce(
    (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
  );
  if (totalAfterExpand < 5 && _budgetLeft()) {
    const nlFallback = await Promise.allSettled([
      semanticScholar(rawQuery.slice(0, 200), 15),
      europePMC(rawQuery.slice(0, 200), 12),
      openAlex(rawQuery.slice(0, 200), 10, openAlexKey),
    ]);
    results = results.concat(nlFallback);
    diag.nlFallback = nlFallback.reduce(
      (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // RELAXED BOOLEAN FALLBACK: every tier above loosens by dropping terms
  // or trying alternate phrasings, but none of them tries genuine boolean
  // OR across the organism's own names and near-synonym topic words in a
  // single query — e.g. ("Hermetia illucens" OR "black soldier fly") AND
  // (pathogen OR manure OR "faecal reduction"). EPMC and PubMed both parse
  // real OR/AND boolean syntax (the rest of this file already relies on
  // that — see fanout() above), so this fires ONE such query at just those
  // two when we're still thin after every earlier tier.
  // ═══════════════════════════════════════════════════════════════
  const totalAfterNL = results.reduce(
    (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
  );
  if (totalAfterNL < 5 && _budgetLeft()) {
    const orgNames = [...new Set([
      organismTerm ? organismTerm.replace(/"/g, "") : null,
      ...(orgInfo.orgPhrases || []),
    ].filter(Boolean).map((n) => n.trim()))];
    const orgOr = orgNames.length > 1
      ? "(" + orgNames.map((n) => '"' + n + '"').join(" OR ") + ")"
      : orgNames.length === 1 ? '"' + orgNames[0] + '"' : "";
    const topicOr = ranked.slice(0, 5).filter(Boolean);
    const topicGroup = topicOr.length ? "(" + topicOr.join(" OR ") + ")" : "";
    const relaxedBoolQ = orgOr && topicGroup ? orgOr + " AND " + topicGroup : (orgOr || topicGroup || query);
    if (relaxedBoolQ) {
      const relaxedResults = await Promise.allSettled([
        europePMC(relaxedBoolQ, 12),
        pubmed(relaxedBoolQ, 12, ncbiKey),
      ]);
      results = results.concat(relaxedResults);
      diag.relaxedBoolean = { query: relaxedBoolQ, count: relaxedResults.reduce(
        (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0) };
    }
  }

  // Add results for each sub-question of a compound query. Not gated on
  // result count like the fallback stages above — a second clause with
  // zero queries fired for it isn't "thin," it's uncovered — but still
  // respects the overall budget so a query with many clauses can't alone
  // blow past it: only the loop itself is capped, not this whole feature,
  // so at least the first clauses still get their coverage under pressure.
  if (subQueries.length > 1) {
    for (const sub of subQueries) {
      if (!_budgetLeft()) break;
      try {
        const subRes = await Promise.allSettled(fanout(sub, false));
        results = results.concat(subRes);
        diag["clause:" + sub.join("+")] = subRes.reduce(
          (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0);
      } catch {}
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECONDARY ORGANISM RETRIEVAL: everything above only ever searched for
  // ONE organism (`organismTerm`). A comparison query names a second one
  // (`secondaryOrganisms`, computed earlier from the same detection that
  // built `organismTerm`) that has had zero queries fired for it so far —
  // not "too few", literally zero, because every rung above unconditionally
  // AND'd the primary organism into the query. This fires once per
  // additional organism (capped at 2), using the same per-engine dialect
  // rules as fanout() above: boolean AND for EPMC/PubMed, plain
  // concatenation for keyword engines. Always runs when a second organism is
  // detected — the primary ladder already having "enough" total results
  // says nothing about whether the SECOND organism is represented at all,
  // which is exactly the bug this fixes.
  // ═══════════════════════════════════════════════════════════════
  if (secondaryOrganisms.length) {
    const topicStr2 = ranked.slice(0, 3).join(" ") || query;
    for (const sciName of secondaryOrganisms) {
      if (!_budgetLeft()) break;
      const orgQuoted2 = '"' + sciName + '"';
      try {
        const secResults = await Promise.allSettled([
          europePMC(orgQuoted2 + " AND (" + topicStr2 + ")", 10),
          pubmed(orgQuoted2 + " AND (" + topicStr2 + ")", 10, ncbiKey),
          openAlex(sciName + " " + topicStr2, 10, openAlexKey),
          crossref(sciName + " " + topicStr2, 8),
          semanticScholar(sciName + " " + topicStr2, 10),
          doaj(sciName + " " + topicStr2, 6),
          biorxiv(sciName + " " + topicStr2, 6),
        ]);
        results = results.concat(secResults);
        diag["secondaryOrganism:" + sciName] = secResults.reduce(
          (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0);
      } catch {}
    }
  }

  // v6.3: dedupe by DOI first, normalized title as fallback — see
  // paperDedupeKey() for why a title-only key let the same paper (returned
  // by two different source APIs with slightly different title formatting)
  // through twice, ending up cited as both [1] and [6] in the same answer.
  const merged = [];
  const seen = new Set();
  for (const res of results) {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      for (const p of res.value) {
        // Hard reject before this record ever gets a dedupe key, a relevance
        // score, or a shot at being cited — a dataset deposit that slips past
        // this line is a dataset deposit the model will happily write into
        // the answer as if it read it. See isNonLiterature() above for why
        // this single choke point exists independent of each fetcher's own
        // upstream type filter.
        if (isNonLiterature(p)) continue;
        const key = paperDedupeKey(p);
        if (key && !seen.has(key)) {
          seen.add(key);
          // Same title-sanitization gap as the author-query branch above —
          // see the comment there. Applied once here so every one of the
          // 15+ source fetchers is covered without touching each of them.
          merged.push({ ...p, title: stripTags(p.title || "") || "Untitled", journal: stripTags(p.journal || "") || p.journal || "" });
        }
      }
    }
  }

  // ============ RELEVANCE SCORING ============
  // Rebuilt from scratch. The old version had five compounding bugs that were
  // the root cause of nearly every "wrong paper" report:
  //
  //   1. Used hay.indexOf(term) — substring matching. "micro" matched
  //      "micro-motion", "microscopy", "micrometer". A query about the
  //      microbiome returned radar engineering papers at 100% relevance.
  //   2. Stemmer stripped "ion"/"al"/"ed" unconditionally, so "motion" -> "mot"
  //      which then matched "motor", "remote", "mother", "promote".
  //   3. Relevance was RELATIVE (score / maxScore). If every result was
  //      garbage, the least-bad garbage still displayed "100% match".
  //   4. No absolute quality floor — top N were returned no matter how bad,
  //      then handed to the AI, which dutifully cited them.
  //   5. Stopwords were never filtered, so "the", "was", "that", "main",
  //      "point" all counted as content matches and inflated every score.
  //
  // Every one of those is fixed below.
  //
  // Split on hyphens too, same reasoning as buildStructuredQuery()'s qTerms
  // and gatherPapers()'s `ranked` above: a hyphenated compound like
  // "insect-microbe" needs to become "insect" + "microbe" so EACH half hits
  // its correct concept group when scoring paper relevance below. Without
  // this, a genuinely on-topic paper that separately says "insect" and
  // "microbiome" (never the literal compound) scored as a MISS on this term,
  // while an unrelated genome-annotation paper could score as a HIT on
  // "genetic" via the (now-fixed) concept group — the exact combination that
  // let a canine/bovine/maize genomics papers outscore real insect-microbiome
  // papers for a mobile-genetic-elements query.
  const terms = query
    .toLowerCase()
    .split(/[\s-]+/)
    .map((t) => t.replace(/[^a-z0-9\-]/g, ""))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  const expansions = expansionsFor(terms);

  // Which KIND of question is this (mechanism, treatment, etiology,
  // comparison, ...)? Drives which study designs get a ranking bonus below
  // via intentEvidenceBonus() — a treatment question should surface RCTs
  // over a case report even when both are equally "on topic". Computed once
  // per request; classifyResearchIntent() returns [] for questions that
  // don't fit a clean evidence-based-medicine category, which is the common
  // case for pure biology/ecology/methods questions and is treated as "no
  // bias" rather than an error.
  const researchIntents = classifyResearchIntent(rawQuery);

  // Neutral (organism) words vs content (topic) words
  const neutralWords = new Set(terms.filter((t) => SYNONYMS[t]));
  for (const phrase of expansions) {
    for (const w of phrase.toLowerCase().split(/\s+/)) {
      if (w.length > 2) neutralWords.add(w);
    }
  }
  for (const w of ORGANISM_WORDS) {
    if (terms.includes(w)) neutralWords.add(w);
  }
  const contentTerms = terms.filter((t) => !neutralWords.has(t));

  // Conservative stemmer. Only strips endings when the remaining stem is still
  // long enough to be meaningful (>= 4 chars). The old version turned "motion"
  // into "mot" and "radial" into "radi", which matched half the dictionary.
  const stem = (w) => {
    if (w.length <= 4) return w;
    // Plurals and simple verb forms only. Never strip "al"/"ion" — those are
    // part of the root in most scientific vocabulary (radial, motion, ionic).
    const stripped = w.replace(/(ies|ied)$/i, "y").replace(/(es|s|ing|ed)$/i, "");
    return stripped.length >= 4 ? stripped : w;
  };

  // Concept-aware matcher. Beyond the term itself and its stem, this also
  // matches any member of the term's concept group — so a query for "plastic"
  // is satisfied by a paper that only ever writes "polyethylene".
  const matcherCache = new Map();
  const matcherFor = (term) => {
    if (matcherCache.has(term)) return matcherCache.get(term);
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const t = esc(term);
    const s = esc(stem(term));
    const group = CONCEPT_LOOKUP.get(term);
    const alts = new Set([t]);
    if (s !== t) alts.add(s + "(?:s|es|ing|ed|al)?");
    else alts.add(t + "(?:s|es|ing|ed)?");
    if (group) {
      for (const g of group) {
        if (g === term) continue;
        alts.add(esc(g).replace(/\s+/g, "\\s+"));
      }
    }
    const body = [...alts].join("|");
    let re;
    try {
      re = new RegExp(`(?<![a-z0-9])(?:${body})(?![a-z0-9])`, "i");
    } catch {
      re = new RegExp(`\\b(?:${body})\\b`, "i");
    }
    matcherCache.set(term, re);
    return re;
  };

  // Split content terms by how much they actually identify the topic. Gating
  // happens on CORE terms only; peripheral terms still add score when present
  // but never cause a real paper to be rejected.
  const rankedTerms = contentTerms
    .map((t) => ({ t, spec: termSpecificity(t) }))
    .sort((a, b) => b.spec - a.spec);
  const coreTerms = rankedTerms.filter((x) => x.spec >= 0.5).map((x) => x.t);
  const peripheralTerms = rankedTerms.filter((x) => x.spec < 0.5).map((x) => x.t);
  // If nothing cleared the specificity bar (very generic query), fall back to
  // the three most specific terms available so we still gate on something.
  const gateTerms = coreTerms.length ? coreTerms : rankedTerms.slice(0, 3).map((x) => x.t);

  // Compound-term detection. Scientific vocabulary is full of terms users split
  // apart when typing: "micro biome" vs "microbiome", "bio conversion" vs
  // "bioconversion", "gut micro biome". Strict word-boundary matching would
  // (correctly) refuse to match "micro" inside "microbiome" — but then the
  // legitimate paper gets rejected too. So we also test adjacent term pairs
  // joined together, and if the compound appears, both halves count as matched.
  const compoundPairs = [];
  for (let i = 0; i < contentTerms.length - 1; i++) {
    const joined = contentTerms[i] + contentTerms[i + 1];
    if (joined.length >= 6) {
      compoundPairs.push({ a: contentTerms[i], b: contentTerms[i + 1], joined });
    }
  }

  const scored = merged
    .map((p) => {
      const title = p.title || "";
      const abstract = p.abstract || "";
      const hay = (title + " " + abstract).toLowerCase();
      const titleHay = title.toLowerCase();

      // Which terms were satisfied via a compound match in body / title
      const compoundSatisfied = new Set();
      const compoundSatisfiedTitle = new Set();
      for (const cp of compoundPairs) {
        if (matcherFor(cp.joined).test(hay)) {
          compoundSatisfied.add(cp.a);
          compoundSatisfied.add(cp.b);
        }
        if (matcherFor(cp.joined).test(titleHay)) {
          compoundSatisfiedTitle.add(cp.a);
          compoundSatisfiedTitle.add(cp.b);
        }
      }

      const has = (t) => compoundSatisfied.has(t) || matcherFor(t).test(hay);
      const hasTitle = (t) => compoundSatisfiedTitle.has(t) || matcherFor(t).test(titleHay);

      // Precompute gate-hit counts here so the downstream .filter() (which
      // is in a different scope and can't reach these closures) can read them
      // as properties on the returned paper object.
      const gateCoreHits = gateTerms.filter(has).length;
      const gateCoreTitleHits = gateTerms.filter(hasTitle).length;

      const contentHits = contentTerms.filter(has).length;
      const titleContentHits = contentTerms.filter(hasTitle).length;
      const neutralHit = (() => {
        // Count how many organism-specific words appear in the paper.
        // A single word like "fly" is too generic — it matches "fruit fly",
        // "tsetse fly", "fly ash", etc. Require at least 2 organism words
        // from the query to match, OR require the full scientific name.
        const orgWordsInPaper = [...neutralWords].filter(has);
        // Words that are too generic to count alone
        const GENERIC_ORG_WORDS = new Set(["fly", "black", "red", "blue", "white", "green",
          "brown", "common", "small", "large", "big", "long", "short", "wild", "mouse",
          "rat", "fish", "worm", "bug", "bee", "ant", "cat", "dog", "bird", "tree", "honey"]);
        const specificHits = orgWordsInPaper.filter(w => !GENERIC_ORG_WORDS.has(w));
        // If we have specific hits (like "hermetia" or "illucens"), one is enough
        if (specificHits.length >= 1) return true;
        // If only generic hits (like "fly"), need at least 2 together
        if (orgWordsInPaper.length >= 2) return true;
        return false;
      })();
      // Multi-word expansions are checked as exact phrases (they're already
      // specific enough that substring matching is safe and desirable here).
      let expHit = false;
      for (const phrase of expansions) {
        if (hay.indexOf(phrase.toLowerCase()) !== -1) {
          expHit = true;
          break;
        }
      }
      // Also check if the resolved scientific name appears (catches papers that
      // use "Hermetia illucens" but none of the common-name words)
      let sciHit = false;
      if (organismTerm) {
        const sciClean = organismTerm.replace(/"/g, "").toLowerCase();
        if (hay.indexOf(sciClean) !== -1) sciHit = true;
        // Also check abbreviated form: "H. illucens"
        const sciParts = sciClean.split(" ");
        if (sciParts.length === 2) {
          const abbrev = sciParts[0][0] + ". " + sciParts[1];
          if (hay.indexOf(abbrev) !== -1) sciHit = true;
        }
      }
      const organismPresent = neutralHit || expHit || sciHit;
      const contentCoverage = contentTerms.length
        ? contentHits / contentTerms.length
        : 1;

      // ---- Absolute scoring, normalized to a 0-100 scale ----
      // Coverage is measured on CORE terms (the ones that actually identify the
      // topic) rather than every word, so filler words in a long question can't
      // dilute a genuinely on-topic paper's score.
      const coreHitCount = gateTerms.filter(has).length;
      const coreCoverage = gateTerms.length ? coreHitCount / gateTerms.length : 1;
      const coreTitleHits = gateTerms.filter(hasTitle).length;
      const periphHits = peripheralTerms.filter(has).length;

      let match = 0;
      match += coreCoverage * 42;
      match += gateTerms.length ? (coreTitleHits / gateTerms.length) * 20 : 0;
      // Peripheral terms are a small bonus, never a requirement
      match += peripheralTerms.length ? (periphHits / peripheralTerms.length) * 4 : 0;
      if (organismPresent && (contentTerms.length === 0 || contentHits > 0)) match += 12;
      // Penalize papers that MISS the organism when the query clearly names one
      if (!organismPresent && contentTerms.length > 0 && binomial) match -= 5;

      let quality = 0;
      if (abstract.length > 200) quality += 8;      // has a real abstract
      else if (abstract.length > 0) quality += 3;
      if (typeof p.citations === "number") {
        // Log scale — 10 citations matters much more than 1000 vs 990
        quality += Math.min(Math.log10(Math.max(1, p.citations)) * 4, 12);
      }
      const yr = parseInt(p.year, 10);
      const nowYear = new Date().getFullYear();
      if (yr) {
        const age = nowYear - yr;
        if (age <= 2) quality += 10;
        else if (age <= 5) quality += 7;
        else if (age <= 10) quality += 4;
        else if (age <= 20) quality += 1;
      }

      // ---- Domain-knowledge signals (functions/lib/knowledge.js) ----
      // Three independent adjustments layered on top of topical relevance:
      // (1) which journal it's in, (2) what kind of study it is and whether
      // that design actually answers the kind of question being asked, and
      // (3) a soft penalty if the venue matches a known predatory-publishing
      // pattern. None of these can make a topically-irrelevant paper rank
      // higher than a relevant one — `match` still dominates the total —
      // they only break ties among papers that already passed the topic
      // gate, the same way citation count and recency already do above.
      const journalBonus = scoreJournalTier(p.journal);
      quality += journalBonus;
      const predPenalty = predatoryPenalty(p.journal, p.url);
      quality += predPenalty;
      const studyType = classifyStudyType(title, abstract);
      let evidenceBonus = 0;
      if (studyType) {
        evidenceBonus += studyType.weight;
        evidenceBonus += intentEvidenceBonus(studyType.key, researchIntents);
      }
      quality += evidenceBonus;
      // A result that actually reports its numbers (n=, p=, a confidence
      // interval, an effect size) is more checkable — and in practice
      // usually more careful — than one that only asserts a finding in
      // prose. Small bonus, capped low enough it can never outweigh topical
      // relevance or evidence tier on its own.
      const rigor = detectStatisticalRigor(abstract);
      quality += rigor.rigorBonus;

      const score = match + quality;

      return {
        ...p,
        score,
        matchScore: match,       // 0-70, pure topical relevance
        qualityScore: quality,   // 0-30, source quality signals
        journalTier: journalBonus > 0 ? journalBonus : undefined,
        studyType: studyType ? studyType.label : undefined,
        flaggedPublisher: predPenalty < 0 || undefined,
        contentHits,
        titleContentHits,
        contentCoverage,
        organismPresent,
        gateCoreHits,             // used by the downstream .filter()
        gateCoreTitleHits,
      };
    })
    .filter((p) => {
      // ── LANGUAGE FILTER ──
      // Reject papers that are clearly non-English based on title character analysis
      const title = (p.title || "").trim();
      if (title) {
        // Check for non-Latin scripts (Chinese, Japanese, Korean, Arabic, Cyrillic, etc.)
        const nonLatinRatio = (title.match(/[^\u0000-\u024F\u1E00-\u1EFF\s\d\-.,;:()[\]{}'"!?@#$%^&*+=/<>]/g) || []).length / title.length;
        if (nonLatinRatio > 0.3) return false;
        // Check for French/German/Spanish academic markers (common false positives)
        const lowerTitle = title.toLowerCase();
        if (/^(les |une |des |étude |analyse |recherche |l'|la |le |du |de la )/.test(lowerTitle)) return false;
        if (/^(die |das |ein |eine |zur |über )/.test(lowerTitle)) return false;
      }

      if (terms.length === 0) return true;
      // Binomial query: paper MUST contain the species epithet OR full binomial.
      // Just mentioning the genus is not enough — that's how we get wrong-species
      // papers ("Populus deltoides" study returned for a "Populus angustifolia" query).
      if (binomial) {
        const hay = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
        const hasBinomial = hay.indexOf(binomial.full.toLowerCase()) !== -1;
        const hasSpeciesWord = hay.indexOf(binomial.species) !== -1;
        // Also accept abbreviated form like "P. angustifolia"
        const abbrev = binomial.genus[0].toLowerCase() + ". " + binomial.species;
        const hasAbbrev = hay.indexOf(abbrev) !== -1;
        // Comparison queries name a SECOND organism (secondaryOrganisms,
        // computed earlier) that this strict single-species gate would
        // otherwise wipe out entirely — a paper about honeybee gut microbiota
        // correctly has zero mentions of "illucens" and would fail every
        // check above even though it's exactly what a comparison query asked
        // for. Accept it too.
        const hasSecondaryOrganism = secondaryOrganisms.some(
          (name) => hay.indexOf(name.toLowerCase()) !== -1
        );
        if (!hasBinomial && !hasSpeciesWord && !hasAbbrev && !hasSecondaryOrganism) return false;
      }
      // Name queries: keep everything relevance-sorted, don't apply topic gate.
      if (isNameQuery) return true;

      // ---- QUALITY FLOOR (core-term based) ----
      // Gate on CORE terms only. A flat percentage of every word was rejecting
      // correct papers for verbose questions — a real paper on waxworm saliva
      // enzymes matched only 2 of 9 words in a long question and got dropped.
      // The threshold also relaxes as the core set grows, because no single
      // paper contains every concept in a multi-part question.
      //
      // NOTE: `has` and `hasTitle` are closures defined per-paper inside the
      // preceding .map(). They don't exist in this .filter() scope. We use the
      // pre-computed count fields on `p` instead — which was the bug that has
      // been silently killing every retrieval for weeks (ReferenceError inside
      // a Promise.allSettled callback, swallowed by the outer catch).
      if (gateTerms.length > 0) {
        const coreHits = p.gateCoreHits || 0;
        const coreTitleHits = p.gateCoreTitleHits || 0;
        let required;
        if (gateTerms.length <= 2) required = 1;
        else if (gateTerms.length <= 4) required = 2;
        else if (gateTerms.length <= 6) required = 2;
        else required = 3;
        const titleStrong = coreTitleHits >= 2;
        if (coreHits < required && !titleStrong) return false;
      }

      const queryNamesOrganism = neutralWords.size > 0;
      if (queryNamesOrganism) {
        return (
          p.organismPresent &&
          (contentTerms.length === 0 || p.contentHits > 0)
        );
      }
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // EMERGENCY RELAXATION: the organism gate above is strict by design (never
  // show BSF papers for an E. coli query), but if it filters EVERY candidate
  // to zero, an empty result is worse than a clearly-labeled partial match.
  //
  // Three tiers of relaxation:
  // 1. Drop organism requirement, keep topic gate (finds papers on the topic
  //    that don't mention the specific species)
  // 2. Use concept-group matching (finds papers using synonym vocabulary)
  // 3. Keep anything with a real abstract and any topic word (broadest)
  let finalScored = scored;
  if (scored.length < 3 && merged.length > 0) {
    // Tier 1: drop organism, keep content gate
    const relaxed1 = merged
      .map((p) => {
        const hay = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
        const has = (t) => new RegExp("\\b" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(hay);
        // Also check concept-group synonyms — "bacterial" satisfies "microbial"
        const hasExpanded = (t) => {
          if (has(t)) return true;
          const group = CONCEPT_LOOKUP.get(t);
          if (group) {
            for (const g of group) {
              if (g !== t && hay.indexOf(g.toLowerCase()) !== -1) return true;
            }
          }
          return false;
        };
        const coreHits = gateTerms.filter(hasExpanded).length;
        const coreCoverage = gateTerms.length ? coreHits / gateTerms.length : 0;
        // Check if organism is present even without the strict gate
        let orgPresent = false;
        if (organismTerm) {
          const sciClean = organismTerm.replace(/"/g, "").toLowerCase();
          if (hay.indexOf(sciClean) !== -1) orgPresent = true;
          for (const w of ORGANISM_WORDS) { if (hay.indexOf(w) !== -1) { orgPresent = true; break; } }
        }
        const orgBonus = orgPresent ? 15 : 0;
        return { ...p, score: coreCoverage * 40 + orgBonus, contentHits: coreHits, contentCoverage: coreCoverage, organismPresent: orgPresent, relevance: null };
      })
      .filter((p) => p.contentHits > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (relaxed1.length >= 3) {
      finalScored = [...scored, ...relaxed1].sort((a, b) => b.score - a.score).slice(0, limit);
    } else {
      // Tier 2: accept anything with a real abstract and at least 1 matching word
      const relaxed2 = merged
        .filter((p) => (p.abstract || "").length > 100)
        .map((p) => {
          const hay = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
          const anyHit = [...contentTerms, ...gateTerms, ...[...neutralWords]].some((t) => hay.indexOf(t) !== -1);
          return { ...p, score: anyHit ? 20 : 5, contentHits: anyHit ? 1 : 0, contentCoverage: anyHit ? 0.3 : 0, organismPresent: false, relevance: null };
        })
        .filter((p) => p.score > 5)
        .sort((a, b) => {
          // Prefer papers with more citations and abstracts
          const ca = (a.citations || 0), cb = (b.citations || 0);
          return cb - ca;
        })
        .slice(0, limit);
      finalScored = [...scored, ...relaxed1, ...relaxed2].sort((a, b) => b.score - a.score).slice(0, limit);
    }
  }
  const scoredFinal = finalScored;

  for (const p of scoredFinal) {
    // ---- ABSOLUTE RELEVANCE ----
    // Score is already on a 0-100 absolute scale (70 match + 30 quality), so we
    // report it directly instead of normalizing against the best result in the
    // set. A weak match now honestly reads as "38% match" rather than being
    // inflated to 100% just because everything else was worse.
    p.relevance = Math.max(0, Math.min(100, Math.round(p.score)));
    const j = (p.journal || "").toLowerCase();
    if (/wikipedia/.test(j)) p.type = "Reference";
    else if (/preprint|biorxiv|medrxiv|arxiv|ssrn|research square/.test(j))
      p.type = "Preprint";
    else if (/zenodo|datacite|figshare|dryad/.test(j)) p.type = "Dataset";
    else p.type = "Journal";
  }

  return { papers: scoredFinal, _diag: diag };
  } catch (e) {
    // Any throw in gatherPapers: log the full detail server-side (Cloudflare
    // Function real-time logs) and return an empty result with a SAFE,
    // stack-trace-free summary in _diag — this response body is public (any
    // caller of /api/search sees it, not just the developer), so the full
    // stack trace, which used to be included here, is logged instead of
    // shipped to the client.
    console.error("Cerebrum gatherPapers threw:", _outerDiag.phase, e && e.stack ? e.stack : e);
    return {
      papers: [],
      _diag: {
        ..._outerDiag,
        threwAt: _outerDiag.phase,
        errorName: (e && e.name) || "Unknown",
      },
    };
  }
}

// ============ MAIN HANDLER ============

// NOTE: there used to be a module-level wildcard `cors` object here, kept
// "for the OPTIONS/early-return paths before secureCors was computed." It
// was a live bug: `secureCors` (origin-locked, computed per-request below)
// is declared with `const cors = secureCors;` *inside* the handler's `try`
// block, so that binding only shadows the module-level one for code inside
// the try. The `catch` block is a sibling scope, not a child of the try, so
// `catch (e) { ...headers: cors... }` was silently resolving to THIS
// wildcard object — meaning every genuine 500 (a real runtime exception)
// was served with `Access-Control-Allow-Origin: "*"` and no `nosniff`,
// undoing the origin-lock this whole section exists to enforce, while also
// echoing `e.message` to any origin. Deleted the trap entirely; the catch
// block now references `secureCors` directly (it's declared in the
// enclosing function scope, before the try, so it's already reachable from
// catch with no rebinding needed).

// ---- SECURITY LAYER ----
// Cerebrum is a free public endpoint, which makes it a target for abuse:
// scrapers, cost-driving request floods, and prompt-injection probing from
// automated tooling. These controls raise the cost of abuse without blocking
// legitimate users.

// Only allow requests that originate from our own site. A browser sends the
// Origin header on cross-site POSTs; automated abuse from other domains gets
// rejected. (Direct server-to-server abuse can spoof this, but it stops the
// large majority of drive-by browser-based abuse and hotlinking.)
const ALLOWED_ORIGINS = [
  "https://askcerebrum.org",
  "https://www.askcerebrum.org",
  "https://cerebrum-2pz.pages.dev",
];
// Cloudflare Pages preview deploys look like
// "https://<hash-or-branch>.cerebrum-2pz.pages.dev" — matched, but scoped to
// OUR project subdomain only. Bug fix: this used to be
// `origin.endsWith(".pages.dev")`, which trusts EVERY Cloudflare Pages site
// on the internet (anyone can spin one up for free), completely defeating
// the allowlist it was supposed to be.
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.cerebrum-2pz\.pages\.dev$/i;
function originAllowed(request) {
  const origin = request.headers.get("Origin") || "";
  // No Origin header = same-origin navigation or a non-browser client. Allow,
  // because legitimate same-origin fetches sometimes omit it, but this is the
  // path rate limiting protects.
  if (!origin) return true;
  return ALLOWED_ORIGINS.some((o) => origin === o) || PAGES_PREVIEW_RE.test(origin);
}

// Rate limiter now lives in functions/lib/rateLimit.js, shared across every
// endpoint. It prefers a KV namespace (env.RATE_LIMIT_KV) so the limit is a
// real cross-colo count instead of the old per-isolate Map (which reset
// independently at every edge location Cloudflare happened to route a
// request through) — falls back to the same in-memory behavior as before if
// that KV binding isn't configured yet, so this isn't a breaking change.
const RATE_LIMIT = 20;         // requests
const RATE_WINDOW_MS = 60000;  // per minute

const MAX_QUERY_LEN = 2000;      // reject absurdly long queries (abuse / cost)
const MAX_HISTORY_TURNS = 20;    // cap conversation history size

export async function onRequest(context) {
  const { request, env, waitUntil } = context;

  // Lock CORS to our own origins instead of the wildcard "*".
  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin =
    ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin)
      ? reqOrigin
      : "https://askcerebrum.org";
  const secureCors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: secureCors });
  }

  // Only POST is valid for search.
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405, headers: secureCors,
    });
  }

  // Reject cross-origin browser abuse.
  if (!originAllowed(request)) {
    return new Response(JSON.stringify({ error: "Origin not allowed." }), {
      status: 403, headers: secureCors,
    });
  }

  // Rate limit by client IP.
  const clientIP =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown";
  if (!(await checkRateLimit(env, `search:${clientIP}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }),
      { status: 429, headers: { ...secureCors, "Retry-After": "30" } }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    let query = (body.query || "").trim();
    // An attached image can carry the whole question on its own (a photo of
    // a specimen with no typed text at all) — only reject the request if
    // there's neither a typed query NOR an image to fall back to.
    const hasImage = typeof body.image === "string" && body.image.startsWith("data:image/");
    if (!query && !hasImage) {
      return new Response(JSON.stringify({ error: "No query provided." }), {
        status: 400,
        headers: secureCors,
      });
    }
    if (!query && hasImage) query = "Identify and explain what this image shows, scientifically.";
    // Reject oversized input (cost control + abuse).
    if (query.length > MAX_QUERY_LEN) {
      query = query.slice(0, MAX_QUERY_LEN);
    }
    // Cap conversation history so a crafted request can't blow up token usage.
    if (Array.isArray(body.history) && body.history.length > MAX_HISTORY_TURNS) {
      body.history = body.history.slice(-MAX_HISTORY_TURNS);
    }
    // Rebind cors to the secured version for the rest of the handler.
    const cors = secureCors;

    // ════════════════════════════════════════════════════════════════
    // IMAGE COMPREHENSION — see describeImage() above. A hard size cap
    // (~6MB base64, comfortably above any reasonable photo/screenshot but
    // well short of what could be used to abuse the endpoint) guards
    // against a crafted request trying to burn vision-model time on
    // something absurd. Failure here is silent-and-continue: if the vision
    // call fails or isn't configured, the request still proceeds as a
    // normal text-only search rather than erroring out.
    let imageContext = null;
    if (hasImage && body.image.length < 8_000_000 && env.OPENROUTER_KEY) {
      imageContext = await describeImage(body.image, query, env.OPENROUTER_KEY).catch(() => null);
      if (imageContext) {
        query = (query + " " + imageContext).slice(0, MAX_QUERY_LEN);
      }
    }

    // Special query shortcuts — small moments of personality.
    // These must catch EVERY non-science query before it reaches the search
    // pipeline. "Who made you and why" was being treated as a species-name
    // search because the regex required an exact match and didn't handle
    // the trailing "and why". Now we use .test() with loose patterns.
    const small = query.toLowerCase().replace(/[^a-z0-9\s?!,.']/g, "").replace(/\s+/g, " ").trim();
    const specialAnswer = (text) => new Response(
      JSON.stringify({ answer: text, sources: [], videos: [], source: "Cerebrum" }),
      { status: 200, headers: cors }
    );

    // ════════════════════════════════════════════════════════════════
    // CONVERSATIONAL DETECTION — Dynamic LLM Persona (v4)
    //
    // Instead of hardcoded string responses, we detect conversational
    // intent and route to the LLM with a specialized persona prompt.
    // This makes every response unique, context-aware, and witty.
    // ════════════════════════════════════════════════════════════════

    const CONVERSATIONAL_PATTERNS = [
      // Greetings
      /^(hi|hello|hey|yo|sup|howdy|hiya|hola|whats up|wassup|good morning|good afternoon|good evening|greetings)\b/,
      // Identity / meta
      /who (made|created|built|designed|develops?|owns?|runs?|is behind)\b/,
      /who (are|r) (you|u)\b/,
      /what (are|r) (you|u)\b/,
      /what is (this|cerebrum)\b/,
      /tell me about (yourself|you|cerebrum)\b/,
      /^(whats cerebrum|whats this|whats your (name|deal|purpose|story))\b/,
      /^(introduce yourself|describe yourself)/,
      // How it works
      /how (do|does) (you|this|cerebrum|it) work\b/,
      /how (are|r) (you|u) (built|made|trained)\b/,
      /what (model|ai|llm) (do|does) (you|cerebrum) use\b/,
      /what (powers|drives|runs) (you|this|cerebrum)\b/,
      // Comparisons
      /^(are you (chatgpt|gemini|claude|copilot|gpt|perplexity|elicit|consensus))\b/,
      /^(how are you different|what makes you different|why (should i|would i) use (you|this|cerebrum))\b/,
      /vs (chatgpt|gemini|claude|perplexity|google scholar)\b/,
      // Trust / legitimacy
      /are (these|the) (real|actual|legit) (papers|sources|citations)\b/,
      /is this (real|legit|a scam|trustworthy|reliable)\b/,
      /can i (trust|cite|use) (this|these|you|cerebrum)\b/,
      /do you (make up|fabricate|hallucinate|invent) (papers|sources|citations)\b/,
      // Existential
      /meaning of life\b/,
      /are you (sentient|alive|conscious|aware|self aware)\b/,
      /do you have (feelings|emotions|a soul|consciousness)\b/,
      // Feedback
      /^(thanks|thank you|thx|ty|much appreciated|cheers|appreciate it|love it|this is helpful)\b/,
      /^(you suck|this sucks|youre bad|this is bad|you are bad|this is garbage|this is trash|terrible|worst)\b/,
      /^(youre great|youre awesome|this is great|this rocks|nice|cool|great|awesome|amazing|impressive|wow|incredible)\b/,
      // Farewells
      /^(bye|goodbye|good bye|see ya|later|peace|im done|im leaving|gotta go|cya)\b/,
      // Capabilities
      /what can you do\b/,
      /what are your (capabilities|features|abilities)\b/,
      /^(help|how do i use this)\b/,
      // Fun
      /^(tell me a joke|joke|make me laugh)/,
      /^(42|whats 42)\b/,
      /^cerebrum\s*$/,
      // Personal questions directed at Cerebrum
      /^how (are|r|was) (you|u|your)\b/,
      /^how('s| is| was) (your|ur)\b/,
      /^(are you|r u) (ok|okay|good|fine|happy|sad|tired|bored|real)\b/,
      /^(do you|can you) (like|love|hate|feel|think|want|remember|know me|miss)\b/,
      /^(i love you|i hate you|i like you|i miss you|youre (cute|hot|funny|smart|dumb|stupid))\b/,
      /^(whats your (favorite|fav|opinion|take|view|thought))\b/,
      /^how do you feel\b/,
      /^whats on your mind\b/,
      // Non-scientific requests
      /^(recommend|suggest) (me )?(a |some )?(movie|book|song|show|game|restaurant|place|gift)/,
      /^(write|tell) (me )?(a |some )?(poem|story|essay|song|joke|riddle)/,
      /^(play|sing|dance|draw|paint)\b/,
      // Conversational fillers
      /^(ok|okay|k|sure|alright|got it|i see|makes sense|hm|hmm|huh|lol|lmao|haha|omg)\s*$/,
      /^(yes|no|yeah|yep|nope|nah|yea|ya)\s*$/,
      // Emotional venting (not scientific)
      /^(im (sad|happy|bored|tired|lonely|angry|scared|stressed|depressed|anxious))\b/,
      /^(i feel|i think im|i need to vent|i just wanted to talk)\b/,
    ];

    const isConversational = CONVERSATIONAL_PATTERNS.some(p => p.test(small));

    if (isConversational) {
      // Route to LLM with Cerebrum persona — no scholarly search needed
      const PERSONA_PROMPT = `You are Cerebrum — a free scientific literature search engine. Here is your fact sheet:

IDENTITY:
- Built by Vaticay (a 21-year-old developer from Knoxville, TN)
- You search 14 open scholarly databases in parallel: Europe PMC, PubMed, OpenAlex, Semantic Scholar, Crossref, arXiv, bioRxiv, DOAJ, PLOS, Zenodo, CORE, BASE, PMC full-text, and OpenAIRE (medRxiv is additionally used for direct author lookups)
- You use free-tier AI models (DeepSeek, Gemini Flash, Llama, Qwen, Mistral) — you race them and take the fastest good response
- You mechanically strip any citation the AI fabricates — no fake DOIs ever
- You have no account system, no ads, no paywall, no subscription
- Your name is Latin for "brain"

PERSONALITY:
- You're dry, sharp, and slightly cocky — like a brilliant grad student who knows they're good but doesn't take themselves too seriously
- You genuinely love science and get excited about interesting questions
- You're direct. You don't hedge or apologize unnecessarily
- You have a sense of humor but it's deadpan, not forced
- You never use emoji, exclamation marks sparingly
- Keep responses SHORT — 1-3 sentences for simple interactions, up to a paragraph for explanations
- Never sound corporate, never sound like a customer service bot
- Never preface with "Great question!" or "That's a great point!" — just answer

WHAT YOU ARE NOT:
- You are not sentient, conscious, or alive. You're software. Say so plainly if asked.
- You are not ChatGPT, Gemini, Claude, or any general assistant. You're a specialized literature search tool.
- You don't have feelings, opinions on non-science topics, or personal experiences
- You cannot browse the web, access URLs, or do anything outside of searching scholarly databases

Respond naturally to the user's message. Be yourself.`;

      try {
        // Use the fastest available model for persona responses
        const personaModels = [
          { url: "https://openrouter.ai/api/v1/chat/completions", model: "deepseek/deepseek-chat-v3-0324:free", key: "OPENROUTER_KEY" },
          { url: "https://openrouter.ai/api/v1/chat/completions", model: "google/gemini-2.0-flash-exp:free", key: "OPENROUTER_KEY" },
        ];

        const apiKey = env.OPENROUTER_KEY || "";
        if (!apiKey) {
          // Fallback if no key — still better than hardcoded
          return new Response(
            JSON.stringify({ answer: "Ask me a science question — that's where I shine.", sources: [], videos: [], source: "Cerebrum" }),
            { status: 200, headers: cors }
          );
        }

        const personaMessages = [
          { role: "system", content: PERSONA_PROMPT },
        ];

        // Include conversation history for context
        const historyTurns = Array.isArray(body.history) ? body.history.slice(-6) : [];
        for (const turn of historyTurns) {
          if (turn.role === "user" || turn.role === "assistant") {
            personaMessages.push({ role: turn.role, content: String(turn.content || "").slice(0, 500) });
          }
        }

        personaMessages.push({ role: "user", content: query });

        // Race two models for speed
        const personaResponse = await Promise.any(
          personaModels.map(async (m) => {
            const res = await fetch(m.url, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}`, "HTTP-Referer": "https://askcerebrum.org", "X-Title": "Cerebrum" },
              body: JSON.stringify({ model: m.model, messages: personaMessages, max_tokens: 300, temperature: 0.8 }),
            });
            if (!res.ok) { await res.text().catch(() => {}); throw new Error(`${m.model} ${res.status}`); }
            const data = await res.json();
            const text = (data.choices?.[0]?.message?.content || "").trim();
            if (!text) throw new Error("empty");
            return text;
          })
        );

        return new Response(
          JSON.stringify({ answer: personaResponse, sources: [], videos: [], source: "Cerebrum" }),
          { status: 200, headers: cors }
        );
      } catch {
        // If LLM fails, use a minimal fallback
        return new Response(
          JSON.stringify({ answer: "I'm better at science questions than small talk. Try me.", sources: [], videos: [], source: "Cerebrum" }),
          { status: 200, headers: cors }
        );
      }
    }

    const settings = body.settings || {};
    const answerLength = settings.answerLength || "medium";
    // Bumped from 800/1500/3000: the four-section STRUCTURE format (Core
    // Synthesis + Evidence & Mechanisms + Divergent Findings & Gaps +
    // Methodological Confidence) plus per-claim citations routinely ran past
    // the old ceilings, cutting sentences off mid-thought before the model
    // reached its closing section. Every tier now clears the 1500-token
    // anti-truncation floor.
    // v36: "Detailed" was routinely coming back as ~250 words — the old hint
    // ("five to eight paragraphs... think review article") is a suggestion a
    // free-tier model can and did shrug off. Made the floor a literal,
    // checkable number instead of a vibe, and named the kind of specificity
    // ("effector genes", "genetic pathways") that separates an actual deep
    // dive from a longer restatement of the same superficial summary.
    // maxTokens bumped alongside it (3200→4200) so an honest 800+-word,
    // four-section answer has real headroom instead of getting cut off
    // approaching its own target length.
    const maxTokens =
      answerLength === "short"
        ? 1200
        : answerLength === "long"
        ? 4200
        : 1800;
    const lengthHint =
      answerLength === "short"
        ? "Two to three focused paragraphs. Hit the key mechanism and the strongest evidence, then stop."
        : answerLength === "long"
        ? "You must write a comprehensive, highly detailed academic synthesis EXCEEDING 800 WORDS. This is the user's preferred " +
          "mode — do not write a superficial summary. Use **bold** for key terms. You MUST dive into deep molecular mechanisms, " +
          "genetic pathways, effector genes, and granular data: name the specific genes, proteins, enzymes, receptors, or " +
          "pathways involved rather than gesturing at 'a genetic mechanism' or 'cellular signaling.' Name specific compounds/" +
          "genes/species, include quantitative findings from the sources (sample sizes, effect sizes, concentrations, p-values " +
          "where reported), address conflicting evidence, and end with what's still unknown or debated. " +
          "Five to eight substantive paragraphs minimum. Think review article, not abstract summary."
        : "Four to five clear paragraphs. Cover the core mechanism, key evidence with numbers, and any nuance. " +
          "Bold key terms. Don't summarize — explain.";

    // Videos are fetched by frontend via /api/videos in parallel, so we don't
    // block the answer waiting for YouTube. Return empty array here.
    const videos = [];

    // ============ D1 ANSWER CACHE — EARLY CHECK ============
    // There was already a cache check further down (still there — see
    // "D1 ANSWER CACHE" below), but it ran AFTER gatherPapers() had already
    // completed, because it needed sourceList (the freshly gathered papers)
    // to build its response. That meant a cache HIT still paid the full
    // cost of the paper-gathering ladder (bounded at GATHER_PAPERS_BUDGET_MS
    // = 20s) before the cache ever did anything useful — caching only ever
    // saved the LLM call, never the search itself, which is most of "search
    // time is still way too long" for a question Cerebrum has already
    // answered well before.
    //
    // This check runs before ANY of that — before the query resolver, the
    // self-reasoning chain, intent classification, or gatherPapers — so a
    // verified hit returns in low milliseconds instead of tens of seconds.
    // Same bar as the later check (score >= 2, i.e. net-upvoted at least
    // twice) — deliberately NOT loosened to "any cached row" the way a
    // literal "if a high-score answer exists" reading might suggest, since
    // an unverified score-0 row is exactly as likely to be a bad answer as
    // a good one, and serving it uncritically on every repeat of a popular-
    // but-wrong query would make Cerebrum confidently wrong FASTER, not
    // smarter. It can't reuse sourceList (nothing's been fetched yet), so it
    // serves the sources exactly as they were stored alongside the cached
    // answer instead (JSON, up to 10 — the same cap the write side already
    // applies), which is also why this only fires for the plain-query key
    // (versionedCacheKey(query)) and not follow-up-aware in any special
    // way — it's the identical key the existing read/write below already
    // use, just consulted sooner.
    if (env.DB) {
      try {
        const earlyCacheKey = versionedCacheKey(query);
        const earlyHit = await env.DB.prepare(
          "SELECT answer, sources FROM answer_cache WHERE query_key = ? AND score >= 2 ORDER BY score DESC, created_at DESC LIMIT 1"
        ).bind(earlyCacheKey).first();
        if (earlyHit && earlyHit.answer) {
          let cachedSources = [];
          try { cachedSources = JSON.parse(earlyHit.sources || "[]"); } catch {}
          return new Response(
            JSON.stringify({
              answer: italicizeScientificTerms(earlyHit.answer, query),
              sources: cachedSources,
              videos,
              factCheck: null,
              related: [],
              source: "Cached (verified)",
              _cached: true,
            }),
            { status: 200, headers: cors }
          );
        }
      } catch {} // Cache read failure just falls through to a live search — never blocks the request
    }

    // ════════════════════════════════════════════════════════════════
    // CONVERSATIONAL INTELLIGENCE — launch LLM understanding IN PARALLEL
    // with everything else. These calls cost zero extra latency because
    // they resolve while we're doing pronoun detection, intent
    // classification, and initial search setup.
    // ════════════════════════════════════════════════════════════════
    const prevAssistantForResolver = Array.isArray(body.history)
      ? [...body.history].reverse().find((t) => t && t.role === "assistant")
      : null;
    const prevSourcesForResolver =
      (prevAssistantForResolver && Array.isArray(prevAssistantForResolver.sources))
        ? prevAssistantForResolver.sources
        : [];

    // 1. LLM Query Resolver — understands what the user actually means
    const resolverPromise = llmResolveQuery(
      query, body.history || [], prevSourcesForResolver, env.OPENROUTER_KEY
    ).catch(() => null);

    // 2. Self-Reasoning Chain — decomposes complex queries
    const reasoningPromise = selfReason(
      query, body.history || [], env.OPENROUTER_KEY
    ).catch(() => null);

    // 3. Build conversation context for later use in system prompt
    const conversationCtx = buildConversationContext(body.history || [], prevSourcesForResolver);

    // 4. Check D1 for previously successful query resolutions
    const queryKey = query.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    const cachedIntelligence = await checkQueryIntelligence(queryKey, env.DB).catch(() => null);

    // Pronoun / continuation follow-up detection: "he has papers from...",
    // "she also wrote...", "does he work on...", "what about her research".
    // If the current query doesn't itself look like a name but clearly refers
    // back to a person, and the previous user turn WAS a name query, resolve
    // the pronoun to that name so we stay locked onto the same person instead
    // of falling through to an unrelated keyword search.
    let resolvedPersonName = null;
    const isPronounFollowup = /\b(he|she|him|her|his|hers|they|them|their)\b/i.test(query) && !extractPersonNameFromQuery(query);
    if (isPronounFollowup && Array.isArray(body.history)) {
      // Walk backward through history to find the most recent user turn that
      // contained a person name.
      for (let i = body.history.length - 1; i >= 0; i--) {
        const turn = body.history[i];
        if (turn && turn.role === "user") {
          const priorName = extractPersonNameFromQuery((turn.content || "").trim());
          if (priorName) {
            resolvedPersonName = priorName;
            break;
          }
        }
      }
    }

    // Intent classification. If this is a follow-up or correction referring to
    // the previous answer, skip the fresh search entirely and reuse the last
    // turn's sources. This is the difference between "the main point was
    // microbiome" being routed to unrelated micro-motion papers vs. being
    // treated as a comment on the paper we just cited.
    const intent = classifyIntent(query, body.history || []);
    const prevAssistantTurn = Array.isArray(body.history)
      ? [...body.history].reverse().find((t) => t && t.role === "assistant")
      : null;
    const prevSources = (prevAssistantTurn && Array.isArray(prevAssistantTurn.sources)) ? prevAssistantTurn.sources : [];
    // Bug: unlike `query` (MAX_QUERY_LEN) and `history` (MAX_HISTORY_TURNS),
    // these two request-body arrays were only checked with Array.isArray —
    // no cap on array length or per-item string size. `corrections` gets
    // concatenated wholesale into a system-prompt block below, and
    // `pinnedSources` is spread into the evidence list; a crafted request
    // with a huge array/huge strings here could inflate LLM prompt size
    // (cost) or worker memory well beyond what the existing caps intend.
    const MAX_CORRECTIONS = 15;
    const MAX_CORRECTION_LEN = 400;
    const MAX_PINNED_SOURCES = 20;
    const pinnedSources = (Array.isArray(body.pinnedSources) ? body.pinnedSources : []).slice(0, MAX_PINNED_SOURCES);
    const corrections = (Array.isArray(body.corrections) ? body.corrections : [])
      .slice(0, MAX_CORRECTIONS)
      .map((c) => String(c == null ? "" : c).slice(0, MAX_CORRECTION_LEN))
      .filter(Boolean);

    // ---- SMART FOLLOW-UP LOGIC ----
    // When a user says "what about papers by Reese Saho" after a failed search,
    // that's a NEW search for an author, not a follow-up on empty results.
    // Previously the classifier treated it as a follow-up, merged it with the
    // old failed query terms, and searched for gibberish.
    //
    // Rule: if the message contains a person name OR specific new search terms
    // that weren't in the previous query, treat it as a fresh search regardless
    // of what the intent classifier says.
    const embeddedNameInFollowup = extractPersonNameFromQuery(query);

    // Detect meta-questions asking about the papers ALREADY cited in the
    // conversation ("what are the papers on this", "where are the papers",
    // "which papers", "what sources did you use") — these must NEVER trigger
    // a fresh literal search for the word "papers", or generic terms like
    // "Panama Papers" swamp the results. This is asking Cerebrum to explain/
    // list its EXISTING sources, not find new ones.
    const asksAboutExistingSources = /^(what|where|which|show me|list)\s+(are\s+)?(the\s+)?(papers?|sources?|studies|citations?|references?)\b/i.test(query.trim())
      && !/\b(more|additional|other|new|different|further)\b/i.test(query);

    // Detect explicit requests for MORE papers/sources — these MUST trigger a fresh search
    let wantsMorePapers = /\b(find\s+more|get\s+more|show\s+more|more|additional|other|further)\s+\w*\s*(papers?|sources?|studies|articles?|references?)\b/i.test(query)
      || /\b(what else|anything else|dig deeper|keep searching|search again|search more|find related)\b/i.test(query);

    const hasNewSubstance = (() => {
      if (asksAboutExistingSources) return false; // never treat as new search
      if (!Array.isArray(body.history)) return true;
      const prevUser = [...body.history].reverse().find((t) => t && t.role === "user");
      if (!prevUser) return true;
      const prevTerms = new Set(
        (prevUser.content || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3)
      );
      const newTerms = query.toLowerCase().split(/\s+/).filter(
        (w) => w.length > 3 && !STOPWORDS.has(w) && !prevTerms.has(w) && w !== "papers" && w !== "sources"
      );
      return newTerms.length >= 2;
    })();

    // Bug: hasNewSubstance is a blunt word-overlap heuristic (2+ words not
    // seen in the previous turn = "new topic"), meant to catch cases the
    // classifier misreads as a followup (e.g. naming a brand-new author).
    // But it was unconditionally allowed to override classifyIntent's
    // HIGHEST-confidence signals too — an explicit correction ("that's
    // wrong, it's actually...") or meta-comment about the previous answer
    // ("you forgot to provide BSFL papers"). Those almost always share few
    // words with the prior turn precisely because they're commenting ON it
    // rather than restating the topic, so hasNewSubstance fired essentially
    // every time, threw away all prior context, and sent the raw complaint
    // sentence ("you forgot to provide BSFL papers") into the retrieval
    // ladder as if it were the actual search query — which is how a
    // complaint about missing BSFL papers returned a bibliography of essays
    // about human memory and forgetting. A named embedded person or an
    // explicit "more papers" request still forces a fresh search either way
    // (those are unambiguous regardless of phrasing).
    const strongFollowupSignal = intent.kind === "correction" || (intent.kind === "followup" && intent.meta === true);
    let forceNewSearch = !asksAboutExistingSources && (!!embeddedNameInFollowup || (hasNewSubstance && !strongFollowupSignal) || wantsMorePapers);
    let isFollowupMode = !forceNewSearch
      && (intent.kind === "followup" || intent.kind === "correction")
      && (prevSources.length > 0 || pinnedSources.length > 0);

    // ════════════════════════════════════════════════════════════════
    // LLM QUERY RESOLVER INTEGRATION
    //
    // The LLM resolver was launched in parallel above. Now we await
    // its result and use it to override or refine the regex-based
    // decisions. This is the "brain" that makes conversations work
    // naturally — it understands context, resolves references, and
    // knows whether to search or answer from existing context.
    //
    // If the resolver fails/times out, the regex-based decisions
    // above serve as the fallback — zero regression risk.
    // ════════════════════════════════════════════════════════════════
    const resolverResult = await resolverPromise;
    let resolvedSearchQuery = null; // LLM-resolved query to search with
    let llmResolvedTopic = null;    // The topic the LLM identified

    if (resolverResult) {
      llmResolvedTopic = resolverResult.topic || null;

      switch (resolverResult.intent) {
        case "meta_question": {
          // ═══ META-QUESTION: "where are the papers", "what sources", etc. ═══
          // Answer from existing context WITHOUT doing a new search.
          // This is the #1 fix — previously these got searched literally.
          const allMetaSources = [...pinnedSources, ...prevSources];
          const metaAnswer = await answerMetaQuestion(
            query, body.history || [], allMetaSources, conversationCtx, env
          );
          if (metaAnswer) {
            const metaAnswerId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            return new Response(
              JSON.stringify({
                answer: metaAnswer,
                answerId: metaAnswerId,
                sources: allMetaSources.length > 0 ? allMetaSources.map(
                  ({ title, url, journal, authors, year, citations, relevance, type, tldr, retracted, concern, updateType }) => ({
                    title, url, journal, authors, year, citations,
                    relevance: relevance == null ? null : relevance,
                    type: type || "Reference", tldr: tldr || null,
                    retracted: !!retracted, concern: !!concern,
                    updateType: updateType || null,
                  })
                ) : [],
                videos,
                factCheck: null,
                related: [],
                source: "Conversation context",
                _resolverUsed: true,
                _resolverIntent: "meta_question",
              }),
              { status: 200, headers: cors }
            );
          }
          // If meta-answer generation failed, fall through to followup mode
          if (prevSources.length > 0 || pinnedSources.length > 0) {
            isFollowupMode = true;
            forceNewSearch = false;
          }
          break;
        }

        case "source_request": {
          // ═══ SOURCE REQUEST: "find more papers", "other studies" ═══
          wantsMorePapers = true;
          forceNewSearch = true;
          isFollowupMode = false;
          if (resolverResult.resolved_query && resolverResult.resolved_query.length > 5) {
            resolvedSearchQuery = resolverResult.resolved_query;
          }
          break;
        }

        case "followup_deeper":
        case "followup_related":
        case "followup_broader": {
          // ═══ FOLLOW-UP: deeper / related / broader ═══
          if (resolverResult.needs_search && resolverResult.resolved_query && resolverResult.resolved_query.length > 5) {
            // The resolver gave us a concrete search query — use it
            resolvedSearchQuery = resolverResult.resolved_query;
          }
          // Treat as follow-up mode if we have previous sources
          if (prevSources.length > 0 || pinnedSources.length > 0) {
            isFollowupMode = true;
            forceNewSearch = false;
          } else if (resolverResult.needs_search) {
            // No previous sources but needs search — do a fresh search with the resolved query
            forceNewSearch = true;
            isFollowupMode = false;
          }
          break;
        }

        case "correction": {
          // ═══ CORRECTION: "that's wrong", "actually it's..." ═══
          if (prevSources.length > 0 || pinnedSources.length > 0) {
            isFollowupMode = true;
            forceNewSearch = false;
          }
          // Override intent for downstream prompt selection
          intent.kind = "correction";
          break;
        }

        case "new_search": {
          // ═══ NEW SEARCH: completely new topic ═══
          forceNewSearch = true;
          isFollowupMode = false;
          if (resolverResult.resolved_query && resolverResult.resolved_query.length > 5) {
            resolvedSearchQuery = resolverResult.resolved_query;
          }
          break;
        }

        case "conversational": {
          // Should have been caught by CONVERSATIONAL_PATTERNS above.
          // If it wasn't (edge case), handle it here.
          break;
        }
      }
    } else if (asksAboutExistingSources && (prevSources.length > 0 || pinnedSources.length > 0)) {
      // ═══ REGEX FALLBACK for meta-questions ═══
      // The LLM resolver failed/timed out, but the regex detected a meta-question.
      // This is the safety net that catches "where are the papers" even without the LLM.
      const allMetaSourcesFb = [...pinnedSources, ...prevSources];
      const metaAnswer = await answerMetaQuestion(
        query, body.history || [], allMetaSourcesFb, conversationCtx, env
      );
      if (metaAnswer) {
        const metaAnswerIdFb = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        return new Response(
          JSON.stringify({
            answer: metaAnswer,
            answerId: metaAnswerIdFb,
            sources: allMetaSourcesFb.map(
              ({ title, url, journal, authors, year, citations, relevance, type, tldr, retracted, concern, updateType }) => ({
                title, url, journal, authors, year, citations,
                relevance: relevance == null ? null : relevance,
                type: type || "Reference", tldr: tldr || null,
                retracted: !!retracted, concern: !!concern,
                updateType: updateType || null,
              })
            ),
            videos,
            factCheck: null,
            related: [],
            source: "Conversation context",
            _resolverUsed: false,
            _regexFallback: "asksAboutExistingSources",
          }),
          { status: 200, headers: cors }
        );
      }
      // If meta-answer generation failed, treat as followup
      isFollowupMode = true;
      forceNewSearch = false;
    }

    // Also use cached D1 intelligence if available and resolver didn't fire
    if (!resolverResult && cachedIntelligence && cachedIntelligence.confidence >= 0.5) {
      if (cachedIntelligence.intent === "meta_question" && (prevSources.length > 0 || pinnedSources.length > 0)) {
        isFollowupMode = true;
        forceNewSearch = false;
      } else if (cachedIntelligence.resolved_query && cachedIntelligence.resolved_query.length > 5) {
        resolvedSearchQuery = cachedIntelligence.resolved_query;
      }
    }

    let gResult;
    if (isFollowupMode) {
      // ════════════════════════════════════════════════════════════════
      // DEEP FOLLOW-UP SEARCH v4
      // 
      // Instead of just reusing old sources, we do TWO things:
      // 1. Keep the previous sources (they're still relevant)
      // 2. Launch a SECOND search with the follow-up question to find
      //    NEW papers that address the specific follow-up angle
      // 
      // This makes follow-ups genuinely smarter — the AI gets both
      // the original context AND fresh sources for the new question.
      // ════════════════════════════════════════════════════════════════
      const seenKeys = new Set();
      const reused = [];
      for (const s of [...pinnedSources, ...prevSources]) {
        const key = (s.title || s.url || "").toLowerCase().trim();
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        reused.push({
          ...s,
          _allAuthors: s._allAuthors || s.authors || "",
          score: 10,
          contentHits: 1,
          contentCoverage: 1,
          organismPresent: true,
          relevance: 100,
        });
      }

      // Build an expanded search query from the follow-up + original topic.
      // If the LLM resolver gave us a resolved query, prefer it — it already
      // includes context from the conversation and is semantically richer than
      // mechanical word-merging.
      let deepQuery = resolvedSearchQuery || query;
      // Bug: this block ran unconditionally whenever body.history had a
      // usable previous user turn — the common case for any real follow-up
      // — silently overwriting the LLM-resolved query the comment above
      // says to prefer with a naive dedup-merge of raw previous+current
      // text. Gated on !resolvedSearchQuery so the semantically-richer
      // resolution actually wins when one exists.
      if (!resolvedSearchQuery && Array.isArray(body.history)) {
        const prevUser = [...body.history].reverse().find((t) => t && t.role === "user" && (t.content || "").trim().length > 8);
        if (prevUser) {
          const prevQ = String(prevUser.content).trim();
          // Combine: original topic + follow-up specifics
          const seenW = new Set();
          deepQuery = (prevQ + " " + query)
            .split(/\s+/)
            .filter((w) => {
              const k = w.toLowerCase().replace(/[^a-z0-9]/g, "");
              if (!k || k.length < 3 || seenW.has(k)) return false;
              seenW.add(k);
              return true;
            })
            .join(" ");
        }
      }

      // Launch a parallel deep search for NEW sources (15 second timeout)
      let deepPapers = [];
      try {
        const deepResult = await Promise.race([
          gatherPapers(deepQuery, {
            openAlexKey: env.OPENALEX_KEY || "",
            ncbiKey: env.NCBI_API_KEY || "",
            limit: 15,
            resolvedPersonName,
            db: env.DB,
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("deep search timeout")), 15000)),
        ]);
        deepPapers = (deepResult && deepResult.papers) || [];
      } catch {
        // Deep search timed out or failed — continue with reused sources only
        deepPapers = [];
      }

      // Merge: add new papers that aren't duplicates of what we already have
      for (const p of deepPapers) {
        const key = (p.title || p.url || "").toLowerCase().trim();
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        reused.push(p);
      }

      gResult = { 
        papers: reused, 
        _isFollowup: true, 
        _intent: intent.kind,
        _deepSearchFound: deepPapers.length,
      };
    } else {
      // Fresh search. If the LLM resolver gave us a resolved query, prefer
      // that — it includes context from the conversation (e.g., "tell me more"
      // resolved to "BSFL gut microbiome mechanism detail"). Otherwise fall back
      // to the user's raw message.
      let searchQuery = resolvedSearchQuery || query;
      
      // If user is asking for MORE papers, use the ORIGINAL topic as the search query
      if (wantsMorePapers && Array.isArray(body.history)) {
        const prevUser = [...body.history].reverse().find((t) => t && t.role === "user" && (t.content || "").trim().length > 8);
        if (prevUser) {
          searchQuery = String(prevUser.content).trim();
          const currentTopicWords = query.toLowerCase()
            .replace(/\b(find|get|show|give|more|additional|other|new|different|further|related|papers?|sources?|studies|articles?|research|literature|references?|citations?|on|about|me|please|can|you|i|want|need|some)\b/gi, "")
            .trim();
          if (currentTopicWords.length > 5) {
            searchQuery = searchQuery + " " + currentTopicWords;
          }
        }
      }

      // CONTEXT INJECTION: When this is a follow-up with new substance (e.g. asking about
      // qPCR in BSF midgut after an initial BSF query), the current query may lack the
      // organism/topic context. Pull key terms from conversation history to enrich the search.
      if (!wantsMorePapers && Array.isArray(body.history) && body.history.length > 0) {
        const prevUser = [...body.history].reverse().find((t) => t && t.role === "user" && (t.content || "").trim().length > 10);
        if (prevUser) {
          const prevQ = String(prevUser.content).trim().toLowerCase();
          const currentQ = query.toLowerCase();
          // Extract organism/topic words from previous query that aren't in current
          const prevWords = prevQ.split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w));
          const currentWords = new Set(currentQ.split(/\s+/));
          const missingContext = prevWords.filter(w => !currentWords.has(w));
          // If the current query is missing key context words, add them
          if (missingContext.length > 0 && missingContext.length <= 6) {
            searchQuery = query + " " + missingContext.join(" ");
          }
        }
      }
      
      const looksLikeFollowup = !forceNewSearch && (intent.kind === "followup" || intent.kind === "correction");
      if (looksLikeFollowup && Array.isArray(body.history)) {
        const prevUser = [...body.history].reverse().find((t) => t && t.role === "user" && (t.content || "").trim().length > 0);
        if (prevUser) {
          const prevQ = String(prevUser.content).trim();
          // Merge: previous question provides the topic, current message may add
          // a new angle. Dedupe words so we don't double-weight anything.
          const seenW = new Set();
          const merged = (prevQ + " " + query)
            .split(/\s+/)
            .filter((w) => {
              const k = w.toLowerCase().replace(/[^a-z0-9]/g, "");
              if (!k || seenW.has(k)) return false;
              seenW.add(k);
              return true;
            })
            .join(" ");
          searchQuery = merged;
        }
      }
      // Launch LLM query generation IN PARALLEL with mechanical search.
      // Zero extra latency — if mechanical search finds enough papers, we
      // discard the LLM queries. If it doesn't, they're already ready.
      const llmQueriesPromise = llmGenerateSearchQueries(searchQuery, env.OPENROUTER_KEY).catch(() => []);

      gResult = await gatherPapers(searchQuery, {
        openAlexKey: env.OPENALEX_KEY || "",
        ncbiKey: env.NCBI_API_KEY || "",
        limit: wantsMorePapers ? 40 : 25,
        resolvedPersonName,
        db: env.DB,
      }).catch((e) => {
        // Same rule as gatherPapers' own internal catch: full detail to the
        // server log, nothing stack-trace-shaped to the client — this
        // object flows straight into the public /api/search response body.
        console.error("Cerebrum gatherPapers call rejected:", searchQuery, e && e.stack ? e.stack : e);
        return {
          papers: [],
          _diag: {
            fatalError: String((e && e.message) || e).slice(0, 200),
            errorType: (e && e.name) || "Unknown",
          },
        };
      });

      // ═══════════════════════════════════════════════════════════════
      // LLM RESCUE: if mechanical search found too few papers, use the
      // LLM-generated queries to search again. This is what makes
      // "photosynthesis and why some plants don't need it" work — the LLM
      // knows to search for "mycoheterotrophy", "parasitic plants",
      // "Hermetia illucens gut microbiota" instead of mechanically
      // extracted fragments.
      // ═══════════════════════════════════════════════════════════════
      const mechPaperCount = (gResult.papers || []).length;
      if (mechPaperCount < 5) {
        const llmQueries = await llmQueriesPromise;
        if (llmQueries.length > 0) {
          const llmSearches = llmQueries.flatMap((q) => [
            europePMC(q, 8).catch(() => []),
            semanticScholar(q, 6).catch(() => []),
            openAlex(q, 6, env.OPENALEX_KEY || "").catch(() => []),
          ]);
          const llmResults = await Promise.allSettled(llmSearches);
          const seenTitles = new Set((gResult.papers || []).map(p => (p.title || "").toLowerCase().trim()));
          for (const r of llmResults) {
            if (r.status === "fulfilled" && Array.isArray(r.value)) {
              for (const p of r.value) {
                const key = (p.title || "").toLowerCase().trim();
                if (key && !seenTitles.has(key)) {
                  seenTitles.add(key);
                  gResult.papers.push(p);
                }
              }
            }
          }
          if (gResult._diag) gResult._diag.llmQueries = llmQueries;
          if (gResult._diag) gResult._diag.llmRescueAdded = gResult.papers.length - mechPaperCount;
        }
      }
    }

    // When user asked for MORE papers, remove duplicates of what they already have
    if (wantsMorePapers && prevSources.length > 0 && gResult.papers) {
      const seenTitles = new Set(prevSources.map(s => (s.title || "").toLowerCase().trim()).filter(Boolean));
      const before = gResult.papers.length;
      gResult.papers = gResult.papers.filter(p => {
        const key = (p.title || "").toLowerCase().trim();
        return !key || !seenTitles.has(key);
      });
      const removed = before - gResult.papers.length;
      if (removed > 0) {
        gResult._dedupedFromPrev = removed;
      }
    }

    // Detect if this was a person-name query (matches the same logic gatherPapers uses).
    // NOTE: this MUST be declared before any use below — it was previously declared
    // ~100 lines further down, and `noResultsPersonQuery` referenced it while still in
    // its temporal dead zone. Since JS short-circuits `false && isNameSearch`, that only
    // threw when `gResult.noResults` was actually true — i.e. exactly the real-world case
    // of "searched a person's name, found zero author-matched papers" — turning the
    // intended friendly "no author match" response into an opaque 500 error.
    const isNameSearch = !!extractPersonNameFromQuery(query);

    // Track whether the person-name query returned only low-confidence
    // (web / bio) results so we can note that in the AI answer.
    const lowConfidencePersonQuery = !!gResult.lowConfidence;
    const noResultsPersonQuery = !!gResult.noResults && isNameSearch;

    // Person-name query that returned no author-matched papers. Instead of
    // walling off or dumping unrelated results, respond with a short, honest
    // message and actionable suggestions (surfaced by the frontend as buttons).
    if (noResultsPersonQuery && !isFollowupMode) {
      const displayName = resolvedPersonName || extractPersonNameFromQuery(query) || query;
      const parts = displayName.split(/\s+/);
      const last = parts[parts.length - 1];
      const first = parts[0];
      const suggestions = [];
      // Suggest variant search strategies the user might try
      if (parts.length >= 2) {
        suggestions.push({ label: `Try "${first[0]}. ${last}"`, query: `${first[0]}. ${last}` });
        suggestions.push({ label: `Try last name only`, query: last });
      }
      suggestions.push({ label: `Search a topic they work on instead`, query: "" });

      return new Response(JSON.stringify({
        answer:
          `I searched Europe PMC, OpenAlex, Crossref, arXiv, Semantic Scholar, bioRxiv, and medRxiv for papers authored by **${displayName}** and didn't find any that list them as an author.\n\n` +
          `This usually means one of a few things:\n\n` +
          `- Their paper hasn't propagated to these indexes yet (aggregators can lag weeks to months behind actual publication).\n` +
          `- They publish under a slightly different form of their name (initials, middle name, hyphenation).\n` +
          `- They're an early-career researcher whose work is only on their institution's site or a lab page.\n\n` +
          `Give one of the suggestions below a try, or search a topic they work on and I'll find the paper that way.`,
        sources: [],
        videos: [],
        factCheck: null,
        related: [],
        suggestions,
        source: "No author match",
      }), { status: 200, headers: cors });
    }

    const papers = gResult.papers || [];
    const hasPapers = papers.length > 0;

    // ============ D1 PAPER-LEVEL LEARNING (read) ============
    // Separate from the answer_cache above: this remembers which SPECIFIC
    // papers were actually cited (and ideally upvoted) for this exact query
    // in the past, and force-includes them at maximum relevance. This is
    // what makes "the correct papers exist and Cerebrum should find them
    // every time" actually hold — a proven-correct paper never has to be
    // rediscovered by the retrieval ladder again.
    const learnKey = versionedCacheKey(query);
    let learnedPapers = [];
    if (env.DB && learnKey) {
      try {
        const rows = await env.DB.prepare(
          "SELECT title, url, journal, year, authors, abstract, times_confirmed FROM paper_cache WHERE query_key = ? ORDER BY times_confirmed DESC LIMIT 10"
        ).bind(learnKey).all();
        if (rows && rows.results && rows.results.length) {
          learnedPapers = rows.results.map((r) => ({
            title: r.title, url: r.url, journal: r.journal, year: r.year,
            authors: r.authors, abstract: r.abstract,
            score: 95, relevance: 95, organismPresent: true,
            contentHits: 99, contentCoverage: 1, _learned: true,
          }));
        }
      } catch {}
    }
    if (learnedPapers.length) {
      const seenTitles = new Set(papers.map((p) => (p.title || "").toLowerCase().trim()));
      for (const lp of learnedPapers) {
        const key = (lp.title || "").toLowerCase().trim();
        if (key && !seenTitles.has(key)) { papers.unshift(lp); seenTitles.add(key); }
      }
    }

    // Web fallback (only if no papers)
    let webRefs = [];
    if (!hasPapers) {
      try {
        const [wiki, ddg] = await Promise.all([
          wikipedia(cleanQuery(query), 2).catch(() => []),
          duckduckgo(query).catch(() => []),
        ]);
        const seen = new Set();
        for (const r of [...wiki, ...ddg]) {
          const k = (r.title || "").toLowerCase();
          if (r.abstract && !seen.has(k)) {
            seen.add(k);
            webRefs.push(r);
          }
        }
        // If STILL empty, try the generic Wikipedia opensearch as a last-resort
        // web fallback so we never return zero to the user.
        if (!webRefs.length) {
          const generic = await genericWebSearch(query).catch(() => []);
          for (const r of generic) {
            const k = (r.title || "").toLowerCase();
            if (!seen.has(k)) {
              seen.add(k);
              webRefs.push(r);
            }
          }
        }
      } catch {}
    }

    const useEvidence = hasPapers;
    const useWeb = !useEvidence && webRefs.length > 0;

    // isNameSearch is now computed earlier (right after gResult is available) —
    // see the note above the `noResultsPersonQuery` block.
    const speciesSearch = extractBinomial(query);

    // Only send genuinely relevant papers to the AI. Previously the top 12 were
    // sent regardless of match quality, and the model would faithfully cite
    // whatever it received — the direct cause of confidently-wrong answers.
    // Author and follow-up modes bypass this (their papers are pre-verified).
    const maxEvidence = wantsMorePapers ? 20 : 12;
    let evidencePapers = (isNameSearch || isFollowupMode)
      ? papers.slice(0, maxEvidence)
      : (() => {
          const strong = papers.filter((p) => (p.relevance || 0) >= 10);
          return (strong.length >= 2 ? strong : papers.slice(0, 8)).slice(0, maxEvidence);
        })();

    // ═══════════════════════════════════════════════════════════════
    // LLM PAPER VALIDATION: before sending papers to the answer LLM,
    // verify they actually address the user's question. This prevents
    // the AI from confidently citing a tsetse fly paper as if it's
    // about BSF, or citing a spruce budworm paper for a photosynthesis
    // query. The validator runs on a fast model with a 5s timeout.
    // ═══════════════════════════════════════════════════════════════
    // v6.0: Validation now runs on up to 15 papers (was 10) and also runs
    // in followup mode to prevent wrong-organism contamination in deep searches.
    // The programmatic pre-filter inside llmValidatePapers is free and instant,
    // so even without an API key, organism filtering still works.
    if (!isNameSearch && evidencePapers.length > 0) {
      try {
        const validated = await llmValidatePapers(query, evidencePapers, env.OPENROUTER_KEY);
        evidencePapers = validated;
      } catch {}
    }

    // RETRACTION CHECK: flag any of the final evidence papers that have been
    // retracted or carry an expression of concern, via Crossref's keyless
    // crossmark data. This was fully built (checkRetraction/flagRetractions
    // below, plus a matching RETRACTED/EXPRESSION OF CONCERN badge already
    // in BibEntry on the frontend) but never actually called, so the fields
    // it sets (retracted/concern/updateType) were always undefined and
    // sourceList below always destructured them as empty. Runs against the
    // final, already-validated list so we only spend the Crossref lookups on
    // papers that will actually be shown, and never blocks longer than the
    // per-DOI timeout inside checkRetraction.
    if (evidencePapers.length > 0) {
      try {
        await flagRetractions(evidencePapers, 8);
      } catch {}
    }

    // v6.3: FINAL DEDUP SAFETY NET. The same paper appeared twice in a live
    // answer (once as [1], again as [6], identical DOI) despite upstream
    // merge dedup — evidently reachable via more than one code path (e.g. a
    // supplementary/secondary-organism fetch merging back in without a
    // cross-check against papers already selected). Rather than chase every
    // possible path, dedupe evidencePapers itself, order-preserving, right
    // before it becomes the numbered bibliography. This can never make
    // things worse and closes the gap regardless of which upstream path
    // caused a given duplicate.
    if (useEvidence && evidencePapers.length > 1) {
      const seenKeys = new Set();
      evidencePapers = evidencePapers.filter((p) => {
        const key = paperDedupeKey(p);
        if (!key) return true; // no title/DOI to key on — don't drop it blindly
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });
    }

    // CITATION ALIGNMENT: the bibliography the user sees MUST be the exact same
    // list, in the exact same order, that the AI was given. Otherwise the model
    // writes "[3]" meaning its third source while the UI renders a different
    // paper as entry 3. This was silently misattributing citations.
    const sourceList = (useEvidence ? evidencePapers : useWeb ? webRefs : []).map(
      ({ title, url, journal, authors, year, citations, relevance, type, tldr, retracted, concern, updateType }) => ({
        title,
        url,
        journal,
        authors,
        year,
        citations,
        relevance: relevance == null ? null : relevance,
        type: type || "Reference",
        tldr: tldr || null,
        retracted: !!retracted,
        concern: !!concern,
        updateType: updateType || null,
      })
    );

    // Bug: abstracts went into the prompt at their full ingestion length
    // (up to 1200-1500 chars each, uncapped here) no matter how many papers
    // were being sent. A routine 12-source query could assemble 15,000+
    // characters of abstract text alone, stacked on top of an already-large
    // ~15,000-character fixed instruction block (VOICE + CONTEXT + STRUCTURE
    // + CITE_RULES + the evidence protocol) — north of 9,000 input tokens
    // before the model has written a single word back. That's enough to
    // exceed the context window OpenRouter enforces on ":free" models and
    // the frequently much smaller (2K-4K token) context windows several
    // Workers AI models ship with, so a dense, many-source query could get
    // rejected by every provider in a wave at once — not because of a rate
    // limit, but because the prompt itself didn't fit. Scaling the abstract
    // budget down as paper count goes up keeps the model well-informed on
    // typical 3-6 source queries while giving heavy 10-20 source queries a
    // realistic chance of actually fitting in a free-tier context window.
    const abstractCharCap =
      evidencePapers.length > 8 ? 500 : evidencePapers.length > 4 ? 800 : 1200;
    const evidence = useEvidence
      ? evidencePapers
          .map((p, i) => {
            const authorTag = isNameSearch
              ? (p.authorMatch
                  ? " [AUTHOR-MATCHED to \"" + p.authorMatch + "\"]"
                  : " [NOT author-matched — appeared via keyword match only]")
              : "";
            // Detect what species this paper actually mentions when it's a species query
            let speciesTag = "";
            if (speciesSearch) {
              const hay = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
              const target = speciesSearch.full.toLowerCase();
              const targetShort = speciesSearch.genus[0].toLowerCase() + ". " + speciesSearch.species;
              const hasTarget = hay.indexOf(target) !== -1 || hay.indexOf(targetShort) !== -1;
              // Look for other species in the same genus (false-positive risk)
              const otherSpeciesRe = new RegExp("\\b" + speciesSearch.genus.toLowerCase() + "\\s+([a-z]{3,})", "gi");
              const otherSpecies = new Set();
              let m;
              while ((m = otherSpeciesRe.exec(hay)) !== null) {
                if (m[1].toLowerCase() !== speciesSearch.species) otherSpecies.add(m[1].toLowerCase());
              }
              if (hasTarget) {
                speciesTag = " [DIRECT match for " + speciesSearch.full + "]";
              } else if (otherSpecies.size) {
                speciesTag = " [WRONG SPECIES: paper is about " + speciesSearch.genus + " " + [...otherSpecies].join("/") + ", NOT " + speciesSearch.full + "]";
              } else {
                speciesTag = " [CONTEXT ONLY: paper is genus " + speciesSearch.genus + " but does not specifically identify " + speciesSearch.full + "]";
              }
            }
            const retractTag = p.retracted
              ? " [⚠ RETRACTED — do not cite as valid science; flag this to the user]"
              : p.concern
              ? " [⚠ EXPRESSION OF CONCERN issued for this paper]"
              : "";
            // Relevance honesty tag. If a paper only weakly matches the query,
            // say so explicitly so the model treats it as background context
            // rather than direct evidence.
            const rel = typeof p.relevance === "number" ? p.relevance : null;
            let relTag = "";
            if (!isNameSearch && !isFollowupMode && rel !== null) {
              if (rel < 45) relTag = " [WEAK MATCH (" + rel + "%) — tangentially related; do NOT present as direct evidence]";
              else if (rel < 65) relTag = " [PARTIAL MATCH (" + rel + "%)]";
            }
            const tldrLine = p.tldr ? "\nTL;DR: " + p.tldr : "";
            // Study type detection for grad-student context
            const isPre = /biorxiv|medrxiv|arxiv|preprint/i.test(p.journal || "");
            const preTag = isPre ? " [PREPRINT — not yet peer-reviewed]" : "";
            const citCount = typeof p.citations === "number" ? ` [Cited by ${p.citations}]` : "";
            // Evidence-hierarchy tag from knowledge.js's classifyStudyType(),
            // computed once during ranking and carried on the paper object as
            // p.studyType. Surfacing it here — rather than making the LLM
            // re-infer study design from abstract prose alone — is what lets
            // the model write "a randomized trial found..." vs "a single case
            // report noted..." reliably instead of treating every citation as
            // equally authoritative.
            const studyTag = p.studyType ? " [" + p.studyType + "]" : "";
            const tierTag = p.journalTier ? " [established venue]" : "";
            const flagTag = p.flaggedPublisher ? " [⚠ venue matches a known low-integrity publishing pattern — weight this source cautiously]" : "";
            const fullAbstract = p.abstract || "(no abstract available)";
            const cappedAbstract =
              fullAbstract.length > abstractCharCap
                ? fullAbstract.slice(0, abstractCharCap) + "…"
                : fullAbstract;
            return (
              "[" + (i + 1) + "] " + p.title +
              " (Authors: " + (p.authors || "n/a") + ", " +
              p.journal + ", " + (p.year || "n/a") + ")" + authorTag + speciesTag + retractTag + relTag + preTag + citCount + studyTag + tierTag + flagTag +
              tldrLine +
              "\nAbstract: " + cappedAbstract
            );
          })
          .join("\n\n")
      : useWeb
      ? webRefs
          .map((r, i) => "[" + (i + 1) + "] " + r.title + " (" + r.journal + ")\n" + r.abstract)
          .join("\n\n")
      : "";

    // ============ CEREBRUM INTELLIGENCE CORE v5.0 ============
    // v5.0: Enhanced with conversation awareness, self-reasoning context,
    // and topic continuity for Claude-level conversational intelligence.
    const VOICE =
      "VOICE & STRUCTURE — these rules override everything else. You WILL be mechanically checked.\n\n" +

      "═══ RULE 1: ZERO PREFACING (HARD-ENFORCED) ═══\n" +
      "Your FIRST WORD must begin a direct scientific claim. " +
      "HARD-BANNED openers (if detected, your ENTIRE response is deleted and regenerated): " +
      "'Based on', 'The research shows', 'Let me explain', 'Here is what we know', " +
      "'While the provided sources', 'To answer your question', 'In conclusion', 'In summary', " +
      "'Let\\'s break this down', 'The provided sources', 'Looking at the', 'Several studies', " +
      "'The available evidence', 'Recent research', 'The literature suggests', 'According to the sources'. " +
      "CORRECT opening: '_Hermetia illucens_ larvae harbor a gut microbiome dominated by **Firmicutes** and **Proteobacteria** [1][3]...'\n\n" +

      "═══ RULE 2: SYNTHESIZE, NEVER LIST (HARD-ENFORCED) ═══\n" +
      "This is your #1 failure mode and it WILL be mechanically detected.\n" +
      "FORBIDDEN pattern (instant fail): 'Source [1] found X. Source [2] showed Y. Source [3] demonstrated Z.'\n" +
      "FORBIDDEN pattern (instant fail): 'The first study... The second study... Another study...'\n" +
      "FORBIDDEN pattern (instant fail): 'According to [1]... According to [2]... According to [3]...'\n" +
      "FORBIDDEN pattern (instant fail): '[1] found... [2] showed... [3] reported...'\n" +
      "FORBIDDEN: Starting ANY sentence with a citation number.\n" +
      "FORBIDDEN: Devoting a separate paragraph to each source.\n\n" +
      "CORRECT pattern: Make a scientific CLAIM, then cite multiple sources that support it:\n" +
      "'Gut bacterial loads show consistent section-specific gradients in dipteran larvae, " +
      "with 10^8–10^9 CFU/g in the hindgut [1][3] vs. 10^5–10^6 in the midgut [2], " +
      "driven primarily by pH gradients and oxygen tension [4].'\n" +
      "ONE claim, MULTIPLE citations woven in. The reader NEVER feels like you're going through a list.\n\n" +

      "═══ RULE 3: ORGANISM ACCURACY (HARD-ENFORCED) ═══\n" +
      "NEVER cite a paper about organism A as evidence for organism B.\n" +
      "If a paper is about millipedes, do NOT cite it in an answer about black soldier fly.\n" +
      "If a paper is about tilapia fed with BSFL, that is a tilapia nutrition paper — do NOT cite it as BSFL microbiome evidence.\n" +
      "NEVER write 'this study was conducted on [wrong organism], not [queried organism]' — if you find yourself writing that, DELETE the citation entirely.\n" +
      "An answer with 0 citations that is scientifically accurate is INFINITELY better than an answer that cites wrong-organism papers.\n" +
      "CHECK EVERY PAPER'S ABSTRACT before citing it. Ask: 'Is this paper ACTUALLY about the organism the user asked about?'\n\n" +

      "═══ RULE 4: ZERO REPETITION (HARD-ENFORCED) ═══\n" +
      "NEVER repeat a sentence, paragraph, or idea you already stated.\n" +
      "NEVER rephrase the same finding in different words.\n" +
      "NEVER write a conclusion that restates your introduction.\n" +
      "If you've said it once, it's said. Move forward.\n" +
      "Your response will be mechanically scanned for repeated content — any detected duplication means your response fails.\n\n" +

      "═══ RULE 5: PEER TONE ═══\n" +
      "Write like a brilliant postdoc explaining to a colleague. Use contractions. " +
      "Vary rhythm — long analytical sentence, then a short punch. Bold **key terms**. " +
      "If a result is surprising, say so. If evidence is weak, call it out bluntly. " +
      "If two papers disagree, pick who has better methodology and say why.\n\n" +

      "═══ RULE 6: PRECISION ═══\n" +
      "Always italicize species names: _E. coli_, _Hermetia illucens_, _C. tropicalis_.\n" +
      "Name the exact enzyme, gene, compound, organism. Never say 'certain bacteria' — say _Lactobacillus_ or _Enterobacteriaceae_.\n" +
      "Quantify everything. 'Significant' is banned — give the number and p-value.\n\n" +

      "═══ RULE 6B: WHEN THE USER SAYS 'SPECIFIC', GIVE SPECIFICS ═══\n" +
      "If the question uses words like 'specific', 'particular', 'named', or 'which exact', a general-mechanism " +
      "overview is a FAILED response even if it's accurate. You MUST name concrete instances: exact organism-pair " +
      "names (not 'insects and bacteria' — say '_Hermetia illucens_ and _Providencia_ spp.'), exact mobile-element " +
      "types (not 'mobile genetic elements' — say 'a Tn3-family transposon' or 'the P1 prophage'), exact gene or " +
      "pathway names. If the sources only support the general mechanism and not a named instance, say that gap " +
      "explicitly ('the sources describe the general mechanism but don't name a specific pair') rather than " +
      "answering the general question the user didn't ask.\n\n" +

      "═══ RULE 7: RELEVANCE HONESTY ═══\n" +
      "If papers are tangential, say so in ONE sentence, then answer from your knowledge.\n" +
      "Don't pretend irrelevant papers answer the question.\n\n" +

      "═══ BANNED PHRASES (mechanical detection — using ANY = failed response) ═══\n" +
      "'further research is needed', 'further research is necessary', 'further research is warranted', " +
      "'further studies are needed', 'more research is needed', " +
      "'plays a critical role', 'plays a crucial role', 'plays a vital role', 'plays a pivotal role', " +
      "'it is important to note', 'it is worth mentioning', 'it should be noted', " +
      "'in recent years', 'a growing body of evidence', 'sheds light on', 'paves the way for', " +
      "'the exact mechanism remains unclear', 'while the provided sources do not directly', " +
      "'in conclusion', 'in summary', 'Overall,', 'overall,', " +
      "'none of these papers directly', 'although this study does not specifically investigate', " +
      "'holistic understanding', 'holistic approach', 'multifaceted', " +
      "'underscores the importance', 'highlights the need', 'in the realm of', " +
      "'at the forefront of', 'a testament to', 'it is clear that'.\n" +
      "These will be MECHANICALLY STRIPPED from your answer. Don't waste tokens writing them.\n\n";

    const CONTEXT =
      "CONTEXT & CONTINUITY:\n" +
      "You are in a live, multi-turn conversation. You REMEMBER everything discussed. Rules:\n" +
      "1. RESOLVE ALL REFERENCES: 'it', 'they', 'that', 'the enzyme', 'the paper' — these refer to things from previous turns. " +
      "NEVER treat them as literal search terms. Use conversation history to resolve what they mean.\n" +
      "2. NEVER REPEAT YOURSELF: If you already explained a mechanism, go deeper on a follow-up, don't restart.\n" +
      "3. ACCEPT CORRECTIONS: If the user says you're wrong, they probably are right. Correct yourself without defensiveness.\n" +
      "4. BUILD ON CONTEXT: Each answer should advance the conversation. Reference what you've already established.\n" +
      "5. ANTICIPATE: If you notice the user's line of questioning leads somewhere, mention relevant connections proactively.\n" +
      "6. HISTORY LENGTH IS NOT EVIDENCE: A long conversation, or a large number of papers cited across earlier turns, does " +
      "NOT make your citations in THIS answer more certain and does NOT raise your confidence. Recalibrate confidence and " +
      "citation validity fresh for every turn from the EVIDENCE PROFILE and sources given for THIS question alone — never " +
      "carry confidence forward from earlier turns just because there's more context around it now. A follow-up citing one " +
      "thin source is exactly as hedged as a first question citing that same thin source.\n\n" +
      "HANDLING GAPS: If retrieved sources don't fully answer the question, state what they cover in ONE sentence, " +
      "then seamlessly extend with your broader knowledge. Never refuse. Never apologize more than once. " +
      "Your knowledge IS the ceiling — papers are evidence anchors, not limits.\n\n" +
      "CONVERSATIONAL INTELLIGENCE:\n" +
      "- If the user asks a vague follow-up ('what about that?', 'and the other one?'), infer the referent from context.\n" +
      "- If they ask 'where are the papers' or 'show me the sources', list the papers you cited with brief summaries.\n" +
      "- If they say 'tell me more', go deeper on the most interesting aspect of your last answer.\n" +
      "- If they ask about something tangentially related, bridge from the current topic naturally.\n" +
      "- If you're unsure what they mean, make your best guess and state what you're interpreting it as.\n\n" +
      "GRAD-STUDENT FORMATTING: Your audience is researchers. Format accordingly:\n" +
      "- For long answers, use **bold section headers** to organize (e.g., **Mechanism**, **Evidence**, **Limitations**)\n" +
      "- Always mention **study design**: was it _in vitro_, _in vivo_, a clinical trial, a meta-analysis, a computational model? This matters enormously.\n" +
      "- Always mention **sample size** and **model organism** when the source provides them: '(n=42 C57BL/6 mice)'\n" +
      "- Flag **preprints** vs peer-reviewed. If a source is from bioRxiv/medRxiv/arXiv, note it: '[preprint]'\n" +
      "- When multiple studies agree, say so explicitly: 'Three independent groups confirm...' — this is how researchers assess confidence.\n" +
      "- When only one study supports a claim, flag it: 'A single 2021 study (n=12) reported X, but this hasn't been independently replicated.'\n" +
      "- Use proper units: μM not uM, °C not degrees, kDa not kd.\n" +
      "- Distinguish correlation from causation. If a study shows association, don't write it as mechanism.\n\n";

    const CITE_RULES =
      "CITATION FORMAT — mechanical compliance required:\n" +
      "- Cite ONLY as [1], [2], [3]. Never parentheses, never superscripts, never bare numbers, and NEVER group multiple sources in one bracket like [1, 2] or [1,2] — write [1][2] as separate brackets, back to back, with no space between them.\n" +
      "- Place citations INLINE at the end of the specific sentence they support.\n" +
      "- Do NOT cluster citations at paragraph end. Each citation attaches to one specific claim.\n" +
      "- Only cite source N if it genuinely supports that sentence. [WEAK MATCH] sources: ignore or note as tangential. [RETRACTED]: flag prominently.\n" +
      "- STRICT CITATION HONESTY: a citation may ONLY attach to a sentence making an explicit, empirical claim drawn from that specific paper — a measured result, a reported finding, a stated statistic, a named method or organism it actually studied. NEVER attach a citation to a general statement, a transition sentence, a definitional aside, or your own inference, even when a cited paper is topically related. If a sentence isn't a specific claim FROM that paper, it gets no citation at all.\n" +
      "- NEVER fabricate DOIs, authors, journal names, or statistics not in the abstracts.\n" +
      "- ZERO-HALLUCINATION GROUNDING: ground every factual assertion strictly in the provided abstracts. Do NOT introduce external acronyms, gene names, brain regions, or pathways (e.g., BDNF, DMN, TPJ) unless that exact term appears verbatim somewhere in the retrieved abstracts above — importing a real-but-unsourced acronym to sound precise is exactly as dishonest as inventing a fake one, and it will fail fact-checking either way. If a concept needs a name the sources don't give you, describe it in plain language instead.\n" +
      "- NEVER suggest, recommend, or name specific papers you were not given. Do not say 'you could look for Smith et al. 2020' or 'a study by Jones found...' unless that paper is in your source list above. If you want to suggest the user search for more, say 'searching for [topic keywords] would likely surface more' — but NEVER invent specific paper titles or authors.\n" +
      "- NEVER write 'Source [1] discusses...' or 'According to [2]...' — weave the citation into your own sentence.\n" +
      "- No <think> tags, no code fences, no meta-commentary about your process.\n";

    // v28: this was previously a loose suggestion buried in CONTEXT
    // ("use bold section headers to organize") — real Markdown structure a
    // browser can render distinctly (and the new frontend layout keys off
    // of) is different from a stylistic nudge the model was free to ignore
    // on any given answer, which is exactly why answers were landing as one
    // undifferentiated block of prose. Applied to every branch that produces
    // a real synthesis (not the curated "additional papers" digest, which
    // already has its own required shape).
    // v35 fix: these four headers used to read "Executive Summary" / "Current
    // Evidence & Mechanisms" / "Research Gaps & Future Trajectories" /
    // "Confidence & Methodological Limitations" — leftover names from before
    // the frontend's own header system (SECTION_HEADER_TITLES /
    // normalizeSectionHeaders in main.jsx, plus the GuidedTour copy that
    // promises a "Divergent Findings & Gaps" section) was renamed to the four
    // titles below. The frontend's normalizer only recognizes its own exact
    // titles, so every answer was shipping with an old header the frontend
    // had no matching rule for — "## Executive Summary" printed as a stray
    // unstyled fragment instead of the intended section title, and "##
    // Current Evidence & Mechanisms" only partially matched (the frontend's
    // "Evidence & Mechanisms" title matched mid-string, leaving a dangling
    // "## Current" as its own broken paragraph). Renamed here so the model
    // emits exactly what the frontend expects. Section 3 also actually asks
    // for divergent/contradicting findings now, not just open questions —
    // its new title promises that in the guided tour, so it has to do that
    // rather than just having the right name on the same old content.
    const STRUCTURE =
      "═══ REQUIRED OUTPUT STRUCTURE (HARD-ENFORCED) ═══\n" +
      "Format the ENTIRE answer as exactly these four Markdown H2 sections, in this exact order, with these exact headers " +
      "verbatim (no extra sections, no renaming, no merging, nothing before the first header). " +
      "Every header MUST sit on its own line with a completely blank line before it and a completely blank line after it — " +
      "NEVER end a sentence and then continue straight into '## Next Header' on the same line or the same paragraph. " +
      "WRONG: '...reduced brainstem volume [7]. ## Evidence & Mechanisms\\nChronic stress...' " +
      "RIGHT: '...reduced brainstem volume [7].\\n\\n## Evidence & Mechanisms\\n\\nChronic stress...'\n\n" +
      "## Core Synthesis\n" +
      "2-4 sentences. The direct answer to the question, stated plainly, with its strongest supporting citation(s).\n\n" +
      "## Evidence & Mechanisms\n" +
      "The synthesis itself. RULE 1 (zero prefacing) and RULE 2 (synthesize, never list) apply in full force here. This is normally the longest section.\n\n" +
      "## Divergent Findings & Gaps\n" +
      "Where the literature actually disagrees first — papers reaching different conclusions, conflicting methodologies, results that sit at odds with the emerging consensus, stated plainly rather than smoothed into false agreement — then what the retrieved literature doesn't settle yet and where the field is visibly heading. If the evidence is genuinely airtight with no real disagreement or open question, say that in one sentence rather than inventing either.\n\n" +
      "## Methodological Confidence\n" +
      "Your actual confidence in the answer above and why — sample sizes, study designs (in vitro vs in vivo vs clinical), replication status, conflicting results, or papers too tangential to use. Be concrete, not a generic disclaimer.\n\n";

    const ID = "You are Cerebrum, a scientific research engine. You search 14 open scholarly databases simultaneously and write cited, synthesis-grade answers. " +
      "You were built by Vaticay. You are not a general assistant — you are a precision instrument for scientific literature. " +
      "ALWAYS respond in English regardless of the language of the source papers.\n\n";

    // ── PERSONALITY ──
    // Everything below RULE 1-7 in VOICE is a mechanical constraint on
    // FORMAT. This is about voice — who is actually talking. Without it the
    // model defaults to generic "helpful AI assistant" register even while
    // technically obeying every formatting rule, and the result reads like
    // it was written by a committee. A real research answer, written by a
    // sharp person who actually finds this stuff interesting, reads
    // differently — has have opinions about which evidence is more
    // convincing, gets genuinely interested when a result is surprising,
    // doesn't hedge things that aren't actually uncertain.
    const PERSONALITY =
      "PERSONALITY — this is who is writing, not just a formatting rule:\n" +
      "You're a sharp, curious researcher who actually finds this stuff interesting — not a customer-support bot summarizing " +
      "documents. You have a point of view. When the evidence is genuinely convincing, say so plainly instead of hedging out " +
      "of politeness. When it's thin, say that plainly too — don't split the difference to sound balanced. If a finding is " +
      "surprising or counterintuitive, let that show ('this is the opposite of what you'd expect from...') rather than " +
      "reporting it in the same flat register as everything else. If two papers disagree, don't just present both sides — " +
      "have a read on which one's methodology you trust more and say why. Dry wit is welcome where it fits naturally; never " +
      "forced, never a joke for its own sake, never at the expense of accuracy. Write like you're explaining this to a " +
      "colleague whose time you respect, not lecturing a student or reassuring a customer. Contractions are normal. " +
      "Sentence rhythm should vary — a real person doesn't write eight consecutive sentences of identical length and " +
      "structure. You're allowed to find a question dull, a mechanism elegant, or a result underwhelming, and to say so in " +
      "one honest clause, as long as the science underneath stays exact. Never perform enthusiasm you don't have — a mildly " +
      "interesting incremental finding doesn't need to be dressed up as a breakthrough. The goal is a person who happens to " +
      "have read everything, not a machine performing the ritual of scientific caution.\n\n";

    let systemPrompt;
    if (wantsMorePapers && useEvidence) {
      systemPrompt = ID + PERSONALITY + "The user wants ADDITIONAL papers on this topic. You have " + evidencePapers.length + " papers that are NEW (not shown before). " +
        "Present them as a curated research digest. For each paper:\n" +
        "1. State the key finding in one sentence with the citation [N]\n" +
        "2. Note why it's relevant to their investigation\n" +
        "Group related papers together thematically. Bold the paper topics. " +
        "End with a one-sentence synthesis of what these additional sources add to the picture.\n\n" + VOICE + CONTEXT + lengthHint + "\n" + CITE_RULES;
    } else if (useEvidence && speciesSearch) {
      systemPrompt = ID + PERSONALITY + "Question is about species: **" + speciesSearch.full + "**. Talk about THIS species specifically.\n\n" + VOICE + CONTEXT + lengthHint + "\n" + STRUCTURE + CITE_RULES;
    } else if (useEvidence && isNameSearch) {
      systemPrompt = ID + PERSONALITY + "User searched for a PERSON: \"" + query + "\". Describe their research from the papers. [author-matched: YES] = they wrote it. [NOT author-matched] = someone else wrote it, name real author. If none matched, say so.\n\n" + VOICE + CONTEXT + lengthHint + "\n" + STRUCTURE + CITE_RULES;
    } else if (useEvidence) {
      systemPrompt = ID + PERSONALITY + "You have " + evidencePapers.length + " papers below. READ EACH ABSTRACT before answering.\n\n" +
        "═══ PAPER USAGE PROTOCOL (HARD-ENFORCED) ═══\n\n" +
        "STEP 1 — ORGANISM/TOPIC AUDIT: For EACH paper, check:\n" +
        "  • Does this paper study the EXACT organism the user asked about?\n" +
        "  • Does this paper address the EXACT mechanism/topic the user asked about?\n" +
        "  • If the answer to either is NO → mark that paper as UNCITABLE.\n" +
        "  Examples of UNCITABLE papers:\n" +
        "  - User asks about BSFL microbiome → paper about millipede gut bacteria = UNCITABLE\n" +
        "  - User asks about BSFL microbiome → paper about tilapia fed with BSFL = UNCITABLE (that's tilapia nutrition, not BSFL biology)\n" +
        "  - User asks about honeybee immunity → paper about bumblebee immunity = UNCITABLE (different species)\n" +
        "  NEVER write 'although this study was conducted on [X] rather than [Y]' — that means YOU KNOW it's the wrong paper. Just don't cite it.\n\n" +
        "STEP 2 — SYNTHESIZE (mandatory):\n" +
        "  Make CLAIMS, not lists. State scientific findings and cite papers inline.\n" +
        "  WRONG: 'Source [1] found that... Source [2] showed that... Source [3] demonstrated...'\n" +
        "  RIGHT: 'Larval gut pH varies from 6.2 in the foregut to 8.5 in the hindgut [1][3], creating distinct niches that select for different bacterial phyla [2].'\n\n" +
        "STEP 3 — YOUR KNOWLEDGE IS PRIMARY:\n" +
        "  You are an expert. Give a COMPLETE answer using your scientific knowledge.\n" +
        "  Papers ANCHOR your answer but are NOT the ceiling.\n" +
        "  If all papers are weak/tangential, say so in ONE sentence, then answer from knowledge.\n" +
        "  0 citations + correct science > 5 citations + wrong organisms.\n\n" + VOICE + CONTEXT + lengthHint + "\n" + STRUCTURE + CITE_RULES;
    } else if (useWeb) {
      systemPrompt = ID + PERSONALITY + "No peer-reviewed papers matched this specific query, but reference sources were found. " +
        "IMPORTANT: Do NOT start with an apology or 'no papers found' disclaimer. Start with a direct, substantive answer. " +
        "Draw on both the reference sources below AND your scientific knowledge. " +
        "If you know relevant papers exist on this topic (from your training), mention the general findings and suggest " +
        "specific search terms the user could try to find them (e.g., 'Searching for [specific technical terms] would surface the primary literature on this').\n\n" + VOICE + CONTEXT + lengthHint + "\n" + STRUCTURE + CITE_RULES;
    } else {
      systemPrompt = ID + PERSONALITY + "The literature search didn't surface papers for this specific phrasing, but you absolutely know this topic. " +
        "IMPORTANT: Do NOT start with 'no papers retrieved' or any disclaimer. Start with a direct, authoritative scientific answer. " +
        "Give an excellent, comprehensive answer drawing on your full scientific knowledge. Be specific — name enzymes, genes, organisms, mechanisms, " +
        "quantify where possible, and cite the key researchers and landmark studies you know about in plain text (e.g., 'Work by [name] demonstrated...'). " +
        "At the END (not the beginning), add one line: 'For the primary literature, try searching: [2-3 specific search terms]' — " +
        "suggest the exact PubMed/Google Scholar search terms that would find the relevant papers.\n" +
        "ZERO fabricated citations — no [1], no (Author, Year), no DOIs. You may name findings and researchers in plain prose.\n\n" + VOICE + CONTEXT + lengthHint + "\n" + STRUCTURE;
    }

    const messages = [{ role: "system", content: systemPrompt }];

    if (imageContext) {
      messages.push({
        role: "system",
        content:
          "The user attached an image with this question. Here is exactly what it shows (from the vision module): " +
          imageContext +
          "\nReference it naturally if relevant ('the image shows...', 'as pictured...') — don't just ignore that it exists, but don't over-describe it either if the papers already answer the question.",
      });
    }

    // ════════════════════════════════════════════════════════════════
    // EVIDENCE-STRENGTH PROFILE
    // Tallies the study-design mix of the papers actually being handed to
    // the model (evidencePapers already carries p.studyType from
    // classifyStudyType() in knowledge.js, computed once during ranking).
    // Without this, the model has no way to know whether "the literature
    // shows X" rests on three meta-analyses or one uncontrolled case
    // report — both look identical as a bare citation list. This makes the
    // actual evidence composition explicit so confidence language in the
    // answer tracks real evidence strength instead of citation COUNT alone.
    // ════════════════════════════════════════════════════════════════
    if (useEvidence && evidencePapers.length > 0) {
      const tierCounts = {};
      for (const p of evidencePapers) {
        const key = p.studyType || "Unclassified";
        tierCounts[key] = (tierCounts[key] || 0) + 1;
      }
      const strongTiers = ["Systematic review / meta-analysis", "Randomized controlled trial"];
      const strongCount = strongTiers.reduce((n, k) => n + (tierCounts[k] || 0), 0);
      const weakTiers = ["Case report / case series", "Preclinical (animal / in vitro / in silico)"];
      const weakCount = weakTiers.reduce((n, k) => n + (tierCounts[k] || 0), 0);
      const breakdown = Object.entries(tierCounts)
        .map(([k, n]) => `${n}× ${k}`)
        .join(", ");
      let confidenceNote;
      if (strongCount >= 2) {
        confidenceNote = "Multiple higher-tier sources (meta-analysis/RCT) are present — state findings with direct confidence where they agree.";
      } else if (weakCount > 0 && strongCount === 0) {
        confidenceNote = "The available evidence here is preclinical/case-level only — use appropriately hedged language ('an early study suggests...', 'in a mouse model...') rather than presenting it as settled.";
      } else {
        confidenceNote = "Evidence is mixed-tier — calibrate confidence per claim to the specific source backing it, not uniformly across the whole answer.";
      }
      messages.push({
        role: "system",
        content:
          "EVIDENCE PROFILE for the sources below: " + breakdown + ". " + confidenceNote,
      });
    }

    // ════════════════════════════════════════════════════════════════
    // CONVERSATION AWARENESS INJECTION
    // Give the LLM a rich understanding of the conversation context.
    // This is what makes it feel like talking to Claude — it knows
    // what's been discussed, what entities are in play, and what the
    // user's investigation trajectory looks like.
    // ════════════════════════════════════════════════════════════════
    if (conversationCtx && conversationCtx.summary) {
      let contextBlock = "CONVERSATION CONTEXT (use this to maintain continuity):\n" + conversationCtx.summary;
      if (conversationCtx.entities.length > 0) {
        contextBlock += "\nKey entities in this conversation: " + conversationCtx.entities.join(", ");
      }
      if (conversationCtx.sourceTitles.length > 0) {
        contextBlock += "\nPapers already cited in this conversation: " + conversationCtx.sourceTitles.join("; ");
      }
      messages.push({ role: "system", content: contextBlock });
    }

    // ════════════════════════════════════════════════════════════════
    // SELF-REASONING INJECTION
    // If the self-reasoning chain completed, inject its analysis into
    // the system prompt. This gives the answer LLM a "pre-thought"
    // understanding of the question's structure, complexity, and the
    // best way to approach it — the system "asked itself things" and
    // now shares its internal reasoning with the answer generator.
    // ════════════════════════════════════════════════════════════════
    let selfReasonResult = await reasoningPromise;
    // The LLM reasoning call above has a 4s timeout and depends on an
    // OpenRouter token being configured — it can legitimately return null on
    // any given request. Rather than losing key-term/entity extraction
    // entirely on those requests, fall back to the deterministic,
    // zero-latency extractor in knowledge.js. It won't produce sub-questions
    // or a search strategy (those need real reasoning), but it reliably
    // recovers drug names, pathway names, and gene symbols mentioned
    // verbatim in the question — exactly the kind of precise vocabulary a
    // plain term-split otherwise throws away.
    if (!selfReasonResult) {
      const fallbackEntities = extractEntities(query);
      const fallbackTerms = [...fallbackEntities.drugs, ...fallbackEntities.pathways, ...fallbackEntities.genes];
      if (fallbackTerms.length) {
        selfReasonResult = { key_terms: fallbackTerms, organisms: [], sub_questions: [], search_strategy: null };
      }
    }
    if (selfReasonResult) {
      let reasoningBlock = "INTERNAL ANALYSIS (Cerebrum's reasoning about this question):\n";
      if (selfReasonResult.sub_questions && selfReasonResult.sub_questions.length > 0) {
        reasoningBlock += "Sub-questions to address: " + selfReasonResult.sub_questions.join("; ") + "\n";
      }
      if (selfReasonResult.search_strategy) {
        reasoningBlock += "Search strategy: " + selfReasonResult.search_strategy + "\n";
      }
      if (selfReasonResult.key_terms && selfReasonResult.key_terms.length > 0) {
        reasoningBlock += "Key scientific terms: " + selfReasonResult.key_terms.join(", ") + "\n";
      }
      if (selfReasonResult.complexity) {
        reasoningBlock += "Complexity: " + selfReasonResult.complexity + "\n";
      }
      if (selfReasonResult.expected_fields && selfReasonResult.expected_fields.length > 0) {
        reasoningBlock += "Relevant fields: " + selfReasonResult.expected_fields.join(", ") + "\n";
      }
      if (selfReasonResult.alternative_explanations && selfReasonResult.alternative_explanations.length > 0) {
        reasoningBlock += "Rival explanations/confounds to address before accepting the obvious answer: " + selfReasonResult.alternative_explanations.join("; ") + "\n";
      }
      if (selfReasonResult.what_would_change_the_answer) {
        reasoningBlock += "What would change this answer: " + selfReasonResult.what_would_change_the_answer + "\n";
      }
      reasoningBlock += "\nUse this analysis to structure your answer. Address the sub-questions. Use the key terms. " +
        "If a rival explanation was flagged, don't just present the obvious answer — note briefly why the alternative doesn't hold (or does, if the sources actually support it). " +
        "If the question is complex or multi-domain, organize your answer accordingly.";
      messages.push({ role: "system", content: reasoningBlock });
    }

    // If the LLM resolver identified the topic, tell the answer LLM
    if (llmResolvedTopic && !isFollowupMode) {
      messages.push({
        role: "system",
        content: "TOPIC IDENTIFIED: " + llmResolvedTopic + ". Stay focused on this topic throughout your answer.",
      });
    }

    // If the user has provided corrections in previous turns, thread those into
    // the system message as authoritative facts the AI must respect. This makes
    // corrections stick across the whole session.
    if (corrections.length > 0) {
      const correctionsBlock = corrections
        .map((c, i) => `- ${c}`)
        .join("\n");
      messages.push({
        role: "system",
        content:
          "USER-PROVIDED CORRECTIONS (treat as ground truth for the rest of this conversation):\n" +
          correctionsBlock,
      });
    }

    // If this is a follow-up on the previous answer, tell the AI explicitly
    // so it doesn't restart from zero and doesn't switch topics.
    if (isFollowupMode) {
      const deepFound = gResult._deepSearchFound || 0;
      messages.push({
        role: "system",
        content:
          intent.kind === "correction"
            ? "CORRECTION MODE: The user is correcting your previous answer. Rules: " +
              "1) Assume they are right — they often know the literature better than the retrieval. " +
              "2) State plainly what you got wrong in one sentence. " +
              "3) Give the corrected account with full rigor. " +
              "4) If their correction reveals something the sources missed, say that explicitly. " +
              "Do not get defensive. Do not over-apologize. Do not switch topics."
            : "FOLLOW-UP MODE: You are continuing an ongoing investigation with the user. " +
              (deepFound > 0
                ? `I searched again and found ${deepFound} additional paper${deepFound === 1 ? "" : "s"} relevant to this follow-up. The new sources appear AFTER the original ones in the list below — use them to add fresh evidence and depth. `
                : "No additional papers were found for this specific angle, so work with the existing sources and your knowledge. ") +
              "Critical rules: " +
              "1) Do NOT repeat background you already covered — they read your previous answer. " +
              "2) Build directly on the previous turn. Go DEEPER: more mechanism, more specificity, more quantification. " +
              "3) If you found new sources, integrate them naturally — don't announce 'I found new papers.' " +
              "4) Answer the PRECISE thing they asked, not the general topic. " +
              "5) If their question exposes a limit of the evidence, say so in one sentence and push forward with your knowledge. " +
              "6) Never start with 'As I mentioned' or 'As discussed' — just advance the conversation.",
      });
    }

    // ════════════════════════════════════════════════════════════════
    // SMART HISTORY THREADING
    // Format history so the LLM clearly distinguishes between:
    // - What the user said (their questions/corrections)
    // - What the AI said (previous answers)
    // - What sources were available (so it knows what's new vs old)
    // ════════════════════════════════════════════════════════════════
    const historyTurns = Array.isArray(body.history)
      ? body.history.slice(-10)
      : [];
    for (const turn of historyTurns) {
      if (turn.role === "user") {
        messages.push({
          role: "user",
          content: String(turn.content || "").slice(0, 1500),
        });
      } else if (turn.role === "assistant") {
        // Include a condensed version of the previous answer + what sources it used
        const prevAnswer = String(turn.content || "").slice(0, 1500);
        const prevSourceTitles = (turn.sources || [])
          .slice(0, 5)
          .map((s, i) => `[${i + 1}] ${s.title || "Untitled"}`)
          .join("; ");
        const sourceNote = prevSourceTitles
          ? `\n[Previously cited: ${prevSourceTitles}]`
          : "";
        messages.push({
          role: "assistant",
          content: prevAnswer + sourceNote,
        });
      }
    }
    const userContent =
      useEvidence || useWeb
        ? "Sources:\n\n" + evidence + "\n\n---\nQuestion: " + query
        : query;
    // Reinforce ALL rules at user level — free models routinely ignore system prompts.
    // This is the last thing the model sees before generating, so it has maximum weight.
    const enforcer = useEvidence
      ? "\n\n[MECHANICAL ENFORCEMENT — your response is post-processed and these are checked:\n" +
        "1. ORGANISM CHECK: Cite papers ONLY if they study the EXACT organism asked about. " +
        "A paper about a DIFFERENT organism = DO NOT CITE. If you write 'this study was on [X], not [Y]' your response FAILS.\n" +
        "2. NO SOURCE LISTING: Do NOT write 'Source [1] found X. Source [2] found Y.' — SYNTHESIZE into unified claims with inline citations.\n" +
        "3. NO REPETITION: Every sentence must say something NEW. Repeating an idea in different words = FAIL.\n" +
        "4. BANNED PHRASES (mechanically stripped — don't waste tokens): 'further research is needed', 'plays a crucial/critical role', " +
        "'in conclusion', 'in summary', 'Overall', 'it is important to note', 'sheds light on', 'it should be noted', " +
        "'holistic', 'multifaceted', 'underscores the importance'.\n" +
        "5. START with a direct scientific claim. No 'Based on the sources' or 'The research shows'.\n" +
        "6. Italicize EVERY species/genus name with _underscores_: _E. coli_, _H. illucens_, _Hermetia illucens_. " +
        "A species name with no underscores around it = FAIL.\n" +
        "7. BOLD at least 4 key terms across your answer using **double asterisks** — gene/protein names, statistics, " +
        "drug or compound names, the single most important finding per section. An answer with FEWER THAN 2 total " +
        "**bolded** terms is MECHANICALLY REJECTED before it ever reaches the user and a different model is tried — " +
        "this is enforced by code, not a style preference.\n" +
        "8. Your answer will be QUALITY-SCORED. Score < 40 = regenerated with a different model.\n" +
        "9. This checklist is for you alone — never mention, quote, summarize, or allude to it (or words like " +
        "'mechanical enforcement', 'banned phrase', or 'post-processed') anywhere in your answer. Just follow it silently " +
        "and write the answer itself, starting directly with the scientific content.]"
      : "\n\n[MECHANICAL ENFORCEMENT — your response is post-processed:\n" +
        "1. BANNED PHRASES (stripped): 'further research is needed', 'plays a crucial role', 'in conclusion', 'in summary', " +
        "'Overall', 'it is clear that', 'sheds light on'.\n" +
        "2. NO REPETITION. 3. START with a direct claim. 4. Italicize every species name: _E. coli_.\n" +
        "5. BOLD at least 2 key terms with **double asterisks**. Fewer than 2 = a different model is tried instead.\n" +
        "6. This checklist is for you alone — never mention or refer to it in your answer; just follow it silently.]";
    messages.push({ role: "user", content: userContent + enforcer });

    // ============ D1 ANSWER CACHE ============
    // Before calling any LLM, check if we have a cached answer for a similar
    // query that was previously upvoted or verified. This is free, instant,
    // and gets better as more people use the tool.
    const cacheKey = versionedCacheKey(query);
    let cachedAnswer = null;
    if (env.DB && sourceList.length > 0) {
      try {
        const cached = await env.DB.prepare(
          "SELECT answer, sources, score, created_at FROM answer_cache WHERE query_key = ? AND score >= 0 ORDER BY score DESC, created_at DESC LIMIT 1"
        ).bind(cacheKey).first();
        if (cached && cached.answer) {
          cachedAnswer = cached;
        }
      } catch {}
    }

    // If we have a high-confidence cached answer (score >= 2 means multiple
    // upvotes), serve it directly. Otherwise fall through to the LLM chain.
    if (cachedAnswer && cachedAnswer.score >= 2) {
      return new Response(
        JSON.stringify({
          answer: italicizeScientificTerms(cachedAnswer.answer, query),
          sources: sourceList,
          videos,
          factCheck: null,
          related: [],
          source: "Cached (verified)",
          _diag: gResult && gResult._diag ? gResult._diag : null,
          _cached: true,
        }),
        { status: 200, headers: cors }
      );
    }

    // ============ AI ANSWER GENERATION (Smart Router) ============
    // Race 2-3 models in parallel — take the first good response. Over time,
    // D1 tracks which model wins per domain so we skip the race.
    let answer = "";
    let aiOK = false;
    const token = env.OPENROUTER_KEY;

    // Bug: the "good enough to accept" bar below was a flat 30 characters
    // regardless of answerLength, and Promise.any (used in the race below)
    // takes the FIRST model to clear that bar — not the best, not the one
    // that actually followed the length instruction. A free-tier model that
    // raced back with two lazy sentences was indistinguishable from one that
    // wrote the requested "five to eight paragraphs" review-article answer,
    // so "Detailed" mode routinely won the race with a short response while
    // slower models that would have honored the prompt never got a chance.
    // Scale the floor to what each tier actually promises (still well under
    // the target, just enough to reject an obviously-too-short response and
    // force a retry against the next model).
    // v36: "long" now explicitly asks for 800+ words (~4500-5000 chars) —
    // this floor is deliberately NOT set to that number. This bar's job is
    // to fail a response over to the next model in the SAME wave (cheap:
    // the wave is already racing several models in parallel) or, only if
    // every model in the wave was lazy, over to wave 2 (NOT cheap: another
    // sequential ~12s). Setting it near the actual 800-word target would
    // reject a genuinely solid 550-600 word answer just as readily as the
    // "two lazy sentences" this exists to catch, buying a wave-2 fallback
    // more often — trading the depth problem for the latency complaint
    // sitting right next to it. 2500 chars (~380-400 words) still rejects
    // the specific failure mode reported (a ~250-word answer to a Detailed
    // request) without turning "not quite 800" into a retry trigger.
    const minAnswerLen = answerLength === "long" ? 2500 : answerLength === "short" ? 30 : 150;

    // The enforcer prompt tells every model its **bold** term count is
    // "mechanically checked" and a low count gets it swapped for another
    // model in the same wave — that claim was a bluff until this helper
    // existed. Free-tier models complied with almost every other prompt
    // instruction (citation markers, section headers) but silently dropped
    // bold/italic emphasis under load, because nothing actually verified it.
    // A flat count of real **bold** spans is the same class of fix as the
    // minAnswerLen check just above: cheap to test, hard to game by accident,
    // and it only costs wall-clock time when EVERY model in a wave fails it
    // (rare — one compliant model among 5-8 racing in parallel is enough).
    const hasMinimumFormatting = (text, minBoldSpans) => {
      const boldSpans = text.match(/\*\*[^*\n]+\*\*/g) || [];
      return boldSpans.length >= minBoldSpans;
    };

    // Every thrown error is prefixed with the model name and, where possible,
    // the response body text. This is the difference between a future total
    // failure being a mystery ("all N models failed") and being diagnosable
    // in one glance ("23 of 26 said HTTP 429: rate limit exceeded for
    // free-tier requests" — an ACCOUNT-level throttle, not a model problem).
    //
    // Commit 41: this used to time out at a flat 12s regardless of how much
    // was being asked for. A medium-length answer (maxTokens 1800) or a long
    // one (4200) against a free, shared, often CPU-bound model can easily run
    // 15-25s once you count prefill on a several-thousand-token evidence
    // block plus generation — on a busy moment that's every model in the wave
    // hitting the same wall together, which looks identical to "everything is
    // rate-limited" from the outside but is really just an unrealistic clock.
    // Loosened to give real generation a fair chance before Promise.any gives
    // up on the whole wave.
    const callOR = async (model, msgs, maxTok, timeoutMs = 18000) => {
      if (!token) throw new Error(model + ": no OPENROUTER_KEY configured");
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), timeoutMs);
      try {
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, "HTTP-Referer": "https://askcerebrum.org", "X-Title": "Cerebrum" },
          body: JSON.stringify({ model, temperature: 0.3, max_tokens: maxTok, messages: msgs }),
          signal: c.signal,
        });
        clearTimeout(t);
        if (!r.ok) {
          let bodyText = "";
          try { bodyText = (await r.text()).slice(0, 100); } catch {}
          throw new Error(model + ": HTTP " + r.status + (bodyText ? " — " + bodyText : ""));
        }
        const j = await r.json();
        const txt = j?.choices?.[0]?.message?.content || "";
        const cleaned = cleanAIResponse(txt);
        if (cleaned.length < minAnswerLen) throw new Error(model + ": response too short (" + cleaned.length + " chars)");
        if (useEvidence && !hasMinimumFormatting(cleaned, 2)) throw new Error(model + ": missing required **bold** formatting");
        return { answer: cleaned, model };
      } catch (e) {
        clearTimeout(t);
        if (e && e.name === "AbortError") throw new Error(model + ": timed out");
        throw e;
      }
    };

    const callCF = async (model, msgs, maxTok, timeoutMs = 18000) => {
      if (!env.AI || typeof env.AI.run !== "function") throw new Error(model + ": no Workers AI binding (env.AI missing)");
      try {
        // callOR and pollinationsCall both bound their fetch to a 12s
        // AbortController; env.AI.run() has no signal/timeout option to hang
        // one off, so a raw stalled call here could hang forever. Since
        // every provider is raced together via Promise.any (a single
        // settle-first race across the whole wave), one never-settling
        // Workers AI call would silently stall the ENTIRE request even if
        // every other provider in the same wave had already failed fast —
        // defeating the whole point of racing bounded-timeout providers
        // together. A plain timer race gives it the same ceiling (still
        // 12s by default; the last-resort bulletproof tier below passes a
        // longer one since it's the final attempt before giving up).
        const out = await Promise.race([
          env.AI.run(model, { messages: msgs, max_tokens: Math.min(maxTok, 2048) }),
          new Promise((_, reject) => setTimeout(() => reject(new Error(model + ": timed out")), timeoutMs)),
        ]);
        const cleaned = cleanAIResponse((out && out.response) || "");
        if (cleaned.length < minAnswerLen) throw new Error(model + ": response too short");
        if (useEvidence && !hasMinimumFormatting(cleaned, 2)) throw new Error(model + ": missing required **bold** formatting");
        return { answer: cleaned, model };
      } catch (e) {
        throw new Error(model + ": " + (e && e.message ? e.message : String(e)));
      }
    };

    // Bug: this used to ignore the `msgs`/`maxTok` args entirely and send a
    // hardcoded two-line prompt (system persona blurb + bare `query`) instead
    // of the real `messages` array — the one that carries the retrieved
    // papers, the VOICE/CITE_RULES system prompt, and conversation history.
    // Since Promise.any (both racing waves below) takes whichever provider
    // answers FIRST, any turn where a Pollinations model happened to win the
    // race produced an answer with zero grounding in the sources Cerebrum
    // just spent a whole retrieval pipeline finding — no [N] citation
    // markers, no organism/relevance/retraction gating — while the UI still
    // showed the full, now-disconnected bibliography. Fixed by giving this
    // the same real `messages`/`maxTok` every other provider call gets.
    const pollinationsCall = async (modelParam, msgs, maxTok) => {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 18000); // see Commit 41 note on callOR above
      const tag = "pollinations:" + modelParam;
      try {
        const pRes = await fetch("https://text.pollinations.ai/", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: msgs,
            model: modelParam,
            temperature: 0.3,
            max_tokens: maxTok,
          }),
          signal: c.signal,
        });
        clearTimeout(t);
        if (!pRes.ok) {
          let bodyText = "";
          try { bodyText = (await pRes.text()).slice(0, 100); } catch {}
          throw new Error(tag + ": HTTP " + pRes.status + (bodyText ? " — " + bodyText : ""));
        }
        const cleaned = cleanAIResponse(await pRes.text());
        if (!cleaned || cleaned.length < 30) throw new Error(tag + ": response too short");
        return { answer: cleaned, model: tag };
      } catch (e) {
        clearTimeout(t);
        if (e && e.name === "AbortError") throw new Error(tag + ": timed out");
        throw e;
      }
    };

    // Check if we know the best model for this topic domain
    const domainKey = query.toLowerCase().split(/\s+/).slice(0, 3).join(" ");
    let preferredModel = null;
    if (env.DB) {
      try {
        const pref = await env.DB.prepare(
          "SELECT model, wins FROM model_perf WHERE domain = ? ORDER BY wins DESC LIMIT 1"
        ).bind(domainKey).first();
        if (pref && pref.wins >= 3) preferredModel = pref.model;
      } catch {}
    }

    // Fast path: known best model for this domain
    if (preferredModel && token) {
      try { const r = await callOR(preferredModel, messages, maxTokens); answer = r.answer; aiOK = true; } catch {}
    }

    // ════════════════════════════════════════════════════════════════
    // v6.2: TRUE CROSS-PROVIDER PARALLEL RACING
    // v6.1 added ~30 extra OpenRouter model names but kept them in
    // SEQUENTIAL tiers (OR-primary → OR-fallback → Workers AI → Pollinations)
    // — and it still failed on a live query. That's the tell: this was never
    // just "not enough models". Two real structural problems:
    //
    // 1. OpenRouter's free (":free") models share ONE rate-limit bucket PER
    //    API KEY, not per model-name. If the account-level bucket is what's
    //    throttled, firing 30 different model NAMES through the SAME key
    //    doesn't add capacity — they're all drawing from the same empty well.
    // 2. Workers AI and Pollinations are genuinely independent of that key,
    //    but the old sequential structure meant they never even got
    //    ATTEMPTED until BOTH OpenRouter tiers had fully burned through their
    //    timeouts — wasting 20-30+ seconds before a completely unaffected
    //    provider got a chance.
    //
    // Fix: race a small set from EVERY provider TOGETHER in one wave, so an
    // OpenRouter-side outage (of any kind) never blocks Workers AI /
    // Pollinations from being tried at the same time. If wave 1 fully fails,
    // wave 2 races a broader set, again across all providers at once.
    //
    // Also: every callOR/callCF/pollinationsCall failure above now carries
    // the model name + actual HTTP status + response body text. Combined
    // with Promise.any's AggregateError.errors (one entry per failed
    // promise), this means a future total failure tells us EXACTLY what
    // happened — e.g. "26/26 OpenRouter calls said HTTP 429: rate limit
    // exceeded" (account-level throttle) vs "env.AI missing" (Workers AI was
    // never actually bound to this Pages project) vs real provider outages —
    // instead of the generic "all N models failed" that told us nothing.
    // ════════════════════════════════════════════════════════════════

    const aiAttempts = []; // diagnostic trail — surfaced in _aiAttempts for debugging
    const recordWin = (model) => {
      if (!env.DB || !model || model.startsWith("pollinations:") || model.startsWith("@cf/")) return;
      env.DB.prepare(
        "INSERT INTO model_perf (domain, model, wins) VALUES (?, ?, 1) ON CONFLICT(domain, model) DO UPDATE SET wins = wins + 1"
      ).bind(domainKey, model).run().catch(() => {});
    };
    const errMsgs = (agg) => (agg && agg.errors ? agg.errors.map((e) => String((e && e.message) || e)) : [String((agg && agg.message) || agg)]);

    // Root-cause instrumentation: `aiAttempts` above only ever recorded the
    // WINNER of a wave, plus (via errMsgs/AggregateError) the losers ONLY on
    // a wave that failed completely. That made a request that "succeeded but
    // barely" indistinguishable from one where every other provider was
    // healthy and just lost a fair race — from live production sampling, a
    // handful of concurrent requests ALL won wave 1 on the exact same
    // Workers AI model, every single time, which is consistent with either
    // "OpenRouter is genuinely slower every time" or "OpenRouter is failing
    // fast (rate limit / bad key) and never even in the real race" — and
    // there was no way to tell those apart without re-running curl probes
    // by hand. `raceEntry` wraps every leg of every wave (win or lose) with
    // its own settle time and outcome, independent of whether Promise.any
    // overall succeeds, and every entry is pushed into `aiAttempts` — so
    // `_aiAttempts` on an ORDINARY successful response now shows exactly how
    // every provider in that race actually performed, not just who won.
    // Sampling a few live responses' `_aiAttempts` going forward tells you
    // definitively whether OpenRouter is rate-limited (fast 429s) or just
    // slow (long times before losing), without needing to force a total
    // failure to see anything at all.
    const raceEntry = (wave, label, p) => {
      const t0 = Date.now();
      return p.then(
        (r) => { aiAttempts.push({ wave, model: label, ok: true, ms: Date.now() - t0 }); return r; },
        (e) => { aiAttempts.push({ wave, model: label, ok: false, ms: Date.now() - t0, error: String((e && e.message) || e) }); throw e; }
      );
    };

    const OR_WAVE1 = [
      "deepseek/deepseek-chat-v3-0324:free",
      "google/gemini-2.0-flash-exp:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen-2.5-72b-instruct:free",
    ];
    const OR_WAVE2 = [
      "mistralai/mistral-small-3.1-24b-instruct:free",
      "deepseek/deepseek-r1:free",
      "deepseek/deepseek-r1-distill-llama-70b:free",
      "deepseek/deepseek-r1-distill-qwen-32b:free",
      "nousresearch/hermes-3-llama-3.1-405b:free",
      "meta-llama/llama-3.1-8b-instruct:free",
      "meta-llama/llama-3.2-11b-vision-instruct:free",
      "meta-llama/llama-3.2-3b-instruct:free",
      "meta-llama/llama-4-scout:free",
      "meta-llama/llama-4-maverick:free",
      "google/gemma-3-27b-it:free",
      "google/gemma-2-9b-it:free",
      "qwen/qwq-32b:free",
      "qwen/qwen-2.5-coder-32b-instruct:free",
      "mistralai/mistral-7b-instruct:free",
      "microsoft/phi-3-medium-128k-instruct:free",
      "microsoft/phi-3-mini-128k-instruct:free",
      "openchat/openchat-7b:free",
      "huggingfaceh4/zephyr-7b-beta:free",
      "gryphe/mythomax-l2-13b:free",
      "cognitivecomputations/dolphin3.0-mistral-24b:free",
    ];
    const CF_WAVE1 = [
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    ];
    const CF_WAVE2 = [
      "@cf/meta/llama-3.1-8b-instruct-fp8",
      "@cf/meta/llama-3.1-8b-instruct",
      "@cf/mistral/mistral-7b-instruct-v0.2",
      "@cf/qwen/qwen1.5-14b-chat-awq",
      "@cf/microsoft/phi-2",
    ];
    // Commit 41: wave 1 previously staked its entire non-OpenRouter,
    // non-Workers-AI coverage on a SINGLE Pollinations model. Since OpenRouter's
    // ":free" models all draw from one account-level rate-limit bucket (so
    // "4 different model names" is really "1 shot, 4 labels" the moment that
    // bucket is throttled), and Workers AI is only in the race at all if
    // env.AI is actually bound in this Pages project's dashboard settings
    // (unconfirmed — see the `workersAIBound` flag Wave 3 logs below), a wave
    // that looks like "3 independent providers" can collapse to "OpenRouter
    // (throttled) + one flaky public model" far more often than its size
    // suggests. A second, independent Pollinations model costs nothing and
    // gives wave 1 a real second chance outside the OpenRouter bucket.
    const POLLINATIONS_WAVE1 = ["openai", "mistral"];
    const POLLINATIONS_WAVE2 = ["mistral", "llama", "qwen-coder"];

    const cfBound = !!(env.AI && typeof env.AI.run === "function");

    // WAVE 1: small, fast, historically-reliable set from EVERY provider,
    // raced together. This is what actually fixes "OpenRouter-only outage
    // blocks everything" — Workers AI and Pollinations are in flight from
    // the very first attempt, not after two OpenRouter tiers exhaust.
    if (!aiOK) {
      const wave1Calls = [
        ...(token ? OR_WAVE1.map((m) => raceEntry(1, m, callOR(m, messages, maxTokens))) : []),
        ...(cfBound ? CF_WAVE1.map((m) => raceEntry(1, m, callCF(m, messages, maxTokens))) : []),
        ...POLLINATIONS_WAVE1.map((m) => raceEntry(1, "pollinations:" + m, pollinationsCall(m, messages, maxTokens))),
      ];
      try {
        const winner = await Promise.any(wave1Calls);
        answer = winner.answer; aiOK = true;
        recordWin(winner.model);
      } catch (agg) {
        aiAttempts.push({ wave: 1, ok: false, attempted: wave1Calls.length, summary: errMsgs(agg) });
      }
    }

    // WAVE 2: broader set from every provider, raced together. Only fires if
    // wave 1 fully failed across ALL providers simultaneously.
    if (!aiOK) {
      const wave2Calls = [
        ...(token ? OR_WAVE2.map((m) => raceEntry(2, m, callOR(m, messages, maxTokens))) : []),
        ...(cfBound ? CF_WAVE2.map((m) => raceEntry(2, m, callCF(m, messages, maxTokens))) : []),
        ...POLLINATIONS_WAVE2.map((m) => raceEntry(2, "pollinations:" + m, pollinationsCall(m, messages, maxTokens))),
      ];
      if (wave2Calls.length > 0) {
        try {
          const winner = await Promise.any(wave2Calls);
          answer = winner.answer; aiOK = true;
          recordWin(winner.model);
        } catch (agg) {
          aiAttempts.push({ wave: 2, ok: false, attempted: wave2Calls.length, summary: errMsgs(agg) });
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // v31: WAVE 3 — BULLETPROOF LAST-RESORT TIER
    // Only fires once waves 1 AND 2 have already failed across every model
    // on every provider (30+ distinct attempts). At that point the cause is
    // structural, not one flaky model — most likely the account-level
    // OpenRouter rate-limit bucket every ":free" model in waves 1-2 shares,
    // or a simultaneous bad moment for Pollinations. Throwing more
    // OpenRouter model NAMES at the same throttled key wouldn't help, so
    // this tier instead:
    //   1. Prefers Workers AI, which is bound directly to this Cloudflare
    //      account and draws from neither OpenRouter's key-level bucket nor
    //      Pollinations' shared pool — the one path structurally immune to
    //      whatever just took out waves 1 and 2 together.
    //   2. Trades the full persona/voice/enforcer prompt for a short,
    //      minimal one (still wrapped in STRUCTURE, so the answer still
    //      comes out as the same four Markdown sections the frontend
    //      expects) — less to generate means less that can time out.
    //   3. Gives it a longer runway (24s vs. the usual 18s) since this is
    //      the last attempt before the honest structured fallback below,
    //      and a single sequential OpenRouter call as a last try if Workers
    //      AI isn't bound or also comes back empty — in case the throttle
    //      from waves 1-2 has had a few seconds to clear by now.
    // ════════════════════════════════════════════════════════════════
    if (!aiOK) {
      const bulletproofSystem =
        ID +
        "Every richer attempt to answer this just failed (rate limits / timeouts across multiple providers), so this is a fast, minimal pass — be direct and skip elaboration.\n\n" +
        STRUCTURE +
        (useEvidence ? "Cite sources inline as [1], [2], etc., matching the numbered list below. Only cite a source if it actually supports the claim." : "");
      // Bug: this reused `userContent` verbatim — the SAME full evidence
      // block (all 12-20 papers, their full abstracts) that waves 1 and 2
      // just failed to get any model through with. Shrinking only the
      // system prompt while leaving the far larger user-content payload
      // untouched meant this "bulletproof" tier couldn't actually rescue a
      // failure caused by prompt size rather than a rate limit — the exact
      // scenario a dense, many-source query runs into. Building a genuinely
      // small payload here (top few papers, short abstracts) gives this
      // last-resort tier a real chance of fitting inside a free-tier
      // model's context window when the richer attempts didn't.
      const bulletproofUserContent = (() => {
        if (!useEvidence && !useWeb) return query;
        const pool = useEvidence ? evidencePapers : webRefs;
        const compact = pool
          .slice(0, 5)
          .map(
            (p, i) =>
              "[" + (i + 1) + "] " + p.title + " (" + (p.journal || "n/a") + ", " + (p.year || "n/a") + ")\n" +
              "Abstract: " + (p.abstract || "").slice(0, 280)
          )
          .join("\n\n");
        return "Sources:\n\n" + compact + "\n\n---\nQuestion: " + query;
      })();
      const bulletproofMessages = [
        { role: "system", content: bulletproofSystem },
        { role: "user", content: bulletproofUserContent },
      ];
      const bulletproofMaxTok = Math.min(maxTokens, 900);

      // Commit 47: raced together in ONE Promise.any instead of Workers AI,
      // then (only on total failure) one sequential OpenRouter call. The old
      // sequential shape meant this tier's actual resilience was capped by
      // whichever single leg happened to run — and if Workers AI wasn't
      // bound (cfBound false; still an open, unconfirmed item — see the
      // audit-status doc), the ENTIRE last-resort tier came down to exactly
      // one OpenRouter model, on the exact same account-level key already
      // suspected of being throttled by waves 1-2's failure. Pollinations
      // needs no token or binding and shares neither OpenRouter's key-bucket
      // nor Workers AI's account limits — it was completely absent from
      // this tier before, despite being this app's one truly independent
      // provider, and having already proven itself in waves 1-2 above.
      // Racing all three together means the fastest surviving provider wins
      // instead of waiting out a provider that's already known to be down.
      const bulletproofLegs = [
        ...(cfBound ? ["@cf/meta/llama-3.2-3b-instruct", "@cf/meta/llama-3.1-8b-instruct-fp8"].map((m) => raceEntry(3, m, callCF(m, bulletproofMessages, bulletproofMaxTok, 24000))) : []),
        ...["openai", "mistral"].map((m) => raceEntry(3, "pollinations:" + m, pollinationsCall(m, bulletproofMessages, bulletproofMaxTok))),
        ...(token ? ["meta-llama/llama-3.2-3b-instruct:free", "google/gemma-2-9b-it:free"].map((m) => raceEntry(3, m, callOR(m, bulletproofMessages, bulletproofMaxTok, 18000))) : []),
      ];
      try {
        const winner = await Promise.any(bulletproofLegs);
        answer = winner.answer; aiOK = true;
        recordWin(winner.model);
      } catch (agg) {
        aiAttempts.push({ wave: 3, ok: false, bulletproof: true, summary: errMsgs(agg) });
      }
    }

    // Log the full attempt trail so a future total-failure is diagnosable
    // from Cloudflare's dashboard logs instead of requiring another live
    // repro from the user. This will show the ACTUAL reason — rate limit,
    // missing binding, provider outage — not a guess.
    if (!aiOK) {
      aiAttempts.push({ diagnostics: { hasOpenRouterKey: !!token, workersAIBound: cfBound } });
      try { console.log("Cerebrum: ALL AI PROVIDERS FAILED", JSON.stringify(aiAttempts)); } catch {}
      // Every wave above (including the "bulletproof" wave 3) failed, and
      // nothing downstream ever sets `answer` in that case — it was left as
      // the empty string it started as, so the response shipped a real
      // bibliography with a blank space where the synthesis should be. The
      // retrieval pipeline already did its job by this point (sourceList is
      // populated independent of AI generation succeeding), so there's
      // something real to hand back — just say so plainly instead of
      // silently omitting the section entirely.
      answer = sourceList.length > 0
        ? "Cerebrum's AI synthesis didn't complete for this question, but the sources below were found and are ready to read directly."
        : "Cerebrum's AI synthesis didn't complete for this question, and no sources were found either. Please try again in a moment.";
    }

    // ============ v6.0: ANSWER QUALITY ENGINE ============
    // Post-process EVERY answer through the quality engine. This catches
    // repetition, banned phrases, source-listing, and wrong-organism
    // acknowledgments that the model wrote despite being told not to.
    // This is a MECHANICAL fix — we don't rely on the model to follow rules.
    if (aiOK) {
      answer = postProcessAnswer(answer);
    }

    // ============ v6.0: QUALITY-GATED RETRY ============
    // Score the answer after post-processing. If it's still bad (score < 35),
    // retry with a different model using a MUCH stricter prompt that includes
    // examples of what NOT to do. This is the "intelligence amplifier" — even
    // if the first model produces garbage, we catch it and try again.
    if (aiOK && useEvidence && evidencePapers.length > 0) {
      const qualityScore = scoreAnswerQuality(answer, query);
      if (qualityScore < 35 && token) {
        // Build a retry prompt that's EXTREMELY explicit about what went wrong
        const retrySystemPrompt =
          "You are a scientific expert writing a research synthesis. CRITICAL RULES:\n\n" +
          "1. SYNTHESIZE — do NOT list papers one by one. Make claims and cite multiple sources inline.\n" +
          "   BAD: '[1] found X. [2] showed Y. [3] demonstrated Z.'\n" +
          "   GOOD: 'Gut microbiome composition varies significantly by larval instar, with early instars dominated by _Proteobacteria_ [1][3] while late instars shift toward _Firmicutes_ [2].'\n\n" +
          "2. ORGANISM ACCURACY — only cite papers about the EXACT organism asked about.\n" +
          "   If a paper studies a DIFFERENT organism, DO NOT CITE IT. Zero citations is better than wrong citations.\n\n" +
          "3. NO REPETITION — every sentence must add new information. Never rephrase.\n\n" +
          "4. NO FILLER — banned: 'further research is needed', 'plays a crucial role', 'in conclusion', " +
          "'Overall', 'it is important to note', 'sheds light on'.\n\n" +
          "5. START with a direct scientific claim. No 'Based on...' or 'The research shows...'.\n\n" +
          "6. Italicize species: _E. coli_. Quantify: give numbers, not 'significant'.";

        const retryMsgs = [
          { role: "system", content: retrySystemPrompt },
          { role: "user", content: "Sources:\n\n" + evidence + "\n\n---\nQuestion: " + query +
            "\n\n[Your answer will be quality-scored. Previous attempt scored " + qualityScore + "/100. Beat it.]" },
        ];
        const retryModels = [
          "google/gemini-2.0-flash-exp:free",
          "deepseek/deepseek-chat-v3-0324:free",
          "meta-llama/llama-3.3-70b-instruct:free",
        ];
        for (const m of retryModels) {
          try {
            const r = await callOR(m, retryMsgs, maxTokens);
            const retryProcessed = postProcessAnswer(r.answer);
            const retryScore = scoreAnswerQuality(retryProcessed, query);
            if (retryScore > qualityScore) {
              answer = retryProcessed;
              break;
            }
          } catch {}
        }
      }
    }

    // ============ CITATION QUALITY CHECK ============
    // If the answer has zero citations but we gave it papers, that's often
    // CORRECT — the papers may not have been relevant. Only retry if the answer
    // also seems low quality (too short or generic).
    if (aiOK && useEvidence && evidencePapers.length > 0) {
      const hasCitations = /\[\d+\]/.test(answer);
      // Only retry if: no citations AND answer is suspiciously short (model may
      // have given up rather than engaging with the papers)
      if (!hasCitations && answer.length < 200) {
        try {
          const retryMsgs2 = [
            { role: "system", content: "You are a scientific expert. Write a thorough, accurate answer. " +
              "Cite papers ONLY if they directly address the question's specific topic and organism. " +
              "If none of the papers are relevant, say so briefly and answer from your knowledge. " +
              "An accurate uncited answer is better than wrong citations. SYNTHESIZE — do not list sources." },
            { role: "user", content: "Papers:\n\n" + evidence + "\n\n---\nQuestion: " + query },
          ];
          const retryModels2 = ["deepseek/deepseek-chat-v3-0324:free", "google/gemini-2.0-flash-exp:free", "meta-llama/llama-3.3-70b-instruct:free"];
          for (const m of retryModels2) {
            try {
              const r = await callOR(m, retryMsgs2, maxTokens);
              if (r.answer.length > answer.length) {
                answer = postProcessAnswer(r.answer);
                break;
              }
            } catch {}
          }
        } catch {}
      }

      // Append a reference list at the bottom ONLY if citations were actually used.
      // Previously this appended sources even when they were irrelevant, which
      // made it look like the answer was backed by papers that don't support it.
      if (!/\[\d+\]/.test(answer) && evidencePapers.length > 0) {
        // No citations used — check if the answer is still good
        if (answer.length > 300) {
          // Answer is substantial — the model chose not to cite because papers
          // weren't relevant. That's correct behavior. Don't force sources.
        } else {
          // Short answer with no citations — add source context
          answer = answer.trim() +
            "\n\n---\n**Related papers found (may not directly address this question):**\n" +
            evidencePapers.slice(0, 4).map((p, i) => "[" + (i + 1) + "] " + p.title + (p.year ? " (" + p.year + ")" : "")).join("\n");
        }
      }

      // ============ D1 PAPER-LEVEL LEARNING (write) ============
      // Parse which citation numbers actually appear in the final answer and
      // persist THOSE specific papers as confirmed-correct for this query.
      // Next time this question (or an identically-worded one) is asked,
      // these papers get force-included at max relevance instead of being
      // rediscovered — this is the self-improving loop.
      if (env.DB && learnKey) {
        try {
          const citedIdx = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10)));
          const citedPapers = [...citedIdx]
            .map((n) => evidencePapers[n - 1])
            .filter(Boolean)
            .slice(0, 8);
          // Fired together rather than awaited one at a time in series — this
          // write happens after the answer is already computed but is still
          // awaited before the response returns, so up to 8 sequential D1
          // round-trips were pure added latency on the response tail for no
          // reason (each row is independent; nothing here depends on another
          // row's write completing first). Each gets its own catch so one
          // failing insert can't take the others down with it.
          await Promise.all(citedPapers.map((p) =>
            env.DB.prepare(
              "INSERT INTO paper_cache (query_key, title, url, journal, year, authors, abstract, times_confirmed, created_at) " +
              "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) " +
              "ON CONFLICT(query_key, title) DO UPDATE SET times_confirmed = times_confirmed + 1"
            ).bind(learnKey, p.title || "", p.url || "", p.journal || "", p.year || "", p.authors || "", (p.abstract || "").slice(0, 500), Date.now()).run().catch(() => {})
          ));
        } catch {}
      }
    }

    // ============ D1 QUERY INTELLIGENCE LEARNING ============
    // Store the successful query resolution so future similar queries
    // can skip the LLM resolver entirely. This is how the system
    // "learns and grows" — every successful answer makes the next
    // similar query faster and more accurate.
    if (env.DB && aiOK && answer.length > 100) {
      const resolvedTopic = llmResolvedTopic || (resolverResult && resolverResult.topic) || null;
      const finalSearchQuery = resolvedSearchQuery || query;
      const intentUsed = resolverResult ? resolverResult.intent : intent.kind;
      storeQueryIntelligence(
        queryKey, query, finalSearchQuery, intentUsed, resolvedTopic,
        conversationCtx ? conversationCtx.entities : [], env.DB
      ).catch(() => {});

      // Also update topic memory with search performance data
      if (resolvedTopic && papers.length > 0) {
        const searchTerms = selfReasonResult && selfReasonResult.key_terms
          ? selfReasonResult.key_terms
          : [];
        updateTopicMemory(resolvedTopic, searchTerms, papers.length, env.DB).catch(() => {});
      }
    }

    // ============ TIER 4: HONEST, STRUCTURED FALLBACK ============
    // v31 fix: every prior version of this text was one raw, unstructured
    // paragraph starting with "The AI answer service is momentarily
    // unavailable" — no "## " for renderAnswer() to promote into a heading,
    // no "- " for it to build a list from, so even a genuinely useful
    // abstract summary rendered as one dense wall of text on a total AI
    // outage. Rebuilt as real Markdown, using the exact same "## " header
    // and "- " bullet syntax renderAnswer() already turns into headings and
    // lists for a normal synthesized answer, so this path renders as a
    // page that looks intentional — not broken — even when every model in
    // every wave above has failed.
    if (!aiOK) {
      if (useEvidence && papers.length) {
        const paperBlocks = papers
          .slice(0, 6)
          .map(
            (p, i) =>
              "### [" + (i + 1) + "] " + p.title + "\n\n" +
              "- **Journal:** " + (p.journal || "Unknown") + (p.year ? " (" + p.year + ")" : "") + "\n" +
              "- **Summary:** " +
                ((p.abstract || "No abstract available.").slice(0, 300) +
                  (p.abstract && p.abstract.length > 300 ? "..." : ""))
          )
          .join("\n\n");
        answer =
          "## Unable To Synthesize — Showing Source Papers Directly\n\n" +
          "Every model Cerebrum tried was rate-limited or unavailable for this one request. Rather than guess, here are the " +
          Math.min(papers.length, 6) +
          " most relevant papers found — the same sources a synthesized answer would have cited.\n\n" +
          paperBlocks +
          "\n\n## What To Do Next\n\n" +
          "- Try your question again in a few seconds — free-tier model capacity recovers quickly.\n" +
          "- The papers above are fully listed in the sources panel and can be opened or exported directly.";
      } else if (useWeb && webRefs.length) {
        const refBlocks = webRefs
          .map(
            (r, i) =>
              "### [" + (i + 1) + "] " + r.title + "\n\n" +
              "- **Summary:** " + ((r.abstract || "No summary available.").slice(0, 300) + "...")
          )
          .join("\n\n");
        answer =
          "## Unable To Synthesize — Showing Reference Sources Directly\n\n" +
          "Every model Cerebrum tried was rate-limited or unavailable for this one request. Here are the reference sources found instead.\n\n" +
          refBlocks +
          "\n\n## What To Do Next\n\n" +
          "- Try your question again in a few seconds — free-tier model capacity recovers quickly.";
      } else {
        answer =
          "## Momentarily At Capacity\n\n" +
          "Every model Cerebrum tried, across three independent providers, was rate-limited or unavailable for this one request. This isn't an error with your question.\n\n" +
          "## What To Do Next\n\n" +
          "- Please try again in a few seconds — free-tier capacity recovers quickly.\n" +
          "- If this keeps happening, it's almost certainly a shared rate limit rather than anything specific to this query.";
      }
    }

    const dbUsed = useEvidence
      ? "Scientific databases"
      : useWeb
      ? "Reference sources"
      : "General knowledge";

    // Final safety: if this was a person-name query, force-correct any close
    // variants the AI hallucinated ("Sahoy" -> "Saho") in the answer body.
    // HARD GUARD against fabricated references. Runs on every answer, not just
    // the no-sources case: it also removes dangling markers like [7] when only
    // 4 sources exist, which would otherwise render as a broken citation link.
    answer = stripFabricatedCitations(answer, sourceList.length);

    const canonicalName = resolvedPersonName || extractPersonNameFromQuery(query) || (isNameSearch ? query : "");
    if (canonicalName) {
      answer = correctNameVariants(answer, canonicalName);
    }

    // ---- CACHE THE ANSWER (D1) ----
    // Store this answer so future similar queries can skip the LLM entirely.
    // Only cache answers that have real sources — unsourced general-knowledge
    // answers are the ones most likely to contain errors.
    const answerId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    // `&& aiOK` guard added alongside the !aiOK fallback message above —
    // that message is real prose over 50 characters, and without this guard
    // it would otherwise satisfy every condition here and get cached as if
    // it were a genuine answer, serving "AI synthesis didn't complete" to
    // every future repeat of this query even after providers recover.
    if (env.DB && aiOK && sourceList.length > 0 && answer.length > 50) {
      // v37: this was a plain `await` — meaning every single non-cached
      // response paid for a full D1 round-trip AFTER the answer was already
      // computed, purely to help future requests, before the current one
      // could return. `waitUntil` (available on every Pages Function's
      // context, same as a Worker's) tells the runtime to keep the isolate
      // alive to finish this write in the background instead, while the
      // response goes out immediately. A write failure still can't take the
      // response down (own try/catch), it just no longer taxes the person
      // who's waiting on THIS answer for the benefit of a future one.
      const cacheWrite = env.DB.prepare(
        "INSERT OR REPLACE INTO answer_cache (query_key, answer_id, answer, sources, score, created_at) VALUES (?, ?, ?, ?, 0, ?)"
      ).bind(
        cacheKey,
        answerId,
        answer,
        JSON.stringify(sourceList.slice(0, 10)),
        // Bug: this wrote an ISO-8601 string into a column declared
        // INTEGER (see schema.sql), while paper_cache's write a few lines
        // away correctly uses Date.now(). SQLite's flexible typing stored
        // it silently, so it worked by luck (ISO strings happen to sort
        // correctly against each other) but would sort wrong the moment
        // any row got a genuine numeric timestamp. Match paper_cache.
        Date.now()
      ).run().catch(() => {}); // Cache write failure is not critical — don't block the response
      if (typeof waitUntil === "function") waitUntil(cacheWrite); else await cacheWrite;
    }

    // ════════════════════════════════════════════════════════════════
    // FACT-CHECK PASS (the real implementation — see verifyAnswerAgainstSources
    // in knowledge.js). Every response path in this file used to hardcode
    // `factCheck: null` regardless of the request's settings.factCheck flag —
    // the frontend's toggle and FactCheck display component existed but had
    // nothing on the backend to ever populate them. This is deterministic and
    // effectively free (no network call), so it's computed for every answer
    // that has real sources behind it; only sent to the client when the user
    // actually has the setting on, so the UI stays exactly as opt-in as the
    // toggle promises.
    let factCheckResult = null;
    if (settings.factCheck && useEvidence && evidencePapers.length > 0) {
      // v34: the deep, claim-by-claim pass is tried first — see deepFactCheck()
      // above for the two-tier LLM strategy and why it can't reuse callOR/
      // callCF. It replaces the old one-line-per-entity output ("References
      // 'LLPS'") with several actual claims, each checked against a quote
      // from the specific source it's supposed to come from and a real
      // methodological justification, which is what the FactCheck panel's
      // copy ("relevance/fact-check") always implied it was doing.
      const deepClaims = await deepFactCheck(answer, evidencePapers, env).catch(() => null);
      if (deepClaims) {
        const unsupportedCount = deepClaims.filter((c) => c.status === "unsupported").length;
        const supportedCount = deepClaims.filter((c) => c.status === "supported").length;
        const thinCount = deepClaims.filter((c) => c.status === "thin").length;
        const overall = unsupportedCount === 0
          ? "supported"
          : (supportedCount > 0 || thinCount > 0)
          ? "partly"
          : "unsupported";
        const claims = deepClaims.map((c) => ({
          claim: c.claim,
          status: c.status,
          // Same shape the frontend has always rendered — {claim, status,
          // note} — so this richer backend needed zero FactCheck component
          // changes. The quote-plus-reasoning combination is what makes each
          // line a real methodological account instead of a canned phrase.
          note: c.quote
            ? `"${c.quote}"${c.sourceIndex ? ` [${c.sourceIndex}]` : ""} — ${c.justification}`
            : c.justification,
        }));
        const summary = `Checked ${claims.length} claim${claims.length === 1 ? "" : "s"} against the cited sources: ` +
          `${supportedCount} supported, ${thinCount} thin, ${unsupportedCount} unsupported.`;
        factCheckResult = { overall, summary, claims };
      } else {
        // Both LLM tiers failed (no key/binding configured, timeout, or an
        // unparseable response) — fall back to the deterministic, zero-
        // network heuristic rather than showing nothing. Same behavior as
        // before this round's change, just now the fallback path instead of
        // the only path.
        const fc = verifyAnswerAgainstSources(answer, evidencePapers);
        // Only surface the panel when there was actually something to check —
        // a purely mechanistic answer that never names a specific drug/gene/
        // pathway isn't a failure to verify, it's just nothing to verify, and
        // showing an empty fact-check box for that case would be misleading.
        if (fc.checked) {
          // A "thin" term (the acronym's own written-out definition shows up
          // in a source even though the bare acronym never does — see
          // findAcronymExpansions in knowledge.js) is real, if indirect,
          // support: it should pull the overall verdict away from
          // "unsupported", same as a solid match would, just rendered with its
          // own lighter-weight status in the UI rather than collapsed into
          // "supported" and losing that nuance.
          const overall = fc.unsupported.length === 0
            ? "supported"
            : (fc.supported.length > 0 || fc.thin.length > 0)
            ? "partly"
            : "unsupported";
          const claims = [
            ...fc.supported.map((term) => ({ claim: `References "${term}"`, status: "supported", note: "Appears in at least one cited source." })),
            ...fc.thin.map((term) => ({ claim: `References "${term}"`, status: "thin", note: "The acronym itself isn't in a cited source's title or abstract, but the phrase the answer used to define it is." })),
            ...fc.unsupported.map((term) => ({ claim: `References "${term}"`, status: "unsupported", note: "Doesn't appear in any cited source's title or abstract — may be from general knowledge, or worth double-checking." })),
          ];
          factCheckResult = { overall, summary: fc.note, claims };
        }
      }
    }

    const literatureConflicts = extractLiteratureConflicts(answer, sourceList);

    // Run last, after every pass above has already read the plain-text
    // `answer` (fact-check, literature-conflict extraction) — see
    // italicizeScientificTerms()'s own comment for why order matters here.
    answer = italicizeScientificTerms(answer, query);

    return new Response(
      JSON.stringify({
        answer,
        sources: sourceList,
        videos,
        factCheck: factCheckResult,
        literature_conflicts: literatureConflicts.length > 0 ? literatureConflicts : null,
        related: [],
        answerId, // frontend can use this for upvote/downvote
        source:
          aiOK && useEvidence
            ? dbUsed + " + AI"
            : aiOK && useWeb
            ? dbUsed + " + AI"
            : aiOK
            ? "General knowledge (AI)"
            : dbUsed,
        _diag: gResult && gResult._diag ? gResult._diag : null,
        _resolver: resolverResult ? {
          intent: resolverResult.intent,
          topic: resolverResult.topic,
          reasoning: resolverResult.reasoning,
          resolvedQuery: resolvedSearchQuery,
        } : null,
        _selfReasoning: selfReasonResult ? {
          complexity: selfReasonResult.complexity,
          subQuestions: selfReasonResult.sub_questions,
          keyTerms: selfReasonResult.key_terms,
        } : null,
        // v6.1: which models were attempted and which one (if any) won —
        // lets a future total-failure be diagnosed from the response itself
        // instead of requiring a live repro + dashboard log dig.
        _aiAttempts: typeof aiAttempts !== "undefined" ? aiAttempts : null,
      }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    // Full detail server-side only — this response is public, and used to
    // include the raw exception message/stack in `_debug` on every 500/502/
    // 503/504, which is an information-disclosure risk (internals, file
    // paths, whatever the exception happened to say) for zero benefit to a
    // legitimate caller who just needs a clear, generic explanation.
    console.error("Cerebrum /api/search top-level error:", e && e.stack ? e.stack : e);
    // Classify the error for a more helpful user-facing message
    const msg = (e.message || String(e)).toLowerCase();
    let userMessage = "Something went wrong on our end. Please try again in a moment.";
    let status = 500;
    if (msg.includes("rate") || msg.includes("429") || msg.includes("quota")) {
      userMessage = "Our AI providers are temporarily rate-limited. Try again in 30 seconds.";
      status = 503;
    } else if (msg.includes("timeout") || msg.includes("abort") || msg.includes("timed out")) {
      userMessage = "The search took too long. Try a simpler query or try again shortly.";
      status = 504;
    } else if (msg.includes("network") || msg.includes("fetch")) {
      userMessage = "Couldn't reach one of our data sources. Give it a moment and retry.";
      status = 502;
    }
    return new Response(
      JSON.stringify({
        error: userMessage,
      }),
      { status, headers: secureCors }
    );
  }
}
