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
  assert.ok(appSrc.includes("Longest running") && appSrc.includes("Newest"), "sort options missing");
  // The surface is called what it is, everywhere it is named: the
  // daily edition of new science. One name in the nav, the page
  // heading, the phone title, and the tab title.
  assert.ok(appSrc.includes('["trending", "Today in Science", "chart"]'), "sidebar does not carry the new name");
  assert.ok(appSrc.includes(">Today in Science</h1>"), "page heading is not the new name");
  assert.ok(appSrc.includes('t = "Today in Science · Cerebrum"'), "tab title is not the new name");
  assert.ok(appSrc.includes('trending: "Today in Science"'), "phone title is not the new name");
  assert.ok(!appSrc.includes("Trending in Science</h1>"), "the old name still heads the page");
});

await test("a filter that matches nothing gets a real empty state", () => {
  assert.ok(appSrc.includes("Nothing in this edition matches"), "empty state missing");
  assert.ok(appSrc.includes("Show the whole edition"), "empty state has no way back");
});

await test("the edition is hero and digest only, with no rail repeating stories", () => {
  // The Newest rail repeated stories the hero and digest already
  // showed, so a story could appear twice on one page. It is gone:
  // no rail component, no rail title, and no newest list computed
  // beside the visible items.
  assert.ok(!appSrc.includes("TrendRailList"), "the rail component is still present");
  assert.ok(!appSrc.includes("Newest in this edition"), "the newest rail title is still present");
  assert.ok(appSrc.includes("TrendingHero"), "the hero is missing");
  assert.ok(appSrc.includes("The digest"), "the digest is missing");
});

await test("the most cited rail stays hidden while the feed sends no counts", () => {
  // When this pin was written the live edition carried citedByCount
  // null on most records and a genuine reported zero on the rest, so
  // a rail ranking by citations would have been decoration. Counts
  // now arrive completed from OpenAlex (see the fixture edition
  // below), but the rail itself remains the client's choice: this
  // pin guards the app never rendering a "most cited" rail the
  // redesign did not build, whatever the payload carries.
  assert.ok(!appSrc.includes("Most cited in this edition"), "most cited rail is rendered without data");
});

await test("section pills carry story counts", () => {
  assert.ok(appSrc.includes("categoryCount"), "category counts missing");
});

