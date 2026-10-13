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
const appUtilsSrc = await readFile(join(root, "src/appUtils.js"), "utf8");
const palettesSrc = await readFile(join(root, "src/palettes.js"), "utf8");
const inboxSrc = await readFile(join(root, "src/inbox.jsx"), "utf8");

group("Workspace ambient reel (revised)");
await test("workspace CinematicFilm mount exists, darker than before", () => {
  // 2026-10-08: three mounts (intro reel, calm reel, workspace backdrop).
  // 2026-10-13 plate redesign superseded the intro mount: the door is
  // the DotField now, so two mounts remain (calm reel on the search
  // backdrop, workspace backdrop). The component itself is unchanged.
  const mounts = (appSrc.match(/<CinematicFilm/g) || []).concat(introSrc.match(/<CinematicFilm/g) || []);
  assert.strictEqual(mounts.length, 2, `expected calm+workspace mounts, found ${mounts.length}`);
  const introFn = introSrc.slice(introSrc.indexOf("function Intro({"), introSrc.indexOf("function CerebrumFieldCanvas"));
  assert.ok(!introFn.includes("<CinematicFilm"), "the intro mounts the film reel again");
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
await test("TurnInner reveals fresh answers through answer assembly", () => {
  // 2026-10-08: Answer Assembly replaced the typewriter with paragraph stagger.
  assert.match(appSrc, /useAnswerAssembly/, "answer assembly wiring missing");
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
  // 2026-10-08: The Dive is the loading language (cb-dive).
  assert.match(appSrc, /cb-dive/, "dive layer missing");
  assert.match(appSrc, /function Dive\(/, "Dive component missing");
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

group("Status colors: light theme variants clear 4.5:1");
{
  // 2026-10-13: the rescore panel's standing Mobile/A11y defect. The raw
  // STATUS warn (#d9a520, 2.13:1) and good (#10b981, 2.41:1) fail WCAG
  // text contrast on the Light palette; bad already had a light variant
  // via statusBad in appUtils.js, warn and good now mirror it.
  const relLum = (hex) => {
    const c = (v) => { const n = parseInt(v, 16) / 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); };
    return 0.2126 * c(hex.slice(1, 3)) + 0.7152 * c(hex.slice(3, 5)) + 0.0722 * c(hex.slice(5, 7));
  };
  const ratio = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const statusM = designSrc.match(/export const STATUS = \{ good: "(#[0-9a-f]{6})", warn: "(#[0-9a-f]{6})", bad: "(#[0-9a-f]{6})" \}/);
  const lightM = palettesSrc.match(/Light: \{ dark: false, bg: "(#[0-9a-f]{6})", surface: "(#[0-9a-f]{6})", raised: "(#[0-9a-f]{6})"/);
  const darkM = palettesSrc.match(/Dark:\s+\{ dark: true,\s+bg: "(#[0-9a-f]{6})", surface: "(#[0-9a-f]{6})"/);
  const midM = palettesSrc.match(/Mid:\s+\{ dark: true,\s+bg: "(#[0-9a-f]{6})", surface: "(#[0-9a-f]{6})"/);
  const warnLightM = appUtilsSrc.match(/function statusWarn\(P\) \{\s*return P\.dark \? STATUS\.warn : "(#[0-9a-f]{6})";\s*\}/);
  const goodLightM = appUtilsSrc.match(/function statusGood\(P\) \{\s*return P\.dark \? STATUS\.good : "(#[0-9a-f]{6})";\s*\}/);
  const badLightM = appUtilsSrc.match(/function statusBad\(P, pn\) \{\s*return P\.dark \? \(pn === "Mid" \? "#ff7a7a" : STATUS\.bad\) : "(#[0-9a-f]{6})";\s*\}/);

  await test("raw STATUS hues are unchanged", () => {
    assert.ok(statusM, "STATUS definition not found in designSystem.jsx");
    assert.deepStrictEqual(statusM.slice(1), ["#10b981", "#d9a520", "#e5484d"]);
  });
  await test("statusWarn and statusGood mirror statusBad and are exported", () => {
    assert.ok(badLightM, "statusBad no longer matches its established shape");
    assert.ok(warnLightM, "statusWarn(P) must return STATUS.warn on dark and a light hex otherwise");
    assert.ok(goodLightM, "statusGood(P) must return STATUS.good on dark and a light hex otherwise");
    assert.match(appUtilsSrc, /export \{[^}]*statusBad, statusWarn, statusGood,[^}]*\}/, "helpers missing from the appUtils export list");
    assert.match(appSrc, /statusBad, statusWarn, statusGood,/, "CerebrumApp does not import the status helpers");
    assert.match(settingsSrc, /statusBad, statusWarn, statusGood,/, "settings does not import the status helpers");
    assert.match(inboxSrc, /statusBad, statusGood \} from "\.\/appUtils\.js"/, "inbox does not import statusGood");
  });
  await test("light variants clear 4.5:1 on every Light surface; raw hues fail", () => {
    assert.ok(lightM, "Light palette surfaces not found in palettes.js");
    const surfaces = lightM.slice(1);
    for (const [name, m] of [["warn", warnLightM], ["good", goodLightM], ["bad", badLightM]]) {
      assert.ok(m, `status ${name} light variant missing`);
      for (const s of surfaces) {
        assert.ok(ratio(m[1], s) >= 4.5, `${name} light variant ${m[1]} is ${ratio(m[1], s).toFixed(2)}:1 on light surface ${s}`);
      }
    }
    // The defect itself, pinned so the helpers are never "simplified" away:
    assert.ok(ratio(statusM[2], surfaces[1]) < 4.5, "raw warn should still fail on the light surface");
    assert.ok(ratio(statusM[1], surfaces[1]) < 4.5, "raw good should still fail on the light surface");
  });
  await test("dark surfaces keep the raw hues at passing contrast (no regression)", () => {
    assert.ok(darkM && midM, "Dark/Mid palette surfaces not found in palettes.js");
    for (const s of [...darkM.slice(1), ...midM.slice(1)]) {
      assert.ok(ratio(statusM[2], s) >= 4.5, `raw warn is ${ratio(statusM[2], s).toFixed(2)}:1 on dark surface ${s}`);
      assert.ok(ratio(statusM[1], s) >= 4.5, `raw good is ${ratio(statusM[1], s).toFixed(2)}:1 on dark surface ${s}`);
    }
  });
  await test("foreground status text routes through the helpers", () => {
    for (const [name, src] of [["CerebrumApp", appSrc], ["settings", settingsSrc], ["inbox", inboxSrc]]) {
      assert.ok(!/color: STATUS\.(warn|good)/.test(src), `${name} still sets a foreground color from raw STATUS`);
    }
    assert.match(appSrc, /tone === "warn" \? statusWarn\(P\)/, "toneColor does not route warn through statusWarn");
    assert.match(appSrc, /const relColor = \(r\) => r >= 65 \? statusGood\(P\)/, "relColor does not route through the helpers");
    assert.match(settingsSrc, /st === "ok" \? statusGood\(P\)/, "settings tone() does not route through the helpers");
    assert.match(settingsSrc, /statusPill\("Locked", statusWarn\(P\)\)/, "Locked pill does not route warn through statusWarn");
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
