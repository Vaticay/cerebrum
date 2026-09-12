/**
 * Excel-export tests: src/exportExcel.js.
 *
 * The workbook is built in node (no DOM): the logo path is skipped without
 * crashing, writeBuffer must produce a non-empty .xlsx, the 20-paper cap
 * must hold, hyperlink cells must carry real URLs, and hostile URLs must
 * never become clickable cells.
 *
 * Unit tests against the real module — no server, no network.
 * Run with: node tests/export-excel.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildPapersWorkbook, exportPapersToExcel } = await import(join(root, "src/exportExcel.js"));

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

const FAKE_PAPERS = [
  {
    title: "CRISPR–Cas9 structures and mechanisms",
    authors: "Jiang, F., Doudna, J. A.",
    journal: "Annual Review of Biophysics",
    year: "2017",
    url: "https://doi.org/10.1146/annurev-biophys-062215-010822",
  },
  {
    title: "Development and applications of CRISPR–Cas9 for genome engineering",
    authors: ["Hsu, P. D.", "Lander, E. S.", "Zhang, F."],
    journal: "Cell",
    year: 2014,
    url: "https://doi.org/10.1016/j.cell.2014.05.010",
  },
  {
    title: "A paper with missing fields",
    // no authors, journal, year, url
  },
];

// ══════════════════════════════════════════════════════════════════════════
group("buildPapersWorkbook — real .xlsx output in node (no DOM)");

await test("writeBuffer produces a non-empty xlsx buffer", async () => {
  const { workbook } = await buildPapersWorkbook(FAKE_PAPERS, {});
  const buf = await workbook.xlsx.writeBuffer();
  assert.ok(buf && buf.byteLength > 4000, `buffer too small: ${buf && buf.byteLength}`);
  // ZIP magic: a .xlsx is a zip archive.
  const head = Buffer.from(buf).subarray(0, 2).toString("latin1");
  assert.equal(head, "PK", "buffer is not a zip/.xlsx payload");
});

await test("the 20-paper cap holds", async () => {
  const many = Array.from({ length: 35 }, (_, i) => ({ title: `Paper ${i + 1}` }));
  const { workbook, count } = await buildPapersWorkbook(many, {});
  assert.equal(count, 20, `expected 20, got ${count}`);
  const ws = workbook.getWorksheet("Top papers");
  assert.equal(ws.rowCount, 25, `expected 25 rows (5 chrome + 20 papers), got ${ws.rowCount}`);
});

await test("header row is styled with the accent fill and frozen", async () => {
  const { workbook } = await buildPapersWorkbook(FAKE_PAPERS, { accent: "#8ba888" });
  const ws = workbook.getWorksheet("Top papers");
  const header = ws.getRow(5);
  assert.equal(header.getCell(2).value, "Title");
  assert.ok(header.getCell(2).font.bold, "header not bold");
  assert.equal(header.getCell(2).fill.fgColor.argb, "FF8BA888", "accent fill not applied");
  assert.equal(ws.views[0].state, "frozen", "panes not frozen");
  assert.equal(ws.views[0].ySplit, 5, "freeze split not below the header");
  assert.ok(ws.autoFilter, "autofilter missing");
});

await test("paper rows carry titles, joined authors and a real hyperlink", async () => {
  const { workbook } = await buildPapersWorkbook(FAKE_PAPERS, {});
  const ws = workbook.getWorksheet("Top papers");
  const r1 = ws.getRow(6);
  assert.equal(r1.getCell(1).value, 1);
  assert.match(r1.getCell(2).value, /CRISPR–Cas9 structures/);
  const link = r1.getCell(6).value;
  assert.equal(link.text, "Open");
  assert.equal(link.hyperlink, "https://doi.org/10.1146/annurev-biophys-062215-010822");
  // Array authors are joined; numeric year is stringified.
  const r2 = ws.getRow(7);
  assert.equal(r2.getCell(3).value, "Hsu, P. D., Lander, E. S., Zhang, F.");
  assert.equal(r2.getCell(5).value, "2014");
});

await test("missing fields never crash and hostile URLs are not linked", async () => {
  const { workbook } = await buildPapersWorkbook(
    [
      { title: "Evil", url: "javascript:alert(1)" },
      { title: "Data", url: "data:text/html,<script>alert(1)</script>" },
      null,
      "not an object",
    ],
    {}
  );
  const ws = workbook.getWorksheet("Top papers");
  assert.equal(ws.getRow(6).getCell(6).value, null, "javascript: URL became a cell value");
  assert.equal(ws.getRow(7).getCell(6).value, null, "data: URL became a cell value");
  assert.doesNotThrow(() => ws.getRow(8).getCell(2).value);
});

await test("logo is skipped without crashing outside a DOM", async () => {
  assert.equal(typeof document, "undefined", "test expects no DOM");
  const { workbook } = await buildPapersWorkbook(FAKE_PAPERS, { logoSvg: "<svg></svg>" });
  assert.ok(workbook.getWorksheet("Top papers"), "worksheet missing after logo skip");
});

await test("custom title, subtitle and filename flow through", async () => {
  const { workbook } = await buildPapersWorkbook(FAKE_PAPERS, {
    title: "My custom title",
    subtitle: "my query · 2026-09-12",
  });
  const ws = workbook.getWorksheet("Top papers");
  assert.equal(ws.getCell("A2").value, "My custom title");
  assert.equal(ws.getCell("A3").value, "my query · 2026-09-12");
  const res = await exportPapersToExcel(FAKE_PAPERS, { filename: "custom.xlsx" });
  assert.deepEqual(res, { count: 3, filename: "custom.xlsx" });
});

await test("exportPapersToExcel defaults the filename and counts papers", async () => {
  const res = await exportPapersToExcel(FAKE_PAPERS, {});
  assert.deepEqual(res, { count: 3, filename: "cerebrum-papers.xlsx" });
  const empty = await exportPapersToExcel(null, {});
  assert.equal(empty.count, 0);
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
