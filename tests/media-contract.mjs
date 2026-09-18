/**
 * Frontend media-contract tests — the verified media rendering contract.
 *
 * What this covers:
 *   1. The pure resolvers in src/CerebrumApp.jsx (extracted and evaluated):
 *      cleanMediaUrl, verifiedMediaOf, trendingMediaOf, docMediaOf.
 *      - Only `verified: true` slots with safe https URLs are media.
 *      - image XOR video; image preferred.
 *      - {image:null, video:null} = honest nothing → null.
 *      - trending: media absent + legacy image_url → back-compat render;
 *        media present-but-empty beats the legacy url (resolved nothing).
 *      - document: media always keyed on the final response; absent → null.
 *   2. Wiring: the hero, article modal, digest rows, and Document Mode
 *      analysis all render through the resolvers + MediaFigure/TrendThumb,
 *      failed loads remove the figure (never a broken frame), video has
 *      controls and no autoplay, credit links are safe.
 *
 * Pure unit tests: no network, no database, no Cloudflare bindings.
 *
 * Standalone: run with `node tests/media-contract.mjs`. Also wired into
 * tests/run.
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

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

// ── Extract the pure resolvers from CerebrumApp.jsx ──────────────────────
// They are declared as top-level `function name(...)` with no nested
// function declarations, so brace counting is a safe extractor.
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");

function extractFunction(src, name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  assert.ok(start !== -1, `function ${name} not found in CerebrumApp.jsx`);
  // Skip the parameter list (it may destructure: `({ P, media })`), then
  // take the body block. Braces stay balanced through JSX.
  let i = start + marker.length;
  let pdepth = 1;
  for (; i < src.length; i++) {
    if (src[i] === "(") pdepth++;
    else if (src[i] === ")") { pdepth--; if (pdepth === 0) break; }
  }
  i = src.indexOf("{", i);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return src.slice(start, i);
}

const resolverSrc = [
  "cleanMediaUrl",
  "cleanMediaText",
  "verifiedMediaOf",
  "trendingMediaOf",
  "docMediaOf",
].map((n) => extractFunction(appSrc, n)).join("\n");

// The resolvers reference the module-level MEDIA_URL_RE; pass it in as a
// parameter since new Function has only global scope.
const factory = new Function(
  "MEDIA_URL_RE",
  `${resolverSrc}; return { cleanMediaUrl, verifiedMediaOf, trendingMediaOf, docMediaOf };`
);
const { cleanMediaUrl, verifiedMediaOf, trendingMediaOf, docMediaOf } =
  factory(/^https:\/\/[^"'\s<>]+$/i);

// ─═════════════════════════════════════════════════════════════════════════
group("cleanMediaUrl — only safe https URLs are media URLs");

await test("accepts a plain https Commons URL", () => {
  assert.equal(
    cleanMediaUrl("https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.png"),
    "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.png"
  );
});

await test("accepts a Commons URL with tracking query params", () => {
  // The backend fix: imageinfo URLs carry query strings; the frontend
  // must not reject them the way the old backend parser did.
  const u = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.png/640px-Example.png?download=1";
  assert.equal(cleanMediaUrl(u), u);
});

await test("rejects javascript:, data:, and http: URLs", () => {
  assert.equal(cleanMediaUrl("javascript:alert(1)"), null);
  assert.equal(cleanMediaUrl("data:text/html,<h1>x</h1>"), null);
  assert.equal(cleanMediaUrl("http://example.com/x.png"), null);
});

await test("rejects empty / non-string input", () => {
  assert.equal(cleanMediaUrl(""), null);
  assert.equal(cleanMediaUrl(null), null);
  assert.equal(cleanMediaUrl(undefined), null);
  assert.equal(cleanMediaUrl(42), null);
});

// ─═════════════════════════════════════════════════════════════════════════
group("verifiedMediaOf — only verified slots are media");

const verifiedImage = () => ({
  image: {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.png",
    credit: "Jane Doe / Wikimedia Commons",
    creditUrl: "https://commons.wikimedia.org/wiki/File:Example.png",
    license: "CC BY-SA 4.0",
    source: "commons",
    verified: true,
  },
  video: null,
  resolvedAt: 1726590000000,
});

await test("verified image normalizes to a renderable object", () => {
  const m = verifiedMediaOf(verifiedImage());
  assert.equal(m.kind, "image");
  assert.equal(m.url, "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.png");
  assert.equal(m.credit, "Jane Doe / Wikimedia Commons");
  assert.equal(m.creditUrl, "https://commons.wikimedia.org/wiki/File:Example.png");
  assert.equal(m.license, "CC BY-SA 4.0");
  assert.equal(m.verified, true);
});

await test("verified video keeps its poster", () => {
  const m = verifiedMediaOf({
    image: null,
    video: {
      url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.webm",
      poster: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/640px-Example.jpg",
      credit: "NASA / Wikimedia Commons",
      creditUrl: "https://commons.wikimedia.org/wiki/File:Example.webm",
      license: "Public domain",
      source: "commons",
      verified: true,
    },
    resolvedAt: 1726590000000,
  });
  assert.equal(m.kind, "video");
  assert.equal(m.poster, "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/640px-Example.jpg");
});

await test("image is preferred when both slots are set (XOR contract)", () => {
  const media = verifiedImage();
  media.video = {
    url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.webm",
    verified: true,
  };
  assert.equal(verifiedMediaOf(media).kind, "image");
});

await test("unverified slot is not media", () => {
  const media = verifiedImage();
  media.image.verified = false;
  assert.equal(verifiedMediaOf(media), null);
});

await test("missing verified flag is not media", () => {
  const media = verifiedImage();
  delete media.image.verified;
  assert.equal(verifiedMediaOf(media), null);
});

await test("unsafe URL is not media even when verified", () => {
  const media = verifiedImage();
  media.image.url = "javascript:alert(1)";
  assert.equal(verifiedMediaOf(media), null);
});

await test("{image:null, video:null} is honest nothing → null", () => {
  assert.equal(verifiedMediaOf({ image: null, video: null, resolvedAt: 1 }), null);
});

await test("absent / malformed media → null", () => {
  assert.equal(verifiedMediaOf(null), null);
  assert.equal(verifiedMediaOf(undefined), null);
  assert.equal(verifiedMediaOf("nope"), null);
  assert.equal(verifiedMediaOf({}), null);
});

await test("credit text is trimmed and capped", () => {
  const media = verifiedImage();
  media.image.credit = "  " + "x".repeat(300) + "  ";
  const m = verifiedMediaOf(media);
  assert.equal(m.credit.length, 160);
  assert.ok(!m.credit.startsWith(" "));
});

// ─═════════════════════════════════════════════════════════════════════════
group("trendingMediaOf — precedence media.image.url → image_url");

await test("verified media wins outright", () => {
  const item = { media: verifiedImage(), image_url: "https://example.com/legacy.png" };
  const m = trendingMediaOf(item);
  assert.equal(m.kind, "image");
  assert.equal(m.url, "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.png");
  assert.equal(m.verified, true);
});

await test("resolved {null,null} beats a legacy image_url (honest nothing)", () => {
  const item = {
    media: { image: null, video: null, resolvedAt: 1 },
    image_url: "https://example.com/legacy.png",
  };
  assert.equal(trendingMediaOf(item), null);
});

await test("media absent + legacy image_url → back-compat render", () => {
  const m = trendingMediaOf({ title: "t", image_url: "https://example.com/legacy.png" });
  assert.equal(m.kind, "image");
  assert.equal(m.url, "https://example.com/legacy.png");
  assert.equal(m.verified, false);
  assert.equal(m.credit, null);
});

await test("media absent + no image_url → null (not resolved yet)", () => {
  assert.equal(trendingMediaOf({ title: "t" }), null);
  assert.equal(trendingMediaOf({ title: "t", image_url: "not a url" }), null);
});

await test("null item → null", () => {
  assert.equal(trendingMediaOf(null), null);
});

// ─═════════════════════════════════════════════════════════════════════════
group("docMediaOf — document analysis media");

await test("verified analysis media is returned", () => {
  const m = docMediaOf({ executiveSummary: "…", media: verifiedImage() });
  assert.equal(m.kind, "image");
  assert.equal(m.verified, true);
});

await test("analysis without media → null", () => {
  assert.equal(docMediaOf({ executiveSummary: "…" }), null);
  assert.equal(docMediaOf({ executiveSummary: "…", media: { image: null, video: null, resolvedAt: 1 } }), null);
  assert.equal(docMediaOf(null), null);
});

// ─═════════════════════════════════════════════════════════════════════════
group("wiring — every surface renders through the contract");

await test("TrendingHero resolves media via trendingMediaOf", () => {
  const heroSrc = extractFunction(appSrc, "TrendingHero");
  assert.match(heroSrc, /trendingMediaOf\(item\)/, "hero must resolve item media");
  assert.match(heroSrc, /<MediaFigure/, "hero must render MediaFigure");
});

await test("TrendingArticleModal renders lead media via the contract", () => {
  const modalSrc = extractFunction(appSrc, "TrendingArticleModal");
  assert.match(modalSrc, /trendingMediaOf\(item\)/, "modal must resolve item media");
  assert.match(modalSrc, /<MediaFigure/, "modal must render MediaFigure");
  assert.ok(!/imgStatus/.test(modalSrc), "legacy imgStatus state must be gone");
});

await test("digest rows render TrendThumb via trendingMediaOf", () => {
  assert.match(appSrc, /<TrendThumb[^>]*media=\{trendingMediaOf\(item\)\}/, "digest rows must render TrendThumb");
});

await test("Document Mode analysis renders docMediaOf(summary)", () => {
  assert.match(appSrc, /docMediaOf\(summary\)/, "analysis card must resolve summary.media");
});

await test("MediaFigure removes itself on load failure (never a broken frame)", () => {
  const figSrc = extractFunction(appSrc, "MediaFigure");
  assert.match(figSrc, /if \(!media \|\| failed\) return null/, "figure must vanish when failed");
  assert.match(figSrc, /onError=\{\(\) => setFailed\(true\)\}/, "img/video onError must set failed");
});

await test("MediaFigure video has controls and no autoplay", () => {
  const figSrc = extractFunction(appSrc, "MediaFigure");
  assert.match(figSrc, /<video[^>]*controls/, "video must have controls");
  assert.ok(!/autoPlay/.test(figSrc), "video must never autoplay");
});

await test("credit link is safe (safeHref, new tab)", () => {
  const figSrc = extractFunction(appSrc, "MediaFigure");
  assert.match(figSrc, /safeHref\(media\.creditUrl\)/, "credit URL must go through safeHref");
  assert.match(figSrc, /target="_blank" rel="noreferrer"/, "credit link must open safely");
});

await test("TrendThumb removes itself on load failure", () => {
  const thumbSrc = extractFunction(appSrc, "TrendThumb");
  assert.match(thumbSrc, /if \(!media \|\| failed\) return null/);
  assert.match(thumbSrc, /onError=\{\(\) => setFailed\(true\)\}/);
});

// ─═════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
