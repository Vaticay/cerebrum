/**
 * The Bench tests (2026-11-12).
 *
 * Dusty picked The Bench as the Nova tab replacement, with the
 * Her Rounds memory driven opening stolen into it. Field Notes
 * as the tab is rejected; its entries survive as bench notes.
 * This suite pins the concept contract against the real modules
 * and the real surface:
 *   her figure at stage size on the tab first screen
 *   the memory opening built only from data the app holds
 *   the plain fallback when the store holds nothing
 *   no fabricated papers, findings, or visits in her lines
 *   the spoken question, with no quiz form and no points
 *   the resident speaker routing staged in NovaRive
 *   session records stamped from real answers
 *
 * No network, no DOM. Run with: node tests/bench-nov12.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bench = await import(join(root, "src/bench.js"));
const fn = await import(join(root, "src/fieldNotes.js"));
const viewSrc = readFileSync(join(root, "src/FieldNotesView.jsx"), "utf8");
const riveSrc = readFileSync(join(root, "src/NovaRive.jsx"), "utf8");
const learnSrc = readFileSync(join(root, "src/LearnView.jsx"), "utf8");

let passed = 0;
const failures = [];
async function test(name, f) {
  try { await f(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push({ name, error: e }); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function group(name) { console.log(`\n${name}`); }

const entries = fn.fieldNoteEntries();
const NOW = Date.UTC(2026, 10, 12, 15, 0, 0);
const DAY = 86400000;
const DASH = /[-–—]/;

group("Memory facts: only what the app holds");
await test("an empty store gives a first visit with the newest entry on the bench", () => {
  const f = bench.benchFacts({ saved: [], history: [], readIds: [], reviewState: {}, entries, lastVisitMs: 0, nowMs: NOW });
  assert.equal(f.firstVisit, true);
  assert.equal(f.newSavedCount, 0);
  assert.equal(f.newestSavedTitle, null);
  assert.equal(f.lastQuestion, null);
  assert.equal(f.repeatTitle, null);
  assert.equal(f.dueCount, 0);
  assert.ok(f.onBench, "the bench is empty on an empty store");
  assert.equal(f.onBench.id, entries[0].id, "with nothing read, the newest entry goes on the bench");
  assert.equal(f.onBenchWhy, "unread");
});
await test("saved papers since the last visit are counted and named from the real rows", () => {
  const saved = [
    { title: "Older paper on tides", savedAt: NOW - 9 * DAY },
    { title: "Fresh paper on sleep spindles", savedAt: NOW - 1 * DAY },
    { title: "Fresh paper on bee dances", savedAt: NOW - 2 * DAY },
  ];
  const f = bench.benchFacts({ saved, history: [], readIds: [], reviewState: {}, entries, lastVisitMs: NOW - 5 * DAY, nowMs: NOW });
  assert.equal(f.firstVisit, false);
  assert.equal(f.savedCount, 3);
  assert.equal(f.newSavedCount, 2);
  assert.equal(f.newestSavedTitle, "Fresh paper on sleep spindles");
  assert.equal(f.daysAway, 5);
});
await test("a topic asked twice is the only repeat she may claim", () => {
  const history = [
    { title: "Why do bees dance", ts: NOW - 1 * DAY },
    { title: "What is a tide pool", ts: NOW - 2 * DAY },
    { title: "Why do bees dance", ts: NOW - 3 * DAY },
  ];
  const f = bench.benchFacts({ saved: [], history, readIds: [], reviewState: {}, entries, lastVisitMs: NOW - 4 * DAY, nowMs: NOW });
  assert.equal(f.repeatTitle, "Why do bees dance");
  assert.equal(f.repeatCount, 2);
  assert.equal(f.lastQuestion, "Why do bees dance");
  const single = bench.benchFacts({ saved: [], history: history.slice(0, 2), readIds: [], reviewState: {}, entries, lastVisitMs: 0, nowMs: NOW });
  assert.equal(single.repeatTitle, null);
});
await test("a due review puts its own entry on the bench first", () => {
  const target = entries[3];
  const reviewState = { [target.id]: { step: 0, dueAt: NOW - 1000, attempts: 1, lastCorrect: false } };
  const f = bench.benchFacts({ saved: [], history: [], readIds: [target.id], reviewState, entries, lastVisitMs: NOW - 2 * DAY, nowMs: NOW });
  assert.equal(f.dueCount, 1);
  assert.equal(f.onBench.id, target.id);
  assert.equal(f.onBenchWhy, "review");
});
await test("the bench pick matches the reader own recent work by marks, honestly", () => {
  const saved = [{ title: "Sleep and memory consolidation in adolescents", savedAt: NOW - 1 * DAY }];
  const f = bench.benchFacts({ saved, history: [], readIds: [], reviewState: {}, entries, lastVisitMs: 0, nowMs: NOW });
  assert.ok(f.onBench && f.onBench.threadTitle === "Sleep and Memory", "expected a sleep entry on the bench, got " + (f.onBench && f.onBench.title));
  assert.equal(f.onBenchWhy, "match");
});

group("Her opening lines");
await test("the empty store opening admits it plainly and invents nothing", () => {
  const f = bench.benchFacts({ saved: [], history: [], readIds: [], reviewState: {}, entries, lastVisitMs: 0, nowMs: NOW });
  const lines = bench.benchOpeningLines(f);
  assert.ok(lines.length >= 2 && lines.length <= 4);
  assert.ok(lines.join(" ").includes("Nothing in your library yet"), "the fallback should say the store is empty");
  for (const line of lines) assert.ok(!DASH.test(line), "opening line carries a dash: " + line);
});
await test("a returning opening names only the real saved paper and the real gap", () => {
  const saved = [{ title: "Fresh paper on sleep spindles", savedAt: NOW - 1 * DAY }];
  const f = bench.benchFacts({ saved, history: [], readIds: [], reviewState: {}, entries, lastVisitMs: NOW - 5 * DAY, nowMs: NOW });
  const text = bench.benchOpeningLines(f).join(" ");
  assert.ok(text.includes("5 days since you last stood here"));
  assert.ok(text.includes("Fresh paper on sleep spindles"));
  assert.ok(!text.includes("tide"), "a paper nobody saved leaked into her lines");
});
await test("a first visit never claims a past the app does not hold", () => {
  const f = bench.benchFacts({ saved: [], history: [{ title: "One real question", ts: NOW }], readIds: [], reviewState: {}, entries, lastVisitMs: 0, nowMs: NOW });
  const text = bench.benchOpeningLines(f).join(" ");
  assert.ok(text.includes("First time at my bench"));
  assert.ok(!/since you last/i.test(text), "first visit line claims a previous visit");
  assert.ok(!/while you were gone/i.test(text), "first visit line claims an absence");
});

group("Session records");
await test("a session record stamps answers and keeps the first open stamp", () => {
  let s = bench.makeSessionRecord({}, "e1", { openedAt: 100 }, 100);
  s = bench.makeSessionRecord(s, "e1", { answeredAt: 200, correct: true }, 200);
  assert.equal(s.e1.openedAt, 100);
  assert.equal(s.e1.answeredAt, 200);
  assert.equal(s.e1.correct, true);
  assert.equal(bench.sessionDateLabel(s.e1), bench.sessionDateLabel({ answeredAt: 200 }));
  assert.equal(bench.sessionDateLabel(null), null);
  assert.equal(bench.sessionDateLabel({}), null);
});

group("The surface");
await test("the tab is The Bench, with her at stage size on the first screen", () => {
  assert.ok(viewSrc.includes("The Bench"), "bench title missing");
  assert.ok(viewSrc.includes('framing="full"'), "stage figure is not full framing");
  assert.ok(/size=\{26[04]\}/.test(viewSrc), "stage figure is not at stage size");
  assert.ok(viewSrc.includes('surface="nova-home"'), "stage figure lost her home surface");
});
await test("her speaker mount on the session screen is a resident figure under 120", () => {
  assert.ok(viewSrc.includes("residentFigure"), "the session speaker does not opt into the resident figure routing");
  assert.ok(/size=\{112\}/.test(viewSrc), "the session speaker is not at a speaker size under 120");
});
await test("no quiz form, no true or false, no points on the bench surface", () => {
  assert.ok(!/\bXP\b/.test(viewSrc), "XP leaked onto the bench");
  assert.ok(!/points/i.test(viewSrc), "points leaked onto the bench");
  assert.ok(!viewSrc.includes("truefalse") && !viewSrc.includes("true_false"), "the banned form is present");
  assert.ok(!viewSrc.includes("<Player") && !viewSrc.includes("mkQuiz") && !viewSrc.includes("mkTrueFalse"), "old quiz machinery mounted");
  assert.ok(viewSrc.includes("SHE ASKS ONE THING"), "her spoken question block is missing");
});
await test("the Field Notes carry over as bench notes, shelf and streak intact", () => {
  assert.ok(viewSrc.includes("BENCH NOTES"), "bench notes section missing");
  assert.ok(viewSrc.includes("Field Notes"), "the bench notes do not name their Field Notes origin");
  assert.ok(viewSrc.includes("HER SHELF"), "shelf section missing");
  assert.ok(viewSrc.includes("Streak"), "streak missing");
  assert.ok(viewSrc.includes("notebookForFleet"), "fleet down degradation lost");
  assert.ok(viewSrc.includes("entryIsToday(entry)"), "the Today label gate from the fix wave was dropped");
});
await test("the opening reads the real stores and stamps the visit", () => {
  assert.ok(viewSrc.includes("benchFacts("), "the view does not compute memory facts");
  assert.ok(viewSrc.includes("benchOpeningLines("), "the view does not build her opening");
  assert.ok(viewSrc.includes('"cb_saved"') || viewSrc.includes("SAVED_KEY"), "saved papers store not read");
  assert.ok(viewSrc.includes('"cb_history"') || viewSrc.includes("HISTORY_KEY"), "history store not read");
  assert.ok(viewSrc.includes("BENCH_LAST_VISIT_KEY"), "last visit stamp not wired");
});

group("Resident speaker routing (presence plan Part 1, staged for the tab)");
await test("the glyph substitution retires only for resident speaker mounts", () => {
  assert.ok(riveSrc.includes("size < 120"), "the glyph threshold for ordinary mounts moved");
  assert.ok(riveSrc.includes("!props.residentFigure"), "the resident speaker exemption is missing from the routing");
  assert.ok(riveSrc.includes("NovaGlyph"), "the glyph itself was removed instead of kept for chrome");
});
await test("NovaLive forwards the resident figure flag and nothing else opts in yet", () => {
  assert.ok(learnSrc.includes("residentFigure = false"), "NovaLive does not accept the flag");
  assert.ok(learnSrc.includes("residentFigure={residentFigure}"), "NovaLive does not forward the flag");
});
await test("the stale drop description in the canvas header is corrected", () => {
  assert.ok(!riveSrc.includes("The rendered figure is the drop"), "the stale drop header survived");
  assert.ok(riveSrc.includes("restored"), "the header does not name the restored figure");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
