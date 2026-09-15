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

import { getSessionUser, newId, ensureUserProfileColumns, ensureSocialTables, isBlockedPair } from "../lib/authHelpers.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { maybeSweep } from "../lib/retention.js";
import { safeUrl, cleanString, safeId, safeInt, LIMITS } from "../lib/validate.js";
import { clientIp, privacyKey, requireTrustedOrigin, corsHeaders, readOriginAllowed, readJsonBody } from "../lib/http.js";

const MAX_MESSAGE_LEN = 4000;
const MAX_NAME_LEN = 120;
const MAX_USERNAME_LEN = 40;
const MAX_AFFILIATION_LEN = 200;
const MAX_DEGREE_LEN = 120;
const MAX_GRAD_YEAR_LEN = 9; // "2024" or a range like "2020-2024"
// Commit 75 — profile fields.
const MAX_BIO_LEN = 400;
const MAX_LINK_LEN = 300;
// Covers are a fixed set of named designs, not free input — a profile
// cover is rendered on a public page, so the value has to be something the
// client can only choose from, never something it can compose.
const ALLOWED_COVERS = new Set([
  "aurora", "graphite", "ember", "abyss", "moss", "violet", "sandstone", "signal",
]);
const MAX_REPORT_REASON_LEN = 100;
const MAX_REPORT_NOTE_LEN = 1000;
// A 256x256 JPEG comes back from the client-side canvas compressor at
// roughly 15-50KB before base64's ~4/3 inflation, so this leaves generous
// headroom for a lower-quality/less-compressible image while still
// rejecting anything that isn't actually a compressed 256x256 thumbnail
// (a full-res photo someone points a hand-rolled client at, for instance).
const MAX_AVATAR_BASE64_LEN = 300000;
// Commit 56 — an attachment's blob rides on the message row as a base64
// data URL. A D1 row tops out around 1MB, so this is the ceiling that keeps
// a send from failing at the database rather than at the door: the client
// compresses images and caps voice-note length before it ever posts (see
// the composer in src/main.jsx), and anything still over this is refused
// with a message a person can act on instead of a 500.
const MAX_ATTACHMENT_DATA_LEN = 700000;
const MAX_ATTACHMENT_URL_LEN = 600;
const MAX_ATTACHMENT_META_LEN = 4000;
const ALLOWED_ATTACHMENT_KINDS = new Set(["image", "audio", "paper"]);

// The POST body is buffered in full before parsing. Whole-library syncs
// (saved/history replace-all) are legitimately large — up to ~2000 saved
// items — so this ceiling is generous, but it still stops a hostile client
// from OOMing the worker with an unbounded JSON body. readJsonBody checks
// Content-Length before buffering and measures the buffered text too.
const MAX_BODY_BYTES = 64 * 1024 * 1024;

// ---- consistent response shapes ----
// Every response from this endpoint carries `ok`. Failures are always
// { ok: false, error, code? } with a human-safe message; successes are
// { ok: true, ... }. `error` text and HTTP status are unchanged so existing
// clients keep working — `ok`/`code` are additive.
const okRes = (payload, status, headers) =>
  new Response(JSON.stringify({ ok: true, ...payload }), { status: status || 200, headers });
const errRes = (message, status, code, headers) =>
  new Response(JSON.stringify({ ok: false, error: message, code: code || "error" }), { status: status || 400, headers });
// Exported for unit tests (tests/content-endpoints.mjs).
export { okRes, errRes };

// D1 batches are a single transaction, but an unbounded statement list is
// not free — chunk large write sets so a 2000-item library sync can't hit
// statement/parameter limits in one batch. The first chunk carries the
// DELETE so a partial failure never leaves a half-synced table behind a
// completed delete... in practice D1 batch is atomic per batch() call, and
// chunking keeps each call well inside the limits.
async function batchedWrites(db, stmts, chunkSize) {
  const size = chunkSize || 100;
  for (let i = 0; i < stmts.length; i += size) {
    await db.batch(stmts.slice(i, i + size));
  }
}

// The live social tables declare their timestamp columns DATETIME DEFAULT
// CURRENT_TIMESTAMP (a SQLite string default), but every write this file
// makes supplies an explicit epoch-ms integer instead, matching the epoch
// convention every other table in this codebase already uses (otp_codes,
// sessions, user_history, …). That keeps rows THIS code writes consistent,
// but can't guarantee some row wasn't inserted a different way before this
// code ever ran (e.g. a manually seeded test row that fell through to the
// column's own string default). This normalizes either shape to a number
// so a stray ISO-string timestamp can't silently break a numeric sort.
// Commit 65 — watchlist support.
//
// A watched topic is stored as the user's own words, normalized only for
// whitespace and case-folding on the uniqueness index, so "CRISPR base
// editing" and "crispr base editing" don't become two rows the user has to
// manage separately.
const MAX_TOPIC_LEN = 120;
function normalizeTopic(raw) {
  return (raw || "").toString().replace(/\s+/g, " ").trim().slice(0, MAX_TOPIC_LEN);
}

