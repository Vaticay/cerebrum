/**
 * Wave 3 Lane S5 (2026-10-23). Pins Stage 5 of the logic audit
 * (L5-5 to L5-15) in functions/api/search.js, src/CerebrumApp.jsx,
 * and src/fcLabel.js, and re verifies the already closed items
 * L5-1 to L5-4 briefly against current code.
 *
 * Run with: node tests/claimcheck-stage5-repair.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
const search = await import(join(root, "functions/api/search.js"));
const { fcCompressStep, fcSentenceIncompressible } = await import(join(root, "src/fcLabel.js"));

const {
  buildClaimCheckInventory, factCheckCounts, factCheckOverallFromCounts,
  factCheckSupportRecord, factCheckSupport, withFactCheckCounts,
  dedupeFactCheckClaims, deriveFactCheckStageOutcome, FACT_CHECK_STAGE_OUTCOMES,
  factCheckTierBudgetMs, FACT_CHECK_RESERVE_MS, factCheckTierExcluded,
  factCheckModelFamily, deepFactCheck, deepClaimEvidenceVerified,
  buildCachedServeTrust, packAnswerCachePayload, unpackAnswerCachePayload,
  buildConfidenceLine, factCheckActuallyChecked, parseDeepFactCheckJSON,
} = search;

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push({ name, error: e }); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function group(name) { console.log(`\n${name}`); }

const PAPER = {
  title: "Honey for acute cough in children",
  abstract: "Honey reduced cough frequency in children with upper respiratory infections and soothed throats at night.",
};
const ANSWER =
  "## The short answer\n\nHoney reduced cough frequency in children [1].\n\n" +
  "## Evidence\n\nHoney also soothed throats at night in the same trial [1].";

// ═══════════════════════════════════════════════════════════
group("Already closed, verified briefly (L5-1 to L5-4)");

await test("L5-1: terms returns no support; L5-2: universal typed at parse; L5-3: quote verified; L5-4: flags only is not checked", () => {
  assert.equal(factCheckSupport({ mode: "terms", claims: [{ claim: "BSFL", status: "supported" }] }), null);
  const parsed = parseDeepFactCheckJSON(JSON.stringify({ claims: [
    { claim: "No study has measured this enzyme in soil", status: "supported", justification: "j", quote: "q", source_index: 1 },
  ] }));
  assert.equal(parsed[0].kind, "universal");
  assert.equal(deepClaimEvidenceVerified(
    { claim: "Honey reduced cough frequency in children", status: "supported", quote: "a fabricated quote", sourceIndex: 1 },
    ANSWER, [PAPER]), false);
  assert.equal(factCheckActuallyChecked({
    mode: "claims", overall: "partly",
    claims: [{ claim: "x", status: "unsupported", kind: "alignment" }],
  }), false);
});

// ═══════════════════════════════════════════════════════════
group("L5-5 — deterministic claim inventory, coverage over inventory");

await test("inventory holds every substantive cited sentence, in order", () => {
  const inv = buildClaimCheckInventory(ANSWER);
  assert.equal(inv.length, 2);
  assert.ok(inv[0].central, "the short answer's central claim is not marked central");
  assert.deepEqual(inv.map((e) => e.index), [1, 2]);
});

await test("the central claim is a mandatory member even without a citation marker", () => {
  const inv = buildClaimCheckInventory(
    "## The short answer\n\nHoney probably helps coughs in children over one year old.\n\n" +
    "## Evidence\n\nHoney reduced cough frequency in a randomised trial of children [1].");
  assert.ok(inv.length >= 2 && inv[0].central, "central claim missing: " + JSON.stringify(inv));
});

await test("the handler hands the inventory and the winner to the check, and coverage ships on the object", () => {
  assert.ok(src.includes("inventory: claimInventory"), "deepFactCheck is not handed the inventory");
  assert.ok(src.includes("synthesisModel: synthWinner"), "deepFactCheck is not handed the synthesis winner");
  const fc = dedupeFactCheckClaims({
    mode: "claims", overall: "supported", inventoryTotal: 4,
    summary: "Checked 2 claims against the cited sources: 2 supported, 0 thin, 0 unsupported.",
    claims: [
      { claim: "A checked sentence about honey and coughs.", status: "supported", sentenceIndex: 1, sentence: "A checked sentence about honey and coughs." },
      { claim: "Another checked sentence about honey.", status: "supported", sentenceIndex: 2, sentence: "Another checked sentence about honey." },
    ],
  });
  assert.equal(fc.counts.checked, 2);
});

// ═══════════════════════════════════════════════════════════
group("L5-6 — the synthesis winner and its family are excluded, in code");

await test("family mapping and exclusion", () => {
  assert.equal(factCheckModelFamily("gemini:gemini-3.5-flash-lite"), "gemini");
  assert.equal(factCheckModelFamily("@cf/meta/llama-3.3-70b-instruct-fp8-fast"), "llama");
  assert.equal(factCheckTierExcluded("google/gemma-4-26b-a4b-it:free", "google/gemma-4-31b-it:free"), true);
  assert.equal(factCheckTierExcluded("google/gemma-4-31b-it:free", "gemini:gemini-3.5-flash-lite"), false);
  assert.equal(factCheckTierExcluded("google/gemma-4-31b-it:free", null), false);
});

function stubFetch(verdict) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(verdict) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}
const VERDICT = { claims: [{
  claim: "Honey reduced cough frequency in children",
  sentence_index: 1, source_index: 1,
  quote: "Honey reduced cough frequency in children",
  status: "supported", justification: "The abstract states it directly.",
}] };

await test("a gemini winner is excluded from the gemini tier and the checking model is recorded", async () => {
  const { calls, restore } = stubFetch(VERDICT);
  try {
    const trace = [];
    const claims = await deepFactCheck(ANSWER, [PAPER],
      { GEMINI_KEY: "k", OPENROUTER_KEY: "k" }, null, trace, null,
      { synthesisModel: "gemini:gemini-3.8-flash" });
    assert.ok(claims && claims.length === 1, "no tier landed: " + JSON.stringify(trace));
    assert.ok(!calls.some((u) => u.includes("generativelanguage")), "the excluded gemini tier fired");
    assert.ok(trace.some((t) => t.tier === "gemini" && t.outcome === "excluded"), "exclusion not traced: " + JSON.stringify(trace));
    assert.equal(claims.checkingModel, "google/gemma-4-31b-it:free");
    assert.equal(claims.inventoryTotal, 2);
    assert.equal(claims[0].answerSentenceIndex, 1);
  } finally { restore(); }
});

await test("where exclusion leaves no tier the result is did not run, never a self check", async () => {
  const { calls, restore } = stubFetch(VERDICT);
  try {
    const trace = [];
    const claims = await deepFactCheck(ANSWER, [PAPER],
      { OPENROUTER_KEY: "k" }, null, trace, null,
      { synthesisModel: "google/gemma-4-31b-it:free" });
    assert.equal(claims, null, "a self check landed: " + JSON.stringify(trace));
    assert.equal(calls.length, 0, "an excluded tier fired: " + JSON.stringify(calls));
    assert.ok(trace.some((t) => t.outcome === "excluded"), "exclusion not traced");
  } finally { restore(); }
});

// ═══════════════════════════════════════════════════════════
group("L5-7 — sentences are the countable unit, worst status wins");

await test("verdicts for the same sentence merge, worst wins, unit labelled with the sentence", () => {
  const out = dedupeFactCheckClaims({
    mode: "claims", overall: "supported",
    summary: "Checked 2 claims against the cited sources: 1 supported, 0 thin, 1 unsupported.",
    claims: [
      { claim: "Honey reduced cough frequency", status: "supported", sentenceIndex: 3, sentence: "Honey reduced cough frequency and soothed throats [1].", note: "clause one" },
      { claim: "Honey soothed throats", status: "unsupported", sentenceIndex: 3, sentence: "Honey reduced cough frequency and soothed throats [1].", note: "clause two" },
    ],
  });
  assert.equal(out.claims.length, 1, "the compound sentence counted twice: " + JSON.stringify(out.claims));
  assert.equal(out.claims[0].status, "unsupported", "the worst clause did not win");
  assert.equal(out.claims[0].claim, "Honey reduced cough frequency and soothed throats [1].");
  assert.equal(out.counts.checked, 1);
  assert.equal(out.summary.includes("abstracts of the cited sources"), true);
});

await test("same text with different verdicts folds to the worst, not the first", () => {
  const out = dedupeFactCheckClaims({
    mode: "claims", overall: "supported",
    summary: "Checked 2 claims against the cited sources: 2 supported, 0 thin, 0 unsupported.",
    claims: [
      { claim: "Honey helps coughs.", status: "supported", note: "first" },
      { claim: "Honey helps coughs.", status: "unsupported", note: "second" },
    ],
  });
  assert.equal(out.claims.length, 1);
  assert.equal(out.claims[0].status, "unsupported");
});

await test("a single usable verdict is a real check result now", () => {
  const parsed = parseDeepFactCheckJSON(JSON.stringify({ claims: [
    { claim: "Honey helps coughs", status: "supported", justification: "j", quote: "q", source_index: 1 },
  ] }));
  assert.ok(Array.isArray(parsed) && parsed.length === 1);
});

// ═══════════════════════════════════════════════════════════
group("L5-8 — one support record, no placeholder calibration input");

await test("the support record carries counts and ratio from one computation", () => {
  const rec = factCheckSupportRecord({
    mode: "claims",
    claims: [
      { claim: "a", status: "supported" }, { claim: "b", status: "thin" },
      { claim: "c", status: "unsupported", kind: "alignment" },
    ],
  });
  assert.deepEqual(
    { supported: rec.supported, checked: rec.checked, ratio: rec.ratio, flags: rec.flags },
    { supported: 1, checked: 2, ratio: 0.5, flags: 1 });
  const conf = buildConfidenceLine(
    [{ title: "t", relevance: 80, year: 2024, abstract: "a" }, { title: "u", relevance: 80, year: 2024, abstract: "b" }],
    { status: "settled" }, { support: rec });
  assert.ok(conf.line.includes("supports 1 of 2 checked claims"), "line does not carry the record: " + conf.line);
  assert.ok(!src.includes("integrityFlags: 0"), "a placeholder calibration input remains");
  assert.ok(src.includes("support: supportRecord"), "the confidence builder is not handed the one record");
});

// ═══════════════════════════════════════════════════════════
group("L5-9 — one deadline, per tier fractions of what remains");

await test("tier budgets are fractions of the remainder under the one reserve", () => {
  assert.equal(FACT_CHECK_RESERVE_MS, 8000);
  assert.equal(factCheckTierBudgetMs(8000, 4, 3000), 2000);
  assert.equal(factCheckTierBudgetMs(6000, 2, 4000), 2500);
  assert.equal(factCheckTierBudgetMs(100, 1, 4000), 100);
  assert.equal(factCheckTierBudgetMs(null, 4, 3000), 3000);
  assert.ok(factCheckTierBudgetMs(8000, 4, 3000) + factCheckTierBudgetMs(6000, 3, 3500) +
    factCheckTierBudgetMs(4000, 2, 4000) + factCheckTierBudgetMs(2000, 1, 4000) <= 8000 + 2500,
    "the tier fractions can still stack far past the reserve");
});

// ═══════════════════════════════════════════════════════════
group("L5-10 — stage outcome is a closed enum, rendered everywhere from it");

await test("the enum has exactly one value per real state and derivation covers them", () => {
  assert.deepEqual(FACT_CHECK_STAGE_OUTCOMES,
    ["off", "no-time", "budget-spent", "tiers-failed", "ran-no-countable", "ran-with-verdicts"]);
  assert.equal(deriveFactCheckStageOutcome({ settingOff: true }), "off");
  assert.equal(deriveFactCheckStageOutcome({ attempted: false }), "no-time");
  assert.equal(deriveFactCheckStageOutcome({ budgetSkipped: true, attempted: false }), "budget-spent");
  assert.equal(deriveFactCheckStageOutcome({ attempted: true, ranCheck: false, countable: 0 }), "tiers-failed");
  assert.equal(deriveFactCheckStageOutcome({ attempted: true, ranCheck: true, countable: 0 }), "ran-no-countable");
  assert.equal(deriveFactCheckStageOutcome({ attempted: true, ranCheck: true, countable: 3 }), "ran-with-verdicts");
  assert.ok(!src.includes("nothing to verify — deep tiers"), "the failed check is still called nothing to verify in the record");
  assert.ok(!src.includes('skipReason: "nothing to verify"'), "a stage push still uses the nothing to verify wording");
  assert.ok(!appSrc.includes('"Nothing to verify"'), "the client still renders a failed or empty check as Nothing to verify");
});

// ═══════════════════════════════════════════════════════════
group("L5-11 — counts ship on the object, flags enter no total");

await test("counts at the dedupe point and on withFactCheckCounts", () => {
  const fc = withFactCheckCounts({
    mode: "claims",
    claims: [
      { claim: "a", status: "supported" }, { claim: "b", status: "unsupported" },
      { claim: "flag one", status: "unsupported", kind: "stripped" },
      { claim: "lost", status: "supported", kind: "unattributed" },
    ],
  });
  assert.deepEqual(fc.counts,
    { supported: 1, thin: 0, unsupported: 1, traced: 0, checked: 2, flags: 2 });
  assert.ok(appSrc.includes("fc.counts"), "the client does not read the shipped counts");
  assert.ok(appSrc.includes("Flags from other checks"), "flags have no separately labelled client group");
});

// ═══════════════════════════════════════════════════════════
group("L5-12 — cached serves label the stored check and recompute from it");

await test("pack and unpack carry the stored date; the serve labels and consumes the stored object", () => {
  const packed = packAnswerCachePayload([PAPER], {
    factCheck: { mode: "claims", overall: "supported", claims: [{ claim: "Honey helps coughs", status: "supported" }] },
    factCheckStoredAt: 1690000000000, synthesisMode: "ai", disagreementVerdict: null,
  });
  const unpacked = unpackAnswerCachePayload(packed);
  assert.equal(unpacked.trust.factCheckStoredAt, 1690000000000);
  const served = buildCachedServeTrust({
    answer: "Honey reduced cough frequency in children [1].",
    sources: [PAPER], question: "does honey help coughs",
    askedAt: 1700000000000, synthesisMode: "ai",
    factCheck: unpacked.trust.factCheck, factCheckStoredAt: unpacked.trust.factCheckStoredAt,
  });
  assert.equal(served.factCheck.stored, true);
  assert.equal(served.factCheck.storedAt, new Date(1690000000000).toISOString());
  assert.equal(served.factCheck.counts.checked, 1);
  assert.ok(served.confidence.line.includes("supports 1 of 1 checked claim"),
    "the recompute did not consume the stored check: " + served.confidence.line);
  assert.ok(!src.includes("Cached (verified)"), "the verified tag remains");
  assert.ok(src.includes("Cached (stored check)"), "the stored check tag is missing");
  assert.ok(appSrc.includes("was not rerun for this view"), "the client does not label a stored check");
});

// ═══════════════════════════════════════════════════════════
group("L5-13 — evidence unit stated, shown set and abstract required");

await test("an index past the shown set, or a paper with no abstract, is uncountable", () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    title: "Paper " + (i + 1),
    abstract: "Finding number " + (i + 1) + " is stated here in full.",
  }));
  assert.equal(deepClaimEvidenceVerified(
    { claim: "Finding number 21 is stated", status: "supported", quote: "Finding number 21 is stated here in full.", sourceIndex: 21 },
    "Finding number 21 is stated [21].", many), false, "a paper the checker never saw counted as checked");
  const noAbs = [{ title: "Title only paper", abstract: "" }];
  assert.equal(deepClaimEvidenceVerified(
    { claim: "Anything at all", status: "unsupported", quote: "", sourceIndex: 1 },
    "Anything at all [1].", noAbs), false, "a claim was checkable on title alone");
});

// ═══════════════════════════════════════════════════════════
group("L5-14 — one overall rule at every construction site");

await test("supported needs a supported claim, all thin is partly, zero countable is null", () => {
  assert.equal(factCheckOverallFromCounts({ supported: 0, thin: 2, unsupported: 0, checked: 2 }), "partly");
  assert.equal(factCheckOverallFromCounts({ supported: 0, thin: 0, unsupported: 0, checked: 0 }), null);
  assert.equal(factCheckOverallFromCounts({ supported: 1, thin: 0, unsupported: 0, checked: 1 }), "supported");
  assert.equal(factCheckOverallFromCounts({ supported: 0, thin: 0, unsupported: 2, checked: 2 }), "unsupported");
  const allThin = dedupeFactCheckClaims({
    mode: "claims", overall: "supported",
    summary: "Checked 1 claim against the cited sources: 0 supported, 1 thin, 0 unsupported.",
    claims: [{ claim: "A thin claim about honey.", status: "thin" }],
  });
  assert.equal(allThin.overall, "partly", "an all thin check still reads supported after the recount");
});

// ═══════════════════════════════════════════════════════════
group("L5-15 — fcLabel refuses scope carrying sentences");

await test("negation, qualifier, and contrast sentences pass through whole", () => {
  const neg = "The treatment did not reduce mortality in older adults with severe disease at all.";
  assert.equal(fcCompressStep(neg), "The treatment did not reduce mortality in older adults with severe disease at all");
  const qual = "The drug may lower blood pressure in some patients with resistant hypertension.";
  assert.equal(fcCompressStep(qual), "The drug may lower blood pressure in some patients with resistant hypertension");
  const con = "The dose lowered glucose while raising risk in older adults with kidney disease.";
  assert.equal(fcCompressStep(con), "The dose lowered glucose while raising risk in older adults with kidney disease");
  assert.equal(fcSentenceIncompressible("Metformin lowers blood glucose."), false);
  assert.ok(fcCompressStep("The study found that metformin lowers blood glucose in adults with diabetes mellitus type two.").length <= 52,
    "a marker free sentence no longer compresses");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
