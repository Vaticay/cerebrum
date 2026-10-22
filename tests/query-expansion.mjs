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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  validateExpansionGroups,
  buildDynLookup,
  llmConceptGroups,
  buildStructuredQuery,
  extractBinomial,
  analyzeQuery,
  topicOverlapFilter,
  questionConceptGroups,
  pairedOmicsComparison,
  gateConceptGroups,
  gateDynLookup,
  retrievalStrategiesTried,
  llmValidatePapers,
  defaultValidationCall,
  finalizeValidationHealth,
  defaultConceptGroupCall,
  clampStageLegTimeout,
  publicStageHealth,
  stageHealthDegraded,
  screenStructuredQuery,
  screenKeyPhrase,
  queryTermContentWords,
  rebuildStructuredQueryFromGroups,
  dropFailedRungs,
  buildSearchRecord,
  buildDeterministicFallbackGroups,
  inflectionVariants,
  centralContentTerms,
  citationGateStandard,
  paperClearsCitationGate,
  subjectConceptGroup,
  applyConceptCoverageGate,
  orderCitedSliceByCoverage,
  paperConceptGroupHits,
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

// CORRECTED CONTRACT (2026-10-13, phrase merge): this pin used to
// assert the rung was the model group verbatim ("whole gut
// preparations" OR "entire gut extract" OR ...). That was the other
// half of the midgut defect: "whole gut preparations" is ALSO a
// member of the hand written homogenate group, and conceptSetFor's
// model first precedence meant the hand group's field vocabulary
// (midgut homogenate, midgut extract) never shipped on the model
// present path — the path production takes. When a phrase resolves
// in both lookups the rung now MERGES, hand multi word members
// first, so the shipped rung is the merged one pinned here (the
// model alternates fall past the member cap behind the hand group's
// 20+ multi word members). The merge pins proper are in the phrase
// merge section below.
await test("a validated multi word phrase group becomes a rung of the shipped query", () => {
  const validated = validateExpansionGroups(PROBE_GROUPS, PROBE_Q);
  assert.equal(validated.length, 1, "probe group should survive the validator");
  const out = buildStructuredQuery(PROBE_Q.toLowerCase(), buildDynLookup(validated));
  assert.ok(
    out.includes('("whole gut preparations" OR "crude extract" OR "crude extracts" OR "gut extract" OR "gut extracts" OR "midgut homogenate" OR "midgut extract")'),
    `merged preparation group missing from shipped query: ${out}`
  );
  assert.ok(out.includes("homogenate"), `homogenate wording missing from: ${out}`);
});

await test("the phrase group replaces its component word anchors inside the group budget", () => {
  const out = buildStructuredQuery(PROBE_Q.toLowerCase(), buildDynLookup(PROBE_GROUPS));
  const rungs = out.split(" AND ");
  assert.equal(rungs.length, 4, `expected 4 AND groups, got ${rungs.length}: ${out}`);
  assert.ok(rungs[0].includes("whole gut preparations"), `phrase group should lead: ${out}`);
});

// CORRECTED CONTRACT (2026-10-13, midgut coverage): this pin used to
// assert the probe query carried NO homogenate wording without a
// dynLookup. That absence was the defect, not the contract: the hand
// written table held the preparation phrasings all along, but
// buildStructuredQuery only ever scanned dynLookup for phrase keys,
// so the deterministic rung could not fire. It now fires (full pins
// in the midgut section below); the zorblaxin pin above still covers
// the no-invention rule for terms the table does not know.
await test("without a dynLookup the probe query carries the deterministic preparation rung", () => {
  const out = buildStructuredQuery(PROBE_Q.toLowerCase());
  assert.ok(out.includes("homogenate"), `deterministic preparation rung missing from: ${out}`);
  assert.ok(out.includes('"midgut homogenate"'), `midgut vocabulary missing from: ${out}`);
});

