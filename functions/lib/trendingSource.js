// Shared fetch + normalize logic for the "Trending in Science" feed.
// Used by both trending.js (serves the cached feed to the browser) and
// trending-refresh.js (the hourly job that repopulates that cache) so the
// two can never drift into fetching or shaping articles differently.

const POLITE_UA =
  "Cerebrum/1.0 (askcerebrum.org; a free scientific literature search; mailto:contact@askcerebrum.org)";

// Spaceflight News API v4 — free, keyless, publicly documented aggregator
// of real science/space journalism from named outlets (NASA, SpaceNews,
// Ars Technica, and others), with real article photos. Nothing here is
// generated or invented — every field returned below is copied straight
// from that article's own record.
//
// limit=24, up from the old 12: the redesigned feed leads with one large
// featured story plus a magazine grid underneath, which needs enough real
// inventory to fill both without repeating the same handful of stories.
const SOURCE_URL = "https://api.spaceflightnewsapi.net/v4/articles/?limit=24&ordering=-published_at";

/**
 * Read a response body with a hard byte ceiling.
 *
 * These feeds are third-party and untrusted: a misbehaving or compromised
 * upstream answering with a multi-hundred-MB body would otherwise be
 * buffered whole by res.text()/res.json() into the isolate's memory.
 * The reader is cancelled the moment the budget is exceeded.
 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

async function readCappedText(res) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("response body exceeded size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(buf);
}

async function getJSON(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": POLITE_UA, Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      await res.text().catch(() => {});
      throw new Error("HTTP " + res.status);
    }
    return JSON.parse(await readCappedText(res));
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// Strips protocol, "www.", trailing slash, and query/hash so two links to
// the same story (http vs https, a tracking query string, a trailing
// slash) collapse to the same dedup key instead of sneaking past a literal
// string match.
function normalizeUrl(url) {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

// Falls back to the article's own title (lowercased, whitespace collapsed)
// when two syndicated copies of the same story ship under different URLs
// entirely — a real-world case with wire-service reporting that a URL-only
// dedup would miss.
function normalizeTitle(title) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

// Commit 60 — MULTI-DISCIPLINE. Until now the single source here was the
// Spaceflight News API, which is exactly what it sounds like: an aggregator
// of spaceflight reporting. So "Trending in Science" was, unavoidably, 100%
// space news — reported directly ("trending and daily are still way too
// space coded... there needs to be biology and all that jazz"), and entirely
// correct. No amount of layout work fixes a feed that only has one subject.
//
// Four keyless sources now, chosen so the disciplines a science platform
// actually spans are each represented by something authoritative:
//   · Europe PMC   — biology and medicine, the largest open biomedical index
//   · bioRxiv      — life-science preprints, i.e. what's happening this week
//   · arXiv        — physics, chemistry, quantitative biology, CS
//   · Spaceflight  — kept, but as ONE slice instead of the whole feed
//
// Every item carries a `category`, and the merge below takes a fixed share
// from each rather than sorting everything by date — a pure date sort would
// hand the whole feed back to whichever source publishes most often, which
// is how this became a space feed in the first place. Sources that fail or
// time out are simply absent; the feed degrades to whatever answered rather
// than failing whole.
// Upstream aggregator scrapers sometimes fill `summary` with the article
// page's NAV CHROME ("Today's APOD Archive Submissions Index Search
// Calendar") instead of article text. That is site furniture, not a summary —
// printing it verbatim puts garbage on a card. Detect it and fall back to
// honest attribution rather than the furniture. Conservative by design: only
// unambiguous chrome words count ("search"/"index" appear in real prose, so
// they are excluded), and a summary that is just the site name on repeat
// ("APOD APOD APOD: …") trips the second rule.
// Real incident (2026-09-16): an APOD item shipped with nav text as its card
// description.
const NAV_CHROME_RE = /\b(archive|submissions|sitemap|calendar|subscribe|newsletter|menu|navigation|breadcrumb)\b/gi;
function cleanSpaceSummary(a) {
  const s = (a && a.summary || "").trim();
  if (!s) return s;
  const chromeHits = (s.match(NAV_CHROME_RE) || []).length;
  const siteNameRepeat = /^([a-z]{2,}\s*){3,}/i.test(s) && new Set(s.toLowerCase().split(/\s+/).filter(Boolean)).size <= 3;
  if (chromeHits >= 2 || siteNameRepeat) {
    // No summary. This used to return a placeholder sentence
    // ("NASA story. Full text at the source link.") which then
    // shipped AS the summary, with summaryMissing false — a card
    // asserting a description it did not have. Chrome in place of a
    // summary means the item HAS no summary; the empty string is
    // the honest value, and buildTrendingItem marks an empty
    // summary missing, so the card renders without one.
    return "";
  }
  return s;
}

// Upstream titles carry their own markup. Europe PMC's JSON ships titles
// with embedded, already-escaped tags ("Disseminated &lt;i&gt;Klebsiella
// pneumoniae&lt;/i&gt; Infection ..."), and rendering that string through
// JSX escapes the ampersands a SECOND time, so the raw entities land on
// the card as visible text. Decode once, strip tags, collapse whitespace —
// provenance is kept, markup is not. Applied to every source at merge
// time so no parser has to remember to do it. Never emits HTML: tags are
// removed as plain text, never trusted.
//
// One exception, and it is meaning rather than markup: an italic span is
// how a source marks a species name, and stripping it silently rendered
// *Phytophthora* in roman on the card, indistinguishable from an ordinary
// word. Italic spans (literal or entity escaped) are parked in sentinels
// before decoding and stripping; a caller that renders through the
// markdown path — titles do, via buildTrendingItem — gets them back as
// *pairs*, and every other caller gets exactly the plain text it has
// always had. buildTrendingItem asks for pairs on both title and
// summary; the plain default remains for callers whose surface prints
// raw text.
const ITALIC_OPEN = "\u0001";
const ITALIC_CLOSE = "\u0002";
// Converts parked italic sentinels to markdown *pairs*. An unpaired
// sentinel is dropped rather than left as a broken marker: a close with
// no open, a second open inside a span, an empty span, and a span left
// open at the end of the string all lose their markers, keeping the words.
function italicSentinelsToMarkdown(t) {
  let out = "";
  let openAt = -1;
  for (const ch of t) {
    if (ch === ITALIC_OPEN) {
      if (openAt === -1) { openAt = out.length; out += "*"; }
    } else if (ch === ITALIC_CLOSE) {
      if (openAt !== -1) {
        if (out.length === openAt + 1) out = out.slice(0, openAt);
        else out += "*";
        openAt = -1;
      }
    } else out += ch;
  }
  if (openAt !== -1) out = out.slice(0, openAt) + out.slice(openAt + 1);
  return out;
}

// TeX commands that name a symbol rather than a word, restored by
// cleanTrendingText before its generic command strip runs: relations
// become the ASCII or symbol form a reader parses ($f\gg 1$ reads
// "f >> 1"), Greek letters become the letters themselves, matching
// the named entity decoding above.
const TEX_SYMBOL_TEXT = {
  // Relations carry their spaces: TeX glues them to the operands
  // ($f\gg 1$), and the whitespace collapse downstream normalizes
  // the spaced form ($f \gg 1$) to the same single spaces.
  gg: " >> ", ll: " << ", geq: " >= ", ge: " >= ", leq: " <= ", le: " <= ",
  approx: " ≈ ", sim: " ~ ", times: " × ", pm: " ± ", cdot: " · ",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ",
  nu: "ν", xi: "ξ", omicron: "ο", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
};

const NAMED_ENTITIES = {
  lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " ",
  // The micro sign, under its entity name: a dose or a length
  // spelled "&micro;atm" or "&micro;m" must come through as the
  // sign it names (µ, the same character the numeric form &#181;
  // decodes to), not print the entity raw and not lose the prefix
  // — 2,800 microatmospheres misread as 2,800 atmospheres is a
  // six order of magnitude error wearing a unit's clothes. The
  // payload spells Greek letters as characters (see the Greek
  // entries below and TEX_SYMBOL_TEXT), so the sign ships as the
  // character too, never as the word "micro".
  micro: "µ",
  // Greek letters: a source that spells a name with an entity
  // ("&epsilon;psilon", ESA's stylized name for Sophie Adenot's
  // mission) must decode to the letter it names, not print the
  // entity raw on the card. Numeric entities already decode through
  // the code point branch; these are the named forms of the same
  // letters.
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ",
  nu: "ν", xi: "ξ", omicron: "ο", pi: "π", rho: "ρ", sigma: "σ",
  tau: "τ", upsilon: "υ", phi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Alpha: "Α", Beta: "Β", Gamma: "Γ", Delta: "Δ", Epsilon: "Ε", Zeta: "Ζ",
  Eta: "Η", Theta: "Θ", Iota: "Ι", Kappa: "Κ", Lambda: "Λ", Mu: "Μ",
  Nu: "Ν", Xi: "Ξ", Omicron: "Ο", Pi: "Π", Rho: "Ρ", Sigma: "Σ",
  Tau: "Τ", Upsilon: "Υ", Phi: "Φ", Chi: "Χ", Psi: "Ψ", Omega: "Ω",
};

// ── Data hygiene: dashes, TeX artifacts, page furniture ────────────
// The dash gate scans the app's own authored strings; it cannot see
// upstream DATA, and upstream data arrives with its own defects: em
// and en dashes in titles and summaries (a live APOD title shipped
// "2026 October 13 – Desert Stairway to Heaven", its summary "NASA
// story — full text at the source link."), TeX double hyphens out of
// arXiv style abstracts ("Curie--Weiss", "10--41\%"), and page
// furniture scraped into summary starts ("For more information,
// contact … Download the PDF version …"). Every title and summary
// passes through cleanTrendingText, so the fixes live here, once.
//
// deDashTrendingText mirrors deDash (functions/api/search.js), the
// rule the answers already ship under: a numeric range reads "to", a
// paired dash is a parenthetical set off with commas, a single dash
// before a clause becomes a period and otherwise a comma or a colon.
// Two trending specific choices, made deliberately:
//   · A dash glued inside a word (T–cell) is a compound joint, not
//     punctuation: it becomes a space ("T cell"), a spelling the
//     literature itself uses.
//   · A TeX "--" is an author's range or compound, never emphasis:
//     between numbers it reads "to" ("10--41%" → "10 to 41%"), and
//     between words the compound opens to a space ("Curie--Weiss" →
//     "Curie Weiss"). A plain hyphen is not an option: the no dashes
//     rule covers hyphens in shipped text too.
function deDashTrendingText(t) {
  let out = String(t);
  out = out.replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2");
  out = out.replace(/(\d)\s*--\s*(\d)/g, "$1 to $2");
  // A plain hyphen between decimals is the same range in a third
  // spelling (a live summary shipped "Z_c 0.382-0.386"): it converts
  // like the dash spellings above. Scoped to a decimal point on the
  // left so hyphenated words and part numbers are untouched.
  out = out.replace(/(\d+\.\d+)\s*-\s*(\d+(?:\.\d+)?)/g, "$1 to $2");
  out = out.replace(/([A-Za-z])--([A-Za-z])/g, "$1 $2");
  out = out.replace(/\s+--\s+/g, ", ");
  out = out.replace(/--/g, " ");
  return out.split("\n").map((line) => {
    if (!/[–—]/.test(line)) return line;
    let o = line.replace(/([\p{L}\p{N}])[–—]([\p{L}\p{N}])/gu, "$1 $2");
    o = o.replace(/\s*[–—]\s*([^–—]{1,120}?)\s*[–—]\s*/g, ", $1, ");
    o = o.replace(/\s*[–—]\s*(.+)$/, (m, rest) => {
      const tail = rest.trim();
      if (!tail) return "";
      const hasVerb = /\s(is|are|was|were|be|been|has|have|had|can|could|will|would|may|might|does|do|did|remains?|shows?|showed|suggests?|means?|makes?|made|gives?|gave|leaves?|left|becomes?|became|reduces?|increases?|supports?|appears?|seems?|tends?)\s/i.test(" " + tail);
      const startsClause = /^(the|this|that|these|those|it|they|we|there|a|an|its|their|his|her|our|most|many|some|each|every|both|neither|either|[A-Z])\b/.test(tail);
      if (hasVerb && startsClause && tail.length > 24) return ". " + tail.charAt(0).toUpperCase() + tail.slice(1);
      if (!hasVerb && /,|\sand\s|\sor\s/.test(tail)) return ": " + tail;
      return ", " + tail;
    });
    return o.replace(/\s+([,.;:!?])/g, "$1").replace(/,\s*,/g, ",").replace(/,\s*\./g, ".").replace(/\.\s*\./g, ".").replace(/,\s*$/, "").replace(/\s{2,}/g, " ");
  }).join("\n");
}

