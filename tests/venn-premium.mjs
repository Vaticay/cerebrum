/**
 * Venn premium redesign — the diagram is a research instrument, not a toy.
 *
 * Asserts the premium pass: no wobble filter, no drift animation, no
 * "creature" naming, muted clay/rust contests color, quiet tracked
 * labels, subtle dot sizing. The classification logic itself is covered
 * in tests/answer-insights.mjs and is untouched by the redesign.
 *
 * Run with: node tests/venn-premium.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

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

group("Venn premium redesign");

const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");

await test("no creature naming remains", () => {
  assert.ok(!/VennCreature/.test(src), "VennCreature still referenced");
  assert.ok(!/venn creature/i.test(src), "venn creature comment still present");
  assert.ok(/function VennDiagram/.test(src), "VennDiagram component missing");
});

await test("wobble filter and drift animation fully removed", () => {
  // feTurbulence survives elsewhere (film grain) — scope the check to the Venn component.
  const start = src.indexOf("function VennDiagram");
  const end = src.indexOf("QUERY AUTOPSY", start);
  const venn = src.slice(start, end);
  for (const s of ["feTurbulence", "feDisplacementMap", "vennWobble", "venn-drift", "vennDriftA", "vennDriftB"]) {
    assert.ok(!venn.includes(s), `${s} still present in VennDiagram`);
  }
  assert.ok(!/<defs>/.test(venn), "filter defs still present in VennDiagram");
  assert.ok(/nothing on this diagram moves/i.test(src),
    "static-instrument comment missing");
});

await test("neon middle purple is gone; muted clay defined", () => {
  assert.ok(!src.includes("#a78bfa"), "neon #a78bfa still present");
  assert.ok(!/VENN_MIDDLE/.test(src), "VENN_MIDDLE still referenced");
  assert.ok(/VENN_CLAY\s*=\s*"#9e7350"/.test(src), "VENN_CLAY constant missing");
  assert.ok(/function mixHex/.test(src), "mixHex helper missing");
});

await test("lobes are static hairline circles", () => {
  const lobeBlock = src.slice(src.indexOf("Two perfect static circles"));
  assert.ok(/strokeWidth=\{1\}/.test(lobeBlock), "lobe strokeWidth is not 1px hairline");
  assert.ok(!/className="venn-drift/.test(src), "drift wrapper still present");
});

await test("region labels are quiet tracked uppercase, not bold", () => {
  assert.ok(/fontWeight:\s*500,\s*letterSpacing:\s*"0\.22em"/.test(src),
    "region labels lost the quiet 500-weight tracked styling");
  assert.ok(!/SUPPORTS",\s*accent/.test(src), "region labels still colored like toys");
});

await test("dot sizing is subtle (4.5–8px range)", () => {
  assert.ok(/return 4\.5;/.test(src), "dot base radius not 4.5");
  assert.ok(/4 \+ Math\.min\(4,/.test(src), "dot sizing range not subtle");
});

await test("classification logic entry point untouched", () => {
  assert.ok(/classifyVennPapers\(\{ answer: turn\.answer, sources: turn\.sources, factCheck: turn\.factCheck \}\)/.test(src),
    "classifyVennPapers call changed");
  assert.ok(/if \(classifiable < 2\) return null;/.test(src), "render guard changed");
});

await test("hover readout and unclear row copy preserved", () => {
  assert.ok(/Placed from the fact-check and the disagreement section — never guessed/.test(src),
    "honest placement copy missing");
  assert.ok(/No clear signal/.test(src), "no-clear-signal row missing");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
