/**
 * Nova's unified speech (2026-10-15).
 *
 * Nova used to speak through three fragmented surfaces, each
 * with its own gate and bubble: NovaLive's private line state,
 * the NovaTip gate, and the quip engine inside NovaRive.jsx,
 * whose isTalking feed only moved her mouth for quips. The
 * redo gathers all of it into src/NovaSpeech.jsx: one
 * controller, one bubble, a talking signal pulsed in phrase
 * bursts from the line's own punctuation, and display time
 * that scales with line length.
 *
 * The controller's decisions are pure functions over a plain
 * state object, so they are extracted by AST and run in a bare
 * VM here, the same pattern the cortex suite uses for
 * LearnView.jsx and NovaRive.jsx. No DOM, no React, no timers:
 * time, typing, and the chance roll all arrive as inputs.
 *
 * Run with: node tests/nova-speech.mjs
 * (Add "nova-speech.mjs" to the suite list in tests/run when
 * the integration pass lands; it is not listed yet because
 * tests/run is mid wave in the working tree.)
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

// ── Extract the pure speech layer from src/NovaSpeech.jsx ──
const speechSrc = readFileSync(join(root, "src/NovaSpeech.jsx"), "utf8");
const speechAst = parse(speechSrc, { sourceType: "module", plugins: ["jsx"] });

const WANTED = [
  "SPEECH_PRIORITY", "SPEECH_CAUSED_SOURCES", "SPEECH_MIN_GAP_MS", "SPEECH_QUEUE_MAX",
  "SPEECH_DISPLAY_BASE_MS", "SPEECH_READ_MS_PER_CHAR", "SPEECH_DISPLAY_MIN_MS", "SPEECH_DISPLAY_MAX_MS",
  "SPEECH_SPEAK_MS_PER_CHAR", "SPEECH_BURST_MIN_MS", "SPEECH_BURST_MAX_MS",
  "SPEECH_PAUSE_CLAUSE_MS", "SPEECH_PAUSE_SENTENCE_MS", "SPEECH_PAUSE_BREATH_MS", "SPEECH_TAIL_MS",
  "SPEECH_CADENCE_MIN", "SPEECH_CADENCE_MAX", "SPEECH_PAUSE_PUNCH_MS", "SPEECH_PUNCH_MAX_CHARS",
  "SPEECH_EXCITED_MIN_CHARS", "SPEECH_EXCITED_FACTOR", "speechCadenceFor",
  "speechSourceForCategory", "speechDurationFor", "speechPlanFor", "speechTalkingAt", "pickSpeechLine",
  "createSpeechState", "speechIsCaused", "speechShow", "speechOffer", "speechAdvance", "speechDismiss",
];
function declFor(ast, name) {
  for (const node of ast.program.body) {
    const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (!decl) continue;
    if (decl.type === "FunctionDeclaration" && decl.id && decl.id.name === name) return decl;
    if (decl.type === "VariableDeclaration") {
      const d = decl.declarations.find((x) => x.id && x.id.name === name);
      if (d) return decl;
    }
  }
  return null;
}
const chunks = [];
for (const name of WANTED) {
  const decl = declFor(speechAst, name);
  assert.ok(decl, `${name} must be declared in src/NovaSpeech.jsx`);
  chunks.push(speechSrc.slice(decl.start, decl.end));
}
const js = transformSync(chunks.join("\n") + `\n;globalThis.__x = { ${WANTED.join(", ")} };`, { loader: "jsx" }).code;
const context = vm.createContext({});
vm.runInContext(js, context);
const {
  SPEECH_PRIORITY, SPEECH_MIN_GAP_MS, SPEECH_QUEUE_MAX,
  SPEECH_DISPLAY_MIN_MS, SPEECH_DISPLAY_MAX_MS,
  SPEECH_PAUSE_CLAUSE_MS, SPEECH_PAUSE_SENTENCE_MS, SPEECH_TAIL_MS,
  SPEECH_SPEAK_MS_PER_CHAR, SPEECH_BURST_MAX_MS, SPEECH_PAUSE_PUNCH_MS, SPEECH_PUNCH_MAX_CHARS,
  SPEECH_EXCITED_MIN_CHARS, speechCadenceFor,
  speechSourceForCategory, speechDurationFor, speechPlanFor, speechTalkingAt, pickSpeechLine,
  createSpeechState, speechOffer, speechAdvance, speechDismiss,
} = context.__x;

// ── Extract the real quip tables from NovaRive.jsx, so the
// gate is also exercised against the production bank ──
const riveSrc = readFileSync(join(root, "src/NovaRive.jsx"), "utf8");
const riveAst = parse(riveSrc, { sourceType: "module", plugins: ["jsx"] });
const RIVE_WANTED = ["NOVA_QUIP_BANK", "QUIP_CATEGORY_COOLDOWN_MS", "QUIP_CATEGORY_CHANCE"];
const riveChunks = [];
for (const name of RIVE_WANTED) {
  const decl = declFor(riveAst, name);
  assert.ok(decl, `${name} must be declared in src/NovaRive.jsx`);
  riveChunks.push(riveSrc.slice(decl.start, decl.end));
}
const riveJs = transformSync(riveChunks.join("\n") + `\n;globalThis.__r = { ${RIVE_WANTED.join(", ")} };`, { loader: "jsx" }).code;
const riveContext = vm.createContext({});
vm.runInContext(riveJs, riveContext);
const { NOVA_QUIP_BANK, QUIP_CATEGORY_COOLDOWN_MS, QUIP_CATEGORY_CHANCE } = riveContext.__r;

const REAL_TABLES = { lines: NOVA_QUIP_BANK, cooldowns: QUIP_CATEGORY_COOLDOWN_MS, chances: QUIP_CATEGORY_CHANCE };
const TABLES = {
  lines: { idle: ["Line one.", "Line two."], quizCorrect: ["Correct."], searching: ["Searching."] },
  cooldowns: { idle: 240000, quizCorrect: 60000, searching: 150000 },
  chances: { idle: 0.5, quizCorrect: 0.55, searching: 0.45 },
};
const env = (now, extra = {}) => ({ now, typing: false, roll: 0, tables: TABLES, ...extra });
const T0 = 1000000;

// ══════════════════════════════════════════════════════════════
group("Line timing, display time scales with length");

await test("an empty or tiny line still gets the minimum display time", () => {
  assert.equal(speechDurationFor(""), SPEECH_DISPLAY_MIN_MS);
  assert.equal(speechDurationFor("Done."), SPEECH_DISPLAY_MIN_MS);
});

await test("a mid length line lasts base plus per character time", () => {
  const text = "x".repeat(40);
  assert.equal(speechDurationFor(text), 900 + 40 * 55);
});

await test("a long line is clamped at the maximum", () => {
  assert.equal(speechDurationFor("x".repeat(400)), SPEECH_DISPLAY_MAX_MS);
});

await test("duration grows with length across the range", () => {
  const ds = [10, 30, 60, 100, 140].map((n) => speechDurationFor("x".repeat(n)));
  for (let i = 1; i < ds.length; i++) assert.ok(ds[i] > ds[i - 1], `${ds[i]} should exceed ${ds[i - 1]}`);
});

// ══════════════════════════════════════════════════════════════
group("Speech rhythm, phrase bursts from the line's own punctuation");

await test("a sentence break splits the plan with the sentence pause", () => {
  const plan = speechPlanFor("Correct. The chance that was a guess is under one in a thousand.");
  assert.ok(plan.bursts.length >= 2, "expected at least two bursts");
  const gap = plan.bursts[1].startMs - plan.bursts[0].endMs;
  assert.equal(gap, SPEECH_PAUSE_SENTENCE_MS);
});

await test("commas produce more bursts and clause pauses", () => {
  const withCommas = speechPlanFor("Hypothesis falsified, run it again, carefully this time.");
  assert.ok(withCommas.bursts.length >= 3, `expected at least three bursts, got ${withCommas.bursts.length}`);
  const gap = withCommas.bursts[1].startMs - withCommas.bursts[0].endMs;
  assert.equal(gap, SPEECH_PAUSE_CLAUSE_MS);
  const plain = speechPlanFor("Hypothesis falsified and run it again right now carefully");
  assert.equal(plain.bursts.length, 1, "a comma free line of this length is one burst");
});

await test("bursts are ordered and never overlap", () => {
  const plan = speechPlanFor("One. Two, three. Four, five, six. Seven.");
  for (let i = 1; i < plan.bursts.length; i++) {
    assert.ok(plan.bursts[i].startMs >= plan.bursts[i - 1].endMs, "bursts must not overlap");
  }
  assert.equal(plan.speechEndMs, plan.bursts[plan.bursts.length - 1].endMs);
});

await test("talking is true inside a burst and false in the pause after it", () => {
  const plan = speechPlanFor("Correct. The chance that was a guess is under one in a thousand.");
  const duration = speechDurationFor("Correct. The chance that was a guess is under one in a thousand.");
  const midBurst = Math.floor((plan.bursts[0].startMs + plan.bursts[0].endMs) / 2);
  assert.equal(speechTalkingAt(plan, midBurst, duration), true);
  const midPause = plan.bursts[0].endMs + Math.floor(SPEECH_PAUSE_SENTENCE_MS / 2);
  assert.equal(speechTalkingAt(plan, midPause, duration), false);
});

await test("talking ends after the bubble leaves, tail included", () => {
  const plan = speechPlanFor("Correct. The chance that was a guess is under one in a thousand.");
  assert.equal(speechTalkingAt(plan, 2000 + SPEECH_TAIL_MS + 500, 2000), false);
  assert.equal(speechTalkingAt(plan, -5, 2000), false);
  assert.equal(speechTalkingAt(null, 100, 2000), false);
});

await test("a plan that outlasts its bubble finishes inside the tail, then stops", () => {
  const plan = speechPlanFor("Correct. The chance that was a guess is under one in a thousand.");
  assert.ok(plan.speechEndMs > 2600, "the fixture plan should overrun a 2600ms bubble");
  assert.equal(speechTalkingAt(plan, 2700, 2600), true, "inside the tail she finishes the phrase");
  assert.equal(speechTalkingAt(plan, 2600 + SPEECH_TAIL_MS + 10, 2600), false, "past the tail she is done");
  const short = speechPlanFor("Short.");
  assert.equal(speechTalkingAt(short, 500, 400), false, "a finished short line does not restart for the tail");
});

// ══════════════════════════════════════════════════════════════
group("The cadence: no two lines tick at the same speed");

await test("the cadence is deterministic per line and stays inside its band", () => {
  const line = "Somewhere in this lab there's a beaker I labeled do not drink.";
  assert.equal(speechCadenceFor(line), speechCadenceFor(line), "the same line earned two rhythms");
  assert.deepEqual(speechPlanFor(line), speechPlanFor(line), "the same line planned two ways");
  const f = speechCadenceFor(line);
  assert.ok(f >= 0.96 && f <= 1.08, `the cadence left its band at ${f}`);
});

await test("a short final clause lands after the punch pause, not the standard one", () => {
  const plan = speechPlanFor("The lab is quiet tonight, and the data is in. Listen.");
  assert.ok(plan.bursts.length >= 2, "the fixture should speak in bursts");
  const last = plan.bursts[plan.bursts.length - 1];
  const before = plan.bursts[plan.bursts.length - 2];
  assert.equal(last.startMs - before.endMs, SPEECH_PAUSE_PUNCH_MS,
    "the setup and punch beat is missing before the short final clause");
  assert.ok(SPEECH_PAUSE_PUNCH_MS > SPEECH_PAUSE_SENTENCE_MS, "the punch pause is not longer than a sentence pause");
  /* A long final clause earns no punch: the pause there
     stays the standard sentence pause. */
  const plain = speechPlanFor("Correct. The chance that was a guess is under one in a thousand.");
  assert.equal(plain.bursts[1].startMs - plain.bursts[0].endMs, SPEECH_PAUSE_SENTENCE_MS,
    "a long final clause borrowed the punch pause");
});

