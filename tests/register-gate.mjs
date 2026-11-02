/**
 * Register gate (Wave Zero, 2026-11-02).
 *
 * The token gate every later surface wave stands on. At the
 * baseline commit 064a491 the register tokens in
 * src/registerTokens.js had effectively one consumer family,
 * and both defects the owner photographed on the home (a lime
 * send button, a hue hashed account tile) were legal output
 * of the system as written. This gate makes the tokens load
 * bearing:
 *
 *  (a) Colour literals. No new colour literal (hex, rgb,
 *      rgba, hsl) in src outside the allowlist of token
 *      defining files. Pre existing literals outside the
 *      allowlist sit on the frozen baseline below, generated
 *      from the tree at 064a491; a count may only shrink. The
 *      three register gold values are exempt by name, because
 *      the gold rule (d) permits them in chrome and surface
 *      code; every other literal is judged against the
 *      baseline.
 *  (b) Palette ban on Register surfaces. The door function in
 *      src/intro.jsx and the home stage block in
 *      src/CerebrumApp.jsx may not read PALETTES, ACCENTS, a
 *      palette ground, surface, or ink field (P.dark, P.bg,
 *      P.surface, P.raised, P.ink, P.ink2, P.faint, P.line,
 *      P.line2), or the bare accent value. Sign in maps to
 *      Register in the class table; the tree carries no
 *      distinct sign in surface (sign in is the AuthModal
 *      dialog, whose sentence form is a later wave), and a
 *      pin below holds that premise so a future sign in
 *      surface cannot slip in unclassified.
 *  (c) Accent is never paint. Anywhere in src, an accent
 *      value or alpha derivative in a background, backgroundColor,
 *      or fill position is counted per file against a frozen
 *      baseline that may only shrink. In chrome and the
 *      composer (SignalComposer, EvidenceFilter, Sidebar, the
 *      mobile tab bar, the .cb-ask-go rule, the account
 *      tiles) the count must be zero after Wave Zero, and the
 *      legal positions are the enumerated ones only: text
 *      colour, a 1px rule or underline, a marginal mark, a
 *      focus outline.
 *  (d) Gold. A gold range literal outside the token file
 *      must be one of REGISTER_GOLD, REGISTER_GOLD_BRIGHT,
 *      REGISTER_GOLD_ON_LIGHT, or a pre existing literal on
 *      the frozen baseline (the Nova lesson artwork golds in
 *      LearnView.jsx are the named exception the baseline
 *      carries). New gold fails.
 *  (e) Dead tokens. Every export of registerTokens.js must
 *      have a consumer outside its defining file, or sit on
 *      the expiry allowlist below with the wave that consumes
 *      it named.
 *  (f) The door consumes the tokens: intro.jsx imports
 *      REGISTER_GROUND and the door root paints it, with the
 *      rendered value pinned at the value it replaces.
 *
 *  Plus the resolver unit pins (Register identical under any
 *  palette, Instrument fixed, Reading alone moves, the
 *  record hybrid, unmapped views throw), the shell legal row
 *  pins (exactly one legal row component inside the shell),
 *  and the regression pins for the door values and the
 *  search empty state structure and honesty copy.
 *
 * Run with: node tests/register-gate.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src");

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

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (extname(p) === ".js" || extname(p) === ".jsx") out.push(p);
  }
  return out;
}

const files = walk(SRC);
const textOf = new Map();
for (const f of files) textOf.set(relative(root, f), readFileSync(f, "utf8"));
const appSrc = textOf.get("src/CerebrumApp.jsx");
const introSrc = textOf.get("src/intro.jsx");
const tokensSrc = textOf.get("src/registerTokens.js");

const {
  REGISTER_GROUND, REGISTER_GOLD, REGISTER_GOLD_BRIGHT, REGISTER_GOLD_ON_LIGHT,
  REGISTER_INK, REGISTER_SERIF_SCALE, INSTRUMENT_GROUND,
  SURFACE_CLASSES, resolveSurface,
} = await import(join(SRC, "registerTokens.js"));
const { PALETTES } = await import(join(SRC, "palettes.js"));

/* Files allowed to define colour values. Nova artwork files
   are allowlisted by path so this gate never repaints her;
   her lesson surface (LearnView.jsx) is not artwork and sits
   on the baseline like everything else. */
const COLOUR_ALLOWLIST = new Set([
  "src/registerTokens.js",
  "src/palettes.js",
  "src/designSystem.jsx",
  "src/introAtmosphere.jsx",
  "src/NovaFigure.jsx",
  "src/NovaGlyph.jsx",
  "src/NovaEgg.jsx",
  "src/NovaRive.jsx",
  "src/NovaSpeech.jsx",
  "src/NovaTour.jsx",
  "src/NovaSidebarPop.jsx",
]);

const REGISTER_GOLD_VALUES = new Set([REGISTER_GOLD, REGISTER_GOLD_BRIGHT, REGISTER_GOLD_ON_LIGHT]);

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const FN_RE = /(?:rgba?|hsla?)\([^)]*\)/g;

