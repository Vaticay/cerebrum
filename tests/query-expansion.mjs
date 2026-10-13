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
  retrievalStrategiesTried,
  llmValidatePapers,
  defaultValidationCall,
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

await test("the homogenate wording question is byte identical to its pre fix form", () => {
  // This question already keyed the homogenate group through the
  // single word "homogenate"; its phrase "gut homogenate" is claimed
  // by that word, so the new phrase scan must add nothing.
  const q = "Are there any research papers that use insect gut homogenate in order to study enzyme activity, as opposed to purifying the enzymes from the gut homogenate?";
  const expected =
    "(gut OR intestinal OR intestine OR digestive OR midgut OR hindgut OR foregut) AND " +
    "(homogenate OR homogenates OR homogenized OR homogenised OR homogenization OR \"crude extract\" OR \"crude extracts\") AND " +
    "(enzymes OR enzyme OR enzymatic OR oxidase OR oxidases OR hydrolase OR hydrolases) AND " +
    "(gut OR intestinal OR intestine OR digestive OR midgut OR hindgut OR foregut)";
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
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
