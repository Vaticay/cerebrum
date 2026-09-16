/**
 * Trending digest integrity — the newspaper edition must be honest.
 *
 * Three invariants:
 *  1. The no-photograph cover is a solid tonal field, not a decorative
 *     gradient (the craft pass killed gradients on cards; coverFor was a
 *     survivor — this locks the fix).
 *  2. "Cited by N" comes only from Europe PMC's own citedByCount field and
 *     is shown only when positive. No trending score, no read counts, no
 *     view numbers are ever invented — the upstream sources do not provide
 *     them and the digest must not print what it does not know.
 *  3. The "why it matters" signal degrades to nothing, never to a fake:
 *     a record without a citation count carries citedByCount 0.
 *
 * Standalone script with its own assertions; run as a child process from
 * tests/run. The backend half runs against the real fetchTrendingItems
 * with stubbed fetch (no network); the frontend half is a source
 * assertion on src/CerebrumApp.jsx.
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

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
group("trending digest — frontend craft and honesty");

const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");

await test("coverFor paints a solid tonal field, never a gradient", () => {
  const m = appSrc.match(/function coverFor\(item\) \{[\s\S]*?\n\}/);
  assert.ok(m, "coverFor not found");
  assert.doesNotMatch(m[0], /linear-gradient|radial-gradient/, "coverFor still emits a decorative gradient");
  assert.match(m[0], /background: `hsl\(/, "coverFor background is not a solid hsl tone");
});

await test("no fabricated engagement numbers anywhere in the trending view", () => {
  // The digest prints what the feed provides: title, source, journal,
  // recency, and Europe PMC citation counts. Read counts, view counts and
  // "trending scores" do not exist upstream and must never be printed.
  const trendStart = appSrc.indexOf("function TrendingView(");
  const trendEnd = appSrc.indexOf("/* ═", trendStart);
  assert.ok(trendStart > 0 && trendEnd > trendStart, "TrendingView bounds not found");
  const view = appSrc.slice(trendStart, trendEnd);
  assert.doesNotMatch(view, /reads?\b.{0,20}\d|views?\b.{0,20}\d|trending score/i, "fabricated engagement stat in TrendingView");
});

await test("the 'Cited by' label is guarded by a real positive count", () => {
  assert.match(
    appSrc,
    /item\.citedByCount > 0 \? `Cited by \$\{item\.citedByCount\}`/,
    "digest 'Cited by' label is not guarded by a positive count"
  );
});

// ══════════════════════════════════════════════════════════════════════════
group("trending digest — citation signal is real and never invented");

const { fetchTrendingItems } = await import(join(root, "functions/lib/trendingSource.js"));

function stubFetch(handler) {
  const saved = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = saved; };
}

function cannedFetch(map) {
  return async (url) => {
    const body = map(url);
    if (body === null) return new Response("nope", { status: 500 });
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(payload, { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

await test("Europe PMC citation counts carry through; missing means zero, never a guess", async () => {
  const epmc = {
    resultList: { result: [
      { title: "Cited paper.", abstractText: "A.", doi: "10.9/z", journalTitle: "J Test",
        firstPublicationDate: "2026-09-01", citedByCount: 42 },
      { title: "Uncited paper.", abstractText: "B.", doi: "10.9/w", journalTitle: "J Test",
        firstPublicationDate: "2026-09-01" },
      { title: "Zero paper.", abstractText: "C.", doi: "10.9/v", journalTitle: "J Test",
        firstPublicationDate: "2026-09-01", citedByCount: 0 },
    ] },
  };
  const restore = stubFetch(cannedFetch((url) => {
    if (url.includes("europepmc")) return epmc;
    return null; // every other source down: they are simply absent
  }));
  let items;
  try { items = await fetchTrendingItems(); } finally { restore(); }
  assert.equal(items.length, 3, "expected only the Europe PMC bucket");
  // Europe PMC titles have trailing periods stripped by the parse step.
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.equal(byTitle["Cited paper"].citedByCount, 42, "real count did not carry through");
  assert.equal(byTitle["Uncited paper"].citedByCount, 0, "missing count was not normalized to 0");
  assert.equal(byTitle["Zero paper"].citedByCount, 0, "explicit zero was not kept at 0");
  assert.ok(items.every((i) => Number.isInteger(i.citedByCount) && i.citedByCount >= 0), "count is not a non-negative integer");
});

await test("malformed citation counts degrade to zero", async () => {
  const epmc = {
    resultList: { result: [
      { title: "Weird paper.", abstractText: "A.", doi: "10.9/z", journalTitle: "J Test",
        firstPublicationDate: "2026-09-01", citedByCount: "a dozen" },
      { title: "Negative paper.", abstractText: "B.", doi: "10.9/w", journalTitle: "J Test",
        firstPublicationDate: "2026-09-01", citedByCount: -5 },
    ] },
  };
  const restore = stubFetch(cannedFetch((url) => (url.includes("europepmc") ? epmc : null)));
  let items;
  try { items = await fetchTrendingItems(); } finally { restore(); }
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.citedByCount === 0), "malformed counts were not degraded to 0");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
