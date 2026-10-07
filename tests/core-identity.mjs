/**
 * core-identity tests: Dusty's 2026-09-17 direction — the videos, the
 * search atmosphere, and the existing character are the site's core
 * identity. The redesign must layer onto Cerebrum, not hollow it out.
 *
 * These pin the restoration: the workspace film reel, the generated-field
 * fallback, the intro handoff, the grain, the app-level film controls,
 * animated typing, the full-viewport particle atmosphere, and Document
 * Mode's own film layer.
 *
 * Static assertions against the real sources — no server, no network.
 *
 * Run with: node tests/core-identity.mjs
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

const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const introSrc = await readFile(join(root, "src/intro.jsx"), "utf8");
const diveSrc = await readFile(join(root, "src/DiveParticles.jsx"), "utf8");
const settingsSrc = await readFile(join(root, "src/settings.jsx"), "utf8");
const designSrc = await readFile(join(root, "src/designSystem.jsx"), "utf8");

group("Workspace ambient reel (revised)");
await test("workspace CinematicFilm mount exists, darker than before", () => {
  const mounts = (appSrc.match(/<CinematicFilm/g) || []).concat(introSrc.match(/<CinematicFilm/g) || []);
  assert.strictEqual(mounts.length, 2, `expected intro + workspace mounts, found ${mounts.length}`);
  assert.match(appSrc, /started \? 0\.16/, "reading intensity should be 0.16 (darker)");
  assert.match(appSrc, /brightness\(0\.72\)/, "extra CSS grade missing on the workspace reel wrapper");
});
await test("generated field is the fallback when film is blocked", () => {
  assert.match(appSrc, /<CerebrumFieldCanvas/, "CerebrumFieldCanvas mount missing");
});
await test("grain overlay is restored", () => {
  assert.match(appSrc, /grain: \{ position: "fixed"/, "S.grain style missing");
  assert.match(appSrc, /<div style=\{S\.grain\} \/>/, "grain div missing from the shell");
});

group("Intro-to-workspace handoff");
await test("onEnter carries the intro clip as a dissolving still", () => {
  assert.match(appSrc, /setEnterClip\(clipSrc\)/, "enterClip handoff missing from onEnter");
  assert.match(appSrc, /cb-enter-frame/, "handoff still CSS missing");
});

group("App-level film controls");
await test("footer exposes Film credits, no background toggle", () => {
  assert.match(appSrc, /\["credits", "Film credits"\]/, "Film credits footer entry missing");
  assert.ok(!/\["motion",/.test(appSrc), "dead background toggle still in the workspace footer");
  assert.match(appSrc, /setFilmCreditsOpen\(true\)/, "credits dialog opener missing");
});
await test("film credits dialog mounts from the shell", () => {
  assert.match(appSrc, /\{filmCreditsOpen && <FilmCreditsDialog/, "FilmCreditsDialog shell mount missing");
});

group("Animated typing");
await test("typewriter state persists in the cb_tw cookie", () => {
  assert.match(appSrc, /getCookie\("cb_tw"\)/, "typewriter cookie read missing");
  assert.match(appSrc, /setCookie\("cb_tw", typewriter \? "1" : "0"\)/, "typewriter cookie write missing");
});
await test("TurnInner reveals fresh answers through the typewriter", () => {
  assert.match(appSrc, /const shown = useTypewriter\(t\.answer, typewriter && t\.fresh\)/, "typewriter wiring missing");
  assert.match(appSrc, /const done = synthFailed \? true : shown === t\.answer/, "`done` does not follow the reveal");
});
await test("new turns are marked fresh so typing runs once", () => {
  assert.match(appSrc, /const nt = \{ id: turnId, fresh: true,/, "fresh flag missing on new turns");
});
await test("Settings exposes the Animated typing row", () => {
  // Settings UI lives in src/settings.jsx after the monolith split.
  assert.match(settingsSrc, /label="Animated typing"/, "Animated typing settings row missing");
  assert.match(settingsSrc, /\["Animated typing", "answers", "typewriter reveal progressive"\]/, "settings-search index entry missing");
});

group("Particle atmosphere");
await test("DiveParticles keeps the 190-particle three-layer field", () => {
  assert.match(diveSrc, /const COUNT = 190/, "particle count changed");
  assert.match(diveSrc, /LAYERS = \[/, "depth layers missing");
  const layers = diveSrc.match(/\{ r: [\d.]+, speed: [\d.]+, alpha: [\d.]+, sway: [\d.]+ \}/g) || [];
  assert.strictEqual(layers.length, 3, `expected 3 depth layers, found ${layers.length}`);
});
await test("the field becomes the full-viewport flight atmosphere", () => {
  assert.match(appSrc, /cb-dive-atmosphere/, "atmosphere layer missing");
  // Z-index scale (Z.base=0, Z.content=1) replaced the literal z-index values;
  // the stacking contract is unchanged.
  assert.match(designSrc, /base: 0,/, "Z.base is not 0");
  assert.match(designSrc, /content: 1,/, "Z.content is not 1");
  assert.match(appSrc, /from "\.\/designSystem\.jsx"/, "Z scale not imported");
  assert.match(appSrc, /\.cb-dive-atmosphere \{\s*position: fixed; inset: 0; z-index: \$\{Z\.base\};/, "atmosphere is not a fixed full-viewport layer");
  assert.match(appSrc, /position: relative; z-index: \$\{Z\.content\};/, "room content does not stack above the atmosphere");
});

group("Document Mode is quiet");
await test("Document Mode has no film layer", () => {
  assert.ok(!/src=\{DOC_FILM_SRC\}/.test(appSrc), "Document Mode film mount still present");
  assert.match(appSrc, /2026-10-05: Document Mode's own film is gone/, "quiet-document note missing");
});

group("Slogan");
await test("slogan is byte-identical", () => {
  // 2026-10-05: the specimen door rethink removed the marketing slogan.
  // The promise now lives in the specimen verdict and the paper links.
  assert.ok(
    introSrc.includes("Traced to a direct finding"),
    "specimen verdict missing"
  );
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
