/**
 * Document Mode — regression tests for the nine proven defects of the
 * 2026-11-06 site wide debug, Documents lane
 * (~/workspace/cerebrum-site-debug-nov06/documents/report.md).
 *
 * The lane's harness probes (real jsPDF PDFs through the repo's pdfjs)
 * are translated here into synthetic pdf.js text items with the same
 * geometry, so they run in the suite with no PDF generation:
 *  1. Two column pages with a short centered line (affiliation,
 *     footnote) interleaved the columns line by line, because the
 *     spanning line closed the gutter in findPdfColumnSplit.
 *  5. Hyphenated line breaks ("atten-" / "tion") never rejoined.
 *  6. HTML uploads kept hex entities (&#x2019;) literal.
 *  7. Titles of 12 characters or fewer never won ("On Sleep").
 * The component level defects are pinned by source assertion, the
 * technique tests/document-rewrite.mjs already uses:
 *  2. The dyslexic stylesheet was committed with no .css extension,
 *     so /fonts/opendyslexic.css served the app shell.
 *  3. Jump to this passage silently returned in the Source view.
 *  4. Any dropped file was ingested; an empty file wiped the open one.
 *  8. Find presented its 500 match navigation cap as the total.
 *  9. The outline silently sliced at 16 headings.
 *
 * Run with: node tests/document-debug-fixes-nov06.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, access } from "node:fs/promises";

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

const { extractHtmlText, docTitleOf, pdfPagesToText } = await import(join(root, "src/docReader.js"));
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const appUtilsSrc = await readFile(join(root, "src/appUtils.js"), "utf8");

/* ── Synthetic pdf.js items ────────────────────────────────────────
   pdf.js text items carry the string, a transform whose [4] and [5]
   are the x and the baseline y measured from the BOTTOM of the page,
   and a width. The lane probes built letter pages (612 x 792) with
   jsPDF (y from the top), so y here is 792 minus the jsPDF y. */
const PAGE_H = 792;
function item(str, x, yTop, width, size = 10) {
  return { str, transform: [size, 0, 0, size, x, PAGE_H - yTop], width, height: size };
}

/* The probe page: two columns, margin 54, gutter 36, column width
   234 (left x 54, right x 324), a centered bold title, six lines per
   column, and one optional centered line of a given width. */
function twoColumnPage({ centerLine = null, centerWidth = 0, centerY = 84, pageNumber = false, columnFootnote = false } = {}) {
  const items = [];
  items.push(item("SPANTITLE Marker ordering in two column papers", 116, 64, 380, 16));
  if (centerLine) items.push(item(centerLine, 306 - centerWidth / 2, centerY, centerWidth));
  for (let i = 1; i <= 6; i++) items.push(item(`LEFT${i} sentence of the left column body text.`, 54, 104 + i * 16, 190));
  for (let i = 1; i <= 6; i++) items.push(item(`RIGHT${i} sentence of the right column body text.`, 324, 104 + i * 16, 190));
  if (columnFootnote) items.push(item("FOOTNOTE set inside the left column width only.", 54, 300, 200, 8));
  if (pageNumber) items.push(item("742", 299, 760, 14, 9));
  return items;
}

function columnOrder(text) {
  const at = (m) => text.indexOf(m);
  return {
    interleaved: at("RIGHT1") >= 0 && at("RIGHT1") < at("LEFT6"),
    leftBlock: at("LEFT1") >= 0 && at("LEFT1") < at("LEFT6") && at("LEFT6") < at("RIGHT1"),
  };
}

group("defect 1 — two column PDFs with a spanning line keep column order");

for (const [label, width] of [["135pt affiliation", 135], ["213pt affiliation", 213], ["250pt centered footnote width", 250]]) {
  await test(`${label} no longer interleaves the columns`, () => {
    const text = pdfPagesToText([twoColumnPage({ centerLine: "CENTERLINE spanning the middle of the page", centerWidth: width })]);
    const order = columnOrder(text);
    assert.equal(order.interleaved, false, `columns interleaved: ${text.slice(0, 200)}`);
    assert.equal(order.leftBlock, true, "left column must read top to bottom before the right starts");
    assert.ok(text.includes("CENTERLINE"), "the spanning line itself must survive extraction");
    assert.ok(text.indexOf("SPANTITLE") < text.indexOf("LEFT1"), "title stays ahead of the columns");
    assert.ok(text.indexOf("CENTERLINE") < text.indexOf("LEFT1"), "a centered line above the columns stays ahead of them");
  });
}

