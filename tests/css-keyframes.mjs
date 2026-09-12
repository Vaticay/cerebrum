/**
 * CSS keyframes integrity — regression test for a real production bug.
 *
 * The bibliography and the video cards use the `.cb-fade` entrance class.
 * A dead-CSS cleanup once deleted `@keyframes cbFade` while `.cb-fade`
 * still referenced it — so the animation named nothing and both sections
 * rendered invisible. The fix: content is visible by default (opacity: 1)
 * and the animation is an enhancement, never a requirement.
 *
 * This test asserts the structural invariant: every cb* animation name
 * referenced anywhere in src/CerebrumApp.jsx (CSS rules AND inline JS
 * style strings) must have a matching @keyframes definition.
 *
 * Run with: node tests/css-keyframes.mjs
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
group("CSS keyframes integrity");

const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");

const defined = new Set([...src.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));

// Animation references appear both in the CSS template (`animation: cbFade
// 180ms …`) and in inline JS style objects (`animation: "cbPeekIn .22s …"`).
// Only cb-prefixed first tokens are keyframe names; anything else is a JS
// conditional, a time value, or `none`.
const referenced = new Set();
for (const m of src.matchAll(/animation(?:-name)?\s*:\s*([^;}\n]+)/g)) {
  const first = m[1].trim().replace(/^[`'"]+/, "").split(/[\s,}]+/)[0].replace(/[`'"]+$/, "");
  if (/^cb/i.test(first)) referenced.add(first);
}

await test("every referenced cb* animation has @keyframes", () => {
  const missing = [...referenced].filter((r) => !defined.has(r));
  assert.deepEqual(missing, [], `animations referenced but never defined: ${missing.join(", ")}`);
});

await test("cbFade exists — the bibliography/video entrance depends on it", () => {
  // .cb-fade uses this animation for its entrance. Content is visible by
  // default (opacity: 1); the animation is an enhancement, not a requirement.
  // If the keyframes go missing again, the entrance simply doesn't play.
  assert.ok(defined.has("cbFade"), "@keyframes cbFade is missing — the entrance animation will not play");
  assert.match(src, /\.cb-fade\s*\{[^}]*animation:\s*cbFade/, ".cb-fade no longer uses the cbFade keyframes");
});

await test("no @keyframes block is defined twice under the same name", () => {
  const names = [...src.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual([...new Set(dupes)], [], `duplicate @keyframes: ${[...new Set(dupes)].join(", ")}`);
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
