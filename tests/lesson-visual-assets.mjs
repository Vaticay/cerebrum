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
console.log(`\nlesson visual assets: checked ${referenced.length} referenced paths`);
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
