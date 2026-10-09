/**
 * Query anchors + named-entity token weighting (2026-10-08) — Dusty: "make
 * the searches intelligent".
 *
 * 1. extractAnchors(): multi-word topic phrases that must survive the
 *    minimum-results broadening ladder ("waste oil substrates", not the
 *    organism alone).
 * 2. GENERIC_QUERY_WORDS: "won", "first", "reported" etc. get near-zero
 *    specificity so they can never gate or dominate scoring.
 *
 * Run with: node tests/query-anchors.mjs
 */
import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { extractAnchors } = await import(join(root, "functions/api/search.js"));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

// ── Anchor extraction ──────────────────────────────────────────────

test("extractAnchors: BSFL waste oil keeps the discriminator", () => {
  const a = extractAnchors("Studies involving BSFL waste oil substrates");
  assert.ok(a.includes("waste oil substrates"), `got ${JSON.stringify(a)}`);
});

test("extractAnchors: Nobel query anchors on the prize, not won/2026", () => {
  const a = extractAnchors("Who won the 2026 Nobel Prize in Chemistry and why?");
  assert.ok(a.includes("nobel prize"), `got ${JSON.stringify(a)}`);
  assert.ok(!a.some((x) => x.includes("won")), "won must not anchor");
  assert.ok(!a.some((x) => /\d/.test(x)), "years must not anchor");
});

test("extractAnchors: first-reported query keeps the topic phrase", () => {
  const a = extractAnchors("Which paper first reported nonlinear effects in asymmetric synthesis?");
  assert.ok(a.includes("asymmetric synthesis"), `got ${JSON.stringify(a)}`);
  assert.ok(!a.some((x) => x.includes("reported")), "reported must not anchor");
});

test("extractAnchors: Soai reaction anchors the named reaction", () => {
  const a = extractAnchors("What is the Soai reaction?");
  assert.ok(a.includes("soai reaction"), `got ${JSON.stringify(a)}`);
});

test("extractAnchors: gut microbiome survives", () => {
  const a = extractAnchors("BSFL gut microbiome");
  assert.ok(a.includes("gut microbiome"), `got ${JSON.stringify(a)}`);
});

test("extractAnchors: empty/garbage input returns []", () => {
  assert.deepEqual(extractAnchors(""), []);
  assert.deepEqual(extractAnchors("the and of"), []);
  assert.deepEqual(extractAnchors(null), []);
});

// ── anchorHit / countAnchorPapers are module-internal; verify through ─
// ── the exported extractAnchors contract only. ───────────────────────

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
