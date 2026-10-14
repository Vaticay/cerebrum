/**
 * Input guards: the 16px floor and the solid background rule for
 * text fields, checked the way the palette token gate checks tokens:
 * by parsing the real source with Babel and resolving the style each
 * field actually carries, never by grepping for literals.
 *
 * Two rules, both from the audit panels:
 *
 *  1. THE 16PX FLOOR (src/CerebrumApp.jsx). iOS Safari zooms the
 *     viewport when a focused field's text is under 16px, so every
 *     text input, textarea, and select in the app shell carries an
 *     inline fontSize of at least 16. The Inbox wave raised inbox.jsx
 *     and settings.jsx; this gate covers the shell, where the follow
 *     up input sat at 15 and the rename and find fields at 12 and 13
 *     until 2026-10-14. Non text input types (checkbox, file, range,
 *     and friends) are excluded BY NAME: they render no text to zoom.
 *     A field whose size comes from a stylesheet class rather than an
 *     inline style (the home composer) is outside this rule's reach
 *     and is counted as unresolved, never silently passed.
 *
 *  2. SOLID FIELD BACKGROUNDS (all of src/). A field's background is
 *     a palette surface token (P.surface, P.bg), a solid literal, or
 *     "transparent" for the deliberate borderless inline fields that
 *     sit on a solid parent. It is never an rgba() tint or a
 *     withAlpha() wash: a translucent field over a translucent
 *     parent composes down to whatever scrolls behind it, which is
 *     how the sign in, student, recovery, and composer fields
 *     shipped at 0.03 to 0.06 alpha until 2026-10-14.
 *
 * Resolution follows the indirections the codebase actually uses:
 * FONT_SIZES tokens (read out of designSystem.jsx itself), style
 * objects held in consts (inputStyle, textArea, UIField's base),
 * makeStyles entries (S.searchInput), and identifier backgrounds
 * (the reader's inputBg). Anything the resolver cannot see through
 * is reported as unresolved and held to the counted floors below,
 * so the gates cannot pass by going blind.
 *
 * Run with: node tests/input-guards.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

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

function parseSrc(source) {
  return parse(source, { sourceType: "module", plugins: ["jsx"], allowReturnOutsideFunction: true });
}

function walk(node, cb) {
  if (!node || typeof node.type !== "string") return;
  cb(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "range" || key === "__clone") continue;
    const child = node[key];
    if (Array.isArray(child)) for (const c of child) walk(c, cb);
    else walk(child, cb);
  }
}

/* FONT_SIZES, read out of designSystem.jsx: the gate resolves the
 * same tokens the components resolve, so a token change moves both. */
const FONT_SIZES = (() => {
  const ast = parseSrc(readFileSync(join(root, "src/designSystem.jsx"), "utf8"));
  const out = {};
  walk(ast.program, (n) => {
    if (n.type === "VariableDeclarator" && n.id && n.id.name === "FONT_SIZES" && n.init && n.init.type === "ObjectExpression") {
      for (const p of n.init.properties) {
        if (p.type === "ObjectProperty" && p.value.type === "NumericLiteral") out[p.key.name || p.key.value] = p.value.value;
      }
    }
  });
  return out;
})();

const NON_TEXT_TYPES = new Set(["checkbox", "radio", "range", "file", "color", "hidden", "submit", "button", "image", "reset"]);

function buildIndex(ast) {
  const valueByName = new Map(); // const name -> its init expression
  let makeStylesObj = null;
  walk(ast.program, (n) => {
    if (n.type === "VariableDeclarator" && n.id && n.id.type === "Identifier" && n.init) {
      valueByName.set(n.id.name, n.init);
    }
    const isMakeStyles =
      (n.type === "FunctionDeclaration" && n.id && n.id.name === "makeStyles") ||
      (n.type === "VariableDeclarator" && n.id && n.id.name === "makeStyles");
    if (isMakeStyles) {
      walk(n, (m) => {
        if (!makeStylesObj && m.type === "ReturnStatement" && m.argument && m.argument.type === "ObjectExpression") {
          makeStylesObj = m.argument;
        }
      });
    }
  });
  return { valueByName, makeStylesObj };
}

/* Merge a style expression into a Map of property name to value
 * node, later properties winning, the way JSX style objects merge. */