await test("a long line runs quicker than the metronome, and its bursts still respect the cap", () => {
  const long = "x".repeat(200);
  assert.ok(long.length >= SPEECH_EXCITED_MIN_CHARS, "the fixture is not in excited territory");
  const plan = speechPlanFor(long);
  assert.ok(plan.speechEndMs < long.length * SPEECH_SPEAK_MS_PER_CHAR,
    `a long excited line still ticked at the flat rate: ${plan.speechEndMs}ms for ${long.length} chars`);
  for (const b of plan.bursts) assert.ok(b.endMs - b.startMs <= SPEECH_BURST_MAX_MS, "a burst outlasted the cap");
});

// ══════════════════════════════════════════════════════════════
group("The gate, priority, queue, and one line at a time");

await test("a first ambient quip shows, and the handed in state is not mutated", () => {
  const st = createSpeechState();
  const r = speechOffer(st, { category: "idle", seed: 0 }, env(T0));
  assert.equal(r.result, "shown");
  assert.equal(r.line.text, "Line one.");
  assert.equal(st.current, null, "speechOffer must not mutate its input state");
  assert.equal(r.state.current.text, "Line one.");
});

await test("one line at a time: a second ambient offer while one is up is denied", () => {
  const r1 = speechOffer(createSpeechState(), { category: "idle", seed: 0 }, env(T0));
  const r2 = speechOffer(r1.state, { source: "brain", text: "A memory." }, env(T0 + 5000));
  assert.equal(r2.result, "denied");
  assert.equal(r2.reason, "busy");
});

