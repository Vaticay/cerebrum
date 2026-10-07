/**
 * Priority search queue tests (functions/lib/searchPriority.js).
 *
 * Covers acquire/release with a minimal mock D1 handling exactly the SQL
 * shapes the implementation issues.
 *
 * Run with: node tests/search-priority.mjs
 */

import { strict as assert } from "node:assert";
import {
  acquireSearchSlot,
  releaseSearchSlot,
  MAX_CONCURRENT_SEARCHES,
  PRO_RESERVED_SLOTS,
} from "../functions/lib/searchPriority.js";

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

// Minimal mock D1: single-row counter.
function mockDB() {
  let n = 0;
  let expires = 0;
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  return {
    _get: () => n,
    // Simulate a crashed worker: leaked count, expiry long past.
    _set: (v) => { n = v; expires = 0; },
    async exec() {},
    prepare(sql) {
      const q = norm(sql);
      // Real D1 lets you call .first()/.run() directly on the prepared
      // statement (no .bind() needed when there are no parameters).
      const stmt = (...args) => {
        const first = async () => {
          if (q.startsWith("SELECT n FROM search_slots WHERE k = 'active'")) {
            return { n };
          }
          throw new Error("mockD1 first() unhandled: " + q);
        };
        const run = async () => {
          if (q.startsWith("UPDATE search_slots SET n = 0 WHERE k = 'active' AND expires_at < ?")) {
            if (expires < args[0]) n = 0;
            return {};
          }
          if (q.startsWith("INSERT INTO search_slots (k, n, expires_at) VALUES ('active', 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1, expires_at = ?")) {
            n += 1; expires = args[1];
            return {};
          }
          if (q.startsWith("UPDATE search_slots SET n = MAX(n - 1, 0) WHERE k = 'active'")) {
            n = Math.max(n - 1, 0);
            return {};
          }
          throw new Error("mockD1 run() unhandled: " + q);
        };
        return { first, run };
      };
      return { bind: (...args) => stmt(...args), first: () => stmt().first(), run: () => stmt().run() };
    },
  };
}

const env = { DB: mockDB() };

await okAsync("standard acquire succeeds under capacity", async () => {
  const s = await acquireSearchSlot(env, false);
  assert.equal(s.allowed, true);
  assert.equal(s.priority, "standard");
  await releaseSearchSlot(env);
  assert.equal(env.DB._get(), 0, "released");
});

await okAsync("standard requests are denied past their cap, Pro proceeds", async () => {
  const cap = MAX_CONCURRENT_SEARCHES - PRO_RESERVED_SLOTS;
  const held = [];
  for (let i = 0; i < cap; i++) {
    const s = await acquireSearchSlot(env, false);
    assert.equal(s.allowed, true, "slot " + i);
    held.push(s);
  }
  // One more standard request: denied.
  const denied = await acquireSearchSlot(env, false);
  assert.equal(denied.allowed, false, "standard denied at cap");
  assert.equal(env.DB._get(), cap, "denied request gave its slot back");
  // Pro request: allowed (reserved headroom).
  const pro = await acquireSearchSlot(env, true);
  assert.equal(pro.allowed, true, "pro allowed past standard cap");
  assert.equal(pro.priority, "pro");
  // Pro at absolute max: still allowed (cap == MAX).
  for (let i = 0; i < PRO_RESERVED_SLOTS - 1; i++) await acquireSearchSlot(env, true);
  const proFull = await acquireSearchSlot(env, true);
  assert.equal(proFull.allowed, false, "pro denied past absolute max");
  // Drain everything.
  for (let i = 0; i < cap + PRO_RESERVED_SLOTS; i++) await releaseSearchSlot(env);
  assert.equal(env.DB._get(), 0, "drained");
});

await okAsync("release never drives the counter negative", async () => {
  await releaseSearchSlot(env);
  await releaseSearchSlot(env);
  assert.equal(env.DB._get(), 0);
});

await okAsync("stale counter self-heals", async () => {
  // Simulate a leaked counter: high n, ancient expiry.
  env.DB._set(19);
  const s = await acquireSearchSlot(env, false);
  assert.equal(s.allowed, true, "healed counter allows");
  assert.ok(s.active <= 2, "counter was reset, got " + s.active);
  await releaseSearchSlot(env);
});

await okAsync("no DB fails open", async () => {
  const s = await acquireSearchSlot({}, false);
  assert.equal(s.allowed, true, "fail-open without DB");
  await releaseSearchSlot({});
});

console.log(`\n${passed} passed`);
