/**
 * Subrequest budget (2026-10-13) — the per request ledger that keeps
 * retrieval from spending the invocation's whole Cloudflare
 * subrequest allowance (50 on this plan) before the answer stages
 * run.
 *
 * The production evidence (third panel rescore, build 491e84c):
 * synthesis races died wholesale with "Too many subrequests by
 * single Worker invocation" at millisecond zero, expansion fired on
 * 0 of 8 probes, validation reported "no leg answered" everywhere,
 * and the extractive tier served most probes — because gatherPapers
 * guarded its fanout with a TIME budget while fast failures (429s in
 * milliseconds) spent the COUNT budget almost instantly. The
 * failure classifier also mapped the exhaustion error to "other",
 * so parking, rescue planning and stage health all misread our own
 * budget exhaustion as a fleet outage.
 *
 * What is pinned here:
 *   1. The ledger itself: counts, per stage attribution, the
 *      reserve arithmetic retrievalRoom() gates on.
 *   2. planWaveLegs: breadth first across provider buckets, zero
 *      cost legs always fire, nothing fires past the allowance, and
 *      with a plentiful allowance the selection is the construction
 *      order unchanged (behavior identical when budget is plentiful).
 *   3. The failure class: "Too many subrequests" is its own class,
 *      legs never park for it, and the delayed rescue planner does
 *      not treat a budget failure set as a rate limit set.
 *   4. Handler level, with a counting fetch stub: a hard question's
 *      retrieval trims its later rungs and fallback rounds BEFORE
 *      synthesis can starve — total outbound fetches stay within
 *      the 50 cap while expansion and validation still fire and the
 *      synthesis race still produces an AI answer.
 *
 * Run with: node tests/subrequest-budget.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  onRequest,
  createSubrequestLedger,
  planWaveLegs,
  SUBREQUEST_LIMIT,
  SUBREQUEST_ANSWER_RESERVE,
  SUBREQUEST_RUNG_COST,
  SUBREQUEST_TAIL_RESERVE,
  SUBREQUEST_RESERVE_REASON,
  SUBREQUEST_EXHAUSTED_REASON,
  classifyLegFailure,
  isSubrequestBudgetError,
  recordLegOutcome,
  legParkInfo,
  resetLegHealth,
  planDelayedRescue,
} = await import(join(root, "functions/api/search.js"));

// ═══════════════════════════════════════════════════════════════
group("the ledger — counts, stages, reserve arithmetic");

await test("a fresh ledger holds the full plan allowance", () => {
  const ledger = createSubrequestLedger();
  assert.equal(ledger.used(), 0);
  assert.equal(ledger.remaining(), SUBREQUEST_LIMIT);
  assert.equal(SUBREQUEST_LIMIT, 50, "the plan allowance this design is sized against");
  const snap = ledger.snapshot();
  assert.deepEqual(snap, { used: 0, limit: 50, remaining: 50, byStage: {} });
});

// spend() records exactly one outbound fetch per call (that is the
// unit every call site spends in), so bulk spends loop.
function spendN(ledger, n) {
  for (let i = 0; i < n; i++) ledger.spend();
}

await test("spend counts every fetch and attributes it to the current stage", () => {
  const ledger = createSubrequestLedger();
  ledger.setStage("retrieval");
  ledger.spend();
  ledger.spend();
  ledger.setStage("synthesis");
  spendN(ledger, 3);
  assert.equal(ledger.used(), 5);
  assert.equal(ledger.remaining(), 45);
  const snap = ledger.snapshot();
  assert.deepEqual(snap.byStage, { retrieval: 2, synthesis: 3 });
});

await test("retrievalRoom protects the answer reserve, with margin on top", () => {
  const ledger = createSubrequestLedger();
  // Spend down to exactly reserve + rung cost + 1: a speculative
  // round (margin = one rung) may still start, plain retrieval may.
  spendN(ledger, SUBREQUEST_LIMIT - (SUBREQUEST_ANSWER_RESERVE + SUBREQUEST_RUNG_COST) - 1);
  assert.equal(ledger.remaining(), SUBREQUEST_ANSWER_RESERVE + SUBREQUEST_RUNG_COST + 1);
  assert.equal(ledger.retrievalRoom(SUBREQUEST_RUNG_COST), true);
  assert.equal(ledger.retrievalRoom(), true);
  // One more spend: the speculative round is cut, plain retrieval is not.
  ledger.spend();
  assert.equal(ledger.retrievalRoom(SUBREQUEST_RUNG_COST), false);
  assert.equal(ledger.retrievalRoom(), true);
  // Spend to exactly the reserve: nothing retrieval-side may start.
  spendN(ledger, SUBREQUEST_RUNG_COST);
  assert.equal(ledger.remaining(), SUBREQUEST_ANSWER_RESERVE);
  assert.equal(ledger.retrievalRoom(), false);
  // Spend past zero: remaining clamps at zero, used keeps the truth.
  spendN(ledger, SUBREQUEST_ANSWER_RESERVE + 10);
  assert.equal(ledger.remaining(), 0);
  assert.equal(ledger.used(), SUBREQUEST_LIMIT + 10);
  assert.equal(ledger.retrievalRoom(), false);
});

await test("two ledgers are independent (no module state across requests)", () => {
  const a = createSubrequestLedger();
  const b = createSubrequestLedger();
  spendN(a, 40);
  assert.equal(a.remaining(), 10);
  assert.equal(b.remaining(), SUBREQUEST_LIMIT);
});

// ═══════════════════════════════════════════════════════════════
group("planWaveLegs — breadth first across buckets, allowance bound");

const leg = (label, bucket, fetchCost, wave = 1) => ({ label, bucket, fetchCost, wave, fire: () => label });

await test("a tight allowance funds one leg per bucket before any bucket's second leg", () => {
  const descriptors = [
    leg("or-1", "openrouter", 1), leg("or-2", "openrouter", 1),
    leg("or-3", "openrouter", 1), leg("or-4", "openrouter", 1),
    leg("groq-1", "compat:groq", 1), leg("groq-2", "compat:groq", 1),
    leg("wai-1", "workers-ai", 0), leg("wai-2", "workers-ai", 0), leg("wai-3", "workers-ai", 0),
  ];
  const { selected, skipped } = planWaveLegs(descriptors, 3);
  // Round robin: or-1, groq-1, wai-1 (free), then or-2 spends the
  // last unit; wai-2 and wai-3 are free and still fire; groq-2 and
  // the remaining OpenRouter legs do not fit.
  assert.deepEqual(selected.map((d) => d.label), ["or-1", "or-2", "groq-1", "wai-1", "wai-2", "wai-3"]);
  assert.deepEqual(skipped.map((d) => d.label), ["or-3", "or-4", "groq-2"]);
});

await test("a plentiful allowance fires every leg in construction order (behavior unchanged)", () => {
  const descriptors = [
    leg("or-1", "openrouter", 1), leg("or-2", "openrouter", 1),
    leg("groq-1", "compat:groq", 1),
    leg("wai-1", "workers-ai", 0),
  ];
  const { selected, skipped } = planWaveLegs(descriptors, 500);
  assert.deepEqual(selected.map((d) => d.label), ["or-1", "or-2", "groq-1", "wai-1"]);
  assert.deepEqual(skipped, []);
});

await test("a zero allowance fires only the zero cost legs", () => {
  const descriptors = [
    leg("or-1", "openrouter", 1),
    leg("wai-1", "workers-ai", 0), leg("wai-2", "workers-ai", 0),
    leg("groq-1", "compat:groq", 1),
  ];
  const { selected, skipped } = planWaveLegs(descriptors, 0);
  assert.deepEqual(selected.map((d) => d.label), ["wai-1", "wai-2"]);
  assert.deepEqual(skipped.map((d) => d.label), ["or-1", "groq-1"]);
});

await test("an unaffordable leg does not block a cheaper leg behind it in the same bucket", () => {
  const descriptors = [
    leg("big-1", "openrouter", 5), leg("free-1", "openrouter", 0), leg("big-2", "openrouter", 5),
  ];
  const { selected, skipped } = planWaveLegs(descriptors, 2);
  assert.deepEqual(selected.map((d) => d.label), ["free-1"]);
  assert.deepEqual(skipped.map((d) => d.label), ["big-1", "big-2"]);
});

// ═══════════════════════════════════════════════════════════════
group("the failure class — our budget is not a provider outage");

const T0 = 1_700_000_000_000;

await test("exhaustion classifies as its own class, ahead of every other reading", () => {
  // The classifier keys on the runtime's own wording (the error a
  // fired leg actually dies with). Legs the planner never fired are
  // identified by their budgetSkipped flag on the attempt record,
  // not by parsing our own reason strings back.
  assert.equal(classifyLegFailure(new Error("Too many subrequests by single Worker invocation")), "subrequest-budget");
  assert.equal(classifyLegFailure("Too many subrequests by single Worker invocation"), "subrequest-budget");
  // The neighbouring classes are untouched.
  assert.equal(classifyLegFailure(new Error("m: HTTP 429 . rate limited")), "rate-limit");
  assert.equal(classifyLegFailure(new Error("m: timed out")), "timeout");
  assert.equal(isSubrequestBudgetError(new Error("Too many subrequests")), true);
  assert.equal(isSubrequestBudgetError(new Error("HTTP 429")), false);
  assert.equal(isSubrequestBudgetError(null), false);
  // The shipped reason strings name the budget for humans reading
  // stage health; they are not provider failure text.
  assert.ok(SUBREQUEST_EXHAUSTED_REASON.includes("subrequest budget"));
  assert.ok(SUBREQUEST_RESERVE_REASON.includes("subrequest budget"));
});

await test("a leg never parks for budget exhaustion, however often it repeats", () => {
  resetLegHealth();
  const label = "groq:openai/gpt-oss-120b";
  for (let i = 0; i < 6; i++) {
    recordLegOutcome(label, false, new Error("Too many subrequests by single Worker invocation"), T0 + i * 1000);
    assert.equal(legParkInfo(label, T0 + i * 1000 + 1), null, `budget failure ${i + 1} parked the leg`);
  }
  resetLegHealth();
});

await test("the delayed rescue planner refuses a budget failure set", () => {
  resetLegHealth();
  const attempts = [
    { wave: 1, model: "groq:openai/gpt-oss-120b", ok: false, error: "Too many subrequests by single Worker invocation" },
    { wave: 5, model: "groq:openai/gpt-oss-20b", ok: false, ms: 0, budgetSkipped: true, error: SUBREQUEST_EXHAUSTED_REASON },
  ];
  const plan = planDelayedRescue(attempts, {
    rosterLabels: ["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b"],
    preferredLabel: "groq:openai/gpt-oss-120b",
    nowMs: T0,
    requestDeadlineMs: T0 + 120000,
  });
  assert.equal(plan.action, "skip", "a budget failure set must not trigger the rate limit wait");
  resetLegHealth();
});

// ═══════════════════════════════════════════════════════════════
group("handler level — retrieval trims before synthesis can starve");

// A counting fetch stub driving the real onRequest. Two scenarios
// share it: "rich" returns two papers per Europe PMC call and an
// empty PubMed (the ladder stops after two rungs on plenty); "lean"
// returns one paper per call and PubMed ids that cost three fetches
// per call for zero papers (the ladder wants all three rungs, and
// without the ledger this scenario spends past the 50 cap before
// validation ever fires: 1 + 3 rungs x 16 + fallbacks).
const QUERY = "Do the germs in a baby belly change how well the baby grows";
const queryWords = QUERY.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
const richAbstract = (n) =>
  ("Study " + n + " on " + queryWords.join(" ") + ". " +
   "This paper examines " + queryWords.join(", ") + " in detail. " +
   "The findings show clear effects for " + queryWords.slice(0, 4).join(" and ") + " across the first year of life. ").repeat(2);
const SYNTH_ANSWER =
  "The microbes living in an infant gut **shape growth** from the first weeks of life [1]. " +
  "Studies show that **gut microbes** influence how nutrients are absorbed and how weight is gained over time [2]. " +
  "When the microbial community is disturbed early, growth can slow until the community recovers [1].";

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function chatRes(content) {
  return jsonRes({ choices: [{ message: { content } }] });
}
function fakeDb() {
  const st = () => {
    const s = {
      bind: () => s,
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true, meta: { changes: 0 } }),
    };
    return s;
  };
  return { prepare: () => st(), batch: async () => [], exec: async () => ({ results: [] }) };
}

async function runScenario(mode) {
  let fetchCount = 0;
  let epmcCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    fetchCount++;
    const u = String(url);
    const body = typeof opts.body === "string" ? opts.body : "";
    if (u.includes("api.groq.com") || u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com")) {
      if (body.includes("literature search specialist")) {
        // The term is the query's own (stemmed) wording, as the
        // strict expansion validator requires.
        return chatRes(JSON.stringify([{ term: "germ", alternates: ["gut microbes", "microbiota", "microbial community"] }]));
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      }
      return chatRes(SYNTH_ANSWER);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      epmcCalls++;
      const mk = (n) => ({
        title: "Gut germs and infant growth patterns study " + n,
        doi: "10.1000/ledger" + n,
        pubYear: "2024",
        citedByCount: 7,
        authorString: "Doe J, Roe K",
        journalTitle: "Journal of Infant Studies",
        abstractText: richAbstract(n),
      });
      if (mode === "lean") {
        if (u.includes("BODY")) return jsonRes({ resultList: { result: [] } });
        return jsonRes({ resultList: { result: [mk(epmcCalls)] } });
      }
      return jsonRes({ resultList: { result: [mk(epmcCalls * 2 - 1), mk(epmcCalls * 2)] } });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) {
        return jsonRes({ esearchresult: { idlist: mode === "lean" ? ["101", "102", "103"] : [] } });
      }
      if (u.includes("esummary")) return jsonRes({ result: {} });
      return new Response("", { status: 200 });
    }
    if (u.includes("export.arxiv.org")) return new Response("", { status: 200 });
    return jsonRes({});
  };
  try {
    const env = {
      DB: fakeDb(),
      GROQ_KEY: "ledger-test-groq-key-123456",
      GEMINI_KEY: "ledger-test-gemini-key-123456",
      MISTRAL_KEY: "ledger-test-mistral-key-123456",
      NVIDIA_KEY: "ledger-test-nvidia-key-123456",
    };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: {} });
    assert.equal(res.status, 200);
    return { data: await res.json(), fetchCount };
  } finally {
    globalThis.fetch = realFetch;
  }
}

function assertAnswerStagesFunded(data, fetchCount, minFetches) {
  assert.ok(fetchCount <= SUBREQUEST_LIMIT,
    `the invocation spent ${fetchCount} subrequests, past the ${SUBREQUEST_LIMIT} cap`);
  assert.ok(fetchCount >= minFetches,
    `only ${fetchCount} fetches: retrieval did not really run`);
  // Expansion fired and validated, inside the reserve.
  assert.equal(data._expansion && data._expansion.via, "groq", "expansion did not fire on its Groq leg");
  assert.ok(Array.isArray(data._expansion.groups) && data._expansion.groups.length >= 1,
    "expansion returned no validated groups");
  // Validation fired on a real leg (not "no leg answered", not a
  // budget skip): the shipped stage record carries the leg.
  const validation = (data.stageHealth || []).find((s) => s.name === "validation");
  assert.ok(validation, "no validation stage record shipped");
  assert.equal(validation.ok, true, "validation stage not ok");
  assert.equal(validation.via, "groq", "validation did not answer on its Groq leg");
  // Synthesis raced and won: an AI answer, not the extractive tier.
  const synthesis = (data.stageHealth || []).find((s) => s.name === "synthesis");
  assert.ok(synthesis, "no synthesis stage record shipped");
  assert.equal(synthesis.ok, true, "synthesis stage not ok");
  assert.ok(synthesis.winner, "synthesis record has no winner");
  assert.equal(data.synthesisMode, "ai", "the extractive tier served instead of a synthesis win");
}

await test("rich retrieval: expansion and validation fire, synthesis wins, spend inside the cap", async () => {
  const { data, fetchCount } = await runScenario("rich");
  assertAnswerStagesFunded(data, fetchCount, 40);
  assert.ok((data.sources || []).length >= 8, "the rich scenario should ship its papers");
});

await test("lean retrieval: later rungs and fallbacks trim, the answer stages stay funded", async () => {
  const { data, fetchCount } = await runScenario("lean");
  assertAnswerStagesFunded(data, fetchCount, 35);
  assert.ok((data.sources || []).length >= 3, "the lean scenario should still ship its papers");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
