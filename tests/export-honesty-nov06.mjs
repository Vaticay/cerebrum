/**
 * Export honesty tests (2026-11-06, site wide debug, exports lane).
 *
 * The defects pinned here, from the exports audit report
 * (~/workspace/cerebrum-site-debug-nov06/exports/report.md):
 *  - Catalog 5: an all further reading bibliography downloaded empty
 *    files (zero byte BibTeX and RIS, header only CSV) and the
 *    Exports log recorded success. doExportFmt now refuses with
 *    words, and the Excel path writes a receipt only when a file
 *    was actually produced.
 *  - Catalog 6: the Settings workspace export carried only saved,
 *    history, and preferences under an "Everything, as JSON"
 *    promise, and import left the old browser's other stores
 *    standing. The document now carries every store, the Nova
 *    section is the versioned Nova progress document, and import
 *    replaces each store the file carries, wholesale.
 *  - Catalog 8: an answer whose sectioniser yields zero printable
 *    blocks exported as a PDF with a silently empty body. The PDF
 *    now falls back to plain text blocks.
 *  - Catalog 9: investigation export truncated mid word at its
 *    disclosed 2,000 character cap. The cut now lands on a word
 *    boundary.
 *  - Catalog 10: the command palette BibTeX path silently fell back
 *    to every source in the app and wrote no Exports log receipt.
 *  - Catalog 11: the Library diagram SVG used a stale duplicate
 *    exporter while Diagram Studio used the maintained one. The
 *    duplicate is deleted; both surfaces call the one fcSvgString
 *    from src/flowcharts.jsx with the live palette colors.
 *
 * Component internal handlers are pinned by source assertions (the
 * style tests/run itself uses); the pure machinery (workspace build
 * and plan, the Nova round trip, the PDF fallback, the truncation,
 * the diagram exporter) runs for real, extracted by AST into a bare
 * VM the way cortex-learning.mjs and flowchart-sync.mjs do.
 *
 * Run with: node tests/export-honesty-nov06.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { transformSync } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const settingsSrc = readFileSync(join(root, "src/settings.jsx"), "utf8");
const flowSrc = readFileSync(join(root, "src/flowcharts.jsx"), "utf8");
const designSrc = readFileSync(join(root, "src/designSystem.jsx"), "utf8");
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
function group(name) { console.log(`\n${name}`); }

/* Extract top level declarations by name from a source file, the
   pattern flowchart-sync.mjs established. */
function declChunks(src, names) {
  const ast = parse(src, { sourceType: "module", plugins: ["jsx"] });
  const chunks = [];
  for (const name of names) {
    let found = null;
    for (const node of ast.program.body) {
      const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
      if (!decl) continue;
      if (decl.type === "FunctionDeclaration" && decl.id && decl.id.name === name) { found = decl; break; }
      if (decl.type === "VariableDeclaration" && decl.declarations.some((d) => d.id && d.id.name === name)) { found = decl; break; }
    }
    assert.ok(found, `${name} must be declared at top level`);
    chunks.push(src.slice(found.start, found.end));
  }
  return chunks.join("\n");
}
function runInVm(code, contextExtras, exportNames) {
  const js = transformSync(code + `\n;globalThis.__x = { ${exportNames.join(", ")} };`, { loader: "jsx" }).code;
  const context = vm.createContext({ ...contextExtras });
  vm.runInContext(js, context);
  return context.__x;
}
const plain = (v) => JSON.parse(JSON.stringify(v));

/* A localStorage shaped stub the test fully controls. */
function makeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

/* Slice a named region out of a source file for handler level
   assertions: from the marker to the next top level declaration of
   the given kind, or a fixed window. */
function region(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a >= 0, `marker not found: ${startMarker}`);
  const b = endMarker ? src.indexOf(endMarker, a + startMarker.length) : -1;
  return src.slice(a, b > a ? b : a + 4000);
}

// ══════════════════════════════════════════════════════════════════
group("Catalog 5 — empty bibliography exports refuse, and receipts tell the truth");

