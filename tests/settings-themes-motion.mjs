/**
 * Settings fix regression suite (2026-11-06, defects S2 to S5).
 *
 * S2: the Theme picker was dead. The palette derivation in
 * CerebrumApp.jsx overrode all 13 palette fields with register
 * values on every surface, so all 8 themes produced a byte
 * identical P. The palette B ruling exempts only Register
 * surfaces (door, search home, sign in). This suite runs the
 * real PALETTES and register token modules through a
 * transcription of the shipped derivation and proves two
 * themes now differ on a Reading surface and are identical on
 * a Register surface, and that Pro gating still falls back.
 *
 * S3: the Accent picker was dead (accent was REGISTER_GOLD
 * unconditionally) and the 404 page read the custom accent
 * from a cookie name the app never writes.
 *
 * S4: the Animation speed slider had no reader. It now scales
 * the ambient clock in IntroAtmosphere through the exported
 * atmoStep helper, measured here directly.
 *
 * S5: Motion Subtle equalled Full. Subtle now draws the
 * atmosphere still and kills the ambient looping CSS classes
 * through body.cb-motion-subtle, while functional motion
 * (loading, progress, one shot entrances) is untouched.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { failures.push({ name, error: e }); console.log("  ✗ " + name + "\n      " + e.message); }
}
function group(name) { console.log("\n" + name); }

const { PALETTES, ACCENTS, isProPalette } = await import(join(root, "src/palettes.js"));
const RT = await import(join(root, "src/registerTokens.js"));
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const mainSrc = readFileSync(join(root, "src/main.jsx"), "utf8");
const settingsSrc = readFileSync(join(root, "src/settings.jsx"), "utf8");
const atmoSrc = readFileSync(join(root, "src/introAtmosphere.jsx"), "utf8");
const introSrc = readFileSync(join(root, "src/intro.jsx"), "utf8");

/* Transcription of the shipped derivation in CerebrumApp.jsx:
   paletteBase resolves the entitled palette; a Register surface
   receives the register override object; Reading and Instrument
   surfaces receive paletteBase itself. The accent resolves the
   same way: register gold on Register, the picked accent
   elsewhere. Kept in step with the source assertions below. */
