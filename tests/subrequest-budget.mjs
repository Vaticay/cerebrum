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
 *   7. THE HARD ALLOWANCE (2026-10-14): pricing rounds at their
 *      start could not stop in-round multiplication (retries,
 *      multi call fetchers, the rerank's shelf scaled binding
 *      spend) from eating the reserve — the live black soldier fly
 *      draw still starved synthesis on the priced build. The
 *      retrieval PHASE now has a hard allowance (limit − answer
 *      reserve − tail reserve = 27) enforced at the ledger's grant
 *      points, cumulative across a request's gathers, with one
 *      exception: on an empty shelf the zero sources cascade's
 *      first fallback round fires anyway under a one round yield,
 *      because zero sources is worse than a spent budget. The
 *      greedy and empty shelf scenarios below pin both halves.
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
  SUBREQUEST_RAW_NET_COST,
  SUBREQUEST_NL_NET_COST,
  SUBREQUEST_RELAXED_NET_COST,
  SUBREQUEST_RETRIEVAL_ALLOWANCE,
  SUBREQUEST_VALIDATION_ALLOWANCE,
  SUBREQUEST_AUTHORIZE_COST,
  SUBREQUEST_SYNTHESIS_RACE_COST,
  classifyLegFailure,
  isSubrequestBudgetError,
  recordLegOutcome,
  legParkInfo,
  resetLegHealth,
  planDelayedRescue,
  llmValidatePapers,
  finalizeValidationHealth,
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
group("the retrieval phase allowance — a hard cap on the phase (2026-10-14)");

// The reserve gates price each retrieval ROUND before it starts,
// but a round's real cost lands after: fetchers retry, PubMed and
// Europe PMC multiply calls internally, and the rerank's binding
// spend scales with the shelf. The phase therefore gets a hard
// allowance enforced at the ledger's grant points: inside
// gatherPapers (the phase), grants that would push the phase past
// its allowance are refused with the budget error BEFORE the
// platform call is made, so the refused grant is never counted
// and the ledger's total stays equal to the platform's attempts.
await test("the allowance is derived in one place from the budget constants", () => {
  assert.equal(SUBREQUEST_RETRIEVAL_ALLOWANCE, 27,
    "allowance = 50 limit − 16 answer reserve − 7 tail reserve");
  assert.equal(SUBREQUEST_RETRIEVAL_ALLOWANCE,
    SUBREQUEST_LIMIT - SUBREQUEST_ANSWER_RESERVE - SUBREQUEST_TAIL_RESERVE);
  const ledger = createSubrequestLedger();
  assert.equal(ledger.retrievalAllowance(), SUBREQUEST_RETRIEVAL_ALLOWANCE);
  // A custom limit derives its ceiling by the same formula.
  assert.equal(createSubrequestLedger(120).retrievalAllowance(),
    120 - SUBREQUEST_ANSWER_RESERVE - SUBREQUEST_TAIL_RESERVE);
});

// CORRECTED CONTRACT (2026-10-14, stage allowances): the reserve
// keeps its total (16) and retrieval keeps its allowance (27),
// but the reserve is no longer a lump estimate — it is the sum
// of the named stage shares it must fund, the largest of them
// enforced as a hard phase allowance, and the whole budget
// closes line by line: retrieval allowance + validation
// allowance + authorize + synthesis race + tail reserve = the
// limit exactly, so no stage can spend another stage's share.
// The lump derivation priced validation at 4 and padded the
// rest with shares the tail also carried; the live probe on the
// hard capped build showed synthesis still starving behind a
// real validation draw, which is the defect this fixes.
await test("the budget arithmetic closes: every stage's share is a named constant", () => {
  assert.equal(SUBREQUEST_VALIDATION_ALLOWANCE, 5,
    "validation phase: two model legs + three first attempt Crossref checks");
  assert.equal(SUBREQUEST_AUTHORIZE_COST, 6,
    "authorize block: budget select + first insert + cold ensure + cache read + cache telemetry + routing read");
  assert.equal(SUBREQUEST_SYNTHESIS_RACE_COST, 5,
    "a synthesis race worth firing: one leg per live provider bucket, breadth first");
  assert.equal(SUBREQUEST_ANSWER_RESERVE,
    SUBREQUEST_VALIDATION_ALLOWANCE + SUBREQUEST_AUTHORIZE_COST + SUBREQUEST_SYNTHESIS_RACE_COST,
    "the reserve is exactly the shares it must fund after retrieval");
  assert.equal(
    SUBREQUEST_RETRIEVAL_ALLOWANCE + SUBREQUEST_VALIDATION_ALLOWANCE +
    SUBREQUEST_AUTHORIZE_COST + SUBREQUEST_SYNTHESIS_RACE_COST + SUBREQUEST_TAIL_RESERVE,
    SUBREQUEST_LIMIT,
    "retrieval + validation + authorize + synthesis + tail = the limit");
});

await test("outside the retrieval phase, grants are never refused by the ceiling", () => {
  const ledger = createSubrequestLedger();
  // Stage "other" (no gather running): spends count straight past
  // the allowance, exactly as before the cap existed.
  spendN(ledger, SUBREQUEST_RETRIEVAL_ALLOWANCE + 5);
  assert.equal(ledger.used(), SUBREQUEST_RETRIEVAL_ALLOWANCE + 5);
  assert.equal(ledger.retrievalSpent(), 0, "no phase, no phase spend");
  assert.equal(ledger.retrievalRefusals(), 0);
});

await test("inside the phase, grants stop at the allowance and refusals are not counted", () => {
  const ledger = createSubrequestLedger();
  ledger.beginRetrievalPhase();
  spendN(ledger, SUBREQUEST_RETRIEVAL_ALLOWANCE);
  assert.equal(ledger.retrievalSpent(), SUBREQUEST_RETRIEVAL_ALLOWANCE);
  assert.equal(ledger.used(), SUBREQUEST_RETRIEVAL_ALLOWANCE);
  // The next grant would cross the allowance: refused with the
  // budget error (the class legs already read as our own
  // exhaustion), and NOT counted — no platform attempt happened.
  assert.throws(() => ledger.spend(), /too many subrequests/i);
  assert.equal(ledger.used(), SUBREQUEST_RETRIEVAL_ALLOWANCE, "a refused grant must not count");
  assert.equal(ledger.retrievalSpent(), SUBREQUEST_RETRIEVAL_ALLOWANCE);
  assert.equal(ledger.retrievalRefusals(), 1);
  // A bulk binding grant that would cross is refused atomically:
  // no partial count.
  assert.throws(() => ledger.spendBinding("rerank", 2), /too many subrequests/i);
  assert.equal(ledger.used(), SUBREQUEST_RETRIEVAL_ALLOWANCE);
  assert.equal(ledger.retrievalRefusals(), 2);
  // A zero spend is a no-op, never a refusal (existing contract).
  ledger.spendBinding("rerank", 0);
  assert.equal(ledger.retrievalRefusals(), 2);
  ledger.endRetrievalPhase();
});

