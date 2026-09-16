/**
 * answer-ship tests: the provider-error sanitizer, the Wave-4 TLDR lede,
 * and the Venn render guarantee.
 *
 * These cover the defects Dusty caught live on 2026-09-12: a Pollinations
 * budget error shipped as cited claim [3] in a soil-cracking answer, the
 * robotic "Across the N sources below, the clearest reported findings are:
 * [Results]" lede, and the Venn diagram not rendering without fact-check.
 *
 * Unit tests against the real modules — no server, no database, no network.
 *
 * Run with: node tests/answer-ship.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

const {
  isProviderErrorText,
  assertValidProviderText,
  stripClaimTags,
  fingerprintClaim,
  buildExtractiveSynthesis,
  parseClaimLines,
} = await import(join(root, "functions/api/search.js"));

const { classifyVennPapers } = await import(join(root, "src/answerInsights.js"));

const searchSrc = await readFile(join(root, "functions/api/search.js"), "utf8");
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");

// The exact error body that shipped as cited claim [3] in the live
// soil-cracking answer (Pollinations budget error, HTTP 200).
const BUDGET_ERROR =
  "The API key used for this request has reached its budget. Please [raise the key budget]" +
  "(https://enter.pollinations.ai/edit-key?id=89idjaTSg2hI4YwZDuO8ZME5Ma6GrFps&ref=agentkeybudget), then try again." +
  "Topping up the wallet does not raise this limit. If this isn\u2019t your Pollinations account, " +
  "contact whoever runs the app or service you\u2019re using.";

// ══════════════════════════════════════════════════════════════════════════
group("Provider-error sanitizer — error text must never become a claim");

await test("exact Pollinations budget error is detected", () => {
  assert.equal(isProviderErrorText(BUDGET_ERROR), true);
});

await test("rate-limit and 5xx phrasing is detected", () => {
  assert.equal(isProviderErrorText("Rate limit exceeded for this model, please try again later."), true);
  assert.equal(isProviderErrorText("HTTP 503 Service Unavailable"), true);
  assert.equal(isProviderErrorText("Topping up the wallet does not raise this limit."), true);
  assert.equal(isProviderErrorText('{"error":{"message":"Invalid API key"}}'), true);
});

await test("ordinary scientific prose is NOT flagged", () => {
  assert.equal(
    isProviderErrorText("Cracks in depositional crusts exhibited significantly higher geometric parameters compared to those in structural crusts."),
    false
  );
  // "budget" + "quota" together are only two weak signals — must not trip.
  assert.equal(
    isProviderErrorText("The budget impact analysis used quota sampling across twelve regions."),
    false
  );
  assert.equal(isProviderErrorText(""), false);
  assert.equal(isProviderErrorText(null), false);
});

await test("extraction section tags are stripped, numeric citations kept", () => {
  assert.equal(
    stripClaimTags("[Results] Cracks in depositional crusts ran deeper."),
    "Cracks in depositional crusts ran deeper."
  );
  assert.equal(stripClaimTags("[Methods] We measured crack depth."), "We measured crack depth.");
  assert.equal(stripClaimTags("[1] A cited sentence."), "[1] A cited sentence.");
  assert.equal(stripClaimTags("[12] Another cited sentence."), "[12] Another cited sentence.");
  assert.equal(stripClaimTags("No tag here."), "No tag here.");
});

await test("fingerprint ignores extraction tags so tagged/untagged dupes merge", () => {
  assert.equal(fingerprintClaim("[Results] Cracks ran deeper."), fingerprintClaim("Cracks ran deeper."));
});

// ══════════════════════════════════════════════════════════════════════════
group("Wave-4 TLDR lede — plain short answer, never error text");

const soilPapers = [
  {
    title: "Mechanisms of Soil Physical Crust Crack Formation",
    journal: "Shuitu Baochi Xuebao",
    year: 2025,
    abstract:
      "Cracks in depositional crusts exhibited significantly higher geometric parameters compared to those in structural crusts. " +
      "As soil depth increased, cracks in depositional crusts displayed a stepped decrease under different rainfall durations. " +
      "Tensile stress from moisture gradients drives the polygonal patterning as the soil dries.",
  },
  {
    title: "Morphological Approach to Quantifying Soil Cracks: Application to Dynamic Crack Patterns during Wetting-Drying Cycles",
    journal: "Soil Science Society of America Journal",
    year: 2018,
    abstract:
      "The crack skeleton simultaneously, non-hierarchically and rapidly propagated in successive drying cycles compared to the initial drying process. " +
      "The quantification of cracks is therefore inevitable for predicting moisture movement in cracked soils.",
  },
  {
    title: "Fundamentals of desiccation cracking of fine-grained soils: experimental characterisation and mechanisms identification",
    journal: "Canadian Geotechnical Journal",
    year: 2009,
    abstract:
      "Desiccation cracking initiates when suction-induced tensile stress exceeds the soil tensile strength. " +
      "Crack spacing scales with layer thickness in fine-grained soils under controlled drying.",
  },
];

const poisonedBrief = [
  { text: "[Results] Cracks in depositional crusts exhibited significantly higher geometric parameters.", idx: 1 },
  { text: "The crack skeleton propagated rapidly in successive drying cycles.", idx: 2 },
  // The incident: the extractor returned the provider error as a claim.
  { text: BUDGET_ERROR, idx: 3 },
];

await test("lede is a TLDR, not the robotic meta-framing", () => {
  const md = buildExtractiveSynthesis(soilPapers, []);
  assert.ok(md.includes("## The short answer"), "missing The short answer section");
  assert.ok(!md.includes("Across the"), "robotic 'Across the N sources' framing still present");
  assert.ok(!md.includes("clearest reported findings"), "old lede phrasing still present");
  assert.ok(!md.includes("[Results]"), "[Results] tag leaked into output");
  const shortAnswer = md.split("## What the research shows")[0];
  const citeCount = (shortAnswer.match(/\[\d+\]/g) || []).length;
  assert.ok(citeCount >= 1 && citeCount <= 3, `TLDR should carry 1-3 citations, found ${citeCount}`);
});

await test("provider error text never surfaces as a claim, even when briefed", () => {
  const md = buildExtractiveSynthesis(soilPapers, poisonedBrief);
  assert.ok(!/pollinations/i.test(md), "pollinations leaked into the summary");
  assert.ok(!/api key/i.test(md), "api key error leaked into the summary");
  assert.ok(!/wallet/i.test(md), "wallet error leaked into the summary");
  assert.ok(!md.includes("[Results]"), "[Results] tag leaked into output");
  assert.ok(md.includes("## The short answer"), "missing The short answer section");
});

await test("old robotic lede is gone from search.js", () => {
  assert.ok(!searchSrc.includes("clearest reported findings"), "old lede still in search.js");
});

await test("raceEntry rejects error-text answers (AI path)", () => {
  assert.ok(
    searchSrc.includes("provider returned error text, not an answer"),
    "raceEntry error-text rejection missing"
  );
});

// ══════════════════════════════════════════════════════════════════════════
group("Provider failover — one bad provider never poisons the race");

await test("assertValidProviderText throws on error text, passes good text through", () => {
  assert.throws(() => assertValidProviderText(BUDGET_ERROR, "pollinations:openai"), /error text, not an answer/);
  const good = "## The short answer\n\nSoil cracks as it dries. [1]";
  assert.equal(assertValidProviderText(good, "groq:llama"), good);
});

await test("error-body-as-200 can never win a race", async () => {
  // Mirrors the wave raceEntry pattern: validation runs in the fulfillment
  // handler, so a 200-with-error-body becomes a failed attempt, not a winner.
  const validate = (label, p) => p.then((r) => {
    if (r && r.answer) assertValidProviderText(r.answer, label);
    return r;
  });
  const legs = [
    validate("pollinations:openai", Promise.resolve({ answer: BUDGET_ERROR, model: "pollinations:openai" })),
    validate("groq:llama-3.3-70b-versatile", Promise.resolve({ answer: "## The short answer\n\nReal answer. [1]", model: "groq" })),
  ];
  const winner = await Promise.any(legs);
  assert.ok(!isProviderErrorText(winner.answer), "error text won the race");
  assert.equal(winner.model, "groq");
});

await test("one provider failing while another succeeds still yields an AI answer", async () => {
  // The isolation property: a 429 on one provider must not block or poison
  // the others racing beside it — the answer comes from AI, no fallback.
  const validate = (label, p) => p.then((r) => {
    if (r && r.answer) assertValidProviderText(r.answer, label);
    return r;
  });
  const legs = [
    validate("groq:llama-3.3-70b-versatile", Promise.reject(new Error("groq: HTTP 429"))),
    validate("cerebras:llama-3.3-70b", Promise.resolve({ answer: "## The short answer\n\nAI answer. [1]", model: "cerebras" })),
  ];
  const winner = await Promise.any(legs);
  assert.match(winner.answer, /## The short answer/);
  assert.equal(winner.model, "cerebras");
});

await test("every provider call self-validates (no path can forget the check)", () => {
  const hits = (searchSrc.match(/assertValidProviderText\(cleaned/g) || []).length;
  assert.ok(hits >= 4, `expected >=4 in-call validations (callOR/callCompat/callCF/pollinationsCall), found ${hits}`);
  assert.ok(searchSrc.includes("formattingRelaxed = true"), "wave-3 formatting relaxation missing");
});

await test("two body-cited sources render the Venn (no fact-check)", () => {
  const m = classifyVennPapers({
    answer: "## The short answer\n\nCracks ran deeper in depositional crusts [1]. Drying cycles propagated the network rapidly [2].",
    sources: [{ title: "a" }, { title: "b" }, { title: "c" }],
    factCheck: null,
  });
  const placed = m.agree.length + m.disagree.length + m.middle.length;
  assert.ok(placed >= 2, `Venn needs >=2 placed papers, got ${placed}`);
  assert.ok(m.agree.includes(1) && m.agree.includes(2), "body-cited papers should default to agree");
});

await test("explicit fact-check verdicts still override the default", () => {
  const m = classifyVennPapers({
    answer: "Cracks ran deeper [1]. Cycles propagated rapidly [2].",
    sources: [{ title: "a" }, { title: "b" }],
    factCheck: { claims: [{ claim: "cracks ran deeper [1]", note: "", status: "contradicted" }] },
  });
  assert.ok(m.disagree.includes(1), "contradicted claim should place paper 1 in disagree");
});

// ══════════════════════════════════════════════════════════════════════════
group("Dead labels — the permanent NOT CHECKED is gone");

await test("no NOT CHECKED label remains in the app", () => {
  assert.ok(!appSrc.includes("NOT CHECKED"), "NOT CHECKED still present in CerebrumApp.jsx");
});

await test("fog treatment is present on source/evidence/answer cards", () => {
  assert.ok(appSrc.includes("Frosted reading surface"), "srcItem fog comment missing");
  assert.ok(appSrc.includes("Frosted shell"), "AnswerStateCard fog comment missing");
});

await test("bibliography uses matte paper, not frosted rows", () => {
  // Redesign: the bibliography is a printed ledger on matte paper — per-row
  // backdrop blur is retired. The fog must not come back here.
  assert.ok(appSrc.includes("Matte ledger rows"), "BibEntry matte-ledger comment missing");
  assert.ok(!appSrc.includes("Frosted rows"), "Frosted rows comment must not return to BibEntry");
});

await test("answer card uses matte paper, not glass", () => {
  // Redesign: the answer is a matte document — no glass panel, no specimen ticks.
  assert.ok(appSrc.includes("MATTE DOCUMENT SURFACE"), "answerCard matte comment missing");
  assert.ok(!appSrc.includes('className="cb-answer-enter cb-glass-panel cb-specimen"'), "answer card must not use glass/specimen classes");
});

await test("evidence map exists and is wired into the turn", () => {
  assert.ok(appSrc.includes("function EvidenceMap("), "EvidenceMap component missing");
  assert.ok(appSrc.includes("<EvidenceMap t={t}"), "EvidenceMap not rendered in the turn");
  // Honest empty state: no citations → no map, never decoration.
  assert.ok(appSrc.includes("if (!rows.length) return null;"), "EvidenceMap must render nothing without cited claims");
  // Bounded: a map, not a second bibliography.
  assert.ok(appSrc.includes(".slice(0, 8)"), "EvidenceMap must cap its rows");
});

// ══════════════════════════════════════════════════════════════════════════
if (failures.length) {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
} else {
  console.log(`\n${passed} passed, 0 failed`);
}
