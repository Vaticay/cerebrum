/**
 * Cortex built in learning paths (2026-10-13).
 *
 * Cortex used to teach only from papers: no search, no course. The
 * rework adds authored paths that teach directly, with Duolingo style
 * activities (match, order, true or false) beside the existing quiz
 * and cloze cards. These tests pin the authored data and the pure
 * logic behind it: every lesson must be answerable exactly as
 * written, progression must lock lessons until the one before is
 * done, and daily practice must only sample what was learned.
 *
 * The curriculum and its helpers live in src/LearnView.jsx, so they
 * are extracted by AST and run in a bare VM, the same pattern the
 * flowchart sync suite uses for CerebrumApp.jsx. No network, no DOM.
 *
 * Run with: node tests/cortex-learning.mjs
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

// ── Extract the curriculum and its pure helpers from LearnView.jsx ──
const learnSrc = readFileSync(join(root, "src/LearnView.jsx"), "utf8");
const ast = parse(learnSrc, { sourceType: "module", plugins: ["jsx"] });

const WANTED = [
  "hashStr", "seededShuffle", "cleanText",
  "mkNote", "mkQuiz", "mkTrueFalse", "mkMatch", "mkOrder", "mkDeepen",
  "LEARNING_PATHS", "CATALOG", "TOPIC_COURSES", "topicPathFor", "INTERACTIVE_KINDS", "isInteractiveCard",
  "flattenPathLessons", "isLessonUnlocked", "pathProgress",
  "applyLessonResult", "buildDailyPracticeCards", "validateCurriculum",
  "MASTERY_MIN_PCT", "isLessonMastered", "orderScore", "parseRichText",
  "XP_CORRECT", "XP_WRONG", "XP_BATTLE", "XP_LESSON_FINISH",
  "matchScore", "lessonXpScale", "scaleXp",
  "TOUR_STEPS", "focusTrapStep",
  "CORTEX_EXPORT_FORMAT", "CORTEX_EXPORT_VERSION",
  "COURSES_KEY", "CLAIMS_KEY", "PROFILE_KEY", "SOUND_KEY", "BUILTIN_PROGRESS_KEY",
  "cortexIsPlainObject", "cortexIsFiniteNumber", "cortexIsStringArray",
  "cortexEmptyProfile", "cortexEmptyBuiltinProgress", "cortexImportFailure",
  "cortexCourseProblem", "cortexClaimProblem", "cortexProgressRecordProblem",
  "buildCortexExport", "parseCortexImport", "applyCortexImport",
  "normKey", "protectPeriods", "looksLikeFragment", "extractClaims",
  "NUMBER_RE", "numbersIn", "hasAttributionShape", "claimSeq",
  "FLIP_WORDS", "flipDirection", "scaleNumberIn", "mutatedVariants", "nearestClaims",
  "RESTATE_WORDS", "firstWordsOf", "swapRestateWords", "stripReportFrame",
  "moveFrontClause", "rotateMidClause", "restateClaim", "withinOptionBand",
  "quizCard", "clozeCard",
  "VOCAB_STOP", "extractVocab", "vocabCard",
  "loadJSON", "saveJSON", "loadClaims", "saveClaims", "createCourseFromResults",
];
function declFor(name) {
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
  const decl = declFor(name);
  assert.ok(decl, `${name} must be declared in src/LearnView.jsx`);
  chunks.push(learnSrc.slice(decl.start, decl.end));
}
const epilogue = `\n;globalThis.__x = { ${WANTED.join(", ")} };`;
const js = transformSync(chunks.join("\n") + epilogue, { loader: "jsx" }).code;
// A localStorage shaped stub so the course builder's storage calls
// (loadClaims/saveClaims under createCourseFromResults) round trip
// in the VM the way they do in the browser.
const memStore = new Map();
const context = vm.createContext({
  localStorage: {
    getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
    setItem: (k, v) => { memStore.set(k, String(v)); },
    removeItem: (k) => { memStore.delete(k); },
  },
});
vm.runInContext(js, context);
const {
  LEARNING_PATHS, CATALOG, TOPIC_COURSES, topicPathFor, isInteractiveCard, flattenPathLessons, isLessonUnlocked,
  pathProgress, applyLessonResult, buildDailyPracticeCards, validateCurriculum,
  MASTERY_MIN_PCT, isLessonMastered, orderScore, parseRichText, TOUR_STEPS,
  focusTrapStep, cleanText,
  XP_CORRECT, XP_WRONG, XP_BATTLE, XP_LESSON_FINISH,
  matchScore, lessonXpScale, scaleXp,
  COURSES_KEY, CLAIMS_KEY, PROFILE_KEY, SOUND_KEY, BUILTIN_PROGRESS_KEY,
  CORTEX_EXPORT_FORMAT, CORTEX_EXPORT_VERSION, buildCortexExport, parseCortexImport,
  applyCortexImport, restateClaim, quizCard, clozeCard, extractClaims, firstWordsOf, normKey,
  hasAttributionShape, createCourseFromResults, looksLikeFragment,
} = context.__x;

const allLessons = LEARNING_PATHS.flatMap((p) =>
  flattenPathLessons(p).map((l) => ({ path: p, lesson: l })));
const allCards = allLessons.flatMap(({ lesson }) => lesson.cards);

// ─═════════════════════════════════════════════════════════════════
group("Curriculum shape: paths, units, lessons, cards");

await test("at least 4 built in paths", () => {
  assert.ok(LEARNING_PATHS.length >= 4, `only ${LEARNING_PATHS.length} paths`);
});

await test("every path has at least 2 units of at least 2 lessons", () => {
  for (const p of LEARNING_PATHS) {
    assert.ok(p.units.length >= 2, `${p.title} has ${p.units.length} units`);
    for (const u of p.units) {
      assert.ok(u.lessons.length >= 2, `${p.title} / ${u.title} has ${u.lessons.length} lessons`);
    }
  }
});

await test("every lesson has 5 to 8 cards and at least 3 interactive ones", () => {
  for (const { path, lesson } of allLessons) {
    assert.ok(lesson.cards.length >= 5 && lesson.cards.length <= 8,
      `${path.title} / ${lesson.title} has ${lesson.cards.length} cards`);
    const n = lesson.cards.filter(isInteractiveCard).length;
    assert.ok(n >= 3, `${path.title} / ${lesson.title} has only ${n} interactive cards`);
  }
});

await test("the whole curriculum passes its own validator", () => {
  const problems = [...validateCurriculum()];
  assert.deepEqual(problems, [], problems.join("; "));
});

await test("the validator catches broken content", () => {
  const broken = [{
    id: "bad", title: "Bad Path", units: [
      { id: "u1", title: "U1", lessons: [
        { id: "b1", title: "Broken", cards: [
          { kind: "quiz", question: "?", options: ["a", "b"], correct: 9, why: "w" },
          { kind: "truefalse", statement: "s", answer: "yes", correct: 0, why: "w" },
          { kind: "match", prompt: "m", pairs: [{ left: "a", right: "1" }, { left: "a", right: "2" }, { left: "b", right: "3" }] },
        ] },
        { id: "b2", title: "Thin", cards: [{ kind: "note", kicker: "k", title: "t", text: "x" }] },
      ] },
      { id: "u2", title: "U2", lessons: [] },
    ],
  }];
  const problems = [...validateCurriculum(broken)];
  assert.ok(problems.length >= 5, `expected several problems, got: ${problems.join("; ")}`);
  assert.ok(problems.some((s) => s.includes("Broken")), "problems should name the broken lesson");
});

// ─═════════════════════════════════════════════════════════════════
group("Tier two: a second staircase above the first");

const TIER_TWO = [
  { unit: "Fair Tests and Honest Answers", lessons: ["Change One Thing at a Time", "Not Fooling Yourself"] },
  { unit: "Air and Fuel", lessons: ["Breathing: Trading Gases", "Digestion: The Long Way Down"] },
  { unit: "The Moon and the Far Beyond", lessons: ["The Moon and Its Changing Face", "Galaxies and the Light Year"] },
  { unit: "The Restless Earth", lessons: ["Rocks That Change", "Plates on the Move"] },
];

await test("every path has a third unit, for 24 lessons in all", () => {
  let total = 0;
  for (const p of LEARNING_PATHS) {
    assert.equal(p.units.length, 3, `${p.title} has ${p.units.length} units`);
    assert.equal(flattenPathLessons(p).length, 6, `${p.title} should hold 6 lessons`);
    total += flattenPathLessons(p).length;
  }
  assert.equal(total, 24, `curriculum holds ${total} lessons, not 24`);
});

await test("the tier two units and lessons are the authored ones", () => {
  LEARNING_PATHS.forEach((p, i) => {
    const flat = flattenPathLessons(p);
    assert.equal(flat[4].unitTitle, TIER_TWO[i].unit, `${p.title} tier two unit renamed`);
    assert.equal(flat[5].unitTitle, TIER_TWO[i].unit);
    assert.deepEqual([flat[4].title, flat[5].title], TIER_TWO[i].lessons,
      `${p.title} tier two lessons are not the authored pair`);
  });
});

await test("every tier two lesson follows the six card lesson shape", () => {
  for (const p of LEARNING_PATHS) {
    const flat = flattenPathLessons(p);
    for (const l of [flat[4], flat[5]]) {
      const kinds = l.cards.map((c) => c.kind);
      assert.equal(kinds.length, 6, `${p.title} / ${l.title} has ${kinds.length} cards`);
      assert.equal(kinds[0], "note", `${l.title} should open with a note`);
      assert.equal(kinds[1], "quiz", `${l.title} card two should be a quiz`);
      assert.ok(kinds[2] === "match" || kinds[2] === "order", `${l.title} card three should be match or order`);
      assert.equal(kinds[3], "truefalse", `${l.title} card four should be true or false`);
      assert.equal(kinds[4], "quiz", `${l.title} card five should be a quiz`);
      assert.equal(kinds[5], "deepen", `${l.title} should close with a deepen card`);
    }
  }
});

await test("tier two stays locked until the last tier one lesson is done", () => {
  for (const p of LEARNING_PATHS) {
    const flat = flattenPathLessons(p);
    let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
    assert.equal(isLessonUnlocked(p, flat[4].id, prog), false, `${p.title} tier two starts open`);
    for (let i = 0; i < 4; i++) prog = applyLessonResult(prog, p, flat[i].id, 90);
    assert.equal(isLessonUnlocked(p, flat[4].id, prog), true, `${p.title} tier two should open after tier one`);
    assert.equal(isLessonUnlocked(p, flat[5].id, prog), false, `${p.title} second tier two lesson should wait its turn`);
    prog = applyLessonResult(prog, p, flat[4].id, 90);
    assert.equal(isLessonUnlocked(p, flat[5].id, prog), true);
  }
});

await test("a tier two lesson masters and counts like any other", () => {
  const p0 = LEARNING_PATHS[0];
  const flat = flattenPathLessons(p0);
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  for (let i = 0; i < 4; i++) prog = applyLessonResult(prog, p0, flat[i].id, 100);
  prog = applyLessonResult(prog, p0, flat[4].id, 100);
  assert.equal(prog.lessons[flat[4].id].mastered, true);
  const pp = pathProgress(p0, prog);
  assert.equal(pp.done, 5);
  assert.equal(pp.mastered, 5);
  assert.equal(pp.total, 6);
  assert.equal(pp.complete, false, "one lesson remains, so the path is not complete");
});

await test("daily practice samples finished tier two lessons", () => {
  const p0 = LEARNING_PATHS[0];
  const flat = flattenPathLessons(p0);
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  for (let i = 0; i < 4; i++) prog = applyLessonResult(prog, p0, flat[i].id, 100);
  prog = applyLessonResult(prog, p0, flat[4].id, 20);
  prog = applyLessonResult(prog, p0, flat[5].id, 20);
  const tierTwoCards = [flat[4], flat[5]].flatMap((l) => l.cards.filter(isInteractiveCard));
  const tierOneCards = new Set(flat.slice(0, 4).flatMap((l) => l.cards));
  const out = buildDailyPracticeCards({ progress: prog, dueCards: [], seed: 3, limit: tierTwoCards.length });
  assert.equal(out.length, tierTwoCards.length);
  for (const c of out) {
    assert.ok(tierTwoCards.includes(c), "the session should fill from the unmastered tier two lessons");
    assert.ok(!tierOneCards.has(c), "mastered tier one cards wait behind unmastered tier two cards");
  }
});

// ─═════════════════════════════════════════════════════════════════
group("Every card is answerable exactly as written");

await test("every quiz and truefalse has a reachable correct answer", () => {
  for (const c of allCards) {
    if (c.kind === "quiz" || c.kind === "cloze") {
      assert.ok(Array.isArray(c.options) && c.options.length >= 2, "quiz needs options");
      assert.ok(c.correct >= 0 && c.correct < c.options.length, `correct ${c.correct} outside options`);
      assert.ok(c.why, "quiz needs an explanation");
    }
    if (c.kind === "truefalse") {
      assert.equal(typeof c.answer, "boolean");
      assert.equal(c.correct, c.answer ? 0 : 1, "truefalse correct index must match its answer");
      assert.ok(c.statement && c.why, "truefalse needs a statement and an explanation");
    }
  }
});

await test("every match card has well formed pairs with unique sides", () => {
  const matches = allCards.filter((c) => c.kind === "match");
  assert.ok(matches.length >= 4, `only ${matches.length} match cards authored`);
  for (const c of matches) {
    assert.ok(c.pairs.length >= 3 && c.pairs.length <= 6, "match needs 3 to 6 pairs");
    assert.equal(new Set(c.pairs.map((p) => p.left)).size, c.pairs.length, "left sides repeat");
    assert.equal(new Set(c.pairs.map((p) => p.right)).size, c.pairs.length, "right sides repeat");
    for (const p of c.pairs) assert.ok(p.left && p.right, "a pair has an empty side");
  }
});

await test("every order card defines a unique correct sequence", () => {
  const orders = allCards.filter((c) => c.kind === "order");
  assert.ok(orders.length >= 4, `only ${orders.length} order cards authored`);
  for (const c of orders) {
    assert.ok(c.items.length >= 3 && c.items.length <= 6, "order needs 3 to 6 items");
    assert.equal(new Set(c.items).size, c.items.length, "order items repeat");
    assert.ok(c.why, "order needs an explanation");
  }
});

await test("the new activity kinds are really used, in every lesson", () => {
  for (const kind of ["match", "order", "truefalse"]) {
    assert.ok(allCards.some((c) => c.kind === kind), `no ${kind} cards authored`);
  }
  for (const { path, lesson } of allLessons) {
    const kinds = new Set(lesson.cards.map((c) => c.kind));
    assert.ok(kinds.has("truefalse"), `${path.title} / ${lesson.title} has no true or false card`);
    assert.ok(kinds.has("match") || kinds.has("order"),
      `${path.title} / ${lesson.title} has neither a match nor an order card`);
  }
});

await test("no dashes in any authored lesson copy", () => {
  const strings = [];
  const walk = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const p of LEARNING_PATHS) {
    walk(p.title); walk(p.blurb);
    for (const u of p.units) {
      walk(u.title); walk(u.subtitle);
      for (const l of u.lessons) {
        walk(l.title); walk(l.subtitle);
        for (const c of l.cards) {
          walk(c.kicker); walk(c.title); walk(c.text); walk(c.question);
          walk(c.prompt); walk(c.statement); walk(c.why); walk(c.options); walk(c.items);
          if (c.pairs) for (const pr of c.pairs) { walk(pr.left); walk(pr.right); }
        }
      }
    }
  }
  for (const s of TOUR_STEPS) { walk(s.title); walk(s.body); }
  assert.ok(strings.length > 200, `suspiciously little copy collected: ${strings.length}`);
  for (const s of strings) {
    assert.ok(!s.includes("-") && !s.includes("—") && !s.includes("–"), `dash in copy: ${s}`);
  }
});

// ─═════════════════════════════════════════════════════════════════
group("Progression: a staircase, not a shelf");

const path0 = LEARNING_PATHS[0];
const flat0 = flattenPathLessons(path0);

await test("lesson one is open, the rest start locked", () => {
  const fresh = { lessons: {}, lastPathId: "", lastLessonId: "" };
  assert.equal(isLessonUnlocked(path0, flat0[0].id, fresh), true);
  assert.equal(isLessonUnlocked(path0, flat0[1].id, fresh), false);
  assert.equal(isLessonUnlocked(path0, flat0[flat0.length - 1].id, fresh), false);
});

await test("finishing a lesson unlocks exactly the next one", () => {
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  prog = applyLessonResult(prog, path0, flat0[0].id, 80);
  assert.equal(isLessonUnlocked(path0, flat0[1].id, prog), true);
  assert.equal(isLessonUnlocked(path0, flat0[2].id, prog), false);
  const pp = pathProgress(path0, prog);
  assert.equal(pp.done, 1);
  assert.equal(pp.nextLessonId, flat0[1].id);
  assert.equal(prog.lastLessonId, flat0[1].id, "continue pointer should move to the next lesson");
});

await test("best score is kept across replays", () => {
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  prog = applyLessonResult(prog, path0, flat0[0].id, 60);
  prog = applyLessonResult(prog, path0, flat0[0].id, 90);
  assert.equal(prog.lessons[flat0[0].id].best, 90);
  prog = applyLessonResult(prog, path0, flat0[0].id, 40);
  assert.equal(prog.lessons[flat0[0].id].best, 90, "a worse replay must not lower the best score");
});

await test("finishing every lesson completes the path", () => {
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  for (const l of flat0) prog = applyLessonResult(prog, path0, l.id, 100);
  const pp = pathProgress(path0, prog);
  assert.equal(pp.complete, true);
  assert.equal(pp.pct, 100);
  assert.equal(pp.done, pp.total);
});

// ─═════════════════════════════════════════════════════════════════
group("Mastery: done is generous, mastered is earned");

await test("finishing under the bar completes but does not master", () => {
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  prog = applyLessonResult(prog, path0, flat0[0].id, MASTERY_MIN_PCT - 30);
  const rec = prog.lessons[flat0[0].id];
  assert.equal(rec.done, true, "completion stays generous at any score");
  assert.equal(rec.mastered, false);
  assert.equal(isLessonMastered(rec), false);
  assert.equal(isLessonUnlocked(path0, flat0[1].id, prog), true, "completion still unlocks the next lesson");
});

await test("finishing at or over the bar masters the lesson", () => {
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  prog = applyLessonResult(prog, path0, flat0[0].id, MASTERY_MIN_PCT);
  assert.equal(prog.lessons[flat0[0].id].mastered, true);
  assert.equal(isLessonMastered(prog.lessons[flat0[0].id]), true);
});

await test("a worse replay never unmasters a lesson", () => {
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  prog = applyLessonResult(prog, path0, flat0[0].id, 100);
  prog = applyLessonResult(prog, path0, flat0[0].id, 10);
  assert.equal(prog.lessons[flat0[0].id].mastered, true);
  assert.equal(prog.lessons[flat0[0].id].best, 100);
});

await test("completing a miss review masters a low scoring lesson", () => {
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  prog = applyLessonResult(prog, path0, flat0[0].id, 30);
  assert.equal(isLessonMastered(prog.lessons[flat0[0].id]), false);
  prog = applyLessonResult(prog, path0, flat0[0].id, 30, { review: true });
  const rec = prog.lessons[flat0[0].id];
  assert.equal(rec.mastered, true);
  assert.equal(rec.reviewMastered, true);
  assert.equal(rec.best, 30, "the review masters the lesson, it does not rewrite its score");
});

await test("records written before mastery existed still load and read", () => {
  assert.equal(isLessonMastered({ done: true, best: 85, completedAt: "2026-10-13T00:00:00.000Z" }), true);
  assert.equal(isLessonMastered({ done: true, best: 20, completedAt: "2026-10-13T00:00:00.000Z" }), false);
  assert.equal(isLessonMastered({ done: true, best: 20, reviewMastered: true }), true);
  assert.equal(isLessonMastered({}), false);
  assert.equal(isLessonMastered(null), false);
  assert.equal(isLessonMastered(undefined), false);
});

await test("pathProgress counts mastered lessons separately from done", () => {
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  prog = applyLessonResult(prog, path0, flat0[0].id, 100);
  prog = applyLessonResult(prog, path0, flat0[1].id, 20);
  const pp = pathProgress(path0, prog);
  assert.equal(pp.done, 2);
  assert.equal(pp.mastered, 1);
});

// ─═════════════════════════════════════════════════════════════════
group("Daily practice: only what was learned, plus what is due");

await test("nothing started and nothing due means an empty session", () => {
  const out = buildDailyPracticeCards({ progress: { lessons: {} }, dueCards: [], seed: 5 });
  assert.equal(out.length, 0);
});

await test("due cards are served even before any path is started", () => {
  const dueCards = [
    { kind: "quiz", question: "q1", options: ["a", "b"], correct: 0, why: "w", claimId: "c1" },
    { kind: "quiz", question: "q2", options: ["a", "b"], correct: 1, why: "w", claimId: "c2" },
  ];
  const out = buildDailyPracticeCards({ progress: { lessons: {} }, dueCards, seed: 5 });
  assert.equal(out.length, 2);
  assert.deepEqual([...out.map((c) => c.claimId)].sort(), ["c1", "c2"]);
});

await test("activities are sampled only from finished lessons of started paths", () => {
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  prog = applyLessonResult(prog, path0, flat0[0].id, 100);
  const out = buildDailyPracticeCards({ progress: prog, dueCards: [], seed: 3, limit: 8 });
  const finishedCards = flat0[0].cards.filter(isInteractiveCard);
  assert.ok(out.length > 0 && out.length <= finishedCards.length, `sampled ${out.length}`);
  for (const c of out) assert.ok(finishedCards.includes(c), "sampled a card from an unfinished lesson");
  const untouched = LEARNING_PATHS[1];
  const untouchedCards = new Set(flattenPathLessons(untouched).flatMap((l) => l.cards));
  for (const c of out) assert.ok(!untouchedCards.has(c), "sampled from a path never started");
});

await test("unmastered finished lessons are practice material with priority", () => {
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  prog = applyLessonResult(prog, path0, flat0[0].id, 100);
  prog = applyLessonResult(prog, path0, flat0[1].id, 20);
  const weakCards = flat0[1].cards.filter(isInteractiveCard);
  const strongCards = new Set(flat0[0].cards.filter(isInteractiveCard));
  const out = buildDailyPracticeCards({ progress: prog, dueCards: [], seed: 3, limit: weakCards.length });
  assert.equal(out.length, weakCards.length);
  for (const c of out) {
    assert.ok(weakCards.includes(c), "the session should fill from the unmastered lesson first");
    assert.ok(!strongCards.has(c), "mastered cards only enter once the priority pool runs out");
  }
  const wide = buildDailyPracticeCards({ progress: prog, dueCards: [], seed: 3, limit: 8 });
  assert.ok(wide.some((c) => strongCards.has(c)), "mastered cards still appear in a longer session");
});

// ─═════════════════════════════════════════════════════════════════
group("Order cards: per position credit");

await test("a clean full sequence earns full marks", () => {
  const items = ["a", "b", "c", "d"];
  const res = orderScore([...items], items);
  assert.equal(res.correctPositions, 4);
  assert.equal(res.total, 4);
  assert.equal(res.xp, 10);
  assert.equal(res.perfect, true);
});

await test("each step in its right place earns its share", () => {
  const items = ["a", "b", "c", "d"];
  const half = orderScore(["a", "b", "d", "c"], items);
  assert.equal(half.correctPositions, 2);
  assert.equal(half.perfect, false);
  assert.equal(half.xp, 5, "half the positions right earns half the marks");
  const three = orderScore(["a", "b", "c", "x"], ["a", "b", "c", "d"]);
  assert.equal(three.correctPositions, 3);
  assert.equal(three.xp, 8);
});

await test("a checked attempt with nothing in place earns the token point", () => {
  // Corrected contract (third rescore): wrong answers used to earn
  // a 4 XP house floor on every card kind, so the XP total mostly
  // measured activity. A wrong answer now earns the token 1 XP.
  const res = orderScore(["d", "c", "b", "a"], ["a", "b", "c", "d"]);
  assert.equal(res.correctPositions, 0);
  assert.equal(res.xp, 1, "a wrong answer earns the token point, not the old floor of 4");
  const empty = orderScore([], []);
  assert.equal(empty.correctPositions, 0);
  assert.equal(empty.total, 0);
  assert.equal(empty.xp, 0);
  assert.equal(empty.perfect, false);
});

// ─═════════════════════════════════════════════════════════════════
group("Rich text: one markup convention, everything else plain");

await test("an asterisk pair becomes an italic segment", () => {
  const segs = parseRichText("studies of *Homo sapiens* show");
  assert.equal(JSON.stringify(segs), JSON.stringify([
    { text: "studies of ", italic: false },
    { text: "Homo sapiens", italic: true },
    { text: " show", italic: false },
  ]));
});

await test("a lone asterisk stays literal and plain text stays whole", () => {
  const seg = (t) => JSON.stringify(parseRichText(t));
  assert.equal(seg("2 * 3 makes 6"), JSON.stringify([{ text: "2 * 3 makes 6", italic: false }]));
  assert.equal(seg("plain words"), JSON.stringify([{ text: "plain words", italic: false }]));
  assert.equal(seg(""), "[]");
  const two = parseRichText("*one* and *two*");
  assert.equal(JSON.stringify(two.filter((s) => s.italic).map((s) => s.text)), JSON.stringify(["one", "two"]));
});

await test("the species name in the deepen card is marked for italics", () => {
  const deepen = allCards.filter((c) => c.kind === "deepen" && c.text.includes("Homo"));
  assert.ok(deepen.length >= 1, "the Homo sapiens deepen card is missing");
  const segs = parseRichText(deepen[0].text);
  assert.ok(segs.some((s) => s.italic && s.text === "Homo sapiens"), "Homo sapiens must be an italic segment");
});

// ─═════════════════════════════════════════════════════════════════
group("Player and home wiring (source pins)");

await test("the Player renders the new card kinds", () => {
  for (const needle of ['card.kind === "match"', 'card.kind === "order"', 'card.kind === "truefalse"', 'card.kind === "deepen"']) {
    assert.ok(learnSrc.includes(needle), `Player is missing ${needle}`);
  }
  assert.ok(learnSrc.includes("Match every pair to finish"), "match completion bar missing");
  assert.ok(learnSrc.includes("Check order"), "order check button missing");
  assert.ok(learnSrc.includes("TRUE OR FALSE"), "true or false stage missing");
});

await test("the Player announces feedback through one live region", () => {
  assert.ok(learnSrc.includes('aria-live="polite"'), "no polite live region in the Player");
  assert.ok(learnSrc.includes('role="status"'), "live region needs the status role");
  // Announcements report the amount actually paid (10 for a right
  // answer at full scale), so the string is built from the payment.
  assert.ok(learnSrc.includes('"Right. Plus " + paid + " XP."'), "right answers are not announced with the amount paid");
  assert.ok(learnSrc.includes("Matched ") && learnSrc.includes("does not match."), "match progress is not announced");
  // The completion announcement reports the bonus actually paid,
  // which the replay scale can reduce, so it is built from the paid
  // amount rather than a fixed 20.
  assert.ok(learnSrc.includes('"Lesson complete. Plus " + bonus + " XP for finishing."'), "lesson completion is not announced with the bonus actually paid");
});

await test("the Player manages focus and Escape", () => {
  assert.ok(learnSrc.includes("tabIndex={-1}"), "the Player shell is not a focus target");
  assert.ok(learnSrc.includes("shellRef"), "the Player shell has no ref for focus");
  assert.ok(learnSrc.includes('e.key === "Escape"'), "Escape does not close the Player");
});

await test("the Player shell is a labelled modal dialog", () => {
  assert.ok(learnSrc.includes('role="dialog"'), "the Player shell has no dialog role");
  assert.ok(learnSrc.includes('aria-modal="true"'), "the Player shell is not marked modal");
  assert.ok(learnSrc.includes('"Lesson: " + (lesson ? lesson.title : course.title)'), "the dialog label does not name the lesson being played");
  assert.ok(learnSrc.includes('"Course complete: " + course.title'), "the finished screen label does not name the course");
});

await test("focusTrapStep wraps focus at both ends of the Player", () => {
  // Focus on the shell itself (index below zero) enters at an end.
  assert.equal(focusTrapStep(3, -1, false), 0, "Tab from the shell should land on the first control");
  assert.equal(focusTrapStep(3, -1, true), 2, "Shift Tab from the shell should land on the last control");
  // The ends wrap.
  assert.equal(focusTrapStep(3, 2, false), 0, "Tab on the last control should wrap to the first");
  assert.equal(focusTrapStep(3, 0, true), 2, "Shift Tab on the first control should wrap to the last");
  // Moves that stay inside are left to the browser.
  assert.equal(focusTrapStep(3, 0, false), null, "Tab mid list should move naturally");
  assert.equal(focusTrapStep(3, 1, false), null, "Tab mid list should move naturally");
  assert.equal(focusTrapStep(3, 1, true), null, "Shift Tab mid list should move naturally");
  assert.equal(focusTrapStep(3, 2, true), null, "Shift Tab mid list should move naturally");
  // A single control cycles onto itself; none at all holds focus.
  assert.equal(focusTrapStep(1, 0, false), 0, "a lone control should keep focus under Tab");
  assert.equal(focusTrapStep(1, 0, true), 0, "a lone control should keep focus under Shift Tab");
  assert.equal(focusTrapStep(0, -1, false), "hold", "with no controls, focus must stay on the shell");
});

await test("the Player traps Tab through the pure step helper", () => {
  assert.ok(learnSrc.includes('e.key !== "Tab"'), "the Player key handler ignores Tab");
  assert.ok(learnSrc.includes("focusTrapStep(focusables.length"), "the trap does not run focusTrapStep over the shell controls");
  assert.ok(learnSrc.includes("shellNode.querySelectorAll"), "the trap does not collect the shell's focusable controls");
});

await test("the Player close buttons meet the 44px target floor", () => {
  const closes = learnSrc.match(/aria-label="Close lesson"[^>]*minHeight: 44/g) || [];
  assert.equal(closes.length, 2, `both glyph close buttons need minHeight 44, found ${closes.length}`);
  const wide = learnSrc.match(/aria-label="Close lesson"[^>]*minWidth: 44/g) || [];
  assert.equal(wide.length, 2, `both glyph close buttons need minWidth 44, found ${wide.length}`);
});

await test("match pair buttons expose their selection state", () => {
  assert.ok(learnSrc.includes("aria-pressed={selected || donePair}"), "left match buttons lack aria-pressed");
  assert.ok(learnSrc.includes("aria-pressed={donePair}"), "right match buttons lack aria-pressed");
});

await test("motion respects prefers reduced motion", () => {
  const css = learnSrc.slice(learnSrc.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(css.length > 0, "no reduced motion block in the stylesheet");
  for (const cls of [".lv-shake", ".lv-pulse", ".lv-rise"]) {
    assert.ok(css.includes(cls), `reduced motion block does not gate ${cls}`);
  }
});

await test("shuffles are seeded per attempt, not per card", () => {
  assert.ok(learnSrc.includes("attempt * 131"), "match and order shuffles do not vary by attempt");
  assert.ok(learnSrc.includes("shuffleSalt"), "shuffles are not salted per mount");
});

await test("order checks score through the per position helper", () => {
  assert.ok(learnSrc.includes("orderScore(orderPlaced, card.items)"), "checkOrder does not use orderScore");
  assert.ok(learnSrc.includes("steps in the right place."), "the sheet does not report per position credit");
});

await test("feedback tones come from the design system, not borrowed brand colours", () => {
  for (const hex of ["#58CC02", "#FF4B4B", "#D7FFB8", "#FFDFE0"]) {
    assert.ok(!learnSrc.includes(hex), `borrowed palette literal still present: ${hex}`);
  }
  assert.ok(learnSrc.includes("STATUS.good") && learnSrc.includes("STATUS.bad"), "STATUS tones are not used");
  assert.ok(learnSrc.includes("withAlpha(STATUS.good"), "no STATUS wash fills");
});

await test("the feedback sheet and action bar sit on solid surfaces, never a bare wash", () => {
  // Dusty's 2026-10-13 photo: the feedback sheet's background was
  // the 13 to 20 percent alpha wash itself, so the quiz options
  // underneath showed through and the finding text double exposed.
  // The sheet must composite its tint over the opaque surface
  // token, and the unchecked action bar must be solid too.
  assert.ok(!learnSrc.includes("background: sheetGood ? goodWash : badWash"),
    "the feedback sheet background is the bare translucent wash");
  const sheetAt = learnSrc.indexOf('className="lv-sheet"');
  assert.ok(sheetAt > 0, "feedback sheet not found");
  const sheetBlock = learnSrc.slice(sheetAt, sheetAt + 600);
  assert.ok(sheetBlock.includes("backgroundColor: P.surface"),
    "the feedback sheet has no solid surface underlay");
  assert.ok(sheetBlock.includes("backgroundImage:") && sheetBlock.includes("goodWash"),
    "the feedback sheet lost its tone tint instead of layering it over the solid surface");
  assert.ok(!learnSrc.includes('linear-gradient(rgba(0,0,0,0), " + P.bg'),
    "the bottom action bar still fades from transparent over scrolling content");
});

await test("mastery shows on the path, distinctly from done", () => {
  assert.ok(learnSrc.includes('"MASTERED"'), "the path view has no mastered state");
  assert.ok(learnSrc.includes("not mastered yet"), "done but unmastered lessons are not explained");
  assert.ok(learnSrc.includes("onReviewDone"), "review completion is not wired to mastery");
});

await test("note, deepen, and summary text render through RichText", () => {
  assert.ok(learnSrc.includes("<RichText text={card.text} />"), "card text is not rendered through RichText");
});

await test("the tour opens with the learning paths", () => {
  assert.ok(TOUR_STEPS[0].title.includes("path"), `first tour step is not about paths: ${TOUR_STEPS[0].title}`);
  assert.ok(TOUR_STEPS[0].body.includes("learning paths"), "first tour step does not name the learning paths");
  assert.ok(!learnSrc.includes("Pick a course, or build one"), "the old course first tour step survived");
});

await test("home leads with learning and topic courses come after", () => {
  const daily = learnSrc.indexOf("DAILY PRACTICE");
  const paths = learnSrc.indexOf("LEARNING PATHS");
  const shelves = learnSrc.indexOf("TOPIC COURSES");
  assert.ok(daily > 0 && paths > daily, "daily practice should sit above the paths grid");
  assert.ok(shelves > paths, "topic courses should sit below the paths");
  assert.ok(learnSrc.includes("cerebrum-learn2-progress"), "built in progress storage key missing");
  assert.ok(learnSrc.includes("Start daily practice"), "daily practice entry missing");
});

group("Typography: design tokens, not raw sizes");

await test("LearnView takes its sizes from FONT_SIZES", () => {
  assert.match(learnSrc, /import \{[^}]*\bFONT_SIZES\b[^}]*\} from "\.\/designSystem\.jsx"/, "FONT_SIZES is not imported from the design system");
  const uses = (learnSrc.match(/FONT_SIZES\.(caption|label|body|title|display|hero)/g) || []).length;
  assert.ok(uses >= 150, `expected at least 150 token sizes in LearnView, found ${uses}`);
});

await test("raw numeric fontSize literals stay at the named one offs", () => {
  // The only raw sizes allowed are the two close glyphs and the decorative
  // quote mark: optical glyph sizing, not text roles. Everything else must
  // come from the FONT_SIZES scale so the same role cannot drift by a pixel
  // or two from screen to screen.
  const raw = learnSrc.match(/fontSize: \d+(\.\d+)?/g) || [];
  assert.ok(raw.length <= 3, `expected at most 3 raw fontSize literals, found ${raw.length}: ${raw.join(", ")}`);
});

group("Progress export and import: the record can leave this browser as a file");

const cortexFixtureState = {
  courses: [{ id: "course-1", title: "Sleep science", lessons: [{ id: "l1", cards: [] }], doneLessons: ["l1"], xpEarned: 40 }],
  claims: { "claim-1": { id: "claim-1", reps: 3, lapses: 0, stability: 2.4, last: 1760000000000, due: 1760200000000, card: { kind: "quiz", question: "Q?" } } },
  profile: { xp: 120, days: ["2026-10-11", "2026-10-12", "2026-10-13"], bridged: [], freezes: 1, freezeMilestone: 0, streak: 3 },
  builtinProgress: { lessons: { "sci-questions": { done: true, bestPct: 100 } }, lastPathId: "how-science-works", lastLessonId: "sci-questions" },
  sound: true,
};

// The helpers run in a bare VM, so their objects carry that realm's
// prototypes; compare structure through JSON, the same shape the
// export file itself takes.
const asJSON = (v) => JSON.parse(JSON.stringify(v));

await test("export carries every stored section under a format marker and version", () => {
  const doc = buildCortexExport(cortexFixtureState, new Date("2026-10-13T12:00:00.000Z"));
  assert.equal(doc.format, CORTEX_EXPORT_FORMAT);
  assert.equal(doc.version, CORTEX_EXPORT_VERSION);
  assert.equal(doc.exportedAt, "2026-10-13T12:00:00.000Z");
  assert.deepEqual(asJSON(doc.courses), cortexFixtureState.courses);
  assert.deepEqual(asJSON(doc.claims), cortexFixtureState.claims);
  assert.deepEqual(asJSON(doc.profile), cortexFixtureState.profile);
  assert.deepEqual(asJSON(doc.builtinProgress), cortexFixtureState.builtinProgress);
  assert.equal(doc.sound, true);
});

await test("export round trips through the parser back to the same progress", () => {
  const doc = buildCortexExport(cortexFixtureState, new Date("2026-10-13T12:00:00.000Z"));
  const parsed = parseCortexImport(JSON.stringify(doc));
  assert.equal(parsed.ok, true, parsed.error || "parser refused its own export");
  assert.deepEqual(asJSON(parsed.state), cortexFixtureState);
});

await test("export of an empty browser still parses, with default sections", () => {
  const parsed = parseCortexImport(JSON.stringify(buildCortexExport({}, new Date())));
  assert.equal(parsed.ok, true, parsed.error || "empty export refused");
  assert.deepEqual(asJSON(parsed.state.courses), []);
  assert.deepEqual(asJSON(parsed.state.claims), {});
  assert.equal(parsed.state.profile.xp, 0);
  assert.deepEqual(asJSON(parsed.state.builtinProgress.lessons), {});
});

await test("parser rejects foreign JSON with no partial state", () => {
  for (const foreign of [JSON.stringify({ hello: "world" }), JSON.stringify([1, 2, 3]), JSON.stringify("just a string"), "null"]) {
    const parsed = parseCortexImport(foreign);
    assert.equal(parsed.ok, false, `foreign file accepted: ${foreign}`);
    assert.equal(parsed.state, undefined, "a rejected file handed back partial state");
    assert.ok(parsed.error && parsed.error.length > 0, "rejection carries no plain reason");
  }
});

await test("parser rejects a file from a newer Cortex instead of guessing", () => {
  const doc = buildCortexExport(cortexFixtureState, new Date());
  doc.version = CORTEX_EXPORT_VERSION + 1;
  const parsed = parseCortexImport(JSON.stringify(doc));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.state, undefined);
  assert.ok(parsed.error.includes("newer version"), `reason does not name the problem: ${parsed.error}`);
});

await test("parser rejects a truncated file", () => {
  const text = JSON.stringify(buildCortexExport(cortexFixtureState, new Date()));
  const parsed = parseCortexImport(text.slice(0, Math.floor(text.length / 2)));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.state, undefined);
});

await test("parser rejects a section with the wrong shape", () => {
  const doc = buildCortexExport(cortexFixtureState, new Date());
  doc.courses = { not: "an array" };
  const parsed = parseCortexImport(JSON.stringify(doc));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.state, undefined);
  const doc2 = buildCortexExport(cortexFixtureState, new Date());
  doc2.builtinProgress = { lessons: [1, 2, 3] };
  assert.equal(parseCortexImport(JSON.stringify(doc2)).ok, false);
});

await test("export and import controls render in the home progress surface", () => {
  assert.ok(learnSrc.includes("Export progress"), "no export control on the Cortex home");
  assert.ok(learnSrc.includes("Import progress"), "no import control on the Cortex home");
  assert.ok(learnSrc.includes("buildCortexExport({ courses, claims, profile, builtinProgress, sound: soundOn }"), "export button does not build from the live state");
  assert.ok(learnSrc.includes("parseCortexImport(String(reader.result"), "import does not validate through the parser");
  assert.ok(learnSrc.includes('accept=".json"'), "import file input does not limit itself to json files");
  assert.ok(learnSrc.includes("Replace the Cortex progress in this browser"), "import replaces without asking first");
  assert.ok(learnSrc.includes("not a cloud copy"), "the copy does not say plainly that the export is a kept file");
  assert.ok(learnSrc.includes('a.download = "cerebrum-cortex-progress-" + todayKey() + ".json"'), "export file is not named with the date");
});

// ─═════════════════════════════════════════════════════════════════
group("Import validation: deep shapes, not top level types");

const deepDoc = () => buildCortexExport({
  courses: [{
    id: "course-9", title: "Gut science", sourceCount: 2, doneLessons: [], xpEarned: 0,
    lessons: [{ id: "l1", title: "Start", subtitle: "s", cards: [
      { kind: "quiz", question: "Q?", options: ["a", "b"], correct: 1, why: "w" },
      { kind: "match", prompt: "m", pairs: [{ left: "a", right: "1" }] },
      { kind: "note", kicker: "k", title: "t", text: "x" },
    ] }],
  }],
  claims: { c1: { id: "c1", reps: 1, lapses: 0, stability: 1, due: 5, last: 4, card: { kind: "quiz", options: ["a", "b"], correct: 0 } } },
  profile: { xp: 10, days: ["2026-10-13"], bridged: [], freezes: 2, freezeMilestone: 0 },
  builtinProgress: { lessons: { l1: { done: true, best: 80, completions: 1 } }, lastPathId: "p", lastLessonId: "l1" },
  sound: false,
}, new Date());

await test("a deeply shaped file parses whole", () => {
  const parsed = parseCortexImport(JSON.stringify(deepDoc()));
  assert.equal(parsed.ok, true, parsed.error || "deep file refused");
});

await test("a course with no lessons list is rejected, naming courses", () => {
  const doc = deepDoc();
  doc.courses = [{ id: "c", title: "t" }];
  const parsed = parseCortexImport(JSON.stringify(doc));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.state, undefined);
  assert.ok(parsed.error.includes("courses"), `reason does not name the section: ${parsed.error}`);
});

await test("a lesson with no cards list is rejected", () => {
  const doc = deepDoc();
  doc.courses[0].lessons = [{ id: "l1", title: "Start" }];
  const parsed = parseCortexImport(JSON.stringify(doc));
  assert.equal(parsed.ok, false);
  assert.ok(parsed.error.includes("courses"), `reason does not name the section: ${parsed.error}`);
});

await test("a card with no kind, and a question card with unreachable answers, are rejected", () => {
  const doc = deepDoc();
  doc.courses[0].lessons[0].cards = [{ question: "Q?" }];
  assert.equal(parseCortexImport(JSON.stringify(doc)).ok, false, "kindless card accepted");
  const doc2 = deepDoc();
  doc2.courses[0].lessons[0].cards = [{ kind: "quiz", options: ["a", "b"], correct: 5 }];
  assert.equal(parseCortexImport(JSON.stringify(doc2)).ok, false, "out of range correct index accepted");
  const doc3 = deepDoc();
  doc3.courses[0].lessons[0].cards = [{ kind: "match", prompt: "m" }];
  assert.equal(parseCortexImport(JSON.stringify(doc3)).ok, false, "match card without pairs accepted");
});

await test("claims are validated entry by entry, naming review claims", () => {
  const doc = deepDoc();
  doc.claims = { c1: "not a claim" };
  const parsed = parseCortexImport(JSON.stringify(doc));
  assert.equal(parsed.ok, false);
  assert.ok(parsed.error.includes("review claims"), `reason does not name the section: ${parsed.error}`);
  const doc2 = deepDoc();
  doc2.claims = { c1: { id: "c1", reps: 1 } };
  assert.equal(parseCortexImport(JSON.stringify(doc2)).ok, false, "a claim with no review card was accepted");
  const doc3 = deepDoc();
  doc3.claims = { c1: { id: "c1", reps: "three", card: { kind: "quiz" } } };
  assert.equal(parseCortexImport(JSON.stringify(doc3)).ok, false, "a claim with a word for a schedule was accepted");
});

await test("an empty profile no longer passes", () => {
  const doc = deepDoc();
  doc.profile = {};
  const parsed = parseCortexImport(JSON.stringify(doc));
  assert.equal(parsed.ok, false);
  assert.ok(parsed.error.includes("profile"), `reason does not name the section: ${parsed.error}`);
  const doc2 = deepDoc();
  doc2.profile = { xp: 10, days: "2026-10-13", bridged: [], freezes: 2, freezeMilestone: 0 };
  assert.equal(parseCortexImport(JSON.stringify(doc2)).ok, false, "profile days as one string accepted");
});

await test("path progress records are validated, naming path progress", () => {
  const doc = deepDoc();
  doc.builtinProgress = { lessons: { l1: "done" }, lastPathId: "", lastLessonId: "" };
  const parsed = parseCortexImport(JSON.stringify(doc));
  assert.equal(parsed.ok, false);
  assert.ok(parsed.error.includes("path progress"), `reason does not name the section: ${parsed.error}`);
});

// ─═════════════════════════════════════════════════════════════════
group("Import apply: all five sections stored, or none of them");

const fakeStorage = (initial = {}, failOn = null) => {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if (failOn === k) throw new Error("storage is full"); map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
};

await test("a clean apply stores every section and reports success", () => {
  const store = fakeStorage();
  const res = applyCortexImport(cortexFixtureState, store);
  assert.equal(res.ok, true, res.error || "clean apply refused");
  assert.deepEqual(JSON.parse(store.map.get(COURSES_KEY)), asJSON(cortexFixtureState.courses));
  assert.deepEqual(JSON.parse(store.map.get(CLAIMS_KEY)), asJSON(cortexFixtureState.claims));
  assert.deepEqual(JSON.parse(store.map.get(PROFILE_KEY)), asJSON(cortexFixtureState.profile));
  assert.deepEqual(JSON.parse(store.map.get(BUILTIN_PROGRESS_KEY)), asJSON(cortexFixtureState.builtinProgress));
  assert.equal(store.map.get(SOUND_KEY), "true");
});

await test("a mid write failure rolls every key back and reports failure", () => {
  const store = fakeStorage({ [COURSES_KEY]: "\"the old courses\"", [PROFILE_KEY]: "\"the old profile\"" }, PROFILE_KEY);
  const res = applyCortexImport(cortexFixtureState, store);
  assert.equal(res.ok, false, "a failed write was reported as imported");
  assert.ok(res.error.includes("nothing was changed"), `failure does not say the record is untouched: ${res.error}`);
  assert.equal(store.map.get(COURSES_KEY), "\"the old courses\"", "courses key was left half written");
  assert.equal(store.map.has(CLAIMS_KEY), false, "claims key was left behind by the failed import");
  assert.equal(store.map.get(PROFILE_KEY), "\"the old profile\"", "profile key was touched by the failed import");
  assert.equal(store.map.has(SOUND_KEY), false, "sound key was left behind by the failed import");
});

await test("a write that does not read back counts as a failure", () => {
  const base = fakeStorage();
  const tampering = {
    getItem: (k) => { const v = base.getItem(k); return v == null ? v : v + "x"; },
    setItem: (k, v) => base.setItem(k, v),
    removeItem: (k) => base.removeItem(k),
  };
  const res = applyCortexImport(cortexFixtureState, tampering);
  assert.equal(res.ok, false, "an unverifiable write was reported as imported");
});

await test("the import handler applies through the transactional writer", () => {
  assert.ok(learnSrc.includes("applyCortexImport(parsed.state, localStorage)"), "the import handler does not use applyCortexImport");
});

// ─═════════════════════════════════════════════════════════════════
group("XP economy: points follow learning, not activity");

await test("the award values are the rebalanced ones", () => {
  assert.equal(XP_CORRECT, 10);
  assert.equal(XP_WRONG, 1, "a wrong answer earns the token point, not 4");
  assert.equal(XP_BATTLE, 6);
  assert.equal(XP_LESSON_FINISH, 20);
});

await test("match runs pay for clean work and decay with misses", () => {
  assert.equal(matchScore(0), 10);
  assert.equal(matchScore(1), 8);
  assert.equal(matchScore(2), 6);
  assert.equal(matchScore(4), 2);
  assert.equal(matchScore(5), 1, "a messy finish still earns the token point");
  assert.equal(matchScore(12), 1, "the token point is the floor");
});

await test("the replay scale pays full, then half, then nothing", () => {
  assert.equal(lessonXpScale(0), 1);
  assert.equal(lessonXpScale(1), 0.5);
  assert.equal(lessonXpScale(2), 0);
  assert.equal(lessonXpScale(9), 0);
  assert.equal(scaleXp(10, lessonXpScale(0)), 10);
  assert.equal(scaleXp(10, lessonXpScale(1)), 5);
  assert.equal(scaleXp(20, lessonXpScale(1)), 10);
  assert.equal(scaleXp(10, lessonXpScale(2)), 0);
});

await test("lesson results count completions for the replay scale", () => {
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  prog = applyLessonResult(prog, path0, flat0[0].id, 90);
  assert.equal(prog.lessons[flat0[0].id].completions, 1);
  prog = applyLessonResult(prog, path0, flat0[0].id, 90);
  assert.equal(prog.lessons[flat0[0].id].completions, 2);
  const legacy = { lessons: { [flat0[1].id]: { done: true, best: 50 } }, lastPathId: "", lastLessonId: "" };
  const after = applyLessonResult(legacy, path0, flat0[1].id, 60);
  assert.equal(after.lessons[flat0[1].id].completions, 2, "a record written before the counter counts its done state as the first completion");
});

await test("the Player pays through the scale, and reading cards pay nothing", () => {
  assert.ok(learnSrc.includes("pay(correct ? XP_CORRECT : XP_WRONG)"), "quiz checks do not pay the rebalanced values");
  assert.ok(learnSrc.includes("pay(matchScore(matchMistakes))"), "match completion does not score through matchScore");
  assert.ok(learnSrc.includes("pay(res.xp)"), "order checks do not pay the scored value");
  assert.ok(!learnSrc.includes("award(2)"), "advancing past a card still pays 2 XP");
  assert.ok(!learnSrc.includes("onProgress(2, course)"), "advancing past a card still reports 2 XP");
  assert.ok(learnSrc.includes("scaleXp(XP_LESSON_FINISH, xpScaleNow())"), "the finish bonus is not scaled by replays");
});

// ─═════════════════════════════════════════════════════════════════
group("Formatting: findings keep the emphasis they had in the answer");

await test("cleanText keeps emphasis marks and drops citation markers", () => {
  const out = cleanText("**Memory consolidation** improved in _Rattus norvegicus_ after sleep [3].");
  assert.ok(out.includes("**Memory consolidation**"), `bold marks were stripped: ${out}`);
  assert.ok(out.includes("_Rattus norvegicus_"), `species marks were stripped: ${out}`);
  assert.ok(!out.includes("[3]"), "the citation marker survived cleaning");
});

await test("double asterisks parse as bold, underscores as italics", () => {
  const bold = parseRichText("**memory consolidation** matters");
  assert.equal(JSON.stringify(bold), JSON.stringify([
    { text: "memory consolidation", italic: false, bold: true },
    { text: " matters", italic: false },
  ]));
  const species = parseRichText("seen in _Rattus norvegicus_ colonies");
  assert.ok(species.some((s) => s.italic && s.text === "Rattus norvegicus"), "underscore species name is not an italic segment");
  const mixed = parseRichText("a *Homo sapiens* fossil and a **bold** claim");
  assert.ok(mixed.some((s) => s.italic && s.text === "Homo sapiens"), "asterisk species name lost its italics");
  assert.ok(mixed.some((s) => s.bold && s.text === "bold"), "bold term lost its bold");
});

await test("generated card text renders through RichText on the card surfaces", () => {
  for (const needle of ["<RichText text={card.why} />", "<RichText text={opt} />", "<RichText text={side.claim} />", "<RichText text={card.prompt} />", "<RichText text={card.statement} />"]) {
    assert.ok(learnSrc.includes(needle), `a card surface does not render through RichText: ${needle}`);
  }
});

// ─═════════════════════════════════════════════════════════════════
group("Tour honesty, the builtin source note, and catalog blurbs");

await test("the tour describes taught lessons and real quizzes, with no paper talk", () => {
  // Pivot contract (2026-10-13): the tour once scoped paper grading and
  // paper quoting claims per learner kind. Courses no longer reference
  // papers at all, so the tour now describes the one flow every course
  // shares: teach plainly, then quiz what was taught.
  assert.ok(TOUR_STEPS[1].body.includes("only then quizzes you on it"), "the teach step does not promise teaching before quizzing");
  assert.ok(TOUR_STEPS[2].body.includes("standard textbook material"), "the catalog step does not name the textbook standard");
  assert.ok(TOUR_STEPS[2].body.includes("built from a search"), "the catalog step does not mention search built courses");
  assert.ok(!TOUR_STEPS.some((s) => (s.title + " " + s.body).includes("Cortex grades you against the paper itself")),
    "the tour still promises paper grading somewhere");
  assert.ok(TOUR_STEPS[3].body.includes("daily practice"), "the review step does not say how lessons stay fresh");
  assert.ok(TOUR_STEPS[3].body.includes("review schedule"), "the review step does not name the review schedule");
});

await test("builtin lessons carry an honest source note, with no invented citation", () => {
  const hits = learnSrc.match(/for Cortex from standard textbook material/g) || [];
  assert.ok(hits.length >= 3, `the textbook source note should appear in the tour, the path view, and the lesson intro; found ${hits.length}`);
  assert.ok(learnSrc.includes("quote no single paper"), "the source note does not say plainly that no paper is quoted");
});

await test("catalog blurbs describe coverage instead of asserting facts", () => {
  assert.equal(CATALOG.length, 6, "the catalog should hold six shelves");
  const topics = CATALOG.flatMap((c) => c.topics);
  assert.equal(topics.length, 24, "the catalog should hold 24 topics");
  for (const t of topics) {
    assert.ok(typeof t.b === "string" && t.b.length > 10, `${t.t} has no real blurb`);
    assert.ok(!t.b.includes("-"), `blurb carries a dash: ${t.b}`);
  }
  const all = topics.map((t) => t.b).join(" ");
  for (const flat of ["Half your oxygen comes from these", "Pain is an opinion the brain can revise", "Gravity is geometry", "A teaspoon of soil holds a civilization"]) {
    assert.ok(!all.includes(flat), `a flat factual assertion is still on the home surface: ${flat}`);
  }
});

group("Quiz options: restatements, not lifts");

/* Dusty's 2026-10-13 ruling: quiz options were the papers' own
   sentences, so the correct one could be spotted by matching its
   opening words against text the player had already seen. These
   fixtures pin the fix: options are restatements, distractors
   share the frame and the length band, and the verbatim finding
   survives only in the feedback (card.why). */
