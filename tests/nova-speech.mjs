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
  "SPEECH_QUEUED_TTL_MS", "speechSanitizeText", "speechSetContext",
  "SPEECH_BUBBLE_VIEWPORT_MARGIN", "speechBubbleShiftFor", "speechBubbleStyleFor",
  "SPEECH_TRIGGERS", "speechCauseOf", "speechCauseLive",
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
/* The sheet geometry reads RADIUS.xl from the design system;
   the VM gets the token's shipped value (2, src/designSystem.jsx)
   as a global so the extracted style function can run bare. */
const context = vm.createContext({ RADIUS: { xl: 2 } });
vm.runInContext(js, context);
const {
  SPEECH_PRIORITY, SPEECH_MIN_GAP_MS, SPEECH_QUEUE_MAX,
  SPEECH_DISPLAY_MIN_MS, SPEECH_DISPLAY_MAX_MS,
  SPEECH_PAUSE_CLAUSE_MS, SPEECH_PAUSE_SENTENCE_MS, SPEECH_TAIL_MS,
  SPEECH_SPEAK_MS_PER_CHAR, SPEECH_BURST_MAX_MS, SPEECH_PAUSE_PUNCH_MS, SPEECH_PUNCH_MAX_CHARS,
  SPEECH_EXCITED_MIN_CHARS, speechCadenceFor,
  speechSourceForCategory, speechDurationFor, speechPlanFor, speechTalkingAt, pickSpeechLine,
  createSpeechState, speechOffer, speechAdvance, speechDismiss,
  SPEECH_QUEUED_TTL_MS, speechSanitizeText, speechSetContext,
  SPEECH_BUBBLE_VIEWPORT_MARGIN, speechBubbleShiftFor, speechBubbleStyleFor,
  SPEECH_TRIGGERS, speechCauseOf, speechCauseLive,
} = context.__x;

// ── Extract the real quip tables from NovaRive.jsx, so the
// gate is also exercised against the production bank ──
const riveSrc = readFileSync(join(root, "src/NovaRive.jsx"), "utf8");
const riveAst = parse(riveSrc, { sourceType: "module", plugins: ["jsx"] });
const RIVE_WANTED = ["NOVA_QUIP_BANK", "QUIP_CATEGORY_COOLDOWN_MS"];
const riveChunks = [];
for (const name of RIVE_WANTED) {
  const decl = declFor(riveAst, name);
  assert.ok(decl, `${name} must be declared in src/NovaRive.jsx`);
  riveChunks.push(riveSrc.slice(decl.start, decl.end));
}
const riveJs = transformSync(riveChunks.join("\n") + `\n;globalThis.__r = { ${RIVE_WANTED.join(", ")} };`, { loader: "jsx" }).code;
const riveContext = vm.createContext({});
vm.runInContext(riveJs, riveContext);
const { NOVA_QUIP_BANK, QUIP_CATEGORY_COOLDOWN_MS } = riveContext.__r;

const REAL_TABLES = { lines: NOVA_QUIP_BANK, cooldowns: QUIP_CATEGORY_COOLDOWN_MS };
const TABLES = {
  lines: { quizCorrect: ["Correct.", "Right."], quizWrong: ["Not quite."], highConfidence: ["Strong signal."] },
  cooldowns: { quizCorrect: 60000, quizWrong: 60000, highConfidence: 150000 },
};
/* Causes (2026-10-29, dialog spec Lane 1): every offer carries
   its cause record, and an offer with no cause, a trigger
   outside SPEECH_TRIGGERS, or one of the retired narration
   categories is denied before wording is considered. The
   fixtures below speak the new law: lesson verdicts, pokes,
   search landings, and screen fact memory lines. */
const CAUSE = {
  lesson: { trigger: "lesson-verdict", surface: "lesson", subject: "L1:0" },
  lessonOther: { trigger: "lesson-verdict", surface: "lesson", subject: "L1:1" },
  poke: { trigger: "poke", surface: "nova-home", subject: "poke-ladder" },
  brain: { trigger: "memory-screen-fact", surface: "nova-home", subject: "fact-1" },
  hour: { trigger: "hour-arrival", surface: "nova-home", subject: "morning:1" },
};
const searchCause = (stamp) => ({ trigger: "search-landed", surface: "search", subject: "search@" + stamp });
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

