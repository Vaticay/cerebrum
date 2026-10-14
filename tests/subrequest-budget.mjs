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
 * THE CORRECTION (2026-10-13, same day, live follow up): the first
 * version counted fetch() calls only and costed Workers AI legs at
 * zero. Production on that build still starved synthesis: expansion
 * and validation fired, but the legs died on the runtime's own
 * "Too many subrequests" while stage health said "subrequest
 * budget exhausted" — because the platform ALSO draws D1 statement
 * executions and Workers AI runs from the same 50, and the handler
 * path spends 25 or more of those on a hard request (rate limit
 * checks, entitlement gate, priority slot, cache reads, the rerank
 * block's vector cache traffic, metering and learning writes).
 * The ledger now counts bound service calls through spendBinding()
 * at every execution site in this file's handler path and the lib
 * modules it calls, Workers AI legs cost 1 in the wave planner,
 * and the constants were re derived from the corrected totals.
 * Batch assumption, stated in search.js and mirrored by the stub
 * below: db.batch() is ONE subrequest (a single round trip to the
 * D1 service) however many statements it carries.
 *
 * What the correction adds here:
 *   5. spendBinding: bound service calls count against the same
 *      ledger, under their own stage labels, and retrievalRoom()
 *      answers for total spend, not fetch spend.
 *   6. Handler level with a COUNTING fake env: the D1 stub counts
 *      every statement execution (and each exec, and each batch as
 *      one call), the AI stub counts every run, a cache stub counts
 *      operations (the path uses none), and the stubs REFUSE any
 *      attempt past 50 with the runtime's own error, like the
 *      platform. Each scenario supplies its own ledger through the
 *      request context and asserts the ledger's final total equals
 *      the total platform attempts the stubs recorded — any missed
 *      call site anywhere in the handler path breaks the equality —
 *      and that on warm draws expansion and validation still fire
 *      and synthesis still gets funded legs.
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

await test("spendBinding counts bound service calls under their own labels", () => {
  const ledger = createSubrequestLedger();
  ledger.setStage("retrieval");
  ledger.spend();
  // A lib module spends under its functional label, in bulk.
  ledger.spendBinding("ratelimit", 4);
  ledger.spendBinding("queue", 3);
  // A null label attributes to the current pipeline stage.
  ledger.spendBinding(null, 2);
  assert.equal(ledger.used(), 10);
  assert.equal(ledger.remaining(), SUBREQUEST_LIMIT - 10);
  const snap = ledger.snapshot();
  assert.deepEqual(snap.byStage, { retrieval: 3, ratelimit: 4, queue: 3 });
  // Zero and negative spends are no-ops, never refunds.
  ledger.spendBinding("queue", 0);
  ledger.spendBinding("queue", -2);
  assert.equal(ledger.used(), 10);
});

await test("retrievalRoom answers for total spend, bindings included", () => {
  const ledger = createSubrequestLedger();
  // Spend the whole pre-retrieval fixed cost in bindings alone:
  // with fetch only counting this request would look untouched.
  ledger.spendBinding("ratelimit", 4);
  ledger.spendBinding("entitlement", 1);
  ledger.spendBinding("queue", 3);
  ledger.spendBinding("cache", 3);
  assert.equal(ledger.used(), 11);
  assert.equal(ledger.retrievalRoom(), true, "reserve still intact at fixed cost alone");
  // Bindings keep spending through retrieval (the rerank block):
  // once total spend reaches the reserve line, retrieval trims —
  // the exact behavior the fetch only count could not produce.
  ledger.spendBinding("rerank", SUBREQUEST_LIMIT - SUBREQUEST_ANSWER_RESERVE - 11);
  assert.equal(ledger.remaining(), SUBREQUEST_ANSWER_RESERVE);
  assert.equal(ledger.retrievalRoom(), false);
});

await test("the retention sweep charges every statement it executes", async () => {
  const { sweepExpiredData } = await import(join(root, "functions/lib/retention.js"));
  let executions = 0;
  const stmt = () => {
    const s = {
      bind: () => s,
      run: async () => { executions++; return { meta: { changes: 0 } }; },
    };
    return s;
  };
  const env = { DB: { prepare: () => stmt() } };
  const ledger = createSubrequestLedger();
  const before = ledger.used();
  await sweepExpiredData(env, ledger);
  // 12 statements in the sweep list (RAW_QUERY_PURGE unset), each
  // one a D1 execution: the stub's count and the ledger's must agree.
  assert.equal(executions, 12);
  assert.equal(ledger.used() - before, executions);
  assert.equal(ledger.snapshot().byStage.sweep, 12);
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
  // Round robin: or-1, groq-1, wai-1 (zero cost), then or-2 spends
  // the last unit; wai-2 and wai-3 cost nothing and still fire;
  // groq-2 and the remaining OpenRouter legs do not fit. (The
  // zero cost legs here pin the planner's contract for genuinely
  // free legs; production descriptors no longer cost Workers AI
  // legs at zero — see the next test.)
  assert.deepEqual(selected.map((d) => d.label), ["or-1", "or-2", "groq-1", "wai-1", "wai-2", "wai-3"]);
  assert.deepEqual(skipped.map((d) => d.label), ["or-3", "or-4", "groq-2"]);
});

await test("Workers AI legs costed at the platform truth (1) trim like fetch legs", () => {
  // The correction: a Workers AI run spends a subrequest exactly
  // like a fetch, so production wave descriptors carry fetchCost 1
  // for the workers-ai bucket. Under a tight allowance those legs
  // now trim breadth first instead of all firing "free" and dying
  // at the runtime cap.
  const descriptors = [
    leg("groq-1", "compat:groq", 1), leg("groq-2", "compat:groq", 1),
    leg("wai-1", "workers-ai", 1), leg("wai-2", "workers-ai", 1), leg("wai-3", "workers-ai", 1),
  ];
  const { selected, skipped } = planWaveLegs(descriptors, 2);
  assert.deepEqual(selected.map((d) => d.label), ["groq-1", "wai-1"]);
  assert.deepEqual(skipped.map((d) => d.label), ["groq-2", "wai-2", "wai-3"]);
  const plenty = planWaveLegs(descriptors, 50);
  assert.equal(plenty.selected.length, 5, "a plentiful allowance still fires every leg");
  assert.deepEqual(plenty.skipped, []);
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
group("handler level — the ledger's total is the platform's total");

// A COUNTING fake env driving the real onRequest. The fetch stub
// counts outbound calls; the D1 stub counts every statement
// execution (first/all/run), every exec as one call, and every
// batch as ONE call (the stated assumption); the AI stub counts
// every run; a cache stub counts operations (this handler path
// uses no Cache API, so it must stay at zero). Every stub refuses
// attempts past the 50 cap with the runtime's own error text, the
// way the platform does. Each scenario supplies its own ledger via
// the request context (data.ledger — the seam onRequest documents
// for exactly this) and the assertions compare the ledger's final
// total against the stubs' recorded attempts: if any call site in
// the handler path spends a platform call the ledger does not
// count, or counts one the platform does not make, the equality
// breaks and names both totals.
//
// Scenarios: the first rich run is a COLD isolate (every module
// level table ensure pays its DDL into this request, as the
// platform charges it); the rich and lean runs after it are warm.
// "rich" returns two papers per Europe PMC call and an empty
// PubMed; "lean" returns one paper per call and PubMed ids that
// cost three fetches per call for zero papers — the draw that
// spent past the cap before validation ever fired under fetch only
// counting. Math.random is pinned high for the scenario block so
// the probabilistic branches (the 1% retention sweep, the 1% rate
// limit prune) take their no-op side deterministically; the sweep's
// counting is pinned directly in the unit test above.
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

function makeCounts() {
  return { fetch: 0, d1: 0, ai: 0, cache: 0, attempts: 0, refused: 0 };
}
// One platform attempt. Past the cap the attempt still counts (the
// ledger charged it before firing) and the stub refuses it with
// the runtime's own wording, like the platform.
function attempt(counts, kind) {
  counts[kind]++;
  counts.attempts++;
  if (counts.attempts > SUBREQUEST_LIMIT) {
    counts.refused++;
    throw new Error("Too many subrequests by single Worker invocation");
  }
}
function countingDb(counts) {
  const st = () => {
    const s = {
      bind: () => s,
      first: async () => { attempt(counts, "d1"); return null; },
      all: async () => { attempt(counts, "d1"); return { results: [] }; },
      run: async () => { attempt(counts, "d1"); return { success: true, meta: { changes: 1 } }; },
    };
    return s;
  };
  return {
    prepare: () => st(),
    batch: async (arr) => { attempt(counts, "d1"); return (arr || []).map(() => ({ success: true })); },
    exec: async () => { attempt(counts, "d1"); return { results: [] }; },
  };
}
function countingAi(counts) {
  return {
    run: async (model, input) => {
      attempt(counts, "ai");
      if (model === "@cf/baai/bge-small-en-v1.5") {
        // The rerank's batched embedding call: one vector per text.
        const texts = (input && input.text) || [];
        return { data: texts.map((_, i) => [1, 0.01 * (i + 1), 0.5, 0.25]) };
      }
      const msgs = (input && input.messages) || [];
      const joined = msgs.map((m) => String(m.content || "")).join("\n");
      // The fact check's tier 1 returns unparseable text on purpose:
      // with no OpenRouter key configured, tier 2 is skipped and the
      // stage falls back to its zero network heuristic, at a cost of
      // exactly this one run.
      if (joined.includes("ANSWER TO FACT-CHECK:")) return { response: "not json" };
      return { response: SYNTH_ANSWER };
    },
  };
}

async function runScenario(mode) {
  const counts = makeCounts();
  let epmcCalls = 0;
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  globalThis.caches = {
    default: {
      match: async () => { counts.cache++; return undefined; },
      put: async () => { counts.cache++; },
      delete: async () => { counts.cache++; return false; },
    },
  };
  Math.random = () => 0.99;
  globalThis.fetch = async (url, opts = {}) => {
    attempt(counts, "fetch");
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
    const ledger = createSubrequestLedger();
    const env = {
      DB: countingDb(counts),
      AI: countingAi(counts),
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
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    // Let fire and forget work (the vector cache store, telemetry)
    // finish spending before the totals are compared: both sides of
    // the equality count the same events whenever they land.
    await new Promise((r) => setTimeout(r, 150));
    return { data, counts, ledger };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

function assertLedgerEqualsPlatform(counts, ledger) {
  const platform = counts.attempts + counts.cache;
  assert.equal(counts.cache, 0, "the handler path used the Cache API, which the ledger audit says it never does");
  assert.equal(ledger.used(), platform,
    `ledger counted ${ledger.used()} but the stubs recorded ${platform} platform attempts ` +
    `(fetch ${counts.fetch}, d1 ${counts.d1}, ai ${counts.ai}) — a call site is uncounted or double counted`);
  assert.ok(counts.attempts - counts.refused <= SUBREQUEST_LIMIT,
    "accepted platform calls exceeded the cap the ledger is sized against");
}

function assertAnswerStagesFunded(data, counts) {
  assert.ok(counts.fetch >= 15,
    `only ${counts.fetch} fetches: retrieval did not really run`);
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
  // Past cap attempts are bounded and confined to the post answer
  // tail (accounting writes and the record store, each individually
  // caught): the stages above were all funded inside the cap.
  assert.ok(counts.refused <= 5,
    `${counts.refused} attempts were refused past the cap; only a small post answer tail may overflow`);
}

await test("cold isolate: every cold DDL execution counts, and the draw degrades honestly", async () => {
  const { data, counts, ledger } = await runScenario("rich");
  assertLedgerEqualsPlatform(counts, ledger);
  // The cold request pays every ensure's DDL, so its budget is the
  // tightest of the three runs: expansion and validation still
  // fire, papers still ship, and if synthesis cannot be funded the
  // stage record names our budget — never a fake provider failure.
  assert.equal(data._expansion && data._expansion.via, "groq", "cold: expansion did not fire");
  const validation = (data.stageHealth || []).find((s) => s.name === "validation");
  assert.ok(validation && validation.ok, "cold: validation did not answer");
  assert.ok((data.sources || []).length >= 3, "cold: the draw should still ship its papers");
  const synthesis = (data.stageHealth || []).find((s) => s.name === "synthesis");
  assert.ok(synthesis, "cold: no synthesis stage record shipped");
  if (!synthesis.ok) {
    assert.equal(synthesis.skipReason, SUBREQUEST_EXHAUSTED_REASON,
      "cold: a starved synthesis must name the budget, not an outage");
  }
});

await test("rich retrieval (warm): expansion and validation fire, synthesis wins, ledger equals platform", async () => {
  const { data, counts, ledger } = await runScenario("rich");
  assertLedgerEqualsPlatform(counts, ledger);
  assertAnswerStagesFunded(data, counts);
  assert.ok((data.sources || []).length >= 8, "the rich scenario should ship its papers");
});

await test("lean retrieval (warm): rungs and fallbacks trim, synthesis still gets funded legs", async () => {
  const { data, counts, ledger } = await runScenario("lean");
  assertLedgerEqualsPlatform(counts, ledger);
  assertAnswerStagesFunded(data, counts);
  assert.ok((data.sources || []).length >= 3, "the lean scenario should still ship its papers");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
