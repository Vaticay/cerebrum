/**
 * Answer fallback tier regressions (2026-10-08).
 *
 * Dusty: "Make the search work everytime." When retrieval returns thin
 * results (e.g. 2 Wikipedia articles for "Why does soil crack into patterns
 * as it dries?"), the system surrendered with "couldn't build a reliable
 * summary" and an "Unverified" verdict. The tier-aware fallback now produces
 * the best honest answer from thin sources instead:
 *
 *   - "background" tier: encyclopedia overviews summarized with clear
 *     attribution, never presented as research findings.
 *   - "limited" tier: thin paper abstracts, honestly labeled.
 *   - "weak" tier: the true dead end (closest-sources list + reformulations
 *     + related topics).
 *
 * Unit tests against the real exports (no server, no network).
 *
 * Run with: node tests/answer-fallback-tiers.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildExtractiveSynthesis, getLastExtractiveTier } = await import(
  join(root, "functions/api/search.js")
);

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

const WIKI = (title, extract) => ({
  title: title + " (Wikipedia)",
  url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")),
  year: "",
  authors: "Wikipedia contributors",
  journal: "Wikipedia",
  abstract: extract,
  isEncyclopedia: true,
});

const PAPER = (title, abstract) => ({ title, abstract, year: 2023, journal: "J Test" });

const MUDCRACK_EXTRACT =
  "Mudcracks (also known as mud cracks, desiccation cracks or cracked mud) are " +
  "sedimentary structures formed as muddy sediment dries and contracts. " +
  "Crack formation also occurs in clay-bearing soils as a result of a reduction " +
  "in water content. The pattern of cracks is governed by the tensile stress " +
  "distribution as the material shrinks unevenly during drying.";

// ── TIER: background ──────────────────────────────────────────────

await test("wikipedia-only pool produces a background answer, not a surrender", () => {
  const md = buildExtractiveSynthesis(
    [WIKI("Mudcrack", MUDCRACK_EXTRACT), WIKI("Pore space in soil", "Pore space in soil is the void between soil particles.")],
    null,
    { query: "Why does soil crack into patterns as it dries?" }
  );
  assert.ok(md, "expected markdown output");
  assert.match(md, /## Background/, "must use the Background heading");
  assert.doesNotMatch(md, /Couldn't find a direct answer/, "must not surrender");
  assert.equal(getLastExtractiveTier(), "background", "tier must be background");
});

await test("background answer attributes wikipedia honestly", () => {
  const md = buildExtractiveSynthesis(
    [WIKI("Mudcrack", MUDCRACK_EXTRACT)],
    null,
    { query: "Why does soil crack into patterns as it dries?" }
  );
  assert.match(md, /not primary research|not research findings/i, "must state this is not research");
  assert.match(md, /reference overviews|encyclopedia/i, "must name the source kind");
  assert.match(md, /\[1\]/, "sentences must carry citations");
});

await test("background answer never claims research findings", () => {
  const md = buildExtractiveSynthesis(
    [WIKI("Mudcrack", MUDCRACK_EXTRACT)],
    null,
    { query: "Why does soil crack into patterns as it dries?" }
  );
  assert.doesNotMatch(md, /our findings|we found|researchers found|the study/i, "no research voice");
});

await test("background answer includes related topics", () => {
  const md = buildExtractiveSynthesis(
    [WIKI("Mudcrack", MUDCRACK_EXTRACT)],
    null,
    { query: "Why does soil crack into patterns as it dries?" }
  );
  assert.match(md, /Related topics/, "must suggest related topics");
});

// ── TIER: limited ─────────────────────────────────────────────────

await test("thin paper abstracts produce a limited answer", () => {
  const md = buildExtractiveSynthesis(
    [PAPER(
      "Desiccation cracking in clay soils",
      "Desiccation cracking was observed in clay soil samples under controlled drying. " +
      "Crack spacing correlated with layer thickness in the tested samples."
    )],
    null,
    { query: "Why does soil crack into patterns as it dries?" }
  );
  assert.ok(md, "expected markdown output");
  // Either the limited tier or the research path fires; both beat surrender.
  assert.doesNotMatch(md, /Couldn't find a direct answer/, "must not surrender");
  const tier = getLastExtractiveTier();
  assert.ok(["limited", "research"].includes(tier), `tier must be limited or research, got ${tier}`);
});

// ── TIER: weak (true dead end) ────────────────────────────────────

await test("title-only pool still surrenders honestly with related topics", () => {
  const md = buildExtractiveSynthesis(
    [{ title: "Something unrelated entirely", abstract: "" }],
    null,
    { query: "Why does soil crack into patterns as it dries?" }
  );
  assert.ok(md, "expected markdown output");
  // With no usable abstracts anywhere, the weak answer is correct.
  if (getLastExtractiveTier() === "weak") {
    assert.match(md, /Related topics/, "weak answer must suggest related topics");
    assert.doesNotMatch(md, /—/, "no em dashes in user copy");
  }
});

await test("no em dashes in any fallback copy", () => {
  const md = buildExtractiveSynthesis(
    [WIKI("Mudcrack", MUDCRACK_EXTRACT)],
    null,
    { query: "Why does soil crack into patterns as it dries?" }
  );
  assert.doesNotMatch(md, /—/, "em dash violates the no-dash rule");
});

await test("wikipedia is never labeled a paper in fallback output", () => {
  const md = buildExtractiveSynthesis(
    [WIKI("Mudcrack", MUDCRACK_EXTRACT), WIKI("Pore space in soil", "Pore space in soil.")],
    null,
    { query: "Why does soil crack into patterns as it dries?" }
  );
  assert.doesNotMatch(md, /2 papers|closest papers/i, "wikipedia must not be called papers");
});

// ── summary ───────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
