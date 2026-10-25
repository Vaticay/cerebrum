/**
 * Fleet hardening (2026-10-13): per-leg health memory, Groq roster
 * re-verification, the Workers AI tail, and the delayed rescue.
 *
 * The production failure this answers: every synthesis leg failed in
 * one run (OpenRouter free daily cap, Groq per-model 429s, Gemini and
 * Mistral 429s, two Workers AI legs burning full 10s timeouts, one
 * "response too short") and the extractive tier served. The fleet had
 * no memory: the next request fired the same dead legs again.
 *
 * Pins:
 *  - failure classification reads the providers' own wording; daily
 *    cap wording wins over the generic 429 in the same message.
 *  - a daily capped leg parks for hours, a short rate limit for about
 *    a minute, timeouts only after repeats; success clears all of it.
 *    The clock is injected, like clampStageLegTimeout's.
 *  - wave legs are constructed through guardedRaceEntry, which skips
 *    a parked leg and records the skip in the attempt trail (source
 *    pins: the wave builders live inside the request handler).
 *  - the delayed rescue planner fires ONLY on an all rate limit
 *    failure set; the production trail itself (which contains a
 *    timeout and a too short) does not qualify, a pure 429 set does,
 *    a daily cap only set stands down with a named reason, and a wait
 *    that cannot fit before the rescue deadline is skipped by name.
 *  - the Groq roster names only models verified current in Groq's
 *    published catalog (listing verification 2026-10-13).
 *
 * Run with: node tests/fleet-hardening.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
const {
  classifyLegFailure,
  recordLegOutcome,
  legParkInfo,
  legHealthKey,
  legHealthSnapshot,
  resetLegHealth,
  planDelayedRescue,
  cfLegTimeoutMs,
  cfCompletionBudget,
  compatLegTimeoutMs,
  COMPAT_LEG_TIMEOUT_OVERRIDES,
  LEG_PARK_DAILY_CAP_MS,
  LEG_PARK_RATE_LIMIT_MS,
  LEG_PARK_TIMEOUT_MS,
  LEG_TIMEOUT_PARK_THRESHOLD,
  DELAYED_RESCUE_WAIT_MS,
  DELAYED_RESCUE_RETRY_MS,
  DELAYED_RESCUE_OVERRUN_MS,
  DELAYED_RESCUE_MIN_WAIT_MS,
  // 2026-10-25 (free legs wave): the second key bucket pins below
  // exercise these three directly.
  synthesisBucketForLabel,
  auxLegHealthLabel,
  factCheckModelFamily,
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

const T0 = 1_700_000_000_000;
const OR_DAILY = 'google/gemma-4-31b-it:free: HTTP 429 . {"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to "}}';
const GROQ_429 = 'groq:openai/gpt-oss-120b: HTTP 429 . {"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` in organization"}}';
const GEMINI_429 = 'gemini:gemini-3.8-flash: HTTP 429 . {"error":{"code":429,"message":"You exceeded your current quota, please check"}}';
const TIMEOUT = "@cf/meta/llama-4-scout-17b-16e-instruct: timed out";
const TOO_SHORT = "@cf/openai/gpt-oss-20b: response too short";

// ═══════════════════════════════════════════════════════════════════
group("failure classification — the providers' own wording");

await test("OpenRouter's daily message classifies as a daily cap, not a minute limit", () => {
  // The message contains BOTH "Rate limit" and "per-day": the daily
  // reading must win, or the leg gets re-fired every minute all day.
  assert.equal(classifyLegFailure(OR_DAILY), "daily-cap");
  assert.equal(classifyLegFailure(new Error(OR_DAILY)), "daily-cap");
});

await test("short window 429s classify as rate limits", () => {
  assert.equal(classifyLegFailure(GROQ_429), "rate-limit");
  assert.equal(classifyLegFailure(GEMINI_429), "rate-limit");
  assert.equal(classifyLegFailure('mistral:mistral-small-latest: HTTP 429 . {"message":"Rate limit exceeded"}'), "rate-limit");
});

await test("timeouts, circuit opens, and substance failures classify separately", () => {
  assert.equal(classifyLegFailure(TIMEOUT), "timeout");
  assert.equal(classifyLegFailure("circuit open for llm:groq; retry in 42s"), "circuit-open");
  assert.equal(classifyLegFailure("groq:meta-llama/llama-3.3-70b-versatile: HTTP 404 . model not found"), "other");
  assert.equal(classifyLegFailure(TOO_SHORT), "other");
  assert.equal(classifyLegFailure("some model: no OpenRouter key configured"), "other");
});

// ═══════════════════════════════════════════════════════════════════
group("per-leg parking — injected clock");

await test("a daily capped leg parks for hours", () => {
  resetLegHealth();
  recordLegOutcome("google/gemma-4-31b-it:free", false, OR_DAILY, T0);
  const park = legParkInfo("google/gemma-4-31b-it:free", T0 + 60 * 60 * 1000);
  assert.ok(park, "still parked an hour later");
  assert.equal(park.parkClass, "daily-cap");
  assert.equal(park.reason, "daily rate limit cap");
  assert.equal(park.untilMs - T0, LEG_PARK_DAILY_CAP_MS);
  assert.ok(LEG_PARK_DAILY_CAP_MS >= 2 * 60 * 60 * 1000, "daily park is hours, not minutes");
  assert.equal(legParkInfo("google/gemma-4-31b-it:free", T0 + LEG_PARK_DAILY_CAP_MS + 1), null, "park lapses after its window");
});

await test("a short rate limit parks for about a minute", () => {
  resetLegHealth();
  recordLegOutcome("groq:openai/gpt-oss-120b", false, GROQ_429, T0);
  const park = legParkInfo("groq:openai/gpt-oss-120b", T0 + 1000);
  assert.ok(park, "parked right after the 429");
  assert.equal(park.parkClass, "rate-limit");
  assert.equal(park.untilMs - T0, LEG_PARK_RATE_LIMIT_MS);
  assert.ok(LEG_PARK_RATE_LIMIT_MS >= 30000 && LEG_PARK_RATE_LIMIT_MS <= 120000, "minute scale");
  assert.ok(legParkInfo("groq:openai/gpt-oss-120b", T0 + 59000), "still parked at 59s");
  assert.equal(legParkInfo("groq:openai/gpt-oss-120b", T0 + 61000), null, "free again at 61s");
});

await test("timeouts park only after repeats, and briefly", () => {
  resetLegHealth();
  recordLegOutcome("@cf/meta/llama-4-scout-17b-16e-instruct", false, TIMEOUT, T0);
  assert.equal(legParkInfo("@cf/meta/llama-4-scout-17b-16e-instruct", T0 + 1), null, "one timeout is a fluke, no park");
  recordLegOutcome("@cf/meta/llama-4-scout-17b-16e-instruct", false, TIMEOUT, T0 + 1000);
  const park = legParkInfo("@cf/meta/llama-4-scout-17b-16e-instruct", T0 + 2000);
  assert.ok(park, "parked after the repeat");
  assert.equal(park.parkClass, "timeout");
  assert.equal(park.reason, "repeated timeouts");
  assert.equal(park.untilMs - (T0 + 1000), LEG_PARK_TIMEOUT_MS);
  assert.equal(LEG_TIMEOUT_PARK_THRESHOLD, 2);
});

await test("a success or a different failure breaks the timeout streak", () => {
  resetLegHealth();
  const leg = "@cf/mistralai/mistral-small-3.1-24b-instruct";
  recordLegOutcome(leg, false, TIMEOUT, T0);
  recordLegOutcome(leg, true, null, T0 + 1);
  recordLegOutcome(leg, false, TIMEOUT, T0 + 2);
  assert.equal(legParkInfo(leg, T0 + 3), null, "success reset the streak");
  recordLegOutcome(leg, false, "leg: HTTP 404 . model not found", T0 + 4);
  recordLegOutcome(leg, false, TIMEOUT, T0 + 5);
  assert.equal(legParkInfo(leg, T0 + 6), null, "a substance failure reset the streak too");
});

await test("a success clears an active park and counts the win", () => {
  resetLegHealth();
  recordLegOutcome("groq:openai/gpt-oss-120b", false, GROQ_429, T0);
  assert.ok(legParkInfo("groq:openai/gpt-oss-120b", T0 + 1));
  recordLegOutcome("groq:openai/gpt-oss-120b", true, null, T0 + 2);
  assert.equal(legParkInfo("groq:openai/gpt-oss-120b", T0 + 3), null);
  assert.equal(legHealthSnapshot("groq:openai/gpt-oss-120b").successes, 1);
});

await test("substance failures never park", () => {
  resetLegHealth();
  recordLegOutcome("@cf/openai/gpt-oss-20b", false, TOO_SHORT, T0);
  recordLegOutcome("@cf/openai/gpt-oss-20b", false, TOO_SHORT, T0 + 1);
  recordLegOutcome("@cf/openai/gpt-oss-20b", false, TOO_SHORT, T0 + 2);
  assert.equal(legParkInfo("@cf/openai/gpt-oss-20b", T0 + 3), null);
});

await test("the fastpath shares its model's health record", () => {
  assert.equal(legHealthKey("fastpath:nvidia/nemotron-3-ultra-550b-a55b:free"), "nvidia/nemotron-3-ultra-550b-a55b:free");
  resetLegHealth();
  recordLegOutcome("nvidia/nemotron-3-ultra-550b-a55b:free", false, "m: HTTP 429 . Rate limit exceeded: free-models-per-day", T0);
  assert.ok(
    legParkInfo("fastpath:nvidia/nemotron-3-ultra-550b-a55b:free", T0 + 1),
    "a park recorded under the bare model name covers the fastpath label"
  );
});

// ═══════════════════════════════════════════════════════════════════
group("wave construction — parked legs are skipped and the skip is reported");

await test("every wave leg is constructed through guardedRaceEntry", () => {
  // CORRECTED CONTRACT (2026-10-13, subrequest ledger): wave legs are
  // built as descriptors and fired through fireWaveLegs, whose single
  // guardedRaceEntry call is now the funnel every selected leg passes
  // (the park check still runs before any leg fires; counting raw
  // guardedRaceEntry call sites no longer measures the contract).
  // Waves 1, 2 and 3 fire through the planner; the rescue waves map
  // their planned legs through guardedRaceEntry directly.
  // PIN UPDATED (2026-10-16, finding 12): fireWaveLegs now also
  // forwards the race state (the closed flag a planned retry race
  // sets when its close window expires, so discarded outcomes
  // drop their bookkeeping) as a fourth argument. The funnel
  // contract this pin protects — every selected leg passes the
  // single guardedRaceEntry call — is unchanged.
  assert.ok(src.includes("guardedRaceEntry(d.wave, d.label, d.fire, raceState)"),
    "fireWaveLegs does not funnel selected legs through guardedRaceEntry");
  const planned = src.match(/fireWaveLegs\(\[/g) || [];
  assert.ok(planned.length >= 3, `expected waves 1 to 3 to fire through fireWaveLegs, found ${planned.length}`);
  const descriptorBuilders = src.match(/compatLegDescriptors\(/g) || [];
  assert.ok(descriptorBuilders.length >= 3, `expected compatLegDescriptors call sites in waves 1 to 3, found ${descriptorBuilders.length}`);
  assert.ok(!src.includes(".map((m) => raceEntry("), "a wave still builds legs with bare raceEntry");
});

await test("the skip lands in the attempt trail in the failure shape, with its plain reason", () => {
  assert.ok(
    src.includes('aiAttempts.push({ wave, model: label, ok: false, ms: 0, parked: true, error: "parked (" + park.reason + ")" })'),
    "guardedRaceEntry must record parked skips with the park reason"
  );
});

await test("the immediate rescue also respects parks", () => {
  assert.ok(src.includes("both rescue legs parked by the per-leg health store; rescue not fired"));
});

// ═══════════════════════════════════════════════════════════════════
group("Groq roster — verified current in Groq's published catalog (2026-10-13)");

const modelsBlock = src.slice(src.indexOf("const PROVIDER_MODELS = {"), src.indexOf("const PROVIDER_MODELS = {") + 1800);

await test("the new independent Groq pool is in the roster under its current name", () => {
  // Roster correction (2026-10-13): an earlier draft of this pass
  // added qwen/qwen3-32b and llama-3.1-8b-instant on catalog listing
  // alone. Groq's deprecations list says both were shut down for
  // free/developer tier keys (2026-07-17 and 2026-08-16), and no
  // verification call is possible from the build machine to save
  // them, so they are out. What ships is the current name in Groq's
  // replacement chain: qwen/qwen3.8-27b.
  assert.ok(modelsBlock.includes('"qwen/qwen3.8-27b"'), "qwen/qwen3.8-27b missing from the roster");
  assert.ok(
    modelsBlock.includes('groq:     { w1: ["openai/gpt-oss-120b"],      w2: ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"] }'),
    "groq roster line changed shape"
  );
});

await test("no decommissioned or tier-shut-down Groq model is a roster leg", () => {
  assert.ok(!modelsBlock.includes("llama-4-maverick"), "maverick was decommissioned 2026-03-09");
  assert.ok(!modelsBlock.includes("kimi-k2"), "kimi-k2 reached EOL 2025-10-10");
  assert.ok(!modelsBlock.includes("qwq-32b"), "qwen-qwq-32b was deprecated 2025-07-14");
  assert.ok(!modelsBlock.includes("r1-distill"), "deepseek-r1-distill was deprecated 2025-10-02");
  assert.ok(!modelsBlock.includes("llama-3.3-70b-versatile"), "shut down for free/developer accounts 2026-08-16");
  assert.ok(!modelsBlock.includes('"qwen/qwen3-32b"'), "qwen3-32b was shut down for this tier 2026-07-17");
  assert.ok(!modelsBlock.includes('"llama-3.1-8b-instant"'), "llama-3.1-8b-instant was removed for this tier 2026-08-16");
});

await test("the unverifiable GitHub Models bucket is parked out of the active providers", () => {
  assert.ok(
    src.includes('// { id: "github",   key: env.GITHUB_MODELS_KEY'),
    "the github provider row must be parked (commented out) until a real call verifies it"
  );
});

// ═══════════════════════════════════════════════════════════════════
group("second key buckets — separate quotas on the proven providers (2026-10-25)");

await test("groq2 and gemini2 rows exist as opt in second key buckets", () => {
  // Free legs wave (2026-10-25): Groq caps follow the organization
  // and AI Studio caps follow the project, so a second key from a
  // second org / project is a genuinely separate pool behind the
  // same production proven endpoint and roster. The rows follow
  // the fleet's opt in shape — no key set, no leg, no behaviour
  // change — so these pins assert the rows and their env names,
  // never that a key exists.
  assert.ok(
    src.includes('{ id: "groq2",    key: env.GROQ_KEY_2,'),
    "the groq2 provider row is missing"
  );
  assert.ok(
    src.includes('{ id: "gemini2",  key: env.GEMINI_KEY_2,'),
    "the gemini2 provider row is missing"
  );
  assert.ok(
    src.includes('groq2:    { w1: ["openai/gpt-oss-120b"],      w2: ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"] }'),
    "the groq2 roster must mirror the groq roster exactly"
  );
  assert.ok(
    src.includes('gemini2:  { w1: ["gemini-3.8-flash"],        w2: ["gemini-3.5-flash-lite"] }'),
    "the gemini2 roster must mirror the gemini roster exactly"
  );
});

await test("second key labels bucket per provider, never into the shared pools", () => {
  // The whole point of a second key is a separate quota; if its
  // labels bucketed into the shared OpenRouter pool they would
  // inherit that pool's daily cap parks and the bucket would be
  // fiction. synthesisBucketForLabel is the behaviour the wave
  // planner and the park store both read.
  assert.equal(synthesisBucketForLabel("groq2:openai/gpt-oss-120b"), "compat:groq2");
  assert.equal(synthesisBucketForLabel("gemini2:gemini-3.8-flash"), "compat:gemini2");
  assert.equal(synthesisBucketForLabel("sambanova:gpt-oss-120b"), "compat:sambanova");
  assert.equal(auxLegHealthLabel({ via: "gemini2", model: "gemini-3.5-flash-lite" }), "gemini2:gemini-3.5-flash-lite");
});

await test("the second Gemini key arms a validation leg and a claim check tier", () => {
  // The stages that starve on a capped day are validation and
  // the claim check, not only the synthesis race: the wave gave
  // GEMINI_KEY_2 a leg in defaultValidationCall (via gemini2)
  // and tier 1b in deepFactCheck, both behind the same family's
  // rules (winner exclusion for the tier, the 3,000 ms cap).
  assert.ok(src.includes('via: "gemini2",'), "the validation fifth leg is missing");
  assert.ok(src.includes('finishClaims(claimsG2, "gemini2", GEMINI_CHECK_MODEL)'), "claim check tier 1b does not record its outcome");
  assert.equal(compatLegTimeoutMs("gemini2:gemini-3.8-flash", 10000), 3000);
  assert.equal(compatLegTimeoutMs("gemini2:gemini-3.5-flash-lite", 8000), 3000);
  // Family math: a gemini2 winner is the gemini family, so the
  // Gemini check tiers may not check its answers.
  assert.equal(factCheckModelFamily("gemini2:gemini-3.8-flash"), "gemini");
  assert.equal(factCheckModelFamily("groq2:openai/gpt-oss-120b"), "gpt-oss");
});

await test("the SambaNova bucket is parked with its roster ready", () => {
  // Same discipline as the GitHub park: a documented free tier
  // (SambaNova's own rate limits page, 2026-10-23) is not a
  // verified leg. The row stays commented and the models entry
  // stays, so restoring is one line once a key passes a live
  // serving sized call.
  assert.ok(
    src.includes('// { id: "sambanova", key: env.SAMBANOVA_KEY,'),
    "the sambanova provider row must be parked (commented out) until a real call verifies it"
  );
  assert.ok(
    src.includes('sambanova: { w1: ["gpt-oss-120b"],           w2: ["Meta-Llama-3.3-70B-Instruct", "DeepSeek-V3.1"] }'),
    "the sambanova roster entry is missing"
  );
});

await test("wave 2 no longer trims the roster with firstOnly", () => {
  assert.ok(!src.includes("{ firstOnly: true }"), "the firstOnly trim is gone (it only ever trimmed Groq)");
});

// ═══════════════════════════════════════════════════════════════════
group("OpenRouter roster — the restricted inkling-small leg is out (2026-10-14)");

await test("the 403 restricted model is not an entry in OR_FREE_MODELS", () => {
  // Evidence (live production stageHealth trails, saved probe
  // responses): thinkingmachines/inkling-small:free failed every
  // race it entered with HTTP 403 in ~26ms, OpenRouter's error text
  // beginning "is only availab..." — a model side restriction. The
  // same key answered sibling models in the same races, so it was
  // never a missing key problem, and the full size inkling shows
  // no such failure and stays.
  // PIN UPDATED (2026-10-14, wave ten): the last clause is
  // superseded by newer live evidence. The wave nine build's
  // PCR probe trail shows the FULL SIZE inkling failing with
  // the same HTTP 403 restriction ("only available on
  // agenti..."), so it leaves the roster too, and
  // classifyLegFailure now parks the model-restricted class.
  const orBlock = src.slice(src.indexOf("const OR_FREE_MODELS = ["), src.indexOf("const OR_FREE_MODELS = [") + 1800);
  assert.ok(!orBlock.includes('"thinkingmachines/inkling-small:free"'), "inkling-small is back in OR_FREE_MODELS");
  assert.ok(!orBlock.includes('"thinkingmachines/inkling:free"'), "the full size inkling is restricted too and must stay out (wave ten evidence)");
});

await test("no wave or rescue roster references the removed list position", () => {
  // OR_WAVE2 and the wave 3 bulletproof seats named the dead leg
  // by list index (OR_FREE_MODELS[5]); the delayed rescue iterates
  // the whole list, so the list removal covers it too.
  assert.ok(!src.includes("OR_FREE_MODELS[5]"), "a roster still references OR_FREE_MODELS[5]");
  assert.ok(
    src.includes("const OR_WAVE2 = [OR_FREE_MODELS[1], OR_FREE_MODELS[3], OR_FREE_MODELS[4]];"),
    "OR_WAVE2 changed shape"
  );
});

// ═══════════════════════════════════════════════════════════════════
group("Workers AI tail — timeout caps and the reasoning completion budget");

await test("the flaky-slow legs get a 3s cap, others keep the wave timeout", () => {
  // CORRECTED CONTRACT (2026-10-14, fifth panel, Job 4): the cap
  // was 6s when the pair held wave 1 seats; the fifth panel's
  // probes timed both out at exactly that 6,000 ms in every probe
  // and neither ever won, so wave six demoted them out of the
  // early waves into the final wave and cut the override to
  // 3,000 ms. The pin moves with the roster.
  // PIN UPDATED (2026-10-14, wave sixteen, eighth panel
  // Infrastructure defect 2): gpt-oss-20b joins the capped
  // roster — it had no entry in either timeout map and burned
  // 10,000 and 12,000 ms timeouts in wave 1 and the rescue
  // wave. This pin used it as the unlisted example; the
  // unlisted example is now a leg no map names.
  assert.equal(cfLegTimeoutMs("@cf/meta/llama-4-scout-17b-16e-instruct", 10000), 3000);
  assert.equal(cfLegTimeoutMs("@cf/mistralai/mistral-small-3.1-24b-instruct", 10000), 3000);
  assert.equal(cfLegTimeoutMs("@cf/meta/llama-4-scout-17b-16e-instruct", 2000), 2000, "never raises a smaller wave timeout");
  assert.equal(cfLegTimeoutMs("@cf/openai/gpt-oss-20b", 10000), 3000, "gpt-oss-20b is capped after wave sixteen");
  assert.equal(cfLegTimeoutMs("@cf/meta/llama-3.3-70b-instruct-fp8-fast", 10000), 10000, "unlisted legs keep the wave timeout");
});

await test("the demoted pair races in the final wave, not the early waves (Job 4)", () => {
  const wave1Block = src.match(/const CF_WAVE1 = \[([\s\S]*?)\];/);
  assert.ok(wave1Block, "CF_WAVE1 roster not found in source");
  assert.ok(!wave1Block[1].includes("llama-4-scout"), "llama-4-scout still holds a wave 1 seat");
  assert.ok(!wave1Block[1].includes("mistral-small"), "mistral-small still holds a wave 1 seat");
  assert.ok(wave1Block[1].includes("@cf/openai/gpt-oss-20b"), "wave 1 lost its fast Workers AI leg");
  // The final wave's Workers AI list carries both demoted legs,
  // raced through cfLegTimeoutMs so the 3s override binds there.
  assert.ok(
    src.includes('"@cf/meta/llama-3.2-3b-instruct", "@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/mistralai/mistral-small-3.1-24b-instruct"'),
    "the wave 3 Workers AI roster does not carry the demoted pair");
  assert.ok(src.includes("cfLegTimeoutMs(m, bpTimeout)"),
    "the final wave does not apply the per leg timeout overrides");
});

await test("gpt-oss legs get double the completion budget for reasoning", () => {
  assert.equal(cfCompletionBudget("@cf/openai/gpt-oss-20b", 6000), 4096);
  assert.equal(cfCompletionBudget("@cf/openai/gpt-oss-120b", 6000), 4096);
  assert.equal(cfCompletionBudget("@cf/openai/gpt-oss-20b", 3000), 3000, "a smaller request keeps its own budget");
  assert.equal(cfCompletionBudget("@cf/meta/llama-4-scout-17b-16e-instruct", 6000), 2048, "non reasoning legs keep 2048");
  assert.equal(cfCompletionBudget("@cf/meta/llama-4-scout-17b-16e-instruct", 1000), 1000);
  assert.ok(src.includes("max_tokens: cfCompletionBudget(model, maxTok)"), "callCF must use the per-model budget");
});

// ═══════════════════════════════════════════════════════════════════
group("compat tail — the long timeout legs capped (sixth panel, Job 3a)");

await test("the three long timeout compat legs get a 3s cap, others keep the wave timeout", () => {
  // The wave six demotion pattern, applied to the compat roster:
  // gemini-3.8-flash timed out at the full wave 1 timeout
  // (10,000 ms) in the panel's probes, and gemini-3.5-flash-lite
  // and mistral:open-mistral-nemo at the wave 2 timeout (8,000 ms).
  assert.equal(compatLegTimeoutMs("gemini:gemini-3.8-flash", 10000), 3000);
  assert.equal(compatLegTimeoutMs("gemini:gemini-3.5-flash-lite", 8000), 3000);
  assert.equal(compatLegTimeoutMs("mistral:open-mistral-nemo", 8000), 3000);
  assert.equal(compatLegTimeoutMs("gemini:gemini-3.8-flash", 2000), 2000, "never raises a smaller wave timeout");
  assert.equal(compatLegTimeoutMs("gemini:gemini-2.5-flash", 10000), 10000, "unlisted legs keep the wave timeout");
  assert.equal(compatLegTimeoutMs("mistral:mistral-small-latest", 8000), 8000, "unlisted legs keep the wave timeout");
  // PIN UPDATED (2026-10-25, free legs wave): the table gains the
  // two gemini2 labels. The cap follows the MODEL's measured stall,
  // not the key: the second Gemini key serves the same two models
  // on the same API, so leaving its legs uncapped would re-open
  // the exact 10 s wave 1 stall this test exists to keep closed.
  // The pin's intent is unchanged — no leg is capped without the
  // panel pattern behind it — and the gemini2 entries are asserted
  // behaviourally in the second key bucket group above.
  assert.deepEqual(Object.keys(COMPAT_LEG_TIMEOUT_OVERRIDES).sort(),
    ["gemini2:gemini-3.5-flash-lite", "gemini2:gemini-3.8-flash", "gemini:gemini-3.5-flash-lite", "gemini:gemini-3.8-flash", "mistral:open-mistral-nemo"],
    "the override table names legs other than the panel specimens and the second key's same models");
});

await test("the caps bind where the wave descriptors are built, and the seats are as placed", () => {
  // Applied in compatLegDescriptors, so every wave a listed leg
  // races in — including the bulletproof wave, which reuses the
  // w1 rosters — inherits the cap.
  assert.ok(src.includes('compatLegTimeoutMs(p.id + ":" + m, timeoutMs)'),
    "compatLegDescriptors does not apply the per leg timeout overrides");
  // Placement, by the wave six reasoning: gemini-3.8-flash is the
  // family's quality leg and keeps its wave 1 seat (capped);
  // flash-lite and nemo are diversity legs whose seat is already
  // the late wave 2, capped in place rather than duplicated into
  // the bulletproof roster (wave 3 draws the w1 lists).
  assert.ok(src.includes('gemini:   { w1: ["gemini-3.8-flash"],        w2: ["gemini-3.5-flash-lite"] }'),
    "the gemini seats moved: 3.8-flash must hold w1 and 3.5-flash-lite w2");
  assert.ok(src.includes('mistral:  { w1: ["mistral-small-latest"],    w2: ["open-mistral-nemo"] }'),
    "the mistral seats moved: open-mistral-nemo must hold w2");
});

// ═══════════════════════════════════════════════════════════════════
group("delayed rescue — fires only when waiting can actually help");

await test("the wait is inside the 15 to 25 second band and the shape is bounded", () => {
  assert.ok(DELAYED_RESCUE_WAIT_MS >= 15000 && DELAYED_RESCUE_WAIT_MS <= 25000, "wait band");
  assert.equal(DELAYED_RESCUE_RETRY_MS, 8000);
  assert.equal(DELAYED_RESCUE_OVERRUN_MS, 30000);
  assert.ok(DELAYED_RESCUE_MIN_WAIT_MS >= 1000 && DELAYED_RESCUE_MIN_WAIT_MS < DELAYED_RESCUE_WAIT_MS);
});

await test("the production trail shape does NOT qualify (timeouts and a too short are in it)", () => {
  resetLegHealth();
  const trail = [
    { wave: 1, model: "google/gemma-4-31b-it:free", ok: false, error: OR_DAILY },
    { wave: 1, model: "groq:openai/gpt-oss-120b", ok: false, error: GROQ_429 },
    { wave: 1, model: "gemini:gemini-3.8-flash", ok: false, error: GEMINI_429 },
    { wave: 1, model: "@cf/openai/gpt-oss-20b", ok: false, error: TOO_SHORT },
    { wave: 1, model: "@cf/meta/llama-4-scout-17b-16e-instruct", ok: false, error: TIMEOUT },
    { wave: 1, model: "@cf/mistralai/mistral-small-3.1-24b-instruct", ok: false, error: TIMEOUT },
  ];
  const plan = planDelayedRescue(trail, {
    rosterLabels: ["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b"],
    preferredLabel: "groq:openai/gpt-oss-120b",
    nowMs: T0,
    requestDeadlineMs: T0 + 120000,
  });
  assert.equal(plan.action, "skip");
  assert.equal(plan.summary, null, "a mixed failure set stands the rescue down silently");
});

await test("a pure 429 set waits, and retries the preferred leg plus one more", () => {
  resetLegHealth();
  // Groq's main leg 429'd at T0 and is in its one minute cooldown.
  recordLegOutcome("groq:openai/gpt-oss-120b", false, GROQ_429, T0);
  const attempts = [
    { wave: 1, model: "groq:openai/gpt-oss-120b", ok: false, error: GROQ_429 },
    { wave: 2, model: "groq:openai/gpt-oss-20b", ok: false, error: GROQ_429 },
    { wave: 1, model: "gemini:gemini-3.8-flash", ok: false, error: GEMINI_429 },
  ];
  const plan = planDelayedRescue(attempts, {
    rosterLabels: ["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b", "groq:qwen/qwen3.8-27b"],
    preferredLabel: "groq:openai/gpt-oss-120b",
    // 45s after the failure, the 60s cooldown lapses inside the wait.
    nowMs: T0 + 45000,
    requestDeadlineMs: T0 + 120000,
  });
  assert.equal(plan.action, "wait");
  assert.equal(plan.waitMs, DELAYED_RESCUE_WAIT_MS);
  assert.equal(plan.chosen[0], "groq:openai/gpt-oss-120b", "Groq's main leg leads the retry");
  assert.equal(plan.chosen.length, 2);
});

await test("a leg still parked at the end of the wait is not chosen", () => {
  resetLegHealth();
  recordLegOutcome("groq:openai/gpt-oss-120b", false, GROQ_429, T0); // parked until T0 + 60s
  const attempts = [{ wave: 1, model: "groq:openai/gpt-oss-120b", ok: false, error: GROQ_429 }];
  const plan = planDelayedRescue(attempts, {
    rosterLabels: ["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b"],
    preferredLabel: "groq:openai/gpt-oss-120b",
    // Only 10s after the failure: the cooldown (ends at 60s) outlasts
    // the 20s wait, so the preferred leg is passed over, not fired early.
    nowMs: T0 + 10000,
    requestDeadlineMs: T0 + 120000,
  });
  assert.equal(plan.action, "wait");
  assert.deepEqual(plan.chosen, ["groq:openai/gpt-oss-20b"]);
});

await test("a daily cap only set stands down with a named reason", () => {
  resetLegHealth();
  const attempts = [
    { wave: 1, model: "google/gemma-4-31b-it:free", ok: false, error: OR_DAILY },
    { wave: 2, model: "nvidia/nemotron-3-super-120b-a12b:free", ok: false, error: OR_DAILY },
  ];
  const plan = planDelayedRescue(attempts, {
    rosterLabels: ["groq:openai/gpt-oss-120b"],
    preferredLabel: "groq:openai/gpt-oss-120b",
    nowMs: T0,
    requestDeadlineMs: T0 + 120000,
  });
  assert.equal(plan.action, "skip");
  assert.ok(plan.summary && plan.summary.includes("daily cap"), "the stand down is named");
});

await test("a wait that cannot fit before the rescue deadline is skipped by name", () => {
  resetLegHealth();
  const attempts = [{ wave: 5, model: "groq:openai/gpt-oss-120b", ok: false, error: GROQ_429 }];
  const plan = planDelayedRescue(attempts, {
    rosterLabels: ["groq:openai/gpt-oss-120b"],
    preferredLabel: "groq:openai/gpt-oss-120b",
    nowMs: T0,
    // The request is already 20s past its deadline: wait + retry +
    // reserve cannot fit inside deadline + the 30s overrun.
    requestDeadlineMs: T0 - 20000,
  });
  assert.equal(plan.action, "skip");
  assert.ok(plan.summary && plan.summary.includes("does not fit"), "the skip is named");
});

await test("when every roster leg is daily parked, the rescue stands down by name", () => {
  resetLegHealth();
  recordLegOutcome("groq:openai/gpt-oss-120b", false, OR_DAILY, T0);
  recordLegOutcome("groq:openai/gpt-oss-20b", false, OR_DAILY, T0);
  const attempts = [
    { wave: 5, model: "pollinations:openai", ok: false, error: "pollinations:openai: HTTP 429 . rate limited" },
    { wave: 1, model: "google/gemma-4-31b-it:free", ok: false, error: OR_DAILY },
  ];
  const plan = planDelayedRescue(attempts, {
    rosterLabels: ["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b"],
    preferredLabel: "groq:openai/gpt-oss-120b",
    nowMs: T0 + 1000,
    requestDeadlineMs: T0 + 120000,
  });
  assert.equal(plan.action, "skip");
  assert.ok(plan.summary && plan.summary.includes("no leg will be unparked"), "the stand down is named");
});

await test("the second retry leg is the roster's best tracked leg", () => {
  resetLegHealth();
  recordLegOutcome("groq:qwen/qwen3.8-27b", true, null, T0);
  recordLegOutcome("groq:qwen/qwen3.8-27b", true, null, T0);
  recordLegOutcome("groq:qwen/qwen3.8-27b", true, null, T0);
  recordLegOutcome("groq:openai/gpt-oss-20b", true, null, T0);
  const attempts = [{ wave: 1, model: "groq:openai/gpt-oss-120b", ok: false, error: GROQ_429 }];
  const plan = planDelayedRescue(attempts, {
    rosterLabels: ["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b", "groq:qwen/qwen3.8-27b"],
    preferredLabel: "groq:openai/gpt-oss-120b",
    nowMs: T0,
    requestDeadlineMs: T0 + 120000,
  });
  assert.equal(plan.action, "wait");
  assert.deepEqual(plan.chosen, ["groq:openai/gpt-oss-120b", "groq:qwen/qwen3.8-27b"], "wins outrank roster order for the second seat");
});

await test("parked skips in the trail do not poison the failure set", () => {
  resetLegHealth();
  const attempts = [
    { wave: 2, model: "groq:openai/gpt-oss-120b", ok: false, error: GROQ_429 },
    // A skip recorded by guardedRaceEntry: its error text mentions a
    // daily cap, but it is not a failure of THIS request and must not
    // change the gate either way.
    { wave: 2, model: "google/gemma-4-31b-it:free", ok: false, ms: 0, parked: true, error: "parked (daily rate limit cap)" },
    { wave: 3, model: "@cf/openai/gpt-oss-20b", ok: false, ms: 0, parked: true, error: "parked (repeated timeouts)" },
  ];
  const plan = planDelayedRescue(attempts, {
    rosterLabels: ["groq:openai/gpt-oss-120b"],
    preferredLabel: "groq:openai/gpt-oss-120b",
    nowMs: T0,
    requestDeadlineMs: T0 + 120000,
  });
  assert.equal(plan.action, "wait", "only the real 429 counts toward the gate");
});

await test("the delayed rescue is planned before the synthesis stage closes", () => {
  const planIdx = src.indexOf("planDelayedRescue(aiAttempts");
  const stageIdx = src.indexOf('name: "synthesis",');
  assert.ok(planIdx > 0, "handler must plan the delayed rescue");
  assert.ok(stageIdx > planIdx, "the plan must land in the attempt trail before stage health is computed");
  assert.ok(src.includes("delayedRescue: true"), "wave 6 attempts are marked as the delayed rescue");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
