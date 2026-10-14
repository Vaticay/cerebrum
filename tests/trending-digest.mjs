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
 *     a record without a citation count carries citedByCount null,
 *     meaning no data, never a structural zero.
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
  // Pass 4 (2026-09-17): digest rows render through trendProvenance, which
  // guards the label with `if (item.citedByCount > 0)` before pushing it.
  assert.match(
    appSrc,
    /if \(item\.citedByCount > 0\) parts\.push\(`Cited by \$\{item\.citedByCount\}`\)/,
    "digest 'Cited by' label is not guarded by a positive count"
  );
});

// ══════════════════════════════════════════════════════════════════════════
group("trending digest — citation signal is real and never invented");

const { fetchTrendingItems } = await import(join(root, "functions/lib/trendingSource.js"));

// Fixture dates are computed from the run's own clock, never hard
// coded: the edition window (90 days, judged on the real Date.now in
// fetchTrendingFeed) silently ate fixed 2026-09-01 fixtures once the
// calendar passed them — the suite would have begun failing around
// 2026-11-30 with nothing in the code changed. Relative dates keep
// every fixture inside the window forever while the window assertions
// themselves (in trending-redesign.mjs, against an explicit `now`)
// stay exactly as strict.
const DAY_MS = 86400000;
const isoDaysAgo = (n) => new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

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