const QUIZ_SOURCES = [
  { title: "Sleep loss and infection risk", authors: "Prather AA, Cohen S", journal: "Sleep", year: 2015 },
  { title: "Dream content across sleep stages", authors: "Nielsen T", journal: "Sleep Medicine Reviews", year: 2017 },
  { title: "Resident sleepiness after overnight shifts", authors: "Lockley SW", journal: "BMJ", year: 2019 },
  { title: "A supplement and reaction time", authors: "Smith J, Doe A", journal: "Nutrients", year: 2021 },
];
const CLAIM_TRIAL = { text: "In a randomized trial, adults who slept under six hours showed a 23% higher rate of infection over the following winter, compared with adults who slept eight hours or more.", sourceIdx: 1 };
const CLAIM_DREAM = { text: "Dream properties evaluated using the Dream Property Scale showed qualitative differences between SOREMP and NREMP dream reports, with more emotional content in the later REM periods of the night.", sourceIdx: 2 };
const CLAIM_RESIDENT = { text: "Sleep loss raised next day sleepiness scores by 41% in a crossover study of 28 medical residents working overnight shifts in a teaching hospital.", sourceIdx: 3 };
const CLAIM_SUPPLEMENT = { text: "Compared with a placebo group, volunteers taking the supplement showed reaction times that were 12% faster after eight weeks of daily use in the laboratory.", sourceIdx: 4 };
const QUIZ_CLAIMS = [CLAIM_TRIAL, CLAIM_DREAM, CLAIM_RESIDENT, CLAIM_SUPPLEMENT];

