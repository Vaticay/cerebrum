/* Trending helpers, extracted from CerebrumApp.jsx so the test suite
   can execute them directly. Clustering ran unproven for two live
   editions while it lived unexported inside the app file: no suite
   could run it, and it grouped zero stories. These functions are
   pure; the app imports them from here. */
export function trendingDoiOf(item) {
  if (!item) return null;
  if (item.doi) return String(item.doi);
  const m = String(item.url || "").match(/doi\.org\/(.+)$/i);
  return m ? decodeURIComponent(m[1]) : null;
}
/* ════════════════════════════════════════════════════════════════════
   VERIFIED MEDIA CONTRACT (2026-09-17)
   /api/trending items and /api/document analysis responses carry
     media: { image: {...}|null, video: {...}|null, resolvedAt }
   Each slot is { url, credit, creditUrl, license, source, verified }.
   - image XOR video is ever set (image preferred); a video slot carries
     a poster and is a verified NASA/Commons clip, shown with controls,
     never autoplayed.
   - { image: null, video: null } = the resolver ran and found nothing
     honest. For document analyses that is the end of it: render
     nothing, never a broken frame.
   - Trending items additionally fall back to their own image_url:
     enrichment attaches an all null media object to every item, so
     an empty object proves nothing, and the old rule suppressed the
     Space section's own photographs in production (corrected
     2026-10-13). The fallback renders marked unverified, and the
     figure still removes itself if the load fails.
   - image_url is kept for back-compat on trending payloads that predate
     the media object; precedence: media.image.url → image_url.
   These resolvers are pure so tests can pin the contract. Anything that
   fails verification (unverified flag, unsafe URL) is not media — it is
   nothing, and the caller renders nothing.
   ════════════════════════════════════════════════════════════════════ */
const MEDIA_URL_RE = /^https:\/\/[^"'\s<>]+$/i;
export function cleanMediaUrl(u) {
  const s = String(u || "").trim();
  return MEDIA_URL_RE.test(s) ? s : null;
}
export function cleanMediaText(t, max) {
  const s = String(t || "").trim();
  return s ? s.slice(0, max) : null;
}
/* The verified slot of a media object, normalized, or null. */
export function verifiedMediaOf(media) {
  if (!media || typeof media !== "object") return null;
  const pick = (slot, kind) => {
    if (!slot || typeof slot !== "object" || slot.verified !== true) return null;
    const url = cleanMediaUrl(slot.url);
    if (!url) return null;
    return {
      kind,
      url,
      poster: kind === "video" ? cleanMediaUrl(slot.poster) : null,
      credit: cleanMediaText(slot.credit, 160),
      creditUrl: cleanMediaUrl(slot.creditUrl),
      license: cleanMediaText(slot.license, 60),
      source: cleanMediaText(slot.source, 40),
      verified: true,
    };
  };
  return pick(media.image, "image") || pick(media.video, "video") || null;
}
/* A trending item → renderable media or null. */
export function trendingMediaOf(item) {
  if (!item || typeof item !== "object") return null;
  const v = verifiedMediaOf(item.media);
  if (v) return v;
  /* The media object rides on every item, including all null ones the
     resolver filled in when it found nothing, so its presence proves
     nothing. When no verified slot exists, the article record's own
     image is the honest fallback: it renders marked unverified, and
     MediaFigure still removes the figure if the load fails. */
  const url = cleanMediaUrl(item.image_url);
  if (!url) return null;
  return { kind: "image", url, poster: null, credit: null, creditUrl: null, license: null, source: null, verified: false };
}

export function normalizeTrendingUrl(url) {
  return String(url || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "")
    .replace(/[?#].*$/, "").replace(/\/+$/, "");
}
export function normalizeTrendingTitle(title) {
  return String(title || "").trim().toLowerCase().replace(/\s+/g, " ");
}
export function dedupeTrendingItems(items) {
  const seenUrls = new Set();
  const seenDois = new Set();
  const titleOwner = new Map();
  const out = [];
  for (const item of items) {
    const urlKey = normalizeTrendingUrl(item.url);
    const doiKey = trendingDoiOf(item);
    const titleKey = normalizeTrendingTitle(item.title);
    if (urlKey && seenUrls.has(urlKey)) continue;
    if (doiKey && seenDois.has(doiKey)) continue;
    // Same title, different DOI: two different records that happen to
    // share a generic title. Only a title match with no DOI on either
    // side still counts as the same record here; story level grouping
    // below handles same event coverage.
    if (titleKey && titleOwner.has(titleKey)) {
      const ownerDoi = titleOwner.get(titleKey);
      if (!ownerDoi && !doiKey) continue;
      if (ownerDoi && !doiKey) continue;
    }
    if (urlKey) seenUrls.add(urlKey);
    if (doiKey) seenDois.add(doiKey);
    if (titleKey && !titleOwner.has(titleKey)) titleOwner.set(titleKey, doiKey);
    out.push(item);
  }
  return out;
}

/* Story clustering: several outlets reporting the same event are one
   story with several reports, not several stories. Two items join a
   cluster when they share a DOI, or when their titles share most of
   their meaningful words. The primary is the report with verified
   media, then the fullest summary; the rest ride along as coverage. */
export const TREND_STOPWORDS = new Set(["the", "a", "an", "of", "for", "and", "in", "on", "to", "with", "from", "by", "at", "as", "is", "are", "new", "study", "shows", "show", "finds", "found", "using", "first", "reveals", "after", "over", "into", "than", "more"]);
export function trendTitleTokens(title) {
  return new Set(String(title || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => (w.length >= 3 || /\d/.test(w)) && !TREND_STOPWORDS.has(w)));
}
export function clusterTrendingItems(items) {
  const n = items.length;
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const tokenSets = items.map((x) => trendTitleTokens(x.title));
  const dois = items.map((x) => trendingDoiOf(x));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (dois[i] && dois[j] && dois[i].toLowerCase() === dois[j].toLowerCase()) { join(i, j); continue; }
      const a = tokenSets[i];
      const b = tokenSets[j];
      if (a.size < 4 || b.size < 4) continue;
      let shared = 0;
      for (const w of a) if (b.has(w)) shared++;
      const jaccard = shared / (a.size + b.size - shared);
      const containment = shared / Math.min(a.size, b.size);
      if (shared >= 4 && (jaccard >= 0.6 || containment >= 0.78)) join(i, j);
    }
  }
  const groups = new Map();
  items.forEach((x, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x); });
  const ordered = [...groups.values()]
    .map((group) => ({ group, first: Math.min(...group.map((x) => items.indexOf(x))) }))
    .sort((a, b) => a.first - b.first);
  const out = [];
  for (const { group } of ordered) {
    if (group.length === 1) { out.push(group[0]); continue; }
    const primary = [...group].sort((a, b) =>
      ((trendingMediaOf(b) ? 1 : 0) - (trendingMediaOf(a) ? 1 : 0)) ||
      (String(b.summary || "").length - String(a.summary || "").length) ||
      (items.indexOf(a) - items.indexOf(b))
    )[0];
    out.push({ ...primary, coverage: group, coverageCount: group.length });
  }
  return out;
}
export function trendStoryKey(item) {
  return trendingDoiOf(item) || normalizeTrendingUrl(item && item.url) || normalizeTrendingTitle(item && item.title);
}