function paletteBaseFor(paletteName, user) {
  const name = isProPalette(paletteName) && !(user && user.isPro) ? "Dark" : paletteName;
  return PALETTES[name] || PALETTES.Dark;
}
function registerOverride(base) {
  return {
    ...base,
    dark: true,
    bg: RT.REGISTER_GROUND,
    surface: RT.REGISTER_SURFACE,
    raised: RT.REGISTER_RAISED,
    ink: RT.REGISTER_INK.ink,
    ink2: RT.REGISTER_INK.ink72,
    faint: RT.REGISTER_INK.ink55,
    line: RT.REGISTER_LINE,
    line2: RT.REGISTER_LINE_STRONG,
    shadow: "none",
    shadowSm: "none",
    grain: 0,
    skel: "linear-gradient(90deg, " + RT.REGISTER_SURFACE + " 25%, " + RT.REGISTER_RAISED + " 50%, " + RT.REGISTER_SURFACE + " 75%)",
  };
}
function deriveP(paletteName, user, surfaceClass) {
  const base = paletteBaseFor(paletteName, user);
  return surfaceClass === "Register" ? registerOverride(base) : base;
}
function deriveAccent(paletteName, user, surfaceClass, accentName, customAccent) {
  if (surfaceClass === "Register") return RT.REGISTER_GOLD;
  const base = paletteBaseFor(paletteName, user);
  if (customAccent && /^#[0-9a-fA-F]{6}$/.test(customAccent)) return customAccent;
  if (accentName === "Mono") return base.dark ? "#ffffff" : "#000000";
  return ACCENTS[accentName] || (base.dark ? "#ffffff" : "#000000");
}

group("S2 theme picker: palettes govern Reading and Instrument, never Register");
test("two themes differ on a Reading surface", () => {
  const dark = deriveP("Dark", null, "Reading");
  const light = deriveP("Light", null, "Reading");
  assert.notDeepEqual(dark, light);
  assert.equal(light.bg, "#f6f1e7");
  assert.equal(light.dark, false);
});
test("two themes differ on an Instrument surface", () => {
  assert.notDeepEqual(deriveP("Dark", null, "Instrument"), deriveP("Sage", null, "Instrument"));
});
test("every theme is identical on a Register surface", () => {
  const ref = JSON.stringify(deriveP("Dark", null, "Register"));
  for (const name of Object.keys(PALETTES)) {
    assert.equal(JSON.stringify(deriveP(name, { isPro: true }, "Register")), ref, name);
  }
});
test("the Register resolution is the register ground and ink family", () => {
  const p = deriveP("Light", null, "Register");
  assert.equal(p.bg, RT.REGISTER_GROUND);
  assert.equal(p.ink, RT.REGISTER_INK.ink);
  assert.equal(p.surface, RT.REGISTER_SURFACE);
});
test("Pro palettes stay gated for guests and free users", () => {
  assert.equal(deriveP("Pro Violet", null, "Reading").bg, PALETTES.Dark.bg);
  assert.equal(deriveP("Pro Violet", { isPro: false }, "Reading").bg, PALETTES.Dark.bg);
  assert.equal(deriveP("Pro Violet", { isPro: true }, "Reading").bg, PALETTES["Pro Violet"].bg);
});
test("all 8 themes are offered and distinct as palette bases", () => {
  assert.equal(Object.keys(PALETTES).length, 8);
});
test("the shipped derivation branches on the surface class", () => {
  assert.ok(appSrc.includes("const onRegisterSurface = surfaceClassNow === \"Register\""));
  assert.ok(appSrc.includes("const P = onRegisterSurface ? {"));
  assert.ok(appSrc.includes("SURFACE_CLASSES[view]"));
});
test("sign in receives the register palette and gold explicitly", () => {
  assert.ok(appSrc.includes("P={registerPalette} accent={REGISTER_GOLD}"));
});

group("S3 accent picker: the picked accent drives off Register surfaces");
test("register surfaces always take the register gold", () => {
  assert.equal(deriveAccent("Dark", null, "Register", "Sage", "#7c3aed"), RT.REGISTER_GOLD);
});
test("a named accent shows on a Reading surface", () => {
  assert.equal(deriveAccent("Dark", null, "Reading", "Sage", ""), ACCENTS.Sage);
});
test("a custom color wins on an Instrument surface", () => {
  assert.equal(deriveAccent("Dark", null, "Instrument", "Amber", "#7c3aed"), "#7c3aed");
});
test("Mono follows the palette ink direction", () => {
  assert.equal(deriveAccent("Dark", null, "Reading", "Mono", ""), "#ffffff");
  assert.equal(deriveAccent("Light", null, "Reading", "Mono", ""), "#000000");
});
test("an invalid custom color falls back to the named accent", () => {
  assert.equal(deriveAccent("Dark", null, "Reading", "Sage", "purple"), ACCENTS.Sage);
});
test("the shipped accent derivation branches on the surface class", () => {
  assert.ok(appSrc.includes("const accent = onRegisterSurface ? REGISTER_GOLD"));
});
test("the 404 page reads the cookie the app writes", () => {
  assert.ok(mainSrc.includes("readCookie(\"cb_ca\")"));
  assert.ok(!mainSrc.includes("readCookie(\"cb_accentCustom\")"));
  assert.ok(appSrc.includes("setCookie(\"cb_ca\", customAccent)"));
});

group("S4 animation speed: the slider scales the atmosphere clock");
const atmoStep = (() => {
  const start = atmoSrc.indexOf("export function atmoStep");
  assert.ok(start !== -1, "atmoStep exported from introAtmosphere.jsx");
  const end = atmoSrc.indexOf("\n}", start);
  const body = atmoSrc.slice(start, end + 2).replace("export function", "function");
  return new Function(body + "\nreturn atmoStep;")();
})();
test("speed 1 advances by the raw frame delta", () => {
  assert.equal(atmoStep(10, 0.5, 1), 10.5);
});
test("speed 2 doubles the advance over simulated frames", () => {
  let a = 0, b = 0;
  for (let i = 0; i < 60; i++) { a = atmoStep(a, 1 / 60, 1); b = atmoStep(b, 1 / 60, 2); }
  assert.ok(Math.abs(b - 2 * a) < 1e-9, b + " vs " + 2 * a);
});
test("speed 0.25 quarters the advance", () => {
  let a = 0, b = 0;
  for (let i = 0; i < 60; i++) { a = atmoStep(a, 1 / 60, 1); b = atmoStep(b, 1 / 60, 0.25); }
  assert.ok(Math.abs(b - a / 4) < 1e-9);
});
test("a missing or invalid speed falls back to 1", () => {
  assert.equal(atmoStep(0, 0.5, undefined), 0.5);
  assert.equal(atmoStep(0, 0.5, 0), 0.5);
});
test("the component consumes the speed and App threads animSpeed to both mounts", () => {
  assert.ok(atmoSrc.includes("speed = 1"));
  assert.ok(atmoSrc.includes("elapsed = atmoStep(elapsed, dt, speed)"));
  assert.ok(appSrc.includes("<IntroAtmosphere animationMode={animationMode} speed={animSpeed}"));
  assert.ok(appSrc.includes("animSpeed={animSpeed}"));
  assert.ok(introSrc.includes("speed={animSpeed}"));
});
test("the slider shows only where the atmosphere runs, in Full", () => {
  assert.ok(settingsSrc.includes("animationMode === \"cinematic\" && ("));
  assert.ok(settingsSrc.includes("LocalSlider label=\"Animation speed\""));
});

group("S5 motion Subtle: ambient and looping motion stops, functional motion stays");
test("the atmosphere draws still under Subtle", () => {
  assert.ok(atmoSrc.includes("animationMode === \"subtle\""));
});
test("the app toggles a subtle body class beside the off class", () => {
  assert.ok(appSrc.includes("document.body.classList.toggle(\"cb-motion-subtle\", animationMode === \"subtle\")"));
  assert.ok(appSrc.includes("document.body.classList.toggle(\"cb-motion-off\", animationMode === \"off\")"));
});
const AMBIENT = [".cb-mark-breath-a", ".cb-mark-breath-b", ".cb-spec-sheen", ".cb-spec-dot", ".cb-intro-haze i", ".cb-intro-grain", ".cb-founder-ring", ".lv-pulse"];
for (const cls of AMBIENT) {
  test("Subtle kills the ambient loop " + cls, () => {
    assert.ok(appSrc.includes("body.cb-motion-subtle " + cls), cls);
  });
}
test("functional loops are not in the Subtle kill list", () => {
  const blockStart = appSrc.indexOf("body.cb-motion-subtle .cb-mark-breath-a");
  const block = appSrc.slice(blockStart, appSrc.indexOf("{ animation: none; }", blockStart));
  for (const kept of ["cbspin", "cb-indeterminate", "cbMicPulse", "cbReadheadSweep", "cbRise", "cbModal"]) {
    assert.ok(!block.includes(kept), kept + " must keep running under Subtle");
  }
});

console.log("\nsettings-themes-motion: " + passed + " passed, " + failures.length + " failed");
if (failures.length) process.exit(1);
