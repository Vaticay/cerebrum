/**
 * The Nova alive wave (2026-11-02, the owner's order: her
 * animations and her text need to feel more alive).
 *
 * Two halves, pinned separately. The figure: her form is the
 * restored revision 3 axolotl behind the same seam, and the
 * life on it is priced by pure helpers the component reads
 * (blink constants, lid coverage, the glance picker, the
 * filament sway), so those helpers are extracted from the
 * real file and exercised directly, and the source pins hold
 * the laws code cannot price: her mouth never performs, the
 * reduced motion still covers the clock while the blink
 * engine keeps running, and the mounts around the seam are
 * untouched. The voice: every bank she speaks from is
 * extracted from the real files and held to the standing
 * copy laws (no dash characters of any kind, at most one
 * exclamation, 175 characters at most), the expansion counts
 * are pinned at what the wave shipped, and the session
 * pickers are exercised for the one behaviour the owner
 * ordered: no line repeats within a session while unheard
 * lines remain.
 *
 * Run with: node tests/nova-alive.mjs (also in tests/run)
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { transformSync } from "esbuild";

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

/* Declaration extraction, the house pattern from
   cortex-learning.mjs: parse the real file, slice the named
   top level declarations, transform, and run them in a vm
   so the tests exercise the shipped code itself. */
function extractDecls(file, names, extraEpilogue = "") {
  const src = readFileSync(join(root, file), "utf8");
  const ast = parse(src, { sourceType: "module", plugins: ["jsx"] });
  const chunks = [];
  for (const name of names) {
    let found = null;
    for (const node of ast.program.body) {
      const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
      if (!decl) continue;
      if (decl.type === "FunctionDeclaration" && decl.id && decl.id.name === name) found = decl;
      if (decl.type === "VariableDeclaration") {
        const d = decl.declarations.find((x) => x.id && x.id.name === name);
        if (d) found = decl;
      }
    }
    assert.ok(found, `${name} must be declared in ${file}`);
    chunks.push(src.slice(found.start, found.end));
  }
  const js = transformSync(chunks.join("\n") + `\n;globalThis.__x = { ${names.join(", ")} };` + extraEpilogue, { loader: "jsx" }).code;
  const context = vm.createContext({});
  vm.runInContext(js, context);
  return { ...context.__x, __at: context.__at, __atMin: context.__atMin };
}

const figureSrc = readFileSync(join(root, "src/NovaFigure.jsx"), "utf8");
const riveSrc = readFileSync(join(root, "src/NovaRive.jsx"), "utf8");

const F = extractDecls("src/NovaFigure.jsx", [
  "novaSizeClassFor", "novaFigureModeFor",
  "novaBlinkIntervalMs", "NOVA_BLINK_CLOSE_MS", "NOVA_BLINK_HOLD_MS", "NOVA_BLINK_OPEN_MS",
  "NOVA_EXPRESSION_TRANSITIONS_MS", "novaExpressionTransitionMs",
  "novaLidCoverageFor", "novaEyeOffsetFor", "novaAttentionShift",
  "NOVA_GLANCE_TARGETS", "novaGlancePick", "filamentAngleAt",
  "ART_GILLS",
]);

group("The restored figure: her motion is priced by the real helpers");

await test("the blink waits 7 to 13 seconds, drawn from the seed", () => {
  assert.equal(F.novaBlinkIntervalMs(0), 7000);
  assert.equal(F.novaBlinkIntervalMs(1), 13000);
  assert.equal(F.novaBlinkIntervalMs(0.5), 10000);
  assert.equal(F.novaBlinkIntervalMs(-4), 7000, "out of range draws clamp low");
  assert.equal(F.novaBlinkIntervalMs(9), 13000, "out of range draws clamp high");
});

await test("the reopen outlasts the close: the asymmetry is her personality", () => {
  assert.ok(F.NOVA_BLINK_OPEN_MS > F.NOVA_BLINK_CLOSE_MS * 2, "the reopen must be far slower than the close");
  assert.equal(F.NOVA_BLINK_CLOSE_MS, 90);
  assert.equal(F.NOVA_BLINK_OPEN_MS, 280);
  assert.ok(F.NOVA_BLINK_HOLD_MS <= 60, "the hold stays a beat, not a nap");
});

