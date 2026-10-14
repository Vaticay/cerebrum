// Cerebrum "Trending in Science" feed — Cloudflare Pages Function.
//
// This used to proxy OpenAlex (recent, highly-cited papers) for a small
// preview widget, then later called the Spaceflight News API live, on
// every single page load, leaning entirely on Cloudflare's edge cache (a
// 15-minute Cache-Control TTL) to keep that bearable. "Live" in name only:
// a visitor was always looking at whatever a given edge colo happened to
// have cached — anywhere from fresh to 15 minutes old depending on which
// one answered — and a visitor from a cold region paid the live-fetch
// latency themselves.
//
// This reads from a small D1 cache row and keeps that row warm itself,
// using stale-while-revalidate: a payload past the refresh window is
// served immediately and rebuilt in the background after the response has
// gone out, so no visitor ever waits for an upstream fetch. Commit 89
// removed the GitHub Actions cron that used to do this — see the block
// above REFRESH_AFTER_MS for why. If the cache is missing entirely, this
// still falls back to a live fetch, so a cold start degrades gracefully
// instead of leaving the page broken.
//
// Labeled "Preview" on screen, not "Fact-Checked": unlike a single search
// answer, nothing here has gone through Cerebrum's own fact-check pass —
// this is a live feed of other outlets' reporting, not Cerebrum's own
// verified output. See TrendingView in src/CerebrumApp.jsx for exactly how that's
// worded on screen.

import { corsHeaders, readOriginAllowed, requireTrustedOrigin, forbiddenOrigin, clientIp, privacyKey } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { fetchTrendingFeed, attachTrendHistory } from "../lib/trendingSource.js";
import { resolveLeadMedia } from "./image.js";


const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60000;
// If the cached row is older than this, treat it as if it doesn't exist.
// The hourly refresh should be repopulating it every 60 minutes, so
// anything this stale means that job has been failing for a while, not
// just running a few minutes behind schedule.
const MAX_CACHE_AGE_MS = 90 * 60 * 1000; // 90 minutes

/* ══════════════════════════════════════════════════════════════════
   Commit 89 — the hourly refresh refreshes itself now.

   The design was: a GitHub Actions cron POSTs to /api/trendingrefresh
   once an hour with a shared secret, and this endpoint serves whatever
   that job last wrote. Three separate things had to be right for that to
   work — the secret had to exist in GitHub, the same secret had to exist
   in Cloudflare, and Cloudflare's bot protection had to let a datacentre
   IP through — and two of them were wrong, which is why the job has been
   emailing a failure every hour.

   None of it was necessary. This endpoint already had a live-fetch
   fallback that writes what it fetched back into the cache, so the app
   was never actually depending on the cron for correctness; the cron only
   existed so that no individual visitor would have to pay the latency of
   that live fetch.

   Stale-while-revalidate does the same job with no moving parts. Past
   REFRESH_AFTER_MS the cached payload is still served instantly, and the
   refresh runs in the background through waitUntil() after the response
   has already gone out. Nobody ever waits for it. The feed stays hourly
   as long as anyone visits at all, and if nobody visits for a day then
   nobody was looking at a stale feed either.

   What this deletes: the GitHub Actions workflow, the shared secret in
   two places, the Bot Fight Mode exception, and the hourly failure email.
   ══════════════════════════════════════════════════════════════════ */
const REFRESH_AFTER_MS = 60 * 60 * 1000; // 60 minutes

// ---- consistent response shapes ----
// Every response from this endpoint carries `ok`. Failures are always
// { ok: false, error, code } with a human-safe message; successes are
// { ok: true, ... }. `error` text and HTTP status are unchanged so existing
// clients keep working — `ok`/`code` are additive.
const okRes = (payload, status, headers) =>
  new Response(JSON.stringify({ ok: true, ...payload }), { status: status || 200, headers });
const errRes = (message, status, code, headers) =>
  new Response(JSON.stringify({ ok: false, error: message, code: code || "error" }), { status: status || 400, headers });
// Exported for unit tests (tests/content-endpoints.mjs).
export { okRes, errRes };

// ---- cache evaluation, factored pure for unit tests ----

