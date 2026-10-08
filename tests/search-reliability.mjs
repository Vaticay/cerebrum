/**
 * Search reliability regression tests (2026-10-08).
 *
 * Dusty's query "Why does soil crack into patterns as it dries?" returned
 * ZERO scholarly papers (only 2 Wikipedia articles) because:
 * 1. Conjugated verbs ("dries") were sent literally to keyword APIs
 * 2. No concept groups existed for physical/geoscience vocabulary
 * These tests lock the fixes.
 *
 * Run with: node tests/search-reliability.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}\n    ${e.message.split("\n")[0]}`);
  }
}

// Extract the functions we need to test from source
function extractFns() {
  const swStart = src.indexOf("const STOPWORDS = new Set([");
  const swEnd = src.indexOf("]);", swStart) + 3;
  const lemStart = src.indexOf("function lemmatizeTerm(w)");
  const lemEnd = src.indexOf("function cleanQuery(raw)", lemStart);
  const cqEnd = src.indexOf("// ============ SCHOLARLY DATABASE SOURCES", lemEnd);
  const cgStart = src.indexOf("const CONCEPT_GROUPS = [");
  let depth = 0, cgEnd = cgStart;
  for (let i = cgStart; i < src.length; i++) {
    if (src[i] === "[") depth++;
    if (src[i] === "]") { depth--; if (depth === 0) { cgEnd = i + 1; break; } }
  }
  const code = src.slice(swStart, swEnd) + "\n" +
    src.slice(lemStart, cqEnd) + "\n" +
    src.slice(cgStart, cgEnd) + "\n" +
    "const CONCEPT_LOOKUP = new Map(); for (const g of CONCEPT_GROUPS) for (const t of g) CONCEPT_LOOKUP.set(t, new Set(g));";
  const fn = new Function(code + "\nreturn { lemmatizeTerm, cleanQuery, CONCEPT_LOOKUP };");
  return fn();
}

const { lemmatizeTerm, cleanQuery, CONCEPT_LOOKUP } = extractFns();

console.log("\nVerb lemmatization");

test("dries/drying/dried all map to dry", () => {
  assert.equal(lemmatizeTerm("dries"), "dry");
  assert.equal(lemmatizeTerm("drying"), "dry");
  assert.equal(lemmatizeTerm("dried"), "dry");
});

test("cracks/cracking/cracked all map to crack", () => {
  assert.equal(lemmatizeTerm("cracks"), "crack");
  assert.equal(lemmatizeTerm("cracking"), "crack");
  assert.equal(lemmatizeTerm("cracked"), "crack");
});

test("plurals map to singular", () => {
  assert.equal(lemmatizeTerm("patterns"), "pattern");
  assert.equal(lemmatizeTerm("microplastics"), "microplastic");
  assert.equal(lemmatizeTerm("studies"), "study");
});

test("does not mangle root words", () => {
  assert.equal(lemmatizeTerm("king"), "king");
  assert.equal(lemmatizeTerm("ring"), "ring");
  assert.equal(lemmatizeTerm("class"), "class");
  assert.equal(lemmatizeTerm("virus"), "virus");
  assert.equal(lemmatizeTerm("soil"), "soil");
});

console.log("\nQuery transformation");

test("Dusty soil query produces searchable keywords", () => {
  const out = cleanQuery("Why does soil crack into patterns as it dries?");
  assert.equal(out, "soil crack pattern dry");
  assert.ok(!out.includes("dries"), "must not contain the recall-killing 'dries'");
});

test("diverse natural-language queries normalize", () => {
  assert.equal(cleanQuery("How do bees communicate the location of flowers?"), "bees communicate location flower");
  assert.equal(cleanQuery("Do microplastics accumulate in human tissue?"), "microplastic accumulate human tissue");
  assert.equal(cleanQuery("What causes Alzheimer disease to progress?"), "cause alzheimer disease progress");
});

test("garbage input does not throw", () => {
  assert.ok(cleanQuery("").length >= 0);
  assert.ok(cleanQuery("!!!").length > 0);
});

console.log("\nConcept groups");

test("has cracking/fracture group", () => {
  const group = CONCEPT_LOOKUP.get("crack");
  assert.ok(group, "crack should have a concept group");
  assert.ok(group.has("fracture"), "should include fracture");
  assert.ok(group.has("mudcrack"), "should include mudcrack");
  assert.ok(group.has("desiccation crack"), "should include desiccation crack");
});

test("has drying/desiccation group", () => {
  const group = CONCEPT_LOOKUP.get("dry");
  assert.ok(group, "dry should have a concept group");
  assert.ok(group.has("desiccation"), "should include desiccation");
  assert.ok(group.has("drying"), "should include drying");
});

test("has pattern/morphology group", () => {
  const group = CONCEPT_LOOKUP.get("pattern");
  assert.ok(group, "pattern should have a concept group");
  assert.ok(group.has("polygonal"), "should include polygonal");
  assert.ok(group.has("morphology"), "should include morphology");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