await test("expressions are lid coverage: sleep whole, greeting lifted, deadpan past half", () => {
  assert.equal(F.novaLidCoverageFor("sleep"), 1);
  assert.ok(F.novaLidCoverageFor("fading") > F.novaLidCoverageFor("deadpan"));
  assert.ok(F.novaLidCoverageFor("deadpan") > 0.5, "deadpan drops the lids past halfway");
  assert.ok(F.novaLidCoverageFor("thinking") > F.novaLidCoverageFor("stern"));
  assert.ok(F.novaLidCoverageFor("greeting") < F.novaLidCoverageFor("pleased"));
  assert.ok(F.novaLidCoverageFor("greeting") < F.novaLidCoverageFor("stern"));
  for (const e of ["stern", "greeting", "explaining", "worried", "thinking", "pleased", "deadpan", "poked", "fading", "sleep"]) {
    const c = F.novaLidCoverageFor(e);
    assert.ok(c >= 0 && c <= 1, `${e} coverage out of range`);
  }
});

await test("framing law: full figure above 200, head and shoulders crop at 200 and below", () => {
  assert.equal(F.novaFigureModeFor(288), "full");
  assert.equal(F.novaFigureModeFor(201), "full");
  assert.equal(F.novaFigureModeFor(200), "crop");
  assert.equal(F.novaFigureModeFor(120), "crop");
  assert.equal(F.novaFigureModeFor(60), "crop", "the one small mount that reaches the figure gets the crop, never a shrink");
  assert.equal(F.novaFigureModeFor(288, true), "crop", "a bust mount crops at any size");
  assert.equal(F.novaSizeClassFor(288).name, "stage");
  assert.equal(F.novaSizeClassFor(150).name, "medium");
  assert.equal(F.novaSizeClassFor(60).name, "small");
});

await test("six gills, each on its own detuned period, sway bounded and returning to rest", () => {
  assert.equal(F.ART_GILLS.length, 6);
  const params = new Set(F.ART_GILLS.map((g) => `${g.dur}/${g.a}/${g.b}`));
  assert.equal(params.size, 6, "no two filaments share a sway: uneven timing is the life");
  for (const g of F.ART_GILLS) {
    const cap = Math.max(Math.abs(g.a), Math.abs(g.b));
    for (let t = 0; t <= g.dur * 1000; t += 137) {
      const a = F.filamentAngleAt(t, g.dur, g.a, g.b);
      assert.ok(Math.abs(a) <= cap + 1e-9, `${g.id} overshoots its sway at ${t}ms`);
    }
    assert.ok(Math.abs(F.filamentAngleAt(0, g.dur, g.a, g.b)) < 1e-9, `${g.id} does not start at rest`);
    assert.ok(Math.abs(F.filamentAngleAt(g.dur * 1000, g.dur, g.a, g.b)) < 1e-9, `${g.id} does not return to rest`);
  }
});

await test("the glance picker never serves the same target twice in a row", () => {
  for (let avoid = 0; avoid < F.NOVA_GLANCE_TARGETS.length; avoid++) {
    for (let seed = 0; seed < 500; seed++) {
      assert.notEqual(F.novaGlancePick(seed, avoid), avoid, `seed ${seed} re served glance ${avoid}`);
    }
  }
  assert.equal(JSON.stringify(F.NOVA_GLANCE_TARGETS[0]), JSON.stringify({ x: 0, y: 0 }), "the first glance target is centre: a glance returns home");
});

await test("attention shift clamps: her eyes stay inside the glasses", () => {
  assert.equal(JSON.stringify(F.novaAttentionShift(null)), JSON.stringify({ x: 0, y: 0 }));
  const far = F.novaAttentionShift({ x: 100, y: 100 });
  assert.ok(Math.abs(far.x) <= 7 && Math.abs(far.y) <= 4);
});

group("The restored figure: the laws the helpers cannot price");

await test("her mouth never performs: the plate mouth helpers stay retired", () => {
  assert.ok(figureSrc.includes('data-mouth="flat"'), "the figure does not pin her mouth still");
  assert.ok(!figureSrc.includes("novaMouthShapeAt"), "a mouth shape helper is back: speech must never move her mouth");
  assert.ok(!figureSrc.includes("novaTalkShapeAt"), "a talk shape helper is back: speech must never move her mouth");
  assert.ok(!figureSrc.includes("novaDropLidFor"), "a drop helper survived the restoration");
});