// Parses a trending_cache row into { items, generatedAt, fetchedAt }, or
// null when the row is missing or its payload isn't JSON we understand.
// Never throws — a corrupt cache row is a degraded feed, not a 500.
export function parseCachePayload(row) {
  if (!row || typeof row.payload !== "string") return null;
  try {
    const parsed = JSON.parse(row.payload);
    const items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
    return {
      items,
      generatedAt: parsed && parsed.generatedAt != null ? parsed.generatedAt : null,
      sourceHealth: parsed && Array.isArray(parsed.sourceHealth) ? parsed.sourceHealth : null,
      fetchedAt: Number(row.fetched_at) || 0,
    };
  } catch {
    return null;
  }
}

// A parsed payload is servable when it has real items in the current
// multi-discipline shape. Commit 61's rule, unchanged: items from the
// current feed carry a `category`, so a cached payload without one is the
// old single-source (space-only) feed and is discarded no matter how fresh.
export function isUsableCachePayload(parsed) {
  if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) return false;
  return parsed.items.some((x) => x && x.category);
}

// One place that decides how a cache row should be treated, given its age:
// "fresh" (serve, no refresh), "stale" (serve now, refresh in background),
// or "ancient" (try live first; serve only if live fails). A row that fails
// parseCachePayload/isUsableCachePayload never reaches this function.
// Exported for unit tests — pure function of (fetchedAt, now).
export function classifyCacheAge(fetchedAt, now) {
  const age = now - (Number(fetchedAt) || 0);
  if (age < 0) return { state: "fresh", ageMs: 0 };
  if (age <= REFRESH_AFTER_MS) return { state: "fresh", ageMs: age };
  if (age <= MAX_CACHE_AGE_MS) return { state: "stale", ageMs: age };
  return { state: "ancient", ageMs: age };
}

// In the stale window, EVERY visitor would otherwise kick off their own
// background refresh via waitUntil — ten concurrent visitors means ten
// concurrent upstream fetch fans. One module-level flag per isolate makes
// the first request in the window the only one that refreshes; the rest
// just serve the stale payload. The safety timer clears a flag stuck by an
// isolate that was frozen mid-refresh (module state would otherwise stay
// true for the isolate's whole remaining life).
let _refreshInFlight = false;
function scheduleRefresh(env, waitUntil) {
  if (_refreshInFlight) return;
  _refreshInFlight = true;
  const done = () => { _refreshInFlight = false; };
  const safety = setTimeout(done, 120000);
  const p = refreshCache(env).finally(() => { clearTimeout(safety); done(); });
  if (typeof waitUntil === "function") waitUntil(p);
  else p.catch(() => {});
}

// Same dedup shape as scheduleRefresh, for the media backfill: a cache
// row can outlive the code that wrote it, and a row whose items carry
// no `media` key at all (written before enrichment existed, or by a
// first serve whose background backfill died with its isolate) would
// otherwise serve media-less stories until the row happened to go
// stale. Serving such a row schedules the backfill the live path runs.
let _mediaBackfillInFlight = false;
function scheduleMediaBackfill(env, waitUntil) {
  if (_mediaBackfillInFlight) return;
  _mediaBackfillInFlight = true;
  const done = () => { _mediaBackfillInFlight = false; };
  const safety = setTimeout(done, 120000);
  const p = backfillTrendingMedia(env).finally(() => { clearTimeout(safety); done(); });
  if (typeof waitUntil === "function") waitUntil(p);
  else p.catch(() => {});
}

// ── Edition archive ─────────────────────────────────────────────────
// An edition is one day of the feed, keyed by the UTC date of its
// generatedAt. Every refresh upserts that day's snapshot (the latest
// build of the day is the day's edition), the archive keeps the
// newest fourteen days, and ?edition=YYYY-MM-DD serves a past day
// read only. Until this existed the surface had no memory at all:
// yesterday's edition vanished the moment today's was built.
export function editionIdOf(generatedAt) {
  const ts = Number(generatedAt);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

const EDITION_KEEP = 14;
let _editionsEnsured = false;
async function ensureEditionsTable(env) {
  if (_editionsEnsured) return;
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS trending_editions (edition_id TEXT PRIMARY KEY, payload TEXT NOT NULL, generated_at INTEGER NOT NULL)"
  );
  _editionsEnsured = true;
}

