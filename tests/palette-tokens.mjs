/**
 * Palette token gate: every P.<token> a component reads must exist.
 *
 * Components receive the active palette as the prop `P` and read tokens
 * off it (P.ink, P.surface, ...). A token no palette defines resolves to
 * undefined, and React style objects swallow undefined silently: the
 * text simply inherits whatever color surrounds it, no error anywhere.
 * That is exactly how Cortex shipped with 81 reads of P.muted in
 * src/LearnView.jsx (no palette has ever defined `muted`; secondary
 * text is `ink2`, caption metadata is `faint`), and how one table
 * header in src/CerebrumApp.jsx read P.panel for its background.
 *
 * This suite parses the two palette consuming surfaces with the real
 * Babel parser and checks every member read `P.<token>` (including
 * `P?.<token>`) against the actual PALETTES objects imported from
 * src/palettes.js: the token must exist on EVERY palette, because any
 * of them can be the active one. One exemption, named: a read that is
 * the left operand of `||` supplies its own fallback by construction
 * (`P.warn || "#b98a2f"`), so it cannot resolve to undefined and is
 * not flagged. String literals and comments are never member
 * expressions, so degree strings ("M.P.H.") and prose cannot trip it.
 *
 * Run with: node tests/palette-tokens.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { PALETTES } from "../src/palettes.js";

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

const paletteNames = Object.keys(PALETTES);

/* Every token at least one palette defines is not enough: the read
 * must resolve under whichever palette is active, so a token counts
 * as defined only when ALL palettes carry it. Returns the list of
 * palette names missing the token (empty when the token is safe). */
function palettesMissing(token) {
  return paletteNames.filter((name) => !(token in PALETTES[name]));
}

/* Collect unguarded P.<token> reads from a parsed program. A read is
 * guarded when it is the left operand of a `||` expression. */
function collectReads(node, parent, out) {
  if (!node || typeof node.type !== "string") return;
  if (
    (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") &&
    node.object && node.object.type === "Identifier" && node.object.name === "P" &&
    node.property && node.property.type === "Identifier" && !node.computed
  ) {
    const guarded =
      parent && parent.type === "LogicalExpression" && parent.operator === "||" && parent.left === node;
    if (!guarded) {
      out.push({ token: node.property.name, line: node.loc ? node.loc.start.line : 0 });
    }
  }
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "range" || key === "__clone") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) if (c && typeof c.type === "string") collectReads(c, node, out);
    } else if (child && typeof child.type === "string") {
      collectReads(child, node, out);
    }
  }
}

function badReadsIn(source, label) {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["jsx"],
    allowReturnOutsideFunction: true,
  });
  const reads = [];
  collectReads(ast.program, null, reads);
  const bad = [];
  for (const r of reads) {
    const missing = palettesMissing(r.token);
    if (missing.length) {
      bad.push(`${label}:${r.line} reads P.${r.token}, missing from ${missing.join(", ")}`);
    }
  }
  return { reads, bad };
}

for (const rel of ["src/LearnView.jsx", "src/CerebrumApp.jsx"]) {
  await test(`${rel}: every unguarded P.<token> read exists on all palettes`, () => {
    const { reads, bad } = badReadsIn(readFileSync(join(root, rel), "utf8"), rel);
    assert.ok(reads.length > 50, `expected the palette reads of ${rel}, found only ${reads.length}`);
    assert.deepEqual(bad, [], `undefined palette tokens:\n${bad.join("\n")}`);
  });
}

await test("the checker itself is not vacuous: it catches a planted undefined token and spares guarded and valid reads", () => {
  const { bad } = badReadsIn(
    "const a = P.muted;\nconst b = P.warn || \"#b98a2f\";\nconst c = P.ink2;\nconst d = P?.faint;",
    "planted.jsx"
  );
  assert.equal(bad.length, 1, `expected exactly the planted P.muted to be flagged, got: ${bad.join("; ")}`);
  assert.ok(bad[0].includes("P.muted"));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
