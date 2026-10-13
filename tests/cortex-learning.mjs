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