// Leading page furniture: contact blocks, download prompts, and
// "for more information" boilerplate that precede the real summary
// text (a live NASA tech summary opened with the contact block and
// download prompt and only then described its own subject, a code
// its title never mentioned). The patterns are narrow and anchored
// at the very start; each pattern removes at most one block, the set
// runs until nothing matches, and if stripping would empty the text
// the original is kept — a summary that is all furniture degrades to
// itself rather than to a silent blank.
// The contact block ends at its email when one is present: the names
// inside it carry their own periods ("Joel W. Sills"), so a sentence
// end cannot be trusted to close it.
const LEADING_FURNITURE_RES = [
  /^for more information,?\s+contact\b[\s\S]{0,320}?[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\s*/i,
  /^for more information,?\s+contact\b[^.!?…]*[.!?…]\s*/i,
  /^download\s+(?:the\s+)?(?:pdf|document|fact\s*sheet|full\s*text)\b[^.!?…]*[.!?…]\s*/i,
  /^for more information\b[^.!?…]*[.!?…]\s*/i,
];
function stripLeadingPageFurniture(t) {
  let out = String(t || "");
  for (let n = 0; n < 3; n++) {
    const before = out;
    for (const re of LEADING_FURNITURE_RES) out = out.replace(re, "");
    out = out.replace(/^\s+/, "");
    if (out === before) break;
  }
  return out.trim() ? out : t;
}

export function cleanTrendingText(s, opts) {
  let t = String(s || "");
  // Park italic spans first, in both spellings: the entity escaped form
  // Europe PMC actually ships, and the literal tag form.
  t = t.replace(/&lt;\s*(\/?)\s*(?:i|em)\s*&gt;/gi, (m, close) => (close ? ITALIC_CLOSE : ITALIC_OPEN));
  t = t.replace(/<\s*(\/?)\s*(?:i|em)\s*>/gi, (m, close) => (close ? ITALIC_CLOSE : ITALIC_OPEN));
  t = t.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : m;
  });
  t = t.replace(/<[^>]*>/g, " ");
  // Escaped literals first: "\%" and "\&" carry no command letters, so
  // the unwrap below would leave their backslashes in the text (the
  // live "10--41\%" artifact kept its slash). They mean the character.
  t = t.replace(/\\%/g, "%").replace(/\\&/g, "&");
  // TeX remnants ride along in arXiv and bioRxiv abstracts
  // (\emph{...}, {Delta}, $...$). Unwrap commands, drop the braces and
  // math delimiters, keep the words.
  // First, the commands that ARE symbols: a relation or a Greek
  // letter dropped by the generic command strip below leaves a hole
  // in the sentence — a live summary shipped "For f 1" where the
  // abstract said $f\gg 1$, its comparator silently deleted. These
  // restore to the symbol they name before the strip can eat them.
  // The terminator is "not a letter", NOT a word boundary: TeX
  // command names are letter runs, so a command glued straight to
  // its operand is still the command — $f\geq1$ is \geq followed by
  // 1. The word boundary form missed exactly that spelling (a
  // letter and a digit are both word characters, so no boundary
  // sits between them), and the generic strip below then ate the
  // command whole: the live arXiv abstract for the Curie Weiss cell
  // fluid model (arXiv 2610.18411) ships "For $f\geq1$" and
  // "$Z_c\approx0.382-0.386$", and both relations vanished from the
  // served summary ("For f 1", "Zc 0.382 to 0.386"). A lookahead for
  // a letter keeps non commands safe: \get is not \ge, because the
  // letter run continues.
  t = t.replace(/\\(gg|ll|geq|ge|leq|le|approx|sim|times|pm|cdot|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)(?![a-zA-Z])/g,
    (m, name) => TEX_SYMBOL_TEXT[name] || " ");
  t = t.replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, "$1");
  t = t.replace(/\\[a-zA-Z]+/g, " ");
  t = t.replace(/\$/g, "");
  t = t.replace(/[{}]/g, "");
  // Subscripts keep their base and subscript joined, the way the
  // symbol is spoken: TeX's J_2 and Z_c shipped literally in a live
  // summary ("f=J_2/J_1", "Z_c 0.382-0.386"). Digit subscripts join
  // always; letter subscripts join only when short (one to three
  // letters, a symbol's subscript), so snake_case words in prose are
  // never fused by this rule.
  t = t.replace(/([A-Za-z0-9])_(\d)/g, "$1$2");
  t = t.replace(/([A-Za-z])_([a-z]{1,3})(?![a-z])/g, "$1$2");
  // Syndication boilerplate and upstream truncation markers are not
  // summary text.
  t = t.replace(/The post [\s\S]*? appeared first on [^.]*\./gi, " ");
  t = t.replace(/\s*\[…\]/g, "");
  t = t.replace(/\s*\[\.\.\.\]\s*$/g, "");
  // Data hygiene (see the block above deDashTrendingText): dashes and
  // TeX "--" sequences normalize here, in the one cleaning path every
  // title and summary passes through, and leading page furniture
  // comes off the front before the italics are restored.
  t = deDashTrendingText(t);
  t = t.replace(/\s+/g, " ").trim();
  t = stripLeadingPageFurniture(t);
  if (opts && opts.italics === "markdown") return italicSentinelsToMarkdown(t).replace(/\s+/g, " ").trim();
  return t.split(ITALIC_OPEN).join("").split(ITALIC_CLOSE).join("");
}