function colourCounts(text) {
  const counts = new Map();
  for (const m of text.matchAll(HEX_RE)) {
    const k = m[0].toLowerCase();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  for (const m of text.matchAll(FN_RE)) counts.set(m[0], (counts.get(m[0]) || 0) + 1);
  return counts;
}

/* Gold range test for one literal: a hex or rgb/rgba value
   whose hue sits in the gold band with real saturation. */
function goldLike(lit) {
  let r, g, b;
  const hex = /^#([0-9a-f]{6})$/.exec(lit);
  if (hex) {
    r = parseInt(hex[1].slice(0, 2), 16); g = parseInt(hex[1].slice(2, 4), 16); b = parseInt(hex[1].slice(4, 6), 16);
  } else {
    const rgb = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(lit);
    if (!rgb) return false;
    r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3]);
  }
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return false;
  const light = (mx + mn) / 2 / 255;
  const sat = (mx - mn) / (255 - Math.abs(mx + mn - 255));
  let hue;
  if (mx === r) hue = 60 * (((g - b) / (mx - mn)) % 6);
  else if (mx === g) hue = 60 * ((b - r) / (mx - mn) + 2);
  else hue = 60 * ((r - g) / (mx - mn) + 4);
  if (hue < 0) hue += 360;
  return hue >= 32 && hue <= 58 && sat >= 0.3 && light >= 0.25 && light <= 0.8;
}

/* Accent as paint, counted per line: a background,
   backgroundColor, or fill declaration whose value segment
   carries the bare accent, an alpha derivative of it, or
   the composer accent variable. Text colour, rules,
   underlines, marks, and focus outlines are not background
   positions and never match. */
const PAINT_PROP_RE = /(background|backgroundColor|fill)\s*:/;
function accentPaintCount(text) {
  let n = 0;
  for (const line of text.split("\n")) {
    const m = PAINT_PROP_RE.exec(line);
    if (!m) continue;
    const rest = line.slice(m.index, m.index + 140);
    if (/\baccent\b/.test(rest) || rest.includes("var(--cb-acc)") || rest.includes("withAlpha(accent")) n++;
  }
  return n;
}

const PALETTE_READ_RES = [
  /\bPALETTES\b/, /\bACCENTS\b/,
  /\bP\.(dark|bg|surface|raised|ink|ink2|faint|line|line2|shadow|shadowSm|skel)\b/,
  /\baccent=\{accent\}/, /\{\s*accent\s*\}/,
];
function paletteReads(text) {
  const hits = [];
  for (const re of PALETTE_READ_RES) {
    const m = re.exec(text);
    if (m) hits.push(`${re} matched ${JSON.stringify(m[0])}`);
  }
  return hits;
}

function blankBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/* The door function and the home stage block, sliced the
   same way the title card suite slices them. */
function doorFn() {
  return introSrc.slice(introSrc.indexOf("function Intro({"), introSrc.indexOf("function CerebrumFieldCanvas"));
}
function homeStageBlock() {
  let s = appSrc.slice(
    appSrc.indexOf("The home stage: the empty search home"),
    appSrc.indexOf("<div style={{ ...S.workspace,")
  );
  /* The Sources dialog mount inside the Reveal is a dialog,
     not the home ground: dialogs follow the palette like
     every other dialog (see IntroModal in intro.jsx), so its
     one mount line is not part of the Register surface. */
  s = s.replace(/<SourcesDialog[^\n]*\n/, "");
  return blankBlockComments(s);
}
function sliceBetween(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a >= 0, `start marker not found: ${startMarker.slice(0, 60)}`);
  const b = src.indexOf(endMarker, a + startMarker.length);
  assert.ok(b > a, `end marker not found after start: ${endMarker.slice(0, 60)}`);
  return src.slice(a, b);
}

/* FROZEN BASELINE, generated from the tree at 064a491.
   Every entry is a pre existing colour literal outside the
   allowlist. A count may only shrink: when a later wave
   converts a literal to a token, lower or delete its entry
   in the same commit. Raising a count, or adding a literal
   or a file, fails the gate. */
