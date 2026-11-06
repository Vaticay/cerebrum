/**
 * Library blank title regression tests (2026-11-06).
 *
 * The mystery: two live browser walks saw one Library answers row with
 * no visible title and no "Untitled answer" fallback, only the date
 * and cited paper count with Open and Remove, on builds that already
 * carried the 3e4b553 crash fix. That fix resolved the row label as
 * "typeof h.title === string && h.title.trim() ? h.title.trim() :
 * fallback". A title made only of characters that paint nothing
 * (the zero width family, word joiners, the soft hyphen, combining
 * marks attached to nothing, bidi marks) survives .trim(), because
 * trim removes whitespace and most of these are format characters,
 * not whitespace. The check passed and the row rendered the invisible
 * string: a blank row with no fallback, on the exact row the fix
 * touched, for exactly the records its fixtures never modelled.
 *
 * The fix route: textUtils gains visibleTitleText (strip the
 * invisible set, then trim) and historyEntryLabel (visible title,
 * else the first turn's visible question, else the fallback), and
 * every history entry label site in CerebrumApp.jsx routes through
 * historyEntryLabel: the Library answers row and its remove undo
 * line, the Answers ledger title, the Compare picker options, and
 * the command palette results and recents.
 *
 * These tests import the real shipped helpers from src/textUtils.js
 * and run them over the fixture shapes: the plausible invisible
 * payloads in both title and first turn question, the crash suite's
 * malformed shapes, and the walk record's own shape (Oct 24, 2026
 * timestamp, 7 cited papers). They also pin the wiring in source so
 * a future edit cannot quietly hand a raw title back to a list.
 *
 * Run with: node tests/library-blank-title-nov06.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { visibleTitleText, historyEntryLabel } = await import(join(root, "src/textUtils.js"));
const appSource = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const crashSuite = await readFile(join(root, "tests/library-filter-crash.mjs"), "utf8");

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL - ${name}: ${err.message}`);
  }
}

// ── The invisible payloads ─────────────────────────────────────────────
// Written as escapes so this file stays plain text. Each one: passes
// the pre fix row check (string, non-empty after trim) and paints
// nothing at text content (no glyph, no advance, or a break hint).

const INVISIBLE_TITLES = [
  ["zero width space", "\u200B"],
  ["zero width non joiner", "\u200C"],
  ["zero width joiner", "\u200D"],
  ["word joiner", "\u2060"],
  ["soft hyphen", "\u00AD"],
  ["combining grapheme joiner", "\u034F"],
  ["arabic letter mark", "\u061C"],
  ["mongolian vowel separator", "\u180E"],
  ["braille blank", "\u2800"],
  ["hangul filler pair", "\u115F\u1160"],
  ["zero width pair around spaces", "\u200B \u200B"],
];

// The pre fix Library row resolution, verbatim from 3e4b553, kept here
// to prove the fixtures really did defeat it.
const preFixRowLabel = (h) => (typeof h.title === "string" && h.title.trim() ? h.title.trim() : "Untitled answer");

await test("the fixtures defeat the pre fix row resolution", async () => {
  for (const [name, payload] of INVISIBLE_TITLES) {
    const label = preFixRowLabel({ title: payload });
    assert.equal(label, payload, `${name}: pre fix check passes the invisible payload through`);
    assert.notEqual(label, "Untitled answer", `${name}: no fallback fires pre fix`);
  }
});

await test("visibleTitleText sees through every invisible payload", async () => {
  for (const [name, payload] of INVISIBLE_TITLES) {
    assert.equal(visibleTitleText(payload), "", `${name} resolves to no visible text`);
  }
  assert.equal(visibleTitleText("  What helps plants grow in low light  "), "What helps plants grow in low light");
  assert.equal(visibleTitleText("a\u200Bb"), "ab", "an embedded zero width char is stripped, the words stay");
  assert.equal(visibleTitleText(null), "");
  assert.equal(visibleTitleText(undefined), "");
  assert.equal(visibleTitleText(42), "42", "non string input stringifies like the other title helpers");
});

// ── The walk record, modelled exactly ──────────────────────────────────
// Oct 24, 2026, 7 cited papers, and the titled sibling the second walk
// saw beside it: the same investigation under its real question.

const OCT_24_2026 = new Date(2026, 9, 24).getTime();
const sevenSources = [1, 2, 3, 4, 5, 6, 7];

await test("the walk record shape gets its question as the label", async () => {
  const blankTwin = { id: "w1", title: "\u200B", ts: OCT_24_2026, turns: [{ q: "what helps plants grow in low light" }], allSources: sevenSources };
  const titledTwin = { id: "w2", title: "What helps plants grow in low light", ts: OCT_24_2026, turns: [{ q: "what helps plants grow in low light" }], allSources: sevenSources };
  assert.equal(historyEntryLabel(blankTwin), "what helps plants grow in low light");
  assert.equal(historyEntryLabel(titledTwin), "What helps plants grow in low light");
});

await test("an invisible title with an invisible question falls back honestly", async () => {
  const h = { id: "w3", title: "\u200B", ts: OCT_24_2026, turns: [{ q: "\u2060" }], allSources: sevenSources };
  assert.equal(historyEntryLabel(h), "Untitled answer");
  assert.equal(historyEntryLabel(h, "Untitled"), "Untitled");
  assert.equal(historyEntryLabel(h, "Untitled investigation"), "Untitled investigation");
});

await test("every crash suite malformed shape gets a visible label", async () => {
  const shapes = [
    { id: "m1", title: "Why do we dream", turns: [{ q: "why do we dream" }] },
    { id: "m2", turns: [{ q: "do fish sleep" }] },
    { id: "m3", title: null, turns: [{ q: "water quality in rivers" }] },
    { id: "m4", title: 42, turns: [{ q: "numeric title entry" }] },
    { id: "m5", title: { text: "object title" }, turns: [{ q: "object title question" }] },
    { id: "m6", title: "   ", turns: [{ q: "whitespace title entry" }] },
    { id: "m7", title: "Water and memory", turns: [null, { q: null }, {}] },
    { id: "m8", title: undefined, turns: undefined },
    { id: "m9", title: "Gardening notes", turns: [null] },
    { id: "m10", title: "\u200B", turns: [null] },
    { id: "m11" },
    null,
    undefined,
  ];
  for (const h of shapes) {
    const label = historyEntryLabel(h);
    assert.equal(typeof label, "string");
    assert.ok(label.length > 0, `${h && h.id} label is not blank`);
    assert.equal(visibleTitleText(label), label, `${h && h.id} label is itself visible text`);
  }
  assert.equal(historyEntryLabel(shapes[1]), "do fish sleep", "missing title reads the question");
  assert.equal(historyEntryLabel(shapes[5]), "whitespace title entry", "whitespace title reads the question, better than the old Untitled fallback");
  assert.equal(historyEntryLabel(shapes[9]), "Untitled answer", "invisible title and a null turn fall back");
  assert.equal(historyEntryLabel(shapes[3]), "42", "a numeric title stringifies, matching saveInvestigation's own String() derivation");
});

// ── The wiring: every label site routes through the helper ────────────

await test("the Library answers row and its undo line use historyEntryLabel", async () => {
  assert.ok(appSource.includes("{historyEntryLabel(h)}"), "row label");
  assert.ok(appSource.includes('Removed the answer "${historyEntryLabel(h)}" from your library.'), "undo line");
});

await test("the Answers ledger title uses historyEntryLabel", async () => {
  assert.ok(appSource.includes('const invTitle = historyEntryLabel(h, "Untitled");'), "ledger invTitle");
});

await test("the Compare picker and command palette use historyEntryLabel", async () => {
  assert.ok(appSource.includes('label: historyEntryLabel(h, "Untitled investigation")'), "palette and compare labels");
  assert.ok(appSource.includes('label: historyEntryLabel(h, "Untitled investigation") }'), "compare option label");
});

await test("no history label site reads a raw title anymore", async () => {
  assert.ok(!appSource.includes('label: h.title || "Untitled investigation"'), "raw palette label gone");
  assert.ok(!appSource.includes("label: h.title }"), "raw compare label gone");
  assert.ok(!appSource.includes('const invTitle = h.title ||'), "raw ledger title gone");
});

await test("the crash suite keeps its own pins (fixture m6 premise intact)", async () => {
  assert.ok(crashSuite.includes('title: "   "'), "the whitespace fixture the crash suite pins is unchanged");
  assert.ok(crashSuite.includes('rowLabel(shapes') || crashSuite.includes("rowLabel"), "crash suite still pins a row label");
  // The crash suite copies the pre fix row expression locally and pins
  // it against the app source; this fix supersedes that expression, so
  // the crash suite's own source check is updated in the same change,
  // and this line pins the new state: the copied resolver in the crash
  // suite must be the helper backed one, not the raw expression.
  assert.ok(crashSuite.includes("const rowLabel = (h) => historyEntryLabel(h);"), "crash suite rowLabel routes through historyEntryLabel");
});

// ── Summary ─────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURES, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n${passed} passed, 0 failed`);
}