await test("an offer with no cause is denied by construction, whatever it carries", () => {
  /* Dialog spec Lane 1 (2026-10-29): the cause is judged
     first. No cause, no line, and the denial names itself. */
  assert.equal(speechOffer(createSpeechState(), { source: "brain", text: "A memory." }, env(T0)).reason, "no-cause");
  assert.equal(speechOffer(createSpeechState(), { category: "quizCorrect", seed: 0 }, env(T0)).reason, "no-cause");
  assert.equal(speechOffer(createSpeechState(), { source: "lesson", text: "Feedback.", cause: { trigger: "made-up", surface: "lesson", subject: "x" } }, env(T0)).reason, "no-cause",
    "a trigger outside the closed list is no cause at all");
  assert.ok(SPEECH_TRIGGERS.includes("lesson-verdict") && SPEECH_TRIGGERS.includes("search-landed"), "the closed trigger list lost a member");
  const parsed = speechCauseOf({ cause: CAUSE.lesson });
  assert.equal(parsed.trigger, "lesson-verdict");
  assert.equal(parsed.surface, "lesson");
  assert.equal(parsed.subject, "L1:0");
  assert.equal(speechCauseOf({}), null);
});

await test("the retired narration categories are denied even with a cause", () => {
  /* She does not narrate starting, idling, or the fourth
     wall: those categories are garnish triggers, and the
     trigger list is closed. */
  for (const category of ["searching", "idle", "fourthWall"]) {
    const r = speechOffer(createSpeechState(), { category, seed: 0, cause: CAUSE.lesson }, env(T0));
    assert.equal(r.result, "denied", `${category} still speaks`);
    assert.equal(r.reason, "trigger-not-allowed", `${category} denied for the wrong reason`);
  }
});

await test("a first caused line shows, and the handed in state is not mutated", () => {
  const st = createSpeechState();
  const r = speechOffer(st, { category: "quizCorrect", seed: 0, cause: CAUSE.lesson }, env(T0));
  assert.equal(r.result, "shown");
  assert.equal(r.line.text, "Correct.");
  assert.equal(st.current, null, "speechOffer must not mutate its input state");
  assert.equal(r.state.current.text, "Correct.");
  assert.equal(r.line.cause.subject, "L1:0", "the shown line does not carry its cause");
});

await test("one line at a time: a second ambient offer while one is up is denied", () => {
  const r1 = speechOffer(createSpeechState(), { category: "quizCorrect", seed: 0, cause: CAUSE.lesson }, env(T0));
  const r2 = speechOffer(r1.state, { source: "brain", text: "A memory.", cause: CAUSE.brain }, env(T0 + 5000));
  assert.equal(r2.result, "denied");
  assert.equal(r2.reason, "busy");
});

await test("an ambient line never interrupts a caused line", () => {
  const r1 = speechOffer(createSpeechState(), { source: "lesson", text: "Feedback.", cause: CAUSE.lesson }, env(T0));
  assert.equal(r1.result, "shown");
  const r2 = speechOffer(r1.state, { source: "brain", text: "A memory.", cause: CAUSE.brain }, env(T0 + 1000));
  assert.equal(r2.result, "denied");
  assert.equal(r2.reason, "busy");
  assert.equal(r2.state.current.text, "Feedback.");
});

await test("a caused line preempts an ambient line already up", () => {
  const r1 = speechOffer(createSpeechState(), { source: "brain", text: "A memory.", cause: CAUSE.brain }, env(T0));
  const r2 = speechOffer(r1.state, { source: "poke", text: "Third poke.", cause: CAUSE.poke }, env(T0 + 1000));
  assert.equal(r2.result, "shown");
  assert.equal(r2.line.text, "Third poke.");
  assert.equal(r2.preempted.text, "A memory.");
});

await test("a caused line queues behind a caused line, and advance promotes it", () => {
  const r1 = speechOffer(createSpeechState(), { source: "lesson", text: "Feedback.", cause: CAUSE.lesson }, env(T0));
  const r2 = speechOffer(r1.state, { source: "search", text: "Landed.", cause: searchCause(1) }, env(T0 + 100));
  assert.equal(r2.result, "queued");
  assert.equal(r2.state.queue.length, 1);
  const early = speechAdvance(r2.state, env(T0 + 200));
  assert.equal(early.ended, null, "nothing ends before its display time runs out");
  /* Promotion judges the search cause (2026-10-29): the
     search it answers is still the latest, and the learner
     is still on the search surface, so the line promotes.
     This is the 36a06a9 pinned shape, kept: no clock TTL
     stands in its way. */
  const done = speechAdvance(r2.state, env(T0 + r1.line.durationMs + 1, { latestSearch: "search@1", onSearchSurface: true }));
  assert.equal(done.ended.text, "Feedback.");
  assert.equal(done.promoted.text, "Landed.");
  assert.equal(done.state.current.text, "Landed.");
  assert.equal(done.state.queue.length, 0);
});

