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
// verified output. See TrendingView in src/main.jsx for exactly how that's
// worded on screen.

import { corsHeaders, readOriginAllowed, requireTrustedOrigin, forbiddenOrigin, clientIp, privacyKey } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { fetchTrendingItems } from "../lib/trendingSource.js";
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

// Refreshes the cache row from upstream. Never throws — this runs
// detached via waitUntil() where a rejection has nobody to catch it, and
// a failed background refresh must not affect the response already sent.
async function refreshCache(env) {
  try {
    let items = await fetchTrendingItems();
    if (!Array.isArray(items) || items.length === 0) return;
    // Every item leaves here carrying verified lead media (or an honest
    // empty) — see attachMedia/enrichTrendingMedia below. This is the pass
    // that puts pictures back on the biology/medicine/preprint/physics
    // cards: those sources ship no thumbnails of their own, so without this
    // enrichment three quarters of the feed can never have lead media.
    items = await enrichTrendingMedia(env, items);
    const body = JSON.stringify({ items, generatedAt: Date.now() });
    await env.DB.prepare(
      "INSERT INTO trending_cache (id, payload, fetched_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at"
    ).bind(body, Date.now()).run();
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

// Resolves lead media for every item through the shared /api/image
// pipeline (resolveLeadMedia), which carries its own per-subject cache —
// so the steady-state cost of this pass is one D1 read per item, not nine
// upstream fetches. Items that already carry media are skipped, and one
// item's failure never affects the rest. Concurrency is capped so a cold
// refresh can't open hundreds of upstream connections at once.
export async function enrichTrendingMedia(env, items, { concurrency = 4 } = {}) {
  const out = (items || []).slice();
  let next = 0;
  const worker = async () => {
    while (next < out.length) {
      const i = next++;
      const item = out[i];
      if (!item || (item.media && (item.media.image || item.media.video))) continue;
      try {
        const { image } = await resolveLeadMedia(env, item.title || "", item.category || "");
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
    const body = JSON.stringify({ items, generatedAt: parsed.generatedAt });
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

  const clientIP = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  if (!(await checkRateLimit(env, `trending:${clientIP}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return errRes("Too many requests. Please wait a moment and try again.", 429, "rate_limited", { ...cors, "Retry-After": "30" });
  }

  // Serves a cache payload with the consistent { ok: true, ... } shape.
  // The payload is re-serialized (not returned verbatim) so every path out
  // of this endpoint — cache, live, or degraded — carries the same fields.
  const serveCache = (cached, source, extra) => okRes(
    { items: cached.items, generatedAt: cached.generatedAt, stale: source !== "cache", ...(extra || {}) },
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
    const items = await fetchTrendingItems();
    const generatedAt = Date.now();
    const body = JSON.stringify({ items, generatedAt });
    // Opportunistically warm the cache with this live result too, so the
    // next visitor — and the next hourly refresh, whenever it lands —
    // isn't starting from nothing either. Media enrichment happens in the
    // background right after: the response goes out immediately with the
    // items as fetched (no `media` key yet), and backfillTrendingMedia
    // rewrites the cached row with verified lead media attached, so the
    // following request serves it. Consumers: a missing `media` key means
    // "not resolved yet" — treat it as no media.
    if (env.DB) {
      const write = env.DB.prepare(
        "INSERT INTO trending_cache (id, payload, fetched_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at"
      ).bind(body, generatedAt).run().catch(() => {});
      const after = write.then(() => backfillTrendingMedia(env)).catch(() => {});
      if (typeof waitUntil === "function") waitUntil(after); else await after;
    }
    return okRes({ items, generatedAt }, 200, { ...cors, "Cache-Control": "public, max-age=300", "X-Trending-Source": "live" });
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