await test("the phase count is cumulative across gathers; the answer phase is not capped", () => {
  const ledger = createSubrequestLedger();
  ledger.beginRetrievalPhase();
  spendN(ledger, SUBREQUEST_RETRIEVAL_ALLOWANCE - 2);
  ledger.endRetrievalPhase();
  // A repeated gather (minimum results guarantee) inherits the
  // spent allowance instead of restarting it.
  ledger.beginRetrievalPhase();
  spendN(ledger, 2);
  assert.equal(ledger.retrievalSpent(), SUBREQUEST_RETRIEVAL_ALLOWANCE);
  assert.throws(() => ledger.spend(), /too many subrequests/i);
  ledger.endRetrievalPhase();
  // The answer stages spend against the overall limit and their
  // own guards, never against the retrieval ceiling.
  ledger.setStage("validation");
  spendN(ledger, 10);
  assert.equal(ledger.used(), SUBREQUEST_RETRIEVAL_ALLOWANCE + 10);
  assert.equal(ledger.retrievalSpent(), SUBREQUEST_RETRIEVAL_ALLOWANCE,
    "answer phase spends are not retrieval phase spends");
});

await test("retrievalRoom binds the phase allowance while the phase is active", () => {
  const ledger = createSubrequestLedger();
  ledger.beginRetrievalPhase();
  spendN(ledger, 20);
  // Reserve rule alone: remaining 30 > 16 + 8, the round may start.
  // Phase rule: 20 + 8 crosses the allowance of 27, it may not.
  assert.equal(ledger.retrievalRoom(8), false, "the phase ceiling must trim the round by name");
  assert.equal(ledger.retrievalRoom(5), true, "a round that fits the allowance still starts");
  assert.equal(ledger.retrievalRoom(0), true);
  ledger.endRetrievalPhase();
  // Phase closed: the same totals answer by the reserve rule only.
  assert.equal(ledger.retrievalRoom(8), true);
});

await test("the cascade yield lets grants past the ceiling, counted, until it closes", () => {
  const ledger = createSubrequestLedger();
  ledger.beginRetrievalPhase();
  spendN(ledger, SUBREQUEST_RETRIEVAL_ALLOWANCE);
  // At the ceiling exactly: a zero cost grant still fits, any real
  // grant crosses — which is what gatherPapers asks, with each
  // fallback round's priced cost as the margin.
  assert.equal(ledger.retrievalCapHit(0), false);
  assert.equal(ledger.retrievalCapHit(1), true);
  assert.equal(ledger.retrievalCapHit(5), true);
  ledger.setRetrievalYield(true);
  spendN(ledger, 4);
  assert.equal(ledger.retrievalSpent(), SUBREQUEST_RETRIEVAL_ALLOWANCE + 4,
    "yield grants are honored and still counted");
  assert.equal(ledger.retrievalRefusals(), 0, "a yield grant is not a refusal");
  ledger.setRetrievalYield(false);
  assert.throws(() => ledger.spend(), /too many subrequests/i);
  ledger.endRetrievalPhase();
  assert.equal(ledger.retrievalCapHit(0), false, "no phase, no cap");
});

await test("the snapshot carries the phase tally once the phase has spent", () => {
  const ledger = createSubrequestLedger();
  assert.deepEqual(Object.keys(ledger.snapshot()).sort(),
    ["byStage", "limit", "remaining", "used"],
    "a ledger that never gathered keeps the original snapshot shape");
  ledger.beginRetrievalPhase();
  spendN(ledger, 3);
  ledger.endRetrievalPhase();
  const snap = ledger.snapshot();
  assert.equal(snap.retrievalSpent, 3);
  assert.equal(snap.retrievalAllowance, SUBREQUEST_RETRIEVAL_ALLOWANCE);
  assert.equal(snap.retrievalRefused, 0);
});

// ═══════════════════════════════════════════════════════════════
group("the validation phase allowance — a hard cap on the stage (2026-10-14)");

// The live probe on the hard capped build (829397a): retrieval
// capped at its allowance, validation OK for the first time that
// evening, fact check OK — and synthesis STILL skipped
// "subrequest budget exhausted". The stages between gather and
// synthesis spent the lump reserve the old derivation had priced
// validation at 4 inside of. The validation block is advisory
// (papers ship without it), so it gets the retrieval cap's shape:
// a hard phase allowance enforced at the grant points. Spent
// allowance stops the block and the trim is recorded, instead of
// the block quietly eating synthesis's share.
await test("the validation allowance is the stage's own constant at any plan limit", () => {
  const ledger = createSubrequestLedger();
  assert.equal(ledger.validationAllowance(), SUBREQUEST_VALIDATION_ALLOWANCE);
  // The stage's cost does not grow with the plan limit.
  assert.equal(createSubrequestLedger(120).validationAllowance(), SUBREQUEST_VALIDATION_ALLOWANCE);
  // A cap below the allowance shrinks the ceiling to the cap.
  assert.equal(createSubrequestLedger(4).validationAllowance(), 4);
});

await test("outside the validation phase, grants are never refused by its ceiling", () => {
  const ledger = createSubrequestLedger();
  ledger.setStage("validation");
  spendN(ledger, SUBREQUEST_VALIDATION_ALLOWANCE + 5);
  assert.equal(ledger.used(), SUBREQUEST_VALIDATION_ALLOWANCE + 5);
  assert.equal(ledger.validationSpent(), 0, "no phase, no phase spend");
  assert.equal(ledger.validationRefusals(), 0);
  assert.equal(ledger.validationCapHit(1), false, "no phase, no cap");
});

await test("inside the phase, grants stop at the allowance and refusals are not counted", () => {
  const ledger = createSubrequestLedger();
  ledger.beginValidationPhase();
  spendN(ledger, SUBREQUEST_VALIDATION_ALLOWANCE);
  assert.equal(ledger.validationSpent(), SUBREQUEST_VALIDATION_ALLOWANCE);
  assert.equal(ledger.validationCapHit(0), false, "at the allowance exactly, a zero cost grant still fits");
  assert.equal(ledger.validationCapHit(1), true, "one more grant would cross the allowance");
  // Refused with the budget error (the class the failure
  // classifier reads as our own exhaustion), and NOT counted:
  // no platform attempt happened.
  assert.throws(() => ledger.spend(), /too many subrequests/i);
  assert.equal(ledger.used(), SUBREQUEST_VALIDATION_ALLOWANCE, "a refused grant must not count");
  assert.equal(ledger.validationSpent(), SUBREQUEST_VALIDATION_ALLOWANCE);
  assert.equal(ledger.validationRefusals(), 1);
  assert.throws(() => ledger.spendBinding("budget", 2), /too many subrequests/i);
  assert.equal(ledger.used(), SUBREQUEST_VALIDATION_ALLOWANCE);
  assert.equal(ledger.validationRefusals(), 2);
  ledger.endValidationPhase();
  // Phase closed: the stage spends against the overall limit again.
  ledger.spend();
  assert.equal(ledger.used(), SUBREQUEST_VALIDATION_ALLOWANCE + 1);
  assert.equal(ledger.validationCapHit(1), false, "no phase, no cap");
});

