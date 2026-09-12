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

const canned = {
  europepmc: {
    resultList: { result: [{ title: "EPMC paper.", abstractText: "An abstract.", doi: "10.1/x",
      journalTitle: "J Test", authorString: "A Uthor", firstPublicationDate: "2026-09-01" }] },
  },
  biorxiv: {
    collection: [{ title: "Biorxiv preprint", abstract: "Preprint abstract.", doi: "10.2/y",
      category: "neuroscience", authors: "B Uthor", date: "2026-09-02" }],
  },
  arxiv: `<feed><entry><title>Arxiv paper</title><summary>Arxiv abstract.</summary>` +
    `<id>https://arxiv.org/abs/2609.00001</id><published>2026-09-03</published></entry></feed>`,
  spaceflight: {
    results: [{ title: "Space story", summary: "A summary.", url: "https://example.com/space",
      image_url: "", news_site: "NASA", published_at: "2026-09-04" }],
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