await test("Europe PMC citation counts carry through; missing means no data, never a guess", async () => {
  const epmc = {
    resultList: { result: [
      { title: "Cited paper.", abstractText: "A.", doi: "10.9/z", journalTitle: "J Test",
        firstPublicationDate: isoDaysAgo(2), citedByCount: 42 },
      { title: "Uncited paper.", abstractText: "B.", doi: "10.9/w", journalTitle: "J Test",
        firstPublicationDate: isoDaysAgo(2) },
      { title: "Zero paper.", abstractText: "C.", doi: "10.9/v", journalTitle: "J Test",
        firstPublicationDate: isoDaysAgo(2), citedByCount: 0 },
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
  assert.equal(byTitle["Uncited paper"].citedByCount, null, "missing count was not kept as no data");
  assert.equal(byTitle["Zero paper"].citedByCount, 0, "explicit zero was not kept at 0");
  assert.ok(items.every((i) => i.citedByCount === null || (Number.isInteger(i.citedByCount) && i.citedByCount >= 0)), "count is not null or a non-negative integer");
});

await test("malformed citation counts degrade to no data, never a fake zero", async () => {
  const epmc = {
    resultList: { result: [
      { title: "Weird paper.", abstractText: "A.", doi: "10.9/z", journalTitle: "J Test",
        firstPublicationDate: isoDaysAgo(2), citedByCount: "a dozen" },
      { title: "Negative paper.", abstractText: "B.", doi: "10.9/w", journalTitle: "J Test",
        firstPublicationDate: isoDaysAgo(2), citedByCount: -5 },
    ] },
  };
  const restore = stubFetch(cannedFetch((url) => (url.includes("europepmc") ? epmc : null)));
  let items;
  try { items = await fetchTrendingItems(); } finally { restore(); }
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.citedByCount === null || i.citedByCount === 0), "malformed counts were not degraded honestly");
  assert.equal(items.find((i) => i.title === "Weird paper").citedByCount, null, "non numeric count should be no data");
  assert.equal(items.find((i) => i.title === "Negative paper").citedByCount, 0, "negative count should clamp to zero");
});

await test("spaceflight nav-chrome summaries degrade to honest attribution", async () => {
  // Real incident (2026-09-16): an APOD item's card description was the
  // upstream scraper's nav text ("Today's APOD Archive Submissions Index
  // Search Calendar"). Site furniture must never print as a summary.
  const space = {
    results: [
      { title: "APOD: Something in the sky.", summary: "APOD Science APOD APOD: 2026 September 16 – Today's APOD Archive Submissions Index Search Calendar",
        url: "https://x.example/a", image_url: "", news_site: "NASA", published_at: isoDaysAgo(1) },
      { title: "A real story.", summary: "Engineers tested the new thruster and it worked.",
        url: "https://x.example/b", image_url: "", news_site: "SpaceNews", published_at: isoDaysAgo(1) },
    ],
  };
  const restore = stubFetch(cannedFetch((url) => (url.includes("spaceflightnewsapi") ? space : null)));
  let items;
  try { items = await fetchTrendingItems(); } finally { restore(); }
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
  assert.ok(!/archive|submissions|calendar/i.test(byTitle["APOD: Something in the sky."].summary),
    "nav chrome leaked into the summary: " + byTitle["APOD: Something in the sky."].summary);
  assert.match(byTitle["APOD: Something in the sky."].summary, /NASA story/,
    "chrome summary did not degrade to outlet attribution");
  assert.equal(byTitle["A real story."].summary, "Engineers tested the new thruster and it worked.",
    "legitimate summary was altered");
});

await test("entity-mangled upstream titles render as plain text, never raw entities", async () => {
  // Real incident (2026-09-16): an Europe PMC title shipped with embedded,
  // already-escaped markup — "Disseminated &lt;i&gt;Klebsiella
  // pneumoniae&lt;/i&gt; Infection ..." — and rendered on the card as
  // literal "&lt;i&gt;" text after JSX escaped the ampersands a second
  // time. Titles and summaries must be decoded once and stripped of tags.
  const { cleanTrendingText } = await import(join(root, "functions/lib/trendingSource.js"));
  assert.equal(
    cleanTrendingText("Disseminated &lt;i&gt;Klebsiella pneumoniae&lt;/i&gt; Infection Mimicking Lesions: A Case Report"),
    "Disseminated Klebsiella pneumoniae Infection Mimicking Lesions: A Case Report",
    "escaped markup was not decoded and stripped"
  );
  assert.equal(cleanTrendingText("Fish &amp; chips: a &quot;study&quot;"), 'Fish & chips: a "study"',
    "named entities were not decoded");
  assert.equal(cleanTrendingText("T&#8211;cell &#x3B1; response"), "T–cell α response",
    "numeric entities were not decoded");
  assert.equal(cleanTrendingText("&bogus; stays"), "&bogus; stays",
    "unknown entities must pass through untouched");
  assert.equal(cleanTrendingText("  spaced   <b>bold</b>  text  "), "spaced bold text",
    "tags were not removed as plain text / whitespace not collapsed");
});

await test("fetchTrendingItems strips entities from upstream Europe PMC titles", async () => {
  const epmc = {
    resultList: { result: [
      { title: "Disseminated &lt;i&gt;Klebsiella pneumoniae&lt;/i&gt; Infection Mimicking Lesions.", abstractText: "A &amp; B.",
        doi: "10.9/z", journalTitle: "J Test", firstPublicationDate: isoDaysAgo(2) },
    ] },
  };
  const restore = stubFetch(cannedFetch((url) => (url.includes("europepmc") ? epmc : null)));
  let items;
  try { items = await fetchTrendingItems(); } finally { restore(); }
  assert.equal(items.length, 1);
  assert.ok(!/[&<>]/.test(items[0].title) || !items[0].title.includes("&lt;"),
    "raw entities survived into the served title: " + items[0].title);
  // The served title carries the species name's italics as a markdown
  // pair: the pipeline used to strip the <i> span entirely, so the
  // name rendered in roman. The client renders titles through
  // renderInlineMdLite, which turns the pair back into italics.
  assert.equal(items[0].title, "Disseminated *Klebsiella pneumoniae* Infection Mimicking Lesions",
    "title was not cleaned end to end, italics marker included");
  assert.equal(items[0].summary, "A & B.", "summary entities were not decoded");
});

// ══════════════════════════════════════════════════════════════════════════
group("trending digest — species italics survive the pipeline");

await test("italic spans become markdown pairs for titles, plain text everywhere else", async () => {
  const { cleanTrendingText, buildTrendingItem } = await import(join(root, "functions/lib/trendingSource.js"));
  const raw = "Disseminated &lt;i&gt;Klebsiella pneumoniae&lt;/i&gt; Infection";
  assert.equal(cleanTrendingText(raw), "Disseminated Klebsiella pneumoniae Infection",
    "the default clean changed: plain surfaces must stay marker free");
  assert.equal(cleanTrendingText(raw, { italics: "markdown" }), "Disseminated *Klebsiella pneumoniae* Infection",
    "escaped italic markup did not become a markdown pair");
  assert.equal(cleanTrendingText("A <i>Phytophthora infestans</i> outbreak", { italics: "markdown" }),
    "A *Phytophthora infestans* outbreak", "literal italic tags did not become a markdown pair");
  assert.equal(cleanTrendingText("A &lt;em&gt;Phytophthora&lt;/em&gt; outbreak", { italics: "markdown" }),
    "A *Phytophthora* outbreak", "an em span did not become a markdown pair");
  // Broken markup loses its markers rather than printing them: an
  // unclosed span and a stray close both degrade to the plain words.
  assert.equal(cleanTrendingText("A &lt;i&gt;Phytophthora outbreak", { italics: "markdown" }),
    "A Phytophthora outbreak", "an unclosed italic span kept its marker");
  assert.equal(cleanTrendingText("A Phytophthora&lt;/i&gt; outbreak", { italics: "markdown" }),
    "A Phytophthora outbreak", "a stray italic close kept its marker");
  const item = buildTrendingItem(
    { title: raw, summary: "About &lt;i&gt;Klebsiella&lt;/i&gt; in the gut.", url: "https://doi.org/10.9/z" },
    "Biology & Medicine"
  );
  assert.equal(item.title, "Disseminated *Klebsiella pneumoniae* Infection", "the built title lost its italics marker");
  assert.equal(item.summary, "About Klebsiella in the gut.", "the built summary gained a marker it would print literally");
});

await test("markdown italics already in an upstream title pass through untouched", async () => {
  const epmc = { resultList: { result: [
    { title: "*Phytophthora infestans* spreads in wet soil.", abstractText: "A.",
      doi: "10.9/p", journalTitle: "J Test", firstPublicationDate: isoDaysAgo(2) },
  ] } };
  const restore = stubFetch(cannedFetch((url) => (url.includes("europepmc") ? epmc : null)));
  let items;
  try { items = await fetchTrendingItems(); } finally { restore(); }
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "*Phytophthora infestans* spreads in wet soil",
    "a title's own markdown italics were altered by the pipeline");
});

