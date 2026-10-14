/**
 * Shared-library reliability tests.
 *
 * Covers the guards added in the shared-libs reliability pass:
 * input-size caps in knowledge.js, the frozen MeSH vocabulary in
 * meshBulk.js, the per-key timestamp cap in rateLimit.js, the history
 * bound in conversation.js, and the trending-feed hardening
 * (stale-date fix + upstream body size cap) in trendingSource.js.
 *
 * Unit tests against the real modules — no server, no database, no
 * network (fetch is stubbed where a module would otherwise call out).
 *
 * Run with: node tests/shared-libs.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

function group(name) {
  console.log(`\n${name}`);
}

// ══════════════════════════════════════════════════════════════════════════
group("meshBulk — shared vocabulary integrity");

const { MESH_BULK } = await import(join(root, "functions/lib/meshBulk.js"));

await test("data shape is valid across all entries", () => {
  const keys = Object.keys(MESH_BULK);
  assert.ok(keys.length >= 8000, `expected ~8500 keys, got ${keys.length}`);
  for (const k of keys) {
    assert.ok(typeof k === "string" && k.length > 0, `bad key: ${JSON.stringify(k)}`);
    const v = MESH_BULK[k];
    assert.ok(Array.isArray(v) && v.length > 0, `bad value for key ${k}`);
    for (const s of v) assert.ok(typeof s === "string" && s.length > 0, `bad synonym for key ${k}`);
  }
});

await test("the vocabulary and every synonym array are frozen", () => {
  assert.ok(Object.isFrozen(MESH_BULK), "MESH_BULK is not frozen");
  for (const syns of Object.values(MESH_BULK)) {
    assert.ok(Object.isFrozen(syns), "a synonym array is not frozen");
  }
});

await test("a write attempt fails loudly instead of poisoning the isolate", () => {
  assert.throws(() => { MESH_BULK.__poison = ["x"]; }, TypeError);
  assert.throws(() => { MESH_BULK["zyvox"].push("__poison"); }, TypeError);
  assert.ok(!MESH_BULK.__poison, "poison key survived");
  assert.ok(!MESH_BULK["zyvox"].includes("__poison"), "poison synonym survived");
});

// ══════════════════════════════════════════════════════════════════════════
group("knowledge.js — input-size guards");

const {
  expandViaMesh,
  extractEntities,
  verifyAnswerAgainstSources,
} = await import(join(root, "functions/lib/knowledge.js"));

await test("expandViaMesh still expands a normal query", () => {
  const syns = expandViaMesh("heart attack");
  assert.ok(syns.includes("myocardial infarction"), `missing curated synonym: ${syns.slice(0, 4)}`);
  assert.ok(syns.length <= 12, "synonym cap exceeded");
});

await test("expandViaMesh bounds the n-gram scan on huge input", () => {
  // A matching phrase past the 1000-word cap is not expanded — the scan
  // stays O(bounded) instead of O(words × 6) on a pasted document.
  const filler = Array(1500).fill("lorem");
  filler[1200] = "heart";
  filler[1201] = "attack";
  const late = expandViaMesh(filler.join(" "));
  assert.ok(Array.isArray(late), "did not return an array");
  assert.ok(!late.includes("myocardial infarction"), "scan was not bounded");
  // Control: the same phrase inside the window still expands.
  const early = expandViaMesh(["heart", "attack", ...Array(50).fill("lorem")].join(" "));
  assert.ok(early.includes("myocardial infarction"), "in-window expansion broke");
});

await test("extractEntities caps the scanned text instead of stalling", () => {
  const head = "aspirin ".repeat(100);
  const tail = "x".repeat(300_000) + " metformin";
  const { drugs } = extractEntities(head + tail);
  assert.ok(drugs.includes("aspirin"), "entity inside the window missed");
  assert.ok(!drugs.includes("metformin"), "entity past the 200k cap was scanned");
});

await test("verifyAnswerAgainstSources bounds papers and per-paper text", () => {
  const papers = Array.from({ length: 150 }, (_, i) => ({
    title: `Paper ${i}`,
    // 100 KB abstract — must not blow up the join/scan.
    abstract: i === 5 ? "aspirin was administered" : "nothing relevant here ".repeat(5000),
  }));
  // Entity only in paper 120 (past the 100-paper cap) -> unsupported.
  papers[120].abstract = "metformin was administered";
  const r = verifyAnswerAgainstSources("Both aspirin and metformin were studied.", papers);
  assert.equal(r.checked, true);
  assert.ok(r.supported.includes("aspirin"), `aspirin should be supported: ${JSON.stringify(r.supported)}`);
  assert.ok(r.unsupported.includes("metformin"), `metformin (paper 120) should be out of scope: ${JSON.stringify(r.unsupported)}`);
});

await test("verifyAnswerAgainstSources never throws on malformed input", () => {
  assert.doesNotThrow(() => verifyAnswerAgainstSources(null, null));
  assert.doesNotThrow(() => verifyAnswerAgainstSources("aspirin", "not an array"));
  assert.doesNotThrow(() => verifyAnswerAgainstSources("aspirin", [{ title: null, abstract: 42 }]));
  const r = verifyAnswerAgainstSources("aspirin", [{ title: null, abstract: 42 }]);
  assert.equal(r.checked, true);
  assert.ok(r.unsupported.includes("aspirin"));
});

// ══════════════════════════════════════════════════════════════════════════
group("trendingSource — stale dates and untrusted bodies");

const trendingSrc = await import("node:fs/promises").then((fs) =>
  fs.readFile(join(root, "functions/lib/trendingSource.js"), "utf8"));

await test("the bioRxiv date window is computed per refresh, not at import", () => {
  // A module-level IIFE would freeze "today" for the life of a warm
  // isolate; the URL must be a thunk resolved inside fetchTrendingItems.
  assert.match(trendingSrc, /url: \(\) => \{[\s\S]{0,400}api\.biorxiv\.org\/details\/biorxiv/, "bioRxiv url is not a thunk");
  assert.match(trendingSrc, /typeof src\.url === "function" \? src\.url\(\) : src\.url/, "fetchTrendingItems does not resolve url thunks");
});

const { fetchTrendingItems } = await import(join(root, "functions/lib/trendingSource.js"));

function stubFetch(handler) {
  const saved = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = saved; };
}

// Fixture dates are relative to the run's own clock: the edition
// window in fetchTrendingItems is judged on the real Date.now, so the
// hard coded 2026-09-01..04 dates these used to carry would have
// fallen out of the 90 day window around 2026-11-30 and emptied the
// fixture feed with no code change at all.
const fixtureDay = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const canned = {
  europepmc: {
    resultList: { result: [{ title: "EPMC paper.", abstractText: "An abstract.", doi: "10.1/x",
      journalTitle: "J Test", authorString: "A Uthor", firstPublicationDate: fixtureDay(4) }] },
  },
  biorxiv: {
    collection: [{ title: "Biorxiv preprint", abstract: "Preprint abstract.", doi: "10.2/y",
      category: "neuroscience", authors: "B Uthor", date: fixtureDay(3) }],
  },
  arxiv: `<feed><entry><title>Arxiv paper</title><summary>Arxiv abstract.</summary>` +
    `<id>https://arxiv.org/abs/2609.00001</id><published>${fixtureDay(2)}</published></entry></feed>`,
  spaceflight: {
    results: [{ title: "Space story", summary: "A summary.", url: "https://example.com/space",
      image_url: "", news_site: "NASA", published_at: fixtureDay(1) }],
  },
};

function cannedFetch(map) {
  return async (url) => {
    const body = map(url);
    if (body === null) return new Response("nope", { status: 500 });
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(payload, { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

function routeCanned() {
  return (url) => {
    if (url.includes("europepmc")) return canned.europepmc;
    if (url.includes("biorxiv")) return canned.biorxiv;
    if (url.includes("export.arxiv.org")) return canned.arxiv;
    if (url.includes("spaceflightnewsapi")) return canned.spaceflight;
    throw new Error("unexpected url: " + url);
  };
}

await test("the bioRxiv request carries today's date window", async () => {
  const seen = [];
  const restore = stubFetch(cannedFetch((url) => { seen.push(url); return routeCanned()(url); }));
  try {
    await fetchTrendingItems();
  } finally { restore(); }
  const bx = seen.find((u) => u.includes("api.biorxiv.org/details/biorxiv/"));
  assert.ok(bx, "bioRxiv was not requested");
  const d = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  assert.ok(bx.endsWith(`/biorxiv/${d(4)}/${d(0)}`), `stale date window in ${bx}`);
});

await test("a normal refresh parses, dedups and interleaves disciplines", async () => {
  const restore = stubFetch(cannedFetch(routeCanned()));
  let items;
  try { items = await fetchTrendingItems(); } finally { restore(); }
  assert.equal(items.length, 4);
  const cats = items.map((i) => i.category);
  assert.deepEqual(cats, ["Biology & Medicine", "Preprints", "Physics & Chemistry", "Space"]);
  assert.ok(items.every((i) => i.title && i.url), "item missing title/url");
});

await test("an oversized upstream body is rejected and the feed degrades", async () => {
  const restore = stubFetch(cannedFetch((url) => {
    if (url.includes("europepmc")) return "x".repeat(5 * 1024 * 1024); // 5 MB > 4 MB cap
    return routeCanned()(url);
  }));
  let items;
  try { items = await fetchTrendingItems(); } finally { restore(); }
  assert.ok(Array.isArray(items), "refresh threw instead of degrading");
  assert.ok(!items.some((i) => i.category === "Biology & Medicine"), "oversized source was not dropped");
  assert.equal(items.length, 3, "healthy sources should still feed");
});

await test("a failing source is absent, not fatal", async () => {
  const restore = stubFetch(cannedFetch((url) => (url.includes("arxiv") ? null : routeCanned()(url))));
  let items;
  try { items = await fetchTrendingItems(); } finally { restore(); }
  assert.equal(items.length, 3);
  assert.ok(!items.some((i) => i.category === "Physics & Chemistry"));
});

// ══════════════════════════════════════════════════════════════════════════
group("rateLimit — memory-bucket bound");

const { checkRateLimit } = await import(join(root, "functions/lib/rateLimit.js"));

await test("rejects once the limit is exceeded", async () => {
  const key = "test:basic:" + Math.random();
  assert.equal(await checkRateLimit({}, key, 3, 60000), true);
  assert.equal(await checkRateLimit({}, key, 3, 60000), true);
  assert.equal(await checkRateLimit({}, key, 3, 60000), true);
  assert.equal(await checkRateLimit({}, key, 3, 60000), false);
  assert.equal(await checkRateLimit({}, key, 3, 60000), false);
});

await test("a hot key stays rejected without unbounded timestamp growth", async () => {
  const key = "test:hot:" + Math.random();
  for (let i = 0; i < 500; i++) await checkRateLimit({}, key, 5, 60000);
  // Still exactly at the cap decision, and the stored array is capped at
  // limit+1 rather than holding all 500 timestamps.
  assert.equal(await checkRateLimit({}, key, 5, 60000), false);
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(join(root, "functions/lib/rateLimit.js"), "utf8"));
  assert.match(src, /slice\(-cap\)/, "per-key timestamp cap missing");
});

await test("expired timestamps stop counting", async () => {
  const key = "test:expiry:" + Math.random();
  assert.equal(await checkRateLimit({}, key, 2, 60), true);
  assert.equal(await checkRateLimit({}, key, 2, 60), true);
  assert.equal(await checkRateLimit({}, key, 2, 60), false);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(await checkRateLimit({}, key, 2, 60), true, "window did not reset");
});

// ── Fake D1 binding for the shared-limiter D1 path ──────────────────────
// Implements just enough of the D1 API (exec/prepare/bind/first/run) for
// rateLimit.js: an in-memory map of k -> { count, expires_at }.
function fakeD1() {
  const rows = new Map();
  const db = {
    _rows: rows,
    _writes: 0,
    _batches: 0,
    async exec() { return undefined; },
    // One call however many statements it carries, matching the
    // platform convention the ledger counts by: SELECTs answer
    // from the map, writes apply through the statement's own run.
    async batch(stmts) {
      db._batches++;
      const out = [];
      for (const s of stmts) {
        if (/SELECT count FROM rate_limits/i.test(s._sql)) {
          const r = rows.get(s._params[0]);
          out.push({ results: r ? [{ count: r.count }] : [] });
        } else {
          await s.run();
          out.push({ success: true });
        }
      }
      return out;
    },
    prepare(sql) {
      const stmt = {
        _params: [],
        _sql: sql,
        bind(...params) { stmt._params = params; return stmt; },
        async first() {
          if (/SELECT count FROM rate_limits/i.test(sql)) {
            const r = rows.get(stmt._params[0]);
            return r ? { count: r.count } : null;
          }
          return null;
        },
        async run() {
          if (/INSERT INTO rate_limits/i.test(sql)) {
            db._writes++;
            const [k, expiresAt] = stmt._params;
            const r = rows.get(k);
            if (r) { r.count += 1; r.expires_at = expiresAt; }
            else rows.set(k, { count: 1, expires_at: expiresAt });
          } else if (/DELETE FROM rate_limits/i.test(sql)) {
            const now = stmt._params[0];
            for (const [k, r] of rows) if (r.expires_at < now) rows.delete(k);
          }
          return { success: true };
        },
      };
      return stmt;
    },
  };
  return db;
}

await test("D1 path: rejects once the limit is exceeded", async () => {
  const db = fakeD1();
  const key = "test:d1:basic:" + Math.random();
  const env = { DB: db };
  assert.equal(await checkRateLimit(env, key, 3, 60000), true);
  assert.equal(await checkRateLimit(env, key, 3, 60000), true);
  assert.equal(await checkRateLimit(env, key, 3, 60000), true);
  assert.equal(await checkRateLimit(env, key, 3, 60000), false);
  assert.equal(await checkRateLimit(env, key, 3, 60000), false);
});

await test("D1 path: over-limit requests skip the write", async () => {
  const db = fakeD1();
  const key = "test:d1:nowrite:" + Math.random();
  const env = { DB: db };
  for (let i = 0; i < 3; i++) await checkRateLimit(env, key, 3, 60000);
  const writesBefore = db._writes;
  assert.equal(await checkRateLimit(env, key, 3, 60000), false);
  assert.equal(await checkRateLimit(env, key, 3, 60000), false);
  assert.equal(db._writes, writesBefore, "rejected requests wrote to D1");
});

await test("D1 path: a failing D1 fails open to memory", async () => {
  const broken = { prepare() { throw new Error("d1 down"); }, async exec() { throw new Error("d1 down"); } };
  const key = "test:d1:failopen:" + Math.random();
  const env = { DB: broken };
  assert.equal(await checkRateLimit(env, key, 3, 60000), true);
  assert.equal(await checkRateLimit(env, key, 3, 60000), true);
  assert.equal(await checkRateLimit(env, key, 3, 60000), true);
  assert.equal(await checkRateLimit(env, key, 3, 60000), false, "memory fallback did not enforce the limit");
});

await test("D1 path: no KV binding is consulted", async () => {
  const src = await import("node:fs/promises").then((fs) =>
    fs.readFile(join(root, "functions/lib/rateLimit.js"), "utf8"));
  assert.ok(!/RATE_LIMIT_KV/.test(src), "rateLimit.js still references the removed KV binding");
});

// ── checkRateLimitBatch (2026-10-14, overhead audit) ───────────────────
// The search handler's two checks (sustained + burst) in one batched
// read and one batched write. Decisions must equal the sequential
// checkRateLimit calls exactly, including the short circuit: once a
// check fails, later checks are never written.
const { checkRateLimitBatch } = await import(join(root, "functions/lib/rateLimit.js"));

await test("batch: same decisions as sequential, first failure index reported", async () => {
  const dbA = fakeD1();
  const dbB = fakeD1();
  const key = "test:d1:batch:" + Math.random();
  const checks = [
    { key, limit: 3, windowMs: 60000 },
    { key: key + ":burst", limit: 2, windowMs: 10000 },
  ];
  // Burst (limit 2) binds first: calls 1-2 pass both, call 3 fails
  // the burst check (index 1), call 4 fails the sustained (index 0).
  const expected = [-1, -1, 1, 0, 0];
  for (let i = 0; i < expected.length; i++) {
    const viaBatch = await checkRateLimitBatch({ DB: dbA }, checks);
    let viaSeq = -1;
    if (!(await checkRateLimit({ DB: dbB }, checks[0].key, checks[0].limit, checks[0].windowMs))) viaSeq = 0;
    else if (!(await checkRateLimit({ DB: dbB }, checks[1].key, checks[1].limit, checks[1].windowMs))) viaSeq = 1;
    assert.equal(viaBatch, expected[i], `call ${i + 1}: batch returned ${viaBatch}`);
    assert.equal(viaSeq, expected[i], `call ${i + 1}: sequential returned ${viaSeq}`);
  }
  // Final counters identical on both paths — including the short
  // circuit: the burst counter stopped at 2 (never written after
  // its first failure), the sustained at 3.
  const counts = (db) => [...db._rows.entries()].map(([k, r]) => [k.split(":").slice(-2).join(":"), r.count]).sort();
  assert.deepEqual(counts(dbA), counts(dbB), "batched and sequential counters diverged");
  const burst = [...dbA._rows.values()];
  assert.ok(burst.every((r) => r.count <= 3), "a counter grew past its limit");
});

await test("batch: two platform calls per request once ensured", async () => {
  const db = fakeD1();
  const key = "test:d1:batchcost:" + Math.random();
  const checks = [
    { key, limit: 30, windowMs: 60000 },
    { key: key + ":burst", limit: 6, windowMs: 10000 },
  ];
  await checkRateLimitBatch({ DB: db }, checks);
  await checkRateLimitBatch({ DB: db }, checks);
  assert.equal(db._batches, 4, "expected a read batch and a write batch per request");
});

await test("batch: no batch on the binding falls back to sequential decisions", async () => {
  const db = fakeD1();
  delete db.batch;
  const key = "test:d1:batchfallback:" + Math.random();
  const checks = [
    { key, limit: 2, windowMs: 60000 },
    { key: key + ":burst", limit: 6, windowMs: 10000 },
  ];
  assert.equal(await checkRateLimitBatch({ DB: db }, checks), -1);
  assert.equal(await checkRateLimitBatch({ DB: db }, checks), -1);
  assert.equal(await checkRateLimitBatch({ DB: db }, checks), 0, "sequential fallback did not enforce");
});

// ══════════════════════════════════════════════════════════════════════════
group("conversation — history bound");

const { previousAnswer, contextAction } = await import(join(root, "functions/lib/conversation.js"));

await test("previousAnswer finds the latest assistant message in a long history", () => {
  const history = [];
  for (let i = 0; i < 5000; i++) history.push({ role: "user", content: `question ${i}` });
  history.push({ role: "assistant", content: "the latest answer" });
  const found = previousAnswer(history);
  assert.ok(found && found.content === "the latest answer");
});

await test("previousAnswer scans only the last 100 turns", () => {
  const history = [{ role: "assistant", content: "ancient answer" }];
  for (let i = 0; i < 200; i++) history.push({ role: "user", content: `q${i}` });
  assert.ok(!previousAnswer(history), "scanned past the 100-turn bound");
  history.push({ role: "assistant", content: "recent answer" });
  assert.equal(previousAnswer(history).content, "recent answer");
});

await test("contextAction still routes follow-ups", () => {
  assert.equal(contextAction("summarize that"), "summary");
  assert.equal(contextAction("What is CRISPR?"), null);
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