await test("a queued search line whose search is no longer the latest dies in silence at promotion", () => {
  const r1 = speechOffer(createSpeechState(), { source: "lesson", text: "Feedback.", cause: CAUSE.lesson }, env(T0));
  const r2 = speechOffer(r1.state, { source: "search", text: "Landed.", cause: searchCause(1) }, env(T0 + 100));
  const stale = speechAdvance(r2.state, env(T0 + r1.line.durationMs + 1, { latestSearch: "search@2", onSearchSurface: true }));
  assert.equal(stale.ended.text, "Feedback.");
  assert.equal(stale.promoted, null, "a stale search line was spoken late");
  assert.equal(stale.state.queue.length, 0);
  const offSurface = speechAdvance(r2.state, env(T0 + r1.line.durationMs + 1, { latestSearch: "search@1", onSearchSurface: false }));
  assert.equal(offSurface.promoted, null, "a search line promoted after the learner left the search surface");
});

await test("the queue is capped and refuses duplicates", () => {
  let st = speechOffer(createSpeechState(), { source: "lesson", text: "First.", cause: CAUSE.lesson }, env(T0)).state;
  st = speechOffer(st, { source: "search", text: "Queued one.", cause: searchCause(1) }, env(T0 + 1)).state;
  const dup = speechOffer(st, { source: "search", text: "Queued one.", cause: searchCause(1) }, env(T0 + 2));
  assert.equal(dup.result, "denied");
  assert.equal(dup.reason, "duplicate");
  st = speechOffer(st, { source: "poke", text: "Queued two.", cause: CAUSE.poke }, env(T0 + 3)).state;
  st = speechOffer(st, { source: "search", text: "Queued three.", cause: searchCause(1) }, env(T0 + 4)).state;
  assert.equal(st.queue.length, SPEECH_QUEUE_MAX);
  /* Overflow (2026-10-29): the cap used to refuse the new
     line outright. Reactions are perishable, so the new line
     now drops the oldest queued line it outranks or matches
     (here the search line at the head; the poke line outranks
     the newcomer and stays) and takes the tail. */
  const full = speechOffer(st, { source: "search", text: "One too many.", cause: searchCause(1) }, env(T0 + 5));
  assert.equal(full.result, "queued");
  assert.equal(full.dropped.text, "Queued one.");
  assert.equal(full.state.queue.length, SPEECH_QUEUE_MAX);
  assert.deepEqual([...full.state.queue.map((q) => q.text)], ["Queued two.", "Queued three.", "One too many."]);
  /* A queue full of lines that all outrank the newcomer
     still refuses it: nothing in it is the newcomer's to
     drop. */
  let top = speechOffer(createSpeechState(), { source: "lesson", text: "Showing.", cause: CAUSE.lesson }, env(T0)).state;
  top = speechOffer(top, { source: "lesson", text: "Lesson one.", cause: CAUSE.lesson }, env(T0 + 1)).state;
  top = speechOffer(top, { source: "lesson", text: "Lesson two.", cause: CAUSE.lesson }, env(T0 + 2)).state;
  top = speechOffer(top, { source: "lesson", text: "Lesson three.", cause: CAUSE.lesson }, env(T0 + 3)).state;
  const refused = speechOffer(top, { source: "search", text: "Too weak.", cause: searchCause(1) }, env(T0 + 4));
  assert.equal(refused.result, "denied");
  assert.equal(refused.reason, "queue-full");
});