await test("an ambient line never interrupts a caused line", () => {
  const r1 = speechOffer(createSpeechState(), { source: "lesson", text: "Feedback." }, env(T0));
  assert.equal(r1.result, "shown");
  const r2 = speechOffer(r1.state, { category: "idle", seed: 0 }, env(T0 + 1000));
  assert.equal(r2.result, "denied");
  assert.equal(r2.reason, "busy");
  assert.equal(r2.state.current.text, "Feedback.");
});

await test("a caused line preempts an ambient line already up", () => {
  const r1 = speechOffer(createSpeechState(), { category: "idle", seed: 0 }, env(T0));
  const r2 = speechOffer(r1.state, { source: "poke", text: "Third poke." }, env(T0 + 1000));
  assert.equal(r2.result, "shown");
  assert.equal(r2.line.text, "Third poke.");
  assert.equal(r2.preempted.text, "Line one.");
});

await test("a caused line queues behind a caused line, and advance promotes it", () => {
  const r1 = speechOffer(createSpeechState(), { source: "lesson", text: "Feedback." }, env(T0));
  const r2 = speechOffer(r1.state, { source: "search", text: "Landed." }, env(T0 + 100));
  assert.equal(r2.result, "queued");
  assert.equal(r2.state.queue.length, 1);
  const early = speechAdvance(r2.state, env(T0 + 200));
  assert.equal(early.ended, null, "nothing ends before its display time runs out");
  const done = speechAdvance(r2.state, env(T0 + r1.line.durationMs + 1));
  assert.equal(done.ended.text, "Feedback.");
  assert.equal(done.promoted.text, "Landed.");
  assert.equal(done.state.current.text, "Landed.");
  assert.equal(done.state.queue.length, 0);
});