await test("controls still extract in column order (no center line, 311pt line, page number, column width footnote)", () => {
  for (const page of [
    twoColumnPage({}),
    twoColumnPage({ centerLine: "CENTERLINE a long affiliation line", centerWidth: 311 }),
    twoColumnPage({ pageNumber: true }),
    twoColumnPage({ columnFootnote: true }),
  ]) {
    const text = pdfPagesToText([page]);
    const order = columnOrder(text);
    assert.equal(order.interleaved, false);
    assert.equal(order.leftBlock, true);
  }
  const foot = pdfPagesToText([twoColumnPage({ columnFootnote: true })]);
  assert.ok(foot.indexOf("FOOTNOTE") > foot.indexOf("LEFT6"), "a column width footnote stays at the foot of its own column");
  assert.ok(foot.indexOf("FOOTNOTE") < foot.indexOf("RIGHT1"), "and the right column still reads after the left, footnote included");
});

await test("a wide centered footnote at the page foot no longer interleaves narrow gutters", () => {
  // The lane's gutter sweep: margin 54, a centered abstract line and
  // a centered footnote, gutters 36 down to 8pt all interleaved.
  for (const gutter of [36, 18, 12, 8]) {
    const colW = (612 - 108 - gutter) / 2;
    const rightX = 54 + colW + gutter;
    const items = [item("SPANTITLE Marker ordering in two column papers", 116, 64, 380, 16)];
    items.push(item("Abstract spanline above both columns.", 171, 88, 270));
    for (let i = 1; i <= 10; i++) items.push(item(`LEFT${i} sentence of the left column body text.`, 54, 104 + i * 16, colW - 44));
    for (let i = 1; i <= 10; i++) items.push(item(`RIGHT${i} sentence of the right column body text.`, rightX, 104 + i * 16, colW - 44));
    items.push(item("FOOTNOTE spanline at the bottom of the page.", 181, 740, 250, 8));
    const text = pdfPagesToText([items]);
    assert.ok(text.indexOf("RIGHT1") > text.indexOf("LEFT10"), `gutter ${gutter}pt interleaved`);
    assert.ok(text.indexOf("FOOTNOTE") > text.indexOf("RIGHT10"), `gutter ${gutter}pt footnote misplaced`);
  }
});

await test("a single column page is untouched by the spanning retry", () => {
  const items = [
    item("First line of a plain single column document.", 54, 80, 300, 11),
    item("Second line directly below the first one.", 54, 96, 290, 11),
    item("Third line ends the short document body.", 54, 112, 280, 11),
  ];
  const text = pdfPagesToText([items]);
  assert.equal(text, "First line of a plain single column document.\nSecond line directly below the first one.\nThird line ends the short document body.");
});

group("defect 5 — hyphenated line breaks rejoin");

await test("a word broken with a hyphen rejoins, and Find can match it", () => {
  const items = [
    item("The treatment improved sustained atten-", 54, 80, 260, 11),
    item("tion scores in every participant group tested.", 54, 96, 300, 11),
    item("A second ordinary sentence follows here.", 54, 112, 280, 11),
  ];
  const text = pdfPagesToText([items]);
  assert.ok(text.includes("attention"), `expected the rejoined word in: ${JSON.stringify(text)}`);
  assert.equal(text.toLowerCase().indexOf("attention") >= 0, true, "Find in document searches this exact text");
  assert.ok(!text.includes("atten-"), "the break hyphen is gone");
});

await test("genuine hyphens stay: mid line compounds and a break before a capital", () => {
  const items = [
    item("A well-known result held across every group.", 54, 80, 290, 11),
    item("The byline names the author Smith-", 54, 96, 240, 11),
    item("Jones as the senior investigator on the work.", 54, 112, 300, 11),
  ];
  const text = pdfPagesToText([items]);
  assert.ok(text.includes("well-known"), "a compound inside one line is untouched");
  assert.ok(!text.includes("Smith-Jones"), "a break before a capital is not joined");
  assert.ok(text.includes("Smith-"), "the author's hyphen stays as printed");
});

group("defect 6 — HTML hex entities decode");

await test("hex entities decode alongside decimal ones", () => {
  assert.equal(extractHtmlText("<p>&#x48;ello world, this is a test.</p>"), "Hello world, this is a test.");
  assert.equal(extractHtmlText("<p>it&#x2019;s a saved web page body</p>"), "it\u2019s a saved web page body");
  assert.equal(extractHtmlText("<p>&#X41; hex with a capital X</p>"), "A hex with a capital X");
  assert.equal(extractHtmlText("<p>&#72;ello world, this is a test.</p>"), "Hello world, this is a test.");
});

group("defect 7 — short titles win");

await test("a short title set off by a blank line becomes the title", () => {
  const doc = "On Sleep\n\nSleep pressure builds across the waking day and clears overnight in every mammal studied so far.\nMore body text follows here.";
  assert.equal(docTitleOf(doc), "On Sleep");
  assert.equal(docTitleOf("Dream Work\n\nThe night shift of the mind sorts the day into what stays and what goes.\nMore text."), "Dream Work");
});

