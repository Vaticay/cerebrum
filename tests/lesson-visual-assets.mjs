/**
 * Live lesson visual assets (2026-10-16).
 *
 * Authored lessons in src/LearnView.jsx point at lesson visuals
 * under /cortex/lessons/... through their visual fields. A path
 * written in the data is only a promise: the file still has to
 * exist under public/, carry real image bytes, and weigh enough
 * to be finished art rather than a stub or an error page saved
 * under an image name. A referenced visual with no file behind
 * it renders as a broken frame in a live lesson, and nothing
 * else in the suite looks at the files themselves, so a missing
 * set of visuals can ship silently while every data test passes.
 *
 * This suite scans LearnView.jsx for every such reference, so
 * it covers every path and every lesson directory the source
 * names today and any it adds later, with no list kept here.
 * When a dist/ build output directory exists in the worktree,
 * each referenced visual must also be present there with real
 * image magic, since dist is what actually gets served. When
 * there is no dist/, that half of the check is skipped silently.
 *
 * Run with: node tests/lesson-visual-assets.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

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
group("Lesson visual assets: every referenced visual is a real file");

const learnSrc = readFileSync(join(root, "src/LearnView.jsx"), "utf8");

// Every authored lesson visual reference, whatever directory it
// lives in: the quoted string form of a /cortex/lessons/ path.
// Duplicates collapse, since a visual shared by two cards still
// has only one file to check.
const referenced = [...new Set(
  [...learnSrc.matchAll(/["'](\/cortex\/lessons\/[^"']+)["']/g)].map((m) => m[1]),
)].sort();

console.log(`  checking ${referenced.length} referenced lesson visual paths`);

const MIN_BYTES = 10 * 1024;

// Real image bytes, by extension. The shipped lesson visuals are
// WebP, so that check is exact: RIFF at bytes 0 to 3 and WEBP at
// bytes 8 to 11. Any other extension that appears is held to its
// own magic rather than waved through.
function hasImageMagic(buf, filePath) {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (ext === ".webp") {
    return buf.length >= 12
      && buf.toString("ascii", 0, 4) === "RIFF"
      && buf.toString("ascii", 8, 12) === "WEBP";
  }
  if (ext === ".png") {
    return buf.length >= 8
      && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (ext === ".gif") {
    const head = buf.toString("ascii", 0, 6);
    return head === "GIF87a" || head === "GIF89a";
  }
  if (ext === ".avif") {
    return buf.length >= 12
      && buf.toString("ascii", 4, 8) === "ftyp"
      && (buf.toString("ascii", 8, 12) === "avif" || buf.toString("ascii", 8, 12) === "avis");
  }
  if (ext === ".svg") {
    const head = buf.toString("utf8", 0, 512).trimStart();
    return head.startsWith("<svg") || head.startsWith("<?xml");
  }
  return false;
}

function assertRealImage(absPath, label) {
  const buf = readFileSync(absPath);
  assert.ok(hasImageMagic(buf, absPath),
    `${label} exists but its bytes are not a real image for its extension`);
  return buf;
}

const distExists = existsSync(join(root, "dist"));

await test("the scan finds authored lesson visual references in LearnView.jsx", () => {
  assert.ok(referenced.length > 0, "no /cortex/lessons/ visual references found in src/LearnView.jsx");
  for (const p of referenced) {
    assert.ok(p.startsWith("/cortex/lessons/"), `scan picked up a path outside the lesson visuals: ${p}`);
  }
});

for (const p of referenced) {
  await test(`lesson visual is present as a real image: ${p}`, () => {
    const pubPath = join(root, "public", p);
    assert.ok(existsSync(pubPath), `no file at public${p} for the visual referenced in src/LearnView.jsx`);
    const buf = assertRealImage(pubPath, `public${p}`);
    assert.ok(buf.length >= MIN_BYTES,
      `public${p} is only ${buf.length} bytes, under the 10 KB floor for finished art (the shipped Body visuals run 28 to 87 KB)`);
    if (distExists) {
      const distPath = join(root, "dist", p);
      assert.ok(existsSync(distPath), `no file at dist${p} though dist/ exists and public${p} is referenced`);
      assertRealImage(distPath, `dist${p}`);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════
group("Path card pictures: every learning path declares a real picture");

/* Added 2026-10-20 citing the owner photos from 2026-10-20 and his
   order to give paths actual pics. The journey cards on the Paths
   page rendered the Cover fallback, abstract CategoryArt geometry,
   because each LEARNING_PATHS entry carried no img and the journey
   card Cover call passed none. Every path entry must now declare
   an img under /cortex/paths/, the journey card must pass it, and
   each file must exist under public/ with real WEBP magic bytes.
   Flat diagram friezes compress far smaller than lesson photos, so
   this gate uses its own floor: the smallest shipped card is
   6,440 bytes, and the floor sits well under that while still
   catching a stub or an error page saved under an image name. */
