/**
 * No-dash gate for user visible copy.
 *
 * Dusty's standing rule: no dashes of any kind in user visible copy, and
 * the typed dashes (em dash U+2014, en dash U+2013) are the ones a raw
 * grep cannot police, because the sources carry over a thousand of them
 * inside comments. This suite parses every file under src with the real
 * Babel parser and checks ONLY what can reach a reader: string literals,
 * template literal text, and JSX text. Comments are never part of an AST
 * string node, so comment dashes cannot trip it, and code cannot hide
 * behind them either.
 *
 * Three narrow exclusions, each named:
 *  1. Block comments inside template literals. The stylesheet templates
 *     injected by CerebrumApp and the flowchart canvas carry CSS
 *     comments; those are comments, not copy, so they are stripped
 *     before the check, exactly as the parser strips JS comments.
 *  2. Regex character classes. A dash inside a [...] class in a pattern
 *     string (for example the heading separator matcher in
 *     CerebrumApp.jsx) is matching machinery, not copy; classes are
 *     stripped before the check. A dash OUTSIDE a class still fails.
 *  3. The dash decoding tables: src/textUtils.js (the ndash and mdash
 *     entries of HTML_NAMED_ENTITIES) and src/importCitations.js (the
 *     LaTeX --- and -- replacement values). Those two files hold the
 *     characters the decoders produce when upstream source data itself
 *     contains a dash entity or a LaTeX dash; they are data conversion
 *     tables, not authored copy. The exclusion applies only when the
 *     whole literal is exactly one dash character in one of those two
 *     files. Any other dash in either file fails like anywhere else.
 *
 * Run with: node tests/dash-gate.mjs
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

const DASH = /[—–]/;
const DECODE_TABLE_FILES = new Set(["src/textUtils.js", "src/importCitations.js"]);

function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ");
}
function stripCharClasses(text) {
  return text.replace(/\\.|\\\[|\[(?:\\.|[^\]\\])*\]/g, (m) => (m.startsWith("[") ? " " : m));
}

function checkLiteral(text, rel, line, kind, hits) {
  if (!text) return;
  const cleaned = stripCharClasses(stripBlockComments(text));
  if (!DASH.test(cleaned)) return;
  // Exclusion 3: the whole literal is one dash character in a decode table.
  if (DECODE_TABLE_FILES.has(rel) && (text === "—" || text === "–")) return;
  hits.push(`${rel}:${line} [${kind}] ${JSON.stringify(text.slice(0, 120))}`);
}

function visit(node, rel, hits) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) visit(n, rel, hits);
    return;
  }
  if (node.type === "StringLiteral" || node.type === "DirectiveLiteral") {
    checkLiteral(node.value, rel, node.loc.start.line, "string", hits);
  } else if (node.type === "TemplateLiteral") {
    for (const q of node.quasis) checkLiteral(q.value.cooked, rel, q.loc.start.line, "template", hits);
  } else if (node.type === "JSXText") {
    checkLiteral(node.value, rel, node.loc.start.line, "jsx text", hits);
  }
  for (const k of Object.keys(node)) {
    if (k === "loc" || k === "range") continue;
    visit(node[k], rel, hits);
  }
}

group("No em or en dash in user visible strings under src");

await test("every src file parses and carries no dash in its strings or JSX text", () => {
  const hits = [];
  const files = walk(SRC);
  assert.ok(files.length > 20, `expected the full src tree, found ${files.length} files`);
  for (const f of files) {
    const rel = relative(root, f);
    const ast = parse(readFileSync(f, "utf8"), {
      sourceType: "module",
      plugins: ["jsx"],
      allowReturnOutsideFunction: true,
    });
    visit(ast.program, rel, hits);
  }
  assert.deepEqual(hits, [], `dash characters in user visible copy:\n${hits.join("\n")}`);
});

await test("the checker itself is not vacuous: it catches a planted dash and spares the named exclusions", () => {
  const hits = [];
  checkLiteral("a range 2019–2024 in copy", "src/example.js", 1, "string", hits);
  assert.equal(hits.length, 1, "planted en dash in plain copy was not caught");
  const spared = [];
  checkLiteral("/* a — comment */ .x { color: red }", "src/example.jsx", 1, "template", spared);
  checkLiteral("[\\s:.?—-]*", "src/example.jsx", 1, "string", spared);
  checkLiteral("—", "src/textUtils.js", 1, "string", spared);
  assert.deepEqual(spared, [], `an exclusion leaked: ${spared.join("; ")}`);
  const notSpared = [];
  checkLiteral("copy — with a dash", "src/textUtils.js", 1, "string", notSpared);
  assert.equal(notSpared.length, 1, "the decode table exclusion is wider than one whole literal");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
