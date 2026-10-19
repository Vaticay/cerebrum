/**
 * Stance ledger — the venn diagram's replacement.
 *
 * The premium venn pass asserted a calmer diagram (no wobble, no
 * drift, muted clay, quiet labels). The diagram itself is gone now:
 * two overlapping circles with colored dots read as a dashboard
 * widget, not a reading room. StanceLedger groups the same classified
 * papers under plain stance headings; a contesting paper gets a clay
 * numeral, never a red card. These tests assert the ledger contract
 * and that no diagram machinery survives. The classification logic
 * itself is covered in tests/answer-insights.mjs.
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

group("Stance ledger — the venn replacement");

const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");

const ledgerStart = src.indexOf("function StanceLedger");
const ledger = src.slice(ledgerStart, src.indexOf("QUERY AUTOPSY", ledgerStart));

await test("no creature naming remains; the diagram is gone, the ledger stands", () => {
  assert.ok(!/VennCreature/.test(src), "VennCreature still referenced");
  assert.ok(!/venn creature/i.test(src), "venn creature comment still present");
  assert.ok(!/function VennDiagram/.test(src), "VennDiagram component resurrected");
  assert.ok(/The venn diagram is gone/.test(src), "removal design note missing");
  assert.ok(/function StanceLedger/.test(src), "StanceLedger component missing");
});

await test("wobble filter and drift animation fully removed", () => {
  // feTurbulence survives elsewhere (film grain) — scope the check to
  // the ledger, which must carry no diagram machinery at all.
  for (const s of ["feTurbulence", "feDisplacementMap", "vennWobble", "venn-drift", "vennDriftA", "vennDriftB"]) {
    assert.ok(!ledger.includes(s), `${s} still present in StanceLedger`);
  }
  assert.ok(!/<svg/.test(ledger), "ledger still draws SVG geometry");
  assert.ok(!/className="venn-drift/.test(src), "drift wrapper still present");
});

await test("neon middle purple is gone; the contesting color is muted clay", () => {
  assert.ok(!src.includes("#a78bfa"), "neon #a78bfa still present");
  assert.ok(!/VENN_MIDDLE/.test(src), "VENN_MIDDLE still referenced");
  assert.ok(!/VENN_CLAY/.test(src), "VENN_CLAY still referenced");
  // The clay lives in STANCE_COLORS now: a muted rust for contesting.
  // Updated 2026-10-19 (design audit M24): STANCE_TOKENS is the one
  // definition and STANCE_COLORS is fed from it, so the clay is pinned
  // at the token and at the feed, not at a second literal.
  assert.ok(/STANCE_TOKENS\s*=\s*\{[^}]*contest: "#B0472B"/.test(src), "muted clay contesting token missing");
  assert.ok(/contrasting: STANCE_TOKENS\.contest/.test(src), "STANCE_COLORS is not fed from the contest token");
  assert.ok(/numColor: STANCE_COLORS\.contrasting/.test(ledger), "contesting group not on the clay numeral");
});

await test("lobes replaced by grouped stance rows under plain headings", () => {
  assert.ok(!src.includes("Two perfect static circles"), "lobe geometry comment still present");
  assert.ok(/eyebrow="Where the papers stand"/.test(ledger), "ledger eyebrow missing");
  for (const label of ["Supports the direction", "Qualifies it", "Contests it"]) {
    assert.ok(ledger.includes(`label: "${label}"`), `stance group missing: ${label}`);
  }
});

await test("group labels are quiet faint rows, not tracked caps", () => {
  assert.ok(!/letterSpacing/.test(ledger), "ledger still uses tracked caps styling");
  assert.ok(/color: P\.faint/.test(ledger), "group labels lost the quiet faint color");
});

await test("citation rows are quiet numbered buttons, not dots on a diagram", () => {
  assert.ok(/\[{n}\]/.test(ledger) || ledger.includes("[{n}]"), "numbered citation rows missing");
  assert.ok(/fontVariantNumeric: "tabular-nums"/.test(ledger), "citation numerals not tabular");
  assert.ok(!/return 4\.5;/.test(src), "venn dot sizing still present");
});

await test("classification logic entry point untouched", () => {
  // 2026-10-08: conflicts param added so literature conflict pairs are
  // visible in the classification instead of contradicting it.
  assert.ok(/classifyVennPapers\(\{ answer: turn\.answer, sources: turn\.sources, factCheck: turn\.factCheck, conflicts: turn\.literatureConflicts \}\)/.test(src),
    "classifyVennPapers call changed");
  assert.ok(/if \(classifiable < 2\) return null;/.test(src), "render guard changed");
});

await test("unclear row copy preserved: placement is honest, never guessed", () => {
  assert.ok(/No clear signal/.test(ledger), "no-clear-signal row missing");
  assert.ok(/Placed from the fact-check and the disagreement section/.test(ledger),
    "honest placement copy missing");
  assert.ok(/never guessed/.test(ledger), "never-guessed copy missing");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
