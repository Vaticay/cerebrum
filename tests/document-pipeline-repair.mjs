/**
 * Document Reader pipeline repair regressions (2026-10-17).
 *
 * The owner's phone photos of 2026-10-16 showed a 10,450 word journal
 * paper failing end to end on production: the digest stage failed
 * (five sections unread, four more cut at their length cap), the
 * synthesis stage failed at 0.0s, the extractive summary led with the
 * paper's submission dates, and Q&A served the paper's keyword list
 * as an "answer". The root causes, reproduced against the shipped
 * code before fixing:
 *   - the digest token budget (350) sat below the chunk prompt's own
 *     150-250 word ask, so digests were cut mid-thought;
 *   - a failed or cut section had no second chance inside the run;
 *   - when the digest's chunk races parked every provider leg, the
 *     synthesis call built an empty race and threw in under a
 *     millisecond without firing a single request;
 *   - the extractive fallback drew its lead sentences from the
 *     document's opening unscreened, so journal front matter
 *     (submission history, publisher statement, keyword list) became
 *     the summary's headline and the Q&A extract's lead.
 *
 * These tests pin the repaired contracts. Run with:
 *   node tests/document-pipeline-repair.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const document = await import(join(root, "functions/api/document.js"));
const { docTitleOf } = await import(join(root, "src/docReader.js"));

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
function group(name) {
  console.log(`\n${name}`);
}

// A section built from two distinct halves, so a parts read can be
// told apart from a whole read by which markers its digests carry.
// Sized so the whole section runs about 5,900 chars (over the fakes'
// 4,000 char failure line below) while each half stays under it.
function twoHalfSection() {
  const alpha = "ALPHA findings on wound microbiome ratios in 214 samples with a 37% effect (p < 0.01). " + "alpha detail sentence. ".repeat(125);
  const omega = "OMEGA methods for the validation cohort of 96 samples measured across three time points. " + "omega detail sentence. ".repeat(125);
  return alpha + "\n\n" + omega;
}

// ── The digest budget vs the prompt's own word ask ─────────────────
group("digest budget");

await test("the chunk token budget fits the digest the prompt asks for", () => {
  // The chunk prompt asks for roughly 150-250 words; 250 words runs
  // past 350 tokens, which is why digests were cut at the old budget.
  assert.ok(document.MAP_MAX_TOKENS >= 600, `MAP_MAX_TOKENS ${document.MAP_MAX_TOKENS} is under the 250 word ask`);
});

// ── Parts recovery in summarizeChunks ──────────────────────────────
group("summarizeChunks — sections read in parts");

await test("a section whose whole digest fails is recovered by reading it in parts", async () => {
  const section = twoHalfSection();
  const digest = async (env, chunkText) => {
    if (chunkText.length > 4000) throw new Error("provider blew up on the long call");
    const tag = chunkText.includes("ALPHA") ? "ALPHA" : "OMEGA";
    return { answer: "Part digest of " + tag + ". " + "d".repeat(60) };
  };
  const { sections, failed, recoveredInParts } = await document.summarizeChunks({}, [section], null, { digest });
  assert.deepEqual(failed, [], "section stayed failed after the parts read");
  assert.deepEqual(recoveredInParts, [1]);
  assert.ok(sections[0].includes("Part digest of ALPHA"), "first half missing from the recovered digest");
  assert.ok(sections[0].includes("Part digest of OMEGA"), "second half missing from the recovered digest");
});

await test("a length cut digest is replaced by a whole parts read", async () => {
  const section = twoHalfSection();
  const digest = async (env, chunkText) => {
    if (chunkText.length > 4000) {
      return { answer: "A digest that was cut off mid thought by the token cap. " + "c".repeat(60), finishReason: "length" };
    }
    const tag = chunkText.includes("ALPHA") ? "ALPHA" : "OMEGA";
    return { answer: "Complete part digest of " + tag + ". " + "d".repeat(60), finishReason: "stop" };
  };
  const { sections, failed, lengthCutChunks, recoveredInParts } = await document.summarizeChunks({}, [section], null, { digest });
  assert.deepEqual(failed, []);
  assert.deepEqual(lengthCutChunks, [], "the replaced digest is still reported as length cut");
  assert.deepEqual(recoveredInParts, [1]);
  assert.ok(sections[0].includes("Complete part digest of ALPHA"), "parts read did not replace the cut digest");
  assert.ok(sections[0].includes("Complete part digest of OMEGA"), "parts read did not replace the cut digest");
  assert.ok(!sections[0].includes("cut off mid thought"), "the truncated digest survived the parts read");
});

await test("a section that fails even in parts stays honestly failed", async () => {
  const section = twoHalfSection();
  const digest = async () => {
    throw new Error("the whole fleet is down");
  };
  const { sections, failed, recoveredInParts } = await document.summarizeChunks({}, [section], null, { digest });
  assert.deepEqual(failed, [1]);
  assert.deepEqual(sections, [null]);
  assert.deepEqual(recoveredInParts, []);
});

await test("runSummary ships a complete summary when the parts read rescues the digest", async () => {
  const paras = [];
  for (let i = 0; i < 30; i++) paras.push(twoHalfSection());
  const paper = paras.join("\n\n");
  assert.ok(paper.length > document.MAP_REDUCE_THRESHOLD, "test doc must take the map/reduce path");
  const digest = async (env, chunkText) => {
    if (chunkText.length > 4000) throw new Error("long calls fail in this fleet");
    return { answer: "Part digest with real findings and a 37% effect size. " + "d".repeat(60) };
  };
  const generateFn = async () => ({
    answer: "## Summary\nFull AI summary.\n\n## Methodology\nM.\n\n## Key Findings\nK.\n\n## Limitations\nL.",
    model: "test-model",
  });
  const result = await document.runSummary({}, paper, { digest, generateFn });
  assert.equal(result.path, "mapreduce");
  assert.equal(result.partial, false, "summary still marked partial after the parts rescue");
  assert.deepEqual(result.missingSections, []);
  const digestStage = result.stageHealth.find((s) => s.name === "digest");
  assert.equal(digestStage.ok, true);
  assert.ok(digestStage.detail && digestStage.detail.includes("read in parts"), "digest stage does not disclose the parts read");
});

// ── The desperation leg: a parked fleet still gets one attempt ────
group("generate — desperation leg");

await test("when every leg is parked, generate still fires one real attempt", async () => {
  document.resetDocLegHealth();
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: "A complete answer of ample length drawn from the document text itself." }, finish_reason: "stop" }] }) };
  };
  try {
    const env = { OPENROUTER_KEY: "test-key" };
    // Park the roster leg AND the small model retry, so the old code
    // threw without firing anything (the 0.0s synthesis failure).
    document.recordDocLegOutcome("solo:free", false, new Error("solo:free: HTTP 429 — rate limit exceeded"));
    document.recordDocLegOutcome("meta-llama/llama-3.2-3b-instruct:free", false, new Error("retry: HTTP 429 — rate limit exceeded"));
    const r = await document.generate(env, [{ role: "user", content: "q" }], 100, { providers: ["solo:free"] });
    assert.equal(fetchCalls, 1, "expected exactly one desperation attempt");
    assert.equal(r.model, "solo:free");
    assert.ok(r.skippedLegs.some((s) => s.model === "solo:free"), "the skip was not named on the result");
    assert.equal(document.docLegParkInfo("solo:free"), null, "the successful attempt did not clear the park");
  } finally {
    globalThis.fetch = realFetch;
    document.resetDocLegHealth();
  }
});

await test("a failed desperation attempt still fails, and the error names the attempt", async () => {
  document.resetDocLegHealth();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 429, text: async () => "rate limit exceeded" });
  try {
    const env = { OPENROUTER_KEY: "test-key" };
    document.recordDocLegOutcome("solo:free", false, new Error("solo:free: HTTP 429 — rate limit exceeded"));
    document.recordDocLegOutcome("meta-llama/llama-3.2-3b-instruct:free", false, new Error("retry: HTTP 429 — rate limit exceeded"));
    await assert.rejects(
      document.generate(env, [{ role: "user", content: "q" }], 100, { providers: ["solo:free"] }),
      /All providers failed: .*desperation leg solo:free:/
    );
  } finally {
    globalThis.fetch = realFetch;
    document.resetDocLegHealth();
  }
});

// ── Front matter never leads an extract ────────────────────────────
group("front matter screen");

const FRONT_MATTER_PAPER = [
  "Received: 7 October 2025. Revised: 24 February 2026. Accepted: 12 March 2026.",
  "The study was published by Oxford University Press on behalf of the International Society for Microbial Ecology and revised on 24 February 2026, and accepted on 12 March 2026.",
  "Keywords metatranscriptomics, microbe-microbe interaction, polymicrobial infection, chronic wounds, microbial ecology, bacterial pathogenesis",
  "Introduction From the start, microbiology has explored microbial dynamics across diverse environments, including within the human body, where direct access is limited. Recognizing the importance of rational laboratory model selection, a quantitative accuracy score framework using RNA sequencing data was developed and used to improve two experimental model systems of polymicrobial infection in chronic wounds.",
  "The trial enrolled 214 wound samples and measured the ratio of metagenomic to metatranscriptomic reads for each organism in the cohort. The accuracy score improved by 37% over the baseline model (p < 0.01), and the result held in the validation subset of 96 samples measured at three time points using RNA sequencing.",
  "This study has limitations that the authors state plainly. The sample came from two clinics, however, and may not generalize to other care settings without further research.",
].join("\n\n");

await test("isFrontMatterSentence recognizes the front matter shapes and spares substance", () => {
  assert.equal(document.isFrontMatterSentence("Received: 7 October 2025."), true);
  assert.equal(document.isFrontMatterSentence("Revised: 24 February 2026."), true);
  assert.equal(document.isFrontMatterSentence("Received: 7 October 2025. Revised: 24 February 2026. Accepted: 12 March 2026."), true);
  assert.equal(document.isFrontMatterSentence("The study was published by Oxford University Press on behalf of the International Society for Microbial Ecology."), true);
  assert.equal(document.isFrontMatterSentence("Keywords metatranscriptomics, microbe-microbe interaction, chronic wounds"), true);
  assert.equal(document.isFrontMatterSentence("© 2026 The Authors. Published by Elsevier."), true);
  assert.equal(document.isFrontMatterSentence("The trial enrolled 214 patients and measured wound closure at three time points."), false);
  assert.equal(document.isFrontMatterSentence("Samples were received from three clinics and processed within 24 hours of collection."), false);
  assert.equal(document.isFrontMatterSentence("The revised protocol measured outcomes again in 2026 with a larger cohort."), false);
});

await test("the extractive summary leads with the study, not its submission dates", () => {
  const ex = document.extractiveSummary(FRONT_MATTER_PAPER);
  const summarySection = ex.split("## Methodology")[0];
  assert.ok(!summarySection.includes("Received:"), "summary leads with the submission history");
  assert.ok(!summarySection.includes("Oxford University Press"), "summary leads with the publisher statement");
  assert.ok(!summarySection.includes("Keywords"), "summary leads with the keyword list");
  assert.ok(summarySection.includes("microbiology has explored"), "the study's substance is missing from the summary lead");
  assert.ok(!ex.includes("Received: 7 October 2025"), "submission history appears anywhere in the extract");
});

await test("the extractive Q&A does not answer with the keyword list", () => {
  const qa = document.extractiveQA(FRONT_MATTER_PAPER, "Does this paper mention calculating the ratio of an organism's metagenomics to metatranscriptomics reads?");
  assert.ok(!qa.startsWith("Keywords"), "Q&A extract leads with the keyword list");
  assert.ok(qa.includes("metatranscriptomic reads"), "the on topic passage was not surfaced");
});

await test("the document title hunt skips front matter lines", () => {
  const text = [
    "Received: 7 October 2025. Revised: 24 February 2026. Accepted: 12 March 2026",
    "The study was published by Oxford University Press on behalf of the International Society for Microbial Ecology",
    "A quantitative accuracy score framework for polymicrobial infection models",
    "Abstract text follows here.",
  ].join("\n");
  assert.equal(docTitleOf(text), "A quantitative accuracy score framework for polymicrobial infection models");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
