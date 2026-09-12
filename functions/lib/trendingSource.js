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
const SOURCES = [
  {
    category: "Biology & Medicine",
    // Plain query + date sort rather than a date-range filter: Europe PMC's
    // range syntax is easy to get subtly wrong and a malformed query returns
    // zero results rather than an error, which would look identical to "the
    // source is down". Sorting by publication date descending gets the same
    // recency with nothing that can silently mis-parse.
    url: "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=OPEN_ACCESS%3Ay%20AND%20HAS_ABSTRACT%3Ay&format=json&pageSize=12&sort=P_PDATE_D%20desc",
    parse: (d) => ((d && d.resultList && d.resultList.result) || []).map((r) => ({
      title: (r.title || "").replace(/\.$/, ""),
      summary: r.abstractText || `${r.journalTitle || "Journal"} · ${r.authorString || "Authors unlisted"}`,
      url: r.doi ? `https://doi.org/${r.doi}` : (r.fullTextUrlList && r.fullTextUrlList.fullTextUrl && r.fullTextUrlList.fullTextUrl[0] && r.fullTextUrlList.fullTextUrl[0].url) || "",
      source: r.journalTitle || "Europe PMC",
      publishedAt: r.firstPublicationDate || null,
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
    parse: (d) => ((d && d.collection) || []).slice(0, 12).map((r) => ({
      title: (r.title || "").trim(),
      summary: (r.abstract || `${r.category || "Preprint"} · ${r.authors || ""}`).trim(),
      url: r.doi ? `https://doi.org/${r.doi}` : "",
      source: `bioRxiv${r.category ? " · " + r.category : ""}`,
      publishedAt: r.date || null,
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
        return {
          title: pick("title"),
          summary: pick("summary"),
          url: linkMatch ? linkMatch[1].trim() : "",
          source: "arXiv",
          publishedAt: pick("published") || null,
        };
      });
    },
  },
  {
    category: "Space",
    url: SOURCE_URL,
    parse: (d) => (Array.isArray(d && d.results) ? d.results : []).map((a) => ({
      title: (a.title || "").trim(),
      summary: (a.summary || "").trim(),
      url: typeof a.url === "string" ? a.url.trim() : "",
      image_url: typeof a.image_url === "string" ? a.image_url : "",
      source: (a.news_site || "Spaceflight News").trim(),
      publishedAt: a.published_at || null,
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

export async function fetchTrendingItems() {
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

  const seenUrls = new Set();
  const seenTitles = new Set();
  const buckets = [];
  for (const group of perSource) {
    if (!group) continue;
    const clean = [];
    for (const a of group.items || []) {
      const title = (a.title || "").trim();
      const url = (a.url || "").trim();
      // A summary is genuinely optional for a paper (many records have no
      // abstract); a title and a link are not — without those there's
      // nothing to show and nowhere to send anyone.
      if (!title || !url) continue;
      const urlKey = normalizeUrl(url);
      const titleKey = normalizeTitle(title);
      if (seenUrls.has(urlKey) || seenTitles.has(titleKey)) continue;
      seenUrls.add(urlKey);
      seenTitles.add(titleKey);
      clean.push({
        title,
        summary: (a.summary || "").trim().slice(0, 900),
        url,
        image_url: a.image_url || "",
        source: a.source || group.category,
        publishedAt: a.publishedAt || null,
        category: group.category,
      });
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
  return items;
}