const SOURCES = [
  {
    category: "Biology & Medicine",
    // Plain query + date sort rather than a date-range filter: Europe PMC's
    // range syntax is easy to get subtly wrong and a malformed query returns
    // zero results rather than an error, which would look identical to "the
    // source is down". Sorting by publication date descending gets the same
    // recency with nothing that can silently mis-parse.
    // resultType=core is load bearing: the lite response carries no
    // abstractText at all, so without it every record in this section
    // arrived summaryless and the page told readers no summary was
    // published when the fetch had simply never asked for it.
    url: "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=OPEN_ACCESS%3Ay%20AND%20HAS_ABSTRACT%3Ay&format=json&pageSize=12&sort=P_PDATE_D%20desc&resultType=core",
    parse: (d) => ((d && d.resultList && d.resultList.result) || []).map((r) => ({
      title: (r.title || "").replace(/\.$/, ""),
      // No abstract means NO summary. The old fallback stored the
      // journal and author line in the summary field, and the UI then
      // presented bibliographic metadata as if it were an abstract.
      summary: r.abstractText || "",
      summaryMissing: !r.abstractText,
      url: r.doi ? `https://doi.org/${r.doi}` : (r.fullTextUrlList && r.fullTextUrlList.fullTextUrl && r.fullTextUrlList.fullTextUrl[0] && r.fullTextUrlList.fullTextUrl[0].url) || "",
      source: r.journalTitle || "Europe PMC",
      // The sort key is the print publication date, so the date shown
      // must be that same date. The old code displayed the first
      // online date, which can sit months earlier, and a story could
      // read as far older than the edition position it was sorted into.
      publishedAt: r.printPublicationDate || r.firstPublicationDate || null,
      indexedAt: r.firstIndexDate || null,
      doi: r.doi || null,
      type: /review/i.test(String(r.pubType || "")) ? "Review" : "Paper",
      // Europe PMC's own citation count for the record — a real, grounded
      // "why this matters" signal for journal articles. Shown only when
      // positive; the other three sources don't provide one, so no label
      // is ever invented for them.
      citedByCount: r.citedByCount,
    })),
  },
  {
    category: "Preprints",
    // bioRxiv's documented shape is /details/{server}/{from}/{to}; the date
    // window is computed rather than relying on a "recent" alias whose
    // existence isn't guaranteed by their docs.
    // A THUNK, not a value: this module lives for the lifetime of a warm
    // isolate, so computing the window once at import would freeze "today"
    // and serve an ever-more-stale date range after midnight. Resolved on
    // every refresh instead.
    url: () => {
      const d = (offsetDays) => new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
      return `https://api.biorxiv.org/details/biorxiv/${d(4)}/${d(0)}`;
    },
    parse: (d) => [...((d && d.collection) || [])]
      // The API returns its window in no promised order; the old code
      // took the first 12 as they came, which in practice meant every
      // record dated from the first day of the window. Newest first.
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      .slice(0, 12).map((r) => ({
      title: (r.title || "").trim(),
      summary: (r.abstract || "").trim(),
      summaryMissing: !r.abstract,
      url: r.doi ? `https://doi.org/${r.doi}` : "",
      source: `bioRxiv${r.category ? " · " + r.category : ""}`,
      publishedAt: r.date || null,
      doi: r.doi || null,
      type: "Preprint",
      discipline: r.category || null,
    })),
  },
  {
    category: "Physics & Chemistry",
    // Explicit category codes instead of wildcards — arXiv accepts wildcards
    // inconsistently across category groups, and a rejected query returns an
    // empty feed rather than an error. https, not http, because the redirect
    // would otherwise cost a round trip on every refresh.
    url: "https://export.arxiv.org/api/query?search_query=cat:q-bio.BM+OR+cat:cond-mat.soft+OR+cat:physics.bio-ph+OR+cat:physics.chem-ph&sortBy=submittedDate&sortOrder=descending&max_results=12",
    xml: true,
    parse: (text) => {
      // arXiv answers in Atom XML and there is no XML parser in the Workers
      // runtime, so this pulls the handful of fields needed with regexes.
      // Narrow and forgiving on purpose: a feed format change should cost a
      // missing section, never a thrown request.
      const entries = String(text).split("<entry>").slice(1);
      return entries.map((e) => {
        const pick = (tag) => {
          const m = e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
          return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
        };
        const linkMatch = e.match(/<id>([\s\S]*?)<\/id>/);
        const catMatch = e.match(/<category[^>]*term="([^"]+)"/);
        const catTerm = catMatch ? catMatch[1] : "";
        const url = linkMatch ? linkMatch[1].trim() : "";
        return {
          title: pick("title"),
          summary: pick("summary"),
          url,
          source: "arXiv",
          publishedAt: pick("published") || null,
          doi: url.includes("arxiv.org/abs/") ? url.split("arxiv.org/abs/")[1] : null,
          type: "Preprint",
          discipline: catTerm || null,
        };
      });
    },
  },
  {
    category: "Space",
    url: SOURCE_URL,
    parse: (d) => (Array.isArray(d && d.results) ? d.results : []).map((a) => ({
      title: (a.title || "").trim(),
      summary: cleanSpaceSummary(a),
      url: typeof a.url === "string" ? a.url.trim() : "",
      image_url: typeof a.image_url === "string" ? a.image_url : "",
      source: (a.news_site || "Spaceflight News").trim(),
      publishedAt: a.published_at || null,
      type: "Press",
      discipline: "Space",
    })),
  },
];