await test("the phase count is cumulative across blocks; other stages are not capped by it", () => {
  const ledger = createSubrequestLedger();
  ledger.beginValidationPhase();
  spendN(ledger, SUBREQUEST_VALIDATION_ALLOWANCE - 2);
  ledger.endValidationPhase();
  ledger.beginValidationPhase();
  spendN(ledger, 2);
  assert.equal(ledger.validationSpent(), SUBREQUEST_VALIDATION_ALLOWANCE);
  assert.throws(() => ledger.spend(), /too many subrequests/i);
  ledger.endValidationPhase();
  // Synthesis spends against the overall limit and its own floor,
  // never against the validation ceiling.
  ledger.setStage("synthesis");
  spendN(ledger, 10);
  assert.equal(ledger.used(), SUBREQUEST_VALIDATION_ALLOWANCE + 10);
  assert.equal(ledger.validationSpent(), SUBREQUEST_VALIDATION_ALLOWANCE,
    "synthesis spends are not validation phase spends");
});

await test("the snapshot carries the validation tally once the phase has spent", () => {
  const ledger = createSubrequestLedger();
  ledger.beginValidationPhase();
  spendN(ledger, 2);
  assert.throws(() => { spendN(ledger, SUBREQUEST_VALIDATION_ALLOWANCE); }, /too many subrequests/i);
  ledger.endValidationPhase();
  const snap = ledger.snapshot();
  assert.equal(snap.validationSpent, SUBREQUEST_VALIDATION_ALLOWANCE);
  assert.equal(snap.validationAllowance, SUBREQUEST_VALIDATION_ALLOWANCE);
  assert.equal(snap.validationRefused, 1);
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

// ═══════════════════════════════════════════════════════════════
group("fallback net pricing — the final nets pay their real cost (2026-10-14)");

// The first ledger gated the last three retrieval rounds (the raw
// query net, the natural language net, the relaxed boolean net) at
// margin 0: each could start whenever anything sat above the answer
// reserve and then spend INTO it, because each net's fetchers
// multiply internally on exactly the starved queries the nets exist
// for. Live trace (the sleep and colds question, corrected ledger
// build): the primary starved, every fallback round fired, the
// nets spent the reserve, and validation and synthesis both skipped
// as budget exhausted. The nets are now gated at their real cost:
// a net fires only when the remaining budget covers the net AND
// leaves the answer reserve intact afterward.
await test("the net prices are the fetchers' real internal fanout", () => {
  // europePMC fires up to 3 sequential formulations on an empty
  // result (given query, structured rebuild, organism form);
  // PubMed up to 5 calls (3 esearch formulations, efetch, esummary);
  // Semantic Scholar and OpenAlex cost 1 each.
  assert.equal(SUBREQUEST_RAW_NET_COST, 5, "raw net = europePMC 3 + semanticScholar 1 + openAlex 1");
  assert.equal(SUBREQUEST_NL_NET_COST, 5, "NL net = semanticScholar 1 + europePMC 3 + openAlex 1");
  assert.equal(SUBREQUEST_RELAXED_NET_COST, 8, "relaxed net = europePMC 3 + pubmed 5");
});

await test("a net may start only when the reserve survives it", () => {
  const ledger = createSubrequestLedger();
  // Spend down so exactly reserve + raw cost + 1 remains: the raw
  // net may start (after it, more than the reserve is left).
  spendN(ledger, SUBREQUEST_LIMIT - (SUBREQUEST_ANSWER_RESERVE + SUBREQUEST_RAW_NET_COST) - 1);
  assert.equal(ledger.retrievalRoom(SUBREQUEST_RAW_NET_COST), true);
  // The net spends its price: the reserve is intact, but a second
  // net no longer fits above it.
  spendN(ledger, SUBREQUEST_RAW_NET_COST);
  assert.equal(ledger.remaining(), SUBREQUEST_ANSWER_RESERVE + 1);
  assert.equal(ledger.retrievalRoom(SUBREQUEST_NL_NET_COST), false,
    "a second net would now spend into the reserve");
  assert.equal(ledger.retrievalRoom(SUBREQUEST_RELAXED_NET_COST), false);
  // At exactly reserve + cost, the strict inequality still refuses:
  // the reserve must remain intact AFTER the net, not just covered.
  const edge = createSubrequestLedger();
  spendN(edge, SUBREQUEST_LIMIT - (SUBREQUEST_ANSWER_RESERVE + SUBREQUEST_RAW_NET_COST));
  assert.equal(edge.remaining(), SUBREQUEST_ANSWER_RESERVE + SUBREQUEST_RAW_NET_COST);
  assert.equal(edge.retrievalRoom(SUBREQUEST_RAW_NET_COST), false);
});

// Starved primary: the ladder's engines answer a paper at a time
// (Europe PMC one per call, PubMed the lean three fetch no paper
// shape), totals stay under the nets' count thresholds, and every
// fallback round's count condition is met — so if a net does not
// fire, the budget gate is what stopped it. Before the pricing fix
// the nets fired here and spent the reserve; now they are priced
// out and the answer stages keep their funding.
async function runStarvedScenario() {
  const counts = makeCounts();
  counts.epmcVerbatim = 0;
  counts.s2Verbatim = 0;
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
        return chatRes(JSON.stringify([{ term: "germ", alternates: ["gut microbes", "microbiota", "microbial community"] }]));
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      }
      return chatRes(SYNTH_ANSWER);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      const qs = new URL(u).searchParams.get("query") || "";
      if (qs.includes(QUERY)) { counts.epmcVerbatim++; return jsonRes({ resultList: { result: [] } }); }
      epmcCalls++;
      return jsonRes({ resultList: { result: [{
        title: "Gut germs and infant growth patterns study " + epmcCalls,
        doi: "10.1000/starve" + epmcCalls,
        pubYear: "2024",
        citedByCount: 7,
        authorString: "Doe J, Roe K",
        journalTitle: "Journal of Infant Studies",
        abstractText: richAbstract(epmcCalls),
      }] } });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: ["101", "102", "103"] } });
      if (u.includes("esummary")) return jsonRes({ result: {} });
      return new Response("", { status: 200 });
    }
    if (u.includes("api.semanticscholar.org")) {
      const q = new URL(u).searchParams.get("query") || "";
      if (q === QUERY) counts.s2Verbatim++;
      return jsonRes({ data: [] });
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
    await new Promise((r) => setTimeout(r, 150));
    return { data, counts, ledger };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

await test("starved primary: the nets are priced out and the answer stages keep their funding", async () => {
  const { data, counts, ledger } = await runStarvedScenario();
  assertLedgerEqualsPlatform(counts, ledger);
  // Neither the raw net nor the natural language net ever fired:
  // no engine was ever called with the verbatim question. Their
  // count conditions were met (the ladder returned a paper at a
  // time), so the budget gate is the only thing that stopped them.
  assert.equal(counts.epmcVerbatim, 0, "a fallback net fired Europe PMC on the verbatim question");
  assert.equal(counts.s2Verbatim, 0, "a fallback net fired Semantic Scholar on the verbatim question");
  // And the stages the reserve exists for ran anyway.
  assertAnswerStagesFunded(data, counts);
  assert.ok((data.sources || []).length >= 3, "the starved scenario should still ship its papers");
});

// ═══════════════════════════════════════════════════════════════
group("the reserve funds what it protects — heavy draw (2026-10-14)");

// Dusty's own question on the corrected ledger build (7dfe2c8):
// "how does changing diets impact microbial community assembly in
// the black soldier fly larval gut" gathered about 74 papers across
// 15 databases with the full rerank block, returned extractive with
// validation skipped "subrequest budget exhausted" and EVERY
// synthesis leg refused with "subrequest budget reserved for
// synthesis" — the ledger's own guard refusing the stage the
// reserve exists for. The reserve was a gate time estimate, not a
// reservation: rung costs overshoot their estimate when every
// engine answers and the multi call fetchers multiply, the rerank
// block spent after the last trim check with no ledger gate at
// all, and fireWaveLegs then subtracted the tail reserve a second
// time from the synthesis race's own allowance, selecting zero
// legs whenever what remained was at or under the tail.
// This scenario reproduces the shape: Europe PMC answers only on
// its second formulation (two fetches per call site) with four
// papers a call, PubMed pays the lean three fetches per call, and
// the shelf is big enough for the full rerank block. On the
// unfixed code the synthesis stage is refused by the reserve
// reason; on the fixed code validation runs and the race fires.
const HEAVY_Q = "how does changing diets impact microbial community assembly in the black soldier fly larval gut";
const heavyAbstract = (n) =>
  ("Study " + n + " on diet and the gut microbial community of black soldier fly larvae, Hermetia illucens. " +
   "Larvae were reared on different diets and the larval gut microbiota and microbial community assembly were measured. " +
   "Diet strongly shaped the gut microbial community of the larvae across treatments. ").repeat(2);

async function runHeavyScenario() {
  const counts = makeCounts();
  // Stage boundary marks on the scenario's own ledger: the used
  // count and the provider call counts (fetches + AI runs) at the
  // moment each pipeline stage starts. The synthesis stage's leg
  // breadth is not shipped in the response, but it is exactly the
  // provider calls made between the synthesis mark and the fact
  // check mark — which is what the heavy test asserts on.
  const marks = [];
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
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("openrouter.ai")) {
      if (body.includes("literature search specialist")) {
        return chatRes(JSON.stringify([{ term: "microbial", alternates: ["microbiota", "microbiome", "gut microbes"] }]));
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      }
      return chatRes(SYNTH_ANSWER);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      epmcCalls++;
      // Odd calls are a call site's first formulation (empty, so the
      // fetcher pays its internal structured retry); even calls are
      // the retry answering with four papers.
      if (epmcCalls % 2 === 1) return jsonRes({ resultList: { result: [] } });
      const mk = (n) => ({
        title: "Diet and gut microbial community assembly in black soldier fly larvae study " + n,
        doi: "10.1000/heavy" + n,
        pubYear: "2024",
        citedByCount: 7,
        authorString: "Doe J, Roe K",
        journalTitle: "Journal of Insect Studies",
        abstractText: heavyAbstract(n),
      });
      return jsonRes({ resultList: { result: [mk(epmcCalls * 10 + 1), mk(epmcCalls * 10 + 2), mk(epmcCalls * 10 + 3), mk(epmcCalls * 10 + 4)] } });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: ["101", "102", "103", "104", "105"] } });
      if (u.includes("esummary")) return jsonRes({ result: {} });
      return new Response("", { status: 200 });
    }
    if (u.includes("export.arxiv.org")) return new Response("", { status: 200 });
    return jsonRes({});
  };
  try {
    const ledger = createSubrequestLedger();
    const origSetStage = ledger.setStage.bind(ledger);
    ledger.setStage = (name) => {
      marks.push({ name, used: ledger.used(), providerCalls: counts.fetch + counts.ai });
      origSetStage(name);
    };
    const env = {
      DB: countingDb(counts),
      AI: countingAi(counts),
      GROQ_KEY: "ledger-test-groq-key-123456",
      GEMINI_KEY: "ledger-test-gemini-key-123456",
      MISTRAL_KEY: "ledger-test-mistral-key-123456",
      NVIDIA_KEY: "ledger-test-nvidia-key-123456",
      // Production carries an OpenRouter key: the expansion,
      // validation and synthesis stages all try that leg first,
      // which is part of the live draw's spend.
      OPENROUTER_KEY: "ledger-test-openrouter-key-123456",
    };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: HEAVY_Q }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return { data, counts, ledger, marks };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

