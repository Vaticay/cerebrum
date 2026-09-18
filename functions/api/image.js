// Cerebrum illustration resolver — Cloudflare Pages Function.
//
// The problem this exists to solve: the app looked machine-made partly
// because it had almost no photography. Trending carried images only when
// its upstream happened to supply one (in practice, NASA), and every other
// surface — the daily science card, a paper without a thumbnail — fell back
// to a generated initials-on-a-colour-field cover. A screen of those reads
// as a template.
//
// So: given a subject, find a real, properly-licensed picture of it.
//
// SOURCE ORDER, and why it is this order:
//
//   1. Operator's own library. If CUSTOM_IMAGE_BASE is set, a curated file
//      wins over everything. This is the hook for licensed stock (Motion
//      Array, Envato, a commissioned set) — drop the files somewhere they
//      are served from and point this at them. Nothing else in this file
//      can be licensed that way, so the operator's own assets go first.
//   2. Europe PMC open-access figures. A figure from the actual paper beats
//      any stock photograph of a laboratory, and it is the most honest
//      illustration a literature tool can show. Only ever from the OA
//      subset, which is licensed for reuse.
//   3. NASA image library. Public domain, excellent, and already the source
//      of the imagery the app does have.
//   4. Wikimedia Commons. Enormous scientific coverage, free licences,
//      requires attribution — which is returned and displayed.
//   5. Openverse. Aggregates CC-licensed work across many providers.
//   6. Unsplash, then Pexels. The most "premium"-looking option, but both
//      need a free API key, so they only run if the operator has set one.
//
// Every result carries its credit and licence back to the client, and the
// UI shows them. An image whose licence we cannot state is not returned —
// a pretty picture is not worth an attribution violation.

import { checkRateLimit } from "../lib/rateLimit.js";
import { fetchWithTimeout, neverFail, safeErr, jsonOk, jsonError, clampText, isSafeHttpsUrl } from "../lib/resilience.js";

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60000;
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — subjects don't change
// A MISS is not a subject that doesn't change — it's a subject whose
// providers were down, rate-limited, or parser-broken at resolve time. The
// old code cached {"image":null} for the same 14 days as a verified hit,
// so a subject that missed once kept serving null for two weeks AFTER its
// providers recovered. Misses get hours, not weeks: cheap enough to avoid
// a fetch storm on genuinely imageless subjects, short enough that a fixed
// provider heals on its own.
const MISS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FETCH_TIMEOUT_MS = 4000;
const MAX_QUERY_LEN = 160;

import { corsHeaders, readOriginAllowed, forbiddenOrigin, clientIp, privacyKey } from "../lib/http.js";

async function getJSON(url, headers) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: "application/json", "User-Agent": "Cerebrum/1.0 (+https://askcerebrum.org)", ...(headers || {}) },
    }, FETCH_TIMEOUT_MS);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch { return null; }
}
async function getText(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "Cerebrum/1.0 (+https://askcerebrum.org)" },
    }, FETCH_TIMEOUT_MS);
    if (!res || !res.ok) return null;
    return await res.text();
  } catch { return null; }
}

// Strip question scaffolding and stopwords down to the few words that
// actually name a subject. An image search for the literal sentence "How
// does the gut microbiome influence brain function?" returns nothing
// anywhere; "gut microbiome brain" returns the right picture everywhere.
const IMG_STOP = new Set([
  "the","a","an","and","or","but","of","in","on","at","to","for","with","from",
  "by","as","is","are","was","were","be","do","does","did","how","what","why",
  "when","where","which","who","this","that","these","those","it","its","new",
  "study","research","paper","science","explain","behind","using","via","based",
]);
export function imageTerms(raw, max = 4) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !IMG_STOP.has(w))
    .slice(0, max)
    .join(" ");
}

// ── 1. Operator's own curated / licensed library ────────────────────────
// CUSTOM_IMAGE_BASE=https://askcerebrum.org/covers means a query about
// neuroscience will try https://askcerebrum.org/covers/neuroscience.jpg
// first. A HEAD request keeps a miss cheap.
async function fromCustom(env, category) {
  const base = (env.CUSTOM_IMAGE_BASE || "").replace(/\/+$/, "");
  if (!base || !category) return null;
  const slug = String(category).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return null;
  for (const ext of ["jpg", "webp", "png"]) {
    const url = `${base}/${slug}.${ext}`;
    // A HEAD request keeps a miss cheap; explicit timeout so a hanging
    // origin can't stall the whole fan-out.
    const res = await neverFail(
      fetchWithTimeout(url, { method: "HEAD" }, 2500),
      null,
      "custom-cover"
    );
    if (res && res.ok) return { url, credit: "", creditUrl: "", license: "Licensed", source: "curated" };
  }
  return null;
}