await test("restateClaim strips the report frame and swaps the scaffolding words", () => {
  const photo = "We investigated how seven nights of insufficient sleep (6 h time in bed), compared to sufficient sleep, alter periodic and aperiodic components of the phasic and tonic REM sleep electroencephalography (EEG), in 542 sleep recordings of 36 young adults.";
  const out = restateClaim(photo);
  assert.notEqual(out, photo, "the photo's pretest option survived verbatim");
  assert.ok(out.startsWith("Seven nights of"), `the report frame survived: ${out.slice(0, 40)}`);
  assert.ok(out.includes("too little sleep"), "insufficient was not restated in plain words");
  assert.notEqual(firstWordsOf(out, 3), firstWordsOf(photo, 3), "the opening three words still match the source sentence");
});

await test("restateClaim breaks the opening of a findings sentence with no frame to strip", () => {
  const out = restateClaim(CLAIM_DREAM.text);
  assert.notEqual(out, CLAIM_DREAM.text, "the dream claim survived verbatim");
  assert.ok(out.includes("assessed"), "evaluated was not swapped");
  assert.notEqual(firstWordsOf(out, 3), firstWordsOf(CLAIM_DREAM.text, 3), "the opening three words still match");
  const moved = restateClaim(CLAIM_TRIAL.text);
  assert.ok(moved.endsWith("in a randomized trial."), `the front clause was not moved: ${moved.slice(-30)}`);
  assert.notEqual(firstWordsOf(moved, 3), firstWordsOf(CLAIM_TRIAL.text, 3), "the trial claim still opens with its source words");
});