await test("the queue is capped and refuses duplicates", () => {
  let st = speechOffer(createSpeechState(), { source: "lesson", text: "First." }, env(T0)).state;
  st = speechOffer(st, { source: "search", text: "Queued one." }, env(T0 + 1)).state;
  const dup = speechOffer(st, { source: "search", text: "Queued one." }, env(T0 + 2));
  assert.equal(dup.result, "denied");
  assert.equal(dup.reason, "duplicate");
  st = speechOffer(st, { source: "poke", text: "Queued two." }, env(T0 + 3)).state;
  st = speechOffer(st, { source: "search", text: "Queued three." }, env(T0 + 4)).state;
  assert.equal(st.queue.length, SPEECH_QUEUE_MAX);
  const full = speechOffer(st, { source: "search", text: "One too many." }, env(T0 + 5));
  assert.equal(full.result, "denied");
  assert.equal(full.reason, "queue-full");
});

await test("dismiss ends the line and clears the queue, and keeps the stamps", () => {
  let st = speechOffer(createSpeechState(), { category: "idle", seed: 0 }, env(T0)).state;
  st = speechOffer(st, { source: "search", text: "Queued." }, env(T0 + 1)).state;
  const cleared = speechDismiss(st);
  assert.equal(cleared.current, null);
  assert.equal(cleared.queue.length, 0);
  assert.equal(cleared.categoryAt.idle, T0, "a dismissal does not reset cooldowns");
});

