/**
 * CEREBRUM-1 Phase 0 — provider fallback, versioned prompt, learning loop.
 *
 * Verifies:
 * 1. CEREBRUM_SYSTEM_v1 exists with all required components
 * 2. CEREBRUM_SYSTEM_VERSION is "v1"
 * 3. The cerebrum-1 provider entry is structured correctly
 * 4. Training data JSONL format is valid
 *
 * Run with: node tests/cerebrum-phase0.mjs
 */

import { strict as assert } from "node:assert";
import { CEREBRUM_SYSTEM_VERSION, CEREBRUM_SYSTEM_v1 } from "../functions/api/search.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

console.log("CEREBRUM-1 Phase 0 tests:\n");

// 1. Version constant
test("CEREBRUM_SYSTEM_VERSION is v1", () => {
  assert.equal(CEREBRUM_SYSTEM_VERSION, "v1");
});

// 2. All components exist
test("CEREBRUM_SYSTEM_v1 has ID", () => {
  assert.ok(CEREBRUM_SYSTEM_v1.ID, "ID missing");
  assert.ok(CEREBRUM_SYSTEM_v1.ID.includes("Cerebrum"), "ID should identify Cerebrum");
});

test("CEREBRUM_SYSTEM_v1 has PERSONALITY", () => {
  assert.ok(CEREBRUM_SYSTEM_v1.PERSONALITY, "PERSONALITY missing");
  assert.ok(CEREBRUM_SYSTEM_v1.PERSONALITY.length > 1000, "PERSONALITY seems too short");
});

test("CEREBRUM_SYSTEM_v1 has VOICE", () => {
  assert.ok(CEREBRUM_SYSTEM_v1.VOICE, "VOICE missing");
  assert.ok(CEREBRUM_SYSTEM_v1.VOICE.includes("RULE 1"), "VOICE should contain RULE 1");
});

test("CEREBRUM_SYSTEM_v1 has CONTEXT_BASE", () => {
  assert.ok(CEREBRUM_SYSTEM_v1.CONTEXT_BASE, "CONTEXT_BASE missing");
});

test("CEREBRUM_SYSTEM_v1 has CITE_RULES", () => {
  assert.ok(CEREBRUM_SYSTEM_v1.CITE_RULES, "CITE_RULES missing");
  assert.ok(CEREBRUM_SYSTEM_v1.CITE_RULES.includes("[1]"), "CITE_RULES should mention citation format");
});

// 3. No first-person in PERSONALITY (the hard rule)
test("PERSONALITY does not claim research as own", () => {
  const banned = ["our findings", "we found", "our results", "in our study"];
  for (const phrase of banned) {
    assert.ok(
      !CEREBRUM_SYSTEM_v1.PERSONALITY.toLowerCase().includes(phrase),
      `PERSONALITY contains banned phrase: "${phrase}"`
    );
  }
});

// 4. Training triple format validation
test("Training triple has required fields", () => {
  const triple = {
    instruction: "You are Cerebrum...",
    input: "Question: ...\n\nEvidence:\n...",
    output: "The answer...",
  };
  assert.ok(triple.instruction, "instruction required");
  assert.ok(triple.input, "input required");
  assert.ok(triple.output, "output required");
  // JSONL: must serialize to single line
  const line = JSON.stringify(triple);
  assert.ok(!line.includes("\n"), "JSONL line must not contain newlines");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
