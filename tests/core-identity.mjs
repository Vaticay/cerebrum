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
const diveSrc = await readFile(join(root, "src/DiveParticles.jsx"), "utf8");

group("Workspace film reel");
await test("workspace CinematicFilm mount exists", () => {
  const mounts = appSrc.match(/<CinematicFilm/g) || [];
  assert.strictEqual(mounts.length, 2, `expected intro + workspace mounts, found ${mounts.length}`);
});
await test("film intensity is state-aware (brightest on search, dimmest reading)", () => {
  assert.match(appSrc, /started \? 0\.28/, "reading intensity missing");
  assert.match(appSrc, /\(view && view !== "search"\) \? 0\.34/, "working-view intensity missing");
  assert.match(appSrc, /composerFocused \? 0\.40/, "composer-focus intensity missing");
});
await test("workspace reel unmounts in Document Mode", () => {
  assert.match(appSrc, /\{view !== "document" && \(filmBlocked\(animationMode, false\)/, "document-mode reel guard missing");
});
await test("generated field is the fallback when film is blocked", () => {
  assert.match(appSrc, /<CerebrumFieldCanvas/, "CerebrumFieldCanvas mount missing");
  assert.match(appSrc, /function CerebrumFieldCanvas\(/, "CerebrumFieldCanvas component missing");
  assert.match(appSrc, /from "\.\/cerebrumField\.js"/, "cerebrumField.js import missing");
});
await test("grain overlay is restored", () => {
  assert.match(appSrc, /grain: \{ position: "fixed"/, "S.grain style missing");
  assert.match(appSrc, /<div style=\{S\.grain\} \/>/, "grain div missing from the shell");
});

group("Intro-to-workspace handoff");
await test("onEnter carries the intro clip into the workspace", () => {
  assert.match(appSrc, /setEnterClip\(clipSrc\)/, "enterClip handoff missing from onEnter");
  assert.match(appSrc, /startAt=\{enterClip\}/, "workspace reel does not open on the handoff clip");
  assert.match(appSrc, /cb-enter-frame/, "handoff still CSS missing");
});

group("App-level film controls");
await test("footer exposes Film credits and background play/pause", () => {
  assert.match(appSrc, /\["credits", "Film credits"\]/, "Film credits footer entry missing");
  assert.match(appSrc, /\["motion", filmMotion \? "Pause background" : "Play background"\]/, "motion toggle footer entry missing");
  assert.match(appSrc, /setFilmCreditsOpen\(true\)/, "credits dialog opener missing");
  assert.match(appSrc, /filmRef\.current\?\.playNow\(\)/, "play control does not resume through the reel ref");
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
  assert.match(appSrc, /label="Animated typing"/, "Animated typing settings row missing");
  assert.match(appSrc, /\["Animated typing", "answers", "typewriter reveal progressive"\]/, "settings-search index entry missing");
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
  assert.match(appSrc, /\.cb-dive-atmosphere \{\s*position: fixed; inset: 0; z-index: 0;/, "atmosphere is not a fixed full-viewport layer");
  assert.match(appSrc, /position: relative; z-index: 1;\n\}/, "room content does not stack above the atmosphere");
});

group("Document Mode film");
await test("Document Mode keeps its own single FilmLayer", () => {
  assert.match(appSrc, /const DOC_FILM_SRC = "\/assets\/cinematic\/science-66\.mp4"/, "DOC_FILM_SRC missing");
  assert.match(appSrc, /src=\{DOC_FILM_SRC\}/, "Document Mode film mount missing");
  assert.match(appSrc, /filmOK=\{!filmBlocked\(animationMode, false\)\}/, "filmOK not passed to the document page");
});

group("Slogan");
await test("slogan is byte-identical", () => {
  assert.ok(
    appSrc.includes("Ask a real research question. Every claim traces to a paper you can open."),
    "slogan wording changed"
  );
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
