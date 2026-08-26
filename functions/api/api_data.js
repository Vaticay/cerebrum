// Per-account data endpoint: GET /api/data?resource=saved|collections|history
// and POST /api/data (action-multiplexed by { resource, action, ...payload })
// for everything that mutates it. This is what a signed-in user's Saved
// articles / Collections / History switch to instead of localStorage — see
// the frontend's `useServerData` in src/main.jsx for the client side.
//
// Every single handler below starts by resolving the session and rejecting
// with 401 if there isn't one — there is no "read someone else's data by
// guessing an id" path here, because every query is also scoped to
// `user_id = ?` on top of the row id, not just the row id alone.

import { getSessionUser, newId } from "../lib/auth.js";

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

const RATE_BUCKET = new Map();
function rateLimit(ip, limit = 60, windowMs = 60000) {
  const now = Date.now();
  const rec = RATE_BUCKET.get(ip) || [];
  const recent = rec.filter((t) => now - t < windowMs);
  recent.push(now);
  RATE_BUCKET.set(ip, recent);
  if (RATE_BUCKET.size > 8000) {
    for (const [k, v] of RATE_BUCKET) if (v.every((t) => now - t > windowMs)) RATE_BUCKET.delete(k);
  }
  return recent.length <= limit;
}

const MAX_SAVED_PER_USER = 2000;
const MAX_COLLECTIONS_PER_USER = 200;
const MAX_HISTORY_PER_USER = 500;
const MAX_SOURCE_JSON_LEN = 20000;
const MAX_TURNS_JSON_LEN = 500000;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin =
    ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin) ? reqOrigin : "https://askcerebrum.org";
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!originAllowed(request)) return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers: cors });
  if (!env.DB) return new Response(JSON.stringify({ error: "Accounts are not configured on this deployment." }), { status: 503, headers: cors });

  const clientIP = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  if (!rateLimit(clientIP)) {
    return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment." }), { status: 429, headers: { ...cors, "Retry-After": "20" } });
  }

  const user = await getSessionUser(request, env);
  if (!user) return new Response(JSON.stringify({ error: "Sign in first." }), { status: 401, headers: cors });

  try {
    if (request.method === "GET") {
      const resource = url.searchParams.get("resource");
      if (resource === "saved") {
        const rows = await env.DB.prepare(
          "SELECT id, collection_id, source_json, created_at FROM user_saved_sources WHERE user_id = ? ORDER BY created_at DESC"
        ).bind(user.id).all();
        const items = (rows.results || []).map((r) => {
          let source = {};
          try { source = JSON.parse(r.source_json); } catch {}
          return { id: r.id, collectionId: r.collection_id, createdAt: r.created_at, ...source };
        });
        return new Response(JSON.stringify({ items }), { status: 200, headers: cors });
      }
      if (resource === "collections") {
        const rows = await env.DB.prepare(
          "SELECT id, name, created_at FROM user_collections WHERE user_id = ? ORDER BY created_at ASC"
        ).bind(user.id).all();
        return new Response(JSON.stringify({ items: rows.results || [] }), { status: 200, headers: cors });
      }
      if (resource === "history") {
        const rows = await env.DB.prepare(
          "SELECT id, title, turns_json, created_at, updated_at FROM user_history WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200"
        ).bind(user.id).all();
        const items = (rows.results || []).map((r) => {
          // turns_json actually holds { turns, allSources } — see the
          // "history"/"replace-all" write path below. Named for the
          // original column purpose; kept as-is rather than adding a
          // migration for a rename that doesn't change behavior.
          let blob = { turns: [], allSources: [] };
          try { blob = JSON.parse(r.turns_json); } catch {}
          return { id: r.id, title: r.title, turns: blob.turns || [], allSources: blob.allSources || [], createdAt: r.created_at, updatedAt: r.updated_at };
        });
        return new Response(JSON.stringify({ items }), { status: 200, headers: cors });
      }
      return new Response(JSON.stringify({ error: "Unknown resource." }), { status: 400, headers: cors });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: cors });
    }

    const body = await request.json().catch(() => ({}));
    const resource = body && body.resource;
    const action = body && body.action;

    // Whole-array sync used by the frontend's debounced "push local state to
    // my account" effect — simpler and more robust than diffing add/remove
    // client-side against server ids, and cheap at the scale one person's
    // saved-articles list actually reaches. Existing collection assignments
    // are preserved by id where the client still has that collectionId;
    // anything else lands uncategorized rather than erroring.
    if (resource === "saved" && action === "replace-all") {
      const items = Array.isArray(body.items) ? body.items.slice(0, MAX_SAVED_PER_USER) : [];
      const now = Date.now();
      const validCollections = new Set(
        (await env.DB.prepare("SELECT id FROM user_collections WHERE user_id = ?").bind(user.id).all()).results?.map((r) => r.id) || []
      );
      const stmts = [env.DB.prepare("DELETE FROM user_saved_sources WHERE user_id = ?").bind(user.id)];
      for (const item of items) {
        const { collectionId, ...source } = item || {};
        const sourceJson = JSON.stringify(source);
        if (sourceJson.length > MAX_SOURCE_JSON_LEN) continue;
        stmts.push(env.DB.prepare("INSERT INTO user_saved_sources (id, user_id, collection_id, source_json, created_at) VALUES (?, ?, ?, ?, ?)")
          .bind(newId("src"), user.id, validCollections.has(collectionId) ? collectionId : null, sourceJson, now));
      }
      await env.DB.batch(stmts);
      return new Response(JSON.stringify({ ok: true, count: items.length }), { status: 200, headers: cors });
    }

    if (resource === "history" && action === "replace-all") {
      const items = Array.isArray(body.items) ? body.items.slice(0, MAX_HISTORY_PER_USER) : [];
      const now = Date.now();
      const stmts = [env.DB.prepare("DELETE FROM user_history WHERE user_id = ?").bind(user.id)];
      for (const item of items) {
        const turnsJson = JSON.stringify({ turns: item?.turns || [], allSources: item?.allSources || [] });
        if (turnsJson.length > MAX_TURNS_JSON_LEN) continue;
        const title = (item?.title || "").toString().slice(0, 300);
        const ts = Number(item?.ts) || now;
        stmts.push(env.DB.prepare("INSERT INTO user_history (id, user_id, title, turns_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(newId("hist"), user.id, title, turnsJson, ts, ts));
      }
      await env.DB.batch(stmts);
      return new Response(JSON.stringify({ ok: true, count: items.length }), { status: 200, headers: cors });
    }

    if (resource === "collections" && action === "create") {
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_collections WHERE user_id = ?").bind(user.id).first();
      if ((count?.n || 0) >= MAX_COLLECTIONS_PER_USER) return new Response(JSON.stringify({ error: "Collection limit reached." }), { status: 400, headers: cors });
      const name = (body.name || "").toString().trim().slice(0, 80);
      if (!name) return new Response(JSON.stringify({ error: "Name a collection first." }), { status: 400, headers: cors });
      const id = newId("col");
      await env.DB.prepare("INSERT INTO user_collections (id, user_id, name, created_at) VALUES (?, ?, ?, ?)")
        .bind(id, user.id, name, Date.now()).run();
      return new Response(JSON.stringify({ id, name }), { status: 200, headers: cors });
    }

    if (resource === "collections" && action === "rename") {
      const name = (body.name || "").toString().trim().slice(0, 80);
      if (!name) return new Response(JSON.stringify({ error: "Name can't be empty." }), { status: 400, headers: cors });
      await env.DB.prepare("UPDATE user_collections SET name = ? WHERE id = ? AND user_id = ?").bind(name, body.id, user.id).run();
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
    }

    if (resource === "collections" && action === "delete") {
      // Sources that were in this collection become uncategorized rather
      // than being deleted along with it.
      await env.DB.batch([
        env.DB.prepare("UPDATE user_saved_sources SET collection_id = NULL WHERE collection_id = ? AND user_id = ?").bind(body.id, user.id),
        env.DB.prepare("DELETE FROM user_collections WHERE id = ? AND user_id = ?").bind(body.id, user.id),
      ]);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
    }

    return new Response(JSON.stringify({ error: "Unknown resource/action." }), { status: 400, headers: cors });
  } catch (e) {
    console.error("Cerebrum data endpoint error:", e);
    return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), { status: 500, headers: cors });
  }
}
