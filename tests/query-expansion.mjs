/**
 * Model-proposed query expansion tests (2026-10-13).
 *
 * The hand written CONCEPT_GROUPS table in functions/api/search.js can
 * only cover vocabulary mismatches a human already noticed (the
 * homogenate / crude extract gap). llmConceptGroups lets a cheap model
 * propose equivalence groups per question, gated by the strict
 * deterministic validator in validateExpansionGroups, and threaded
 * through retrieval as a request scoped dynLookup.
 *
 * These tests pin the gate (junk can never become a group), the lookup
 * shape, and the two consumers that decide what gets retrieved and
 * what survives filtering: buildStructuredQuery and
 * topicOverlapFilter. No network: the model call is injected.
 *
 * Run with: node tests/query-expansion.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  validateExpansionGroups,
  buildDynLookup,
  llmConceptGroups,
  buildStructuredQuery,
  topicOverlapFilter,
  retrievalStrategiesTried,
} = await import(join(root, "functions/api/search.js"));

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

// A query whose specific terms are deliberately NOT in the hand
// written concept table, so nothing here can pass by leaning on it.
const QUERY = "does zorblaxin affect quixotase activity";
const CLEAN = [
  { term: "zorblaxin", alternates: ["zorb extract", "zorblaxin metabolite"] },
];

// ═══════════════════════════════════════════════════════════════════
group("validateExpansionGroups — the gate");

await test("accepts a clean payload (parsed value)", () => {
  const out = validateExpansionGroups(CLEAN, QUERY);
  assert.deepEqual(out, CLEAN);
});

await test("accepts a clean payload (fenced JSON string)", () => {
  const out = validateExpansionGroups("```json\n" + JSON.stringify(CLEAN) + "\n```", QUERY);
  assert.deepEqual(out, CLEAN);
});

await test("accepts an object wrapper around the array", () => {
  const out = validateExpansionGroups({ groups: CLEAN }, QUERY);
  assert.deepEqual(out, CLEAN);
});

await test("rejects a term that does not appear in the query", () => {
  const out = validateExpansionGroups(
    [{ term: "thylakoid", alternates: ["grana stack", "thylakoid membrane"] }],
    QUERY
  );
  assert.deepEqual(out, []);
});

await test("rejects a term that only appears as a substring of a longer word", () => {
  const out = validateExpansionGroups(
    [{ term: "zorblax", alternates: ["zorb extract", "zorblaxin metabolite"] }],
    QUERY
  );
  assert.deepEqual(out, []);
});

await test("rejects an oversized alternate list outright", () => {
  const out = validateExpansionGroups(
    [{
      term: "zorblaxin",
      alternates: ["alt one", "alt two", "alt three", "alt four", "alt five", "alt six", "alt seven"],
    }],
    QUERY
  );
  assert.deepEqual(out, []);
});

await test("drops alternates with junk characters, keeps the clean ones", () => {
  const out = validateExpansionGroups(
    [{ term: "zorblaxin", alternates: ["zorb extract", "zorblaxin!!", "zorb_ extract", "zorblaxin metabolite"] }],
    QUERY
  );
  assert.deepEqual(out, [{ term: "zorblaxin", alternates: ["zorb extract", "zorblaxin metabolite"] }]);
});

await test("drops the group when junk leaves fewer than two alternates", () => {
  const out = validateExpansionGroups(
    [{ term: "zorblaxin", alternates: ["zorb extract", "nope!!", "also #bad"] }],
    QUERY
  );
  assert.deepEqual(out, []);
});

await test("drops framing words as terms and as alternates", () => {
  const out = validateExpansionGroups(
    [
      { term: "study", alternates: ["paper trial", "research report"] },
      { term: "zorblaxin", alternates: ["the", "zorb extract", "zorblaxin metabolite"] },
    ],
    "what does the study of zorblaxin show"
  );
  assert.deepEqual(out, [{ term: "zorblaxin", alternates: ["zorb extract", "zorblaxin metabolite"] }]);
});

await test("drops an alternate equal to the term and dedupes repeats", () => {
  const out = validateExpansionGroups(
    [{ term: "zorblaxin", alternates: ["zorblaxin", "zorb extract", "zorb extract", "zorblaxin metabolite"] }],
    QUERY
  );
  assert.deepEqual(out, [{ term: "zorblaxin", alternates: ["zorb extract", "zorblaxin metabolite"] }]);
});

await test("caps the result at four groups", () => {
  const q = "zorblaxin quixotase perchlorate vanadate molybdate tungstate";
  const many = ["zorblaxin", "quixotase", "perchlorate", "vanadate", "molybdate"]
    .map((term) => ({ term, alternates: [term + " form", term + " salt"] }));
  const out = validateExpansionGroups(many, q);
  assert.equal(out.length, 4);
});

await test("any invalid input yields an empty array, never a throw", () => {
  for (const junk of [null, undefined, 42, "not json at all {{{", "", [null, 7, "x"], { groups: "nope" }]) {
    assert.deepEqual(validateExpansionGroups(junk, QUERY), []);
  }
  assert.deepEqual(validateExpansionGroups(CLEAN, ""), []);
});

// ═══════════════════════════════════════════════════════════════════
group("buildDynLookup — CONCEPT_LOOKUP shape");

await test("term maps to a Set of the term plus its alternates", () => {
  const lookup = buildDynLookup(CLEAN);
  assert.ok(lookup instanceof Map);
  const set = lookup.get("zorblaxin");
  assert.ok(set instanceof Set);
  assert.deepEqual([...set].sort(), ["zorb extract", "zorblaxin", "zorblaxin metabolite"]);
});

await test("junk in, empty Map out", () => {
  assert.equal(buildDynLookup(null).size, 0);
  assert.equal(buildDynLookup([{ term: 9 }, { alternates: [] }, null]).size, 0);
});

// ═══════════════════════════════════════════════════════════════════
group("buildStructuredQuery — model groups reach the Boolean query");

await test("the alternate renders inside the OR group for its anchor", () => {
  const dyn = buildDynLookup(CLEAN);
  const out = buildStructuredQuery("zorblaxin quixotase activity", dyn);
  assert.ok(out.includes("(zorblaxin OR"), `no OR group for zorblaxin in: ${out}`);
  assert.ok(out.includes('"zorb extract"'), `alternate missing from: ${out}`);
});

await test("without a dynLookup the same term stays bare", () => {
  const out = buildStructuredQuery("zorblaxin quixotase activity");
  assert.ok(!out.includes("zorb extract"), `unexpected expansion in: ${out}`);
});

// ═══════════════════════════════════════════════════════════════════
group("topicOverlapFilter — alternate wording satisfies a core term");

const FILTER_QUERY = "zorblaxin degradation in wetlands";
const altPaper = () => ({
  title: "Field measurements of extract breakdown",
  abstract: "We measured zorb extract degradation rates across three field sites.",
  url: "https://example.com/a",
});
const literalPaper = () => ({
  title: "Zorblaxin fate in wetland soils",
  abstract: "Zorblaxin degradation in wetland soils was rapid and complete.",
  url: "https://example.com/c",
});
const offTopicPaper = () => ({
  title: "Photosynthesis in maize",
  abstract: "Photosynthesis and stomatal conductance in maize under drought stress.",
  url: "https://example.com/b",
});

await test("with a dynLookup, the alternate-only paper survives and the off topic paper drops", () => {
  const dyn = buildDynLookup([
    { term: "zorblaxin", alternates: ["zorb extract", "zorblaxin residue"] },
  ]);
  const out = topicOverlapFilter(FILTER_QUERY, [altPaper(), literalPaper(), offTopicPaper()], dyn);
  const urls = out.map((p) => p.url);
  assert.ok(urls.includes("https://example.com/a"), "alternate-only paper was dropped");
  assert.ok(urls.includes("https://example.com/c"), "literal paper was dropped");
  assert.ok(!urls.includes("https://example.com/b"), "off topic paper survived");
});

await test("without a dynLookup, the alternate-only paper does not survive", () => {
  const out = topicOverlapFilter(FILTER_QUERY, [altPaper(), literalPaper(), offTopicPaper()]);
  const urls = out.map((p) => p.url);
  assert.ok(!urls.includes("https://example.com/a"), "alternate-only paper survived without expansion");
  assert.ok(urls.includes("https://example.com/c"), "literal paper was dropped");
});

// ═══════════════════════════════════════════════════════════════════
group("llmConceptGroups — injected call, fail open");

await test("a junk reply resolves to [] without throwing", async () => {
  assert.deepEqual(await llmConceptGroups(QUERY, {}, async () => "not json at all {{{"), []);
  assert.deepEqual(await llmConceptGroups(QUERY, {}, async () => ({ foo: 1 })), []);
  assert.deepEqual(await llmConceptGroups(QUERY, {}, async () => null), []);
});

await test("a throwing call resolves to [] without throwing", async () => {
  const out = await llmConceptGroups(QUERY, {}, async () => { throw new Error("rate limited"); });
  assert.deepEqual(out, []);
});

await test("a valid reply passes through the validator", async () => {
  const out = await llmConceptGroups(QUERY, {}, async () => JSON.stringify(CLEAN));
  assert.deepEqual(out, CLEAN);
  const out2 = await llmConceptGroups(QUERY, {}, async () => CLEAN);
  assert.deepEqual(out2, CLEAN);
});

await test("a valid reply naming terms outside the query is still gated out", async () => {
  const out = await llmConceptGroups(QUERY, {}, async () => [
    { term: "thylakoid", alternates: ["grana stack", "thylakoid membrane"] },
  ]);
  assert.deepEqual(out, []);
});

await test("no API key and no injected call fails open to []", async () => {
  assert.deepEqual(await llmConceptGroups(QUERY, {}), []);
  assert.deepEqual(await llmConceptGroups(QUERY, null), []);
});

// ═══════════════════════════════════════════════════════════════════
group("retrievalStrategiesTried — methods label");

await test("model expansion gets its own line, in the existing style", () => {
  const out = retrievalStrategiesTried({
    conceptExpanded: ["q1", "q2"],
    llmExpanded: [{ term: "zorblaxin", alternates: ["zorb extract", "zorblaxin metabolite"] }],
  });
  assert.ok(out.includes("synonym + MeSH expansion (2 queries)"), `concept line missing: ${out}`);
  assert.ok(out.includes("model proposed synonym expansion (1 terms)"), `model line missing: ${out}`);
});

await test("no model line when no model expansion ran", () => {
  const out = retrievalStrategiesTried({ conceptExpanded: ["q1"] });
  assert.ok(!out.some((s) => s.includes("model proposed")), `unexpected line: ${out}`);
});

// ═══════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