let _lastArchivedSig = "";
async function archiveEdition(env, payloadBody, generatedAt) {
  try {
    if (!env.DB) return;
    const id = editionIdOf(generatedAt);
    if (!id) return;
    // One archive write per distinct build per isolate is enough; the
    // serve path calls this on every read otherwise.
    const sig = id + ":" + generatedAt;
    if (sig === _lastArchivedSig) return;
    _lastArchivedSig = sig;
    await ensureEditionsTable(env);
    await env.DB.prepare(
      "INSERT INTO trending_editions (edition_id, payload, generated_at) VALUES (?, ?, ?) ON CONFLICT(edition_id) DO UPDATE SET payload = excluded.payload, generated_at = excluded.generated_at"
    ).bind(id, payloadBody, generatedAt).run();
    await env.DB.prepare(
      "DELETE FROM trending_editions WHERE edition_id NOT IN (SELECT edition_id FROM trending_editions ORDER BY generated_at DESC LIMIT ?)"
    ).bind(EDITION_KEEP).run();
  } catch (e) {
    console.error("Cerebrum trending archive failed:", e);
  }
}

async function listEditions(env) {
  try {
    if (!env.DB) return [];
    await ensureEditionsTable(env);
    const { results } = await env.DB.prepare(
      "SELECT edition_id, generated_at FROM trending_editions ORDER BY generated_at DESC LIMIT ?"
    ).bind(EDITION_KEEP).all();
    return (results || []).map((r) => ({ id: r.edition_id, generatedAt: r.generated_at }));
  } catch { return []; }
}

// ── Trend signal from the archive ───────────────────────────────────
// The archive is the pipeline's own memory, so it is also where the
// trend signal comes from: before a build is written, its items are
// matched against the archived editions and each leaves carrying a
// `trend` record (see attachTrendHistory in trendingSource.js) saying
// on how many distinct edition days the work has appeared. A build
// with no archive behind it still gets honest values: every item is
// on its first day. Never throws; a failed archive read degrades to
// first day values, not to a failed build.
async function loadPriorEditions(env) {
  try {
    if (!env.DB) return [];
    await ensureEditionsTable(env);
    const { results } = await env.DB.prepare(
      "SELECT edition_id, payload FROM trending_editions ORDER BY generated_at DESC LIMIT ?"
    ).bind(EDITION_KEEP).all();
    return (results || [])
      .map((r) => {
        const parsed = parseCachePayload({ payload: r.payload, fetched_at: 0 });
        return { id: r.edition_id, items: parsed ? parsed.items : [] };
      })
      .filter((e) => e.id && e.items.length);
  } catch { return []; }
}

export async function withEditionTrend(env, items, generatedAt) {
  try {
    const priors = await loadPriorEditions(env);
    return attachTrendHistory(items, priors, editionIdOf(generatedAt));
  } catch {
    return items;
  }
}

// Refreshes the cache row from upstream. Never throws — this runs
// detached via waitUntil() where a rejection has nobody to catch it, and
// a failed background refresh must not affect the response already sent.
async function refreshCache(env) {
  try {
    const feed = await fetchTrendingFeed();
    let items = feed.items;
    if (!Array.isArray(items) || items.length === 0) return;
    const genAt = Date.now();
    // Trend history attaches before anything else enriches the items:
    // it reads the archive as it stood before this build, and the
    // build's own edition joins the archive only when it is written
    // below, so a work can never count itself twice for one day.
    items = await withEditionTrend(env, items, genAt);
    // Every item leaves here carrying verified lead media (or an honest
    // empty) — see attachMedia/enrichTrendingMedia below. This is the pass
    // that puts pictures back on the biology/medicine/preprint/physics
    // cards: those sources ship no thumbnails of their own, so without this
    // enrichment three quarters of the feed can never have lead media.
    items = await enrichTrendingMedia(env, items);
    const body = JSON.stringify({ items, generatedAt: genAt, sourceHealth: feed.sourceHealth });
    await env.DB.prepare(
      "INSERT INTO trending_cache (id, payload, fetched_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at"
    ).bind(body, Date.now()).run();
    await archiveEdition(env, body, genAt);
  } catch (e) {
    console.error("Cerebrum trending background refresh failed:", e);
  }
}