await test("a generated quiz offers restatements only, with the verbatim finding kept for feedback", () => {
  const card = quizCard(CLAIM_TRIAL, QUIZ_CLAIMS, QUIZ_SOURCES);
  assert.equal(card.options.length, 4, "a quiz should offer four options");
  assert.ok(!card.options.includes(CLAIM_TRIAL.text), "the verbatim finding is still an option");
  assert.notEqual(card.options[card.correct], CLAIM_TRIAL.text, "the correct option is the verbatim finding");
  for (const opt of card.options) {
    assert.notEqual(firstWordsOf(opt, 3), firstWordsOf(CLAIM_TRIAL.text, 3),
      `an option opens with the finding's own words: ${opt.slice(0, 40)}`);
  }
  assert.equal(card.why, CLAIM_TRIAL.text, "the feedback quote must stay the verbatim finding");
  assert.equal(card.cite, undefined, "a generated quiz card still carries a citation");
  assert.equal(card.paperTitle, undefined, "a generated quiz card still carries a paper title");
});

await test("quiz options sit in one length band around the answer", () => {
  // The stated band: every option is at least half and at most
  // double the correct option's length, so length alone cannot
  // single the answer out.
  for (const claim of QUIZ_CLAIMS) {
    const card = quizCard(claim, QUIZ_CLAIMS, QUIZ_SOURCES);
    assert.equal(card.options.length, 4, `quiz for "${claim.text.slice(0, 30)}" shipped ${card.options.length} options`);
    const ref = card.options[card.correct].length;
    for (const opt of card.options) {
      assert.ok(opt.length >= ref * 0.5 && opt.length <= ref * 2,
        `option length ${opt.length} sits outside the band around the answer's ${ref}: ${opt.slice(0, 40)}`);
    }
  }
});

