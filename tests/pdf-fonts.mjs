/**
 * PDF font tests: src/pdfFonts.js and the TTF assets it embeds.
 *
 * Added 2026-10-20 (design audit H14 remainder). The answer PDF used
 * to set its serif and sans roles in the jsPDF built in times and
 * helvetica faces. These tests pin the replacement: real static
 * TrueType faces for Source Serif 4 and Inter ship under
 * public/fonts/ttf/, the loader registers them on a real jsPDF
 * document, the generated PDF really embeds them, and a failed load
 * throws instead of passing silently.
 *
 * Unit tests against the real module and the real font files, plus
 * source pins on the builder wiring in src/CerebrumApp.jsx.
 * No server, no network: font bytes are read from disk through the
 * loader's fetchBytes seam, the same seam the browser fetch uses.
 * Run with: node tests/pdf-fonts.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const pdfFonts = await import(join(root, "src/pdfFonts.js"));
const { PDF_FONT_SPECS, PDF_SERIF_FAMILY, PDF_SANS_FAMILY, registerPdfFonts } = pdfFonts;

const fetchBytesFromDisk = async (spec) => readFileSync(join(root, "public", spec.path));

/* Minimal TTF table directory read: tag list, so a variable font
   (fvar table) or a non TrueType file cannot slip in as a face. */
function ttfTags(buf) {
  const numTables = buf.readUInt16BE(4);
  const tags = [];
  for (let i = 0; i < numTables; i++) tags.push(buf.subarray(12 + i * 16, 16 + i * 16).toString("latin1"));
  return tags;
}
function utf16be(text) {
  const out = [];
  for (const ch of text) { out.push(0, ch.charCodeAt(0)); }
  return Buffer.from(out);
}

// ══════════════════════════════════════════════════════════════════════════
group("TTF assets: the faces the loader promises are really in the repo");

await test("every spec file exists under public/fonts/ttf and is a static TrueType face", () => {
  assert.equal(PDF_FONT_SPECS.length, 8, `expected 8 faces, got ${PDF_FONT_SPECS.length}`);
  for (const spec of PDF_FONT_SPECS) {
    const p = join(root, "public", spec.path);
    assert.ok(existsSync(p), `missing font file ${spec.path}`);
    const buf = readFileSync(p);
    assert.ok(buf.length > 50000, `${spec.file} is suspiciously small: ${buf.length}`);
    assert.equal(buf.subarray(0, 4).toString("hex"), "00010000", `${spec.file} lacks TrueType magic`);
    assert.ok(!ttfTags(buf).includes("fvar"), `${spec.file} is a variable font (fvar table present)`);
  }
});

await test("the serif family carries all four styles and the sans carries at least normal and bold", () => {
  const serifStyles = PDF_FONT_SPECS.filter((s) => s.family === PDF_SERIF_FAMILY).map((s) => s.style).sort();
  assert.deepEqual(serifStyles, ["bold", "bolditalic", "italic", "normal"]);
  const sansStyles = PDF_FONT_SPECS.filter((s) => s.family === PDF_SANS_FAMILY).map((s) => s.style);
  assert.ok(sansStyles.includes("normal") && sansStyles.includes("bold"), `sans styles: ${sansStyles}`);
});

await test("each TTF name table names its own family", () => {
  for (const spec of PDF_FONT_SPECS) {
    const buf = readFileSync(join(root, "public", spec.path));
    const familyName = spec.family === PDF_SERIF_FAMILY ? "Source Serif 4" : "Inter";
    assert.ok(buf.includes(utf16be(familyName)), `${spec.file} name table does not name ${familyName}`);
  }
});

await test("the OFL license text and a sources note sit next to the fonts", () => {
  const dir = join(root, "public/fonts/ttf");
  for (const name of ["OFL.txt", "SOURCES.md"]) {
    assert.ok(existsSync(join(dir, name)), `missing ${name}`);
  }
  assert.match(readFileSync(join(dir, "OFL.txt"), "utf8"), /SIL OPEN FONT LICENSE Version 1\.1/);
  const sources = readFileSync(join(dir, "SOURCES.md"), "utf8");
  assert.match(sources, /Source Serif 4/);
  assert.match(sources, /Inter/);
  assert.match(sources, /SIL Open Font License 1\.1/);
});

// ══════════════════════════════════════════════════════════════════════════
group("registerPdfFonts: real registration on a real jsPDF document");

await test("registers both families with every style and the PDF embeds them", async () => {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const registered = await registerPdfFonts(doc, { fetchBytes: fetchBytesFromDisk });
  assert.equal(registered.serif, PDF_SERIF_FAMILY);
  assert.equal(registered.sans, PDF_SANS_FAMILY);
  assert.equal(registered.registered.length, 8);
  const list = doc.getFontList();
  for (const spec of PDF_FONT_SPECS) {
    assert.ok((list[spec.family] || []).includes(spec.style), `getFontList missing ${spec.family} ${spec.style}`);
  }
  doc.setFont(PDF_SERIF_FAMILY, "italic"); doc.setFontSize(11);
  doc.text("Hermetia illucens", 72, 72);
  doc.setFont(PDF_SANS_FAMILY, "bold"); doc.setFontSize(14);
  doc.text("Heading", 72, 100);
  const pdfText = Buffer.from(doc.output("arraybuffer")).toString("latin1");
  assert.ok(pdfText.includes("/FontFile2"), "generated PDF has no embedded FontFile2 stream");
  assert.ok(pdfText.includes("/BaseFont /" + PDF_SERIF_FAMILY), "generated PDF does not name the serif family");
  assert.ok(pdfText.includes("/BaseFont /" + PDF_SANS_FAMILY), "generated PDF does not name the sans family");
});

await test("a failed font load throws, so the builder fallback is a visible branch", async () => {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  await assert.rejects(
    () => registerPdfFonts(doc, { fetchBytes: async () => { throw new Error("network down"); } }),
    /network down/
  );
  const doc2 = new jsPDF({ unit: "pt", format: "letter" });
  await assert.rejects(
    () => registerPdfFonts(doc2, { fetchBytes: async () => Buffer.from("not a font at all") }),
    /not a TrueType file/
  );
});

// ══════════════════════════════════════════════════════════════════════════
group("Builder wiring: CerebrumApp routes its roles through the loader");

await test("exportAnswerToPDF registers the embedded faces and keeps built ins only as logged fallback", () => {
  const src = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
  const start = src.indexOf("async function exportAnswerToPDF");
  const end = src.indexOf("async function saveToZotero", start);
  assert.ok(start > 0 && end > start, "PDF builder not found");
  const builder = src.slice(start, end);
  assert.ok(builder.includes('await import("./pdfFonts.js")'), "builder does not lazy load pdfFonts");
  assert.ok(builder.includes("registerPdfFonts(doc)"), "builder does not register the embedded fonts");
  assert.ok(builder.includes('let PDF_SERIF_FONT = "times"'), "serif fallback is not the built in face");
  assert.ok(builder.includes('let PDF_SANS_FONT = "helvetica"'), "sans fallback is not the built in face");
  assert.ok(builder.includes("console.error"), "font failure is not logged in the builder");
  assert.ok(!/setFont\(\s*"(times|helvetica)"/.test(builder), "builder sets a built in face directly somewhere");
  assert.ok(statSync(join(root, "src/pdfFonts.js")).size > 1000, "pdfFonts module is missing or empty");
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
