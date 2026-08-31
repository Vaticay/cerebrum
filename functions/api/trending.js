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
// This now reads from a small D1 cache row that a separate hourly job
// (trending-refresh.js, triggered by a GitHub Actions cron once an hour —
// see that file and .github/workflows/refresh-trending.yml) keeps warm.
// Every visitor gets the same already-fetched feed, and "updates every
// hour" is an actual guarantee from a real clock, not a side effect of
// cache TTLs. If that cache is ever missing or old enough that something
// has clearly gone wrong with the hourly job, this falls back to a live
// fetch — same as the old behavior — so a missed refresh degrades
// gracefully instead of leaving the page broken.
//
// Labeled "Preview" on screen, not "Fact-Checked": unlike a single search
// answer, nothing here has gone through Cerebrum's own fact-check pass —
// this is a live feed of other outlets' reporting, not Cerebrum's own
// verified output. See TrendingView in src/main.jsx for exactly how that's
// worded on screen.

import { checkRateLimit } from "../lib/rateLimit.js";
import { fetchTrendingItems } from "../lib/trendingSource.js";

const ALLOWED_ORIGINS = [
  "https://askcerebrum.org",
  "https://www.askcerebrum.org",
  "https://cerebrum-2pz.pages.dev",
];
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.cerebrum-2pz\.pages\.dev$/i;
function originAllowed(request) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return true;
  return ALLOWED_ORIGINS.some((o) => origin === o) || PAGES_PREVIEW_RE.test(origin);
}

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60000;

// If the cached row is older than this, treat it as if it doesn't exist.
// The hourly refresh should be repopulating it every 60 minutes, so
// anything this stale means that job has been failing for a while, not
// just running a few minutes behind schedule.
const MAX_CACHE_AGE_MS = 90 * 60 * 1000; // 90 minutes

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
  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin = ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin) ? reqOrigin : "https://askcerebrum.org";
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: cors });
  if (!originAllowed(request)) return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers: cors });

  const clientIP = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  if (!(await checkRateLimit(env, `trending:${clientIP}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }), { status: 429, headers: { ...cors, "Retry-After": "30" } });
  }

  // ---- Fast path: serve the hourly-refreshed D1 cache ----
  if (env.DB) {
    try {
      await ensureTable(env);
      const row = await env.DB.prepare("SELECT payload, fetched_at FROM trending_cache WHERE id = 1").first();
      if (row && row.payload && Date.now() - row.fetched_at < MAX_CACHE_AGE_MS) {
        return new Response(row.payload, {
          status: 200,
          headers: { ...cors, "Cache-Control": "public, max-age=300", "X-Trending-Source": "cache" },
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
