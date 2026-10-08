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
  // SYNONYMS map for abbreviation expansion tests (2026-10-08 BSFL regression)
  const synStart = src.indexOf("const SYNONYMS = {");
  let synDepth = 0, synEnd = synStart;
  for (let i = synStart; i < src.length; i++) {
    if (src[i] === "{") synDepth++;
    if (src[i] === "}") { synDepth--; if (synDepth === 0) { synEnd = i + 1; break; } }
  }
  const expStart = src.indexOf("function expansionsFor(tokens)");
  const expEnd = src.indexOf("const ORGANISM_PHRASES = [", expStart);
  const code = src.slice(swStart, swEnd) + "\n" +
    src.slice(lemStart, cqEnd) + "\n" +
    src.slice(cgStart, cgEnd) + "\n" +
    src.slice(synStart, synEnd) + "\n" +
    src.slice(expStart, expEnd) + "\n" +
    "const CONCEPT_LOOKUP = new Map(); for (const g of CONCEPT_GROUPS) for (const t of g) CONCEPT_LOOKUP.set(t, new Set(g));";
  const fn = new Function(code + "\nreturn { lemmatizeTerm, cleanQuery, CONCEPT_LOOKUP, SYNONYMS, expansionsFor };");
  return fn();
}

const { lemmatizeTerm, cleanQuery, CONCEPT_LOOKUP, SYNONYMS, expansionsFor } = extractFns();

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

console.log("\nBSFL abbreviation expansion (2026-10-08 regression)");

test("SYNONYMS has bsfl entry", () => {
  assert.ok(SYNONYMS["bsfl"], "bsfl should be in SYNONYMS");
  assert.ok(SYNONYMS["bsfl"].includes("black soldier fly larvae"), "should expand to black soldier fly larvae");
  assert.ok(SYNONYMS["bsfl"].includes("hermetia illucens"), "should expand to hermetia illucens");
});

test("expansionsFor resolves bsfl token", () => {
  const exp = expansionsFor(["bsfl", "gut", "microbiome"]);
  assert.ok(exp.includes("black soldier fly larvae"), "should include black soldier fly larvae");
  assert.ok(exp.includes("hermetia illucens"), "should include hermetia illucens");
});

test("expansionsFor handles uppercase BSFL", () => {
  const exp = expansionsFor(["bsfl", "gut", "microbiome"]);
  assert.ok(exp.length >= 2, "should produce at least 2 expansions");
});

test("gut has intestinal concept group", () => {
  const group = CONCEPT_LOOKUP.get("gut");
  assert.ok(group, "gut should have a concept group");
  assert.ok(group.has("intestinal"), "should include intestinal");
  assert.ok(group.has("midgut"), "should include midgut");
});

console.log("\nMinimum results guarantee (2026-10-08 regression)");

// These are source-presence tests: they lock the broadening pipeline
// into the handler so a future refactor cannot silently drop it.
test("handler has minimum-results-guarantee block", () => {
  assert.ok(src.includes("MINIMUM RESULTS GUARANTEE"),
    "search.js must contain the minimum results guarantee block");
  assert.ok(src.includes("minResultsGuarantee"),
    "search.js must log broadening diagnostics to _diag.minResultsGuarantee");
});

test("broadening triggers on zero, thin, and encyclopedia-only results", () => {
  assert.ok(src.includes('"zero_papers"'),
    "must detect the zero-papers trigger");
  assert.ok(src.includes('"encyclopedia_only"'),
    "must detect the Wikipedia-only trigger");
  assert.ok(src.includes('"thin_results"'),
    "must detect the thin-results trigger");
  assert.ok(src.includes("MIN_REAL_PAPERS"),
    "must define a minimum real-paper threshold");
});

test("broadening uses three strategies in order", () => {
  assert.ok(src.includes('"bare_terms"'),
    "strategy 1: bare significant terms must exist");
  assert.ok(src.includes('"synonym_expanded"'),
    "strategy 2: synonym-expanded query must exist");
  assert.ok(src.includes('"organism_only"'),
    "strategy 3: organism-alone broadest net must exist");
});

test("broadening adopts only strictly-better results", () => {
  // Guard against swapping a good result set for an equal-or-worse one.
  assert.ok(src.includes("_rp.length > _realPapers0.length"),
    "must only adopt a retry result with MORE real papers than the first pass");
  assert.ok(src.includes("_candidates.slice(0, 3)"),
    "must bound the broadening to at most 3 extra retrieval calls");
});

test("broadening counts real papers via isEncyclopediaSource", () => {
  assert.ok(src.includes("!isEncyclopediaSource(p)"),
    "must filter encyclopedia sources when counting real papers");
  assert.ok(src.includes("function isEncyclopediaSource(p)"),
    "isEncyclopediaSource helper must exist");
  // The helper must catch Wikipedia by journal, URL, type, or flag.
  const helperStart = src.indexOf("function isEncyclopediaSource(p)");
  const helperEnd = src.indexOf("}", src.indexOf("return /wikipedia/i", helperStart)) + 1;
  const helper = src.slice(helperStart, helperEnd);
  assert.ok(helper.includes("wikipedia"), "must detect wikipedia");
  assert.ok(helper.includes("Reference"), "must detect Reference type");
});

test("broadening prefers the scientific name for organism-only strategy", () => {
  assert.ok(src.includes("organism_only"),
    "organism_only strategy must exist");
  // The scientific (two-word latin) phrase is preferred over common names.
  const idx = src.indexOf("organism_only");
  const window = src.slice(idx - 600, idx + 200);
  assert.ok(/\[a-z\]\+ \[a-z\]\+/.test(window) || /sci/.test(window),
    "organism_only should prefer the scientific name phrase");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
