/**
 * Extractive-fallback integrity regressions (2026-09-16).
 *
 * From a real production QA pass on the signed-out search path (Wave-4
 * deterministic fallback), two defects shipped in the rendered answer:
 *
 *   1. ABBREVIATION TRUNCATION. An abstract's "An. stephensi" was split at
 *      "An.", and the fragment "…infection intensities in An." shipped as a
 *      cited claim. Genus abbreviations (An./P./E./S.) must not split
 *      sentences; a sentence ending on a bare "X." is rejected by the gate.
 *   2. DISHONEST FALLBACK COPY. A signed-out reader (AI synthesis gated,
 *      not failed) read "Cerebrum's AI providers were temporarily
 *      unavailable" — a false claim about our own infrastructure. The
 *      closing line now names the true gate reason.
 *
 * Unit tests against the real exports (no server, no network).
 *
 * Run with: node tests/extractive-fallback.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildExtractiveSynthesis, isWellFormedClaim } = await import(
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

const PAPER = (title, abstract) => ({ title, abstract, year: 2024 });

// The abstract is built so the ONLY high-scoring finding sentence contains
// the genus abbreviation; if the splitter cuts at "An.", the emitted text
// contains the dangling fragment.
const GENUS_ABSTRACT =
  "We previously demonstrated that modifying An. gambiae to express two " +
  "exogenous antimicrobial peptides inhibits the sporogonic development of " +
  "laboratory-cultured P. falciparum, and models predict significant " +
  "reductions in transmission. The compound effector molecule gene complexes " +
  "significantly reduced both parasite prevalence and infection intensities " +
  "in An. stephensi populations.";

await test("genus abbreviations do not split sentences", () => {
  const md = buildExtractiveSynthesis(
    [PAPER("Gene drive mosquitoes", GENUS_ABSTRACT)],
    null,
    { query: "gene drive mosquitoes" }
  );
  assert.ok(md, "expected markdown output");
  assert.match(md, /An\. stephensi/, "full binomial must survive intact");
  assert.match(md, /P\. falciparum/, "full binomial must survive intact");
  assert.doesNotMatch(
    md,
    /in An\.\s*(\[\d+\]|$)/m,
    "dangling 'An.' fragment must never ship"
  );
});

await test("genuine sentence ends still split (uppercase follow)", () => {
  const md = buildExtractiveSynthesis(
    [
      PAPER(
        "Vitamin D trial",
        "Supplementation with vitamin D. The results demonstrated a " +
          "significant increase in serum levels across all cohorts studied."
      ),
    ],
    null,
    { query: "vitamin D" }
  );
  assert.ok(md, "expected markdown output");
  // "vitamin D." must remain a sentence boundary — the two sentences must
  // not be glued into one.
  assert.doesNotMatch(md, /vitamin D\. The results demonstrated a significant increase in serum levels[^.]*\./s, "sentences must not glue across the boundary");
});

await test("gate rejects dangling abbreviation fragments", () => {
  assert.equal(
    isWellFormedClaim("The compound reduced infection intensities in An."),
    false,
    "sentence ending on bare 'An.' is a splitter casualty"
  );
  assert.equal(
    isWellFormedClaim("The compound reduced infection intensities in An. stephensi."),
    true,
    "intact binomial sentence still passes"
  );
  assert.equal(
    isWellFormedClaim("Supplementation increased serum vitamin D levels significantly."),
    true,
    "ordinary sentence still passes"
  );
});

await test("signed-out fallback names the gate, not an outage", () => {
  const md = buildExtractiveSynthesis(
    [PAPER("Gene drive mosquitoes", GENUS_ABSTRACT)],
    null,
    { query: "gene drive", aiGateReason: "signin-required" }
  );
  assert.ok(md, "expected markdown output");
  assert.match(md, /sign in for AI-synthesized answers/i);
  assert.doesNotMatch(md, /temporarily unavailable/i);
});

await test("free-cap fallback names the cap, not an outage", () => {
  const md = buildExtractiveSynthesis(
    [PAPER("Gene drive mosquitoes", GENUS_ABSTRACT)],
    null,
    { query: "gene drive", aiGateReason: "free-cap" }
  );
  assert.ok(md, "expected markdown output");
  assert.match(md, /free AI answers/i);
  assert.doesNotMatch(md, /temporarily unavailable/i);
});

await test("true provider failure keeps the outage copy", () => {
  const md = buildExtractiveSynthesis(
    [PAPER("Gene drive mosquitoes", GENUS_ABSTRACT)],
    null,
    { query: "gene drive" }
  );
  assert.ok(md, "expected markdown output");
  assert.match(md, /temporarily unavailable/i);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
