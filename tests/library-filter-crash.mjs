/**
 * Library / Answers filter crash regression tests (2026-11-06).
 *
 * The bug: UIField forwarded the consumer's onChange verbatim to the DOM
 * input, while every consumer hands it a useState setter and reads back a
 * string (the contract UISelect and SegControl honour). The first
 * keystroke therefore stored the change EVENT object in the query state,
 * and the re-render's first .trim() on that state threw
 * "X.trim is not a function" and took the whole screen to the error
 * boundary. It reproduced with any keystroke, on perfectly clean data,
 * in both the Library filter and the Answers filter.
 *
 * These tests execute the real shipped UIField (extracted by AST and
 * transformed with esbuild, the tests/ui-render.cjs technique) under a
 * faithful simulation of React's onChange/setState contract, then run the
 * shipped filter predicates over malformed saved records: missing, null,
 * numeric, object and whitespace titles, null turn entries, and missing
 * turns/allSources. The search must never throw on a malformed record,
 * and an untitled answer must render an honest label.
 *
 * Run with: node tests/library-filter-crash.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const { parse } = require("@babel/parser");
const { transformSync } = require("esbuild");
const React = require("react");

const dsSource = await readFile(join(root, "src/designSystem.jsx"), "utf8");
const appSource = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const { PALETTES } = await import(join(root, "src/palettes.js"));
const { REGISTER_GOLD } = await import(join(root, "src/registerTokens.js"));

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

// ── The real UIField, extracted from the shipped source ─────────────────

function loadUIField() {
  const ast = parse(dsSource, { sourceType: "module", plugins: ["jsx"] });
  const wanted = new Set(["UIField", "COLOR", "TYPE", "SP", "RADIUS", "FONT_SIZES"]);
  const decls = ast.program.body
    .map((n) => (n.type === "ExportNamedDeclaration" ? n.declaration : n))
    .filter((n) => n && ((n.type === "FunctionDeclaration" && wanted.has(n.id.name)) ||
      (n.type === "VariableDeclaration" && n.declarations.some((d) => wanted.has(d.id.name)))));
  assert.equal(decls.length, wanted.size, "UIField and its token consts extracted");
  const code = transformSync(
    decls.map((n) => dsSource.slice(n.start, n.end)).join("\n") + "\nmodule.exports = { UIField };",
    { loader: "jsx", jsx: "transform", format: "cjs" }
  ).code;
  const sandbox = { React, module: { exports: {} }, PALETTES, REGISTER_GOLD };
  sandbox.exports = sandbox.module.exports;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.module.exports.UIField;
}

const PAL = { dark: true, surface: "#111", line: "#222", ink: "#eee" };
const changeEvent = (value) => ({ type: "change", target: { value }, preventDefault() {}, stopPropagation() {} });

// ── The shipped filter predicates (verbatim from src/CerebrumApp.jsx;
//    guest mode: the vault index is locked, so zkQueryIds returns null) ──

const zkQueryIds = () => null;
const collections = [];

function visibleSaved(saved, libraryQuery, librarySort) {
  const q = libraryQuery.trim();
  let list;
  if (!q) {
    list = saved.slice();
  } else {
    const ql = q.toLowerCase();
    const legacyMatch = (sv) => {
      const collectionName = sv.collectionId ? (collections.find((c) => c.id === sv.collectionId)?.name || "") : "";
      return [sv.title, sv.authors, sv.journal, sv.abstract, sv.doi, sv.year, collectionName]
        .filter(Boolean).join(" ").toLowerCase().includes(ql);
    };
    const ids = zkQueryIds(q);
    list = ids
      ? saved.filter((sv) => (sv.zkId && ids.has(sv.zkId)) || legacyMatch(sv))
      : saved.filter(legacyMatch);
  }
  if (librarySort === "title") return list.sort((x, y) => String(x.title || "").localeCompare(String(y.title || "")));
  if (librarySort === "year") return list.sort((x, y) => (Number(y.year) || 0) - (Number(x.year) || 0));
  return list.sort((x, y) => (y.savedAt || y.createdAt || 0) - (x.savedAt || x.createdAt || 0));
}

function visibleHistory(history, historyQuery) {
  const q = historyQuery.trim();
  if (!q) return history;
  const ql = q.toLowerCase();
  const legacyMatch = (h) => String(h.title || "").toLowerCase().includes(ql)
    || (h.turns || []).some((t) => String((t && t.q) || "").toLowerCase().includes(ql));
  const ids = zkQueryIds(q);
  if (!ids) return history.filter(legacyMatch);
  return history.filter((h) => (h.zkId ? ids.has(h.zkId) : legacyMatch(h)));
}

function libraryAnswersSublist(history, libraryQuery) {
  return history.filter((h) => { const q = libraryQuery.trim().toLowerCase(); return !q || String(h.title || "").toLowerCase().includes(q); });
}

// The Library answers row label, as shipped: the row renders the
// shared historyEntryLabel helper from src/textUtils.js (visible
// title, else the first turn's question, else "Untitled answer").
// PIN UPDATED 2026-11-06 (blank title lane): the shipped resolution
// was the inline h.title expression; it rendered a BLANK row for a
// title made only of zero width characters, which survive .trim(),
// so the resolution moved into the helper where the invisible
// character set is stripped before the check. The fixtures below now
// assert the helper's labels, which differ from the old fallback in
// one honest way: a record whose title is unusable but whose first
// turn carries the question is labelled with its question.
const { historyEntryLabel } = await import(join(root, "src/textUtils.js"));
const rowLabel = (h) => historyEntryLabel(h);

// ── Fixtures: the malformed shapes ───────────────────────────────────────

const malformedHistory = [
  { id: "m1", title: "Why do we dream", ts: 8, turns: [{ q: "why do we dream" }], allSources: [1, 2, 3] },
  { id: "m2", ts: 7, turns: [{ q: "do fish sleep" }], allSources: [] },
  { id: "m3", title: null, ts: 6, turns: [{ q: "water quality in rivers" }], allSources: [1] },
  { id: "m4", title: 42, ts: 5, turns: [{ q: "numeric title entry" }], allSources: [] },
  { id: "m5", title: { text: "object title" }, ts: 4, turns: [{ q: "object title question" }], allSources: [] },
  { id: "m6", title: "   ", ts: 3, turns: [{ q: "whitespace title entry" }], allSources: [1, 2, 3, 4, 5, 6, 7] },
  { id: "m7", title: "Water and memory", ts: 2, turns: [null, { q: null }, {}], allSources: undefined },
  { id: "m8", title: undefined, ts: 1, turns: undefined, allSources: undefined },
  { id: "m9", title: "Gardening notes", ts: 0, turns: [null], allSources: [] },
];

const malformedPapers = [
  { title: "Dreaming in REM sleep", authors: "Doe A", journal: "Sleep", year: 2024, savedAt: 5 },
  { authors: ["Array", "Authors"], year: "2022", savedAt: 4 },
  { title: { text: "object" }, authors: "X Y", savedAt: 3 },
  { title: null, authors: null, journal: null, abstract: null, doi: null, year: null, savedAt: 2 },
  { title: 1999, year: 1999, savedAt: 1 },
];

// ── The wiring: a keystroke must deliver a string to state ──────────────

await test("UIField hands the typed string to a state setter, never the event", async () => {
  const UIField = loadUIField();
  let query = "";
  const setQuery = (v) => { query = (typeof v === "function") ? v(query) : v; };
  const el = UIField({ value: query, onChange: setQuery, placeholder: "Search your library", P: PAL, accent: "#C4A35A" });
  assert.notEqual(el.props.onChange, setQuery, "the raw setter must not reach the DOM input");
  el.props.onChange(changeEvent("dream"));
  assert.equal(query, "dream");
  el.props.onChange(changeEvent("water"));
  assert.equal(query, "water");
});

await test("UIField source keeps the value lifting handler", async () => {
  assert.ok(dsSource.includes("onChange(e && e.target ? e.target.value : e)"), "UIField lifts e.target.value");
});

// ── The filters over malformed records ───────────────────────────────────

await test("Answers filter matches titles and turn questions without throwing", async () => {
  assert.deepEqual(visibleHistory(malformedHistory, "dream").map((h) => h.id), ["m1"]);
  assert.deepEqual(visibleHistory(malformedHistory, "water").map((h) => h.id), ["m3", "m7"]);
  assert.deepEqual(visibleHistory(malformedHistory, "fish").map((h) => h.id), ["m2"]);
  assert.equal(visibleHistory(malformedHistory, "").length, malformedHistory.length);
});

await test("Answers filter survives a null turn entry on a title miss", async () => {
  assert.deepEqual(visibleHistory(malformedHistory, "zzz-no-match"), []);
});

await test("Answers filter source keeps the null turn guard", async () => {
  assert.ok(appSource.includes('String((t && t.q) || "")'), "legacyMatch guards (t && t.q)");
});

await test("Library answers sublist filters without throwing", async () => {
  assert.deepEqual(libraryAnswersSublist(malformedHistory, "dream").map((h) => h.id), ["m1"]);
  assert.equal(libraryAnswersSublist(malformedHistory, "").length, malformedHistory.length);
});

await test("Library papers filter runs over malformed papers without throwing", async () => {
  assert.equal(visibleSaved(malformedPapers, "dream", "recent").length, 1);
  assert.equal(visibleSaved(malformedPapers, "", "title").length, malformedPapers.length);
  assert.equal(visibleSaved(malformedPapers, "zzz-no-match", "year").length, 0);
});

// ── The untitled row renders an honest label ────────────────────────────

await test("every malformed answer gets a non-empty string row label", async () => {
  for (const h of malformedHistory) {
    const label = rowLabel(h);
    assert.equal(typeof label, "string", `${h.id} label is a string`);
    assert.ok(label.length > 0, `${h.id} label is not blank`);
  }
  assert.equal(rowLabel(malformedHistory[0]), "Why do we dream");
  // PIN UPDATED 2026-11-06 (blank title lane): the whitespace, object,
  // and numeric title fixtures asserted the old "Untitled answer"
  // fallback; under historyEntryLabel those records show the question
  // they carry in their first turn, which is the honest label. The
  // "Untitled answer" fallback itself is pinned by the new
  // library-blank-title-nov06 suite on records with no visible text
  // anywhere.
  assert.equal(rowLabel(malformedHistory[5]), "whitespace title entry", "whitespace title shows its question");
  assert.equal(rowLabel(malformedHistory[4]), "object title question", "object title shows its question");
  assert.equal(rowLabel(malformedHistory[3]), "42", "numeric title stringifies, as saveInvestigation itself derives it");
});

await test("row label source resolves through the shared historyEntryLabel helper", async () => {
  assert.ok(
    appSource.includes("{historyEntryLabel(h)}"),
    "Library answers row label renders historyEntryLabel"
  );
});

// ── Summary ─────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURES, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n${passed} passed, 0 failed`);
}