const PATH_CARD_MIN_BYTES = 1024;
const pathsStart = learnSrc.indexOf("export const LEARNING_PATHS");
const pathsEnd = learnSrc.indexOf("export const TOPIC_COURSES", pathsStart);
const pathsBlock = pathsStart >= 0 && pathsEnd > pathsStart ? learnSrc.slice(pathsStart, pathsEnd) : "";
const pathEntryIds = [...pathsBlock.matchAll(/\n  \{\n    id: "([^"]+)",/g)].map((m) => m[1]);
const pathCardImgs = [...new Set(
  [...pathsBlock.matchAll(/img:\s*["'](\/cortex\/paths\/[^"']+)["']/g)].map((m) => m[1]),
)].sort();

console.log(`  checking ${pathCardImgs.length} path card pictures for ${pathEntryIds.length} learning paths`);

await test("every learning path declares a path card picture", () => {
  assert.ok(pathEntryIds.length >= 5, `scan found only ${pathEntryIds.length} learning path entries`);
  assert.equal(pathCardImgs.length, pathEntryIds.length,
    `found ${pathCardImgs.length} path card img fields for ${pathEntryIds.length} learning paths`);
  for (const p of pathCardImgs) {
    assert.ok(p.startsWith("/cortex/paths/"), `path card img sits outside /cortex/paths/: ${p}`);
    assert.ok(p.endsWith(".webp"), `path card img is not a WEBP file: ${p}`);
  }
  const entryChunks = pathsBlock.split(/\n  \{\n    id: "/).slice(1);
  assert.equal(entryChunks.length, pathEntryIds.length, "path entry scan split does not match the entry count");
  entryChunks.forEach((chunk, i) => {
    assert.ok(/img:\s*["']\/cortex\/paths\/[^"']+["']/.test(chunk),
      `learning path ${pathEntryIds[i]} declares no img under /cortex/paths/`);
  });
});

await test("the journey card Cover call passes the path picture", () => {
  assert.ok(
    learnSrc.includes("<Cover title={path.title} height={120} radius={0} cat={cat} img={path.img} />"),
    "the journey card Cover call does not pass img={path.img}, so path cards fall back to CategoryArt geometry",
  );
});

for (const p of pathCardImgs) {
  await test(`path card picture is present as a real image: ${p}`, () => {
    const pubPath = join(root, "public", p);
    assert.ok(existsSync(pubPath), `no file at public${p} for the path card picture declared in src/LearnView.jsx`);
    const buf = assertRealImage(pubPath, `public${p}`);
    assert.ok(buf.length >= PATH_CARD_MIN_BYTES,
      `public${p} is only ${buf.length} bytes, under the floor for finished path card art`);
    if (distExists) {
      const distPath = join(root, "dist", p);
      assert.ok(existsSync(distPath), `no file at dist${p} though dist/ exists and public${p} is referenced`);
      assertRealImage(distPath, `dist${p}`);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════
console.log(`\nlesson visual assets: checked ${referenced.length} referenced paths and ${pathCardImgs.length} path card pictures`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
