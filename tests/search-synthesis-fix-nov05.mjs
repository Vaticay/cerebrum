/**
 * Synthesis failure wave proofs (2026-11-05).
 *
 * Spec: the live batch on production 78577c2 in
 * ~/workspace/cerebrum-synthesis-failure-nov05/ (31 plain
 * language searches, spaced): a written AI answer landed on
 * 1 of 30 literature bearing searches; synthesis read "all
 * legs failed" on 21, "no legs recorded" on 2 (validation
 * burned 5,750 ms and failed open, closing the window before
 * any leg fired), "no citable evidence" on 4; databases
 * answered averaged 5.2 of 14 with the roster tail recorded
 * not searched on essentially every request and Crossref
 * budget stopped in nearly every record. Three recalibrations
 * answer it, each on the existing logic:
 *   1. FACT_CHECK_RESERVE_MS 8,000 to 6,000 — the reserve's
 *      8,000 sizing predates the bounded rescue; the check's
 *      measured full run spent 4,337 ms. The freed 2,000 ms
 *      returns to the retrieval slice, the synthesis deadline,
 *      and the rescue deadline on fact check requests.
 *   2. SUBREQUEST_TAIL_RESERVE 7 to 6 — the record store's
 *      share priced a grant the bookkeeping lane never refuses;
 *      the freed share moves to the retrieval allowance,
 *      23 to 24, and the budget still closes at the limit.
 *   3. Crossref joins FANOUT_PRIORITY_NAMES, so its one cheap
 *      call is funded and settles with the head group instead
 *      of racing the head sources' follow on calls from the
 *      tail. (The delayed rescue half of the wave — the gate
 *      judged on the chosen legs — is pinned in
 *      tests/fleet-hardening.mjs.)
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  FACT_CHECK_RESERVE_MS, synthesisDeadlineFor, retrievalDeadlineFor, rescueDeadlineFor,
  SUBREQUEST_LIMIT, SUBREQUEST_TAIL_RESERVE, SUBREQUEST_RETRIEVAL_ALLOWANCE,
  SUBREQUEST_POST_RETRIEVAL_COST, SUBREQUEST_ANSWER_RESERVE,
  createSubrequestLedger, FANOUT_PRIORITY_NAMES, planFanoutFunding,
} = await import(join(root, "functions/api/search.js"));

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  PASS", name);
  } catch (e) {
    failures.push(name + ": " + String(e && e.message || e).split("\n").slice(0, 3).join(" | "));
    console.log("  FAIL", name, "-", String(e && e.message || e).split("\n")[0]);
  }
}
function group(label) { console.log("\n== " + label); }

group("Fact check reserve — one number, recalibrated");

await test("the reserve is 6,000 and every deadline derives from it", () => {
  assert.equal(FACT_CHECK_RESERVE_MS, 6000);
  const t0 = 1000000;
  const deadline = t0 + 19000;
  // Synthesis deadline on a fact check request: start + 10,500
  // (was 8,500 at the 8,000 reserve).
  assert.equal(synthesisDeadlineFor(t0, deadline, true), deadline - 2500 - 6000);
  assert.equal(synthesisDeadlineFor(t0, deadline, true) - t0, 10500);
  // With the check off nothing changes.
  assert.equal(synthesisDeadlineFor(t0, deadline, false), deadline - 2500);
  // Rescue deadline: the reserve intact behind it, now 13,000.
  assert.equal(rescueDeadlineFor(deadline, true), deadline - 6000);
  assert.equal(rescueDeadlineFor(deadline, false), deadline - 2500);
});

await test("the retrieval slice on a fact check request is 6,000 ms (was 4,000)", () => {
  const t0 = 1000000;
  const deadline = t0 + 19000;
  assert.equal(retrievalDeadlineFor(t0, deadline, true) - t0, 6000);
  assert.equal(retrievalDeadlineFor(t0, deadline, false) - t0, 12000);
});

group("Subrequest budget — the tail share moves to retrieval, the budget still closes");

await test("tail reserve 6, retrieval allowance 24, closure at the limit", () => {
  assert.equal(SUBREQUEST_TAIL_RESERVE, 6);
  assert.equal(SUBREQUEST_RETRIEVAL_ALLOWANCE, 24);
  assert.equal(
    SUBREQUEST_RETRIEVAL_ALLOWANCE + SUBREQUEST_POST_RETRIEVAL_COST + SUBREQUEST_ANSWER_RESERVE + SUBREQUEST_TAIL_RESERVE,
    SUBREQUEST_LIMIT,
    "retrieval + post retrieval + answer reserve + tail must still close at the limit"
  );
  const ledger = createSubrequestLedger();
  assert.equal(ledger.retrievalAllowance(), 24);
});

group("Fanout priority — Crossref settles with the head group");

await test("crossref is a priority name", () => {
  assert.ok(FANOUT_PRIORITY_NAMES.includes("crossref"));
  assert.deepEqual(FANOUT_PRIORITY_NAMES.slice(0, 4), ["pubmed", "europePMC", "openAlex", "openAlexCommon"]);
});

await test("a headroom short rung funds crossref's first call inside the head group", () => {
  const ROSTER = ["europePMC", "pubmed", "openAlex", "openAlexCommon", "crossref", "arxiv",
    "semanticScholar", "doaj", "biorxiv", "plos", "CORE", "BASE", "pmcFullText", "openAire", "preprints"];
  const plan = planFanoutFunding(ROSTER, 8, { prioritizeTrio: true });
  assert.deepEqual(plan.priorityOrder.slice(0, 5), ["pubmed", "europePMC", "openAlex", "openAlexCommon", "crossref"]);
  assert.deepEqual(plan.funded.slice(0, 5), ["pubmed", "europePMC", "openAlex", "openAlexCommon", "crossref"]);
});

console.log("\nsearch-synthesis-fix-nov05: " + passed + " passed, " + failures.length + " failed");
if (failures.length) {
  for (const f of failures) console.log("  FAILED:", f);
  process.exitCode = 1;
}