async function getText(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Cerebrum/1.0 (https://askcerebrum.org)" } });
    if (!res.ok) return null;
    return await readCappedText(res);
  } catch { return null; } finally { clearTimeout(timer); }
}

// The 3000 char slice in buildTrendingItem (and the sentence finish
// after it) can cut an italic *pair* in half, leaving a lone marker
// that would print literally. Markers in a cleaned summary exist only
// as pairs, so an odd count means the last one is an orphan: drop the
// marker, keep the words.
function rebalanceTrendingItalics(s) {
  const count = (s.match(/\*/g) || []).length;
  if (count % 2 === 0) return s;
  const i = s.lastIndexOf("*");
  return s.slice(0, i) + s.slice(i + 1);
}

// Normalizes one upstream record into the feed's item shape. Pure and
// exported for unit tests: the HTML cleanup here must decode/strip markup
// in titles and summaries without ever touching the media URL — a cleanup
// that strips image_url is a cleanup that silently deletes every picture
// on the feed.
// Topical coherence between a title and its summary. The Space
// pipeline strips leading page furniture off a summary, and what
// survives the strip can be a DIFFERENT text than the story's own: a
// live edition shipped a structural systems title ("Complex Modes in
// Lightly Damped Structural Systems") over equilibrium chemistry
// prose, the summary of the software page the article sat beside.
// The check is the media rule's family (tokenize both sides,
// distinctive title tokens only): when the title yields at least
// three distinctive tokens and the summary shares NONE of them, the
// summary is not about this title, and a mismatched summary is worse
// than none — the item ships summaryMissing instead. Validated
// against the live 2026-10-14 edition: exactly the two defective
// items share zero (the structural systems mismatch and the APOD
// chrome placeholder); every legitimate item shares at least one,
// including short press summaries that share only a name.
const COHERENCE_GENERIC_TOKENS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "by", "from", "at", "as", "is", "are", "was", "were", "be", "been",
  "being", "it", "its", "this", "that", "these", "those", "we", "our",
  "they", "their", "he", "she", "his", "her", "not", "no", "than",
  "then", "so", "such", "can", "could", "may", "might", "will",
  "would", "should", "into", "over", "under", "between", "among",
  "during", "after", "before", "when", "while", "which", "who",
  "whom", "what", "how", "all", "any", "each", "other", "more",
  "most", "many", "much", "new", "one", "two", "three", "also",
  "using", "used", "use", "based", "study", "studies", "paper",
  "results", "show", "shows", "showed", "found", "find", "report",
  "reports", "nasa", "esa", "space", "mission", "missions", "launch",
  "launches",
]);
function coherenceTokens(text) {
  return new Set(
    String(text || "").toLowerCase().split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3)
  );
}
export function summaryCoheresWithTitle(title, summary) {
  // Too little text to judge: a short summary that repeats no title
  // word is a stub, not a mismatch. The conviction needs a summary
  // long enough to have had its chance to be about the title (the
  // live mismatch ran 141 characters of another subject's prose).
  if (String(summary || "").length < 100) return true;
  const titleTokens = new Set(
    [...coherenceTokens(title)].filter((t) => !COHERENCE_GENERIC_TOKENS.has(t))
  );
  if (titleTokens.size < 3) return true;
  const summaryTokens = coherenceTokens(summary);
  for (const t of titleTokens) if (summaryTokens.has(t)) return true;
  return false;
}