await test("typing suppresses everything except lesson feedback", () => {
  const typing = { typing: true };
  assert.equal(speechOffer(createSpeechState(), { category: "idle", seed: 0 }, env(T0, typing)).reason, "typing");
  assert.equal(speechOffer(createSpeechState(), { source: "brain", text: "A memory." }, env(T0, typing)).reason, "typing");
  assert.equal(speechOffer(createSpeechState(), { source: "poke", text: "Third poke." }, env(T0, typing)).reason, "typing");
  const lesson = speechOffer(createSpeechState(), { source: "lesson", text: "Feedback." }, env(T0, typing));
  assert.equal(lesson.result, "shown", "lesson feedback is learner caused and lands while typing");
});

await test("ambient lines wait out the global gap from the last line of any kind", () => {
  const r1 = speechOffer(createSpeechState(), { source: "brain", text: "A memory." }, env(T0));
  assert.equal(r1.result, "shown");
  const ended = speechAdvance(r1.state, env(T0 + r1.line.durationMs + 1));
  assert.equal(ended.state.current, null);
  const soon = speechOffer(ended.state, { source: "brain", text: "Another." }, env(T0 + 30000));
  assert.equal(soon.result, "denied");
  assert.equal(soon.reason, "gap");
  const later = speechOffer(ended.state, { source: "brain", text: "Another." }, env(T0 + SPEECH_MIN_GAP_MS + 1000));
  assert.equal(later.result, "shown");
  const caused = speechOffer(ended.state, { source: "poke", text: "A poke." }, env(T0 + 5000));
  assert.equal(caused.result, "shown", "caused lines ignore the ambient gap");
});

await test("category cooldowns and chance rolls bind categorized offers", () => {
  const r1 = speechOffer(createSpeechState(), { category: "idle", seed: 0 }, env(T0));
  const ended = speechAdvance(r1.state, env(T0 + r1.line.durationMs + 1)).state;
  const cooling = speechOffer(ended, { category: "idle", seed: 0 }, env(T0 + 100000));
  assert.equal(cooling.result, "denied");
  assert.equal(cooling.reason, "cooldown");
  const unlucky = speechOffer(createSpeechState(), { category: "idle", seed: 0 }, env(T0, { roll: 0.9 }));
  assert.equal(unlucky.result, "denied");
  assert.equal(unlucky.reason, "chance");
  const after = speechOffer(ended, { category: "idle", seed: 0 }, env(T0 + 241000));
  assert.equal(after.result, "shown");
  assert.equal(after.line.text, "Line two.", "the bank does not repeat the line it showed last");
});

await test("unknown categories and empty lines are denied", () => {
  assert.equal(speechOffer(createSpeechState(), { category: "nope" }, env(T0)).reason, "unknown-category");
  assert.equal(speechOffer(createSpeechState(), { source: "brain", text: "   " }, env(T0)).reason, "empty");
});

await test("categories map to their sources", () => {
  assert.equal(speechSourceForCategory("searching"), "search");
  assert.equal(speechSourceForCategory("highConfidence"), "search");
  assert.equal(speechSourceForCategory("preprintWarning"), "search");
  assert.equal(speechSourceForCategory("quizThinking"), "lesson");
  assert.equal(speechSourceForCategory("quizCorrect"), "lesson");
  assert.equal(speechSourceForCategory("quizStreak"), "lesson");
  assert.equal(speechSourceForCategory("quizWrong"), "lesson");
  assert.equal(speechSourceForCategory("idle"), "quip");
  assert.equal(speechSourceForCategory("fourthWall"), "quip");
});

await test("priorities put lesson feedback and reactions above ambient lines", () => {
  assert.ok(SPEECH_PRIORITY.lesson > SPEECH_PRIORITY.poke);
  assert.ok(SPEECH_PRIORITY.poke > SPEECH_PRIORITY.search);
  assert.ok(SPEECH_PRIORITY.search > SPEECH_PRIORITY.brain);
  assert.ok(SPEECH_PRIORITY.brain > SPEECH_PRIORITY.tip);
  assert.ok(SPEECH_PRIORITY.tip > SPEECH_PRIORITY.quip);
});