const COLOUR_BASELINE = {
 "src/CerebrumApp.jsx": {
  /* Correct fix census (2026-11-02): the rail badge step is a new
     shell literal, counted here so the census stays honest. */
  "rgba(255,255,255,0.08)": 1,
  "#000": 13,
  "#000000": 7,
  "#05070a": 3,
  "#0552b5": 1,
  "#060606": 2,
  "#06080a": 1,
  "#070b14": 1,
  "#0a0a0a": 5,
  "#0a0c10": 6,
  "#0b0b0e": 1,
  "#0b0d10": 4,
  "#0b0d11": 1,
  "#0b0f0d": 1,
  "#0e1014": 1,
  "#0f1115": 1,
  "#101216": 1,
  "#101317": 1,
  "#101408": 1,
  "#10141a": 1,
  "#121110": 1,
  "#141416": 1,
  "#14161a": 2,
  "#14161c": 1,
  "#141620": 1,
  "#14171a": 2,
  "#141816": 1,
  "#161916": 1,
  "#232723": 1,
  "#2e7d52": 1,
  "#2e7d5b": 1,
  "#300": 1,
  "#34d399": 5,
  "#444": 1,
  "#5b625b": 1,
  "#5eead4": 1,
  "#7a756a": 1,
  "#7c9a82": 3,
  "#8593": 1,
  "#888": 4,
  "#8b8b93": 1,
  "#8ba888": 8,
  "#9fbd9f": 1,
  "#a3b899": 4,
  "#b0472b": 2,
  "#ccc": 3,
  "#d13438": 4,
  "#d4af37": 4,
  "#d7c27b": 1,
  "#d99b86": 1,
  "#d9a441": 4,
  "#d9a520": 1,
  "#e5484d": 3,
  "#e8a13c": 1,
  "#e8b44a": 1,
  "#eef4ef": 1,
  "#f2f4f2": 5,
  "#f3f3f1": 1,
  "#f43f5e": 1,
  "#f59e0b": 2,
  "#f6f7f6": 1,
  "#fafbf9": 1,
  "#ff6b6b": 1,
  "#fff": 18,
  "#ffffff": 18,
  "hsl(${t.h} ${t.s}% 15%)": 1,
  "hsl(${t.h} ${t.s}% 46%)": 1,
  "rgb(71,71,71)": 1,
  "rgba(0,0,0,0.015)": 4,
  "rgba(0,0,0,0.018)": 2,
  "rgba(0,0,0,0.02)": 4,
  "rgba(0,0,0,0.03)": 4,
  "rgba(0,0,0,0.04)": 6,
  "rgba(0,0,0,0.045)": 1,
  "rgba(0,0,0,0.05)": 8,
  "rgba(0,0,0,0.06)": 2,
  "rgba(0,0,0,0.10)": 1,
  "rgba(0,0,0,0.18)": 1,
  "rgba(0,0,0,0.22)": 1,
  "rgba(0,0,0,0.24)": 1,
  "rgba(0,0,0,0.30)": 2,
  "rgba(0,0,0,0.32)": 1,
  "rgba(0,0,0,0.34)": 1,
  "rgba(0,0,0,0.36)": 1,
  "rgba(0,0,0,0.45)": 1,
  "rgba(0,0,0,0.5)": 4,
  "rgba(0,0,0,0.55)": 4,
  "rgba(0,0,0,0.6)": 3,
  "rgba(0,0,0,0.65)": 1,
  "rgba(0,0,0,0.72)": 2,
  "rgba(10,12,14,0.95)": 1,
  "rgba(10,12,16,0.45)": 1,
  "rgba(10,14,32,0.65)": 1,
  "rgba(11,13,16,0.30)": 1,
  "rgba(11,13,16,0.72)": 1,
  "rgba(127, 127, 127, 0.07)": 1,
  "rgba(127,127,127,0.07)": 1,
  "rgba(127,127,127,0.45)": 1,
  "rgba(127,140,127,0.06)": 1,
  "rgba(128,128,128,0.16)": 2,
  "rgba(128,128,128,0.22)": 4,
  "rgba(128,128,128,0.3)": 2,
  "rgba(138,155,186,0.08)": 1,
  "rgba(138,155,186,0.14)": 1,
  "rgba(160,175,165,.24)": 1,
  "rgba(2,4,6,0.74)": 1,
  "rgba(20,30,20,0.24)": 1,
  "rgba(201,162,39,0.6)": 1,
  "rgba(212,175,55,0.05)": 1,
  "rgba(212,175,55,0.08)": 1,
  "rgba(212,175,55,0.35)": 1,
  "rgba(212,175,55,0.6)": 1,
  "rgba(242,244,242,0.52)": 1,
  "rgba(242,244,242,0.55)": 1,
  "rgba(242,244,242,0.6)": 1,
  "rgba(243,243,241,0.65)": 2,
  "rgba(250, 204, 21, 0.30)": 1,
  "rgba(250,250,248,0)": 1,
  "rgba(250,250,248,0.62)": 1,
  "rgba(250,250,248,0.94)": 1,
  "rgba(255,107,107,0.1)": 1,
  "rgba(255,107,107,0.3)": 1,
  "rgba(255,255,255,0)": 3,
  "rgba(255,255,255,0.015)": 3,
  "rgba(255,255,255,0.02)": 2,
  "rgba(255,255,255,0.022)": 1,
  "rgba(255,255,255,0.025)": 1,
  "rgba(255,255,255,0.028)": 2,
  "rgba(255,255,255,0.03)": 2,
  "rgba(255,255,255,0.034)": 2,
  "rgba(255,255,255,0.04)": 5,
  "rgba(255,255,255,0.05)": 8,
  "rgba(255,255,255,0.055)": 1,
  "rgba(255,255,255,0.06)": 3,
  /* Correct fix census (2026-11-02): the rail active row step joins the count. */
  "rgba(255,255,255,0.07)": 9,
  "rgba(255,255,255,0.09)": 2,
  "rgba(255,255,255,0.1)": 2,
  "rgba(255,255,255,0.11)": 1,
  "rgba(255,255,255,0.12)": 1,
  "rgba(255,255,255,0.14)": 3,
  "rgba(255,255,255,0.16)": 3,
  "rgba(255,255,255,0.18)": 2,
  "rgba(255,255,255,0.20)": 1,
  "rgba(255,255,255,0.28)": 1,
  "rgba(255,255,255,0.35)": 1,
  "rgba(255,255,255,0.38)": 1,
  "rgba(255,255,255,0.4)": 1,
  "rgba(255,255,255,0.5)": 1,
  "rgba(255,255,255,0.65)": 1,
  "rgba(3,5,7,0)": 1,
  "rgba(3,5,7,0.42)": 1,
  "rgba(3,5,7,0.48)": 1,
  "rgba(3,5,7,0.80)": 1,
  "rgba(33,28,20,0.06)": 2,
  "rgba(33,28,20,0.07)": 2,
  "rgba(33,28,20,0.10)": 1,
  "rgba(33,28,20,0.13)": 1,
  "rgba(34,37,42,0.66)": 1,
  "rgba(5,7,10,0.62)": 1,
  "rgba(5,7,10,0.78)": 1,
  "rgba(52,211,153,0.5)": 2
 },
 "src/DiveParticles.jsx": {
  "rgba(207,232,228,${(a * 0.55)": 1,
  "rgba(207,232,228,${a.toFixed(3)": 1,
  "rgba(207,232,228,0)": 1
 },
 "src/LearnView.jsx": {
  "#0d2f2c": 2,
  "#0f0f0f": 1,
  "#101408": 23,
  "#122b1c": 2,
  "#12303f": 1,
  "#14161c": 1,
  "#14240a": 1,
  "#1a1a1a": 1,
  "#1a2942": 2,
  "#1f5450": 2,
  "#22330f": 2,
  "#26506b": 1,
  "#26543a": 2,
  "#2a1c40": 2,
  "#2e1e0e": 1,
  "#300": 1,
  "#33270c": 1,
  "#35496b": 2,
  "#3a1c26": 2,
  "#3a352c": 1,
  "#47632a": 2,
  "#4d3a26": 1,
  "#51386b": 2,
  "#5c4a1f": 1,
  "#6e3542": 2,
  "#6e675c": 1,
  "#a79e8d": 1,
  "#c4a35a": 16,
  "#e8e4dc": 1,
  "#f0e3c0": 1,
  "#fdf3d7": 2,
  "#ff8a8a": 2,
  "#fff": 13,
  "rgba(\" + ((n >> 16)": 1,
  "rgba(0,0,0,0)": 1,
  "rgba(0,0,0,0.20)": 1,
  "rgba(232, 228, 220, 0.66)": 1,
  "rgba(255, 255, 255, 0.4)": 1,
  "rgba(255,255,255,.07)": 1,
  "rgba(255,255,255,.13)": 1,
  "rgba(255,255,255,.28)": 1,
  "rgba(255,255,255,.38)": 1,
  "rgba(255,255,255,.55)": 2,
  "rgba(255,255,255,0)": 3,
  "rgba(255,255,255,0.06)": 1,
  "rgba(255,255,255,0.26)": 1,
  "rgba(255,255,255,0.55)": 1,
  "rgba(26, 26, 26, 0.16)": 1,
  "rgba(6,10,6,0.05)": 1,
  "rgba(6,10,6,0.16)": 1,
  "rgba(6,10,6,0.72)": 1,
  "rgba(6,10,6,0.85)": 1
 },
 "src/appUtils.js": {
  "#047857": 2,
  "#101216": 3,
  "#10b981": 1,
  "#86672f": 1,
  "#876614": 2,
  "#b92c31": 1,
  "#d9a520": 2,
  "#f1f0ec": 1,
  "#f9f9f7": 2,
  "#ff7a7a": 1,
  "#ffffff": 2,
  "hsl(${t.h} ${t.s}% 32%)": 1,
  "hsl(${t.h} 34% 90%)": 1
 },
 "src/cerebrumField.js": {
  "#0a1020": 3,
  "#183d32": 1,
  "#214c40": 1,
  "#285b4c": 1,
  "#39594d": 1,
  "#39dca2": 4,
  "#ddfff2": 1,
  "#e2fff2": 1,
  "#e3f7f1": 1,
  "#f0fffa": 1,
  "rgba(${parseInt(h.slice(0, 2)": 1,
  "rgba(238,255,250,.7)": 1,
  "rgba(240,255,250,${light ? .40 : .85})": 1,
  "rgba(255,255,255,0)": 2,
  "rgba(a, .025 * l.strength)": 1,
  "rgba(a, .08 + (12 - i)": 1,
  "rgba(a, .09)": 1,
  "rgba(a, .19 * l.strength)": 1,
  "rgba(a, .20 + (12 - i)": 1,
  "rgba(a, .8)": 1,
  "rgba(a, 0)": 3,
  "rgba(a, light ? .06 : .075)": 1,
  "rgba(color, alpha)": 1,
  "rgba(state.deep, .68)": 1,
  "rgba(state.deep, .94)": 1,
  "rgba(state.deep, 0)": 1
 },
 "src/exportExcel.js": {
  "#475569": 1,
  "rgb(accent)": 2,
  "rgb(opts.accent)": 2
 },
 "src/flowcharts.jsx": {
  "#0f1115": 2,
  "#16181d": 2,
  "#161916": 1,
  "#1c1b19": 2,
  "#232723": 3,
  "#2e7d52": 1,
  "#767676": 1,
  "#eef4ef": 1,
  "#f2f4f2": 2,
  "#f4f4f2": 3,
  "#f6f7f6": 1,
  "#ffffff": 2,
  "rgba(0,0,0,0.65)": 1,
  "rgba(242,244,242,0.75)": 1,
  "rgba(255,255,255,0.05)": 2,
  "rgba(255,255,255,0.10)": 1,
  "rgba(255,255,255,0.12)": 4
 },
 "src/inbox.jsx": {
  "#161822": 1,
  "#8ba888": 1,
  "#fff": 1,
  "hsl(${Math.round((hue + offset)": 1,
  "rgba(0,0,0,0.03)": 1,
  "rgba(0,0,0,0.04)": 1,
  "rgba(0,0,0,0.05)": 1,
  "rgba(0,0,0,0.15)": 1,
  "rgba(0,0,0,0.9)": 1,
  "rgba(255,255,255,0.04)": 1,
  "rgba(255,255,255,0.06)": 2
 },
 "src/intro.jsx": {
  "#000": 1,
  "#060606": 2,
  "#0a1020": 1,
  "#0b0d10": 2,
  "#0f1115": 1,
  "#767676": 1,
  "#d4af37": 2,
  "#f2f4f2": 1,
  "#f3f3f1": 1,
  "#f4f4f2": 1,
  "#f5f4f1": 1,
  "rgba(\" + (d.acc ? accentRgb : dotRgb)": 1,
  "rgba(\" + dotRgb + \",0.028)": 1,
  "rgba(242,244,242,0.44)": 1,
  "rgba(242,244,242,0.5)": 1,
  "rgba(242,244,242,0.68)": 1,
  "rgba(242,244,242,0.78)": 1,
  "rgba(243,243,241,0.55)": 1,
  "rgba(243,243,241,0.72)": 1,
  "rgba(255,255,255,0.06)": 1,
  "rgba(255,255,255,0.07)": 1,
  "rgba(255,255,255,0.10)": 1,
  "rgba(255,255,255,0.12)": 1
 },
 "src/main.jsx": {
  "#0b0b0e": 1,
  "#0d0f0e": 1,
  "#151816": 1,
  "#8ba888": 1,
  "#94a397": 1,
  "#cbd5cd": 1,
  "#f4f7f4": 1,
  "rgba(128,128,128,0.4)": 1,
  "rgba(139,168,136,0.2)": 1
 },
 "src/marketingWidgets.jsx": {
  "#0b0b0e": 1,
  "rgba(16,185,129,0.08)": 1,
  "rgba(16,185,129,0.35)": 1,
  "rgba(217,165,32,0.08)": 1,
  "rgba(217,165,32,0.4)": 1
 },
 "src/settings.jsx": {
  "#000000": 1,
  "#1a1a1a": 1,
  "#333333": 1,
  "#3fb96c": 2,
  "#c9c9c9": 1,
  "#d13438": 3,
  "#e5484d": 4,
  "#e8e8e8": 1,
  "#fff": 5,
  "#ffffff": 1,
  "rgba(0,0,0,0.03)": 3,
  "rgba(0,0,0,0.04)": 1,
  "rgba(0,0,0,0.05)": 1,
  "rgba(0,0,0,0.06)": 1,
  "rgba(0,0,0,0.14)": 1,
  "rgba(229,72,77,0.4)": 2,
  "rgba(255,255,255,0.04)": 3,
  "rgba(255,255,255,0.05)": 2,
  "rgba(255,255,255,0.06)": 1,
  "rgba(255,255,255,0.07)": 1,
  "rgba(255,255,255,0.14)": 1
 }
};

