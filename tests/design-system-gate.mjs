/**
 * Design system gate: the plan tokens cannot drift at call sites.
 *
 * The 2026-10-18 design audit found the same drift everywhere a guard
 * did not reach: weights of 600 and above under a 400 and 500 only
 * plan, corner radii up to 24px under a radius cap of 2, elevation
 * shadows under a borders not shadows plan, one surface (Nova) reading
 * in a Georgia stack the plan never named, and the mono type token
 * pointing at the sans family. This suite parses every file under src
 * with the real Babel parser and fails on those five things, so the
 * sweep that fixed them cannot quietly regrow.
 *
 * What is checked, per parsed file:
 *  (a) fontWeight and font-weight literal values outside 400 and 500,
 *      whether they sit in a style object (including the leaves of a
 *      conditional) or in a CSS declaration inside a string.
 *  (b) borderRadius and border-radius literal numeric values of 3 or
 *      more, in the same two homes.
 *  (c) boxShadow and box-shadow literal strings that carry an
 *      elevation shadow: a length sequence whose blur (the third
 *      length) is above zero.
 *  (d) The literal Georgia serif stack: Georgia named as the first
 *      family of a font value (at the start of a string, right after
 *      a colon, or right after a size such as 16px).
 *  (e) TYPE.mono in src/designSystem.jsx pointing anywhere except
 *      var(--cb-mono).
 *
 * Exemptions, each narrow and named (all dated 2026-10-18):
 *  1. Orbitron lines (rule a only): a weight on a source line that
 *     also contains the word Orbitron belongs to the NOVA wordmark,
 *     the one display face the plan sets in its own weight.
 *  2. TYPE token definitions (rule a only): fontWeight entries inside
 *     the TYPE object in src/designSystem.jsx are the token file
 *     defining values as data, not a call site choosing a weight.
 *  3. The value "50%" (rule b): a round avatar or dot is geometry,
 *     not a corner radius choice. A 50% token inside a larger radius
 *     list is likewise spared; every other token is judged.
 *  4. RADIUS definitions (rule b only): radius entries inside the
 *     RADIUS object in src/designSystem.jsx define the scale as data.
 *  5. Ring shadows (rule c): a sequence of the form 0 0 0 Npx has a
 *     blur of zero, so it never trips the elevation test in the first
 *     place; focus rings and hairline rings stay legal by shape.
 *  6. SHADOW scale definitions (rule c only): strings inside the
 *     SHADOW object in src/designSystem.jsx define the one allowed
 *     modal shadow as data. Uses of SHADOW.* at call sites are calls,
 *     not literals, and are never scanned as strings.
 *  7. Georgia as a fallback (rule d): the serif token stacks that
 *     name Source Serif 4 first and Georgia later are the plan serif
 *     itself, so only a stack that LEADS with Georgia fails. Names
 *     like "University of Georgia" carry no comma and never match.
 * Comments are never part of an AST string node, so prose in comments
 * (including the audit explanations several files carry) cannot trip
 * any rule, and block comments inside template literals are blanked
 * before the text checks, newlines preserved.
 *
 * Run with: node tests/design-system-gate.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src");

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

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (extname(p) === ".js" || extname(p) === ".jsx") out.push(p);
  }
  return out;
}

/* Blank block comments but keep their newlines, so line numbers in the
 * text that follows a comment stay true. */
function blankBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function lineAt(baseLine, text, idx) {
  return baseLine + text.slice(0, idx).split("\n").length - 1;
}

/* The brace matched block of `export const NAME = { ... }` in the
 * token file, as a 1 based line range. Used only for the named token
 * definition exemptions 2, 4 and 6. */
function blockRange(source, name) {
  const m = new RegExp(`export const ${name} = \\{`).exec(source);
  if (!m) return null;
  const open = source.indexOf("{", m.index);
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) { close = i; break; }
    }
  }
  if (close < 0) return null;
  return {
    start: source.slice(0, m.index).split("\n").length,
    end: source.slice(0, close).split("\n").length,
  };
}