// ── 2. Europe PMC open-access figures ───────────────────────────────────
// Restricted to OPEN_ACCESS:y so every figure returned is licensed for
// reuse. The full-text XML carries <graphic xlink:href="..."> names, and
// Europe PMC serves those under /articles/<PMCID>/bin/<name>.jpg.
export function parseEpmcFigure(xml, pmcid) {
  if (!xml) return null;
  const m = xml.match(/<graphic[^>]*xlink:href="([^"]+)"/i) || xml.match(/<graphic[^>]*href="([^"]+)"/i);
  if (!m) return null;
  const name = m[1].replace(/\.(jpg|jpeg|png|gif|tif|tiff)$/i, "");
  if (!/^[\w.-]{1,80}$/.test(name)) return null;
  return `https://europepmc.org/articles/${pmcid}/bin/${name}.jpg`;
}
async function fromEuropePMC(query) {
  const terms = imageTerms(query, 4);
  if (!terms) return null;
  const q = `(${terms.split(" ").map((t) => `"${t}"`).join(" AND ")}) AND (OPEN_ACCESS:y) AND (HAS_FT:y)`;
  const data = await getJSON(
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
    new URLSearchParams({ query: q, format: "json", pageSize: "2", resultType: "lite", sort: "CITED desc" })
  );
  const rows = (data && data.resultList && data.resultList.result) || [];
  for (const r of rows) {
    if (!r.pmcid) continue;
    const xml = await getText(`https://www.ebi.ac.uk/europepmc/webservices/rest/${r.pmcid}/fullTextXML`);
    const url = parseEpmcFigure(xml, r.pmcid);
    if (url) {
      return {
        url,
        credit: `Figure from “${(r.title || "").replace(/<[^>]*>/g, "").slice(0, 90)}”`,
        creditUrl: r.doi ? "https://doi.org/" + r.doi : `https://europepmc.org/article/PMC/${r.pmcid}`,
        license: "Open access",
        source: "europepmc",
      };
    }
  }
  return null;
}

// ── 3. NASA image library (public domain) ───────────────────────────────
export function parseNasa(data) {
  const items = (data && data.collection && data.collection.items) || [];
  for (const it of items) {
    const link = (it.links || []).find((l) => l && l.href && hasStillExtension(l.href));
    const meta = (it.data || [])[0] || {};
    if (link) {
      return {
        url: link.href.replace(/^http:/, "https:"),
        credit: meta.center ? `NASA/${meta.center}` : "NASA",
        creditUrl: "https://images.nasa.gov/",
        license: "Public domain",
        source: "nasa",
      };
    }
  }
  return null;
}
async function fromNasa(query) {
  const terms = imageTerms(query, 3);
  if (!terms) return null;
  return parseNasa(await getJSON(
    "https://images-api.nasa.gov/search?" + new URLSearchParams({ q: terms, media_type: "image" })
  ));
}

// ── 4. Wikimedia Commons ────────────────────────────────────────────────
export function parseCommons(data) {
  const pages = (data && data.query && data.query.pages) || {};
  for (const k of Object.keys(pages)) {
    const p = pages[k];
    const info = (p.imageinfo || [])[0];
    if (!info || !info.url) continue;
    if (!hasStillExtension(info.url)) continue;
    const ext = (info.extmetadata || {});
    const licence = (ext.LicenseShortName && ext.LicenseShortName.value) || "";
    // No stated licence, no image. A picture is not worth an attribution
    // violation, and "probably fine" is not a licence.
    if (!licence) continue;
    const artist = ((ext.Artist && ext.Artist.value) || "").replace(/<[^>]*>/g, "").trim();
    return {
      url: info.url,
      credit: artist ? `${artist.slice(0, 70)} / Wikimedia Commons` : "Wikimedia Commons",
      creditUrl: info.descriptionurl || "https://commons.wikimedia.org/",
      license: licence.slice(0, 40),
      source: "commons",
    };
  }
  return null;
}
async function fromCommons(query) {
  const terms = imageTerms(query, 4);
  if (!terms) return null;
  return parseCommons(await getJSON(
    "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
      action: "query", format: "json", generator: "search",
      gsrsearch: `filetype:bitmap ${terms}`, gsrnamespace: "6", gsrlimit: "6",
      prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "1200",
    })
  ));
}