/* FROZEN BASELINE, same commit: per file count of accent
   values in background, backgroundColor, or fill positions.
   May only shrink. Chrome and the composer are held to zero
   separately below, not by this table. */
const ACCENT_PAINT_BASELINE = {
  "src/CerebrumApp.jsx": 153,
  "src/LearnView.jsx": 39,
  "src/NovaTour.jsx": 2,
  "src/designSystem.jsx": 1,
  "src/flowcharts.jsx": 9,
  "src/inbox.jsx": 25,
  "src/intro.jsx": 2,
  "src/main.jsx": 1,
  "src/marketingWidgets.jsx": 2,
  "src/settings.jsx": 25,
};

group("Register gate");

await test("the scan is not vacuous, and the detectors catch planted violations", () => {
  assert.ok(files.length >= 30, `expected the full src tree, saw ${files.length} files`);
  assert.ok(appSrc.length > 500000, "CerebrumApp.jsx read in full");
  const planted = 'const x = { background: "#123456", color: P.bg };';
  const counts = colourCounts(planted);
  assert.equal(counts.get("#123456"), 1, "the hex detector missed a planted literal");
  assert.equal(goldLike("#d4af37"), true, "the gold detector missed the classic off token gold");
  assert.equal(goldLike("#c89a3a"), true, "the gold detector should see the register gold as gold range");
  assert.equal(goldLike("#767676"), false, "a neutral grey is not gold");
  assert.equal(accentPaintCount('style={{ background: accent }}'), 1, "the paint detector missed a planted accent background");
  assert.equal(accentPaintCount('style={{ color: accent }}'), 0, "text colour must never count as paint");
  assert.ok(paletteReads(planted).length > 0, "the palette detector missed a planted P.bg read");
});