await test("dismissal is scoped: same cause drops, a live caused line survives, stamps keep", () => {
  /* Dialog spec 2.5 (2026-10-29), replacing the clear
     everything dismissal: ending her line no longer discards
     a teaching line the learner is still owed. */
  let st = speechOffer(createSpeechState(), { category: "quizCorrect", seed: 0, cause: CAUSE.lesson }, env(T0)).state;
  st = speechOffer(st, { source: "lesson", text: "Teach.", contextKey: "L1:0", cause: CAUSE.lesson }, env(T0 + 1)).state;
  st = speechOffer(st, { source: "poke", text: "A poke.", cause: CAUSE.poke }, env(T0 + 2)).state;
  const cleared = speechDismiss(st, env(T0 + 3));
  assert.equal(cleared.current, null);
  assert.deepEqual([...cleared.queue.map((q) => q.text)], ["A poke."],
    "the queued line of the dismissed cause should drop and the live poke line should survive");
  assert.equal(cleared.categoryAt.quizCorrect, T0, "a dismissal does not reset cooldowns");
  assert.equal(cleared.dismissals, 1, "the dismissal was not counted");
});

await test("two dismissals in a session silence ambient and arrival lines, caused lines still answer", () => {
  let st = speechOffer(createSpeechState(), { source: "lesson", text: "One.", cause: CAUSE.lesson }, env(T0)).state;
  st = speechDismiss(st, env(T0 + 1));
  st = speechOffer(st, { source: "lesson", text: "Two.", cause: CAUSE.lesson }, env(T0 + 2)).state;
  st = speechDismiss(st, env(T0 + 3));
  assert.equal(st.quietSession, true, "the second dismissal did not ask for quiet");
  const ambient = speechOffer(st, { source: "brain", text: "A memory.", cause: CAUSE.brain }, env(T0 + 4000));
  assert.equal(ambient.result, "denied");
  assert.equal(ambient.reason, "quiet-session");
  const arrival = speechOffer(st, { source: "brain", text: "Morning.", cause: CAUSE.hour }, env(T0 + 4000));
  assert.equal(arrival.result, "denied");
  assert.equal(arrival.reason, "quiet-session");
  const caused = speechOffer(st, { source: "lesson", text: "Feedback.", cause: CAUSE.lesson }, env(T0 + 4000));
  assert.equal(caused.result, "shown", "a caused lesson line stopped answering the learner's own action");
});

await test("typing suppresses everything except lesson feedback", () => {
  const typing = { typing: true };
  assert.equal(speechOffer(createSpeechState(), { source: "brain", text: "A memory.", cause: CAUSE.brain }, env(T0, typing)).reason, "typing");
  assert.equal(speechOffer(createSpeechState(), { source: "poke", text: "Third poke.", cause: CAUSE.poke }, env(T0, typing)).reason, "typing");
  const lesson = speechOffer(createSpeechState(), { source: "lesson", text: "Feedback.", cause: CAUSE.lesson }, env(T0, typing));
  assert.equal(lesson.result, "shown", "lesson feedback is learner caused and lands while typing");
});

await test("ambient lines wait out the global gap from the last line of any kind", () => {
  const r1 = speechOffer(createSpeechState(), { source: "brain", text: "A memory.", cause: CAUSE.brain }, env(T0));
  assert.equal(r1.result, "shown");
  const ended = speechAdvance(r1.state, env(T0 + r1.line.durationMs + 1));
  assert.equal(ended.state.current, null);
  const soon = speechOffer(ended.state, { source: "brain", text: "Another.", cause: CAUSE.brain }, env(T0 + 30000));
  assert.equal(soon.result, "denied");
  assert.equal(soon.reason, "gap");
  const later = speechOffer(ended.state, { source: "brain", text: "Another.", cause: CAUSE.brain }, env(T0 + SPEECH_MIN_GAP_MS + 1000));
  assert.equal(later.result, "shown");
  const caused = speechOffer(ended.state, { source: "poke", text: "A poke.", cause: CAUSE.poke }, env(T0 + 5000));
  assert.equal(caused.result, "shown", "caused lines ignore the ambient gap");
});