await test("the front matter screen still keeps short metadata out of the title slot", () => {
  const doc = "Received: 7 October 2025. Revised: 24 February 2026. Accepted: 12 March 2026\n\nOn Sleep\n\nSleep pressure builds across the waking day and clears overnight in every mammal studied so far.";
  assert.equal(docTitleOf(doc), "On Sleep");
  const keywords = "Keywords: sleep, circadian\n\nOn Sleep\n\nSleep pressure builds across the waking day and clears overnight in every mammal studied so far.";
  assert.equal(docTitleOf(keywords), "On Sleep");
});

await test("a short first line that is not set off does not steal the title", () => {
  const doc = "On Sleep\nSleep pressure builds across the waking day and clears overnight.";
  assert.equal(docTitleOf(doc), "Sleep pressure builds across the waking day and clears overnight.");
  const plain = "Sleep pressure builds across the waking day\nand clears overnight in every mammal studied so far.\nMore body text follows here.";
  // The pre existing wrapped title join (2026-10-19) takes the
  // lowercase continuation line, exactly as before this fix.
  assert.equal(docTitleOf(plain), "Sleep pressure builds across the waking day and clears overnight in every mammal studied so far.");
});

group("defect 2 — the dyslexic stylesheet exists at the URL the loader requests");

await test("public/fonts/opendyslexic.css is committed and the extensionless name is gone", async () => {
  await access(join(root, "public/fonts/opendyslexic.css"));
  await assert.rejects(access(join(root, "public/fonts/opendyslexic")), "the extensionless asset must not come back");
  const css = await readFile(join(root, "public/fonts/opendyslexic.css"), "utf8");
  assert.ok(css.includes("@font-face"), "the file at the URL is a stylesheet");
  assert.ok(css.includes("OpenDyslexic-Regular.woff"), "it declares the real OpenDyslexic faces");
  assert.ok(appUtilsSrc.includes('"/fonts/opendyslexic.css"'), "the loader still requests the matching URL");
});

group("defect 3 — jump to this passage switches to the Read view");

await test("a jump with no mounted read body is held and the view switches", () => {
  const jumpAt = appSrc.indexOf("const jumpToTextOffset");
  const jumpFn = appSrc.slice(jumpAt, appSrc.indexOf("const focusDocAsk", jumpAt));
  assert.ok(jumpFn.includes('pendingJumpRef.current = { offset, len }'), "the jump is held instead of dropped");
  assert.ok(jumpFn.includes('setSourceView("read")'), "the jump switches to the Read view");
  assert.ok(appSrc.includes("pendingJumpRef.current = null;\n    jumpToTextOffset(pending.offset, pending.len);"), "an effect runs the held jump once the view has switched");
  const ranAt = appSrc.indexOf("jumpToTextOffset(pending.offset, pending.len);");
  assert.ok(appSrc.slice(ranAt, ranAt + 90).includes("}, [sourceView]);"), "the effect is keyed on the view switch");
});

group("defect 4 — dropped files are gated by type, empty files refused");

await test("extractFileText refuses unknown types and empty text before any return of raw content", () => {
  const start = appSrc.indexOf("const extractFileText");
  const extract = appSrc.slice(start, appSrc.indexOf("const readFile =", start));
  assert.ok(extract.includes("isPlainText"), "the plain branch is gated by type");
  assert.ok(extract.includes("That file type is not supported."), "unknown types get an honest refusal");
  assert.ok(extract.includes("That file is empty, so nothing was opened."), "an empty file is refused in words that say the open document is unchanged");
  assert.ok(extract.indexOf("isPlainText") < extract.lastIndexOf("return raw;"), "the gate stands before the raw return");
  assert.ok(extract.indexOf('throw new Error("That file is empty') < extract.lastIndexOf("return raw;"), "the empty refusal stands before the raw return");
});

group("defect 8 — the Find counter admits its cap");

await test("runFind marks a capped result and the counter renders the plus", () => {
  const start = appSrc.indexOf("const runFind");
  const runFind = appSrc.slice(start, appSrc.indexOf("const scrollToHighlight", start));
  assert.ok(runFind.includes("const capped = matches.length >= 500 && idx >= 0;"), "the cap is detected, not hidden");
  assert.ok(runFind.includes("capped"), "the flag reaches findState");
  assert.ok(appSrc.includes('${findState.capped ? "+" : ""}'), "the counter renders the cap honestly");
});

group("defect 9 — the outline shows every heading");

await test("the outline render no longer slices the headings", () => {
  assert.ok(!appSrc.includes("docOutline.slice(0, 16)"), "the silent slice is gone");
  assert.ok(appSrc.includes("docOutline.map((o) => ("), "the full outline renders");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