// ══════════════════════════════════════════════════════════════════════════
group("trending digest — citation health and ranking basis are on screen");

await test("the Most cited ordering discloses the size of its ranked subset", () => {
  assert.match(appSrc, /effectiveSort === "cited" && visibleItems\.length > 0/,
    "the cited ordering renders without its basis disclosure");
  assert.match(appSrc, /have a count above zero/,
    "the disclosure does not state how many stories carry a positive count");
  assert.match(appSrc, /Stories without a reported count are not ranked/,
    "the disclosure does not say the uncounted stories are unranked");
  assert.match(appSrc, /const citedRankedCount = filteredItems\.filter\(\(x\) => citedOf\(x\) > 0\)\.length/,
    "the disclosed count is not computed from the view being ranked");
});

await test("citation health is rendered, not just shipped in the payload", () => {
  assert.match(appSrc, /stories carry a citation count/, "no citation coverage line in the masthead");
  assert.match(appSrc, /const citedKnownCount = stories\.filter\(\(x\) => typeof x\.citedByCount === "number"\)\.length/,
    "the coverage line is not computed from the stories on screen");
  assert.match(appSrc, /item\.citedByCount === 0\) parts\.push\("No citations yet"\)/,
    "a reported zero citation count is not named in the story rows");
  assert.match(appSrc, /s\.source !== "Citation counts" && !s\.ok/,
    "the citation completion leg can still land in the missing sections list");
  assert.match(appSrc, /Citation counts could not be completed this round/,
    "a failed citation completion leg is not rendered on screen");
});

