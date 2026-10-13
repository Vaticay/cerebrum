/**
 * Trending redesign regressions (2026-10-13).
 *
 * The audit found the feed's frontend discarding the health fields
 * the endpoint sends on every response, a category filter that could
 * land on a silently blank page, and no way to search or sort an
 * edition. These tests pin the briefing redesign in place.
 *
 * Run with: node tests/trending-redesign.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const trendingSrc = await readFile(join(root, "functions/api/trending.js"), "utf8");
const refreshSrc = await readFile(join(root, "functions/api/trendingrefresh.js"), "utf8");

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

await test("the view reads the feed health fields the endpoint sends", () => {
  assert.ok(appSrc.includes("setFeedMeta"), "feed health state missing");
  assert.ok(appSrc.includes("!!data.degraded"), "degraded flag never read");
  assert.ok(appSrc.includes("!!data.stale"), "stale flag never read");
  assert.ok(appSrc.includes("last good edition"), "degraded notice missing");
});

await test("the edition can be searched and sorted", () => {
  assert.ok(appSrc.includes("Search this edition"), "edition search missing");
  assert.ok(appSrc.includes("trendSort"), "sort state missing");
  assert.ok(appSrc.includes("Most cited") && appSrc.includes("Newest"), "sort options missing");
});

await test("a filter that matches nothing gets a real empty state", () => {
  assert.ok(appSrc.includes("Nothing in this edition matches"), "empty state missing");
  assert.ok(appSrc.includes("Show the whole edition"), "empty state has no way back");
});

await test("the briefing band ranks the edition", () => {
  assert.ok(appSrc.includes("TrendRailList"), "rail component missing");
  assert.ok(appSrc.includes("Newest in this edition"), "newest rail missing");
});

await test("the most cited rail stays hidden while the feed sends no counts", () => {
  // The live edition payload carries citedByCount 0 on every record
  // (verified 2026-10-13). A rail ranking by a signal that is not
  // there would be decoration pretending to be data, so the band
  // renders only the newest rail until real counts arrive.
  assert.ok(!appSrc.includes("Most cited in this edition"), "most cited rail is rendered without data");
});

await test("section pills carry story counts", () => {
  assert.ok(appSrc.includes("categoryCount"), "category counts missing");
});

await test("backend comments point at the real view and the real refresh story", () => {
  assert.ok(!trendingSrc.includes("src/main.jsx"), "trending.js still points at a file that does not hold the view");
  assert.ok(!refreshSrc.includes(".github/workflows/refresh-trending.yml calls"), "refresh endpoint still claims a deleted workflow calls it");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