await test("heavy draw, full rerank: validation runs and the synthesis race fires its legs", async () => {
  const { data, counts, ledger, marks } = await runHeavyScenario();
  assertLedgerEqualsPlatform(counts, ledger);
  // The draw really was heavy: a full shelf shipped.
  assert.ok((data.sources || []).length >= 8,
    `heavy scenario shipped only ${(data.sources || []).length} sources`);
  // Validation ran on a real leg.
  const validation = (data.stageHealth || []).find((s) => s.name === "validation");
  assert.ok(validation, "no validation stage record shipped");
  assert.equal(validation.ok, true, "validation did not run on the heavy draw");
  assert.ok(typeof validation.via === "string" && validation.via.length > 0,
    "validation answered on no leg");
  // The synthesis race fired real legs from the primary waves.
  // Measured on the scenario ledger's stage marks: the provider
  // calls (fetches + AI runs) between the synthesis stage's start
  // and the post stage's start are the waves' legs (plus the
  // rescue's, when the waves never fired). On the unfixed code
  // this draw reached synthesis with 5 subrequests left: the wave
  // planner's allowance (what remains minus the tail reserve,
  // again) was zero, waves 1 to 3 selected no legs at all, every
  // leg was stamped with the reserve reason, and only the spend
  // to zero rescue fired — 2 provider calls in the window and an
  // extractive answer. With the floor, the primary race fires:
  // the fastpath leg plus its wave companions, bounded by the 6
  // subrequests this draw has left and by early victory (a wave 1
  // winner ends the race by design). 3 separates the two shapes
  // with room on both sides: the broken draw shows exactly 2
  // (rescue only), the fixed draw shows 4.
  const synthMark = marks.find((m) => m.name === "synthesis");
  const afterMark = marks.find((m) => (m.name === "fact-check" || m.name === "post") && synthMark && m.used >= synthMark.used);
  assert.ok(synthMark && afterMark, "stage marks missing: " + JSON.stringify(marks.map((m) => m.name)));
  const waveProviderCalls = afterMark.providerCalls - synthMark.providerCalls;
  assert.ok(waveProviderCalls >= 3,
    `the synthesis race fired only ${waveProviderCalls} provider calls on the heavy draw ` +
    "(the unfixed planner selected zero wave legs; only the rescue's 2 fired)");
  const synthesis = (data.stageHealth || []).find((s) => s.name === "synthesis");
  assert.ok(synthesis, "no synthesis stage record shipped");
  assert.equal(synthesis.ok, true, "synthesis did not fire on the heavy draw");
  assert.ok(synthesis.winner, "synthesis record has no winner");
  assert.equal(data.synthesisMode, "ai", "the extractive tier served instead of a synthesis win");
  assert.ok(counts.refused <= 5,
    `${counts.refused} attempts were refused past the cap; only a small post answer tail may overflow`);
});

