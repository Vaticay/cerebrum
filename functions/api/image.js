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

// Fetch failures come in two kinds and the cache treats them very
// differently (see resolveLeadMedia). A provider that ANSWERS — any
// HTTP status at all, even a 403 or a 404 — has given a definitive
// reply: it was reached, and it had nothing for us. A fetch that
// THROWS (timeout, network refusal, or the platform refusing the
// subrequest because the invocation is out of budget) gave no reply
// at all, and a "no media" conclusion drawn from it is not evidence,
// it is starvation. These helpers collapse both kinds to null for
// their callers, so throws are counted here, at the one place both
// kinds pass through; resolveLeadMedia snapshots the counter around
// its fan-out and refuses to cache a miss the fan-out never earned.
let mediaFetchThrew = 0;
async function getJSON(url, headers) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { Accept: "application/json", "User-Agent": "Cerebrum/1.0 (+https://askcerebrum.org)", ...(headers || {}) },
    }, FETCH_TIMEOUT_MS);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch { mediaFetchThrew++; return null; }
}
async function getText(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "Cerebrum/1.0 (+https://askcerebrum.org)" },
    }, FETCH_TIMEOUT_MS);
    if (!res || !res.ok) return null;
    return await res.text();
  } catch { mediaFetchThrew++; return null; }
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
        subject: mediaSubjectOf((r.title || "").replace(/<[^>]*>/g, "")),
      };
    }
  }
  return null;
}

// Every candidate carries a `subject`: the asset's OWN metadata text
// (a NASA title, a Commons file name, a paper title for a figure).
// resolveLeadMedia's topical verification reads it — see
// mediaMatchesSubject below. A candidate with no subject can still be
// URL verified, but it can never be verified as being about the story.
const mediaSubjectOf = (...parts) =>
  parts.filter((p) => typeof p === "string" && p.trim()).join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
// A Commons page title ("File:Gut_microbiota_composition.png") → the
// file's own name as words ("Gut microbiota composition").
function commonsFileSubject(pageTitle) {
  return String(pageTitle || "")
    .replace(/^File:/i, "")
    .replace(/\.(jpg|jpeg|png|webp|gif|webm|ogv|mp4)$/i, "")
    .replace(/_/g, " ")
    .trim();
}

// ── 3. NASA image library (public domain) ───────────────────────────────
// Up to three candidates, not one: a provider's first search result
// is its nearest guess, and when that guess is a different mission
// the topical check rejects it — under a one candidate contract the
// source then contributed nothing, even when its second or third
// result was the story's own subject. The winner walk reads every
// candidate in order and applies the same checks to each, so more
// candidates raise the honest yield without lowering the bar.
export function parseNasaMulti(data, limit = 3) {
  const items = (data && data.collection && data.collection.items) || [];
  const out = [];
  for (const it of items) {
    if (out.length >= limit) break;
    const link = (it.links || []).find((l) => l && l.href && hasStillExtension(l.href));
    const meta = (it.data || [])[0] || {};
    if (link) {
      out.push({
        url: link.href.replace(/^http:/, "https:"),
        credit: meta.center ? `NASA/${meta.center}` : "NASA",
        creditUrl: "https://images.nasa.gov/",
        license: "Public domain",
        source: "nasa",
        // Title only, deliberately: a NASA description is press
        // release prose that shares vocabulary with every story in
        // its domain ("testing", "mission", a launch complex), and
        // the topical rule below read it as agreement — the Mars
        // Exploration Rover assembly photo verified for a lunar
        // lander story on the strength of its description alone.
        // Every other source's subject is its title-like field (a
        // Commons file name, a paper title, a stock alt); NASA's
        // title is the asset's own name, and that is what is checked.
        subject: mediaSubjectOf(meta.title),
      });
    }
  }
  return out;
}
export function parseNasa(data) {
  const list = parseNasaMulti(data, 1);
  return list.length ? list[0] : null;
}
async function fromNasa(query) {
  const terms = imageTerms(query, 3);
  if (!terms) return null;
  return parseNasaMulti(await getJSON(
    "https://images-api.nasa.gov/search?" + new URLSearchParams({ q: terms, media_type: "image" })
  ));
}

