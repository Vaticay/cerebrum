/**
 * Specimen-door regression tests.
 *
 * The cinematic intro is a specimen door, not a headline: the first
 * viewport shows ONE verified claim as a museum specimen — the claim in
 * large type, its paper attached, a "traced to a direct finding" verdict —
 * rotating through real published findings. The product demonstrates
 * itself instead of describing itself.
 *
 * These tests lock the invariants of the rethink (2026-10-05):
 *
 *   1. SPECIMENS holds real published findings, each with a claim, a
 *      paper citation, and a DOI link. The old headline and slogan are
 *      gone.
 *   2. Rotation advances on a timer, pauses while the visitor holds the
 *      specimen (hover/focus), while a dialog is open, or under reduced
 *      motion. Dots select specimens directly.
 *   3. The film controls must report the video element's ACTUAL playback
 *      state (media events), never inferred intent — the lying
 *      "paused — tap to play" label came from intent flags.
 *   4. The quiet sci-fi language: focus-pull entrance, small tracked
 *      type, a whisper outline CTA with no light sweep.
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
group("The specimens — real claims, real papers");

const src = await readFile(join(root, "src/intro.jsx"), "utf8");
// Intro CSS keyframes live in the app's global CSS block (CerebrumApp.jsx).
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const cssSrc = src + "\n" + appSrc;

await test("SPECIMENS holds at least three specimens", () => {
  const m = src.match(/const SPECIMENS = \[([\s\S]*?)\n\];/);
  assert.ok(m, "SPECIMENS not defined");
  const claims = (m[1].match(/claim:/g) || []).length;
  assert.ok(claims >= 3, `only ${claims} specimens`);
});

await test("every specimen has a claim, a paper, and a DOI", () => {
  const m = src.match(/const SPECIMENS = \[([\s\S]*?)\n\];/);
  const block = m[1];
  for (const field of ["claim:", "paper:", "doi:"]) {
    const n = (block.match(new RegExp(field, "g")) || []).length;
    assert.ok(n >= 3, `field ${field} appears only ${n} times`);
  }
  assert.ok(block.includes("https://doi.org/"), "no DOI links in specimens");
});

await test("old headline and slogan are gone", () => {
  assert.ok(
    !src.includes("There&rsquo;s a world behind your question."),
    "old headline still present"
  );
  assert.ok(
    !src.includes("Ask a real research question. Every claim traces to a paper you can open."),
    "old slogan still present"
  );
});

await test("verdict line marks each claim as traced", () => {
  assert.ok(src.includes("Traced to a direct finding"), "verdict line missing");
});

await test("single CTA reads \"Start researching\"", () => {
  assert.ok(src.includes("Start researching"), "CTA text missing");
});

// ══════════════════════════════════════════════════════════════════════════
group("Rotation — timed, pausable, directly selectable");

await test("rotation advances on a 9s interval", () => {
  assert.ok(src.includes("setInterval(() => setSpecimenIdx"), "no rotation interval");
  assert.ok(src.includes("9000"), "rotation interval not 9s");
});

await test("rotation pauses while held, in dialogs, or under reduced motion", () => {
  assert.ok(src.includes("specimenHeld"), "hold state missing");
  assert.ok(src.includes("setSpecimenHeld(true)"), "hover/focus hold not wired");
  // The effect bails when held, when any dialog is open, or under reduced motion.
  const eff = src.slice(src.indexOf("const [specimenIdx, setSpecimenIdx]"), src.indexOf("const specimen = SPECIMENS"));
  assert.ok(eff.includes("specimenHeld || howOpen || sourcesOpen || creditsOpen"), "pause conditions incomplete");
  assert.ok(eff.includes("reduced"), "reduced-motion bail missing");
});

await test("dots select specimens directly", () => {
  assert.ok(src.includes('role="tablist"'), "dots tablist missing");
  assert.ok(src.includes("onClick={() => setSpecimenIdx(i)}"), "dot selection not wired");
});

await test("specimen change has its own entrance animation", () => {
  assert.ok(cssSrc.includes("@keyframes cbSpecimenIn"), "specimen keyframes missing");
  assert.ok(cssSrc.includes("cb-specimen-in"), "specimen entrance class missing");
});

// ══════════════════════════════════════════════════════════════════════════
group("Removals — the intro is a specimen, not an information stack");

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

await test("the old worked-example section is gone — the specimen is the example", () => {
  assert.ok(!src.includes("A real answer"), "old worked-example section still present");
  assert.ok(!src.includes("Do we have direct evidence of gravitational waves?"), "old example question still present");
});

// ══════════════════════════════════════════════════════════════════════════
group("Playback truth — labels follow the video element, not intent flags");

await test("CinematicFilm listens to real media events", () => {
  assert.ok(cssSrc.includes('addEventListener("playing"'), "no playing listener");
  assert.ok(cssSrc.includes('addEventListener("pause"'), "no pause listener");
  assert.ok(cssSrc.includes('addEventListener("play"'), "no play listener");
});

await test("playback state is reported to the parent via onPlaybackChange", () => {
  assert.ok(cssSrc.includes("onPlaybackChange"), "onPlaybackChange not wired");
  assert.ok(src.includes("onPlaybackChange={setFilmPlaying}"), "parent not receiving playback state");
  assert.ok(cssSrc.includes("reportPlaying"), "no element-state reporter in the reel");
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
  assert.ok(cssSrc.includes("@keyframes cbFocusIn"), "cbFocusIn not defined");
  const kf = cssSrc.slice(cssSrc.indexOf("@keyframes cbFocusIn"), cssSrc.indexOf("@keyframes cbFocusIn") + 200);
  assert.ok(kf.includes("blur("), "focus-pull does not use blur");
  assert.ok(!kf.includes("translate"), "focus-pull must not move the type");
});

await test("hero text uses a premium entrance (focus-pull or specimen-in)", () => {
  assert.ok(src.includes('"cb-focus-in"') || src.includes('"cb-specimen-in"'), "no premium entrance applied to hero text");
});

await test("old fade-and-rise entrance is fully gone", () => {
  assert.ok(!src.includes("cb-title-in"), "cb-title-in class still referenced");
  assert.ok(!src.includes("cbTitleIn"), "cbTitleIn keyframes still referenced");
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
  assert.ok(cssSrc.includes(".cb-focus-in { animation: none; }"), "reduced-motion override missing");
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