// ── 5. Openverse ────────────────────────────────────────────────────────
export function parseOpenverse(data) {
  const results = (data && data.results) || [];
  for (const r of results) {
    if (!r || !r.url) continue;
    if (!r.license) continue;
    return {
      url: r.url,
      credit: r.creator ? `${String(r.creator).slice(0, 70)}${r.source ? " / " + r.source : ""}` : (r.source || "Openverse"),
      creditUrl: r.foreign_landing_url || "https://openverse.org/",
      license: String(r.license).toUpperCase() + (r.license_version ? " " + r.license_version : ""),
      source: "openverse",
    };
  }
  return null;
}
async function fromOpenverse(query) {
  const terms = imageTerms(query, 4);
  if (!terms) return null;
  return parseOpenverse(await getJSON(
    "https://api.openverse.org/v1/images/?" + new URLSearchParams({
      q: terms, license_type: "commercial,modification", page_size: "6", mature: "false",
    })
  ));
}

// ── 6. Unsplash / Pexels (only with an operator-supplied key) ───────────
export function parseUnsplash(data) {
  const r = ((data && data.results) || [])[0];
  if (!r || !r.urls || !r.urls.regular) return null;
  return {
    url: r.urls.regular,
    credit: r.user && r.user.name ? `${r.user.name} / Unsplash` : "Unsplash",
    creditUrl: (r.links && r.links.html) || "https://unsplash.com/",
    license: "Unsplash License",
    source: "unsplash",
  };
}
async function fromUnsplash(env, query) {
  if (!env.UNSPLASH_KEY) return null;
  const terms = imageTerms(query, 3);
  if (!terms) return null;
  return parseUnsplash(await getJSON(
    "https://api.unsplash.com/search/photos?" + new URLSearchParams({ query: terms, per_page: "3", orientation: "landscape" }),
    { Authorization: "Client-ID " + env.UNSPLASH_KEY }
  ));
}
export function parsePexels(data) {
  const r = ((data && data.photos) || [])[0];
  if (!r || !r.src || !r.src.large) return null;
  return {
    url: r.src.large,
    credit: r.photographer ? `${r.photographer} / Pexels` : "Pexels",
    creditUrl: r.url || "https://www.pexels.com/",
    license: "Pexels License",
    source: "pexels",
  };
}
async function fromPexels(env, query) {
  if (!env.PEXELS_KEY) return null;
  const terms = imageTerms(query, 3);
  if (!terms) return null;
  return parsePexels(await getJSON(
    "https://api.pexels.com/v1/search?" + new URLSearchParams({ query: terms, per_page: "3", orientation: "landscape" }),
    { Authorization: env.PEXELS_KEY }
  ));
}

/* ── Video, as the last resort before a generated cover ──────────────────
   Commit 73. The brief: every news card carries a real image OR a video
   playing on the card. Stills are still preferred — one autoplaying clip
   on a card is striking, a grid of eight is a space heater — so video only
   runs when every still source above came back empty.

   Two keyless, properly-licensed sources:
     • NASA's video library (public domain). Its search returns a
       collection manifest per item; the manifest lists the actual asset
       files, from which we take the smallest real mp4 — a card does not
       need the 4K master.
     • Wikimedia Commons video, restricted to .webm. Commons also holds
       .ogv, which only Firefox plays; shipping a file most browsers show
       as a black rectangle is worse than shipping no video at all. */