await test("story titles render through the inline markdown path the answers use", () => {
  const rendered = appSrc.split("renderInlineMdLite(item.title, P)").length - 1;
  assert.ok(rendered >= 3, `expected hero, digest and modal titles via renderInlineMdLite, found ${rendered}`);
  assert.match(appSrc, /renderInlineMdLite\(x\.title, P\)/, "rail titles do not render via renderInlineMdLite");
  assert.match(appSrc, /renderInlineMdLite\(nx\.title, P\)/, "up next titles do not render via renderInlineMdLite");
  assert.match(appSrc, /renderInlineMdLite\(c\.title, P\)/, "coverage titles do not render via renderInlineMdLite");
});

// ══════════════════════════════════════════════════════════════════════════
group("trending endpoint — first serve media and the edition archive");

// A minimal in-memory D1 stand in for the two trending tables plus
// pass-through behaviour for the other statements the request path
// issues (rate limit buckets, the image cache): reads miss, writes
// land nowhere. Only the trending statements are modelled, because
// they are the ones under test.
function fakeTrendingDb() {
  const cache = { row: null };
  const editions = new Map();
  // A statement answers run/first/all with or without a bind, the way
  // D1's own prepared statements do.
  const statement = (sql, args) => ({
    bind: (...a) => statement(sql, a),
    run: async () => {
      if (sql.includes("INSERT INTO trending_cache")) cache.row = { payload: args[0], fetched_at: args[1] };
      else if (sql.includes("INSERT INTO trending_editions")) editions.set(args[0], { payload: args[1], generated_at: args[2] });
      else if (sql.includes("DELETE FROM trending_editions")) {
        const keep = [...editions.entries()].sort((a, b) => b[1].generated_at - a[1].generated_at).slice(0, args[0]);
        editions.clear();
        for (const [k, v] of keep) editions.set(k, v);
      }
      return { success: true };
    },
    first: async () => {
      if (sql.includes("FROM trending_cache")) return cache.row ? { payload: cache.row.payload, fetched_at: cache.row.fetched_at } : null;
      if (sql.includes("FROM trending_editions")) {
        const e = editions.get(args[0]);
        return e ? { payload: e.payload, generated_at: e.generated_at } : null;
      }
      return null;
    },
    all: async () => {
      if (sql.includes("FROM trending_editions")) {
        return { results: [...editions.entries()]
          .map(([edition_id, v]) => ({ edition_id, generated_at: v.generated_at, payload: v.payload }))
          .sort((a, b) => b.generated_at - a.generated_at) };
      }
      return { results: [] };
    },
  });
  return { prepare: (sql) => statement(sql, []), exec: async () => {}, _cache: cache, _editions: editions };
}

function jsonRes(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
}

// Routes the four feed sources and the citation providers; every
// other URL (the whole image pipeline) answers 404, so media
// resolution honestly finds nothing and attaches the empty contract.
function endpointFetch({ epmcResults, spaceResults }) {
  return async (url) => {
    const u = String(url);
    if (u.includes("europepmc") && u.includes("/search")) return jsonRes({ resultList: { result: epmcResults } });
    if (u.includes("biorxiv")) return jsonRes({ collection: [] });
    if (u.includes("export.arxiv.org")) return new Response("<feed></feed>", { status: 200, headers: { "Content-Type": "application/atom+xml" } });
    if (u.includes("spaceflightnewsapi")) return jsonRes({ results: spaceResults });
    if (u.includes("api.openalex.org")) return jsonRes({ results: [] });
    return new Response("nope", { status: 404 });
  };
}

async function callTrending(db, url) {
  const { onRequest } = await import(join(root, "functions/api/trending.js"));
  const pending = [];
  const res = await onRequest({
    request: new Request(url || "https://askcerebrum.org/api/trending"),
    env: { DB: db },
    waitUntil: (p) => pending.push(p),
  });
  return { res, data: await res.json(), pending };
}

