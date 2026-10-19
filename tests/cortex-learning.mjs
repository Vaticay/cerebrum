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
import { readFileSync, readdirSync, existsSync } from "node:fs";
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
  "decodeHtmlEntities", "decodeStringsDeep", "cardIsPaperBacked", "courseIsPaperBacked",
  "retirePaperBackedLearning", "loadLearnCourses", "dueClaims", "retrievability",
  "mkNote", "mkQuiz", "mkTrueFalse", "mkMatch", "mkOrder", "mkDeepen",
  "mkVisualQ", "mkSpotError", "mkPredict", "mkBuild",
  "CORTEX_TAGLINE", "RANK_LADDER", "rankForXp", "topicMasteryLevel",
  "DAY_MS", "FADING_AFTER_DAYS", "MASTERED_FADING_AFTER_DAYS",
  "lessonLastActivityMs", "isLessonFading", "fadingLessons", "buildReviewSessionCards",
  "OPENER_STYLES", "lessonOpenerStyle",
  "LEARNING_PATHS", "CATALOG", "TOPIC_COURSES", "topicPathFor", "INTERACTIVE_KINDS", "isInteractiveCard",
  "flattenPathLessons", "isLessonUnlocked", "pathProgress", "pathPaceFor",
  "applyLessonResult", "buildDailyPracticeCards", "validateCurriculum",
  "MASTERY_MIN_PCT", "isLessonMastered", "orderScore", "parseRichText",
  "XP_CORRECT", "XP_WRONG", "XP_LESSON_FINISH",
  "matchScore", "lessonXpScale", "scaleXp",
  "TOUR_STEPS", "focusTrapStep",
  "CORTEX_EXPORT_FORMAT", "CORTEX_EXPORT_VERSION",
  "COURSES_KEY", "CLAIMS_KEY", "PROFILE_KEY", "SOUND_KEY", "BUILTIN_PROGRESS_KEY",
  "cortexIsPlainObject", "cortexIsFiniteNumber", "cortexIsStringArray",
  "cortexEmptyProfile", "cortexEmptyBuiltinProgress", "cortexImportFailure",
  "cortexCourseProblem", "cortexClaimProblem", "cortexProgressRecordProblem",
  "buildCortexExport", "parseCortexImport", "applyCortexImport",
  "normKey", "protectPeriods", "looksLikeFragment", "extractClaims",
  /* Quiz repeat helpers (2026-10-18): the similarity measure and
     the within card and across lesson repeat checks that
     cortexCourseProblem, validateCurriculum, and quizCard now call. */
  "QUIZ_SIMILARITY_MAX", "SIMILARITY_STOPWORDS", "similarityTokenList", "similarityBigramSet",
  "cardTextSimilarity", "textContainsPassage", "passagesRepeat", "cardInternalRepeat", "lessonRepeatProblem",
  "NUMBER_RE", "numbersIn", "hasAttributionShape", "claimSeq",
  "FLIP_WORDS", "flipDirection", "scaleNumberIn", "mutatedVariants", "nearestClaims",
  "RESTATE_WORDS", "firstWordsOf", "swapRestateWords", "stripReportFrame",
  "moveFrontClause", "rotateMidClause", "moveTrailingPhrase", "restateClaim", "withinOptionBand",
  "shuffledOptionsForCard",
  "quizCard", "clozeCard",
  "VOCAB_STOP", "extractVocab", "vocabCard",
  "loadJSON", "saveJSON", "loadClaims", "saveClaims", "createCourseFromResults",
  "todayKey", "cortexLoopProblem",
  "SPARKS_RATES", "SPARKS_NEVER_BUYS", "emptyLoop", "loopForDay",
  "buildDailyQuests", "questState", "recordLoopEvent", "settleQuestPayouts",
  "awardSparksForRankUps", "spendSparks", "buyStreakFreeze",
  "streakRepairOffer", "applyStreakRepair", "reminderFor",
  "LEAGUE_GROUP_SIZE", "LEAGUE_DAILY_POINTS_CAP", "LEAGUES_WEEKLY_ACTIVE_GATE",
  "leagueDailyPoints", "leagueWeeklyPoints", "leagueGroupFor", "leaguesAreOpen",
  "shareCardModel",
  "visitGapDays", "shelfGlyphFor", "shelfObjects", "SHELF_GLYPH_BY_PATH", "SHELF_GLYPH_BY_CATEGORY",
  "novaMoodFor", "tipEligible", "TIP_GAP_MS",
  "NOVA_ACTIVITY_EVENT", "NOVA_WAKE_STEP_MS", "novaIdleStageFor", "novaAdaptiveStateFor", "emitNovaActivity",
  "createNovaBrain", "novaBrainObserve", "novaBrainDecide",
  /* Removed 2026-10-15 (the old model purge): CHARACTER_POSES and
     the rig data tables (NOVA_RIG_STATES, NOVA_RIG_MOUTHS,
     NOVA_RIG_D, NOVA_RIG_FILAMENTS) retired with the two old
     models they described. The purge test below pins their
     absence from the source instead of extracting them. */
  "QUIRKS_KEY", "QUIRK_GAG_COOLDOWN_MS", "QUIRK_SHELF_COOLDOWN_MS",
  "QUIRK_FAST_MS", "QUIRK_FAST_COOLDOWN_MS", "QUIRK_HARD_COOLDOWN_MS",
  "QUIRK_BROW_COOLDOWN_MS", "QUIRK_PERFECT_COOLDOWN_MS", "QUIRK_POKE_GAP_MS",
  "QUIRK_POKE_LOCK_MS", "QUIRK_EASY_STREAK",
  "NOVA_EGG_LINES", "NOVA_SUMMON_LINES", "NOVA_CELEBRATE_LINES", "NOVA_LESSON_DONE_LINES", "NOVA_GAG_LINES",
  "NOVA_LATE_LINES", "NOVA_MORNING_LINES", "NOVA_MORNING_DENIAL",
  "NOVA_POKE_LINE_THREE", "NOVA_POKE_LINE_FIVE", "NOVA_SHELF_LINE", "NOVA_SHELF_FAVORITE_LINE",
  "NOVA_POKE_STEP_ONE", "NOVA_POKE_STEP_TWO", "NOVA_POKE_STEP_THREE", "NOVA_POKE_STEP_FOUR", "NOVA_POKE_STEP_FIVE",
  "NOVA_POKE_LINES",
  /* Feedback teaching extraction (2026-10-15, the voice
     overhaul's second half): her reaction opener banks and
     the pure helpers that compose her spoken teaching from a
     card's own fields, pinned by the feedback tests below. */
  "NOVA_FEEDBACK_RIGHT_LINES", "NOVA_FEEDBACK_WRONG_LINES",
  "plainSpeechText", "speechSentence", "feedbackCorrectionFor", "feedbackTeachLine",
  "NOVA_OPINION_HARD_LINE", "NOVA_OPINION_FAST_LINE", "NOVA_OPINION_BROW_LINE", "NOVA_OPINION_PERFECT_LINE",
  "loadNovaQuirks", "saveNovaQuirks", "pickNovaLine", "hourLineSet",
  "computeNovaMemory", "memoryLineFor", "loadNovaMemoryFacts",
  "opinionForEvent", "pokeStep", "gagDue", "recordGag", "recordNovaVisit", "shelfCommentFor", "pickEggLine",
];
/* Tour script extraction (2026-10-15, the cutscene redo): the
   tour's script moved with the tour into src/NovaTour.jsx, so
   declFor falls back to that file's AST and source. In
   practice only TOUR_STEPS resolves there; everything else
   still comes from LearnView.jsx. */
const tourSrc = readFileSync(join(root, "src/NovaTour.jsx"), "utf8");
const tourAst = parse(tourSrc, { sourceType: "module", plugins: ["jsx"] });
function declFor(name) {
  for (const [tree, src] of [[ast, learnSrc], [tourAst, tourSrc]]) {
    for (const node of tree.program.body) {
      const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
      if (!decl) continue;
      if (decl.type === "FunctionDeclaration" && decl.id && decl.id.name === name) return { decl, src };
      if (decl.type === "VariableDeclaration") {
        const d = decl.declarations.find((x) => x.id && x.id.name === name);
        if (d) return { decl, src };
      }
    }
  }
  return null;
}
const chunks = [];
for (const name of WANTED) {
  const found = declFor(name);
  assert.ok(found, `${name} must be declared in src/LearnView.jsx or src/NovaTour.jsx`);
  chunks.push(found.src.slice(found.decl.start, found.decl.end));
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
  pathProgress, pathPaceFor, applyLessonResult, buildDailyPracticeCards, validateCurriculum,
  MASTERY_MIN_PCT, isLessonMastered, orderScore, parseRichText, TOUR_STEPS,
  focusTrapStep, cleanText,
  decodeHtmlEntities, decodeStringsDeep, cardIsPaperBacked, courseIsPaperBacked,
  retirePaperBackedLearning, loadLearnCourses, loadClaims, dueClaims, retrievability,
  XP_CORRECT, XP_WRONG, XP_LESSON_FINISH,
  matchScore, lessonXpScale, scaleXp,
  COURSES_KEY, CLAIMS_KEY, PROFILE_KEY, SOUND_KEY, BUILTIN_PROGRESS_KEY,
  CORTEX_EXPORT_FORMAT, CORTEX_EXPORT_VERSION, buildCortexExport, parseCortexImport,
  applyCortexImport, restateClaim, quizCard, clozeCard, extractClaims, firstWordsOf, normKey,
  hasAttributionShape, createCourseFromResults, looksLikeFragment,
  QUIZ_SIMILARITY_MAX, cardTextSimilarity, textContainsPassage, passagesRepeat, cardInternalRepeat, lessonRepeatProblem,
  hashStr, seededShuffle, shuffledOptionsForCard,
  INTERACTIVE_KINDS, CORTEX_TAGLINE, RANK_LADDER, rankForXp, topicMasteryLevel,
  FADING_AFTER_DAYS, MASTERED_FADING_AFTER_DAYS, lessonLastActivityMs, isLessonFading,
  fadingLessons, buildReviewSessionCards, OPENER_STYLES, lessonOpenerStyle,
  todayKey, cortexLoopProblem,
  SPARKS_RATES, SPARKS_NEVER_BUYS, emptyLoop, loopForDay,
  buildDailyQuests, questState, recordLoopEvent, settleQuestPayouts,
  awardSparksForRankUps, spendSparks, buyStreakFreeze,
  streakRepairOffer, applyStreakRepair, reminderFor,
  LEAGUE_GROUP_SIZE, LEAGUE_DAILY_POINTS_CAP, LEAGUES_WEEKLY_ACTIVE_GATE,
  leagueDailyPoints, leagueWeeklyPoints, leagueGroupFor, leaguesAreOpen,
  shareCardModel,
  visitGapDays, shelfGlyphFor, shelfObjects,
  novaMoodFor, tipEligible, TIP_GAP_MS,
  NOVA_ACTIVITY_EVENT, NOVA_WAKE_STEP_MS, novaIdleStageFor, novaAdaptiveStateFor, emitNovaActivity,
  createNovaBrain, novaBrainObserve, novaBrainDecide,
  QUIRKS_KEY, QUIRK_GAG_COOLDOWN_MS, QUIRK_SHELF_COOLDOWN_MS,
  QUIRK_FAST_MS, QUIRK_FAST_COOLDOWN_MS, QUIRK_HARD_COOLDOWN_MS,
  QUIRK_BROW_COOLDOWN_MS, QUIRK_PERFECT_COOLDOWN_MS, QUIRK_POKE_GAP_MS,
  QUIRK_POKE_LOCK_MS, QUIRK_EASY_STREAK,
  NOVA_EGG_LINES, NOVA_SUMMON_LINES, NOVA_CELEBRATE_LINES, NOVA_LESSON_DONE_LINES, NOVA_GAG_LINES,
  NOVA_LATE_LINES, NOVA_MORNING_LINES, NOVA_MORNING_DENIAL,
  NOVA_POKE_LINE_THREE, NOVA_POKE_LINE_FIVE, NOVA_SHELF_LINE, NOVA_SHELF_FAVORITE_LINE,
  NOVA_POKE_STEP_ONE, NOVA_POKE_STEP_TWO, NOVA_POKE_STEP_THREE, NOVA_POKE_STEP_FOUR, NOVA_POKE_STEP_FIVE,
  NOVA_POKE_LINES,
  NOVA_FEEDBACK_RIGHT_LINES, NOVA_FEEDBACK_WRONG_LINES,
  plainSpeechText, speechSentence, feedbackCorrectionFor, feedbackTeachLine,
  NOVA_OPINION_HARD_LINE, NOVA_OPINION_FAST_LINE, NOVA_OPINION_BROW_LINE, NOVA_OPINION_PERFECT_LINE,
  loadNovaQuirks, saveNovaQuirks, pickNovaLine, hourLineSet,
  computeNovaMemory, memoryLineFor, loadNovaMemoryFacts,
  opinionForEvent, pokeStep, gagDue, recordGag, recordNovaVisit, shelfCommentFor, pickEggLine,
  cortexEmptyProfile, cortexEmptyBuiltinProgress,
} = context.__x;

