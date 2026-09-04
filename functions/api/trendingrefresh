// Hourly refresh job for the "Trending in Science" feed's D1 cache.
//
// Cloudflare Pages Functions have no scheduled()/cron trigger of their
// own — Cron Triggers are a Workers-only feature (configured on a
// Worker's own wrangler.toml), and Cloudflare's own docs and staff
// guidance on the community forum are explicit that a Pages project needs
// a separate Worker for that, as of this writing. Standing up and
// maintaining a whole second Cloudflare project just to fetch a news feed
// once an hour would be a lot of moving parts for very little — so
// instead, the "clock" lives in this repo's own GitHub Actions, which can
// already run on a schedule for free: .github/workflows/refresh-trending.yml
// calls this endpoint once an hour, and this endpoint does the one thing
// that actually matters, fetch real articles and refresh the cache.
//
// Protected by a shared-secret bearer token (TRENDING_REFRESH_SECRET — set
// as a Cloudflare Pages environment variable, and as a GitHub Actions repo
// secret with the exact same value) so this can't be triggered by anyone
// who stumbles on the URL. It does a real outbound fetch and a database
// write on every call, which is exactly the kind of endpoint that
// shouldn't be left open to the public internet.

import { fetchTrendingItems } from "../lib/trendingSource.js";

let _tableEnsured = false;
async function ensureTable(env) {
  if (_tableEnsured) return;
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS trending_cache (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, fetched_at INTEGER NOT NULL)"
  );
  _tableEnsured = true;
}

function json(data, status) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  // Not a password needing constant-time comparison — it's a shared
  // deploy secret that only ever travels from one GitHub Actions runner to
  // this one endpoint — but a plain strict-equality check still rejects
  // anything that isn't an exact match, including a missing header, an
  // unset secret, or someone guessing at the scheme.
  const auth = request.headers.get("Authorization") || "";
  const expected = env.TRENDING_REFRESH_SECRET || "";
  if (!expected || auth !== `Bearer ${expected}`) {
    return json({ error: "Unauthorized." }, 401);
  }
  if (!env.DB) {
    return json({ error: "No database bound — nothing to refresh into." }, 500);
  }

  try {
    const items = await fetchTrendingItems();
    if (!items.length) {
      // The source returned nothing usable this run — leave whatever's
      // already cached in place rather than overwriting a good feed with
      // an empty one. The next hourly run gets another try.
      return json({ ok: false, reason: "Source returned no usable articles; existing cache left unchanged." }, 502);
    }
    const payload = JSON.stringify({ items, generatedAt: Date.now() });
    await ensureTable(env);
    await env.DB.prepare(
      "INSERT INTO trending_cache (id, payload, fetched_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at"
    ).bind(payload, Date.now()).run();
    return json({ ok: true, count: items.length, generatedAt: Date.now() }, 200);
  } catch (e) {
    console.error("Cerebrum trending-refresh error:", e);
    return json({ ok: false, error: "Refresh failed: " + ((e && e.message) || String(e)) }, 502);
  }
}
