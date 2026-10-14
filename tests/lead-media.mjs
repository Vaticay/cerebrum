/**
 * Lead-media tests — the {"ok":true,"image":null} root cause and its fixes.
 *
 * What this covers, end to end:
 *   1. The actual root cause: Wikimedia Commons appends tracking query
 *      parameters to every imageinfo URL, and the old $-anchored extension
 *      test rejected 100% of real Commons results — the whole source read
 *      as "empty" while the provider was returning plenty. Regression
 *      tests pin the fixed extension matching for stills, webm video, and
 *      NASA mp4 manifests.
 *   2. resolveLeadMedia with a stubbed fetch: a usable provider result now
 *      flows through to a verified image; a dead early candidate no longer
 *      blocks a working later one; total failure is an honest null.
 *   3. Cache discipline: verified hits live 14 days, misses live 6 hours
 *      (the old code cached nulls for 14 days, so a miss never healed).
 *   4. videos.js provider fallback: an empty YouTube-direct result no
 *      longer wins the race — the proxy fallback genuinely runs.
 *   5. The trending media contract: attachMedia shapes, enrichment wiring,
 *      and the guarantee that HTML cleanup never strips image_url.
 *
 * Pure unit tests: no network, no database, no Cloudflare bindings. The
 * global fetch is stubbed wherever the pipeline needs exercising.
 *
 * Standalone: run with `node tests/lead-media.mjs`. Also wired into
 * tests/run.
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

function stubFetch(handler) {
  const saved = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = saved; };
}

const jsonRes = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// A live-shaped Wikimedia Commons API response: imageinfo URLs ALWAYS
// carry the tracking query string as of 2026. This is the exact shape
// that the old $-anchored extension test rejected on every single page.
function commonsApiResponse(url, license = "CC BY-SA 4.0") {
  return {
    query: {
      pages: {
        67380551: {
          pageid: 67380551,
          ns: 6,
          title: "File:Gut microbiota composition.png",
          imageinfo: [
            {
              url: url,
              descriptionurl: "https://commons.wikimedia.org/wiki/File:Gut_microbiota_composition.png",
              extmetadata: license
                ? {
                    LicenseShortName: { value: license },
                    Artist: { value: '<a href="x">Some Artist</a>' },
                  }
                : {},
            },
          ],
        },
      },
    },
  };
}

const COMMONS_UTM_URL =
  "https://upload.wikimedia.org/wikipedia/commons/3/3c/Gut_microbiota_composition.png" +
  "?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original";

const {
  hasStillExtension,
  hasVideoExtension,
  hasMp4Extension,
  parseNasa,
  parseCommons,
  parseCommonsVideo,
  pickNasaVideoAsset,
  verifyMediaUrl,
  resolveLeadMedia,
  isImageCacheFresh,
  mediaCacheKey,
  mediaMatchesSubject,
} = await import(join(root, "functions/api/image.js"));

const { searchVideos } = await import(join(root, "functions/api/videos.js"));

const {
  attachMedia,
  enrichTrendingMedia,
  isUsableCachePayload,
} = await import(join(root, "functions/api/trending.js"));

const { buildTrendingItem } = await import(join(root, "functions/lib/trendingSource.js"));

// ══════════════════════════════════════════════════════════════════════════
group("root cause — extension matching against real provider URLs");

await test("hasStillExtension accepts a Commons URL with tracking params", () => {
  assert.equal(hasStillExtension(COMMONS_UTM_URL), true);
});

await test("hasStillExtension accepts plain still URLs and webp", () => {
  assert.equal(hasStillExtension("https://images-assets.nasa.gov/image/x/x~medium.jpg"), true);
  assert.equal(hasStillExtension("https://example.com/photo.webp"), true);
  assert.equal(hasStillExtension("https://example.com/a.png#frag"), true);
});

await test("hasStillExtension still rejects disguised extensions", () => {
  assert.equal(hasStillExtension("https://evil.example/x.png.evil"), false);
  assert.equal(hasStillExtension("https://evil.example/x.jpg/"), false);
  assert.equal(hasStillExtension("https://example.com/noext"), false);
  assert.equal(hasStillExtension(null), false);
});

await test("hasVideoExtension accepts Commons webm with tracking params", () => {
  assert.equal(
    hasVideoExtension("https://upload.wikimedia.org/x/clip.webm?utm_source=commons.wikimedia.org"),
    true
  );
  assert.equal(hasVideoExtension("https://evil.example/x.webm.evil"), false);
});

await test("hasMp4Extension accepts NASA manifest mp4s, with or without query", () => {
  assert.equal(hasMp4Extension("https://images-assets.nasa.gov/video/x/x~mobile.mp4"), true);
  assert.equal(hasMp4Extension("https://cdn.example/x.mp4?dl=1"), true);
  assert.equal(hasMp4Extension("https://evil.example/x.mp4.evil"), false);
});

await test("parseCommons returns the live-shaped result (was: null for every page)", () => {
  const hit = parseCommons(commonsApiResponse(COMMONS_UTM_URL));
  assert.ok(hit, "parseCommons rejected a real Commons result");
  assert.equal(hit.url, COMMONS_UTM_URL, "provider URL must be preserved verbatim");
  assert.equal(hit.source, "commons");
  assert.equal(hit.license, "CC BY-SA 4.0");
  assert.ok(hit.credit.includes("Wikimedia Commons"), "attribution missing");
});

await test("parseCommons still refuses unlicensed files", () => {
  assert.equal(parseCommons(commonsApiResponse(COMMONS_UTM_URL, null)), null);
});

await test("parseCommonsVideo returns webm results with tracking params", () => {
  const data = commonsApiResponse(
    "https://upload.wikimedia.org/wikipedia/commons/x/clip.webm?utm_source=commons.wikimedia.org"
  );
  const hit = parseCommonsVideo(data);
  assert.ok(hit, "parseCommonsVideo rejected a real Commons webm");
  assert.equal(hit.type, "video");
  assert.equal(hit.source, "commons-video");
});

await test("parseNasa still parses real NASA links", () => {
  const hit = parseNasa({
    collection: {
      items: [
        {
          links: [{ href: "https://images-assets.nasa.gov/image/x/x~medium.jpg" }],
          data: [{ center: "JSC" }],
        },
      ],
    },
  });
  assert.ok(hit);
  assert.equal(hit.source, "nasa");
});

await test("pickNasaVideoAsset picks the smallest mp4", () => {
  const asset = pickNasaVideoAsset([
    "https://images-assets.nasa.gov/video/x/x~orig.mp4",
    "https://images-assets.nasa.gov/video/x/x~mobile.mp4",
    "https://images-assets.nasa.gov/video/x/x~small.mp4",
  ]);
  assert.ok(asset.endsWith("~mobile.mp4"), "did not pick the smallest mp4: " + asset);
});

// ══════════════════════════════════════════════════════════════════════════
group("resolveLeadMedia — the full pipeline with stubbed providers");

function headStubFor({ nasa = 404, commons = 404 } = {}) {
  return async (url, opts) => {
    const method = (opts && opts.method) || "GET";
    if (method === "HEAD") {
      if (String(url).startsWith("https://images-assets.nasa.gov/")) {
        return new Response("", {
          status: nasa,
          headers: { "Content-Type": nasa === 200 ? "image/jpeg" : "text/html" },
        });
      }
      if (String(url).startsWith("https://upload.wikimedia.org/")) {
        return new Response("", {
          status: commons,
          headers: { "Content-Type": commons === 200 ? "image/jpeg" : "text/html" },
        });
      }
      return new Response("", { status: 404, headers: { "Content-Type": "text/html" } });
    }
    if (String(url).includes("commons.wikimedia.org/w/api.php")) {
      return jsonRes(commonsApiResponse(COMMONS_UTM_URL));
    }
    if (String(url).includes("images-api.nasa.gov")) {
      return jsonRes({
        collection: {
          items: [
            {
              links: [{ href: "https://images-assets.nasa.gov/image/x/x~medium.jpg" }],
              data: [{ center: "JSC" }],
            },
          ],
        },
      });
    }
    return new Response("{}", { status: 404, headers: { "Content-Type": "text/html" } });
  };
}

await test("a usable Commons result flows through to a verified image", async () => {
  const restore = stubFetch(headStubFor({ nasa: 404, commons: 200 }));
  try {
    const { image, cacheHit } = await resolveLeadMedia({}, "gut microbiome brain", "Biology & Medicine");
    assert.ok(image, "expected an image, got null — the root-cause regression is back");
    assert.equal(image.source, "commons");
    assert.equal(image.url, COMMONS_UTM_URL);
    assert.equal(image.verified, true);
    assert.equal(cacheHit, false);
  } finally { restore(); }
});

await test("a dead early candidate does not block a working later one", async () => {
  // NASA's URL verifies as text/html (the Europe PMC 301-to-HTML class of
  // failure); Commons verifies cleanly. Priority order must still fall
  // through to the working candidate.
  const restore = stubFetch(async (url, opts) => {
    const method = (opts && opts.method) || "GET";
    if (method === "HEAD") {
      const ok = String(url).startsWith("https://upload.wikimedia.org/");
      return new Response("", {
        status: ok ? 200 : 200,
        headers: { "Content-Type": ok ? "image/jpeg" : "text/html" },
      });
    }
    if (String(url).includes("commons.wikimedia.org/w/api.php")) {
      return jsonRes(commonsApiResponse(COMMONS_UTM_URL));
    }
    if (String(url).includes("images-api.nasa.gov")) {
      return jsonRes({
        collection: {
          items: [
            {
              links: [{ href: "https://images-assets.nasa.gov/image/x/x~medium.jpg" }],
              data: [{ center: "JSC" }],
            },
          ],
        },
      });
    }
    return new Response("{}", { status: 404 });
  });
  try {
    const { image } = await resolveLeadMedia({}, "gut microbiome", "");
    assert.ok(image, "expected fallback to Commons, got null");
    assert.equal(image.source, "commons", "dead NASA candidate blocked the Commons fallback");
  } finally { restore(); }
});

await test("total provider failure is an honest null, not a throw", async () => {
  const restore = stubFetch(async () => new Response("{}", { status: 404 }));
  try {
    const { image } = await resolveLeadMedia({}, "some obscure topic xyz", "");
    assert.equal(image, null);
  } finally { restore(); }
});

await test("verification still rejects a query-string URL with the wrong content type", async () => {
  const restore = stubFetch(async () => new Response("", {
    status: 200, headers: { "Content-Type": "text/html; charset=UTF-8" },
  }));
  try {
    assert.equal(
      await verifyMediaUrl("https://x.example/a.png?utm_source=commons.wikimedia.org", "image"),
      false,
      "the extension fix must not weaken content-type verification"
    );
  } finally { restore(); }
});

// ══════════════════════════════════════════════════════════════════════════
group("cache discipline — misses must heal, hits must last");

await test("verified hits keep the 14-day TTL", () => {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  assert.equal(isImageCacheFresh({ created_at: now - 13 * DAY, hit: 1 }, now), true);
  assert.equal(isImageCacheFresh({ created_at: now - 15 * DAY, hit: 1 }, now), false);
});

await test("misses expire in hours, not weeks", () => {
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;
  assert.equal(isImageCacheFresh({ created_at: now - 1 * HOUR, hit: 0 }, now), true);
  assert.equal(isImageCacheFresh({ created_at: now - 7 * HOUR, hit: 0 }, now), false);
});

await test("legacy rows without a hit flag are treated as misses", () => {
  const now = Date.now();
  assert.equal(isImageCacheFresh({ created_at: now - 1000 }, now), true);
  assert.equal(isImageCacheFresh({ created_at: now - 24 * 60 * 60 * 1000 }, now), false);
});

await test("cache key is namespaced so fixed resolvers never read stale rows", () => {
  // v5: the namespace moved when the identifier rule gained its
  // strong/weak distinction AND the v4 rows turned out to carry
  // starved misses (the sixth panel's zero verified yield: fan-outs
  // that never ran, cached as authoritative nulls). v4 rows are
  // abandoned, not read — same reasoning as the v3 → v4 move, when
  // URL-only verified rows were abandoned for the topical rule.
  assert.ok(mediaCacheKey("Biology & Medicine", "gut microbiome").includes("|v5"));
});

// ══════════════════════════════════════════════════════════════════════════
group("videos.js — the proxy fallback genuinely runs");

const PIPED_RESULTS = [
  {
    url: "/watch?v=ABCDEFGHIJK",
    title: "Black hole event horizon explained lecture",
    author: "Test Channel",
  },
];

await test("an empty YouTube-direct result no longer beats the proxy fallback", async () => {
  const restore = stubFetch(async (url) => {
    const u = String(url);
    if (u.includes("youtube.com/results")) {
      // Scrape succeeds but the page carries nothing usable: the old code
      // let this [] win the race and the proxies never ran.
      return new Response("<html><body>no usable data here</body></html>", {
        status: 200, headers: { "Content-Type": "text/html" },
      });
    }
    if (u.includes("pipedapi.") || u.includes("invidious.") || u.includes("iv.ggtyler.dev")) {
      return jsonRes(PIPED_RESULTS);
    }
    throw new Error("unexpected fetch: " + u);
  });
  try {
    const videos = await searchVideos("black hole event horizon");
    assert.ok(videos.length >= 1, "proxy fallback never ran — got []");
    assert.equal(videos[0].id, "ABCDEFGHIJK");
    assert.equal(videos[0].provider, "youtube");
    assert.equal(videos[0].url, "https://www.youtube.com/watch?v=ABCDEFGHIJK");
  } finally { restore(); }
});

await test("total video failure is an honest [], never a throw", async () => {
  const restore = stubFetch(async (url) => {
    if (String(url).includes("youtube.com/results")) {
      return new Response("<html></html>", { status: 200 });
    }
    throw new Error("proxy down");
  });
  try {
    assert.deepEqual(await searchVideos("black hole event horizon"), []);
  } finally { restore(); }
});

// ══════════════════════════════════════════════════════════════════════════
group("trending media contract — shapes the UI can rely on");

await test("attachMedia shapes a verified still", () => {
  const item = { title: "T", url: "https://example.com/t" };
  const out = attachMedia(item, {
    url: COMMONS_UTM_URL, credit: "A / Wikimedia Commons",
    creditUrl: "https://commons.wikimedia.org/", license: "CC BY-SA 4.0",
    source: "commons", verified: true,
  });
  assert.equal(out.title, "T", "original item fields must survive");
  assert.equal(out.media.image.url, COMMONS_UTM_URL);
  assert.equal(out.media.image.verified, true);
  assert.equal(out.media.image.source, "commons");
  assert.equal(out.media.video, null);
  assert.ok(typeof out.media.resolvedAt === "number");
});

await test("attachMedia shapes a last-resort video", () => {
  const out = attachMedia({ title: "T" }, {
    url: "https://images-assets.nasa.gov/video/x/x~mobile.mp4",
    type: "video", poster: "https://images-assets.nasa.gov/image/x/x~thumb.jpg",
    credit: "NASA", creditUrl: "https://images.nasa.gov/",
    license: "Public domain", source: "nasa-video", verified: true,
  });
  assert.equal(out.media.image, null);
  assert.equal(out.media.video.url, "https://images-assets.nasa.gov/video/x/x~mobile.mp4");
  assert.equal(out.media.video.poster, "https://images-assets.nasa.gov/image/x/x~thumb.jpg");
  assert.equal(out.media.video.verified, true);
});

await test("attachMedia with no candidate is the honest empty", () => {
  const out = attachMedia({ title: "T" }, null);
  assert.deepEqual(
    { image: out.media.image, video: out.media.video },
    { image: null, video: null }
  );
});

await test("enrichTrendingMedia resolves and attaches per item", async () => {
  const restore = stubFetch(headStubFor({ nasa: 404, commons: 200 }));
  try {
    const items = [
      { title: "gut microbiome brain", url: "https://example.com/a", category: "Biology & Medicine" },
    ];
    const out = await enrichTrendingMedia({}, items, { concurrency: 2 });
    assert.equal(out[0].media.image.source, "commons");
    assert.equal(out[0].media.image.verified, true);
    // Input array is not mutated in place.
    assert.equal(items[0].media, undefined);
  } finally { restore(); }
});

await test("enrichTrendingMedia skips items that already carry media", async () => {
  let fetches = 0;
  const restore = stubFetch(async () => { fetches++; return new Response("{}", { status: 404 }); });
  try {
    const media = { image: { url: "https://example.com/kept.jpg", verified: true }, video: null, resolvedAt: 1 };
    const out = await enrichTrendingMedia({}, [{ title: "T", media }]);
    assert.equal(out[0].media, media, "existing media must not be re-resolved");
    assert.equal(fetches, 0, "no upstream fetch should have run");
  } finally { restore(); }
});

await test("enrichTrendingMedia degrades per item — one failure never poisons the rest", async () => {
  const restore = stubFetch(headStubFor({ nasa: 404, commons: 200 }));
  try {
    const out = await enrichTrendingMedia({}, [
      { title: "gut microbiome", url: "https://example.com/a", category: "Biology & Medicine" },
      { title: "", url: "https://example.com/b", category: "Space" },
    ]);
    assert.ok(out[0].media.image, "first item should have media");
    assert.equal(out[1].media.image, null, "empty-title item gets the honest empty");
    assert.equal(out[1].media.video, null);
  } finally { restore(); }
});

await test("items with media still satisfy the cache-usability rule", () => {
  const item = attachMedia(
    { title: "T", url: "https://example.com/t", category: "Space" },
    { url: "https://example.com/i.jpg", source: "curated", verified: true }
  );
  assert.equal(isUsableCachePayload({ items: [item] }), true);
  const roundTripped = JSON.parse(JSON.stringify(item));
  assert.equal(roundTripped.media.image.verified, true, "media must survive the cache JSON round trip");
});

// ══════════════════════════════════════════════════════════════════════════
group("topical verification — verified means about the story, not just alive");

// The fifth panel's live evidence, replayed as fixtures: on the
// 2026-10-14 edition, five of six verified slots were topically wrong
// (a Mars rover photo on a lunar lander story, a CRS 17 photo on the
// CRS 35 story, a crewed launch photo on a cargo story, a mountains
// video on a structural systems story). URL resolution said all of
// them were fine. The matching rule (documented at mediaMatchesSubject
// in image.js): tokenize both sides with stopwords and generic
// provider words dropped; digit bearing tokens are identifiers and a
// mismatch on both sides vetoes; otherwise a shared identifier (3), a
// shared title token (2), or a shared summary only token (1) must
// reach a score of 2.

await test("the matching rule rejects the panel's wrong assets", () => {
  // Lunar lander story, Mars rover asset: no shared vocabulary at all.
  assert.equal(mediaMatchesSubject(
    "Mars Exploration Rover assembly at Kennedy Space Center",
    "NASA JPL testing readies Voyager lander technologies for a Moon mission",
    "A way to test new outer planet technologies on the Moon with a small lander."
  ), false, "Mars rover asset verified for a lunar lander story");
  // CRS 35 story, CRS 17 asset: the words overlap (SpaceX, CRS,
  // launch) and the identifier veto is what rejects it.
  assert.equal(mediaMatchesSubject(
    "SpaceX CRS-17 launch from Cape Canaveral",
    "SpaceX CRS-35 cargo resupply mission to the space station",
    "The CRS-35 capsule carries cargo and science."
  ), false, "CRS 17 asset verified for the CRS 35 story");
  // CRS 35 story, Crew 12 asset: crewed is not cargo, and 12 is not 35.
  assert.equal(mediaMatchesSubject(
    "NASA SpaceX Crew-12 launch",
    "SpaceX CRS-35 cargo resupply mission to the space station",
    ""
  ), false, "Crew 12 asset verified for the CRS 35 cargo story");
  // Structural systems story, German mountains video: nothing shared.
  assert.equal(mediaMatchesSubject(
    "Visualisierung der Liste der Berge nach Dominanz",
    "Complex Modes in Lightly Damped Structural Systems",
    "A method for lightly damped structures."
  ), false, "mountains video verified for a structural systems story");
  // Mars moon lander story, Phobos eclipse asset: adjacent subject,
  // still not this story (one summary only token is not enough).
  assert.equal(mediaMatchesSubject(
    "Phobos eclipses the Sun as seen by InSight",
    "NASA selects Intuitive Machines for Mars moon lander demo",
    "A lander for the Mars moon Phobos is planned as a demo."
  ), false, "Phobos eclipse asset verified for the lander story");
});

await test("the matching rule accepts assets that are about the story", () => {
  // The one correct slot on the panel's edition: H5N1 story, H5N1
  // image — identifier agreement is decisive on its own.
  assert.equal(mediaMatchesSubject(
    "Colorized transmission electron micrograph of H5N1 virus particles",
    "Bovine H5N1 influenza viruses from cattle",
    "Samples of H5N1 were taken from herds."
  ), true, "H5N1 asset rejected for the H5N1 story");
  // One distinctive shared title word is enough.
  assert.equal(mediaMatchesSubject(
    "Gut microbiota composition",
    "gut microbiome brain",
    ""
  ), true, "gut asset rejected for the gut microbiome story");
  // No metadata at all: topicality cannot be verified, so it is not.
  assert.equal(mediaMatchesSubject("", "gut microbiome brain", ""), false,
    "a metadata free asset was verified on nothing");
});

// A NASA-shaped stub: the search returns one titled asset, every URL
// under images-assets.nasa.gov verifies as a real image, and every
// other provider is empty or down.
function nasaOnlyStub(assetTitle) {
  return async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || "GET";
    if (method === "HEAD") {
      const ok = u.startsWith("https://images-assets.nasa.gov/");
      return new Response("", { status: ok ? 200 : 404, headers: { "Content-Type": ok ? "image/jpeg" : "text/html" } });
    }
    if (u.includes("images-api.nasa.gov")) {
      if (u.includes("media_type=video")) return jsonRes({ collection: { items: [] } });
      return jsonRes({
        collection: {
          items: [{
            links: [{ href: "https://images-assets.nasa.gov/image/PIA04834/PIA04834~medium.jpg" }],
            data: [{ title: assetTitle, center: "JPL" }],
          }],
        },
      });
    }
    if (u.includes("europepmc")) return jsonRes({ resultList: { result: [] } });
    return new Response("{}", { status: 404 });
  };
}

await test("a resolved but off topic asset is not verified: the resolver returns the honest null", async () => {
  const restore = stubFetch(nasaOnlyStub("Mars Exploration Rover on the ramp at Kennedy Space Center"));
  try {
    const { image } = await resolveLeadMedia({}, "Voyager lander moon mission", "Space", {
      title: "NASA JPL testing readies Voyager lander technologies for a Moon mission",
      summary: "A way to test new outer planet technologies on the Moon.",
    });
    assert.equal(image, null, "the Mars rover asset came back verified for a lunar lander story");
  } finally { restore(); }
});

await test("an on topic asset still verifies end to end", async () => {
  const restore = stubFetch(nasaOnlyStub("Colorized micrograph of H5N1 virus particles"));
  try {
    const { image } = await resolveLeadMedia({}, "H5N1 influenza viruses", "Biology & Medicine", {
      title: "Bovine H5N1 influenza viruses from cattle",
      summary: "Samples of H5N1 were taken from herds.",
    });
    assert.ok(image, "the H5N1 asset did not verify for the H5N1 story");
    assert.equal(image.source, "nasa");
    assert.equal(image.verified, true);
  } finally { restore(); }
});

await test("enrichTrendingMedia ships a wrong asset's item media free and a right asset's item verified", async () => {
  const restore = stubFetch(async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || "GET";
    if (method === "HEAD") {
      const ok = u.startsWith("https://images-assets.nasa.gov/");
      return new Response("", { status: ok ? 200 : 404, headers: { "Content-Type": ok ? "image/jpeg" : "text/html" } });
    }
    if (u.includes("images-api.nasa.gov")) {
      if (u.includes("media_type=video")) return jsonRes({ collection: { items: [] } });
      // NASA answers each item's own search: the lander story's search
      // surfaces the rover photo (the panel's exact failure), the
      // H5N1 story's search surfaces the virus micrograph.
      const title = u.includes("h5n1")
        ? "Colorized micrograph of H5N1 virus particles"
        : "Mars Exploration Rover on the ramp at Kennedy Space Center";
      return jsonRes({
        collection: {
          items: [{
            links: [{ href: "https://images-assets.nasa.gov/image/x/x~medium.jpg" }],
            data: [{ title, center: "JPL" }],
          }],
        },
      });
    }
    if (u.includes("europepmc")) return jsonRes({ resultList: { result: [] } });
    return new Response("{}", { status: 404 });
  });
  try {
    const out = await enrichTrendingMedia({}, [
      { title: "NASA JPL testing readies Voyager lander technologies for a Moon mission", summary: "A way to test new outer planet technologies on the Moon.", url: "https://example.com/lander", category: "Space" },
      { title: "Bovine H5N1 influenza viruses from cattle", summary: "Samples of H5N1 were taken from herds.", url: "https://example.com/h5n1", category: "Biology & Medicine" },
    ], { concurrency: 2 });
    assert.deepEqual(
      { image: out[0].media.image, video: out[0].media.video },
      { image: null, video: null },
      "the lunar lander item shipped with the Mars rover photo attached"
    );
    assert.ok(out[1].media.image, "the H5N1 item shipped without its matching image");
    assert.equal(out[1].media.image.verified, true);
    assert.equal(out[1].media.image.source, "nasa");
  } finally { restore(); }
});

// ══════════════════════════════════════════════════════════════════════════
group("identifier strength — a coincidence is not an agreement (wave seven)");

await test("the live CRS 35 case: weak shared numbers do not save a CRS 17 asset", () => {
  // Replayed from the live edition (item 27) with its real metadata:
  // the asset is the CRS 17 launch, the story is CRS 35, and the two
  // texts share Launch Complex 40 and Falcon 9. Under the first
  // version of the rule the shared "40" counted as identifier
  // agreement, the veto never fired, and the wrong launch verified.
  assert.equal(mediaMatchesSubject(
    "Live Coverage of SpaceX CRS-17 Launch to the International Space Station. The SpaceX Falcon 9 rocket launched from Launch Complex 40 at Cape Canaveral.",
    "NASA Science, Cargo Launch on 35th SpaceX Resupply Mission to Station",
    "The CRS-35 Dragon capsule launches from Launch Complex 40 carrying cargo and science to the station."
  ), false, "CRS 17 asset verified for the CRS 35 story on a shared launch complex");
  // The ordinal in the headline and the compound in the summary are
  // the same number: "35th" must meet "CRS-35" as one identifier.
  assert.equal(mediaMatchesSubject(
    "SpaceX CRS-35 launch coverage",
    "NASA Science, Cargo Launch on 35th SpaceX Resupply Mission to Station",
    "Cargo and science for the station."
  ), true, "the CRS 35 asset was rejected for the 35th resupply story");
});

await test("a bare shared year is not identifier agreement", () => {
  // The live APOD case (item 39): a 1968 Apollo 7 photograph whose
  // Commons filename carries the year as a catalog fragment verified
  // for a 2026 APOD story on the year alone. Its own designator
  // (AS07) names a different mission than the story's headline.
  assert.equal(mediaMatchesSubject(
    "AS07-11-2026 - Apollo 7 - Apollo 7 Mission, Mexico and Arizona - NARA - 16667026",
    "APOD: 2026 October 13, Desert Stairway to Heaven",
    "A desert stairway under the Milky Way."
  ), false, "the Apollo 7 catalog photo verified for the APOD story on a shared year");
});

await test("a numbered story demands vocabulary from an unnumbered asset", () => {
  // The live item 15 case: a NASA video about the astronaut
  // programme, carrying no designator at all, verified for the
  // CRS 35 cargo story on the single shared word "spacex". One word
  // is not proof when the story names a specific numbered thing.
  assert.equal(mediaMatchesSubject(
    "What's the Status of NASA and SpaceX's Mission to Launch Astronauts to Space?",
    "SpaceX launches NASA science and cargo to the International Space Station",
    "The CRS-35 resupply mission carries science and cargo to the station."
  ), false, "an unnumbered astronaut video verified for the numbered cargo story on one word");
  // Two distinctive shared words still carry an unnumbered asset
  // for an unnumbered story: the bar only rises when the STORY is
  // the numbered one.
  assert.equal(mediaMatchesSubject(
    "Gut microbiota composition",
    "gut microbiome brain",
    ""
  ), true, "the gut asset regressed under the threshold rule");
});

await test("NASA subjects are the asset's title, never its press prose", () => {
  const parsed = parseNasa({
    collection: { items: [{
      links: [{ href: "https://images-assets.nasa.gov/image/PIA04834/PIA04834~medium.jpg" }],
      data: [{ title: "Mars Exploration Rover 1", center: "JPL", description: "Engineers for the mission are completing assembly and testing for the twin robotic geologists at JPL, readying lander technologies for a Moon mission." }],
    }] },
  });
  assert.equal(parsed.subject, "Mars Exploration Rover 1",
    "the NASA subject carried description prose: " + parsed.subject);
});

await test("a later candidate from the same source wins when the first is off topic", async () => {
  // NASA answers the H5N1 search with the rover first and the virus
  // micrograph second. One candidate per source used to end the
  // matter at the rover's rejection; the walk now reads the list.
  const restore = stubFetch(async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || "GET";
    if (method === "HEAD") {
      const ok = u.startsWith("https://images-assets.nasa.gov/");
      return new Response("", { status: ok ? 200 : 404, headers: { "Content-Type": ok ? "image/jpeg" : "text/html" } });
    }
    if (u.includes("images-api.nasa.gov")) {
      if (u.includes("media_type=video")) return jsonRes({ collection: { items: [] } });
      return jsonRes({ collection: { items: [
        { links: [{ href: "https://images-assets.nasa.gov/image/PIA04834/PIA04834~medium.jpg" }], data: [{ title: "Mars Exploration Rover 1", center: "JPL" }] },
        { links: [{ href: "https://images-assets.nasa.gov/image/PIA99999/PIA99999~medium.jpg" }], data: [{ title: "Colorized micrograph of H5N1 virus particles", center: "JPL" }] },
      ] } });
    }
    if (u.includes("europepmc")) return jsonRes({ resultList: { result: [] } });
    return new Response("{}", { status: 404 });
  });
  try {
    const { image } = await resolveLeadMedia({}, "H5N1 influenza viruses", "Biology & Medicine", {
      title: "Bovine H5N1 influenza viruses from cattle",
      summary: "Samples of H5N1 were taken from herds.",
    });
    assert.ok(image, "the on topic second candidate did not verify");
    assert.ok(image.url.includes("PIA99999"), "the winner was not the second candidate: " + image.url);
  } finally { restore(); }
});

// ══════════════════════════════════════════════════════════════════════════
group("resolution budget and miss honesty — a starved null is not a miss (wave seven)");

// A tiny in-memory image_cache: the resolver's own statements,
// nothing else modelled.
function fakeImageDb() {
  const rows = new Map();
  const statement = (sql, args) => ({
    bind: (...a) => statement(sql, a),
    run: async () => {
      if (sql.includes("INSERT INTO image_cache")) rows.set(args[0], { payload: args[1], created_at: args[2], hit: args[3] });
      return { success: true };
    },
    first: async () => (sql.includes("FROM image_cache") ? rows.get(args[0]) || null : null),
  });
  return { rows, exec: async () => {}, prepare: (sql) => statement(sql, []) };
}

await test("a cache-only probe never fetches and never writes", async () => {
  let fetches = 0;
  const restore = stubFetch(async () => { fetches++; return new Response("{}", { status: 404 }); });
  try {
    const probe = await resolveLeadMedia({}, "gut microbiome brain", "Biology & Medicine", null, { cacheOnly: true });
    assert.equal(probe.cacheHit, false);
    assert.equal(probe.needsResolution, true);
    assert.equal(probe.image, null);
    assert.equal(fetches, 0, "the probe ran the fan-out it exists to avoid");
  } finally { restore(); }
});

await test("a fan-out that threw its way to null does not cache the miss; an answered one does", async () => {
  // Every provider fetch throws: the platform refusing subrequests
  // and a provider timing out look exactly like this from inside.
  const db1 = fakeImageDb();
  const restore1 = stubFetch(async () => { throw new Error("too many subrequests"); });
  try {
    const { image } = await resolveLeadMedia({ DB: db1 }, "gut microbiome brain", "Biology & Medicine");
    assert.equal(image, null);
    assert.equal(db1.rows.size, 0, "a starved resolution cached its null as a miss");
  } finally { restore1(); }
  // Every provider answers 404: a definitive "nothing anywhere".
  // That miss is earned, it caches, and the next call reads it back.
  const db2 = fakeImageDb();
  const restore2 = stubFetch(async () => new Response("{}", { status: 404 }));
  try {
    const first = await resolveLeadMedia({ DB: db2 }, "gut microbiome brain", "Biology & Medicine");
    assert.equal(first.image, null);
    assert.equal(db2.rows.size, 1, "an answered miss was not cached");
    const second = await resolveLeadMedia({ DB: db2 }, "gut microbiome brain", "Biology & Medicine");
    assert.equal(second.cacheHit, true, "the cached miss was not served back");
    assert.equal(second.image, null);
  } finally { restore2(); }
});

await test("enrichTrendingMedia spends at most its fan-out budget per pass and defers the rest", async () => {
  const restore = stubFetch(nasaOnlyStub("Colorized micrograph of H5N1 virus particles"));
  try {
    const items = [1, 2, 3, 4, 5].map((n) => ({
      title: `Bovine H5N1 influenza viruses study ${n}`,
      summary: "Samples of H5N1 were taken from herds.",
      category: "Preprints",
    }));
    const out = await enrichTrendingMedia({}, items, { concurrency: 2, maxFanout: 2 });
    const resolved = out.filter((it) => "media" in it);
    assert.equal(resolved.length, 2, `expected exactly the fan-out budget resolved, got ${resolved.length}`);
    assert.ok(resolved.every((it) => it.media.image && it.media.image.verified),
      "a budgeted resolution did not verify its asset");
    assert.ok(out.filter((it) => !("media" in it)).every((it) => it.media === undefined),
      "a deferred item was stamped resolved instead of left for a later pass");
  } finally { restore(); }
});

// ══════════════════════════════════════════════════════════════════════════
group("HTML cleanup must never strip media URLs");

await test("buildTrendingItem cleans markup but preserves image_url byte-for-byte", () => {
  const raw = {
    title: "Disseminated &lt;i&gt;Klebsiella pneumoniae&lt;/i&gt; Infection",
    summary: "<p>A <b>real</b> abstract.</p>",
    url: "  https://doi.org/10.1/example  ",
    image_url: "https://spaceflight.example/img.jpg?x=1&y=2",
    source: "",
    publishedAt: null,
    citedByCount: "3",
  };
  const item = buildTrendingItem(raw, "Biology & Medicine");
  // Corrected contract (third rescore fix): the title keeps the
  // species name's italics as a markdown pair — the old expectation
  // pinned the defect, the name stripped of its italics and rendered
  // in roman. The summary assertion below still pins plain text.
  assert.equal(item.title, "Disseminated *Klebsiella pneumoniae* Infection");
  assert.equal(item.summary, "A real abstract.");
  assert.equal(item.url, "https://doi.org/10.1/example");
  assert.equal(
    item.image_url,
    "https://spaceflight.example/img.jpg?x=1&y=2",
    "image_url was altered by the cleanup path"
  );
  assert.equal(item.source, "Biology & Medicine");
  assert.equal(item.category, "Biology & Medicine");
  assert.equal(item.citedByCount, 3);
});

await test("buildTrendingItem drops markup-only titles as empty", () => {
  const item = buildTrendingItem({ title: "<br/>", summary: "s", url: "https://example.com/x" }, "Space");
  assert.equal(item.title, "");
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
