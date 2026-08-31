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
    return res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

export async function fetchTrendingItems() {
  const data = await getJSON(SOURCE_URL);
  const raw = Array.isArray(data && data.results) ? data.results : [];

  // Spaceflight News occasionally carries the same story from a
  // syndication partner under two different article IDs — same title,
  // same underlying URL. Dedupe on the URL so the feed never shows one
  // story twice.
  const seen = new Set();
  const items = [];
  for (const a of raw) {
    const title = (a.title || "").trim();
    const summary = (a.summary || "").trim();
    const url = typeof a.url === "string" ? a.url.trim() : "";
    if (!title || !summary || !url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      title,
      summary,
      url,
      image_url: typeof a.image_url === "string" ? a.image_url : "",
      source: (a.news_site || "").trim(),
      publishedAt: a.published_at || null,
    });
  }
  return items;
}