await test("no generated option opens with any course finding's words", () => {
  const seenOpenings = new Set(QUIZ_CLAIMS.map((c) => firstWordsOf(c.text, 3)));
  for (const claim of QUIZ_CLAIMS) {
    const card = quizCard(claim, QUIZ_CLAIMS, QUIZ_SOURCES);
    for (const opt of card.options) {
      assert.ok(!seenOpenings.has(firstWordsOf(opt, 3)),
        `an option opens with a seen finding's words: ${opt.slice(0, 40)}`);
      assert.ok(!QUIZ_CLAIMS.some((c) => c.text === opt), "an option is a verbatim course finding");
    }
  }
});

await test("the correct option's position is not fixed across questions", () => {
  const positions = new Set(QUIZ_CLAIMS.map((c) => quizCard(c, QUIZ_CLAIMS, QUIZ_SOURCES).correct));
  assert.ok(positions.size >= 2, `the answer sat in the same slot for every question: ${[...positions]}`);
});

await test("extracted claims flow into restated quizzes while feedback stays verbatim", () => {
  const md = "## Summary\n\nAdults who slept under six hours showed a 23% higher rate of infection over the following winter in the trial cohort. [1]\n";
  const claims = extractClaims(md);
  assert.equal(claims.length, 1, "the fixture answer should yield exactly one claim");
  const pool = [...claims, ...QUIZ_CLAIMS];
  const card = quizCard(claims[0], pool, QUIZ_SOURCES);
  assert.equal(card.why, claims[0].text, "feedback must quote the extracted finding word for word");
  assert.ok(!card.options.includes(claims[0].text), "the extracted finding shipped as a verbatim option");
  assert.notEqual(firstWordsOf(card.options[card.correct], 3), firstWordsOf(claims[0].text, 3),
    "the correct option opens with the extracted finding's words");
});

