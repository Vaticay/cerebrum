/**
 * Embedding cache tests — D1-backed vector cache for semantic rerank.
 *
 * Paper embeddings are stable per (title+abstract), so we cache them keyed
 * by sha256 of the exact embedded text, 30-day TTL. Repeat searches then
 * cost ~1 embedding (the query) instead of ~21.
 *
 * Run with: node tests/embedding-cache.mjs
 */

import { strict as assert } from "node:assert";
import {
  sha256hex,
  getCachedPaperVectors,
  setCachedPaperVectors,
  semanticRerank,
  EMBEDDING_CACHE_TTL_MS,
  paperEmbedText,
} from "../functions/lib/semanticRerank.js";

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

// --- Minimal in-memory D1 mock ---
function mockDb() {
  const tables = new Map(); // key -> { vector_json, created_at }
  return {
    prepare(sql) {
      const q = {
        bind(...params) { q.params = params; return q; },
        async run() {
          if (/CREATE TABLE/i.test(sql)) return { success: true };
          if (/CREATE INDEX/i.test(sql)) return { success: true };
          if (/INSERT OR REPLACE/i.test(sql)) {
            const [key, vector_json, created_at] = q.params;
            tables.set(key, { vector_json, created_at });
            return { success: true };
          }
          if (/DELETE FROM embedding_cache WHERE created_at </i.test(sql)) {
            const [cutoff] = q.params;
            for (const [k, v] of tables) if (v.created_at < cutoff) tables.delete(k);
            return { success: true };
          }
          return { success: true };
        },
        async first() { return null; },
        async all() {
          // SELECT key, vector_json ... WHERE key IN (...) AND created_at > ?
          const cutoff = q.params[q.params.length - 1];
          const keys = q.params.slice(0, -1);
          const results = [];
          for (const k of keys) {
            const row = tables.get(k);
            if (row && row.created_at > cutoff) results.push({ key: k, vector_json: row.vector_json });
          }
          return { results };
        },
      };
      return q;
    },
    batch(stmts) { return Promise.all(stmts.map((s) => s.run())); },
    _tables: tables,
  };
}
const mockEnv = (db) => ({ DB: db });

// --- sha256hex ---
await okAsync("sha256hex: deterministic", async () => {
  const a = await sha256hex("hello world");
  const b = await sha256hex("hello world");
  assert.equal(a, b);
  assert.ok(a.length >= 16, "should produce a usable key");
});

await okAsync("sha256hex: different inputs differ", async () => {
  const a = await sha256hex("paper one title");
  const b = await sha256hex("paper two title");
  assert.notEqual(a, b);
});

await okAsync("sha256hex: never throws on empty", async () => {
  const k = await sha256hex("");
  assert.ok(typeof k === "string" && k.length > 0);
});

// --- cache round-trip ---
await okAsync("cache: miss then hit", async () => {
  const db = mockDb();
  const env = mockEnv(db);
  const keys = ["k1", "k2"];
  const miss = await getCachedPaperVectors(env, keys);
  assert.equal(miss.size, 0, "empty cache → all miss");

  await setCachedPaperVectors(env, [
    { key: "k1", vector: [0.1, 0.2, 0.3] },
    { key: "k2", vector: [0.4, 0.5, 0.6] },
  ]);
  const hit = await getCachedPaperVectors(env, keys);
  assert.equal(hit.size, 2, "both should hit after store");
  assert.deepEqual(hit.get("k1"), [0.1, 0.2, 0.3]);
});

await okAsync("cache: no DB → empty map, never throws", async () => {
  const miss = await getCachedPaperVectors({}, ["k1"]);
  assert.equal(miss.size, 0);
  await setCachedPaperVectors({}, [{ key: "k1", vector: [1] }]); // should not throw
  await setCachedPaperVectors(null, [{ key: "k1", vector: [1] }]);
});

await okAsync("cache: TTL expiry treated as miss", async () => {
  const db = mockDb();
  const env = mockEnv(db);
  // Manually insert an expired row
  db._tables.set("old", {
    vector_json: JSON.stringify([9, 9, 9]),
    created_at: Date.now() - EMBEDDING_CACHE_TTL_MS - 1000,
  });
  const hit = await getCachedPaperVectors(env, ["old"]);
  assert.equal(hit.size, 0, "expired entry should miss");
});

await okAsync("cache: corrupt JSON treated as miss", async () => {
  const db = mockDb();
  const env = mockEnv(db);
  db._tables.set("bad", { vector_json: "not-json{{{", created_at: Date.now() });
  const hit = await getCachedPaperVectors(env, ["bad"]);
  assert.equal(hit.size, 0, "corrupt entry should miss, not throw");
});

await okAsync("cache: invalid entries filtered on store", async () => {
  const db = mockDb();
  const env = mockEnv(db);
  await setCachedPaperVectors(env, [
    { key: "good", vector: [1, 2] },
    { key: "", vector: [1, 2] },       // no key
    { key: "novec", vector: [] },       // empty vector
    { key: "nullvec", vector: null },   // null vector
    null,                               // null entry
  ]);
  assert.equal(db._tables.size, 1, "only the valid entry should store");
  assert.ok(db._tables.has("good"));
});

// --- end-to-end: rerank uses cache on second call ---
await okAsync("rerank: second identical call hits cache (fewer embedding texts)", async () => {
  const db = mockDb();
  let aiCalls = [];
  const env = {
    DB: db,
    AI: {
      run: async (model, { text }) => {
        aiCalls.push(text.length);
        // Deterministic mock vectors: quality by position
        return { data: text.map((t, i) => [0.1 * (i + 1), 0.2, 0.3]) };
      },
    },
  };
  const papers = [
    { title: "CRISPR gene editing paper", abstract: "gene editing abstract", score: 70 },
    { title: "CRISPR screening paper", abstract: "screening abstract", score: 75 },
  ];
  const r1 = await semanticRerank(env, "CRISPR gene editing", papers, { topN: 2 });
  assert.ok(r1.semanticApplied, "first call should apply");
  const firstCallTexts = aiCalls[0];

  aiCalls = [];
  const r2 = await semanticRerank(env, "CRISPR gene editing", papers, { topN: 2 });
  assert.ok(r2.semanticApplied, "second call should apply");
  const secondCallTexts = aiCalls[0];

  assert.ok(secondCallTexts < firstCallTexts,
    `cached call should embed fewer texts (${secondCallTexts} < ${firstCallTexts})`);
  assert.equal(secondCallTexts, 1, "all papers cached → only the query is embedded");
  // Results should be identical
  assert.deepEqual(
    r2.papers.map((p) => p.blendedScore),
    r1.papers.map((p) => p.blendedScore),
    "cached rerank should produce identical scores"
  );
});

await okAsync("rerank: works with no DB (cache skipped)", async () => {
  const env = {
    AI: {
      run: async (model, { text }) => ({ data: text.map(() => [0.5, 0.5, 0.5]) }),
    },
  };
  const papers = [{ title: "t", abstract: "a", score: 80 }];
  const r = await semanticRerank(env, "q", papers, { topN: 1 });
  assert.ok(r.semanticApplied, "should work without DB");
});

console.log(`\n${passed} passed`);