await test("reduced motion stills the clock and the glances, and the blink keeps running", () => {
  assert.ok(figureSrc.includes("nva-still"), "the figure has no reduced motion still class");
  const clockStart = figureSrc.indexOf("The motion clock");
  const clockSlice = figureSrc.slice(clockStart, figureSrc.indexOf("Lids, eyes, head", clockStart));
  assert.ok(clockSlice.includes("if (reducedMotion) return"), "the motion clock does not stop under reduced motion");
  assert.ok(figureSrc.includes("if (reducedMotion || !awake) return undefined;"), "the glances do not stop under reduced motion");
  const blinkSlice = figureSrc.slice(figureSrc.indexOf("The blink engine"), figureSrc.indexOf("Attention wake"));
  assert.ok(!blinkSlice.includes("reducedMotion"), "the blink engine must keep running under reduced motion: the blink is the one cycle it keeps");
});

await test("the seams are unchanged: canvas routing, the glyph below 120, the live mount", () => {
  assert.ok(riveSrc.includes('from "./NovaFigure.jsx"'), "the canvas no longer imports the figure");
  assert.ok(riveSrc.includes("<NovaFigure"), "the canvas no longer renders the figure");
  assert.ok(riveSrc.includes("NovaGlyph"), "the small size routing lost the approved glyph");
  assert.ok(riveSrc.includes("size < 120"), "the glyph threshold moved: below 120 is the glyph's, by the audit ruling");
  assert.ok(!riveSrc.includes("@rive-app"), "the Rive runtime is back in the wiring");
  assert.ok(figureSrc.includes('viewBox="0 0 480 640"'), "the figure canvas changed under the seam");
  assert.ok(figureSrc.includes("data-expression={expression}"), "the figure no longer keys off the expression");
});

group("Her voice: the banks, extracted from the real files");

const DASHES = ["-", "‐", "‑", "–", "—", "―"];
function assertVoiceLines(lines, where) {
  for (const line of lines) {
    assert.equal(typeof line, "string", `${where} carries a non string line`);
    for (const d of DASHES) assert.ok(!line.includes(d), `${where} line carries a dash character: ${line}`);
    assert.ok(line.length <= 175, `${where} line runs past 175 characters: ${line}`);
    assert.ok((line.match(/!/g) || []).length <= 1, `${where} line carries more than one exclamation: ${line}`);
    assert.ok(!/\bAI\b/.test(line), `${where} line names her kind: ${line}`);
    assert.ok(!/mascot/i.test(line), `${where} line uses the banned word: ${line}`);
  }
}

const R = extractDecls("src/NovaRive.jsx", ["NOVA_QUIP_BANK", "pickQuipLine"]);
const L = extractDecls("src/LearnView.jsx", [
  "NOVA_EGG_LINES", "NOVA_SUMMON_LINES", "NOVA_CELEBRATE_LINES", "NOVA_LESSON_DONE_LINES",
  "NOVA_GAG_LINES", "NOVA_LATE_LINES", "NOVA_MORNING_LINES",
  "NOVA_FEEDBACK_RIGHT_LINES", "NOVA_FEEDBACK_WRONG_LINES",
  "pickNovaLine", "pickNovaSessionLine",
]);
/* The greeting helper tests its argument with instanceof
   Date, so the probe dates are built inside the extraction
   realm: a date from the test's realm would fail that check
   and silently become now. In the browser there is one
   realm and the shipped call passes a same realm date. */
const A = extractDecls("src/CerebrumApp.jsx", ["NOVA_HOME_GREETINGS", "novaHomeGreetingAt"],
  "\n;globalThis.__at = (h) => novaHomeGreetingAt(new Date(2026, 10, 2, h, 30));" +
  "\n;globalThis.__atMin = (h, m) => novaHomeGreetingAt(new Date(2026, 10, 2, h, m));");

await test("every quip line obeys the voice laws, and every category grew by at least four", () => {
  const minimums = {
    idle: 16, fourthWall: 8, searching: 14, preprintWarning: 8, highConfidence: 8,
    quizThinking: 10, quizCorrect: 14, quizStreak: 9, quizWrong: 14,
  };
  for (const [cat, min] of Object.entries(minimums)) {
    const lines = R.NOVA_QUIP_BANK[cat];
    assert.ok(Array.isArray(lines), `the quip bank lost ${cat}`);
    assert.ok(lines.length >= min, `${cat} holds ${lines.length} lines; the alive wave promised at least ${min}`);
    assert.equal(new Set(lines).size, lines.length, `${cat} carries a duplicate line`);
    assertVoiceLines(lines, `quips/${cat}`);
  }
});