// ── Lead media on every trending item ─────────────────────────────────
// The media contract, attached to each feed item:
//
//   media: {
//     image: { url, credit, creditUrl, license, source, verified: true }
//            | null,   // a verified still, when one exists
//     video: { url, poster, credit, creditUrl, license, source,
//              verified: true } | null,  // verified last-resort clip,
//                                        // only when no still exists
//     resolvedAt: <ms epoch>
//   }
//
// image XOR video is ever set: a still is calmer and cheaper, so a card
// only moves when nothing static could be verified — the same ordering
// /api/image itself uses. { image: null, video: null } is the honest
// "no media exists for this subject": the UI renders nothing rather than
// a broken frame. `image_url` (the Space source's own thumbnail) is kept
// untouched for backward compatibility; consumers should prefer
// media.image.url when present and fall back to image_url.
//
// Pure — exported for unit tests.
export function attachMedia(item, candidate) {
  const media = { image: null, video: null, resolvedAt: Date.now() };
  if (candidate && candidate.url) {
    const entry = {
      url: candidate.url,
      credit: candidate.credit || "",
      creditUrl: candidate.creditUrl || "",
      license: candidate.license || "",
      source: candidate.source || "",
      verified: true,
    };
    if (candidate.poster) entry.poster = candidate.poster;
    if (candidate.type === "video") media.video = entry;
    else media.image = entry;
  }
  return { ...item, media };
}

// How many items the live fallback path in onRequest resolves media
// for inline before responding: the visible first screen of an edition.
// The background refresh and the manual refresh resolve every item;
// only a first serve trades the tail for latency, and the backfill
// completes it into the same row.
export const FIRST_SERVE_MEDIA_SLICE = 10;

// How many UNCACHED subjects one enrichment pass may fan out on.
// A fan-out is a dozen or more upstream fetches; the invocations this
// pass runs inside (the refresh, a first serve) have already spent
// most of their platform subrequest budget on the feed fetch and the
// citation legs, and the first wave of topical verification resolved
// all 40 items from inside exactly those invocations — every fan-out
// starved, every starved null was cached as a miss, and the edition
// served zero verified media while every per subject resolution
// through /api/image worked. So a pass now spends its few fan-outs
// where they can actually complete (the front of the edition first),
// serves every already cached subject for free, and leaves the rest
// UNRESOLVED — no media key, which the backfill check reads as work
// still owed — instead of stamping them resolved-with-nothing on
// evidence the budget never let anyone gather.
export const MEDIA_FANOUT_PER_BUILD = 3;