/* Literal leaves of a style value: numbers, strings and templates,
 * looking through conditionals and negation. Calls (SHADOW.xl(P)),
 * identifiers (P.shadow) and member reads are token uses, not
 * literals, and yield nothing. */
function leaves(node, out = []) {
  if (!node || typeof node.type !== "string") return out;
  if (node.type === "NumericLiteral" || node.type === "StringLiteral" || node.type === "TemplateLiteral") {
    out.push(node);
  } else if (node.type === "ConditionalExpression") {
    leaves(node.consequent, out);
    leaves(node.alternate, out);
  } else if (node.type === "LogicalExpression") {
    leaves(node.left, out);
    leaves(node.right, out);
  } else if (node.type === "UnaryExpression") {
    leaves(node.argument, out);
  }
  return out;
}

function leafText(leaf) {
  if (leaf.type === "StringLiteral") return leaf.value;
  if (leaf.type === "TemplateLiteral") return leaf.quasis.map((q) => q.value.cooked ?? q.value.raw).join(" ");
  return null;
}

/* Elevation test for one shadow string: any length sequence whose
 * third length (the blur) is above zero is an elevation shadow. Ring
 * shadows (0 0 0 Npx, exemption 5) and hairlines (blur zero) pass. */
function hasElevation(text) {
  const seq = /-?\d+(?:\.\d+)?(?:px)?\s+-?\d+(?:\.\d+)?(?:px)?\s+-?\d+(?:\.\d+)?(?:px)?/g;
  let m;
  while ((m = seq.exec(text))) {
    const parts = m[0].split(/\s+/).map((t) => parseFloat(t));
    if (parts.length >= 3 && parts[2] > 0) return true;
  }
  return false;
}

/* The bad radius tokens of one value string, if any. "50%" is
 * exemption 3 and is never returned. */
function badRadiusTokens(text) {
  if (text.trim() === "50%") return [];
  const bad = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)(px|%|rem|em)?/g)) {
    if (m[2] === "%" && parseFloat(m[1]) === 50) continue;
    if (parseFloat(m[1]) >= 3) bad.push(m[0]);
  }
  return bad;
}

function badWeight(value) {
  if (typeof value === "number") return value !== 400 && value !== 500 ? String(value) : null;
  const t = String(value).trim();
  if (/^\d+$/.test(t)) return t !== "400" && t !== "500" ? t : null;
  if (t === "bold" || t === "bolder") return t;
  return null;
}

/* Georgia as the FIRST family of a font value (rule d). See
 * exemption 7 for why fallback mentions are spared. */