// ═══════════════════════════════════════════════════════════════
group("natural language net ranking — concept coverage before term frequency (2026-10-14)");

// The NL net answers with the engines' own matching over the raw
// question, filler words included, so its shelf can be topped by a
// paper that matches surface words heavily while engaging fewer
// of the question's concepts than another paper on the same
// shelf. The net's papers now rank by concept group coverage
// (paperConceptGroupHits over the merged retrieval groups) ahead
// of raw score. Fixture: the short yogurt question. The curated
// table resolves two groups (microbe via germs, gut via belly)
// and the expansion stub adds a third (yogurt) — the ranking
// resolution merges all three, while the handler's topic filter
// (gateConceptGroups) judges on the two curated groups alone and
// requires two touches to ship at all, so a zero coverage paper
// is filtered as off topic by design (the shelf staying honest,
// not a ranking failure). The competition is therefore between
// the NL net's own papers: a surface heavy paper covering the two
// curated groups with a large raw score (citation bait, phrase
// repetition) but NOT the expansion group, and a full coverage
// paper covering all three groups with a modest raw score. The
// full coverage paper must ship ahead of the surface paper.
// The scenario runs on a larger ledger limit on purpose: the
// ranking machinery is what is under test, and at the production
// limit this harness's fresh database pre stages (~25 spends)
// plus three ladder rungs and the concept round (~55 more) leave
// the NL gate no room on any question — the nets sit last in the
// gather order by design (the budget behavior itself is pinned at
// the real limit by the scenarios above). The counting stub
// enforces the same limit the ledger carries, so the equality
// assertion still holds.
const NL_Q = "does eating yogurt change belly germs";
const NL_LIMIT = 120;
const NL_LADDER = {
  title: "The infant belly and its germs in the first year of life",
  doi: "10.1000/nlladder", pubYear: "2023", citedByCount: 9,
  authorString: "Eee F", journalTitle: "Journal of Infant Studies",
  abstractText: "The belly of infants was examined across the first year. Belly size, belly growth, and the germs present were recorded for each infant in the cohort while eating patterns were logged, and the germs in the belly were counted again at six months.",
};
const NL_SURFACE = {
  title: "Belly germs in daily life: the germs and belly health you carry",
  doi: "10.1000/nlsurface", pubYear: "2024", citedByCount: 80,
  authorString: "Aaa B", journalTitle: "Journal of Daily Studies",
  abstractText: "Belly germs are part of daily life. The germs in your belly and the belly germs you carry were counted again and again. Germs and belly, belly and germs: a survey of germs, belly health, and the daily germs of the belly.",
};
const NL_FULLCOV = {
  title: "Yogurt, gut germs and the infant belly",
  doi: "10.1000/nlfull", pubYear: "2024", citedByCount: 5,
  authorString: "Ccc D", journalTitle: "Journal of Gut Studies",
  abstractText: "Infants fed yogurt were sampled over six weeks. The germs in the belly and the gut germs were counted, and yogurt intake was tracked daily.",
};

async function runNlRankScenario() {
  const counts = { fetch: 0, d1: 0, ai: 0, attempts: 0, refused: 0, epmcVerbatim: 0, s2Verbatim: 0 };
  const attemptNl = (kind) => {
    counts[kind]++;
    counts.attempts++;
    if (counts.attempts > NL_LIMIT) {
      counts.refused++;
      throw new Error("Too many subrequests by single Worker invocation");
    }
  };
  const countingDbNl = () => {
    const st = () => {
      const s = {
        bind: () => s,
        first: async () => { attemptNl("d1"); return null; },
        all: async () => { attemptNl("d1"); return { results: [] }; },
        run: async () => { attemptNl("d1"); return { success: true, meta: { changes: 1 } }; },
      };
      return s;
    };
    return {
      prepare: () => st(),
      batch: async (arr) => { attemptNl("d1"); return (arr || []).map(() => ({ success: true })); },
      exec: async () => { attemptNl("d1"); return { results: [] }; },
    };
  };
  const aiStub = {
    run: async (model, input) => {
      attemptNl("ai");
      if (model === "@cf/baai/bge-small-en-v1.5") {
        const texts = (input && input.text) || [];
        return { data: texts.map((_, i) => [1, 0.01 * (i + 1), 0.5, 0.25]) };
      }
      const msgs = (input && input.messages) || [];
      const joined = msgs.map((m) => String(m.content || "")).join("\n");
      if (joined.includes("ANSWER TO FACT-CHECK:")) return { response: "not json" };
      return { response: SYNTH_ANSWER };
    },
  };
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  globalThis.caches = {
    default: {
      match: async () => undefined,
      put: async () => {},
      delete: async () => false,
    },
  };
  Math.random = () => 0.99;
  globalThis.fetch = async (url, opts = {}) => {
    attemptNl("fetch");
    const u = String(url);
    const body = typeof opts.body === "string" ? opts.body : "";
    if (u.includes("api.groq.com") || u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com")) {
      if (body.includes("literature search specialist")) {
        // The expansion group the ranking resolution merges in:
        // the gate resolution (two curated groups already) does
        // not use it, which is the wedge this fixture stands on.
        return chatRes(JSON.stringify([{ term: "yogurt", alternates: ["yogurt drink", "yogurt culture", "greek yogurt"] }]));
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      }
      return chatRes(SYNTH_ANSWER);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      const qs = new URL(u).searchParams.get("query") || "";
      if (qs.includes(NL_Q)) {
        counts.epmcVerbatim++;
        // The natural language net is the verbatim caller (the raw
        // net asks with the cleaned query, not the question): its
        // call returns the surface paper ahead of the full coverage
        // paper. Later verbatim callers (a retry gather, the
        // evidence cascade) get nothing, so the competition exists
        // exactly once, inside the NL net's own shelf.
        if (counts.epmcVerbatim === 1) return jsonRes({ resultList: { result: [NL_SURFACE, NL_FULLCOV] } });
        return jsonRes({ resultList: { result: [] } });
      }
      // Only the ladder's boolean answers, with the one ladder
      // paper, and only the first time it is asked: the nets judge
      // the draw by gathered counts, and every retrieval round
      // re-issues the boolean, so a stub that answers it every
      // time inflates the count past the nets' thresholds and they
      // are never reached. The shipped boolean for this question
      // opens with the gut group's rung.
      if (qs.startsWith("((belly OR gut") && !counts.boolAnswered) {
        counts.boolAnswered = 1;
        return jsonRes({ resultList: { result: [NL_LADDER] } });
      }
      return jsonRes({ resultList: { result: [] } });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: [] } });
      if (u.includes("esummary")) return jsonRes({ result: {} });
      return new Response("", { status: 200 });
    }
    if (u.includes("api.semanticscholar.org")) {
      const q = new URL(u).searchParams.get("query") || "";
      if (q === NL_Q) counts.s2Verbatim++;
      return jsonRes({ data: [] });
    }
    if (u.includes("export.arxiv.org")) return new Response("", { status: 200 });
    return jsonRes({});
  };
  try {
    const ledger = createSubrequestLedger(NL_LIMIT);
    const env = {
      DB: countingDbNl(),
      AI: aiStub,
      GROQ_KEY: "ledger-test-groq-key-123456",
      GEMINI_KEY: "ledger-test-gemini-key-123456",
      MISTRAL_KEY: "ledger-test-mistral-key-123456",
      NVIDIA_KEY: "ledger-test-nvidia-key-123456",
    };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: NL_Q }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return { data, counts, ledger };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

