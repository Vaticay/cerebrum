/**
 * Live-favicon tests: the dynamic tab icon in src/CerebrumApp.jsx.
 *
 * The favicon is redrawn from a canvas so the tab reflects app activity
 * (activity arc while searching, unread inbox badge, accent-tinted mark).
 * These tests pin the badge logic (evaluating the real function extracted
 * from source), the hook wiring, the motion/visibility guards, and the
 * modernized static favicon assets.
 *
 * Run with: node tests/favicon.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");

let passed = 0;
let failed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
};

// Evaluate the REAL liveFaviconBadge from source, not a copy.
const badgeSrc = appSrc.match(/function liveFaviconBadge\(unread\) \{[\s\S]*?\n\}/);
assert.ok(badgeSrc, "liveFaviconBadge not found in src/CerebrumApp.jsx");
const liveFaviconBadge = new Function(`${badgeSrc[0]}; return liveFaviconBadge;`)();

t("badge: zero / negative / missing -> null (no badge drawn)", () => {
  assert.equal(liveFaviconBadge(0), null);
  assert.equal(liveFaviconBadge(-4), null);
  assert.equal(liveFaviconBadge(undefined), null);
  assert.equal(liveFaviconBadge(null), null);
});

t("badge: 1..9 -> digit string", () => {
  assert.equal(liveFaviconBadge(1), "1");
  assert.equal(liveFaviconBadge(5), "5");
  assert.equal(liveFaviconBadge(9), "9");
});

t("badge: 10+ caps at 9+", () => {
  assert.equal(liveFaviconBadge(10), "9+");
  assert.equal(liveFaviconBadge(137), "9+");
});

t("hook defined with { accent, busy, unread } signature", () => {
  assert.match(appSrc, /function useDynamicFavicon\(\{ accent, busy, unread \}\)/);
});

t("hook wired in App with busy + unread thread count", () => {
  assert.match(appSrc, /useDynamicFavicon\(\{ accent, busy, unread: threads\.filter\(\(t\) => t\.unread\)\.length \}\);/);
});

t("animation loop runs only while busy", () => {
  assert.match(appSrc, /const shouldRun = bz && !reduceMotion\(\) && !document\.hidden;/);
  assert.match(appSrc, /requestAnimationFrame\(loop\)/);
});

t("honours prefers-reduced-motion", () => {
  assert.match(appSrc, /prefers-reduced-motion/);
});

t("pauses when tab hidden (visibilitychange)", () => {
  assert.match(appSrc, /visibilitychange/);
});

t("live link tagged data-live so the static SVG stays as fallback", () => {
  assert.match(appSrc, /data-live/);
});

t("brain paths mirror the Mark logo paths exactly", () => {
  const left = "M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 7.5 11a2.5 2.5 0 0 1 0-4.12A2.5 2.5 0 0 1 9.5 2Z";
  const right = "M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 16.5 11a2.5 2.5 0 0 0 0-4.12A2.5 2.5 0 0 0 14.5 2Z";
  assert.ok(appSrc.includes(`FAVICON_BRAIN_L = "${left}"`), "left hemisphere path drifted from the logo");
  assert.ok(appSrc.includes(`FAVICON_BRAIN_R = "${right}"`), "right hemisphere path drifted from the logo");
});

t("flat favicon.svg present (solid mark, no gradients, no bloom, transparent)", () => {
  const svg = readFileSync(join(root, "public/favicon.svg"), "utf8");
  assert.match(svg, /viewBox="0 0 64 64"/);
  assert.ok(!/linearGradient|radialGradient/.test(svg), "favicon must not use gradients");
  assert.ok(!/cb-bloom|feGaussianBlur|shadow/.test(svg), "favicon must not use bloom/glow filters");
  assert.ok(!/<rect/.test(svg), "favicon must not paint a background tile");
});

t("png fallbacks exist: 32px + apple-touch-icon 180px", () => {
  assert.ok(existsSync(join(root, "public/favicon-32x32.png")), "favicon-32x32.png missing");
  assert.ok(existsSync(join(root, "public/apple-touch-icon.png")), "apple-touch-icon.png missing");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
