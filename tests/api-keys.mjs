/**
 * Pro API key tests (functions/lib/apiKeys.js).
 *
 * Covers create/list/revoke/resolve with a minimal mock D1 that handles
 * exactly the SQL shapes the implementation issues.
 *
 * Run with: node tests/api-keys.mjs
 */

import { strict as assert } from "node:assert";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  resolveApiKey,
  API_KEY_PREFIX,
  MAX_KEYS_PER_USER,
} from "../functions/lib/apiKeys.js";

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

// Minimal mock D1: array of key rows. Handles the SQL shapes in apiKeys.js.
function mockDB() {
  const rows = [];
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  return {
    _rows: rows,
    async exec() {},
    prepare(sql) {
      const q = norm(sql);
      return {
        bind(...args) {
          const first = async () => {
            if (q.startsWith("SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL")) {
              return { n: rows.filter((r) => r.user_id === args[0] && r.revoked_at == null).length };
            }
            if (q.startsWith("SELECT id, user_id AS userId FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL")) {
              const r = rows.find((x) => x.key_hash === args[0] && x.revoked_at == null);
              return r ? { id: r.id, userId: r.user_id } : null;
            }
            throw new Error("mockD1 first() unhandled: " + q);
          };
          const run = async () => {
            if (q.startsWith("INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, created_at)")) {
              rows.push({ id: args[0], user_id: args[1], key_hash: args[2], key_prefix: args[3], name: args[4], created_at: args[5], last_used_at: null, revoked_at: null });
              return { meta: { changes: 1 } };
            }
            if (q.startsWith("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")) {
              const r = rows.find((x) => x.id === args[1] && x.user_id === args[2] && x.revoked_at == null);
              if (r) { r.revoked_at = args[0]; return { meta: { changes: 1 } }; }
              return { meta: { changes: 0 } };
            }
            if (q.startsWith("UPDATE api_keys SET last_used_at = ? WHERE id = ?")) {
              const r = rows.find((x) => x.id === args[1]);
              if (r) r.last_used_at = args[0];
              return {};
            }
            throw new Error("mockD1 run() unhandled: " + q);
          };
          const all = async () => {
            if (q.startsWith("SELECT id, key_prefix AS keyPrefix, name, created_at AS createdAt, last_used_at AS lastUsedAt FROM api_keys")) {
              return { results: rows.filter((r) => r.user_id === args[0] && r.revoked_at == null)
                .map((r) => ({ id: r.id, keyPrefix: r.key_prefix, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at })) };
            }
            throw new Error("mockD1 all() unhandled: " + q);
          };
          return { first, run, all };
        },
      };
    },
  };
}

function reqWithAuth(header) {
  return { headers: { get: (k) => (k.toLowerCase() === "authorization" ? header : null) } };
}

const env = { DB: mockDB() };

await okAsync("createApiKey returns a cbk_ key and stores only the hash", async () => {
  const created = await createApiKey(env, "u1", "my script");
  assert.ok(created.key.startsWith(API_KEY_PREFIX), "prefix");
  assert.ok(created.key.length > 30, "length");
  assert.equal(created.name, "my script");
  const stored = env.DB._rows[0];
  assert.ok(!("key" in stored), "raw key not stored");
  assert.ok(stored.key_hash && stored.key_hash.length === 64, "sha256 stored");
  assert.equal(stored.key_prefix, created.key.slice(0, 11));
});

await okAsync("resolveApiKey authenticates a valid key", async () => {
  const created = await createApiKey(env, "u2", "k");
  const resolved = await resolveApiKey(reqWithAuth("Bearer " + created.key), env);
  assert.ok(resolved, "resolved");
  assert.equal(resolved.userId, "u2");
});

await okAsync("resolveApiKey rejects garbage and wrong scheme", async () => {
  assert.equal(await resolveApiKey(reqWithAuth("Bearer cbk_nonexistentkey1234567890"), env), null);
  assert.equal(await resolveApiKey(reqWithAuth("Basic abc"), env), null);
  assert.equal(await resolveApiKey(reqWithAuth(null), env), null);
});

await okAsync("revokeApiKey kills the key", async () => {
  const created = await createApiKey(env, "u3", "k");
  const okRev = await revokeApiKey(env, "u3", created.id);
  assert.equal(okRev, true);
  const resolved = await resolveApiKey(reqWithAuth("Bearer " + created.key), env);
  assert.equal(resolved, null, "revoked key does not resolve");
  const again = await revokeApiKey(env, "u3", created.id);
  assert.equal(again, false, "double revoke is a no-op");
});

await okAsync("revokeApiKey cannot revoke another user's key", async () => {
  const created = await createApiKey(env, "u4", "k");
  const okRev = await revokeApiKey(env, "u5", created.id);
  assert.equal(okRev, false);
});

await okAsync("listApiKeys hides revoked keys and raw material", async () => {
  await createApiKey(env, "u6", "one");
  const c2 = await createApiKey(env, "u6", "two");
  await revokeApiKey(env, "u6", c2.id);
  const list = await listApiKeys(env, "u6");
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "one");
  assert.ok(!("key_hash" in list[0]) && !("key" in list[0]), "no secrets leaked");
});

await okAsync("createApiKey enforces the per-user cap", async () => {
  for (let i = 0; i < MAX_KEYS_PER_USER; i++) await createApiKey(env, "u7", "k" + i);
  let threw = null;
  try { await createApiKey(env, "u7", "one too many"); } catch (e) { threw = e; }
  assert.ok(threw && threw.code === "key_limit", "key_limit thrown");
});

console.log(`\n${passed} passed`);
