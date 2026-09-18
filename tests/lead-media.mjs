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
  assert.ok(mediaCacheKey("Biology & Medicine", "gut microbiome").includes("|v3"));
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
  assert.equal(item.title, "Disseminated Klebsiella pneumoniae Infection");
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
