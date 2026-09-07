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

// Refreshes the cache row from upstream. Never throws — this runs
// detached via waitUntil() where a rejection has nobody to catch it, and
// a failed background refresh must not affect the response already sent.
async function refreshCache(env) {
  try {
    const items = await fetchTrendingItems();
    if (!Array.isArray(items) || items.length === 0) return;
    const body = JSON.stringify({ items, generatedAt: Date.now() });
    await env.DB.prepare(
      "INSERT INTO trending_cache (id, payload, fetched_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at"
    ).bind(body, Date.now()).run();
  } catch (e) {
    console.error("Cerebrum trending background refresh failed:", e);
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
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: cors });
  if (!readOriginAllowed(request, env)) return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers: cors });

  const clientIP = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  if (!(await checkRateLimit(env, `trending:${clientIP}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }), { status: 429, headers: { ...cors, "Retry-After": "30" } });
  }

  // ---- Fast path: serve the hourly-refreshed D1 cache ----
  if (env.DB) {
    try {
      await ensureTable(env);
      const row = await env.DB.prepare("SELECT payload, fetched_at FROM trending_cache WHERE id = 1").first();
      // Commit 61 — a cached payload from the OLD single-source feed is
      // still "fresh" by age but is 100% space news, so broadening the
      // sources changed nothing on screen: every visitor kept being served
      // the pre-existing cache row until it aged out, and the hourly job
      // that would replace it may not be running at all. Age alone is the
      // wrong staleness test after a source change; the shape of the data
      // is the real one. Items from the multi-discipline feed carry a
      // `category`, so a cached payload without one is by definition from
      // the old feed and gets discarded no matter how recent it is.
      let cacheUsable = false;
      if (row && row.payload && Date.now() - row.fetched_at < MAX_CACHE_AGE_MS) {
        try {
          const parsed = JSON.parse(row.payload);
          const list = Array.isArray(parsed && parsed.items) ? parsed.items : [];
          cacheUsable = list.length > 0 && list.some((x) => x && x.category);
        } catch { cacheUsable = false; }
      }
      if (cacheUsable) {
        // Past the refresh window but still inside the max age: serve this
        // payload now, and rebuild it after the response has been sent.
        const age = Date.now() - row.fetched_at;
        const stale = age > REFRESH_AFTER_MS;
        if (stale && typeof waitUntil === "function") waitUntil(refreshCache(env));
        return new Response(row.payload, {
          status: 200,
          headers: {
            ...cors,
            // A stale-but-serving payload gets a short browser TTL so the
            // next visitor picks up the refreshed one promptly.
            "Cache-Control": stale ? "public, max-age=60" : "public, max-age=300",
            "X-Trending-Source": stale ? "cache-revalidating" : "cache",
            "X-Trending-Age": String(Math.round(age / 1000)),
          },
        });
      }
    } catch (e) {
      console.error("Cerebrum trending cache read failed:", e);
      // Fall through to a live fetch below — a broken cache read shouldn't
      // take the whole feed down.
    }
  }

  // ---- Fallback: cache missing, stale, or no DB bound. Fetch live. ----
  try {
    const items = await fetchTrendingItems();
    const body = JSON.stringify({ items, generatedAt: Date.now() });
    // Opportunistically warm the cache with this live result too, so the
    // next visitor — and the next hourly refresh, whenever it lands —
    // isn't starting from nothing either.
    if (env.DB) {
      const write = env.DB.prepare(
        "INSERT INTO trending_cache (id, payload, fetched_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at"
      ).bind(body, Date.now()).run().catch(() => {});
      if (typeof waitUntil === "function") waitUntil(write); else await write;
    }
    return new Response(body, { status: 200, headers: { ...cors, "Cache-Control": "public, max-age=300", "X-Trending-Source": "live" } });
  } catch (e) {
    console.error("Cerebrum trending endpoint error:", e);
    return new Response(JSON.stringify({ error: "Couldn't load the trending feed right now. Please try again shortly.", items: [] }), { status: 502, headers: cors });
  }
}