// ── Species italics: ensured, not just preserved ─────────────────
// The sentinel path above preserves the italics a SOURCE marked,
// but sources mark binomials inconsistently: Europe PMC ships them
// in <i> spans, a bioRxiv abstract prints the same name bare. The
// seventh panel's live edition carried *Helicobacter pylori*
// correctly marked in one summary and "Crassostrea virginica" bare
// in another, so the bare one rendered in roman while its
// neighbour italicized. buildTrendingItem therefore ENSURES the
// marking on summaries: a binomial shaped pair the source left bare
// is wrapped in the same markdown pair the sentinel path produces.
//
// The detector is deliberately conservative, in the family of the
// client query parse (CerebrumApp.jsx, parseQueryEntities): a
// capitalized genus of three or more letters, a lowercase epithet
// of four or more, and a common word skip on BOTH tokens. Shape
// alone is NOT enough, and the live edition proves it: ordinary
// prose is full of capitalized word plus lowercase word pairs
// ("Bayesian inference", "Our pipeline", "Tuesday aboard",
// "Coastal organisms"), and a shape only pass wrapped junk in 31
// of the edition's 40 summaries. The further gate is the epithet's
// FORM: a Latin epithet ends in a Latin termination (virginica,
// pylori, elegans, aureus, cerevisiae, thaliana), while the
// English words that fill the epithet slot in prose pairs
// (inference, approaches, second, whole, free, aboard) do not. A
// small blocklist names the English exceptions that do end in a
// Latin termination (helium, sigma, biomarker, criteria, media).
// Two further restraints: text already inside a *pair* is passed
// through byte for byte (a marked span is the source's own
// assertion, species or not — statistical pairs like *p* are never
// rewritten, and an already marked binomial is never double
// wrapped), and the abbreviated genus form ("C. elegans") requires
// the same epithet discipline. False negatives are acceptable (a
// missed name stays roman, as before); false positives are not (a
// wrapped prose pair would print italics the source never meant).
const SPECIES_GENUS_STOPWORDS = new Set(
  ("the,a,an,this,that,these,those,there,their,which,when,while,after,before,during,using,used,based," +
   "results,methods,method,background,conclusion,conclusions,introduction,patients,cells,treatment,data," +
   "analysis,however,although,because,through,between,among,within,without,across,under,over,into,from," +
   "with,have,been,were,will,would,should,could,first,second,third,total,overall,present,current,study," +
   "complete,significant,sustained,early,late,median,minor,major,effective,classical,conventional," +
   "traditional,synthetic,engineered,adequate,several,logistic,endoscopic,living,despite,beyond,rare," +
   "future,joint,neural,chemical,genomic,somatic,deep," +
   "group,groups,effect,effects,model,models,value,values,level,levels,point,points,range,for,all,any," +
   "each,per,via,new,our,its,his,her,who,how,why,not,but,and").split(",")
);
const SPECIES_EPITHET_STOPWORDS = new Set(
  ("the,a,an,and,or,of,to,in,on,for,with,from,that,this,were,was,are,has,have,had,been,being,show,shows," +
   "showed,show,found,using,used,uses,use,study,studies,result,results,effect,effects,group,groups,cell," +
   "cells,level,levels,value,values,range,ranges,model,models,water,pressure,temperature,point,points," +
   "growth,change,changes,control,treatment,patients,human,significantly,significant,increased,decreased," +
   "higher,lower,between,among,within,under,over,after,before,during,about,other,more,most,than,then," +
   // English words whose endings are Latin shaped: the form gate
   // alone would pass these, so they are named.
   "helium,hydrogen,oxygen,nitrogen,carbon,sigma,alpha,beta,gamma,delta,epsilon,theta,lambda,omega," +
   "biomarker,criteria,media,data,area,idea,agenda,lens,opens,hemostasis").split(",")
);
// Latin terminations of a species epithet: single letter genitives
// and nominatives (a, i), the common declensions (is, us, um, er,
// ae), and the compound suffixes (-ensis, -ica, -osus, -alis,
// -oides, -ella, -ium, -orum, -escens, -ans, -ens...). Tested with
// endsWith semantics via a $-anchored alternation.
const SPECIES_EPITHET_LATIN_RE = /(?:a|i|is|us|um|er|ae|ans|ens|ex|ix|ax|ox|ensis|ica|icus|icum|osa|osus|osum|alis|aris|elis|ilis|oides|ella|ellum|ium|iae|ii|ei|orum|arum|cola|escens)$/;
const BINOMIAL_PAIR_RE = /\b([A-Z][a-z]{2,})\s([a-z]{4,})\b|\b([A-Z])\.\s([a-z]{4,})\b/g;
export function ensureSpeciesItalics(summary) {
  const s = String(summary || "");
  if (!s) return s;
  // Segments alternate unmarked, marked, unmarked... on the "*"
  // boundaries the sentinel path left. Only unmarked segments are
  // candidates; marked segments are returned exactly as they came.
  const segments = s.split("*");
  if (segments.length % 2 === 0) return s; // an unpaired marker: leave the text to rebalance, never guess
  for (let i = 0; i < segments.length; i += 2) {
    segments[i] = segments[i].replace(BINOMIAL_PAIR_RE, (m, genus, epithet, abbrGenus, abbrEpithet) => {
      const g = (genus || abbrGenus || "");
      const e = (epithet || abbrEpithet || "");
      if (SPECIES_GENUS_STOPWORDS.has(g.toLowerCase())) return m;
      if (SPECIES_EPITHET_STOPWORDS.has(e.toLowerCase())) return m;
      if (!SPECIES_EPITHET_LATIN_RE.test(e)) return m;
      return "*" + m + "*";
    });
  }
  return segments.join("*");
}

