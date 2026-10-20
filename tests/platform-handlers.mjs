/**
 * Platform route handler tests (2026-10-20).
 *
 * Direct tests for three handlers that previously had none at all:
 * functions/api/cortex.js, functions/api/iceservers.js, and the push
 * subscribe and unsubscribe handlers under functions/api/push/. Each
 * handler is invoked for real with a mocked env, request, and context,
 * in the style of the neighbouring handler suites, and each one gets
 * its main success path plus its obvious refusal paths: bad method,
 * missing fields, and unauthenticated where that applies.
 *
 * Two source pins ride along for the same wave: the document endpoint
 * must build its rate limit key through the shared clientIp helper
 * (never the client settable forwarded header), and the search
 * handler must record per key usage whenever a key identity is set,
 * with no remaining budget gate in front of it.
 *
 * Run with: node tests/platform-handlers.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { signJWT } from "../functions/lib/authHelpers.js";
import { onRequest as cortexRequest } from "../functions/api/cortex.js";
import { onRequest as iceRequest } from "../functions/api/iceservers.js";
import { onRequest as pushSubscribeRequest } from "../functions/api/push/subscribe.js";
import { onRequest as pushUnsubscribeRequest } from "../functions/api/push/unsubscribe.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    failed++;
    console.log("  ✗ " + name + ": " + (e && e.message));
  }
}

function group(name) {
  console.log("\n" + name);
}

// ── Fake D1 ─────────────────────────────────────────────────────────
// Supports exactly the SQL shapes these handlers and their shared
// helpers use: session lookups, the epoch probe, the rate limiter,
// the cortex tables, the accolade grant, and push subscriptions.
function makeDb() {
  const state = {
    usersById: new Map(),
    usersByEmail: new Map(),
    creators: new Map(),
    catalog: new Map(),
    pushSubs: new Map(),
    rateCounts: new Map(),
    accolades: [],
  };
  function runSql(sql, p) {
    if (sql.includes("INSERT OR IGNORE INTO cortex_creators")) {
      state.creators.set(p[0], { email: p[0], granted_by: p[1], created_at: p[2] });
    } else if (sql.includes("DELETE FROM cortex_creators")) {
      state.creators.delete(p[0]);
    } else if (sql.includes("INSERT OR IGNORE INTO accolades")) {
      state.accolades.push(p);
    } else if (sql.includes("INSERT INTO cortex_catalog")) {
      state.catalog.set(p[0], {
        id: p[0], title: p[1], category: p[2], query: p[3],
        blurb: p[4], created_by: p[5], created_at: p[6],
      });
    } else if (sql.includes("DELETE FROM cortex_catalog")) {
      state.catalog.delete(p[0]);
    } else if (sql.includes("INSERT INTO push_subscriptions")) {
      state.pushSubs.set(p[0] + "|" + p[1], {
        user_id: p[0], endpoint: p[1], p256dh: p[2], auth: p[3], created_at: p[4],
      });
    } else if (sql.includes("DELETE FROM push_subscriptions")) {
      if (sql.includes("AND endpoint")) {
        state.pushSubs.delete(p[0] + "|" + p[1]);
      } else {
        for (const key of [...state.pushSubs.keys()]) {
          if (key.startsWith(p[0] + "|")) state.pushSubs.delete(key);
        }
      }
    } else if (sql.includes("INSERT INTO rate_limits")) {
      state.rateCounts.set(p[0], (state.rateCounts.get(p[0]) || 0) + 1);
    }
    return { success: true, meta: { changes: 1 } };
  }
  function firstSql(sql, p) {
    if (sql.includes("FROM session_epochs")) return null;
    if (sql.includes("SELECT id, email FROM users")) return state.usersById.get(p[0]) || null;
    if (sql.includes("FROM users WHERE email_lower")) {
      const user = state.usersByEmail.get(p[0]);
      return user ? { id: user.id } : null;
    }
    if (sql.includes("FROM cortex_creators WHERE email")) {
      const row = state.creators.get(p[0]);
      return row ? { email: row.email } : null;
    }
    if (sql.includes("SELECT created_by FROM cortex_catalog")) {
      const row = state.catalog.get(p[0]);
      return row ? { created_by: row.created_by } : null;
    }
    if (sql.includes("SELECT count FROM rate_limits")) {
      const count = state.rateCounts.get(p[0]);
      return count ? { count } : null;
    }
    return null;
  }
  function allSql(sql) {
    if (sql.includes("FROM cortex_creators ORDER")) {
      return { results: [...state.creators.values()] };
    }
    if (sql.includes("FROM cortex_catalog ORDER")) {
      return { results: [...state.catalog.values()].sort((a, b) => b.created_at - a.created_at) };
    }
    return { results: [] };
  }
  const db = {
    state,
    async exec() { return { success: true }; },
    prepare(sql) {
      const stmt = {
        params: [],
        bind(...params) { stmt.params = params; return stmt; },
        async run() { return runSql(sql, stmt.params); },
        async first() { return firstSql(sql, stmt.params); },
        async all() { return allSql(sql, stmt.params); },
      };
      return stmt;
    },
  };
  return db;
}

function addUser(db, id, email) {
  const user = { id, email };
  db.state.usersById.set(id, user);
  db.state.usersByEmail.set(email.toLowerCase(), user);
  return user;
}

function makeEnv(db, extra = {}) {
  return { DB: db, JWT_SECRET: "testsecretvalue", FOUNDER_EMAIL: "founder@example.com", ...extra };
}

async function sessionHeaders(env, user) {
  const token = await signJWT({ sub: user.id, email: user.email }, env);
  return { Cookie: "cb_sess=" + token };
}

async function call(handler, env, url, { method = "POST", user = null, body, rawBody, trusted = false } = {}) {
  const headers = {};
  if (user) Object.assign(headers, await sessionHeaders(env, user));
  if (trusted) headers["Sec-Fetch-Site"] = "same-origin";
  let payload;
  if (rawBody !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = rawBody;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const request = new Request(url, { method, headers, body: payload });
  const res = await handler({ request, env });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { res, data };
}

// ── Cortex ──────────────────────────────────────────────────────────
group("cortex handler");

const CORTEX_URL = "https://askcerebrum.org/api/cortex";

await test("cortex rejects an unsupported method", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const { res, data } = await call(cortexRequest, env, CORTEX_URL, { method: "PUT", trusted: true, body: {} });
  assert.equal(res.status, 405);
  assert.equal(data.code, "method_not_allowed");
});

await test("cortex rejects an untrusted origin", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const { res } = await call(cortexRequest, env, CORTEX_URL, { body: { action: "access" } });
  assert.equal(res.status, 403);
});

await test("cortex access reports a signed out caller", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const { res, data } = await call(cortexRequest, env, CORTEX_URL, { trusted: true, body: { action: "access" } });
  assert.equal(res.status, 200);
  assert.equal(data.signedIn, false);
  assert.equal(data.isFounder, false);
  assert.equal(data.isCreator, false);
});

await test("cortex access reports the founder", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const founder = addUser(db, "u_founder", "founder@example.com");
  const { res, data } = await call(cortexRequest, env, CORTEX_URL, { trusted: true, user: founder, body: { action: "access" } });
  assert.equal(res.status, 200);
  assert.equal(data.signedIn, true);
  assert.equal(data.isFounder, true);
  assert.equal(data.isCreator, true);
});

await test("cortex refuses an unknown action", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const { res, data } = await call(cortexRequest, env, CORTEX_URL, { trusted: true, body: { action: "bogus" } });
  assert.equal(res.status, 400);
  assert.equal(data.code, "unknown_action");
});

await test("cortex grant refuses a caller who is not the founder", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const plain = addUser(db, "u_plain", "plain@example.com");
  const { res } = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: plain, body: { action: "grant-creator", email: "creator@example.com" },
  });
  assert.equal(res.status, 403);
  assert.equal(db.state.creators.size, 0);
});

await test("cortex grant refuses a malformed email", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const founder = addUser(db, "u_founder", "founder@example.com");
  const { res, data } = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: founder, body: { action: "grant-creator", email: "not an email" },
  });
  assert.equal(res.status, 400);
  assert.equal(data.code, "invalid_email");
});

await test("cortex founder can grant, list, and revoke a creator", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const founder = addUser(db, "u_founder", "founder@example.com");
  addUser(db, "u_creator", "creator@example.com");
  const granted = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: founder, body: { action: "grant-creator", email: "Creator@Example.com" },
  });
  assert.equal(granted.res.status, 200);
  assert.equal(granted.data.email, "creator@example.com");
  assert.equal(granted.data.badgeGranted, true);
  assert.ok(granted.data.creators.some((c) => c.email === "creator@example.com"), "creator list carries the grant");
  const listed = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: founder, body: { action: "list-creators" },
  });
  assert.equal(listed.res.status, 200);
  assert.equal(listed.data.creators.length, 1);
  const revoked = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: founder, body: { action: "revoke-creator", email: "creator@example.com" },
  });
  assert.equal(revoked.res.status, 200);
  assert.equal(revoked.data.creators.length, 0);
  assert.equal(db.state.creators.size, 0);
});

await test("cortex list creators refuses a caller who is not the founder", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const plain = addUser(db, "u_plain", "plain@example.com");
  const { res } = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: plain, body: { action: "list-creators" },
  });
  assert.equal(res.status, 403);
});

await test("cortex catalog create refuses a signed out caller", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const { res, data } = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, body: { action: "catalog-create", title: "Course title", category: "Biology", query: "cell signalling" },
  });
  assert.equal(res.status, 401);
  assert.equal(data.code, "unauthenticated");
});

await test("cortex catalog create refuses an account that is not a creator", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const plain = addUser(db, "u_plain", "plain@example.com");
  const { res, data } = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: plain,
    body: { action: "catalog-create", title: "Course title", category: "Biology", query: "cell signalling" },
  });
  assert.equal(res.status, 403);
  assert.equal(data.code, "not_a_creator");
});

await test("cortex catalog create refuses a title that is too short", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const founder = addUser(db, "u_founder", "founder@example.com");
  const { res, data } = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: founder,
    body: { action: "catalog-create", title: "ab", category: "Biology", query: "cell signalling" },
  });
  assert.equal(res.status, 400);
  assert.equal(data.code, "invalid_title");
});

await test("cortex creator publishes an entry and the catalog lists it", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const founder = addUser(db, "u_founder", "founder@example.com");
  const creator = addUser(db, "u_creator", "creator@example.com");
  await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: founder, body: { action: "grant-creator", email: "creator@example.com" },
  });
  const created = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: creator,
    body: { action: "catalog-create", title: "Cell Signalling Basics", category: "Biology", query: "cell signalling pathways", blurb: "A first course." },
  });
  assert.equal(created.res.status, 200);
  assert.equal(created.data.entry.title, "Cell Signalling Basics");
  assert.equal(created.data.entry.createdBy, "creator@example.com");
  const listed = await call(cortexRequest, env, CORTEX_URL, { method: "GET", trusted: true });
  assert.equal(listed.res.status, 200);
  assert.equal(listed.data.entries.length, 1);
  assert.equal(listed.data.entries[0].id, created.data.entry.id);
});

await test("cortex catalog delete enforces ownership and existence", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const founder = addUser(db, "u_founder", "founder@example.com");
  const creator = addUser(db, "u_creator", "creator@example.com");
  const other = addUser(db, "u_other", "other@example.com");
  await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: founder, body: { action: "grant-creator", email: "creator@example.com" },
  });
  await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: founder, body: { action: "grant-creator", email: "other@example.com" },
  });
  const created = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: creator,
    body: { action: "catalog-create", title: "Cell Signalling Basics", category: "Biology", query: "cell signalling pathways" },
  });
  const entryId = created.data.entry.id;
  const missing = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: creator, body: { action: "catalog-delete" },
  });
  assert.equal(missing.res.status, 400);
  assert.equal(missing.data.code, "invalid_id");
  const gone = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: creator, body: { action: "catalog-delete", id: "cat_missing" },
  });
  assert.equal(gone.res.status, 404);
  assert.equal(gone.data.code, "not_found");
  const notYours = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: other, body: { action: "catalog-delete", id: entryId },
  });
  assert.equal(notYours.res.status, 403);
  assert.equal(notYours.data.code, "not_yours");
  assert.equal(db.state.catalog.size, 1);
  const removed = await call(cortexRequest, env, CORTEX_URL, {
    trusted: true, user: creator, body: { action: "catalog-delete", id: entryId },
  });
  assert.equal(removed.res.status, 200);
  assert.equal(db.state.catalog.size, 0);
});

// ── ICE servers ─────────────────────────────────────────────────────
group("iceservers handler");

const ICE_URL = "https://askcerebrum.org/api/iceservers";

await test("iceservers rejects a non GET method", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const { res, data } = await call(iceRequest, env, ICE_URL, { method: "POST", body: {} });
  assert.equal(res.status, 405);
  assert.equal(data.code, "method_not_allowed");
});

await test("iceservers refuses a signed out caller", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const { res, data } = await call(iceRequest, env, ICE_URL, { method: "GET" });
  assert.equal(res.status, 401);
  assert.equal(data.code, "unauthenticated");
});

await test("iceservers serves STUN only and says no relay is configured", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const user = addUser(db, "u_ice", "ice@example.com");
  const { res, data } = await call(iceRequest, env, ICE_URL, { method: "GET", user });
  assert.equal(res.status, 200);
  assert.equal(data.relay, "none");
  assert.equal(data.reason, "not-configured");
  assert.equal(data.iceServers.length, 1);
  assert.ok(data.iceServers[0].urls.some((u) => u.startsWith("stun:")), "STUN urls are served");
});

await test("iceservers serves operator configured static TURN", async () => {
  const db = makeDb();
  const env = makeEnv(db, {
    TURN_URLS: "turn:turn.example.com:3478",
    TURN_USERNAME: "turnuser",
    TURN_CREDENTIAL: "turnpass",
  });
  const user = addUser(db, "u_ice", "ice@example.com");
  const { res, data } = await call(iceRequest, env, ICE_URL, { method: "GET", user });
  assert.equal(res.status, 200);
  assert.equal(data.relay, "static");
  assert.equal(data.iceServers.length, 2);
  assert.equal(data.iceServers[1].username, "turnuser");
  assert.deepEqual(data.iceServers[1].urls, ["turn:turn.example.com:3478"]);
});

await test("iceservers serves minted Cloudflare TURN credentials", async () => {
  const db = makeDb();
  const env = makeEnv(db, { TURN_KEY_ID: "keyid", TURN_KEY_API_TOKEN: "apitoken" });
  const user = addUser(db, "u_ice", "ice@example.com");
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).includes("/turn/keys/keyid/credentials/generate-ice-servers"), "mint url names the key");
    assert.equal(init.method, "POST");
    return new Response(JSON.stringify({
      iceServers: [{ urls: ["turn:turn.cloudflare.example:3478"], username: "minteduser", credential: "mintedpass" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const { res, data } = await call(iceRequest, env, ICE_URL, { method: "GET", user });
    assert.equal(res.status, 200);
    assert.equal(data.relay, "cloudflare");
    assert.equal(data.iceServers.length, 2);
    assert.equal(data.iceServers[1].username, "minteduser");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

await test("iceservers names a failed mint instead of serving it silently", async () => {
  const db = makeDb();
  const env = makeEnv(db, { TURN_KEY_ID: "keyid", TURN_KEY_API_TOKEN: "apitoken" });
  const user = addUser(db, "u_ice", "ice@example.com");
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 401 });
  try {
    const { res, data } = await call(iceRequest, env, ICE_URL, { method: "GET", user });
    assert.equal(res.status, 200);
    assert.equal(data.relay, "none");
    assert.equal(data.reason, "mint-http-401");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

// ── Push subscribe and unsubscribe ──────────────────────────────────
group("push subscribe and unsubscribe handlers");

const SUB_URL = "https://askcerebrum.org/api/push/subscribe";
const UNSUB_URL = "https://askcerebrum.org/api/push/unsubscribe";

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function validSubscription(endpoint) {
  const point = Buffer.alloc(65, 3);
  point[0] = 4;
  return { endpoint, keys: { p256dh: b64url(point), auth: b64url(Buffer.alloc(16, 7)) } };
}
const ENDPOINT_ONE = "https://fcm.googleapis.com/fcm/send/abc123";
const ENDPOINT_TWO = "https://fcm.googleapis.com/fcm/send/def456";

await test("push subscribe rejects a non POST method", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const { res, data } = await call(pushSubscribeRequest, env, SUB_URL, { method: "GET" });
  assert.equal(res.status, 405);
  assert.equal(data.code, "method_not_allowed");
});

await test("push unsubscribe rejects a non POST method", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const { res, data } = await call(pushUnsubscribeRequest, env, UNSUB_URL, { method: "GET" });
  assert.equal(res.status, 405);
  assert.equal(data.code, "method_not_allowed");
});

await test("push subscribe reports unavailable without a database", async () => {
  const { res, data } = await call(pushSubscribeRequest, {}, SUB_URL, { body: {} });
  assert.equal(res.status, 503);
  assert.equal(data.code, "unavailable");
});

await test("push unsubscribe reports unavailable without a database", async () => {
  const { res, data } = await call(pushUnsubscribeRequest, {}, UNSUB_URL, { body: {} });
  assert.equal(res.status, 503);
  assert.equal(data.code, "unavailable");
});

await test("push subscribe refuses a signed out caller", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const { res, data } = await call(pushSubscribeRequest, env, SUB_URL, {
    body: { subscription: validSubscription(ENDPOINT_ONE) },
  });
  assert.equal(res.status, 401);
  assert.equal(data.code, "unauthenticated");
  assert.equal(db.state.pushSubs.size, 0);
});

await test("push unsubscribe refuses a signed out caller", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const { res, data } = await call(pushUnsubscribeRequest, env, UNSUB_URL, { body: {} });
  assert.equal(res.status, 401);
  assert.equal(data.code, "unauthenticated");
});

await test("push subscribe refuses malformed JSON", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const user = addUser(db, "u_push", "push@example.com");
  const { res, data } = await call(pushSubscribeRequest, env, SUB_URL, { user, rawBody: "not json" });
  assert.equal(res.status, 400);
  assert.equal(data.code, "bad_request");
});

await test("push subscribe refuses an invalid subscription", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const user = addUser(db, "u_push", "push@example.com");
  const bad = await call(pushSubscribeRequest, env, SUB_URL, {
    user, body: { subscription: validSubscription("https://evil.example/push") },
  });
  assert.equal(bad.res.status, 400);
  assert.equal(bad.data.code, "bad_subscription");
  const missing = await call(pushSubscribeRequest, env, SUB_URL, { user, body: {} });
  assert.equal(missing.res.status, 400);
  assert.equal(missing.data.code, "bad_subscription");
  assert.equal(db.state.pushSubs.size, 0);
});

await test("push subscribe stores a valid subscription for the signed in user", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const user = addUser(db, "u_push", "push@example.com");
  const { res, data } = await call(pushSubscribeRequest, env, SUB_URL, {
    user, body: { subscription: validSubscription(ENDPOINT_ONE) },
  });
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(db.state.pushSubs.size, 1);
  const stored = [...db.state.pushSubs.values()][0];
  assert.equal(stored.user_id, "u_push");
  assert.equal(stored.endpoint, ENDPOINT_ONE);
});

await test("push unsubscribe removes one endpoint, then all of them", async () => {
  const db = makeDb();
  const env = makeEnv(db);
  const user = addUser(db, "u_push", "push@example.com");
  await call(pushSubscribeRequest, env, SUB_URL, { user, body: { subscription: validSubscription(ENDPOINT_ONE) } });
  await call(pushSubscribeRequest, env, SUB_URL, { user, body: { subscription: validSubscription(ENDPOINT_TWO) } });
  assert.equal(db.state.pushSubs.size, 2);
  const one = await call(pushUnsubscribeRequest, env, UNSUB_URL, { user, body: { endpoint: ENDPOINT_ONE } });
  assert.equal(one.res.status, 200);
  assert.equal(one.data.ok, true);
  assert.equal(db.state.pushSubs.size, 1);
  assert.ok([...db.state.pushSubs.values()][0].endpoint === ENDPOINT_TWO, "the other endpoint survives");
  const all = await call(pushUnsubscribeRequest, env, UNSUB_URL, { user, rawBody: "" });
  assert.equal(all.res.status, 200);
  assert.equal(db.state.pushSubs.size, 0);
});

// ── Source pins for the same wave ───────────────────────────────────
group("platform source pins");

await test("the document endpoint builds its rate limit key through the shared clientIp helper", async () => {
  const src = await readFile(join(root, "functions/api/document.js"), "utf8");
  assert.ok(src.includes("const clientIP = clientIp(request);"), "document rate limit key does not use clientIp");
  assert.ok(!src.includes("X-Forwarded-For"), "document endpoint still consults the forwarded header");
});

await test("the search handler records per key usage with no remaining budget gate", async () => {
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  assert.ok(!src.includes("apiKeyIdentity && ledger.remaining()"), "per key usage is still gated on remaining budget");
  const at = src.lastIndexOf("recordApiKeyUsage");
  assert.ok(at > 0, "recordApiKeyUsage call not found");
  assert.ok(src.slice(Math.max(0, at - 400), at).includes("if (apiKeyIdentity) {"), "the usage record does not fire on the key identity alone");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