function resolveStyleProps(expr, idx, depth = 0) {
  if (!expr || depth > 6) return null;
  if (expr.type === "ObjectExpression") {
    const out = new Map();
    for (const p of expr.properties) {
      if (p.type === "SpreadElement") {
        const sub = resolveStyleProps(p.argument, idx, depth + 1);
        if (sub) for (const [k, v] of sub) out.set(k, v);
      } else if (p.type === "ObjectProperty") {
        out.set(p.key.name || p.key.value, p.value);
      }
    }
    return out;
  }
  if (expr.type === "Identifier") {
    const init = idx.valueByName.get(expr.name);
    return init ? resolveStyleProps(init, idx, depth + 1) : null;
  }
  if (expr.type === "MemberExpression" && expr.object.type === "Identifier" && expr.object.name === "S" && idx.makeStylesObj) {
    const prop = idx.makeStylesObj.properties.find(
      (p) => p.type === "ObjectProperty" && (p.key.name || p.key.value) === (expr.property.name || expr.property.value)
    );
    return prop ? resolveStyleProps(prop.value, idx, depth + 1) : null;
  }
  return null;
}

function resolveFontSize(node, idx, depth = 0) {
  if (!node || depth > 6) return null;
  if (node.type === "NumericLiteral") return node.value;
  if (node.type === "MemberExpression" && node.object.type === "Identifier" && node.object.name === "FONT_SIZES") {
    const v = FONT_SIZES[node.property.name || node.property.value];
    return typeof v === "number" ? v : null;
  }
  if (node.type === "Identifier") {
    const init = idx.valueByName.get(node.name);
    return init ? resolveFontSize(init, idx, depth + 1) : null;
  }
  return null;
}

/* True when the background expression lets the surface behind the
 * field show through: an rgba() string anywhere in it, or a
 * withAlpha() call. False for palette tokens and solid literals.
 * Null when the expression cannot be seen through at all. */
function backgroundIsAlpha(node, idx, depth = 0) {
  if (!node || depth > 6) return null;
  switch (node.type) {
    case "StringLiteral":
      return /rgba\s*\(/.test(node.value);
    case "TemplateLiteral":
      return node.quasis.some((q) => /rgba\s*\(/.test(q.value.cooked || ""));
    case "CallExpression":
      return node.callee && node.callee.type === "Identifier" && node.callee.name === "withAlpha" ? true : null;
    case "ConditionalExpression": {
      const a = backgroundIsAlpha(node.consequent, idx, depth + 1);
      const b = backgroundIsAlpha(node.alternate, idx, depth + 1);
      if (a === true || b === true) return true;
      if (a === false && b === false) return false;
      return null;
    }
    case "Identifier": {
      const init = idx.valueByName.get(node.name);
      return init ? backgroundIsAlpha(init, idx, depth + 1) : null;
    }
    case "MemberExpression":
      return false; // a palette token read: solid by construction
    default:
      return null;
  }
}

/* Every input, textarea, and select element in a source file, with
 * its type attribute and the fontSize and background its style
 * resolves to (null when unresolved). */
function fieldElements(source) {
  const ast = parseSrc(source);
  const idx = buildIndex(ast);
  const out = [];
  walk(ast.program, (n) => {
    if (n.type !== "JSXOpeningElement" || !n.name || !["input", "textarea", "select"].includes(n.name.name)) return;
    let type = null;
    let styleExpr = null;
    for (const attr of n.attributes || []) {
      if (attr.type !== "JSXAttribute" || !attr.name) continue;
      if (attr.name.name === "type" && attr.value && attr.value.type === "StringLiteral") type = attr.value.value;
      if (attr.name.name === "style" && attr.value && attr.value.type === "JSXExpressionContainer") styleExpr = attr.value.expression;
    }
    const props = styleExpr ? resolveStyleProps(styleExpr, idx) : null;
    const rec = { line: n.loc ? n.loc.start.line : 0, name: n.name.name, type, fontSize: null, bgAlpha: null, hasStyle: !!props };
    if (props) {
      if (props.has("fontSize")) rec.fontSize = resolveFontSize(props.get("fontSize"), idx);
      if (props.has("background")) rec.bgAlpha = backgroundIsAlpha(props.get("background"), idx);
    }
    out.push(rec);
  });
  return out;
}

function* srcFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* srcFiles(p);
    else if (/\.jsx?$/.test(entry)) yield p;
  }
}