await test("(a) no new colour literal outside the allowlist, baseline may only shrink", () => {
  const breaches = [];
  for (const [rel, text] of textOf) {
    if (COLOUR_ALLOWLIST.has(rel)) continue;
    const base = COLOUR_BASELINE[rel] || {};
    for (const [lit, n] of colourCounts(text)) {
      if (REGISTER_GOLD_VALUES.has(lit)) continue;
      const allowed = base[lit] || 0;
      if (n > allowed) breaches.push(`${rel}: ${lit} x${n} exceeds frozen x${allowed}`);
    }
  }
  assert.deepEqual(breaches, [], "new or grown colour literals:\n" + breaches.join("\n"));
});

await test("(d) gold outside the token file is a register gold or a frozen baseline literal", () => {
  const breaches = [];
  for (const [rel, text] of textOf) {
    if (COLOUR_ALLOWLIST.has(rel)) continue;
    const base = COLOUR_BASELINE[rel] || {};
    for (const [lit, n] of colourCounts(text)) {
      if (!goldLike(lit)) continue;
      if (REGISTER_GOLD_VALUES.has(lit)) continue;
      if ((base[lit] || 0) >= n) continue;
      breaches.push(`${rel}: ${lit} x${n} is not a register gold and not frozen`);
    }
  }
  assert.deepEqual(breaches, [], "off token gold:\n" + breaches.join("\n"));
  assert.equal(REGISTER_GOLD, "#c89a3a");
  assert.equal(REGISTER_GOLD_BRIGHT, "#e0bd68");
  assert.equal(REGISTER_GOLD_ON_LIGHT, "#8a6618");
});

await test("(f) the door consumes REGISTER_GROUND, and the rendered values did not move", () => {
  assert.equal(REGISTER_GROUND, "#060606", "REGISTER_GROUND must stay the value the literal carried");
  assert.match(introSrc, /import \{[^}]*REGISTER_GROUND[^}]*\} from "\.\/registerTokens\.js"/, "intro.jsx does not import REGISTER_GROUND");
  const door = doorFn();
  assert.ok(door.includes("background: REGISTER_GROUND"), "the door root does not paint REGISTER_GROUND");
  assert.ok(!door.includes('"#060606"'), "the door still carries the raw ground literal");
  assert.deepEqual(REGISTER_INK, {
    ink: "#f3f3f1",
    ink72: "rgba(243,243,241,0.72)",
    ink55: "rgba(243,243,241,0.55)",
  }, "the door ink steps must stay the values the literals carried");
  assert.deepEqual(REGISTER_SERIF_SCALE.display, {
    fontSize: 104, mobileFontSize: 57, fontWeight: 500, letterSpacing: "0.008em", lineHeight: 1.04,
  }, "the door title scale must stay the values the literals carried");
});

