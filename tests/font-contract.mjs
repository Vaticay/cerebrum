/**
 * Font contract tests: the stylesheet cache rule, the three homes of the
 * font variables, the font files behind every @font-face, and the search
 * home stage width chain.
 *
 * Added 2026-10-20 (owner photos and his order). Production served a stale
 * copy of the font stylesheet (then at public/fonts/cerebrum-fonts.css) under an immutable cache rule.
 * That stylesheet was the only home of the UI font variable since
 * 2026-10-19, so the variable was undefined in production and every UI
 * text fell back to the browser default serif. These tests pin the fix:
 * the stylesheet revalidates, the font variables live in three homes
 * with identical values, the stack leads with the self hosted face that
 * is actually declared, and the stage fits beside the sidebar.
 *
 * Unit tests against the real files on disk. No server, no network.
 * Run with: node tests/font-contract.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
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

const headersText = readFileSync(join(root, "public/_headers"), "utf8");
const indexHtml = readFileSync(join(root, "index.html"), "utf8");
const fontsCss = readFileSync(join(root, "public/cerebrum-fonts.css"), "utf8");
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const mainSrc = readFileSync(join(root, "src/main.jsx"), "utf8");
const designSrc = readFileSync(join(root, "src/designSystem.jsx"), "utf8");

function fontVar(text, name) {
  const m = text.match(new RegExp(name.replace(/-/g, "\\-") + "\\s*:\\s*([^;]+);"));
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}
function families(stack) {
  return stack.split(",").map((s) => s.trim());
}

/* Parse public/_headers into path blocks: a block starts on a line with
   no leading space that is not a comment, and its header lines are the
   indented lines that follow. */
function headerBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line) && !line.trim().startsWith("#")) {
      current = { pattern: line.trim(), lines: [] };
      blocks.push(current);
    } else if (current && /^\s/.test(line)) {
      current.lines.push(line.trim());
    }
  }
  return blocks;
}
function patternMatches(pattern, path) {
  if (pattern.endsWith("/*")) return path.startsWith(pattern.slice(0, -1));
  return pattern === path;
}
function effectiveBlock(blocks, path) {
  const matching = blocks.filter((b) => patternMatches(b.pattern, path));
  matching.sort((a, b) => b.pattern.length - a.pattern.length);
  return matching[0] || null;
}

// ══════════════════════════════════════════════════════════════════════════
group("Cache rule: the font stylesheet can never be immutable again");

await test("no rule that can match the font stylesheet grants immutable, under Pages merge semantics", () => {
  /* Corrected 2026-10-20 (landing, proven against production): Cloudflare
     Pages does not pick the most specific matching _headers rule, it
     merges every matching rule. The first landing of this fix added a
     specific max-age=0 block for the stylesheet under /fonts/, and
     production served the file with the merged header
     "max-age=31536000, must-revalidate, immutable": the wildcard's
     immutable survived. The stylesheet therefore lives at
     /cerebrum-fonts.css, outside /fonts/*, where the immutable font
     rule can never match it. This test models the merge: collect every
     block whose pattern can match the stylesheet path and assert none
     of them carries immutable. */
  const blocks = headerBlocks(headersText);
  assert.ok(!headersText.includes("/fonts/cerebrum-fonts.css"), "the stylesheet is still referenced under /fonts/, where the immutable wildcard matches it");
  const matching = blocks.filter((b) => b.pattern === "/cerebrum-fonts.css" || (b.pattern.endsWith("/*") && "/cerebrum-fonts.css".startsWith(b.pattern.slice(0, -1))));
  assert.ok(matching.length >= 1, "no header block covers /cerebrum-fonts.css");
  for (const b of matching) {
    const cc = b.lines.find((l) => l.startsWith("Cache-Control:"));
    if (cc) assert.ok(!cc.includes("immutable"), `the ${b.pattern} rule can match the stylesheet and grants immutable`);
  }
  const specific = blocks.find((b) => b.pattern === "/cerebrum-fonts.css");
  assert.ok(specific, "no header block names /cerebrum-fonts.css specifically");
  const cc = specific.lines.find((l) => l.startsWith("Cache-Control:"));
  assert.ok(cc, "the stylesheet block carries no Cache-Control line");
  assert.match(cc, /max-age=0/);
  assert.match(cc, /must-revalidate/);
});