await test("no text field in CerebrumApp.jsx carries an inline fontSize below 16", () => {
  const els = fieldElements(readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8"));
  const text = els.filter((e) => !NON_TEXT_TYPES.has(e.type || ""));
  const known = text.filter((e) => e.fontSize !== null);
  // Counted floors, not quotas: the shell renders 37 fields today,
  // 29 of them text fields, 27 of those with a resolvable inline
  // size (the home composer's size lives in a stylesheet class).
  // If these totals collapse, the resolver went blind and a pass
  // would mean nothing.
  assert.ok(els.length >= 35, `expected the shell's fields, found only ${els.length}`);
  assert.ok(text.length >= 28, `expected the shell's text fields, found only ${text.length}`);
  assert.ok(known.length >= 25, `expected resolvable inline sizes on the shell's text fields, found only ${known.length}`);
  const bad = known.filter((e) => e.fontSize < 16).map((e) => `line ${e.line}: <${e.name}> at ${e.fontSize}px`);
  assert.deepEqual(bad, [], `fields under the 16px floor:\n${bad.join("\n")}`);
});

await test("no field style anywhere in src carries an alpha background", () => {
  let total = 0;
  let resolvedBg = 0;
  const bad = [];
  for (const file of srcFiles(join(root, "src"))) {
    const label = file.slice(root.length + 1);
    for (const e of fieldElements(readFileSync(file, "utf8"))) {
      total++;
      if (e.bgAlpha !== null) resolvedBg++;
      if (e.bgAlpha === true) bad.push(`${label}:${e.line}: <${e.name}> background lets the surface behind it show through`);
    }
  }
  // The tree carries 74 fields today, 55 of them with a background
  // this resolver can see through. The floors keep the scan honest.
  assert.ok(total >= 60, `expected the fields of the whole src tree, found only ${total}`);
  assert.ok(resolvedBg >= 40, `expected resolvable backgrounds across src, found only ${resolvedBg}`);
  assert.deepEqual(bad, [], `alpha field backgrounds:\n${bad.join("\n")}`);
});

await test("the font size checker is not vacuous: it flags planted small fields and spares legal ones", () => {
  const planted = [
    `const a = <input style={{ fontSize: 13 }} />;`,
    `const b = <select style={{ fontSize: FONT_SIZES.small }} />;`,
    `const c = <input style={{ fontSize: 16 }} />;`,
    `const d = <input type="checkbox" style={{ fontSize: 10 }} />;`,
    `const e = <textarea style={{ fontSize: FONT_SIZES.body }} />;`,
  ].join("\n");
  const els = fieldElements(planted);
  const text = els.filter((e) => !NON_TEXT_TYPES.has(e.type || ""));
  const flagged = text.filter((e) => e.fontSize !== null && e.fontSize < 16);
  assert.equal(flagged.length, 3, `expected the 13px input, the small select, and the body textarea flagged, got ${JSON.stringify(els)}`);
});

await test("the background checker is not vacuous: it flags planted alpha and spares solid and transparent", () => {
  const planted = [
    `const a = <input style={{ background: P.dark ? "rgba(255,255,255,0.03)" : "#fff" }} />;`,
    `const b = <textarea style={{ background: withAlpha(accent, 0.4) }} />;`,
    `const c = <input style={{ background: P.surface }} />;`,
    `const d = <input style={{ background: "transparent" }} />;`,
    `const fieldBg = P.dark ? "rgba(255,255,255,0.05)" : "#fff";`,
    `const e = <input style={{ background: fieldBg }} />;`,
  ].join("\n");
  const els = fieldElements(planted);
  const flagged = els.filter((e) => e.bgAlpha === true);
  const spared = els.filter((e) => e.bgAlpha === false);
  assert.equal(flagged.length, 3, `expected the conditional, the withAlpha, and the identifier backgrounds flagged, got ${JSON.stringify(els)}`);
  assert.equal(spared.length, 2, `expected the palette token and the transparent field spared, got ${JSON.stringify(els)}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