export function pickNasaVideoAsset(list) {
  if (!Array.isArray(list)) return null;
  const mp4s = list.filter((u) => typeof u === "string" && hasMp4Extension(u));
  if (!mp4s.length) return null;
  // Filename hints are the only size signal the manifest gives us.
  const rank = (u) => (/~mobile\.mp4$/i.test(u) ? 0 : /~small\.mp4$/i.test(u) ? 1 : /~preview\.mp4$/i.test(u) ? 2 : /~orig\.mp4$/i.test(u) ? 4 : 3);
  mp4s.sort((a2, b2) => rank(a2) - rank(b2));
  return mp4s[0].replace(/^http:/, "https:");
}
async function fromNasaVideo(query) {
  const terms = imageTerms(query, 3);
  if (!terms) return null;
  const data = await getJSON(
    "https://images-api.nasa.gov/search?" + new URLSearchParams({ q: terms, media_type: "video" })
  );
  const items = (data && data.collection && data.collection.items) || [];
  for (const it of items.slice(0, 3)) {
    if (!it.href) continue;
    const manifest = await getJSON(String(it.href).replace(/^http:/, "https:"));
    const asset = pickNasaVideoAsset(manifest);
    if (asset) {
      const meta = (it.data || [])[0] || {};
      const poster = (it.links || []).find((l) => l && l.href && hasStillExtension(l.href));
      return {
        url: asset,
        type: "video",
        poster: poster ? poster.href.replace(/^http:/, "https:") : "",
        credit: meta.center ? `NASA/${meta.center}` : "NASA",
        creditUrl: "https://images.nasa.gov/",
        license: "Public domain",
        source: "nasa-video",
      };
    }
  }
  return null;
}
export function parseCommonsVideo(data) {
  const pages = (data && data.query && data.query.pages) || {};
  for (const k of Object.keys(pages)) {
    const p = pages[k];
    const info = (p.imageinfo || [])[0];
    if (!info || !info.url) continue;
    // webm only — see the note above about .ogv.
    if (!hasVideoExtension(info.url)) continue;
    const ext = info.extmetadata || {};
    const licence = (ext.LicenseShortName && ext.LicenseShortName.value) || "";
    if (!licence) continue;
    const artist = ((ext.Artist && ext.Artist.value) || "").replace(/<[^>]*>/g, "").trim();
    return {
      url: info.url,
      type: "video",
      poster: info.thumburl || "",
      credit: artist ? `${artist.slice(0, 70)} / Wikimedia Commons` : "Wikimedia Commons",
      creditUrl: info.descriptionurl || "https://commons.wikimedia.org/",
      license: licence.slice(0, 40),
      source: "commons-video",
    };
  }
  return null;
}
async function fromCommonsVideo(query) {
  const terms = imageTerms(query, 3);
  if (!terms) return null;
  return parseCommonsVideo(await getJSON(
    "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
      action: "query", format: "json", generator: "search",
      gsrsearch: `filetype:video ${terms}`, gsrnamespace: "6", gsrlimit: "6",
      prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "800",
    })
  ));
}

