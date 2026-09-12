/**
 * Intro title-card regression tests.
 *
 * The cinematic intro is a quiet sci-fi title card, not an information
 * stack: full-bleed footage first, then a slow focus-pull sequence —
 * kicker → title → slogan → single CTA — each layer resolving from soft
 * blur to sharp, like a lens finding focus. Type is small and tracked,
 * monumental through restraint.
 *
 * These tests lock the invariants that broke in earlier shipped intros:
 *
 *   1. The exact slogan ("Ask a real research question. Every claim
 *      traces to a paper you can open.") must appear in the hero, word
 *      for word. The generic sub-copy it replaced must be gone.
 *   2. The film controls must report the video element's ACTUAL playback
 *      state (media events), never inferred intent — the lying
 *      "paused — tap to play" label came from intent flags.
 *   3. The quiet sci-fi language: focus-pull entrance (blur, never a
 *      rise), small tracked type, a whisper outline CTA with no light
 *      sweep — and none of the old oversized display treatment.
 *
 * They also lock the removals: no pointer parallax, no rotating scene
 * questions, no scene indexes, no explore links.
 *
 * Run with: node tests/intro-title-card.mjs
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
group("The slogan, word for word");

const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const SLOGAN = "Ask a real research question. Every claim traces to a paper you can open.";

await test("exact slogan appears in the source", () => {
  assert.ok(src.includes(SLOGAN), "slogan missing or altered");
});

await test("generic sub-copy it replaced is gone", () => {
  assert.ok(
    !src.includes("Explore scientific papers. Follow the evidence. Find your next question."),
    "old generic hero copy still present"
  );
});

await test("title is one quiet line, not a display shout", () => {
  assert.ok(
    src.includes("There&rsquo;s a world behind your question."),
    "single-line title missing"
  );
});

await test("single CTA reads \"Start researching\"", () => {
  assert.ok(src.includes("Start researching"), "CTA text missing");
});

// ══════════════════════════════════════════════════════════════════════════
group("Removals — the intro is a title card, not an information stack");

await test("no pointer parallax anywhere in the intro", () => {
  assert.ok(!src.includes("heroColRef"), "parallax ref still referenced");
  assert.ok(!src.includes("cb-hero-enter"), "old hero entrance class still referenced");
});

await test("no rotating scene-question machinery", () => {
  assert.ok(!src.includes("cb-intro-scene"), "scene prompt class still referenced");
  assert.ok(!src.includes("scene.question"), "scene question lookup still referenced");
  assert.ok(!src.includes("Explore this question"), "explore link still present");
  assert.ok(!src.includes("sceneNo"), "editorial plate number still referenced");
});

// ══════════════════════════════════════════════════════════════════════════
group("Playback truth — labels follow the video element, not intent flags");

await test("CinematicFilm listens to real media events", () => {
  assert.ok(src.includes('addEventListener("playing"'), "no playing listener");
  assert.ok(src.includes('addEventListener("pause"'), "no pause listener");
  assert.ok(src.includes('addEventListener("play"'), "no play listener");
});

await test("playback state is reported to the parent via onPlaybackChange", () => {
  assert.ok(src.includes("onPlaybackChange"), "onPlaybackChange not wired");
  assert.ok(src.includes("onPlaybackChange={setFilmPlaying}"), "parent not receiving playback state");
  assert.ok(src.includes("reportPlaying"), "no element-state reporter in the reel");
});

await test("no inferred autoplay-blocked flag survives", () => {
  assert.ok(!src.includes("autoplayBlocked"), "inferred autoplay flag still present");
});

await test("footer label reads actual playback state", () => {
  assert.ok(
    src.includes('{filmPlaying ? "Pause background" : "Play background"}'),
    "footer label not driven by filmPlaying"
  );
});

await test("tap-to-play pill only renders when the element is actually paused", () => {
  assert.ok(
    src.includes("{filmRunning && vetoed && !filmPlaying && ("),
    "pill condition does not require actual paused state"
  );
});

await test("intro reel dwells longer than the old 11s cut", () => {
  assert.ok(src.includes("holdMs={18000}"), "intro holdMs not set to the slower dwell");
});

// ══════════════════════════════════════════════════════════════════════════
group("Quiet sci-fi — focus-pull entrance, small type, whisper CTA");

await test("focus-pull keyframes exist and resolve blur to sharp", () => {
  assert.ok(src.includes("@keyframes cbFocusIn"), "cbFocusIn not defined");
  const kf = src.slice(src.indexOf("@keyframes cbFocusIn"), src.indexOf("@keyframes cbFocusIn") + 200);
  assert.ok(kf.includes("blur("), "focus-pull does not use blur");
  assert.ok(!kf.includes("translate"), "focus-pull must not move the type");
});

await test("hero text uses the focus-pull entrance", () => {
  assert.ok(src.includes('"cb-focus-in"'), "cb-focus-in not applied to hero text");
});

await test("old fade-and-rise entrance is fully gone", () => {
  assert.ok(!src.includes("cb-title-in"), "cb-title-in class still referenced");
  assert.ok(!src.includes("cbTitleIn"), "cbTitleIn keyframes still referenced");
});

await test("title type is small, light, and tracked — not a display face", () => {
  assert.ok(src.includes('clamp(28px, 3.6vw, 46px)'), "desktop title scale not the quiet size");
  assert.ok(src.includes('clamp(24px, 7vw, 34px)'), "mobile title scale not the quiet size");
  assert.ok(!src.includes("clamp(58px, 8.6vw, 118px)"), "old oversized desktop title still present");
  assert.ok(!src.includes("clamp(46px, 13.5vw, 78px)"), "old oversized mobile title still present");
});

await test("kicker is tiny tracked caps", () => {
  assert.ok(src.includes('letterSpacing: "0.42em"'), "kicker tracking not at the tiny-caps scale");
});

await test("CTA is a whisper outline, not a chunky pill", () => {
  assert.ok(!src.includes("cb-intro-go::after"), "CTA light sweep still present");
  assert.ok(
    !src.includes("0 14px 34px rgba(163,184,153,0.30)"),
    "old chunky sage CTA shadow still present"
  );
  assert.ok(src.includes('textTransform: "uppercase"'), "CTA not set as tracked caps");
});

await test("reduced motion kills the focus-pull", () => {
  assert.ok(src.includes(".cb-focus-in { animation: none; }"), "reduced-motion override missing");
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