await test("NL net: full concept coverage ranks ahead of the surface match", async () => {
  const { data, counts, ledger } = await runNlRankScenario();
  assert.equal(ledger.used(), counts.attempts,
    `ledger counted ${ledger.used()} but the stubs recorded ${counts.attempts} platform attempts`);
  // The natural language net demonstrably fired: Europe PMC saw
  // the verbatim question (only the NL net asks it verbatim; the
  // raw net asks with the cleaned query).
  assert.ok(counts.epmcVerbatim >= 1,
    `the NL net never fired (verbatim Europe PMC calls: ${counts.epmcVerbatim})`);
  const titles = (data.sources || []).map((s) => s.title || "");
  const surfaceIdx = titles.findIndex((t) => t.includes("Belly germs in daily life"));
  const fullIdx = titles.findIndex((t) => t.includes("Yogurt, gut germs and the infant belly"));
  assert.ok(surfaceIdx >= 0, "the surface paper did not ship at all: " + JSON.stringify(titles));
  assert.ok(fullIdx >= 0, "the full coverage paper did not ship at all: " + JSON.stringify(titles));
  assert.ok(fullIdx < surfaceIdx,
    `the full coverage paper must rank ahead of the surface match (full coverage at ${fullIdx}, surface at ${surfaceIdx})`);
});

// ═══════════════════════════════════════════════════════════════
group("the hard retrieval allowance, handler level (2026-10-14)");

