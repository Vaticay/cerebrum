/**
 * Relevance gate and expansion fallback, end to end (2026-10-14,
 * fourth panel, JOB 2).
 *
 * The panel's fresh, everyday worded probes failed in three
 * shapes, all reproduced here against the real onRequest with a
 * counting stub env:
 *
 *   1. "does creatine make your hair fall out" cited a sociology
 *      paper about hair and a history of cure alls titled
 *      "Panacea". Model expansion returned zero groups for the
 *      question, the hand table has no group for the substance or
 *      the body part, and a hair only keyword match passed every
 *      gate. Now: the deterministic fallback builds the missing
 *      groups (diag via "fallback"), the citation gate judges
 *      with them, and the two collision papers ship as further
 *      reading, never as citations.
 *   2. "what happens to a baby's gut germs in the first year"
 *      cited germ free animal papers while the on topic early
 *      life papers sat uncited in the same list. Now: citation
 *      selection orders the gated pool by concept coverage ahead
 *      of raw score, so the covering papers lead the cited slice.
 *   3. Control: the baby belly scenario the budget suite pins —
 *      its cited set and order are unchanged by this wave.
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 *
 * Run with: node tests/relevance-gate.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { onRequest, createSubrequestLedger } = await import(join(root, "functions/api/search.js"));

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

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function chatRes(content) {
  return jsonRes({ choices: [{ message: { content } }] });
}
function rgDb() {
  const st = (sql) => {
    const s = {
      bind: () => s,
      first: async () => {
        if (/CASE WHEN search_slots\.expires_at/.test(sql || "")) return { n: 1 };
        return null;
      },
      all: async () => {
        if (/sqlite_master/.test(sql || "")) {
          return { results: [
            { name: "pro_usage", sql: "CREATE TABLE pro_usage (user_id TEXT NOT NULL, month TEXT NOT NULL, ai_answers INTEGER NOT NULL DEFAULT 0, doc_reads INTEGER NOT NULL DEFAULT 0, flowcharts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month))" },
            { name: "stripe_events", sql: "CREATE TABLE stripe_events (event_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL)" },
            { name: "student_verifications", sql: "CREATE TABLE student_verifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)" },
          ] };
        }
        return { results: [] };
      },
      run: async () => ({ success: true, meta: { changes: 1 } }),
    };
    return s;
  };
  return {
    prepare: (sql) => st(sql),
    batch: async (arr) => (arr || []).map(() => ({ success: true })),
    exec: async () => ({ results: [] }),
  };
}
let scenPapers = [];
let scenAnswer = "";
async function runScenario(query) {
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  globalThis.caches = {
    default: { match: async () => undefined, put: async () => {}, delete: async () => false },
  };
  Math.random = () => 0.99;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = typeof opts.body === "string" ? opts.body : "";
    if (u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("openrouter.ai")) {
      if (body.includes("literature search specialist")) {
        // The panel's weather: the model leg answers with prose,
        // which validates to zero groups.
        return chatRes("I cannot group those terms today.");
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      }
      return chatRes(scenAnswer);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      if (u.includes("BODY")) return jsonRes({ resultList: { result: [] } });
      return jsonRes({ resultList: { result: scenPapers } });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: [] } });
      if (u.includes("esummary")) return jsonRes({ result: {} });
      return new Response("", { status: 200 });
    }
    if (u.includes("export.arxiv.org")) return new Response("", { status: 200 });
    return jsonRes({});
  };
  try {
    const ledger = createSubrequestLedger();
    const env = {
      DB: rgDb(),
      OPENROUTER_KEY: "rg-test-openrouter-key-123456",
    };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return data;
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

const epmc = (n, title, abstractText, citedByCount) => ({
  title,
  doi: "10.1000/rg" + n,
  pubYear: "2024",
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});

// ═══════════════════════════════════════════════════════════════════
group("creatine shape — collisions never cite, the fallback is on the record");

await test("hair only and neither papers never cite; the fallback is on the record", async () => {
  scenPapers = [
    epmc(1, "Creatine monohydrate supplementation and hair shedding: a randomized controlled trial",
      "Adults taking creatine monohydrate at five grams daily were followed for twelve weeks against placebo. Hair shedding counts and scalp hair density did not increase on creatine, and dihydrotestosterone remained within the normal range in both groups throughout the trial.", 500),
    epmc(2, "Creatine supplementation in athletes: a systematic review of safety outcomes",
      "Across forty one trials of creatine supplementation in athletes, adverse events were uncommon and mild. Hair outcomes were reported in three trials, none of which found increased hair shedding or hair loss on creatine compared with placebo at standard doses.", 400),
    epmc(3, "Creatine dosing strategies and side effects in resistance training",
      "This review compares creatine dosing strategies in resistance training and catalogues reported side effects. Hair shedding and hair loss reports were rare, anecdotal, and never confirmed in controlled creatine measurements at any dose studied.", 300),
    epmc(4, "Hair in the schoolyard: hair policies and belonging in English schools",
      "This sociology paper examines how school hair rules shape pupils' sense of identity and belonging. Hair is treated as culture and self expression throughout, and hair length rules are traced through school policy documents and pupil interviews about hair.", 200),
    epmc(5, "Panacea: cure alls in the history of popular medicine",
      "A history of universal remedies, from hair tonics to bottled elixirs. Sellers promised restored hair, cured baldness, and renewed youth, and hair preparations outsold every other remedy in the catalogues of the period.", 100),
  ];
  scenAnswer =
    "## Summary\n\n" +
    "**Creatine** did not increase hair shedding or hair density loss in the randomized trial that measured both [1]. " +
    "A systematic review of creatine in athletes likewise found no increase in hair shedding or hair loss [2]. " +
    "A review of creatine dosing strategies found hair shedding reports rare and never confirmed in controlled measurements [3]. " +
    "School hair policies shape how pupils feel they belong, a separate literature about hair as culture [4]. " +
    "Sellers of cure alls once promised restored hair and cured baldness to anyone who paid [5].\n\n" +
    "## Limits\n\n" +
    "The trials are short, their samples are small, and few followed anyone past twelve weeks.";
  const data = await runScenario("does creatine make your hair fall out");
  assert.equal(data.synthesisMode, "ai", "the scenario must ship the AI answer, got: " + data.synthesisMode);

  // The fallback is on the record, honestly labeled: the model
  // leg returned zero groups, and the diag says so by naming the
  // fallback rather than a provider.
  assert.ok(data._expansion, "the expansion record is missing");
  assert.equal(data._expansion.via, "fallback",
    "the expansion via must name the fallback: " + JSON.stringify(data._expansion));
  const fbTerms = (data._expansion.groups || []).map((g) => g.term);
  assert.ok(fbTerms.includes("creatine") && fbTerms.includes("hair"),
    "the fallback groups miss the question's central terms: " + JSON.stringify(fbTerms));

  // The collision papers never cite. With the fallback groups
  // resolving, the grouped topic filter (the same standard, one
  // layer earlier) resolves them out of the shipped list entirely
  // on this draw; had they survived to the evidence set, the
  // citation gate bars them from the cited set — that layer is
  // pinned directly in tests/query-expansion.mjs ("creatine
  // shape: with fallback groups, hair only and neither papers
  // lose their markers"). What this scenario pins is the shipped
  // contract: the cited set is exactly the three creatine papers,
  // and no marker in the answer resolves to a collision paper.
  const citedTitles = (data.sources || []).filter((s) => !s.uncited).map((s) => s.title);
  assert.equal(citedTitles.length, 3, "exactly the three creatine papers may be cited: " + JSON.stringify(citedTitles));
  assert.ok(citedTitles.every((t) => t.startsWith("Creatine")), "a non creatine paper was cited: " + JSON.stringify(citedTitles));
  (data.sources || []).forEach((s, i) => {
    if (s.title.startsWith("Hair in the schoolyard") || s.title.startsWith("Panacea")) {
      assert.equal(s.uncited, true, "a collision paper shipped as cited: " + s.title);
      assert.ok(!data.answer.includes("[" + (i + 1) + "]"),
        "a collision paper's marker survived in the answer: " + s.title);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
group("baby gut shape — coverage leads the cited slice");

await test("the early life papers lead; the germ free papers do not outcite them", async () => {
  scenPapers = [
    epmc(1, "Germ free mice show altered gut development and immune maturation",
      "Germ free animals were raised in sterile isolators from birth. The gut of germ free mice developed differently, gut motility changed, and immune maturation in the gut lagged behind conventionally raised mice on every measure taken.", 500),
    epmc(2, "Germ free rats and the development of the intestinal barrier",
      "Germ free rats were compared with colonized controls. Intestinal barrier function in the gut of germ free animals was immature, gut permeability was higher, and microbial absence changed gut tissue growth across the small intestine.", 400),
    epmc(3, "Microbial shifts in early life shape the infant gut",
      "We followed each baby through the first year of life. Gut germs changed month by month as the baby gut matured, and the germs of the baby gut in the first weeks predicted later gut health in every infant in the cohort.", 90),
    epmc(4, "The baby gut in the first year: colonization patterns and feeding",
      "Stool samples from each baby were collected monthly through the first year. The baby gut germs shifted with feeding, gut colonization steadied by twelve months, and early gut germs differed between breastfed and formula fed babies.", 80),
    epmc(5, "Early gut colonization and growth in the first year of life",
      "Each baby in the cohort was weighed monthly while gut germs were profiled. Baby gut germs in the first month tracked growth across the first year, and the infant gut community differed by delivery mode in the early weeks.", 70),
  ];
  scenAnswer =
    "## Summary\n\n" +
    "The **gut germs** in a baby gut change month by month through the first year as the gut matures [1]. " +
    "What a baby eats shifts those gut germs, and the mix steadies by about twelve months [2]. " +
    "The earliest gut germs also track how the baby grows across the first year [3].\n\n" +
    "## Limits\n\n" +
    "Most cohorts are small, and feeding is hard to separate from everything else that changes in the first year.";
  const data = await runScenario("what happens to a baby's gut germs in the first year");
  assert.equal(data.synthesisMode, "ai", "the scenario must ship the AI answer, got: " + data.synthesisMode);
  const titles = (data.sources || []).map((s) => s.title);
  const earlyIdx = titles.findIndex((t) => t.includes("early life") || t.includes("first year"));
  const germIdx = titles.findIndex((t) => t.startsWith("Germ free"));
  assert.ok(earlyIdx >= 0 && germIdx >= 0, "both paper families must ship: " + JSON.stringify(titles));
  assert.ok(earlyIdx < germIdx,
    "an early life paper must lead the germ free papers in the cited slice: " + JSON.stringify(titles));
  // The first three sources are the three early life papers (the
  // covering set), and they are the cited ones.
  const head = titles.slice(0, 3).join(" | ");
  assert.ok(!head.includes("Germ free"), "a germ free paper sits in the cited slice's head: " + head);
  const citedTitles = (data.sources || []).filter((s) => !s.uncited).map((s) => s.title);
  assert.ok(citedTitles.length >= 3 && citedTitles.slice(0, 3).every((t) => !t.startsWith("Germ free")),
    "the cited set does not lead with the early life papers: " + JSON.stringify(citedTitles));
});

// ═══════════════════════════════════════════════════════════════════
group("control — the budget suite's baby belly shape, unchanged");

await test("the control question's cited set and order are what they were", async () => {
  // The budget suite's rich scenario shape verbatim in structure:
  // the baby belly question its own wave pinned end to end, with
  // abstracts dense in the question's concepts. JOB 2 must leave
  // this canonical good case exactly as it was: both papers
  // cited, in order, under an AI answer.
  // One shared abstract for both papers (the budget suite's rich
  // shape): identical scoring inputs keep the shelf order the
  // return order, and every answer sentence traces to both
  // abstracts, so the control isolates JOB 2's effects from the
  // rest of the pipeline's ordering and stripping machinery.
  const bellyAbstract =
    "The germs in a baby belly change across the first year of life, and the microbes living in the infant gut influence how nutrients are absorbed and how weight is gained over time. " +
    "When the microbial community is disturbed early, growth can slow until the community recovers, and how well the baby grows tracks the germs in the belly month by month.";
  scenPapers = [1, 2].map((n) => ({
    title: "Gut germs and infant growth patterns study " + n,
    doi: "10.1000/rgc" + n,
    pubYear: "2024",
    citedByCount: 7,
    authorString: "Doe J, Roe K",
    journalTitle: "Journal of Infant Studies",
    abstractText: bellyAbstract,
  }));
  scenAnswer =
    "The **gut microbes** living in an infant gut influence how nutrients are absorbed and how weight is gained over time [1]. " +
    "When the microbial community is disturbed early, growth can slow until the community recovers [2]. " +
    "The germs in the belly change month by month across the first year [1].";
  const data = await runScenario("Do the germs in a baby belly change how well the baby grows");
  assert.equal(data.synthesisMode, "ai", "the control must ship the AI answer");
  const titles = (data.sources || []).map((s) => s.title);
  assert.deepEqual(titles, [
    "Gut germs and infant growth patterns study 1",
    "Gut germs and infant growth patterns study 2",
  ], "the control's source order changed: " + JSON.stringify(titles));
  assert.ok(data.sources.every((s) => !s.uncited), "the control's papers must both stay cited");
  assert.ok(data.answer.includes("[1]") && data.answer.includes("[2]"), "the control's markers changed");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