await test("there is no Most cited sort until the citation leg is reliable", () => {
  // A ranking of only the subset a rate limited provider answered
  // claims an order the data does not support, so the sort is gone
  // outright: no option, no gating helper, no cited branch in the
  // visible items sort. Counts still print on stories that carry
  // them, and the citation health detail still reports the leg.
  const view = appSrc.slice(appSrc.indexOf("function TrendingView("), appSrc.indexOf("function LiteratureTimeline("));
  assert.ok(!view.includes('id: "cited"'), "a cited sort option is still offered");
  assert.ok(!view.includes("hasCitedData"), "the cited sort gate is still present");
  assert.ok(!view.includes('effectiveSort === "cited"'), "the visible items still sort by citations");
  assert.ok(appSrc.includes("stories carry a citation count"), "citation coverage stopped being reported");
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

await test("clustering: the CRS-35 launch pair groups across outlets", async () => {
  // Shaped on the live edition's one genuine same event pair, which
  // the trend signal pass measured at 5 shared title tokens, jaccard
  // 0.417, containment 0.625: under the old rule it never grouped,
  // because "launches" and "launch" tokenized as different words.
  const { clusterTrendingItems } = await import(join(root, "src/trendingUtils.js"));
  const sfn = { title: "SpaceX launches CRS-35 Dragon cargo capsule to the space station", url: "https://sfn.example/crs35", summary: "s" };
  const nasa = { title: "NASA CRS-35 Dragon cargo launch reaches the International Space Station", url: "https://nasa.example/crs35", summary: "a longer report" };
  const out = clusterTrendingItems([sfn, nasa]);
  assert.equal(out.length, 1, "the two CRS-35 launch reports stayed separate stories");
  assert.equal(out[0].coverageCount, 2);
  assert.deepEqual(out[0].coverage.map((c) => c.url).sort(), [nasa.url, sfn.url].sort(), "the story must carry both outlets as coverage");
});

await test("clustering: a three outlet event is one story, singletons stay singletons", async () => {
  const { clusterTrendingItems } = await import(join(root, "src/trendingUtils.js"));
  const mk = (title, url) => ({ title, url, summary: "wire report" });
  const edition = [
    mk("SpaceX launches CRS-35 Dragon cargo capsule to the space station", "https://sfn.example/crs35"),
    mk("NASA CRS-35 Dragon cargo launch reaches the International Space Station", "https://nasa.example/crs35"),
    mk("Artemis II astronauts complete historic Moon flyby mission", "https://a.example/artemis"),
    mk("NASA Artemis II astronauts complete Moon flyby mission", "https://b.example/artemis"),
    mk("Artemis II astronauts complete Moon flyby as crowds cheer return", "https://c.example/artemis"),
    mk("SpaceX launches Falcon 9 rocket with Starlink satellites", "https://sfn.example/falcon9"),
    mk("SpaceX CRS-34 Dragon cargo capsule launches to the space station", "https://sfn.example/crs34"),
    mk("Rocket Lab launches Electron rocket with small satellites from New Zealand", "https://rl.example/electron"),
    mk("NASA telescope captures sharpest image yet of distant galaxy", "https://nasa.example/telescope"),
    mk("Ocean microbes produce oxygen in complete darkness", "https://p.example/microbes1"),
    mk("Volcanic microbes thrive in acidic hot springs", "https://p.example/microbes2"),
    mk("New exoplanet found in habitable zone of nearby star", "https://p.example/exoplanet"),
  ];
  const out = clusterTrendingItems(edition);
  assert.equal(out.length, 9, "12 reports should read as 9 stories");
  const byCoverage = (u) => out.find((s) => (s.coverage || [s]).some((c) => c.url === u));
  assert.equal(byCoverage("https://sfn.example/crs35").coverageCount, 2, "CRS-35 reports did not group");
  const artemis = byCoverage("https://a.example/artemis");
  assert.equal(artemis.coverageCount, 3, "the three Artemis II reports did not form one story");
  assert.deepEqual(artemis.coverage.map((c) => c.url).sort(),
    ["https://a.example/artemis", "https://b.example/artemis", "https://c.example/artemis"].sort());
  // Distinct stories sharing vocabulary stay apart: a different
  // launch, a different mission number in parallel wording (the old
  // rule merged CRS-34 into CRS-35 at containment 0.875), a
  // different rocket, a different NASA topic, two different papers
  // sharing a genus, and a lone paper.
  for (const u of ["https://sfn.example/falcon9", "https://sfn.example/crs34", "https://rl.example/electron",
    "https://nasa.example/telescope", "https://p.example/microbes1", "https://p.example/microbes2",
    "https://p.example/exoplanet"]) {
    const s = byCoverage(u);
    assert.ok(s && !s.coverage, `${u} should be a singleton story`);
  }
});

await test("clustering: shared common vocabulary alone cannot group two stories", async () => {
  // The fish and coral items share 6 stems at containment 0.667,
  // enough for the event path on overlap alone. Every stem they
  // share also appears in at least three other items in this
  // edition, so none of them is edition rare, and the pair must
  // stay apart: they are different findings in common words, not
  // one event reported twice.
  const { clusterTrendingItems } = await import(join(root, "src/trendingUtils.js"));
  const mk = (title, url) => ({ title, url, summary: "wire report" });
  const out = clusterTrendingItems([
    mk("Climate driven ocean warming affects fish populations along coast", "https://p.example/fish"),
    mk("Climate driven ocean warming affects coral populations in tropical seas", "https://p.example/coral"),
    mk("Climate change and ocean warming bleach coral reefs", "https://n.example/1"),
    mk("Climate panel warns warming affects ocean currents", "https://n.example/2"),
    mk("Ocean temperatures climb to record levels in Pacific", "https://n.example/3"),
    mk("Warming driven drought strains water supplies for farm populations", "https://n.example/4"),
    mk("Warming driven storms affect bird populations at lakes", "https://n.example/5"),
  ]);
  assert.equal(out.length, 7, "stories sharing only common vocabulary merged");
  assert.ok(out.every((s) => !s.coverage), "no story in this edition should carry coverage");
});

await test("clustering tokens: light stemming, identifiers exact, shared tokenizer untouched", async () => {
  const { trendClusterTokens, trendTitleTokens } = await import(join(root, "src/trendingUtils.js"));
  const stems = (t) => trendClusterTokens(t);
  assert.ok(stems("launches").has("launch") && stems("launch").has("launch"), "launches and launch must meet");
  assert.ok(stems("docking").has("dock") && stems("docked").has("dock") && stems("docks").has("dock"), "dock inflections must meet");
  assert.ok(stems("satellites").has("satellite") && stems("satellite").has("satellite"), "satellites and satellite must meet");
  assert.ok(stems("crs-35").has("crs-35"), "identifiers are never stemmed");
  assert.ok(stems("glass").has("glass") && stems("status").has("status"), "ss and us endings are not stripped");
  // The modal's up next scorer uses trendTitleTokens; it must stay
  // exactly as it was, so the stemming cannot leak into it.
  assert.ok(trendTitleTokens("launches").has("launches"), "the shared tokenizer changed under the clustering fix");
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

// ══════════════════════════════════════════════════════════════════
// Behavioral fixture edition.
//
// The pins above read source text. This section instead builds a
// whole edition through fetchTrendingFeed with stubbed sources and
// asserts what the edition itself guarantees: the date floor holds,
// summaries end honestly, citation counts are completed from
// OpenAlex without ever overwriting a source's own report or
// inventing one, and source health describes the built edition.
// Dates are computed from the run's own clock so the fixture cannot
// go stale the way a hard coded date would.

function stubFetchGlobal(handler) {
  const saved = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = saved; };
}
function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
}
const DAY_MS = 86400000;
const isoDaysAgo = (n) => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

const openAlexRequests = [];
function fixtureFetch(url) {
  const u = String(url);
  if (u.includes("europepmc")) {
    return jsonResponse({ resultList: { result: [
      { title: "Fresh journal paper.", abstractText: "This study reports a complete and self contained first sentence about the work. A second clause then trails off mid",
        doi: "10.9/fresh", journalTitle: "J Fixture", firstPublicationDate: isoDaysAgo(2) },
      { title: "Counted journal paper.", abstractText: "An abstract that ends properly.",
        doi: "10.9/counted", journalTitle: "J Fixture", firstPublicationDate: isoDaysAgo(3), citedByCount: 5 },
      { title: "Stale journal paper.", abstractText: "An old abstract that ends properly.",
        doi: "10.9/stale", journalTitle: "J Fixture", firstPublicationDate: isoDaysAgo(120) },
    ] } });
  }
  if (u.includes("biorxiv")) {
    return jsonResponse({ collection: [
      { title: "Preprint with a citation history", abstract: "A complete abstract.",
        doi: "10.1101/2025.01.01.000001", category: "neuroscience", date: isoDaysAgo(1) },
    ] });
  }
  if (u.includes("export.arxiv.org")) {
    const xml = `<feed><entry><title>An arXiv paper</title><summary>Arxiv abstract.</summary>` +
      `<id>http://arxiv.org/abs/2601.00001v1</id><published>${new Date().toISOString()}</published>` +
      `<category term="physics.chem-ph"/></entry></feed>`;
    return new Response(xml, { status: 200, headers: { "Content-Type": "application/atom+xml" } });
  }
  if (u.includes("spaceflightnewsapi")) {
    return jsonResponse({ results: [
      { title: "Launch campaign update", summary: "A long rolling update about the launch campaign and the teams preparing the vehicle for its next attempt on the pad",
        url: "https://news.example/launch", image_url: "", news_site: "Fixture News", published_at: new Date().toISOString() },
    ] });
  }
  if (u.includes("api.openalex.org")) {
    openAlexRequests.push(u);
    const counts = { "10.1101/2025.01.01.000001": 7, "10.48550/arxiv.2601.00001": 3, "10.9/counted": 99 };
    const filter = decodeURIComponent(u.split("filter=doi:")[1].split("&")[0]);
    const results = filter.split("|")
      .filter((d) => Object.prototype.hasOwnProperty.call(counts, d.toLowerCase()))
      .map((d) => ({ doi: "https://doi.org/" + d, cited_by_count: counts[d.toLowerCase()] }));
    return jsonResponse({ results });
  }
  throw new Error("unexpected url: " + u);
}

await test("fixture edition: floor, finished summaries, completed counts, truthful health", async () => {
  const restore = stubFetchGlobal(fixtureFetch);
  let feed;
  try { feed = await (await import(join(root, "functions/lib/trendingSource.js"))).fetchTrendingFeed(); }
  finally { restore(); }
  const { items, sourceHealth } = feed;

  // The 120 day old paper never enters the edition; the rest do.
  assert.equal(items.length, 5, "edition should hold five items after the floor");
  assert.ok(!items.some((i) => i.title.includes("Stale")), "stale item survived the date floor");

  // Source health describes the edition that was built, not the raw
  // upstream return (Europe PMC sent three, the edition holds two).
  // The citation completion entry is not a section of the edition, so
  // the per section contract is checked on the section entries only;
  // the completion entry carries its own contract, asserted below.
  for (const h of sourceHealth.filter((x) => x.source !== "Citation counts")) {
    assert.equal(h.count, items.filter((i) => i.category === h.source).length, `health count wrong for ${h.source}`);
    assert.equal(h.ok, h.count > 0, `health ok flag wrong for ${h.source}`);
  }
  assert.equal(sourceHealth.find((h) => h.source === "Biology & Medicine").count, 2);

  // The completion leg reports itself: three items needed a count
  // (the fresh paper, the preprint, the arXiv paper), OpenAlex
  // resolved two of them, both positive, and no fallback ran.
  const cites = sourceHealth.find((h) => h.source === "Citation counts");
  assert.ok(cites, "no citation completion entry in source health");
  assert.equal(cites.ok, true, "completion leg should read healthy when OpenAlex answers");
  assert.equal(cites.attempted, 3, "completion attempted count wrong");
  assert.equal(cites.resolved, 2, "completion resolved count wrong");
  assert.equal(cites.positive, 2, "completion positive count wrong");
  assert.equal(cites.count, 2, "completion entry count should be its resolved count");
  assert.equal(cites.error, null, "healthy completion leg carries an error");
  assert.deepEqual(cites.legs.map((l) => l.provider), ["OpenAlex"], "Crossref ran after an OpenAlex success");
  assert.equal(cites.legs[0].error, null);

  // Every summary ends at a sentence boundary or admits its cut.
  const sentenceEnd = /[.!?]["'”’)\]]*$/;
  for (const i of items) {
    const s = (i.summary || "").trim();
    if (!s) continue;
    assert.ok(sentenceEnd.test(s) || s.endsWith("…"), `summary ends mid sentence: …${s.slice(-40)}`);
  }
  const fresh = items.find((i) => i.title === "Fresh journal paper");
  assert.equal(fresh.summary, "This study reports a complete and self contained first sentence about the work.",
    "mid sentence summary was not trimmed to its last sentence boundary");
  const story = items.find((i) => i.category === "Space");
  assert.ok(story.summary.endsWith("…"), "summary with no usable boundary carries no truncation marker");

  // Counts: OpenAlex completes what sources did not report, a
  // source's own report is never overwritten, and a work no source
  // knows stays null rather than becoming a guessed zero.
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.equal(byTitle["Preprint with a citation history"].citedByCount, 7, "OpenAlex count not applied to the preprint");
  assert.equal(byTitle["An arXiv paper"].citedByCount, 3, "OpenAlex count not applied to the arXiv paper");
  assert.equal(byTitle["Counted journal paper"].citedByCount, 5, "a source's own count was overwritten");
  assert.equal(byTitle["Fresh journal paper"].citedByCount, null, "unknown work gained an invented count");
  assert.equal(byTitle["Launch campaign update"].citedByCount, null, "press item gained an invented count");

  // The lookup itself is one batch, uses the arXiv DOI form without
  // the version suffix, and never asks about works already counted.
  assert.equal(openAlexRequests.length, 1, "OpenAlex was not queried exactly once");
  assert.ok(openAlexRequests[0].includes("10.48550/arXiv.2601.00001"), "arXiv lookup DOI form wrong");
  assert.ok(!openAlexRequests[0].includes("2601.00001v1"), "versioned arXiv id sent as a DOI");
  assert.ok(!openAlexRequests[0].includes("10.9/counted"), "already counted work was looked up again");
});

// ── Citation completion: fallback and honest health ───────────────
// The production edition of 2026-10-13 shipped with zero of its
// twenty resolvable DOIs populated and no surface able to say why:
// the OpenAlex leg swallowed its error whole. These scenarios stub
// the providers around the same five item edition and pin the new
// contract: the leg reports itself in source health, a failed
// OpenAlex gives the same DOI set to Crossref, counts are never
// invented, and a source's own report is never even asked about.

function citationScenario({ openAlex, crossref }) {
  const requests = { openAlex: [], crossref: [] };
  const handler = (url) => {
    const u = String(url);
    if (u.includes("europepmc")) {
      return jsonResponse({ resultList: { result: [
        { title: "Counted journal paper.", abstractText: "An abstract that ends properly.",
          doi: "10.9/counted", journalTitle: "J Fixture", firstPublicationDate: isoDaysAgo(3), citedByCount: 5 },
        { title: "Fresh journal paper.", abstractText: "An abstract that ends properly.",
          doi: "10.9/fresh", journalTitle: "J Fixture", firstPublicationDate: isoDaysAgo(2) },
      ] } });
    }
    if (u.includes("biorxiv")) {
      return jsonResponse({ collection: [
        { title: "Preprint with a citation history", abstract: "A complete abstract.",
          doi: "10.1101/2025.01.01.000001", category: "neuroscience", date: isoDaysAgo(1) },
      ] });
    }
    if (u.includes("export.arxiv.org")) {
      const xml = `<feed><entry><title>An arXiv paper</title><summary>Arxiv abstract.</summary>` +
        `<id>http://arxiv.org/abs/2601.00001v1</id><published>${new Date().toISOString()}</published>` +
        `<category term="physics.chem-ph"/></entry></feed>`;
      return new Response(xml, { status: 200, headers: { "Content-Type": "application/atom+xml" } });
    }
    if (u.includes("spaceflightnewsapi")) {
      return jsonResponse({ results: [
        { title: "Launch campaign update", summary: "A complete summary.",
          url: "https://news.example/launch", image_url: "", news_site: "Fixture News", published_at: new Date().toISOString() },
      ] });
    }
    if (u.includes("api.openalex.org")) { requests.openAlex.push(u); return openAlex(u); }
    if (u.includes("api.crossref.org")) { requests.crossref.push(u); return crossref(u); }
    throw new Error("unexpected url: " + u);
  };
  return { handler, requests };
}

function crossrefStub(counts) {
  return (u) => {
    const doi = decodeURIComponent(u.split("/works/")[1].split("?")[0]).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(counts, doi)) {
      return new Response("not found", { status: 404 });
    }
    return jsonResponse({ message: { DOI: doi, "is-referenced-by-count": counts[doi] } });
  };
}

async function buildScenario(opts) {
  const { handler, requests } = citationScenario(opts);
  const restore = stubFetchGlobal(handler);
  let feed;
  try { feed = await (await import(join(root, "functions/lib/trendingSource.js"))).fetchTrendingFeed(); }
  finally { restore(); }
  return { feed, requests };
}

await test("citation completion: OpenAlex failure falls back to Crossref and health names both legs", async () => {
  const { feed, requests } = await buildScenario({
    openAlex: () => new Response("upstream down", { status: 503 }),
    // Crossref would offer 42 for the counted paper if it were ever
    // asked; the completion leg must never ask about a work whose own
    // source already reported a count.
    crossref: crossrefStub({
      "10.1101/2025.01.01.000001": 11,
      "10.48550/arxiv.2601.00001": 0,
      "10.9/fresh": 4,
      "10.9/counted": 42,
    }),
  });
  const { items, sourceHealth } = feed;
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.equal(byTitle["Preprint with a citation history"].citedByCount, 11, "Crossref count not applied to the preprint");
  assert.equal(byTitle["An arXiv paper"].citedByCount, 0, "a real Crossref zero must land as zero, not stay null");
  assert.equal(byTitle["Fresh journal paper"].citedByCount, 4, "Crossref count not applied to the fresh paper");
  assert.equal(byTitle["Counted journal paper"].citedByCount, 5, "a source's own count was overwritten by the fallback");
  assert.ok(requests.crossref.length > 0, "Crossref was never called after the OpenAlex failure");
  assert.ok(requests.crossref.every((u) => !decodeURIComponent(u).includes("10.9/counted")),
    "Crossref was asked about a work already counted by its own source");

  const cites = sourceHealth.find((h) => h.source === "Citation counts");
  assert.ok(cites, "no citation completion entry in source health");
  assert.equal(cites.ok, true, "the leg should read healthy when the fallback answers");
  assert.deepEqual(cites.legs.map((l) => l.provider), ["OpenAlex", "Crossref"], "health does not name both legs");
  assert.equal(cites.legs[0].error, "HTTP 503", "the OpenAlex failure class is not reported");
  assert.equal(cites.legs[1].error, null, "the answering Crossref leg carries an error");
  assert.ok(cites.error && cites.error.includes("OpenAlex") && cites.error.includes("HTTP 503"),
    "the entry error does not name the failed leg and its class");
  assert.equal(cites.attempted, 3);
  assert.equal(cites.resolved, 3, "all three attempted items should resolve through the fallback");
  assert.equal(cites.positive, 2, "the Crossref zero is resolved but not positive");
});

await test("citation completion: both providers failing leaves counts null and health reports the failure", async () => {
  const { feed } = await buildScenario({
    openAlex: () => { throw new TypeError("fetch failed"); },
    crossref: () => new Response("server error", { status: 500 }),
  });
  const { items, sourceHealth } = feed;
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.equal(byTitle["Preprint with a citation history"].citedByCount, null, "a count appeared from two dead providers");
  assert.equal(byTitle["An arXiv paper"].citedByCount, null, "a count appeared from two dead providers");
  assert.equal(byTitle["Fresh journal paper"].citedByCount, null, "a count appeared from two dead providers");
  assert.equal(byTitle["Counted journal paper"].citedByCount, 5, "a source's own count was disturbed");

  const cites = sourceHealth.find((h) => h.source === "Citation counts");
  assert.ok(cites, "no citation completion entry in source health");
  assert.equal(cites.ok, false, "a leg both of whose providers failed must read as failed");
  assert.equal(cites.resolved, 0);
  assert.equal(cites.count, 0);
  assert.equal(cites.legs[0].error, "network error", "the OpenAlex failure class is wrong");
  assert.equal(cites.legs[1].error, "HTTP 500", "the Crossref failure class is wrong");
  assert.ok(cites.error.includes("network error") && cites.error.includes("HTTP 500"),
    "the entry error does not carry both failure classes");
});

await test("citation completion: a malformed OpenAlex reply is named, and the fallback still lands", async () => {
  const { feed } = await buildScenario({
    openAlex: () => jsonResponse({ meta: { count: 0 } }),
    crossref: crossrefStub({ "10.1101/2025.01.01.000001": 2 }),
  });
  const { items, sourceHealth } = feed;
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.equal(byTitle["Preprint with a citation history"].citedByCount, 2, "fallback did not land after the malformed reply");
  // Crossref answering 404 for works it does not know is the leg
  // doing its job: those items stay null and the leg is not failed.
  assert.equal(byTitle["An arXiv paper"].citedByCount, null, "an unknown work gained an invented count");
  assert.equal(byTitle["Fresh journal paper"].citedByCount, null, "an unknown work gained an invented count");

  const cites = sourceHealth.find((h) => h.source === "Citation counts");
  assert.equal(cites.legs[0].error, "malformed reply", "the malformed reply was not named as its class");
  assert.equal(cites.legs[1].error, null, "Crossref 404s for unknown works were treated as a leg failure");
  // Corrected contract (fifth panel): this scenario is a PARTIAL
  // completion with an error present — one of three resolved, the
  // primary leg errored — so ok reads false and the masthead can
  // disclose it. The old pin asserted true here; it pinned the
  // defective "healthy when any leg answered" rule that hid the live
  // partial failure behind ok true. The counts themselves still land.
  assert.equal(cites.ok, false, "a partial completion with an errored leg must read not ok");
  assert.equal(cites.resolved, 1);
  assert.equal(cites.attempted, 3);
});

await test("citation completion: a rate limited primary with a partial fallback reads not ok, counts carried", async () => {
  // The live shape from the 2026-10-14 edition: OpenAlex answered
  // HTTP 429 and only part of the edition's counts ever resolved.
  const { feed } = await buildScenario({
    openAlex: () => new Response("rate limited", { status: 429 }),
    crossref: crossrefStub({ "10.1101/2025.01.01.000001": 11 }),
  });
  const { items, sourceHealth } = feed;
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.equal(byTitle["Preprint with a citation history"].citedByCount, 11, "the resolved count did not land");
  assert.equal(byTitle["An arXiv paper"].citedByCount, null, "an unresolved work gained an invented count");
  assert.equal(byTitle["Fresh journal paper"].citedByCount, null, "an unresolved work gained an invented count");

  const cites = sourceHealth.find((h) => h.source === "Citation counts");
  assert.ok(cites, "no citation completion entry in source health");
  assert.equal(cites.ok, false, "partial resolution with a rate limited leg shipped as ok");
  assert.equal(cites.attempted, 3, "attempted count not carried");
  assert.equal(cites.resolved, 1, "resolved count not carried");
  assert.ok(cites.error && cites.error.includes("OpenAlex") && cites.error.includes("HTTP 429"),
    "the entry error does not name the rate limited leg");
});

await test("summary finishing: boundaries, decimals, and the marker", async () => {
  const { finishTrendingSummary } = await import(join(root, "functions/lib/trendingSource.js"));
  assert.equal(finishTrendingSummary("Already complete."), "Already complete.");
  assert.equal(finishTrendingSummary(""), "");
  // A decimal point inside a number is not a sentence boundary; the
  // cut lands on the real one before it.
  assert.equal(
    finishTrendingSummary("The agency committed funds in 2027. NOK 223.5 million"),
    "The agency committed funds in 2027."
  );
  // No usable boundary in the back half: the ellipsis admits the cut.
  const marked = finishTrendingSummary("Details are on the agency site. NASA Engineering and Safety Center (NESC) Activity");
  assert.ok(marked.endsWith("…"), "boundary too far back should fall back to the marker");
});

await test("edition window: ninety days, stated once, missing dates kept", async () => {
  const { isWithinEditionWindow, EDITION_WINDOW_DAYS } = await import(join(root, "functions/lib/trendingSource.js"));
  assert.equal(EDITION_WINDOW_DAYS, 90);
  const now = Date.UTC(2026, 9, 13);
  assert.equal(isWithinEditionWindow({ publishedAt: "2026-07-16" }, now), true, "89 day old item dropped");
  assert.equal(isWithinEditionWindow({ publishedAt: "2026-07-14" }, now), false, "91 day old item kept");
  assert.equal(isWithinEditionWindow({ publishedAt: "2026-10-20" }, now), true, "future dated item dropped");
  assert.equal(isWithinEditionWindow({ publishedAt: null }, now), true, "undated item dropped on suspicion");
  assert.equal(isWithinEditionWindow({ publishedAt: "not a date" }, now), true, "unparseable date dropped on suspicion");
});

await test("trend history: days present across editions, first seen, ordering", async () => {
  const { attachTrendHistory, compareByTrend } = await import(join(root, "functions/lib/trendingSource.js"));
  const x = { title: "Work X as first titled", doi: "10.1/x", url: "https://doi.org/10.1/x", citedByCount: 0, publishedAt: "2026-10-01" };
  const y = { title: "Work Y", url: "https://news.example/y", citedByCount: null, publishedAt: "2026-10-05" };
  const priors = [
    { id: "2026-10-11", items: [{ title: "Work X under a different title", doi: "10.1/X" }] },
    { id: "2026-10-12", items: [{ doi: "10.1/x" }, { url: "https://news.example/y/" }] },
    // Today's earlier build is already archived; it must not count
    // the work twice for the same day.
    { id: "2026-10-13", items: [{ doi: "10.1/x" }] },
  ];
  const [ax, ay, az] = attachTrendHistory([x, y, { title: "Brand new work", url: "https://news.example/z" }], priors, "2026-10-13");
  assert.equal(ax.trend.daysPresent, 3, "work seen on two prior days plus today should read 3");
  assert.equal(ax.trend.firstSeenEdition, "2026-10-11");
  assert.equal(ay.trend.daysPresent, 2, "URL matched work should read 2");
  assert.equal(ay.trend.firstSeenEdition, "2026-10-12");
  assert.equal(az.trend.daysPresent, 1, "a new work is on its first day");
  assert.equal(az.trend.firstSeenEdition, "2026-10-13");

  const mk = (doi, daysPresent, citedByCount, publishedAt) => ({ doi, trend: { daysPresent }, citedByCount, publishedAt });
  const shuffled = [
    mk("z", 1, null, "2026-10-13"),
    mk("y", 2, 0, "2026-10-12"),
    mk("x", 3, 0, "2026-10-10"),
    mk("w", 3, 12, "2026-10-09"),
    mk("v", 3, 12, "2026-10-11"),
  ];
  const ordered = [...shuffled].sort(compareByTrend).map((i) => i.doi);
  assert.deepEqual(ordered, ["v", "w", "x", "y", "z"], "trend ordering is not days, then citations, then recency");
});

// ── The persistence signal reaches the reader ────────────────────
// The server has stamped trend { daysPresent, firstSeenEdition } on
// every item since the signal pass, and compareByTrend ordered by
// it server side, but the client rendered daysPresent nowhere and
// offered no trend ordering: the signal was computed and dropped.
// These pins cover the client half: the comparator's order, its
// parity with the server's, and the marker's render rule.

await test("client trend ordering: days, then citation presence and size, then recency", async () => {
  const { compareByTrend } = await import(join(root, "src/trendingUtils.js"));
  const mk = (doi, daysPresent, citedByCount, publishedAt) => ({ doi, trend: { daysPresent }, citedByCount, publishedAt });
  const shuffled = [
    mk("z", 1, 40, "2026-10-13"),       // most cited, newest, but only one day present
    mk("y", 2, 0, "2026-10-12"),        // a reported zero still outranks a missing count
    mk("x", 3, 0, "2026-10-10"),
    mk("w", 3, 12, "2026-10-09"),
    mk("v", 3, 12, "2026-10-11"),       // same days and count as w, newer, so first
    mk("u", 2, null, "2026-10-13"),     // missing count ranks below any reported one
  ];
  const ordered = [...shuffled].sort(compareByTrend).map((i) => i.doi);
  assert.deepEqual(ordered, ["v", "w", "x", "y", "u", "z"], "client trend ordering is not days, then citations, then recency");
  // A story with no trend field at all reads as zero days, never as
  // a phantom veteran, and an all first day edition still orders by
  // the tiebreakers alone.
  const young = [mk("b", 1, null, "2026-10-12"), mk("a", 1, 3, "2026-10-11"), { doi: "c", citedByCount: 9, publishedAt: "2026-10-13" }];
  assert.deepEqual([...young].sort(compareByTrend).map((i) => i.doi), ["a", "b", "c"],
    "missing trend data or a one day archive must fall through to citations, then recency");
});

await test("client trend ordering matches the server comparator on the same stories", async () => {
  const client = await import(join(root, "src/trendingUtils.js"));
  const server = await import(join(root, "functions/lib/trendingSource.js"));
  const mk = (doi, daysPresent, citedByCount, publishedAt) => ({ doi, trend: { daysPresent, firstSeenEdition: "2026-10-10" }, citedByCount, publishedAt });
  const stories = [
    mk("p", 4, null, "2026-10-08"),
    mk("q", 4, 2, "2026-10-07"),
    mk("r", 1, 90, "2026-10-13"),
    mk("s", 2, 2, "2026-10-12"),
    mk("t", 2, 2, "2026-10-11"),
  ];
  const byClient = [...stories].sort(client.compareByTrend).map((i) => i.doi);
  const byServer = [...stories].sort(server.compareByTrend).map((i) => i.doi);
  assert.deepEqual(byClient, ["q", "p", "s", "t", "r"], "client trend fixture order wrong");
  assert.deepEqual(byClient, byServer, "client and server trend orderings disagree");
});

await test("persistence marker: named only above the first day", async () => {
  const { trendPersistenceLabel } = await import(join(root, "src/trendingUtils.js"));
  assert.equal(trendPersistenceLabel({ trend: { daysPresent: 1 } }), null, "a first day story earned a marker");
  assert.equal(trendPersistenceLabel({ trend: { daysPresent: 2 } }), "Day 2 in the edition");
  assert.equal(trendPersistenceLabel({ trend: { daysPresent: 5, firstSeenEdition: "2026-10-09" } }), "Day 5 in the edition");
  assert.equal(trendPersistenceLabel({}), null, "a story with no trend field earned a marker");
  assert.equal(trendPersistenceLabel({ trend: { daysPresent: "3" } }), null, "a string day count earned a marker");
  assert.equal(trendPersistenceLabel({ trend: { daysPresent: NaN } }), null, "a NaN day count earned a marker");
  assert.equal(trendPersistenceLabel(null), null, "a missing story earned a marker");
});

await test("the view offers the trend ordering and renders the persistence marker", () => {
  assert.ok(appSrc.includes("compareByTrend(a, b)"), "the client sort never calls the trend comparator");
  assert.ok(appSrc.includes('{ id: "trend", label: "Longest running" }'), "no persistence sort option");
  // Persistence is the default order under the new name, not an
  // option behind the edition order, and it is not gated on
  // citation data it does not need.
  assert.ok(appSrc.includes('useState("trend")'), "the default sort is not persistence");
  const optionsAt = appSrc.indexOf('id: "trend", label: "Longest running"');
  const optionsSlice = appSrc.slice(optionsAt, optionsAt + 240);
  assert.ok(optionsSlice.indexOf('id: "edition"') > -1, "the persistence option does not lead the sort group");
  // The marker reaches every story surface through one helper: the
  // provenance line the hero and digest rows render, and the story
  // modal's own meta line and up next rows.
  assert.ok(appSrc.includes("const persistence = trendPersistenceLabel(item);"), "provenance never carries the marker");
  assert.ok(appSrc.includes("const persistenceLabel = trendPersistenceLabel(item);"), "the modal never computes the marker");
  assert.ok(appSrc.includes("trendPersistenceLabel(nx)"), "the modal's up next rows never carry the marker");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