group("Search built courses: the attribution screen and honest card drops");

/* The panel's leak (2026-10-14): a cited sentence wearing its
   citation on its face ("Smith et al. (2023) found...") passed the
   fragment guard, which only rejected stacked attributions, and
   became taught text, options, and verbatim feedback. The screen
   below rejects the shape outright; these fixtures prove the
   fragment guard alone would have let every leaky sentence
   through, so the screen is what does the work. */
const LEAK_MD = `## Summary

Smith et al. (2023) found that adults who slept under six hours caught colds far more often over the following winter months. [1]
Jones and Lee (2021) reported that short sleep raised next day sleepiness scores by 41% in resident physicians on overnight wards. [2]
Volunteers taking the supplement reacted 12% faster after eight weeks of daily use in the laboratory (Garcia, 2020). [1]
Adults who slept under six hours showed a 23% higher rate of infection over the following winter, compared with adults who slept eight hours or more. [1]
Sleep loss raised next day sleepiness scores by 41% in a crossover trial of medical residents working overnight shifts in a teaching hospital. [2]
Compared with a placebo group, volunteers taking the supplement showed reaction times that were 12% faster after eight weeks of daily use. [1]
Dream reports gathered after awakenings from rapid eye movement sleep carried more emotional content than reports from deep sleep in the same night. [2]
`;
const LEAK_SOURCES = [
  { title: "Sleep duration and infection risk in adults", authors: "Prather AA", journal: "Sleep", year: 2015 },
  { title: "Sleepiness in resident physicians on night wards", authors: "Lockley SW", journal: "BMJ", year: 2019 },
];
const CLEAN_CLAIMS = [
  "Adults who slept under six hours showed a 23% higher rate of infection over the following winter, compared with adults who slept eight hours or more.",
  "Sleep loss raised next day sleepiness scores by 41% in a crossover trial of medical residents working overnight shifts in a teaching hospital.",
  "Compared with a placebo group, volunteers taking the supplement showed reaction times that were 12% faster after eight weeks of daily use.",
  "Dream reports gathered after awakenings from rapid eye movement sleep carried more emotional content than reports from deep sleep in the same night.",
];

