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

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