export function buildTrendingItem(a, category) {
  // Decode entities/strip tags BEFORE anything else: a title that is
  // nothing but markup is not a title. Titles keep their italic spans
  // as markdown *pairs* — the client renders titles through the same
  // inline markdown path the answers use, so a marked species name
  // comes back italic instead of roman. Summaries carry the same
  // pairs now: the digest renders summaries through that same path
  // (renderInlineMdLite in CerebrumApp.jsx — hero, digest rows, and
  // the story modal), so a binomial in a summary renders italic too
  // instead of sitting in roman while the title's names italicize.
  const title = cleanTrendingText(a.title, { italics: "markdown" });
  // 3000 chars: the story modal promises the fullest summary the
  // source provided; the old 900 char cap cut abstracts mid sentence.
  // The finish pass below then makes sure what survives ends at a
  // sentence boundary, or admits with an ellipsis that it was cut.
  let summary = ensureSpeciesItalics(rebalanceTrendingItalics(finishTrendingSummary(cleanTrendingText(a.summary, { italics: "markdown" }).slice(0, 3000))));
  // An empty summary IS a missing summary, whatever the source
  // claimed: the Space chrome fallback now yields "" rather than a
  // placeholder sentence, and a record whose text cleaned away to
  // nothing must not ship summaryMissing false over a blank.
  let summaryMissing = !!a.summaryMissing || !summary;
  // A summary that shares no distinctive vocabulary with its title
  // is a different story's text (see summaryCoheresWithTitle): it is
  // dropped and marked missing, never shipped mismatched.
  if (summary && !summaryCoheresWithTitle(title, summary)) {
    summary = "";
    summaryMissing = true;
  }
  return {
    title,
    summary,
    summaryMissing,
    url: (a.url || "").trim(),
    image_url: a.image_url || "",
    source: a.source || category,
    publishedAt: a.publishedAt || null,
    indexedAt: a.indexedAt || null,
    doi: a.doi || null,
    // Publication type and discipline are separate facts. Type says
    // what the record IS (paper, preprint, press), discipline says
    // what it is ABOUT; the category bucket alone conflated them.
    type: a.type || null,
    discipline: a.discipline || null,
    category,
    // Carried through from the source parse only; never invented here.
    // A source that provides no count gets null (no data), NOT zero:
    // zero means the source reported zero citations, and ranking the
    // two against each other was meaningless.
    citedByCount: a.citedByCount === null || a.citedByCount === undefined || a.citedByCount === ""
      ? null
      : (Number.isFinite(Number(a.citedByCount)) ? Math.max(0, Math.floor(Number(a.citedByCount))) : null),
  };
}