await test("every LearnView bank obeys the voice laws, at the expanded counts", () => {
  const minimums = {
    NOVA_EGG_LINES: 9, NOVA_SUMMON_LINES: 5, NOVA_CELEBRATE_LINES: 4, NOVA_LESSON_DONE_LINES: 8,
    NOVA_GAG_LINES: 3, NOVA_LATE_LINES: 5, NOVA_MORNING_LINES: 5,
    NOVA_FEEDBACK_RIGHT_LINES: 10, NOVA_FEEDBACK_WRONG_LINES: 10,
  };
  for (const [bank, min] of Object.entries(minimums)) {
    const lines = L[bank];
    assert.ok(Array.isArray(lines), `${bank} is missing`);
    assert.ok(lines.length >= min, `${bank} holds ${lines.length} lines; the alive wave promised at least ${min}`);
    assert.equal(new Set(lines).size, lines.length, `${bank} carries a duplicate line`);
    assertVoiceLines(lines, bank);
  }
});

await test("the home greetings grew, split by day part, and obey the voice laws", () => {
  assert.ok(A.NOVA_HOME_GREETINGS.length >= 10, "the home greetings did not grow past ten");
  assertVoiceLines(A.NOVA_HOME_GREETINGS, "home greetings");
  const at = (hour) => A.__at(hour);
  const late = A.NOVA_HOME_GREETINGS.slice(6, 9);
  const morning = A.NOVA_HOME_GREETINGS.slice(9, 12);
  const general = A.NOVA_HOME_GREETINGS.slice(0, 6);
  assert.ok(late.includes(at(23)), "the 23:00 greeting is not from the late set");
  assert.ok(late.includes(at(2)), "the 02:00 greeting is not from the late set");
  assert.ok(morning.includes(at(7)), "the 07:00 greeting is not from the morning set");
  assert.ok(general.includes(at(14)), "the 14:00 greeting is not from the general set");
  assert.equal(at(14), A.__atMin(14, 55), "the greeting is not steady within its day part");
});

group("Her voice: no line repeats within a session");

await test("the session picker cycles the whole bank before any repeat, per key", () => {
  const bank = ["one", "two", "three", "four", "five"];
  const seen = [];
  for (let i = 0; i < bank.length; i++) seen.push(L.pickNovaSessionLine(bank, i * 3 + 1, "alive-test-a"));
  assert.equal(new Set(seen).size, bank.length, "a line repeated inside one cycle");
  const firstOfNext = L.pickNovaSessionLine(bank, 7, "alive-test-a");
  assert.notEqual(firstOfNext, seen[seen.length - 1], "the fresh cycle opened on the line just shown");
  const other = L.pickNovaSessionLine(bank, 1, "alive-test-b");
  assert.ok(bank.includes(other), "a second key did not get its own cycle");
});

await test("pickNovaLine steps past every avoided line when it can", () => {
  const bank = ["a", "b", "c", "d"];
  for (let seed = 0; seed < 24; seed++) {
    const picked = L.pickNovaLine(bank, seed, ["a", "b", "c"]);
    assert.equal(picked, "d", `seed ${seed} served an avoided line`);
  }
  assert.equal(L.pickNovaLine(bank, 0, bank), "a", "a fully avoided bank falls back rather than refusing");
});

await test("pickQuipLine with an avoid list never serves a listed line while unlisted lines remain", () => {
  const bank = R.NOVA_QUIP_BANK.quizCorrect;
  const avoidList = bank.slice(0, bank.length - 2);
  for (let seed = 0; seed < 60; seed++) {
    const picked = R.pickQuipLine("quizCorrect", seed, null, avoidList);
    assert.ok(!avoidList.includes(picked), `seed ${seed} served a recently shown line`);
  }
  const legacy = R.pickQuipLine("quizCorrect", 3, bank[3 % bank.length]);
  assert.notEqual(legacy, bank[3 % bank.length], "the legacy three argument call lost its avoid behaviour");
});

await test("the speech controller carries a per category seen list, fed when a line shows", () => {
  const speechSrc = readFileSync(join(root, "src/NovaSpeech.jsx"), "utf8");
  assert.ok(speechSrc.includes("seenByCategory"), "the speech state carries no seen list: session repeats stay possible");
  assert.ok(speechSrc.includes("avoidMany"), "pickSpeechLine has no avoidMany pool: the seen list is never consulted");
});

console.log(`\nnova-alive: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