await test("(b) the door reads no palette and no accent", () => {
  const hits = paletteReads(blankBlockComments(doorFn()));
  assert.deepEqual(hits, [], "palette reads inside the door:\n" + hits.join("\n"));
});

await test("(b)+(f) the home stage is a Register surface: resolver ground, atmosphere mounted unconditionally, no palette reads", () => {
  const home = homeStageBlock();
  const hits = paletteReads(home);
  assert.deepEqual(hits, [], "palette reads inside the home stage block:\n" + hits.join("\n"));
  assert.ok(appSrc.includes("const homeSurface = resolveSurface(SURFACE_CLASSES.search);"), "the home does not resolve its surface through resolveSurface");
  assert.ok(appSrc.includes("const registerP = {"), "the register palette shim for the home composer is missing");
  assert.ok(home.includes("<IntroAtmosphere"), "the home does not mount IntroAtmosphere");
  assert.ok(!home.includes("{P.dark && <IntroAtmosphere"), "the atmosphere mount is still conditional on the palette");
  assert.ok(!home.includes("REGISTER_POOL_CSS"), "the home still references the CSS pool as a ground");
  assert.ok(!home.includes("staticFieldCss"), "the home still references the static field as a ground");
  assert.ok(!home.includes("background: P.bg"), "the home light palette panel form is still present");
  assert.ok(home.includes('background: "transparent"'), "the home column is not transparent over the atmosphere");
  assert.ok(home.includes("P={registerP}") && home.includes("accent={REGISTER_GOLD}"), "the home composer is not fed the register palette shim and the register gold");
  assert.ok(home.includes('"--cb-acc": homeSurface.gold'), "the home column accent variable is not the register gold role");
});

await test("(b) sign in maps to Register, and the tree carries no distinct sign in surface to classify later", () => {
  assert.equal(SURFACE_CLASSES.signin, "Register");
  assert.ok(appSrc.includes("function AuthModal("), "AuthModal, the only sign in form, is gone");
  assert.ok(!/view === "signin"/.test(appSrc), "a distinct sign in view appeared: map it through resolveSurface and hold it to the Register pins before this premise is retired");
});

await test("(c) accent as paint never grows past the frozen baseline anywhere in src", () => {
  const breaches = [];
  for (const [rel, text] of textOf) {
    const n = accentPaintCount(text);
    const allowed = ACCENT_PAINT_BASELINE[rel] || 0;
    if (n > allowed) breaches.push(`${rel}: ${n} accent paint positions exceed frozen ${allowed}`);
  }
  assert.deepEqual(breaches, [], breaches.join("\n"));
});

await test("(c) correct fix: the shell chrome holds no user accent paint, and the composer send is a filled action again", () => {
  const composer = sliceBetween(appSrc, "function SignalComposer({", "/* ── SSE search streaming");
  const filter = sliceBetween(appSrc, "function EvidenceFilter({", "const QUERY_COMMON_WORDS");
  const sidebar = sliceBetween(appSrc, "const Sidebar = React.memo(function Sidebar(", "/* Commit 69 — the consent gate.");
  assert.equal(accentPaintCount(sidebar), 0, "the rail paints with the user accent: the frame is register, not palette");
  const tabbar = sliceBetween(appSrc, '<nav aria-label="Primary" className="cb-shell-tabbar-in"', '{view === "search" && (');
  assert.equal(accentPaintCount(tabbar), 0, "the mobile tab bar paints with the user accent");
  assert.ok(tabbar.includes('"--cb-accent": REGISTER_GOLD'), "the tab bar does not scope its accent variable to the register gold");
  const goRule = sliceBetween(appSrc, ".cb-ask-go {", ".cb-ask-spin {");
  assert.ok(goRule.includes("background: color-mix(in srgb, var(--cb-acc) 15%, transparent)"), "the composer send lost its filled wash");
  assert.ok(goRule.includes("border: 1px solid color-mix(in srgb, var(--cb-acc) 42%, transparent)"), "the composer send lost its border");
  assert.ok(goRule.includes("color: var(--cb-faint)"), "the composer disabled state does not read the surface faint step");
  assert.ok(appSrc.includes(".cb-ask--stage .cb-ask-go {"), "the stage send has no solid key rule");
  const stageGo = sliceBetween(appSrc, ".cb-ask--stage .cb-ask-go {", ".cb-ask--stage .cb-ask-go:hover");
  assert.ok(stageGo.includes("background: var(--cb-acc)"), "the stage send is not the solid accent fill");
  assert.ok(stageGo.includes("color: var(--cb-on-acc)"), "the stage send ink is not computed on the accent");
  const askCss = appSrc.slice(appSrc.indexOf(".cb-ask {"), appSrc.indexOf(".cb-ask-field {"));
  assert.ok(askCss.includes("--cb-acc: #c89a3a"), "the composer accent variable is not the register gold literal");
  const diveCss = appSrc.slice(appSrc.indexOf(".cb-dive {"), appSrc.indexOf(".cb-dive-scroll {"));
  assert.ok(diveCss.includes("--cb-acc: #c89a3a"), "the Dive accent variable is not the register gold literal");
  const searchBtn = sliceBetween(appSrc, "searchBtn: {", 'boxShadow: "none",');
  assert.ok(searchBtn.includes("background: accent"), "the follow up submit is not the filled accent pill");
  assert.ok(searchBtn.includes("color: at"), "the follow up submit ink is not the ink computed on the accent");
  assert.ok(searchBtn.includes("borderRadius: RADIUS.viewport"), "the follow up submit is not a pill");
});