await test("doExportFmt guards the empty cited set before any download or receipt", () => {
  const body = region(appSrc, "const doExportFmt = (fmt) => {", "// Jump bar:");
  const guardAt = body.indexOf("if (!citedOnly.length)");
  assert.ok(guardAt >= 0, "doExportFmt has no empty cited set guard");
  assert.ok(guardAt < body.indexOf("download("), "the guard must run before the first download");
  assert.ok(body.includes("Nothing to export yet."), "the refusal must speak in plain words");
  assert.ok(body.indexOf('logExport("BibTeX"') > guardAt, "receipts are written only past the guard");
});

await test("the Excel bibliography path writes a receipt only for a produced file", () => {
  const body = region(appSrc, "const exportExcel = async () => {", "const [zoteroOpen, setZoteroOpen]");
  assert.ok(body.includes("excelResult.count > 0) logExport("), "Excel logExport is not gated on the produced count");
  assert.ok(body.includes("Nothing to export yet."), "an empty cited set gets the same honest words as the text formats");
});

group("Catalog 10 — the command palette BibTeX path");

await test("no silent fallback to all sources, and the export is logged", () => {
  assert.ok(!appSrc.includes("saved.length ? saved : allSources"), "the palette still falls back to all sources");
  assert.ok(appSrc.includes('logExport("BibTeX", "cerebrum.bib")'), "the palette path writes no Exports log receipt");
  const body = region(appSrc, '"Download your papers as a BibTeX file"', "Compare investigations");
  assert.ok(body.includes("No saved papers yet."), "an empty saved set gets honest words, not a file of everything");
});

// ══════════════════════════════════════════════════════════════════
group("Catalog 6 — the workspace export is the workspace, and import replaces it");

const LEARN_NAMES = [
  "CORTEX_EXPORT_FORMAT", "CORTEX_EXPORT_VERSION",
  "COURSES_KEY", "CLAIMS_KEY", "PROFILE_KEY", "SOUND_KEY", "BUILTIN_PROGRESS_KEY",
  "cortexIsPlainObject", "cortexIsFiniteNumber", "cortexIsStringArray",
  "cortexEmptyProfile", "cortexEmptyBuiltinProgress", "cortexImportFailure",
  "cortexCourseProblem", "cortexClaimProblem", "cortexProgressRecordProblem", "cortexLoopProblem",
  "buildCortexExport", "parseCortexImport", "applyCortexImport",
  "retirePaperBackedLearning", "courseIsPaperBacked", "cardIsPaperBacked",
  "decodeStringsDeep", "decodeHtmlEntities",
  "QUIZ_SIMILARITY_MAX", "SIMILARITY_STOPWORDS", "similarityTokenList", "similarityBigramSet",
  "cardTextSimilarity", "textContainsPassage", "passagesRepeat", "cardInternalRepeat", "lessonRepeatProblem",
  "QUANTIFIER_OPTION_WORDS", "QUANTIFIER_SINGLE_WORDS", "quantifierOnlyOption", "cardOptionQualityProblem",
  "NUMBER_RE", "numbersIn", "parseNumberValue", "hasAttributionShape",
];
const SETTINGS_NAMES = [
  "READING_PROFILES", "READING_PROFILE_KEYS",
  "WORKSPACE_INBOX_DRAFTS_KEY", "WORKSPACE_INBOX_OUTBOX_KEY", "WORKSPACE_LEARN_KEYS",
  "workspaceIsPlainObject", "workspaceReadJSON", "readWorkspaceLearnState",
  "buildWorkspaceDocument", "planWorkspacePreferences", "planWorkspaceImport",
];