// ── Extension tests for provider payloads ─────────────────────────────
// Wikimedia Commons' API appends tracking parameters to every imageinfo
// URL (…/Gut_microbiota_composition.png?utm_source=commons.wikimedia.org&…),
// so a $-anchored extension test rejects EVERY real Commons result and the
// whole source reads as "empty" — the actual root cause of the lead-media
// endpoint returning {"ok":true,"image":null} for subjects Commons covers.
// The extension must be followed by a query string, a fragment, or the end
// of the URL — never by more path characters (which would accept
// "x.png.evil").
export function hasStillExtension(url) {
  return /\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(String(url || ""));
}
export function hasVideoExtension(url) {
  return /\.webm(\?|#|$)/i.test(String(url || ""));
}
export function hasMp4Extension(url) {
  return /\.mp4(\?|#|$)/i.test(String(url || ""));
}

// ── Commit: verify the winning URL before returning it ──────────────────
// The client pre-decodes every still through `new Image()` so a dead URL
// can never render as a broken glyph. But that probe fails SILENTLY: a URL
// the provider metadata *says* is an image but that actually serves a
// redirect to an HTML page (Europe PMC figure links do exactly this when
// the figure file is missing from the article) was handed back as a "hit",
// cached for 14 days, dropped by the client's probe, and the hero fell
// back to a bare gradient panel — the biggest thing on the Trending page
// was an empty dark box. So the endpoint now verifies the URL itself, and
// walks the priority-ordered candidates until one actually resolves to the
// media type it claims to be. Some origins reject HEAD, so a 405/501 gets
// one ranged-GET second chance rather than an instant rejection. Timeouts
// go through the shared fetchWithTimeout — never a hand-rolled
// AbortController.
export async function verifyMediaUrl(url, kind) {
  const want = kind === "video" ? "video/" : "image/";
  const ua = { "User-Agent": "Cerebrum/1.0 (https://askcerebrum.org)" };
  const check = (res) => {
    if (!res || !res.ok) return false;
    const ct = String((res.headers && res.headers.get("content-type")) || "").toLowerCase();
    return ct.startsWith(want);
  };
  try {
    const res = await fetchWithTimeout(url, { method: "HEAD", redirect: "follow", headers: ua }, 6000);
    if (check(res)) return true;
    if (res && (res.status === 405 || res.status === 501)) {
      const res2 = await fetchWithTimeout(url, {
        method: "GET", redirect: "follow", headers: { ...ua, Range: "bytes=0-0" },
      }, 6000);
      return check(res2);
    }
    return false;
  } catch { return false; }
}

async function ensureCache(env) {
  try {
    await env.DB.exec("CREATE TABLE IF NOT EXISTS image_cache (q TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at INTEGER NOT NULL)");
    // Added for the miss/hit TTL split below. Guarded: on a table created
    // before this column existed the ALTER throws "duplicate column name"
    // exactly once, which is swallowed here.
    await env.DB.exec("ALTER TABLE image_cache ADD COLUMN hit INTEGER NOT NULL DEFAULT 0").catch(() => {});
  } catch {}
}

// Pure: is a cached image_cache row still servable? Verified hits live
// 14 days; misses live 6 hours. Exported for unit tests.
export function isImageCacheFresh(row, now) {
  const age = now - Number(row && row.created_at);
  const ttl = Number(row && row.hit) === 1 ? CACHE_TTL_MS : MISS_TTL_MS;
  return age < ttl;
}

export function mediaCacheKey(category, query) {
  return ((category || "") + "|" + imageTerms(query, 4) + "|v3").toLowerCase();
}

// ── Shared lead-media resolver ──────────────────────────────────────────
// The whole pipeline — cache lookup, nine-source fan-out, URL verification,
// priority-order winner selection, cache write — factored out of onRequest
// so other endpoints can resolve lead media for their own payloads without
// duplicating it: trending.js enriches every feed item at refresh time, and
// document.js (separate owner) attaches it to analysis responses.
//
// Returns { image, diag, cacheHit } where image is the verified winning
// candidate ({ url, credit, creditUrl, license, source, [type, poster],
// verified: true }) or null when no provider had anything usable — the
// honest empty, cached briefly rather than denied.
export async function resolveLeadMedia(env, query, category) {
  const diag = [];
  const key = mediaCacheKey(category, query);
  if (!imageTerms(query, 4)) return { image: null, diag, cacheHit: false };

  if (env.DB) {
    await ensureCache(env);
    try {
      const row = await env.DB.prepare("SELECT payload, created_at, hit FROM image_cache WHERE q = ?").bind(key).first();
      if (row && isImageCacheFresh(row, Date.now())) {
        // A cached miss is cached too — re-running nine upstream searches
        // on every page view for a subject that has no picture anywhere is
        // the expensive half of this endpoint, not the hits. But misses
        // expire in hours (see MISS_TTL_MS), so a recovered provider heals
        // without anyone flushing the cache by hand.
        let image = null;
        try { image = JSON.parse(row.payload).image || null; } catch {}
        return { image, diag, cacheHit: true };
      }
    } catch {}
  }

  // Commit 76 — parallel, not sequential.
  //
  // This ran the sources one after another and stopped at the first hit.
  // The order put Europe PMC second because a figure from the actual paper
  // is the most on-brand illustration there is — but it is also by far the
  // most expensive source: a search, then several full-text XML downloads,
  // each a whole paper. On a slow day that alone can eat the entire
  // request before NASA or Commons is even tried, so the endpoint returns
  // null and every card falls back to a generated cover. Which is exactly
  // the reported symptom: no images in Trending.
  //
  // Now every source runs at once under its own timeout, and the winner is
  // chosen by PRIORITY rather than by whoever answers first. Same
  // preference order as before, none of the head-of-line blocking. Results
  // cache for 14 days, so the extra upstream calls are paid once per
  // subject, not once per page view.
  const SOURCES = [
    ["curated", () => fromCustom(env, category)],
    ["europepmc", () => fromEuropePMC(query)],
    ["nasa", () => fromNasa(query)],
    ["commons", () => fromCommons(query)],
    ["openverse", () => fromOpenverse(query)],
    ["unsplash", () => fromUnsplash(env, query)],
    ["pexels", () => fromPexels(env, query)],
    // Video after every still: a still is calmer and cheaper, so a card
    // only moves when nothing static could be found for it.
    ["nasa-video", () => fromNasaVideo(query)],
    ["commons-video", () => fromCommonsVideo(query)],
  ];
  const settled = await Promise.all(SOURCES.map(async ([name, fn]) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      // Never hand the client a URL we wouldn't fetch ourselves: https
      // only, parseable, no embedded credentials. Third-party provider
      // payloads are untrusted input.
      const ok = !!(r && r.url && isSafeHttpsUrl(r.url));
      diag.push({ source: name, result: ok ? "hit" : "empty", ms: Date.now() - t0 });
      return ok ? r : null;
    } catch (e) {
      diag.push({ source: name, result: "error", ms: Date.now() - t0, error: safeErr(e) });
      return null;
    }
  }));
  // The winner must actually BE what it claims to be — see verifyMediaUrl
  // above. Every candidate is verified CONCURRENTLY (each under its own
  // timeout) and the winner is then walked in priority order: a dead URL
  // early in the list can never head-of-line-block a working one further
  // down, and a slow HEAD on one candidate can't stall the rest. The old
  // sequential walk burned up to 6s per dead candidate before even trying
  // the next one.
  const verified = await Promise.all(settled.map((cand) =>
    cand ? verifyMediaUrl(cand.url, cand.type === "video" ? "video" : "image") : Promise.resolve(false)
  ));
  let winner = null;
  for (let i2 = 0; i2 < settled.length; i2++) {
    if (settled[i2] && verified[i2]) { winner = settled[i2]; break; }
  }
  // verified:true is the contract: downstream surfaces render this URL
  // directly, and the flag is what tells "checked and real" apart from
  // "the provider said so".
  const image = winner ? { ...winner, verified: true } : null;

  const payload = JSON.stringify({ ok: true, image });
  if (env.DB) {
    try {
      await env.DB.prepare(
        "INSERT INTO image_cache (q, payload, created_at, hit) VALUES (?, ?, ?, ?) ON CONFLICT(q) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at, hit = excluded.hit"
      ).bind(key, payload, Date.now(), image ? 1 : 0).run();
    } catch {}
  }
  return { image, diag, cacheHit: false };
}

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env, { methods: "GET, OPTIONS", credentials: false });
  // This file built CORS headers and never rejected anything — it was the only
  // gate-less endpoint besides report.js and config.js.
  if (!readOriginAllowed(request, env)) return forbiddenOrigin(cors);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") {
    return jsonError(405, "method_not_allowed", "Method not allowed.", cors);
  }
  const url = new URL(request.url);
  const query = clampText(url.searchParams.get("q"), MAX_QUERY_LEN);
  const category = clampText(url.searchParams.get("category"), 60);
  if (!query) return jsonOk({ image: null }, cors);

  const rlKey = await privacyKey("image", clientIp(request), env);
  if (!(await checkRateLimit(env, rlKey, RATE_LIMIT, RATE_WINDOW_MS))) {
    // 429, not 200: the frontend treats non-ok as "no image" and falls back
    // to the generated cover, so this degrades silently.
    return jsonError(429, "rate_limited", "Too many requests.", { ...cors, "Retry-After": "30" });
  }

  const { image, diag, cacheHit } = await resolveLeadMedia(env, query, category);

  // ?debug=1 reports what every source actually did. This endpoint depends
  // on nine third parties, none of which can be reached from a development
  // sandbox — "it returns nothing and I cannot tell you why" was a real
  // possibility, and this is how that gets answered without a guess.
  /* ?debug=1 reported which image-provider API keys are configured. That is
   * exactly the environment-variable disclosure config.js gates behind the
   * founder account, published here to anyone who appended a query parameter.
   * Same gate now applies. */
  if (url.searchParams.get("debug") === "1") {
    const founderEmail = String(env.FOUNDER_EMAIL || "").trim().toLowerCase();
    let viewer = null;
    try {
      const { getSessionUser } = await import("../lib/authHelpers.js");
      viewer = await getSessionUser(request, env);
    } catch { viewer = null; }
    const isFounder = !!viewer && !!founderEmail && String(viewer.email || "").trim().toLowerCase() === founderEmail;
    if (!isFounder) {
      return new Response(JSON.stringify({ error: "Not authorized.", code: "forbidden" }), { status: 403, headers: cors });
    }
    return new Response(JSON.stringify({
      ok: true,
      image,
      query,
      terms: imageTerms(query, 4),
      category: category || null,
      cacheHit,
      keys: { custom: !!env.CUSTOM_IMAGE_BASE, unsplash: !!env.UNSPLASH_KEY, pexels: !!env.PEXELS_KEY },
      sources: diag.sort((a2, b2) => a2.ms - b2.ms),
    }, null, 2), { status: 200, headers: { ...cors, "Cache-Control": "no-store" } });
  }

  const payload = JSON.stringify({ ok: true, image });
  return new Response(payload, {
    status: 200,
    headers: { ...cors, "Cache-Control": "public, max-age=86400" },
  });
}