// ── Sentence aware summary endings ─────────────────────────────────
// Upstream summaries regularly stop mid sentence: scraped page text
// runs out, and the 3000 char cap above can cut an abstract in half.
// A card that trails off mid clause reads as broken, so every summary
// is finished one of two honest ways: trimmed back to its last
// sentence boundary when that keeps at least half the text, or closed
// with an ellipsis that admits the cut. Text that already ends at a
// sentence boundary is returned untouched.
const SENTENCE_END_RE = /[.!?]["'”’)\]]*$/;
export function finishTrendingSummary(text) {
  const t = String(text || "").trim();
  if (!t) return t;
  if (SENTENCE_END_RE.test(t) || t.endsWith("…")) return t;
  const boundaryRe = /[.!?]+["'”’)\]]*\s+/g;
  let cut = -1;
  let m;
  while ((m = boundaryRe.exec(t)) !== null) cut = m.index + m[0].length;
  if (cut >= Math.floor(t.length / 2)) return t.slice(0, cut).trim();
  return t + "…";
}

// ── Edition window ─────────────────────────────────────────────────
// An edition presented as today's trending cannot hold items from a
// past quarter. Production evidence (live edition of 2026-10-13): a
// paper first published 2026-06-25, 110 days earlier, sat in the
// current edition because nothing ever checked. The window is 90
// days, stated here rather than buried in a comparison: scholarly
// print dates lag first online dates by weeks, so the window is a
// quarter rather than a news cycle, and it still removes the stale
// tail (the next oldest item in that edition was 61 days). An item
// whose date is missing or unparseable is kept: every source in this
// pipeline supplies a date, and an item that cannot be dated cannot
// be proven stale either. Dropping on suspicion would be its own
// kind of invention.
export const EDITION_WINDOW_DAYS = 90;
export function isWithinEditionWindow(item, now) {
  const raw = item && item.publishedAt;
  if (!raw) return true;
  const ts = new Date(raw).getTime();
  if (!Number.isFinite(ts)) return true;
  return now - ts <= EDITION_WINDOW_DAYS * 86400000;
}

// ── Citation completion ────────────────────────────────────────────
// Exactly one source (Europe PMC) reports citation counts, and its
// window is the newest journal papers, whose counts are a genuine
// zero: the citations do not exist yet. The counts that do exist for
// this feed live on the preprint side, where a work keeps the DOI it
// was first posted under months before its latest version date.
// OpenAlex indexes those works and reports a real cited_by_count, so
// one batch lookup per build completes the picture for every item
// whose own source reported nothing. Verified against the live
// edition of 2026-10-13: OpenAlex resolved 20 of the 20 resolvable
// DOIs and returned positive counts where Europe PMC's window
// structurally cannot (7 and 1 on two bioRxiv papers). An item no
// provider knows stays null: no data, never a guessed zero. A
// reported count from the item's own source is never overwritten.
//
// Two hard lessons are built into the shape of this leg:
//
// OBSERVABILITY. The first version swallowed its error in a bare
// catch, and the production edition of 2026-10-13 came back with
// zero of its twenty resolvable DOIs populated while every surface
// reported health: the code was proven sound locally three ways and
// the failure existed nowhere anyone could see it. The leg now
// returns a health entry that fetchTrendingFeed appends to
// sourceHealth: how many items it set out to complete, how many it
// resolved, how many came back positive, which providers ran, and
// the failure class of any leg that failed. A failed leg reads as a
// failed leg in the payload the client already receives.
//
// FALLBACK. When the OpenAlex batch fails outright, or answers but
// resolves nothing while attempts existed, the same DOI set is put
// to Crossref, the other index this pipeline already trusts from
// production (search.js reads its is-referenced-by-count the same
// way). Crossref has no batch DOI lookup in the shape this repo
// uses, so the fallback is a bounded per DOI pass: at most
// CROSSREF_ATTEMPT_CAP lookups, CROSSREF_CONCURRENCY at a time, each
// with its own short timeout. A partial OpenAlex success is a
// success and does not trigger the fallback; the works it resolved
// are never shopped to the second provider, and works neither
// provider knows stay null.
function openAlexLookupDoi(item) {
  const raw = item && item.doi ? String(item.doi).trim() : "";
  if (!raw) return null;
  if (raw.includes("/")) return raw;
  // The arXiv parse stores the bare identifier ("2610.13922v1").
  // OpenAlex knows the work under its arXiv DOI, without the version.
  const base = raw.replace(/v\d+$/i, "");
  if (/^\d{4}\.\d{4,5}$/.test(base)) return "10.48550/arXiv." + base;
  return null;
}

// Failure classes in plain words. The health entry is an API surface
// the client renders, so a class reads like a label, not a code:
// an HTTP status, a timeout, a network error, or a malformed reply.
function citationFailureClass(e) {
  if (e && e.name === "AbortError") return "timeout";
  const msg = String((e && e.message) || "");
  const http = /^HTTP (\d{3})\b/.exec(msg);
  if (http) return "HTTP " + http[1];
  if (e instanceof SyntaxError || /size limit/i.test(msg)) return "malformed reply";
  return "network error";
}

async function openAlexCitationLeg(wanted) {
  const leg = { provider: "OpenAlex", attempted: 0, resolved: 0, positive: 0, error: null };
  for (const w of wanted.values()) leg.attempted += w.items.length;
  if (!leg.attempted) return leg;
  try {
    const url = "https://api.openalex.org/works?filter=doi:" + [...wanted.values()].map((w) => w.doi).join("|") +
      "&select=doi,cited_by_count&per-page=100&mailto=contact@askcerebrum.org";
    const data = await getJSON(url, 8000);
    if (!data || !Array.isArray(data.results)) {
      // The provider answered but not in its documented shape: that
      // is a failed leg, not an empty one, and it is named as such.
      leg.error = "malformed reply";
      return leg;
    }
    for (const w of data.results) {
      const key = String(w.doi || "").replace(/^https?:\/\/doi\.org\//i, "").toLowerCase();
      const target = wanted.get(key);
      if (!target) continue;
      const n = Number(w.cited_by_count);
      if (!Number.isFinite(n) || n < 0) continue;
      for (const item of target.items) {
        item.citedByCount = Math.floor(n);
        leg.resolved++;
        if (n > 0) leg.positive++;
      }
    }
  } catch (e) {
    leg.error = citationFailureClass(e);
  }
  return leg;
}

const CROSSREF_ATTEMPT_CAP = 24;
const CROSSREF_CONCURRENCY = 6;

async function crossrefCitationLeg(wanted) {
  const leg = { provider: "Crossref", attempted: 0, resolved: 0, positive: 0, error: null };
  const queue = [...wanted.values()].slice(0, CROSSREF_ATTEMPT_CAP);
  let answered = 0;
  let firstFailure = null;
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const entry = queue[cursor++];
      leg.attempted += entry.items.length;
      try {
        const url = "https://api.crossref.org/works/" + encodeURIComponent(entry.doi) +
          "?mailto=contact@askcerebrum.org";
        const data = await getJSON(url, 4000);
        const msg = data && data.message;
        if (!msg || typeof msg !== "object") {
          if (!firstFailure) firstFailure = "malformed reply";
          continue;
        }
        answered++;
        const n = msg["is-referenced-by-count"];
        if (typeof n === "number" && Number.isFinite(n) && n >= 0) {
          for (const item of entry.items) {
            item.citedByCount = Math.floor(n);
            leg.resolved++;
            if (n > 0) leg.positive++;
          }
        }
      } catch (e) {
        const cls = citationFailureClass(e);
        // A 404 is the provider answering "not a work I know": the
        // work stays null, and the leg itself did its job.
        if (cls === "HTTP 404") { answered++; continue; }
        if (!firstFailure) firstFailure = cls;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CROSSREF_CONCURRENCY, queue.length) }, () => worker()));
  // The leg failed only if it attempted lookups and not one of them
  // produced a definitive answer; its class is the first failure met.
  if (queue.length && !answered && firstFailure) leg.error = firstFailure;
  return leg;
}

// Completes counts in place and returns the leg's health entry. The
// entry's `count` follows the sourceHealth convention: how many
// items in the finished edition this entry accounts for, here the
// items whose displayed count the completion leg supplied.
async function enrichCitationCounts(items) {
  const wanted = new Map();
  for (const item of items || []) {
    if (item.citedByCount !== null && item.citedByCount !== undefined) continue;
    const doi = openAlexLookupDoi(item);
    if (!doi) continue;
    // Keyed lowercase for matching provider replies, but requests
    // carry the DOI in its canonical form.
    const key = doi.toLowerCase();
    if (!wanted.has(key)) wanted.set(key, { doi, items: [] });
    wanted.get(key).items.push(item);
  }
  const health = {
    source: "Citation counts",
    ok: true,
    count: 0,
    attempted: 0,
    resolved: 0,
    positive: 0,
    error: null,
    legs: [],
  };
  for (const w of wanted.values()) health.attempted += w.items.length;
  if (!wanted.size) return health;

  const openAlex = await openAlexCitationLeg(wanted);
  health.legs.push(openAlex);

  if (openAlex.error || openAlex.resolved === 0) {
    const remaining = new Map();
    for (const [key, w] of wanted) {
      const open = w.items.filter((it) => it.citedByCount === null || it.citedByCount === undefined);
      if (open.length) remaining.set(key, { doi: w.doi, items: open });
    }
    if (remaining.size) health.legs.push(await crossrefCitationLeg(remaining));
  }

  for (const leg of health.legs) {
    health.resolved += leg.resolved;
    health.positive += leg.positive;
  }
  health.count = health.resolved;
  const failed = health.legs.filter((l) => l.error);
  if (failed.length) health.error = failed.map((l) => l.provider + ": " + l.error).join("; ");
  // ok means the completion actually completed. It reads true only
  // when every attempted item resolved, or when no leg errored at all
  // (a provider that answered cleanly but does not know some works
  // has given a complete answer, not a failure). A leg error WITH
  // items still unresolved is a partial completion and reads ok
  // false, with the counts and the error carried, so the UI can say
  // how much of the picture is missing instead of hiding it. The old
  // rule (healthy when any one leg answered) shipped ok true on the
  // live edition of 2026-10-14 with OpenAlex rate limited at HTTP
  // 429 and only 10 of 20 counts resolved, and the banner gated on
  // not ok never showed.
  const anyLegError = health.legs.some((l) => l.error);
  health.ok = health.resolved >= health.attempted || !anyLegError;
  return health;
}