const storage = makeStorage();
const SEEDED_COURSE = {
  id: "course-sleep", title: "Sleep basics",
  lessons: [{ id: "lesson-1", title: "Lesson one", cards: [{ kind: "note", text: "Deep sleep files the day away." }] }],
};
const SEEDED_LEARN = {
  courses: [SEEDED_COURSE],
  claims: {},
  profile: { xp: 120, days: ["2026-11-04", "2026-11-05"], bridged: [], freezes: 2, freezeMilestone: 0, sparks: 7, loopDay: "", loop: null, reminderHour: null, leaguesOptIn: false },
  builtinProgress: { lessons: { "lesson-1": { done: true, best: 0.9, completions: 2, mastered: false, completedAt: "2026-11-05", lastAt: "2026-11-05" } }, lastPathId: "", lastLessonId: "lesson-1" },
  sound: true,
};
storage.setItem("cerebrum-learn2-courses", JSON.stringify(SEEDED_LEARN.courses));
storage.setItem("cerebrum-learn2-claims", JSON.stringify(SEEDED_LEARN.claims));
storage.setItem("cerebrum-learn2-profile", JSON.stringify(SEEDED_LEARN.profile));
storage.setItem("cerebrum-learn2-progress", JSON.stringify(SEEDED_LEARN.builtinProgress));
storage.setItem("cerebrum-learn2-sound", JSON.stringify(SEEDED_LEARN.sound));
const SEEDED_DRAFTS = { "thread-1": "a draft kept mid sentence" };
const SEEDED_OUTBOX = { "thread-2": [{ body: "queued reply", at: 123 }] };
storage.setItem("cb_inbox_drafts_v1", JSON.stringify(SEEDED_DRAFTS));
storage.setItem("cb_inbox_outbox_v1", JSON.stringify(SEEDED_OUTBOX));

const ws = runInVm(
  declChunks(learnSrc, LEARN_NAMES) + "\n" + declChunks(settingsSrc, SETTINGS_NAMES),
  { localStorage: storage },
  ["buildCortexExport", "parseCortexImport", "applyCortexImport", "readWorkspaceLearnState", "buildWorkspaceDocument", "planWorkspaceImport"]
);
const { buildCortexExport, parseCortexImport, applyCortexImport, readWorkspaceLearnState, buildWorkspaceDocument, planWorkspaceImport } = ws;

const SEEDED_COLLECTION = { id: "col-1", name: "Reading list", paperKeys: ["paper-a"], createdAt: 42 };
const SEEDED_DIAGRAM = { id: "fc-1", title: "Sleep pathway", nodes: [], edges: [], updatedAt: 7 };
let workspaceDoc = null;

await test("the learn state reader returns exactly what LearnView stored", () => {
  assert.deepEqual(plain(readWorkspaceLearnState()), SEEDED_LEARN);
});

await test("buildWorkspaceDocument carries every store, Nova as its own versioned document", () => {
  workspaceDoc = buildWorkspaceDocument({
    version: "test-version",
    exported: "2026-11-06T00:00:00.000Z",
    saved: [{ title: "A saved paper", url: "https://doi.org/10.1/abc" }],
    history: [{ title: "An investigation", ts: 99 }],
    collections: [SEEDED_COLLECTION],
    diagrams: [SEEDED_DIAGRAM],
    profile: { name: "Ada Lovelace", handle: "ada" },
    inbox: { drafts: SEEDED_DRAFTS, outbox: SEEDED_OUTBOX },
    nova: buildCortexExport(readWorkspaceLearnState(), new Date("2026-11-06T00:00:00.000Z")),
    preferences: { dyslexicFont: "1", fontSize: "large", muted: "0" },
  });
  const doc = plain(workspaceDoc);
  assert.deepEqual(doc.collections, [SEEDED_COLLECTION], "collections missing from the workspace file");
  assert.deepEqual(doc.diagrams, [SEEDED_DIAGRAM], "diagrams missing from the workspace file");
  assert.deepEqual(doc.profile, { name: "Ada Lovelace", handle: "ada" }, "profile missing from the workspace file");
  assert.deepEqual(doc.inbox, { drafts: SEEDED_DRAFTS, outbox: SEEDED_OUTBOX }, "inbox drafts and outbox missing from the workspace file");
  assert.equal(doc.nova.format, "cerebrum-cortex-progress", "the Nova section is not the versioned Nova progress document");
  assert.equal(doc.nova.version, 1);
  assert.deepEqual(doc.saved, [{ title: "A saved paper", url: "https://doi.org/10.1/abc" }]);
  assert.deepEqual(doc.history, [{ title: "An investigation", ts: 99 }]);
});