// ── Extract the egg's pure helpers from NovaEgg.jsx the same way ──
const eggSrc = readFileSync(join(root, "src/NovaEgg.jsx"), "utf8");
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const eggAst = parse(eggSrc, { sourceType: "module", plugins: ["jsx"] });
const EGG_WANTED = [
  "EGG_BASE_COOLDOWN_MS", "EGG_LONG_COOLDOWN_MS", "EGG_CELEBRATE_COOLDOWN_MS",
  "EGG_AMBIENT_CHANCE", "EGG_TICK_MS", "WORDMARK_GAP_MS", "WORDMARK_CLICKS",
  "eggCooldownMs", "eggBlocked", "eggEligible", "eggCelebrateEligible",
  "countWordmarkClick", "recordEggAppearance", "recordEggDismissal",
];
function eggDeclFor(name) {
  for (const node of eggAst.program.body) {
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
const eggChunks = [];
for (const name of EGG_WANTED) {
  const decl = eggDeclFor(name);
  assert.ok(decl, `${name} must be declared in src/NovaEgg.jsx`);
  eggChunks.push(eggSrc.slice(decl.start, decl.end));
}
const eggJs = transformSync(eggChunks.join("\n") + `\n;globalThis.__egg = { ${EGG_WANTED.join(", ")} };`, { loader: "jsx" }).code;
const eggContext = vm.createContext({});
vm.runInContext(eggJs, eggContext);
const {
  EGG_BASE_COOLDOWN_MS, EGG_LONG_COOLDOWN_MS, EGG_CELEBRATE_COOLDOWN_MS,
  EGG_AMBIENT_CHANCE, EGG_TICK_MS, WORDMARK_GAP_MS, WORDMARK_CLICKS,
  eggCooldownMs, eggBlocked, eggEligible, eggCelebrateEligible,
  countWordmarkClick, recordEggAppearance, recordEggDismissal,
} = eggContext.__egg;

/* The Rive contract lane (2026-10-15): src/NovaRive.jsx, the
   code side of the Rive rebuild, is extracted the same way so
   the state machine contract, the quip bank, and the mapping
   helpers are pinned without mounting a canvas. Only the pure
   declarations are extracted; the components and the quip hook
   stay in the app, and their wiring is pinned by source below. */
const riveSrc = readFileSync(join(root, "src/NovaRive.jsx"), "utf8");
const speechSrc = readFileSync(join(root, "src/NovaSpeech.jsx"), "utf8");
const riveAst = parse(riveSrc, { sourceType: "module", plugins: ["jsx"] });
function riveDeclFor(name) {
  for (const node of riveAst.program.body) {
    const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (!decl) continue;
    const isVar = decl.type === "VariableDeclaration" && decl.declarations.some((d) => d.id.name === name);
    const isFn = decl.type === "FunctionDeclaration" && decl.id && decl.id.name === name;
    if (isVar || isFn) return { start: node.start, end: node.end };
  }
  return null;
}
const RIVE_WANTED = [
  "NOVA_RIVE_STATE_MACHINE", "NOVA_RIVE_SRC", "NOVA_RIVE_ASSET", "NOVA_RIVE_INPUTS", "NOVA_RIVE_EVENTS",
  "NOVA_QUIP_BANK", "QUIP_MIN_GAP_MS", "QUIP_LONG_IDLE_MS",
  "QUIP_CATEGORY_COOLDOWN_MS", "QUIP_CATEGORY_CHANCE",
  "quizCategoryForState", "searchCategoryForState", "quipCategoryForRiveEvent",
  "quipGateAllows", "pickQuipLine", "quizPointerFor", "appStateForActivity", "quizStateForSheet",
];
const riveChunks = [];
for (const name of RIVE_WANTED) {
  const decl = riveDeclFor(name);
  assert.ok(decl, `${name} must be declared in src/NovaRive.jsx`);
  riveChunks.push(riveSrc.slice(decl.start, decl.end).replace(/^export\s+/, ""));
}
const riveJs = transformSync(riveChunks.join("\n") + `\n;globalThis.__rive = { ${RIVE_WANTED.join(", ")} };`, { loader: "jsx" }).code;
const riveContext = vm.createContext({});
vm.runInContext(riveJs, riveContext);
const {
  NOVA_RIVE_STATE_MACHINE, NOVA_RIVE_SRC, NOVA_RIVE_ASSET, NOVA_RIVE_INPUTS, NOVA_RIVE_EVENTS,
  NOVA_QUIP_BANK, QUIP_MIN_GAP_MS, QUIP_LONG_IDLE_MS,
  QUIP_CATEGORY_COOLDOWN_MS, QUIP_CATEGORY_CHANCE,
  quizCategoryForState, searchCategoryForState, quipCategoryForRiveEvent,
  quipGateAllows, pickQuipLine, quizPointerFor, appStateForActivity, quizStateForSheet,
} = riveContext.__rive;

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

await test("every lesson has 5 to 10 cards and at least 3 interactive ones", () => {
  // Ceiling raised 8 to 10 on 2026-10-14 with the flagship lesson
  // standard (ten physical cards across the nine beats). Legacy
  // lessons still run 5 to 8.
  for (const { path, lesson } of allLessons) {
    assert.ok(lesson.cards.length >= 5 && lesson.cards.length <= 10,
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

await test("the legacy paths keep the four unit shape; the flagships hold their own", () => {
  // Updated 2026-10-14: The Human Body was rebuilt as the flagship
  // (six units, five lessons each, a checkpoint per unit, and the
  // capstone, for 37 lessons), superseding its tier two shape. The
  // three legacy paths keep the three unit, six lesson shape.
  // Nova content wave (2026-10-14): a second flagship joins, Matter
  // and Energy, built to the same discipline (six units, 37 lessons
  // with capstone), so the curriculum total moves 55 to 92.
  // Curriculum upgrade (2026-10-19, the owner's order to raise the
  // ceiling to college level): every path gains one advanced unit
  // at the end. The legacy paths run four units and eight lessons,
  // the flagships seven units and forty lessons, and the total
  // moves 92 to 104. Tier two indices are untouched because the
  // new units append after them.
  let total = 0;
  for (const p of LEARNING_PATHS) {
    if (p.id === "the-human-body" || p.id === "matter-and-energy") {
      assert.equal(p.units.length, 7, `the flagship ${p.title} has ${p.units.length} units`);
      assert.equal(flattenPathLessons(p).length, 40, `the flagship ${p.title} should hold 40 lessons`);
      total += flattenPathLessons(p).length;
      continue;
    }
    assert.equal(p.units.length, 4, `${p.title} has ${p.units.length} units`);
    assert.equal(flattenPathLessons(p).length, 8, `${p.title} should hold 8 lessons`);
    total += flattenPathLessons(p).length;
  }
  assert.equal(total, 104, `curriculum holds ${total} lessons, not 104`);
});

await test("the tier two units and lessons are the authored ones", () => {
  LEARNING_PATHS.forEach((p, i) => {
    // The flagship Body path (2026-10-14) supersedes tier two; its
    // flat indices 4 and 5 are a flagship lesson and a checkpoint,
    // so the authored pair pin covers the legacy paths only.
    // Nova content wave (2026-10-14): Matter and Energy is a second
    // flagship on the same terms, so it skips here too.
    if (p.id === "the-human-body" || p.id === "matter-and-energy") return;
    const flat = flattenPathLessons(p);
    assert.equal(flat[4].unitTitle, TIER_TWO[i].unit, `${p.title} tier two unit renamed`);
    assert.equal(flat[5].unitTitle, TIER_TWO[i].unit);
    assert.deepEqual([flat[4].title, flat[5].title], TIER_TWO[i].lessons,
      `${p.title} tier two lessons are not the authored pair`);
  });
});

await test("every tier two lesson follows the six card lesson shape", () => {
  for (const p of LEARNING_PATHS) {
    // Legacy paths only: the flagship Body lessons follow the ten
    // card flagship standard instead (2026-10-14), and Matter and
    // Energy (Nova content wave, 2026-10-14) follows it too.
    if (p.id === "the-human-body" || p.id === "matter-and-energy") continue;
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
  // Curriculum upgrade (2026-10-19): the science path holds eight
  // lessons since its advanced unit landed, so the total is 8.
  assert.equal(pp.total, 8);
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
    // Flagship accommodation (2026-10-14): Body lessons carry their
    // hands on slot in a four kind rotation, match, order, build,
    // and spot the error, so the slot is any of the four there.
    // Legacy lessons keep the match or order rule. Nova content
    // wave (2026-10-14): Matter and Energy is a flagship too and
    // takes the same four kind rotation.
    const handsOn = (path.id === "the-human-body" || path.id === "matter-and-energy")
      ? ["match", "order", "build", "spoterror"]
      : ["match", "order"];
    assert.ok(handsOn.some((k) => kinds.has(k)),
      `${path.title} / ${lesson.title} has no hands on practice card`);
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

await test("the species name in the authored cards is marked for italics", () => {
  // The example used to live in a Body deepen card; the flagship
  // rebuild (2026-10-14) retired the deepen shape there, and the
  // mention now sits in the senses teach card on the blind spot.
  // The law is unchanged: a species name in authored copy is
  // carried in asterisks so it renders italic.
  const carrier = allCards.filter((c) => (c.text || "").includes("Homo"));
  assert.ok(carrier.length >= 1, "the Homo sapiens mention is missing from the authored cards");
  const segs = parseRichText(carrier[0].text);
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
  // Updated 2026-10-14 (design wave 3): this pin used to require
  // the STATUS green and red as the Player's verdict tones. The
  // reconciled Nova discipline supersedes that contract, so the
  // pin now asserts the corrected one: a correct answer takes the
  // muted gold accent, a wrong answer stays neutral (the warm
  // gray WRONG_LINE on the same cream card), the old bright blue
  // selection literals are gone too, and STATUS keeps its job on
  // true status surfaces (the course delete confirm) instead of
  // grading answers.
  for (const hex of ["#58CC02", "#FF4B4B", "#D7FFB8", "#FFDFE0", "#84D8FF", "#DDF4FF"]) {
    assert.ok(!learnSrc.includes(hex), `borrowed palette literal still present: ${hex}`);
  }
  assert.ok(learnSrc.includes("const toneGood = accent"), "the correct state is not the gold accent");
  assert.ok(learnSrc.includes("const toneBad = WRONG_LINE"), "the wrong state is not the neutral line");
  assert.ok(!learnSrc.includes("withAlpha(STATUS.good"), "the green verdict wash survived in the Player");
  assert.ok(learnSrc.includes("STATUS.bad"), "STATUS tones vanished entirely instead of staying on status surfaces");
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
  // Reading note, 2026-10-14 (home restructure wave): these
  // sections no longer stack on one page. Daily practice sits on
  // the Today screen and the paths and topic courses sit on the
  // Paths screen, in this order in the source and in the
  // navigation alike; the ordering assertions below now pin that
  // screen order, not a scroll order.
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
  // or two from screen to screen. One addition since 2026-10-14 (wave
  // eight): literal fontSize: 16 on text input fields, where the mobile
  // floor requires 16px but the body token is 15 by the owner's standing
  // call; an input literal of any other value still fails here.
  const raw = learnSrc.match(/fontSize: \d+(\.\d+)?/g) || [];
  const nonInput = raw.filter((r) => r !== "fontSize: 16");
  assert.ok(nonInput.length <= 3, `expected at most 3 non input raw fontSize literals, found ${nonInput.length}: ${nonInput.join(", ")}`);
});

group("Progress export and import: the record can leave this browser as a file");

// Fixture updated 2026-10-16 (bug audit finding 8): import now
// rejects a lesson with an empty cards list, so this fixture's
// lesson carries one valid quiz card instead of no cards.
const cortexFixtureState = {
  courses: [{ id: "course-1", title: "Sleep science", lessons: [{ id: "l1", cards: [{ kind: "quiz", question: "Q?", options: ["a", "b"], correct: 0, why: "w" }] }], doneLessons: ["l1"], xpEarned: 40 }],
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

// Placement note, 2026-10-14 (design wave 3): the export and
// import controls moved off the home into the Nova settings
// screen, per the organization ruling. The assertions below pin
// presence and wiring in LearnView, not the home specifically,
// so they stand unchanged; only this test's name moves with the
// controls.
await test("export and import controls render in the Nova settings progress surface", () => {
  assert.ok(learnSrc.includes("Export progress"), "no export control on the Cortex home");
  assert.ok(learnSrc.includes("Import progress"), "no import control on the Cortex home");
  assert.ok(learnSrc.includes("buildCortexExport({ courses, claims, profile, builtinProgress, sound: soundOn }"), "export button does not build from the live state");
  assert.ok(learnSrc.includes("parseCortexImport(String(reader.result"), "import does not validate through the parser");
  assert.ok(learnSrc.includes('accept=".json"'), "import file input does not limit itself to json files");
  assert.ok(learnSrc.includes("Replace the Nova progress in this browser"), "import replaces without asking first");
  assert.ok(learnSrc.includes("not a cloud copy"), "the copy does not say plainly that the export is a kept file");
  assert.ok(learnSrc.includes('a.download = "cerebrum-cortex-progress-" + todayKey() + ".json"'), "export file is not named with the date");
});

// ─═════════════════════════════════════════════════════════════════
group("Import validation: deep shapes, not top level types");

// Fixture updated 2026-10-16 (bug audit finding 8): import now
// enforces the authored match floor of 3 pairs, so this fixture's
// match card carries three pairs instead of one.
const deepDoc = () => buildCortexExport({
  courses: [{
    id: "course-9", title: "Gut science", sourceCount: 2, doneLessons: [], xpEarned: 0,
    lessons: [{ id: "l1", title: "Start", subtitle: "s", cards: [
      { kind: "quiz", question: "Q?", options: ["a", "b"], correct: 1, why: "w" },
      { kind: "match", prompt: "m", pairs: [{ left: "a", right: "1" }, { left: "b", right: "2" }, { left: "c", right: "3" }] },
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
group("Paper backed retirement: legacy courses and claims are dropped");

/* Dusty ordered the paper backed questions removed from the learning
   flow: people are not going to know what a paper reported, and the
   scraped citation text that shipped as options is not a quiz. These
   fixtures pin the retirement: a course stored before the pivot,
   carrying a paper card and a quiz dressed in citation boilerplate,
   is dropped whole with its review claims, while a taught course
   built after the pivot is kept, with HTML entities in its strings
   decoded and nothing else about it changed. Imports cannot bring
   the legacy record back, and exports do not carry it forward. */
const legacyPaperCard = {
  kind: "paper", title: "Interactions between time and space",
  meta: "Topi&#x107; V · The Philosophical Quarterly · 1975",
  year: 1975, citations: 12, text: "A passage.",
};
const legacyQuizCard = {
  kind: "quiz", claimId: "cl-legacy-1",
  question: "What did John North et al. (1975) report?",
  options: [
    "In a go/no-go task, participants pressed a button when they found the target.",
    "North Search for other works by this author on: Oxford Academic Google Scholar The Philosophical Quarterly, Volume 25, Issue 101, October 1975, Pages 374-376, https://doi.",
    "The results revealed faster responses to shorter durations.",
    "Abstract interactions between time and space in children anchor an active debate.",
  ],
  correct: 1,
  why: "North Search for other works by this author on: Oxford Academic.",
  cite: "North et al. (1975)", paperTitle: "Search for other works",
};
const legacyCourse = {
  id: "course-legacy-1", title: "Attention and time", sourceCount: 3,
  doneLessons: ["basics"], xpEarned: 40,
  lessons: [{ id: "basics", title: "The papers", cards: [legacyPaperCard, legacyQuizCard] }],
};
const taughtNoteCard = {
  kind: "note", kicker: "Teach", title: "How sleep stores the day",
  text: "Memory caf&eacute; talk aside, sleep stores the day.",
};
const taughtQuizCard = {
  kind: "quiz", claimId: "cl-taught-1",
  question: "Which of these statements is correct?",
  options: [
    "Sleep helps the brain store new memories from the day.",
    "Staying awake all night makes memory stronger the next day.",
    "Memories are stored only while a person is awake and alert.",
    "Dreams erase every memory that was formed during the day.",
  ],
  correct: 0,
  why: "Sleep replays the day's events so they can be stored.",
};
const taughtCourse = {
  id: "course-taught-1", title: "How memory works", sourceCount: 2,
  doneLessons: [], xpEarned: 0,
  lessons: [{ id: "memory-basics", title: "Memory basics", cards: [taughtNoteCard, taughtQuizCard] }],
};
const legacyClaim = {
  id: "cl-legacy-1", courseId: "course-legacy-1", courseTitle: "Attention and time",
  card: legacyQuizCard, stability: 2, due: 1, reps: 1, lapses: 0, last: 1,
};
const taughtClaim = {
  id: "cl-taught-1", courseId: "course-taught-1", courseTitle: "How memory works",
  card: taughtQuizCard, stability: 2, due: 1, reps: 1, lapses: 0, last: 1,
};
const profileFixture = {
  xp: 500, days: ["2026-10-13", "2026-10-14"], bridged: [], freezes: 2,
  freezeMilestone: 0, sparks: 35, loopDay: "", loop: null, reminderHour: null, leaguesOptIn: false,
};
const cloneRetireFixture = (v) => JSON.parse(JSON.stringify(v));
const bothRetireClaims = () => ({ "cl-legacy-1": cloneRetireFixture(legacyClaim), "cl-taught-1": cloneRetireFixture(taughtClaim) });
// A localStorage shaped stub over the same memStore the VM context
// was built with, so an apply through it is what the loaders read.
const memStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => { memStore.set(k, String(v)); },
  removeItem: (k) => { memStore.delete(k); },
};

await test("cardIsPaperBacked flags paper cards and citation dressed quizzes, and passes taught cards", () => {
  assert.equal(cardIsPaperBacked(legacyPaperCard), true, "the paper card was not flagged");
  assert.equal(cardIsPaperBacked(legacyQuizCard), true, "the legacy quiz card was not flagged");
  assert.equal(cardIsPaperBacked({ kind: "quiz", question: "What did Q et al. (2026) report?", options: [], correct: 0 }), true,
    "a bare report question was not flagged");
  assert.equal(cardIsPaperBacked(taughtQuizCard), false, "the taught quiz card was flagged");
  assert.equal(cardIsPaperBacked(taughtNoteCard), false, "the note card was flagged");
  assert.equal(cardIsPaperBacked(null), false, "a missing card was flagged");
});

await test("courseIsPaperBacked reads a whole course by its cards", () => {
  assert.equal(courseIsPaperBacked(legacyCourse), true, "the legacy course was not flagged");
  assert.equal(courseIsPaperBacked(taughtCourse), false, "the taught course was flagged");
});

await test("retirePaperBackedLearning drops the legacy course and its claims, and decodes what it keeps", () => {
  // In the browser the entries handed to this helper come from
  // JSON.parse in the same realm, so build same realm copies here
  // the same way (a test realm object would trip the deep
  // decoder's plain object guard that storage objects never meet).
  const vmRealm = (v) => vm.runInContext("JSON.parse(" + JSON.stringify(JSON.stringify(v)) + ")", context);
  const out = retirePaperBackedLearning(
    vmRealm([legacyCourse, taughtCourse]),
    vmRealm(bothRetireClaims()));
  assert.equal(out.courses.length, 1, `expected only the taught course to survive, kept ${out.courses.length}`);
  assert.equal(out.courses[0].id, "course-taught-1", "the surviving course is not the taught one");
  assert.deepEqual([...out.retiredCourseIds], ["course-legacy-1"], "the retired course ids do not name the legacy course");
  assert.deepEqual(Object.keys(out.claims), ["cl-taught-1"], "the retired claims view still holds a legacy claim");
  assert.equal(out.retiredClaims, 1, `expected 1 retired claim, got ${out.retiredClaims}`);
  const keptNote = out.courses[0].lessons[0].cards[0];
  assert.ok(keptNote.text.includes("café"), `the kept note text was not decoded: ${keptNote.text}`);
  assert.ok(!JSON.stringify(out.courses[0]).includes("&#"), "an HTML entity survived in the kept course");
  assert.deepEqual([...out.courses[0].doneLessons], [...taughtCourse.doneLessons], "the kept course lost its finished lessons");
  assert.equal(out.courses[0].xpEarned, taughtCourse.xpEarned, "the kept course lost its earned XP");
  assert.equal(out.courses[0].sourceCount, taughtCourse.sourceCount, "the kept course lost its source count");
});

await test("decodeHtmlEntities decodes hex, decimal, and named entities, and cleanText uses it", () => {
  assert.equal(decodeHtmlEntities("Topi&#x107;"), "Topić", "the hex entity was not decoded");
  assert.equal(decodeHtmlEntities("caf&eacute;"), "café", "the named entity was not decoded");
  assert.equal(decodeHtmlEntities("a &amp; b"), "a & b", "the ampersand entity was not decoded");
  assert.equal(decodeHtmlEntities("&#263;"), "ć", "the decimal entity was not decoded");
  assert.equal(decodeHtmlEntities("&nosuchentity;"), "&nosuchentity;", "an unknown entity was changed");
  assert.equal(cleanText("Topi&#x107; V [1]"), "Topić V", "cleanText did not decode entities");
});

await test("the storage loaders return the retired view, so review never surfaces a paper backed card", () => {
  memStore.set(COURSES_KEY, JSON.stringify([legacyCourse, taughtCourse]));
  memStore.set(CLAIMS_KEY, JSON.stringify(bothRetireClaims()));
  const courses = loadLearnCourses();
  assert.equal(courses.length, 1, `the stored legacy course survived loading, kept ${courses.length}`);
  assert.equal(courses[0].id, "course-taught-1", "the loaded course is not the taught one");
  assert.ok(courses[0].lessons[0].cards[0].text.includes("café"), "the loaded course was not decoded");
  assert.ok(!JSON.stringify(courses[0]).includes("&#"), "an HTML entity survived in the loaded course");
  const claims = loadClaims();
  assert.deepEqual(Object.keys(claims), ["cl-taught-1"], "the loaded claims still hold a legacy claim");
  const due = [...dueClaims(claims)];
  assert.equal(due.length, 1, `expected exactly the taught claim to be due, got ${due.length}`);
  assert.equal(due[0].id, "cl-taught-1", "the due claim is not the taught one");
  for (const claim of due) {
    assert.equal(cardIsPaperBacked(claim.card), false, "a paper backed card would be handed to the Player");
  }
});

await test("an import cannot resurrect a paper backed course, and applying it keeps storage clean", () => {
  const doc = {
    format: CORTEX_EXPORT_FORMAT, version: CORTEX_EXPORT_VERSION,
    exportedAt: "2026-10-14T12:00:00.000Z",
    courses: [cloneRetireFixture(legacyCourse), cloneRetireFixture(taughtCourse)],
    claims: bothRetireClaims(),
    profile: cloneRetireFixture(profileFixture),
    builtinProgress: { lessons: {}, lastPathId: "", lastLessonId: "" },
    sound: false,
  };
  const parsed = parseCortexImport(JSON.stringify(doc));
  assert.equal(parsed.ok, true, parsed.error || "the import was refused");
  assert.equal(parsed.state.courses.length, 1, `the import kept ${parsed.state.courses.length} courses`);
  assert.equal(parsed.state.courses[0].id, "course-taught-1", "the imported course is not the taught one");
  assert.deepEqual(Object.keys(parsed.state.claims), ["cl-taught-1"], "the imported claims still hold a legacy claim");
  assert.equal(parsed.state.profile.xp, 500, "the imported profile lost its XP");
  assert.equal(parsed.state.profile.sparks, 35, "the imported profile lost its Sparks");
  assert.deepEqual([...parsed.state.profile.days], [...profileFixture.days], "the imported profile lost its days");
  assert.equal(parsed.retired.courses, 1, `expected 1 retired course on the import, got ${parsed.retired && parsed.retired.courses}`);
  assert.equal(parsed.retired.claims, 1, `expected 1 retired claim on the import, got ${parsed.retired && parsed.retired.claims}`);
  const applied = applyCortexImport(parsed.state, memStorage);
  assert.equal(applied.ok, true, applied.error || "the clean import would not apply");
  const courses = loadLearnCourses();
  assert.equal(courses.length, 1, "the applied import brought the legacy course back");
  assert.equal(courses[0].id, "course-taught-1", "the stored course after import is not the taught one");
  assert.deepEqual(Object.keys(loadClaims()), ["cl-taught-1"], "the stored claims after import still hold a legacy claim");
  const rawCourses = memStore.get(COURSES_KEY);
  assert.equal(typeof rawCourses, "string", "no courses were stored by the import");
  assert.ok(!rawCourses.includes("\"paper\""), "a paper card kind is still in the stored courses");
  assert.ok(!rawCourses.includes("et al"), "an et al is still in the stored courses");
  for (const key of [COURSES_KEY, CLAIMS_KEY, PROFILE_KEY, BUILTIN_PROGRESS_KEY, SOUND_KEY]) memStore.delete(key);
});

await test("an export does not carry a paper backed course or claim forward", () => {
  const exported = buildCortexExport({
    courses: [cloneRetireFixture(legacyCourse), cloneRetireFixture(taughtCourse)],
    claims: bothRetireClaims(),
    profile: cloneRetireFixture(profileFixture),
    builtinProgress: { lessons: {}, lastPathId: "", lastLessonId: "" },
    sound: false,
  });
  assert.equal(exported.courses.length, 1, `the export kept ${exported.courses.length} courses`);
  assert.equal(exported.courses[0].id, "course-taught-1", "the exported course is not the taught one");
  assert.deepEqual(Object.keys(exported.claims), ["cl-taught-1"], "the exported claims still hold a legacy claim");
  assert.deepEqual(asJSON(exported.profile), profileFixture, "the export changed the profile");
});

await test("the Player source carries no paper card branch or kind label", () => {
  assert.ok(!learnSrc.includes("courses stored before the pivot"), "the removed Player paper branch comment survived");
  assert.ok(!learnSrc.includes('c.kind === "paper" ? "Read"'), "the removed paper kind label survived");
});

await test("the Player source carries no battle branch, and a stored battle card retires its course", () => {
  // Permanent ruling (2026-10-15): papers stay out of lessons for
  // good. The claim battle was the last paper shaped card kind:
  // the Player rendered two sourced readings against each other,
  // claims and source labels alike. The branch is out, the kind
  // is out of INTERACTIVE_KINDS, and the storage screen retires
  // any stored course still holding one. The one surviving
  // mention of the kind in the source is the screen itself.
  assert.ok(!learnSrc.includes('card.kind === "battle" &&'), "the Player battle renderer survived");
  assert.ok(!learnSrc.includes("CLAIM BATTLE"), "the battle card heading survived");
  assert.ok(!INTERACTIVE_KINDS.includes("battle"), "battle is still an interactive kind");
  assert.equal(cardIsPaperBacked({ kind: "battle", question: "Which reading holds up?", claimA: "One plain statement.", sourceA: "Some Journal, 2021", claimB: "Another plain statement.", sourceB: "Another Journal, 2022" }), true, "a battle card was not flagged");
  assert.equal(courseIsPaperBacked({ lessons: [{ cards: [{ kind: "battle", claimA: "a", claimB: "b" }] }] }), true, "a course holding a battle card was not flagged");
});

// ─═════════════════════════════════════════════════════════════════
group("XP economy: points follow learning, not activity");

await test("the award values are the rebalanced ones", () => {
  assert.equal(XP_CORRECT, 10);
  assert.equal(XP_WRONG, 1, "a wrong answer earns the token point, not 4");
  // The battle award (a flat 6 for engaging a claim battle) was
  // removed on 2026-10-15 with the battle kind itself: battles
  // were paper machinery, and the owner's permanent ruling took
  // papers out of lessons for good.
  assert.ok(!learnSrc.includes("XP_BATTLE"), "the retired battle award survived");
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
  // The side.claim needle left the list on 2026-10-15: it pinned
  // the claim battle renderer, and the battle kind was retired
  // outright when the owner ruled papers out of lessons for good.
  for (const needle of ["<RichText text={card.why} />", "<RichText text={opt} />", "<RichText text={card.prompt} />", "<RichText text={card.statement} />"]) {
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

await test("builtin lessons carry an honest source note, with no paper talk on the surface", () => {
  // The tour's copy lives in NovaTour.jsx since the cutscene
  // redo (2026-10-15), so the note is counted across both
  // sources; the three homes are unchanged: the tour, the
  // path view, and the lesson intro.
  const hits = (learnSrc + "\n" + tourSrc).match(/for Nova from standard textbook material/g) || [];
  assert.ok(hits.length >= 3, `the textbook source note should appear in the tour, the path view, and the lesson intro; found ${hits.length}`);
  // Permanent ruling (2026-10-15): papers are out of lessons for
  // good, and lesson surfaces no longer talk about papers at all,
  // not even to say that none is quoted. This replaces the earlier
  // pin, which required the words "quote no single paper" in the
  // note; that wording was itself paper talk on a lesson surface.
  assert.ok(!learnSrc.includes("quote no single paper"), "a lesson surface still talks about papers");
  assert.ok(!learnSrc.includes("no papers needed"), "a lesson surface still talks about papers");
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

/* Changed 2026-10-18 (quiz repeat defect): the length band, opening
   words, and position pins below now run over the three claims
   whose restatements clear the new similarity gate. The fourth
   fixture claim (the supplement claim) no longer builds a card at
   all: its only restatement is a rotation of its own why passage
   (similarity 0.875 against the 0.85 maximum), so quizCard drops
   it, which the new repeat group below pins directly. */
const BUILDABLE_CLAIMS = [CLAIM_TRIAL, CLAIM_DREAM, CLAIM_RESIDENT];

await test("quiz options sit in one length band around the answer", () => {
  // The stated band: every option is at least half and at most
  // double the correct option's length, so length alone cannot
  // single the answer out.
  for (const claim of BUILDABLE_CLAIMS) {
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
  // Buildable subset only (changed 2026-10-18, see BUILDABLE_CLAIMS).
  for (const claim of BUILDABLE_CLAIMS) {
    const card = quizCard(claim, QUIZ_CLAIMS, QUIZ_SOURCES);
    for (const opt of card.options) {
      assert.ok(!seenOpenings.has(firstWordsOf(opt, 3)),
        `an option opens with a seen finding's words: ${opt.slice(0, 40)}`);
      assert.ok(!QUIZ_CLAIMS.some((c) => c.text === opt), "an option is a verbatim course finding");
    }
  }
});

await test("the correct option's position is not fixed across questions", () => {
  // Buildable subset only (changed 2026-10-18, see BUILDABLE_CLAIMS).
  const positions = new Set(BUILDABLE_CLAIMS.map((c) => quizCard(c, QUIZ_CLAIMS, QUIZ_SOURCES).correct));
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

await test("the attribution screen also catches yearless shapes and pre 1900 years", () => {
  // The fifth panel's second leak (2026-10-14): the screen only
  // rejected year carrying shapes, so "Smith found that...",
  // "According to Smith, ...", "Smith & Jones found that...", and
  // "Darwin (1859) proposed..." (a pre 1900 year escapes both old
  // year regexes) all flowed into built courses.
  assert.equal(hasAttributionShape("Smith found that adults who slept under six hours caught colds far more often."), true);
  assert.equal(hasAttributionShape("Smith & Jones found that short sleep raised next day sleepiness scores."), true);
  assert.equal(hasAttributionShape("Smith and Jones reported that short sleep raised next day sleepiness scores."), true);
  assert.equal(hasAttributionShape("According to Smith, adults who slept under six hours caught colds far more often."), true);
  assert.equal(hasAttributionShape("Darwin (1859) proposed that species change over time as environments change."), true);
  assert.equal(hasAttributionShape("Darwin proposed that species change over time as environments change."), true);
  assert.equal(hasAttributionShape("Garcia discovered that a short nap improved memory scores in older adults."), true);
  // The fragment guard alone admits the yearless shapes too; only
  // the widened screen keeps them out of the claim pool.
  assert.equal(looksLikeFragment("Smith found that adults who slept under six hours caught colds far more often over the following winter months."), false);
  assert.equal(looksLikeFragment("Darwin (1859) proposed that species change slowly over generations as the world around them changes."), false);
});

await test("the attribution screen catches the sixth panel's three remaining shapes", () => {
  // The verb list missed common attribution verbs, so these read
  // as plain teaching to the old screen.
  assert.equal(hasAttributionShape("Smith claimed that short sleep doubled the chance of catching a cold."), true);
  assert.equal(hasAttributionShape("Smith stated that short sleep doubled the chance of catching a cold."), true);
  assert.equal(hasAttributionShape("Garcia suggested that a short nap improved memory scores in older adults."), true);
  assert.equal(hasAttributionShape("Lee estimated that short sleep raised next day sleepiness scores."), true);
  assert.equal(hasAttributionShape("Smith published that short sleep doubled the chance of catching a cold."), true);
  assert.equal(hasAttributionShape("Darwin wrote that species change over time as environments change."), true);
  // A possessive name owning a research noun that governs a verb:
  // the name never touches the verb directly, so the name and verb
  // pattern above cannot see it.
  assert.equal(hasAttributionShape("Smith's study found that adults who slept under six hours caught colds far more often."), true);
  assert.equal(hasAttributionShape("Darwin's work suggested that species change over time as environments change."), true);
  // A bare pre 1900 year attached to a study reference: the old
  // final year check covered only 19xx and 20xx tokens.
  assert.equal(hasAttributionShape("A widely repeated study in 1859 linked short sleep with next day sleepiness."), true);
  assert.equal(hasAttributionShape("The claim traces to a trial in 1747 with sailors sleeping in short shifts."), true);
});

await test("near miss statements with no attribution shape stay admitted", () => {
  // The false positive bar: plain taught statements with
  // capitalised sentence starts and common nouns must still pass.
  // A name used as a topic word, with no speech or discovery verb,
  // no year, and no According opener, is legitimate teaching text
  // (a concept's namesake is a topic, not an attribution), and the
  // screen admits it on purpose; that is the documented line.
  assert.equal(hasAttributionShape("Sleep consolidates memories formed during the day."), false);
  assert.equal(hasAttributionShape("Darwin's finches differ from island to island in the shape of their beaks."), false);
  assert.equal(hasAttributionShape("Adults who slept under six hours showed a higher rate of infection."), false);
  assert.equal(hasAttributionShape("Results showed higher infection rates after short sleep in the trial cohort."), false);
  assert.equal(hasAttributionShape("Sleep loss raised next day sleepiness scores by 41% in a crossover trial of medical residents."), false);
});

const YEARLESS_LEAK_MD = `## Summary

Smith found that adults who slept under six hours caught colds far more often over the following winter months. [1]
According to Smith, short sleep doubles the chance of catching a cold over the following winter months. [1]
Darwin (1859) proposed that species change slowly over generations as the world around them changes. [2]
Adults who slept under six hours showed a 23% higher rate of infection over the following winter, compared with adults who slept eight hours or more. [1]
Sleep loss raised next day sleepiness scores by 41% in a crossover trial of medical residents working overnight shifts in a teaching hospital. [2]
Compared with a placebo group, volunteers taking the supplement showed reaction times that were 12% faster after eight weeks of daily use. [1]
Dream reports gathered after awakenings from rapid eye movement sleep carried more emotional content than reports from deep sleep in the same night. [2]
`;

await test("a course built from a yearless attribution answer carries neither name anywhere", () => {
  const claims = extractClaims(YEARLESS_LEAK_MD);
  assert.deepEqual([...claims.map((c) => c.text)], CLEAN_CLAIMS,
    "a yearless leaky sentence reached the claim pool, or a clean one was lost");
  const course = createCourseFromResults("how sleep affects health", LEAK_SOURCES, YEARLESS_LEAK_MD);
  assert.ok(course, "the clean claims should still build a course");
  const blob = JSON.stringify({ title: course.title, lessons: course.lessons, vocab: course.vocab });
  assert.ok(!/Smith|Darwin/.test(blob), "a yearless attribution name reached the built course");
  assert.ok(!/1859/.test(blob), "a pre 1900 citation year reached the built course");
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


group("Quiz repeat defect: no passage does two jobs (2026-10-18)");

/* The owner's photo (2026-10-18): a search built lesson on the
   black soldier fly microbiome, card 4 of 4, answered wrong. The
   picked option, the correct answer, and the why all recycled one
   long passage about the microbiome complementing innate immunity
   and cathepsin L, and the why passage appeared twice inside the
   feedback sheet itself. These pins hold the fix: a stated
   similarity measure with a stated maximum, enforced within a
   card, across a lesson, in generation, and in the feedback
   composition. */
const REPEAT_PASSAGE = "The microbiome complements the innate immunity of the host, and exposure to Escherichia coli induces up regulation of the cysteine protease cathepsin L in the gut, a response modulated by microbial signals that helps to control pathogen load.";
const repeatCard = () => ({
  kind: "quiz", question: "Which of these statements is correct?",
  options: [
    "Starvation causes a loss of microbial diversity in the gut over time",
    REPEAT_PASSAGE,
    "A core microbiome of a handful of taxa persists on almost any diet",
    "Larvae grow fastest when the gut carries no microbes at all",
  ],
  correct: 1, why: REPEAT_PASSAGE,
});
const repeatImportDoc = (card) => buildCortexExport({
  courses: [{ id: "course-repeat", title: "Repeat", lessons: [{ id: "l1", title: "Lesson", cards: [card] }] }],
  claims: {}, profile: { xp: 0, days: [] }, builtinProgress: { lessons: {} }, sound: false,
}, new Date());

await test("the similarity measure: verbatim scores 1, a one word change in a passage still repeats, distinct statements pass", () => {
  // The stated measure (2026-10-18): normalized token bigram
  // Jaccard, maximum QUIZ_SIMILARITY_MAX.
  assert.equal(QUIZ_SIMILARITY_MAX, 0.85, "the stated similarity maximum moved");
  assert.equal(cardTextSimilarity(REPEAT_PASSAGE, REPEAT_PASSAGE), 1, "a verbatim passage does not score 1");
  const oneWordChanged = REPEAT_PASSAGE.replace("pathogen load", "pathogen burden");
  assert.ok(cardTextSimilarity(REPEAT_PASSAGE, oneWordChanged) >= QUIZ_SIMILARITY_MAX,
    `a one word change in a passage scored ${cardTextSimilarity(REPEAT_PASSAGE, oneWordChanged)}, under the maximum`);
  assert.ok(passagesRepeat(REPEAT_PASSAGE, oneWordChanged), "a one word change in a passage is not a repeat");
  const distinct = "Sleep loss raised next day sleepiness scores in residents working overnight shifts at a teaching hospital.";
  assert.ok(cardTextSimilarity(REPEAT_PASSAGE, distinct) < QUIZ_SIMILARITY_MAX, "a distinct statement scored as a repeat");
  assert.ok(!passagesRepeat(REPEAT_PASSAGE, distinct), "a distinct statement is flagged as a repeat");
  // Verbatim containment: the why carrying the correct passage
  // whole, plus more, repeats it even though the longer text
  // dilutes the bigram score below the maximum.
  const whyLong = REPEAT_PASSAGE + " Sleep, by contrast, is governed by circadian signals deep in the brain.";
  assert.ok(cardTextSimilarity(REPEAT_PASSAGE, whyLong) < QUIZ_SIMILARITY_MAX, "the containment fixture should score under the maximum on bigrams alone");
  assert.ok(textContainsPassage(whyLong, REPEAT_PASSAGE), "the why does not contain the passage verbatim");
  assert.ok(passagesRepeat(REPEAT_PASSAGE, whyLong), "a why containing the answer verbatim is not a repeat");
});

await test("a card whose correct option repeats its why is rejected by the import validator and the curriculum validator", () => {
  const card = repeatCard();
  assert.ok((cardInternalRepeat(card) || "").includes("correct option repeats its why"),
    `the within card check missed the photographed card: ${cardInternalRepeat(card)}`);
  const parsed = parseCortexImport(JSON.stringify(repeatImportDoc(card)));
  assert.equal(parsed.ok, false, "an import carrying the photographed card was accepted");
  assert.ok((parsed.error || "").includes("repeats its why passage"), `the import error does not name the repeat: ${parsed.error}`);
  const paths = JSON.parse(JSON.stringify(LEARNING_PATHS));
  const lesson = paths[0].units[0].lessons[0];
  const qi = lesson.cards.findIndex((c) => c.kind === "quiz");
  lesson.cards[qi] = card;
  const problems = [...validateCurriculum(paths)];
  assert.ok(problems.some((p) => p.includes("repeats its why passage")),
    `the curriculum validator missed the photographed card: ${problems.join("; ")}`);
});

await test("a card with two options repeating one passage is rejected", () => {
  const card = repeatCard();
  card.correct = 0;
  card.options[0] = REPEAT_PASSAGE;
  card.options[1] = REPEAT_PASSAGE.replace("pathogen load", "pathogen burden");
  card.why = "The gut community supports the host defences it lives alongside.";
  assert.ok((cardInternalRepeat(card) || "").includes("two of its options repeat"),
    `the pairwise check missed near identical options: ${cardInternalRepeat(card)}`);
  const parsed = parseCortexImport(JSON.stringify(repeatImportDoc(card)));
  assert.equal(parsed.ok, false, "an import carrying near identical options was accepted");
});

await test("the same passage as a correct answer or a why in two cards of one lesson is rejected", () => {
  const first = { kind: "quiz", question: "One?", options: ["Alpha statement about rivers", "Beta statement about mountains", "Gamma statement about deserts", "Delta statement about oceans"], correct: 0, why: REPEAT_PASSAGE };
  const secondWhy = { kind: "quiz", question: "Two?", options: ["Epsilon statement about forests", "Zeta statement about glaciers", "Eta statement about valleys", "Theta statement about islands"], correct: 1, why: REPEAT_PASSAGE };
  assert.ok((lessonRepeatProblem([first, secondWhy]) || "").includes("repeats an earlier card's why"),
    `the across lesson check missed a reused why: ${lessonRepeatProblem([first, secondWhy])}`);
  const secondCorrect = { kind: "quiz", question: "Three?", options: ["Iota statement about harbors", REPEAT_PASSAGE, "Kappa statement about meadows", "Lambda statement about caverns"], correct: 1, why: "A short distinct reason for this one." };
  assert.ok((lessonRepeatProblem([first, secondCorrect]) || "").includes("correct answer repeats an earlier card's why"),
    `the across lesson check missed a reused passage as an answer: ${lessonRepeatProblem([first, secondCorrect])}`);
  assert.equal(lessonRepeatProblem([first]), null, "a single use of a passage was flagged");
  const paths = JSON.parse(JSON.stringify(LEARNING_PATHS));
  const lesson = paths[0].units[0].lessons[0];
  const quizzes = lesson.cards.map((c, i) => [c, i]).filter(([c]) => c.kind === "quiz");
  lesson.cards[quizzes[1][1]].why = lesson.cards[quizzes[0][1]].why;
  const problems = [...validateCurriculum(paths)];
  assert.ok(problems.some((p) => p.includes("repeats an earlier card")),
    `the curriculum validator missed a reused why: ${problems.join("; ")}`);
});

await test("generation drops a card whose restatement is its why near word for word, and counts repeated checks in a built course", () => {
  // The supplement fixture's only restatement is a rotation of
  // its own passage (measured 0.875, 2026-10-18), so its card is
  // dropped by the quizCard gate instead of shipped.
  assert.ok(cardTextSimilarity(restateClaim(CLAIM_SUPPLEMENT.text), CLAIM_SUPPLEMENT.text) >= QUIZ_SIMILARITY_MAX,
    "the supplement restatement no longer measures as a repeat; revisit this pin");
  assert.equal(quizCard(CLAIM_SUPPLEMENT, QUIZ_CLAIMS, QUIZ_SOURCES), null,
    "a card whose answer repeats its why shipped instead of dropping");
  // Two near identical claims in one answer: the second check in
  // the lesson is dropped and counted, and no built lesson
  // carries a repeat.
  const nearA = "Adults who slept under six hours showed a 23% higher rate of infection over the following winter, compared with adults who slept eight hours or more, and the effect held across every age group in the trial cohort that winter season.";
  const nearB = nearA.replace("showed a 23%", "recorded a 23%");
  const md = `## Summary\n\n${nearA} [1]\n${nearB} [1]\n${CLEAN_CLAIMS[1]} [2]\n${CLEAN_CLAIMS[3]} [2]\n`;
  const course = createCourseFromResults("sleep and infection", LEAK_SOURCES, md);
  assert.ok(course, "the near duplicate fixture should still build a course");
  assert.ok(course.droppedChecks >= 1, `a repeated check was not counted as dropped: ${course.droppedChecks}`);
  for (const lesson of course.lessons) {
    assert.equal(lessonRepeatProblem(lesson.cards), null, `a built lesson carries a repeat: ${lesson.title}`);
    for (const card of lesson.cards) {
      assert.equal(cardInternalRepeat(card), null, `a built card repeats itself in ${lesson.title}`);
    }
  }
  const basicsWhys = course.lessons[0].cards.map((c) => c.why).filter((w) => w === nearA || w === nearB);
  assert.ok(basicsWhys.length <= 1, "both near identical passages serve as whys in the first lesson");
});

await test("feedback never says or prints one passage twice (2026-10-18)", () => {
  // The photographed case: the why is the correct passage itself.
  const photo = { kind: "quiz", why: REPEAT_PASSAGE };
  const said = feedbackTeachLine(photo, { good: false, correctText: REPEAT_PASSAGE });
  assert.equal(said, REPEAT_PASSAGE, `her line should speak the passage once, as the why: ${said}`);
  assert.equal((said.match(/cathepsin/g) || []).length, 1, "her line says the passage more than once");
  // The why contains the answer verbatim, plus more: she speaks
  // the why once, with no correction re reading the answer first.
  const whyLong = REPEAT_PASSAGE + " The same signals also steady the gut wall during feeding.";
  const saidLong = feedbackTeachLine({ kind: "quiz", why: whyLong }, { good: false, correctText: REPEAT_PASSAGE });
  assert.equal(saidLong, whyLong, `her line re read the answer before the why: ${saidLong}`);
  assert.equal((saidLong.match(/cathepsin/g) || []).length, 1, "her line says the contained passage more than once");
  // Genuinely different correction and why: both are still said,
  // correction briefly first, then the reason.
  const distinct = feedbackTeachLine({ kind: "quiz", why: "Heat moves by conduction here." }, { good: false, correctText: "It stores heat" });
  assert.equal(distinct, "The answer was: It stores heat. Heat moves by conduction here.");
  // The sheet composition carries the same dedup at print time:
  // the recap section stands down when the why repeats it, and a
  // predict why stands down when the outcome repeats it.
  assert.ok(learnSrc.includes("passagesRepeat(displayOptions[displayCorrect], card.why)"),
    "the sheet recap is not deduped against the why");
  assert.ok(learnSrc.includes("passagesRepeat(card.outcome, card.why)"),
    "the sheet why is not deduped against a predict outcome");
  assert.ok(learnSrc.includes("No passage twice on one sheet"), "the sheet dedup lost its marker comment");
});

await test("the authored sets pass the repeat checks whole: 510 option cards, no repeats left", () => {
  // Counts measured 2026-10-18 for step 5 of the defect fix: the
  // checks flagged exactly two authored cards (a senses checkpoint
  // visual question reusing the retina answer, and a fasting
  // checkpoint spot the error reusing an earlier why), and both
  // were rewritten in place. This pin holds the cleaned state.
  // Curriculum upgrade (2026-10-19): the advanced units add 36
  // path option cards (294 in the paths, 216 in the topics, 510 in
  // all), and every one passes the same repeat checks.
  let pathCards = 0;
  let topicCards = 0;
  for (const [paths, tally] of [[LEARNING_PATHS, "paths"], [TOPIC_COURSES, "topics"]]) {
    for (const p of paths) {
      for (const lesson of flattenPathLessons(p)) {
        assert.equal(lessonRepeatProblem(lesson.cards), null,
          `${p.title} / ${lesson.title} reuses a passage: ${lessonRepeatProblem(lesson.cards)}`);
        for (const card of lesson.cards) {
          assert.equal(cardInternalRepeat(card), null,
            `${p.title} / ${lesson.title} has a repeating card: ${cardInternalRepeat(card)}`);
          if (card.kind === "quiz" || card.kind === "visualq" || card.kind === "predict") {
            if (tally === "paths") pathCards++; else topicCards++;
          }
        }
      }
    }
  }
  assert.equal(pathCards, 294, `learning path option cards measured ${pathCards}, expected 294`);
  assert.equal(topicCards, 216, `topic option cards measured ${topicCards}, expected 216`);
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

await test("each topic course follows the flagship topic standard", () => {
  // Rewritten for the Nova content wave (2026-10-14): every topic
  // course was rebuilt to the flagship lesson standard of The Human
  // Body. The old shape (three lessons of 5 to 8 cards, teaching
  // lessons opening with a note, a five card review) is retired.
  // Now: two teaching lessons of exactly ten cards in the flagship
  // order (predict hook, three teach notes with the mechanism note
  // carrying a diagram, a visual question answered from that same
  // diagram, one hands on card, a true then false pair, an apply
  // quiz, and a payoff note ending in a Tomorrow hook), then an
  // eight card all interactive checkpoint in the flagship order.
  const HANDS_ON = ["match", "order", "build", "spoterror"];
  for (const p of TOPIC_COURSES) {
    const lessons = flattenPathLessons(p);
    assert.equal(lessons.length, 3, `${p.title} has ${lessons.length} lessons`);
    lessons.forEach((lesson, li) => {
      const kinds = [...lesson.cards.map((c) => c.kind)];
      if (li < 2) {
        assert.equal(kinds.length, 10, `${p.title} / ${lesson.title} has ${kinds.length} cards, not 10`);
        assert.deepEqual(kinds.slice(0, 5), ["predict", "note", "note", "note", "visualq"],
          `${p.title} / ${lesson.title} does not open with the flagship hook and teach run`);
        assert.ok(HANDS_ON.includes(kinds[5]), `${p.title} / ${lesson.title} card six is not a hands on card`);
        assert.deepEqual(kinds.slice(6), ["truefalse", "truefalse", "quiz", "note"],
          `${p.title} / ${lesson.title} does not close with the flagship pair, apply quiz, and payoff`);
        assert.equal(lesson.cards[6].answer, true, `${p.title} / ${lesson.title} first true or false card is not the true one`);
        assert.equal(lesson.cards[7].answer, false, `${p.title} / ${lesson.title} second true or false card is not the false one`);
        const mechanism = lesson.cards[3];
        assert.ok(mechanism.diagram && Array.isArray(mechanism.diagram.steps) && mechanism.diagram.steps.length >= 3,
          `${p.title} / ${lesson.title} mechanism note carries no diagram`);
        assert.deepEqual(lesson.cards[4].diagram, mechanism.diagram,
          `${p.title} / ${lesson.title} visual question does not repeat the mechanism diagram word for word`);
        const payoff = lesson.cards[9];
        assert.equal(payoff.kicker, "The payoff", `${p.title} / ${lesson.title} last card is not the payoff`);
        assert.ok(payoff.text.includes("Tomorrow:"), `${p.title} / ${lesson.title} payoff ends without its Tomorrow hook`);
      } else {
        assert.ok(lesson.title.startsWith("Checkpoint: "), `${p.title} third lesson is not titled as a checkpoint`);
        assert.deepEqual(kinds, ["quiz", "match", "visualq", "truefalse", "truefalse", "order", "quiz", "spoterror"],
          `${p.title} checkpoint does not follow the eight card flagship checkpoint order`);
        assert.ok(lesson.cards.every(isInteractiveCard), `${p.title} checkpoint is not all checks`);
        assert.equal(lesson.cards[3].answer, true, `${p.title} checkpoint first true or false card is not the true one`);
        assert.equal(lesson.cards[4].answer, false, `${p.title} checkpoint second true or false card is not the false one`);
      }
    });
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
  // 24 until 2026-10-14, when the flagship Body rebuild retired its
  // six deepen cards for the payoff note shape, leaving 18.
  assert.equal(deepens.length, 18, `expected 18 deepen cards under the ban, found ${deepens.length}`);
});

await test("every learning path quiz answer is taught before it is asked, apart from the named fair applications", () => {
  // The topic course coverage standard, applied to the paths
  // (seventh panel, 2026-10-14): a quiz's correct answer must reuse
  // at least half its content words from earlier cards in the same
  // course, with word families counted through a six letter stem
  // and glue words carrying no topic. Wave eight audited every
  // path quiz the method flags. Five quizzed facts no earlier card
  // taught, and those are now taught in the lesson note before the
  // quiz: hemoglobin and iron behind red blood, the spinal cord
  // shortcut in a reflex, the word evaporated, colliding plates
  // crumpling into mountain ranges, and satellites measuring the
  // drift. The questions named below still score under half
  // on vocabulary alone and are judged fair applications, not
  // gaps: each asks the learner to use a taught idea on a fresh
  // example, so the answer's words are the example's words, or the
  // answer restates the teaching in other words the measure cannot
  // see. The set is asserted exactly, so a future quiz on an
  // untaught fact fails here until it is taught or added to this
  // list with its judgment stated.
  // Update (2026-10-14, engine wave two): the list drops to eight.
  // "Raindrops begin to fall when the droplets..." used to score
  // under half as a fair application of the note's droplets so
  // small they float. The water cycle lesson's new visual question
  // now teaches, in its feedback one lesson earlier, that droplets
  // grow heavy and fall, so the quiz is covered outright and no
  // longer belongs on this list.
  const FAIR_APPLICATIONS = [
    "Which of these questions can science test directly?", // apply the observability test to four fresh example questions
    "A claim is testable when...", // the opening note's checkable answer, stated from the side of being shown wrong
    "Which of these is a hypothesis?", // apply the taught definition to a fresh example statement
    "Which is the strongest evidence that a new medicine works?", // apply the rule that stories and opinions are not evidence
    "Two friends disagree about whether it rained more this year than last year. What settles it?", // records are named as evidence in the lesson note
    "A result that many teams have repeated is...", // the lesson's own thesis restated; the measure misses trusts versus trustworthy
    "If the Sun's gravity suddenly vanished, Earth would...", // one step from the taught orbit model: no pull, no curve
    "What powers a star's light?", // taught in the note just before, as fuse and fusion at the center; the answer says fusing and core
  ];
  const GLUE = new Set("the a an of to in on and or is are it its that this with for from by as at be can not but so than then when which what who how why into over after before about their they them one two all any each more most some such own our your you yourself only also just even still every both against between while during without within across around among along upon onto makes make made gets get got goes going come comes came take takes took give gives gave keep keeps kept used using uses way ways thing things kind kinds part parts back away together alone almost nearly really quite rather instead indeed perhaps probably sometimes usually often always never ever yet already means much same fully several".split(" "));
  const cwords = (s) => [...new Set(String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !GLUE.has(w)))];
  const covered = (w, seen) => seen.includes(w) || (w.length >= 6 && seen.includes(w.slice(0, 6)));
  const cov = (text, seen) => { const need = cwords(text); if (!need.length) return 1; return need.filter((w) => covered(w, seen)).length / need.length; };
  const flagged = [];
  let quizzes = 0;
  for (const p of LEARNING_PATHS) {
    let seen = "";
    for (const lesson of flattenPathLessons(p)) {
      for (const card of lesson.cards) {
        if (card.kind === "quiz") {
          quizzes++;
          if (cov(card.options[card.correct], seen) < 0.5) flagged.push(String(card.question));
        }
        seen = (seen + " " + lpCardText(card).toLowerCase()).trim();
      }
    }
  }
  // Nova content wave (2026-10-14): the fifth path, Matter and
  // Energy, adds its 44 quizzes to the 77, for 121 in all.
  // Curriculum upgrade (2026-10-19): the advanced units add 20
  // quizzes (twelve in the legacy paths, four in each flagship
  // capstone), for 141 in all. None needed the fair application
  // judgment: every new quiz meets coverage outright.
  assert.equal(quizzes, 141, `expected 141 path quizzes under the coverage pin, found ${quizzes}`);
  assert.deepEqual([...flagged].sort(), [...FAIR_APPLICATIONS].sort(),
    `path quizzes under half coverage differ from the judged fair applications.\nflagged: ${flagged.join(" | ")}\nnamed fair: ${FAIR_APPLICATIONS.join(" | ")}`);
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

await test("learning path quizzes meet the same length band the topics are held to", () => {
  // The topic standard, applied to the authored path quizzes
  // (2026-10-14 panel): 14 spread wider than max to min 3, and in
  // 16 the correct option had no distractor within 0.6 to 1.67 of
  // its length, so length alone named the answer there too.
  // The count was 45 until the flagship Body rebuild (2026-10-14)
  // replaced its 12 quizzes with 44, for 77 in all. The Nova content
  // wave (2026-10-14) adds the fifth path Matter and Energy with 44
  // more of its own, for 121 in all. The curriculum upgrade
  // (2026-10-19) adds the advanced units' 20, for 141 in all.
  const pathCards = [];
  for (const p of LEARNING_PATHS) {
    for (const lesson of flattenPathLessons(p)) {
      for (const card of lesson.cards) if (card.kind === "quiz") pathCards.push({ path: p, card });
    }
  }
  assert.equal(pathCards.length, 141, `expected 141 path quizzes, found ${pathCards.length}`);
  for (const { path, card } of pathCards) {
    assert.equal(card.options.length, 4, `${path.title}: "${String(card.question).slice(0, 40)}" has ${card.options.length} options`);
    const keys = card.options.map(normKey);
    assert.equal(new Set(keys).size, keys.length, `${path.title}: duplicate option text in "${String(card.question).slice(0, 40)}"`);
    const lens = card.options.map((o) => o.length);
    const ref = lens[card.correct];
    assert.ok(Math.max(...lens) <= Math.min(...lens) * 3,
      `${path.title}: option lengths spread too wide in "${String(card.question).slice(0, 40)}": ${lens.join(", ")}`);
    assert.ok(card.options.some((o, i) => i !== card.correct && o.length >= ref * 0.6 && o.length <= ref * 1.67),
      `${path.title}: the correct option stands alone by length in "${String(card.question).slice(0, 40)}"`);
  }
});

await test("the correct option's length rank stays near chance in both authored sets", () => {
  // The band pins above constrain length ratios, not rank, and the
  // sixth panel measured what that missed: picking the longest
  // option won 201 of 237 authored quizzes (84.8 percent), because
  // the correct option was longest or tied longest in 206 of 237
  // (86.9 percent) and uniquely longest in 199. Wave seven lengthened
  // distractors until the rank fell to chance: unique longest 53 of
  // 237 (22.4 percent), longest or tied 58 of 237 (24.5 percent),
  // picking the longest wins 55 of 237 (23.2 percent). These ceilings
  // hold the fix per set and combined: unique longest at most 35
  // percent, longest or tied at most 45 percent.
  const rankStats = (sets) => {
    let n = 0, uniq = 0, tied = 0;
    for (const p of sets) {
      for (const lesson of flattenPathLessons(p)) {
        for (const card of lesson.cards) {
          if (card.kind !== "quiz") continue;
          n++;
          const lens = card.options.map((o) => o.length);
          const max = Math.max(...lens);
          if (lens[card.correct] === max) {
            tied++;
            if (lens.filter((l) => l === max).length === 1) uniq++;
          }
        }
      }
    }
    return { n, uniq, tied };
  };
  // Nova content wave (2026-10-14): the flagship shape moves checks
  // into predict, visualq, and spoterror cards. Each topic now
  // carries 4 quizzes among 20 interactive checks in 28 cards (was
  // 8 quizzes among 17 cards), so topic quizzes fall 192 to 96,
  // while the fifth path lifts path quizzes 77 to 121; both sets
  // together run 217.
  // Curriculum upgrade (2026-10-19): the advanced units lift path
  // quizzes 121 to 141, so both sets together run 237.
  const groups = [
    ["learning paths", LEARNING_PATHS, 141],
    ["topic courses", TOPIC_COURSES, 96],
    ["both sets", [...LEARNING_PATHS, ...TOPIC_COURSES], 237],
  ];
  for (const [label, sets, expected] of groups) {
    const { n, uniq, tied } = rankStats(sets);
    assert.equal(n, expected, `${label}: expected ${expected} authored quizzes, found ${n}`);
    assert.ok(uniq / n <= 0.35, `${label}: correct option uniquely longest in ${uniq} of ${n}, over the 35 percent ceiling`);
    assert.ok(tied / n <= 0.45, `${label}: correct option longest or tied in ${tied} of ${n}, over the 45 percent ceiling`);
  }
});

await test("the correct option's length rank stays near chance for shortest in both authored sets", () => {
  // The mirror tell, measured 2026-10-16: Panel 8 and Panel 9
  // found the correct option uniquely shortest in 111 of 216
  // topic cards across quiz, visualq, and predict kinds (51.4
  // percent against 25 percent chance), while learning paths sat
  // near chance on the same measure. Picking the shortest option
  // named the answer in the topic courses, so length alone leaked
  // it from the other direction than the longest pin above
  // guards. The wave of 2026-10-16 rebalanced the topic options,
  // and this pin holds the fix. The population is wider than the
  // longest pin: every authored card of kinds quiz, visualq, and
  // predict (truefalse is excluded), grouped per set and
  // combined, with the same ceilings: unique shortest at most 35
  // percent, shortest or tied at most 45 percent.
  const SHORTABLE_KINDS = new Set(["quiz", "visualq", "predict"]);
  const shortestStats = (sets) => {
    let n = 0, uniq = 0, tied = 0;
    for (const p of sets) {
      for (const lesson of flattenPathLessons(p)) {
        for (const card of lesson.cards) {
          if (!SHORTABLE_KINDS.has(card.kind)) continue;
          n++;
          const lens = card.options.map((o) => o.length);
          const min = Math.min(...lens);
          if (lens[card.correct] === min) {
            tied++;
            if (lens.filter((l) => l === min).length === 1) uniq++;
          }
        }
      }
    }
    return { n, uniq, tied };
  };
  // Curriculum upgrade (2026-10-19): the advanced units lift the
  // path population 258 to 294 and the combined 474 to 510.
  const groups = [
    ["learning paths", LEARNING_PATHS, 294],
    ["topic courses", TOPIC_COURSES, 216],
    ["both sets", [...LEARNING_PATHS, ...TOPIC_COURSES], 510],
  ];
  for (const [label, sets, expected] of groups) {
    const { n, uniq, tied } = shortestStats(sets);
    assert.equal(n, expected, `${label}: expected ${expected} authored quiz, visualq, and predict cards, found ${n}`);
    assert.ok(uniq / n <= 0.35, `${label}: correct option uniquely shortest in ${uniq} of ${n}, over the 35 percent ceiling`);
    assert.ok(tied / n <= 0.45, `${label}: correct option shortest or tied in ${tied} of ${n}, over the 45 percent ceiling`);
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

// ─═════════════════════════════════════════════════════════════════
group("Authored positions: the Player shuffle, not authored order");

/* The fifth panel's severe Cortex finding (2026-10-14): authored
   correct answers sit at index 1 in 37 of 45 path quizzes and 183
   of 192 topic quizzes, and never at index 3, and authored options
   rendered in authored order. The Player now shuffles per attempt
   through shuffledOptionsForCard; these pins run that same helper
   with the Player's own seed shape (the card's question hash, the
   mount salt, and the attempt counter) over several salts and
   attempts, and require the displayed positions to spread. */
const playerSeedFor = (card, salt, attempt) =>
  hashStr(card.question || card.statement || card.prompt || "") + 59 + salt + attempt * 131;
const PLAYER_SALTS = [7, 12345, 99991];
const PLAYER_ATTEMPTS = [0, 1, 2, 3, 4, 5, 6, 7];

await test("shuffledOptionsForCard remaps the correct marker and keeps the option set", () => {
  const sample = [
    ...allCards.filter((c) => c.kind === "quiz"),
    ...topicCardsFlat.map((x) => x.card).filter((c) => c.kind === "quiz" || c.kind === "truefalse"),
  ];
  assert.ok(sample.length > 200, `position sample too small: ${sample.length}`);
  for (const card of sample) {
    for (const salt of PLAYER_SALTS) {
      for (const attempt of [0, 3]) {
        const out = shuffledOptionsForCard(card, playerSeedFor(card, salt, attempt));
        assert.ok(out, "a readable option card produced no shuffle");
        assert.deepEqual([...out.options].sort(), [...card.options].sort(),
          "the shuffle changed the option set itself");
        assert.equal(out.options[out.correct], card.options[card.correct],
          "the remapped correct marker no longer points at the correct option");
      }
    }
  }
  assert.equal(shuffledOptionsForCard({ kind: "quiz", options: ["only"], correct: 0 }, 5), null,
    "a one option card should produce no shuffle");
  assert.equal(shuffledOptionsForCard({ kind: "note", text: "x" }, 5), null,
    "a card with no options should produce no shuffle");
});

await test("authored quiz positions spread under the Player shuffle, in both sets", () => {
  // Stated share: no displayed index may hold more than 40 percent
  // of positions (uniform would be 25), and every index must be
  // used. Authored order itself sits at 82 to 95 percent on index
  // 1 and never uses index 3, so this pin fails on the old render.
  for (const [label, sets] of [["learning paths", LEARNING_PATHS], ["topic courses", TOPIC_COURSES]]) {
    const quizzes = [];
    for (const p of sets) {
      for (const lesson of flattenPathLessons(p)) {
        for (const card of lesson.cards) if (card.kind === "quiz") quizzes.push(card);
      }
    }
    const dist = [0, 0, 0, 0];
    let total = 0;
    for (const card of quizzes) {
      for (const salt of PLAYER_SALTS) {
        for (const attempt of PLAYER_ATTEMPTS) {
          dist[shuffledOptionsForCard(card, playerSeedFor(card, salt, attempt)).correct]++;
          total++;
        }
      }
    }
    for (let i = 0; i < 4; i++) {
      assert.ok(dist[i] > 0, `${label}: displayed index ${i} is never used`);
      assert.ok(dist[i] / total <= 0.4,
        `${label}: displayed index ${i} holds ${(dist[i] / total * 100).toFixed(1)} percent of ${total} positions`);
    }
  }
});

await test("authored true or false positions spread under the Player shuffle, in both sets", () => {
  for (const [label, sets] of [["learning paths", LEARNING_PATHS], ["topic courses", TOPIC_COURSES]]) {
    const cards = [];
    for (const p of sets) {
      for (const lesson of flattenPathLessons(p)) {
        for (const card of lesson.cards) if (card.kind === "truefalse") cards.push(card);
      }
    }
    const dist = [0, 0];
    let total = 0;
    for (const card of cards) {
      for (const salt of PLAYER_SALTS) {
        for (const attempt of PLAYER_ATTEMPTS) {
          const out = shuffledOptionsForCard(card, playerSeedFor(card, salt, attempt));
          assert.equal(out.options[out.correct], card.answer ? "True" : "False",
            "the true or false remap lost the answer");
          dist[out.correct]++;
          total++;
        }
      }
    }
    for (let i = 0; i < 2; i++) {
      assert.ok(dist[i] > 0, `${label}: true or false index ${i} is never used`);
      assert.ok(dist[i] / total <= 0.65,
        `${label}: true or false index ${i} holds ${(dist[i] / total * 100).toFixed(1)} percent of ${total} positions`);
    }
  }
});

await test("the Player renders option cards through the shuffle, not authored order", () => {
  assert.ok(learnSrc.includes("shuffledOptionsForCard(card,"), "the Player does not compute its display order through shuffledOptionsForCard");
  assert.ok(learnSrc.includes("picked === displayCorrect"), "the Player's verdict does not read the remapped correct marker");
  assert.ok(learnSrc.includes("(displayOptions || []).map((opt, i)"), "quiz and cloze options do not render in display order");
  assert.ok(learnSrc.includes('(displayOptions || ["True", "False"]).map((label, i)'), "true or false options do not render in display order");
  assert.ok(learnSrc.includes("displayOptions[picked]"), "the feedback sheet does not name the option the learner actually picked");
});

// ─═════════════════════════════════════════════════════════════════
group("True or false balance and build error language");

await test("topic true or false cards run within 40 to 60 percent true", () => {
  // Before the rebalance (2026-10-14 panel): 13 true to 35 false,
  // so guessing False scored about 73 percent. The Nova content
  // wave (2026-10-14) rebuilt every topic to the flagship shape
  // with a true then false pair in each of its 3 lessons, so the
  // set now runs 144 cards, 72 true, by construction.
  const cards = topicCardsFlat.map((x) => x.card).filter((c) => c.kind === "truefalse");
  assert.equal(cards.length, 144, `expected 144 topic true or false cards, found ${cards.length}`);
  const trues = cards.filter((c) => c.answer === true).length;
  const share = trues / cards.length;
  assert.ok(share >= 0.4 && share <= 0.6,
    `topic true or false runs ${trues} true of ${cards.length} (${(share * 100).toFixed(0)} percent), outside 40 to 60`);
});

await test("learning path true or false cards run within 40 to 60 percent true", () => {
  // The path set had no share pin at all before wave seven; it ran
  // 10 true of 24 (41.7 percent), inside the band, so this pins the
  // balance rather than rebalancing it. The flagship Body rebuild
  // (2026-10-14) writes its true or false cards in true and false
  // pairs by construction, so the set now runs 45 true of 92
  // (48.9 percent) and the count pin moves to 92. The Nova content
  // wave (2026-10-14) adds the fifth path Matter and Energy, whose
  // true or false cards are also written in true and false pairs:
  // 74 more cards, 37 of them true, so the set runs 82 true of 166
  // (49.4 percent) and the count pin moves to 166.
  // Curriculum upgrade (2026-10-19): the advanced units add 18
  // more (six misconception statements in the legacy units, all
  // false by construction, and three true and false pairs in each
  // flagship capstone), so the set runs 88 true of 184 (47.8
  // percent) and the count pin moves to 184.
  const cards = [];
  for (const p of LEARNING_PATHS) {
    for (const lesson of flattenPathLessons(p)) {
      for (const card of lesson.cards) if (card.kind === "truefalse") cards.push(card);
    }
  }
  assert.equal(cards.length, 184, `expected 184 path true or false cards, found ${cards.length}`);
  const trues = cards.filter((c) => c.answer === true).length;
  const share = trues / cards.length;
  assert.ok(share >= 0.4 && share <= 0.6,
    `path true or false runs ${trues} true of ${cards.length} (${(share * 100).toFixed(0)} percent), outside 40 to 60`);
});

await test("topic courses carry mixed true or false answers, not a single answer per course", () => {
  // Before wave seven, 18 of the 24 topic courses were single
  // answer courses (both cards true, or both false), so a learner
  // who answered the first card could guess the second from the
  // course's habit. Wave seven flipped one card in each of those
  // 18 courses, rewriting the statement and keeping the teaching
  // point, so every course now mixes. The ceiling allows at most
  // 2 of 24 single answer courses if a future course's content
  // genuinely cannot carry a mixed pair; the current count is 0.
  // Nova content wave (2026-10-14): topics rebuilt to the flagship
  // shape carry six true or false cards each, three true then false
  // pairs by construction, so every course mixes by design and the
  // per course count pin moves 2 to 6.
  let single = 0;
  const names = [];
  for (const course of TOPIC_COURSES) {
    const answers = [];
    for (const lesson of flattenPathLessons(course)) {
      for (const card of lesson.cards) if (card.kind === "truefalse") answers.push(card.answer);
    }
    assert.equal(answers.length, 6, `${course.title}: expected 6 true or false cards, found ${answers.length}`);
    if (answers.every((a) => a === answers[0])) { single++; names.push(course.title); }
  }
  assert.ok(single <= 2, `${single} of 24 topic courses are single answer (${names.join(", ")}), over the ceiling of 2`);
});

await test("build error strings speak plain product language, with no paper machinery", () => {
  // The learner facing build errors still named the removed paper
  // machinery (2026-10-14 panel): "cited findings" for a short
  // build and "literature databases" for a busy service. The scan
  // covers every setBuildError string literal in the component,
  // so the class is pinned, not just the two sentences.
  const literals = [...learnSrc.matchAll(/setBuildError\("([^"]*)"/g)].map((m) => m[1]);
  assert.ok(literals.length >= 4, `expected at least 4 build error strings, found ${literals.length}`);
  for (const lit of literals) {
    assert.ok(!/\bpaper(s)?\b|\bfinding(s)?\b|\bliterature\b|\bcitation(s)?\b|\bcited\b|\bdatabase(s)?\b/i.test(lit),
      `a build error still names the paper machinery: ${lit}`);
    assert.ok(!lit.includes("-") && !lit.includes("—") && !lit.includes("–"), `a dash in a build error: ${lit}`);
  }
  assert.ok(learnSrc.includes('setBuildError("Not enough solid material on this topic yet to build a course. Try a broader topic.")'),
    "the short build error is not the plain product sentence");
  assert.ok(learnSrc.includes('setBuildError("The service is busy right now. Wait a minute and try again.")'),
    "the busy service error is not the plain product sentence");
  assert.ok(!learnSrc.includes("did not return enough cited findings"), "the old cited findings error survived");
  assert.ok(!learnSrc.includes("literature databases are rate limiting"), "the old literature databases error survived");
});

// ─═════════════════════════════════════════════════════════════════
group("Redesign wave two: tagline, new card kinds, ranks, the map, onboarding");

await test("the tagline is the Nova line, and the old ones are nowhere", () => {
  // Rename pin (2026-10-14): the owner ordered the learning product
  // renamed from Cortex to Wick in the morning and rejected Wick the
  // same day, picking Nova with Asta's tagline "Science, one spark
  // at a time." The Wick line "One idea a day." and both earlier
  // taglines must stay absent from the source.
  assert.equal(CORTEX_TAGLINE, "Science, one spark at a time.");
  assert.ok(learnSrc.includes("Science, one spark at a time."), "the Nova tagline is not in the source");
  assert.ok(learnSrc.includes("{CORTEX_TAGLINE}"), "the home does not render the tagline constant");
  assert.ok(!learnSrc.includes("One idea a day."), "the Wick tagline survived the Nova rename");
  assert.ok(!learnSrc.includes("Where papers become memory"), "the oldest tagline survived somewhere");
  assert.ok(!learnSrc.includes("Science you will actually remember"), "the pre rename tagline survived somewhere");
});

await test("the four new card kinds are authored in the paths and count as interactive", () => {
  for (const kind of ["visualq", "spoterror", "predict", "build"]) {
    assert.ok(INTERACTIVE_KINDS.includes(kind), `${kind} is not in INTERACTIVE_KINDS`);
    assert.ok(allCards.some((c) => c.kind === kind), `no ${kind} card is authored in the learning paths`);
    assert.ok(isInteractiveCard({ kind }), `${kind} does not read as interactive`);
  }
});

await test("the whole curriculum still passes its own validator with the new kinds in it", () => {
  // The validator's shape contract (two or more units per path) is
  // the learning paths' contract; topic courses are one unit of
  // three lessons by design and are held to their own shape pins
  // in the catalog group above, so only the paths run here, as
  // before this wave.
  assert.deepEqual([...validateCurriculum()], [], "the paths validator complains");
});

await test("the validator rejects broken second version cards", () => {
  const clone = () => JSON.parse(JSON.stringify(LEARNING_PATHS));
  const withCard = (card) => {
    const paths = clone();
    paths[0].units[0].lessons[0].cards[1] = card;
    return [...validateCurriculum(paths)];
  };
  const base = { question: "Q?", options: ["aa", "bb"], correct: 0, why: "w" };
  assert.ok(withCard({ ...base, kind: "visualq" }).some((s) => s.includes("visualq needs the visual or diagram")),
    "a visual question with nothing to look at was accepted");
  assert.ok(withCard({ ...base, kind: "predict" }).some((s) => s.includes("predict has no outcome")),
    "a predict card with no outcome to reveal was accepted");
  assert.ok(withCard({ kind: "spoterror", prompt: "p", parts: ["a", "b", "c"], wrong: 9, fix: "f", why: "w" }).some((s) => s.includes("spoterror wrong index")),
    "a spot the error card pointing outside its pieces was accepted");
  assert.ok(withCard({ kind: "spoterror", prompt: "p", parts: ["a", "b", "c"], wrong: 1, why: "w" }).some((s) => s.includes("spoterror has no corrected piece")),
    "a spot the error card with no correction was accepted");
  assert.ok(withCard({ kind: "build", prompt: "p", items: ["a", "a", "b"], why: "w" }).some((s) => s.includes("build items repeat")),
    "a build card with repeated parts was accepted");
});

await test("new kind checks are taught before they are asked", () => {
  // The same vocabulary coverage standard the quizzes live under,
  // extended to the new kinds: an option card's correct answer, a
  // build card's parts, a spot the error card's true pieces and
  // its correction must all speak the language of earlier cards
  // in the same path.
  const GLUE = new Set("the a an of to in on and or is are it its that this with for from by as at be can not but so than then when which what who how why into over after before about their they them one two all any each more most some such own our your you yourself only also just even still every both against between while during without within across around among along upon onto makes make made gets get got goes going come comes came take takes took give gives gave keep keeps kept used using uses way ways thing things kind kinds part parts back away together alone almost nearly really quite rather instead indeed perhaps probably sometimes usually often always never ever yet already means much same fully several".split(" "));
  const cwords = (s) => [...new Set(String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !GLUE.has(w)))];
  const covered = (w, seen) => seen.includes(w) || (w.length >= 6 && seen.includes(w.slice(0, 6)));
  const cov = (text, seen) => { const need = cwords(text); if (!need.length) return 1; return need.filter((w) => covered(w, seen)).length / need.length; };
  const cardTextAll = (c) => [c.title, c.kicker, c.text, c.question, c.statement, c.prompt, c.why, c.outcome, c.fix,
    ...(c.options || []), ...(c.items || []), ...(c.parts || []),
    ...(c.pairs || []).flatMap((p) => [p.left, p.right]),
    ...(c.diagram ? [...(c.diagram.steps || []), c.diagram.caption || ""] : [])].filter(Boolean).join(" ");
  for (const p of LEARNING_PATHS) {
    let seen = "";
    for (const lesson of flattenPathLessons(p)) {
      for (const card of lesson.cards) {
        if (card.kind === "visualq" || card.kind === "predict") {
          assert.ok(cov(card.options[card.correct], seen) >= 0.5,
            `${p.title}: ${card.kind} answer is not taught before it is asked: ${card.question.slice(0, 40)}`);
        }
        if (card.kind === "build") {
          for (const item of card.items) {
            assert.ok(cov(item, seen) >= 0.5,
              `${p.title}: build part is not taught before the build: ${item.slice(0, 40)}`);
          }
        }
        if (card.kind === "spoterror") {
          card.parts.forEach((part, i) => {
            if (i === card.wrong) {
              assert.ok(cwords(part).some((w) => covered(w, seen)),
                `${p.title}: the wrong piece is not even about the taught topic: ${part.slice(0, 40)}`);
            } else {
              assert.ok(cov(part, seen) >= 0.5,
                `${p.title}: a true piece of the claim was never taught: ${part.slice(0, 40)}`);
            }
          });
          assert.ok(cov(card.fix, seen + " " + card.parts.join(" ")) >= 0.5,
            `${p.title}: the correction does not speak the taught language: ${card.fix.slice(0, 40)}`);
        }
        seen = (seen + " " + cardTextAll(card).toLowerCase()).trim();
      }
    }
  }
});

await test("authored new kind options obey the fairness band", () => {
  for (const c of allCards) {
    if (c.kind !== "visualq" && c.kind !== "predict") continue;
    assert.equal(c.options.length, 4, `${c.kind} should offer four options`);
    const keys = c.options.map(normKey);
    assert.equal(new Set(keys).size, keys.length, `${c.kind} has a repeated option`);
    const lens = c.options.map((o) => o.length);
    const ref = lens[c.correct];
    assert.ok(Math.max(...lens) <= Math.min(...lens) * 3, `${c.kind} options spread too wide: ${lens.join(", ")}`);
    assert.ok(c.options.some((o, i) => i !== c.correct && o.length >= ref * 0.6 && o.length <= ref * 1.67),
      `${c.kind}: the correct option stands alone by length`);
    assert.ok(c.why && c.why.length > 10, `${c.kind} has no real explanation`);
    for (const opt of c.options) assert.ok(!/^\d/.test(opt), `${c.kind}: an option opens with a digit`);
  }
});

await test("no dashes, paper talk, or years in any new kind card text", () => {
  const fields = (c) => [c.question, c.prompt, c.why, c.outcome, c.fix, ...(c.options || []), ...(c.items || []), ...(c.parts || [])].filter(Boolean);
  for (const c of allCards) {
    if (!["visualq", "spoterror", "predict", "build"].includes(c.kind)) continue;
    for (const s of fields(c)) {
      assert.ok(!s.includes("-") && !s.includes("—") && !s.includes("–"), `a dash in a ${c.kind} card: ${s.slice(0, 50)}`);
      assert.ok(!/\bpaper(s)?\b|\bfinding(s)?\b|\bliterature\b|\bet al\b/i.test(s), `paper talk in a ${c.kind} card: ${s.slice(0, 50)}`);
      assert.ok(!/\b(19|20)\d{2}\b/.test(s), `a year in a ${c.kind} card: ${s.slice(0, 50)}`);
    }
  }
});

await test("every path opens with a declared visual slot on its first teach card", () => {
  for (const p of LEARNING_PATHS) {
    const first = flattenPathLessons(p)[0].cards[0];
    // Flagship exception (2026-10-14): The Human Body opens with
    // its hook, a prediction the learner commits to before any
    // teaching, per the flagship standard. Its first teach card is
    // card two, and that is the card that must carry the visual.
    // Nova content wave (2026-10-14): Matter and Energy is built to
    // the same flagship standard and takes the same exception.
    if (p.id === "the-human-body" || p.id === "matter-and-energy") {
      assert.equal(first.kind, "predict", "the flagship does not open with its hook");
      const teach = flattenPathLessons(p)[0].cards[1];
      assert.equal(teach.kind, "note", "the flagship's second card is not its first teach card");
      assert.ok(typeof teach.visual === "string" && teach.visual.startsWith("/cortex/"),
        "the flagship's first teach card declares no visual slot under the cortex asset root");
      continue;
    }
    assert.equal(first.kind, "note", `${p.title} does not open with a teach card`);
    assert.ok(typeof first.visual === "string" && first.visual.startsWith("/cortex/"),
      `${p.title} opener declares no visual slot under the cortex asset root`);
  }
  const water = flattenPathLessons(LEARNING_PATHS.find((p) => p.id === "earth-and-weather"))
    .find((l) => l.id === "earth-water-cycle");
  assert.ok(water.cards[0].diagram && water.cards[0].diagram.steps.length >= 4,
    "the water cycle teach card carries no diagram");
  const visualq = water.cards.find((c) => c.kind === "visualq");
  assert.ok(visualq && visualq.diagram, "the water cycle visual question is not answered from the taught diagram");
});

await test("the rank ladder is the named five rungs, in order, on rising thresholds", () => {
  assert.deepEqual([...RANK_LADDER.map((r) => r.name)],
    ["Observer", "Explorer", "Investigator", "Field Researcher", "Principal Investigator"]);
  for (let i = 1; i < RANK_LADDER.length; i++) {
    assert.ok(RANK_LADDER[i].minXp > RANK_LADDER[i - 1].minXp, "rank thresholds do not rise");
  }
  for (const r of RANK_LADDER) assert.ok(r.kit && r.kit.length > 10, `${r.name} has no kit line`);
});

await test("rankForXp reads the rung, the distance, and the top", () => {
  assert.equal(rankForXp(0).name, "Observer");
  assert.equal(rankForXp(0).xpToNext, RANK_LADDER[1].minXp);
  assert.equal(rankForXp(RANK_LADDER[1].minXp - 1).name, "Observer");
  assert.equal(rankForXp(RANK_LADDER[1].minXp).name, "Explorer");
  assert.equal(rankForXp(RANK_LADDER[2].minXp).name, "Investigator");
  assert.equal(rankForXp(RANK_LADDER[3].minXp).name, "Field Researcher");
  const top = rankForXp(RANK_LADDER[4].minXp + 500);
  assert.equal(top.name, "Principal Investigator");
  assert.equal(top.atTop, true);
  assert.equal(top.xpToNext, 0);
  const mid = rankForXp(RANK_LADDER[1].minXp + (RANK_LADDER[2].minXp - RANK_LADDER[1].minXp) / 2);
  assert.equal(mid.pctToNext, 50);
});

await test("topic mastery levels run from untouched to fully mastered", () => {
  const topic = TOPIC_COURSES[0];
  const flat = flattenPathLessons(topic);
  assert.equal(topicMasteryLevel(topic, { lessons: {} }), 0, "an untouched topic reads above zero");
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  prog = applyLessonResult(prog, topic, flat[0].id, 100);
  const partial = topicMasteryLevel(topic, prog);
  assert.ok(partial >= 1 && partial < 5, `one mastered lesson of three reads ${partial}, outside 1 to 4`);
  for (const l of flat) prog = applyLessonResult(prog, topic, l.id, 100);
  assert.equal(topicMasteryLevel(topic, prog), 5, "a fully mastered topic does not read 5");
});

await test("fading reads the last study day, with a longer grace for mastered lessons", () => {
  const NOW = Date.parse("2026-10-20T00:00:00.000Z");
  const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
  assert.equal(isLessonFading({ done: true, best: 20, lastAt: daysAgo(1) }, NOW), false, "yesterday is not fading");
  assert.equal(isLessonFading({ done: true, best: 20, lastAt: daysAgo(FADING_AFTER_DAYS) }, NOW), true, "an unmastered lesson fades at its threshold");
  assert.equal(isLessonFading({ done: true, best: 100, mastered: true, lastAt: daysAgo(FADING_AFTER_DAYS + 1) }, NOW), false, "a mastered lesson keeps its longer grace");
  assert.equal(isLessonFading({ done: true, best: 100, mastered: true, lastAt: daysAgo(MASTERED_FADING_AFTER_DAYS) }, NOW), true, "a mastered lesson fades at its own threshold");
  assert.equal(isLessonFading({ done: false, lastAt: daysAgo(30) }, NOW), false, "an unfinished lesson cannot fade");
  assert.equal(isLessonFading({ done: true, best: 20, completedAt: daysAgo(30) }, NOW), true, "a legacy record fades off its completion date");
  assert.equal(isLessonFading(null, NOW), false);
  assert.equal(lessonLastActivityMs({ lastAt: daysAgo(2), completedAt: daysAgo(9) }), NOW - 2 * 86400000,
    "the last study day should win over the first completion date");
});

await test("lesson results stamp the last study day and keep the first completion date", () => {
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  prog = applyLessonResult(prog, path0, flat0[0].id, 80);
  const rec = prog.lessons[flat0[0].id];
  assert.ok(typeof rec.lastAt === "string" && Number.isFinite(Date.parse(rec.lastAt)), "no readable last study day was stamped");
  const again = applyLessonResult(prog, path0, flat0[0].id, 90);
  assert.equal(again.lessons[flat0[0].id].completedAt, rec.completedAt, "a replay rewrote the first completion date");
});

await test("the review session serves due cards first, then fading lessons only", () => {
  const NOW = Date.parse("2026-10-20T00:00:00.000Z");
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  prog = applyLessonResult(prog, path0, flat0[0].id, 20);
  prog.lessons[flat0[0].id].lastAt = new Date(NOW - 5 * 86400000).toISOString();
  const fading = fadingLessons(LEARNING_PATHS, prog, NOW);
  assert.equal(fading.length, 1, "exactly the aged lesson should read as fading");
  assert.equal(fading[0].lesson.id, flat0[0].id);
  const dueCards = [
    { kind: "quiz", question: "dq1", options: ["a", "b"], correct: 0, why: "w", claimId: "dc1" },
    { kind: "quiz", question: "dq2", options: ["a", "b"], correct: 1, why: "w", claimId: "dc2" },
  ];
  const out = buildReviewSessionCards({ progress: prog, dueCards, seed: 4, limit: 10, paths: LEARNING_PATHS, now: NOW });
  assert.deepEqual([...out.slice(0, 2).map((c) => c.claimId)], ["dc1", "dc2"], "due cards do not lead the session");
  const fadingCards = new Set(flat0[0].cards.filter(isInteractiveCard));
  for (const c of out.slice(2)) assert.ok(fadingCards.has(c), "the session pulled a card from a lesson that is not fading");
  assert.equal(buildReviewSessionCards({ progress: { lessons: {} }, dueCards: [], seed: 4, paths: LEARNING_PATHS, now: NOW }).length, 0,
    "nothing due and nothing fading should build an empty session");
});

await test("the opener rhythm rotates by position and only opens visual where a visual exists", () => {
  assert.deepEqual([...OPENER_STYLES], ["visual", "predict", "story"]);
  const water = flattenPathLessons(LEARNING_PATHS.find((p) => p.id === "earth-and-weather"))[0];
  /* 2026-10-18 (design audit H23): every authored lesson carries art now,
     so the no visual case is the same real lesson with its card
     visuals stripped. */
  const plain = { ...flat0[1], cards: flat0[1].cards.map((c) => ({ ...c, visual: undefined, diagram: undefined })) };
  assert.equal(lessonOpenerStyle(water, 0), "visual", "a lesson with a diagram should open visual at a visual slot");
  assert.equal(lessonOpenerStyle(plain, 0), "story", "a lesson with no visual falls back to the story opener");
  assert.equal(lessonOpenerStyle(plain, 1), "predict");
  assert.equal(lessonOpenerStyle(plain, 2), "story");
  assert.equal(lessonOpenerStyle(water, 3), "visual", "the rotation should come back around");
  assert.equal(lessonOpenerStyle(plain, 4), "predict", "the rotation is by position, not by lesson");
});

await test("an import with a readable last study day parses, and a numeric one is refused", () => {
  const doc = deepDoc();
  doc.builtinProgress.lessons.l1.lastAt = "2026-10-13T00:00:00.000Z";
  assert.equal(parseCortexImport(JSON.stringify(doc)).ok, true, "a record carrying lastAt was refused");
  const bad = deepDoc();
  bad.builtinProgress.lessons.l1.lastAt = 42;
  const parsed = parseCortexImport(JSON.stringify(bad));
  assert.equal(parsed.ok, false, "a numeric last study day was accepted");
  assert.ok(parsed.error.includes("path progress"), `reason does not name the section: ${parsed.error}`);
});

await test("the Player renders every second version kind and the character slot", () => {
  for (const needle of ['card.kind === "visualq"', 'card.kind === "spoterror"', 'card.kind === "predict"', 'card.kind === "build"']) {
    assert.ok(learnSrc.includes(needle), `the Player does not render ${needle}`);
  }
  for (const needle of ["LOOK AT THE PICTURE", "SPOT THE ERROR", "PREDICT WHAT HAPPENS", "BUILD THE SYSTEM", "WHAT ACTUALLY HAPPENS"]) {
    assert.ok(learnSrc.includes(needle), `a stage label is missing: ${needle}`);
  }
  assert.ok(learnSrc.includes("function CardVisual"), "the visual slot component is missing");
  assert.ok(learnSrc.includes('state === "error"'), "the visual slot does not hide a missing asset");
  // Pin corrected 2026-10-15 (the old model purge): this block used
  // to pin the CharacterPose component and the eight raster pose
  // paths under /cortex/character/ (themselves corrected twice on
  // 2026-10-14). The owner saw the old raster model still
  // rendering and ordered it gone: the character slot in the
  // Player is the NovaRive canvas now (the lesson intro mount
  // below), the pose table and its files are deleted, and the
  // pins here flip to absences so the portraits cannot return.
  assert.ok(!learnSrc.includes("function CharacterPose"), "the retired raster pose slot came back");
  assert.ok(!learnSrc.includes("/cortex/character/nova-"), "a raster Nova pose path is declared again");
  assert.ok(learnSrc.includes('<NovaRive state="greeting" size={128} framing="full" />'),
    "the lesson intro no longer opens on the canvas Nova");
  assert.ok(!learnSrc.includes("wick-"), "a live Wick pose path survived the Nova rename");
  assert.ok(!learnSrc.includes("pip-"), "a live Pip pose path survived the rename");
  assert.ok(learnSrc.includes("<DiagramArt"), "the diagram renderer is not used");
});

await test("the home carries the journey, the bench, the bundle, ranks, and onboarding", () => {
  for (const needle of [
    "Your journey", "Next stop: ", "FADING", "REVIEW BENCH", "Start review",
    "COURSES FROM YOUR SEARCHES", "YOUR RANK", "rankForXp(profile ? profile.xp : 0)",
    "Mastery level", "topicMasteryLevel(topicPath, builtinProgress)",
    "function OnboardingFlow", "What are you curious about?", "How many minutes a day?",
    "Start your first lesson", "DAILY SESSION COMPLETE", "TOMORROW",
    "startBundle", "bundleStage", "lessonOpenerStyle(lesson, lessonIdx)",
  ]) {
    assert.ok(learnSrc.includes(needle), `the home is missing: ${needle}`);
  }
  const journey = learnSrc.indexOf("Your journey");
  const searches = learnSrc.indexOf("COURSES FROM YOUR SEARCHES");
  const studio = learnSrc.indexOf("CONTRIBUTOR STUDIO");
  // Reading note, 2026-10-14 (home restructure wave): the journey
  // is the Paths screen, courses from searches is the Library
  // screen, and the studio sits on Create. The assertions now pin
  // that the screens keep this order, Paths before Library before
  // Create, in place of the old stacked page order.
  assert.ok(journey > 0 && searches > journey, "courses from searches should sit below the journey");
  assert.ok(studio > searches, "the contributor studio should sit below the journey too");
  assert.ok(!learnSrc.includes("out of hearts") && !learnSrc.includes("lives to lose"),
    "a punishment mechanic crept into the copy");
});

// ─═════════════════════════════════════════════════════════════════
group("Loop systems: quests, Sparks, reminders, leagues, share cards");

const loopDay = "2026-10-14";
const keyDaysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return todayKey(d); };

await test("quest plan shape: always three, session first, deterministic", () => {
  const args = { day: loopDay, profile: { xp: 0 }, progress: { lessons: {} }, dueCount: 0 };
  const quests = buildDailyQuests(args);
  assert.equal(quests.length, 3);
  assert.deepEqual([...quests.map((q) => q.slot)], ["session", "target", "stretch"]);
  assert.equal(quests[0].kind, "session");
  assert.equal(quests[0].title, "Finish today's session");
  assert.deepEqual(asJSON(buildDailyQuests(args)), asJSON(quests), "identical inputs must give identical quests");
  for (const q of quests) {
    assert.ok(typeof q.title === "string" && q.title.length > 0);
    assert.ok(typeof q.detail === "string" && q.detail.length > 0);
    assert.ok(!q.title.includes("-") && !q.detail.includes("-"), `a dash in quest copy: ${q.title}`);
  }
});

await test("target picks review when due, and stretch picks an available checkpoint before a new topic", () => {
  const withDue = buildDailyQuests({ day: loopDay, profile: { xp: 0 }, progress: { lessons: {} }, dueCount: 3 });
  assert.equal(withDue[1].kind, "review");
  assert.equal(withDue[1].dueAtStart, 3);
  // Make the flagship path's next unfinished lesson its first checkpoint.
  const body = LEARNING_PATHS.find((p) => p.id === "the-human-body");
  const flat = flattenPathLessons(body);
  const checkpointIdx = flat.findIndex((l) => l.checkpoint === true);
  assert.ok(checkpointIdx > 0, "the flagship should carry a checkpoint lesson");
  let prog = { lessons: {}, lastPathId: "", lastLessonId: "" };
  for (let i = 0; i < checkpointIdx; i++) prog = applyLessonResult(prog, body, flat[i].id, 90);
  const quests = buildDailyQuests({ day: loopDay, profile: { xp: 0 }, progress: prog, dueCount: 0 });
  assert.equal(quests[2].kind, "checkpoint", `stretch should pick the checkpoint, got ${quests[2].kind}`);
  assert.equal(quests[2].targetId, flat[checkpointIdx].id);
  const fresh = buildDailyQuests({ day: loopDay, profile: { xp: 0 }, progress: { lessons: {} }, dueCount: 0 });
  assert.equal(fresh[2].kind, "newtopic", "with no checkpoint next, stretch should open a new topic");
  assert.ok(TOPIC_COURSES.some((p) => p.id === fresh[2].pathId));
  assert.equal(fresh[1].kind, "lesson");
  assert.equal(fresh[1].targetId, flat0[0].id, "with nothing started, target is the first path's first lesson");
});

await test("questState reports review progress, partial and cleared", () => {
  const quest = buildDailyQuests({ day: loopDay, profile: { xp: 0 }, progress: { lessons: {} }, dueCount: 3 })[1];
  const loop = emptyLoop(loopDay);
  assert.deepEqual(asJSON(questState(quest, { loop, dueCount: 2, progress: { lessons: {} } })), { current: 1, total: 3, done: false });
  assert.deepEqual(asJSON(questState(quest, { loop, dueCount: 0, progress: { lessons: {} } })), { current: 3, total: 3, done: true });
  assert.deepEqual(asJSON(questState(quest, { loop, dueCount: 3, progress: { lessons: {} } })), { current: 0, total: 3, done: false });
});

await test("questState reads event based quests from the loop record", () => {
  const targetId = flat0[0].id;
  let p = { xp: 0, sparks: 0 };
  p = recordLoopEvent(p, loopDay, { type: "lesson", lessonId: targetId });
  const loop = loopForDay(p, loopDay);
  const lessonQuest = { slot: "target", kind: "lesson", title: "t", detail: "d", targetId, pathId: path0.id, dueAtStart: 0 };
  assert.equal(questState(lessonQuest, { loop, dueCount: 0, progress: { lessons: {} } }).done, true);
  const perfectQuest = { slot: "stretch", kind: "perfect", title: "t", detail: "d", targetId: null, pathId: null, dueAtStart: 0 };
  assert.equal(questState(perfectQuest, { loop, dueCount: 0, progress: { lessons: {} } }).done, false);
  p = recordLoopEvent(p, loopDay, { type: "perfect", lessonId: targetId });
  assert.equal(questState(perfectQuest, { loop: loopForDay(p, loopDay), dueCount: 0, progress: { lessons: {} } }).done, true);
  const sessionQuest = { slot: "session", kind: "session", title: "t", detail: "d", targetId: null, pathId: null, dueAtStart: 0 };
  assert.equal(questState(sessionQuest, { loop, dueCount: 0, progress: { lessons: {} } }).done, false);
  p = recordLoopEvent(p, loopDay, { type: "session" });
  assert.equal(questState(sessionQuest, { loop: loopForDay(p, loopDay), dueCount: 0, progress: { lessons: {} } }).done, true);
});

await test("recordLoopEvent pays the session once per day, and again the next day", () => {
  let p = { xp: 0, sparks: 0 };
  p = recordLoopEvent(p, loopDay, { type: "session" });
  assert.equal(p.sparks, SPARKS_RATES.session);
  p = recordLoopEvent(p, loopDay, { type: "session" });
  assert.equal(p.sparks, SPARKS_RATES.session, "a second session event the same day pays nothing");
  p = recordLoopEvent(p, "2026-10-15", { type: "session" });
  assert.equal(p.sparks, SPARKS_RATES.session * 2, "the next day pays again");
  const source = { xp: 0, sparks: 3 };
  recordLoopEvent(source, loopDay, { type: "session" });
  assert.equal(source.sparks, 3, "recordLoopEvent must not mutate its input");
});

await test("perfect and checkpoint events dedupe per lesson per day", () => {
  let p = { xp: 0, sparks: 0 };
  p = recordLoopEvent(p, loopDay, { type: "perfect", lessonId: "l-a" });
  p = recordLoopEvent(p, loopDay, { type: "perfect", lessonId: "l-a" });
  assert.equal(p.sparks, SPARKS_RATES.perfect, "the same perfect lesson pays once a day");
  p = recordLoopEvent(p, loopDay, { type: "perfect", lessonId: "l-b" });
  assert.equal(p.sparks, SPARKS_RATES.perfect * 2);
  p = recordLoopEvent(p, loopDay, { type: "checkpoint", lessonId: "l-a" });
  p = recordLoopEvent(p, loopDay, { type: "checkpoint", lessonId: "l-a" });
  assert.equal(p.sparks, SPARKS_RATES.perfect * 2 + SPARKS_RATES.checkpoint);
  p = recordLoopEvent(p, "2026-10-15", { type: "perfect", lessonId: "l-a" });
  assert.equal(p.sparks, SPARKS_RATES.perfect * 3 + SPARKS_RATES.checkpoint, "a new day pays the same lesson again");
});

await test("settleQuestPayouts pays five once per quest", () => {
  const quests = buildDailyQuests({ day: loopDay, profile: { xp: 0 }, progress: { lessons: {} }, dueCount: 0 });
  let p = { xp: 0, sparks: 0 };
  p = recordLoopEvent(p, loopDay, { type: "lesson", lessonId: quests[1].targetId });
  const first = settleQuestPayouts(p, loopDay, quests, { dueCount: 0, progress: { lessons: {} } });
  assert.deepEqual([...first.newlyPaid], ["target"]);
  assert.equal(first.profile.sparks, SPARKS_RATES.quest);
  assert.equal(first.profile.loop.paid.target, true);
  assert.equal(first.profile.loop.done.target, true);
  const second = settleQuestPayouts(first.profile, loopDay, quests, { dueCount: 0, progress: { lessons: {} } });
  assert.deepEqual([...second.newlyPaid], []);
  assert.equal(second.profile.sparks, SPARKS_RATES.quest, "a settled quest pays only once");
});

await test("rank ups pay fifty per rung and nothing within a rung", () => {
  assert.equal(awardSparksForRankUps({ sparks: 0 }, 0, RANK_LADDER[1].minXp).sparks, 50);
  assert.equal(awardSparksForRankUps({ sparks: 10 }, 0, RANK_LADDER[2].minXp).sparks, 110);
  assert.equal(awardSparksForRankUps({ sparks: 7 }, 10, 100).sparks, 7);
  assert.equal(SPARKS_RATES.rankUp, 50);
});

await test("spending refuses to go below zero, and freezes refuse at the cap and when short", () => {
  assert.equal(spendSparks({ sparks: 20 }, 30), null);
  assert.equal(spendSparks({ sparks: 20 }, 20).sparks, 0);
  assert.equal(buyStreakFreeze({ sparks: 200, freezes: SPARKS_RATES.freezeCap }), null, "the freeze cap refuses");
  assert.equal(buyStreakFreeze({ sparks: 40, freezes: 0 }), null, "a short balance refuses");
  const bought = buyStreakFreeze({ sparks: 50, freezes: 1 });
  assert.equal(bought.freezes, 2);
  assert.equal(bought.sparks, 0);
});

await test("streak repair fires only for exactly one missed day and restores the count for 100", () => {
  const oneMissed = { xp: 0, sparks: 150, freezes: 0, days: [keyDaysAgo(2), keyDaysAgo(0)], bridged: [] };
  const offer = streakRepairOffer(oneMissed, new Date());
  assert.ok(offer, "one missed day should produce an offer");
  assert.equal(offer.missedDay, keyDaysAgo(1));
  assert.equal(offer.lostStreak, 1);
  assert.equal(offer.cost, 100);
  const noMiss = { xp: 0, sparks: 150, freezes: 0, days: [keyDaysAgo(1), keyDaysAgo(0)], bridged: [] };
  assert.equal(streakRepairOffer(noMiss, new Date()), null, "no missed day means no offer");
  const twoMissed = { xp: 0, sparks: 150, freezes: 0, days: [keyDaysAgo(3), keyDaysAgo(0)], bridged: [] };
  assert.equal(streakRepairOffer(twoMissed, new Date()), null, "two missed days means no offer");
  const repaired = applyStreakRepair(oneMissed);
  assert.equal(repaired.sparks, 50, "repair charges 100");
  assert.ok(repaired.days.includes(keyDaysAgo(1)), "the missed day is back in the record");
  assert.ok(repaired.bridged.includes(keyDaysAgo(1)), "the missed day is marked bridged");
  assert.equal(repaired.streak, 3, "today, the repaired day, and the day before count back");
  assert.equal(applyStreakRepair({ ...oneMissed, sparks: 50 }), null, "repair refuses when the balance is short");
});

await test("Sparks never buy list is exact, and spending has exactly the two purchase paths", () => {
  assert.deepEqual([...SPARKS_NEVER_BUYS], ["answers", "hints", "skips", "XP", "rank", "mastery", "league standing"]);
  assert.ok(learnSrc.includes("buyStreakFreeze"), "the freeze purchase path is missing");
  assert.ok(learnSrc.includes("applyStreakRepair"), "the repair purchase path is missing");
  const spendCalls = learnSrc.match(/spendSparks\(/g) || [];
  assert.equal(spendCalls.length, 3, `spendSparks should appear only as its definition plus the freeze and repair calls, found ${spendCalls.length}`);
  for (const copy of ["Buy a hint", "Buy an answer", "Buy a skip", "Buy XP", "Buy rank", "Buy mastery"]) {
    assert.ok(!learnSrc.includes(copy), `a purchase offer for a never buy item crept in: ${copy}`);
  }
  assert.ok(learnSrc.includes("Sparks never buy "), "the shop does not state the never buy line");
});

await test("league points cap the day, ignore replays, and sum capped days for the week", () => {
  assert.equal(LEAGUE_GROUP_SIZE, 30);
  assert.equal(LEAGUE_DAILY_POINTS_CAP, 60);
  assert.equal(LEAGUES_WEEKLY_ACTIVE_GATE, 3000);
  assert.equal(leagueDailyPoints({ lessonsFirstTime: 2, reviewCorrect: 5 }), 50);
  assert.equal(leagueDailyPoints({ lessonsFirstTime: 10, reviewCorrect: 50 }), 60, "the daily cap applies");
  assert.equal(leagueDailyPoints({}), 0);
  assert.equal(leagueDailyPoints({ lessonsFirstTime: 1, reviewCorrect: 0, replays: 99 }), 20, "replays earn nothing and are never counted");
  assert.equal(leagueWeeklyPoints([60, 50, 10]), 120);
  assert.equal(leaguesAreOpen(2999), false);
  assert.equal(leaguesAreOpen(3000), true);
});

await test("league groups chunk sorted ids into groups of thirty holding the learner", () => {
  const ids = Array.from({ length: 65 }, (_, i) => "learner-" + String(i).padStart(2, "0"));
  const mine = leagueGroupFor("learner-40", ids);
  assert.ok(mine.length <= 30, `a league group holds ${mine.length}`);
  assert.ok(mine.includes("learner-40"));
  assert.equal(leagueGroupFor("learner-00", ids).length, 30);
  assert.deepEqual([...leagueGroupFor("nobody", ids)], []);
});

await test("reminders wait for the chosen hour, name the streak and quest, and turn urgent late", () => {
  const quests = buildDailyQuests({ day: loopDay, profile: { xp: 0 }, progress: { lessons: {} }, dueCount: 0 });
  const atHour = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d; };
  const profile = { xp: 0, sparks: 0, streak: 5, reminderHour: 9 };
  assert.equal(reminderFor({ profile, quests, loop: emptyLoop(loopDay), now: atHour(8) }), null, "before the chosen hour there is no reminder");
  assert.equal(reminderFor({ profile: { ...profile, reminderHour: null }, quests, loop: emptyLoop(loopDay), now: atHour(12) }), null, "no chosen hour means no reminder");
  const doneLoop = { ...emptyLoop(loopDay), sessionDone: true };
  assert.equal(reminderFor({ profile, quests, loop: doneLoop, now: atHour(12) }), null, "a finished session needs no reminder");
  const daily = reminderFor({ profile, quests, loop: emptyLoop(loopDay), now: atHour(10) });
  assert.equal(daily.kind, "daily");
  assert.ok(daily.body.includes("5"), "the daily reminder does not name the streak");
  assert.ok(daily.body.includes(quests[0].title), "the daily reminder does not name the open quest");
  const late = reminderFor({ profile, quests, loop: emptyLoop(loopDay), now: atHour(23) });
  assert.equal(late.kind, "atrisk");
  assert.ok(late.body.includes("5") && late.body.includes("session"), "the late reminder should name the streak and the session");
});

await test("share card models shape every kind, with celebrate for wins and wave for rank", () => {
  const lesson = shareCardModel("lesson", { title: "Cells", courseTitle: "The Human Body", accuracy: 90, xp: 120 });
  assert.equal(lesson.pose, "celebrate");
  assert.equal(lesson.title, "Cells");
  assert.ok(lesson.eyebrow.length > 0);
  assert.deepEqual([...lesson.lines], ["First try accuracy 90%", "+120 XP", "The Human Body"]);
  const course = shareCardModel("course", { title: "Sleep", accuracy: 80, xp: 200 });
  assert.equal(course.pose, "celebrate");
  assert.ok(course.lines.some((l) => l.includes("80%")));
  const session = shareCardModel("session", { streak: 4, rankName: "Explorer", mastered: 9 });
  assert.equal(session.pose, "celebrate");
  assert.ok(session.lines.some((l) => l.includes("Explorer")));
  assert.ok(session.lines.some((l) => l.includes("9")));
  const streak = shareCardModel("streak", { streak: 30, rankName: "Explorer", mastered: 9 });
  assert.equal(streak.title, "30 day streak");
  assert.equal(streak.pose, "celebrate");
  const rank = shareCardModel("rank", { rankName: "Explorer", xp: 250 });
  assert.equal(rank.pose, "wave");
  assert.equal(rank.title, "Explorer");
  for (const m of [lesson, course, session, streak, rank]) {
    assert.ok(Array.isArray(m.lines) && m.lines.every((l) => typeof l === "string"));
    assert.ok(!JSON.stringify(m).includes("-") || m.title.includes("Human"), `a dash in a share model: ${JSON.stringify(m)}`);
  }
});

await test("import validation accepts the new profile fields and refuses a corrupt loop", () => {
  const good = deepDoc();
  good.profile = { ...good.profile, sparks: 25, loopDay: loopDay, reminderHour: 9, leaguesOptIn: true, loop: asJSON(emptyLoop(loopDay)) };
  assert.equal(parseCortexImport(JSON.stringify(good)).ok, true, "a profile carrying the new fields was refused");
  const badLoop = deepDoc();
  badLoop.profile = { ...badLoop.profile, sparks: 25, loop: "not a loop" };
  assert.equal(parseCortexImport(JSON.stringify(badLoop)).ok, false, "a corrupt loop record was accepted");
  const badEvents = deepDoc();
  badEvents.profile = { ...badEvents.profile, loop: { plan: null, events: { lessons: "not a list" } } };
  assert.equal(parseCortexImport(JSON.stringify(badEvents)).ok, false, "loop events that are not string lists were accepted");
  const badQuest = deepDoc();
  badQuest.profile = { ...badQuest.profile, loop: { plan: { target: { title: 42 } } } };
  assert.equal(parseCortexImport(JSON.stringify(badQuest)).ok, false, "a quest descriptor without a string title was accepted");
  const badHour = deepDoc();
  badHour.profile = { ...badHour.profile, reminderHour: 25 };
  assert.equal(parseCortexImport(JSON.stringify(badHour)).ok, false, "a reminder hour outside the day was accepted");
  assert.equal(cortexLoopProblem(null), null);
  assert.equal(cortexLoopProblem(asJSON(emptyLoop(loopDay))), null);
  assert.ok(cortexLoopProblem("nope").includes("profile"));
});

await test("export and import round trip keeps sparks and the reminder hour", () => {
  const state = {
    ...cortexFixtureState,
    profile: { ...cortexFixtureState.profile, sparks: 33, reminderHour: 13, leaguesOptIn: false, loopDay: loopDay, loop: null },
  };
  const parsed = parseCortexImport(JSON.stringify(buildCortexExport(state, new Date())));
  assert.equal(parsed.ok, true, parsed.error || "round trip refused");
  assert.equal(parsed.state.profile.sparks, 33);
  assert.equal(parsed.state.profile.reminderHour, 13);
});

await test("the home carries quests, the Sparks shop, reminders, leagues, share cards, and the third onboarding step", () => {
  for (const needle of [
    "SPARKS", "Buy a streak freeze · 50 Sparks", "Repair the missed day · 100 Sparks",
    // Pin moved 2026-10-14 (owner's copy ruling): the reminders
    // explanation was rewritten plainer; the surface is the same.
    "REMINDERS", "Pick an hour. When you come back at that hour", "LEAGUES",
    // Pin moved 2026-10-15 (audit fix 11): the leagues closed state
    // copy was rewritten to read intentional (the board stays shut
    // until enough learners are active, with the meantime named);
    // "Leagues are not open yet" no longer ships.
    "so the board stays shut",
    "You are in for opening day. Your place is saved.",
    "function ShareCardButton", "Share card", "shareCardModel(",
    "When should Nova remind you?", "OF 3", "onDone({ curiosity, minutes, reminderHour })",
    "Tomorrow, one quest is still open: ",
  ]) {
    assert.ok(learnSrc.includes(needle), `the loop surface is missing: ${needle}`);
  }
});

// ─═════════════════════════════════════════════════════════════════
group("Wave 3: the Nova home rebuild");

await test("the shelf holds one object per completed authored path, and nothing else", () => {
  const bodyPath = LEARNING_PATHS.find((p) => p.id === "the-human-body");
  const progress = { lessons: {} };
  for (const l of flattenPathLessons(bodyPath)) progress.lessons[l.id] = { done: true, best: 100 };
  const shelf = shelfObjects([...LEARNING_PATHS, ...TOPIC_COURSES], progress);
  assert.equal(shelf.length, 1, `expected exactly the finished body path on the shelf, got ${JSON.stringify(shelf)}`);
  assert.equal(shelf[0].pathId, "the-human-body");
  assert.equal(shelf[0].title, "The Human Body");
  assert.equal(shelf[0].glyph, "heart", "The Human Body should leave a heart on the shelf");
  assert.deepEqual(asJSON(shelfObjects(LEARNING_PATHS, { lessons: {} })), [], "an untouched learner should have an empty shelf");
  assert.equal(shelfGlyphFor(LEARNING_PATHS.find((p) => p.id === "how-science-works")), "flask", "the science path glyph should be its flask, not its category glyph");
  assert.equal(shelfGlyphFor(LEARNING_PATHS.find((p) => p.id === "space-and-the-solar-system")), "planet", "the space path glyph should be its ringed planet");
  const earthTopic = TOPIC_COURSES.find((p) => p.category === "Earth and Climate");
  assert.equal(shelfGlyphFor(earthTopic), "cloud", "topic paths should fall back to their category glyph");
});

await test("the return greeting gap counts whole days and ignores a missing stamp", () => {
  const now = new Date("2026-10-14T15:00:00").getTime();
  assert.equal(visitGapDays(0, now), 0, "no stamp should read as no gap");
  assert.equal(visitGapDays(new Date("2026-10-14T08:00:00").getTime(), now), 0, "earlier today is not an absence");
  assert.equal(visitGapDays(new Date("2026-10-12T23:00:00").getTime(), now), 2, "two calendar days ago should read as a two day gap");
  assert.equal(visitGapDays(new Date("2026-10-10T09:00:00").getTime(), now), 4);
});

await test("the wave 3 home carries its zones, its settings surface, and Nova's presence", () => {
  // Pin updated 2026-10-14 (home restructure wave): this test used
  // to require the raster asleep pose (pose="asleep") on the home.
  // The persistent avatar is the living vector Nova now, so the
  // asleep presence is pinned as the avatar's asleep state; the
  // raster pose files themselves stay declared for the artwork
  // surfaces, as the character slot test above still requires.
  // Pin updated again 2026-10-14 (presence wave): the owner
  // ordered Nova bigger and reactive, so the asleep presence is
  // the live wrapper at the library empty state's 120px now.
  // Pin updated 2026-10-14 (avatar replacement wave): that
  // presence is the raster art now, and the 120px empty state
  // carries the full figure panel framing.
  // Pin moved 2026-10-15 (owner's one Nova per screen ruling):
  // the library empty state's 120px figure is gone; the empty
  // state carries a book mark instead, pinned below in its
  // place.
  for (const needle of [
    // Pin moved 2026-10-14 (owner's voice ruling): the return
    // greeting was rewritten drier; see the lines library note.
    "NOVA'S SHELF", "Nothing on the shelf yet", "Back, then. Your reviews waited.",
    "Due for review", "Nova settings", "lv-band", "lv-status", "lv-cols",
    'const CREAM = "#FDF3D7"', "Progress stays in this browser. Export to keep a copy.",
    '<Icon name="bookOpen" size={26} />', "Start daily practice", "LAST_VISIT_KEY",
  ]) {
    assert.ok(learnSrc.includes(needle), `the wave 3 home is missing: ${needle}`);
  }
  // Pin removed 2026-10-15 (the old model purge): the needle list
  // above carried "lv-nova-live", the idle sway class the raster
  // portraits wore on the home. The portraits are deleted and
  // the home's Nova is the canvas stage; the class retired with
  // them, and its absence is pinned here instead.
  assert.ok(!learnSrc.includes("lv-nova-live"), "the raster portrait's idle sway class is back");
  assert.ok(!learnSrc.includes("lv-pills"), "the old stat chip row survived the rebuild");
  assert.ok(!learnSrc.includes("YOUR RANK · RUNG"), "the old rank card survived the rebuild");
  assert.ok(!learnSrc.includes('fontStyle: "italic"'), "an italic style survived in LearnView chrome");
  assert.ok(!learnSrc.includes("maxWidth: 880"), "the home is still the old phone width column");
});

await test("the share card draws the wave 3 layout: cream circle, gold glow, two pills, plain footer", () => {
  assert.ok(learnSrc.includes('ctx.fillStyle = "#0F0F0F"'), "share card ground is not the spec near black");
  /* 2026-10-18 (design audit M51): the share card glow was removed on
     purpose; the pin now holds it gone. */
  assert.ok(!learnSrc.includes("rgba(196, 163, 90, 0.08)"), "the share card gold glow is back");
  assert.ok(learnSrc.includes("Cerebrum · askcerebrum.org"), "share card footer is not the spec footer");
  assert.ok(!learnSrc.includes("ctx.strokeRect(36, 36"), "the old share card frame survived");
  assert.ok(!learnSrc.includes("Nova · askcerebrum.org"), "the old share card footer survived");
});

await test("the share card carries the Cerebrum lockup top left and a footer nothing can collide with", () => {
  // 2026-10-15, owner photo: the lesson card's course subline
  // printed on top of the footer brand line (both landed at the
  // same baseline under a two line title) and the card carried
  // no Cerebrum branding of its own. The lockup and the budgeted
  // stack below are the corrected contract.
  assert.ok(learnSrc.includes("SHARE_CARD_BRAIN_L"), "the share card lost its brain mark paths");
  assert.ok(learnSrc.includes("SHARE_CARD_BRAIN_R"), "the share card lost its brain mark paths");
  assert.ok(learnSrc.includes("M9.5 2A2.5 2.5 0 0 1 12 4.5v15"), "the lockup brain is not the favicon geometry");
  assert.ok(learnSrc.includes("ctx.stroke(new Path2D(SHARE_CARD_BRAIN_L))"), "the lockup brain is not stroked");
  assert.ok(learnSrc.includes('ctx.fillText("Cerebrum", 110, 92)'), "the lockup name is not beside the mark");
  /* 2026-10-18 (design audit M51): the copyright line was dropped from
     the card to untangle the vertical band; the pin holds it gone. */
  assert.ok(!learnSrc.includes('ctx.fillText("© 2026 Cerebrum", 56, 128)'), "the share card copyright line is back");
  // The stack is budgeted: the title shrinks until title plus
  // subline plus pills end above STACK_LIMIT with every title
  // word drawn, stepping the whole block up for the longest
  // titles, and the footer keeps its own fixed baseline below
  // that limit.
  assert.ok(learnSrc.includes("const STACK_LIMIT = 968"), "the share card stack lost its budget limit");
  assert.ok(learnSrc.includes("stackFits(titleTop, drawnTitle)"), "the title no longer shrinks to fit the stack");
  assert.ok(learnSrc.includes("titleTop = 784"), "the stepped up second pass for long titles is gone");
  assert.ok(learnSrc.includes("drawn.length >= wrapped.length"), "a fitting layout may again drop title words");
  assert.ok(learnSrc.includes('ctx.fillText("Cerebrum · askcerebrum.org", 540, 1016)'), "the footer brand line lost its own fixed line");
  assert.ok(!learnSrc.includes("belowY"), "the old marching baseline that caused the footer collision survived");
});

// ══════════════════════════════════════════════════════════════════
group("Nova content wave: the fifth path, at the flagship standard");

await test("the fifth path is Matter and Energy, seven units and 40 lessons like the flagship", () => {
  // Nova content wave (2026-10-14): the outside reviewers converged
  // on a fifth authored path in matter, energy, and chemistry. It
  // is authored to the flagship standard of The Human Body and sits
  // with the other authored paths.
  // Curriculum upgrade (2026-10-19): the advanced capstone unit
  // takes it to seven units, forty lessons, and seven flagged
  // checkpoints, the same shape as The Human Body.
  assert.equal(LEARNING_PATHS.length, 5, `expected 5 authored paths, found ${LEARNING_PATHS.length}`);
  const mx = LEARNING_PATHS.find((p) => p.id === "matter-and-energy");
  assert.ok(mx, "the fifth path is missing");
  assert.equal(mx.title, "Matter and Energy");
  assert.equal(mx.category, "Matter and Energy");
  assert.equal(mx.units.length, 7, `the fifth path has ${mx.units.length} units`);
  assert.equal(flattenPathLessons(mx).length, 40, "the fifth path should hold 40 lessons");
  const flagged = flattenPathLessons(mx).filter((l) => l.checkpoint === true);
  assert.equal(flagged.length, 7, `the fifth path has ${flagged.length} flagged checkpoints, not 7`);
  for (const l of flagged) {
    assert.equal(l.subtitle, "Eight mixed questions on the whole unit. Nothing new, just proof.",
      `${l.title} checkpoint subtitle drifted from the flagship wording`);
  }
});

await test("every fifth path lesson follows the flagship card sequences", () => {
  const mx = LEARNING_PATHS.find((p) => p.id === "matter-and-energy");
  const HANDS_ON = ["match", "order", "build", "spoterror"];
  for (const lesson of flattenPathLessons(mx)) {
    const kinds = [...lesson.cards.map((c) => c.kind)];
    if (lesson.id === "mx-capstone") {
      assert.deepEqual(kinds, ["note", "quiz", "order", "note", "predict", "visualq", "truefalse", "truefalse", "quiz", "note"],
        "the capstone does not follow the flagship capstone sequence");
      continue;
    }
    if (lesson.checkpoint === true) {
      assert.deepEqual(kinds, ["quiz", "match", "visualq", "truefalse", "truefalse", "order", "quiz", "spoterror"],
        `${lesson.title} does not follow the eight card checkpoint sequence`);
      assert.equal(lesson.cards[3].answer, true, `${lesson.title} checkpoint pair opens false`);
      assert.equal(lesson.cards[4].answer, false, `${lesson.title} checkpoint pair closes true`);
      continue;
    }
    assert.equal(kinds.length, 10, `${lesson.title} has ${kinds.length} cards, not 10`);
    assert.deepEqual(kinds.slice(0, 5), ["predict", "note", "note", "note", "visualq"],
      `${lesson.title} does not open with the flagship hook and teach run`);
    assert.ok(HANDS_ON.includes(kinds[5]), `${lesson.title} card six is not a hands on card`);
    assert.deepEqual(kinds.slice(6), ["truefalse", "truefalse", "quiz", "note"],
      `${lesson.title} does not close with the flagship pair, apply quiz, and payoff`);
    assert.equal(lesson.cards[6].answer, true, `${lesson.title} first true or false card is not the true one`);
    assert.equal(lesson.cards[7].answer, false, `${lesson.title} second true or false card is not the false one`);
    assert.deepEqual(lesson.cards[4].diagram, lesson.cards[3].diagram,
      `${lesson.title} visual question does not repeat the mechanism diagram word for word`);
    assert.equal(lesson.cards[9].kicker, "The payoff", `${lesson.title} last card is not the payoff`);
  }
});

await test("the fifth path leaves an atom on Nova's shelf when completed", () => {
  const mx = LEARNING_PATHS.find((p) => p.id === "matter-and-energy");
  assert.equal(shelfGlyphFor(mx), "atom", "the fifth path glyph should be its atom, not a fallback");
  const progress = { lessons: {} };
  for (const l of flattenPathLessons(mx)) progress.lessons[l.id] = { done: true, best: 100 };
  const shelf = shelfObjects(LEARNING_PATHS, progress);
  assert.equal(shelf.length, 1, `expected exactly the finished fifth path on the shelf, got ${JSON.stringify(shelf)}`);
  assert.equal(shelf[0].pathId, "matter-and-energy");
  assert.equal(shelf[0].glyph, "atom", "a completed Matter and Energy should leave an atom on the shelf");
});

await test("the search built course asks the search for a medium answer, the value it accepts", () => {
  // The search accepts short, medium, and long for answerLength;
  // medium is the normal answer the main search box sends. The
  // course builder in LearnView once sent "standard", a value the
  // search does not accept (Nova content wave, 2026-10-14).
  assert.ok(learnSrc.includes('answerLength: "medium"'), "the course builder does not send the accepted medium answer length");
  assert.ok(!learnSrc.includes('answerLength: "standard"'), "the course builder still sends the unaccepted standard answer length");
});

group("Home restructure: focused screens and the living Nova");

await test("the home is four focused screens behind one tablist, and Today holds only its own sections", () => {
  // Home restructure wave (2026-10-14): the owner ruled the wave 3
  // home was still one endless scroll with info people would miss.
  // The home is now six screens behind a flat tablist; Today holds
  // the band, the status row, review, quests, and the shelf only,
  // and everything else lives on its own screen.
  for (const entry of [
    '{ id: "today", label: "Today" }', '{ id: "paths", label: "Paths" }',
    '{ id: "library", label: "Library" }', '{ id: "create", label: "Create" }',
  ]) assert.ok(learnSrc.includes(entry), "HOME_TABS is missing " + entry);
  assert.ok(learnSrc.includes('role="tablist"'), "the home navigation is not a tablist");
  assert.ok(learnSrc.includes("aria-selected={active}"), "the tabs do not expose the selected screen");
  assert.ok(learnSrc.includes("onClick={() => setHomeTab(t.id)}"), "the tabs do not switch screens");
  /* 2026-10-18 (design audit M47): Shop and Leagues left the tab bar,
     so four screens are reachable. Their render blocks remain in the
     file in order, unmounted, so the slices below still use all six
     block markers while the tab entries above pin the four. */
  const markers = ["today", "shop", "leagues", "paths", "library", "create"].map((id) => learnSrc.indexOf(`homeTab === "${id}"`));
  assert.ok(markers.every((m) => m >= 0), "a home screen block is missing");
  assert.ok(markers.every((m, i) => i === 0 || m > markers[i - 1]), "the home screen blocks are out of order");
  const today = learnSrc.slice(markers[0], markers[1]);
  for (const s of ["DAILY PRACTICE", "Due for review", "NOVA'S SHELF"])
    assert.ok(today.includes(s), "the Today screen is missing " + s);
  for (const s of ["Your journey", "BUILD A COURSE", "Buy a streak freeze", "LEAGUES"])
    assert.ok(!today.includes(s), "the Today screen still stacks " + s);
  const shop = learnSrc.slice(markers[1], markers[2]);
  const leagues = learnSrc.slice(markers[2], markers[3]);
  const paths = learnSrc.slice(markers[3], markers[4]);
  const library = learnSrc.slice(markers[4], markers[5]);
  const create = learnSrc.slice(markers[5]);
  assert.ok(shop.includes("Buy a streak freeze"), "the Shop screen lost the Sparks shop");
  assert.ok(leagues.includes("LEAGUES"), "the Leagues screen lost the leagues panel");
  assert.ok(paths.includes("Your journey") && paths.includes("TOPIC COURSES"), "the Paths screen lost the paths or the catalog");
  assert.ok(library.includes("COURSES FROM YOUR SEARCHES"), "the Library screen lost the search courses");
  assert.ok(create.includes("BUILD A COURSE") && create.includes("CONTRIBUTOR STUDIO"), "the Create screen lost the builder or the studio");
});

/* 2026-10-15, rewritten the same day (the old model purge): the
   test this replaces pinned the traced rig in loving detail, and
   the raster pose test before it pinned the portraits. Both old
   models are gone now. The owner saw one of them still
   rendering live (the lesson intro, completions, the payoff,
   the onboarding header, and the Easter egg all still drew the
   retired art while the header and stage ran the v3 canvas) and
   ordered the old model gone. What this test pins is the
   corrected contract: one Nova, the v3 Rive canvas, on every
   surface, and no road back for either retired model. */
await test("the old Nova models are purged: one character, the v3 canvas, everywhere (2026-10-15)", () => {
  // Neither retired model exists in the learning source: no
  // traced rig, no avatar wrapper over it, no path or state
  // tables, no raster pose table or slot, no rig CSS.
  for (const gone of ["function NovaRig", "function NovaAvatar", "NOVA_RIG_D", "NOVA_RIG_STATES",
    "NOVA_RIG_MOUTHS", "NOVA_RIG_FILAMENTS", "CHARACTER_POSES", "function CharacterPose",
    "/cortex/character/nova-", ".nv-rig", "@keyframes nvRig", "nova-rig-import"]) {
    assert.ok(!learnSrc.includes(gone), `the purged model left a trace in LearnView: ${gone}`);
  }
  // The surfaces that drew the old art draw the canvas now, at
  // the same spots and comparable scale: the lesson intro in
  // its greeting idle, course completion and the daily payoff
  // on the shared celebration figure, and the onboarding header
  // at its 40px.
  assert.ok(learnSrc.includes('<NovaRive state="greeting" size={128} framing="full" />'),
    "the lesson intro does not open on the canvas");
  assert.ok(learnSrc.includes("function NovaCelebrateFigure"), "the completion figure is missing");
  assert.equal((learnSrc.match(/<NovaCelebrateFigure size=\{128\} \/>/g) || []).length, 2,
    "course completion and the daily payoff must both render the celebration figure");
  assert.ok(learnSrc.includes("celebrateN={celebrateN}"), "the celebration figure does not fire the celebrate trigger");
  assert.ok(learnSrc.includes('<NovaRive state="greeting" size={40} />'),
    "the onboarding header does not render the canvas at 40px");
  // The share card draws the canonical v3 model sheet, the
  // ground stripped copy the link card treatment established,
  // and no longer reads a pose table.
  assert.ok(learnSrc.includes('SHARE_CARD_NOVA_SRC = "/nova/nova-model-sheet.svg"'),
    "the share card does not name the model sheet as its art source");
  assert.ok(!learnSrc.includes("CHARACTER_POSES[model.pose]"), "the share card reads the retired pose set again");
  // The Easter egg's figure is the canvas too, its poses mapped
  // onto the contract: thinking to quizState 1, pleased to
  // quizState 3 with the celebrate counter, at full framing.
  // Its visit logic, rarity, and cooldowns are pinned by the
  // egg tests below and did not move.
  assert.ok(eggSrc.includes("function EggFigure"), "the egg has no canvas figure");
  assert.ok(eggSrc.includes('from "./NovaRive.jsx"'), "the egg does not import the canvas");
  assert.ok(eggSrc.includes('pose === "thinking" ? 1 : pose === "pleased" ? 3 : 0'),
    "the egg's pose to quizState mapping changed");
  assert.ok(eggSrc.includes('framing="full"'), "the egg's figure is not at full framing");
  assert.ok(!eggSrc.includes("NovaRig"), "the egg renders the retired rig again");
  // NovaRive has one surface left: the canvas. The fallback
  // branch and its import are gone; the asset constant stays.
  assert.ok(!riveSrc.includes("NovaFallback"), "the retired fallback surface is back");
  assert.ok(!riveSrc.includes("NovaAvatar"), "NovaRive still imports the retired avatar");
  assert.ok(riveSrc.includes("return <NovaCanvas {...props} />;"), "NovaRive no longer renders the canvas directly");
  // The retired files are deleted and the sheet asset exists.
  for (const f of ["nova-greeting", "nova-pleased", "nova-thinking", "nova-worried",
    "nova-fading", "nova-explaining", "nova-deadpan", "nova-asleep"]) {
    assert.ok(!existsSync(join(root, "public/cortex/character/" + f + ".webp")), f + " is still on disk");
  }
  assert.ok(!existsSync(join(root, "public/nova/nova-rig-import.svg")), "the retired rig import sheet is still on disk");
  assert.ok(existsSync(join(root, "public/nova/nova-model-sheet.svg")), "the share card's model sheet asset is missing");
});

await test("the live Nova stands at the persistent spots and the artwork moments are canvas and sheet", () => {
  // Pins moved 2026-10-14 (presence wave): the owner ordered Nova
  // bigger and reactive. The header Nova is 66px in a 68px circle
  // and the bench greeter is 54px, both through the reactive
  // NovaLive wrapper; the old 46 and 40 pins described the sizes
  // he ruled too small. Retitled 2026-10-14 (avatar replacement
  // wave): the standing Nova is the raster art now, and the
  // Library empty state's 120px presence shows the full figure
  // in its cream panel instead of a disc crop.
  assert.ok(learnSrc.includes("<NovaLive state={novaMood} size={66} />"), "the header does not render the mood driven live Nova");
  // Pin removed 2026-10-14 (owner's ruling, "There's a circle
  // over her"): the 68px cream circle that wrapped the header
  // Nova is gone; she stands on the page. The absence is the pin.
  assert.ok(!learnSrc.includes("width: 68, height: 68"), "the header circle came back");
  assert.ok(learnSrc.includes("<SheetNova good={sheetGood}"), "the feedback sheet lost its timed Nova reaction");
  // Pins replaced 2026-10-15 (owner's one Nova per screen
  // ruling, "There's too many Novas on this one page"): the
  // review bench greeter (fading, 54px) and the library empty
  // state's full figure panel (asleep, 120px) are gone. The
  // header Nova is the home's only resident figure; the
  // absences below are the pins now.
  assert.ok(!learnSrc.includes('state="fading" size={54}'), "the review bench grew a second Nova again");
  assert.ok(!learnSrc.includes('state="asleep" size={120} framing="panel"'), "the library empty state grew a second Nova again");
  // Pins replaced 2026-10-15 (the old model purge): the lesson
  // intro's raster artwork and the share card's pose set are
  // both retired. The intro renders the canvas greeting, and
  // the share card draws the v3 model sheet; the full purge
  // contract is pinned by the purge test above.
  assert.ok(learnSrc.includes('<NovaRive state="greeting" size={128} framing="full" />'), "the lesson intro lost its canvas Nova");
  assert.ok(learnSrc.includes("SHARE_CARD_NOVA_SRC"), "the share card no longer names the model sheet");
});

await test("adaptive animation: idle drift stages, late night compounding, and the wake resolver", () => {
  // Adaptive animation (2026-10-14, the owner's order). The
  // stage math is pure: an untouched page drifts alert (0) to
  // fading (1) to asleep (2) on the user's clock, late night
  // shortens both waits, and a sleepy context shortens them
  // further. The wake itself is staged in NovaLive, one stage
  // per NOVA_WAKE_STEP_MS.
  assert.equal(NOVA_ACTIVITY_EVENT, "nova-activity");
  assert.equal(NOVA_WAKE_STEP_MS, 650);
  assert.equal(novaIdleStageFor(0, 14, "greeting"), 0);
  assert.equal(novaIdleStageFor(44999, 14, "greeting"), 0);
  assert.equal(novaIdleStageFor(45000, 14, "greeting"), 1, "45 quiet seconds should make her fading");
  assert.equal(novaIdleStageFor(119999, 14, "greeting"), 1);
  assert.equal(novaIdleStageFor(120000, 14, "greeting"), 2, "two quiet minutes should put her asleep");
  assert.equal(novaIdleStageFor(20000, 23, "greeting"), 1, "late night drowsiness comes sooner");
  assert.equal(novaIdleStageFor(60000, 2, "greeting"), 2, "late night sleep comes sooner");
  assert.equal(novaIdleStageFor(15000, 14, "asleep"), 1, "a sleepy context re-drifts fast after a wake");
  assert.equal(novaIdleStageFor(45000, 14, "asleep"), 2);
  assert.equal(novaIdleStageFor(0, 14, "fading"), 1, "a fading context starts at stage one");
  assert.equal(novaIdleStageFor(90000, 14, "fading"), 2);
  // The resolver: stages win over the handed mood, except a
  // worried streak risk, which stays worried at stage one; a
  // woken night Nova greets until the drift takes her again.
  assert.equal(novaAdaptiveStateFor({ base: "greeting", sleepStage: 0 }), "greeting");
  assert.equal(novaAdaptiveStateFor({ base: "greeting", sleepStage: 1 }), "fading");
  assert.equal(novaAdaptiveStateFor({ base: "greeting", sleepStage: 2 }), "asleep");
  assert.equal(novaAdaptiveStateFor({ base: "worried", sleepStage: 1 }), "worried");
  assert.equal(novaAdaptiveStateFor({ base: "worried", sleepStage: 2 }), "asleep");
  assert.equal(novaAdaptiveStateFor({ base: "asleep", sleepStage: 0 }), "greeting");
  assert.equal(novaAdaptiveStateFor({ base: "fading", sleepStage: 0 }), "fading");
  assert.equal(typeof emitNovaActivity, "function");
  // The wiring: NovaLive listens on the window and cleans up,
  // and the course builder emits the real search signals.
  // Pins moved 2026-10-15 (the owner's browser check sat
  // untouched for a minute and she stayed alert): the drift is
  // driven by genuine activity only. A pointer move counts
  // when its coordinates actually changed, a scroll counts
  // through wheel and touch gestures, and the bare window
  // scroll listener is gone, because programmatic and layout
  // scrolls (a screenshot pass, a route change) fire it too
  // and kept resetting her clock.
  assert.ok(learnSrc.includes('window.addEventListener("pointermove", onPointerMove, { passive: true })'), "NovaLive does not hear pointer activity");
  assert.ok(learnSrc.includes("e.clientX === lastX && e.clientY === lastY"), "a pointer move with no coordinate change still counts as activity");
  assert.ok(learnSrc.includes('window.addEventListener("keydown", onUser)'), "NovaLive does not hear keys");
  assert.ok(learnSrc.includes('window.addEventListener("wheel", onUser, { passive: true })'), "NovaLive does not hear deliberate scrolls");
  assert.ok(learnSrc.includes('window.addEventListener("touchmove", onUser, { passive: true })'), "NovaLive does not hear touch scrolls");
  assert.ok(!learnSrc.includes('addEventListener("scroll", onUser'), "a bare scroll event feeds the idle clock again");
  assert.ok(learnSrc.includes("window.addEventListener(NOVA_ACTIVITY_EVENT, onSignal)"), "NovaLive does not hear activity signals");
  assert.ok(learnSrc.includes('removeEventListener("pointermove", onPointerMove)'), "NovaLive's listeners do not clean up");
  // Her state is provable (2026-10-15): the wrapper carries
  // mood, sleep stage, and current behavior as data, so a
  // probe reads her stage instead of judging screenshots.
  assert.ok(learnSrc.includes("data-nova-mood={brainUi.mood}"), "the wrapper does not carry her mood");
  assert.ok(learnSrc.includes("data-nova-stage={sleepStage}"), "the wrapper does not carry her sleep stage");
  assert.ok(learnSrc.includes("data-nova-doing={doingNow}"), "the wrapper does not carry her current behavior");
  assert.ok(learnSrc.includes('emitNovaActivity("search", "start")'), "the course builder does not announce its search");
  assert.ok(learnSrc.includes('emitNovaActivity("search", "success")'), "the course builder does not announce a landed course");
  assert.ok(learnSrc.includes('emitNovaActivity("search", "degraded")'), "the course builder does not announce a thin result");
  assert.ok(learnSrc.includes('scanning={activityState === "thinking"}'), "a running search does not set the scanning glance");
});

await test("Nova's brain: drives in, behavior out, and she never repeats herself", () => {
  // The brain (2026-10-15, the owner's order: "Not just three.
  // I want her to like have her own brain."). The picker is
  // pure: drives and context in, a chosen behavior and an
  // accumulated mood out.
  const ctx = (over = {}) => ({
    now: 1000000, hour: 14, idleMs: 0, stage: 0, base: "greeting",
    busy: false, lineReady: false, afterThinking: false, calm: false, rand: 0.5, ...over,
  });
  // Real events outrank self initiated behavior: while a beat
  // owns her, even a maximally curious brain may only watch.
  const busyOut = novaBrainDecide({ ...createNovaBrain(null), curiosity: 1 }, ctx({ busy: true }));
  assert.equal(busyOut.behavior, "watch", "a beat in progress is never interrupted");
  // Silence beats a line: with nothing pulling at her, an
  // available line still loses to watching.
  assert.equal(novaBrainDecide(createNovaBrain(null), ctx({ lineReady: true, idleMs: 1000 })).behavior, "watch",
    "she chooses silence over a line when nothing pulls");
  // The drift is a decision now: a long untouched page at
  // stage zero chooses to drift, and fresh activity at stage
  // two chooses to wake.
  assert.equal(novaBrainDecide(createNovaBrain(null), ctx({ idleMs: 130000 })).behavior, "drift",
    "a long idle chooses to drift a sleep stage");
  assert.equal(novaBrainDecide(createNovaBrain(null), ctx({ idleMs: 1000, stage: 2 })).behavior, "wake",
    "fresh activity at stage two chooses to wake");
  // Curiosity performs: it flutters her gills, and the same
  // brain immediately after cannot repeat the trick (the
  // cooldown and the no repeat penalty both bind), and a
  // third decision with both tricks cooling falls to watch.
  const curious = { ...createNovaBrain(null), curiosity: 0.95 };
  const first = novaBrainDecide(curious, ctx({ idleMs: 10000 }));
  assert.equal(first.behavior, "noticing", "high curiosity at an idle screen chooses the noticing routine");
  assert.ok(first.brain.cooldowns.noticing > 1000000, "the chosen behavior rests on its cooldown");
  const second = novaBrainDecide(first.brain, ctx({ idleMs: 10000 }));
  assert.notEqual(second.behavior, "noticing", "she never does the same trick twice in a row");
  assert.equal(second.behavior, "gill-flutter", "the next best fit takes the turn");
  const third = novaBrainDecide(second.brain, ctx({ idleMs: 10000 }));
  assert.equal(third.behavior, "watch", "with her tricks cooling she settles back to watching");
  // The glasses push is her resettle fidget: it wins shortly
  // after a thinking stretch ends.
  assert.equal(novaBrainDecide(createNovaBrain(null), ctx({ idleMs: 1000, afterThinking: true })).behavior, "glasses-push",
    "after thinking she pushes her glasses up");
  // Moods accumulate: two misses darken a greeting baseline
  // to worried before any line appears, one miss only to
  // deadpan, and a calm stretch warms a darkened bias back.
  let b = createNovaBrain(null);
  b = novaBrainObserve(b, { type: "miss" });
  assert.equal(novaBrainDecide(b, ctx()).mood, "deadpan", "one miss darkens her to deadpan");
  b = novaBrainObserve(b, { type: "miss" });
  assert.equal(novaBrainDecide(b, ctx()).mood, "worried", "repeated misses darken her to worried");
  const warmed = novaBrainDecide({ ...createNovaBrain(null), moodBias: -0.2 }, ctx({ calm: true }));
  assert.equal(warmed.mood, "greeting", "a calm stretch warms the baseline back to greeting");
  // Pokes spend patience, and the memory persists: a visit
  // that ended poked out starts the next one patience thin.
  const poked = novaBrainObserve(createNovaBrain(null), { type: "poke" });
  assert.ok(poked.patience <= 0.5, "a poke spends her patience");
  assert.ok(poked.pokeTrend > 0, "the poke leaves a trend behind");
  assert.ok(createNovaBrain({ lastEnd: "poked-out", patience: 0.9 }).patience <= 0.35,
    "a poked out ending carries thin patience into the next visit");
  assert.equal(createNovaBrain({ lastEnd: "pleased" }).lastEnd, "pleased", "how a visit ended is remembered");
  // The wiring: NovaLive runs the picker on a tick, persists
  // the brain inside the quirks store, and the tap path is
  // whole from the header instance to the held beat (the
  // owner's browser check missed it on screenshot timing;
  // every link of the chain is pinned here instead).
  assert.ok(learnSrc.includes("novaBrainDecide(brainRef.current, {"), "NovaLive never asks the brain");
  assert.ok(learnSrc.includes("createNovaBrain(saved)"), "NovaLive never loads the brain");
  assert.ok(learnSrc.includes("q.brain = brainRef.current"), "the brain is not persisted in the quirks store");
  assert.ok(learnSrc.includes('onClick={onTap}'), "the live wrapper takes no tap");
  assert.ok(learnSrc.includes("setBeat(step.face)"), "a tap does not set the poke ladder's face");
  assert.ok(learnSrc.includes("setTimeout(() => setBeat(null), 1300)"), "the tap beat does not hold its 1300ms");
  // Pin replaced 2026-10-15 (the old model purge): this pair
  // pinned the rig's halo (the faint radial ground behind the
  // bust) and that it could not eat a tap. The halo was part of
  // the retired rig's rendering and is deleted with it; the
  // canvas figure paints no ground layer at all, so there is
  // nothing between the tap and the wrapper that takes it.
  assert.ok(!learnSrc.includes(".nv-rig-halo"), "the retired rig's halo is back");
});

await test("Nova's brain: a full tick simulation of an untouched page drifts on schedule", () => {
  // Instrumented diagnosis (2026-10-15): the idle sleep drift
  // failed to fire in the real browser twice, the second time
  // with data attributes proving mood greeting, stage 0, and
  // doing alternating watch and glance after about 80 seconds
  // of claimed no input. The one shot pins above never modeled
  // the live loop, so this test runs the loop itself: the
  // shipped picker called every 2600ms exactly as NovaLive's
  // tick calls it (same ctx fields, a realistic epoch so the
  // calm flag computes the way production computes it, the
  // chosen behavior applied to the stage the way applyBehavior
  // applies it, the returned brain fed back in). Zero events:
  // the idle span is the whole elapsed clock.
  const T0 = 1760000000000;
  const runTicks = ({ seconds = 120, hour = 14, base = "greeting", startStage = 0, seed = null, refreshEveryMs = 0 } = {}) => {
    let brain = createNovaBrain(seed);
    let stage = startStage;
    let lastRefresh = T0;
    const log = [];
    for (let tick = 1; tick * 2600 <= seconds * 1000; tick++) {
      const now = T0 + tick * 2600;
      if (refreshEveryMs && now - lastRefresh >= refreshEveryMs) lastRefresh = now;
      const idleMs = now - lastRefresh;
      const out = novaBrainDecide(brain, {
        now, hour, idleMs, stage, base,
        busy: false, lineReady: false, afterThinking: false,
        calm: now - 0 > 60000, rand: 0.5,
      });
      brain = out.brain;
      if (out.behavior === "drift") stage = Math.min(2, stage + 1);
      else if (out.behavior === "wake") stage = Math.max(base === "fading" ? 1 : 0, stage - 1);
      log.push({ tick, t: tick * 2.6, idleMs, behavior: out.behavior, stage, attention: brain.attention });
    }
    return log;
  };
  // An untouched daytime page: nothing at all happens until
  // the first tick past the 45 second drowsy threshold, which
  // chooses drift (score about 0.83 against watch's 0.45) and
  // takes her to stage 1; stage 2 follows at the first tick
  // past 120 seconds.
  const day = runTicks({ seconds: 150 });
  assert.ok(day.filter((e) => e.t < 45).every((e) => e.stage === 0 && e.behavior !== "drift"),
    "she drifted before the 45 second threshold");
  const firstDrift = day.find((e) => e.behavior === "drift");
  assert.equal(firstDrift.tick, 18, "the first tick past 45 idle seconds (tick 18, 46.8s in) must choose drift");
  assert.equal(firstDrift.stage, 1, "one drift takes her from alert to fading");
  assert.ok(day.filter((e) => e.tick > 18 && e.t < 120).every((e) => e.stage === 1),
    "she left stage 1 before the two minute mark");
  assert.equal(day.find((e) => e.stage === 2).tick, 47, "stage 2 lands at tick 47, the first past 120 idle seconds");
  // The same on the evening hour the live probe ran at, with a
  // persisted brain and a ready line: the drift is unchanged,
  // because no persisted drive gates it (its floor score of
  // 0.78 beats watch's 0.45 at any energy).
  const evening = runTicks({
    hour: 21,
    seed: { energy: 0.9, curiosity: 0.6, attention: 0.5, patience: 0.6, moodBias: 0.1, lastBehavior: "glance", lastEnd: "ignored", cooldowns: {}, pokeTrend: 0.2, hours: [21] },
  });
  assert.equal(evening.find((e) => e.behavior === "drift").tick, 18, "a persisted brain drifts on the same tick");
  // The other instances on the same page tick independently:
  // the bench (a fading base, starting at stage 1) reaches
  // asleep at the first tick past its 90 second threshold, and
  // the header's schedule is untouched by their presence.
  const bench = runTicks({ base: "fading", startStage: 1 });
  assert.equal(bench.find((e) => e.stage === 2).tick, 35, "the fading bench drifts to asleep on its own schedule (tick 35, 91s in)");
});

await test("Nova's brain: the live failure shape is a fed idle clock, and only that", () => {
  // The mirror of the live reading (2026-10-15 diagnosis). Two
  // facts inside the shipped math turn the browser's report
  // into evidence about its own environment. First, the
  // glance is hard gated: at an idle span of 20 seconds or
  // more its score is -1 and it can never be chosen, whatever
  // the drives say. A probe that reads doing "glance" is
  // therefore reading a tick whose idle span was under 20
  // seconds. Second, a glance can only outscore watch when
  // attention passes 0.7, and attention only climbs on ticks
  // whose idle span is under 5 seconds (plus real observed
  // events); a frozen clock crosses 5 seconds once, attention
  // peaks at 0.48, and from 30 idle seconds it decays. So
  // watch/glance alternation persisting past a claimed 80
  // untouched seconds is unreachable with a frozen clock: the
  // clock was being fed. The only writers of it are genuine
  // window events (the five noteActivity paths), and nothing
  // in the app synthesizes those events, so the feed came from
  // the probing browser's own input channel, which the genuine
  // only listeners correctly counted as use.
  for (const attention of [0, 0.48, 0.9, 1]) {
    for (const curiosity of [0, 0.5, 1]) {
      const b = { ...createNovaBrain(null), attention, curiosity };
      for (const idleMs of [20000, 45000, 80000, 130000]) {
        const out = novaBrainDecide(b, { now: 1760000000000 + idleMs, hour: 21, idleMs, stage: 0, base: "greeting", busy: false, lineReady: true, afterThinking: false, calm: true, rand: 0.5 });
        assert.notEqual(out.behavior, "glance", `glance won at a ${idleMs}ms idle span with attention ${attention}`);
      }
    }
  }
  // Reproduce the live signature by feeding the clock the way
  // the probe environment did: a refresh every 10 seconds
  // (well inside her listeners' definition of genuine use)
  // holds the stage at 0 for a full two minutes, drift never
  // fires, and once attention ratchets past 0.7 the decisions
  // alternate watch and glance, the exact readings the probe
  // reported.
  const T0 = 1760000000000;
  const runFed = (refreshEveryMs) => {
    let brain = createNovaBrain(null);
    let stage = 0;
    let lastRefresh = T0;
    const seen = new Set();
    for (let tick = 1; tick * 2600 <= 120000; tick++) {
      const now = T0 + tick * 2600;
      if (now - lastRefresh >= refreshEveryMs) lastRefresh = now;
      const out = novaBrainDecide(brain, {
        now, hour: 21, idleMs: now - lastRefresh, stage, base: "greeting",
        busy: false, lineReady: false, afterThinking: false, calm: true, rand: 0.5,
      });
      brain = out.brain;
      seen.add(out.behavior);
      if (out.behavior === "drift") stage = Math.min(2, stage + 1);
    }
    return { seen, stage, attention: brain.attention };
  };
  const fed = runFed(10000);
  assert.equal(fed.stage, 0, "a fed clock holds her at stage 0, as the probe saw");
  assert.ok(!fed.seen.has("drift"), "a fed clock never chooses drift, as the probe saw");
  assert.ok(fed.seen.has("glance"), "a fed clock produces the probe's glance readings");
  assert.ok(fed.attention > 0.7, "repeated sub 5 second idle spans ratchet her attention, as the alternation requires");
  // The control: the identical loop with no feed drifts (the
  // schedule itself is proven by the simulation test above),
  // so the feed, not the picker, is the difference.
  const unfed = runFed(Number.POSITIVE_INFINITY);
  assert.ok(unfed.seen.has("drift"), "the same loop unfed chooses drift");
});

await test("novaMoodFor ranks streak risk over overdue review over the late night hours", () => {
  assert.equal(novaMoodFor({ streakAtRisk: true, reviewDue: true, hour: 2, returned: true }), "worried");
  assert.equal(novaMoodFor({ reviewDue: true, hour: 2 }), "fading");
  assert.equal(novaMoodFor({ hour: 23 }), "asleep");
  assert.equal(novaMoodFor({ hour: 2 }), "asleep");
  assert.equal(novaMoodFor({ hour: 14, returned: true }), "greeting");
  assert.equal(novaMoodFor({ hour: 14 }), "greeting");
});

await test("the presence wave: Nova is live where she stands, and her tips obey the gate", () => {
  // Presence wave (2026-10-14), on the owner's order: Nova bigger,
  // reactive, better animated, and helping in speech bubbles.
  // Pins moved 2026-10-14 (avatar replacement wave): the wrapper
  // takes the raster framing now, the hover lift is a translate
  // on the art rather than a gill rotation (the art has no
  // separate gills to rotate), and the tap beat is the quirks
  // engine's poke ladder rather than the old context setBeat:
  // she dislikes being poked, on a schedule, in pokeStep.
  // Pin moved 2026-10-14 (owner's disc ruling): the wrapper's
  // default framing is the bust, not the disc.
  assert.ok(learnSrc.includes('function NovaLive({ state = "greeting", size = 48, framing = "bust" })'), "the reactive Nova wrapper is missing");
  // Pin moved 2026-10-14 (the owner's browser check clicked the
  // header Nova and saw nothing): the tap beat now also pops
  // the wrapper scale, composed with the hover lift.
  // Pin moved again the same night (adaptive animation): the
  // proximity lean rides in on the same wrapper transform.
  assert.ok(learnSrc.includes('(lift ? "translateY(-2px)" : "translateY(0px)") + (beat ? " scale(1.07)" : "") + " translate(" + lean.x + "px, " + lean.y + "px) rotate(" + lean.r + "deg)"'), "the hover lift, tap pop, and proximity lean do not ride in on the wrapper");
  assert.ok(learnSrc.includes("pokeStep(loadNovaQuirks(), Date.now())"), "a tap does not run the poke ladder");
  assert.ok(learnSrc.includes("saveNovaQuirks(step.quirks)"), "the poke ladder's state is not stored");
  assert.ok(learnSrc.includes('const SEEN_TIPS_KEY = "cerebrum-learn2-seentips";'), "the seen tips store is not its own key");
  /* Pin moved 2026-10-15 (the speech unification): LearnView's
     private NovaSpeech bubble component retired; the one bubble
     is NovaBubble from src/NovaSpeech.jsx, which LearnView
     imports and renders directly for its standing speeches. */
  assert.ok(!learnSrc.includes("function NovaSpeech("), "LearnView grew a second private speech bubble");
  assert.ok(learnSrc.includes('from "./NovaSpeech.jsx"'), "LearnView does not take its speech from the one module");
  assert.ok(learnSrc.includes("function NovaTip("), "the tip component is missing");
  for (const id of ["today", "paths", "library", "library-empty", "create", "shop", "leagues", "bench", "streak", "memory", "shelf"])
    assert.ok(learnSrc.includes(`id="${id}"`), "the " + id + " tip is not placed");
  // Pin moved 2026-10-15 (owner's one Nova per screen ruling):
  // the reminder bubble renders bare on the home, text only;
  // its companion figure is gone.
  // Pin moved again the same day (the speech unification): the
  // reminder renders as NovaBubble in its sheet variant, its
  // title and body carried as the bubble's children.
  assert.ok(learnSrc.includes('<NovaBubble variant="sheet">'), "the standing speeches are not NovaBubble sheet bubbles");
  assert.ok(learnSrc.includes("{reminder.title}") && learnSrc.includes("{reminder.body}"), "the reminder is not in bubble form");
  assert.ok(learnSrc.includes("streak={missStreak}"), "the sheet Nova does not hear the miss streak");
  assert.ok(learnSrc.includes("armed={missStreak >= 2}"), "the strategy tip does not arm on the second straight miss");
  assert.ok(!JSON.stringify(buildCortexExport(cortexFixtureState, new Date())).includes("seentips"), "the export carries the seen tips store");
});

await test("tipEligible enforces first visit, the minute gap, and the repeat window", () => {
  const now = 1000000000;
  assert.equal(tipEligible({}, "today", now, 0, 0), true, "an unseen tip behind no gate should be eligible");
  assert.equal(tipEligible({ today: now - 1000 }, "today", now, 0, 0), false, "a seen tip with no repeat window stays seen");
  assert.equal(tipEligible({}, "today", now, now - 30000, 0), false, "a tip inside the minute after another is blocked");
  assert.equal(tipEligible({}, "today", now, now - 61000, 0), true, "a tip after the minute gap is eligible");
  const week = 7 * 24 * 3600 * 1000;
  assert.equal(tipEligible({ streak: now - 2 * 24 * 3600 * 1000 }, "streak", now, 0, week), false, "the streak tip inside its week stays quiet");
  assert.equal(tipEligible({ streak: now - 8 * 24 * 3600 * 1000 }, "streak", now, 0, week), true, "the streak tip returns after its week");
});

// ══════════════════════════════════════════════════════════════════
group("Nova's quirks: memory, opinions, the poke ladder, the shelf, the gag");

await test("computeNovaMemory reads real progress: the weak subject computes, and thin data stays silent", () => {
  // Quirks wave (2026-10-14): her memory lines are computed from
  // the learner's actual profile and progress. The fixture runs
  // real lessons through the real progress writer: four space
  // lessons at 95 and four Matter and Energy lessons at 60, so
  // the strongest and weakest subjects are facts, not fixtures
  // of the line writer.
  const nowMs = new Date("2026-10-14T00:00:00").getTime();
  let progress = cortexEmptyBuiltinProgress();
  const spacePath = LEARNING_PATHS.find((p) => p.category === "Space and Physics");
  const matterPath = LEARNING_PATHS.find((p) => p.id === "matter-and-energy");
  for (const l of flattenPathLessons(spacePath).slice(0, 4)) progress = applyLessonResult(progress, spacePath, l.id, 95);
  for (const l of flattenPathLessons(matterPath).slice(0, 4)) progress = applyLessonResult(progress, matterPath, l.id, 60);
  const profile = { ...cortexEmptyProfile(), days: ["2026-09-24", "2026-10-14"], streak: 6 };
  const facts = computeNovaMemory(profile, progress, nowMs);
  assert.equal(facts.daysKnown, 20, "days known should count from the earliest active day");
  assert.equal(facts.streak, 6);
  assert.ok(facts.subjects, "two worked subjects should produce a reading");
  assert.equal(facts.subjects.strong, "Space and Physics");
  assert.equal(facts.subjects.weak, "Matter and Energy");
  // Expectation moved 2026-10-14 (owner's voice ruling): the
  // memory templates were rewritten; the data slots are the same.
  assert.equal(memoryLineFor(facts),
    "Your Space and Physics is solid. The Matter and Energy scores leak.",
    "the memory line should name the strong and weak subjects the progress proves");
  // Thin data: a brand new learner earns silence, not a guess.
  const thin = computeNovaMemory(cortexEmptyProfile(), cortexEmptyBuiltinProgress(), nowMs);
  assert.equal(thin.subjects, null, "no worked subjects should read as no subjects");
  assert.equal(thin.furthest, null);
  assert.equal(memoryLineFor(thin), null, "thin data should produce no memory line");
  // One subject only: still no strongest versus weakest reading.
  let oneSide = cortexEmptyBuiltinProgress();
  for (const l of flattenPathLessons(spacePath).slice(0, 4)) oneSide = applyLessonResult(oneSide, spacePath, l.id, 95);
  const oneFacts = computeNovaMemory(cortexEmptyProfile(), oneSide, nowMs);
  assert.equal(oneFacts.subjects, null, "one worked subject is not a comparison");
});

await test("memoryLineFor falls to the furthest path when no subject reading exists", () => {
  const nowMs = new Date("2026-10-14T00:00:00").getTime();
  const smallest = [...LEARNING_PATHS, ...TOPIC_COURSES].reduce((a, b) =>
    flattenPathLessons(a).length <= flattenPathLessons(b).length ? a : b);
  const lessons = flattenPathLessons(smallest);
  const n = Math.ceil(lessons.length * 0.3);
  let progress = cortexEmptyBuiltinProgress();
  for (const l of lessons.slice(0, n)) progress = applyLessonResult(progress, smallest, l.id, 80);
  const facts = computeNovaMemory(cortexEmptyProfile(), progress, nowMs);
  assert.ok(facts.furthest, "a partly walked path should be the furthest fact");
  assert.ok(facts.furthest.pct >= 25, `the furthest fact should clear the speaking bar, got ${facts.furthest.pct}`);
  // Expectations moved 2026-10-14 (owner's voice ruling), same
  // templates' data as above.
  assert.equal(memoryLineFor(facts),
    `${facts.furthest.pct} percent into ${facts.furthest.title}. Nothing else is close.`);
  // The streak and days line: a week known and a live streak.
  const known = { ...cortexEmptyProfile(), days: ["2026-10-01"], streak: 3 };
  const knownFacts = computeNovaMemory(known, cortexEmptyBuiltinProgress(), nowMs);
  assert.equal(memoryLineFor(knownFacts), "Day 14 of this. Streak 3. I keep the tally.");
});

await test("opinionForEvent fires in priority order and each opinion rests on its own cooldown", () => {
  const t0 = 5000000000;
  // A perfect lesson outranks everything else on the same event.
  const perfect = opinionForEvent({ perfectLesson: true, good: true, hard: true, ms: 500, easyStreak: 9 }, {}, t0);
  assert.equal(perfect.line, NOVA_OPINION_PERFECT_LINE);
  assert.equal(perfect.face, "pleased");
  assert.equal(opinionForEvent({ perfectLesson: true }, perfect.quirks, t0 + 3600 * 1000), null,
    "the perfect opinion inside its 20 hours stays quiet");
  assert.ok(opinionForEvent({ perfectLesson: true }, perfect.quirks, t0 + QUIRK_PERFECT_COOLDOWN_MS + 1000),
    "the perfect opinion returns after its cooldown");
  // Hard earns respect, and beats the fast compliment.
  const hard = opinionForEvent({ good: true, hard: true, ms: 900 }, {}, t0);
  assert.equal(hard.line, NOVA_OPINION_HARD_LINE);
  assert.equal(hard.face, "explaining");
  assert.equal(opinionForEvent({ good: true, hard: true }, hard.quirks, t0 + 3600 * 1000), null,
    "the hard opinion inside its 2 hours stays quiet");
  // A genuinely fast clean answer.
  const fast = opinionForEvent({ good: true, ms: QUIRK_FAST_MS }, {}, t0);
  assert.equal(fast.line, NOVA_OPINION_FAST_LINE);
  assert.equal(fast.face, "pleased");
  assert.equal(opinionForEvent({ good: true, ms: 2000 }, fast.quirks, t0 + 10 * 60 * 1000), null,
    "the fast opinion inside its 30 minutes stays quiet");
  // Six easy in a row earns the raised brow, deadpan.
  const brow = opinionForEvent({ good: true, ms: 9000, easyStreak: QUIRK_EASY_STREAK }, {}, t0);
  assert.equal(brow.line, NOVA_OPINION_BROW_LINE);
  assert.equal(brow.face, "deadpan");
  // Silence cases: a miss, a slow ordinary correct, five easy.
  assert.equal(opinionForEvent({ good: false, hard: true, ms: 100 }, {}, t0), null, "a miss earns no opinion");
  assert.equal(opinionForEvent({ good: true, ms: 9000 }, {}, t0), null, "a slow ordinary correct earns no opinion");
  assert.equal(opinionForEvent({ good: true, ms: 9000, easyStreak: QUIRK_EASY_STREAK - 1 }, {}, t0), null,
    "five easy in a row is not yet the brow");
  assert.equal(opinionForEvent({ good: true, ms: null }, {}, t0), null, "no timing, no fast opinion");
});

await test("pokeStep escalates pleased, deadpan, turned away, then ignores her for an hour", () => {
  const t = 1000000;
  // Contract widened 2026-10-15 (owner: the old ladder was
  // meh): every step speaks now, from its own variant set, and
  // the early steps rotate. The faces, the gap reset, and the
  // hour lock below are unchanged from the original ladder.
  let s = pokeStep({}, t);
  assert.equal(s.face, "pleased");
  assert.equal(s.line, NOVA_POKE_STEP_ONE[0], "the first poke barely registers, first variant first");
  s = pokeStep(s.quirks, t + 5000);
  assert.equal(s.face, "pleased");
  assert.equal(s.line, NOVA_POKE_STEP_TWO[0], "the second poke acknowledges, dry");
  s = pokeStep(s.quirks, t + 10000);
  assert.equal(s.face, "deadpan");
  assert.equal(s.line, NOVA_POKE_LINE_THREE, "the third poke earns the talked about this line");
  assert.equal(s.line, NOVA_POKE_STEP_THREE[0], "the classic third line is the step's first variant");
  s = pokeStep(s.quirks, t + 15000);
  assert.equal(s.face, "deadpan");
  assert.equal(s.line, NOVA_POKE_STEP_FOUR[0], "the fourth poke draws the documentation line");
  s = pokeStep(s.quirks, t + 20000);
  assert.equal(s.face, "asleep", "the fifth poke turns her away");
  assert.equal(s.line, NOVA_POKE_LINE_FIVE);
  assert.equal(s.line, NOVA_POKE_STEP_FIVE[0], "the classic fifth line is the step's first variant");
  assert.equal(s.quirks.pokes.lockUntil, t + 20000 + QUIRK_POKE_LOCK_MS, "the lock should run an hour");
  const ignored = pokeStep(s.quirks, t + 25000);
  assert.equal(ignored.ignore, true, "taps during the lock are ignored");
  assert.equal(ignored.face, "asleep");
  const after = pokeStep(s.quirks, t + 20000 + QUIRK_POKE_LOCK_MS + 1000);
  assert.equal(after.face, "pleased", "after the hour she is amused again, from zero");
  assert.equal(after.line, NOVA_POKE_STEP_ONE[1], "a fresh ladder serves the next variant, never a repeat");
  // The bank itself: five steps, fourteen lines, originals kept.
  assert.equal(NOVA_POKE_LINES.length, 14, "the poke bank holds every step's variants");
  assert.ok(NOVA_POKE_LINES.includes(NOVA_POKE_LINE_THREE) && NOVA_POKE_LINES.includes(NOVA_POKE_LINE_FIVE),
    "the two original lines stay in the bank");
  // A quiet minute resets her patience before any lock.
  let q = pokeStep({}, t).quirks;
  q = pokeStep(q, t + 5000).quirks;
  const decayed = pokeStep(q, t + 5000 + QUIRK_POKE_GAP_MS + 1000);
  assert.equal(decayed.quirks.pokes.count, 1, "a gap over a minute restarts the count");
  assert.equal(decayed.face, "pleased");
});

await test("the gag rests thirty days and the shelf comments once per object on a fourteen day class rest", () => {
  const t = 9000000000;
  assert.equal(gagDue({}, t), true, "a learner who never heard the gag is due");
  const told = recordGag({}, t);
  assert.equal(gagDue(told, t + 29 * 24 * 3600 * 1000), false, "the gag inside its month stays quiet");
  assert.equal(gagDue(told, t + QUIRK_GAG_COOLDOWN_MS + 1000), true, "the gag returns after thirty days");
  const first = shelfCommentFor({ pathId: "p1", glyph: "flask", category: "The Human Body" }, {}, t);
  assert.equal(first.line, NOVA_SHELF_LINE);
  assert.equal(shelfCommentFor({ pathId: "p1", glyph: "flask" }, first.quirks, t + 1000), null,
    "a seen object earns no second comment");
  const fav = shelfCommentFor({ pathId: "p2", glyph: "planet", category: "Space and Physics" }, {}, t);
  assert.equal(fav.line, NOVA_SHELF_FAVORITE_LINE, "a space object earns the warmer line");
  const suppressed = shelfCommentFor({ pathId: "p3", glyph: "leaf" }, first.quirks, t + 24 * 3600 * 1000);
  assert.equal(suppressed.line, null, "a second landing inside the class rest is not commented");
  assert.ok(suppressed.quirks.shelfSeen.includes("p3"), "the seen mark lands even when the comment is suppressed");
  const later = shelfCommentFor({ pathId: "p4", glyph: "leaf" }, suppressed.quirks, t + QUIRK_SHELF_COOLDOWN_MS + 1000);
  assert.equal(later.line, NOVA_SHELF_LINE, "after the class rest a new landing is commented again");
  assert.equal(shelfCommentFor(null, {}, t), null, "no object, no comment");
  assert.equal(shelfCommentFor({ glyph: "flask" }, {}, t), null, "an object without a path id is not hers to comment on");
});

await test("pickEggLine routes hours, memory, and the gag, and the morning denial covers a repeat", () => {
  // A realistic epoch: the gag's never told state reads as
  // timestamp zero, so a 1970 test clock would read as recently
  // told. Real clocks are what the engine serves.
  const t = 9000000000;
  // The gag lands only when due and the seed calls for it.
  const gag = pickEggLine({ hour: 14, allowGag: true, seed: 8, facts: null }, {}, t);
  assert.ok(NOVA_GAG_LINES.includes(gag.line), "a due gag on a calling seed should be the egg's line");
  assert.equal(gag.quirks.gagAt, t, "telling the gag starts its thirty days");
  const noGag = pickEggLine({ hour: 14, allowGag: true, seed: 8, facts: null }, { gagAt: t }, t + 1000);
  assert.ok(NOVA_EGG_LINES.includes(noGag.line), "a gag on cooldown leaves the plain egg set");
  const gated = pickEggLine({ hour: 14, allowGag: false, seed: 8, facts: null }, {}, t);
  assert.ok(NOVA_EGG_LINES.includes(gated.line), "a surface that does not allow the gag never hears it");
  // Hours: late night and early morning own their sets.
  assert.ok(NOVA_LATE_LINES.includes(pickEggLine({ hour: 23, allowGag: false, seed: 1, facts: null }, {}, t).line));
  assert.ok(NOVA_LATE_LINES.includes(pickEggLine({ hour: 2, allowGag: false, seed: 0, facts: null }, {}, t).line));
  assert.equal(hourLineSet(23), "late");
  assert.equal(hourLineSet(5), "morning");
  assert.equal(hourLineSet(14), null);
  // The morning denial: if she would repeat the cheerful line she
  // used last, she denies it instead.
  const target = NOVA_MORNING_LINES[0];
  let seed = 0;
  while (pickNovaLine(NOVA_MORNING_LINES, seed) !== target && seed < 50) seed++;
  const deny = pickEggLine({ hour: 7, allowGag: false, seed, facts: null }, { lastEggLine: target }, t);
  assert.equal(deny.line, NOVA_MORNING_DENIAL);
  const fresh = pickEggLine({ hour: 7, allowGag: false, seed, facts: null }, {}, t);
  assert.equal(fresh.line, target, "a first morning pick is the cheerful line itself");
  // Memory outranks the plain set when the facts support a line.
  const facts = { daysKnown: 3, streak: 0, furthest: { title: "The Human Body", pct: 40 }, subjects: null };
  const mem = pickEggLine({ hour: 14, allowGag: false, seed: 3, facts }, {}, t);
  // Expectation moved 2026-10-14 (owner's voice ruling): the
  // furthest along template was rewritten.
  assert.equal(mem.line, "40 percent into The Human Body. Nothing else is close.");
  // Otherwise the plain set, and what she said is remembered.
  const plain = pickEggLine({ hour: 14, allowGag: false, seed: 2, facts: null }, {}, t);
  assert.ok(NOVA_EGG_LINES.includes(plain.line));
  assert.equal(plain.quirks.lastEggLine, plain.line);
});

await test("the lines library obeys her voice rules: no dashes, no AI talk, no mascot talk, exclamations on a budget", () => {
  /* Voice gate update (2026-10-15, the overhaul): the dash
     ban stays absolute, and the self naming bans stand. Two
     rules join them from the new contract. Exclamation is a
     budget, not a ban: at most one in any line, never two,
     and none at all in the poke boundary lines, because a
     boundary is not a celebration. And length is a band, not
     a flat cap: lines may run longer when she is pleased
     with an idea, up to a 175 character ceiling that keeps
     the bubbles readable. The feedback opener banks join
     the library here so they answer to the same rules. */
  const lists = { NOVA_EGG_LINES, NOVA_SUMMON_LINES, NOVA_CELEBRATE_LINES, NOVA_GAG_LINES, NOVA_LATE_LINES, NOVA_MORNING_LINES, NOVA_POKE_LINES, NOVA_FEEDBACK_RIGHT_LINES, NOVA_FEEDBACK_WRONG_LINES };
  const singles = [
    NOVA_MORNING_DENIAL, NOVA_POKE_LINE_THREE, NOVA_POKE_LINE_FIVE, NOVA_SHELF_LINE,
    NOVA_SHELF_FAVORITE_LINE, NOVA_OPINION_HARD_LINE, NOVA_OPINION_FAST_LINE,
    NOVA_OPINION_BROW_LINE, NOVA_OPINION_PERFECT_LINE,
  ];
  const everyLine = [...Object.values(lists).flat(), ...singles];
  assert.ok(everyLine.length >= 20, `the library should hold a real set of lines, found ${everyLine.length}`);
  for (const line of everyLine) {
    assert.equal(typeof line, "string");
    assert.ok(line.length > 0, "an empty line sits in the library");
    assert.ok(!/[-–—]/.test(line), `a dash sits in her line: ${line}`);
    assert.ok(!/\bAI\b/.test(line), `she names herself an AI: ${line}`);
    assert.ok(!/mascot/i.test(line), `she names herself a mascot: ${line}`);
    assert.ok((line.match(/!/g) || []).length <= 1, `more than one exclamation in her line: ${line}`);
    assert.ok(line.length <= 175, `a line outgrew the bubble band at ${line.length} chars: ${line}`);
  }
  for (const line of [...NOVA_POKE_STEP_FIVE, NOVA_POKE_LINE_FIVE]) {
    assert.ok(!line.includes("!"), `an exclamation in a poke boundary line: ${line}`);
  }
  assert.ok(NOVA_FEEDBACK_RIGHT_LINES.length >= 6, "the right answer opener bank is thin");
  assert.ok(NOVA_FEEDBACK_WRONG_LINES.length >= 6, "the wrong answer opener bank is thin");
  assert.equal(QUIRKS_KEY, "cerebrum-learn2-quirks", "the quirks store is its own key");
  saveNovaQuirks({ gagAt: 4242 });
  assert.equal(loadNovaQuirks().gagAt, 4242, "the quirks store should round trip");
  assert.ok(!JSON.stringify(buildCortexExport(cortexFixtureState, new Date())).includes("quirks"),
    "the export carries the quirks store");
});

await test("her feedback teaching: the why is spoken on both outcomes, and a miss is corrected from the card's own fields", () => {
  const { mkQuiz, mkSpotError, mkOrder, mkMatch } = context.__x;
  /* Speech carries no markup: the sheet prints the why
     through RichText, her mouth reads the plain words. */
  assert.equal(plainSpeechText("The **mantle** is _hot_ rock."), "The mantle is hot rock.");
  /* Right answer: the why alone teaches. No correction
     exists to state, and none is invented. */
  const quiz = mkQuiz("What does the mantle do?", ["It stores heat", "It makes light"], 0, "The mantle stores heat and moves it slowly upward.");
  assert.equal(feedbackCorrectionFor(quiz, { good: true, correctText: "It stores heat" }), null);
  assert.equal(feedbackTeachLine(quiz, { good: true, correctText: "It stores heat" }),
    "The mantle stores heat and moves it slowly upward.");
  /* Wrong answer on an option card: the correction names
     the right answer the learner actually saw, then the
     authored why follows as her explanation. */
  const miss = feedbackTeachLine(quiz, { good: false, correctText: "It stores heat" });
  assert.ok(miss.startsWith("The answer was: It stores heat."), `the correction is missing: ${miss}`);
  assert.ok(miss.includes("The mantle stores heat and moves it slowly upward."), "the why did not follow the correction");
  /* Rich text markers in a why never reach her mouth. */
  const marked = mkQuiz("Q?", ["A", "B"], 1, "Heat moves by **conduction** here.");
  assert.equal(feedbackTeachLine(marked, { good: true }), "Heat moves by conduction here.");
  /* Spot the error: the card's fix is the correction. */
  const spot = mkSpotError("Tap the wrong piece.", ["Water", "boils", "at", "fifty", "degrees"], 3, "Water boils at one hundred degrees", "Fifty degrees warms water; it does not boil it.");
  assert.ok(feedbackTeachLine(spot, { good: false }).startsWith("It should say: Water boils at one hundred degrees."),
    "the spot error correction is missing");
  /* Order: the card's items in their true order correct. */
  const order = mkOrder("Put the cycle in order.", ["Rain falls", "Water gathers", "Sun heats the sea"], "Heat drives evaporation first; the rest follows.");
  assert.ok(feedbackTeachLine(order, { good: false }).startsWith("The right order: Rain falls, then Water gathers, then Sun heats the sea."),
    "the order correction is missing");
  /* Match: no single correction exists to state. The sheet
     lands only once every pair stands matched, and the
     pairs are the lesson, so the why alone teaches there.
     Documented fallback (2026-10-15), not an oversight. */
  const match = mkMatch("Match each term.", [["Evaporation", "Water becomes vapor"]], "Pairs stick when the process makes sense.");
  assert.equal(feedbackCorrectionFor(match, { good: false }), null);
  assert.equal(feedbackTeachLine(match, { good: false }), "Pairs stick when the process makes sense.");
  /* A card with nothing to teach earns silence, not invention. */
  assert.equal(feedbackTeachLine({ kind: "quiz", why: "" }, { good: false, correctText: null }), null);
});

await test("the feedback sheet routes her teaching through SheetNova, and the canned sheet quips stand down while she teaches", () => {
  assert.ok(learnSrc.includes("teach={sheetTeach}"), "the Player does not hand SheetNova its teaching");
  assert.ok(learnSrc.includes("feedbackTeachLine(card, {"), "the Player does not compose the teaching from the answered card");
  assert.ok(learnSrc.includes("displayOptions[displayCorrect]"), "the correction is not resolved through the order the learner saw");
  assert.ok(learnSrc.includes("NOVA_FEEDBACK_RIGHT_LINES") && learnSrc.includes("NOVA_FEEDBACK_WRONG_LINES"),
    "SheetNova does not draw her reaction openers from the banks");
  assert.ok(learnSrc.includes("if (teachRef.current) return;"), "the sheet's category quips do not stand down while she teaches");
  assert.ok(learnSrc.includes(">WHY</p>"), "the sheet stopped printing the why as text for rereading");
});

/* Pin added 2026-10-18 (the feedback sheet bubble repair):
   her teaching used to reach the sheet only through
   NovaRive, which rendered every surface's line as a
   floating header bubble centered on the figure's anchor.
   On the sheet that meant a 250px column over the body text,
   extending 94px past the sheet column's left edge and
   clipped there by the sheet scroll box, mid word on every
   line (the owner's photo). The corrected contract: the
   Player owns the sheet controller, SheetNova drives it,
   the sheet figure renders figure only, and the Player
   renders the current line in flow in the sheet body. */
await test("the feedback sheet renders her speech in flow at the sheet column's width, never as a floating header bubble", () => {
  assert.ok(learnSrc.includes("const sheetSpeech = useNovaSpeech();"),
    "the Player does not own the feedback sheet's speech controller");
  assert.ok(learnSrc.includes("teach={sheetTeach} speech={sheetSpeech}"),
    "SheetNova is not handed the Player's controller to drive");
  assert.ok(learnSrc.includes("bubbleVariant={null}"),
    "the sheet figure still renders a bubble from its anchor");
  assert.ok(riveSrc.includes('props.bubbleVariant === undefined ? "header" : props.bubbleVariant'),
    "NovaRive surfaces no longer default to the header bubble");
  assert.ok(riveSrc.includes("speech.current && bubbleVariant &&"),
    "NovaCanvas does not gate its bubble on the surface's chosen variant");
  assert.ok(!riveSrc.includes('variant="header" onDismiss={speech.dismiss}'),
    "NovaCanvas hardcodes the header bubble again");
  // The in flow render itself: a sheet bubble under the
  // verdict, clearing the floated figure, its cap lifted so
  // the sheet column (640px desktop, 316px at 360px) is its
  // full width, no tail protruding past its box, and the
  // full line text as its content, so every word is
  // reachable with no clipping mechanism left.
  assert.ok(learnSrc.includes('<NovaBubble variant="sheet" tail="none" onDismiss={sheetSpeech.dismiss} style={{ maxWidth: "none" }}>'),
    "the sheet does not render her line as a full width in flow sheet bubble");
  assert.ok(learnSrc.includes("sheetSpeech.current.text"),
    "the sheet bubble does not carry the controller's full current line");
  assert.ok(learnSrc.includes('style={{ clear: "both", marginTop: 12, marginBottom: 14 }}'),
    "her sheet bubble does not sit in flow below the floated figure and verdict");
  // The Player's own header figure stays figure only: it
  // takes no speech prop at all, before and after the fix.
  assert.ok(learnSrc.includes('anchorRef={novaAnchorRef} />'),
    "the Player header figure took a speech surface");
});

await test("the quirks are wired where she lives: opinions in the sheet, memory and shelf on Today, the gag in the Library", () => {
  assert.ok(learnSrc.includes("opinionForEvent("), "the quirks engine's opinions are not called");
  assert.ok(learnSrc.includes("face={sheetOpinion ? sheetOpinion.face : null}"), "the sheet Nova does not take the opinion's face");
  assert.ok(learnSrc.includes("computeNovaMemory(profile, builtinProgress)"), "the home does not compute her memory from the real profile");
  assert.ok(learnSrc.includes("shelfCommentFor("), "the shelf does not ask for her comment");
  assert.ok(learnSrc.includes("libraryGagLine || "), "the library tip does not rotate the gag in");
  assert.ok(learnSrc.includes('new CustomEvent("nova-egg-celebrate")'), "finishing a path does not cue the egg's celebration");
});

// ══════════════════════════════════════════════════════════════════
group("Nova's egg: the app wide visits, their trigger, cooldowns, and exclusions");

await test("the egg numbers are the chosen ones: rarity, cooldowns, the tick, the wordmark count", () => {
  assert.equal(EGG_AMBIENT_CHANCE, 0.07, "the ambient roll should be seven in a hundred checks");
  assert.equal(EGG_BASE_COOLDOWN_MS, 8 * 3600 * 1000, "the shared appearance cooldown should be eight hours");
  assert.equal(EGG_LONG_COOLDOWN_MS, 48 * 3600 * 1000, "the post dismissal cooldown should be two days");
  assert.equal(EGG_CELEBRATE_COOLDOWN_MS, 30 * 60 * 1000, "celebrations rest thirty minutes");
  assert.equal(EGG_TICK_MS, 45000, "ambient checks tick every forty five seconds");
  assert.equal(WORDMARK_CLICKS, 3, "the summon is three clicks");
  assert.equal(WORDMARK_GAP_MS, 700, "summon clicks land inside seven hundred milliseconds");
  assert.equal(eggCooldownMs({}), EGG_BASE_COOLDOWN_MS);
  assert.equal(eggCooldownMs({ dismissals: 1 }), EGG_BASE_COOLDOWN_MS, "one dismissal does not stretch the cooldown");
  assert.equal(eggCooldownMs({ dismissals: 2 }), EGG_LONG_COOLDOWN_MS, "two dismissals stretch the cooldown to two days");
  const dismissed = recordEggDismissal(recordEggDismissal({}, 1000), 2000);
  assert.equal(dismissed.dismissals, 2);
  assert.equal(eggCooldownMs(dismissed), EGG_LONG_COOLDOWN_MS);
});

await test("eggEligible enforces the cooldown, the session rules, and every exclusion context", () => {
  const now = 100 * 3600 * 1000;
  const fresh = { hadEgg: false, prevSessionHadEgg: false };
  assert.equal(eggEligible({}, {}, fresh, now), true, "a clear page, a rested store, a fresh session: eligible");
  assert.equal(eggEligible({ lastAt: now - 3600 * 1000 }, {}, fresh, now), false, "inside the eight hours she rests");
  assert.equal(eggEligible({ lastAt: now - 9 * 3600 * 1000 }, {}, fresh, now), true, "after the eight hours she may come");
  assert.equal(eggEligible({ lastAt: now - 10 * 3600 * 1000, dismissals: 2 }, {}, fresh, now), false,
    "a twice dismissed Nova rests two days, not eight hours");
  assert.equal(eggEligible({ lastAt: now - 49 * 3600 * 1000, dismissals: 2 }, {}, fresh, now), true);
  assert.equal(eggEligible({}, {}, { hadEgg: true, prevSessionHadEgg: false }, now), false,
    "one ambient visit per session");
  assert.equal(eggEligible({}, {}, { hadEgg: false, prevSessionHadEgg: true }, now), false,
    "never on consecutive visits: last session had her, this one rests");
  for (const ctx of [{ typing: true }, { inLesson: true }, { inCall: true }, { inCheckout: true }, { hidden: true }])
    assert.equal(eggEligible({}, ctx, fresh, now), false, `an egg should never land in ${JSON.stringify(ctx)}`);
  assert.equal(eggBlocked({ typing: true }), true);
  assert.equal(eggBlocked({}), false);
  // Celebrations answer to their own shorter shared cooldown only.
  assert.equal(eggCelebrateEligible({ lastAt: now - 10 * 60 * 1000 }, {}, now), false, "a celebration inside thirty minutes rests");
  assert.equal(eggCelebrateEligible({ lastAt: now - 31 * 60 * 1000 }, {}, now), true);
  assert.equal(eggCelebrateEligible({}, { inLesson: true }, now), false, "no celebration over a lesson in progress");
});

await test("countWordmarkClick stacks quick clicks, resets on a slow one, and summons on the third", () => {
  let st = { count: 0, lastAt: 0 };
  st = countWordmarkClick(st, 10000);
  assert.equal(st.count, 1);
  assert.equal(st.summoned, false);
  st = countWordmarkClick(st, 10500);
  assert.equal(st.count, 2);
  st = countWordmarkClick(st, 10900);
  assert.equal(st.summoned, true, "the third quick click summons her");
  assert.equal(st.count, 0, "the count restarts after a summon");
  const slow = countWordmarkClick({ count: 2, lastAt: 10000 }, 10000 + WORDMARK_GAP_MS + 1);
  assert.equal(slow.count, 1, "a click after the gap starts the count over");
  assert.equal(slow.summoned, false);
  const edge = countWordmarkClick({ count: 2, lastAt: 10000 }, 10000 + WORDMARK_GAP_MS);
  assert.equal(edge.summoned, true, "a click exactly at the gap still counts");
});

await test("the egg is mounted once in the shell, still under quiet motion, and silent by construction", () => {
  assert.ok(appSrc.includes('import NovaEgg from "./NovaEgg.jsx";'), "the shell does not import the egg");
  assert.ok(appSrc.includes("<NovaEgg />"), "the egg is not mounted in the shell");
  assert.ok(eggSrc.includes("cbMotionOff"), "the egg does not read the app's motion setting");
  assert.ok(eggSrc.includes('window.addEventListener("nova-egg-celebrate"'), "the egg does not listen for path completions");
  assert.ok(eggSrc.includes('aria-label="Back to landing page"'), "the summon does not watch the sidebar brand");
  assert.ok(eggSrc.includes(".cb-stage-masthead"), "the summon does not watch the masthead wordmark");
  assert.ok(eggSrc.includes('".lv-sheet"'), "the lesson exclusion does not probe the lesson sheet");
  // Pin changed 2026-10-15 (rig wave): this pair used to pin the
  // egg's print grade and grain to the avatar's, value for value.
  // The print treatment is retired on both sides; the egg now
  // renders the same NovaRig as the avatar, and neither file
  // carries the filter chain or the grain.
  // Pin changed again 2026-10-15 (the old model purge): the rig
  // itself retired the same day. The egg renders the NovaRive
  // canvas through its EggFigure, the same v3 character as
  // every other surface; the mapping is pinned in the purge
  // test above.
  assert.ok(eggSrc.includes("NovaRive"), "the egg does not render the canvas");
  assert.ok(!eggSrc.includes("NovaRig"), "the egg renders the retired rig");
  assert.ok(!eggSrc.includes("sepia(0.17)"), "the egg still carries the retired print grade");
  assert.ok(!eggSrc.includes("feTurbulence"), "the egg still carries the retired print grain");
  /* 2026-10-18 (design audit M49): the swim and its barrel roll were
     retired on purpose; the pin now holds them gone. */
  assert.ok(!eggSrc.includes("@keyframes neRoll"), "the swim barrel roll is back");
  assert.ok(eggSrc.includes("if (!visit) return null;"), "the egg does not unmount to zero cost when idle");
  assert.ok(!/Audio|playSound|speak\(/.test(eggSrc), "the egg makes noise; it should be silent by construction");
});

await test("no visible Wick survives: the first run eyebrows read Nova and Wick lives only in history comments", () => {
  // Panel 8 fold in (2026-10-14): the rename missed the two highest
  // visibility first run surfaces. User visible strings are zero
  // tolerance; dated history comments may keep the old name.
  // The tour eyebrow lives in NovaTour.jsx since the cutscene
  // redo (2026-10-15); the onboarding eyebrow stays in LearnView.
  assert.ok(tourSrc.includes("HOW NOVA WORKS"), "the tour eyebrow does not read Nova");
  assert.ok(learnSrc.includes("WELCOME TO NOVA"), "the onboarding eyebrow does not read Nova");
  assert.ok(!learnSrc.includes("HOW WICK WORKS"), "the tour eyebrow still reads Wick");
  assert.ok(!learnSrc.includes("WELCOME TO WICK"), "the onboarding eyebrow still reads Wick");
  const stripped = learnSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!stripped.includes("Wick"), "a Wick string survives outside comments");
  assert.ok(!stripped.includes("WICK"), "a WICK string survives outside comments");
});

await test("the home's accent text runs through the shell's accentInk correction", () => {
  // Panel 8 fold in (2026-10-14): raw accent text computed at 1.00
  // to 2.61 to 1 on Light palette grounds. The home's tagline,
  // section labels, and action labels now take ink, the corrected
  // value; fills and borders keep the raw accent.
  // Pin updated 2026-10-16 (layout audit finding 12 landing): the import line now also brings useWindowWidth for the phone aware stage size; the shell correction import itself is unchanged.
  assert.ok(learnSrc.includes('import { accentInk, useWindowWidth } from "./appUtils.js";'), "LearnView does not import the shell correction");
  // Two derivations remain in LearnView (2026-10-15): the tour
  // moved into NovaTour.jsx with the cutscene redo and derives
  // its own ink there, from the same shell correction.
  assert.equal((learnSrc.match(/const ink = accentInk\(P, accent\);/g) || []).length, 2, "the home and onboarding should each derive ink");
  assert.ok(tourSrc.includes("const ink = accentInk(P, accent);"), "the tour does not derive ink from the shell correction");
  const homeRegion = learnSrc.slice(learnSrc.indexOf("export default function LearnView"));
  assert.ok(!homeRegion.includes("color: accent"), "the home still colours text with the raw accent");
  assert.ok(learnSrc.includes('color: ink, margin: "8px 0 0"'), "the header tagline does not take the corrected ink");
});

await test("the share card sets the name as the Orbitron wordmark with the tagline under it", () => {
  // 2026-10-15: owner picked Orbitron 800 for the wordmark,
  // superseding the Panel 8 serif lockup. The tagline stays
  // directly under it in gold sans, above everything else.
  assert.ok(learnSrc.includes(`ctx.font = "800 68px 'Orbitron', 'Inter Tight', sans-serif";`), "the share card name is not set in the Orbitron wordmark");
  assert.ok(!learnSrc.includes(`ctx.font = "600 68px 'Source Serif 4', Georgia, 'Times New Roman', serif";`), "the share card name is still set in the old serif wordmark");
  assert.ok(!learnSrc.includes("600 68px 'Inter Tight'"), "the share card name is still set in a sans");
  assert.ok(
    learnSrc.indexOf('ctx.fillText("Nova", 540, 138)') < learnSrc.indexOf("ctx.fillText(CORTEX_TAGLINE, 540, 188)"),
    "the tagline does not sit under the name on the share card"
  );
});

// ══════════════════════════════════════════════════════════════════
group("Hooks discipline: no hook after a return or inside a branch");

/* Crash fix pin (2026-10-15). LearnView kept five hooks (a useMemo,
   two useState, two useEffect) BELOW its player/path/bpath screen
   returns: they arrived with the quirks wave, after the returns
   already existed. Any render that took an early return skipped
   them, so opening a lesson changed the component's hook count
   and React threw error #300, "rendered fewer hooks than
   expected", on the player's first render. A second instance of
   the class sat in CerebrumApp's VideoFrame, where
   useReducedMotion() was the right operand of || and was skipped
   whenever the OS signal was already true. Both are fixed by
   calling every hook unconditionally; this scan keeps the class
   out of src for good.
   What it catches, per component or custom hook scope: a hook
   call positioned after any return the render path can take
   first (including returns inside if/switch/try/loop statements),
   a hook call inside a conditional branch, a loop, a try block, a
   ternary, or a logical (&&/||) expression, and a hook call
   inside a nested plain function or callback (effect callbacks,
   event handlers) within the scope.
   What it cannot catch: hooks reached through a differently
   named alias (the callee must spell useX or React.useX), a
   component assigned to a lowercase variable and rendered as a
   component, hooks violations that only exist at runtime across
   a higher order wrapper defined elsewhere, and hook calls in
   files outside src. Those remain code review territory. */
const HOOK_NAME_RE = /^use[A-Z0-9]/;
function hookCalleeName(node) {
  if (!node || node.type !== "CallExpression") return null;
  const c = node.callee;
  if (c.type === "Identifier" && HOOK_NAME_RE.test(c.name)) return c.name;
  if (c.type === "MemberExpression" && c.object.type === "Identifier" && c.object.name === "React"
    && c.property.type === "Identifier" && HOOK_NAME_RE.test(c.property.name)) return "React." + c.property.name;
  return null;
}
function hooksScanFile(filePath, srcText, stats) {
  const tree = parse(srcText, { sourceType: "module", plugins: ["jsx"], loc: true });
  const out = [];
  const label = filePath.split("/src/")[1] || filePath;
  const report = (node, hook, scope, flags) =>
    out.push(`${label}:${node.loc.start.line} ${hook} in ${scope} [${flags.join(",")}]`);
  const fnNameOf = (node, parent) => {
    if (node.id && node.id.name) return node.id.name;
    if (parent && parent.type === "VariableDeclarator" && parent.id.type === "Identifier") return parent.id.name;
    if (parent && parent.type === "AssignmentExpression" && parent.left.type === "Identifier") return parent.left.name;
    if (parent && parent.type === "ObjectProperty" && parent.key.type === "Identifier") return parent.key.name;
    return "(anonymous)";
  };
  const isScopeName = (name) => /^[A-Z]/.test(name) || HOOK_NAME_RE.test(name);
  function stmtHasReturn(node) {
    if (!["IfStatement", "SwitchStatement", "TryStatement", "ForStatement", "WhileStatement",
      "DoWhileStatement", "ForInStatement", "ForOfStatement"].includes(node.type)) return false;
    let found = false;
    const visit = (n) => {
      if (!n || typeof n.type !== "string" || found) return;
      if (n.type === "ReturnStatement") { found = true; return; }
      if (/Function|Class/.test(n.type)) return;
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) v.forEach(visit);
        else if (v && typeof v === "object") visit(v);
      }
    };
    visit(node);
    return found;
  }
  function scanPlain(node, ctx, scopeName) {
    if (!node || typeof node.type !== "string") return;
    const hk = hookCalleeName(node);
    if (hk) {
      stats.hooksSeen++;
      report(node, hk, scopeName, ["IN_NESTED_FN(" + scopeName + ")"]);
    }
    if (/Function/.test(node.type) && node.type !== "CallExpression") return;
    const c2 = { ...ctx };
    if (node.type === "IfStatement" || node.type === "ConditionalExpression" || node.type === "LogicalExpression") c2.conditional = true;
    for (const k of Object.keys(node)) {
      if (k === "loc" || k === "range") continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((x) => scanPlain(x, c2, scopeName));
      else if (v && typeof v === "object") scanPlain(v, c2, scopeName);
    }
  }
  function nestedFn(fn, name, ctx, scopeName) {
    if (isScopeName(name)) { analyzeScope(fn, name); return; }
    if (fn.body && fn.body.type === "BlockStatement") for (const s of fn.body.body) scanPlain(s, ctx, name);
    else if (fn.body) scanPlain(fn.body, ctx, name);
  }
  function walkExpr(expr, ctx, scopeName) {
    if (!expr || typeof expr.type !== "string") return;
    const hk = hookCalleeName(expr);
    if (hk) {
      stats.hooksSeen++;
      const flags = [];
      if (ctx.conditional) flags.push("IN_CONDITIONAL");
      if (ctx.loop) flags.push("IN_LOOP");
      if (ctx.afterReturn) flags.push("AFTER_RETURN");
      if (ctx.inTry) flags.push("IN_TRY");
      if (flags.length) report(expr, hk, scopeName, flags);
      for (const arg of expr.arguments) {
        if (arg.type === "ArrowFunctionExpression" || arg.type === "FunctionExpression") nestedFn(arg, "(callback of " + hk + ")", ctx, scopeName);
        else walkExpr(arg, ctx, scopeName);
      }
      return;
    }
    if (expr.type === "ArrowFunctionExpression" || expr.type === "FunctionExpression") { nestedFn(expr, fnNameOf(expr, null), ctx, scopeName); return; }
    if (expr.type === "ConditionalExpression") {
      const c2 = { ...ctx, conditional: true };
      walkExpr(expr.test, ctx, scopeName);
      walkExpr(expr.consequent, c2, scopeName);
      walkExpr(expr.alternate, c2, scopeName);
      return;
    }
    if (expr.type === "LogicalExpression") {
      const c2 = { ...ctx, conditional: true };
      walkExpr(expr.left, ctx, scopeName);
      walkExpr(expr.right, c2, scopeName);
      return;
    }
    for (const k of Object.keys(expr)) {
      if (k === "loc" || k === "range") continue;
      const v = expr[k];
      if (Array.isArray(v)) v.forEach((x) => { if (x && typeof x.type === "string") walkAny(x, ctx, scopeName); });
      else if (v && typeof v === "object" && typeof v.type === "string") walkAny(v, ctx, scopeName);
    }
  }
  function walkStmt(stmt, ctx, scopeName) {
    switch (stmt.type) {
      case "ReturnStatement":
        if (stmt.argument) walkExpr(stmt.argument, ctx, scopeName);
        break;
      case "ExpressionStatement":
        walkExpr(stmt.expression, ctx, scopeName);
        break;
      case "VariableDeclaration":
        for (const d of stmt.declarations) {
          if (!d.init) continue;
          if (d.init.type === "ArrowFunctionExpression" || d.init.type === "FunctionExpression") {
            nestedFn(d.init, d.id.type === "Identifier" ? d.id.name : "(anon)", ctx, scopeName);
          } else walkExpr(d.init, ctx, scopeName);
        }
        break;
      case "IfStatement": {
        walkExpr(stmt.test, ctx, scopeName);
        const c2 = { ...ctx, conditional: true };
        if (stmt.consequent) walkAny(stmt.consequent, c2, scopeName);
        if (stmt.alternate) walkAny(stmt.alternate, c2, scopeName);
        break;
      }
      case "ForStatement": case "ForInStatement": case "ForOfStatement": case "WhileStatement": case "DoWhileStatement": {
        const c2 = { ...ctx, loop: true, conditional: true };
        if (stmt.type === "ForStatement") {
          if (stmt.init) walkAny(stmt.init, c2, scopeName);
          if (stmt.test) walkExpr(stmt.test, c2, scopeName);
          if (stmt.update) walkExpr(stmt.update, c2, scopeName);
        }
        if (stmt.type === "WhileStatement" || stmt.type === "DoWhileStatement") walkExpr(stmt.test, c2, scopeName);
        if (stmt.type === "ForInStatement" || stmt.type === "ForOfStatement") { walkAny(stmt.left, c2, scopeName); walkExpr(stmt.right, c2, scopeName); }
        walkAny(stmt.body, c2, scopeName);
        break;
      }
      case "TryStatement": {
        const c2 = { ...ctx, inTry: true, conditional: true };
        walkBlock(stmt.block, c2, scopeName);
        if (stmt.handler) walkBlock(stmt.handler.body, c2, scopeName);
        if (stmt.finalizer) walkBlock(stmt.finalizer, ctx, scopeName);
        break;
      }
      case "SwitchStatement": {
        walkExpr(stmt.discriminant, ctx, scopeName);
        const c2 = { ...ctx, conditional: true };
        for (const cs of stmt.cases) for (const s of cs.consequent) walkStmt(s, c2, scopeName);
        break;
      }
      case "BlockStatement":
        walkBlock(stmt, ctx, scopeName);
        break;
      case "FunctionDeclaration":
        nestedFn(stmt, stmt.id ? stmt.id.name : "(anon)", ctx, scopeName);
        break;
      default:
        if (stmt.type !== "ThrowStatement" && !/^(Break|Continue|Empty|Debugger)Statement$/.test(stmt.type)) walkAny(stmt, ctx, scopeName);
    }
  }
  function walkBlock(block, ctx, scopeName) {
    let local = { ...ctx };
    for (const stmt of block.body) {
      walkStmt(stmt, local, scopeName);
      if (stmt.type === "ReturnStatement" || stmtHasReturn(stmt)) local = { ...local, afterReturn: true };
    }
  }
  function walkAny(node, ctx, scopeName) {
    if (!node) return;
    if (node.type === "BlockStatement") return walkBlock(node, ctx, scopeName);
    if (node.type && node.type.endsWith("Statement")) return walkStmt(node, ctx, scopeName);
    return walkExpr(node, ctx, scopeName);
  }
  function analyzeScope(fn, name) {
    stats.scopesSeen++;
    if (!fn.body) return;
    if (fn.body.type !== "BlockStatement") { walkExpr(fn.body, {}, name); return; }
    walkBlock(fn.body, {}, name);
  }
  const visit = (node, parent) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
      const name = fnNameOf(node, parent);
      if (isScopeName(name)) { analyzeScope(node, name); return; }
    }
    for (const k of Object.keys(node)) {
      if (k === "loc" || k === "range") continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((x) => visit(x, node));
      else if (v && typeof v === "object") visit(v, node);
    }
  };
  visit(tree.program, null);
  return out;
}
function srcClientFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...srcClientFiles(p));
    else if (/\.jsx?$/.test(entry.name)) out.push(p);
  }
  return out.sort();
}

await test("no hook in src sits after an early return, in a branch or loop, in a logical operand, or in a nested plain function", () => {
  const stats = { hooksSeen: 0, scopesSeen: 0 };
  const findings = [];
  for (const file of srcClientFiles(join(root, "src"))) {
    findings.push(...hooksScanFile(file, readFileSync(file, "utf8"), stats));
  }
  /* The floors keep the pin honest: if the scan ever silently
     stops seeing the codebase (a parser change, a walker bug),
     these fail instead of the scan passing on nothing. */
  assert.ok(stats.scopesSeen > 100, `scan saw only ${stats.scopesSeen} component or hook scopes`);
  assert.ok(stats.hooksSeen > 400, `scan saw only ${stats.hooksSeen} hook calls`);
  assert.deepEqual(findings, [], "hooks discipline violations:\n" + findings.join("\n"));
});

await test("LearnView's screen returns all sit below its last hook", () => {
  /* The named regression, pinned by position as well as by the
     class scan above: the player return that crashed must stay
     under every hook the component calls. */
  const learnFnStart = learnSrc.indexOf("export default function LearnView");
  const region = learnSrc.slice(learnFnStart);
  const playerReturn = region.indexOf('if (screen.name === "player")');
  assert.ok(playerReturn > 0, "player screen return missing");
  const hookIdx = [...region.matchAll(/\buse(State|Effect|Memo|Ref|Callback|Context)\s*\(/g)]
    .map((m) => m.index);
  const lastHookBeforeReturn = Math.max(...hookIdx.filter((i) => i < playerReturn));
  assert.ok(lastHookBeforeReturn > 0, "no hooks found before the player return");
  assert.ok(!/\buse(State|Effect|Memo|Ref|Callback|Context)\s*\(/.test(region.slice(playerReturn, region.indexOf('if (screen.name === "payoff")'))),
    "a hook still sits between the player return and the payoff return");
});

// ─═════════════════════════════════════════════════════════════════
group("Nova in Rive: the input contract, the quip bank, the wiring");

/* The Rive rebuild's code side (2026-10-15). The .riv art asset
   is authored in the Rive editor later; these pins hold the
   contract it will be authored against, the quip bank and its
   voice rules, the state mappings the integrations use, and the
   fallback that keeps the shipped rig on screen until the
   asset exists at public/nova/nova.riv. */

await test("the state machine contract is the one the editor build is authored against", () => {
  assert.equal(NOVA_RIVE_STATE_MACHINE, "Nova_Controller");
  assert.deepEqual([...NOVA_RIVE_INPUTS.numbers], ["quizState", "appState", "mouseX", "mouseY"]);
  assert.deepEqual([...NOVA_RIVE_INPUTS.booleans], ["isTalking", "reducedMotion"]);
  assert.deepEqual([...NOVA_RIVE_INPUTS.triggers], ["poke", "celebrate", "sleep", "wake"]);
  for (const ev of ["EmitIdleQuip", "EmitQuizQuip", "EmitSearchQuip"]) {
    assert.ok(NOVA_RIVE_EVENTS.includes(ev), ev + " missing from the event contract");
  }
  assert.equal(NOVA_RIVE_SRC, "/nova/nova.riv");
});

/* Pin updated 2026-10-15: the asset landed at public/nova/nova.riv,
   so this test now holds the shipped contract instead of the
   pre asset one. The switch carries the asset path, the canvas
   surface is live, and the fallback branch stays in the code
   for any caller that ever needs it again.
   Pin updated again 2026-10-15 (the old model purge): the
   fallback branch did not stay. The owner saw the traced rig
   still rendering on the surfaces that had not switched and
   ordered the old model gone, so the wrapper renders the
   canvas directly and the fallback surface is deleted. */
await test("the asset has landed: the one switch points at the shipped .riv", () => {
  assert.equal(NOVA_RIVE_ASSET, "/nova/nova.riv", "the asset switch must carry the shipped asset path");
  assert.ok(riveSrc.includes("return <NovaCanvas {...props} />;"), "the wrapper must render the canvas directly");
  assert.ok(!riveSrc.includes("NovaFallback"), "the retired fallback surface is back");
  assert.ok(!riveSrc.includes("<NovaAvatar"), "the canvas file still renders the retired avatar");
  assert.ok(riveSrc.includes("stateMachines: NOVA_RIVE_STATE_MACHINE"), "the canvas must run the contract state machine");
  assert.ok(riveSrc.includes("useStateMachineInput"), "the canvas must bind the contract inputs");
  assert.ok(riveSrc.includes("EventType.RiveEvent"), "the canvas must listen for Rive quip events");
});

/* Regression pin for the dead canvas of 2026-10-15. The asset
   shipped and served, the brain set its data attributes, clicks
   registered, and the canvas still never painted: the
   @rive-app/canvas RuntimeLoader defaults to fetching its wasm
   from unpkg (fallback jsDelivr), and the site CSP connect-src
   allows only 'self' plus two API origins, so the runtime never
   initialized and the canvas stayed 0x0. The fix self hosts the
   wasm from the installed package. These assertions fail if the
   loader is ever left at its CDN defaults again. */
await test("the Rive runtime wasm is self hosted, never fetched from a CDN", () => {
  assert.ok(riveSrc.includes("RuntimeLoader.setWasmUrl("), "NovaRive must pin the runtime to a local wasm URL");
  assert.ok(riveSrc.includes("@rive-app/canvas/rive.wasm?url"), "the primary wasm must be the one bundled from the installed @rive-app/canvas package");
  assert.ok(riveSrc.includes("RuntimeLoader.setWasmFallbackUrl("), "the fallback wasm must be pinned locally too, or a primary failure retries against the CDN");
  assert.ok(riveSrc.includes("@rive-app/canvas/rive_fallback.wasm?url"), "the fallback wasm must be the one bundled from the installed package");
  assert.ok(!riveSrc.includes("unpkg.com"), "no unpkg reference may creep into the Rive wiring");
  assert.ok(!riveSrc.includes("cdn.jsdelivr.net"), "no jsDelivr reference may creep into the Rive wiring");
  assert.ok(
    existsSync(join(root, "node_modules/@rive-app/canvas/rive.wasm")),
    "the installed @rive-app/canvas package must ship rive.wasm at the imported path"
  );
  assert.ok(
    existsSync(join(root, "node_modules/@rive-app/canvas/rive_fallback.wasm")),
    "the installed @rive-app/canvas package must ship rive_fallback.wasm at the imported path"
  );
  /* When a build exists on disk, the emitted bundle must carry
     the local wasm assets the loader will request. Skipped when
     dist is absent (a bare test run before any build). */
  const distAssets = join(root, "dist/assets");
  if (existsSync(distAssets)) {
    const emitted = readdirSync(distAssets).filter((f) => /^rive.*\.wasm$/i.test(f));
    assert.ok(emitted.length >= 1, "dist/assets must contain the emitted Rive wasm asset");
  }
});

/* The stage contract (2026-10-15, the owner's verdicts on the
   first live Rive build: "She's blurry and too small" and
   "Make her a better home"). The shipped asset is a full body
   figure on a square artboard; the old bust box (size * 1.85
   by 0.62, cut for the traced bust rig) letterboxed her into
   about 59 CSS px in the 66px header, and at that size her
   detail reads soft on a retina phone no matter the backing
   store. She now stands on a stage at the top of Today at
   full body size, the canvas has a full framing beside the
   bust, and the runtime's drawing surface is synced to the
   device pixel ratio (the React wrapper multiplies the
   canvas attributes but never sets the instance's
   devicePixelRatioUsed for non Layout fits; the runtime's own
   consumer method, resizeDrawingSurfaceToCanvas, is what
   records it). These pins hold all three parts. */
await test("her stage: full body framing on Today, a DPR synced canvas, the shelf on the stage", () => {
  // Pin updated 2026-10-16 (layout audit finding 12): the stage
  // size is now phone aware, 264 at widths up to 430px where 288
  // squeezed sideways, and 288 above them.
  assert.ok(learnSrc.includes('<NovaLive state={novaMood} size={stageNarrow ? 264 : 288} framing="full" />'), "the Today stage does not mount her large and full body");
  assert.ok(learnSrc.indexOf("NOVA'S SHELF") < learnSrc.indexOf("Due for review"), "the shelf is not on the stage above the review bench");
  assert.ok(riveSrc.includes('framing === "full" || framing === "panel"'), "the canvas has no full body framing");
  assert.ok(riveSrc.includes("Math.round(size * 1.85)"), "the bust box changed under the small spots");
  assert.ok(riveSrc.includes("useDevicePixelRatio: true"), "the canvas does not pin the device pixel ratio option");
  assert.ok(riveSrc.includes("resizeDrawingSurfaceToCanvas"), "the canvas never syncs its drawing surface to the device pixel ratio");
  // Pin replaced 2026-10-15 (the old model purge): this slot
  // pinned the fallback surface mapping "full" onto the
  // avatar's "panel" framing. The fallback is deleted; the
  // canvas itself treats "panel" as full, pinned two lines
  // above, and the old mapping string stays gone.
  assert.ok(!riveSrc.includes('framing === "full" ? "panel" : framing'), "the retired fallback framing mapping is back");
});

await test("the quip bank holds all nine categories, dash free, exclamations on a budget", () => {
  /* Gate change (2026-10-15, the voice overhaul, owner's
     order after the robot verdict): the old pins helped
     cause the problem. The flat 130 character cap and the
     outright exclamation ban forced every line into the same
     clipped shape. The new contract: the dash ban stays
     absolute; exclamation becomes a budget (at most one per
     line, never doubled, and rare across the whole bank,
     eight lines at most); and length becomes a band with a
     175 character ceiling, room for a longer sentence when
     an idea pleases her while the bubbles stay readable. */
  const cats = ["idle", "fourthWall", "searching", "preprintWarning", "highConfidence",
    "quizThinking", "quizCorrect", "quizStreak", "quizWrong"];
  assert.deepEqual(Object.keys(NOVA_QUIP_BANK).sort(), cats.slice().sort());
  let bangLines = 0;
  for (const c of cats) {
    assert.ok(Array.isArray(NOVA_QUIP_BANK[c]) && NOVA_QUIP_BANK[c].length >= 1, c + " is empty");
    for (const line of NOVA_QUIP_BANK[c]) {
      assert.ok(!/[-–—]/.test(line), `${c} line carries a dash: ${line}`);
      const bangs = (line.match(/!/g) || []).length;
      assert.ok(bangs <= 1, `${c} line carries more than one exclamation: ${line}`);
      if (bangs) bangLines++;
      assert.ok(line.length <= 175, `${c} line runs past the band at ${line.length} chars: ${line}`);
    }
  }
  assert.ok(bangLines <= 8, `exclamations stopped being rare across the bank: ${bangLines} lines carry one`);
});

await test("state to category mapping: quiz states and app states", () => {
  assert.equal(quizCategoryForState(1), "quizThinking");
  assert.equal(quizCategoryForState(3), "quizCorrect");
  assert.equal(quizCategoryForState(4), "quizWrong");
  assert.equal(quizCategoryForState(5), "quizStreak");
  assert.equal(quizCategoryForState(0), null);
  assert.equal(quizCategoryForState(2), null, "suspense itself stays silent; the lines ride transitions");
  assert.equal(searchCategoryForState(1), "searching");
  assert.equal(searchCategoryForState(2), "highConfidence");
  assert.equal(searchCategoryForState(3), "preprintWarning");
  assert.equal(searchCategoryForState(0), null);
});

await test("rive events draw from the matching category, with honest fallbacks", () => {
  assert.equal(quipCategoryForRiveEvent("EmitQuizQuip", { quizState: 4 }), "quizWrong");
  assert.equal(quipCategoryForRiveEvent("EmitQuizQuip", { quizState: 5 }), "quizStreak");
  assert.equal(quipCategoryForRiveEvent("EmitQuizQuip", { quizState: 0 }), "quizThinking");
  assert.equal(quipCategoryForRiveEvent("EmitSearchQuip", { appState: 3 }), "preprintWarning");
  assert.equal(quipCategoryForRiveEvent("EmitSearchQuip", { appState: 0 }), "searching");
  assert.equal(quipCategoryForRiveEvent("EmitIdleQuip", { idleMs: 5000 }), "idle");
  assert.equal(quipCategoryForRiveEvent("EmitIdleQuip", { idleMs: QUIP_LONG_IDLE_MS }), "fourthWall");
  assert.equal(quipCategoryForRiveEvent("EmitSomethingElse", {}), null);
});

await test("brain and sheet mapping: activity and phases land on the contract", () => {
  assert.equal(appStateForActivity("thinking"), 1);
  assert.equal(appStateForActivity("pleased"), 2);
  assert.equal(appStateForActivity("deadpan"), 3);
  assert.equal(appStateForActivity(null), 0);
  assert.equal(appStateForActivity("greeting"), 0, "a plain mood is not an app state");
  assert.equal(quizStateForSheet({ phase: 0 }), 1);
  assert.equal(quizStateForSheet({ phase: 0, hover: true }), 2);
  assert.equal(quizStateForSheet({ phase: 1, good: true, correctStreak: 2 }), 3);
  assert.equal(quizStateForSheet({ phase: 1, good: true, correctStreak: 3 }), 5);
  assert.equal(quizStateForSheet({ phase: 1, good: true, correctStreak: 7 }), 5);
  assert.equal(quizStateForSheet({ phase: 1, good: false }), 4);
  assert.equal(quizStateForSheet({ phase: 2, good: true }), 1);
});

await test("the joystick feed normalizes to minus 100 to 100 and clamps at the edges", () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 };
  const at = (x, y, r) => { const p = quizPointerFor(x, y, r); return [p.x, p.y]; };
  assert.deepEqual(at(200, 100, rect), [0, 0]);
  assert.deepEqual(at(300, 150, rect), [50, 50]);
  assert.deepEqual(at(-500, 900, rect), [-100, 100]);
  assert.deepEqual(at(0, 0, null), [0, 0]);
});

await test("the quip gate keeps her mostly silent", () => {
  const base = { now: 10000000, lastGlobalAt: 0, lastCategoryAt: 0, category: "idle", typing: false, busy: false, roll: 0 };
  assert.equal(quipGateAllows(base), true, "a clean, cooled down offer may speak");
  assert.equal(quipGateAllows({ ...base, typing: true }), false, "never while the learner is typing");
  assert.equal(quipGateAllows({ ...base, busy: true }), false, "never over another line");
  assert.equal(quipGateAllows({ ...base, now: QUIP_MIN_GAP_MS - 1 }), false, "the global gap binds");
  assert.equal(quipGateAllows({ ...base, lastCategoryAt: base.now - 1000 }), false, "the category cooldown binds");
  assert.equal(quipGateAllows({ ...base, roll: 0.99 }), false, "the chance roll can still say no");
  assert.equal(quipGateAllows({ ...base, category: "nonsense" }), false, "an unknown category never speaks");
  assert.equal(quipGateAllows({ ...base, category: null }), false);
});

await test("line picking stays inside the category and avoids an immediate repeat", () => {
  for (const c of Object.keys(NOVA_QUIP_BANK)) {
    assert.ok(NOVA_QUIP_BANK[c].includes(pickQuipLine(c, 12345)), c);
  }
  const first = pickQuipLine("searching", 0);
  assert.notEqual(pickQuipLine("searching", 0, first), first);
  assert.equal(pickQuipLine("nonsense", 0), null);
});

await test("her silence is priced in: praise is the rarest category, warnings the least rare", () => {
  assert.ok(QUIP_CATEGORY_CHANCE.highConfidence < QUIP_CATEGORY_CHANCE.searching, "she is not a cheerleader");
  assert.ok(QUIP_CATEGORY_CHANCE.preprintWarning > QUIP_CATEGORY_CHANCE.highConfidence, "a warning is useful; praise is not");
  assert.ok(QUIP_MIN_GAP_MS >= 60000, "no two quips land within a minute");
  /* Pin moved 2026-10-15 (the speech unification): QUIP_SHOW_MS
     retired with the quip engine it timed. Display time is
     priced by the speech controller now, as reading time
     clamped between SPEECH_DISPLAY_MIN_MS and
     SPEECH_DISPLAY_MAX_MS in src/NovaSpeech.jsx; the retired
     constant must not come back. */
  assert.ok(!riveSrc.includes("const QUIP_SHOW_MS"), "the retired fixed quip duration is back");
  assert.ok(speechSrc.includes("SPEECH_DISPLAY_MIN_MS = 2400") && speechSrc.includes("SPEECH_DISPLAY_MAX_MS = 9000"), "the speech controller no longer prices display time by reading time");
});

await test("NovaLive and SheetNova render NovaRive behind their existing props", () => {
  assert.ok(learnSrc.includes("<NovaRive state={shownState}"), "NovaLive must render NovaRive");
  assert.ok(learnSrc.includes("appState={appStateForActivity(activityState)}"), "NovaLive must map activity onto appState");
  assert.ok(learnSrc.includes("sleepStage={sleepStage}"), "NovaLive must feed the brain sleep stage");
  assert.ok(learnSrc.includes("<NovaRive state={shown}"), "SheetNova must render NovaRive");
  assert.ok(learnSrc.includes("quizStateForSheet({ phase, good, correctStreak"), "SheetNova must map its phases onto quizState");
  // Pin replaced 2026-10-15 (the old model purge): this slot
  // pinned the avatar's export for the NovaRive fallback. The
  // fallback and the avatar are both deleted; the absence is
  // the pin now.
  assert.ok(!learnSrc.includes("export function NovaAvatar"), "the retired avatar export is back");
});

await test("the Player wires option hover and focus into the quiz feed", () => {
  // Threshold corrected 2026-10-15: the floor was 4 while the
  // claim battle buttons were one of the wired surfaces. The
  // battle kind was retired outright that day (papers out of
  // lessons, permanently), leaving 3 wired option surfaces.
  const hovers = (learnSrc.match(/onMouseEnter=\{quizHoverStart\}/g) || []).length;
  assert.ok(hovers >= 3, `expected the hover wiring on at least 3 option surfaces, found ${hovers}`);
  const focuses = (learnSrc.match(/onFocus=\{quizHoverStart\}/g) || []).length;
  assert.ok(focuses >= 3, `expected the focus wiring on at least 3 option surfaces, found ${focuses}`);
  assert.ok(learnSrc.includes("correctStreak={rightStreak}"), "SheetNova must receive the correct streak");
  assert.ok(learnSrc.includes("quizFeed={quizFeed}"), "SheetNova must receive the quiz feed");
  // Pin corrected 2026-10-15 (audit fix 3): the pointer anchor is
  // registered by the header Nova now, because she is mounted for
  // the whole lesson; SheetNova no longer owns the anchor.
  assert.ok(learnSrc.includes("anchorRef={novaAnchorRef}"), "a mounted Nova must register her box as the pointer anchor");
});

// ══════════════════════════════════════════════════════════════════════════
group("Audit fixes (2026-10-15): the live Nova audit, fixed in LearnView");

await test("the lesson actions clear the mobile bottom bar at mobile widths only", () => {
  const mobile = learnSrc.slice(learnSrc.indexOf("@media (max-width: 899px)"), learnSrc.indexOf("@media (max-width: 899px)") + 700);
  assert.ok(mobile.includes(".lv-actionbar") && mobile.includes("72px + env(safe-area-inset-bottom"), "the action bar carries no tab bar clearance");
  assert.ok(mobile.includes(".lv-sheet"), "the feedback sheet carries no tab bar clearance");
  assert.ok(mobile.includes(".lv-screen"), "the Player full screens carry no tab bar clearance");
  assert.ok(learnSrc.includes('className="lv-actionbar"'), "the action bar does not wear the clearance class");
  assert.ok((learnSrc.match(/className="lv-screen"/g) || []).length >= 3, "the intro, done, and course complete screens must all wear the clearance class");
});

await test("answer options shift their border to the accent on a real pointer hover", () => {
  assert.ok(learnSrc.includes("@media (hover: hover) and (pointer: fine)"), "the hover rule is not gated to pointer devices");
  assert.ok(learnSrc.includes("border-color: var(--lv-accent, #C4A35A) !important"), "the hover rule does not move the border to the accent");
  assert.ok((learnSrc.match(/"--lv-accent": accent/g) || []).length >= 5, "the surface roots must hand the accent to the stylesheet");
});

await test("Nova stands on the lesson complete screen, pleased, with a line from her library", () => {
  const done = learnSrc.slice(learnSrc.indexOf("if (showLessonDone)"), learnSrc.indexOf("const cardKindLabel"));
  /* Pin moved 2026-10-15 (the speech unification): the
     completion screen renders LessonDoneNova, which owns the
     speech controller for the screen and renders the NovaRive
     itself, so the figure's props are pinned on its definition
     and the screen is pinned on mounting it with the line. */
  assert.ok(done.includes("<LessonDoneNova"), "the completion screen renders no Nova");
  assert.ok(done.includes("perfectLine || doneLine"), "no completion line is drawn");
  const doneNova = learnSrc.slice(learnSrc.indexOf("function LessonDoneNova"), learnSrc.indexOf("function LessonDoneNova") + 1200);
  assert.ok(doneNova.includes("<NovaRive"), "LessonDoneNova renders no NovaRive");
  assert.ok(doneNova.includes('state="pleased"'), "she is not pleased on the completion screen");
  assert.ok(doneNova.includes("celebrateN={1}"), "the celebrate trigger is not raised for the asset");
  assert.ok(doneNova.includes('say({ source: "lesson", text: line })'), "the completion line is not spoken through the controller");
  assert.ok(Array.isArray(NOVA_LESSON_DONE_LINES) && NOVA_LESSON_DONE_LINES.length >= 3, "the completion lines are missing from her library");
  for (const line of NOVA_LESSON_DONE_LINES) {
    assert.ok(!/[-–—]/.test(line), `a completion line carries a dash: ${line}`);
    assert.ok(!line.includes("!"), `a completion line exclaims: ${line}`);
  }
  assert.ok(NOVA_LESSON_DONE_LINES.includes(pickNovaLine(NOVA_LESSON_DONE_LINES, 7)), "pickNovaLine does not serve the completion lines");
});

await test("Nova is mounted in the lesson header for the whole lesson, with the streak beside her", () => {
  const play = learnSrc.slice(learnSrc.indexOf("top bar: close, segmented course progress"));
  assert.ok(play.includes("<NovaRive"), "the play screen header mounts no Nova");
  assert.ok(play.includes("anchorRef={novaAnchorRef}"), "the header Nova does not own the gaze anchor");
  assert.ok(play.includes('rightStreak >= 2 ? " · " + rightStreak + " IN A ROW"'), "the streak does not show from two in a row");
  // Pin moved 2026-10-15 (owner's one Nova per screen ruling):
  // while the feedback sheet is open she is in the sheet, so
  // the header mount now renders only when no verdict is up,
  // in the unanswered phase; the verdict quizState belongs to
  // the sheet's Nova alone.
  assert.ok(play.includes("{!checked && ("), "the header Nova does not step aside while the sheet is open");
  assert.ok(play.includes("quizStateForSheet({ phase: 0, good: false,"), "the header Nova does not take the unanswered phase mapping");
});

await test("a miss sheet states the answer before the why", () => {
  const sheetStart = learnSrc.indexOf("const sheet = checked ? (");
  const sheet = learnSrc.slice(sheetStart, learnSrc.indexOf("return shell(", sheetStart));
  assert.ok((sheet.match(/WHAT ACTUALLY HAPPENS/g) || []).length >= 2, "the recap section exists only for predict cards");
  assert.ok(sheet.includes("displayOptions[displayCorrect]"), "the miss recap is not drawn from the card's own options");
  assert.ok(sheet.includes("!isRight && displayOptions"), "the miss recap is not gated to misses");
});

await test("the miss review re teaches before it re asks", () => {
  assert.ok(learnSrc.includes("const [reviewRecap, setReviewRecap] = useState(null)"), "no recap state");
  assert.ok(learnSrc.includes("setReviewRecap(cards)"), "starting the review does not arm the recap");
  const recap = learnSrc.slice(learnSrc.indexOf("if (reviewRecap)"), learnSrc.indexOf("const cardKindLabel"));
  assert.ok(recap.includes("The ideas first"), "the recap screen has no teaching heading");
  assert.ok(recap.includes("Try it again"), "the recap screen has no way into the questions");
  assert.ok(recap.includes('{"The idea: "}'), "the recap does not restate each missed idea");
  assert.ok(recap.includes('c.items.join(", then ")'), "the recap omits the right order for order cards");
});

await test("path pace is computed from the real curriculum, never authored", () => {
  for (const path of [...LEARNING_PATHS, ...TOPIC_COURSES]) {
    const pace = pathPaceFor(path);
    const flat = flattenPathLessons(path);
    const cards = flat.reduce((n, l) => n + l.cards.length, 0);
    const questions = flat.reduce((n, l) => n + l.cards.filter(isInteractiveCard).length, 0);
    assert.equal(pace.lessons, flat.length, `${path.id}: lesson count is not the path's own`);
    assert.equal(pace.questions, questions, `${path.id}: question count is not recounted from the cards`);
    assert.equal(pace.minutes, Math.max(1, Math.round(cards * 0.4)), `${path.id}: minutes are not the stated per card rate`);
    assert.ok(["Gentle", "Steady", "Demanding"].includes(pace.word), `${path.id}: unknown pace word ${pace.word}`);
  }
  const body = pathPaceFor(LEARNING_PATHS.find((p) => p.id === "the-human-body"));
  const science = pathPaceFor(LEARNING_PATHS.find((p) => p.id === "how-science-works"));
  assert.equal(body.word, "Demanding", "the 235 question path should read Demanding");
  assert.equal(science.word, "Gentle", "the 24 question path should read Gentle");
  assert.ok(body.minutes > science.minutes * 5, "the long path's estimate should dwarf the short one's");
  /* 2026-10-18 (design audit M46): the Paths tab is an index now and
     carries no pace line; pace is pinned on the path view header
     by the next assertion. */
  assert.ok(learnSrc.includes("about {pace.minutes} min · {pace.word}"), "the path view header does not show the pace");
});

await test("finished paths read as finished, and locked lessons name their key on the paths tab", () => {
  assert.ok(learnSrc.includes('"Finished · all " + pp.total + " lessons done'), "the path view still counts a finished path like an unfinished one");
  /* 2026-10-18 (design audit M46): locked lessons name their key in the
     path detail view, in plain words. */
  assert.ok(learnSrc.includes('"Finish the lesson before this one to unlock it"'), "a locked lesson in the path view does not say what unlocks it");
});

await test("the checkpoint intro states the real rules", () => {
  const intro = learnSrc.slice(learnSrc.indexOf("if (showIntro)"), learnSrc.indexOf("if (showLessonDone)"));
  assert.ok(intro.includes("CHECKPOINT RULES"), "checkpoint lessons open with no rules");
  assert.ok(intro.includes("Finishing counts, whatever your score"), "the rules do not say finishing counts at any score");
  assert.ok(intro.includes("lesson.cards.filter(isInteractiveCard).length"), "the question count is not counted from the lesson");
  assert.ok(intro.includes("MASTERY_MIN_PCT"), "the rules do not name the real mastery bar");
  assert.ok(intro.includes("You can play it again whenever you like"), "the rules do not say retries are allowed");
});

await test("the provenance note names the subject it covers", () => {
  assert.ok(learnSrc.includes('"Written for Nova from standard textbook material covering " + path.title'), "the path view note is not specific");
  assert.ok(learnSrc.includes('"Written for Nova from standard textbook material covering " + course.title'), "the lesson intro note is not specific");
});

await test("the tour introduces Nova herself in its opening step", () => {
  assert.ok(TOUR_STEPS[0].body.includes("Nova"), "the opening step never names her");
  assert.ok(TOUR_STEPS[0].body.includes("axolotl"), "the opening step never says what she is");
  assert.ok(TOUR_STEPS[0].body.includes("hard to impress"), "the opening step never gives her temperament");
});

await test("the leagues closed state reads intentional, with the meantime named", () => {
  const leagues = learnSrc.slice(learnSrc.indexOf('homeTab === "leagues"'), learnSrc.indexOf('homeTab === "paths"'));
  assert.ok(leagues.includes("so the board stays shut"), "the closed state gives no reason");
  assert.ok(leagues.includes("nobody to rank you against"), "the closed state does not say why it is shut");
  assert.ok(leagues.includes("League points come from lessons and reviews"), "the closed state does not name the meantime work");
  assert.ok(!leagues.includes("Leagues are not open yet"), "the dead tab wording is still there");
});

await test("one Nova per screen: exactly one resident figure on every home screen", () => {
  // The owner's ruling (2026-10-15, with a photo of Today):
  // "There's too many Novas on this one page." He counted four
  // on Today alone: the header, the bench, the tip companion,
  // and the shelf. Every figure but the header's is gone now.
  // Pin updated 2026-10-15 (the stage move, the owner's
  // verdicts "She's blurry and too small" and "Make her a
  // better home"): the header mount now renders only when the
  // Today tab is not showing, and a third mount, the stage,
  // renders only on Today. The source count is 3; at runtime
  // every home screen still carries exactly one resident
  // figure, which is what this test exists to hold.
  // Pin updated again 2026-10-15 (the speech unification):
  // the third mount lived inside LearnView's private
  // NovaSpeech bubble component, which retired; its speeches
  // are NovaBubble text now and grow no figure at all. The
  // source count is 2, the header and the Today stage, and
  // the runtime rule this test exists to hold is unchanged.
  const mounts = learnSrc.match(/<NovaLive/g) || [];
  assert.equal(mounts.length, 2, "NovaLive mounts beyond the header and the Today stage");
  assert.ok(learnSrc.includes("<NovaLive state={novaMood} size={66} />"), "the header resident is gone");
  assert.ok(learnSrc.includes('homeTab !== "today"'), "the header resident no longer steps aside on Today");
  for (const gone of [
    'state="fading" size={54}',            // the review bench greeter
    'state="asleep" size={72}',            // the shelf's standing figure
    'state="asleep" size={120}',           // the library empty state figure
    '<NovaAvatar state="pleased" size={44} />', // the quest cheer figure
  ]) {
    assert.ok(!learnSrc.includes(gone), `a removed figure is back: ${gone}`);
  }
  // Speech on the home is text only: every placed tip and both
  // standing speeches render bare, so no companion figure rides
  // beside the header Nova. The streak tip in the lesson sheet
  // is bare too: the sheet's own Nova is that screen's one.
  for (const bareSite of [
    '<NovaTip id="today" bare', '<NovaTip id="memory" bare', '<NovaTip id="bench" bare',
    '<NovaTip id="shelf" bare', '<NovaTip id="shop" bare', '<NovaTip id="leagues" bare',
    '<NovaTip id="paths" bare', '<NovaTip id="library" bare', '<NovaTip id="create" bare',
    '<NovaTip id="streak" bare',
    // The two standing speeches (pin moved 2026-10-15, the
    // speech unification): NovaBubble sheet bubbles now, the
    // return greeting keyed on its review count, the reminder
    // carrying its title as the bubble's first child.
    '<NovaBubble variant="sheet">{reviewDueCount > 0',
    '{reminder.title}</span>',
  ]) {
    assert.ok(learnSrc.includes(bareSite), `a speech surface kept its companion figure: ${bareSite}`);
  }
  // The shelf keeps its objects and its empty line, figure free.
  const shelf = learnSrc.slice(learnSrc.indexOf("NOVA'S SHELF"), learnSrc.indexOf("NOVA'S SHELF") + 1600);
  assert.ok(shelf.includes("ShelfObjectMark"), "the shelf lost its objects with her figure");
  assert.ok(shelf.includes("Nothing on the shelf yet"), "the shelf's empty line went with her figure");
  // In the Player the header Nova steps aside while the sheet
  // is open, so exactly one Nova is visible there at a time.
  const play = learnSrc.slice(learnSrc.indexOf("top bar: close, segmented course progress"));
  const gate = play.indexOf("{!checked && (");
  const headerNova = play.indexOf('<NovaRive state="thinking" size={40}');
  assert.ok(gate !== -1 && headerNova !== -1 && gate < headerNova, "the lesson header Nova is not gated on the sheet being closed");
});

/* ── Extract the sidebar pop's pure helpers from NovaSidebarPop.jsx
   the same way (2026-10-15): the budget arithmetic, the line
   rotation, and the store records are pure, so they pin without
   mounting the component; the component's wiring pins by source
   in the group below. */
const popSrc = readFileSync(join(root, "src/NovaSidebarPop.jsx"), "utf8");
const popAst = parse(popSrc, { sourceType: "module", plugins: ["jsx"] });
function popDeclFor(name) {
  for (const node of popAst.program.body) {
    const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (!decl) continue;
    const isVar = decl.type === "VariableDeclaration" && decl.declarations.some((d) => d.id.name === name);
    const isFn = decl.type === "FunctionDeclaration" && decl.id && decl.id.name === name;
    if (isVar || isFn) return { start: node.start, end: node.end };
  }
  return null;
}
const POP_WANTED = [
  "POP_FIRST_LINE", "POP_LINES", "POP_MIN_SESSION_MS", "POP_GAP_MS", "POP_LONG_GAP_MS",
  "POP_DISMISSAL_STRETCH", "POP_CHECK_MS", "POP_TIMELINE",
  "popGapMs", "popBlocked", "popEligible", "popLineFor", "recordPop", "recordPopDismissal",
];
const popChunks = [];
for (const name of POP_WANTED) {
  const decl = popDeclFor(name);
  assert.ok(decl, `${name} must be declared in src/NovaSidebarPop.jsx`);
  popChunks.push(popSrc.slice(decl.start, decl.end).replace(/^export\s+/, ""));
}
const popJs = transformSync(popChunks.join("\n") + `\n;globalThis.__pop = { ${POP_WANTED.join(", ")} };`, { loader: "jsx" }).code;
const popContext = vm.createContext({});
vm.runInContext(popJs, popContext);
const {
  POP_FIRST_LINE, POP_LINES, POP_MIN_SESSION_MS, POP_GAP_MS, POP_LONG_GAP_MS,
  POP_DISMISSAL_STRETCH, POP_CHECK_MS, POP_TIMELINE,
  popGapMs, popBlocked, popEligible, popLineFor, recordPop, recordPopDismissal,
} = popContext.__pop;

// ══════════════════════════════════════════════════════════════════
group("Nova's sidebar pop: the discovery invitation, its budget, and the wave");

await test("the pop numbers are the chosen ones: the owner's line, the gaps, the five second visit", () => {
  assert.equal(POP_FIRST_LINE, "Hi, I'm Nova, come check me out.", "the first pop speaks the owner's line word for word");
  assert.deepEqual([...POP_LINES], [
    "Nova. The lessons are in the other tab.",
    "Still here. The other tab has lessons.",
    "I teach the science in there. Worth a look.",
  ], "the later pops rotate the dry reminders");
  for (const line of [POP_FIRST_LINE, ...POP_LINES])
    assert.ok(!/[-–—]/.test(line), `a pop line carries a dash: ${line}`);
  assert.equal(POP_MIN_SESSION_MS, 20000, "no pop inside the first twenty seconds of a session");
  assert.equal(POP_GAP_MS, 24 * 3600 * 1000, "a day between pops");
  assert.equal(POP_LONG_GAP_MS, 7 * 24 * 3600 * 1000, "a week once she has been dismissed twice");
  assert.equal(POP_DISMISSAL_STRETCH, 2);
  assert.equal(POP_CHECK_MS, 15000, "the budget is re checked every fifteen seconds");
  assert.deepEqual([...POP_TIMELINE].map((s) => [s.at, s.phase || null, !!s.wave, !!s.end]), [
    [0, "enter", true, false],
    [2600, "hold", true, false],
    [4400, "exit", false, false],
    [5000, null, false, true],
  ], "she enters waving, waves again in the hold, leaves at 4.4 seconds, and is gone at five");
});

await test("popGapMs stretches to a week at two dismissals, and recordPopDismissal counts them", () => {
  assert.equal(popGapMs({}), POP_GAP_MS);
  assert.equal(popGapMs(null), POP_GAP_MS, "a missing store reads as a fresh one");
  assert.equal(popGapMs({ popDismissals: 1 }), POP_GAP_MS, "one dismissal does not stretch the gap");
  assert.equal(popGapMs({ popDismissals: 2 }), POP_LONG_GAP_MS, "two dismissals stretch the gap to a week");
  const twice = recordPopDismissal(recordPopDismissal({}));
  assert.equal(twice.popDismissals, 2);
  assert.equal(popGapMs(twice), POP_LONG_GAP_MS);
});

await test("popEligible enforces the visited flag, the session rules, the gap, and every blocked context", () => {
  const now = 30 * 24 * 3600 * 1000;
  const sess = { startedAt: now - 60000, popped: false };
  assert.equal(popEligible({}, {}, sess, now), true, "a clear page, a rested store, a session of a minute: eligible");
  assert.equal(popEligible({ hasVisitedNova: true }, {}, sess, now), false, "one Nova tab visit retires the pop for good");
  assert.equal(popEligible({}, {}, { startedAt: now - 60000, popped: true }, now), false, "one pop per session");
  assert.equal(popEligible({}, {}, { startedAt: now - 10000, popped: false }, now), false, "never inside the first twenty seconds of a session");
  assert.equal(popEligible({}, {}, { startedAt: now - POP_MIN_SESSION_MS, popped: false }, now), true, "at twenty seconds the session is old enough");
  assert.equal(popEligible({ lastPopAt: now - 3600 * 1000 }, {}, sess, now), false, "inside the day she rests");
  assert.equal(popEligible({ lastPopAt: now - POP_GAP_MS }, {}, sess, now), true, "a full day later she may pop again");
  assert.equal(popEligible({ lastPopAt: now - 2 * POP_GAP_MS, popDismissals: 2 }, {}, sess, now), false,
    "twice dismissed, she rests a week, not a day");
  assert.equal(popEligible({ lastPopAt: now - POP_LONG_GAP_MS, popDismissals: 2 }, {}, sess, now), true);
  for (const ctx of [{ hidden: true }, { typing: true }, { inLesson: true }, { inCall: true }, { inCheckout: true }, { searchRunning: true }, { onNova: true }])
    assert.equal(popEligible({}, ctx, sess, now), false, `a pop should never land in ${JSON.stringify(ctx)}`);
  assert.equal(popBlocked({ typing: true }), true);
  assert.equal(popBlocked({}), false);
  assert.equal(popEligible(null, null, null, now), true, "empty inputs read as a fresh, clear page");
});

await test("popLineFor introduces her once, then rotates the dry reminders", () => {
  assert.equal(popLineFor(0), POP_FIRST_LINE);
  assert.equal(popLineFor(undefined), POP_FIRST_LINE, "no recorded pops is the first pop");
  assert.equal(popLineFor(1), POP_LINES[0]);
  assert.equal(popLineFor(2), POP_LINES[1]);
  assert.equal(popLineFor(3), POP_LINES[2]);
  assert.equal(popLineFor(4), POP_LINES[0], "the rotation wraps");
});

await test("recordPop counts the appearance without mutating the store it was handed", () => {
  const before = { popCount: 1, lastPopAt: 5, other: "kept" };
  const after = recordPop(before, 999);
  assert.notEqual(after, before);
  assert.equal(before.popCount, 1, "the input store is untouched");
  assert.equal(after.popCount, 2);
  assert.equal(after.lastPopAt, 999);
  assert.equal(after.other, "kept", "unrelated quirks survive the record");
  assert.equal(recordPop({}, 7).popCount, 1, "the first pop counts one");
});

await test("recordNovaVisit marks the visit once and returns the same object after", () => {
  const fresh = recordNovaVisit({});
  assert.equal(fresh.hasVisitedNova, true);
  assert.equal(recordNovaVisit(fresh), fresh, "an already recorded visit returns the store itself, so the mount effect can skip the save");
  assert.equal(recordNovaVisit(null).hasVisitedNova, true);
});

await test("the pop is mounted once in the shell and is silent, storeless, and quip free by construction", () => {
  assert.ok(appSrc.includes('import NovaSidebarPop from "./NovaSidebarPop.jsx";'), "the shell does not import the pop");
  assert.ok(appSrc.includes("<NovaSidebarPop"), "the pop is not mounted in the shell");
  assert.ok(appSrc.includes('onOpenNova={() => handleSidebarNavigateRef.current("learn")}'), "clicking her does not open the Nova tab");
  assert.ok(popSrc.includes('from "./LearnView.jsx"'), "the pop does not read the quirks store from LearnView");
  assert.ok(popSrc.includes("loadNovaQuirks") && popSrc.includes("saveNovaQuirks"), "the pop does not use the quirks store");
  assert.ok(!/localStorage|sessionStorage/.test(popSrc), "the pop invented a storage key; her state belongs in the quirks store");
  assert.ok(popSrc.includes('from "./NovaRive.jsx"'), "the pop does not render through NovaRive");
  assert.ok(popSrc.includes("quips={false}"), "the pop figure can still double bubble through the quip engine");
  assert.ok(popSrc.includes("cbMotionOff"), "the pop does not read the app's motion setting");
  assert.ok(popSrc.includes('".lv-sheet"'), "the lesson exclusion does not probe the lesson sheet");
  assert.ok(popSrc.includes('aria-label="Dismiss Nova"'), "the bubble has no close affordance");
  assert.ok(popSrc.includes("if (!pop) return null;"), "the pop does not unmount to zero cost when idle");
  assert.ok(!/Audio|playSound|speak\(/.test(popSrc), "the pop makes noise; it should be silent by construction");
});

/* Pin rewritten 2026-10-15 (the old model purge): this test
   pinned the wave cue's road through the avatar into the rig's
   grouped right arm. The rig is deleted, and the Rive contract
   has no wave trigger, so the road ends at the canvas: callers
   may still pass the counter (the sidebar pop does), and
   NovaCanvas accepts it and leaves it unused, documented in
   the source. The rig's wave machinery stays gone. */
await test("the wave cue ends at the canvas: accepted, unused, and the rig's wave stays gone", () => {
  assert.ok(riveSrc.includes("waveN is accepted here and left unused"), "NovaCanvas no longer documents the unused wave counter");
  assert.ok(!learnSrc.includes('key={"wv" + waveN}'), "the rig's keyed wave arm group is back");
  assert.ok(!learnSrc.includes(".nv-rig-wave"), "the rig's wave class is back");
  assert.ok(!learnSrc.includes("@keyframes nvRigWave"), "the rig's wave keyframes are back");
  assert.ok(!learnSrc.includes("NOVA_RIG_D.armR"), "the rig's arm paths are back");
});

// ══════════════════════════════════════════════════════════════════
group("Curriculum upgrade: college depth and thinking cards (2026-10-19)");

/* The owner's order (2026-10-19): the paths and quizzes smarter
   and more advanced, college level included. These pins hold the
   shape of that upgrade. Every path ends in an advanced unit the
   path view marks as advanced; the advanced lessons ask scenario
   questions rather than recall alone; the topic courses converted
   their apply and checkpoint quizzes to the same stems; and
   search built courses check terms in context and re ask a claim
   in a changed form. The stem convention is the upgrade rubric's:
   application, comparison, and interpretation cards open with a
   person, a setup, a supposition, or a comparison. */
const THINKING_STEM = (text) => {
  const q = String(text || "");
  return /^(A|An|Two|Suppose)\s/.test(q) || q.startsWith("Compared") ||
    q.startsWith("Use the diagram") || q.startsWith("Look at the diagram");
};
const stemOf = (card) => String(card.question || card.prompt || card.statement || "");

await test("every path ends in a marked advanced unit, and the path view shows it", () => {
  for (const p of LEARNING_PATHS) {
    const last = p.units[p.units.length - 1];
    assert.equal(last.advanced, true, `${p.title} last unit is not marked advanced`);
    assert.ok(last.lessons.length >= 2, `${p.title} advanced unit holds ${last.lessons.length} lessons`);
    assert.equal(p.units.filter((u) => u.advanced === true).length, 1,
      `${p.title} should carry exactly one advanced unit`);
  }
  assert.ok(learnSrc.includes("unit.advanced"), "the path view does not read the advanced flag");
  assert.ok(learnSrc.includes("ADVANCED · COLLEGE LEVEL"), "the path view does not show the advanced tag");
});

await test("advanced lessons ask scenario questions, not recall alone", () => {
  for (const p of LEARNING_PATHS) {
    const adv = p.units[p.units.length - 1];
    let marked = 0, optionCards = 0;
    for (const lesson of adv.lessons) {
      const opts = lesson.cards.filter((c) => ["quiz", "visualq", "predict"].includes(c.kind));
      const hits = opts.filter((c) => THINKING_STEM(stemOf(c))).length;
      assert.ok(hits >= 2, `${p.title} / ${lesson.title} holds ${hits} thinking stem cards, under 2`);
      marked += hits; optionCards += opts.length;
    }
    assert.ok(marked * 2 >= optionCards,
      `${p.title} advanced unit: only ${marked} of ${optionCards} option cards carry a thinking stem`);
  }
});

await test("every topic course converted its apply and checkpoint quizzes to thinking stems", () => {
  let total = 0;
  for (const t of TOPIC_COURSES) {
    const lessons = flattenPathLessons(t);
    const targets = [lessons[0].cards[8], lessons[1].cards[8], lessons[2].cards[0], lessons[2].cards[6]];
    const hits = targets.filter((c) => c && THINKING_STEM(stemOf(c))).length;
    assert.ok(hits >= 2, `${t.title} converted only ${hits} of its 4 target quizzes`);
    total += hits;
  }
  assert.ok(total >= 72, `topic thinking conversions measured ${total} of 96, under 72`);
});

await test("search built courses check terms in context and re ask in a changed form", () => {
  const md = `## Summary

In the leaf, photosynthesis turns sunlight, water, and air into sugars that store energy for the plant. [1]
In every cell, respiration frees the energy stored in sugars, running day and night whether the plant is lit or dark. [1]
${CLAIM_TRIAL.text} [1]
${CLAIM_RESIDENT.text} [1]
`;
  const course = createCourseFromResults("light and leaves", LEAK_SOURCES, md);
  assert.ok(course, "the fixture course did not build");
  const teachCards = course.lessons
    .filter((l) => l.id === "basics" || l.id === "deeper")
    .flatMap((l) => l.cards);
  assert.ok(teachCards.some((c) => typeof c.vocab === "string"),
    "no teach check asks a term in context");
  const clozeTaught = teachCards.find((c) => c.kind === "cloze");
  assert.ok(clozeTaught, "the numbered claims earned no cloze check");
  // A card's claim id carries its claim's hash ahead of a sequence
  // suffix, so the same claim's cards share the hash segment.
  const claimKey = (id) => String(id || "").replace(/-\d+$/, "");
  const review = course.lessons.find((l) => l.id === "review");
  const reask = review.cards.find((c) => claimKey(c.claimId) === claimKey(clozeTaught.claimId));
  assert.ok(reask, "a numbered claim is missing from the review lesson");
  assert.notEqual(reask.kind, "cloze", "the review re asked a claim in the same cloze form it was taught");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
