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
  analyzeQuery,
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

// Live probe regression (2026-10-13, build d929b1f): the model proposed
// exactly the right group for this question, but the shipped Boolean
// query had no preparation rung at all — dynLookup keys are phrases,
// buildStructuredQuery's anchors are single words, and no word anchor
// can ever look a phrase key up. The production run reaches the
// natural-language branch with the resolver-normalized (lowercase)
// question, so the pins exercise that branch with the lowercase form.
const PROBE_Q = "Has anyone assayed digestive enzymes in whole gut preparations from insects without isolating the enzymes?";
const PROBE_GROUPS = [
  { term: "whole gut preparations", alternates: ["entire gut extract", "whole intestinal homogenate", "full gut preparation"] },
];

await test("a validated multi word phrase group becomes a rung of the shipped query", () => {
  const validated = validateExpansionGroups(PROBE_GROUPS, PROBE_Q);
  assert.equal(validated.length, 1, "probe group should survive the validator");
  const out = buildStructuredQuery(PROBE_Q.toLowerCase(), buildDynLookup(validated));
  assert.ok(
    out.includes('("whole gut preparations" OR "entire gut extract" OR "whole intestinal homogenate" OR "full gut preparation")'),
    `preparation group missing from shipped query: ${out}`
  );
  assert.ok(out.includes("homogenate"), `homogenate wording missing from: ${out}`);
});

await test("the phrase group replaces its component word anchors inside the group budget", () => {
  const out = buildStructuredQuery(PROBE_Q.toLowerCase(), buildDynLookup(PROBE_GROUPS));
  const rungs = out.split(" AND ");
  assert.equal(rungs.length, 4, `expected 4 AND groups, got ${rungs.length}: ${out}`);
  assert.ok(rungs[0].includes("whole gut preparations"), `phrase group should lead: ${out}`);
});

await test("without a dynLookup the probe query carries no homogenate wording", () => {
  const out = buildStructuredQuery(PROBE_Q.toLowerCase());
  assert.ok(!out.includes("homogenate"), `unexpected expansion in: ${out}`);
});

await test("a phrase group whose phrase is absent from the question changes nothing", () => {
  const dyn = buildDynLookup([
    { term: "thylakoid membrane stacking", alternates: ["grana stack", "thylakoid pile"] },
  ]);
  const withDyn = buildStructuredQuery(PROBE_Q.toLowerCase(), dyn);
  const without = buildStructuredQuery(PROBE_Q.toLowerCase());
  assert.equal(withDyn, without);
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

await test("question framing verbs never become content phrases", () => {
  const a = analyzeQuery("What lets a wood frog survive being frozen for months at a time?");
  const joined = (a.keyPhrases || []).join(" ");
  assert.ok(!/\blets\b/.test(joined), "lets leaked into key phrases: " + joined);
  assert.ok(!/\bbeing\b/.test(joined), "being leaked into key phrases: " + joined);
});

await test("contractions never leak fragments or wholes into key phrases", () => {
  const c = analyzeQuery("Why doesn't freezing kill some frogs in the winter?");
  const joined = (c.keyPhrases || []).join(" ");
  assert.ok(!/doesn/.test(joined), "contraction leaked into key phrases: " + joined);
});

await test("a bare generic frog question forces no lab organism", () => {
  const b = analyzeQuery("How can a frog turn into ice all winter and not die?");
  assert.equal(b.organism, null);
});

await test("people words are never expansion targets", () => {
  const out = validateExpansionGroups(
    [{ term: "scientist", alternates: ["researcher", "biologist"] }],
    "what does a scientist measure in insect guts"
  );
  assert.deepEqual(out, []);
});

await test("a multi word organism name claims its words", () => {
  const a = analyzeQuery("What lets a wood frog survive being frozen for months at a time?");
  assert.equal(a.organism, "rana sylvatica");
  assert.ok(!(a.organismPhrases || []).includes("xenopus laevis"), "bare frog expansion leaked: " + JSON.stringify(a.organismPhrases));
  const b = analyzeQuery("Can black soldier fly larvae break down used cooking oil?");
  assert.equal(b.organism, "hermetia illucens");
});

await test("a reply wrapped in prose still yields its bracketed array", async () => {
  const wrapped = "Here are the equivalences I found for this question:\n" + JSON.stringify(CLEAN) + "\nLet me know if you need more.";
  const out = await llmConceptGroups(QUERY, {}, async () => wrapped);
  assert.deepEqual(out, CLEAN);
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