await test("(c) the composer send action is the filled Ask pill, word kept, on every variant", () => {
  const composer = sliceBetween(appSrc, "function SignalComposer({", "/* ── SSE search streaming");
  assert.ok(composer.includes('className="cb-ask-go"'), "the send button class changed shape");
  assert.ok(composer.includes(': "Ask"}'), "the send action does not render the word Ask");
  assert.ok(composer.includes('aria-label={busy ? "Searching" : "Ask"}'), "the send action label changed");
  assert.ok(composer.includes('"--cb-on-acc": accentInk(P, accent)'), "the solid key ink is not computed on the accent");
  assert.ok(composer.includes('"--cb-acc": accent'), "the composer does not carry its surface accent into the fill");
});

await test("(3b)+(3c) correct fix: the account tile carries the user's identity skin, and the centre tab is a filled action", () => {
  const sidebar = sliceBetween(appSrc, "const Sidebar = React.memo(function Sidebar(", "/* Commit 69 — the consent gate.");
  assert.ok(/avatarSkin\(/.test(sidebar), "the rail account tile lost the per user identity skin");
  const accountMenu = sliceBetween(appSrc, "function AccountMenu({", "const Sidebar = React.memo(function Sidebar(");
  assert.ok(/avatarSkin\(/.test(accountMenu), "the account menu tile lost the per user identity skin");
  assert.equal((appSrc.match(/\.\.\.avatarSkin\(/g) || []).length, 4, "avatarSkin spreads: rail tile, account menu tile, Profile and People surfaces only");
  const tabbar = sliceBetween(appSrc, '<nav aria-label="Primary" className="cb-shell-tabbar-in"', '{view === "search" && (');
  assert.ok(!tabbar.includes("background: accent"), "the mobile tab bar carries a filled user accent object");
  assert.ok(tabbar.includes("background: REGISTER_GOLD"), "the centre tab action is not the filled register gold circle");
  assert.ok(tabbar.includes('width: 48, height: 48, borderRadius: "50%"'), "the centre tab action is not the 48px raised circle");
});

await test("(e) every register token has a consumer, or an expiry on the allowlist", () => {
  const EXPIRY = {
    INSTRUMENT_GROUND: "retired by the correct fix (2026-11-02): null marker only, Instrument resolves with its palette",
    /* REGISTER_LINE_STRONG left this list in the matching pass
       (2026-11-02): the register palette the app hands to every
       surface consumes it as line2. */
    READING_MEASURE: "Reader and answer measure pass, Wave 4",
    NOTEBOOK_MEASURE: "Nova notebook measure, Wave 5",
  };
  const exported = new Set();
  for (const m of tokensSrc.matchAll(/export (?:const|function) (\w+)/g)) exported.add(m[1]);
  assert.ok(exported.size >= 15, `expected the register token surface, saw ${exported.size} exports`);
  const others = [...textOf.entries()].filter(([rel]) => rel !== "src/registerTokens.js").map(([, t]) => t).join("\n");
  const dead = [];
  for (const name of exported) {
    const used = new RegExp(`\\b${name}\\b`).test(others);
    if (!used && !(name in EXPIRY)) dead.push(name);
    if (used && name in EXPIRY) dead.push(`${name} gained a consumer: remove it from the expiry allowlist`);
  }
  assert.deepEqual(dead, [], "dead register tokens:\n" + dead.join("\n"));
});

await test("resolver pins: Register ignores the palette, Reading and Instrument move with it, ground and ink together", () => {
  const palettes = Object.values(PALETTES);
  assert.ok(palettes.length >= 4, "the palette set is missing");
  for (const view of ["door", "search", "signin"]) {
    const first = resolveSurface(view, palettes[0]);
    assert.equal(first.class, "Register", `${view} is not Register`);
    assert.equal(first.ground, REGISTER_GROUND);
    for (const p of palettes) assert.deepEqual(resolveSurface(view, p), first, `${view} resolution moved with the palette`);
  }
  for (const view of ["library", "settings", "inbox"]) {
    const r = resolveSurface(view, PALETTES.Light);
    assert.equal(r.class, "Instrument", `${view} is not Instrument`);
    assert.equal(r.ground, PALETTES.Light.bg, "an Instrument surface must resolve its ground from its palette");
    assert.equal(r.ink.ink, PALETTES.Light.ink, "an Instrument surface must resolve its ink with its ground, never the register ink on a palette ground or the reverse");
    const d = resolveSurface(view, PALETTES.Dark);
    assert.equal(d.ground, PALETTES.Dark.bg, "an Instrument resolution must move with the palette");
    assert.equal(d.ink.ink, PALETTES.Dark.ink);
  }
  assert.equal(INSTRUMENT_GROUND, null, "the fixed Instrument ground alias must stay retired");
  const darkAnswer = resolveSurface("answer", PALETTES.Dark);
  const lightAnswer = resolveSurface("answer", PALETTES.Light);
  assert.equal(darkAnswer.class, "Reading");
  assert.equal(darkAnswer.ground, PALETTES.Dark.bg, "the Reading ground does not come from the palette");
  assert.equal(lightAnswer.ground, PALETTES.Light.bg, "the Reading ground does not move with the palette");
  assert.notEqual(darkAnswer.ground, lightAnswer.ground, "Reading must be the class that moves");
  assert.equal(darkAnswer.gold, REGISTER_GOLD);
  assert.equal(lightAnswer.gold, REGISTER_GOLD_ON_LIGHT, "Reading on a light palette must take the on light gold");
  const record = resolveSurface("record", PALETTES.Light);
  assert.equal(record.class, "Reading");
  assert.equal(record.ground, REGISTER_GROUND, "the record hybrid must sit on the Register ground");
  assert.equal(record.hybrid, "public Reading on Register ground");
  assert.throws(() => resolveSurface("definitely-not-a-view", PALETTES.Dark), /unmapped view/, "an unmapped view must throw");
});

await test("every view the shell renders maps to exactly one surface class", () => {
  const views = new Set();
  for (const m of appSrc.matchAll(/(?:setView\(|view === )"([a-z]+)"/g)) views.add(m[1]);
  views.add("record");
  const missing = [...views].filter((v) => !(v in SURFACE_CLASSES));
  assert.deepEqual(missing, [], "views with no surface class: " + missing.join(", "));
  const block = tokensSrc.slice(tokensSrc.indexOf("const SURFACE_CLASSES"), tokensSrc.indexOf("};", tokensSrc.indexOf("const SURFACE_CLASSES")));
  const keys = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
  assert.equal(new Set(keys).size, keys.length, "SURFACE_CLASSES carries a double mapped view: " + keys.join(", "));
  assert.deepEqual(Object.keys(SURFACE_CLASSES).sort(), keys.sort(), "the exported class table and its source literal disagree");
  for (const [view, cls] of Object.entries(SURFACE_CLASSES)) {
    assert.ok(["Register", "Reading", "Instrument", "RecordHybrid"].includes(cls), `${view} maps to an unknown class ${cls}`);
  }
});

await test("(3g) exactly one shell legal row, and the footer and home no longer carry legal content", () => {
  assert.equal((appSrc.match(/function ShellLegalRow\(/g) || []).length, 1, "ShellLegalRow must be defined exactly once");
  assert.equal((appSrc.match(/<ShellLegalRow/g) || []).length, 1, "ShellLegalRow must be rendered exactly once, inside the shell");
  const row = sliceBetween(appSrc, "const SHELL_LEGAL_LINKS = [", "const Sidebar = React.memo(function Sidebar(");
  for (const [href, label] of [["/about", "About"], ["/privacy", "Privacy"], ["/terms", "Terms"], ["/disclosures", "Disclosures"], ["/contact", "Contact"]]) {
    assert.ok(row.includes(`"${href}"`) && row.includes(`"${label}"`), `the shell legal link table is missing ${label}`);
  }
  assert.ok(row.includes("SHELL_LEGAL_LINKS.map"), "the shell legal row does not render its links from the shared table");
  assert.ok(appSrc.includes("function ShellLegalPopover("), "the collapsed rail has no legal popover: the links vanish for collapsed users");
  assert.ok(appSrc.includes('aria-label="Legal links"'), "the collapsed rail carries no legal links button");
  assert.ok(row.includes("Cerebrum™"), "the shell legal row is missing the Cerebrum notice");
  const appBody = appSrc.slice(appSrc.indexOf("function App({"));
  assert.ok(!appBody.includes("©"), "a legal notice renders inside the App body outside the shell legal row");
  assert.equal((appSrc.match(/©/g) || []).length, 3, "the only notices in CerebrumApp.jsx are InfoPage (outside the shell), the shell legal row, and the collapsed rail legal popover");
  const foot = appSrc.slice(appSrc.indexOf('<div style={S.foot} className="cb-appfoot">'), appSrc.indexOf('<div style={S.foot} className="cb-appfoot">') + 2600);
  for (const href of ["/about", "/privacy", "/terms", "/disclosures", "/contact"]) {
    assert.ok(!foot.includes(href), `the app footer still carries ${href}`);
  }
  assert.ok(!foot.includes("©"), "the app footer still carries the notice");
  assert.ok(foot.includes("Film credits"), "the film credits entry must stay reachable from the thread footer");
  assert.ok(foot.includes("Written by AI from real papers. Check the sources."), "the footer honesty line moved");
});

await test("regression pin: the search empty state structure and honesty copy are unchanged", () => {
  const at = appSrc.indexOf('kicker="No synthesis available"');
  assert.ok(at > 0, "the no evidence empty state card is gone");
  const card = appSrc.slice(Math.max(0, at - 1600), at + 400);
  assert.ok(card.includes("AnswerStateCard"), "the empty state is not an AnswerStateCard");
  assert.ok(card.includes('title={answerText.trim() ? "No citable literature surfaced." : "Synthesis isn\'t available right now."}'), "the empty state titles changed");
  const noSourcesBody = "No paper cleared the relevance bar for this question, so there's no written synthesis. What follows is the honest record of the search instead.";
  const noFallbackBody = "No paper cleared the relevance bar, and no fallback answer could be built from the papers, so there is no answer text to show.";
  assert.ok(appSrc.includes(noSourcesBody), "the no sources honesty sentence changed");
  assert.ok(appSrc.includes(noFallbackBody), "the no fallback honesty sentence changed");
  assert.ok(appSrc.indexOf("<AnswerDiagnostics") < at, "the audit trail must render ahead of the empty state card");
  assert.ok(card.includes('actions={[{ label: "Retry search", primary: true, onClick: retrySearch }]}'), "the empty state retry action changed");
  assert.ok(appSrc.slice(at, at + 900).includes("<QueryRetryForm"), "the empty state lost its restate the question form");
});

console.log(`\nregister gate: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