// GREEDY DRAW: the fetchers multiply like the real ones — Europe
// PMC pays two empty formulations before answering, PubMed pays
// its five call worst case, every other engine answers its call — the
// shelf is deep (30 papers from one Europe PMC call), and the
// rerank block spends its full binding cost against the shelf
// (budget check, vector cache read, the batched embedding call,
// neuron spend, the cache store, telemetry). Before the hard
// allowance, this shape spent the phase's whole draw plus the
// answer stages' share: the rerank and the late rounds ate what
// the reserve was holding. Now the phase must end at or under
// SUBREQUEST_RETRIEVAL_ALLOWANCE, with refusals recorded on the
// ledger, and validation and synthesis must still run funded.
async function runGreedyScenario() {
  const counts = makeCounts();
  const marks = [];
  let epmcCalls = 0;
  let esearchCalls = 0;
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
        return chatRes(JSON.stringify([{ term: "microbial", alternates: ["microbiota", "microbiome", "gut microbes"] }]));
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      }
      return chatRes(SYNTH_ANSWER);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      epmcCalls++;
      // Two formulations empty (the fetcher pays both internal
      // retries), the third answers with the deep shelf.
      if (epmcCalls !== 3) return jsonRes({ resultList: { result: [] } });
      const rows = [];
      for (let n = 1; n <= 30; n++) {
        rows.push({
          title: "Diet and gut microbial community assembly in black soldier fly larvae study " + n,
          doi: "10.1000/greedy" + n,
          pubYear: "2024",
          citedByCount: 7,
          authorString: "Doe J, Roe K",
          journalTitle: "Journal of Insect Studies",
          abstractText: heavyAbstract(n),
        });
      }
      return jsonRes({ resultList: { result: rows } });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) {
        esearchCalls++;
        // PubMed pays its multi formulation shape too: two
        // esearch formulations miss before the third returns ids,
        // then efetch and esummary follow (five calls, no papers
        // the summary shape yields).
        return jsonRes({ esearchresult: { idlist: esearchCalls >= 3 ? ["101", "102", "103", "104", "105"] : [] } });
      }
      if (u.includes("esummary")) return jsonRes({ result: {} });
      return new Response("", { status: 200 });
    }
    if (u.includes("export.arxiv.org")) return new Response("", { status: 200 });
    return jsonRes({});
  };
  try {
    const ledger = createSubrequestLedger();
    const origSetStage = ledger.setStage.bind(ledger);
    ledger.setStage = (name) => {
      marks.push({ name, used: ledger.used(), retrievalSpent: ledger.retrievalSpent() });
      origSetStage(name);
    };
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
      body: JSON.stringify({ query: HEAVY_Q }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return { data, counts, ledger, marks };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

await test("greedy draw: the phase ends at or under its allowance, the answer stages run funded", async () => {
  const { data, counts, ledger, marks } = await runGreedyScenario();
  assertLedgerEqualsPlatform(counts, ledger);
  // The draw really was greedy: the phase spent most of its
  // allowance (the ladder's fanout plus the full rerank)…
  assert.ok(ledger.retrievalSpent() >= 20,
    `the greedy draw spent only ${ledger.retrievalSpent()} in the retrieval phase`);
  // …but never past it, and the ceiling actually refused grants
  // (the rerank's tail spend is where a deep shelf bleeds first).
  assert.ok(ledger.retrievalSpent() <= SUBREQUEST_RETRIEVAL_ALLOWANCE,
    `retrieval phase spent ${ledger.retrievalSpent()} past its allowance ${SUBREQUEST_RETRIEVAL_ALLOWANCE}`);
  assert.ok(ledger.retrievalRefusals() >= 1,
    "the ceiling never refused a grant on the greedy draw");
  // By the time the pipeline left retrieval, the phase tally was
  // already inside the allowance.
  const validationMark = marks.find((m) => m.name === "validation");
  assert.ok(validationMark, "no validation stage mark recorded");
  assert.ok(validationMark.retrievalSpent <= SUBREQUEST_RETRIEVAL_ALLOWANCE,
    `phase tally at validation was ${validationMark.retrievalSpent}`);
  // And the stages the budget exists for ran: expansion,
  // validation, and a winning synthesis (the shared funded
  // assertions), over a real shelf.
  assertAnswerStagesFunded(data, counts);
  assert.ok((data.sources || []).length >= 8,
    `greedy scenario shipped only ${(data.sources || []).length} sources`);
});

// GREEDY VALIDATION (2026-10-14, stage allowances): a deep draw
// in the greedy family (multi formulation payments, the full
// rerank against a 30 paper shelf) with the validation block
// itself ALSO greedy: the production shape on the night
// synthesis starved. The OpenRouter key is present so BOTH
// validation legs fire (the first leg fails, the Groq leg
// answers), and every one of the top 8 cited papers carries a
// DOI URL, so the retraction round is offered a check per paper
// and each check would fail its first attempt with a 503 the
// fetcher retries once: the block is offered 2 legs + 8 papers
// × 2 attempts = 18 subrequests against an allowance of 5 (and
// against the old lump reserve's 4 priced for the whole block).
// On this draw the block's tighter price (the answer reserve)
// cuts the retraction round to zero before the phase ceiling
// is reached — the sacrifice order the block has always had —
// and the phase ceiling is the cap that binds on roomier draws
// (pinned at unit level in the phase group above and the
// llmValidatePapers phase tests below). What this scenario
// pins end to end: the block stays inside its allowance, its
// core leg still answers, the cut round is recorded as a trim
// on the stage record instead of passing as fully run, and
// synthesis still wins an AI answer, funded from what the
// capped block left behind.
async function runGreedyValidationScenario() {
  const counts = makeCounts();
  const marks = [];
  let epmcCalls = 0;
  let esearchCalls = 0;
  const crossrefFirstAttempt = new Set();
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
    if (u.includes("openrouter.ai")) {
      // The first validation leg fails outright (the leg failure
      // shape), so the Groq leg must fire and answer.
      if (body.includes("relevance validator")) {
        return new Response("overloaded", { status: 500 });
      }
      return jsonRes({});
    }
    if (u.includes("api.groq.com") || u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com")) {
      if (body.includes("literature search specialist")) {
        return chatRes(JSON.stringify([{ term: "microbial", alternates: ["microbiota", "microbiome", "gut microbes"] }]));
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      }
      return chatRes(SYNTH_ANSWER);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      epmcCalls++;
      // One formulation empty (the fetcher pays its internal
      // retries), the second answers with the deep shelf. The
      // draw stays greedy — multi formulation payments, the full
      // rerank against a 30 paper shelf — but lands in the
      // window the live starvation came from: the answer reserve
      // still intact when the validation block starts, so the
      // old per round prices alone would let the block spend.
      if (epmcCalls !== 2) return jsonRes({ resultList: { result: [] } });
      const rows = [];
      for (let n = 1; n <= 30; n++) {
        rows.push({
          title: "Diet and gut microbial community assembly in black soldier fly larvae study " + n,
          doi: "10.1000/greedy" + n,
          pubYear: "2024",
          citedByCount: 7,
          authorString: "Doe J, Roe K",
          journalTitle: "Journal of Insect Studies",
          abstractText: heavyAbstract(n),
        });
      }
      return jsonRes({ resultList: { result: rows } });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) {
        esearchCalls++;
        // PubMed pays its multi formulation shape too: one
        // esearch formulation misses before the second returns
        // ids, then efetch and esummary follow (no papers the
        // summary shape yields).
        return jsonRes({ esearchresult: { idlist: esearchCalls >= 2 ? ["101", "102", "103", "104", "105"] : [] } });
      }
      if (u.includes("esummary")) return jsonRes({ result: {} });
      return new Response("", { status: 200 });
    }
    // The retraction round's shape: every DOI's first Crossref
    // attempt 503s (the fetcher retries once, at the real
    // retry cost), the retry answers with nothing flagged.
    if (u.includes("api.crossref.org/works/10.1000")) {
      if (!crossrefFirstAttempt.has(u)) {
        crossrefFirstAttempt.add(u);
        return new Response("busy", { status: 503 });
      }
      return jsonRes({});
    }
    if (u.includes("export.arxiv.org")) return new Response("", { status: 200 });
    return jsonRes({});
  };
  try {
    const ledger = createSubrequestLedger();
    const origSetStage = ledger.setStage.bind(ledger);
    ledger.setStage = (name) => {
      marks.push({ name, used: ledger.used(), retrievalSpent: ledger.retrievalSpent() });
      origSetStage(name);
    };
    const env = {
      DB: countingDb(counts),
      AI: countingAi(counts),
      GROQ_KEY: "ledger-test-groq-key-123456",
      GEMINI_KEY: "ledger-test-gemini-key-123456",
      MISTRAL_KEY: "ledger-test-mistral-key-123456",
      NVIDIA_KEY: "ledger-test-nvidia-key-123456",
      OPENROUTER_KEY: "ledger-test-openrouter-key-123456",
    };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: HEAVY_Q }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return { data, counts, ledger, marks };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

await test("greedy validation: the block stays inside its allowance, the trim is recorded, synthesis answers", async () => {
  const { data, counts, ledger, marks } = await runGreedyValidationScenario();
  assertLedgerEqualsPlatform(counts, ledger);
  // The block was offered far more than its allowance (two
  // validation legs plus eight per paper retraction checks with
  // retries, 18 in all). Both of its caps held it inside the
  // allowance: the phase tally counts exactly the two model
  // legs, and the retraction round — offered eight DOI papers —
  // was cut to none by the tighter of its two prices on this
  // draw. (The phase ceiling's own refusal behavior is pinned
  // at unit level in the validation phase group above and in
  // the llmValidatePapers phase tests below: on this full
  // pipeline draw the reserve price binds first, which is the
  // sacrifice order the block has always had.)
  assert.equal(ledger.validationSpent(), 2,
    `validation phase spent ${ledger.validationSpent()}, not just its two model legs`);
  assert.ok(ledger.validationSpent() <= SUBREQUEST_VALIDATION_ALLOWANCE,
    "the validation block spent past its phase allowance");
  // The phase tally shows in the snapshot once the phase has
  // spent, like retrieval's.
  const snap = ledger.snapshot();
  assert.equal(snap.validationSpent, 2);
  assert.equal(snap.validationAllowance, SUBREQUEST_VALIDATION_ALLOWANCE);
  // The block still did its core job: the first leg failed, the
  // Groq leg answered, and the stage record names the leg AND
  // the trim honestly — ok true, via groq, trimmed (the
  // retraction round was offered checks it never ran).
  const validation = (data.stageHealth || []).find((s) => s.name === "validation");
  assert.ok(validation, "no validation stage record shipped");
  assert.equal(validation.ok, true, "validation stage not ok");
  assert.equal(validation.via, "groq", "validation did not answer on its Groq leg");
  assert.equal(validation.trimmed, true,
    "the retraction round was cut without the trim reaching the stage record");
  // And the answer stages synthesis exists for still ran funded:
  // a winning synthesis, an AI answer, a real shelf.
  assertAnswerStagesFunded(data, counts);
  assert.ok((data.sources || []).length >= 8,
    `greedy validation scenario shipped only ${(data.sources || []).length} sources`);
});

// The phase ceiling binding the model legs themselves, at unit
// level (the full pipeline draw above never reaches it: the
// reserve price binds the retraction round first, and the legs
// are only two). The validator's papers are worded to pass the
// programmatic passes so PASS 2 is the only thing that can stop.
const VAL_PAPERS = [1, 2, 3].map((n) => ({
  title: "Gut microbiome and infant growth study " + n,
  abstract: "The gut microbiome in early infancy shapes infant growth, microbial colonization, and weight gain trajectories.",
  journal: "Journal of Infant Studies",
  year: 2024,
  url: "https://doi.org/10.1000/val" + n,
}));

await test("in phase, a spent allowance keeps PASS 2 from firing, and the diag names the trim", async () => {
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; return new Response("{}", { status: 200 }); };
  try {
    const ledger = createSubrequestLedger();
    ledger.beginValidationPhase();
    spendN(ledger, SUBREQUEST_VALIDATION_ALLOWANCE);
    const diag = { llmValidatedVia: null };
    const out = await llmValidatePapers("gut microbiome infant growth",
      VAL_PAPERS.map((p) => ({ ...p })), "or-token", undefined, { GROQ_KEY: "g" }, diag, undefined, ledger);
    ledger.endValidationPhase();
    assert.equal(fetches, 0, "PASS 2 fired a leg with its allowance spent");
    assert.equal(out.length, 3, "the programmatic survivors were not returned");
    assert.equal(diag.llmBudgetSkipped, true);
    assert.equal(diag.validationTrimmed, true);
    // The finalized record: not ok, the budget named as the
    // reason, and the trim carried — never "no leg answered".
    const rec = finalizeValidationHealth({ name: "validation", ok: true, ms: 1 }, diag);
    assert.equal(rec.ok, false);
    assert.equal(rec.skipReason, SUBREQUEST_EXHAUSTED_REASON);
    assert.equal(rec.trimmed, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("in phase, the allowance running out mid loop refuses the second leg and names the budget", async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return new Response("overloaded", { status: 500 });
  };
  try {
    const ledger = createSubrequestLedger();
    ledger.beginValidationPhase();
    spendN(ledger, SUBREQUEST_VALIDATION_ALLOWANCE - 1);
    const diag = { llmValidatedVia: null };
    const out = await llmValidatePapers("gut microbiome infant growth",
      VAL_PAPERS.map((p) => ({ ...p })), "or-token", undefined, { GROQ_KEY: "g" }, diag, undefined, ledger);
    ledger.endValidationPhase();
    // The first leg fired and failed on the provider; the second
    // was never fired — the phase check refused it. Exactly one
    // fetch, the phase tally at its allowance.
    assert.equal(seen.length, 1, `expected exactly one fired leg, saw ${seen.length}`);
    assert.ok(seen[0].includes("openrouter.ai"), "the fired leg was not the first (OpenRouter) leg");
    assert.equal(ledger.validationSpent(), SUBREQUEST_VALIDATION_ALLOWANCE);
    assert.equal(out.length, 3, "the programmatic survivors were not returned");
    assert.equal(diag.llmValidatedVia, null);
    assert.equal(diag.llmBudgetSkipped, true,
      "the diag would read the phase refusal as a provider outage");
    assert.equal(diag.validationTrimmed, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// EMPTY SHELF: every engine answers nothing to the ladder —
// Europe PMC pays its formulation chain per call, PubMed pays
// its five call worst case, and nine engines each pay a 503
// retry — so the ladder's rungs burn the phase to its ceiling
// (the second rung's tail is refused mid flight) with the shelf
// still empty, and the raw net's price no longer fits. The one
// thing worse than a spent budget is zero sources: the cascade
// yield must let the raw net fire anyway (Europe PMC answers
// its call with the scenario's only two papers), spending
// counted grants past the allowance to do it.
async function runEmptyShelfScenario() {
  const counts = makeCounts();
  let epmcFetches = 0;
  let esearchCalls = 0;
  let crossrefCalls = 0;
  let arxivCalls = 0;
  const retriedHosts = new Set();
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
        return chatRes(JSON.stringify([{ term: "microbial", alternates: ["microbiota", "microbiome", "gut microbes"] }]));
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      }
      return chatRes(SYNTH_ANSWER);
    }
    // Retry pressure, the real fetchers' shape: the scholarly
    // engines below each refuse their first fetch with a 503 the
    // JSON helper retries once, so every one of them pays two
    // fetches for its empty answer. Together with Europe PMC's
    // three formulations and PubMed's five calls, the ladder
    // alone burns the phase to its ceiling before the cascade's
    // first net is priced.
    const retryHosts = ["api.semanticscholar.org", "api.openalex.org", "doaj.org",
      "api.plos.org", "api.core.ac.uk", "api.base-search.net", "api.openaire.eu"];
    const host = retryHosts.find((h) => u.includes(h));
    if (host && !retriedHosts.has(host)) {
      retriedHosts.add(host);
      return new Response("busy", { status: 503 });
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      epmcFetches++;
      // Only ONE call site in the whole pipeline asks this way:
      // the fallback cascade's raw net, which prefixes the
      // organism's binomial to the cleaned question and asks the
      // resulting stemmed bag plainly, so its query opens with
      // the binomial followed by the question's first stems in
      // order ("illucens chang diet impact"). The ladder asks in
      // structured booleans (quoted phrases, AND/OR groups), and
      // the natural language net asks the verbatim question,
      // which carries no binomial. That call answers with the
      // scenario's only two papers; everything else is empty.
      const qs = new URL(u).searchParams.get("query") || "";
      if (qs.includes("illucens chang diet impact")) {
        const mk = (n) => ({
          title: "Diet and gut microbial community assembly in black soldier fly larvae study " + n,
          doi: "10.1000/yield" + n,
          pubYear: "2024",
          citedByCount: 7,
          authorString: "Doe J, Roe K",
          journalTitle: "Journal of Insect Studies",
          abstractText: heavyAbstract(n),
        });
        return jsonRes({ resultList: { result: [mk(1), mk(2)] } });
      }
      return jsonRes({ resultList: { result: [] } });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) {
        esearchCalls++;
        // PubMed's worst case: two formulations miss before the
        // third returns ids, then efetch and esummary follow.
        return jsonRes({ esearchresult: { idlist: esearchCalls >= 3 ? ["101", "102", "103"] : [] } });
      }
      if (u.includes("esummary")) return jsonRes({ result: {} });
      return new Response("", { status: 200 });
    }
    if (u.includes("api.crossref.org")) {
      crossrefCalls++;
      if (crossrefCalls === 1) return new Response("busy", { status: 503 });
      return jsonRes({});
    }
    if (u.includes("export.arxiv.org")) {
      arxivCalls++;
      if (arxivCalls === 1) return new Response("busy", { status: 503 });
      return new Response("", { status: 200 });
    }
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
      body: JSON.stringify({ query: HEAVY_Q }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return { data, counts, ledger };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

await test("empty shelf: the cascade yield fires the first net past the ceiling", async () => {
  const { data, counts, ledger } = await runEmptyShelfScenario();
  assertLedgerEqualsPlatform(counts, ledger);
  // The phase spent PAST its allowance, which only yield grants
  // can do (every other grant refuses at the ceiling): proof the
  // yielded net ran, and ran on budget the cap alone would have
  // refused mid flight.
  assert.ok(ledger.retrievalSpent() > SUBREQUEST_RETRIEVAL_ALLOWANCE,
    `phase spent ${ledger.retrievalSpent()}, at or under the allowance ${SUBREQUEST_RETRIEVAL_ALLOWANCE}: no yield overshoot recorded`);
  // And the papers only that net could find actually shipped:
  // every other engine and round in this stub answers nothing,
  // so a non-empty shelf is the net's own catch.
  assert.ok((data.sources || []).length >= 2,
    `the yielded net's papers did not ship (${(data.sources || []).length} sources) — the cap starved the cascade`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