await test("the font files themselves keep the immutable rule", () => {
  const blocks = headerBlocks(headersText);
  const effective = effectiveBlock(blocks, "/fonts/orbitron-800.woff2");
  assert.ok(effective, "no header rule covers a font file");
  const cc = effective.lines.find((l) => l.startsWith("Cache-Control:"));
  assert.ok(cc && cc.includes("immutable"), "font files lost their immutable rule");
});

// ══════════════════════════════════════════════════════════════════════════
group("Font variables: three homes, one identical stack");

await test("--cb-font is defined identically in index.html, cerebrum-fonts.css and CerebrumApp.jsx", () => {
  const fromIndex = fontVar(indexHtml, "--cb-font");
  const fromCss = fontVar(fontsCss, "--cb-font");
  const fromApp = fontVar(appSrc, "--cb-font");
  assert.ok(fromIndex, "--cb-font missing from index.html");
  assert.ok(fromCss, "--cb-font missing from cerebrum-fonts.css");
  assert.ok(fromApp, "--cb-font missing from CerebrumApp.jsx");
  assert.equal(fromIndex, fromCss, "index.html and cerebrum-fonts.css disagree on --cb-font");
  assert.equal(fromApp, fromCss, "CerebrumApp.jsx and cerebrum-fonts.css disagree on --cb-font");
});

await test("--cb-font leads with Inter Tight and carries no serif family", () => {
  const stack = fontVar(fontsCss, "--cb-font");
  const fams = families(stack);
  assert.equal(fams[0], "'Inter Tight'", `first family is ${fams[0]}`);
  assert.equal(fams[1], "'Inter'", `second family is ${fams[1]}`);
  assert.ok(!/Georgia/.test(stack), "stack names Georgia");
  assert.ok(!/Times New Roman/.test(stack), "stack names Times New Roman");
  for (const fam of fams) {
    assert.notEqual(fam, "serif", "stack carries the bare serif keyword");
    assert.notEqual(fam, "'serif'", "stack carries the bare serif keyword");
  }
  assert.equal(fams[fams.length - 1], "sans-serif", "stack does not end in the generic sans family");
});

await test("--cb-display and --cb-body lead with Inter Tight then Inter wherever they are defined", () => {
  for (const [label, text] of [["index.html", indexHtml], ["cerebrum-fonts.css", fontsCss], ["CerebrumApp.jsx", appSrc]]) {
    for (const name of ["--cb-display", "--cb-body"]) {
      const stack = fontVar(text, name);
      if (stack === null) continue;
      const fams = families(stack);
      assert.equal(fams[0], "'Inter Tight'", `${label} ${name} leads with ${fams[0]}`);
      assert.equal(fams[1], "'Inter'", `${label} ${name} has ${fams[1]} second`);
    }
  }
  assert.ok(fontVar(fontsCss, "--cb-display"), "--cb-display missing from cerebrum-fonts.css");
  assert.ok(fontVar(fontsCss, "--cb-body"), "--cb-body missing from cerebrum-fonts.css");
});

await test("--cb-serif still begins with Source Serif 4", () => {
  for (const [label, text] of [["index.html", indexHtml], ["cerebrum-fonts.css", fontsCss], ["CerebrumApp.jsx", appSrc]]) {
    const stack = fontVar(text, "--cb-serif");
    if (stack === null) continue;
    assert.equal(families(stack)[0], "'Source Serif 4'", `${label} --cb-serif begins with ${families(stack)[0]}`);
  }
  assert.ok(fontVar(fontsCss, "--cb-serif"), "--cb-serif missing from cerebrum-fonts.css");
});

await test("main.jsx fallback stacks use the same sans order", () => {
  const err = mainSrc.match(/const ERR_FONT = "([^"]*(?:\\"[^"]*)*)"/);
  assert.ok(err, "ERR_FONT not found in main.jsx");
  assert.ok(err[1].includes("'Inter Tight', 'Inter'"), "the error screen fallback does not lead with Inter Tight then Inter");
  assert.ok(!/Georgia|Times New Roman/.test(err[1]), "the error screen fallback names a serif family");
  assert.match(mainSrc, /var\(--cb-font, 'Inter Tight', 'Inter',/, "the 404 view fallback does not lead with Inter Tight then Inter");
});