await test("category cooldowns bind categorized offers, and no roll decides speech", () => {
  /* Dialog spec Lane 1 (2026-10-29): QUIP_CATEGORY_CHANCE is
     deleted as a gate. Cooldowns survive as wording and
     family discipline; a roll, where one is handed in at
     all, is never consulted. */
  assert.ok(!riveSrc.includes("QUIP_CATEGORY_CHANCE"), "the chance table came back in NovaRive");
  const r1 = speechOffer(createSpeechState(), { category: "quizCorrect", seed: 0, cause: CAUSE.lesson }, env(T0));
  assert.equal(r1.result, "shown");
  const ended = speechAdvance(r1.state, env(T0 + r1.line.durationMs + 1)).state;
  const cooling = speechOffer(ended, { category: "quizCorrect", seed: 0, cause: CAUSE.lesson }, env(T0 + 30000));
  assert.equal(cooling.result, "denied");
  assert.equal(cooling.reason, "cooldown");
  const unlucky = speechOffer(createSpeechState(), { category: "quizCorrect", seed: 0, cause: CAUSE.lesson }, env(T0, { roll: 0.99 }));
  assert.equal(unlucky.result, "shown", "a handed in roll still gates speech");
  const after = speechOffer(ended, { category: "quizCorrect", seed: 0, cause: CAUSE.lesson }, env(T0 + 61000));
  assert.equal(after.result, "shown");
  assert.equal(after.line.text, "Right.", "the bank does not repeat the line it showed last");
});

