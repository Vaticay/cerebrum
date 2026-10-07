/**
 * Embedding-neuron budget tests (semantic rerank cost control).
 *
 * Covers functions/lib/costControl.js: checkEmbeddingBudget,
 * spendEmbeddingNeurons, and the daily cap guard. Uses a minimal mock D1
 * that handles exactly the SQL shapes the implementation issues.
 *
 * Run with: node tests/embedding-budget.mjs
 */

import { strict as assert } from "node:assert";
import {
  checkEmbeddingBudget,
  spendEmbeddingNeurons,
  EMBEDDING_DAILY_CAP,
  EMBEDDING_NEURON_COST_PER_RERANK,
} from "../functions/lib/costControl.js";

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

// Minimal mock D1: Map day_key -> used_neurons. Replicates the atomic
// guard in spendEmbeddingNeurons (UPDATE ... WHERE used + ? <= cap).
function mockDB() {
  const rows = new Map();
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  return {
    _rows: rows,
    async exec() {},
    prepare(sql) {
      const q = norm(sql);
      return {
        bind(...args) {
          const first = async () => {
            if (q.startsWith("SELECT used_neurons FROM embedding_neuron_usage WHERE day_key = ?")) {
              const n = rows.get(args[0]);
              return n == null ? null : { used_neurons: n };
            }
            throw new Error("mockD1 first() unhandled: " + q);
          };
          const run = async () => {
            if (q.startsWith("INSERT OR IGNORE INTO embedding_neuron_usage")) {
              if (!rows.has(args[0])) rows.set(args[0], 0);
              return {};
            }
            if (q.startsWith("UPDATE embedding_neuron_usage SET used_neurons = used_neurons + ?")) {
              const [cost, , day, cost2] = args;
              const cur = rows.get(day) || 0;
              if (cur + cost2 <= EMBEDDING_DAILY_CAP) rows.set(day, cur + cost);
              return {};
            }
            throw new Error("mockD1 run() unhandled: " + q);
          };
          return { first, run };
        },
      };
    },
  };
}

await okAsync("no D1 → conservative skip (allowed: false)", async () => {
  const r = await checkEmbeddingBudget({});
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "no_ledger");
});

await okAsync("fresh day → allowed, used 0", async () => {
  const env = { DB: mockDB() };
  const r = await checkEmbeddingBudget(env);
  assert.equal(r.allowed, true);
  assert.equal(r.used, 0);
  assert.equal(r.cap, EMBEDDING_DAILY_CAP);
});

await okAsync("spend increases used total", async () => {
  const db = mockDB();
  const env = { DB: db };
  await checkEmbeddingBudget(env); // creates the row
  const used = await spendEmbeddingNeurons(env, EMBEDDING_NEURON_COST_PER_RERANK);
  assert.equal(used, EMBEDDING_NEURON_COST_PER_RERANK);
  const r = await checkEmbeddingBudget(env);
  assert.equal(r.used, EMBEDDING_NEURON_COST_PER_RERANK);
  assert.equal(r.allowed, true);
});

await okAsync("atomic guard: cannot overspend past cap", async () => {
  const db = mockDB();
  const env = { DB: db };
  await checkEmbeddingBudget(env);
  // Drive used to cap - 10 via the mock directly.
  db._rows.set(todayKey(), EMBEDDING_DAILY_CAP - 10);
  const before = await spendEmbeddingNeurons(env, 20); // would exceed cap
  assert.equal(before, EMBEDDING_DAILY_CAP - 10, "guard must block the overspend");
  const r = await checkEmbeddingBudget(env);
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "daily_cap_reached");
});

await okAsync("exact-fit spend at cap boundary is allowed", async () => {
  const db = mockDB();
  const env = { DB: db };
  await checkEmbeddingBudget(env);
  db._rows.set(todayKey(), EMBEDDING_DAILY_CAP - EMBEDDING_NEURON_COST_PER_RERANK);
  const r = await checkEmbeddingBudget(env);
  assert.equal(r.allowed, true, "remaining == cost must still be allowed");
  const used = await spendEmbeddingNeurons(env, EMBEDDING_NEURON_COST_PER_RERANK);
  assert.equal(used, EMBEDDING_DAILY_CAP);
});

await okAsync("spend with no DB returns 0 (no crash)", async () => {
  const used = await spendEmbeddingNeurons({}, 20);
  assert.equal(used, 0);
});

await okAsync("ledger error → conservative skip, never throws", async () => {
  const badDb = { prepare() { throw new Error("boom"); }, async exec() {} };
  const r = await checkEmbeddingBudget({ DB: badDb });
  assert.equal(r.allowed, false);
});

function todayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

console.log(`\nembedding-budget: ${passed} passed`);