await test("the attribution screen catches each citation shape and passes plain statements", () => {
  assert.equal(hasAttributionShape("Smith et al. (2023) found that short sleep doubled infection rates."), true);
  assert.equal(hasAttributionShape("Jones and Lee (2021) reported that short sleep raised sleepiness scores."), true);
  assert.equal(hasAttributionShape("Volunteers reacted faster after eight weeks of daily use (Garcia, 2020)."), true);
  assert.equal(hasAttributionShape("Adults who slept under six hours showed a higher rate of infection."), false);
  // The fragment guard alone admits every leaky shape above; only
  // the attribution screen keeps them out of the claim pool.
  assert.equal(looksLikeFragment("Smith et al. (2023) found that adults who slept under six hours caught colds far more often over the following winter months."), false);
  assert.equal(looksLikeFragment("Jones and Lee (2021) reported that short sleep raised next day sleepiness scores by 41% in resident physicians on overnight wards."), false);
});

await test("extractClaims keeps only the plain statements from a mixed answer", () => {
  const claims = extractClaims(LEAK_MD);
  // Spread into a local array: the VM realm's arrays fail
  // deepStrictEqual's prototype check against this realm's.
  assert.deepEqual([...claims.map((c) => c.text)], CLEAN_CLAIMS,
    "a leaky sentence reached the claim pool, or a clean one was lost");
});

await test("a course built from a mixed answer carries no attribution anywhere", () => {
  const course = createCourseFromResults("how sleep affects health", LEAK_SOURCES, LEAK_MD);
  assert.ok(course, "the clean claims should still build a course");
  // The learner facing content only: the record's own timestamps
  // (createdAt) legitimately carry the current year.
  const blob = JSON.stringify({ title: course.title, lessons: course.lessons, vocab: course.vocab });
  assert.ok(!/Smith|Jones|Lee|Garcia/.test(blob), "an author name reached the built course");
  assert.ok(!/\bet al\b/i.test(blob), "an et al reached the built course");
  assert.ok(!/\b(19|20)\d{2}\b/.test(blob), "a year reached the built course");
  const basicsNote = course.lessons[0].cards[0];
  assert.equal(basicsNote.kind, "note", "the first lesson does not open with teaching");
  for (const t of CLEAN_CLAIMS.slice(0, 3)) {
    assert.ok(basicsNote.text.includes(t), `a clean claim is not taught: ${t.slice(0, 40)}`);
  }
});

const LONE_CLAIM = { text: "Exposure to bright morning light helps older adults fall asleep quickly at night and wake refreshed, with steadier energy through the day and a body clock that keeps its rhythm across the seasons, while dim indoor light leaves sleep shallow and broken.", sourceIdx: 1 };

await test("quizCard drops the card when no in band option set exists", () => {
  // No number and no flippable word means no mutations; alone in
  // its pool it has no siblings either. The old code relaxed the
  // band and shipped anyway; the card must now be dropped.
  assert.equal(quizCard(LONE_CLAIM, [LONE_CLAIM], QUIZ_SOURCES), null,
    "a card with no in band distractors shipped instead of dropping");
});

await test("a dropped check is recorded on the course and its statement is still taught", () => {
  const md = `## Summary

${LONE_CLAIM.text} [1]
Adults who slept under six hours showed a 23% higher rate of infection over the following winter. [1]
Sleep loss raised next day sleepiness scores by 41% among residents working overnight shifts. [2]
Volunteers taking the supplement showed reaction times that were 12% faster with daily use. [1]
`;
  const course = createCourseFromResults("light and sleep", LEAK_SOURCES, md);
  assert.ok(course, "the course should build from the remaining claims");
  // The long statement is checked twice in the build (its lesson
  // and the review lesson) and dropped both times: its only
  // candidate distractors are its far shorter siblings, all out
  // of band. The drop count on the record says so.
  assert.equal(course.droppedChecks, 2, `expected 2 recorded drops, found ${course.droppedChecks}`);
  const basicsNote = course.lessons[0].cards[0];
  assert.ok(basicsNote.text.includes(LONE_CLAIM.text), "the dropped statement is not taught in the reading passage");
  for (const lesson of course.lessons) {
    for (const card of lesson.cards) {
      assert.notEqual(card.why, LONE_CLAIM.text, "a quiz card shipped for the statement that should have been dropped");
      if (card.options) for (const opt of card.options) {
        assert.ok(opt.length <= LONE_CLAIM.text.length * 0.75, "an out of band option shipped on some card");
      }
    }
  }
});

await test("cloze keeps its shape: the value is the question, the quote stays in feedback", () => {
  // Audited for the same gaming: cloze options are bare values,
  // so there is no opening to match; the verbatim sentence is
  // the prompt by design and the finding stays quoted in why.
  const card = clozeCard(CLAIM_TRIAL, QUIZ_CLAIMS, QUIZ_SOURCES);
  assert.ok(card, "a numbered claim should produce a cloze card");
  assert.ok(card.prompt.includes("_____"), "the cloze prompt does not blank the value");
  assert.equal(card.options[card.correct], "23%", "the cloze answer is not the finding's value");
  assert.equal(card.why, CLAIM_TRIAL.text, "cloze feedback must quote the finding verbatim");
});


group("Catalog topic courses: taught lessons, real quizzes");

const topicLessons = TOPIC_COURSES.flatMap((p) =>
  flattenPathLessons(p).map((l) => ({ path: p, lesson: l })));
const topicCardsFlat = [];
for (const { path, lesson } of topicLessons) {
  for (const card of lesson.cards) topicCardsFlat.push({ path, lesson, card });
}
const TC_STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "and", "or", "is", "are", "it", "its", "that", "this", "with", "for", "from", "by", "as", "at", "be", "can", "not", "but", "so", "than", "then", "when", "which", "what", "who", "how", "why", "into", "over", "after", "before", "about", "their", "they", "them", "one", "two", "all", "any", "each", "more", "most", "some", "such", "own", "our", "your", "you", "yourself", "only", "also", "just", "even", "still", "every", "both"]);
const tcWords = (s) => [...new Set(String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !TC_STOP.has(w)))];
const tcCardText = (c) => [c.title, c.kicker, c.text, c.question, c.statement, c.prompt, c.why, ...(c.options || []), ...(c.pairs || []).flatMap((p) => [p.left, p.right])].filter(Boolean).join(" ");
const tcDisplayStrings = [];
for (const p of TOPIC_COURSES) {
  tcDisplayStrings.push(p.title, p.blurb);
  for (const u of p.units) {
    tcDisplayStrings.push(u.title, u.subtitle);
    for (const l of u.lessons) {
      tcDisplayStrings.push(l.title, l.subtitle);
      for (const c of l.cards) tcDisplayStrings.push(tcCardText(c));
    }
  }
}