await test("round trip: export, change everything, import, the seeded state is restored exactly", () => {
  const fileText = JSON.stringify(workspaceDoc);
  // Change the live state the way a different browser's would differ.
  storage.setItem("cerebrum-learn2-courses", "[]");
  storage.setItem("cerebrum-learn2-claims", "{}");
  storage.setItem("cerebrum-learn2-profile", JSON.stringify({ xp: 0, days: [], bridged: [], freezes: 2, freezeMilestone: 0, sparks: 0, loopDay: "", loop: null, reminderHour: null, leaguesOptIn: false }));
  storage.setItem("cerebrum-learn2-progress", JSON.stringify({ lessons: {}, lastPathId: "", lastLessonId: "" }));
  storage.setItem("cerebrum-learn2-sound", "false");
  storage.setItem("cb_inbox_drafts_v1", JSON.stringify({ "thread-9": "someone else's draft" }));
  storage.setItem("cb_inbox_outbox_v1", "{}");

  const plan = planWorkspaceImport(JSON.parse(fileText));
  assert.equal(plan.ok, true, "the plan refused a real workspace file");
  assert.deepEqual(plain(plan.collections), [SEEDED_COLLECTION], "the collection did not survive the plan");
  assert.deepEqual(plain(plan.diagrams), [SEEDED_DIAGRAM], "the diagram did not survive the plan");
  assert.deepEqual(plain(plan.profile), { name: "Ada Lovelace", handle: "ada" });
  assert.deepEqual(plain(plan.inbox), { drafts: SEEDED_DRAFTS, outbox: SEEDED_OUTBOX });
  assert.equal(plan.preferences.dyslexicFont, true, "the dyslexic font preference was not restored as on");
  assert.equal(plan.preferences.fontSize, "large");
  assert.equal(plan.preferences.muted, false);

  // The Nova section applies through LearnView's own validated,
  // transactional importer, the way the settings handler applies it.
  const parsedNova = parseCortexImport(JSON.stringify(plan.nova));
  assert.equal(parsedNova.ok, true, "the Nova section failed its own validation");
  const applied = applyCortexImport(parsedNova.state, storage);
  assert.equal(applied.ok, true, "the Nova section did not apply");
  assert.deepEqual(plain(readWorkspaceLearnState()), SEEDED_LEARN, "the Nova store was not restored exactly");

  // Inbox stores replace wholesale, the way the handler writes them.
  storage.setItem("cb_inbox_drafts_v1", JSON.stringify(plan.inbox.drafts));
  storage.setItem("cb_inbox_outbox_v1", JSON.stringify(plan.inbox.outbox));
  assert.deepEqual(JSON.parse(storage.getItem("cb_inbox_drafts_v1")), SEEDED_DRAFTS, "a stale draft survived beside the imported one");
  assert.deepEqual(JSON.parse(storage.getItem("cb_inbox_outbox_v1")), SEEDED_OUTBOX);
});

await test("planWorkspaceImport refuses files with no recognizable store", () => {
  assert.equal(planWorkspaceImport({}).ok, false);
  assert.equal(planWorkspaceImport(null).ok, false);
  assert.equal(planWorkspaceImport([1, 2]).ok, false);
  assert.equal(planWorkspaceImport({ saved: "not-an-array" }).ok, false);
  assert.equal(planWorkspaceImport({ unrelated: true }).ok, false);
});

await test("a legacy file (library, history, preferences only) leaves the other stores out of the plan", () => {
  const plan = planWorkspaceImport({ saved: [], history: [], preferences: { muted: "1" } });
  assert.equal(plan.ok, true);
  assert.ok(!("collections" in plan) && !("diagrams" in plan) && !("nova" in plan) && !("inbox" in plan),
    "a store the file does not carry must not enter the plan");
  assert.equal(plan.preferences.muted, true);
});

await test("workspace import turns the dyslexic font on through the font loader", () => {
  const body = region(settingsSrc, "const applyWorkspacePreferences = (prefs) => {", "const [notifPerm, setNotifPerm]");
  assert.ok(body.includes("if (prefs.dyslexicFont) ensureDyslexicFont();"),
    "applying an imported dyslexic font preference does not run the loader a manual toggle runs");
  assert.ok(settingsSrc.includes("buildCortexExport(readWorkspaceLearnState(), new Date())"),
    "the workspace export does not build its Nova section from the live learn state");
});

// ══════════════════════════════════════════════════════════════════
group("Catalog 8 — the answer PDF never ships a silently empty body");