await test("unknown categories and empty lines are denied", () => {
  assert.equal(speechOffer(createSpeechState(), { category: "nope", cause: CAUSE.lesson }, env(T0)).reason, "unknown-category");
  assert.equal(speechOffer(createSpeechState(), { source: "brain", text: "   ", cause: CAUSE.brain }, env(T0)).reason, "empty");
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
  let st = speechOffer(createSpeechState(), { source: "lesson", text: "First feedback.", cause: CAUSE.lesson }, env(T0)).state;
  st = speechOffer(st, { source: "search", text: "Search landed.", cause: searchCause(1) }, env(T0 + 1)).state;
  st = speechOffer(st, { source: "lesson", text: "Second feedback.", cause: CAUSE.lesson }, env(T0 + 2)).state;
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
group("Card context: a card's lines die with the card (2026-10-29)");

await test("queued lesson lines carry their card's key", () => {
  let st = speechOffer(createSpeechState(), { source: "lesson", text: "Opener.", contextKey: "L1:0", cause: CAUSE.lesson }, env(T0)).state;
  const r = speechOffer(st, { source: "lesson", text: "Teach.", contextKey: "L1:0", cause: CAUSE.lesson }, env(T0 + 10));
  assert.equal(r.result, "queued");
  assert.equal(r.line.contextKey, "L1:0");
  assert.equal(r.state.current.contextKey, "L1:0");
});

await test("setting a new context drops the old card's queue and ends its current line", () => {
  let st = speechOffer(createSpeechState(), { source: "lesson", text: "Opener.", contextKey: "L1:0", cause: CAUSE.lesson }, env(T0)).state;
  st = speechOffer(st, { source: "lesson", text: "Teach.", contextKey: "L1:0", cause: CAUSE.lesson }, env(T0 + 10)).state;
  st = speechOffer(st, { source: "poke", text: "A poke.", cause: CAUSE.poke }, env(T0 + 20)).state;
  const moved = speechSetContext(st, "L1:1");
  assert.equal(moved.contextKey, "L1:1");
  assert.equal(moved.current, null, "the old card's line still on stage survived the card change");
  assert.deepEqual([...moved.queue.map((q) => q.text)], ["A poke."], "the untagged poke line belongs to no card and stays");
  const cleared = speechSetContext(st, null);
  assert.equal(cleared.current, null, "clearing the context ends the card's current line");
  assert.equal(cleared.queue.length, 1, "clearing the context drops only the card's own lines");
});

await test("advance never promotes a line from a context the stage has left", () => {
  let st = speechOffer(createSpeechState(), { source: "lesson", text: "Showing.", contextKey: "L1:1", cause: CAUSE.lessonOther }, env(T0)).state;
  st = speechOffer(st, { source: "lesson", text: "Old card teach.", contextKey: "L1:0", cause: CAUSE.lesson }, env(T0 + 10)).state;
  st = speechSetContext(st, "L1:1");
  assert.equal(st.queue.length, 0, "the stale line should already be gone at the context change");
  const adv = speechAdvance(st, env(T0 + 10000));
  assert.equal(adv.promoted, null);
});

await test("a queued poke line past its start TTL is dropped, inside it is promoted", () => {
  assert.equal(SPEECH_QUEUED_TTL_MS, 2000);
  /* Real path: a poke queues behind a lesson line, whose
     minimum display (2.4s) already outlasts the TTL, so by
     the time the stage frees up the reaction is stale and
     is dropped rather than spoken late. */
  let st = speechOffer(createSpeechState(), { source: "lesson", text: "Feedback.", cause: CAUSE.lesson }, env(T0)).state;
  st = speechOffer(st, { source: "poke", text: "Third poke.", cause: CAUSE.poke }, env(T0 + 100)).state;
  assert.equal(st.queue[0].ttlMs, SPEECH_QUEUED_TTL_MS);
  const late = speechAdvance(st, env(T0 + 2500));
  assert.equal(late.ended.text, "Feedback.");
  assert.equal(late.promoted, null, "a poke line that waited past its TTL still got spoken");
  assert.equal(late.state.queue.length, 0);
  /* Inside the TTL the same line promotes normally. The
     current line's short duration is hand set here because
     no real line displays for less than the 2.4s floor; the
     arbitration reads only the fields it is handed. */
  const hand = {
    ...createSpeechState(),
    current: { id: 1, text: "Brief.", source: "lesson", category: null, owner: null, contextKey: null, shownAt: T0, durationMs: 1000, plan: speechPlanFor("Brief.") },
    queue: [{ id: 0, text: "Third poke.", source: "poke", category: null, owner: null, contextKey: null, queuedAt: T0 + 100, ttlMs: SPEECH_QUEUED_TTL_MS, shownAt: 0, durationMs: 2400, plan: speechPlanFor("Third poke.") }],
    seq: 1,
  };
  const inTime = speechAdvance(hand, env(T0 + 1500));
  assert.equal(inTime.promoted.text, "Third poke.");
});

// ══════════════════════════════════════════════════════════════
group("Long lines are never cut mid line (2026-10-29)");

await test("a long miss feedback line's display covers its whole mouth plan", () => {
  /* Her longest lines are miss feedback: the correction,
     then the full why. This one is 292 characters, inside
     the audited band where the plan outran the 9 second
     clamp and her mouth stopped mid line. */
  const long = "The answer was: The gill rakers strain the water as it passes. "
    + "Each raker is a small comb of bone, and together they sieve food from the flow before it leaves through the gill slits, "
    + "so the animal feeds and breathes in one motion, never pausing to swallow the way a jawed hunter must between bites at all.";
  assert.ok(long.length > 260 && long.length < 320, `the fixture should sit in the audited band, got ${long.length}`);
  const r = speechOffer(createSpeechState(), { source: "lesson", text: long, cause: CAUSE.lesson }, env(T0));
  assert.equal(r.result, "shown");
  assert.ok(r.line.plan.speechEndMs > SPEECH_DISPLAY_MAX_MS,
    `the fixture's plan should outrun the old clamp, got ${r.line.plan.speechEndMs}ms`);
  assert.ok(r.line.durationMs + SPEECH_TAIL_MS >= r.line.plan.speechEndMs,
    `display ${r.line.durationMs}ms plus tail still cuts the plan at ${r.line.plan.speechEndMs}ms`);
  const justBefore = speechAdvance(r.state, env(T0 + r.line.plan.speechEndMs - SPEECH_TAIL_MS - 1));
  assert.equal(justBefore.ended, null, "her line ended before her mouth finished it");
  const after = speechAdvance(r.state, env(T0 + r.line.durationMs + 1));
  assert.equal(after.ended.text, long);
});

await test("short lines keep their reading time exactly (the plan only ever extends)", () => {
  const r = speechOffer(createSpeechState(), { source: "lesson", text: "Feedback.", cause: CAUSE.lesson }, env(T0));
  assert.equal(r.line.durationMs, speechDurationFor("Feedback."));
});

// ══════════════════════════════════════════════════════════════
group("The dash sanitizer at the controller (2026-10-29)");

await test("speechSanitizeText speaks the words and drops every dash", () => {
  const DASHES = /[-‐-―−]/;
  assert.equal(speechSanitizeText("A well-known result."), "A well known result.");
  assert.equal(speechSanitizeText("Seen in 10-20 trials."), "Seen in 10 to 20 trials.");
  assert.equal(speechSanitizeText("It fell by -3 degrees."), "It fell by minus 3 degrees.");
  assert.equal(speechSanitizeText("A state—of—the—art sieve."), "A state of the art sieve.");
  assert.equal(speechSanitizeText("Line one."), "Line one.", "a clean line passes through untouched");
  for (const s of ["X-ray thin", "pages 4–9", "pre-registered, well-known", "Δ of −2"]) {
    assert.ok(!DASHES.test(speechSanitizeText(s)), `a dash survived in: ${s}`);
  }
});

await test("an assembled line carrying dashes is sanitized before it is shown or queued", () => {
  const dirty = "The answer was: A well-known sieve, proven in 10-20 trials.";
  const r = speechOffer(createSpeechState(), { source: "lesson", text: dirty, cause: CAUSE.lesson }, env(T0));
  assert.equal(r.result, "shown");
  assert.equal(r.line.text, "The answer was: A well known sieve, proven in 10 to 20 trials.");
});

// ══════════════════════════════════════════════════════════════
group("Against the production quip bank and tables");

await test("a real lesson category offers a real line through the real tables", () => {
  const r = speechOffer(createSpeechState(), { category: "quizCorrect", seed: 1, cause: CAUSE.lesson }, { now: T0, typing: false, roll: 0, tables: REAL_TABLES });
  assert.equal(r.result, "shown");
  assert.ok(NOVA_QUIP_BANK.quizCorrect.includes(r.line.text), "the shown line must come from the real bank");
  assert.equal(r.line.source, "lesson");
  assert.ok(r.line.durationMs >= SPEECH_DISPLAY_MIN_MS && r.line.durationMs <= SPEECH_DISPLAY_MAX_MS + 9000,
    "the shown line's display time is outside the priced band (the plan floor may extend it)");
  assert.ok(r.line.plan.speechEndMs > 0, "the shown line carries a speech plan");
});

await test("a real search category speaks with the search source", () => {
  const r = speechOffer(createSpeechState(), { category: "preprintWarning", seed: 0, cause: searchCause(1) }, { now: T0, typing: false, roll: 0, tables: REAL_TABLES });
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
  for (const variant of ['"header"', '"sheet"', '"flow"']) {
    assert.ok(speechSrc.includes(variant), `NovaBubble must know the ${variant} variant`);
  }
});

await test("the integration contract is written at the top of the module", () => {
  assert.ok(speechSrc.includes("INTEGRATION CONTRACT"), "the contract comment must exist");
  assert.ok(speechSrc.includes("useNovaQuips"), "the contract must name what NovaRive gives up");
  assert.ok(speechSrc.includes("NovaTip"), "the contract must cover the tip gate");
});

// ── The header bubble viewport clamp (2026-10-16, layout
// audit findings 3 and 20) ──
group("The header bubble clamp (2026-10-16)");

await test("speechBubbleShiftFor keeps a fitting bubble unshifted and clamps both edges", () => {
  assert.equal(SPEECH_BUBBLE_VIEWPORT_MARGIN, 8);
  assert.equal(speechBubbleShiftFor(500, 250, 1000), 0, "a centered bubble on a wide screen must not move");
  // The header figure case from the audit: center at 77px, a
  // 250px bubble on a 360px screen starts 48px off the left
  // edge; the shift puts its left edge on the 8px margin.
  assert.equal(speechBubbleShiftFor(77, 250, 360), 56, "the header figure bubble is not clamped onto the screen");
  assert.equal(speechBubbleShiftFor(330, 250, 390), -73, "a bubble past the right margin is not pulled back");
  assert.equal(speechBubbleShiftFor(0, 0, 360), 0, "degenerate sizes read as no shift");
});

await test("the bubble caps its width at the viewport and the sheet dismiss is 44px", () => {
  assert.ok(speechSrc.includes('maxWidth: "min(250px, calc(100vw - 16px))"'), "the header bubble width is not capped at the viewport");
  assert.ok(speechSrc.includes("width: 44, height: 44"), "the sheet dismiss hit area is under the 44px tap floor");
});

// ── The sheet bubble geometry (2026-10-18, the feedback
// sheet bubble repair). The owner's photo: on the lesson
// feedback sheet her teaching bubble rendered as the header
// bubble, a narrow column floating over the sheet's text,
// clipped mid word on its left edge. The mechanism, from the
// shipped values: NovaCanvas handed every speaking surface
// variant "header" (absolute, centered on the figure's
// anchor, max-content width capped at 250px); the sheet
// figure is 48px in a 62px anchor at the sheet column's left
// edge, so a full width header bubble's box extends
// 250/2 - 62/2 = 94px past the column, the viewport clamp
// never fires on desktop (the box is nowhere near the
// window's edge), and the sheet scroll box
// (.lv-sheet-scroll, overflowY auto) clips the overhang and
// the first ~83px of every text line with it. The pins below
// hold the corrected contract: the sheet variant is in flow
// and container sized, and the header geometry it must never
// borrow again is unchanged for the surfaces that own it. ──
group("The sheet bubble geometry (2026-10-18)");

await test("the sheet variant is in flow: relative, block, and sized by its container, not by any figure", () => {
  const sheet = speechBubbleStyleFor("sheet");
  assert.equal(sheet.position, "relative", "the sheet bubble is not in flow");
  assert.equal(sheet.display, "block", "the sheet bubble does not lay out as a block in its container");
  assert.equal(sheet.width, "100%", "the sheet bubble's width does not come from its container");
  assert.equal(sheet.boxSizing, "border-box", "the sheet bubble's padding can push it past its container");
  assert.ok(!("transform" in sheet), "the sheet bubble carries a transform that can shift its text out of its box");
  assert.ok(!("left" in sheet) && !("top" in sheet), "the sheet bubble carries a positional offset");
});

await test("the sheet bubble's box stays inside its container at desktop and phone column widths", () => {
  // The sheet's text column: 640px on desktop, and 316px on
  // a 360px phone (360 minus the sheet's 22px side padding
  // twice). The sheet style is width 100% of that container,
  // so its box is the container's box: left edge 0, right
  // edge the container width, nothing outside to clip.
  const sheet = speechBubbleStyleFor("sheet");
  assert.equal(sheet.width, "100%");
  for (const container of [640, 316]) {
    const box = { left: 0, width: container, right: container };
    assert.ok(box.left >= 0 && box.right <= container, `the sheet bubble escapes its ${container}px container`);
    assert.equal(box.width, container, "the sheet bubble does not take the full width its container offers");
  }
  // The figure derived width it must never fall back to:
  // the old header cap on a 62px anchor centered box.
  assert.notEqual(sheet.maxWidth, "min(250px, calc(100vw - 16px))", "the sheet bubble took the header width cap");
});

await test("the header variant keeps its floating geometry and its clamp, untouched by the sheet fix", () => {
  const header = speechBubbleStyleFor("header", 0);
  assert.equal(header.position, "absolute", "the header bubble lost its floating placement");
  assert.equal(header.left, "50%", "the header bubble is no longer centered on its figure");
  assert.equal(header.width, "max-content");
  assert.equal(header.maxWidth, "min(250px, calc(100vw - 16px))", "the header bubble's viewport cap changed");
  assert.equal(header.transform, "translateX(calc(-50% + 0px))", "the header bubble's clamp transform changed at zero shift");
  assert.equal(speechBubbleStyleFor("header", 80).transform, "translateX(calc(-50% + 80px))",
    "the header bubble no longer applies the clamp shift the 2026-10-16 audit added");
  /* The stage variant is deleted (2026-10-29, dialog spec
     2.7): it was defined, passed by no mount, and is how the
     home ended up with header geometry by accident. Home B's
     box is the flow variant: in flow, block, the column's
     width, no transform to push it over anything. An unknown
     variant name reads as the header geometry. */
  const flow = speechBubbleStyleFor("flow");
  assert.equal(flow.position, "relative", "the flow bubble is not in flow");
  assert.equal(flow.display, "block", "the flow bubble does not lay out as a block");
  assert.equal(flow.width, "100%", "the flow bubble does not take its column's width");
  assert.ok(!("transform" in flow), "the flow bubble carries a transform");
  const stage = speechBubbleStyleFor("stage");
  assert.equal(stage.left, "50%", "an unknown variant no longer normalizes to the header geometry");
  assert.ok(!("bottom" in stage) || stage.bottom !== "calc(100% + 10px)", "the deleted stage geometry is back");
});

await test("NovaBubble renders every variant through the one geometry function, and a sheet dismiss keeps text clear of its hit area", () => {
  assert.ok(speechSrc.includes("const variantStyle = speechBubbleStyleFor(v, clampShift);"),
    "NovaBubble does not take its geometry from speechBubbleStyleFor");
  assert.ok(speechSrc.includes('if (v === "sheet" && onDismiss) variantStyle.paddingRight = 52;'),
    "a sheet bubble's text can run under its dismiss button");
});

console.log(`\nnova-speech: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
