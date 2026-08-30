// Per-account data endpoint: GET /api/data?resource=saved|collections|history
// |profile|inbox|thread, and POST /api/data (action-multiplexed by
// { resource, action, ...payload } for saved/collections/history, or a bare
// { action, ...payload } for update-profile/toggle-follow/send-message — see
// the comment further down where those three are defined). This is what a
// signed-in user's Saved articles / Collections / History / Profile / Inbox
// switch to instead of localStorage or local-only component state — see
// apiDataGet/apiDataPost/apiDataAction in src/main.jsx for the client side.
//
// Every single handler below starts by resolving the session and rejecting
// with 401 if there isn't one — there is no "read someone else's data by
// guessing an id" path here, because every query is also scoped to
// `user_id = ?` on top of the row id, not just the row id alone.

import { getSessionUser, newId, ensureUserProfileColumns, ensureSocialTables } from "../lib/authHelpers.js";
import { checkRateLimit } from "../lib/rateLimit.js";

const MAX_MESSAGE_LEN = 4000;
const MAX_NAME_LEN = 120;
const MAX_USERNAME_LEN = 40;
const MAX_AFFILIATION_LEN = 200;
// A 256x256 JPEG comes back from the client-side canvas compressor at
// roughly 15-50KB before base64's ~4/3 inflation, so this leaves generous
// headroom for a lower-quality/less-compressible image while still
// rejecting anything that isn't actually a compressed 256x256 thumbnail
// (a full-res photo someone points a hand-rolled client at, for instance).
const MAX_AVATAR_BASE64_LEN = 300000;