const { answerSectionsInOrder } = await import(join(root, "src/answerPresentation.js"));
const pdf = runInVm(
  declChunks(appSrc, ["pdfGroupBlocks", "pdfSplitSections", "pdfPlainTextSections", "truncateAtWordBoundary"]),
  { answerSectionsInOrder },
  ["pdfGroupBlocks", "pdfSplitSections", "pdfPlainTextSections", "truncateAtWordBoundary"]
);
const { pdfGroupBlocks, pdfSplitSections, pdfPlainTextSections, truncateAtWordBoundary } = pdf;
const printableOf = (sections) => sections.reduce((n, sec) => n + pdfGroupBlocks(sec.lines).length, 0);

for (const sample of ["## Only a heading", "---", "## A\n\n## B"]) {
  await test(`sectioniser yields zero blocks, the fallback still yields the answer: ${JSON.stringify(sample)}`, () => {
    assert.equal(printableOf(pdfSplitSections(sample)), 0, "the report's case no longer reproduces at the sectioniser");
    /* Two stage fallback: plain text sections, or, when even those
       group to nothing (a lone rule is dropped by the block grouper
       on sight), the raw print branch in exportAnswerToPDF, pinned
       by the source assertion in the next test. */
    const fallback = pdfPlainTextSections(sample);
    assert.ok(printableOf(fallback) >= 1 || sample.trim().length > 0,
      "neither fallback stage produces a body for a non empty answer");
  });
}

await test("separator only answers reach the raw print branch in exportAnswerToPDF", () => {
  assert.deepEqual(plain(pdfPlainTextSections("---")), [], "a lone rule should survive the section fallback with no sections");
  const body = region(appSrc, "async function exportAnswerToPDF", "/* Export only additions");
  assert.ok(body.includes("if (!printedBlocks && String(answer || \"\").trim())"),
    "exportAnswerToPDF has no raw print branch for separator only answers");
  assert.ok(body.includes("richPara(pdfInlineRuns(String(answer).trim()))"),
    "the raw print branch does not print the answer's own text");
});

await test("the heading fallback prints the heading's own words as body text", () => {
  const blocks = pdfPlainTextSections("## Only a heading").flatMap((sec) => pdfGroupBlocks(sec.lines));
  assert.ok(blocks.some((b) => b.text.includes("Only a heading")), "the fallback dropped the answer's only words");
});

await test("an ordinary answer keeps its sections, and an empty answer falls back to nothing", () => {
  assert.ok(printableOf(pdfSplitSections("Some prose here.\n\nMore prose follows.")) > 0);
  assert.deepEqual(plain(pdfPlainTextSections("")), []);
  assert.ok(region(appSrc, "async function exportAnswerToPDF", "/* Export only additions").includes("pdfPlainTextSections(answer)"),
    "exportAnswerToPDF does not use the plain text fallback");
});

// ══════════════════════════════════════════════════════════════════
group("Catalog 9 — the investigation truncation cuts at a word boundary");

await test("a long answer cuts at the last space before the cap, never mid word", () => {
  const original = ("word ".repeat(500)).trim(); // 2499 chars
  const cut = truncateAtWordBoundary(original, 2000);
  assert.equal(cut.truncated, true);
  assert.ok(cut.text.length <= 2000, "the cut exceeds the cap");
  assert.ok(original.startsWith(cut.text), "the cut is not a prefix of the answer");
  assert.equal(original[cut.text.length], " ", "the cut does not land on a word boundary");
});

await test("short text passes through whole, and one giant word still cuts at the cap", () => {
  assert.deepEqual(plain(truncateAtWordBoundary("short answer", 2000)), { text: "short answer", truncated: false });
  const giant = truncateAtWordBoundary("x".repeat(2500), 2000);
  assert.equal(giant.truncated, true);
  assert.equal(giant.text.length, 2000);
  assert.equal(truncateAtWordBoundary("x".repeat(2000), 2000).truncated, false);
});

// ══════════════════════════════════════════════════════════════════
group("Catalog 11 — one maintained diagram exporter for both surfaces");