// ── Trend signal: persistence across the edition archive ───────────
// Citations alone cannot say what is trending in a feed of days old
// papers; there has not been time for them to accrue. What the
// pipeline itself observes, and no outside source can sell it, is
// staying power: the edition archive (D1, newest fourteen days) shows
// which works keep appearing day after day while the sources churn
// around them. Each item leaves the build carrying
//   trend: { daysPresent, firstSeenEdition }
// where daysPresent counts the distinct edition days, this build
// included, in which the same work appears, matched on DOI, then
// normalized URL, then normalized title. On the archive's first day
// every item honestly reads 1. compareByTrend is the edition's
// trend ordering: most days present first, then most cited (a
// missing count ranks below any reported one), then newest.
export function trendingItemKey(item) {
  if (!item) return null;
  if (item.doi) return "doi:" + String(item.doi).trim().toLowerCase();
  if (item.url) return "url:" + normalizeUrl(String(item.url));
  if (item.title) return "title:" + normalizeTitle(String(item.title));
  return null;
}

export function attachTrendHistory(items, priorEditions, currentEditionId) {
  const seenIn = new Map();
  for (const ed of priorEditions || []) {
    if (!ed || !ed.id || ed.id === currentEditionId) continue;
    for (const it of ed.items || []) {
      const k = trendingItemKey(it);
      if (!k) continue;
      if (!seenIn.has(k)) seenIn.set(k, new Set());
      seenIn.get(k).add(ed.id);
    }
  }
  return (items || []).map((item) => {
    const k = trendingItemKey(item);
    const days = k && seenIn.has(k) ? [...seenIn.get(k)] : [];
    return {
      ...item,
      trend: {
        daysPresent: days.length + 1,
        firstSeenEdition: days.length ? days.sort()[0] : currentEditionId,
      },
    };
  });
}

export function compareByTrend(a, b) {
  const da = a && a.trend && Number.isFinite(a.trend.daysPresent) ? a.trend.daysPresent : 0;
  const db = b && b.trend && Number.isFinite(b.trend.daysPresent) ? b.trend.daysPresent : 0;
  if (db !== da) return db - da;
  const ca = a && typeof a.citedByCount === "number" ? a.citedByCount : -1;
  const cb = b && typeof b.citedByCount === "number" ? b.citedByCount : -1;
  if (cb !== ca) return cb - ca;
  return new Date((b && b.publishedAt) || 0).getTime() - new Date((a && a.publishedAt) || 0).getTime();
}

export async function fetchTrendingFeed() {
  const now = Date.now();
  const perSource = await Promise.all(SOURCES.map(async (src) => {
    try {
      // Source URLs may be thunks (see the bioRxiv entry) so date windows
      // are computed at refresh time, not at module load.
      const url = typeof src.url === "function" ? src.url() : src.url;
      if (src.xml) {
        const text = await getText(url);
        return text ? { category: src.category, items: src.parse(text) } : null;
      }
      const data = await getJSON(url);
      return data ? { category: src.category, items: src.parse(data) } : null;
    } catch { return null; }
  }));

  // Per source health rides along in the payload. A source failing
  // silently used to look like an editorial decision to drop its whole
  // section; now the reader can be told the section is missing because
  // its source did not answer. The count is filled in after the edition
  // is built, below: it must describe the edition the reader sees, not
  // the raw upstream return, which includes records that validation
  // and dedup will drop.
  const sourceHealth = SOURCES.map((src, i) => ({
    source: src.category,
    ok: !!(perSource[i] && (perSource[i].items || []).length),
    count: 0,
  }));

  const seenUrls = new Set();
  const seenDois = new Set();
  const titleOwner = new Map();
  const buckets = [];
  for (const group of perSource) {
    if (!group) continue;
    const clean = [];
    for (const a of group.items || []) {
      const item = buildTrendingItem(a, group.category);
      // A summary is genuinely optional for a paper (many records have no
      // abstract); a title and a link are not — without those there's
      // nothing to show and nowhere to send anyone.
      if (!item.title || !item.url) continue;
      // Edition window: an item provably older than the window never
      // enters the edition, and never claims a dedup slot either, so a
      // fresher copy of the same work can still take its place.
      if (!isWithinEditionWindow(item, now)) continue;
      const urlKey = normalizeUrl(item.url);
      const doiKey = item.doi ? String(item.doi).toLowerCase() : null;
      const titleKey = normalizeTitle(item.title);
      if (seenUrls.has(urlKey)) continue;
      if (doiKey && seenDois.has(doiKey)) continue;
      // Same title alone no longer suppresses a record: two different
      // papers can share a generic title. A title match only dedupes
      // when neither record carries a DOI to tell them apart, or when
      // the DOIs agree (already handled above).
      if (titleOwner.has(titleKey)) {
        const ownerDoi = titleOwner.get(titleKey);
        if (!ownerDoi && !doiKey) continue;
        if (ownerDoi && !doiKey) continue;
      }
      seenUrls.add(urlKey);
      if (doiKey) seenDois.add(doiKey);
      if (!titleOwner.has(titleKey)) titleOwner.set(titleKey, doiKey);
      clean.push(item);
    }
    if (clean.length) buckets.push(clean);
  }

  // Round-robin across disciplines so the top of the feed is always mixed.
  // Interleaving rather than sorting is the whole fix: the first six items
  // someone sees now span biology, preprints, physics and space instead of
  // being whatever one prolific source published most recently.
  const items = [];
  for (let i = 0; items.length < 40 && buckets.some((b) => i < b.length); i++) {
    for (const b of buckets) if (i < b.length) items.push(b[i]);
  }
  // Complete the citation picture for items whose own source reported
  // nothing, before health counts are taken: the counts below describe
  // this finished edition, and so do the counts on its items. The
  // completion leg reports itself as a health entry of its own,
  // appended after the per source entries: it is not a section of the
  // edition, and its ok flag means the completion finished whole
  // (see enrichCitationCounts), not that a section is present.
  const citationHealth = await enrichCitationCounts(items);
  for (const h of sourceHealth) {
    h.count = items.filter((it) => it.category === h.source).length;
  }
  sourceHealth.push(citationHealth);
  return { items, sourceHealth };
}

export async function fetchTrendingItems() {
  const { items } = await fetchTrendingFeed();
  return items;
}
