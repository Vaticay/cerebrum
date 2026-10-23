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
const { onRequest, createSubrequestLedger, recordLegOutcome, resetLegHealth,
  paperIsCitable, subjectEngagingRescue, conceptGateContext, applyRelevanceGate } = await import(join(root, "functions/api/search.js"));
const { getBreaker, resetBreakers } = await import(join(root, "functions/lib/llmCircuit.js"));

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
let scenPapersFn = null;
let scenQueryLog = [];
async function runScenario(query, opts = {}) {
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
      let qParam = "";
      try { qParam = new URL(u).searchParams.get("query") || ""; } catch { qParam = ""; }
      scenQueryLog.push(qParam);
      if (scenPapersFn) return jsonRes({ resultList: { result: scenPapersFn(qParam) } });
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
    const ledger = createSubrequestLedger(opts.limit || undefined);
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

async function runScenarioLogged(query, opts = {}) {
  scenQueryLog = [];
  const data = await runScenario(query, opts);
  return { data, queries: scenQueryLog.slice() };
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
  // Shipped source split (2026-10-21, answer integrity lane):
  // the presented list is cited `sources` first, then
  // `furtherReading`; positions below read the presented list,
  // which is the order the single list used to carry.
  const titles = [...(data.sources || []), ...(data.furtherReading || [])].map((s) => s.title);
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

// ═══════════════════════════════════════════════════════════════════
group("subject touch standard (2026-10-14) — the creatine shape, one layer deeper");

// The live failure (production, build 75dd771): the creatine
// question shipped citing a sociology paper about hair in schools
// that never mentions creatine. The scenario above pins the hair
// only papers out of the cited set; this one pins the corrected
// standard's two new edges at handler level: an effect only paper
// never cites even when it is the pool's TOP SCORER, and a subject
// only paper — a creatine safety study that never mentions hair —
// DOES cite. Under the old any group standard the subject only
// paper was barred (one group touch), and the effect only paper
// was the kind of citation that shipped.
await test("an effect only top scorer never cites; a below floor subject only paper cannot cite either", async () => {
  scenPapers = [
    epmc(11, "Hair in the schoolyard: hair policies and belonging in English schools",
      "This sociology paper examines how school hair rules shape pupils' sense of identity and belonging. Hair is treated as culture and self expression throughout, and hair length rules are traced through school policy documents and pupil interviews about hair.", 900),
    epmc(12, "Creatine supplementation and renal function in healthy adults: a two year safety study",
      "Healthy adults took creatine monohydrate daily for two years. Renal function, liver enzymes, and blood markers stayed in the normal range on creatine, and no serious adverse events were attributed to creatine supplementation in either arm of the study.", 120),
    epmc(13, "Creatine monohydrate supplementation and hair shedding: a randomized controlled trial",
      "Adults taking creatine monohydrate at five grams daily were followed for twelve weeks against placebo. Hair shedding counts and scalp hair density did not increase on creatine, and dihydrotestosterone remained within the normal range in both groups throughout the trial.", 300),
  ];
  scenAnswer =
    "## Summary\n\n" +
    "**Creatine** did not increase hair shedding or hair density loss in the randomized trial that measured both [1]. " +
    "Two years of daily creatine also left renal function and blood markers in the normal range, with no serious adverse events attributed to it [2]. " +
    "School hair policies shape how pupils feel they belong, a separate literature about hair as culture [3].\n\n" +
    "## Limits\n\n" +
    "The trials are short, their samples are small, and few followed anyone past twelve weeks.";
  const data = await runScenario("does creatine make your hair fall out");
  assert.equal(data.synthesisMode, "ai", "the scenario must ship the AI answer, got: " + data.synthesisMode);
  assert.equal(data._expansion && data._expansion.via, "fallback",
    "the expansion via must name the fallback: " + JSON.stringify(data._expansion));
  // Corrected contract (2026-10-14, sixth panel, wave seven, Job
  // 1a): EVERY cited paper must individually clear the citation
  // gate AND the relevance floor — no cascade promotion, no
  // exceptions. The renal safety study touches the subject group
  // (creatine) and nothing else, so it reached the shelf only
  // through the emergency relaxation at a coverage score far
  // below the floor; the pre wave seven pin expected it cited as
  // marker [2] at relevance 8, which is precisely the panel's
  // specimen failure (cited papers at 10, 24, 26, 45 against a
  // floor of 50). Under binding it cannot cite: the draft's [2]
  // marker is stripped by the uncited handling, and only the
  // subject covering trial — gate clearing and above the floor —
  // ships cited.
  const citedTitles = (data.sources || []).filter((s) => !s.uncited).map((s) => s.title);
  assert.deepEqual(citedTitles, [
    "Creatine monohydrate supplementation and hair shedding: a randomized controlled trial",
  ], "the cited set must be the subject covering trial alone: " + JSON.stringify(citedTitles));
  assert.ok(data.answer.includes("[1]"), "the trial's marker must survive in the shipped answer");
  assert.ok(!data.answer.includes("[2]"),
    "a marker resolving to a below floor paper survived in the answer: " + data.answer.slice(0, 300));
  (data.sources || []).forEach((s, i) => {
    if (s.title.startsWith("Hair in the schoolyard")) {
      assert.equal(s.uncited, true, "the effect only top scorer shipped as cited: " + s.title);
      assert.ok(!data.answer.includes("[" + (i + 1) + "]"),
        "the effect only top scorer's marker survived in the answer: " + s.title);
    }
    if (s.title.startsWith("Creatine supplementation and renal")) {
      assert.equal(s.uncited, true, "the below floor subject only paper shipped as cited: " + s.title);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
group("subject touch standard — baby gut control (subject group: infant gut)");

// The control: the baby gut question's subject group is the gut
// group (the infant gut concept). Its on topic papers must still
// cite, in the same order the coverage selection produced before
// this wave, and the germ free animal papers — which speak about
// the gut in animals raised sterile, not about a baby's first
// year — must stay uncited, exactly as they were.
await test("on topic papers cite in the same order; germ free papers stay uncited", async () => {
  scenPapers = [
    epmc(21, "Germ free mice develop an immature gut and delayed immune maturation",
      "Pups raised germ free in sterile isolators developed an immature gut. Gut barrier function lagged, gut motility was altered, and immune maturation in the gut trailed conventionally raised pups on every measure taken.", 500),
    epmc(22, "The intestinal barrier in germ free rats",
      "Germ free rats were compared with colonized controls. The intestinal barrier of germ free animals stayed permeable, gut tissue growth slowed, and the gut of germ free rats differed across the small intestine.", 400),
    epmc(23, "How the infant gut changes across the first year",
      "We followed each baby through the first year of life. Gut germs changed month by month as the baby gut matured, and the germs of the baby gut in the first weeks predicted later gut health in every infant in the cohort.", 90),
    epmc(24, "Feeding and the baby gut in the first year of life",
      "Stool samples from each baby were collected monthly through the first year. The baby gut germs shifted with feeding, gut colonization steadied by twelve months, and early gut germs differed between breastfed and formula fed babies.", 80),
    epmc(25, "Early gut germs and growth across the first year",
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
  assert.equal(data.synthesisMode, "ai", "the control must ship the AI answer, got: " + data.synthesisMode);
  const titles = (data.sources || []).map((s) => s.title);
  // The order below is the order this exact draw produced under
  // the pre wave standard as well (verified against the old code):
  // the coverage and relevance ordering is untouched by the
  // subject rule, so the control pins it verbatim.
  assert.deepEqual(titles.slice(0, 3), [
    "Early gut germs and growth across the first year",
    "Feeding and the baby gut in the first year of life",
    "How the infant gut changes across the first year",
  ], "the on topic papers must lead the shipped list in the same order as before: " + JSON.stringify(titles));
  const citedTitles = (data.sources || []).filter((s) => !s.uncited).map((s) => s.title);
  assert.deepEqual(citedTitles, titles.slice(0, 3),
    "exactly the three on topic papers are cited: " + JSON.stringify(citedTitles));
  for (const s of data.sources || []) {
    if (s.title.startsWith("Germ free") || s.title.startsWith("The intestinal barrier")) {
      assert.equal(s.uncited, true, "a germ free animal paper shipped as cited: " + s.title);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
group("subject touch standard — a question with no identifiable subject group");

// The sleep and colds question puts a clause ("not getting enough
// sleep") in the subject slot, so no subject group is identified
// and the standard is the founding both concepts standard,
// unchanged: the paper covering both concepts cites, the one
// concept papers do not, whichever side of the relation they sit
// on. If identification ever named sleep (or cold) the subject
// here, one of the one concept papers would start citing and
// this scenario's cited set would change — that is the regression
// it stands against.
await test("the sleep and colds cited set is unchanged: both concepts or nothing", async () => {
  // The groups the handler really builds for this question (the
  // expansion record names them): sleep, likely, catch, enough —
  // "cold" is a generic science word in this codebase, so no group
  // ever carries it, and the concept coverage lives in the sleep
  // and catch groups. The covering paper below touches three of
  // the resolved groups; each one concept paper touches exactly
  // one (sleep alone; catch alone), on opposite sides of the
  // relation, so a subject named on either side would show.
  scenPapers = [
    epmc(31, "Sleep duration and next day alertness in night shift workers",
      "Night shift workers who slept fewer than six hours reported lower alertness the next day. Sleep was recorded by actigraphy across two work weeks, and short sleep predicted slower reaction times on morning tests.", 300),
    epmc(32, "Catching a cold in the office: air handling and infection",
      "We followed office workers through one winter and recorded who did catch a cold each month. Workers in rooms with recirculated air were infected more often, and symptoms lasted longer in poorly ventilated rooms.", 200),
    epmc(33, "Sleep duration and susceptibility to the common cold",
      "Adults kept sleep diaries for two weeks, then were exposed to a cold virus in a clinic. Those who slept less were more likely to catch a cold, and short sleep tracked higher infection rates after exposure.", 100),
  ];
  scenAnswer =
    "## Summary\n\n" +
    "Adults who slept less in the two weeks before exposure were more likely to **catch a cold** when exposed to a cold virus [1]. " +
    "Workers who slept fewer than six hours reported lower alertness the next day [2]. " +
    "Workers in rooms with recirculated air were infected more often through the winter [3].\n\n" +
    "## Limits\n\n" +
    "Exposure studies are small, and sleep was recorded over two weeks only.";
  const data = await runScenario("does not getting enough sleep make you more likely to catch a cold");
  assert.equal(data.synthesisMode, "ai", "the scenario must ship the AI answer, got: " + data.synthesisMode);
  const citedTitles = (data.sources || []).filter((s) => !s.uncited).map((s) => s.title);
  assert.deepEqual(citedTitles, ["Sleep duration and susceptibility to the common cold"],
    "only the both concepts paper may be cited: " + JSON.stringify(citedTitles));
  assert.ok(data.answer.includes("[1]"), "the both concepts marker must survive");
  (data.sources || []).forEach((s, i) => {
    if (s.title.startsWith("Sleep duration and next day") || s.title.startsWith("Catching a cold")) {
      assert.equal(s.uncited, true, "a one concept paper shipped as cited: " + s.title);
      assert.ok(!data.answer.includes("[" + (i + 1) + "]"),
        "a one concept paper's marker survived in the answer: " + s.title);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
group("shelf floor relaxation — a thin pool is not starved (Job 2b)");

const YOGURT_Q = "can eating yogurt fix an upset stomach after taking antibiotics";
const FILLER_TITLES = [
  "Composting kitchen scraps in small gardens",
  "Office chair ergonomics and posture at work",
  "Railway expansion in nineteenth century Britain",
  "Knitting patterns for winter garments",
  "Municipal bonds and local infrastructure funding",
  "Aquarium lighting for planted freshwater tanks",
  "Chess openings for club players",
  "Roofing materials for coastal homes",
  "Typeface design and reading on screens",
];
function yogurtPool() {
  return [
    epmc(41, "Probiotic yogurt for antibiotic associated stomach upset: a randomized trial",
      "Patients taking antibiotics who ate probiotic yogurt daily reported less stomach upset and fewer loose stools than the control group. The yogurt carried Lactobacillus cultures, and symptoms settled faster in the yogurt arm of the trial.", 40),
    epmc(42, "Lactobacillus rhamnosus GG for antibiotic associated diarrhoea",
      "In a randomized double blind trial, Lactobacillus rhamnosus GG or placebo was given during antibiotic therapy. The incidence of diarrhoea and gastrointestinal adverse events was recorded over the treatment period and follow up.", 85),
    epmc(43, "Fermented milk with Lactobacillus after antibiotic therapy",
      "Participants received fermented milk containing Lactobacillus or a control product after antibiotic therapy. Gastric symptom scores, bowel habit, and how upset participants felt after meals were assessed by questionnaire at baseline and weekly thereafter.", 60),
    epmc(44, "Yogurt and stomach comfort during antibiotics: a patient survey",
      "People taking antibiotics often get an upset stomach. In this survey, patients who ate yogurt every day during their antibiotics reported less stomach upset and returned to normal eating sooner than patients who ate no yogurt.", 5),
    epmc(45, "Eating yogurt while taking antibiotics: guidance for patients",
      "Antibiotics can upset the stomach and loosen stools. This guidance reviews eating yogurt during a course of antibiotics, which yogurts carry live cultures, and when an upset stomach on antibiotics needs a doctor instead.", 5),
    epmc(46, FILLER_TITLES[0],
      "Compost bins turn kitchen scraps into soil food. This guide covers layering greens and browns, moisture, turning the pile, and when the finished compost is ready for the beds.", 3),
    epmc(47, FILLER_TITLES[1],
      "A badly adjusted chair strains the back during long sitting. This review covers seat height, lumbar support, and desk layout for office workers who sit all day.", 2),
    epmc(48, FILLER_TITLES[2],
      "Rail lines reshaped trade and travel across Britain. This history follows the railway companies, the navvies who built the lines, and the towns the trains connected.", 4),
    epmc(49, FILLER_TITLES[3],
      "This pattern collection includes scarves, hats, and mittens. Gauge, yarn weight, and stitch counts are given for each garment, with notes on sizing for children and adults.", 1),
    epmc(50, FILLER_TITLES[4],
      "Cities issue bonds to pay for bridges and water systems. This explainer covers bond ratings, repayment schedules, and how investors judge a municipality's finances.", 6),
    epmc(51, FILLER_TITLES[5],
      "Plants in a freshwater aquarium need the right light spectrum and photoperiod. This guide compares LED fixtures and covers algae control in planted tanks.", 5),
    epmc(52, FILLER_TITLES[6],
      "This survey of chess openings covers the Italian game and the French defence, with model games annotated for club players looking to widen their repertoire.", 2),
    epmc(53, FILLER_TITLES[7],
      "Salt air corrodes roofs near the coast. This comparison covers metal panels, treated shingles, and tile, with costs and expected lifetimes for each material.", 3),
    epmc(54, FILLER_TITLES[8],
      "Typefaces shape how text reads on a screen. This study compares serif and sans designs at small sizes and measures reading speed across devices.", 2),
  ];
}

await test("a yogurt shaped pool: the trials below the floor are re admitted and cite", async () => {
  // The panel's specimen shape: of the whole pool only the lay
  // worded papers pass the ranker's core term floor (the two
  // scientific register trials touch too few of the question's
  // core terms literally), so the post floor pool sits under the
  // citable minimum of 6 and the relaxation must re admit the
  // highest scoring excluded papers — the trials — before any
  // filler. Without the relaxation the Lactobacillus trial can
  // never reach the shelf at all (the chain's own emergency
  // tiers do not fire at three scored papers).
  scenPapersFn = null;
  scenPapers = yogurtPool();
  // The claims follow the shelf's score order (the probiotic
  // trial, the fermented milk trial, the guidance, the survey,
  // the Lactobacillus trial), the way this suite's other answers
  // cite the head of the evidence list.
  scenAnswer =
    "In the randomized trial, patients taking antibiotics who ate probiotic yogurt daily reported less stomach upset and fewer loose stools [1]. " +
    "Fermented milk containing Lactobacillus also eased gastric symptoms after antibiotic therapy [2]. " +
    "Guidance for patients on antibiotics recommends yogurt with live cultures when the stomach is upset [3]. " +
    "Patients surveyed while taking antibiotics reported less stomach upset when they ate yogurt every day [4]. " +
    "Lactobacillus rhamnosus GG given during antibiotic therapy reduced diarrhoea in a double blind trial [5].";
  const data = await runScenario(YOGURT_Q);
  const presented = [...(data.sources || []), ...(data.furtherReading || [])];
  const titles = presented.map((s) => s.title);
  const trial = presented.find((s) => s.title.startsWith("Lactobacillus rhamnosus"));
  assert.ok(trial, "the below floor trial never reached the shipped sources: " + JSON.stringify(titles));
  assert.ok(!trial.uncited, "the re admitted trial shipped uncited: " + JSON.stringify(data.sources.map((s) => [s.title, s.uncited])));
  assert.ok(titles.some((t) => t.startsWith("Fermented milk")),
    "the fermented milk trial is missing from the sources: " + JSON.stringify(titles));
  assert.ok(titles.some((t) => t.startsWith("Probiotic yogurt")),
    "the above floor trial is missing: " + JSON.stringify(titles));
});

await test("the same pool with a healthy above floor set is unchanged by the relaxation", async () => {
  // Eight lay worded on topic papers pass the floor outright:
  // the post floor pool is healthy, the relaxation never runs,
  // and no filler is admitted to fill a shelf that is not thin.
  scenPapersFn = null;
  const healthy = yogurtPool().filter((p) => !FILLER_TITLES.includes(p.title));
  healthy[1] = epmc(42, "Lactobacillus yogurt trial for stomach upset on antibiotics",
    "Patients taking antibiotics ate yogurt carrying Lactobacillus every day. Their stomach upset and diarrhoea were milder than the control group's, and the yogurt was well tolerated throughout the antibiotic course.", 85);
  healthy[2] = epmc(43, "Fermented milk and yogurt after antibiotics ease stomach upset",
    "After antibiotics, participants who ate fermented milk and yogurt reported less stomach upset and fewer loose stools. The yogurt carried Lactobacillus, and symptoms settled days sooner than in the control group.", 60);
  healthy.push(
    epmc(55, "Yogurt cultures and the stomach during antibiotic treatment",
      "Antibiotics disturb the stomach. This study followed patients eating yogurt with live cultures during antibiotics and recorded stomach upset, appetite, and recovery of normal eating.", 30),
    epmc(56, "Live culture yogurt for antibiotic stomach complaints",
      "A trial of live culture yogurt in patients on antibiotics found less stomach upset and fewer missed doses. Yogurt was eaten twice daily for the whole antibiotic course.", 25),
    epmc(57, "Probiotic yogurt drinks and stomach upset in antibiotic users",
      "Antibiotic users drinking probiotic yogurt daily reported less stomach upset than those drinking a plain drink. The yogurt drinks carried Lactobacillus cultures.", 20),
  );
  scenPapers = [...healthy, ...yogurtPool().filter((p) => FILLER_TITLES.includes(p.title))];
  scenAnswer =
    "Eating yogurt with live cultures can ease an upset stomach while taking antibiotics [1]. " +
    "Trial evidence on Lactobacillus in yogurt found less antibiotic associated diarrhoea and stomach discomfort [2]. " +
    "Fermented milk carrying Lactobacillus also helped after antibiotics [3].";
  const data = await runScenario(YOGURT_Q);
  const titles = [...(data.sources || []), ...(data.furtherReading || [])].map((s) => s.title);
  assert.ok(titles.length >= 6, "the healthy pool shipped a thin shelf: " + JSON.stringify(titles));
  for (const f of FILLER_TITLES) {
    assert.ok(!titles.includes(f), "a filler was admitted into a healthy pool: " + f);
  }
});

// ═══════════════════════════════════════════════════════════════════
group("the serve gate — nothing citable ships the honest no evidence state (Job 2c)");

await test("a sugar shaped run over a galaxy and fibre pool ships no results, not an answer", async () => {
  scenPapersFn = null;
  scenPapers = [
    epmc(61, "A survey of galaxies in the nearby universe",
      "We present a catalogue of galaxies observed with a wide field telescope. Star formation rates, stellar masses, and morphologies are tabulated for each galaxy, and the survey volume is complete to a stated magnitude limit.", 300),
    epmc(62, "Roll fibre content in commercial breads",
      "Rolls and loaves were sampled from bakeries across the region and their fibre content measured by standard assay. White rolls carried the least fibre and seeded loaves the most, with wide variation between bakeries.", 150),
  ];
  scenAnswer =
    "Sugar clearly makes children hyperactive [1]. Behaviour worsens within the hour after sugar [2].";
  const data = await runScenario("does eating sugar make children hyperactive");
  assert.equal(data.responseKind, "no-results",
    "the run synthesized over an irrelevant pool instead of shipping the no evidence state: " + data.responseKind);
  assert.ok(data.noResults, "the no results flag is missing");
  assert.ok(!data.answer.includes("galaxies observed"),
    "galaxy abstract text was pasted into the answer: " + data.answer.slice(0, 300));
  assert.ok(!data.answer.includes("fibre content measured"),
    "fibre abstract text was pasted into the answer: " + data.answer.slice(0, 300));
  assert.ok(!data.answer.includes("Sugar clearly makes children hyperactive"),
    "the fabricated answer over irrelevant papers shipped");
  assert.ok(!(data.sources || []).some((s) => !s.uncited),
    "an irrelevant paper shipped as cited: " + JSON.stringify(data.sources));
});

await test("a thin pool whose only subject paper sits below the floor ships no evidence (the serve gate stands)", async () => {
  scenPapersFn = null;
  scenPapers = [
    epmc(63, "Creatine and kidney safety in healthy adults: a controlled trial",
      "Healthy adults took creatine daily for twelve weeks while kidney markers were tracked. Creatine did not change kidney filtration markers, and no adverse renal events occurred in the creatine group compared with placebo.", 120),
    epmc(64, "Hair in the schoolyard: hair policies and belonging in English schools",
      "This sociology paper examines how school hair rules shape pupils' sense of identity and belonging. Hair is treated as culture and self expression throughout, and hair length rules are traced through school policy documents.", 200),
  ];
  scenAnswer =
    "Creatine did not change kidney filtration markers in healthy adults over twelve weeks [1]. " +
    "No adverse renal events occurred in the creatine group [1].";
  const data = await runScenario("does creatine make your hair fall out");
  // Corrected contract (2026-10-14, sixth panel, wave seven, Job
  // 1a): the kidney trial clears the concept gate (it touches the
  // creatine subject group) but reaches the shelf only through
  // the emergency relaxation, far below the relevance floor. The
  // pre wave seven pin expected the serve gate to stand down and
  // the thin answer to ship with this paper cited — the exact
  // mechanism that put sub floor papers into the panel's cited
  // sets. Under per paper binding there is nothing citable in
  // this pool, so the honest no evidence state is the only
  // outcome.
  assert.equal(data.responseKind, "no-results",
    "a pool with no citable paper shipped an answer instead of the no evidence state: " + data.responseKind);
  assert.ok(data.noResults, "the no results flag is missing");
  assert.ok(!(data.sources || []).some((s) => !s.uncited),
    "a below floor paper shipped as cited: " + JSON.stringify(data.sources));
});

// ═══════════════════════════════════════════════════════════════════
group("the broad terms rung — the question's own words, combined (Job 2a)");

await test("an uncovered term fires one broad rung of raw central terms", async () => {
  // "Quokka" is in no table: the model leg fails (the harness's
  // weather), the fallback group for it is inflections only
  // (quokkas), which covers nothing, so after every other
  // fallback the broad rung must fire the raw uncovered term
  // itself. Its query signature is the bare term: the ladder's
  // booleans always carry the question's other words (diet,
  // pressure), the concept nets carry the inflection (quokkas),
  // and the NL net carries the whole question — so a query of
  // "quokka" alone can only be the broad rung.
  const isBroadQuery = (q) =>
    q.includes("quokka") && !q.includes("quokkas") && !q.includes("diet") &&
    !q.includes("pressure") && !q.includes("hypertension");
  scenPapersFn = (q) => {
    if (isBroadQuery(q)) {
      return [
        epmc(71, "Diet and blood pressure in the quokka: a field study",
          "The quokka's diet on the island is mostly leaves. Quokkas on leaf diets showed lower blood pressure than quokkas on other forage, and diet composition tracked blood pressure across the island population through the dry season.", 25),
        epmc(72, "Blood pressure regulation in the quokka",
          "The quokka's blood pressure varies with diet and water access. This study measured blood pressure in quokkas across seasons and related it to what the animals ate.", 15),
        epmc(73, "What quokkas eat: diet composition across the island",
          "The quokka's diet is mostly leaves, stems, and bark. Diet composition shifted with rainfall, and the quokka diet in the dry season carried far less water than in the wet season.", 10),
        epmc(74, "Seasonal diet change and blood pressure in quokkas",
          "When the quokka's diet changed with the seasons, its blood pressure changed with it. Quokkas eating the dry season diet ran higher blood pressure than quokkas on the wet season diet.", 8),
      ];
    }
    return [];
  };
  scenPapers = [];
  scenAnswer =
    "A quokka's diet tracks its blood pressure: leaf diets were linked to lower blood pressure [1]. " +
    "Blood pressure in the quokka also varies with water access across seasons [2].";
  // A larger ledger limit on purpose (the budget suite's NL
  // scenario makes the same choice): a fully starved pool fires
  // every rung of the ladder and every fallback net, and that
  // fanout costs more subrequests than a production draw where
  // an early rung answers. The rung's existence and its papers
  // are what is under test here, not the budget.
  const { data, queries } = await runScenarioLogged("can a quokka's diet change its blood pressure", { limit: 130 });
  scenPapersFn = null;
  assert.ok(queries.some(isBroadQuery),
    "no broad terms rung fired (queries seen: " + JSON.stringify(queries.slice(0, 8)) + ")");
  const titles = (data.sources || []).map((s) => s.title);
  assert.ok(titles.some((t) => t.includes("quokka")),
    "the broad rung's papers never shipped: " + JSON.stringify(titles));
});

// ═══════════════════════════════════════════════════════════════════
group("synthesis record honesty — the winner is named only when its draft shipped (Job 3c)");

await test("an all fail run ships the extractive tier with an honest synthesis record", async () => {
  // Every synthesis leg answers with a malformed draft (no
  // formatting, far too short), so all waves fail on content.
  // The run must still complete honestly: extractive ship, the
  // record naming no winner and "all legs failed", and every
  // failedLegs entry a leg that actually raced (a real error,
  // never a planner's budget stamp — the Job 4 separation; the
  // planner side of that contract is pinned in
  // tests/subrequest-budget.mjs, whose harnesses can drive the
  // funded size trims this one's small rosters cannot).
  scenPapersFn = null;
  scenPapers = [
    epmc(81, "Creatine monohydrate supplementation and hair shedding: a randomized controlled trial",
      "Adults taking creatine monohydrate at five grams daily were followed for twelve weeks against placebo. Hair shedding counts and scalp hair density did not increase on creatine, and dihydrotestosterone remained within the normal range in both groups throughout the trial.", 500),
    epmc(82, "Creatine supplementation in athletes: a systematic review of safety outcomes",
      "Across forty one trials of creatine supplementation in athletes, adverse events were uncommon and mild. Hair outcomes were reported in three trials, none of which found increased hair shedding or hair loss on creatine compared with placebo at standard doses.", 400),
  ];
  scenAnswer = "creatine is fine and does not affect hair at all";
  const data = await runScenario("does creatine make your hair fall out");
  assert.equal(data.synthesisMode, "extractive", "the all fail run should fall to the extractive tier");
  const synth = (data.stageHealth || []).find((s) => s.name === "synthesis");
  assert.ok(synth, "the synthesis stage record is missing");
  assert.equal(synth.winner, null, "a winner was named on an all fail run");
  assert.equal(synth.skipReason, "all legs failed");
  assert.ok((synth.failedLegs || []).length >= 1, "the raced failures are missing from the record");
  for (const leg of synth.failedLegs || []) {
    assert.ok(!/subrequest budget exhausted/i.test(leg.error || ""),
      "a planner stamp leaked into failedLegs: " + JSON.stringify(leg));
  }
});

await test("a parked leg counts as parkedLegs on the record, never as a failed leg (sixth panel, Job 3b)", async () => {
  // The wave 1 OpenRouter leg is parked by the per leg health
  // store (two consecutive timeouts) before the run starts. It
  // never races: the synthesis record must count it under
  // parkedLegs and keep it out of failedLegs — the panel still
  // found 0 ms "parked (rate limit cooldown)" entries mixed into
  // failedLegs on half its probes, the same misclassification the
  // planner stamps were separated for.
  scenPapersFn = null;
  scenPapers = [
    epmc(81, "Creatine monohydrate supplementation and hair shedding: a randomized controlled trial",
      "Adults taking creatine monohydrate at five grams daily were followed for twelve weeks against placebo. Hair shedding counts and scalp hair density did not increase on creatine, and dihydrotestosterone remained within the normal range in both groups throughout the trial.", 500),
    epmc(82, "Creatine supplementation in athletes: a systematic review of safety outcomes",
      "Across forty one trials of creatine supplementation in athletes, adverse events were uncommon and mild. Hair outcomes were reported in three trials, none of which found increased hair shedding or hair loss on creatine compared with placebo at standard doses.", 400),
  ];
  scenAnswer = "creatine is fine and does not affect hair at all";
  resetLegHealth();
  const t0 = Date.now();
  recordLegOutcome("nvidia/nemotron-3-ultra-550b-a55b:free", false,
    "nvidia/nemotron-3-ultra-550b-a55b:free: timed out", t0);
  recordLegOutcome("nvidia/nemotron-3-ultra-550b-a55b:free", false,
    "nvidia/nemotron-3-ultra-550b-a55b:free: timed out", t0 + 1000);
  let data;
  try {
    data = await runScenario("does creatine make your hair fall out");
  } finally {
    resetLegHealth();
  }
  assert.equal(data.synthesisMode, "extractive", "the parked run should still fall to the extractive tier");
  const synth = (data.stageHealth || []).find((s) => s.name === "synthesis");
  assert.ok(synth, "the synthesis stage record is missing");
  assert.ok((synth.parkedLegs || 0) >= 1,
    "the parked leg was not counted as parkedLegs: " + JSON.stringify(synth));
  for (const leg of synth.failedLegs || []) {
    assert.ok(!/^parked \(/i.test(leg.error || ""),
      "a parked stamp leaked into failedLegs: " + JSON.stringify(leg));
    assert.ok(leg.model !== "nvidia/nemotron-3-ultra-550b-a55b:free",
      "the parked leg is listed as a raced failure: " + JSON.stringify(leg));
  }
});

await test("legs record ok, the draft is discarded uncited: the record names no winner", async () => {
  scenPapersFn = null;
  scenPapers = [
    epmc(81, "Creatine monohydrate supplementation and hair shedding: a randomized controlled trial",
      "Adults taking creatine monohydrate at five grams daily were followed for twelve weeks against placebo. Hair shedding counts and scalp hair density did not increase on creatine, and dihydrotestosterone remained within the normal range in both groups throughout the trial.", 500),
    epmc(82, "Creatine supplementation in athletes: a systematic review of safety outcomes",
      "Across forty one trials of creatine supplementation in athletes, adverse events were uncommon and mild. Hair outcomes were reported in three trials, none of which found increased hair shedding or hair loss on creatine compared with placebo at standard doses.", 400),
  ];
  // Every leg answers with fluent prose carrying no citations at
  // all: the waves record ok legs, the citation retry cannot fix
  // it (the stub returns the same draft), and the extractive tier
  // ships. Before the fix the synthesis record named the first ok
  // leg as winner beside the skip reason.
  scenAnswer =
    "Creatine is among the most studied sports supplements in the world, and the weight of the evidence says it does not make hair fall out. " +
    "Trials followed adults taking five grams a day for twelve weeks and measured shedding directly, and reviews of dozens of trials in athletes reached the same conclusion about safety at standard doses. " +
    "Anyone worried about hair loss on creatine is, on this evidence, worrying about the wrong thing.";
  const data = await runScenario("does creatine make your hair fall out");
  assert.equal(data.synthesisMode, "extractive", "the uncited draft should have fallen to the extractive tier");
  const synth = (data.stageHealth || []).find((s) => s.name === "synthesis");
  assert.ok(synth, "the synthesis stage record is missing");
  assert.equal(synth.winner, null,
    "the record names a winner whose draft never shipped: " + JSON.stringify(synth));
  assert.equal(synth.skipReason, "answer had no citations",
    "the record does not name the discard reason: " + JSON.stringify(synth));
});

// ═══════════════════════════════════════════════════════════════════
group("breaker escape — an open circuit degrades the stage, never the request");

await test("an open synthesis breaker ships the extractive tier, not the internal error payload", async () => {
  // The fifth panel's weather, one isolate later: a previous
  // request's transient failures opened the OpenRouter breaker.
  // Every synthesis adapter call is then refused by the breaker
  // before any network call. Before the fix the refusal was a
  // SYNCHRONOUS throw out of guardedLlmCall: it escaped through
  // guardedRaceEntry's makeCall() argument and fireWaveLegs' .map
  // (a wave's calls are built before the try that races them) into
  // the handler's top level catch, which shipped synthesisMode
  // "none", zero sources, and the internal error answer although
  // the shelf held citable papers. Now the refusal is an ordinary
  // failed leg and the run degrades like any all fail run.
  scenPapersFn = null;
  scenPapers = [
    epmc(81, "Creatine monohydrate supplementation and hair shedding: a randomized controlled trial",
      "Adults taking creatine monohydrate at five grams daily were followed for twelve weeks against placebo. Hair shedding counts and scalp hair density did not increase on creatine, and dihydrotestosterone remained within the normal range in both groups throughout the trial.", 500),
    epmc(82, "Creatine supplementation in athletes: a systematic review of safety outcomes",
      "Across forty one trials of creatine supplementation in athletes, adverse events were uncommon and mild. Hair outcomes were reported in three trials, none of which found increased hair shedding or hair loss on creatine compared with placebo at standard doses.", 400),
  ];
  scenAnswer =
    "**Creatine** did not increase hair shedding or hair density loss in the randomized trial that measured both [1]. " +
    "A systematic review of creatine in athletes likewise found no increase in hair shedding or hair loss across forty one trials [2].";
  resetBreakers();
  // A ten minute window: the registry hands this same instance to
  // search.js's own getBreaker calls, and no half open probe may
  // lapse mid scenario.
  getBreaker("llm:openrouter", { failureThreshold: 5, openTimeoutMs: 600000 }).open();
  let data;
  try {
    data = await runScenario("does creatine make your hair fall out");
  } finally {
    resetBreakers();
  }
  assert.equal(data.synthesisMode, "extractive",
    "the breaker open run should fall to the extractive tier, got: " + data.synthesisMode);
  assert.equal(data.degraded, true, "the breaker open run must ship degraded");
  assert.ok((data.sources || []).length >= 1,
    "the shelf's papers never shipped: " + JSON.stringify(data.sources));
  assert.ok(!/internal error/i.test(String(data.answer || "")),
    "the internal error answer shipped although the shelf could answer");
  assert.ok(!(data.stageHealth || []).some((s) => s.name === "request"),
    "the top level catch's synthetic request record shipped: " + JSON.stringify(data.stageHealth));
  const synth = (data.stageHealth || []).find((s) => s.name === "synthesis");
  assert.ok(synth, "the synthesis stage record is missing");
  assert.equal(synth.ok, false, "the synthesis stage must record failure");
  assert.equal(synth.winner, null, "a winner was named on a breaker refused run");
  assert.equal(synth.skipReason, "all legs failed");
  assert.ok((synth.failedLegs || []).length >= 1, "the breaker refusals are missing from failedLegs");
  for (const leg of synth.failedLegs || []) {
    assert.match(leg.error || "", /circuit open/i,
      "a failed leg does not name the breaker refusal: " + JSON.stringify(leg));
  }
});

await test("an open synthesis breaker over an empty shelf ships the honest no evidence state", async () => {
  // Same open breaker, nothing retrieved: the pipeline's own no
  // results shape is the honest serve. The defect's shape is
  // distinguishable from it and must not appear: the internal
  // error answer text, and a stageHealth consisting of only the
  // top level catch's synthetic "request" record.
  scenPapersFn = null;
  scenPapers = [];
  scenAnswer =
    "**Creatine** did not increase hair shedding or hair density loss in the randomized trial that measured both [1].";
  resetBreakers();
  getBreaker("llm:openrouter", { failureThreshold: 5, openTimeoutMs: 600000 }).open();
  let data;
  try {
    data = await runScenario("does creatine make your hair fall out");
  } finally {
    resetBreakers();
  }
  assert.equal(data.responseKind, "no-results",
    "an empty shelf should ship the no results shape, got: " + data.responseKind);
  assert.ok(!/internal error/i.test(String(data.answer || "")),
    "the internal error answer shipped on an empty shelf");
  assert.ok(!(data.stageHealth || []).some((s) => s.name === "request"),
    "the top level catch's synthetic request record shipped: " + JSON.stringify(data.stageHealth));
  const synth = (data.stageHealth || []).find((s) => s.name === "synthesis");
  assert.ok(synth, "the synthesis stage record is missing");
  assert.ok((synth.failedLegs || []).some((l) => /circuit open/i.test(l.error || "")),
    "the synthesis record does not name the breaker refusals: " + JSON.stringify(synth));
});

// ═══════════════════════════════════════════════════════════════════
group("subject engaging near floor rescue (2026-10-21, search fix wave, Lane A)");

await test("a subject engaging paper scored just under the old floor becomes citable", () => {
  // The Oct 21 before batch's smoking gun, reproduced at the
  // binding: the waste oil paper cleared the citation standard
  // (gateAudit standard true, legacy true) and died on the
  // single reason "relevance 45 below the floor of 50".
  const q = "if baby black soldier flies eat used cooking oil from restaurants do they turn out healthy";
  const paper = {
    title: "Waste oil substrates reshape the black soldier fly larval gut microbiome and biomass composition during bioconversion",
    abstract: "Black soldier fly larvae (BSFL) are generalist decomposers with promise for converting agricultural and food-processing by-products into value-added bioproducts, but BSFL performance on lipid-rich waste oil streams and the role of the gut microbiome in this process remain unclear. Here, we evaluated BSFL bioconversion of a standard chicken feed diet supplemented with three chemically distinct waste oils: acidulated vegetable oil (AVO), pork grease (PG), and used cooking oil (UCO). Larval performance, bioconversion rate, gut microbiome composition, total protein and fat content, and fatty-acid profiles were measured across bioconversion. Larval age was a major driver of gut microbiome structure, but waste oil supplementation further reshaped community membership and structure, with the strongest diet-associated effects occurring during early-to-intermediate bioconversion.",
    relevance: 45, topicalScore: 20,
  };
  // PIN UPDATED (2026-10-23, wave 3 lane S3, L3-4): the gate
  // now reads the topical component against the calibrated
  // topical floor (25), so the near miss fixture carries its
  // near miss on the topical scale (20, inside the 15 to 24
  // band) instead of a blended 45 under the old floor of 50.
  // The blended relevance stays 45 to pin that it no longer
  // governs the gate.
  const ctx = conceptGateContext([paper], q, null);
  assert.equal(subjectEngagingRescue(paper, ctx), true, "the rescue does not see the subject engaging near miss");
  assert.equal(paperIsCitable(paper, 1, ctx), true, "the near miss paper is still not citable");
  // The band is a near miss band, not a second floor at zero:
  // anything under the band (15) stays out.
  assert.equal(paperIsCitable({ ...paper, topicalScore: 14 }, 1, ctx), false, "a paper at topical 14 became citable");
  assert.equal(paperIsCitable({ ...paper, topicalScore: 5 }, 1, ctx), false, "a paper at topical 5 became citable");
  // A cap verdict about the paper itself (role inverted,
  // unverifiable) is never rescued.
  assert.equal(paperIsCitable({ ...paper, roleInverted: true }, 1, ctx), false, "a role inverted paper was rescued");
  assert.equal(paperIsCitable({ ...paper, unverifiableAbstract: true }, 1, ctx), false, "an unverifiable paper was rescued");
  // Junk at the same score does not ride in: it clears neither
  // the standard nor the engagement count.
  const junk = {
    title: "Soil desiccation cracks in ophthalmology patients",
    abstract: "A study of soil desiccation cracks observed in a clinic garden and eye surface dryness in patients attending an ophthalmology service in a dry season.",
    relevance: 45, topicalScore: 20,
  };
  assert.equal(paperIsCitable(junk, 1, ctx), false, "a junk paper at topical 20 became citable");
});

await test("the rescue covers the audit's other topics at the same near miss score", () => {
  const honeyQ = "does putting honey on a cut help it heal faster or is that just an old wives tale";
  const honeyPaper = {
    title: "Honey: An immunomodulator in wound healing",
    abstract: "Honey has been used in wound care for centuries. This review examines the immunomodulatory properties of honey in wound healing, its antibacterial activity, and clinical evidence for burns, ulcers and other wounds. Honey dressings modulate inflammation and support tissue repair in wound healing.",
    relevance: 45, topicalScore: 20,
  };
  // Topical scale pin (2026-10-23, L3-4): see the waste oil
  // test above; the near miss now sits at topical 20.
  assert.equal(paperIsCitable(honeyPaper, 1, conceptGateContext([honeyPaper], honeyQ, null)), true,
    "the honey review at topical 20 is not citable");
  const sleepQ = "what happens to your brain if you only sleep six hours every night for two weeks straight";
  const sleepPaper = {
    title: "The cumulative cost of additional wakefulness: dose-response effects on neurobehavioral functions and sleep physiology from chronic sleep restriction and total sleep deprivation",
    abstract: "Chronic sleep restriction to six hours per night for fourteen days produced cumulative deficits in neurobehavioral functions, lapses of attention and working memory equivalent to total sleep deprivation, while subjective sleepiness ratings plateaued.",
    relevance: 45, topicalScore: 20,
  };
  assert.equal(paperIsCitable(sleepPaper, 1, conceptGateContext([sleepPaper], sleepQ, null)), true,
    "the sleep restriction paper at topical 20 is not citable");
});

await test("a rescued paper survives the floor only recheck on its tag, and only on its tag", () => {
  // Topical scale pin (2026-10-23, L3-4): both records sit
  // below the topical gate floor (topicalScore 20 under the
  // floor of 25), so only the tag can carry one through.
  const tagged = { title: "x", topicalScore: 20, _subjectRescued: true };
  const untagged = { title: "y", topicalScore: 20 };
  const kept = applyRelevanceGate([tagged, untagged]);
  assert.deepEqual(kept, [tagged], "the tag discipline is wrong: " + JSON.stringify(kept));
});

await test("relaxation re admission carries the scorer's score, not the flat tier score (honey shape)", async () => {
  // The Oct 21 before batch's honey shape at the handler: the
  // on point papers fail the shelf filter (honey sits in
  // ORGANISM_WORDS, so the organism gate judges them), re enter
  // only through the emergency relaxation, and at the tiers'
  // old flat scores (20) could never be cited. With the
  // scorer's own scores carried, the same pool cites them.
  scenPapersFn = null;
  scenPapers = [
    epmc(71, "Honey: An immunomodulator in wound healing",
      "Honey has been used in wound care and healing for centuries and is increasingly used as a wound dressing in clinical practice. This review examines the immunomodulatory properties of honey in wound healing, its antibacterial activity against wound pathogens, and the clinical evidence for burns, ulcers and surgical wounds. Honey modulates inflammation, stimulates cytokine production and supports tissue repair, and honey dressings have shown faster healing in partial thickness burns and infected wounds compared with conventional dressings in several clinical studies.", 180),
    epmc(72, "From Bees to Bandages: Exploring Honey Nanoparticles for Effective Wound Management",
      "Honey nanoparticles are explored as a wound management platform. Honey carries antibacterial and anti inflammatory activity, and loading honey into nanoparticle dressings improves wound closure in animal wound models. This review covers honey composition, nanoparticle formulation, antibacterial assays and wound healing outcomes, and discusses clinical translation for chronic wounds and burns.", 12),
  ];
  scenAnswer =
    "Honey can help wounds heal: a review of honey as an immunomodulator in wound healing found antibacterial activity and support for tissue repair [1]. " +
    "Honey nanoparticle dressings also improved wound closure in wound models [2].";
  const data = await runScenario("does putting honey on a cut help it heal faster or is that just an old wives tale");
  const cited = (data.sources || []).filter((s) => !s.uncited);
  assert.ok(cited.length >= 1, "no honey paper cited over the stubbed pool: " + JSON.stringify((data.sources || []).map((s) => [s.title, s.relevance, s.uncited])));
  for (const s of cited) {
    assert.ok(s.relevance >= 50, "a cited honey paper carries a tier placeholder score instead of the scorer's: " + JSON.stringify([s.title, s.relevance]));
  }
});


console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