const GEORGIA_STACK = /(?:^|["'`])\s*Georgia\s*,|:\s*["'`]?Georgia\s*,|\bpx\s+Georgia\s*,/g;

function collectHits(source, rel) {
  const hits = [];
  const lines = source.split("\n");
  const isTokenFile = rel === "src/designSystem.jsx";
  const typeRange = isTokenFile ? blockRange(source, "TYPE") : null;
  const radiusRange = isTokenFile ? blockRange(source, "RADIUS") : null;
  const shadowRange = isTokenFile ? blockRange(source, "SHADOW") : null;
  const inRange = (range, line) => !!range && line >= range.start && line <= range.end;
  const orbitronLine = (line) => (lines[line - 1] || "").includes("Orbitron");

  let ast;
  try {
    ast = parse(source, { sourceType: "module", plugins: ["jsx"], allowReturnOutsideFunction: true });
  } catch (e) {
    return [`${rel}:1 [parse] ${e.message}`];
  }

  function checkWeight(valueNode) {
    for (const leaf of leaves(valueNode)) {
      const line = leaf.loc ? leaf.loc.start.line : 0;
      if (orbitronLine(line)) continue; // exemption 1, 2026-10-18
      if (inRange(typeRange, line)) continue; // exemption 2, 2026-10-18
      let bad = null;
      if (leaf.type === "NumericLiteral") bad = badWeight(leaf.value);
      else if (leaf.type === "StringLiteral") bad = badWeight(leaf.value);
      if (bad) hits.push(`${rel}:${line} [weight] fontWeight ${bad} is outside 400 and 500`);
    }
  }
  function checkRadius(valueNode) {
    for (const leaf of leaves(valueNode)) {
      const line = leaf.loc ? leaf.loc.start.line : 0;
      if (inRange(radiusRange, line)) continue; // exemption 4, 2026-10-18
      if (leaf.type === "NumericLiteral") {
        if (leaf.value >= 3) hits.push(`${rel}:${line} [radius] borderRadius ${leaf.value} is 3 or more`);
      } else {
        const text = leafText(leaf);
        if (text == null) continue;
        const bad = badRadiusTokens(text);
        if (bad.length) hits.push(`${rel}:${line} [radius] borderRadius ${JSON.stringify(text.slice(0, 60))} carries ${bad.join(", ")}`);
      }
    }
  }
  function checkShadow(valueNode) {
    for (const leaf of leaves(valueNode)) {
      const line = leaf.loc ? leaf.loc.start.line : 0;
      if (inRange(shadowRange, line)) continue; // exemption 6, 2026-10-18
      const text = leafText(leaf);
      if (text == null || text.trim() === "none" || text.trim() === "") continue;
      if (hasElevation(text)) hits.push(`${rel}:${line} [shadow] boxShadow ${JSON.stringify(text.slice(0, 80))} is an elevation shadow`);
    }
  }
  function checkProp(keyName, valueNode) {
    if (keyName === "fontWeight" || keyName === "font-weight") checkWeight(valueNode);
    else if (keyName === "borderRadius" || keyName === "border-radius" || /^border[A-Za-z]*Radius$/.test(keyName)) checkRadius(valueNode);
    else if (keyName === "boxShadow" || keyName === "box-shadow") checkShadow(valueNode);
  }

  /* CSS declarations carried inside strings (the stylesheet templates)
   * and the Georgia stack check share this text scan. */
  function scanText(rawText, baseLine) {
    const text = blankBlockComments(rawText);
    for (const m of text.matchAll(/(font-weight|border-radius|box-shadow)\s*:\s*([^;}]+)/g)) {
      const line = lineAt(baseLine, text, m.index);
      const prop = m[1];
      const value = m[2].trim();
      if (prop === "font-weight") {
        if (orbitronLine(line)) continue; // exemption 1, 2026-10-18
        if (inRange(typeRange, line)) continue; // exemption 2, 2026-10-18
        const bad = badWeight(value.split(/\s+/)[0]);
        if (bad) hits.push(`${rel}:${line} [weight] font-weight ${bad} is outside 400 and 500`);
      } else if (prop === "border-radius") {
        if (inRange(radiusRange, line)) continue; // exemption 4, 2026-10-18
        const bad = badRadiusTokens(value);
        if (bad.length) hits.push(`${rel}:${line} [radius] border-radius ${JSON.stringify(value.slice(0, 60))} carries ${bad.join(", ")}`);
      } else if (prop === "box-shadow") {
        if (inRange(shadowRange, line)) continue; // exemption 6, 2026-10-18
        if (value !== "none" && hasElevation(value)) hits.push(`${rel}:${line} [shadow] box-shadow ${JSON.stringify(value.slice(0, 80))} is an elevation shadow`);
      }
    }
    for (const m of text.matchAll(GEORGIA_STACK)) {
      hits.push(`${rel}:${lineAt(baseLine, text, m.index)} [georgia] a font stack leads with Georgia`);
    }
  }

  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    if (node.type === "ObjectProperty" && node.key) {
      const keyName = node.key.name || node.key.value;
      if (typeof keyName === "string") checkProp(keyName, node.value);
    } else if (
      node.type === "AssignmentExpression" &&
      node.left && node.left.type === "MemberExpression" &&
      node.left.property && (node.left.property.name || node.left.property.value)
    ) {
      checkProp(node.left.property.name || node.left.property.value, node.right);
    } else if (node.type === "StringLiteral") {
      scanText(node.value, node.loc ? node.loc.start.line : 1);
    } else if (node.type === "TemplateLiteral") {
      for (const q of node.quasis) scanText(q.value.cooked ?? q.value.raw, q.loc ? q.loc.start.line : 1);
    } else if (node.type === "JSXText") {
      scanText(node.value, node.loc ? node.loc.start.line : 1);
    }
    for (const k of Object.keys(node)) {
      if (k === "loc" || k === "range") continue;
      visit(node[k]);
    }
  }
  visit(ast.program);

  /* Rule e: TYPE.mono must point at the mono family variable. */
  if (isTokenFile) {
    if (!typeRange) {
      hits.push(`${rel}:1 [mono] the TYPE object was not found`);
    } else {
      const typeText = lines.slice(typeRange.start - 1, typeRange.end).join("\n");
      const mono = /mono\s*:\s*\{[^}]*\}/.exec(typeText);
      if (!mono) hits.push(`${rel}:${typeRange.start} [mono] TYPE carries no mono entry`);
      else if (!mono[0].includes('var(--cb-mono)')) {
        const monoLine = typeRange.start + typeText.slice(0, mono.index).split("\n").length - 1;
        hits.push(`${rel}:${monoLine} [mono] TYPE.mono does not point at var(--cb-mono)`);
      }
    }
  }
  return hits;
}

