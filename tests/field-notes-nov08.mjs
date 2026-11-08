/**
 * Field Notes tests (2026-11-08).
 *
 * Dusty picked Field Notes as the Nova reset: her dated notebook is
 * the whole learning product. This suite pins the concept contract
 * against the real module and the real surfaces:
 *   entry shape (dated, first person, word band, one question)
 *   no true or false form anywhere in the new surface
 *   the blind check gate, driven by fake solver legs
 *   review resurfacing on the entry ladder
 *   fleet down behaviour (cached entries and reviews keep working)
 *   the generated course surface no longer reachable from Nova home
 *   the imprint touches on answers and in the Library
 *   public copy no longer selling lessons or quizzes
 *
 * No network, no DOM. Run with: node tests/field-notes-nov08.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fn = await import(join(root, "src/fieldNotes.js"));
const learnSrc = readFileSync(join(root, "src/FieldNotesView.jsx"), "utf8");
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const marketingSrc = readFileSync(join(root, "src/marketingContent.js"), "utf8");
const llmsSrc = readFileSync(join(root, "public/llms.txt"), "utf8");

let passed = 0;
const failures = [];
async function test(name, f) {
  try { await f(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push({ name, error: e }); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function group(name) { console.log(`\n${name}`); }

const entries = fn.fieldNoteEntries();

group("Entry shape");
await test("the seed set validates clean", () => {
  const v = fn.validateFieldNotes();
  assert.deepEqual(v.problems, []);
  assert.ok(v.entryCount >= 8, "seed set too thin to open with");
  assert.ok(v.threadCount >= 3, "seed set needs several threads");
});
await test("every entry is dated, first person, and inside the word band", () => {
  for (const e of entries) {
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, e.id + " not dated");
    assert.ok(/\bI\b/.test(e.body), e.id + " not first person");
    const w = fn.wordCount(e.body);
    assert.ok(w >= 150 && w <= 250, e.id + " at " + w + " words");
  }
});
await test("exactly one question per entry, and it is a preferred shape", () => {
  for (const e of entries) {
    assert.ok(e.question && typeof e.question === "object", e.id);
    assert.ok(!Array.isArray(e.question), e.id + " carries a question list");
    assert.ok(["predict", "explain"].includes(e.question.kind), e.id + " kind " + e.question.kind);
  }
});
await test("no dash characters in any visible seed text", () => {
  for (const e of entries) {
    const visible = [e.title, e.body, e.noteLine, e.question.prompt, e.question.feedback, ...(e.question.options || [])].join(" ");
    assert.ok(!/[-–—]/.test(visible), e.id + " carries a dash");
  }
});
await test("entries come newest first, so todays entry opens the notebook", () => {
  const dates = entries.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
});
await test("a malformed entry is refused by the validator", () => {
  const bad = { id: "x", date: "soon", dateLabel: "Soon", title: "T", body: "Short.", noteLine: "n", question: { kind: "predict", prompt: "p", options: ["a"], correct: 0, feedback: "short" } };
  assert.ok(fn.entryProblem(bad).length >= 3);
});

group("No true or false form");
await test("no seed question uses the banned form", () => {
  for (const e of entries) assert.ok(e.question.kind !== "truefalse" && e.question.kind !== "true_false", e.id);
});
await test("the new notebook component renders no card factory surface", () => {
  const home = learnSrc;
  assert.ok(home.includes("Field Notes"), "notebook home missing");
  assert.ok(appSrc.includes("<FieldNotesView"), "the Nova tab does not mount the notebook");
  for (const banned of ["<Player", "PathView", "BuiltinPathView", "OnboardingFlow", "mkQuiz", "mkTrueFalse", "createCourseFromResults("]) {
    assert.ok(!home.includes(banned), "old surface still mounted: " + banned);
  }
});

group("Blind check gate");
await test("a solver that already knows fails the gate", async () => {
  const q = entries[0].question;
  const r = await fn.blindCheckQuestion(q, async () => ({ pick: q.correct, alsoTrue: [] }));
  assert.equal(r.ok, false);
  assert.ok(r.reasons.join(" ").includes("already knew"));
});
await test("a second true option fails the gate", async () => {
  const q = entries[0].question;
  const wrong = (q.correct + 1) % q.options.length;
  const other = (q.correct + 2) % q.options.length;
  const r = await fn.blindCheckQuestion(q, async () => ({ pick: wrong, alsoTrue: [other] }));
  assert.equal(r.ok, false);
  assert.ok(r.reasons.join(" ").includes("second true"));
});
await test("a solver that misses with no second true passes the gate", async () => {
  const q = entries[0].question;
  const wrong = (q.correct + 1) % q.options.length;
  const r = await fn.blindCheckQuestion(q, async () => ({ pick: wrong, alsoTrue: [] }));
  assert.equal(r.ok, true);
});
await test("the solver never receives the entry body", async () => {
  const e = entries[1];
  let seen = null;
  await fn.blindCheckQuestion(e.question, async (arg) => { seen = arg; return { pick: 99, alsoTrue: [] }; });
  assert.deepEqual(Object.keys(seen).sort(), ["options", "prompt"]);
  assert.ok(!JSON.stringify(seen).includes(e.body.slice(0, 40)), "entry text leaked to the blind solver");
});
await test("the batch runner reports per entry results", async () => {
  const rs = await fn.blindCheckEntries(entries.slice(0, 3), async () => ({ pick: 99, alsoTrue: [] }));
  assert.equal(rs.length, 3);
  assert.ok(rs.every((r) => r.ok && r.id));
});

group("Review resurfacing");
await test("a correct answer pushes the review out on the ladder", () => {
  const now = Date.UTC(2026, 10, 8);
  const s1 = fn.scheduleEntryReview({}, "e1", true, now);
  assert.equal(s1.e1.dueAt, now + 3 * 86400000);
  const s2 = fn.scheduleEntryReview(s1, "e1", true, now);
  assert.equal(s2.e1.dueAt, now + 7 * 86400000);
});
await test("a wrong answer restarts the ladder at one day", () => {
  const now = Date.UTC(2026, 10, 8);
  const s1 = fn.scheduleEntryReview({}, "e1", true, now);
  const s2 = fn.scheduleEntryReview(s1, "e1", false, now);
  assert.equal(s2.e1.dueAt, now + 1 * 86400000);
  assert.equal(s2.e1.step, 0);
});
await test("due reviews resurface with their entry attached", () => {
  const now = Date.UTC(2026, 10, 8);
  const s = fn.scheduleEntryReview({}, entries[0].id, false, now);
  const due = fn.dueEntryReviews(s, entries, now + 2 * 86400000);
  assert.equal(due.length, 1);
  assert.equal(due[0].entry.id, entries[0].id);
  assert.equal(fn.dueEntryReviews(s, entries, now).length, 0);
});

group("Fleet down behaviour");
await test("cached entries and reviews keep working with the fleet down", () => {
  const now = Date.UTC(2026, 10, 8);
  const s = fn.scheduleEntryReview({}, entries[0].id, false, now);
  const nb = fn.notebookForFleet({ fleetUp: false, entries, reviewState: s, now: now + 2 * 86400000 });
  assert.equal(nb.entries.length, entries.length);
  assert.equal(nb.reviews.length, 1);
  assert.equal(nb.paused, true);
  assert.equal(nb.notice, fn.FLEET_DOWN_LINE);
});
await test("fleet up carries no pause notice", () => {
  const nb = fn.notebookForFleet({ fleetUp: true, entries, reviewState: {}, now: Date.now() });
  assert.equal(nb.paused, false);
  assert.equal(nb.notice, null);
});

group("Imprint");
await test("an answer on a held topic earns exactly one notebook line", () => {
  const hit = fn.notebookLineFor("why do bees navigate by the sun");
  assert.ok(hit && hit.line.startsWith("From my notebook"));
  assert.equal(fn.notebookLineFor("quantum tunnelling in metals"), null);
});
await test("a Library paper on a held topic is marked, others are not", () => {
  const held = fn.paperHasNote({ title: "Sleep and memory consolidation in adolescents" });
  assert.ok(held && held.id);
  assert.equal(fn.paperHasNote({ title: "Tectonic plate velocities" }), null);
});
await test("the answer surface renders the notebook line and the Library mark", () => {
  assert.ok(appSrc.includes("notebookLineFor("), "answer notebook line not wired");
  assert.ok(appSrc.includes("paperHasNote(sv)"), "Library mark not wired");
  assert.ok(appSrc.includes("Nova has a field note on this"), "Library mark copy missing");
});
await test("the old turn into course menu item is retired", () => {
  assert.ok(!appSrc.includes("Turn into course"), "course menu item still offered");
  assert.ok(appSrc.includes("Open Field Notes"), "field notes menu item missing");
});

group("Public copy");
await test("public copy sells Field Notes, not lessons or quizzes", () => {
  assert.ok(marketingSrc.includes("Field Notes"), "marketing copy not updated");
  assert.ok(!marketingSrc.includes("true or false checks"), "marketing still sells the banned form");
  assert.ok(!marketingSrc.includes("taught lessons on a topic you pick"), "marketing still sells lessons");
  assert.ok(llmsSrc.includes("Field Notes"), "llms copy not updated");
  assert.ok(!llmsSrc.includes("quizzes on what each lesson taught"), "llms still sells quizzes");
});

group("Shelf and streaks only");
await test("thread progress completes only when every entry is read", () => {
  const t = fn.FIELD_NOTE_THREADS[0];
  assert.equal(fn.threadProgress(t, []).complete, false);
  assert.equal(fn.threadProgress(t, t.entries.map((e) => e.id)).complete, true);
});
await test("the notebook home shows shelf and streak, and no XP", () => {
  const home = learnSrc;
  assert.ok(home.includes("HER SHELF"));
  assert.ok(home.includes("Streak"));
  assert.ok(!/\bXP\b/.test(home), "XP leaked into the notebook surface");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