// The probe question's FOURTH live failure (2026-10-13, build
// 67b9c9b) was not a query shape problem at all: the shipped query
// above is correct, and Europe PMC (730 hits) and PubMed (91 hits,
// top results real entomology papers) both answer it directly. The
// pool contained the real papers all along. extractBinomial read
// the sentence-initial pair "Has anyone" as a Latin binomial, and
// the binomial branch of the paper gate then required every
// candidate paper to contain the "species" word "anyone", silently
// deleting the whole real shelf between dedup and ranking (the 43
// "excludedWeak" in the live record) and leaving only junk papers
// that happened to print "anyone". Pin the gate-side contract here,
// beside the probe: this question names no species.
await test("the probe question extracts no phantom binomial from its question words", () => {
  assert.equal(extractBinomial(PROBE_Q), null);
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

// Gate precedence (2026-10-13): gating counts curated groups
// first, but this query's hand table is THIN — one curated group
// (degradation) — so the model group for the coined term still
// counts for gating, and the gating resolution equals the merged
// retrieval resolution. Expansion loses its gating vote only when
// two or more hand groups already resolve (pinned in
// search-wave-two.mjs on the baby belly draw).
await test("thin table: the coined term's model group still counts for gating", () => {
  const dyn = buildDynLookup([
    { term: "zorblaxin", alternates: ["zorb extract", "zorblaxin residue"] },
  ]);
  assert.equal(questionConceptGroups(FILTER_QUERY, null).length, 1,
    "control: the hand table resolves only the degradation group");
  assert.equal(gateDynLookup(FILTER_QUERY, dyn), dyn,
    "a thin hand table lets the dyn lookup through to gating");
  assert.equal(gateConceptGroups(FILTER_QUERY, dyn).length, 2,
    "the gating resolution gains the model group in the thin case");
  assert.deepEqual(gateConceptGroups(FILTER_QUERY, dyn), questionConceptGroups(FILTER_QUERY, dyn),
    "in the thin case the gating and retrieval resolutions agree");
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
group("llmValidatePapers — Groq second leg and attribution (fleet pass 2026-10-13)");

// Validation used to ride only the OR_VALIDATE model on the OpenRouter
// free pool, which sits at its daily cap for much of the day; the stage
// fails open, so a capped pool silently disabled relevance gating. The
// Groq leg (openai/gpt-oss-20b) now answers when OpenRouter cannot, and
// diagOut.llmValidatedVia records which leg answered, mirroring
// diag.llmExpandedVia for the expansion.
const VAL_QUERY = "does zorblaxin degrade in wetlands";
const valPapers = () => ([
  {
    title: "Zorblaxin degradation in wetlands",
    abstract: "Zorblaxin degradation in wetland soils was rapid and complete.",
    journal: "J Test", year: 2024, url: "https://example.com/val-a",
  },
  {
    title: "Zorblaxin persistence in wetland sediment",
    abstract: "We tracked zorblaxin degradation rates across wetland sites over two seasons.",
    journal: "J Test", year: 2023, url: "https://example.com/val-b",
  },
]);

await test("verdicts from the second leg filter the papers and the leg is attributed", async () => {
  const diag = { llmValidatedVia: null };
  const out = await llmValidatePapers(VAL_QUERY, valPapers(), "or-token", null, {}, diag, async () => ({
    text: JSON.stringify([{ id: 1, verdict: "RELEVANT" }, { id: 2, verdict: "IRRELEVANT" }]),
    via: "groq",
  }));
  assert.deepEqual(out.map((p) => p.url), ["https://example.com/val-a"]);
  assert.equal(diag.llmValidatedVia, "groq");
});

await test("both legs failing fails open to the programmatic survivors, via stays null", async () => {
  const diag = { llmValidatedVia: null };
  const out = await llmValidatePapers(VAL_QUERY, valPapers(), "or-token", null, { GROQ_KEY: "g" }, diag, async () => null);
  assert.equal(out.length, 2);
  assert.equal(diag.llmValidatedVia, null);
});

await test("no key on either leg skips the model pass entirely", async () => {
  const diag = { llmValidatedVia: null };
  const out = await llmValidatePapers(VAL_QUERY, valPapers(), "", null, {}, diag);
  assert.equal(out.length, 2);
  assert.equal(diag.llmValidatedVia, null);
});

await test("defaultValidationCall tries OpenRouter first, then Groq, with the Groq shape pinned", async () => {
  const realFetch = globalThis.fetch;
  const urls = [];
  let groqBody = null;
  globalThis.fetch = async (url, init) => {
    urls.push(String(url));
    if (String(url).includes("openrouter.ai")) {
      return { ok: false, status: 429, json: async () => ({}) };
    }
    groqBody = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: "[{\"id\":1,\"verdict\":\"RELEVANT\"}]" } }] }),
    };
  };
  try {
    const out = await defaultValidationCall([{ role: "user", content: "x" }], "or-token", { GROQ_KEY: "groq-key" });
    assert.equal(out.via, "groq");
    assert.equal(urls.length, 2);
    assert.ok(urls[0].includes("openrouter.ai"), `first leg should be OpenRouter: ${urls[0]}`);
    assert.ok(urls[1].includes("api.groq.com"), `second leg should be Groq: ${urls[1]}`);
    assert.equal(groqBody.model, "openai/gpt-oss-20b");
    assert.equal(groqBody.reasoning_effort, "low");
    assert.equal(groqBody.max_tokens, 400);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("defaultValidationCall stops at the OpenRouter leg when it answers", async () => {
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: "[{\"id\":1,\"verdict\":\"RELEVANT\"}]" } }] }),
    };
  };
  try {
    const out = await defaultValidationCall([{ role: "user", content: "x" }], "or-token", { GROQ_KEY: "groq-key" });
    assert.equal(out.via, "openrouter");
    assert.equal(urls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("defaultValidationCall with no keys returns null and never fetches", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("must not be called"); };
  try {
    const out = await defaultValidationCall([{ role: "user", content: "x" }], "", {});
    assert.equal(out, null);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("the Workers AI leg answers when both fetch pools fail (sixth panel, Job 3c)", async () => {
  // The panel's weather: OpenRouter capped and Groq down together,
  // validation answering 0 of 3 probes. The third leg is a
  // different provider family on the bound service, so its weather
  // is not the fetch pools'.
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  const aiCalls = [];
  globalThis.fetch = async () => { fetchCalls++; throw new Error("fetch failed"); };
  try {
    const env = {
      GROQ_KEY: "test-groq",
      AI: { run: async (model, input) => {
        aiCalls.push({ model, input });
        return { response: JSON.stringify([{ id: 1, verdict: "RELEVANT" }]) };
      } },
    };
    const out = await defaultValidationCall(
      [{ role: "user", content: "validate" }], "test-openrouter", env);
    assert.ok(out, "no leg answered");
    assert.equal(out.via, "workers-ai", "the answering leg is not the Workers AI leg: " + JSON.stringify(out));
    assert.equal(fetchCalls, 2, "the two fetch legs were not tried first");
    assert.equal(aiCalls.length, 1, "the Workers AI leg did not fire exactly once");
    assert.equal(aiCalls[0].model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    assert.equal(aiCalls[0].input.max_tokens, 400, "the leg's completion budget is not the validation sizing");
    assert.equal(aiCalls[0].input.temperature, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("the Workers AI leg stays inside the stage allowance, and a Workers AI only env validates", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("fetch failed"); };
  try {
    let aiCalls = 0;
    const env = { AI: { run: async () => { aiCalls++; return { response: "[]" }; } } };
    const capped = { remaining: () => 50, spend: () => {}, validationCapHit: () => true };
    const out = await defaultValidationCall(
      [{ role: "user", content: "validate" }], "", env, undefined, capped);
    assert.equal(out, null, "the Workers AI leg answered although the phase allowance was spent");
    assert.equal(aiCalls, 0, "the Workers AI leg fired although the phase allowance was spent");

    // End to end, on the suite's own validation fixtures (both
    // papers survive the programmatic passes): no OpenRouter
    // token, no Groq key — the bound service alone runs PASS 2
    // (llmValidatePapers' early return used to skip the pass
    // entirely in this environment).
    const env2 = {
      AI: { run: async (model, input) => {
        const joined = (input.messages || []).map((m) => String(m.content || "")).join("\n");
        if (joined.includes("relevance validator")) {
          return { response: JSON.stringify([
            { id: 1, verdict: "RELEVANT" }, { id: 2, verdict: "IRRELEVANT" },
          ]) };
        }
        return { response: "" };
      } },
    };
    const diag = {};
    const kept = await llmValidatePapers(VAL_QUERY, valPapers(), "", null, env2, diag);
    assert.equal(diag.llmValidatedVia, "workers-ai",
      "the validation pass did not run on the Workers AI leg: " + JSON.stringify(diag));
    assert.deepEqual(kept.map((p) => p.url), ["https://example.com/val-a"],
      "the rejected paper survived a Workers AI validation: " + JSON.stringify(kept.map((p) => p.title)));
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ═══════════════════════════════════════════════════════════════════
group("validation stage health — fail open must not read as healthy (2026-10-13)");

// The stage fails open deliberately: unvalidated survivors are used.
// But the shipped stageHealth reported ok true with via null whenever
// both legs failed (5 of 7 rescore probes), which reads as a healthy
// gate that silently never ran. finalizeValidationHealth is the
// handler's final word on the record: a leg answering keeps ok and
// names via; no leg answering reports ok false with a skipReason, the
// shape the synthesis stage uses for degraded outcomes.
await test("a leg answering keeps the record ok and names the leg in via", () => {
  const rec = { name: "validation", ok: true, ms: 412 };
  finalizeValidationHealth(rec, { llmValidatedVia: "groq" });
  assert.equal(rec.ok, true);
  assert.equal(rec.via, "groq");
  assert.equal(rec.skipReason, undefined);
});

await test("no leg answering reports ok false with a skipReason, via null", () => {
  const rec = { name: "validation", ok: true, ms: 38 };
  finalizeValidationHealth(rec, { llmValidatedVia: null });
  assert.equal(rec.ok, false, "fail open must not claim ok");
  assert.equal(rec.via, null);
  assert.equal(rec.skipReason, "no leg answered");
});

await test("the helper leaves other stages and empty inputs alone", () => {
  const rec = { name: "retrieval", ok: true, ms: 10 };
  finalizeValidationHealth(rec, { llmValidatedVia: null });
  assert.deepEqual(rec, { name: "retrieval", ok: true, ms: 10 });
  assert.equal(finalizeValidationHealth(null, null), null);
});

await test("the handler finalizes the validation record from the diag", () => {
  const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
  assert.match(src, /finalizeValidationHealth\(stageHealth\[validationHealthIdx\], validationDiag\)/,
    "handler does not finalize the validation health record");
});

// ═══════════════════════════════════════════════════════════════════
group("cerebras — parked out of the synthesis roster (fleet pass 2026-10-13)");

await test("no active cerebras provider row remains, and the parking note is dated", () => {
  const source = readFileSync(join(root, "functions/api/search.js"), "utf8");
  assert.ok(
    !/^\s*\{ id: "cerebras", key: env\.CEREBRAS_KEY,/m.test(source),
    "an active cerebras provider row is still in the roster"
  );
  assert.ok(source.includes("PARKED 2026-10-13"), "the dated parking note is missing");
  assert.ok(
    source.includes('// { id: "cerebras", key: env.CEREBRAS_KEY,'),
    "the parked row should remain as a comment so restoring is one line"
  );
});

// ═══════════════════════════════════════════════════════════════════
group("preparation phrasings — deterministic homogenate bridge (fleet pass 2026-10-13)");

// The homogenate concept group used to fire only when a question
// already contained homogenate wording. These pins run the real
// topicOverlapFilter (the consumer that scans CONCEPT_GROUPS for
// multi word members present in the question) with NO dynLookup and
// NO model call: the bridge is the hand written group alone.
await test("whole gut preparations phrasing lets a crude extract paper through the filter", () => {
  const bridge = () => ({
    title: "Protease levels in insect midgut samples",
    abstract: "Protease levels in crude extracts from dissected midguts of larvae were compared across diets.",
    url: "https://example.com/bridge",
  });
  const strong = () => ({
    title: "Enzyme activity in whole gut preparations of insects",
    abstract: "Enzyme activity was measured in whole gut preparations.",
    url: "https://example.com/strong",
  });
  const out = topicOverlapFilter("enzyme activity in whole gut preparations", [bridge(), strong()]);
  const urls = out.map((p) => p.url);
  assert.ok(urls.includes("https://example.com/strong"), "the literal wording paper must survive");
  assert.ok(
    urls.includes("https://example.com/bridge"),
    "the crude extract paper must survive via the homogenate bridge: " + JSON.stringify(urls)
  );
});

await test("a gut homogenate question accepts a paper that only says whole gut preparation", () => {
  const prep = () => ({
    title: "Whole gut preparation protocol",
    abstract: "A whole gut preparation was used to measure protease release.",
    url: "https://example.com/prep",
  });
  const anchor = () => ({
    title: "Gut homogenate enzyme assays",
    abstract: "Enzyme assays of gut homogenate were run in triplicate.",
    url: "https://example.com/anchor",
  });
  const out = topicOverlapFilter("assays of gut homogenate", [prep(), anchor()]);
  const urls = out.map((p) => p.url);
  assert.ok(urls.includes("https://example.com/anchor"), "the literal wording paper must survive");
  assert.ok(
    urls.includes("https://example.com/prep"),
    "the preparation wording paper must survive via the shared group: " + JSON.stringify(urls)
  );
});

// ═══════════════════════════════════════════════════════════════════
group("midgut coverage — the deterministic preparation rung (2026-10-13)");

// Live evidence (build 7b06b0a), two questions minutes apart. The
// homogenate wording question shipped ("insect gut homogenate" OR
// "insect midgut homogenate" OR ...) from the model group and
// retrieved the real shelf: 88 gathered, 4 cited, answer Yes. The
// whole gut preparations question shipped a preparation rung whose
// alternates came ONLY from the model ("whole gut extract", "entire
// gut preparation", "whole gut lysate") with no midgut form anywhere,
// and failed for the third build in a row (50 gathered, 2 off topic
// cited, scoped No). Trace: buildStructuredQuery's phrase anchor scan
// iterated dynLookup keys only; the hand written preparation phrasings
// in CONCEPT_GROUPS were invisible to it (topicOverlapFilter scanned
// them, the builder did not), and the homogenate group's member order
// put the midgut forms past the rung cap besides. These pins run the
// real builder with NO dynLookup: the rung must be deterministic.
const MIDGUT_Q = PROBE_Q;

await test("the whole gut preparations question ships a midgut rung with no model call", () => {
  const out = buildStructuredQuery(MIDGUT_Q.toLowerCase());
  const rungs = out.split(" AND ");
  assert.equal(rungs.length, 4, `expected 4 AND groups inside the budget, got ${rungs.length}: ${out}`);
  const prep = rungs.find((r) => r.includes("whole gut preparations"));
  assert.ok(prep, `preparation rung missing from: ${out}`);
  assert.ok(prep.includes('"midgut homogenate"'), `midgut homogenate missing from preparation rung: ${prep}`);
  assert.ok(prep.includes('"midgut extract"'), `midgut extract missing from preparation rung: ${prep}`);
});

await test("the homogenate wording question ships the phrase first group rendering", () => {
  // PIN UPDATED (2026-10-22, search diagnosis): this used to pin
  // the byte identical pre fix form. The diagnosis's phrase first
  // ordering (a group's multi word members render ahead of its
  // later single words inside the unchanged seven member window)
  // changes every group's rendering, this one included: the gut
  // group's anatomical phrases now hold window slots the tail
  // singles (midgut, hindgut, foregut) used to hold — midgut is
  // not lost to the query, it ships through its own preparation
  // rung above — and the homogenate group's extract phrases
  // likewise displace its inflection tail. The contract that
  // survives: the wording question adds nothing beyond the
  // resolved groups' own vocabulary, deterministically.
  const q = "Are there any research papers that use insect gut homogenate in order to study enzyme activity, as opposed to purifying the enzymes from the gut homogenate?";
  const expected =
    "(gut OR \"peritrophic membrane\" OR \"alimentary canal\" OR \"digestive tract\" OR intestinal OR intestine OR digestive) AND " +
    "(homogenate OR \"crude extract\" OR \"crude extracts\" OR \"gut extract\" OR \"gut extracts\" OR \"midgut homogenate\" OR \"midgut extract\") AND " +
    "(enzymes OR enzyme OR enzymatic OR oxidase OR oxidases OR hydrolase OR hydrolases) AND " +
    "(gut OR \"peritrophic membrane\" OR \"alimentary canal\" OR \"digestive tract\" OR intestinal OR intestine OR digestive)";
  assert.equal(buildStructuredQuery(q.toLowerCase()), expected);
});

await test("an unrelated preparation question gains no midgut rung", () => {
  const out = buildStructuredQuery("Has anyone assayed enzyme activity in leaf preparations from plants?".toLowerCase());
  assert.ok(!out.includes("midgut"), `midgut leaked into an unrelated query: ${out}`);
  assert.ok(!out.includes("homogenate"), `homogenate leaked into an unrelated query: ${out}`);
});

// ═══════════════════════════════════════════════════════════════════
group("phrase merge — a phrase in both lookups ships the hand vocabulary (2026-10-13)");

// The midgut pins above run with NO dynLookup. Live production runs
// WITH one, and there the model group won outright: these are the
// alternates the model actually proposed for the probe phrase across
// three live runs (builds up to 7b06b0a), and not one is a midgut
// form. The phrase is a member of the hand written homogenate group
// too, so the rung must merge — hand multi word members first, model
// alternates after — instead of shipping the model's set alone.
const LIVE_MODEL_GROUPS = [
  { term: "whole gut preparations", alternates: ["whole gut extract", "entire gut preparation", "whole gut lysate", "entire gut extract", "whole gut homogenate"] },
];

await test("the probe question fed the model's live alternates still ships the midgut forms", () => {
  const out = buildStructuredQuery(PROBE_Q.toLowerCase(), buildDynLookup(LIVE_MODEL_GROUPS));
  const prep = out.split(" AND ").find((r) => r.includes("whole gut preparations"));
  assert.ok(prep, `preparation rung missing from: ${out}`);
  assert.ok(prep.includes('"midgut homogenate"'), `midgut homogenate missing from preparation rung: ${prep}`);
  assert.ok(prep.includes('"midgut extract"'), `midgut extract missing from preparation rung: ${prep}`);
  // Parity with the deterministic path: the hand group's multi word
  // members saturate the member cap ahead of the model alternates,
  // so the preparation rung is the same rung the no model run ships.
  const bare = buildStructuredQuery(PROBE_Q.toLowerCase());
  const barePrep = bare.split(" AND ").find((r) => r.includes("whole gut preparations"));
  assert.equal(prep, barePrep, `merged rung differs from the deterministic rung:\n${prep}\n${barePrep}`);
});

await test("a leaf preparations control gains no midgut wording even with the live model group loaded", () => {
  const out = buildStructuredQuery(
    "Has anyone assayed enzyme activity in leaf preparations from plants?".toLowerCase(),
    buildDynLookup(LIVE_MODEL_GROUPS)
  );
  assert.ok(!out.includes("midgut"), `midgut leaked into an unrelated query: ${out}`);
  assert.ok(!out.includes("homogenate"), `homogenate leaked into an unrelated query: ${out}`);
});

// ═══════════════════════════════════════════════════════════════════
group("buildStructuredQuery — framing words never become AND anchors (fleet pass 2026-10-13)");

// Live regression (build 2197a8f): the homogenate probe's shipped
// structured query ended "AND has AND anyone". "has" scores 0.65 in
// termSpecificity and "anyone" 0.5, and the anchor race consulted
// STOPWORDS only, never QUERY_FRAMING_WORDS.
await test("the probe question's structured query has no bare has or anyone rung", () => {
  const out = buildStructuredQuery(PROBE_Q.toLowerCase());
  const rungs = out.split(" AND ").map((r) => r.trim());
  assert.ok(!rungs.includes("has"), `bare has rung in: ${out}`);
  assert.ok(!rungs.includes("anyone"), `bare anyone rung in: ${out}`);
});

await test("short questions cannot spend anchor slots on has or anyone", () => {
  const out1 = buildStructuredQuery("has anyone assayed frogs");
  assert.equal(out1, "frogs AND assayed");
  const out2 = buildStructuredQuery("has anyone assayed digestive enzymes");
  const rungs2 = out2.split(" AND ").map((r) => r.trim());
  assert.ok(!rungs2.includes("has"), `bare has rung in: ${out2}`);
  assert.ok(!rungs2.includes("anyone"), `bare anyone rung in: ${out2}`);
  assert.ok(out2.includes("assayed"), `content anchor assayed lost in: ${out2}`);
  assert.ok(out2.includes("digestive"), `content anchor digestive lost in: ${out2}`);
});

// ═══════════════════════════════════════════════════════════════════
group("negation led groups — an absence is never an AND rung (2026-10-13)");

// Live regression (build 553caa4): the fleet pass made the rest of
// this question's query excellent — digestive enzyme group, whole
// gut preparation group with homogenate wording, insect group, no
// framing tail — except one rung: ("without isolat enzyme" OR
// "without isolated enzyme" OR "without purified enzyme" OR
// "without enzyme purification"). A negation phrase became a
// REQUIRED AND constraint; papers almost never phrase an absence,
// so gathered fell to 42 (80 on the looser prior build), the only
// cited papers were off topic, and the answer was a scoped No.
// Production reaches these functions with the resolver normalized
// (lemmatized, stopword stripped) question, the form the pins use.
const PROBE_Q_NORMALIZED =
  "has anyone assayed digestive enzymes in whole gut preparations from insects without isolat enzyme";
const WITHOUT_GROUP = {
  term: "without isolat enzyme",
  alternates: ["without isolated enzyme", "without purified enzyme", "without enzyme purification"],
};

await test("validateExpansionGroups drops the without led group and keeps the normal group beside it", () => {
  const out = validateExpansionGroups([PROBE_GROUPS[0], WITHOUT_GROUP], PROBE_Q_NORMALIZED);
  assert.deepEqual(out, PROBE_GROUPS);
});

await test("other negation leads are dropped at the validator too", () => {
  const cases = [
    [{ term: "never exposed", alternates: ["unexposed seedlings", "dark grown seedlings"] },
      "do seedlings never exposed to light germinate"],
    [{ term: "free of pathogens", alternates: ["pathogen free seedlings", "sterile seedlings"] },
      "are seedlings free of pathogens in sterile culture"],
    [{ term: "lacking chlorophyll", alternates: ["achlorophyllous plants", "albino seedlings"] },
      "how do plants lacking chlorophyll survive"],
    [{ term: "absence of light", alternates: ["darkness", "dark conditions"] },
      "does the absence of light stop germination"],
    [{ term: "not photosynthetic", alternates: ["heterotrophic plants", "achlorophyllous plants"] },
      "which plants are not photosynthetic"],
  ];
  for (const [g, q] of cases) {
    assert.deepEqual(validateExpansionGroups([g], q), [], `negation led term survived: ${g.term}`);
  }
});

await test("the probe query ships no without rung, and the other groups stay intact", () => {
  // Built WITHOUT the validator on purpose: buildStructuredQuery is
  // the defensive second line for callers that bypass the gate.
  const dyn = buildDynLookup([PROBE_GROUPS[0], WITHOUT_GROUP]);
  const out = buildStructuredQuery(PROBE_Q_NORMALIZED, dyn);
  const rungs = out.split(" AND ");
  assert.ok(!out.includes("without"), `negation wording leaked into the shipped query: ${out}`);
  assert.equal(rungs.length, 4, `expected 4 AND groups, got ${rungs.length}: ${out}`);
  assert.ok(rungs[0].includes("whole gut preparations"), `preparation group should lead: ${out}`);
  assert.ok(out.includes("homogenate"), `homogenate wording missing from: ${out}`);
  assert.ok(rungs.some((r) => r.includes("digestive")), `digestive group missing from: ${out}`);
  assert.ok(rungs.some((r) => r.includes("enzymes")), `enzyme group missing from: ${out}`);
  assert.ok(rungs.some((r) => r.includes("insects")), `insect group missing from: ${out}`);
});

await test("a term that merely contains a negation word still validates (nitrogen fixation)", () => {
  const out = validateExpansionGroups(
    [{ term: "nitrogen fixation", alternates: ["biological nitrogen fixation", "diazotrophy"] }],
    "how does nitrogen fixation support plant growth"
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].term, "nitrogen fixation");
});

await test("a closed non compound still validates (non-photosynthetic is real vocabulary)", () => {
  const out = validateExpansionGroups(
    [{ term: "non-photosynthetic", alternates: ["achlorophyllous", "mycoheterotrophic"] }],
    "how do non-photosynthetic plants get carbon"
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].term, "non-photosynthetic");
});

// ═══════════════════════════════════════════════════════════════════
group("buildStructuredQuery — subject representation in the anchor race (rescore panel 2026-10-13)");

// Live regression (rescore panel, build 65ba977; Search retrieval
// fell 635 to 545): zero of seven plain language probes returned a
// shelf answering the question as asked. Named mechanism: the anchor
// race ranked on termSpecificity alone, whose +0.25 short word boost
// hands 0.75 to any word of five letters or fewer missing from the
// small COMMON_SHORT_WORDS list. Everyday words are mostly short, so
// they took required AND slots while subject words dropped: break,
// grind, whole, carry, while, and sandy were all observed as
// promoted anchors across the probes, and the sea turtle probe's
// shipped query never anchored "turtles" at all. The deterministic
// anchors are the whole query when the fleet caps out, so the race
// now guarantees representation: a boost reliant anchor (short, no
// concept group, no synonym entry, no digit, no scientific
// morphology) holds its slot only while no eligible subject term
// stands outside. These pins run the real builder with NO model
// lookup, the capped fleet condition. The two gut questions' byte
// identical pins above stand unmodified under the new race.

// A rung's head is its anchor: the bare term, or the first member of
// its OR group (the anchor renders first by construction).
const rungHeads = (out) =>
  out.split(" AND ").map((r) => {
    let s = r.trim();
    if (s.startsWith("(")) s = s.slice(1);
    if (s.startsWith('"')) return s.slice(1).split('"')[0];
    return s.split(" OR ")[0].replace(/\)$/, "").trim();
  });

// Plain language probes in the panel's style: everyday wording, the
// panel's observed promoted words present, and the question's
// subject words named so the rule can be asserted in its own form.
const ANCHOR_PROBES = [
  {
    q: "How do mother sea turtles know which sandy beach to crawl back to at night?",
    everyday: ["sandy", "crawl"],
    subjects: ["turtles", "mother"],
  },
  {
    q: "What makes dry branches break and fall while the tree stays alive through winter?",
    everyday: ["break", "while"],
    subjects: ["branches", "winter"],
  },
  {
    q: "Why do rivers carry sandy gravel downstream while the bigger rocks stay behind?",
    everyday: ["carry", "sandy", "while"],
    subjects: ["rivers", "gravel"],
  },
  {
    q: "Why do snakes swallow their prey whole instead of chewing it first?",
    everyday: ["whole"],
    subjects: ["snakes"],
  },
];

await test("no probe ships an everyday anchor while a subject word from the same question is unanchored", () => {
  for (const p of ANCHOR_PROBES) {
    const heads = rungHeads(buildStructuredQuery(p.q.toLowerCase()));
    for (const s of p.subjects) {
      assert.ok(heads.includes(s), `subject "${s}" unanchored in: ${buildStructuredQuery(p.q.toLowerCase())}`);
    }
    for (const e of p.everyday) {
      if (heads.includes(e)) {
        for (const s of p.subjects) {
          assert.ok(
            heads.includes(s),
            `everyday anchor "${e}" shipped while subject "${s}" is unanchored in: ${buildStructuredQuery(p.q.toLowerCase())}`
          );
        }
      }
    }
  }
});

await test("the sea turtle question anchors turtles (the panel's named drop)", () => {
  const out = buildStructuredQuery("How do mother sea turtles know which sandy beach to crawl back to at night?".toLowerCase());
  const heads = rungHeads(out);
  assert.ok(heads.includes("turtles"), `turtles missing from shipped query: ${out}`);
  assert.ok(heads.includes("mother"), `mother missing from shipped query: ${out}`);
  assert.ok(!heads.includes("crawl"), `crawl still a required rung: ${out}`);
  assert.ok(!heads.includes("night"), `night still a required rung: ${out}`);
});

await test("break and while cannot hold rungs against branches and winter", () => {
  const out = buildStructuredQuery("What makes dry branches break and fall while the tree stays alive through winter?".toLowerCase());
  const heads = rungHeads(out);
  assert.ok(heads.includes("branches"), `branches missing from shipped query: ${out}`);
  assert.ok(heads.includes("winter"), `winter missing from shipped query: ${out}`);
  assert.ok(!heads.includes("break"), `break still a required rung: ${out}`);
  assert.ok(!heads.includes("while"), `while still a required rung: ${out}`);
});

await test("carry, sandy, and while cannot hold rungs against rivers and gravel", () => {
  const out = buildStructuredQuery("Why do rivers carry sandy gravel downstream while the bigger rocks stay behind?".toLowerCase());
  const heads = rungHeads(out);
  assert.ok(heads.includes("rivers"), `rivers missing from shipped query: ${out}`);
  assert.ok(heads.includes("gravel"), `gravel missing from shipped query: ${out}`);
  assert.ok(!heads.includes("carry"), `carry still a required rung: ${out}`);
  assert.ok(!heads.includes("sandy"), `sandy still a required rung: ${out}`);
  assert.ok(!heads.includes("while"), `while still a required rung: ${out}`);
});

await test("whole cannot lead the snake question while snakes stands outside", () => {
  const out = buildStructuredQuery("Why do snakes swallow their prey whole instead of chewing it first?".toLowerCase());
  const heads = rungHeads(out);
  assert.equal(heads[0], "snakes", `snakes should lead the shipped query: ${out}`);
  assert.ok(!heads.includes("whole"), `whole still a required rung: ${out}`);
});

await test("frog controls stay clean under the new race", () => {
  // Frog C is byte identical to its pre fix form.
  const c = buildStructuredQuery("Why doesn't freezing kill some frogs in the winter?".toLowerCase());
  assert.equal(c, "frogs AND freezing AND kill AND winter");
  // Frog B keeps every content word it shipped before and gains
  // "winter": the negation led "not" used to win a race slot that
  // the token filter then discarded, shipping only three rungs; the
  // representation pass recycles that wasted slot for the subject
  // term instead of displacing a real word.
  const b = buildStructuredQuery("How can a frog turn into ice all winter and not die?".toLowerCase());
  const heads = rungHeads(b);
  assert.deepEqual([...heads].sort(), ["die", "frog", "ice", "winter"]);
  assert.ok(!heads.includes("not"), `negation word shipped as a rung: ${b}`);
});

// ═══════════════════════════════════════════════════════════════════
group("buildStructuredQuery — organism branch topic list carries content terms only (2026-10-13)");

// Found by the anchor pass, out of its scope: the organism branch
// resolved the organism exactly (wheat to Triticum aestivum) and
// then ANDed it against a topic list built from every leftover
// token verbatim. The grain mills question shipped
//   ("triticum aestivum" OR "Triticum aestivum" OR wheat) AND
//   (why OR grain OR mills OR grind OR berries OR into OR flour OR
//    for OR baking?)
// — interrogatives, prepositions, and half the sentence, punctuation
// still attached. splitOrganismTopic's topic now runs through the
// same word sets the rest of the file trusts (STOPWORDS,
// QUERY_FRAMING_WORDS, EXPANSION_FRAMING_WORDS), with membership
// checked on the raw and punctuation stripped token forms, and the
// topic carries the stripped form. The organism resolution and the
// natural language branch are untouched; the gut and frog control
// pins above stand unmodified under the change.

// The topic side of an organism branch query is its final
// parenthesized OR group.
const topicListOf = (out) => {
  const m = out.match(/ AND \(([^()]*)\)$/);
  return m ? m[1].split(" OR ").map((s) => s.trim()) : [];
};

const ORGANISM_PROBES = [
  {
    q: "Why do grain mills grind wheat berries into flour for baking?",
    binomial: "Triticum aestivum",
    expected:
      '("triticum aestivum" OR "Triticum aestivum" OR wheat) AND ' +
      "(grain OR mills OR grind OR berries OR flour OR baking)",
  },
  {
    q: "How does the wood frog survive being frozen all winter?",
    binomial: "Rana sylvatica",
    expected:
      '("rana sylvatica" OR "lithobates sylvaticus" OR "Rana sylvatica" OR "wood frog") AND ' +
      "(wood OR frog OR survive OR frozen OR winter)",
  },
  {
    q: "How do honey bees keep the hive warm through the winter?",
    binomial: "Apis mellifera",
    expected:
      '("apis mellifera" OR "Apis mellifera" OR "honey bee" OR "honey bees") AND ' +
      "(hive OR warm OR winter)",
  },
  {
    q: "Why does maize wilt so fast under drought in the summer?",
    binomial: "Zea mays",
    expected:
      '("zea mays" OR "Zea mays" OR maize) AND ' +
      "(wilt OR fast OR drought OR summer)",
  },
];

await test("organism probes ship the resolved binomial against a content only topic list", () => {
  for (const p of ORGANISM_PROBES) {
    const out = buildStructuredQuery(p.q);
    assert.equal(out, p.expected, `shipped query changed shape for: ${p.q}`);
    assert.ok(out.includes(p.binomial), `organism no longer resolves for: ${p.q}`);
  }
});

await test("no interrogative, preposition, or framing token enters an organism topic list", () => {
  const closedClass = [
    "why", "how", "what", "does", "do", "the", "a", "an",
    "into", "for", "from", "through", "under", "over", "with",
    "being", "all", "any", "keep", "lets", "make", "anyone",
  ];
  for (const p of ORGANISM_PROBES) {
    const topic = topicListOf(buildStructuredQuery(p.q));
    assert.ok(topic.length > 0, `topic list vanished for: ${p.q}`);
    for (const tok of topic) {
      assert.ok(!closedClass.includes(tok), `closed class token "${tok}" in topic list for: ${p.q}`);
      assert.ok(!/[^\w-]/.test(tok), `punctuation still attached to topic token "${tok}" for: ${p.q}`);
    }
  }
});

await test("an organism question with no content topic left ships the organism phrases alone", () => {
  // "tell" and "about" are framing; once they are filtered the topic
  // is empty and the branch falls back to the organism side only,
  // instead of ANDing the binomial against (tell OR about).
  const out = buildStructuredQuery("Tell me about honey bees");
  assert.ok(out.includes('"apis mellifera"'), `organism no longer resolves: ${out}`);
  assert.ok(!out.includes("tell"), `framing verb shipped in: ${out}`);
  assert.ok(!out.includes("about"), `framing word shipped in: ${out}`);
});

// ═══════════════════════════════════════════════════════════════════
group("stage budgets — a hung first leg no longer starves the second (wave two part two, 2026-10-13)");

// Validation legs used to run at a fixed 4000ms each against a 6000ms
// stage backstop (8000 > 6000): a hung OpenRouter leg consumed its
// whole abort, and any Groq answer arrived after the caller's race
// had already discarded the stage. Expansion was worse: 6000ms legs
// against a 6500ms race left the second leg 500ms. Both stages now
// clamp each leg against the stage's remaining budget with a reserve
// held back for the legs still to come (clampStageLegTimeout).

await test("clamp arithmetic at production scale: validation pair fits its 6000ms backstop", () => {
  const t0 = 100000;
  // Leg 1 keeps its historic full want.
  assert.equal(clampStageLegTimeout({ startedAt: t0, now: t0, budgetMs: 6000, wantMs: 4000, legsAfter: 1 }), 4000);
  // Leg 1 hangs for its full allowance; leg 2 still gets a real shot.
  assert.equal(clampStageLegTimeout({ startedAt: t0, now: t0 + 4000, budgetMs: 6000, wantMs: 4000, legsAfter: 0 }), 1750);
  // The pair sums inside the backstop, so leg 2's answer is usable.
  assert.ok(4000 + 1750 <= 6000);
});

await test("clamp arithmetic at production scale: expansion pair fits its 6500ms race", () => {
  const t0 = 100000;
  // Leg 1 is the one that changes: 6000 down to 4500 so the reserve exists.
  assert.equal(clampStageLegTimeout({ startedAt: t0, now: t0, budgetMs: 6500, wantMs: 6000, legsAfter: 1 }), 4500);
  assert.equal(clampStageLegTimeout({ startedAt: t0, now: t0 + 4500, budgetMs: 6500, wantMs: 6000, legsAfter: 0 }), 1750);
  assert.ok(4500 + 1750 <= 6500);
});

await test("clamp arithmetic: a fast failing first leg leaves the second its full want", () => {
  const t0 = 100000;
  // Leg 1 fails in 5ms (today's capped fleet behavior): leg 2 is
  // clamped by its want, not by the reserve math. Fast fail behavior
  // is byte for byte the old behavior.
  assert.equal(clampStageLegTimeout({ startedAt: t0, now: t0 + 5, budgetMs: 6000, wantMs: 4000, legsAfter: 0 }), 4000);
  assert.equal(clampStageLegTimeout({ startedAt: t0, now: t0 + 5, budgetMs: 6500, wantMs: 6000, legsAfter: 0 }), 6000);
  // And an already blown budget still yields the floor, never zero or negative.
  assert.equal(clampStageLegTimeout({ startedAt: t0, now: t0 + 99999, budgetMs: 6000, wantMs: 4000, legsAfter: 0 }), 500);
});

const hangUntilAbort = (init) => new Promise((_, reject) => {
  const sig = init && init.signal;
  if (sig) sig.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
});
// Scaled stage timings so the hang scenario runs in about a second:
// budget 1200, want 800, reserve 350 per later leg, final reserve 50.
// Leg 1 clamps to min(800, 1200-400) = 800; leg 2 then gets 350.
const SCALED = { budgetMs: 1200, wantMs: 800, reservePerLegMs: 350, finalReserveMs: 50, floorMs: 40 };

await test("a hung OpenRouter validation leg aborts on budget and the Groq leg answers inside the stage", async () => {
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = (url, init) => {
    urls.push(String(url));
    if (String(url).includes("openrouter.ai")) return hangUntilAbort(init);
    return Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: "[{\"id\":1,\"verdict\":\"RELEVANT\"}]" } }] }),
    });
  };
  try {
    const started = Date.now();
    const out = await defaultValidationCall([{ role: "user", content: "x" }], "or-token", { GROQ_KEY: "groq-key" }, SCALED);
    const elapsed = Date.now() - started;
    assert.equal(out && out.via, "groq", "the second leg must answer after the first hangs");
    assert.equal(urls.length, 2);
    assert.ok(urls[0].includes("openrouter.ai") && urls[1].includes("api.groq.com"), "leg order unchanged");
    assert.ok(elapsed >= 700, `leg 1 should hang until its clamped abort (~800ms), took ${elapsed}ms`);
    assert.ok(elapsed < 1150, `the pair must land inside the 1200ms stage budget, took ${elapsed}ms`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("a hung OpenRouter expansion leg aborts on budget and the Groq leg answers inside the race", async () => {
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = (url, init) => {
    urls.push(String(url));
    if (String(url).includes("openrouter.ai")) return hangUntilAbort(init);
    return Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: "{\"groups\":[[\"germs\",\"microbes\"]]}" } }] }),
    });
  };
  try {
    const started = Date.now();
    const out = await defaultConceptGroupCall("can germs in your belly make you sick", { OPENROUTER_KEY: "or-key", GROQ_KEY: "groq-key" }, SCALED);
    const elapsed = Date.now() - started;
    assert.equal(out && out.via, "groq", "the second leg must answer after the first hangs");
    assert.ok(out.text.includes("microbes"), "the second leg's body is the one returned");
    assert.equal(urls.length, 2);
    assert.ok(urls[0].includes("openrouter.ai") && urls[1].includes("api.groq.com"), "leg order unchanged");
    assert.ok(elapsed >= 700, `leg 1 should hang until its clamped abort (~800ms), took ${elapsed}ms`);
    assert.ok(elapsed < 1150, `the pair must land inside the 1200ms stage budget, took ${elapsed}ms`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("fast fail is unchanged: an instantly failing first leg costs the second nothing", async () => {
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes("openrouter.ai")) return { ok: false, status: 429, json: async () => ({}) };
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: "[{\"id\":1,\"verdict\":\"RELEVANT\"}]" } }] }),
    };
  };
  try {
    const started = Date.now();
    // No timing override: production budgets. An instant failure must
    // not burn any of them.
    const out = await defaultValidationCall([{ role: "user", content: "x" }], "or-token", { GROQ_KEY: "groq-key" });
    const elapsed = Date.now() - started;
    assert.equal(out && out.via, "groq");
    assert.equal(urls.length, 2);
    assert.ok(elapsed < 1000, `fast fail must stay fast, took ${elapsed}ms`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ═══════════════════════════════════════════════════════════════════
group("stage health plumbing — reasons ship, skips do not degrade (wave two part two, 2026-10-13)");

await test("the serializer ships a failed validation's skipReason", () => {
  // finalizeValidationHealth records WHY no leg answered; the public
  // serializer used to whitelist it away.
  const rec = { name: "validation", ok: true, ms: 38 };
  finalizeValidationHealth(rec, { llmValidatedVia: null });
  const shipped = publicStageHealth([rec]);
  assert.equal(shipped.length, 1);
  assert.equal(shipped[0].ok, false);
  assert.equal(shipped[0].via, null);
  assert.equal(shipped[0].skipReason, "no leg answered");
});

await test("the serializer ships synthesis skip reasons and omits the field when unset", () => {
  const shipped = publicStageHealth([
    { name: "synthesis", ok: false, ms: 9000, skipReason: "all legs failed", winner: null, winnerMs: null, legs: 3, failedLegs: ["groq"] },
    { name: "retrieval", ok: true, ms: 120 },
  ]);
  assert.equal(shipped[0].skipReason, "all legs failed");
  assert.deepEqual(shipped[0].failedLegs, ["groq"]);
  assert.ok(!("skipReason" in shipped[1]), "no reason recorded, no reason shipped");
  assert.deepEqual(publicStageHealth(null), []);
  assert.deepEqual(publicStageHealth(undefined), []);
});

await test("a skipped stage passes through with ok null intact, neither success nor failure", () => {
  const shipped = publicStageHealth([
    { name: "fact-check", ok: null, skipReason: "nothing to verify", ms: 3 },
  ]);
  assert.equal(shipped[0].ok, null);
  assert.equal(shipped[0].skipReason, "nothing to verify");
});

await test("a nothing to verify fact check no longer degrades a healthy answer", () => {
  const healthy = [
    { name: "retrieval", ok: true },
    { name: "validation", ok: true },
    { name: "fact-check", ok: null, skipReason: "nothing to verify" },
    { name: "synthesis", ok: true },
    { name: "disagreement", ok: true },
  ];
  assert.equal(stageHealthDegraded(healthy), false);
  assert.equal(stageHealthDegraded([]), false);
  assert.equal(stageHealthDegraded(null), false);
});

await test("degraded still fires on a real stage failure", () => {
  assert.equal(stageHealthDegraded([{ name: "validation", ok: false, skipReason: "no leg answered" }]), true);
  assert.equal(stageHealthDegraded([{ name: "fact-check", ok: null }, { name: "synthesis", ok: false }]), true);
});

await test("the handler ships stage health through the serializer and the shared degraded rule", () => {
  const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
  assert.match(src, /stageHealth: publicStageHealth\(stageHealth\)/,
    "the main response does not serialize stage health through publicStageHealth");
  assert.match(src, /degraded: stageHealthDegraded\(stageHealth\) \|\| responseKind === "no-results"/,
    "the response degraded flag does not use the shared rule");
  assert.match(src, /degraded: !!extractiveOK \|\| stageHealthDegraded\(stageHealth\)/,
    "the confidence degraded input does not use the shared rule");
  assert.ok(!src.includes("stageHealth.some((s) => !s.ok)"),
    "an inline !s.ok degraded computation survives somewhere");
});

await test("fact check stage records skips with reasons and real elapsed time", () => {
  const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
  // CORRECTED CONTRACT (2026-10-13, subrequest ledger): the fact check
  // skipReason is now a three way choice . a budget skip (the
  // invocation subrequest allowance was spent) takes precedence over
  // the two pre existing reasons, which are unchanged.
  assert.ok(src.includes('"nothing to verify"'), "the nothing to verify skip is not recorded");
  // PIN UPDATED (2026-10-14, wave thirteen): the skip reason is
  // built from the claim check's tier trace and its named non
  // attempt causes. The distinction this pin protected survives
  // — an attempted run's skip still leads with "nothing to
  // verify" (now with the tier outcomes attached when the tiers
  // failed) and a non attempt still says the check did not run
  // (now with its cause: toggle off, no time, or budget) — but
  // the old literal ternary is gone, replaced by the trace
  // driven computation.
  assert.ok(src.includes('"nothing to verify — deep tiers: " + fcTierSummary'),
    "an attempted run's skip does not name the failed deep tiers");
  assert.ok(src.includes('factCheckSkipCause || "fact check did not run"'),
    "the did not run skip is not distinguished from nothing to verify");
  assert.ok(src.includes("factCheckBudgetSkipped") && src.includes("SUBREQUEST_EXHAUSTED_REASON"),
    "the budget skip reason is not recorded for the fact check stage");
  assert.equal((src.match(/Date\.now\(\) - factCheckT0/g) || []).length, 4,
    "all four fact check pushes (checked and skipped, both paths) must carry real elapsed ms");
  assert.ok(!src.includes('"fact-check", ok: !!factCheckResult, ms: 0'),
    "the old extractive fact check push (ok false on nothing to verify, ms 0) survives");
  assert.ok(!src.includes('stageHealth.push({ name: "disagreement", ok: true, ms: 0 })'),
    "the disagreement stage still hardcodes ms 0");
  assert.ok(src.includes("ms: Date.now() - disagreementT0"), "the disagreement stage does not record real elapsed ms");
});

// ═══════════════════════════════════════════════════════════════════
group("structured query hygiene — filler never becomes a requirement (2026-10-14)");

// The live trace, reproduced from its pieces. Production question:
// "does not sleeping enough make it easier to catch a cold". The
// pipeline's cleaned form of it (STOPWORDS stripped, lemmatized)
// and the one expansion group that draw validated. The shipped
// structured query required the quantity word "enough" as a
// mandatory AND term, the primary retrieval starved on it, and
// the fallback nets spent the answer reserve behind it.
const SLEEP_CLEANED = "not sleep enough easier catch cold";
const SLEEP_RAW = "does not sleeping enough make it easier to catch a cold";
const COLD_GROUP = [{
  term: "easier catch cold",
  alternates: ["increased susceptibility to colds", "elevated cold incidence"],
}];
const SLEEP_GROUP = [{
  term: "sleep",
  alternates: ["sleeping", "sleep deprivation", "insufficient sleep", "sleep loss", "sleep deficit"],
}];
const TRACE_QUERY =
  "(\"easier catch cold\" OR \"increased susceptibility to colds\" OR \"elevated cold incidence\") AND sleep AND enough";

await test("the trace's pieces now author the hygienic query, not the trace string", () => {
  // PIN UPDATED (2026-10-15, wave seventeen): the builder can
  // no longer reproduce the trace string, by design. "enough"
  // is closed class now and can never occupy an anchor slot
  // again (citation depth diagnosis, stage 2 hygiene), and
  // "sleep" renders its static concept group instead of a bare
  // anchor (stage 4: the bridge lives in the tables, not in a
  // lucky expansion draw). TRACE_QUERY stays above as the
  // literal specimen the screen pins below exercise — it is
  // the historical shipped string, not a buildable one.
  // PIN UPDATED (2026-10-22, search diagnosis): the sleep
  // group renders phrase first now, so the restriction
  // vocabulary the table's tail carried ("sleep restriction",
  // "chronic sleep restriction") survives the seven member
  // window and the inflection tail (sleeping, slept, insomnia)
  // falls outside it. Rendering in the rebuild pins below
  // changed the same way, the cold group's single tail member
  // (rhinovirus) likewise yielding its slot to the phrases.
  const authored = buildStructuredQuery(SLEEP_CLEANED, buildDynLookup(COLD_GROUP));
  assert.equal(authored,
    "(\"easier catch cold\" OR \"increased susceptibility to colds\" OR \"elevated cold incidence\") AND (sleep OR \"sleep deprivation\" OR \"sleep duration\" OR \"sleep quality\" OR \"sleep restriction\" OR \"sleep restricted\" OR \"chronic sleep restriction\")");
  assert.ok(!authored.split(" AND ").includes("enough"),
    "the authored query still requires enough: " + authored);
});

await test("the screen fails the trace query on exactly the filler rung", () => {
  const screen = screenStructuredQuery(TRACE_QUERY);
  assert.equal(screen.ok, false);
  assert.deepEqual(screen.failedRungs, ["enough"],
    "only the quantity word rung may fail: the phrase group carries content (cold), sleep is content");
  assert.deepEqual(queryTermContentWords("enough"), []);
  assert.deepEqual(queryTermContentWords("sleep"), ["sleep"]);
  assert.deepEqual(queryTermContentWords("easier catch cold"), ["cold"],
    "the degree comparative and the light verb are filler; the topic word is the content");
});

await test("a failed authored query is rebuilt from the resolved concept groups", () => {
  const dyn = buildDynLookup(COLD_GROUP);
  const rebuilt = rebuildStructuredQueryFromGroups(SLEEP_CLEANED, dyn);
  // PIN UPDATED (2026-10-15, wave seventeen): the rebuild
  // used to carry only the draw's one phrase group, because
  // no hand group resolved sleep or cold. The static bridges
  // (diagnosis stage 4) resolve both concepts from the table
  // now, so the rebuild carries the two real concepts — the
  // contract (resolved concepts, screens clean, no filler) is
  // unchanged, the resolution source is the table.
  assert.equal(rebuilt,
    "(sleep OR \"sleep deprivation\" OR \"sleep duration\" OR \"sleep quality\" OR \"sleep restriction\" OR \"sleep restricted\" OR \"chronic sleep restriction\") AND (cold OR \"common cold\" OR \"upper respiratory infection\" OR \"upper respiratory tract infection\" OR \"respiratory infection\" OR rhinovirus)");
  assert.equal(screenStructuredQuery(rebuilt).ok, true, "the rebuilt query must pass its own screen");
  // The shipped form (rebuild when possible) contains no filler rung.
  const shipped = rebuilt || dropFailedRungs(TRACE_QUERY, screenStructuredQuery(TRACE_QUERY).failedRungs);
  assert.ok(!/ AND enough$/.test(shipped) && !shipped.split(" AND ").includes("enough"),
    "the shipped query still requires enough: " + shipped);
});

await test("with the sleep group resolved too, the rebuild carries both concepts and no filler", () => {
  const dyn = buildDynLookup([...SLEEP_GROUP, ...COLD_GROUP]);
  const authored = buildStructuredQuery(SLEEP_CLEANED, dyn);
  // PIN UPDATED (2026-10-15, wave seventeen): this asserted
  // the authored query FAILED its screen on the enough rung.
  // There is no enough rung anymore — the word is closed
  // class and cannot be authored as a requirement — so the
  // authored query screens clean, which is the outcome the
  // hygiene wave existed to produce.
  assert.equal(screenStructuredQuery(authored).ok, true, "the sleep draw still ships a failing rung: " + authored);
  const rebuilt = rebuildStructuredQueryFromGroups(SLEEP_CLEANED, dyn);
  assert.ok(rebuilt.includes("\"sleep deprivation\""), "the sleep group is missing from the rebuild: " + rebuilt);
  // The rebuild resolves the cold side from the hand table's
  // cold group (wave seventeen seeding), not the draw's
  // phrase group, so its members are the table's.
  assert.ok(rebuilt.includes("\"common cold\""), "the cold group is missing from the rebuild: " + rebuilt);
  assert.equal(screenStructuredQuery(rebuilt).ok, true);
});

await test("with no expansion at all, the static groups resolve and the failed rung drops", () => {
  // No expansion at all: the deterministic build itself anchors the
  // light verb, the comparative, and the quantity word.
  // 2026-10-14 (wave eight, Job 3a): the authored order is now
  // "sleep AND catch AND enough AND easier". The old order
  // ("...easier AND enough") was an artifact of the negation word
  // "not" winning a race slot and the displacement pass recycling
  // that slot in place; closed class words no longer occupy rung
  // slots at all, so the tail keeps race order (specificity, then
  // question order). The contract is unchanged: the three filler
  // rungs fail the screen and drop, the survivor ships.
  // PIN UPDATED (2026-10-15, wave seventeen): the premise is
  // gone. "enough" and "easier" are closed class and are never
  // authored, and the hand table resolves the sleep and cold
  // groups statically (diagnosis stage 4), so the no expansion
  // build authors the sleep group plus the one light verb rung
  // the screen still fails, and a rebuild from the resolved
  // groups — previously impossible here — now exists and
  // carries both concepts. The surviving contract: the failed
  // rung drops and the survivors ship.
  const authored = buildStructuredQuery(SLEEP_CLEANED, null);
  assert.equal(authored,
    "(sleep OR \"sleep deprivation\" OR \"sleep duration\" OR \"sleep quality\" OR \"sleep restriction\" OR \"sleep restricted\" OR \"chronic sleep restriction\") AND catch");
  const screen = screenStructuredQuery(authored);
  assert.deepEqual(screen.failedRungs, ["catch"]);
  assert.equal(rebuildStructuredQueryFromGroups(SLEEP_CLEANED, null),
    "(sleep OR \"sleep deprivation\" OR \"sleep duration\" OR \"sleep quality\" OR \"sleep restriction\" OR \"sleep restricted\" OR \"chronic sleep restriction\") AND (cold OR \"common cold\" OR \"upper respiratory infection\" OR \"upper respiratory tract infection\" OR \"respiratory infection\" OR rhinovirus)",
    "the static groups resolve sleep and cold, so the rebuild exists");
  assert.equal(dropFailedRungs(authored, screen.failedRungs),
    "(sleep OR \"sleep deprivation\" OR \"sleep duration\" OR \"sleep quality\" OR \"sleep restriction\" OR \"sleep restricted\" OR \"chronic sleep restriction\")");
});

// ═══════════════════════════════════════════════════════════════════
group("search diagnosis — phrase first groups and the paired omics comparison (2026-10-22)");

await test("the sleep clause ships the restriction vocabulary inside the member window", () => {
  // The diagnosis trace: the sleep group's restriction members
  // sat at table positions 9 to 13 while both boolean builders
  // render seven, so no executed query ever named the
  // restriction literature. The rendering above pins the new
  // form; this pins the property directly on a fresh phrasing.
  const out = buildStructuredQuery("does sleeping only six hours a night for two weeks make you worse at thinking", null);
  assert.ok(out.includes("\"sleep restriction\""), "restriction phrase missing: " + out);
  assert.ok(out.includes("\"chronic sleep restriction\""), "chronic restriction phrase missing: " + out);
});

await test("the paired omics comparison resolves both subjects and their ratio", () => {
  const q = "Are there any primary research papers that compares the ratio of metagenomics to metatranscriptomics reads of organisms in order to get a sense of abundance:relative gene expression?";
  assert.deepEqual(pairedOmicsComparison(q), ["metagenome", "metatranscriptome"]);
  const groups = questionConceptGroups(q.toLowerCase(), null);
  const flat = groups.flatMap((g) => [...g]).map((m) => String(m).toLowerCase());
  assert.ok(flat.includes("metagenome"), "metagenome group unresolved: " + JSON.stringify(groups));
  assert.ok(flat.includes("metatranscriptome"), "metatranscriptome group unresolved: " + JSON.stringify(groups));
  assert.ok(flat.includes("rna dna ratio"), "expression ratio group unresolved: " + JSON.stringify(groups));
});

await test("a single subject omics question is not a comparison shape", () => {
  assert.equal(pairedOmicsComparison("how is a metagenome assembled from shotgun reads"), null);
  assert.equal(pairedOmicsComparison("what does the ratio of reads mean in metagenomics"), null);
  assert.equal(pairedOmicsComparison("how does sleep restriction affect cognition"), null);
});

await test("the analysis key phrases are screened: filler out, genuine constraints untouched", () => {
  assert.deepEqual(analyzeQuery(SLEEP_RAW).keyPhrases, ["sleeping", "cold"],
    "the trace's glued phrases must not survive as constraints");
  // The panel's other named failure: "leftover" as a required word.
  const leftover = analyzeQuery("is there leftover food waste that can feed black soldier fly larvae");
  assert.ok(leftover.keyPhrases.includes("food waste"), "the real constraint survives: " + JSON.stringify(leftover.keyPhrases));
  assert.ok(!leftover.keyPhrases.some((p) => p.includes("leftover")), "leftover survived screening: " + JSON.stringify(leftover.keyPhrases));
  // Genuine content phrases pass word for word.
  assert.deepEqual(analyzeQuery("how does creatine affect hair loss").keyPhrases, ["creatine hair loss"]);
  assert.deepEqual(analyzeQuery("Studies involving BSFL waste oil substrates").keyPhrases, ["waste oil"]);
  assert.deepEqual(analyzeQuery("Do the germs in a baby belly change how well the baby grows").keyPhrases,
    ["germs baby belly", "baby"]);
  // The screen itself, word level.
  assert.equal(screenKeyPhrase("not sleeping enough"), "sleeping");
  assert.equal(screenKeyPhrase("easier catch cold"), "cold");
  assert.equal(screenKeyPhrase("enough"), "");
  assert.equal(screenKeyPhrase("whole gut preparations"), "whole gut preparations");
  assert.equal(screenKeyPhrase("sleep deprivation"), "sleep deprivation");
});

await test("clean authored queries ship unchanged (the screen is not a rewrite)", () => {
  const clean = [
    "has anyone assayed digestive enzymes in whole gut preparations from insects without isolating the enzymes",
    "do the germs in a baby belly change how well the baby grows",
    "how does creatine affect hair loss",
    "studies involving bsfl waste oil substrates",
  ];
  for (const q of clean) {
    const authored = buildStructuredQuery(q, null);
    const screen = screenStructuredQuery(authored);
    assert.equal(screen.ok, true, `a clean query failed the screen: ${q} -> ${authored} [${screen.failedRungs}]`);
  }
});

await test("the record carries the rebuild provenance, and stays null for clean queries", () => {
  const base = {
    question: SLEEP_RAW,
    askedAt: 0,
    sources: [{ title: "Sleep duration and cold susceptibility", url: "https://example.com/s" }],
    funnel: { gathered: 3, deduped: 2, cited: 0 },
    databases: [{ source: "europePMC", ok: true, count: 2 }],
  };
  const rebuiltRec = buildSearchRecord({
    ...base,
    structuredQuery: "(\"easier catch cold\" OR \"increased susceptibility to colds\")",
    diag: {
      structuredQueryProvenance: {
        screenFailed: true,
        failedRungs: ["enough"],
        rebuilt: true,
        source: "concept-groups",
        rejected: TRACE_QUERY,
      },
    },
  });
  assert.deepEqual(rebuiltRec.structuredQueryProvenance, {
    screenFailed: true,
    failedRungs: ["enough"],
    rebuilt: true,
    source: "concept-groups",
    rejected: TRACE_QUERY,
  });
  const cleanRec = buildSearchRecord({ ...base, structuredQuery: "creatine AND hair" });
  assert.equal(cleanRec.structuredQueryProvenance, null,
    "a clean query's record must not claim a degradation that never happened");
});

// ═══════════════════════════════════════════════════════════════════
group("deterministic fallback expansion (2026-10-14, fourth panel)");

// The panel's creatine specimen, in the mismatched everyday
// wording the standing rule requires: neither the substance nor
// the body part sits in any hand table group, so with the model
// leg returning zero groups these are exactly the terms the
// gather's dynUncovered carries.
const CREATINE_Q = "does creatine make your hair fall out";
const CREATINE_PAPERS = () => [
  {
    title: "Creatine monohydrate supplementation and hair shedding: a randomized trial",
    abstract: "Men taking creatine monohydrate were followed for twelve weeks. Hair density and hair shedding counts did not differ from placebo, and dihydrotestosterone stayed in the normal range.",
    url: "https://example.com/creatine-hair-trial",
  },
  {
    title: "Hair in the schoolyard: hair policies and belonging in English schools",
    abstract: "This sociology paper examines how school hair rules shape pupils' sense of identity and belonging. Hair is treated as culture and self expression throughout.",
    url: "https://example.com/hair-sociology",
  },
  {
    title: "Panacea: cure alls in the history of popular medicine",
    abstract: "A history of universal remedies, from hair tonics to bottled elixirs, and the promises their sellers made across two centuries of popular medicine.",
    url: "https://example.com/panacea",
  },
];

await test("fallback covers the uncovered central terms, in the model's own shape", () => {
  const groups = buildDeterministicFallbackGroups(CREATINE_Q, ["creatine", "hair", "fall"]);
  assert.deepEqual(groups.map((g) => g.term), ["creatine", "hair", "fall"]);
  for (const g of groups) {
    // Corrected contract (2026-10-14, sixth panel, wave seven):
    // a group no longer has to carry a manufactured alternate.
    // The old pin demanded at least one alternate per group,
    // which is what forced the builder to mint a plural for
    // every uncovered term — the generation path that produced
    // the panel's non word alternates ("sinces", "looses",
    // "runnies"). A group tests membership through its term
    // (buildDynLookup carries the term in the set); alternates
    // are present only when a table or a plausible noun form
    // supplies one.
    assert.ok(Array.isArray(g.alternates), `group for ${g.term} has no alternates array`);
    assert.ok(!g.alternates.includes(g.term), "a group never lists its own term as an alternate");
  }
  // The groups feed the same lookup the model groups feed, and
  // the gating resolution then sees the question's concepts.
  const dyn = buildDynLookup(groups);
  assert.ok(gateConceptGroups(CREATINE_Q, dyn).length >= 2,
    "the fallback groups must resolve for gating");
});

await test("fallback attaches a curated group through inflection", () => {
  // "diets" is nobody's group key, but its singular is a member of
  // the curated nutrition group, so the whole group attaches.
  const groups = buildDeterministicFallbackGroups("do diets change gut germs", ["diets"]);
  assert.equal(groups.length, 1);
  assert.ok(groups[0].alternates.includes("diet") && groups[0].alternates.includes("nutrition"),
    `curated group did not attach: ${JSON.stringify(groups)}`);
});

await test("fallback walks the synonyms table through a phrase the question speaks", () => {
  const groups = buildDeterministicFallbackGroups("what do black soldier fly larvae eat", ["soldier"]);
  assert.equal(groups.length, 1);
  assert.ok(groups[0].alternates.some((a) => a.includes("hermetia illucens")),
    `the organism bridge is missing: ${JSON.stringify(groups)}`);
});

await test("fallback never re-covers covered terms or framing words", () => {
  assert.deepEqual(buildDeterministicFallbackGroups("anything", ["gut"]), [],
    "a term the hand table covers needs no fallback group");
  assert.deepEqual(buildDeterministicFallbackGroups("anything", ["researcher"]), [],
    "a framing word gets no group");
  assert.deepEqual(buildDeterministicFallbackGroups("anything", ["viruses"]), [],
    "a curated group member is already covered");
});

await test("fallback honors the validator's caps (four groups)", () => {
  const groups = buildDeterministicFallbackGroups("q", ["zorblaxin", "quixotase", "wobble", "tremor", "fluxion"]);
  assert.equal(groups.length, 4);
});

await test("inflection variants stay inside the word family", () => {
  assert.ok(inflectionVariants("germs").has("germ"));
  assert.ok(inflectionVariants("baby").has("babies") && !inflectionVariants("baby").has("babys"));
  assert.ok(inflectionVariants("sleeping").has("sleep"));
  // Different concepts that share a prefix are not inflections:
  // the fallback must never bridge them into one group.
  assert.ok(!inflectionVariants("creatine").has("creatinine"));
  assert.ok(!inflectionVariants("germ").has("germination"));
});

await test("the strategies line names the fallback as the fallback", () => {
  const out = retrievalStrategiesTried({
    llmExpanded: [{ term: "creatine", alternates: ["creatines"] }],
    llmExpandedVia: "fallback",
  });
  assert.ok(out.some((s) => s.includes("deterministic fallback expansion (1 terms)")),
    `fallback line missing: ${out}`);
  assert.ok(!out.some((s) => s.includes("model proposed")),
    "the fallback must not wear the model's name");
});

// ═══════════════════════════════════════════════════════════════════
group("the citation standard below two groups (2026-10-14, fourth panel)");

await test("central content terms are the question's specific words, minus the closed class", () => {
  assert.deepEqual(centralContentTerms(CREATINE_Q), ["creatine", "hair", "fall"]);
  const frog = centralContentTerms("What lets a wood frog survive being frozen for months at a time?");
  assert.ok(frog.includes("frog") && frog.includes("frozen"), `frog terms: ${frog}`);
  assert.ok(!frog.includes("being") && !frog.includes("your") && !frog.includes("not"),
    `closed class leaked into the standard: ${frog}`);
});

await test("creatine shape: with fallback groups, hair only and neither papers lose their markers", () => {
  const dyn = buildDynLookup(buildDeterministicFallbackGroups(CREATINE_Q, ["creatine", "hair", "fall"]));
  const papers = CREATINE_PAPERS();
  const answer = "Creatine did not change shedding [1]. Hair rules shape belonging [2]. Cure alls promised everything [3].";
  const out = applyConceptCoverageGate(answer, papers, CREATINE_Q, dyn);
  assert.ok(out.text.includes("[1]"), "the on point creatine paper keeps its marker");
  assert.deepEqual(out.demoted.map((d) => d.idx), [2, 3],
    "the hair only sociology paper and the neither paper are demoted to further reading");
});

// ═══════════════════════════════════════════════════════════════════
group("subject touch standard (2026-10-14)");

// The production failure this wave answers (build 75dd771): the
// creatine question shipped citing exactly one paper, a sociology
// paper about Black hair in English schools that never mentions
// creatine. It cleared because a lexical touch of the EFFECT group
// counted as answering a question whose SUBJECT it never touches.
// The corrected standard: with a subject group identified, a paper
// clears by touching the subject group or by touching at least
// two groups in total; a lone non subject touch no longer clears.
// Identification is deterministic, off machinery the codebase
// already computes (see subjectConceptGroup): the organism route,
// the causative frame's subject slot, the lead key phrase. The
// fixtures below are worded in everyday language against
// paper written language, per the standing rule.

const CREATINE_FALLBACK_DYN = () =>
  buildDynLookup(buildDeterministicFallbackGroups(CREATINE_Q, ["creatine", "hair", "fall"]));
const CREATINE_SUBJECT_ONLY = () => ({
  title: "Creatine supplementation and kidney function in healthy adults",
  abstract: "Adults taking creatine monohydrate daily for two years showed no change in kidney function. Creatine was well tolerated, and blood markers stayed in the normal range in both arms of the study.",
  url: "https://example.com/creatine-kidney",
});
const CREATINE_HAIR_FALL = () => ({
  title: "Hair loss after childbirth: shedding and regrowth",
  abstract: "Postpartum hair loss peaks as strands fall out in the months after delivery, and most hair regrows within a year.",
  url: "https://example.com/postpartum-hair",
});

await test("the subject group is the creatine group, under fallback and under model groups", () => {
  const dyn = CREATINE_FALLBACK_DYN();
  const groups = gateConceptGroups(CREATINE_Q, dyn);
  const subject = subjectConceptGroup(CREATINE_Q, groups, dyn);
  assert.ok(subject && subject.has("creatine"),
    "the causative frame names creatine as the subject: " + JSON.stringify(groups.map((g) => [...g][0])));
  assert.equal(citationGateStandard(CREATINE_Q, dyn).subjectGroup, subject,
    "the standard itself must carry the identified subject group");
  const modelDyn = buildDynLookup([
    { term: "creatine", alternates: ["creatine monohydrate", "creatine supplementation"] },
    { term: "hair fall out", alternates: ["hair loss", "alopecia", "telogen effluvium", "hair shedding"] },
  ]);
  const modelSubject = subjectConceptGroup(CREATINE_Q, gateConceptGroups(CREATINE_Q, modelDyn), modelDyn);
  assert.ok(modelSubject && modelSubject.has("creatine"),
    "with the production model groups the subject is still the creatine group");
});

await test("a subject only paper no longer clears; an effect only paper does not; two non subject groups clear", () => {
  // 2026-10-14 (wave eight, Job 1b): the subject touch standard
  // this test pinned (one touch of the subject group clears) IS
  // the vacuous standard the seventh panel measured — a paper
  // engaging only the subject, and nothing else the question
  // asks, is a one concept paper, and the corrected standard
  // requires two central concepts (or the subject plus a second
  // in the title). The subject only safety paper therefore no
  // longer clears, and the gate demotes it beside the effect
  // only paper. The two group limb stands exactly as before.
  const standard = citationGateStandard(CREATINE_Q, CREATINE_FALLBACK_DYN());
  assert.equal(paperConceptGroupHits(CREATINE_SUBJECT_ONLY(), standard.groups), 1,
    "control: the safety paper touches exactly one group");
  assert.ok(!paperClearsCitationGate(CREATINE_SUBJECT_ONLY(), standard),
    "a paper touching only the subject group must not clear the corrected standard");
  assert.ok(!paperClearsCitationGate(CREATINE_PAPERS()[1], standard),
    "the hair only sociology paper must not clear the standard");
  assert.ok(paperClearsCitationGate(CREATINE_HAIR_FALL(), standard),
    "a paper touching two non subject groups still clears on the two group limb");
  const papers = [CREATINE_PAPERS()[1], CREATINE_SUBJECT_ONLY(), CREATINE_PAPERS()[0]];
  const answer = "Hair rules shape belonging [1]. Creatine was well tolerated for two years [2]. Creatine did not change shedding [3].";
  const out = applyConceptCoverageGate(answer, papers, CREATINE_Q, CREATINE_FALLBACK_DYN());
  assert.deepEqual(out.demoted.map((d) => d.idx), [1, 2],
    "the gate demotes the effect only paper and the subject only paper; the two concept trial keeps its marker");
  assert.ok(out.text.includes("[3]") && !out.text.includes("[2]"), "only the trial keeps its marker");
});

await test("the topic filter still admits the subject only paper to the pool, one layer earlier", () => {
  // 2026-10-14 (wave eight, Job 1b): the filter's subject rule is
  // now a POOL admission rule, not the citation standard — the
  // subject only paper may sit in the pool as further reading,
  // but the corrected gate no longer cites it (pinned above).
  // The effect only paper still dies here, as it may neither be
  // cited nor shipped.
  const dyn = CREATINE_FALLBACK_DYN();
  const out = topicOverlapFilter(CREATINE_Q,
    [CREATINE_SUBJECT_ONLY(), CREATINE_PAPERS()[1], CREATINE_HAIR_FALL()].map((p) => ({ ...p })), dyn);
  const urls = out.map((p) => p.url);
  assert.ok(urls.includes("https://example.com/creatine-kidney"),
    "the subject only paper must survive retrieval into the pool");
  assert.ok(!urls.includes("https://example.com/hair-sociology"),
    "the effect only paper must die in the filter, as it may not be cited");
});

await test("subject identification: the organism route, the lead phrase route, and the crop tiebreak", () => {
  const bsflQ = "Does Hermetia illucens gut bacteria help it digest waste oil?";
  const bsflSubject = subjectConceptGroup(bsflQ, gateConceptGroups(bsflQ, null), null);
  assert.ok(bsflSubject && bsflSubject.has("black soldier fly"),
    "the named organism's group is the subject");
  const bellyQ = "Do the germs in a baby belly change how well the baby grows";
  const bellyGroups = gateConceptGroups(bellyQ, null);
  const bellySubject = subjectConceptGroup(bellyQ, bellyGroups, null);
  assert.ok(bellySubject && bellySubject.has("microbiome") && !bellySubject.has("gut"),
    "the belly question's subject is the microbe group, not the gut group the collisions touch");
  const gutQ = "what happens to a baby's gut germs in the first year";
  const gutDyn = buildDynLookup(buildDeterministicFallbackGroups(gutQ, ["baby"]));
  const gutSubject = subjectConceptGroup(gutQ, gateConceptGroups(gutQ, gutDyn), gutDyn);
  assert.ok(gutSubject && gutSubject.has("gut"),
    "the baby gut question's subject is the gut group (the infant gut concept)");
  // The gut group also carries the single word "crop" (a bird's
  // stomach organ); the phrase "crop rotation" must still name
  // the rotation group — longest member wins a tie at one spot.
  const rotQ = "does crop rotation improve soil fertility over time";
  const rotSubject = subjectConceptGroup(rotQ, gateConceptGroups(rotQ, null), null);
  assert.ok(rotSubject && rotSubject.has("crop rotation"),
    "the rotation question's subject is the crop rotation group, not the gut group");
});

await test("no subject group for the two concept sleep question: the founding standard is untouched", () => {
  // The wave two founding shape: "does not getting enough sleep
  // make you more likely to catch a cold" puts a CLAUSE in the
  // causative frame's subject slot, not an entity, so no subject
  // group is identified and the both concepts standard applies
  // exactly as before — a sleep only paper and a cold only paper
  // are both still demoted (pinned end to end in
  // tests/search-wave-two.mjs).
  const sleepQ = "does not getting enough sleep make you more likely to catch a cold";
  const sleepDyn = buildDynLookup([
    { term: "sleep", alternates: ["insomnia", "sleep deprivation", "sleep loss"] },
    { term: "cold", alternates: ["common cold", "upper respiratory infection", "rhinovirus"] },
  ]);
  const groups = gateConceptGroups(sleepQ, sleepDyn);
  assert.equal(groups.length, 2, "control: the sleep question resolves its two groups");
  assert.equal(subjectConceptGroup(sleepQ, groups, sleepDyn), null,
    "a clause in the subject slot identifies no subject group");
  assert.equal(citationGateStandard(sleepQ, sleepDyn).subjectGroup, null,
    "the standard carries no subject for this question");
});

await test("one resolved group: the group touch cites, word sharing no longer does", () => {
  const q = "why do some plants fold their leaves when you touch them";
  const standard = citationGateStandard(q, null);
  assert.equal(standard.groups.length, 1, "control: the mimosa question resolves one group");
  const onPoint = {
    title: "Thigmonastic leaf movement in Mimosa pudica",
    abstract: "Leaflets fold within seconds of mechanical stimulation. Turgor changes in the pulvinus drive the movement.",
  };
  const termSharer = {
    title: "Touch receptors in mammalian skin",
    abstract: "How touch receptors signal pressure is reviewed, with no plant material anywhere in the discussion of leaves and skin.",
  };
  const collision = {
    title: "Infant intestinal microbiota and growth in the first year",
    abstract: "Stool microbiota of infants was profiled monthly. Intestinal bacteria composition predicted weight gain.",
  };
  assert.equal(paperClearsCitationGate(onPoint, standard), true, "the group touching paper clears");
  // PIN UPDATED (2026-10-15, wave seventeen): the term sharer
  // used to clear — judged on the union of the one real
  // concept with the bare central terms, its two shared words
  // (touch, leaves) completed the two hit rule. The citation
  // depth diagnosis (stage 2) replaces that standard: with
  // exactly one grouped concept in the judged set, the gate
  // judges on that concept alone, and a mammalian skin review
  // sharing the question's words but not its concept is a
  // collision under the corrected standard. The guards the
  // diagnosis names for the wider door (relevance at the
  // floor, engagement in the abstract, the subject serve on
  // the shipped set) are pinned in the wave seventeen suite.
  assert.equal(paperClearsCitationGate(termSharer, standard), false,
    "a paper sharing central terms but not the one real concept still clears");
  assert.equal(paperClearsCitationGate(collision, standard), false,
    "a paper sharing neither the group nor any central term is barred");
});

await test("no resolved groups: central terms alone carry the standard", () => {
  const q = "What lets a wood frog survive being frozen for months at a time?";
  const standard = citationGateStandard(q, null);
  assert.equal(standard.groups.length, 0, "control: the frog question resolves no groups");
  const frogPaper = {
    title: "Freeze tolerance in the wood frog",
    abstract: "The wood frog survives being frozen for months, its tissues tolerating ice through the winter.",
  };
  const offPaper = {
    title: "Infant intestinal microbiota and growth in the first year",
    abstract: "Stool microbiota of infants was profiled monthly. Intestinal bacteria composition predicted weight gain.",
  };
  assert.equal(paperClearsCitationGate(frogPaper, standard), true);
  assert.equal(paperClearsCitationGate(offPaper, standard), false);
  // And through the gate itself: the off topic paper is demoted
  // while the on topic one stands (so the floor does not trigger).
  const out = applyConceptCoverageGate("Frogs freeze and live [1]. Gut germs shape growth [2].",
    [frogPaper, offPaper], q, null);
  assert.ok(out.text.includes("[1]") && !out.text.includes("[2]"),
    `gate output: ${out.text}`);
});

await test("the floor is retired below two groups too: nothing clearing empties the cited set (wave eight)", () => {
  // 2026-10-14 (wave eight, Job 2): the floor rule this test
  // pinned (when no cited paper clears, the gate returns the
  // answer untouched) is retired — it was the mechanism that
  // shipped drafts citing only junk precisely because they
  // cited only junk. The corrected expectation is the full
  // demotion; the handler's fall through to the extractive tier
  // or the no evidence state is pinned in
  // tests/search-wave-eight.mjs.
  const q = "What lets a wood frog survive being frozen for months at a time?";
  const papers = [
    { title: "Thigmonastic leaf movement in Mimosa pudica", abstract: "Leaflets fold within seconds of touch." },
    { title: "Infant intestinal microbiota and growth", abstract: "Stool microbiota of infants was profiled monthly." },
  ];
  const answer = "One [1]. Two [2].";
  const out = applyConceptCoverageGate(answer, papers, q, null);
  assert.equal(out.text, "One. Two.", "an all failing cited set is demoted in full under the corrected contract");
  assert.deepEqual(out.demoted.map((d) => d.idx), [1, 2]);
});

// ═══════════════════════════════════════════════════════════════════
group("citation selection — coverage ahead of score (2026-10-14, fourth panel)");

const BABY_GUT_Q = "what happens to a baby's gut germs in the first year";
const GERM_FREE_PAPER = () => ({
  title: "Germ free mice show altered gut development",
  abstract: "Germ free animals were raised in isolators. The gut of germ free mice developed differently and gut motility changed without microbes present.",
  url: "https://example.com/germ-free",
});
const EARLY_LIFE_PAPER = () => ({
  title: "Microbial shifts in early life shape the infant gut",
  abstract: "We followed each baby through the first year. Gut germs changed month by month as the baby gut matured, and early microbial shifts predicted later gut health in every infant studied.",
  url: "https://example.com/early-life",
});

await test("baby gut shape: the covering paper leads the cited slice", () => {
  const dyn = buildDynLookup(buildDeterministicFallbackGroups(BABY_GUT_Q, ["baby"]));
  const pool = [GERM_FREE_PAPER(), EARLY_LIFE_PAPER()];
  const groups = questionConceptGroups(BABY_GUT_Q, dyn);
  assert.ok(paperConceptGroupHits(EARLY_LIFE_PAPER(), groups) > paperConceptGroupHits(GERM_FREE_PAPER(), groups),
    "control: the early life paper covers more of the question's groups");
  const ordered = orderCitedSliceByCoverage(pool, BABY_GUT_Q, dyn);
  assert.equal(ordered[0].url, "https://example.com/early-life",
    "score order buried the covering paper; coverage order must lead with it");
  assert.equal(ordered[1].url, "https://example.com/germ-free");
});

await test("coverage order is stable and a no op when nothing resolves", () => {
  const pool = [GERM_FREE_PAPER(), EARLY_LIFE_PAPER()];
  const same = orderCitedSliceByCoverage(pool, "what is the capital of anywhere", null);
  assert.deepEqual(same.map((p) => p.url), pool.map((p) => p.url),
    "with no resolved groups the pool order is untouched");
});

await test("duplicate records rank after distinct papers, whatever their coverage", () => {
  // The shelf can carry the same work twice from different fetch
  // rounds, scored differently. A duplicate shares its original's
  // coverage, so without the rule it would take a slice slot from
  // a distinct paper and the final dedupe would collapse the
  // cited set below the pool (verified end to end against the
  // black soldier fly draw: three copies of one paper filled the
  // cascade slice and a distinct paper vanished from the sources).
  const dyn = buildDynLookup(buildDeterministicFallbackGroups(BABY_GUT_Q, ["baby"]));
  const original = { ...EARLY_LIFE_PAPER(), doi: "10.1000/dup1" };
  const duplicate = { ...EARLY_LIFE_PAPER(), doi: "10.1000/dup1", relevance: 12 };
  const distinct = GERM_FREE_PAPER();
  const ordered = orderCitedSliceByCoverage([original, duplicate, distinct], BABY_GUT_Q, dyn);
  assert.equal(ordered[0], original, "the covering original leads");
  assert.equal(ordered[1], distinct, "the distinct paper outranks the duplicate");
  assert.equal(ordered[2], duplicate, "the duplicate ranks last despite sharing the top coverage");
});

// ═══════════════════════════════════════════════════════════════════
group("fallback vocabulary — inflections and bridges (2026-10-14, fifth panel, Job 2a)");

await test("the inflection generator emits no non words", () => {
  // The panel's specimen: fix -> [fixs, fixes]. A sibilant final
  // word takes ONLY the es plural. (inflectionVariants returns a
  // Set.)
  const fix = inflectionVariants("fix");
  assert.ok(fix.has("fixes"), "fix should yield fixes: " + JSON.stringify([...fix]));
  assert.ok(!fix.has("fixs"), "fix yielded the non word fixs: " + JSON.stringify([...fix]));
  const box = inflectionVariants("box");
  assert.ok(box.has("boxes") && !box.has("boxs"), "box variants wrong: " + JSON.stringify([...box]));
  // Words ending in us, is, or ss have no stripped singular.
  assert.ok(!inflectionVariants("analysis").has("analysi"),
    "analysis yielded analysi: " + JSON.stringify([...inflectionVariants("analysis")]));
  assert.ok(!inflectionVariants("class").has("clas"),
    "class yielded clas: " + JSON.stringify([...inflectionVariants("class")]));
  // A plain plural is still generated where it is real.
  assert.ok(inflectionVariants("blood").has("bloods"), "blood lost its plural");
});

await test("the everyday to scientific bridges are in the fallback vocabulary", () => {
  // The panel's specimens: the antibiotic stomach question needs
  // the probiotic class; the caffeine question needs the blood
  // pressure class. The bridges are term class vocabulary in
  // buildDeterministicFallbackGroups, not question hacks.
  const yogurt = buildDeterministicFallbackGroups("can eating yogurt help", ["yogurt"]);
  const yogurtAlts = (yogurt[0] && yogurt[0].alternates) || [];
  assert.ok(yogurtAlts.includes("probiotic"), "yogurt does not bridge to probiotic: " + JSON.stringify(yogurt));
  assert.ok(yogurtAlts.includes("lactobacillus"), "yogurt does not bridge to lactobacillus: " + JSON.stringify(yogurt));
  const bp = buildDeterministicFallbackGroups("does caffeine raise blood pressure", ["blood pressure"]);
  const bpAlts = (bp[0] && bp[0].alternates) || [];
  assert.ok(bpAlts.includes("hypertension"), "blood pressure does not bridge to hypertension: " + JSON.stringify(bp));
  const caf = buildDeterministicFallbackGroups("does caffeine raise blood pressure", ["caffeine"]);
  const cafAlts = (caf[0] && caf[0].alternates) || [];
  assert.ok(cafAlts.includes("coffee"), "caffeine does not bridge to coffee: " + JSON.stringify(caf));
});

// ═══════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