// ══════════════════════════════════════════════════════════════════════════
group("Font files: every @font-face source exists on disk");

await test("every @font-face src url in index.html and cerebrum-fonts.css resolves under public/", () => {
  const urls = [];
  for (const text of [indexHtml, fontsCss]) {
    for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) urls.push(m[1]);
  }
  assert.ok(urls.length >= 7, `expected at least 7 font urls, found ${urls.length}`);
  for (const url of urls) {
    assert.ok(url.startsWith("/"), `font url is not root relative: ${url}`);
    assert.ok(existsSync(join(root, "public", url.slice(1))), `missing font file for ${url}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
group("Search home stage: the flex chain fits beside the sidebar");

function layoutValue(name) {
  const block = designSrc.match(/export const LAYOUT = \{([\s\S]*?)\n\};/);
  assert.ok(block, "LAYOUT block not found in designSystem.jsx");
  const m = block[1].match(new RegExp(name + ":\\s*(\\d+)"));
  assert.ok(m, `LAYOUT.${name} not found`);
  return Number(m[1]);
}

await test("S.scroll and S.container carry the constraining minWidth 0 styles", () => {
  const scrollSlice = appSrc.slice(appSrc.indexOf("scroll: {"), appSrc.indexOf("container: {"));
  assert.ok(scrollSlice.includes("minWidth: 0"), "S.scroll has no minWidth 0");
  const containerLine = appSrc.split("\n").find((l) => l.includes("container: {"));
  assert.ok(containerLine, "S.container not found");
  assert.ok(containerLine.includes("minWidth: 0"), "S.container has no minWidth 0");
  const revealLine = appSrc.split("\n").find((l) => l.includes("deps={[started, deckHasContent]}"));
  assert.ok(revealLine, "the stage Reveal wrapper was not found");
  assert.ok(revealLine.includes("minWidth: 0"), "the stage Reveal wrapper has no minWidth 0");
  const columnLine = appSrc.split("\n").find((l) => l.includes("maxWidth: LAYOUT.answer") && l.includes("\"0 24px\""));
  assert.ok(columnLine, "the stage column was not found");
  assert.ok(columnLine.includes("minWidth: 0"), "the stage column has no minWidth 0");
  assert.ok(columnLine.includes('width: "100%"'), "the stage column lost its full width");
});

await test("the stage column fits the space beside the sidebar at laptop widths", () => {
  const answer = layoutValue("answer");
  const sidebar = layoutValue("sidebar");
  const sidebarCollapsed = layoutValue("sidebarCollapsed");
  assert.equal(answer, 1080);
  assert.equal(sidebar, 216);
  assert.equal(sidebarCollapsed, 68);
  const padMatch = appSrc.match(/const pad = isMobile \? 20 : (\d+);/);
  assert.ok(padMatch, "the container pad constant was not found");
  const containerPad = Number(padMatch[1]);
  const columnLine = appSrc.split("\n").find((l) => l.includes("maxWidth: LAYOUT.answer") && l.includes("\"0 24px\""));
  assert.ok(columnLine, "the stage column line was not found");
  const stagePadMatch = columnLine.match(/"0 (\d+)px"/);
  assert.ok(stagePadMatch, "the stage side padding was not found");
  assert.equal(Number(stagePadMatch[1]), 24);
  const containerCapMatch = appSrc.match(/\{\s*\.\.\.S\.container, maxWidth: (\d+) \}/);
  assert.ok(containerCapMatch, "the search view container override was not found");
  const containerCap = Number(containerCapMatch[1]);

  for (const side of [sidebar, sidebarCollapsed]) {
    for (const vw of [1280, 1366, 1440, 1512, 1920]) {
      const mainWidth = vw - side;
      const containerWidth = Math.min(containerCap, mainWidth);
      const available = containerWidth - 2 * containerPad;
      const stageWidth = Math.min(answer, available);
      assert.equal(stageWidth, Math.min(1080, available), `stage width wrong at viewport ${vw} with sidebar ${side}`);
      const containerLeft = side + (mainWidth - containerWidth) / 2;
      const stageLeft = containerLeft + containerPad + (available - stageWidth) / 2;
      const stageRight = stageLeft + stageWidth;
      assert.ok(stageRight <= vw, `stage right edge ${stageRight} exceeds viewport ${vw} with sidebar ${side}`);
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
