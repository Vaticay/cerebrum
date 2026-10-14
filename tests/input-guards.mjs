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

/* Per file counted floors for the 16px rule, set from the audit of
 * 2026-10-14 (wave eight): els = every input, textarea, and select
 * element in the file; text = those minus the non text types excluded
 * by name; known = text fields whose inline size this resolver can
 * see. A file missing from this table is still scanned and held to
 * the rule; the table exists so a file that HAS fields cannot pass
 * by the resolver going blind on it. */
const FIELD_FLOORS = {
  "src/CerebrumApp.jsx": { els: 35, text: 28, known: 25 },
  "src/LearnView.jsx": { els: 7, text: 6, known: 6 },
  "src/flowcharts.jsx": { els: 7, text: 6, known: 6 },
  "src/inbox.jsx": { els: 8, text: 7, known: 7 },
  "src/settings.jsx": { els: 11, text: 7, known: 7 },
  "src/designSystem.jsx": { els: 2, text: 2, known: 1 },
  "src/main.jsx": { els: 1, text: 1, known: 1 },
};

await test("no text field anywhere in src carries an inline fontSize below 16", () => {
  let totalEls = 0;
  const bad = [];
  const seen = {};
  for (const file of srcFiles(join(root, "src"))) {
    const label = file.slice(root.length + 1);
    const els = fieldElements(readFileSync(file, "utf8"));
    const text = els.filter((e) => !NON_TEXT_TYPES.has(e.type || ""));
    const known = text.filter((e) => e.fontSize !== null);
    totalEls += els.length;
    seen[label] = { els: els.length, text: text.length, known: known.length };
    for (const e of known) {
      if (e.fontSize < 16) bad.push(`${label}:${e.line}: <${e.name}> at ${e.fontSize}px`);
    }
  }
  for (const [label, floor] of Object.entries(FIELD_FLOORS)) {
    const got = seen[label] || { els: 0, text: 0, known: 0 };
    assert.ok(got.els >= floor.els, `${label}: expected at least ${floor.els} fields, resolver found ${got.els}`);
    assert.ok(got.text >= floor.text, `${label}: expected at least ${floor.text} text fields, resolver found ${got.text}`);
    assert.ok(got.known >= floor.known, `${label}: expected at least ${floor.known} resolvable sizes, resolver found ${got.known}`);
  }
  // The whole tree carries 74 field elements today.
  assert.ok(totalEls >= 70, `expected the fields of the whole src tree, found only ${totalEls}`);
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

/* Stylesheet class rules in a source file: every string and template
 * literal is scanned for CSS rule shapes. Interpolations split the
 * CSS into quasis; joining them keeps whole rules parseable except
 * the few a ${} lands inside, which the counted floors absorb. */
function stylesheetRules(source) {
  const ast = parseSrc(source);
  const texts = [];
  walk(ast.program, (n) => {
    if (n.type === "TemplateLiteral") for (const q of n.quasis) texts.push(q.value.cooked || "");
    else if (n.type === "StringLiteral" && /[.#][\w-]/.test(n.value)) texts.push(n.value);
  });
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  const css = texts.join("\n");
  while ((m = re.exec(css))) rules.push({ selector: m[1].trim(), body: m[2] });
  return rules;
}

/* A stylesheet rule whose selector puts it on a field: the ask field
 * and ask input classes, the shared cb-field class, or a bare input,
 * textarea, or select element selector. */
const FIELD_SELECTOR = /ask-field|ask-input|cb-field|(^|[\s>+~.,#])input(?=[\s>+~.:#[]|$)|(^|[\s>+~.,#])textarea(?=[\s>+~.:#[]|$)|(^|[\s>+~.,#])select(?=[\s>+~.:#[]|$)/;
function cssBackgroundIsAlpha(body) {
  const m = body.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/);
  if (!m) return null;
  const v = m[1].trim();
  if (v === "transparent" || v === "none") return false;
  return /rgba\s*\(|hsla\s*\(|color-mix\s*\(|withAlpha\s*\(/.test(v);
}

/* Button rendered select triggers: a <button> carrying
 * aria-haspopup="listbox" is a select wearing a button's tag (the
 * UISelect trigger), and the field rules apply to the text it carries
 * exactly as they apply to a native select. */
function selectTriggerElements(source) {
  const ast = parseSrc(source);
  const idx = buildIndex(ast);
  const out = [];
  walk(ast.program, (n) => {
    if (n.type !== "JSXOpeningElement" || !n.name || n.name.name !== "button") return;
    let isTrigger = false;
    let styleExpr = null;
    for (const attr of n.attributes || []) {
      if (attr.type !== "JSXAttribute" || !attr.name) continue;
      if (attr.name.name === "aria-haspopup" && attr.value && attr.value.type === "StringLiteral" && attr.value.value === "listbox") isTrigger = true;
      if (attr.name.name === "style" && attr.value && attr.value.type === "JSXExpressionContainer") styleExpr = attr.value.expression;
    }
    if (!isTrigger) return;
    const props = styleExpr ? resolveStyleProps(styleExpr, idx) : null;
    out.push({
      line: n.loc ? n.loc.start.line : 0,
      bgAlpha: props && props.has("background") ? backgroundIsAlpha(props.get("background"), idx) : null,
    });
  });
  return out;
}

await test("no stylesheet field rule or select trigger in src carries an alpha background", () => {
  const appRules = stylesheetRules(readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8"));
  const targeted = appRules.filter((r) => FIELD_SELECTOR.test(r.selector));
  const withBg = targeted.filter((r) => cssBackgroundIsAlpha(r.body) !== null);
  // Counted floors from the 2026-10-14 audit: the app stylesheet
  // carries the ask field, ask input, and shared field rules (6
  // targeted rules), two of which declare a background (the solid
  // field and the transparent input inside it).
  assert.ok(targeted.length >= 5, `expected the stylesheet's field rules, found only ${targeted.length}`);
  assert.ok(withBg.length >= 2, `expected background bearing field rules, found only ${withBg.length}`);
  const badCss = targeted.filter((r) => cssBackgroundIsAlpha(r.body) === true)
    .map((r) => `${r.selector} { background lets the surface behind it show through }`);
  assert.deepEqual(badCss, [], `alpha stylesheet field backgrounds:\n${badCss.join("\n")}`);

  let triggers = 0;
  let resolved = 0;
  const badTrig = [];
  for (const file of srcFiles(join(root, "src"))) {
    const label = file.slice(root.length + 1);
    for (const t of selectTriggerElements(readFileSync(file, "utf8"))) {
      triggers++;
      if (t.bgAlpha !== null) resolved++;
      if (t.bgAlpha === true) badTrig.push(`${label}:${t.line}: select trigger background lets the surface behind it show through`);
    }
  }
  // UISelect's trigger is the one listbox button in the tree today.
  assert.ok(triggers >= 1, `expected the select triggers of src, found only ${triggers}`);
  assert.ok(resolved >= 1, `expected a resolvable trigger background, found only ${resolved}`);
  assert.deepEqual(badTrig, [], `alpha select trigger backgrounds:\n${badTrig.join("\n")}`);
});

await test("the stylesheet and trigger checkers are not vacuous", () => {
  const plantedCss = [
    "const CSS = `",
    ".cb-ask-field { background: color-mix(in srgb, var(--cb-ink) 3%, transparent); }",
    ".cb-ask-input { background: transparent; }",
    ".cb-field:focus { border-color: rgba(0,0,0,0.4); }",
    ".cb-other { background: rgba(0,0,0,0.5); }",
    "`;",
  ].join("\n");
  const rules = stylesheetRules(plantedCss).filter((r) => FIELD_SELECTOR.test(r.selector));
  assert.equal(rules.length, 3, `expected the three field rules, got ${JSON.stringify(rules)}`);
  assert.equal(cssBackgroundIsAlpha(rules[0].body), true, "the color-mix field background was not flagged");
  assert.equal(cssBackgroundIsAlpha(rules[1].body), false, "the transparent input background was flagged");
  assert.equal(cssBackgroundIsAlpha(rules[2].body), null, "a rule with no background was not reported as undeclared");

  const plantedTrig = [
    `const a = <button aria-haspopup="listbox" style={{ background: "rgba(255,255,255,0.06)" }} />;`,
    `const b = <button aria-haspopup="listbox" style={{ background: pal.surface }} />;`,
    `const c = <button aria-haspopup="menu" style={{ background: "rgba(0,0,0,0.5)" }} />;`,
  ].join("\n");
  const trigs = selectTriggerElements(plantedTrig);
  assert.equal(trigs.length, 2, `expected the two listbox triggers, got ${JSON.stringify(trigs)}`);
  assert.equal(trigs[0].bgAlpha, true, "the rgba trigger background was not flagged");
  assert.equal(trigs[1].bgAlpha, false, "the palette surface trigger background was flagged");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
