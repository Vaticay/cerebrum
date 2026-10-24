/**
 * Citation wave Lane 1 (2026-10-24): funnel accounting and the
 * honey pool vanish.
 *
 * The live probe that opened this lane (query "does putting
 * honey on a cut help it heal faster or is that just an old
 * wives tale") shipped gathered 22, excludedWeak 3, cited 0,
 * with no recorded stage between the weak floor and the
 * citation gate owning the shrink from 19 shelf papers to 3
 * candidates. Two things are pinned here:
 *
 *   1. The funnel stage accounting itself: every stage between
 *      gathering and citation records its count and titles, and
 *      every paper that leaves between two stages is named in
 *      the later stage's dropped list (by title, with its filter
 *      reason where one is stamped).
 *   2. The honey case at unit level and end to end. With the
 *      live model expansion groups the probe carried, the
 *      gating standard recomputes deterministic fallback groups,
 *      which mint a singleton group for the frame verb
 *      "putting". The subject resolution then named "putting"
 *      the question's subject, no wound paper can engage an
 *      activity verb, and the subject serve replaced a cited
 *      answer with the no results state. The subject is the
 *      entity after the gerund opener: honey.
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 *
 * Run with: node tests/citation-funnel-lane1.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const search = await import(join(root, "functions/api/search.js"));
const { onRequest, createSubrequestLedger } = search;

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

const HONEY_Q = "does putting honey on a cut help it heal faster or is that just an old wives tale";

// The expansion groups the live probe carried, exactly as its
// record shows them (via a live model leg, each group marked).
function liveHoneyDyn() {
  const groups = [
    { term: "honey", alternates: ["bee honey", "honeycomb extract", "apis mellifera honey", "honey product"], _liveModel: true },
    { term: "cut", alternates: ["wound", "laceration", "skin incision", "cutaneous injury"], _liveModel: true },
    { term: "heal faster", alternates: ["accelerated healing", "faster wound closure", "improved tissue repair", "enhanced recovery", "time to wound closure", "rate of epithelialization"], _liveModel: true },
    { term: "old wives tale", alternates: ["folk belief", "traditional saying", "popular lore", "cultural anecdote"], _liveModel: true },
  ];
  groups.via = "groq";
  return search.buildDynLookup(groups);
}

const WOUND_ABS = "Honey dressings were compared with conventional dressings for wound healing in randomized trials. Time to complete healing, wound closure and infection were measured. Honey healed partial thickness burns and other wounds faster than conventional dressings in several trials, and honey dressings supported tissue repair.";
const woundPapers = () => ([
  { title: "Honey for treating wounds: a systematic review and meta analysis", abstractText: WOUND_ABS },
  { title: "Medical grade honey for minor cuts and lacerations: a randomized trial", abstractText: "Patients with minor cuts and lacerations received medical grade honey dressings or standard care. Wound closure time, healing rate and infection were measured over four weeks. The honey group showed faster epithelialization and fewer infections than standard care." },
]);

// ═══════════════════════════════════════════════════════════════════
group("funnel stage accounting — every paper named at every stage");

await test("a stage records its count, its titles, and its drops with reasons", () => {
  const before = [...woundPapers(), { title: "Dropped paper", _filteredReason: "weak floor" }];
  const after = woundPapers();
  const dropped = search.funnelDroppedBetween(before, after);
  assert.equal(dropped.length, 1, "exactly one paper left between the lists");
  const stage = search.funnelStageOf("demo", after, dropped);
  assert.equal(stage.stage, "demo");
  assert.equal(stage.count, 2);
  assert.deepEqual(stage.titles, after.map((p) => p.title));
  assert.deepEqual(stage.dropped, [{ title: "Dropped paper", reason: "weak floor" }]);
});

await test("duplicate titles are accounted one copy per occurrence", () => {
  const before = [{ title: "Same title" }, { title: "Same title" }, { title: "Other title" }];
  const after = [{ title: "Same title" }];
  const dropped = search.funnelDroppedBetween(before, after).map((p) => p.title).sort();
  assert.deepEqual(dropped, ["Other title", "Same title"],
    "one copy of the repeated title survives, the other is accounted as dropped");
});

await test("stage titles and drops are bounded, the count is not", () => {
  const many = Array.from({ length: 45 }, (_, i) => ({ title: "Paper " + (i + 1) }));
  const stage = search.funnelStageOf("wide", many, many);
  assert.equal(stage.count, 45, "the count reports the full stage size");
  assert.equal(stage.titles.length, search.FUNNEL_STAGE_TITLES_CAP);
  assert.equal(stage.dropped.length, search.FUNNEL_STAGE_TITLES_CAP);
});

await test("a chain of stages accounts for every gathered paper", () => {
  const shelf = [
    { title: "Kept to the end" },
    { title: "Leaves at the gate", _filteredReason: "gate" },
    { title: "Leaves at the filter", _filteredReason: "filter" },
  ];
  const afterFilter = shelf.filter((p) => p.title !== "Leaves at the filter");
  const afterGate = afterFilter.filter((p) => p.title !== "Leaves at the gate");
  const stages = [
    search.funnelStageOf("shelf", shelf, []),
    search.funnelStageOf("filter", afterFilter, search.funnelDroppedBetween(shelf, afterFilter)),
    search.funnelStageOf("gate", afterGate, search.funnelDroppedBetween(afterFilter, afterGate)),
  ];
  const accounted = new Set(stages[stages.length - 1].titles);
  for (const s of stages) for (const d of s.dropped || []) accounted.add(d.title);
  assert.deepEqual([...accounted].sort(), shelf.map((p) => p.title).sort(),
    "every gathered title is either in the final stage or named in a dropped list");
});

// ═══════════════════════════════════════════════════════════════════
group("honey subject — the entity after the gerund opener is the subject");

await test("the subject of the honey question is honey, not putting", () => {
  const dyn = liveHoneyDyn();
  assert.ok(dyn._liveModelVia, "the fixture lookup must carry the live model mark");
  const gateDyn = search.gateDynLookup(HONEY_Q, dyn);
  const groups = search.gateConceptGroups(HONEY_Q, dyn);
  const subject = search.subjectConceptGroup(HONEY_Q, groups, gateDyn);
  assert.ok(subject, "no subject resolved for the honey question");
  assert.ok(subject.has("honey"), "the subject group is not the honey group: " + JSON.stringify([...subject]));
  assert.ok(!subject.has("putting"), "the frame verb is still the subject");
  const central = search.questionCentralConcepts(HONEY_Q, gateDyn);
  const subj = central.find((c) => c && c.subject);
  assert.ok(subj, "no central concept is marked as the subject");
  assert.equal(subj.term, "honey", "the central subject term is " + subj.term);
});

await test("wound papers engage the honey subject; the cited set stands", () => {
  const dyn = liveHoneyDyn();
  const papers = woundPapers();
  const verdict = search.citedSetEngagesSubject(papers, new Set([1, 2]), HONEY_Q, dyn);
  assert.deepEqual(
    { judged: verdict.judged, engaged: verdict.engaged, subjectTerm: verdict.subjectTerm },
    { judged: true, engaged: true, subjectTerm: "honey" },
    "the subject serve would still kill a wound paper answer");
  const pool = search.subjectEngagingEvidence(papers, HONEY_Q, dyn);
  assert.equal(pool.judged, true);
  assert.equal(pool.subjectTerm, "honey");
  assert.deepEqual(pool.papers.map((p) => p.title), papers.map((p) => p.title),
    "the rebuild pool lost a wound paper");
});

// ═══════════════════════════════════════════════════════════════════
group("honey end to end — the cited answer ships, stages on the record");

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
const epmc = (n, title, abstractText, citedByCount, yr = "2020") => ({
  title, doi: "10.1000/h" + n, pubYear: yr, citedByCount,
  authorString: "Doe J, Roe K", journalTitle: "Journal of Recorded Studies", abstractText,
});

await test("the honey pool ships its cited answer and the record names every stage", async () => {
  const scenPapers = [
    epmc(1, "Honey for treating wounds: a systematic review and meta analysis", WOUND_ABS, 900, "2015"),
    epmc(2, "Honey as a topical treatment for wounds: systematic review", "This systematic review assessed honey used as a dressing on wounds including burns, ulcers and surgical wounds. Honey may heal partial thickness burns more quickly than conventional treatment and infected postoperative wounds faster than antiseptic dressings.", 700, "2015"),
    epmc(3, "Honey: An immunomodulator in wound healing", "Honey has been used in wound care and healing for centuries and is increasingly used as a wound dressing in clinical practice. This review examines the immunomodulatory properties of honey in wound healing, its antibacterial activity against wound pathogens, and the clinical evidence for burns, ulcers and surgical wounds. Honey modulates inflammation and supports tissue repair, and honey dressings have shown faster healing in partial thickness burns.", 500, "2014"),
    epmc(4, "Medical grade honey for minor cuts and lacerations: a randomized trial", "Patients with minor cuts and lacerations received medical grade honey dressings or standard care. Wound closure time, healing rate and infection were measured over four weeks. The honey group showed faster epithelialization and fewer infections than standard care.", 60, "2022"),
    epmc(5, "Sublethal Effects and Associated Risks of Acaricides Used Against Varroa destructor in Honey Bee (Apis mellifera) Colonies", "Acaricides used against Varroa destructor in honey bee colonies were reviewed for sublethal effects on bees, including exposure through honey and wax residues in the hive.", 0, "2026"),
    epmc(6, "DETERMINATION OF HONEY BEE (Apis mellifera) BACTERIAL FLORA, CRY GENE ANALYSIS AND HONEY BEE HEALTH", "Honey bee bacterial flora was determined and cry gene analysis performed to assess honey bee health and honey production in colonies sampled across apiaries.", 3, "2021"),
    epmc(7, "Honey for acute cough in children: a systematic review", "Honey was compared with no treatment and with diphenhydramine for acute cough in children. Parents rated cough frequency and severity; honey scored better than no treatment for cough symptoms overnight.", 300, "2018"),
    epmc(8, "Antibacterial activity of honey against wound pathogens in vitro", "Honey samples were tested against bacterial strains isolated from wound infections. All honey samples inhibited growth of the wound pathogens tested, with manuka honey showing the strongest antibacterial activity in laboratory assays.", 150, "2019"),
    epmc(9, "Honey consumption and metabolic health: a cohort study", "Adults reporting regular honey consumption were followed for metabolic outcomes. Honey intake was recorded by food frequency questionnaire and compared with sugar intake for weight and glucose measures.", 40, "2020"),
    epmc(10, "The composition of honey: sugars, enzymes and phenolic compounds", "Honey composition was analysed across floral sources. Sugar profiles, enzyme activity and phenolic compounds in honey varied by source and season of harvest.", 80, "2017"),
    epmc(11, "Honey bee pollination services in almond orchards", "Honey bee colonies were placed in almond orchards and pollination outcomes measured. Colony strength and hive placement changed nut set in the orchards studied.", 25, "2019"),
    epmc(12, "Wound healing after surgical incision: a review of closure methods", "Surgical wound closure methods were reviewed, including sutures, staples and adhesive strips. Healing time and infection after incision closure were compared across methods in surgical patients.", 90, "2016"),
  ];
  const scenAnswer =
    "## Summary\n\n" +
    "**Honey** dressings healed wounds faster than conventional dressings in the trials gathered in the systematic review [1]. " +
    "A second systematic review found honey may heal partial thickness burns more quickly than conventional treatment [2].\n\n" +
    "## Limits\n\n" +
    "The trials are varied, their samples are small, and few followed anyone past twelve weeks.";
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  globalThis.caches = { default: { match: async () => undefined, put: async () => {}, delete: async () => false } };
  Math.random = () => 0.99;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = typeof opts.body === "string" ? opts.body : "";
    if (u.includes("generativelanguage.googleapis.com") || u.includes("api.mistral.ai") ||
        u.includes("integrate.api.nvidia.com") || u.includes("openrouter.ai") || u.includes("api.groq.com")) {
      if (body.includes("literature search specialist")) {
        // The live probe's expansion, returned as validated
        // groups by the model leg (a live marked lookup).
        return chatRes(JSON.stringify([
          { term: "honey", alternates: ["bee honey", "honeycomb extract", "apis mellifera honey", "honey product"] },
          { term: "cut", alternates: ["wound", "laceration", "skin incision", "cutaneous injury"] },
          { term: "heal faster", alternates: ["accelerated healing", "faster wound closure", "improved tissue repair", "enhanced recovery", "time to wound closure", "rate of epithelialization"] },
          { term: "old wives tale", alternates: ["folk belief", "traditional saying", "popular lore", "cultural anecdote"] },
        ]));
      }
      if (body.includes("relevance validator")) return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
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
  let data;
  try {
    const ledger = createSubrequestLedger(undefined);
    const env = { DB: rgDb(), OPENROUTER_KEY: "rg-test-openrouter-key-123456", GROQ_KEY: "rg-test-groq-key-123456" };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: HONEY_Q }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }

  // The answer ships: not the no results state the probe hit.
  assert.equal(data.synthesisMode, "ai", "the honey answer did not ship as AI synthesis: " + data.synthesisMode);
  assert.notEqual(data.responseKind, "no-results", "the honey answer fell to no results");
  assert.ok(!String(data.answer || "").startsWith("## No citable literature surfaced"),
    "the no citable literature head shipped");
  const cited = (data.sources || []).filter((s) => !s.uncited);
  assert.ok(cited.length >= 2, "fewer than two papers cited: " + JSON.stringify(cited.map((s) => s.title)));
  const citedTitles = cited.map((s) => s.title);
  assert.ok(citedTitles.includes("Honey for treating wounds: a systematic review and meta analysis"),
    "the wound systematic review is not cited: " + JSON.stringify(citedTitles));
  assert.ok(citedTitles.every((t) => /Honey|honey/.test(t) && !/Acaricides|BACTERIAL FLORA|pollination/.test(t)),
    "an off topic paper was cited: " + JSON.stringify(citedTitles));

  // The subject serve did not fire against the frame verb.
  const serve = data._record && data._record.subjectServe;
  assert.ok(!(serve && serve.fired), "the subject serve fired: " + JSON.stringify(serve));

  // The record's funnel stages: every stage present, the gate
  // stage carrying the citable count the probe could not see,
  // and exact title accounting between consecutive stages.
  const stages = data._record && data._record.funnel && data._record.funnel.stages;
  assert.ok(Array.isArray(stages), "the record funnel carries no stages");
  const names = stages.map((s) => s.stage);
  for (const want of ["shelf", "englishFilter", "nonScholarlyFilter", "evidenceFilter",
    "constraintFilter", "programmaticPasses", "citationGate", "evidenceSlice",
    "validation", "finalGate", "subjectServe", "shipped"]) {
    assert.ok(names.includes(want), "stage missing from the record: " + want + " in " + JSON.stringify(names));
  }
  const gate = stages.find((s) => s.stage === "citationGate");
  assert.match(gate.note || "", /citableBefore=[1-9]/,
    "the citation gate stage does not record a nonzero citable count: " + gate.note);
  for (const t of ["Honey for treating wounds: a systematic review and meta analysis",
    "Honey as a topical treatment for wounds: systematic review",
    "Medical grade honey for minor cuts and lacerations: a randomized trial"]) {
    assert.ok(gate.titles.includes(t), "an on topic paper did not survive to the citable set: " + t);
  }
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1];
    const cur = stages[i];
    const remaining = new Map();
    for (const t of prev.titles) remaining.set(t, (remaining.get(t) || 0) + 1);
    for (const t of cur.titles) {
      assert.ok((remaining.get(t) || 0) > 0,
        `stage ${cur.stage} holds a title ${prev.stage} did not: ${t}`);
      remaining.set(t, remaining.get(t) - 1);
    }
    const expectedDropped = [];
    for (const [t, c] of remaining) for (let k = 0; k < c; k++) expectedDropped.push(t);
    const actualDropped = (cur.dropped || []).map((d) => d.title);
    assert.deepEqual(actualDropped.slice().sort(), expectedDropped.slice().sort(),
      `stage ${cur.stage} does not account for every paper that left after ${prev.stage}`);
    assert.equal(prev.count - cur.count, expectedDropped.length,
      `stage ${cur.stage} count moved without a matching dropped list`);
  }
  const shipped = stages[stages.length - 1];
  assert.equal(shipped.stage, "shipped");
  assert.equal(shipped.count, cited.length, "the shipped stage count is not the cited count");

  // The public funnel stays numbers only, as before this wave.
  assert.ok(data._funnel && !("stages" in data._funnel), "stage detail leaked into the public funnel");
  assert.ok((data._funnel.excludedWeakTitles || []).length <= 5,
    "the public funnel title bound changed");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