// The live social tables declare their timestamp columns DATETIME DEFAULT
// CURRENT_TIMESTAMP (a SQLite string default), but every write this file
// makes supplies an explicit epoch-ms integer instead, matching the epoch
// convention every other table in this codebase already uses (otp_codes,
// sessions, user_history, …). That keeps rows THIS code writes consistent,
// but can't guarantee some row wasn't inserted a different way before this
// code ever ran (e.g. a manually seeded test row that fell through to the
// column's own string default). This normalizes either shape to a number
// so a stray ISO-string timestamp can't silently break a numeric sort.
function toEpochMs(v) {
  if (typeof v === "number") return v;
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

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

const DATA_RATE_LIMIT = 60;
const DATA_RATE_WINDOW_MS = 60000;

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
  if (!(await checkRateLimit(env, `data:${clientIP}`, DATA_RATE_LIMIT, DATA_RATE_WINDOW_MS))) {
    return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment." }), { status: 429, headers: { ...cors, "Retry-After": "20" } });
  }

  const user = await getSessionUser(request, env);
  if (!user) return new Response(JSON.stringify({ error: "Sign in first." }), { status: 401, headers: cors });

  try {
    // Self-healing, memoized per isolate after the first real call — see
    // the comment above these two in functions/lib/authHelpers.js. Cheap
    // to call unconditionally rather than threading it into only the
    // branches that need it, since every call after the first is a no-op.
    await ensureUserProfileColumns(env);
    await ensureSocialTables(env);

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
      // Your own profile: base row from `users` plus a computed follower
      // count and whatever accolades actually exist for you in the DB.
      // Deliberately "your own" only — a version of this that takes a
      // target user id would need its own thinking about which columns
      // are safe to expose about someone ELSE (email stays private to its
      // owner; username/name/affiliation are the public-profile fields),
      // which is a real design question the spec for this round didn't
      // raise, so it's not being guessed at here.
      if (resource === "profile") {
        const row = await env.DB.prepare(
          "SELECT id, email, username, name, affiliation, avatar_base64 FROM users WHERE id = ?"
        ).bind(user.id).first();
        if (!row) return new Response(JSON.stringify({ error: "Account not found." }), { status: 404, headers: cors });
        const followerCount = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM follows WHERE following_id = ?"
        ).bind(user.id).first();
        const badgeRows = await env.DB.prepare(
          "SELECT badge_type FROM accolades WHERE user_id = ? ORDER BY granted_at ASC"
        ).bind(user.id).all();
        return new Response(JSON.stringify({
          user: { id: row.id, email: row.email, username: row.username, name: row.name, affiliation: row.affiliation, avatar_base64: row.avatar_base64 || null },
          followers: followerCount?.n || 0,
          badges: (badgeRows.results || []).map((b) => b.badge_type),
        }), { status: 200, headers: cors });
      }

      // Inbox: every thread you're a participant in, with its most recent
      // message. N+1 queries (one per thread for the last message, plus
      // one more for a DM's display name) — genuinely worse than a single
      // join, but this stage of the Multiplayer Network has a handful of
      // threads per person at most, and clarity here beats a cleverer
      // query that's harder to verify against the actual schema. Worth
      // revisiting with a real join if thread counts ever grow.
      if (resource === "inbox") {
        const threadRows = await env.DB.prepare(
          `SELECT t.id, t.kind, t.name FROM threads t
           JOIN thread_participants tp ON tp.thread_id = t.id
           WHERE tp.user_id = ?`
        ).bind(user.id).all();
        const items = [];
        for (const t of threadRows.results || []) {
          const last = await env.DB.prepare(
            "SELECT sender_id, text, attachment_title, created_at FROM messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1"
          ).bind(t.id).first();
          let displayName = t.name;
          if (!displayName && t.kind === "dm") {
            const other = await env.DB.prepare(
              `SELECT u.name, u.username, u.email FROM thread_participants tp
               JOIN users u ON u.id = tp.user_id
               WHERE tp.thread_id = ? AND tp.user_id != ?`
            ).bind(t.id, user.id).first();
            displayName = other ? (other.name || other.username || other.email) : "Conversation";
          }
          items.push({
            id: t.id,
            kind: t.kind,
            name: displayName || "Conversation",
            lastMessage: last ? {
              text: last.text,
              attachmentTitle: last.attachment_title || null,
              senderId: last.sender_id,
              createdAt: toEpochMs(last.created_at),
              mine: last.sender_id === user.id,
            } : null,
          });
        }
        items.sort((a, b) => (b.lastMessage?.createdAt || 0) - (a.lastMessage?.createdAt || 0));
        return new Response(JSON.stringify({ items }), { status: 200, headers: cors });
      }
      // A single thread's full message history — get-inbox above only ever
      // returns the most recent message per thread (that's what a thread
      // list needs), so opening a conversation needs its own fetch. Same
      // membership guard as send-message: no row in thread_participants for
      // this thread and this user means a 403, not a peek at someone else's
      // conversation.
      if (resource === "thread") {
        const threadId = (url.searchParams.get("thread_id") || "").toString();
        if (!threadId) return new Response(JSON.stringify({ error: "Missing thread_id." }), { status: 400, headers: cors });
        const membership = await env.DB.prepare(
          "SELECT 1 FROM thread_participants WHERE thread_id = ? AND user_id = ?"
        ).bind(threadId, user.id).first();
        if (!membership) return new Response(JSON.stringify({ error: "You're not part of that conversation." }), { status: 403, headers: cors });
        const threadRow = await env.DB.prepare("SELECT id, kind, name FROM threads WHERE id = ?").bind(threadId).first();
        if (!threadRow) return new Response(JSON.stringify({ error: "That conversation no longer exists." }), { status: 404, headers: cors });
        const participantRows = await env.DB.prepare(
          `SELECT u.id, u.name, u.username, u.email, u.affiliation FROM thread_participants tp
           JOIN users u ON u.id = tp.user_id
           WHERE tp.thread_id = ?`
        ).bind(threadId).all();
        const participants = participantRows.results || [];
        const byId = new Map(participants.map((p) => [p.id, p]));
        const displayNameFor = (p) => (p ? (p.name || p.username || p.email) : "Someone");
        let name = threadRow.name;
        let otherEmail = null;
        let otherAffiliation = null;
        if (!name && threadRow.kind === "dm") {
          const other = participants.find((p) => p.id !== user.id);
          name = other ? displayNameFor(other) : "Conversation";
          otherEmail = other?.email || null;
          otherAffiliation = other?.affiliation || null;
        }
        // Every message's sender is guaranteed to be a thread participant
        // (send-message enforces that on the way in), so the participant
        // rows already fetched above double as the sender-lookup table —
        // no extra per-message query needed for the "who said this" label.
        const messageRows = await env.DB.prepare(
          "SELECT id, sender_id, text, attachment_title, created_at FROM messages WHERE thread_id = ? ORDER BY created_at ASC"
        ).bind(threadId).all();
        const messages = (messageRows.results || []).map((m) => ({
          id: m.id,
          senderId: m.sender_id,
          mine: m.sender_id === user.id,
          text: m.text,
          attachmentTitle: m.attachment_title || null,
          createdAt: toEpochMs(m.created_at),
          who: displayNameFor(byId.get(m.sender_id)),
        }));
        return new Response(JSON.stringify({
          id: threadRow.id,
          kind: threadRow.kind,
          name: name || "Conversation",
          memberCount: participants.length,
          otherEmail,
          otherAffiliation,
          messages,
        }), { status: 200, headers: cors });
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

    if (resource === "collections" && (action === "rename" || action === "delete")) {
      // Both actions bind body.id straight into a D1 query — guard it here
      // once rather than in each branch. An absent/non-string id used to
      // reach .bind() as `undefined`, which D1 can reject outright, turning
      // a simple "no id was sent" mistake into an opaque 500 instead of a
      // clear 400.
      const collectionId = (body.id || "").toString();
      if (!collectionId) return new Response(JSON.stringify({ error: "Missing collection id." }), { status: 400, headers: cors });

      if (action === "rename") {
        const name = (body.name || "").toString().trim().slice(0, 80);
        if (!name) return new Response(JSON.stringify({ error: "Name can't be empty." }), { status: 400, headers: cors });
        await env.DB.prepare("UPDATE user_collections SET name = ? WHERE id = ? AND user_id = ?").bind(name, collectionId, user.id).run();
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
      }

      // action === "delete" — sources that were in this collection become
      // uncategorized rather than being deleted along with it.
      await env.DB.batch([
        env.DB.prepare("UPDATE user_saved_sources SET collection_id = NULL WHERE collection_id = ? AND user_id = ?").bind(collectionId, user.id),
        env.DB.prepare("DELETE FROM user_collections WHERE id = ? AND user_id = ?").bind(collectionId, user.id),
      ]);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
    }

    // ═══════════════════════════════════════════════════════════════════
    // Multiplayer Academic Network — these three use a bare `action` field
    // (no `resource`), matching functions/api/auth.js's own dispatch shape
    // rather than the resource+action pairs above, since they're the same
    // single-verb actions a future frontend would call the same way it
    // already calls apiAuth("send-code", …).
    // ═══════════════════════════════════════════════════════════════════

    if (action === "update-profile") {
      const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME_LEN) : undefined;
      // An empty string after trimming means "clear it" — stored as NULL,
      // never as "", since `username` is UNIQUE and SQLite only treats NULL
      // (not "") as exempt from that constraint. Two people both clearing
      // their username to "" would otherwise collide with each other.
      let username = typeof body.username === "string" ? body.username.trim().replace(/^@+/, "").slice(0, MAX_USERNAME_LEN) : undefined;
      if (username === "") username = null;
      const affiliation = typeof body.affiliation === "string" ? body.affiliation.trim().slice(0, MAX_AFFILIATION_LEN) : undefined;
      // `null` (explicit removal) is a valid value here too, so this can't
      // use the same `typeof === "string" ? … : undefined` shape as the
      // text fields above — `undefined` still means "leave it alone."
      let avatarBase64;
      if (body.avatar_base64 === null) {
        avatarBase64 = null;
      } else if (typeof body.avatar_base64 === "string") {
        if (body.avatar_base64.length > MAX_AVATAR_BASE64_LEN) {
          return new Response(JSON.stringify({ error: "Image is too large. Try a smaller photo." }), { status: 400, headers: cors });
        }
        if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(body.avatar_base64)) {
          return new Response(JSON.stringify({ error: "Unsupported image format." }), { status: 400, headers: cors });
        }
        avatarBase64 = body.avatar_base64;
      }
      const sets = [];
      const binds = [];
      if (name !== undefined) { sets.push("name = ?"); binds.push(name); }
      if (username !== undefined) { sets.push("username = ?"); binds.push(username); }
      if (affiliation !== undefined) { sets.push("affiliation = ?"); binds.push(affiliation); }
      if (avatarBase64 !== undefined) { sets.push("avatar_base64 = ?"); binds.push(avatarBase64); }
      if (!sets.length) return new Response(JSON.stringify({ error: "Nothing to update." }), { status: 400, headers: cors });
      binds.push(user.id);
      try {
        await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
      } catch (e) {
        if (username !== undefined && username !== null && /UNIQUE constraint failed:\s*users\.username/i.test(String(e && e.message))) {
          return new Response(JSON.stringify({ error: "That username is already taken." }), { status: 409, headers: cors });
        }
        throw e;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
    }

    if (action === "toggle-follow") {
      // Wire format keeps `target_id` (matching the original spec) even
      // though the live column is `following_id` — that's a DB-shape
      // detail, not something the frontend needs to know about.
      const targetId = (body.target_id || "").toString();
      if (!targetId) return new Response(JSON.stringify({ error: "Missing target_id." }), { status: 400, headers: cors });
      // Not in the literal spec, but following yourself isn't a real
      // action — worth rejecting outright rather than letting it silently
      // inflate your own follower count.
      if (targetId === user.id) return new Response(JSON.stringify({ error: "You can't follow yourself." }), { status: 400, headers: cors });
      const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(targetId).first();
      if (!target) return new Response(JSON.stringify({ error: "That account doesn't exist." }), { status: 404, headers: cors });
      const existing = await env.DB.prepare(
        "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?"
      ).bind(user.id, targetId).first();
      if (existing) {
        await env.DB.prepare("DELETE FROM follows WHERE follower_id = ? AND following_id = ?").bind(user.id, targetId).run();
      } else {
        await env.DB.prepare("INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)").bind(user.id, targetId, Date.now()).run();
      }
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM follows WHERE following_id = ?").bind(targetId).first();
      return new Response(JSON.stringify({ following: !existing, followers: count?.n || 0 }), { status: 200, headers: cors });
    }

    if (action === "send-message") {
      const threadId = (body.thread_id || "").toString();
      const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_MESSAGE_LEN) : "";
      // attachment_title wasn't in the original spec — it's a real column
      // on the live `messages` table this code wasn't using at all, and it
      // maps directly onto the paper-attachment card the Inbox preview in
      // main.jsx already renders (INITIAL_INBOX_THREADS' Dr. Chen message).
      // Optional: a message can carry text, an attachment, or both, but
      // not neither.
      const attachmentTitle = typeof body.attachment_title === "string" ? body.attachment_title.trim().slice(0, 300) : "";
      if (!threadId || (!text && !attachmentTitle)) {
        return new Response(JSON.stringify({ error: "Missing thread_id, or a message needs text or an attachment." }), { status: 400, headers: cors });
      }
      // Not in the literal spec, but load-bearing: without this, any
      // signed-in user who knew or guessed a thread_id could post into a
      // conversation they were never part of. Every other endpoint in this
      // file scopes its query to `user_id = ?` for the same reason — this
      // is that same rule applied to a table shaped differently (membership
      // via a join table instead of a user_id column on the row itself).
      const membership = await env.DB.prepare(
        "SELECT 1 FROM thread_participants WHERE thread_id = ? AND user_id = ?"
      ).bind(threadId, user.id).first();
      if (!membership) return new Response(JSON.stringify({ error: "You're not part of that conversation." }), { status: 403, headers: cors });
      const now = Date.now();
      // messages.id is a plain TEXT primary key on the live table (no
      // autoincrement) — has to be generated here, same as accolades.id in
      // auth.js's verify-code.
      await env.DB.prepare(
        "INSERT INTO messages (id, thread_id, sender_id, text, attachment_title, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(newId("msg"), threadId, user.id, text || null, attachmentTitle || null, now).run();
      return new Response(JSON.stringify({
        ok: true,
        message: { text, attachmentTitle: attachmentTitle || null, senderId: user.id, createdAt: now, mine: true },
      }), { status: 200, headers: cors });
    }

    return new Response(JSON.stringify({ error: "Unknown resource/action." }), { status: 400, headers: cors });
  } catch (e) {
    console.error("Cerebrum data endpoint error:", e);
    return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), { status: 500, headers: cors });
  }
}