await test("every one of the 24 catalog topics has exactly one authored topic course", () => {
  const topics = CATALOG.flatMap((c) => c.topics.map((t) => ({ shelf: c.name, title: t.t })));
  assert.equal(topics.length, 24, `expected 24 catalog topics, found ${topics.length}`);
  assert.equal(TOPIC_COURSES.length, 24, `expected 24 topic courses, found ${TOPIC_COURSES.length}`);
  for (const { shelf, title } of topics) {
    const matches = TOPIC_COURSES.filter((p) => p.title === title);
    assert.equal(matches.length, 1, `topic "${title}" has ${matches.length} courses`);
    assert.equal(matches[0].category, shelf, `"${title}" sits on the wrong shelf`);
    assert.equal(topicPathFor(title), matches[0], `topicPathFor does not resolve "${title}"`);
  }
});

await test("each topic course is 3 lessons of 5 to 8 cards, teaching lessons open with a note", () => {
  for (const { path, lesson } of topicLessons) {
    assert.ok(lesson.cards.length >= 5 && lesson.cards.length <= 8,
      `${path.title} / ${lesson.title} has ${lesson.cards.length} cards`);
    const interactive = lesson.cards.filter(isInteractiveCard).length;
    assert.ok(interactive >= 3, `${path.title} / ${lesson.title} has only ${interactive} interactive cards`);
  }
  for (const p of TOPIC_COURSES) {
    const lessons = flattenPathLessons(p);
    assert.equal(lessons.length, 3, `${p.title} has ${lessons.length} lessons`);
    assert.equal(lessons[0].cards[0].kind, "note", `${p.title} lesson 1 does not open with teaching`);
    assert.equal(lessons[1].cards[0].kind, "note", `${p.title} lesson 2 does not open with teaching`);
    assert.ok(lessons[2].cards.every(isInteractiveCard), `${p.title} review lesson is not all checks`);
  }
});

await test("every quiz answer in a topic course is covered by an earlier card in the same course", () => {
  // Coverage is vocabulary based, with two honest allowances: word
  // families count as one word (bacteria covers bacterial, via a six
  // letter stem), and glue words carry no topic. A correct option
  // must still reuse at least half its content words from earlier
  // cards in the same course; a question about untaught material
  // (the failure this fixture exists to catch) scores near zero.
  // True statements must restate taught words the same way; for a
  // FALSE statement the check lands on its correction instead: the
  // why must speak the taught language, and the statement must at
  // least be about the taught topic.
  const GLUE = new Set("the a an of to in on and or is are it its that this with for from by as at be can not but so than then when which what who how why into over after before about their they them one two all any each more most some such own our your you yourself only also just even still every both against between while during without within across around among along upon onto makes make made gets get got goes going come comes came take takes took give gives gave keep keeps kept used using uses way ways thing things kind kinds part parts back away together alone almost nearly really quite rather instead indeed perhaps probably sometimes usually often always never ever yet already means much same fully several".split(" "));
  const cwords = (s) => [...new Set(String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !GLUE.has(w)))];
  const covered = (w, seen) => seen.includes(w) || (w.length >= 6 && seen.includes(w.slice(0, 6)));
  const cov = (text, seen) => { const need = cwords(text); if (!need.length) return 1; return need.filter((w) => covered(w, seen)).length / need.length; };
  for (const p of TOPIC_COURSES) {
    let seen = "";
    for (const lesson of flattenPathLessons(p)) {
      for (const card of lesson.cards) {
        if (card.kind === "truefalse") {
          if (card.answer === true) {
            assert.ok(cov(card.statement, seen) >= 0.5,
              `${p.title}: true statement is not a restatement of taught material: ${card.statement.slice(0, 50)}`);
          } else {
            assert.ok(cwords(card.statement).some((w) => covered(w, seen)),
              `${p.title}: false statement is not even about the taught topic: ${card.statement.slice(0, 50)}`);
            assert.ok(cov(card.why, seen) >= 0.5,
              `${p.title}: the correction of a false statement does not speak the taught language: ${card.statement.slice(0, 50)}`);
          }
        } else if (card.options && card.correct != null) {
          assert.ok(cov(card.options[card.correct], seen) >= 0.5,
            `${p.title}: quiz "${String(card.question).slice(0, 40)}" answer is not taught before it is asked`);
        }
        if (card.kind === "match") {
          for (const pair of card.pairs) {
            const lw = cwords(pair.left);
            if (lw.length) assert.ok(lw.some((w) => covered(w, seen)),
              `${p.title}: match term "${pair.left}" was never named in an earlier card`);
          }
        }
        seen = (seen + " " + tcCardText(card).toLowerCase()).trim();
      }
    }
  }
});

await test("no topic course string references papers, findings, citations, years, or dashes", () => {
  for (const s of tcDisplayStrings) {
    assert.ok(!/\bet al\b/i.test(s), `citation pattern in topic text: ${s.slice(0, 60)}`);
    assert.ok(!/\[(\d+)\]/.test(s), `bracket citation in topic text: ${s.slice(0, 60)}`);
    assert.ok(!/\b(19|20)\d{2}\b/.test(s), `a year in topic text: ${s.slice(0, 60)}`);
    assert.ok(!/\bpaper(s)?\b/i.test(s), `paper talk in topic text: ${s.slice(0, 60)}`);
    assert.ok(!/\bfinding(s)?\b/i.test(s), `finding talk in topic text: ${s.slice(0, 60)}`);
    assert.ok(!/\bliterature\b/i.test(s), `literature talk in topic text: ${s.slice(0, 60)}`);
    assert.ok(!s.includes("-") && !s.includes("\u2014") && !s.includes("\u2013"), `a dash in topic text: ${s.slice(0, 60)}`);
  }
});

const lpCardText = (c) => [c.title, c.kicker, c.text, c.question, c.statement, c.prompt, c.why, ...(c.options || []), ...(c.items || []), ...(c.pairs || []).flatMap((p) => [p.left, p.right])].filter(Boolean).join(" ");
const lpDisplayStrings = [];
for (const p of LEARNING_PATHS) {
  lpDisplayStrings.push(p.title, p.blurb);
  for (const u of p.units) {
    lpDisplayStrings.push(u.title, u.subtitle);
    for (const l of u.lessons) {
      lpDisplayStrings.push(l.title, l.subtitle);
      for (const c of l.cards) lpDisplayStrings.push(lpCardText(c));
    }
  }
}

await test("no learning path string references papers, findings, citations, years, or dashes", () => {
  // The same ban the topic courses live under, extended to the
  // builtin paths (2026-10-14): their deepen cards used to send
  // learners off to papers and findings, against the standing
  // ruling that the learning flow references no papers at all.
  for (const s of lpDisplayStrings) {
    assert.ok(!/\bet al\b/i.test(s), `citation pattern in path text: ${s.slice(0, 60)}`);
    assert.ok(!/\[(\d+)\]/.test(s), `bracket citation in path text: ${s.slice(0, 60)}`);
    assert.ok(!/\b(19|20)\d{2}\b/.test(s), `a year in path text: ${s.slice(0, 60)}`);
    assert.ok(!/\bpaper(s)?\b/i.test(s), `paper talk in path text: ${s.slice(0, 60)}`);
    assert.ok(!/\bfinding(s)?\b/i.test(s), `finding talk in path text: ${s.slice(0, 60)}`);
    assert.ok(!/\bliterature\b/i.test(s), `literature talk in path text: ${s.slice(0, 60)}`);
    assert.ok(!s.includes("-") && !s.includes("\u2014") && !s.includes("\u2013"), `a dash in path text: ${s.slice(0, 60)}`);
    assert.ok(!/build a course/i.test(s) && !/search for/i.test(s), `a deepen card still sends learners to a search: ${s.slice(0, 60)}`);
  }
  const deepens = allCards.filter((c) => c.kind === "deepen");
  assert.equal(deepens.length, 24, `expected 24 deepen cards under the ban, found ${deepens.length}`);
});

await test("topic quizzes are real quizzes: four fresh options, in band, none opening with a digit", () => {
  for (const { path, card } of topicCardsFlat) {
    if (!card.options || card.kind === "truefalse") continue;
    assert.equal(card.options.length, 4, `${path.title}: "${String(card.question).slice(0, 40)}" has ${card.options.length} options`);
    const keys = card.options.map(normKey);
    assert.equal(new Set(keys).size, keys.length, `${path.title}: duplicate option text in "${String(card.question).slice(0, 40)}"`);
    assert.ok(Number.isInteger(card.correct) && card.correct >= 0 && card.correct < 4, `${path.title}: bad correct index`);
    assert.ok(card.why && card.why.length > 10, `${path.title}: a check has no real explanation`);
    // The anti gaming rule for authored sets: options are comparable
    // to each other (longest at most triple the shortest), and the
    // correct option is never the unique extreme, at least one
    // distractor sits within 0.6 to 1.67 of its length. Length alone
    // must not name the answer.
    const lens = card.options.map((o) => o.length);
    const ref = lens[card.correct];
    assert.ok(Math.max(...lens) <= Math.min(...lens) * 3,
      `${path.title}: option lengths spread too wide in "${String(card.question).slice(0, 40)}": ${lens.join(", ")}`);
    assert.ok(card.options.some((o, i) => i !== card.correct && o.length >= ref * 0.6 && o.length <= ref * 1.67),
      `${path.title}: the correct option stands alone by length in "${String(card.question).slice(0, 40)}"`);
    for (const opt of card.options) {
      assert.ok(!/^\d/.test(opt), `${path.title}: an option opens with a digit: ${opt.slice(0, 40)}`);
    }
  }
});

await test("the learning flow carries no paper machinery at all", () => {
  assert.ok(!learnSrc.includes("THE FINDING"), "the feedback sheet still has a finding label");
  assert.ok(!learnSrc.includes("FROM THE LITERATURE"), "a reading card label survived");
  assert.ok(!learnSrc.includes("papers in this course"), "a paper count survived in course stats");
  // Citation era helpers with no call site left in the module
  // (2026-10-14): shortCite dressed claims in author and year
  // dress, formatYearValue existed only to serve it, and
  // citeCountOf read a citation count nothing displays.
  assert.ok(!learnSrc.includes("function shortCite"), "the dead citation formatter survived");
  assert.ok(!learnSrc.includes("function formatYearValue"), "the dead year formatter survived");
  assert.ok(!learnSrc.includes("function citeCountOf"), "the dead citation counter survived");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