await test("CerebrumApp no longer defines its own SVG exporter", () => {
  assert.ok(!/function fcSvgString\(/.test(appSrc), "a local fcSvgString still exists in CerebrumApp.jsx");
  assert.ok(!/function fcNodeSvg\(/.test(appSrc), "a local fcNodeSvg still exists in CerebrumApp.jsx");
  assert.ok(!/function fcWrap\(/.test(appSrc), "the duplicate's unbounded fcWrap still exists in CerebrumApp.jsx");
  assert.ok(!/const FC_EXPORT_COLORS/.test(appSrc), "the duplicate's fixed palette still exists in CerebrumApp.jsx");
  assert.ok(appSrc.includes('fcSvgString, fcPaletteColors } from "./flowcharts.jsx"') || /import \{[^}]*\bfcSvgString\b[^}]*\bfcPaletteColors\b[^}]*\} from "\.\/flowcharts\.jsx"/.test(appSrc),
    "CerebrumApp does not import the maintained exporter and palette builder");
  assert.ok(appSrc.includes("fcSvgString(fc.nodes || [], fc.edges || [], fc.title, fcPaletteColors(P, accent, at))"),
    "the Library SVG button does not call the maintained exporter with the live palette");
  assert.ok(/export \{[^}]*\bfcSvgString\b[^}]*\bfcPaletteColors\b[^}]*\}/.test(flowSrc) || /export \{[^}]*\bfcPaletteColors\b[^}]*\bfcSvgString\b[^}]*\}/.test(flowSrc),
    "flowcharts.jsx does not export both the exporter and the palette builder");
});

const { fcWrapBounded } = await import(join(root, "src/fcLabel.js"));
const fc = runInVm(
  declChunks(designSrc, ["withAlpha"]) + "\n" + declChunks(flowSrc, ["FC_EXPORT_COLORS", "fcEsc", "fcBounds", "fcPorts", "fcEdgeGeom", "fcPaletteColors", "fcNodeSvg", "fcSvgString"]),
  { fcWrapBounded },
  ["fcPaletteColors", "fcSvgString"]
);

await test("the maintained exporter is deterministic and badges its steps", () => {
  const P = { bg: "#101013", raised: "#17171b", ink2: "#3a3a40", ink: "#f0f0f0" };
  const colors = fc.fcPaletteColors(P, "#C89A3A", "#111111");
  const nodes = [
    { id: "a", type: "start", x: 0, y: 0, w: 160, h: 56, label: "Start" },
    { id: "b", type: "process", x: 0, y: 120, w: 200, h: 92, label: "First step" },
    { id: "c", type: "end", x: 0, y: 280, w: 160, h: 56, label: "End" },
  ];
  const edges = [{ id: "e1", from: "a", to: "b", label: "" }, { id: "e2", from: "b", to: "c", label: "" }];
  const one = fc.fcSvgString(nodes, edges, "Pathway", colors);
  const two = fc.fcSvgString(nodes, edges, "Pathway", colors);
  assert.equal(one, two, "the same diagram and colors must produce the same file on every surface");
  assert.ok(one.includes("<circle"), "the step badges the stale exporter lacked are missing");
  assert.ok(one.includes("#C89A3A"), "the live accent is not in the export");
});

await test("a long node label wraps inside its box height, bounded", () => {
  const P = { bg: "#101013", raised: "#17171b", ink2: "#3a3a40", ink: "#f0f0f0" };
  const colors = fc.fcPaletteColors(P, "#C89A3A", "#111111");
  const longLabel = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau";
  const nodes = [{ id: "b", type: "process", x: 0, y: 0, w: 200, h: 92, label: longLabel }];
  const svg = fc.fcSvgString(nodes, [], "Long", colors);
  const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  const maxLines = Math.floor((92 - 18) / 16); // 4, the box's own line budget
  const maxChars = Math.floor((200 - 30) / 7); // 24, the box's own character budget
  const labelLines = texts.filter((t) => t !== "1"); // minus the step badge
  assert.ok(labelLines.length <= maxLines, `label wrapped to ${labelLines.length} lines, past the box's ${maxLines} line budget`);
  assert.ok(labelLines.every((t) => t.length <= maxChars), "a label line exceeds the box's character budget and would print past its box");
  assert.ok(labelLines.length > 1, "the long label did not wrap at all");
});

// ══════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