// How many papers Europe PMC has indexed on a topic since a given moment.
//
// Returns a number, or null if the upstream couldn't be reached — null and
// 0 mean genuinely different things here (null = "we don't know", 0 = "we
// checked and there's nothing new"), and the caller keeps them apart so a
// network blip never renders as "no new research."
//
// CREATION_DATE is the date Europe PMC first indexed the record, which is
// the right clock for "new since you last looked" — a paper's own
// publication date can be months earlier than the day it became findable.
// resultType=idlist + pageSize=1 makes this the cheapest possible query:
// all we read is hitCount.
async function countNewSince(topic, sinceMs) {
  const t = normalizeTopic(topic);
  if (!t) return null;
  const since = new Date(Math.max(0, sinceMs || 0));
  if (!Number.isFinite(since.getTime())) return null;
  const from = since.toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  // Query shape matters a lot here. A bare multi-word topic is treated as
  // a loose OR by Europe PMC, which inflates every count into meaningless
  // hundreds; a quoted phrase on a long topic is so strict it returns zero
  // forever. So: short topics search as an exact phrase, longer ones as an
  // AND of their significant terms, which is what a person means when they
  // say they're watching "CRISPR base editing in sickle cell disease".
  const words = t.replace(/["()\[\]:]/g, " ").split(/\s+/).filter(Boolean);
  const STOP = new Set(["the", "a", "an", "of", "in", "on", "for", "and", "or", "to", "with", "how", "what", "why", "does", "do", "is", "are", "can"]);
  const terms = words.filter((w) => w.length > 2 && !STOP.has(w.toLowerCase())).slice(0, 6);
  const core = words.length <= 3
    ? `"${words.join(" ")}"`
    : (terms.length ? terms.map((w) => `"${w}"`).join(" AND ") : `"${words.slice(0, 3).join(" ")}"`);
  const q = `(${core}) AND (CREATION_DATE:[${from} TO ${to}])`;
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&resultType=idlist&pageSize=1`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    // Belt and braces: the abort signal is the real timeout, but racing a
    // timer too means a fetch that never settles at all can't hold the
    // whole watchlist response open behind it.
    const res = await Promise.race([
      fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } }),
      new Promise((resolve) => setTimeout(() => resolve(null), 6500)),
    ]);
    if (!res || !res.ok) return null;
    const json = await res.json();
    const n = Number(json && json.hitCount);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toEpochMs(v) {
  if (typeof v === "number") return v;
  if (v == null) return 0;
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

// D1's LIKE treats %, _, and \ as syntax, not literal characters — a search
// for "50_gene" or "100%" would otherwise silently turn into a wildcard
// match instead of the literal substring the user typed. Escaping before
// wrapping in %...% (search-users, below) keeps the query itself the only
// place wildcards get introduced.
function escapeLikeWildcards(s) {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

// isBlockedPair now lives in functions/lib/authHelpers.js (Commit 50) — it
// gained a second caller (call-signal.js) and a duplicated copy of a
// security-relevant check is exactly the kind of thing that quietly drifts.

// Origin policy lives in lib/http.js — one copy, one behaviour.

const DATA_RATE_LIMIT = 60;
const DATA_RATE_WINDOW_MS = 60000;

const MAX_SAVED_PER_USER = 2000;
const MAX_COLLECTIONS_PER_USER = 200;
const MAX_HISTORY_PER_USER = 500;
const MAX_SOURCE_JSON_LEN = 20000;
const MAX_TURNS_JSON_LEN = 500000;

// Commit 74 — the founder's account.
//
// Driven entirely by the FOUNDER_EMAIL environment variable, never by a
// hardcoded id and never by anything the client can send. The badge means
// "this is the person who actually runs Cerebrum", so the only thing
// allowed to confer it is a value the operator sets on the server. Anyone
// who could claim it by editing a request would make it worthless.
//
// Idempotent: INSERT OR IGNORE, so the badges keep the timestamp of the
// first time they were granted.
async function ensureFounderBadges(env, userId, emailLower) {
  const founderEmail = (env.FOUNDER_EMAIL || "").trim().toLowerCase();
  if (!founderEmail || !emailLower || emailLower !== founderEmail) return false;
  try {
    for (const badge of ["founder", "verified"]) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO accolades (id, user_id, badge_type, granted_at) VALUES (?, ?, ?, ?)"
      ).bind(newId("acc"), userId, badge, Date.now()).run();
    }
  } catch {}
  return true;
}
async function founderRow(env) {
  const founderEmail = (env.FOUNDER_EMAIL || "").trim().toLowerCase();
  if (!founderEmail) return null;
  try {
    // Commit 75 — match on lower(email) as well as email_lower.
    // email_lower is backfilled by ensureUserProfileColumns, but that runs
    // on /api/data and this lookup can be the thing that needs it before
    // any code path has. Matching both means a row that has not been
    // backfilled yet still resolves instead of the founder silently not
    // existing.
    return await env.DB.prepare(
      "SELECT id, username, name, affiliation, degree, grad_year, plan FROM users WHERE email_lower = ? OR LOWER(email) = ?"
    ).bind(founderEmail, founderEmail).first();
  } catch { return null; }
}

/* Commit 100 — the founder card, factored out of search-users.

   With browse deleted, this is the only account the app ever surfaces
   without being asked for by name, and that is defensible for exactly one
   reason: it is the person who runs the service, volunteering their own
   contact, on their own product. It is not a sample of other users, and it
   is not a suggestion algorithm — it recommends one account and says plainly
   who it is and why. Everyone else has to be searched for. */
async function founderCard(env, user) {
  const fr = await founderRow(env);
  if (!fr || fr.id === user.id) return null;
  try {
    const followers = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM follows WHERE following_id = ?"
    ).bind(fr.id).first();
    const isFollowing = await env.DB.prepare(
      "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?"
    ).bind(user.id, fr.id).first();
    return {
      id: fr.id, username: fr.username, name: fr.name || fr.username || "Founder",
      affiliation: fr.affiliation || null, degree: fr.degree || null,
      gradYear: fr.grad_year || null,
      followers: (followers && followers.n) || 0,
      following: !!isFollowing,
      isFounder: true,
      isPro: fr.plan === "pro",
      prompt: "Have a question for the owner?",
    };
  } catch { return null; }
}

/* Commit 100 — may `senderId` open a NEW conversation with `targetId`?

   The default is "only people I follow", chosen deliberately over the old
   "anyone signed in". An unsolicited DM from a stranger is the single most
   common way a small network becomes unpleasant, and the person who pays for
   a permissive default is never the one who chose it.

   Two carve-outs, because a rule that blocks legitimate first contact just
   gets worked around:

     - The founder accepts from anyone. The Find People card invites you to
       ask them a question; that invitation has to actually work, and it is
       their own account extending it.
     - An account can opt back in to 'anyone' explicitly.

   This gates thread CREATION only. Once a conversation exists, both sides
   can speak in it — the recipient allowed it by replying, or it predates
   this rule, and retroactively silencing half of an open thread would be a
   worse surprise than the one this prevents. Blocking is still the control
   that ends an existing conversation. */
async function mayStartConversation(env, senderId, targetId) {
  let policy = "following";
  let founderEmail = (env.FOUNDER_EMAIL || "").trim().toLowerCase();
  try {
    const row = await env.DB.prepare(
      "SELECT dm_policy, email_lower, email FROM users WHERE id = ?"
    ).bind(targetId).first();
    if (row) {
      if (row.dm_policy === "anyone") policy = "anyone";
      const targetEmail = (row.email_lower || row.email || "").toLowerCase();
      if (founderEmail && targetEmail === founderEmail) policy = "anyone";
    }
  } catch {
    // A missing dm_policy column (an account older than this deploy, before
    // ensureUserProfileColumns has run) must not fail open into the
    // permissive branch — that is the whole failure mode this control
    // exists to prevent. Fall through with the strict default.
  }
  if (policy === "anyone") return true;
  try {
    const follows = await env.DB.prepare(
      "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?"
    ).bind(targetId, senderId).first();
    return !!follows;
  } catch { return false; }
}

export async function onRequest(context) {
  // Opportunistic retention sweep. See lib/retention.js for why this is
  // not a cron. Runs in the background; never delays this response.
  maybeSweep(context);
  const { request, env } = context;
  const url = new URL(request.url);

  const cors = corsHeaders(request, env);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  /* CSRF on the write path. Reads may omit Origin (same-origin GETs do);
   * writes must prove they came from one of our pages, because a cookie
   * that is SameSite=Lax still rides along on a top-level cross-site POST. */
  if (request.method === "POST" && !requireTrustedOrigin(request, env)) {
    return errRes("Request blocked.", 403, "origin_not_allowed", cors);
  }
  if (!readOriginAllowed(request, env)) return errRes("Request blocked.", 403, "origin_not_allowed", cors);
  if (!env.DB) return errRes("Accounts are not configured on this deployment.", 503, "service_unavailable", cors);

  const user = await getSessionUser(request, env);

  /* ══════════════════════════════════════════════════════════════════
     Commit 100 — the one resource in this file that answers without a
     session, and the only one that ever should.

     A profile link that dies at a sign-in wall is not a profile link, so
     signed-out visitors get a card: display name, @username, avatar, bio.
     That is the whole payload. Everything a scraper would actually want is
     withheld — institution, degree, graduation year, follower and following
     counts, badges, links, activity — because those are the fields that make
     a harvested profile worth harvesting, and none of them are needed to
     decide whether to sign in and look properly.

     Three further constraints on this branch:

       - It requires an exact user id. There is no listing, no search, and no
         enumeration from here; you can only ask about an account you were
         already given a link to.
       - It honours `discoverable`. Someone who has opted out of being found
         is not reachable through a guessed link either.
       - It is rate limited per IP, harder than the signed-in budget, because
         this is the only unauthenticated door and it is the one an automated
         client would knock on.

     Signed-in visitors fall through to the full public-profile branch far
     below, which is a different and much richer response.
     ══════════════════════════════════════════════════════════════════ */
  if (!user && request.method === "GET" && url.searchParams.get("resource") === "public-profile") {
    const clientIPAnon = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
    if (!(await checkRateLimit(env, `anonprofile:${clientIPAnon}`, 20, 60000))) {
      return errRes("Too many requests.", 429, "rate_limited", { ...cors, "Retry-After": "30" });
    }
    // Ids are opaque values we generated (newId) — safeId rejects anything
    // else outright, so junk never reaches a query bind and "missing" and
    // "malformed" share one clear 400.
    const targetId = safeId(url.searchParams.get("id"));
    if (!targetId) return errRes("Missing id.", 400, "missing_id", cors);
    try {
      await ensureUserProfileColumns(env);
      const row = await env.DB.prepare(
        "SELECT id, username, name, avatar_base64, bio, discoverable FROM users WHERE id = ?"
      ).bind(targetId).first();
      // Same 404 for "no such account" and "opted out", so this cannot be
      // used to confirm that a hidden account exists.
      if (!row || row.discoverable === 0) {
        return errRes("Profile not found.", 404, "not_found", cors);
      }
      return new Response(JSON.stringify({
        ok: true,
        limited: true,
        user: {
          id: row.id,
          username: row.username,
          name: row.name || row.username || "Researcher",
          avatar_base64: row.avatar_base64 || null,
          bio: row.bio || null,
        },
      }), { status: 200, headers: cors });
    } catch {
      return errRes("Profile not found.", 404, "not_found", cors);
    }
  }

  if (!user) return errRes("Sign in first.", 401, "unauthenticated", cors);

  const clientIP = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  // Commit 56 — polling resources are exempt from the shared per-IP budget
  // and metered per user instead. This was a real, silent production
  // failure, not a tuning preference: DATA_RATE_LIMIT is 60 requests per
  // minute PER IP, and Commit 54's incoming-call poll alone spends 20 of
  // them (every 3s), with the open-thread poll spending 12 more (every 5s).
  // Two people testing a call from the same home or campus network share
  // one IP, so between them they blow the whole budget on polling before
  // anyone loads a page — and because apiDataGet treats a non-OK response
  // as "no data", a 429 arrived as a silent "nobody is calling you." That
  // is exactly the reported symptom: a call that rings on the caller's
  // screen and never reaches the person being called.
  //
  // Keyed on user id (not IP) so two people behind one router can't starve
  // each other, and sized to comfortably fit both poll loops plus headroom.
  const pollingResource = request.method === "GET" && ["incoming-calls", "thread", "inbox"].includes(url.searchParams.get("resource"));
  const rateKey = pollingResource ? `data-poll:${user.id}` : `data:${clientIP}`;
  const rateLimit = pollingResource ? 240 : DATA_RATE_LIMIT;
  if (!(await checkRateLimit(env, rateKey, rateLimit, DATA_RATE_WINDOW_MS))) {
    return errRes("Too many requests. Please wait a moment.", 429, "rate_limited", { ...cors, "Retry-After": "20" });
  }


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
        // Self-healing: add the rating column if it doesn't exist yet.
        // (SQLite has no ADD COLUMN IF NOT EXISTS, so we try and swallow
        // the "duplicate column" error — same pattern as ensureUserProfileColumns.)
        try {
          await env.DB.exec("ALTER TABLE user_saved_sources ADD COLUMN rating INTEGER");
        } catch (e) {
          if (!/duplicate column/i.test(String(e && e.message || e))) throw e;
        }
        // Optional pagination via `?limit=` / `?offset=`. The client syncs
        // whole libraries through replace-all, so the default is the full
        // list — but nothing here is ever unbounded: the write path caps a
        // library at MAX_SAVED_PER_USER rows, and so does this read.
        const limit = safeInt(url.searchParams.get("limit"), { min: 1, max: MAX_SAVED_PER_USER, fallback: MAX_SAVED_PER_USER });
        const offset = safeInt(url.searchParams.get("offset"), { min: 0, max: 1000000, fallback: 0 });
        const rows = await env.DB.prepare(
          "SELECT id, collection_id, source_json, rating, created_at FROM user_saved_sources WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
        ).bind(user.id, limit, offset).all();
        const items = (rows.results || []).map((r) => {
          let source = {};
          try { source = JSON.parse(r.source_json); } catch {}
          return { id: r.id, savedId: r.id, collectionId: r.collection_id, createdAt: r.created_at, rating: r.rating, ...source, id: source.id || r.id };
        });
        return okRes({ items }, 200, cors);
      }
      if (resource === "collections") {
        const rows = await env.DB.prepare(
          "SELECT id, name, created_at FROM user_collections WHERE user_id = ? ORDER BY created_at ASC"
        ).bind(user.id).all();
        return okRes({ items: rows.results || [] }, 200, cors);
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
          "SELECT id, email, email_lower, username, name, affiliation, degree, grad_year, avatar_base64, bio, cover, link_site, link_orcid, link_scholar, pinned, interests, terms_version, terms_accepted_at, discoverable, dm_policy, show_affiliation FROM users WHERE id = ?"
        ).bind(user.id).first();
        if (!row) return errRes("Account not found.", 404, "not_found", cors);
        const followerCount = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM follows WHERE following_id = ?"
        ).bind(user.id).first();
        // The profile's stats row shows followers AND following; both are
        // the same follows table read in the two directions.
        const followingCount = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?"
        ).bind(user.id).first();
        // Commit 74 — grant before reading, so the founder's badges exist
        // the first time they open their own profile rather than needing a
        // separate migration step.
        const isFounder = await ensureFounderBadges(env, row.id, (row.email_lower || row.email || "").toLowerCase());
        const badgeRows = await env.DB.prepare(
          "SELECT badge_type FROM accolades WHERE user_id = ? ORDER BY granted_at ASC"
        ).bind(user.id).all();
        // Pinned shelf: stored as a JSON array string; a corrupt value
        // degrades to an empty shelf, never a 500.
        let pinnedIds = [];
        if (row.pinned) {
          try {
            const parsed = JSON.parse(row.pinned);
            if (Array.isArray(parsed)) pinnedIds = parsed.filter((v) => typeof v === "string").slice(0, 4);
          } catch { /* keep the empty shelf */ }
        }
        // Interests: same JSON-array-string shape, same graceful degrade.
        let interestList = [];
        if (row.interests) {
          try {
            const parsed = JSON.parse(row.interests);
            if (Array.isArray(parsed)) interestList = parsed.filter((v) => typeof v === "string").slice(0, 8);
          } catch { /* keep the empty list */ }
        }
        return new Response(JSON.stringify({
          ok: true,
          user: { id: row.id, email: row.email, username: row.username, name: row.name, affiliation: row.affiliation, degree: row.degree || null, grad_year: row.grad_year || null, avatar_base64: row.avatar_base64 || null, bio: row.bio || null, cover: row.cover || null, link_site: row.link_site || null, link_orcid: row.link_orcid || null, link_scholar: row.link_scholar || null, pinned: pinnedIds, interests: interestList },
          followers: followerCount?.n || 0,
          followingCount: followingCount?.n || 0,
          badges: (badgeRows.results || []).map((b) => b.badge_type),
          // Commit 69 — lets the consent gate ask the ACCOUNT, not just
          // this browser. Someone who accepted on their laptop shouldn't be
          // re-prompted on their phone; someone who cleared their cookies
          // shouldn't lose a real acceptance.
          termsVersion: row.terms_version || null,
          termsAcceptedAt: row.terms_accepted_at || null,
          isFounder,
          /* Commit 100 — the privacy controls, resolved here rather than in
             the UI. NULL means "never set", and each has a defined default
             (see the column comments in authHelpers.js); doing that
             resolution in one place means the settings screen cannot show a
             switch in a position the server does not actually honour. */
          privacy: {
            discoverable: row.discoverable === null || row.discoverable === undefined ? true : row.discoverable === 1,
            showAffiliation: row.show_affiliation === null || row.show_affiliation === undefined ? true : row.show_affiliation === 1,
            dmPolicy: row.dm_policy === "anyone" ? "anyone" : "following",
          },
        }), { status: 200, headers: cors });
      }

      /* ══════════════════════════════════════════════════════════════
         Commit 100 — somebody else's profile, for a signed-in viewer.

         This did not exist. The old `profile` resource was your own account
         only, and its comment said so explicitly: a version taking a target
         id "would need its own thinking about which columns are safe to
         expose about someone ELSE ... which is a real design question the
         spec for this round didn't raise." This is that thinking.

         Safe to return: display name, @username, avatar, cover, bio, the
         three self-published links, degree and graduation year, follower and
         following counts, badges, and the viewer's own relationship to this
         account (following, blocked, may I message them).

         Never returned: email in any form, account age, last login, the
         accounts they follow or that follow them (a follower LIST is an
         enumeration primitive — the count is not), anything about their
         searches, saved papers, collections or history. A research question
         is often the most sensitive thing a person will type into this
         product, and none of it belongs on a public profile.

         Conditional: affiliation, only when show_affiliation has not been
         turned off. And nothing at all if the account has opted out of
         discovery or either side has blocked the other — with the same 404
         in every case, so this cannot be used to distinguish "no such
         person" from "hidden" from "they blocked you."
         ══════════════════════════════════════════════════════════════ */
      if (resource === "public-profile") {
        const targetId = safeId(url.searchParams.get("id"));
        if (!targetId) return errRes("Missing id.", 400, "missing_id", cors);
        if (targetId === user.id) {
          return errRes("Use resource=profile for your own account.", 400, "self", cors);
        }
        const row = await env.DB.prepare(
          `SELECT id, username, name, affiliation, show_affiliation, degree, grad_year,
                  avatar_base64, bio, cover, link_site, link_orcid, link_scholar, discoverable, dm_policy, plan
           FROM users WHERE id = ?`
        ).bind(targetId).first();
        const blocked = row ? await isBlockedPair(env, user.id, targetId) : false;
        if (!row || row.discoverable === 0 || blocked) {
          return errRes("Profile not found.", 404, "not_found", cors);
        }
        const followers = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM follows WHERE following_id = ?"
        ).bind(targetId).first();
        const following = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?"
        ).bind(targetId).first();
        const iFollow = await env.DB.prepare(
          "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?"
        ).bind(user.id, targetId).first();
        const followsMe = await env.DB.prepare(
          "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?"
        ).bind(targetId, user.id).first();
        let badges = [];
        try {
          const badgeRows = await env.DB.prepare(
            "SELECT badge_type FROM accolades WHERE user_id = ? ORDER BY granted_at ASC"
          ).bind(targetId).all();
          badges = (badgeRows.results || []).map((b) => b.badge_type);
        } catch {}
        return new Response(JSON.stringify({
          ok: true,
          limited: false,
          user: {
            id: row.id,
            username: row.username,
            name: row.name || row.username || "Researcher",
            // Pro is a public badge, not private account state: a member's
            // Pro status is meant to be seen on their public profile.
            isPro: row.plan === "pro",
            affiliation: row.show_affiliation === 0 ? null : (row.affiliation || null),
            degree: row.degree || null,
            grad_year: row.grad_year || null,
            avatar_base64: row.avatar_base64 || null,
            bio: row.bio || null,
            cover: row.cover || null,
            link_site: row.link_site || null,
            link_orcid: row.link_orcid || null,
            link_scholar: row.link_scholar || null,
          },
          followers: followers?.n || 0,
          followingCount: following?.n || 0,
          badges,
          // The viewer's relationship, which is what the profile's buttons
          // are made of. `followsMe` is shown as "Follows you", the same
          // signal every network gives you before you decide to follow back.
          isFollowing: !!iFollow,
          followsMe: !!followsMe,
          canMessage: await mayStartConversation(env, user.id, targetId),
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
        // Commit 47: tp.last_read_at rides along so each thread's `unread`
        // flag (below) is real, not the "just means non-empty" placeholder
        // the badge used to fall back to — see the ALTER TABLE self-heal in
        // authHelpers.js's ensureSocialTables for where this column comes
        // from on a pre-existing live table.
        const threadRows = await env.DB.prepare(
          `SELECT t.id, t.kind, t.name, tp.last_read_at FROM threads t
           JOIN thread_participants tp ON tp.thread_id = t.id
           WHERE tp.user_id = ?`
        ).bind(user.id).all();
        const items = [];
        for (const t of threadRows.results || []) {
          const last = await env.DB.prepare(
            "SELECT sender_id, text, attachment_title, attachment_kind, created_at FROM messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1"
          ).bind(t.id).first();
          let displayName = t.name;
          let otherId = null;
          if (t.kind === "dm") {
            const other = await env.DB.prepare(
              // Commit 100 — `u.email` selected here too, as the last fallback
              // for a thread's display name. An account with no display name
              // set would title the conversation with the other person's
              // email address. The username always exists (auth.js assigns
              // one at signup), so the fallback was unreachable in practice
              // and only a leak in waiting.
              `SELECT u.id, u.name, u.username FROM thread_participants tp
               JOIN users u ON u.id = tp.user_id
               WHERE tp.thread_id = ? AND tp.user_id != ?`
            ).bind(t.id, user.id).first();
            otherId = other ? other.id : null;
            if (!displayName) displayName = other ? (other.name || other.username || "Conversation") : "Conversation";
          }
          // Commit 48: a DM with either direction of block in place is
          // flagged so the Inbox can disable its composer/huddle button —
          // history stays visible (blocking doesn't erase what was already
          // said), only sending/calling is gated. Groups aren't covered:
          // there's no group-membership-removal flow yet, so "block" for a
          // group would just be confusing half-measure moderation.
          const blocked = otherId ? await isBlockedPair(env, user.id, otherId) : false;
          const lastCreatedAt = last ? toEpochMs(last.created_at) : 0;
          // Unread means: the most recent message exists, isn't mine, and
          // landed after the last time I opened this thread (or I've never
          // opened it at all — last_read_at is NULL, toEpochMs(null) => 0,
          // so any real message counts as unread, which is the right
          // default for a thread you've never looked at).
          const unread = !!(last && last.sender_id !== user.id && lastCreatedAt > toEpochMs(t.last_read_at));
          items.push({
            id: t.id,
            kind: t.kind,
            name: displayName || "Conversation",
            otherId,
            blocked,
            unread,
            lastMessage: last ? {
              text: last.text,
              attachmentTitle: last.attachment_title || null,
              attachmentKind: last.attachment_kind || null,
              senderId: last.sender_id,
              createdAt: lastCreatedAt,
              mine: last.sender_id === user.id,
            } : null,
          });
        }
        items.sort((a, b) => (b.lastMessage?.createdAt || 0) - (a.lastMessage?.createdAt || 0));
        return okRes({ items }, 200, cors);
      }
      // Commit 54 — "is anyone calling me right now?", polled app-wide by
      // every signed-in client. This is what makes a video huddle actually
      // ring: before it, both people had to independently decide to click
      // the huddle button on the same thread at roughly the same moment,
      // which is why the reported symptom was both sides sitting on
      // "Waiting for X to join" forever. Nobody was doing anything wrong —
      // there was simply no path by which one person starting a call could
      // reach the other.
      //
      // Deliberately a heartbeat, not a stored "call state" row. The caller
      // re-posts a `ring` signal every few seconds for as long as it's
      // waiting (see VideoHuddle in main.jsx); this returns the most recent
      // one from the last few seconds. Hanging up, closing the tab, losing
      // the network, or the browser being killed all stop the heartbeat
      // identically, so the callee's ringing UI expires on its own with no
      // cleanup path to get wrong and no way to leave a phantom call
      // ringing forever. The cost is a few seconds of ring latency at
      // pickup; the thing it buys is that there is no such thing as a stuck
      // call.
      if (resource === "incoming-calls") {
        // A ring older than this is from a caller who has stopped ringing.
        const RING_WINDOW_MS = 9000;
        let row = null;
        try {
          row = await env.DB.prepare(
            `SELECT cs.thread_id, cs.sender_id, cs.created_at, cs.payload
             FROM call_signals cs
             JOIN thread_participants tp ON tp.thread_id = cs.thread_id
             WHERE tp.user_id = ? AND cs.sender_id != ? AND cs.type = 'ring' AND cs.created_at > ?
             ORDER BY cs.created_at DESC LIMIT 1`
          ).bind(user.id, user.id, Date.now() - RING_WINDOW_MS).first();
        } catch (e) {
          // call_signals is created by ensureSocialTables, but this endpoint
          // must never be the thing that takes the app down if that hasn't
          // run yet on a given isolate — "nobody is calling" is the correct
          // degraded answer.
          row = null;
        }
        if (!row) return okRes({ call: null }, 200, cors);
        if (await isBlockedPair(env, user.id, row.sender_id)) {
          return okRes({ call: null }, 200, cors);
        }
        const caller = await env.DB.prepare(
          "SELECT name, username FROM users WHERE id = ?"
        ).bind(row.sender_id).first();
        return new Response(JSON.stringify({
          ok: true,
          call: {
            threadId: row.thread_id,
            fromId: row.sender_id,
            // Never the email address. auth.js always assigns a username, so
            // the old `|| caller.email` fallback was unreachable — and it is
            // the same leak Commit 100 removed from the inbox and thread
            // queries, left behind in this one.
            fromName: caller ? (caller.name || caller.username || "Someone") : "Someone",
            at: row.created_at,
            // Commit 97 — the caller's ring payload says whether this is an
            // audio-only call. Without it the callee always answered with a
            // camera request, which hard-failed on any machine that hasn't
            // got one. Parsed defensively: an older client rings with an
            // empty payload and that must still mean "video".
            audioOnly: (() => {
              try { return !!(JSON.parse(row.payload || "{}").audioOnly); } catch { return false; }
            })(),
          },
        }), { status: 200, headers: cors });
      }
      // A single thread's full message history — get-inbox above only ever
      // returns the most recent message per thread (that's what a thread
      // list needs), so opening a conversation needs its own fetch. Same
      // membership guard as send-message: no row in thread_participants for
      // this thread and this user means a 403, not a peek at someone else's
      // conversation.
      if (resource === "thread") {
        const threadId = safeId(url.searchParams.get("thread_id"));
        if (!threadId) return errRes("Missing thread_id.", 400, "missing_id", cors);
        const membership = await env.DB.prepare(
          "SELECT 1 FROM thread_participants WHERE thread_id = ? AND user_id = ?"
        ).bind(threadId, user.id).first();
        if (!membership) return errRes("You're not part of that conversation.", 403, "forbidden", cors);
        // Commit 47: opening a thread is what "read" means here — no
        // separate mark-as-read action, matching how every real DM inbox
        // (Instagram, iMessage, etc.) actually behaves. Awaited rather than
        // fire-and-forget: a Workers/Pages Function's execution can be torn
        // down right after its Response is returned unless the extra work is
        // wrapped in waitUntil(), so an un-awaited write here could silently
        // never land. A non-fatal try/catch — a failed mark-as-read should
        // never take down the actual thread fetch underneath it.
        try {
          await env.DB.prepare("UPDATE thread_participants SET last_read_at = ? WHERE thread_id = ? AND user_id = ?")
            .bind(Date.now(), threadId, user.id).run();
        } catch (e) { console.error("Couldn't mark thread read:", e); }
        const threadRow = await env.DB.prepare("SELECT id, kind, name FROM threads WHERE id = ?").bind(threadId).first();
        if (!threadRow) return errRes("That conversation no longer exists.", 404, "not_found", cors);
        // last_read_at rides along per participant so a DM can report
        // "Seen" on the read side's own last message — see otherLastReadAt
        // below. Not attempted for groups (kind !== "dm"): "seen by which
        // of N people" is a genuinely different feature nobody asked for.
        /* Commit 100 — `u.email` and a raw `u.affiliation` used to be
           selected here and sent to the other participant's browser, where
           the Inbox printed them under the conversation title:
           "alice@utk.edu · University of Tennessee". Two problems.

           The email is the serious one. Nothing in this product asks you to
           share your email address with the people you talk to, and nobody
           agreed to it — opening a DM handed over a real, permanent contact
           address. It is also the exact identifier that makes a scraped
           user base worth something. It is not selected any more, so it
           cannot be printed by accident later.

           The affiliation was sent unconditionally, ignoring
           show_affiliation, so a person who had hidden their institution on
           their profile still leaked it to anyone who opened a conversation
           with them. A privacy switch with a hole in it is worse than no
           switch, because the person believes it holds.

           `username` stays: it is the public handle, it is how you found
           this person, and it is what disambiguates two people with the
           same display name. */
        const participantRows = await env.DB.prepare(
          `SELECT u.id, u.name, u.username, u.affiliation, u.show_affiliation, tp.last_read_at FROM thread_participants tp
           JOIN users u ON u.id = tp.user_id
           WHERE tp.thread_id = ?`
        ).bind(threadId).all();
        const participants = participantRows.results || [];
        const byId = new Map(participants.map((p) => [p.id, p]));
        const displayNameFor = (p) => (p ? (p.name || p.username || "Someone") : "Someone");
        let name = threadRow.name;
        let otherId = null;
        let otherUsername = null;
        let otherAffiliation = null;
        let otherLastReadAt = null;
        if (!name && threadRow.kind === "dm") {
          const other = participants.find((p) => p.id !== user.id);
          name = other ? displayNameFor(other) : "Conversation";
          otherId = other?.id || null;
          otherUsername = other?.username || null;
          otherAffiliation = other && other.show_affiliation !== 0 ? (other.affiliation || null) : null;
          otherLastReadAt = other ? toEpochMs(other.last_read_at) : null;
        }
        // Commit 48: same "either direction blocks" flag as the inbox list
        // (see isBlockedPair above) — this is what the Inbox composer and
        // Huddle button gate on once a conversation is actually open.
        const blocked = otherId ? await isBlockedPair(env, user.id, otherId) : false;
        // Every message's sender is guaranteed to be a thread participant
        // (send-message enforces that on the way in), so the participant
        // rows already fetched above double as the sender-lookup table —
        // no extra per-message query needed for the "who said this" label.
        //
        // Newest-first with a hard cap: an unbounded ASC fetch turns one
        // very active conversation into a multi-megabyte response. The cap
        // is generous — ordinary threads never notice it — and `truncated`
        // tells the client when it bit, instead of silently dropping the
        // oldest messages.
        const MAX_THREAD_MESSAGES = 1000;
        const messageRows = await env.DB.prepare(
          "SELECT id, sender_id, text, attachment_title, attachment_kind, attachment_data, attachment_url, attachment_meta, created_at FROM messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?"
        ).bind(threadId, MAX_THREAD_MESSAGES + 1).all();
        const fetchedMessages = messageRows.results || [];
        const truncated = fetchedMessages.length > MAX_THREAD_MESSAGES;
        const messages = fetchedMessages.slice(0, MAX_THREAD_MESSAGES).reverse().map((m) => ({
          id: m.id,
          senderId: m.sender_id,
          mine: m.sender_id === user.id,
          text: m.text,
          attachmentTitle: m.attachment_title || null,
          attachmentKind: m.attachment_kind || null,
          attachmentData: m.attachment_data || null,
          attachmentUrl: m.attachment_url || null,
          attachmentMeta: (() => { try { return m.attachment_meta ? JSON.parse(m.attachment_meta) : null; } catch { return null; } })(),
          createdAt: toEpochMs(m.created_at),
          who: displayNameFor(byId.get(m.sender_id)),
        }));
        return new Response(JSON.stringify({
          ok: true,
          id: threadRow.id,
          kind: threadRow.kind,
          name: name || "Conversation",
          memberCount: participants.length,
          otherId,
          otherUsername,
          otherAffiliation,
          otherLastReadAt,
          blocked,
          messages,
          truncated,
        }), { status: 200, headers: cors });
      }
      // Find People / the network directory. This used to be a hardcoded
      // MOCK_RESEARCHERS array in the frontend labeled "Preview — sample
      // results" — this is what makes it search real accounts. Same
      // public/private column split as `profile` above: username, name,
      // affiliation, and a computed follower count are fair game; email
      // never leaves a user's own profile fetch. `q` needs 2+ characters so
      // an empty or single-character box doesn't scan every account on each
      // keystroke.
      /* ══════════════════════════════════════════════════════════════
         Commit 100 — Find People, rebuilt around one rule: you find a
         person because you already know something about them, never by
         being handed a list.

         What this endpoint used to do, all of which is now gone:

         1. An empty query returned 20 accounts ordered by followers and
            last_login_at. Opening the tab handed any signed-in user a
            roster. Commit 57 added that deliberately, to solve "a social
            network that shows you nobody until you can name somebody has
            no way in" — a real problem, but the fix was to publish a
            directory, and the cost of that is borne by people who never
            asked to be in one. The founder card (below) solves the same
            cold-start problem without listing anyone else.

         2. It matched `u.email_lower LIKE '%q%'`. Email was never returned,
            but matching on it is the leak: type "@utk.edu" and you get
            everyone at that domain; type a guessed address and the presence
            or absence of a result confirms whether that person has an
            account. That is an email-enumeration oracle, and it was the
            most serious hole in this file. Gone entirely — email is not a
            search key.

         3. It matched `u.affiliation LIKE '%q%'`, and returned a `hubs`
            aggregation: every distinct institution with a headcount. Paired
            with the `hub` resource (deleted below), which returned up to 100
            named accounts for any affiliation string, that made the whole
            user base walkable institution by institution. Reported directly:
            "if I go to find people, it shows up University of Tennessee. I
            should not be able to view the people at University of Tennessee.
            That is not safe." It is not. An institution is not a profile and
            it is not a place you can browse.

         What remains: a match on name or username only, from accounts that
         have not opted out, rate limited so the remaining surface cannot be
         walked at speed.
         ══════════════════════════════════════════════════════════════ */
      if (resource === "search-users") {
        const q = (url.searchParams.get("q") || "").trim();

        // No query, no people. This endpoint has no browse mode. The founder
        // card is still assembled below, because it is one named account
        // that has explicitly volunteered to be contacted — not a sample of
        // other people's.
        if (q.length < 2) {
          return okRes({ items: [], founder: await founderCard(env, user) }, 200, cors);
        }

        // Commit 100 — a search endpoint that returns real accounts is a
        // scraping target by definition. Two characters at a time, 20 rows a
        // shot, an attacker walks the alphabet; the limit is what makes that
        // cost real. Keyed to the account, not the IP, because the endpoint
        // already requires a session — so the budget follows whoever is
        // actually spending it.
        if (!(await checkRateLimit(env, `usersearch:${user.id}`, 30, 60000))) {
          return errRes("You're searching very quickly. Give it a few seconds.", 429, "rate_limited", { ...cors, "Retry-After": "20" });
        }

        const like = "%" + escapeLikeWildcards(q) + "%";
        const rows = await env.DB.prepare(
          `SELECT u.id, u.username, u.name, u.affiliation, u.show_affiliation, u.degree, u.grad_year, u.plan,
                  (SELECT COUNT(*) FROM follows f2 WHERE f2.following_id = u.id) AS followers,
                  EXISTS(SELECT 1 FROM follows f3 WHERE f3.follower_id = ? AND f3.following_id = u.id) AS is_following
           FROM users u
           WHERE u.id != ?
             AND COALESCE(u.discoverable, 1) = 1
             AND (u.username LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')
             AND NOT EXISTS (
               SELECT 1 FROM user_blocks b
               WHERE (b.blocker_id = u.id AND b.blocked_id = ?)
                  OR (b.blocker_id = ? AND b.blocked_id = u.id)
             )
           ORDER BY followers DESC, u.name ASC
           LIMIT 20`
        ).bind(user.id, user.id, like, like, user.id, user.id).all();

        const items = (rows.results || []).map((r) => ({
          id: r.id,
          username: r.username,
          name: r.name || r.username || "Researcher",
          // Honoured here as well as on the profile: a search result that
          // shows the institution of someone who hid it would hand back
          // exactly the field they chose to withhold.
          affiliation: (r.show_affiliation === 0 ? "" : (r.affiliation || "")),
          degree: r.degree || null,
          gradYear: r.grad_year || null,
          followers: r.followers || 0,
          following: !!r.is_following,
          isPro: r.plan === "pro",
        }));

        return okRes({ items, founder: await founderCard(env, user) }, 200, cors);
      }

      /* Commit 100 — the `hub` resource is deleted, not disabled.

         It took an affiliation string and returned up to 100 accounts at
         that institution: id, username, display name, degree, graduation
         year, follower count. No rate limit, and the institution strings to
         feed it were published by search-users' own `hubs` list, so the two
         together were a complete enumeration path over the user base.

         There is no privacy flag that makes an institutional roster safe,
         which is why this is a deletion rather than a `discoverable` filter:
         the feature IS the exposure. A request for it now 404s like any
         other unknown resource, and InstitutionModal is gone from the
         frontend. */

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
        return okRes({ items }, 200, cors);
      }
      // Commit 65 — the watchlist. This is the retention mechanic, and it
      // is deliberately the honest version of one.
      //
      // The research behind it (arXiv 2511.18013, "Save, Revisit, Retain")
      // found that saving is the strongest single predictor of a user
      // coming back, but that it is the REVISIT of a saved thing — not the
      // save — that correlates with sustained activity a month out. So the
      // job of this endpoint is not to manufacture a reason to return; it
      // is to surface a real one. `newCount` below is a live hit count from
      // Europe PMC for literature indexed since the user last looked at
      // that topic. If no new papers exist, the number is 0 and the UI says
      // nothing. A badge in Cerebrum always means literature that actually
      // exists.
      if (resource === "watchlist") {
        const rows = await env.DB.prepare(
          "SELECT id, topic, created_at, last_seen_at, last_count FROM watched_topics WHERE user_id = ? ORDER BY created_at DESC LIMIT 40"
        ).bind(user.id).all();
        const watched = rows.results || [];
        // Only the most recent dozen get a live count: each one is a
        // network round trip, and a 40-topic watchlist would otherwise turn
        // one page load into 40 upstream requests. The rest render from
        // last_count (the number as of the last time it was checked),
        // which is honest — it was true when it was measured.
        const LIVE = 12;
        const counted = await Promise.all(watched.slice(0, LIVE).map(async (w) => {
          const n = await countNewSince(w.topic, toEpochMs(w.last_seen_at));
          return { ...w, live: n };
        }));
        const out = [];
        for (const w of counted) {
          const newCount = w.live == null ? (w.last_count || 0) : w.live;
          if (w.live != null && w.live !== w.last_count) {
            // Cache the fresh number so the next render has something true
            // to fall back on if Europe PMC is unreachable.
            try {
              await env.DB.prepare("UPDATE watched_topics SET last_count = ? WHERE id = ? AND user_id = ?").bind(w.live, w.id, user.id).run();
            } catch {}
          }
          out.push({
            id: w.id, topic: w.topic, createdAt: toEpochMs(w.created_at),
            lastSeenAt: toEpochMs(w.last_seen_at), newCount,
            live: w.live != null,
          });
        }
        for (const w of watched.slice(LIVE)) {
          out.push({
            id: w.id, topic: w.topic, createdAt: toEpochMs(w.created_at),
            lastSeenAt: toEpochMs(w.last_seen_at), newCount: w.last_count || 0,
            live: false,
          });
        }
        const totalNew = out.reduce((s, w) => s + (w.newCount || 0), 0);
        return okRes({ items: out, totalNew }, 200, cors);
      }
      // Commit 69 — milestones.
      //
      // The honest version of achievements. Every milestone below is
      // computed from a real count in this database at request time —
      // sources you actually saved, topics you actually watch, people you
      // actually follow. Nothing is awarded for opening the app, for
      // consecutive days, or for any behaviour whose only value is that it
      // looks like engagement. If a number here is 12, there are twelve
      // rows.
      //
      // Progress toward the NEXT milestone is returned alongside the earned
      // ones, because "3 of 10" is the part that motivates; a wall of
      // locked badges with no distance marked is just a list of things you
      // don't have.
      //
      // Grants are written to `accolades` with INSERT OR IGNORE, so a
      // milestone is earned exactly once and its granted_at is the first
      // time the threshold was actually crossed.
      if (resource === "milestones") {
        const one = async (sql) => {
          try { const r = await env.DB.prepare(sql).bind(user.id).first(); return (r && r.n) || 0; }
          catch { return 0; }
        };
        const saved = await one("SELECT COUNT(*) AS n FROM user_saved_sources WHERE user_id = ?");
        const investigations = await one("SELECT COUNT(*) AS n FROM user_history WHERE user_id = ?");
        const watched = await one("SELECT COUNT(*) AS n FROM watched_topics WHERE user_id = ?");
        const following = await one("SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?");
        const collections = await one("SELECT COUNT(*) AS n FROM user_collections WHERE user_id = ?");

        const DEFS = [
          { key: "first_question", label: "First question", desc: "Ask Cerebrum something", need: 1, have: investigations, unit: "investigation" },
          { key: "ten_questions", label: "Ten investigations", desc: "Ten separate lines of enquiry", need: 10, have: investigations, unit: "investigation" },
          { key: "fifty_questions", label: "Fifty investigations", desc: "This is a research habit now", need: 50, have: investigations, unit: "investigation" },
          { key: "first_save", label: "First paper saved", desc: "Keep something worth returning to", need: 1, have: saved, unit: "paper" },
          { key: "ten_saves", label: "Ten papers saved", desc: "A reading list with weight", need: 10, have: saved, unit: "paper" },
          { key: "fifty_saves", label: "Fifty papers saved", desc: "A genuine personal library", need: 50, have: saved, unit: "paper" },
          { key: "first_collection", label: "First collection", desc: "Organize saved work by theme", need: 1, have: collections, unit: "collection" },
          { key: "first_watch", label: "First watched topic", desc: "Get told when new work lands", need: 1, have: watched, unit: "topic" },
          { key: "five_watches", label: "Five watched topics", desc: "A field of view, not a question", need: 5, have: watched, unit: "topic" },
          { key: "first_follow", label: "First researcher followed", desc: "Cerebrum has people in it too", need: 1, have: following, unit: "researcher" },
        ];

        // Grant anything newly crossed. INSERT OR IGNORE means the first
        // crossing keeps its timestamp forever, even if the count later
        // drops because something was deleted — you did do it.
        const earnedNow = DEFS.filter((d) => d.have >= d.need);
        for (const d of earnedNow) {
          try {
            await env.DB.prepare(
              "INSERT OR IGNORE INTO accolades (id, user_id, badge_type, granted_at) VALUES (?, ?, ?, ?)"
            ).bind(newId("acc"), user.id, d.key, Date.now()).run();
          } catch {}
        }
        const heldRows = await env.DB.prepare(
          "SELECT badge_type, granted_at FROM accolades WHERE user_id = ?"
        ).bind(user.id).all();
        const held = new Map((heldRows.results || []).map((r) => [r.badge_type, r.granted_at]));

        const items = DEFS.map((d) => ({
          key: d.key, label: d.label, desc: d.desc,
          need: d.need, have: Math.min(d.have, d.need), unit: d.unit,
          earned: held.has(d.key),
          earnedAt: held.has(d.key) ? toEpochMs(held.get(d.key)) : null,
        }));
        // The single most useful thing to show: the nearest unearned
        // milestone with real distance to it.
        const next = items
          .filter((i) => !i.earned)
          .sort((a2, b2) => (b2.have / b2.need) - (a2.have / a2.need))[0] || null;
        return new Response(JSON.stringify({
          ok: true,
          items,
          next,
          earnedCount: items.filter((i) => i.earned).length,
          total: items.length,
          // early_adopter is granted at signup by auth.js and isn't a
          // milestone anyone can work toward, so it is reported separately
          // rather than padding the count.
          earlyAdopter: held.has("early_adopter"),
        }), { status: 200, headers: cors });
      }

      // Commit 75 — why the founder badge isn't showing, answered in the
      // app instead of over a screenshot.
      //
      // The badge depends on a Cloudflare environment variable, and an
      // environment variable is NOT part of a git push — which is exactly
      // the failure this endpoint exists to make visible. It reports
      // whether FOUNDER_EMAIL is set at all, whether a user row matches it,
      // and (masked) what this account's own email actually is, so a
      // mismatched address is obvious at a glance rather than being
      // guessed at.
      if (resource === "founder-status") {
        const configured = !!(env.FOUNDER_EMAIL || "").trim();
        const mask = (e) => {
          const str = String(e || "");
          const at = str.indexOf("@");
          if (at < 1) return str ? "(set)" : "";
          const name = str.slice(0, at);
          return name.slice(0, 2) + "•".repeat(Math.max(1, name.length - 2)) + str.slice(at);
        };
        const me = await env.DB.prepare("SELECT email, email_lower FROM users WHERE id = ?").bind(user.id).first();
        const myEmail = ((me && (me.email_lower || me.email)) || "").toLowerCase();
        const target = (env.FOUNDER_EMAIL || "").trim().toLowerCase();
        const youAreFounder = !!(configured && myEmail && myEmail === target);

        /* This resource is a setup aid for the operator, and it was answering
         * everyone. Any signed-in account learned the founder's username (or
         * raw user id) and a mask that preserves the entire email domain —
         * config.js goes to real lengths to gate exactly this disclosure
         * behind the founder account, and this endpoint handed it out.
         *
         * Non-founders now learn only whether owner verification is
         * configured at all, which is what the UI needs to decide whether to
         * show a "not set up" hint, and nothing about who the owner is. */
        if (!youAreFounder) {
          return new Response(JSON.stringify({
            ok: true,
            configured,
            youAreFounder: false,
          }), { status: 200, headers: cors });
        }
        return new Response(JSON.stringify({
          ok: true,
          configured,
          configuredValue: configured ? mask(target) : null,
          yourEmail: mask(myEmail),
          youAreFounder: true,
        }), { status: 200, headers: cors });
      }

      return errRes("Unknown resource.", 400, "bad_request", cors);
    }

    if (request.method !== "POST") {
      return errRes("Method not allowed.", 405, "method_not_allowed", cors);
    }

    // Bounded body parse (see MAX_BODY_BYTES above): an unbounded
    // request.json() would buffer a body of any size into worker memory.
    // Malformed JSON gets an explicit 400 here instead of silently becoming
    // {} and failing later as a confusing "missing field" error.
    const parsedBody = await readJsonBody(request, cors, MAX_BODY_BYTES);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;
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
        const { collectionId, rating, ...source } = item || {};
        const sourceJson = JSON.stringify(source);
        if (sourceJson.length > MAX_SOURCE_JSON_LEN) continue;
        // Rating is validated: null (unrated) or integer 1-5. Anything else
        // is dropped to null rather than rejected — a malformed rating
        // shouldn't fail the whole library sync.
        const cleanRating = (Number.isInteger(rating) && rating >= 1 && rating <= 5) ? rating : null;
        stmts.push(env.DB.prepare("INSERT INTO user_saved_sources (id, user_id, collection_id, source_json, rating, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(newId("src"), user.id, validCollections.has(collectionId) ? collectionId : null, sourceJson, cleanRating, now));
      }
      // Chunked (see batchedWrites): a full-library sync is thousands
      // of statements, and one giant batch risks D1 statement/parameter
      // limits. Chunking trades the single-batch atomicity for bounded
      // batch sizes — a failed chunk leaves a partial sync, but the
      // client's debounced whole-array sync re-sends the full list on the
      // next change and heals it.
      await batchedWrites(env.DB, stmts);
      return new Response(JSON.stringify({ ok: true, count: items.length }), { status: 200, headers: cors });
    }

    /* Paper ratings (Goodreads/Letterboxd-style, 1-5 stars, personal).
       Sets or clears the rating on a single saved paper. The paper must
       belong to the requesting user — otherwise 404 (not 403, to avoid
       leaking whether the ID exists for another user). */
    if (resource === "saved" && action === "set-rating") {
      // Ensure the column exists (same self-heal as the GET path).
      try {
        await env.DB.exec("ALTER TABLE user_saved_sources ADD COLUMN rating INTEGER");
      } catch (e) {
        if (!/duplicate column/i.test(String(e && e.message || e))) throw e;
      }
      const paperId = typeof body.id === "string" ? body.id.trim().slice(0, 64) : "";
      if (!paperId) return new Response(JSON.stringify({ ok: false, error: "missing id" }), { status: 400, headers: cors });
      // rating: null clears, 1-5 sets. Anything else is 400.
      const rating = body.rating;
      const cleanRating = rating === null ? null :
        (Number.isInteger(rating) && rating >= 1 && rating <= 5) ? rating : undefined;
      if (cleanRating === undefined) {
        return new Response(JSON.stringify({ ok: false, error: "rating must be null or an integer 1-5" }), { status: 400, headers: cors });
      }
      const result = await env.DB.prepare(
        "UPDATE user_saved_sources SET rating = ? WHERE id = ? AND user_id = ?"
      ).bind(cleanRating, paperId, user.id).run();
      if (!result.meta || result.meta.changes === 0) {
        return new Response(JSON.stringify({ ok: false, error: "not found" }), { status: 404, headers: cors });
      }
      return new Response(JSON.stringify({ ok: true, id: paperId, rating: cleanRating }), { status: 200, headers: cors });
    }

    if (resource === "history" && action === "replace-all") {
      const items = Array.isArray(body.items) ? body.items.slice(0, MAX_HISTORY_PER_USER) : [];
      const now = Date.now();
      const stmts = [env.DB.prepare("DELETE FROM user_history WHERE user_id = ?").bind(user.id)];
      for (const item of items) {
        const turnsJson = JSON.stringify({ turns: item?.turns || [], allSources: item?.allSources || [] });
        if (turnsJson.length > MAX_TURNS_JSON_LEN) {
          return errRes("An investigation is too large to sync. Existing account history has been preserved.", 413, "too_large", cors);
        }
        const title = (item?.title || "").toString().slice(0, 300);
        const ts = Number(item?.ts) || now;
        stmts.push(env.DB.prepare("INSERT INTO user_history (id, user_id, title, turns_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(newId("hist"), user.id, title, turnsJson, ts, ts));
      }
      // Chunked (see batchedWrites): a full-history sync is hundreds of
      // statements, and one giant batch risks D1 statement/parameter
      // limits. Chunking trades the single-batch atomicity for bounded
      // batch sizes — a failed chunk leaves a partial sync, but the
      // client's debounced whole-array sync re-sends the full list on the
      // next change and heals it. (The 413 check above runs before any
      // write, so an oversized item still preserves existing history.)
      await batchedWrites(env.DB, stmts);
      return new Response(JSON.stringify({ ok: true, count: items.length }), { status: 200, headers: cors });
    }

    if (resource === "collections" && action === "create") {
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_collections WHERE user_id = ?").bind(user.id).first();
      if ((count?.n || 0) >= MAX_COLLECTIONS_PER_USER) return errRes("Collection limit reached.", 400, "bad_request", cors);
      const name = (body.name || "").toString().trim().slice(0, 80);
      if (!name) return errRes("Name a collection first.", 400, "bad_request", cors);
      const id = newId("col");
      await env.DB.prepare("INSERT INTO user_collections (id, user_id, name, created_at) VALUES (?, ?, ?, ?)")
        .bind(id, user.id, name, Date.now()).run();
      return okRes({ id, name }, 200, cors);
    }

    if (resource === "collections" && (action === "rename" || action === "delete")) {
      // Both actions bind body.id straight into a D1 query — guard it here
      // once rather than in each branch. safeId also rejects the old
      // failure mode where an absent/non-string id reached .bind() as
      // `undefined` and D1 turned a simple "no id was sent" into an
      // opaque 500 instead of a clear 400.
      const collectionId = safeId(body.id);
      if (!collectionId) return errRes("Missing collection id.", 400, "missing_id", cors);

      if (action === "rename") {
        const name = (body.name || "").toString().trim().slice(0, 80);
        if (!name) return errRes("Name can't be empty.", 400, "bad_request", cors);
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
      // Academic CV fields — free text, not validated against a controlled
      // vocabulary (a real degree/institution list would need its own
      // reference data this pass doesn't add), same trust level as name/
      // affiliation above. An empty string clears the field, same
      // convention as username above but via NULL directly since neither
      // column carries a uniqueness constraint.
      let degree = typeof body.degree === "string" ? body.degree.trim().slice(0, MAX_DEGREE_LEN) : undefined;
      if (degree === "") degree = null;
      let gradYear = typeof body.grad_year === "string" ? body.grad_year.trim().slice(0, MAX_GRAD_YEAR_LEN) : undefined;
      if (gradYear === "") gradYear = null;
      // `null` (explicit removal) is a valid value here too, so this can't
      // use the same `typeof === "string" ? … : undefined` shape as the
      // text fields above — `undefined` still means "leave it alone."
      let avatarBase64;
      if (body.avatar_base64 === null) {
        avatarBase64 = null;
      } else if (typeof body.avatar_base64 === "string") {
        if (body.avatar_base64.length > MAX_AVATAR_BASE64_LEN) {
          return errRes("Image is too large. Try a smaller photo.", 400, "bad_request", cors);
        }
        if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(body.avatar_base64)) {
          return errRes("Unsupported image format.", 400, "bad_request", cors);
        }
        avatarBase64 = body.avatar_base64;
      }
      // Commit 75 — bio, cover and links.
      //
      // The links are stored as free text but validated as URLs on the way
      // in: they are rendered as anchors on a public profile, so a
      // "javascript:" or "data:" value here would be a stored XSS vector
      // handed to every visitor. Only http/https is accepted, and an empty
      // string clears the field.
      let bio = typeof body.bio === "string" ? body.bio.trim().slice(0, MAX_BIO_LEN) : undefined;
      if (bio === "") bio = null;
      let cover = typeof body.cover === "string" ? body.cover.trim().slice(0, 40) : undefined;
      if (cover !== undefined && cover !== "" && !ALLOWED_COVERS.has(cover)) {
        return errRes("Unknown cover.", 400, "bad_request", cors);
      }
      if (cover === "") cover = null;
      // Pinned shelf: an array of up to 4 saved-paper IDs, stored as a JSON
      // string. The IDs are opaque client-side strings; we validate shape
      // (array, max 4, short non-empty strings), not membership — the paper
      // has to be in the user's own saved list to render, so a forged ID
      // simply matches nothing. `null` clears the shelf.
      let pinned;
      if (body.pinned === null) {
        pinned = null;
      } else if (body.pinned !== undefined) {
        if (!Array.isArray(body.pinned)) {
          return errRes("Pinned must be a list of papers.", 400, "bad_request", cors);
        }
        const ids = body.pinned
          .filter((v) => typeof v === "string" && v.length > 0 && v.length <= 200)
          .slice(0, 4);
        pinned = JSON.stringify(ids);
      }
      // Research interests: up to 8 short strings. `null`/empty clears.
      let interests;
      if (body.interests !== undefined) {
        if (body.interests === null) {
          interests = null;
        } else if (Array.isArray(body.interests)) {
          const list = body.interests
            .filter((v) => typeof v === "string")
            .map((v) => v.trim().slice(0, 60))
            .filter(Boolean)
            .slice(0, 8);
          interests = JSON.stringify(list);
        } else {
          return errRes("Interests must be a list of strings.", 400, "bad_request", cors);
        }
      }
      const safeUrl = (v) => {
        if (typeof v !== "string") return undefined;
        const t = v.trim();
        if (!t) return null;
        let u;
        try { u = new URL(t.startsWith("http") ? t : "https://" + t); } catch { return false; }
        if (u.protocol !== "http:" && u.protocol !== "https:") return false;
        return u.toString().slice(0, MAX_LINK_LEN);
      };
      const linkSite = safeUrl(body.link_site);
      const linkOrcid = safeUrl(body.link_orcid);
      const linkScholar = safeUrl(body.link_scholar);
      if (linkSite === false || linkOrcid === false || linkScholar === false) {
        return errRes("That doesn't look like a web address.", 400, "bad_request", cors);
      }

      const sets = [];
      const binds = [];
      if (bio !== undefined) { sets.push("bio = ?"); binds.push(bio); }
      if (cover !== undefined) { sets.push("cover = ?"); binds.push(cover); }
      if (pinned !== undefined) { sets.push("pinned = ?"); binds.push(pinned); }
      if (interests !== undefined) { sets.push("interests = ?"); binds.push(interests); }
      if (linkSite !== undefined) { sets.push("link_site = ?"); binds.push(linkSite); }
      if (linkOrcid !== undefined) { sets.push("link_orcid = ?"); binds.push(linkOrcid); }
      if (linkScholar !== undefined) { sets.push("link_scholar = ?"); binds.push(linkScholar); }
      if (name !== undefined) { sets.push("name = ?"); binds.push(name); }
      if (username !== undefined) { sets.push("username = ?"); binds.push(username); }
      if (affiliation !== undefined) { sets.push("affiliation = ?"); binds.push(affiliation); }
      if (degree !== undefined) { sets.push("degree = ?"); binds.push(degree); }
      if (gradYear !== undefined) { sets.push("grad_year = ?"); binds.push(gradYear); }
      if (avatarBase64 !== undefined) { sets.push("avatar_base64 = ?"); binds.push(avatarBase64); }

      /* Commit 100 — the three privacy controls, written through the same
         action as the rest of the profile.

         Each is parsed strictly rather than coerced: an unrecognised
         dm_policy is ignored outright instead of being truthy-cast into
         something, and the booleans only accept an actual boolean. A
         privacy setting that can be flipped by a malformed request is worse
         than no setting, because the person believes it holds. */
      if (typeof body.discoverable === "boolean") {
        sets.push("discoverable = ?"); binds.push(body.discoverable ? 1 : 0);
      }
      if (typeof body.show_affiliation === "boolean") {
        sets.push("show_affiliation = ?"); binds.push(body.show_affiliation ? 1 : 0);
      }
      if (body.dm_policy === "anyone" || body.dm_policy === "following") {
        sets.push("dm_policy = ?"); binds.push(body.dm_policy);
      }

      if (!sets.length) return errRes("Nothing to update.", 400, "bad_request", cors);
      binds.push(user.id);
      try {
        await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
      } catch (e) {
        if (username !== undefined && username !== null && /UNIQUE constraint failed:\s*users\.username/i.test(String(e && e.message))) {
          return errRes("That username is already taken.", 409, "conflict", cors);
        }
        throw e;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
    }

    if (action === "toggle-follow") {
      // Wire format keeps `target_id` (matching the original spec) even
      // though the live column is `following_id` — that's a DB-shape
      // detail, not something the frontend needs to know about.
      const targetId = safeId(body.target_id);
      if (!targetId) return errRes("Missing target_id.", 400, "missing_id", cors);
      // Not in the literal spec, but following yourself isn't a real
      // action — worth rejecting outright rather than letting it silently
      // inflate your own follower count.
      if (targetId === user.id) return errRes("You can't follow yourself.", 400, "bad_request", cors);
      /* Three fixes in one guard.
       *
       * Blocks: every sibling action (send-message, start-thread,
       * incoming-calls) consults isBlockedPair; this one did not, so a person
       * you had blocked could still follow you and appear in the follow graph
       * the DM policy is built on.
       *
       * Discoverability: an account that opted out of being found was still
       * confirmable here.
       *
       * Oracle: "That account doesn't exist" (404) versus a 200 told you
       * whether any id was real. public-profile deliberately returns an
       * identical 404 for missing, hidden and blocked — this now matches, so
       * the three states cannot be told apart from outside. */
      const target = await env.DB.prepare("SELECT id, discoverable FROM users WHERE id = ?").bind(targetId).first();
      const blockedPair = target ? await isBlockedPair(env, user.id, targetId) : false;
      if (!target || target.discoverable === 0 || blockedPair) {
        return errRes("That account isn't available.", 404, "not_available", cors);
      }
      const existing = await env.DB.prepare(
        "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?"
      ).bind(user.id, targetId).first();
      if (existing) {
        await env.DB.prepare("DELETE FROM follows WHERE follower_id = ? AND following_id = ?").bind(user.id, targetId).run();
      } else {
        // OR IGNORE closes a real race: two concurrent toggles can both pass
        // the existence check above, and the second INSERT used to die on
        // the UNIQUE constraint as a 500. The outcome is identical either
        // way (the row exists), so ignoring the conflict is correct.
        await env.DB.prepare("INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)").bind(user.id, targetId, Date.now()).run();
      }
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM follows WHERE following_id = ?").bind(targetId).first();
      return okRes({ following: !existing, followers: count?.n || 0 }, 200, cors);
    }

    if (action === "send-message") {
      const threadId = safeId(body.thread_id);
      const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_MESSAGE_LEN) : "";
      // attachment_title wasn't in the original spec — it's a real column
      // on the live `messages` table this code wasn't using at all, and it
      // maps directly onto the paper-attachment card the Inbox preview in
      // main.jsx already renders (INITIAL_INBOX_THREADS' Dr. Chen message).
      // Optional: a message can carry text, an attachment, or both, but
      // not neither.
      const attachmentTitle = typeof body.attachment_title === "string" ? body.attachment_title.trim().slice(0, 300) : "";
      // Commit 56 — image / voice note / shared paper.
      const attachmentKind = ALLOWED_ATTACHMENT_KINDS.has(body.attachment_kind) ? body.attachment_kind : "";
      const attachmentData = attachmentKind === "image" || attachmentKind === "audio"
        ? (typeof body.attachment_data === "string" ? body.attachment_data : "") : "";
      /* This was a bare trim+slice, so `javascript:` and `data:text/html`
       * were stored verbatim and handed to every member of the thread — while
       * the profile link fields three hundred lines below went through a
       * real scheme check. Same validator both places now. */
      const attachmentUrl = safeUrl(body.attachment_url, MAX_ATTACHMENT_URL_LEN) || "";
      let attachmentMeta = "";
      try { attachmentMeta = body.attachment_meta ? JSON.stringify(body.attachment_meta).slice(0, MAX_ATTACHMENT_META_LEN) : ""; } catch { attachmentMeta = ""; }
      if (attachmentData) {
        // Refused explicitly rather than left to fail as a D1 row-size
        // error, so the composer can tell someone their file is too big
        // instead of showing them a generic send failure.
        if (attachmentData.length > MAX_ATTACHMENT_DATA_LEN) {
          return errRes("That attachment is too large to send. Try a smaller image or a shorter voice note.", 413, "too_large", cors);
        }
        // Only ever a self-contained data URL of the kind claimed — this is
        // rendered straight into an <img>/<audio> src on someone else's
        // screen, so a remote or javascript: URL smuggled through here would
        // be an injection vector, not merely a wrong file.
        const expected = attachmentKind === "image" ? /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/ : /^data:audio\/(webm|ogg|mp4|mpeg|wav)(;codecs=[a-z0-9.,=]+)?;base64,[A-Za-z0-9+/=]+$/;
        if (!expected.test(attachmentData)) {
          return errRes("That attachment format isn't supported.", 400, "bad_request", cors);
        }
      }
      if (!threadId || (!text && !attachmentTitle && !attachmentData)) {
        return errRes("Missing thread_id, or a message needs text or an attachment.", 400, "bad_request", cors);
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
      if (!membership) return errRes("You're not part of that conversation.", 403, "forbidden", cors);
      // Commit 48 enforcement: a blocked DM stops accepting new messages
      // from either side — history stays visible (the GET above never
      // hides it), this just closes the door on adding to it. Groups are
      // deliberately untouched, same scope note as user_blocks in
      // schema.sql (no group-membership-removal flow to pair it with yet).
      const threadMeta = await env.DB.prepare("SELECT kind FROM threads WHERE id = ?").bind(threadId).first();
      if (threadMeta?.kind === "dm") {
        const other = await env.DB.prepare(
          "SELECT user_id FROM thread_participants WHERE thread_id = ? AND user_id != ?"
        ).bind(threadId, user.id).first();
        if (other && (await isBlockedPair(env, user.id, other.user_id))) {
          return errRes("You can't message this person.", 403, "forbidden", cors);
        }
      }
      const now = Date.now();
      // messages.id is a plain TEXT primary key on the live table (no
      // autoincrement) — has to be generated here, same as accolades.id in
      // auth.js's verify-code.
      await env.DB.prepare(
        "INSERT INTO messages (id, thread_id, sender_id, text, attachment_title, attachment_kind, attachment_data, attachment_url, attachment_meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(
        newId("msg"), threadId, user.id, text || null, attachmentTitle || null,
        attachmentKind || null, attachmentData || null, attachmentUrl || null, attachmentMeta || null, now
      ).run();
      return new Response(JSON.stringify({
        ok: true,
        message: {
          text, attachmentTitle: attachmentTitle || null,
          attachmentKind: attachmentKind || null, attachmentData: attachmentData || null,
          attachmentUrl: attachmentUrl || null,
          attachmentMeta: (() => { try { return attachmentMeta ? JSON.parse(attachmentMeta) : null; } catch { return null; } })(),
          senderId: user.id, createdAt: now, mine: true,
        },
      }), { status: 200, headers: cors });
    }

    // The "Message" button in Find People used to just open the Inbox with
    // a disclosure toast ("isn't a real account yet") because there was
    // nowhere real to send it. This is the find-or-create half of making
    // that real: reuse an existing DM with this person if one's already
    // there, otherwise create one, and hand back a thread_id the frontend
    // can open straight into and send-message against.
    if (action === "start-thread") {
      const targetId = safeId(body.target_id);
      if (!targetId) return errRes("Missing target_id.", 400, "missing_id", cors);
      if (targetId === user.id) return errRes("You can't message yourself.", 400, "bad_request", cors);
      const target = await env.DB.prepare("SELECT id, discoverable FROM users WHERE id = ?").bind(targetId).first();
      if (!target || target.discoverable === 0) return errRes("That account isn't available.", 404, "not_available", cors);
      // Commit 48 enforcement: blocked in either direction means no new
      // conversation gets started or reopened via this path — including
      // finding-and-returning an existing thread just below, since that
      // would otherwise be a quiet backdoor back into a conversation the
      // block was meant to close.
      if (await isBlockedPair(env, user.id, targetId)) {
        return errRes("You can't message this person.", 403, "forbidden", cors);
      }
      // A DM thread has exactly two participants, so "a thread both of us
      // are in, that's a DM" is unambiguous — no need to also check that
      // membership is exclusive to just the two of us.
      const existing = await env.DB.prepare(
        `SELECT t.id FROM threads t
         JOIN thread_participants tp1 ON tp1.thread_id = t.id AND tp1.user_id = ?
         JOIN thread_participants tp2 ON tp2.thread_id = t.id AND tp2.user_id = ?
         WHERE t.kind = 'dm'
         LIMIT 1`
      ).bind(user.id, targetId).first();
      if (existing) {
        return okRes({ thread_id: existing.id, created: false }, 200, cors);
      }
      /* Commit 100 — the recipient's DM policy gates NEW conversations. This
         check sits after the find-existing lookup on purpose: an open thread
         stays open regardless of what the policy says today, so tightening
         the setting never strands a conversation someone is already having.
         See mayStartConversation for the rule and its two carve-outs.

         The message is written to be useful rather than accusatory — the
         sender has done nothing wrong, they just have not been let in yet,
         and following is not the answer (it is the recipient's follow that
         matters). */
      if (!(await mayStartConversation(env, user.id, targetId))) {
        return errRes("This person only accepts messages from people they follow. Follow them and they may follow you back, which opens a conversation.", 403, "dm_not_allowed", cors);
      }
      // Note: back-to-back double-clicks could theoretically race past this
      // check and create two separate DM threads for the same pair — low-
      // stakes (cosmetic duplicate conversation, not a security issue) and
      // not worth a locking scheme for a find-or-create this infrequent.
      const threadId = newId("thr");
      const now = Date.now();
      await env.DB.prepare("INSERT INTO threads (id, kind, name, created_at) VALUES (?, 'dm', NULL, ?)").bind(threadId, now).run();
      await env.DB.prepare("INSERT INTO thread_participants (thread_id, user_id, joined_at) VALUES (?, ?, ?)").bind(threadId, user.id, now).run();
      await env.DB.prepare("INSERT INTO thread_participants (thread_id, user_id, joined_at) VALUES (?, ?, ?)").bind(threadId, targetId, now).run();
      return okRes({ thread_id: threadId, created: true }, 200, cors);
    }

    // Commit 48: block/unblock the other person in a DM. Storage is
    // directional (user_blocks.blocker_id/blocked_id, see schema.sql) but
    // this toggle always resolves from "are we currently blocked at all" —
    // isBlockedPair checks both directions, and unblocking deletes whichever
    // direction's row actually exists (mine, theirs, or — in a stranger
    // double-click race — both), so it fully clears the pair regardless of
    // who blocked whom first.
    if (action === "toggle-block") {
      const targetId = safeId(body.target_id);
      if (!targetId) return errRes("Missing target_id.", 400, "missing_id", cors);
      if (targetId === user.id) return errRes("You can't block yourself.", 400, "bad_request", cors);
      const target = await env.DB.prepare("SELECT id, discoverable FROM users WHERE id = ?").bind(targetId).first();
      if (!target || target.discoverable === 0) return errRes("That account isn't available.", 404, "not_available", cors);
      const wasBlocked = await isBlockedPair(env, user.id, targetId);
      if (wasBlocked) {
        await env.DB.prepare(
          "DELETE FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)"
        ).bind(user.id, targetId, targetId, user.id).run();
      } else {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
        ).bind(user.id, targetId, Date.now()).run();
      }
      return okRes({ blocked: !wasBlocked }, 200, cors);
    }

    // Commit 48: user/message/call conduct reports, filed from the Inbox
    // (block/report menu on a DM's header), a single message's hover
    // actions, or a Video Huddle's controls. Deliberately separate from
    // functions/api/report.js's `reports` table, which is for bad AI
    // answers/citations, not user-to-user conduct — see content_reports in
    // schema.sql. No admin/review UI exists yet: rows land here for an
    // operator to query directly in D1 until one is built, same honest
    // limitation as `reports` itself.
    if (action === "file-report") {
      const kind = (body.kind || "").toString();
      if (!["message", "user", "call"].includes(kind)) {
        return errRes("Invalid report type.", 400, "bad_request", cors);
      }
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, MAX_REPORT_REASON_LEN) : "";
      const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_REPORT_NOTE_LEN) : "";
      if (!reason) return errRes("Pick a reason.", 400, "bad_request", cors);
      // Optional ids, but when present they must look like ids we generated —
      // a 40KB string in reported_user_id previously rode straight into a
      // query bind.
      const reportedUserId = body.reported_user_id == null ? null : safeId(body.reported_user_id);
      const threadId = body.thread_id == null ? null : safeId(body.thread_id);
      const messageId = body.message_id == null ? null : safeId(body.message_id);
      if ((body.reported_user_id != null && !reportedUserId) ||
          (body.thread_id != null && !threadId) ||
          (body.message_id != null && !messageId)) {
        return errRes("Invalid report target.", 400, "invalid_id", cors);
      }
      if (!reportedUserId && !threadId) {
        return errRes("Nothing to report.", 400, "empty_report", cors);
      }
      if (reportedUserId === user.id) {
        return errRes("You can't report yourself.", 400, "self_report", cors);
      }

      /* SECURITY: the membership guard below only ran when a thread_id was
       * supplied. A report naming only reported_user_id skipped every check,
       * so any signed-in account could file unlimited reports against any
       * user id — including ids it had no connection to and ids that did not
       * exist. That is a report-bombing primitive and a way to poison a
       * moderation queue against a chosen target.
       *
       * A report now requires a real relationship: a shared conversation, or
       * a follow edge in either direction. You can report someone you have
       * actually encountered, not an id you guessed. */
      if (reportedUserId && !threadId) {
        const related = await env.DB.prepare(
          `SELECT 1 FROM thread_participants a
             JOIN thread_participants b ON a.thread_id = b.thread_id
            WHERE a.user_id = ? AND b.user_id = ?
            UNION ALL
           SELECT 1 FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)
            LIMIT 1`
        ).bind(user.id, reportedUserId, user.id, reportedUserId, reportedUserId, user.id).first();
        if (!related) {
          return errRes("You can only report someone you've interacted with.", 403, "no_relationship", cors);
        }
      }

      // One open report per target per reporter. Without this, the guard
      // above still allows a thousand duplicates from a genuine contact.
      const dupe = await env.DB.prepare(
        "SELECT 1 FROM content_reports WHERE reporter_id = ? AND reported_user_id IS ? AND created_at > ? LIMIT 1"
      ).bind(user.id, reportedUserId, Date.now() - 24 * 60 * 60 * 1000).first().catch(() => null);
      if (dupe) {
        return errRes("You've already reported this. We're looking at it.", 429, "duplicate_report", cors);
      }
      // Same membership guard as send-message/thread: reporting a
      // conversation (or a message/call inside one) you're not actually
      // part of isn't a real report.
      if (threadId) {
        const membership = await env.DB.prepare(
          "SELECT 1 FROM thread_participants WHERE thread_id = ? AND user_id = ?"
        ).bind(threadId, user.id).first();
        if (!membership) return errRes("You're not part of that conversation.", 403, "forbidden", cors);
      }
      // A reported message has to actually belong to the reported thread —
      // otherwise thread_id and message_id could point at two unrelated
      // conversations and the report would misfile.
      if (messageId) {
        const msgRow = await env.DB.prepare("SELECT thread_id FROM messages WHERE id = ?").bind(messageId).first();
        if (!msgRow || msgRow.thread_id !== threadId) {
          return errRes("That message couldn't be found in that conversation.", 400, "bad_request", cors);
        }
      }
      await env.DB.prepare(
        "INSERT INTO content_reports (id, reporter_id, reported_user_id, thread_id, message_id, kind, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(newId("rpt"), user.id, reportedUserId, threadId, messageId, kind, reason, note || null, Date.now()).run();
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
    }

    // Commit 65 — watch / unwatch / mark-seen for a topic.
    //
    // "Watch this topic" is offered at the end of an answer, which is the
    // one moment we know the user cared about the subject. Unwatching is a
    // single click from the same places watching is — a retention feature
    // that's hard to leave is just a trap, and a trap doesn't survive
    // contact with a scientist.
    if (action === "watch-topic" || action === "unwatch-topic") {
      const topic = normalizeTopic(body.topic);
      if (!topic) return errRes("Missing topic.", 400, "bad_request", cors);
      if (action === "unwatch-topic") {
        await env.DB.prepare(
          "DELETE FROM watched_topics WHERE user_id = ? AND lower(topic) = lower(?)"
        ).bind(user.id, topic).run();
        return okRes({ watching: false, topic }, 200, cors);
      }
      const existing = await env.DB.prepare(
        "SELECT id FROM watched_topics WHERE user_id = ? AND lower(topic) = lower(?)"
      ).bind(user.id, topic).first();
      if (existing) return okRes({ watching: true, topic }, 200, cors);
      // A cap, because a 200-topic watchlist produces a number nobody
      // reads and a page nobody opens twice.
      const countRow = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM watched_topics WHERE user_id = ?"
      ).bind(user.id).first();
      if ((countRow && countRow.n) >= 40) {
        return errRes("You're watching 40 topics already — remove one to add another.", 400, "bad_request", cors);
      }
      const now = Date.now();
      // last_seen_at starts at now, so the first count is "published since
      // you started watching" rather than the whole back catalogue.
      await env.DB.prepare(
        "INSERT INTO watched_topics (id, user_id, topic, created_at, last_seen_at, last_count) VALUES (?, ?, ?, ?, ?, 0)"
      ).bind(newId("wt"), user.id, topic, now, now).run();
      return okRes({ watching: true, topic }, 200, cors);
    }

    // Called when the user actually opens a watched topic's new results.
    // This is the only thing that clears the badge — it can't be dismissed
    // without looking, and it doesn't clear itself on a page view.
    if (action === "watchlist-seen") {
      const topic = normalizeTopic(body.topic);
      if (!topic) return errRes("Missing topic.", 400, "bad_request", cors);
      await env.DB.prepare(
        "UPDATE watched_topics SET last_seen_at = ?, last_count = 0 WHERE user_id = ? AND lower(topic) = lower(?)"
      ).bind(Date.now(), user.id, topic).run();
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
    }

    // Commit 69 — record that this account accepted a specific version of
    // the Terms, Privacy Policy and Disclosures. Called by the consent gate
    // in src/main.jsx after the person ticks the box; the cookie gates the
    // UI, this row is the durable evidence. Idempotent: accepting the same
    // version twice just refreshes the timestamp.
    if (action === "accept-terms") {
      const version = (body.version || "").toString().trim().slice(0, 40);
      // A version string is a date-like identifier we generate, not free
      // text from the client — validate the shape so a hostile client
      // can't write arbitrary content into an audit column.
      if (!/^[0-9A-Za-z._-]{1,40}$/.test(version)) {
        return errRes("Invalid version.", 400, "bad_request", cors);
      }
      await env.DB.prepare(
        "UPDATE users SET terms_version = ?, terms_accepted_at = ? WHERE id = ?"
      ).bind(version, Date.now(), user.id).run();
      return new Response(JSON.stringify({ ok: true, version }), { status: 200, headers: cors });
    }

    return errRes("Unknown resource/action.", 400, "bad_request", cors);
  } catch (e) {
    console.error("Cerebrum data endpoint error:", e);
    return errRes("Something went wrong. Please try again.", 500, "internal_error", cors);
  }
}