// Resolves lead media for every item through the shared /api/image
// pipeline (resolveLeadMedia), which carries its own per-subject cache —
// so the steady-state cost of this pass is one D1 read per item, not nine
// upstream fetches. Items that already carry media are skipped, and one
// item's failure never affects the rest. Concurrency is capped so a cold
// refresh can't open hundreds of upstream connections at once.
export async function enrichTrendingMedia(env, items, { concurrency = 4, maxFanout = MEDIA_FANOUT_PER_BUILD } = {}) {
  const out = (items || []).slice();
  let next = 0;
  let fanoutLeft = maxFanout;
  const worker = async () => {
    while (next < out.length) {
      const i = next++;
      const item = out[i];
      if (!item || (item.media && (item.media.image || item.media.video))) continue;
      // The story's title AND summary ride along as the subject:
      // resolveLeadMedia verifies the winning asset's own metadata
      // against them, so a resolved asset that is about something
      // else entirely never reaches the item (see image.js).
      const subject = { title: item.title || "", summary: item.summary || "" };
      try {
        // Cache first, for free: a fresh row, hit or miss, is a
        // resolution a previous build already paid for.
        const probe = await resolveLeadMedia(env, item.title || "", item.category || "", subject, { cacheOnly: true });
        if (probe.cacheHit) {
          out[i] = attachMedia(item, probe.image);
          continue;
        }
        // Uncached, and this pass is out of fan-out budget: leave the
        // item untouched. Its missing media key is the honest state
        // (not resolved yet), and a later pass picks it up.
        if (fanoutLeft <= 0) continue;
        fanoutLeft--;
        const { image } = await resolveLeadMedia(env, item.title || "", item.category || "", subject);
        out[i] = attachMedia(item, image);
      } catch {
        out[i] = attachMedia(item, null);
      }
    }
  };
  const n = Math.max(1, Math.min(concurrency, out.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

// Backfills media into a cache row that was written without it — the live
// fallback path in onRequest serves the feed immediately (no visitor waits
// for 40 media resolutions) and then enriches the cached copy in the
// background, so the next request serves items with media attached. Never
// throws.
async function backfillTrendingMedia(env) {
  try {
    if (!env.DB) return;
    await ensureTable(env);
    const row = await env.DB.prepare("SELECT payload, fetched_at FROM trending_cache WHERE id = 1").first();
    const parsed = parseCachePayload(row);
    if (!parsed || !isUsableCachePayload(parsed)) return;
    if (parsed.items.every((it) => it && it.media)) return;
    const items = await enrichTrendingMedia(env, parsed.items);
    const body = JSON.stringify({ items, generatedAt: parsed.generatedAt, sourceHealth: parsed.sourceHealth || undefined });
    await env.DB.prepare(
      "INSERT INTO trending_cache (id, payload, fetched_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at"
    ).bind(body, Date.now()).run();
  } catch (e) {
    console.error("Cerebrum trending media backfill failed:", e);
  }
}

let _tableEnsured = false;
async function ensureTable(env) {
  if (_tableEnsured) return;
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS trending_cache (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, fetched_at INTEGER NOT NULL)"
  );
  _tableEnsured = true;
}

export async function onRequest(context) {
  const { request, env, waitUntil } = context;
  const cors = corsHeaders(request, env);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") return errRes("Method not allowed.", 405, "method_not_allowed", cors);
  if (!readOriginAllowed(request, env)) return errRes("Origin not allowed.", 403, "origin_not_allowed", cors);

  // Hashed rate-limit key under a server secret; clientIp() deliberately
  // ignores the client-settable X-Forwarded-For.
  const rlKey = await privacyKey("trending-ip", clientIp(request), env);
  if (!(await checkRateLimit(env, rlKey, RATE_LIMIT, RATE_WINDOW_MS))) {
    return errRes("Too many requests. Please wait a moment and try again.", 429, "rate_limited", { ...cors, "Retry-After": "30" });
  }

  // Past editions are served read only from the archive and never
  // trigger a refresh: asking for yesterday must not rebuild today.
  const editionParam = new URL(request.url).searchParams.get("edition");
  if (editionParam && env.DB) {
    try {
      await ensureEditionsTable(env);
      const row = await env.DB.prepare("SELECT payload, generated_at FROM trending_editions WHERE edition_id = ?").bind(editionParam).first();
      const parsedArchived = row ? parseCachePayload(row) : null;
      if (parsedArchived && Array.isArray(parsedArchived.items) && parsedArchived.items.length) {
        const editions = await listEditions(env);
        return okRes(
          { items: parsedArchived.items, generatedAt: parsedArchived.generatedAt, ...(parsedArchived.sourceHealth ? { sourceHealth: parsedArchived.sourceHealth } : {}), archived: true, edition: editionParam, editions },
          200,
          { ...cors, "Cache-Control": "public, max-age=300", "X-Trending-Source": "archive" }
        );
      }
    } catch (e) {
      console.error("Cerebrum trending archive read failed:", e);
    }
    return errRes("That edition is not in the archive yet.", 404, "edition_not_found", cors);
  }

  let editionsList = [];
  // Serves a cache payload with the consistent { ok: true, ... } shape.
  // The payload is re-serialized (not returned verbatim) so every path out
  // of this endpoint — cache, live, or degraded — carries the same fields.
  const serveCache = (cached, source, extra) => okRes(
    { items: cached.items, generatedAt: cached.generatedAt, stale: source !== "cache", edition: editionIdOf(cached.generatedAt), ...(editionsList.length ? { editions: editionsList } : {}), ...(cached.sourceHealth ? { sourceHealth: cached.sourceHealth } : {}), ...(extra || {}) },
    200,
    {
      ...cors,
      // A stale-but-serving payload gets a short browser TTL so the next
      // visitor picks up the refreshed one promptly.
      "Cache-Control": source === "cache" ? "public, max-age=300" : "public, max-age=60",
      "X-Trending-Source": source,
      "X-Trending-Age": String(Math.round(cached.ageMs / 1000)),
    }
  );

  // ---- Fast path: serve the hourly-refreshed D1 cache ----
  // `lastResort` holds a usable-but-ancient payload: older than
  // MAX_CACHE_AGE_MS, so it is NOT served as the primary answer — but if
  // the live fetch below fails, yesterday's real feed beats a 502 and an
  // empty page. The old behaviour discarded it and failed the request.
  let lastResort = null;
  if (env.DB) {
    try {
      await ensureTable(env);
      const row = await env.DB.prepare("SELECT payload, fetched_at FROM trending_cache WHERE id = 1").first();
      const parsed = parseCachePayload(row);
      if (parsed && isUsableCachePayload(parsed)) {
        const { state, ageMs } = classifyCacheAge(parsed.fetchedAt, Date.now());
        const cached = { ...parsed, ageMs };
        // A row whose items never got media keys is repaired in the
        // background, once per isolate, instead of serving bare rows
        // for the row's whole fresh window.
        if (parsed.items.some((it) => it && !it.media)) scheduleMediaBackfill(env, waitUntil);
        editionsList = await listEditions(env);
        // Make sure today's edition exists in the archive even when the
        // row was written by the manual refresh endpoint, which does
        // not archive on its own. The archive call dedupes per build.
        const archiveBody = JSON.stringify({ items: cached.items, generatedAt: cached.generatedAt, ...(cached.sourceHealth ? { sourceHealth: cached.sourceHealth } : {}) });
        if (typeof waitUntil === "function") waitUntil(archiveEdition(env, archiveBody, cached.generatedAt));
        if (state === "fresh") {
          return serveCache(cached, "cache");
        }
        if (state === "stale") {
          // Past the refresh window but still inside the max age: serve
          // this payload now, and rebuild it after the response has gone
          // out. scheduleRefresh dedups so concurrent visitors in the same
          // window trigger exactly one background refresh per isolate.
          scheduleRefresh(env, waitUntil);
          return serveCache(cached, "cache-revalidating");
        }
        lastResort = cached;
      }
    } catch (e) {
      console.error("Cerebrum trending cache read failed:", e);
      // Fall through to a live fetch below — a broken cache read shouldn't
      // take the whole feed down.
    }
  }

  // ---- Fallback: cache missing, stale, ancient, or no DB bound. Fetch live. ----
  try {
    const feed = await fetchTrendingFeed();
    let items = feed.items;
    const generatedAt = Date.now();
    // Same trend history as the background refresh path, so a live
    // built edition and a cache built one describe their items the
    // same way. Fails soft inside withEditionTrend when the archive
    // cannot be read.
    if (env.DB) items = await withEditionTrend(env, items, generatedAt);
    // First serve of an edition: resolve lead media for the visible
    // slice BEFORE the payload is stored or sent. The old shape sent
    // the whole edition out with no `media` key on any item and let a
    // background backfill race the first reader — the first serve of
    // every cold edition was bare, and if the backfill's isolate died
    // the row stayed bare. Ten items is what a first screen shows
    // (hero, rails, top of the digest); resolving all forty inline
    // would make a cold visitor wait for the whole enrichment, which
    // is the latency this endpoint exists to avoid. The remainder is
    // still completed by the background backfill below, into the same
    // cache row, and the archived edition carries the slice too.
    if (items.length) {
      const head = await enrichTrendingMedia(env, items.slice(0, FIRST_SERVE_MEDIA_SLICE));
      items = [...head, ...items.slice(FIRST_SERVE_MEDIA_SLICE)];
    }
    const body = JSON.stringify({ items, generatedAt, sourceHealth: feed.sourceHealth });
    // Opportunistically warm the cache with this live result too, so the
    // next visitor — and the next hourly refresh, whenever it lands —
    // isn't starting from nothing either. Media enrichment for the
    // items past the first serve slice happens in the background right
    // after: backfillTrendingMedia rewrites the cached row with
    // verified lead media attached to every item, so the following
    // request serves the completed edition. Consumers: a missing
    // `media` key means "not resolved yet" — treat it as no media.
    if (env.DB) {
      const write = env.DB.prepare(
        "INSERT INTO trending_cache (id, payload, fetched_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at"
      ).bind(body, generatedAt).run().catch(() => {});
      const after = write.then(() => backfillTrendingMedia(env)).catch(() => {});
      if (typeof waitUntil === "function") waitUntil(after); else await after;
      await archiveEdition(env, body, generatedAt);
      editionsList = await listEditions(env);
    }
    return okRes({ items, generatedAt, sourceHealth: feed.sourceHealth, edition: editionIdOf(generatedAt), ...(editionsList.length ? { editions: editionsList } : {}) }, 200, { ...cors, "Cache-Control": "public, max-age=300", "X-Trending-Source": "live" });
  } catch (e) {
    console.error("Cerebrum trending endpoint error:", e);
    // Upstream failed. Serve the ancient cache rather than a 5xx when one
    // exists; otherwise a 200 with an empty list and degraded: true. The
    // frontend keeps whatever feed it already had on screen for background
    // polls and only shows its error state on a genuine first-load
    // failure — either way, no visitor ever sees a 502 page here.
    if (lastResort) {
      return serveCache(lastResort, "cache-expired", { degraded: true });
    }
    return okRes({ items: [], generatedAt: null, degraded: true }, 200, cors);
  }
}