await test("advance drops a queued reaction that would land on typing hands, and promotes the lesson line behind it", () => {
  let st = speechOffer(createSpeechState(), { source: "lesson", text: "First feedback." }, env(T0)).state;
  st = speechOffer(st, { source: "search", text: "Search landed." }, env(T0 + 1)).state;
  st = speechOffer(st, { source: "lesson", text: "Second feedback." }, env(T0 + 2)).state;
  const adv = speechAdvance(st, env(T0 + 10000, { typing: true }));
  assert.equal(adv.state.current.text, "Second feedback.");
  assert.equal(adv.state.queue.length, 0);
});

await test("pickSpeechLine picks by seed, avoids a repeat, and refuses an empty bank", () => {
  assert.equal(pickSpeechLine(["a", "b"], 0), "a");
  assert.equal(pickSpeechLine(["a", "b"], 0, "a"), "b");
  assert.equal(pickSpeechLine([], 0), null);
  assert.equal(pickSpeechLine(null, 0), null);
});

// ══════════════════════════════════════════════════════════════
group("Against the production quip bank and tables");

await test("a real quip category offers a real line through the real tables", () => {
  const r = speechOffer(createSpeechState(), { category: "idle", seed: 1 }, { now: T0, typing: false, roll: 0, tables: REAL_TABLES });
  assert.equal(r.result, "shown");
  assert.ok(NOVA_QUIP_BANK.idle.includes(r.line.text), "the shown line must come from the real bank");
  assert.equal(r.line.source, "quip");
  assert.ok(r.line.durationMs >= SPEECH_DISPLAY_MIN_MS && r.line.durationMs <= SPEECH_DISPLAY_MAX_MS);
  assert.ok(r.line.plan.speechEndMs > 0, "the shown line carries a speech plan");
});

await test("a real search category speaks with the search source", () => {
  const r = speechOffer(createSpeechState(), { category: "preprintWarning", seed: 0 }, { now: T0, typing: false, roll: 0, tables: REAL_TABLES });
  assert.equal(r.result, "shown");
  assert.equal(r.line.source, "search");
});

// ══════════════════════════════════════════════════════════════
group("The module surface, pinned by source");

await test("NovaSpeech imports and re exports the quip bank from NovaRive", () => {
  assert.ok(speechSrc.includes('from "./NovaRive.jsx"'), "NovaSpeech must import from NovaRive.jsx");
  assert.ok(speechSrc.includes("export { NOVA_QUIP_BANK };"), "the quip bank must be re exported untouched");
  assert.ok(speechSrc.includes("NOVA_SPEECH_BANKS"), "the banks map must exist");
});

await test("the brain banks from LearnView are consumable from the module", () => {
  assert.ok(speechSrc.includes('from "./LearnView.jsx"'), "NovaSpeech must import from LearnView.jsx");
  for (const name of ["NOVA_SUMMON_LINES", "NOVA_CELEBRATE_LINES", "NOVA_LESSON_DONE_LINES"]) {
    assert.ok(speechSrc.includes(name), `${name} must be imported`);
  }
});

await test("the hook and the one bubble are exported", () => {
  assert.ok(speechSrc.includes("export function useNovaSpeech"), "useNovaSpeech must be exported");
  assert.ok(speechSrc.includes("export function NovaBubble"), "NovaBubble must be exported");
  for (const variant of ['"stage"', '"header"', '"sheet"']) {
    assert.ok(speechSrc.includes(variant), `NovaBubble must know the ${variant} variant`);
  }
});

await test("the integration contract is written at the top of the module", () => {
  assert.ok(speechSrc.includes("INTEGRATION CONTRACT"), "the contract comment must exist");
  assert.ok(speechSrc.includes("useNovaQuips"), "the contract must name what NovaRive gives up");
  assert.ok(speechSrc.includes("NovaTip"), "the contract must cover the tip gate");
});

console.log(`\nnova-speech: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