await test("first serve carries media on the visible slice; the backfill completes the row", async () => {
  const epmcResults = Array.from({ length: 12 }, (_, i) => ({
    title: `Fixture study ${i + 1} on plant cell signalling.`, abstractText: "An abstract.",
    doi: `10.9/m${i + 1}`, journalTitle: "J Fixture", firstPublicationDate: isoDaysAgo(1),
  }));
  const spaceResults = [1, 2, 3].map((i) => ({
    title: `Launch fixture ${i}`, summary: "A summary.", url: `https://news.example/l${i}`,
    image_url: "", news_site: "Fixture News", published_at: new Date().toISOString(),
  }));
  const db = fakeTrendingDb();
  const restore = stubFetch(endpointFetch({ epmcResults, spaceResults }));
  let out;
  try { out = await callTrending(db); } finally { restore(); }
  const { data, pending } = out;
  assert.equal(data.ok, true);
  assert.equal(data.items.length, 15, "fixture edition should hold fifteen items");
  // The visible slice (hero, rails, top of the digest) leaves with its
  // media resolved — an explicit empty where nothing verified — and
  // the tail leaves unresolved rather than making the first reader
  // wait for all fifteen resolutions.
  for (let i = 0; i < 10; i++) assert.ok("media" in data.items[i], `item ${i} on the first serve has no media key`);
  for (let i = 10; i < 15; i++) assert.ok(!("media" in data.items[i]), `item ${i} past the slice was resolved inline`);
  // The background backfill then completes the stored row, so the
  // next serve carries media on every item.
  await Promise.all(pending);
  const stored = JSON.parse(db._cache.row.payload);
  assert.ok(stored.items.every((it) => it && it.media), "the backfilled cache row still has items without media");
});

await test("editions accumulate: yesterday's archive gives today its second day", async () => {
  const db = fakeTrendingDb();
  const yesterdayTs = Date.now() - DAY_MS;
  const yesterdayId = new Date(yesterdayTs).toISOString().slice(0, 10);
  db._editions.set(yesterdayId, {
    payload: JSON.stringify({
      items: [{ title: "Fresh journal paper", doi: "10.9/fresh", url: "https://doi.org/10.9/fresh",
        category: "Biology & Medicine", source: "J Fixture", publishedAt: isoDaysAgo(3), citedByCount: null }],
      generatedAt: yesterdayTs,
    }),
    generated_at: yesterdayTs,
  });
  const epmcResults = [
    { title: "Fresh journal paper.", abstractText: "An abstract.", doi: "10.9/fresh",
      journalTitle: "J Fixture", firstPublicationDate: isoDaysAgo(2) },
    { title: "Counted journal paper.", abstractText: "An abstract.", doi: "10.9/counted",
      journalTitle: "J Fixture", firstPublicationDate: isoDaysAgo(2), citedByCount: 5 },
  ];
  const restore = stubFetch(endpointFetch({ epmcResults, spaceResults: [] }));
  let out;
  try { out = await callTrending(db); } finally { restore(); }
  const { data } = out;
  assert.equal(data.ok, true);
  // The store accumulated rather than overwrote: both days are in the
  // archive, the picker data lists both, and the work that was in
  // yesterday's edition honestly reads its second day.
  assert.equal(db._editions.size, 2, "the archive did not keep both editions");
  assert.equal(data.editions.length, 2, "the editions list does not carry both days");
  const fresh = data.items.find((i) => i.title === "Fresh journal paper");
  assert.equal(fresh.trend.daysPresent, 2, "a work in two editions did not read day 2");
  const counted = data.items.find((i) => i.title === "Counted journal paper");
  assert.equal(counted.trend.daysPresent, 1, "a new work did not read day 1");
  // And yesterday is still servable, read only, as itself.
  const archived = await callTrending(db, `https://askcerebrum.org/api/trending?edition=${yesterdayId}`);
  assert.equal(archived.data.archived, true, "the past edition was not served from the archive");
  assert.equal(archived.data.items.length, 1, "the archived edition's items changed");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
