/**
 * Document Reader redesign regressions (2026-10-13).
 *
 * The surface was renamed to match what people call it, the source
 * pane became a desk with a status readout, analysis errors became a
 * real alert with a retry, the empty reader now shows the four part
 * report it produces, the analysis masthead carries a section index
 * that marks missing sections honestly, and one stale line of copy
 * (follow up questions costing a document read, which the backend
 * has not charged for since the QA gate fix) is corrected.
 *
 * Run with: node tests/document-reader-redesign.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");

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

await test("the surface is named Document Reader where people see it", () => {
  assert.ok(appSrc.includes('["document", "Document Reader", "bookOpen"]'), "nav label not renamed");
  assert.ok(appSrc.includes('document: "Document Reader"'), "mobile title not renamed");
  assert.ok(appSrc.includes(">Document Reader</h1>"), "page heading not renamed");
});

await test("the source pane has a desk header with a read status chip", () => {
  assert.ok(appSrc.includes("The document"), "desk header missing");
  assert.ok(appSrc.includes("Ready to inspect"), "status chip missing");
  assert.ok(appSrc.includes("Analyzed"), "analyzed state missing");
});

await test("analysis errors render as an alert with a retry", () => {
  assert.ok(appSrc.includes('role="alert"'), "alert role missing");
  assert.ok(appSrc.includes("Try again"), "retry action missing");
});

await test("the empty reader shows the four part report it produces", () => {
  assert.ok(appSrc.includes("The reading desk"), "desk panel missing");
  assert.ok(appSrc.includes("Findings and limitations"), "report outline missing");
  assert.ok(appSrc.includes("Follow up questions"), "report outline missing its questions row");
});

await test("the masthead section index marks missing sections honestly", () => {
  assert.ok(appSrc.includes("Report sections"), "section index missing");
  assert.ok(appSrc.includes('" · missing"'), "missing marker missing");
});

await test("follow up copy no longer claims questions cost a read", () => {
  assert.ok(!appSrc.includes("Each question uses one of your document reads."), "stale cost copy is back");
  assert.ok(appSrc.includes("do not use another document read"), "corrected copy missing");
});

await test("analysis prose is capped at a reading measure", () => {
  assert.ok(appSrc.includes(".cb-doc-analysis-card .cb-doc-reader { max-width: 72ch; }"), "measure cap missing");
});

await test("the sample action can no longer replace a loaded document", () => {
  assert.ok(appSrc.includes("Inspect this document"), "loaded document CTA missing");
});

await test("progress names the synthesis phase instead of mislabeling it", () => {
  assert.ok(appSrc.includes("Writing your summary…"), "reduce phase label missing");
  assert.ok(appSrc.includes("(done, total, phase)"), "phase is dropped by the analyze handler");
});

await test("questions and comparisons get the backend's full time budget", () => {
  const n = appSrc.split("timeoutMs: 120000").length - 1;
  assert.ok(n >= 3, `expected at least 3 long timeout call sites, found ${n}`);
});

await test("compare refuses an oversized combined payload up front", () => {
  assert.ok(appSrc.includes("240,000 characters combined"), "combined compare guard missing");
});

await test("the masthead names the summarizer in human terms", () => {
  assert.ok(appSrc.includes("Summarized by AI"), "human model label missing");
  assert.ok(appSrc.includes("Basic extract · the AI service was unreachable"), "extractive notice missing");
  assert.ok(!appSrc.includes("Analyzed by {summary.model}"), "raw model id is printed again");
});

await test("the shelf shows every stored document, with dates", () => {
  assert.ok(appSrc.includes("recentDocs.slice(0, 8)"), "shelf still hides stored documents");
});

await test("a partial analysis resumes from its finished sections", () => {
  assert.ok(appSrc.includes("priorSections: resumeSections"), "client never sends priorSections");
  assert.ok(appSrc.includes("summary.partial && Array.isArray(summary.sections)"), "resume is not gated on a partial summary");
});

await test("the reading engine detects headings and segments partition the text", async () => {
  const { detectDocHeadings, buildDocSegments } = await import(new URL("../src/docReader.js", import.meta.url));
  const text = [
    "Enzyme Activity in Insect Gut Homogenate",
    "",
    "Abstract",
    "We measured activity in crude extracts from the midgut and report the rates here in full detail.",
    "",
    "1. Methods",
    "Guts were dissected and homogenized in cold buffer before the assay began in earnest.",
    "This sentence is not a heading even though it follows a heading line directly.",
    "",
    "RESULTS AND DISCUSSION",
    "Activity rose with temperature across every replicate that we ran during the spring season.",
  ].join("\n");
  const heads = detectDocHeadings(text);
  const titles = heads.map((h) => h.title);
  assert.ok(titles.includes("Abstract"), "title case heading missed: " + titles.join(" | "));
  assert.ok(titles.includes("1. Methods"), "numbered heading missed");
  assert.ok(titles.includes("RESULTS AND DISCUSSION"), "all caps heading missed");
  assert.ok(!titles.some((t) => t.startsWith("This sentence")), "a body sentence was promoted to a heading");
  const segs = buildDocSegments(text, heads);
  assert.equal(segs.map((s) => s.text).join(""), text, "segments must partition the text exactly or highlight offsets drift");
  assert.ok(segs.some((s) => s.heading === "Abstract"), "no segment carries the Abstract heading");
  const docSrc = await (await import("node:fs/promises")).readFile(new URL("../functions/api/document.js", import.meta.url), "utf8");
  assert.ok(!docSrc.includes("[Note: this document is"), "truncation note is back in the prose");
  assert.ok(!docSrc.includes("[Note: this account's monthly AI token budget"), "budget note is back in the prose");
});

await test("machine notes no longer sit inside the reading matter", async () => {
  const { readFile } = await import("node:fs/promises");
  const docSrc = await readFile(new URL("../functions/api/document.js", import.meta.url), "utf8");
  assert.ok(!docSrc.includes("Best-effort summary: the AI service was unreachable, so the key passages"), "extract note is back in the prose");
  assert.ok(!docSrc.includes("answer: r.answer + missingNote"), "missing sections note is back in the answer");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