// ── 4. Wikimedia Commons ────────────────────────────────────────────────
// Up to three candidates, like NASA (see parseNasaMulti): Commons
// search answers a four term query with its nearest files, and the
// first licensed file is often a same domain neighbour the topical
// check rightly rejects while a later result is the subject itself.
export function parseCommonsMulti(data, limit = 3) {
  const pages = (data && data.query && data.query.pages) || {};
  const out = [];
  for (const k of Object.keys(pages)) {
    if (out.length >= limit) break;
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
    out.push({
      url: info.url,
      credit: artist ? `${artist.slice(0, 70)} / Wikimedia Commons` : "Wikimedia Commons",
      creditUrl: info.descriptionurl || "https://commons.wikimedia.org/",
      license: licence.slice(0, 40),
      source: "commons",
      subject: commonsFileSubject(p.title),
    });
  }
  return out;
}
export function parseCommons(data) {
  const list = parseCommonsMulti(data, 1);
  return list.length ? list[0] : null;
}
async function fromCommons(query) {
  const terms = imageTerms(query, 4);
  if (!terms) return null;
  return parseCommonsMulti(await getJSON(
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
      subject: mediaSubjectOf(r.title),
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
    subject: mediaSubjectOf(r.alt_description, r.description),
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
    subject: mediaSubjectOf(r.alt),
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
        // Title only, same reasoning as parseNasa: the description
        // is press prose whose vocabulary overlaps the whole domain.
        subject: mediaSubjectOf(meta.title),
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
      subject: commonsFileSubject(p.title),
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
  } catch (cbErr) { console.error("[Cerebrum] image.js ensureCache: await env.DB.exec('CREATE TABLE IF NOT EXISTS image_cache (q TEXT PRIM:", cbErr); }
}

// Pure: is a cached image_cache row still servable? Verified hits live
// 14 days; misses live 6 hours. Exported for unit tests.
export function isImageCacheFresh(row, now) {
  const age = now - Number(row && row.created_at);
  const ttl = Number(row && row.hit) === 1 ? CACHE_TTL_MS : MISS_TTL_MS;
  return age < ttl;
}

export function mediaCacheKey(category, query) {
  // v5: the identifier rule changed again (strong versus weak
  // identifiers, title-only NASA subjects — see mediaMatchesSubject),
  // and the v4 namespace carries a second, worse inheritance: miss
  // rows written by the first v4 resolutions, which ran inside the
  // trending refresh invocations whose subrequest budget the feed
  // fetch and citation legs had already spent. Those fan-outs starved
  // (every fetch refused or timed out reads exactly like "provider
  // had nothing" at this layer), and their nulls were cached as
  // authoritative misses and re-served for days — the live edition
  // resolved 40 of 40 items from those rows without a single fan-out
  // running. v4 rows are abandoned by namespace rather than trusted,
  // and resolveLeadMedia no longer caches a miss its fan-out threw
  // its way through, so the v5 namespace cannot refill the same way.
  return ((category || "") + "|" + imageTerms(query, 4) + "|v5").toLowerCase();
}

// ── Topical verification: the asset must be about the subject ──────
// URL verification alone stamped "verified" on any live URL a provider
// returned, and providers answer a four term search with whatever sits
// nearest: the live Trending edition of 2026-10-14 carried a Mars
// Exploration Rover photograph on a lunar lander story, a CRS 17
// launch photo on the CRS 35 story, a crewed launch photo on a cargo
// resupply story, and a German mountains video on a structural systems
// story — five of its six verified slots topically wrong, every one
// honestly "verified" under the old rule. So verified now has a second
// half: the asset's OWN metadata (the `subject` the parsers above carry
// out of the provider payload: a NASA title or description, a Commons
// file title, an Openverse or stock title, a figure's paper title)
// must share topical vocabulary with the story it will illustrate.
//
// THE RULE. Both sides are tokenized (lowercase, split on non
// alphanumerics, stopwords and generic provider words dropped, light
// stemming of the same kind trendingUtils uses for story clustering).
// Digit bearing tokens of length two or more are IDENTIFIERS, and
// they come in two strengths, a distinction the first version of
// this rule missed and the live data punished:
//   · STRONG identifiers name the numbered thing itself: a letter
//     and number compound, attached (H5N1, PIA04834) or separated
//     (CRS-17, Crew 12, Falcon 9), a catalog number of five or more
//     digits, and any number in the story's TITLE (a headline number
//     is the story's own: the 35th resupply, Apollo 11).
//   · WEAK identifiers are the bare numbers that ride along inside
//     a text without naming its subject: a launch complex, a rocket
//     model mentioned in passing, a year. The CRS 17 launch photo
//     and the CRS 35 story share Launch Complex 40 and the year —
//     under the first version that coincidence counted as identifier
//     agreement and the veto never fired.
// Then:
//   · Identifier veto, strong form: when both sides carry strong
//     identifiers and share none, the asset is a different numbered
//     thing and it is rejected however many words overlap.
//   · Identifier veto, plain form: when both sides carry any
//     identifiers and share none at all, same rejection.
//   · Otherwise the overlap is scored: a shared STRONG identifier
//     counts 3, a shared token from the story's TITLE counts 2, a
//     shared token that appears only in the story's summary counts
//     1. Pure digit tokens never score as words (they are the
//     identifier machinery's business, scored there or not at all),
//     and process words every story in a domain shares — mission,
//     launch, testing, flight — are generic and score nothing: a
//     score of 2 or more verifies, so what carries an asset over
//     the line is a distinctive shared title word (the H5N1 image
//     for the H5N1 story, "gut" for the gut microbiome story) or
//     genuine identifier agreement.
// An asset with no usable metadata cannot be verified topically and
// is not verified at all: no evidence, no flag. When no candidate
// passes both halves, the resolver returns the honest null and the
// item ships with no media rather than a wrong picture.
const MEDIA_GENERIC_TOKENS = new Set([
  ...IMG_STOP,
  "nasa", "esa", "jaxa", "space", "image", "images", "photo", "photograph",
  "picture", "pictures", "video", "center", "centre", "file", "jpg", "jpeg",
  "png", "webp", "webm", "mp4", "gif", "shows", "showing", "shown", "view",
  "during", "about", "after", "before", "between", "through", "their",
  "there", "been", "have", "will", "would", "should", "more", "most",
  "other", "such", "like", "also", "only", "very",
  // Process vocabulary: true of nearly every story in the domain,
  // so it cannot testify that an asset is about THIS one. The Mars
  // rover photo and the lunar lander story shared "testing" (and,
  // through the NASA description, half a dozen more); a real match
  // shares the subject's name, not its verbs.
  "mission", "missions", "launch", "launches", "launched", "launching",
  "test", "tests", "testing", "tested", "flight", "flights",
  // Genre vocabulary: a "press conference" video of a Welsh
  // minister verified for an ESA astronaut's press conference
  // story on these two words alone. An event's genre is not its
  // subject.
  "press", "conference", "conferences",
  // Headline verbs, the two carriers the multi candidate walk
  // surfaced on the live replay: a Webb telescope photo verified
  // for a wavefunction paper on the shared stem "complete", and a
  // Mars 2020 spacecraft photo verified for a Moon lander story on
  // "readies" — both stories and both assets wearing NASA headline
  // verbs while being about different subjects entirely.
  "complete", "completes", "completed", "completing",
  "ready", "readies", "readied", "readying",
]);
function mediaRawTokens(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
}
function stemMediaToken(w) {
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}
export function mediaSubjectTokens(text) {
  const out = new Set();
  for (const w of mediaRawTokens(text)) {
    if (MEDIA_GENERIC_TOKENS.has(w)) continue;
    if (w.length < 3 && !/\d/.test(w)) continue;
    out.add(stemMediaToken(w));
  }
  return out;
}
// Ordinal forms normalize to the number they name ("35th" → "35"):
// the story's headline says "35th SpaceX Resupply" while its own
// summary says "CRS-35", and an asset saying "CRS 35" must meet both.
function normalizeMediaIdentifier(w) {
  const m = /^(\d+)(st|nd|rd|th)$/.exec(w);
  return m ? m[1] : w;
}
export function mediaIdentifierTokens(text) {
  const out = new Set();
  for (const w of mediaRawTokens(text)) {
    if (/\d/.test(w) && w.length >= 2) out.add(normalizeMediaIdentifier(w));
  }
  return out;
}
// Letter parts that pair with a number without naming a numbered
// thing ("Figure 1", "Table 2", "on 35", "in 2024", "March 5"):
// excluded from compounds so a label, a preposition, or a date can
// never pose as a mission designator — a junk compound on the story
// side is enough to veto a genuine asset whose own designator it
// fails to share.
const MEDIA_COMPOUND_STOP = new Set([
  "figure", "fig", "table", "page", "chapter", "section",
  "the", "and", "for", "with", "from", "into", "over", "under",
  "after", "before", "about", "through", "during", "between",
  "per", "via", "one", "two", "six", "ten",
  "march", "april", "may", "june", "july",
]);
// STRONG identifiers in compound form: a short letter group (at
// most six letters — CRS, Crew, SpX, Soyuz, Falcon, Apollo; longer
// words pairing with numbers are prose, like "October 13") joined
// to a number of up to four digits, attached (H5N1, AS07), hyphen
// separated (CRS-17, MS-28), or space separated with at least three
// letters (Falcon 9, Apollo 11 — a two letter word before a number
// in open prose is a preposition, not a designator).
export function mediaCompoundIdentifiers(text) {
  const out = new Set();
  const s = String(text || "").toLowerCase();
  for (const m of s.matchAll(/\b([a-z]{2,6})-(\d{1,4})\b/g)) {
    if (MEDIA_COMPOUND_STOP.has(m[1])) continue;
    out.add(m[1] + m[2]);
  }
  for (const m of s.matchAll(/\b([a-z]{3,6}) (\d{1,4})\b/g)) {
    if (MEDIA_COMPOUND_STOP.has(m[1])) continue;
    out.add(m[1] + m[2]);
  }
  for (const w of mediaRawTokens(text)) {
    // Attached forms the pair scan cannot see (the letter group is
    // a single letter, as in H5N1, or the number runs long, as in
    // PIA04834): a token mixing letters and digits is itself one.
    if (/^(?=.*[a-z])(?=.*\d)[a-z0-9]{3,}$/.test(w)) out.add(w);
    // A bare catalog number of five or more digits names one asset.
    else if (/^\d{5,}$/.test(w)) out.add(w);
  }
  return out;
}
function mediaStrongIdentifiers(text, titleText) {
  const out = mediaCompoundIdentifiers(text);
  // Numbers in a title are the text's own headline facts, so the
  // story's title numbers are strong on the story side — except a
  // bare year, which is a date, not an identity: everything
  // published this year shares it, and the APOD false pass rode on
  // exactly a shared year.
  if (titleText) {
    for (const id of mediaIdentifierTokens(titleText)) {
      if (!/^(19|20)\d{2}$/.test(id)) out.add(id);
    }
  }
  return out;
}
export function mediaMatchesSubject(assetSubject, storyTitle, storySummary) {
  const asset = mediaSubjectTokens(assetSubject);
  if (!asset.size) return false;
  const assetIds = mediaIdentifierTokens(assetSubject);
  const storyIds = new Set([...mediaIdentifierTokens(storyTitle), ...mediaIdentifierTokens(storySummary)]);
  const assetStrong = mediaStrongIdentifiers(assetSubject, "");
  const storyStrong = mediaStrongIdentifiers(`${storyTitle || ""} ${storySummary || ""}`, storyTitle);
  // Agreement is judged on the designator AND its number: the story
  // may carry the bare headline number ("35th") where the asset
  // carries the compound ("CRS-35"), and those are the same
  // identifier wearing two forms. Each compound contributes its
  // digit suffix as a key of its own.
  const strongKeys = (set) => {
    const out = new Set(set);
    for (const k of set) {
      const m = /^[a-z]+(\d+)$/.exec(k);
      if (m) out.add(m[1]);
    }
    return out;
  };
  const assetStrongKeys = strongKeys(assetStrong);
  const storyStrongKeys = strongKeys(storyStrong);
  const sharedStrong = [...assetStrongKeys].some((id) => storyStrongKeys.has(id));
  if (assetStrong.size && storyStrong.size && !sharedStrong) return false;
  const sharedId = [...assetIds].some((id) => storyIds.has(id));
  if (assetIds.size && storyIds.size && !sharedId) return false;
  // Identifier agreement earns its 3 only when it is strong: the
  // shared catalog or compound, or a number from the story's own
  // title turning up in the asset. A weak coincidence (both texts
  // mention Launch Complex 40) earns nothing here.
  const titleStrong = mediaStrongIdentifiers("", storyTitle);
  const strongShare = sharedStrong || [...assetIds].some((id) => titleStrong.has(id));
  let score = strongShare ? 3 : 0;
  const titleToks = mediaSubjectTokens(storyTitle);
  const summaryToks = mediaSubjectTokens(storySummary);
  for (const tok of asset) {
    if (/^\d+$/.test(tok)) continue;
    if (titleToks.has(tok)) score += 2;
    else if (summaryToks.has(tok)) score += 1;
  }
  // A story that carries strong identifiers names a specific
  // numbered thing; an asset carrying none must prove itself with
  // vocabulary, at double the usual bar. One shared company word
  // verified a NASA astronaut-programme video for the CRS 35 cargo
  // story: the asset named no number because it was about a
  // different programme, and a single word could not say so.
  const threshold = storyStrong.size && !assetStrong.size ? 4 : 2;
  return score >= threshold;
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
// honest empty, cached briefly rather than denied. Verified means both
// halves of the check: the URL resolves to the media type it claims,
// AND the asset's own metadata is topically about the subject (see
// mediaMatchesSubject). `subject` optionally carries the fuller story
// text ({ title, summary }) the topical check reads; the default is
// the query itself, which is the subject on the other call paths.
export async function resolveLeadMedia(env, query, category, subject, opts) {
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
        try { image = JSON.parse(row.payload).image || null; } catch (cbErr) { console.error("[Cerebrum] image.js if: image = JSON.parse(row.payload).image || null; }:", cbErr); }
        return { image, diag, cacheHit: true };
      }
    } catch (cbErr) { console.error("[Cerebrum] image.js if: image = JSON.parse(row.payload).image || null; } catch {}:", cbErr); }
  }
  // Cache-only probe: the caller (trending's enrichment) is deciding
  // whether a fan-out is worth spending from a small per build
  // budget. A fresh row answered above; anything else is reported as
  // needsResolution and NO fetch runs and NOTHING is written — a
  // probe must never manufacture the miss it merely failed to find.
  if (opts && opts.cacheOnly) return { image: null, diag, cacheHit: false, needsResolution: true };
  const fetchThrewBefore = mediaFetchThrew;

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
      // A source returns one candidate or, for the multi candidate
      // sources (NASA, Commons), a list in the provider's own order.
      // Never hand the client a URL we wouldn't fetch ourselves: https
      // only, parseable, no embedded credentials. Third-party provider
      // payloads are untrusted input.
      const list = (Array.isArray(r) ? r : r ? [r] : [])
        .filter((c) => c && c.url && isSafeHttpsUrl(c.url));
      diag.push({ source: name, result: list.length ? "hit" : "empty", ms: Date.now() - t0 });
      return list;
    } catch (e) {
      diag.push({ source: name, result: "error", ms: Date.now() - t0, error: safeErr(e) });
      return [];
    }
  }));
  // Flatten in priority order (source order, then the provider's own
  // order inside a source), dropping duplicate URLs a provider
  // repeated: the walk below reads this list as "best candidate
  // first" and every check applies per candidate.
  const candidates = [];
  const seenUrls = new Set();
  for (const list of settled) {
    for (const cand of list) {
      if (seenUrls.has(cand.url)) continue;
      seenUrls.add(cand.url);
      candidates.push(cand);
    }
  }
  // The winner must actually BE what it claims to be — see verifyMediaUrl
  // above. Every candidate is verified CONCURRENTLY (each under its own
  // timeout) and the winner is then walked in priority order: a dead URL
  // early in the list can never head-of-line-block a working one further
  // down, and a slow HEAD on one candidate can't stall the rest. The old
  // sequential walk burned up to 6s per dead candidate before even trying
  // the next one.
  const verified = await Promise.all(candidates.map((cand) =>
    verifyMediaUrl(cand.url, cand.type === "video" ? "video" : "image")
  ));
  // The winner walk now applies the second half of verification: a
  // candidate whose own metadata is not about this subject is passed
  // over for the next verified candidate, exactly the way a dead URL
  // already was. The operator's own library is the one exemption: it
  // carries no provider metadata to check because a human placed each
  // file under its category by hand, and that placement is its check.
  const subjectTitle = (subject && subject.title) || query;
  const subjectSummary = (subject && subject.summary) || "";
  let winner = null;
  for (let i2 = 0; i2 < candidates.length; i2++) {
    if (!verified[i2]) continue;
    if (candidates[i2].source !== "curated" && !mediaMatchesSubject(candidates[i2].subject, subjectTitle, subjectSummary)) continue;
    winner = candidates[i2];
    break;
  }
  // verified:true is the contract: downstream surfaces render this URL
  // directly, and the flag is what tells "checked and real" apart from
  // "the provider said so" — checked for existing AND for being about
  // the subject it illustrates.
  const image = winner ? { ...winner, verified: true } : null;

  const payload = JSON.stringify({ ok: true, image });
  // A miss is cached only when the fan-out actually ran: if any
  // provider fetch THREW along the way (timeout, network refusal, or
  // the platform refusing subrequests because the invocation — a
  // trending refresh that already spent its budget on the feed fetch
  // and the citation legs — had none left), the null below is not
  // evidence about the subject, and caching it would re-serve the
  // starvation as fact for the whole miss TTL. That is exactly how
  // the v4 namespace filled with misses no provider ever voted on.
  // An uncached miss simply resolves again on the next build. A hit
  // is cached regardless: a verified winner is a fact the fan-out
  // did establish.
  const fanOutThrew = mediaFetchThrew > fetchThrewBefore;
  if (env.DB && (image || !fanOutThrew)) {
    try {
      await env.DB.prepare(
        "INSERT INTO image_cache (q, payload, created_at, hit) VALUES (?, ?, ?, ?) ON CONFLICT(q) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at, hit = excluded.hit"
      ).bind(key, payload, Date.now(), image ? 1 : 0).run();
    } catch (cbErr) { console.error("[Cerebrum] image.js if: await env.DB.prepare(:", cbErr); }
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
