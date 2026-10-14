/**
 * Search wave eight (2026-10-14, seventh panel): the citation
 * standard in substance.
 *
 * The seventh panel's verdict on wave seven: the per paper
 * binding was built, but the standard it binds to is vacuous —
 * a single subject group touch cleared regardless of the
 * question's other concepts, relevance was lexical (junk scored
 * 57 to 92), the coverage gate refused to ever empty a cited
 * set, and the honest no evidence state fired on questions WITH
 * literature (ankle sprain, swimmer's ear) while sparing
 * questions with none (the sock and grocery checkout shapes
 * cited junk). The fixtures below pin the corrected contract on
 * the panel's own specimen shapes:
 *
 *   Job 1a: a group keyed on a closed class word ("while") is
 *     not a gating group; function words grow no alternates.
 *   Job 1b: a citable paper engages at least two of the
 *     question's central concepts with an abstract engagement,
 *     or carries the subject and a second concept in its title.
 *     The sock shape ships no evidence; the grocery checkout
 *     shape ships no evidence; the ankle shape cites its topical
 *     papers; the yogurt shape cites the probiotic reviews and
 *     not the fermentation critique.
 *   Job 1c: a paper engaging zero central concepts cannot score
 *     above the floor (exercised end to end: the junk pools
 *     above produce no citable paper at all).
 *   Job 2: the coverage gate can empty a cited set. A draft
 *     citing only junk is demoted in full; over an empty citable
 *     pool the run ships the no evidence state (the sock and
 *     checkout handler shapes), and the handler's zero citation
 *     flip (pinned since wave four) routes a mixed pool to the
 *     extractive tier.
 *   Job 3: rungs and frames keep the subject: the fix frame
 *     identifies yogurt, the will/hurt frame identifies coffee,
 *     the coffee structured query anchors coffee and never
 *     "while", and expansion mints no "whiles".
 *   Job 4a: a settled verdict over a junk cited set is guarded
 *     to thin, and the confidence line follows it down.
 *   Job 4b: an AI answer the final fact check supports on none
 *     of its checked claims degrades to the extractive tier over
 *     citable papers instead of shipping as a research answer.
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 * Handler scenarios run the real onRequest against a counting
 * stub env modeled on tests/search-wave-seven.mjs.
 *
 * Run with: node tests/search-wave-eight.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const search = await import(join(root, "functions/api/search.js"));
const { onRequest, createSubrequestLedger } = search;
const {
  citationGateStandard, paperClearsCitationGate, applyConceptCoverageGate,
  gateConceptGroups, subjectConceptGroup, questionCentralConcepts,
  centralConceptHits, buildStructuredQuery, buildDeterministicFallbackGroups,
  buildDynLookup, centralContentTerms, pluralFormOf, validateExpansionGroups,
  guardSettledVerdict, buildDisagreementVerdict, buildConfidenceLine,
  conceptGateContext, isGateFunctionWord,
} = search;

// The standard the handler actually judges with: the deterministic
// fallback lookup for the question's uncovered central terms (the
// model expansion leg is weather in these fixtures, exactly as
// the earlier wave suites model it).
const dynFor = (q) => buildDynLookup(buildDeterministicFallbackGroups(q, centralContentTerms(q)));

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
  globalThis.fetch = async (url, opts2 = {}) => {
    const u = String(url);
    const body = typeof opts2.body === "string" ? opts2.body : "";
    if (u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("openrouter.ai")) {
      if (body.includes("literature search specialist")) {
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
      OPENROUTER_KEY: "w8-test-openrouter-key-123456",
    };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, settings: opts.settings || {} }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return { data, queries: scenQueryLog.slice() };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
    scenQueryLog = [];
  }
}

const epmc = (n, title, abstractText, citedByCount) => ({
  title,
  doi: "10.1000/w8" + n,
  pubYear: "2024",
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});

// The Europe PMC fixture shape the stub fetcher returns; the
// handler normalizes it into { title, abstract } papers. Unit
// tests judge the normalized shape, exactly as the gate sees it.
const asPaper = (p) => ({ title: p.title, abstract: p.abstractText, url: "https://doi.org/" + p.doi });

// ── The panel's specimen papers ────────────────────────────────
const SOCK_Q = "why does my left sock keep disappearing in the dryer";
const CHATBOT_PAPER = () => epmc(201, "On Chatbots and Generative Artificial Intelligence",
  "Chatbots built on large language models are entering classrooms and workplaces. This essay surveys what generative artificial intelligence can and cannot do for writing instruction, and argues that teachers need new norms for disclosure when a machine drafts the text.", 800);
const HARMONICA_PAPER = () => epmc(202, "The Harmonica: a history of a free reed instrument",
  "The harmonica spread from Vienna workshops to blues stages in a century. This history traces the free reed, the tuning of its plates, and the players who made a pocket instrument carry melody and chord together.", 300);

const CHECKOUT_Q = "how long is the wait at the grocery store checkout";
const JOB_SAT_PAPER = () => epmc(203, "Job satisfaction among grocery store employees",
  "Supermarket cashiers and shelf staff were surveyed about pay, shifts, and morale. Job satisfaction among grocery employees tracked supervisor support and break schedules, and turnover intentions were highest among staff working the deli counters.", 950);
const FRUIT_PROMO_PAPER = () => epmc(204, "Fruit promotion at the grocery store raises produce sales",
  "Promotional displays of fruit near the entrance of a grocery store increased produce sales over eight weeks. Shoppers exposed to the promotion bought more fruit per visit, with the strongest effect in the first fortnight of the campaign.", 700);

const ANKLE_Q = "what should I do for a sprained ankle";
const ANKLE_MANAGEMENT = () => epmc(205, "Acute ankle sprain management in primary care",
  "Ankle sprains are among the most common musculoskeletal injuries seen in primary care. For a sprained ankle, protection, rest, ice, compression, and elevation in the first days after the injury limit swelling, and early gentle mobilization speeds recovery of the injured ligament.", 620);
const ANKLE_REHAB = () => epmc(206, "Rehabilitation after lateral ankle sprain: a randomized trial",
  "Patients with a lateral ankle sprain were randomized to supervised rehabilitation or usual care after the injury. Balance and strength training after the sprain reduced recurrent ankle injury over twelve months of follow up.", 410);
const ANKLE_MONITOR = () => epmc(207, "Ankle monitors in criminal justice: compliance and outcomes",
  "Electronic ankle monitors are used to supervise people awaiting trial. This study reports compliance rates, technical violations, and court appearance outcomes across three counties using location monitoring.", 500);

const YOGURT_Q = "can eating yogurt fix an upset stomach after taking antibiotics";
const YOGURT_REVIEW_1 = () => epmc(208, "Probiotic supplementation during antibiotic therapy: a systematic review",
  "Trials of probiotic preparations given alongside antibiotics were pooled in this systematic review. Probiotic use during an antibiotic course reduced antibiotic associated diarrhoea, and Lactobacillus strains were the most studied preparations.", 880);
const YOGURT_REVIEW_2 = () => epmc(209, "Live cultures for antibiotic associated gut upset",
  "Patients taking antibiotics received yogurt cultures or a placebo drink. The yogurt groups reported less stomach upset and fewer loose stools during the antibiotic course than the placebo groups.", 350);
const FERMENTATION_CRITIQUE = () => epmc(210, "Against healthist fermentation",
  "Fermented milk has been recast as a moral duty in wellness culture. This essay argues that the health claims made for fermented foods rest on thin evidence and thick marketing, and that fermentation itself has become a lifestyle signifier.", 275);

const COFFEE_Q = "will drinking coffee while pregnant hurt the baby";
const COFFEE_PAPER = () => epmc(211, "Coffee consumption during pregnancy and birth outcomes",
  "Pregnant people who drank coffee daily were followed to delivery in this cohort. Caffeine intake from coffee was recorded each trimester, and the baby's birth weight and gestational age were compared across intake levels.", 730);

const galaxyJunk = (n) => epmc(300 + n, "Galaxy survey catalogue entry " + n,
  "We present a catalogue of galaxies observed with a wide field telescope. Star formation rates, stellar masses, and morphologies are tabulated for each galaxy, and the survey volume is complete to a stated magnitude limit.", 50);

// ═══════════════════════════════════════════════════════════════
group("Job 1a — closed class groups never gate, function words grow nothing");

await test("the gate's group set excludes the group keyed on 'while'", () => {
  const dyn = dynFor(COFFEE_Q);
  const whileGroup = dyn.get("while");
  assert.ok(whileGroup, "fixture precondition: the fallback lookup mints an entry for 'while'");
  const gateGroups = gateConceptGroups(COFFEE_Q, dyn);
  assert.ok(!gateGroups.includes(whileGroup),
    "the 'while' group reached the gate's group set");
  for (const g of gateGroups) {
    assert.ok(![...g].every((m) => isGateFunctionWord(m)),
      "a gating group consists only of function words: " + JSON.stringify([...g]));
  }
});

await test("expansion generates no forms for closed class words", () => {
  assert.equal(pluralFormOf("while"), null, "'while' grew a plural");
  assert.equal(pluralFormOf("always"), null, "'always' grew a plural");
  const rejected = validateExpansionGroups(
    [{ term: "while", alternates: ["whilst", "whiles"] }], COFFEE_Q);
  assert.deepEqual(rejected, [], "a model proposed group for 'while' was admitted");
  const admitted = validateExpansionGroups(
    [{ term: "coffee", alternates: ["caffeine", "espresso"] }], COFFEE_Q);
  assert.equal(admitted.length, 1, "a real concept group was refused alongside");
});

// ═══════════════════════════════════════════════════════════════
group("Job 1b — the standard judges topicality (unit)");

await test("central concepts resolve on the specimen questions", () => {
  const terms = (q) => questionCentralConcepts(q, dynFor(q)).map((c) => c.term);
  assert.deepEqual(terms("Do the germs in a baby's belly change how well the baby grows?"),
    ["germs", "belly", "baby"]);
  assert.deepEqual(terms("does not getting enough sleep make you more likely to catch a cold"),
    ["sleep", "cold"]);
  assert.deepEqual(terms(YOGURT_Q), ["yogurt", "upset", "antibiotics"]);
  // 2026-10-14 (wave eight arbitration): the coffee list gains
  // "pregnant" — the head of "pregnant hurt baby" is the bare
  // word baby, so the phrase admits its most specific token
  // under the unbacked head rule in questionCentralConcepts.
  // Pregnant is a genuine central term of this question, and
  // the strong concept rule keeps it honest: a paper engaging
  // pregnant alone still cannot clear without coffee.
  assert.deepEqual(terms(COFFEE_Q), ["coffee", "baby", "pregnant"]);
  assert.deepEqual(terms(ANKLE_Q).sort(), ["ankle", "sprained"]);
  const checkout = terms(CHECKOUT_Q);
  assert.ok(checkout.includes("grocery") && checkout.includes("checkout"),
    "checkout concepts lost the question's heads: " + JSON.stringify(checkout));
  assert.ok(!checkout.includes("while"),
    "checkout concepts carry scaffolding: " + JSON.stringify(checkout));
});

await test("the sock shape papers engage nothing central", () => {
  const std = citationGateStandard(SOCK_Q, dynFor(SOCK_Q));
  assert.equal(paperClearsCitationGate(asPaper(CHATBOT_PAPER()), std), false,
    "the chatbot paper clears the sock standard");
  assert.equal(paperClearsCitationGate(asPaper(HARMONICA_PAPER()), std), false,
    "the harmonica paper clears the sock standard");
});

await test("the grocery checkout papers engage at most one central concept", () => {
  const std = citationGateStandard(CHECKOUT_Q, dynFor(CHECKOUT_Q));
  const concepts = std.centralConcepts;
  assert.ok(centralConceptHits(asPaper(JOB_SAT_PAPER()), concepts).total <= 1,
    "the job satisfaction paper engages more than one central concept: " +
    JSON.stringify(centralConceptHits(asPaper(JOB_SAT_PAPER()), concepts)));
  assert.equal(paperClearsCitationGate(asPaper(JOB_SAT_PAPER()), std), false,
    "the job satisfaction paper clears the checkout standard");
  assert.equal(paperClearsCitationGate(asPaper(FRUIT_PROMO_PAPER()), std), false,
    "the fruit promotion paper clears the checkout standard");
});

await test("the ankle papers clear, the ankle monitor does not", () => {
  const std = citationGateStandard(ANKLE_Q, dynFor(ANKLE_Q));
  assert.equal(paperClearsCitationGate(asPaper(ANKLE_MANAGEMENT()), std), true,
    "the ankle management paper fails its own question's standard");
  assert.equal(paperClearsCitationGate(asPaper(ANKLE_REHAB()), std), true,
    "the ankle rehabilitation paper fails its own question's standard");
  assert.equal(paperClearsCitationGate(asPaper(ANKLE_MONITOR()), std), false,
    "the ankle monitor paper clears on the shared word 'ankle' alone");
});

await test("the yogurt reviews clear on the bridged concepts, the critique does not", () => {
  const std = citationGateStandard(YOGURT_Q, dynFor(YOGURT_Q));
  assert.equal(paperClearsCitationGate(asPaper(YOGURT_REVIEW_1()), std), true,
    "the probiotic review fails the yogurt standard (probiotic must bridge to yogurt)");
  assert.equal(paperClearsCitationGate(asPaper(YOGURT_REVIEW_2()), std), true,
    "the live cultures review fails the yogurt standard");
  assert.equal(paperClearsCitationGate(asPaper(FERMENTATION_CRITIQUE()), std), false,
    "the fermentation critique clears on its one concept engagement");
});

await test("the title exception: subject plus a second concept in the title clears without an abstract engagement", () => {
  const std = citationGateStandard(COFFEE_Q, dynFor(COFFEE_Q));
  const titleOnly = {
    title: "Coffee and the baby: what the cohort measured",
    abstract: "Recruitment ran through three maternity clinics over two winters. Interviewers were trained centrally, and the protocol was registered before enrolment opened.",
  };
  assert.equal(paperClearsCitationGate(titleOnly, std), true,
    "a title carrying coffee and baby should clear on the title exception");
  const titleOneConcept = {
    title: "Coffee: a methods note",
    abstract: "Recruitment ran through three maternity clinics over two winters. Interviewers were trained centrally, and the protocol was registered before enrolment opened.",
  };
  assert.equal(paperClearsCitationGate(titleOneConcept, std), false,
    "a title carrying one concept and an off topic abstract cleared");
});

// ═══════════════════════════════════════════════════════════════
group("Jobs 1b and 1c — handler level: junk pools ship no evidence, topical pools cite");

await test("handler: the sock shape ships the no evidence state", async () => {
  scenPapersFn = null;
  scenPapers = [CHATBOT_PAPER(), HARMONICA_PAPER()];
  for (let i = 1; i <= 10; i++) scenPapers.push(galaxyJunk(i));
  scenAnswer = "Your left sock disappears because of static cling and the dryer drum gap [1]. The harmonica has nothing to do with it [2].";
  const { data } = await runScenario(SOCK_Q);
  assert.equal(data.responseKind, "no-results",
    "the sock shape shipped an answer instead of the no evidence state: " + data.responseKind);
  assert.ok(!(data.sources || []).some((s) => !s.uncited),
    "a paper shipped as cited on the sock shape: " + JSON.stringify(data.sources));
});

await test("handler: the grocery checkout shape ships the no evidence state", async () => {
  scenPapersFn = null;
  scenPapers = [JOB_SAT_PAPER(), FRUIT_PROMO_PAPER()];
  for (let i = 1; i <= 10; i++) scenPapers.push(galaxyJunk(i));
  scenAnswer = "Waits at the grocery checkout depend on staffing and shopper satisfaction [1]. Promotions change how people shop [2].";
  const { data } = await runScenario(CHECKOUT_Q);
  assert.equal(data.responseKind, "no-results",
    "the checkout shape shipped an answer instead of the no evidence state: " + data.responseKind);
  assert.ok(!(data.sources || []).some((s) => !s.uncited),
    "a paper shipped as cited on the checkout shape: " + JSON.stringify(data.sources));
});

await test("handler: the ankle shape cites its topical papers and not the monitor paper", async () => {
  scenPapersFn = null;
  scenPapers = [ANKLE_MANAGEMENT(), ANKLE_REHAB(), ANKLE_MONITOR()];
  scenAnswer =
    "For a sprained ankle, protection, rest, ice, compression, and elevation in the first days limit swelling [1]. " +
    "Supervised rehabilitation after a lateral ankle sprain reduces recurrent injury [2]. " +
    "Electronic monitoring is a separate field entirely [3].";
  const { data } = await runScenario(ANKLE_Q, { limit: 300 });
  assert.equal(data.synthesisMode, "ai", "the ankle scenario must ship the AI answer, got: " + data.synthesisMode);
  const citedTitles = (data.sources || []).filter((s) => !s.uncited).map((s) => s.title);
  assert.deepEqual(citedTitles.sort(), [
    "Acute ankle sprain management in primary care",
    "Rehabilitation after lateral ankle sprain: a randomized trial",
  ], "the ankle cited set is wrong: " + JSON.stringify(citedTitles));
  for (const s of data.sources || []) {
    if (s.title.startsWith("Ankle monitors")) {
      assert.equal(s.uncited, true, "the ankle monitor paper shipped as cited");
    }
  }
});

await test("handler: the yogurt shape cites the reviews, not the fermentation critique", async () => {
  scenPapersFn = null;
  scenPapers = [FERMENTATION_CRITIQUE(), YOGURT_REVIEW_1(), YOGURT_REVIEW_2()];
  // The presented list is the citable set in coverage order:
  // [1] the live cultures trial, [2] the probiotic review. The
  // fermentation critique engages one central concept only, so
  // under the wave eight standard it is not citable and never
  // reaches the presented list — the reviews are cited over it
  // by construction, which is the brief's specimen outcome. (An
  // earlier draft of this fixture cited the pool order; the
  // synthesis race refused that draft because its first sentence
  // cited a review for the critique's claim, which is the race's
  // own support check working as designed.)
  scenAnswer =
    "Yogurt cultures lessened stomach upset during the antibiotic course [1]. " +
    "Probiotic preparations during an antibiotic course reduced antibiotic associated diarrhoea [2].";
  const { data } = await runScenario(YOGURT_Q, { limit: 300 });
  assert.equal(data.synthesisMode, "ai", "the yogurt scenario must ship the AI answer, got: " + data.synthesisMode);
  const citedTitles = (data.sources || []).filter((s) => !s.uncited).map((s) => s.title);
  assert.deepEqual(citedTitles.sort(), [
    "Live cultures for antibiotic associated gut upset",
    "Probiotic supplementation during antibiotic therapy: a systematic review",
  ], "the yogurt cited set is wrong: " + JSON.stringify(citedTitles));
  for (const s of data.sources || []) {
    if (s.title.startsWith("Against healthist fermentation")) {
      assert.equal(s.uncited, true, "the fermentation critique shipped as cited");
    }
  }
});

// ═══════════════════════════════════════════════════════════════
group("Job 2 — the coverage gate can empty a cited set");

await test("a draft citing only junk over a mixed pool is demoted in full", () => {
  const papers = [asPaper(ANKLE_MANAGEMENT()), asPaper(ANKLE_REHAB()), asPaper(ANKLE_MONITOR())];
  const answer = "Electronic monitoring is what the evidence shows [3].";
  const out = applyConceptCoverageGate(answer, papers, ANKLE_Q, dynFor(ANKLE_Q));
  assert.deepEqual(out.demoted.map((d) => d.idx), [3],
    "the junk citation was not demoted: " + JSON.stringify(out.demoted));
  assert.ok(!/\[\d+\]/.test(out.text),
    "a citation marker survived the full demotion: " + out.text);
});

await test("a draft citing only junk over a pool with no citable paper is demoted in full", () => {
  const papers = [asPaper(CHATBOT_PAPER()), asPaper(HARMONICA_PAPER())];
  const answer = "Chatbots explain the missing sock [1], and the harmonica agrees [2].";
  const out = applyConceptCoverageGate(answer, papers, SOCK_Q, dynFor(SOCK_Q));
  assert.deepEqual(out.demoted.map((d) => d.idx), [1, 2],
    "the all junk cited set was not demoted in full: " + JSON.stringify(out.demoted));
  assert.ok(!/\[\d+\]/.test(out.text), "a citation marker survived: " + out.text);
});

// ═══════════════════════════════════════════════════════════════
group("Job 3 — rungs and frames keep the subject");

await test("the fix frame identifies the yogurt subject", () => {
  const groups = gateConceptGroups(YOGURT_Q, dynFor(YOGURT_Q));
  const subject = subjectConceptGroup(YOGURT_Q, groups, dynFor(YOGURT_Q));
  assert.ok(subject && subject.has("yogurt"),
    "the fix frame did not identify the yogurt group: " + (subject ? JSON.stringify([...subject]) : "null"));
});

await test("the will and hurt frame identifies the coffee subject", () => {
  const groups = gateConceptGroups(COFFEE_Q, dynFor(COFFEE_Q));
  const subject = subjectConceptGroup(COFFEE_Q, groups, dynFor(COFFEE_Q));
  assert.ok(subject && subject.has("coffee"),
    "the will frame did not identify the coffee group: " + (subject ? JSON.stringify([...subject]) : "null"));
});

await test("the coffee structured query anchors coffee and never 'while'", () => {
  const sq = buildStructuredQuery(COFFEE_Q);
  assert.ok(/(^|\s)coffee(\s|$)/.test(" " + sq + " ") || sq.includes("coffee"),
    "the coffee structured query lost coffee: " + sq);
  assert.ok(!/\bwhile\b/.test(sq),
    "the coffee structured query still anchors 'while': " + sq);
});

// ═══════════════════════════════════════════════════════════════
group("Job 4a — the verdict cannot be settled over a junk cited set");

const JUNK_CITED_SET = () => ([
  { title: "A poem about loss", abstract: "Verses on grief and absence, in three cantos.", relevance: 55, year: 2021 },
  { title: "Disappearing mass in laundry systems", abstract: "Socks and small garments vanish in shared laundry rooms; a counting study.", relevance: 62, year: 2022 },
  { title: "Mass loss phenomena in households", abstract: "Household objects go missing at rates nobody has explained.", relevance: 50, year: 2020 },
  { title: "On missing mass", abstract: "An essay on things that disappear from drawers.", relevance: 58, year: 2023 },
]);

await test("a settled verdict over the junk cited set is guarded to thin", () => {
  const settled = buildDisagreementVerdict([], 4);
  assert.equal(settled.status, "settled", "fixture precondition: four sources, no conflicts reads settled");
  const ctx = conceptGateContext(JUNK_CITED_SET(), SOCK_Q, dynFor(SOCK_Q));
  const guarded = guardSettledVerdict(settled, JUNK_CITED_SET(), ctx);
  assert.equal(guarded.guarded, true, "the guard let a settled verdict stand over the junk set");
  assert.equal(guarded.verdict.status, "thin", "the guarded verdict is not the thin shape");
});

await test("the mean relevance prong guards a junk dominated set even when one paper is citable", () => {
  const settled = buildDisagreementVerdict([], 4);
  const mixed = [
    { title: "Acute ankle sprain management in primary care", abstract: "Ankle sprains: protection, rest, ice, compression, elevation.", relevance: 90, year: 2024 },
    { title: "Household objects", abstract: "Things disappear.", relevance: 30, year: 2020 },
    { title: "Drawer studies", abstract: "Drawers and their contents.", relevance: 30, year: 2019 },
    { title: "Poems", abstract: "Verses.", relevance: 30, year: 2018 },
  ];
  const ctx = conceptGateContext(mixed, ANKLE_Q, dynFor(ANKLE_Q));
  const guarded = guardSettledVerdict(settled, mixed, ctx);
  assert.equal(guarded.guarded, true, "the guard let a settled verdict stand over a mean relevance of 45");
});

await test("a settled verdict over a citable set stands", () => {
  const settled = buildDisagreementVerdict([], 4);
  const good = [
    { ...asPaper(ANKLE_MANAGEMENT()), relevance: 82, year: 2024 },
    { ...asPaper(ANKLE_REHAB()), relevance: 78, year: 2024 },
    { title: "Ankle sprain prevention in sport", abstract: "Ankle sprain prevention programmes cut injury rates in athletes with a previous sprain.", relevance: 74, year: 2023 },
    { title: "Imaging after ankle injury", abstract: "After an ankle sprain, imaging rules identify fractures; most sprained ankles need no radiograph.", relevance: 71, year: 2022 },
  ];
  const ctx = conceptGateContext(good, ANKLE_Q, dynFor(ANKLE_Q));
  const guarded = guardSettledVerdict(settled, good, ctx);
  assert.equal(guarded.guarded, false, "the guard fired over a citable cited set");
  assert.equal(guarded.verdict.status, "settled");
});

await test("the confidence line follows the guarded verdict down", () => {
  const junk = JUNK_CITED_SET();
  const settled = buildDisagreementVerdict([], 4);
  const ctx = conceptGateContext(junk, SOCK_Q, dynFor(SOCK_Q));
  const guarded = guardSettledVerdict(settled, junk, ctx);
  const line = buildConfidenceLine(junk, guarded.verdict, { degraded: false, extractive: false });
  assert.equal(line.verdictStatus, "thin", "the confidence line does not carry the thin verdict");
  assert.notEqual(line.level, "strong",
    "the confidence line read strong over the guarded junk set: " + JSON.stringify(line));
});

// ═══════════════════════════════════════════════════════════════
group("Job 4b — the zero support serve degrades");

await test("handler: an AI answer the claim check supports on nothing falls to the extractive tier", async () => {
  scenPapersFn = null;
  scenPapers = [ANKLE_MANAGEMENT(), ANKLE_REHAB()];
  // The draft's central claim names a drug that appears in no
  // cited paper: the deterministic claim check (the terms tier,
  // which the stub fleet falls back to when the deep check's
  // replies do not parse) checks one claim and supports none.
  scenAnswer =
    "Metformin speeds ligament healing after an ankle sprain and shortens the time away from sport [1]. " +
    "Protection, rest, ice, compression, and elevation limit swelling in the first days [1].";
  // The fact check is a client setting: the fixture sends it the
  // way the real client does, or the check never runs and there
  // is no zero support verdict to degrade on.
  const { data } = await runScenario(ANKLE_Q, { limit: 300, settings: { factCheck: true } });
  assert.equal(data.synthesisMode, "extractive",
    "the zero support AI answer shipped as a research answer instead of degrading: " + data.synthesisMode);
  assert.ok(!/metformin/i.test(String(data.answer || "")),
    "the unsupported central claim survived the degrade: " + String(data.answer || "").slice(0, 200));
});

// ═══════════════════════════════════════════════════════════════
group("cache — the wave eight schema version");

await test("CACHE_SCHEMA_VERSION is v43 with the wave nine entry in its chain", () => {
  const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
  // Updated 2026-10-14 (wave nine): wave nine bumped the schema
  // to v43 (mechanism shape detection, the foundational lane,
  // the mechanism engagement requirement in the citation
  // standard, foundational primaries in the evidence slice, and
  // the mechanism first synthesis contract), superseding the
  // v42 pin from wave eight round three (source list truth,
  // PubMed two calls, Gemini validation leg, swimmer's ear and
  // nutrient concepts).
  // Updated 2026-10-14 (wave ten): bumped to v44 (gate audit,
  // tail hygiene, solidity binding, bucket spread, cache key
  // derivation). The v43 entry stays in the chain as history.
  // Updated 2026-10-14 (wave eleven): bumped to v45 (the
  // compound title clause for the presented list), then to
  // v46 by the same wave's live probe addendum (the mechanism
  // detector hears plain copying words). The v44 entry stays
  // in the chain as history.
  // Updated 2026-10-14 (wave twelve): bumped to v47 (the
  // claim check counts only checked claims, dedupe folds
  // richer duplicate fields, the foundational lane sorts by
  // citations, the compound clause confirmation requires
  // topical company, the single source retry extends to
  // every clean answer).
  // Updated 2026-10-14 (wave thirteen): bumped to v48
  // (foundational primaries get presentation priority, the
  // title rule requires topical company for every sighting,
  // the claim check records a named tier trace and selects
  // literature characterizing claims).
  // Updated 2026-10-14 (wave fourteen): bumped to v49
  // (the search record carries the foundational fate
  // diagnostic, and the LLM validation pass can no longer
  // remove a gate cleared foundational primary).
  // Updated 2026-10-14 (wave fifteen): bumped to v50
  // (the foundational lane gains founding form legs over
  // the unexpanded system name, and the record gains the
  // foundational near miss section).
  assert.ok(src.includes('const CACHE_SCHEMA_VERSION = "v50";'),
    "the cache schema version was not bumped to v50");
  assert.ok(/v44 \(2026-10-14, wave ten\)/.test(src),
    "the v44 chain entry is missing its dated reason");
  assert.ok(/v43 \(2026-10-14, wave nine\)/.test(src),
    "the v43 chain entry is missing its dated reason");
  assert.ok(/v42 \(2026-10-14, seventh panel wave eight, round three\)/.test(src),
    "the v42 chain entry is missing its dated reason");
  assert.ok(/v41 \(2026-10-14, seventh panel wave eight\)/.test(src),
    "the v41 chain entry is missing its dated reason");
});

console.log(`\nsearch-wave-eight: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
