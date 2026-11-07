/**
 * Exports leftovers tests: the 2026-11-06 site debug exports fix,
 * second wave (Master Catalog entries 63 and 64, exports catalog
 * 12 and 13). Neither exports fix lane covered these two: the data
 * lane assigned them to the honesty lane and the honesty lane
 * scoped only catalog 5, 6, 8, 9, 10, 11.
 *
 * Catalog 12: reimporting Cerebrum's own BibTeX left stray
 * backslashes before braces in titles. The writer in
 * src/citationExport.js escapes braces and writes backslash, tilde,
 * and caret as \textbackslash{}, \textasciitilde{}, and
 * \textasciicircum{}; the importer in src/importCitations.js
 * unescaped \& \% \$ \# \_ but never the brace pair, and never
 * decoded the three text commands at all, so a title round trip
 * came back dirty. These are behavioral round trip tests against
 * the real modules.
 *
 * Catalog 13: the Nova share card in src/LearnView.jsx lost content
 * silently at its shrink limits: a title still wrapping past three
 * lines at the 30px floor lost every later word with no marker, and
 * the stat pills stopped shrinking at 22px even when the pair still
 * ran past the card. The card draws on a canvas inside a component,
 * so it is not importable in plain node; those pins are source
 * assertions over the shipped drawing code, the same pattern the
 * citation data suite uses for the CerebrumApp monolith.
 *
 * Run with: node tests/exports-leftovers-nov06.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { toBibTeX } = await import(join(root, "src/citationExport.js"));
const { importCitations } = await import(join(root, "src/importCitations.js"));
const learnSrc = readFileSync(join(root, "src/LearnView.jsx"), "utf8");

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

const roundTripTitle = (title) => {
  const src = [{ authors: "Doe, John and Smith, Jane", authorsFull: "John Doe, Jane Smith", title, journal: "J & J", year: 2021, doi: "10.1000/xyz_1", url: "https://doi.org/10.1000/xyz_1" }];
  const back = importCitations(toBibTeX(src));
  assert.equal(back.papers.length, 1, "the round trip lost the entry");
  return back.papers[0].title;
};

group("Catalog 12, BibTeX round trip keeps the title clean");

await test("braces in a title come back as the words, no backslashes", () => {
  assert.equal(roundTripTitle("Braces {here} in a title"), "Braces here in a title");
});

await test("every writer escape survives the round trip or decodes to its character", () => {
  assert.equal(
    roundTripTitle("Braces {here} & 100% real_new #tag a\\b ~x ^y $z"),
    "Braces here & 100% real_new #tag a\\b ~x ^y $z"
  );
});

await test("foreign BibTeX brace escapes decode too", () => {
  const back = importCitations("@article{x2020,\n  title = {On \\{Nested\\} Sets},\n  year = {2020}\n}");
  assert.equal(back.papers[0].title, "On Nested Sets");
});

await test("the writer text commands decode with or without the empty group", () => {
  const back = importCitations("@article{x2020,\n  title = {A \\textbackslash path, \\textasciitilde home, \\textasciicircum 2},\n  year = {2020}\n}");
  assert.equal(back.papers[0].title, "A \\ path, ~ home, ^ 2");
});

await test("accent decoding still works beside the new passes", () => {
  const back = importCitations("@article{x2020,\n  author = {M{\\\"u}ller, J},\n  title = {Caf\\'e society and S{\\o}rensen},\n  year = {2020}\n}");
  assert.equal(back.papers[0].title, "Café society and Sørensen");
  assert.equal(back.papers[0].authors, "J Müller");
});

await test("the older escapes and dash forms still decode", () => {
  const back = importCitations("@article{x2020,\n  title = {100\\% \\& \\$5 \\#tag under\\_score, pages 123--130},\n  year = {2020}\n}");
  assert.equal(back.papers[0].title, "100% & $5 #tag under_score, pages 123–130");
});

group("Catalog 13, share card shrink limits admit what they cut");

await test("the title marks a truncation instead of dropping words silently", () => {
  assert.ok(learnSrc.includes("if (drawnTitle.length < wrapped.length) {"),
    "the share card title has no truncation branch");
  assert.ok(learnSrc.includes('kept[kept.length - 1] = tail + " …";'),
    "the truncated title line carries no ellipsis");
});

await test("the stat pills shrink past the old 22px floor", () => {
  assert.ok(learnSrc.includes("while (total > 1000 && statSize > 14) {"),
    "the stat pill shrink still stops at 22px");
});

await test("an extreme stat label truncates inside its pill with an ellipsis", () => {
  assert.ok(learnSrc.includes('stats[i] = t + "…";'),
    "the stat pill has no admitted truncation");
});

await test("the subline truncates with the admitted ellipsis at its floor", () => {
  assert.ok(learnSrc.includes('subText += " …";'),
    "the share card subline still prints past the card at its floor");
});

// ══════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