group("Design system gate: weights, radii, shadows, Georgia, mono token");

await test("every src file parses and carries no design system drift", () => {
  const hits = [];
  const files = walk(SRC);
  assert.ok(files.length > 20, `expected the full src tree, found ${files.length} files`);
  for (const f of files) {
    const rel = relative(root, f);
    hits.push(...collectHits(readFileSync(f, "utf8"), rel));
  }
  assert.deepEqual(hits, [], `design system drift:\n${hits.join("\n")}`);
});

await test("the checker itself is not vacuous: it catches planted drift and spares the named exemptions", () => {
  const planted = [
    "const a = { fontWeight: 700 };",
    "const b = { fontWeight: 500 };",
    "const c = { fontFamily: \"Orbitron\", fontWeight: 800 };",
    "const d = { borderRadius: 12 };",
    "const e = { borderRadius: \"50%\" };",
    "const f = { borderRadius: 2 };",
    "const g = { boxShadow: \"0 8px 24px rgba(0,0,0,0.4)\" };",
    "const h = { boxShadow: \"0 0 0 2px #fff\" };",
    "const i = { boxShadow: \"none\" };",
    "const j = { boxShadow: SHADOW.xl(P) };",
    "const SERIF = \"Georgia, 'Times New Roman', serif\";",
    "const OK_SERIF = \"'Source Serif 4', Charter, Georgia, 'Times New Roman', serif\";",
    "const css = `.x { font-weight: 600; border-radius: 9px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }`;",
    "// a comment naming \"Georgia, 'Times New Roman', serif\" and fontWeight: 900 is prose, not code",
  ].join("\n");
  const hits = collectHits(planted, "src/planted.jsx");
  const kinds = hits.map((h) => h.match(/\[(weight|radius|shadow|georgia)\]/)[1]);
  assert.deepEqual(
    [...kinds].sort(),
    ["georgia", "radius", "radius", "shadow", "shadow", "weight", "weight"],
    `planted drift was not caught exactly: ${hits.join("; ")}`
  );
  const monoBad = collectHits(
    "export const TYPE = {\n  mono: { fontFamily: \"var(--cb-font)\", fontWeight: 500 },\n};\n",
    "src/designSystem.jsx"
  );
  assert.equal(monoBad.length, 1, `a mono token on the sans family was not caught: ${monoBad.join("; ")}`);
  assert.ok(monoBad[0].includes("[mono]"));
  const monoGood = collectHits(
    "export const TYPE = {\n  mono: { fontFamily: \"var(--cb-mono)\", fontWeight: 500 },\n};\n" +
      "export const RADIUS = { lg: 2 };\n" +
      "export const SHADOW = { xl: (P) => \"0 1px 0 rgba(0,0,0,0.4)\" };\n",
    "src/designSystem.jsx"
  );
  assert.deepEqual(monoGood, [], `the token file's own definitions were flagged: ${monoGood.join("; ")}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
