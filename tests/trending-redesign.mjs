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
  // The live edition payload carries citedByCount null on most
  // records and a genuine reported zero on the rest (verified
  // 2026-10-13). A rail ranking by a signal that is not
  // there would be decoration pretending to be data, so the band
  // renders only the newest rail until real counts arrive.
  assert.ok(!appSrc.includes("Most cited in this edition"), "most cited rail is rendered without data");
});

await test("section pills carry story counts", () => {
  assert.ok(appSrc.includes("categoryCount"), "category counts missing");
});

await test("the cited sort can never run before its helper exists, and hides without data", () => {
  const helperAt = appSrc.indexOf("const citedOf");
  const sortAt = appSrc.indexOf("const visibleItems");
  assert.ok(helperAt > 0 && sortAt > helperAt, "citedOf is still declared after the sort that uses it");
  assert.ok(appSrc.includes("hasCitedData"), "cited sort is not gated on real counts");
  assert.ok(appSrc.includes('effectiveSort === "cited"'), "sort does not fall back without data");
});

await test("stories group into coverage clusters and are addressable", () => {
  assert.ok(appSrc.includes("clusterTrendingItems"), "no story clustering");
  assert.ok(appSrc.includes("#story="), "stories are not written to the URL hash");
  assert.ok(appSrc.includes("More coverage of this story"), "modal has no coverage list");
});

await test("the modal starts each story clean", () => {
  assert.ok(appSrc.includes("setVideos([])"), "modal video state is not cleared on story change");
  assert.ok(appSrc.includes("bodyRef.current.scrollTop = 0"), "modal scroll is not reset on story change");
});

await test("the bibliography starts at cited sources and folds away", () => {
  assert.ok(appSrc.includes("Show all ${sources.length} sources"), "no show all sources control");
  assert.ok(appSrc.includes("Hide bibliography"), "no bibliography fold control");
  assert.ok(appSrc.includes("Ask a follow up"), "jump rail has no follow up action");
});

await test("summaries are cleaned and missing counts stay missing", async () => {
  const { cleanTrendingText, buildTrendingItem } = await import("../functions/lib/trendingSource.js");
  assert.equal(cleanTrendingText("A \\emph{big} {Delta} result"), "A big Delta result");
  assert.ok(!cleanTrendingText("Story text. The post X appeared first on Y. More text.").includes("appeared first on"), "syndication boilerplate survives cleaning");
  assert.equal(buildTrendingItem({ title: "T", url: "https://x.example" }, "Space").citedByCount, null, "missing count became a fake zero");
});

await test("clustering actually runs and groups reports of one event", async () => {
  const { clusterTrendingItems, trendingMediaOf, dedupeTrendingItems } = await import(join(root, "src/trendingUtils.js"));
  const a = { title: "CRS-35 cargo ship docks with International Space Station", url: "https://a.example/1", summary: "short" };
  const b = { title: "CRS-35 cargo ship arrives at the International Space Station", url: "https://b.example/2", summary: "a longer summary of the same docking event" };
  const other = { title: "New exoplanet found in habitable zone of nearby star", url: "https://c.example/3", summary: "unrelated" };
  const out = clusterTrendingItems([a, b, other]);
  assert.equal(out.length, 2, "the two docking reports should be one story, the exoplanet separate");
  const story = out.find((x) => x.coverageCount === 2);
  assert.ok(story, "no story carries coverageCount 2");
  assert.equal(story.coverage.length, 2);
  const doiPair = clusterTrendingItems([
    { title: "Completely different headline one", url: "https://doi.org/10.1/abc", summary: "" },
    { title: "Nothing alike in wording at all", url: "https://doi.org/10.1/abc", summary: "" },
  ]);
  assert.equal(doiPair.length, 1, "a shared DOI must cluster even with unlike titles");
  const mediaItem = trendingMediaOf({ media: { image: null, video: null, resolvedAt: 1 }, image_url: "https://img.example/photo.jpg" });
  assert.ok(mediaItem && mediaItem.url === "https://img.example/photo.jpg", "an empty media object must not suppress the article image");
  assert.equal(mediaItem.verified, false);
  assert.equal(trendingMediaOf({ media: { image: null, video: null } }), null, "no media anywhere must stay no media");
  const deduped = dedupeTrendingItems([
    { title: "One", url: "https://doi.org/10.1/abc" },
    { title: "Two", url: "https://doi.org/10.1/abc" },
  ]);
  assert.equal(deduped.length, 1, "the same DOI twice is one record");
});

await test("past editions are archived and offered in the masthead", async () => {
  assert.ok(trendingSrc.includes("trending_editions"), "no editions archive table");
  assert.ok(trendingSrc.includes("editionIdOf"), "no edition identifier derived from generatedAt");
  assert.ok(trendingSrc.includes('searchParams.get("edition")'), "endpoint cannot serve a past edition");
  assert.ok(appSrc.includes("Choose an edition"), "no edition selector in the masthead");
  assert.ok(appSrc.includes("Back to the current edition"), "no way back from an archived edition");
  assert.ok(appSrc.includes("New edition since your last visit"), "no new since last visit marker");
  const sourceSrc = await readFile(join(root, "functions/lib/trendingSource.js"), "utf8");
  assert.ok(sourceSrc.includes("resultType=core"), "Europe PMC fetch does not ask for abstracts");
  const { editionIdOf } = await import(join(root, "functions/api/trending.js")).catch(() => ({}));
  if (editionIdOf) {
    assert.equal(editionIdOf(Date.UTC(2026, 9, 13, 5, 0, 0)), "2026-10-13");
    assert.equal(editionIdOf(0), null);
  }
});

await test("backend comments point at the real view and the real refresh story", () => {
  assert.ok(!trendingSrc.includes("src/main.jsx"), "trending.js still points at a file that does not hold the view");
  assert.ok(!refreshSrc.includes(".github/workflows/refresh-trending.yml calls"), "refresh endpoint still claims a deleted workflow calls it");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
