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
  "hashStr", "seededShuffle",
  "mkNote", "mkQuiz", "mkTrueFalse", "mkMatch", "mkOrder", "mkDeepen",
  "LEARNING_PATHS", "INTERACTIVE_KINDS", "isInteractiveCard",
  "flattenPathLessons", "isLessonUnlocked", "pathProgress",
  "applyLessonResult", "buildDailyPracticeCards", "validateCurriculum",
  "MASTERY_MIN_PCT", "isLessonMastered", "orderScore", "parseRichText",
  "TOUR_STEPS",
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
const context = vm.createContext({});
vm.runInContext(js, context);
const {
  LEARNING_PATHS, isInteractiveCard, flattenPathLessons, isLessonUnlocked,
  pathProgress, applyLessonResult, buildDailyPracticeCards, validateCurriculum,
  MASTERY_MIN_PCT, isLessonMastered, orderScore, parseRichText, TOUR_STEPS,
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

await test("a checked attempt with nothing in place keeps the house floor", () => {
  const res = orderScore(["d", "c", "b", "a"], ["a", "b", "c", "d"]);
  assert.equal(res.correctPositions, 0);
  assert.equal(res.xp, 4, "wrong answers earn 4 XP on every other card kind");
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
  assert.ok(learnSrc.includes("Right. Plus 10 XP."), "right answers are not announced");
  assert.ok(learnSrc.includes("Matched ") && learnSrc.includes("does not match."), "match progress is not announced");
  assert.ok(learnSrc.includes("Lesson complete. Plus 20 XP for finishing."), "lesson completion is not announced");
});

await test("the Player manages focus and Escape", () => {
  assert.ok(learnSrc.includes("tabIndex={-1}"), "the Player shell is not a focus target");
  assert.ok(learnSrc.includes("shellRef"), "the Player shell has no ref for focus");
  assert.ok(learnSrc.includes('e.key === "Escape"'), "Escape does not close the Player");
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

await test("home leads with learning and shelves come after", () => {
  const daily = learnSrc.indexOf("DAILY PRACTICE");
  const paths = learnSrc.indexOf("LEARNING PATHS");
  const shelves = learnSrc.indexOf("COURSES FROM YOUR SEARCHES");
  assert.ok(daily > 0 && paths > daily, "daily practice should sit above the paths grid");
  assert.ok(shelves > paths, "courses from searches should sit below the paths");
  assert.ok(learnSrc.includes("cerebrum-learn2-progress"), "built in progress storage key missing");
  assert.ok(learnSrc.includes("Start daily practice"), "daily practice entry missing");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
