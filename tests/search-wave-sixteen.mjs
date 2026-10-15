/**
 * Search wave sixteen (2026-10-14). The eighth panel's serve
 * side honesty wave: five fixes, each at the last step where
 * the reader is decided. Panel 8 totals behind the brief:
 * Search 340, Answer 340, Trust 560, Infrastructure 845.
 *
 *   1. The subject serve: the honest no evidence state fires
 *      when the final cited set cannot address the question's
 *      subject (the gate's own subject computation over the
 *      cited set), regardless of pool size — the grocery
 *      checkout run that cited a digital transformation
 *      review, the plain words creatine run that cited a hair
 *      oil trial, and the backwards shape (a thin list whose
 *      one paper is a word collision) all resolve to the
 *      state; a cited set that engages the subject stands.
 *   2. A claim the pipeline flags unsupported leaves the
 *      shipped body: deep verdicts remove their sentences
 *      (the JOB 3(b) hard rule), the mechanical kinds
 *      (stripped, demoted, alignment) remove theirs under the
 *      soft rule (no surviving citation marker), the answer
 *      degrades when removal guts it, and no orphaned
 *      citation fragment ("[1],.") survives in shipped prose.
 *   3. The confidence level and line cannot disagree:
 *      calibrateConfidenceScore regenerates the shipped line
 *      from the calibrated level through the builder's own
 *      renderer, its banding matches the builder's (including
 *      the thin verdict rule), and dedupeRepeatedSentences
 *      compares sentences after normalization that strips
 *      terminal punctuation, so the provenance cap reason no
 *      longer prints twice.
 *   4. stageHealth does not call the fact check stage ok when
 *      its trace shows no verdict landed: the ok test reads
 *      the stage's own pre merge result, not the mechanical
 *      flags panel. The record page renders factCheckTrace.
 *   5. The claim check's legs and gate: the deep check leads
 *      with an independent quota Gemini tier (validation's
 *      pattern — its Gemini leg answered 6 of 6 panel probes
 *      while every shared quota leg failed); the fact check's
 *      time window is reserved before synthesis
 *      (FACT_CHECK_RESERVE_MS, synthesisDeadlineFor); the
 *      uncapped @cf/openai/gpt-oss-20b leg takes the standard
 *      3,000 ms cap in both timeout maps' reach, including the
 *      rescue wave's call site; and post winner retry races
 *      close after RETRY_RACE_CLOSE_MS instead of racing to
 *      the stage deadline.
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 *
 * Run with: node tests/search-wave-sixteen.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
const search = await import(join(root, "functions/api/search.js"));
const recordPageMod = await import(join(root, "functions/record/[id].js"));

const {
  onRequest, createSubrequestLedger,
  buildDeterministicFallbackGroups, buildDynLookup, centralContentTerms,
  citedSetEngagesSubject, gateJudgedConcepts,
  buildConfidenceLine, calibrateConfidenceScore, confidenceLineText,
  publicConfidence, dedupeRepeatedSentences, tidyCitationArtifacts,
  stripUnsupportedCitations, removeUnsupportedClaimsFromAnswer,
  deepFactCheck, factCheckTraceSummary, factCheckSupport,
  synthesisDeadlineFor, FACT_CHECK_RESERVE_MS,
  raceWithCloseWindow, RETRY_RACE_CLOSE_MS, cfLegTimeoutMs,
} = search;
const { onRequestGet } = recordPageMod;

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
function group(name) { console.log(`\n${name}`); }

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

// ── Scenario runner (wave thirteen pattern): scripted pool,
// scripted synthesis answer, scripted fact check verdicts with
// per mode rate limiting ─────────────────────────────────────
let scenPapers = [];
let scenAnswer = "";
let scenRetryAnswer = null;
let scenFactCheck = null;
let scenFactCheckMode = "ok"; // "ok" | "429-all"
let scenExpansion = null; // landed model concept groups (JSON text), or null for the cannot group stub
let scenFetchLog = [];

async function runScenario(query, opts = {}) {
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  globalThis.caches = {
    default: { match: async () => undefined, put: async () => {}, delete: async () => false },
  };
  Math.random = () => 0.99;
  scenFetchLog = [];
  globalThis.fetch = async (url, opts2 = {}) => {
    const u = String(url);
    const body = typeof opts2.body === "string" ? opts2.body : "";
    scenFetchLog.push({ url: u, body });
    if (u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("openrouter.ai")) {
      if (body.includes("rigorous scientific fact-checker")) {
        if (scenFactCheckMode === "429-all") {
          return new Response("rate limited", { status: 429 });
        }
        return chatRes(scenFactCheck || "no verdict available");
      }
      if (body.includes("Cite at least two different sources inline")) {
        return chatRes(scenRetryAnswer || scenAnswer);
      }
      if (body.includes("literature search specialist")) {
        return chatRes(scenExpansion || "I cannot group those terms today.");
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));
      }
      return chatRes(scenAnswer);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      if (u.includes("BODY")) return jsonRes({ resultList: { result: [] } });
      return jsonRes({ resultList: { result: scenPapers } });
    }
    if (u.includes("api.openalex.org")) return jsonRes({ results: [] });
    if (u.includes("api.semanticscholar.org")) return jsonRes({ data: [] });
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
      OPENROUTER_KEY: "w16-test-openrouter-key-123456",
      ...(opts.envExtra || {}),
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
    return { data, fetchLog: scenFetchLog.slice() };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
    scenFetchLog = [];
    scenExpansion = null;
  }
}

const epmc16 = (id, title, abstractText, citedByCount, pubYear) => ({
  title,
  doi: "10.1000/w16-" + id,
  pubYear: String(pubYear),
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});

// ═══════════════════════════════════════════════════════════════
group("Item 1 — the subject serve test (unit)");

await test("gateJudgedConcepts returns the central set, and central terms join it in the degraded case", () => {
  const std = {
    centralConcepts: [{ term: "sky", group: ["sky"], subject: true }, { term: "blue", group: ["blue"], subject: false }],
    centralTerms: ["sky", "scattering"],
  };
  const judged = gateJudgedConcepts(std);
  assert.equal(judged.length, 3, "the bare central term did not join the judged set");
  assert.ok(judged.some((c) => c.term === "scattering" && c.subject === false));
  assert.deepEqual(gateJudgedConcepts({ centralConcepts: [], centralTerms: [] }), []);
  assert.deepEqual(gateJudgedConcepts(null), []);
});

await test("the grocery cited set does not engage the subject", () => {
  const q = "which line at the grocery store checkout moves the fastest";
  const review = {
    title: "Digital transformation in retail and grocery: a systematic review",
    abstract: "Digital transformation is reshaping retail and grocery organisations. This review synthesises studies of digital strategy, store operations, checkout technology adoption, and customer experience in supermarkets and grocery chains, and discusses implications for retail managers working through digital change in the store estate and at the checkout.",
    year: "2023", citations: 640,
  };
  const r = citedSetEngagesSubject([review], new Set([1]), q, dynFor(q));
  assert.equal(r.judged, true, "the grocery question's subject did not resolve for the test");
  assert.equal(r.engaged, false, "the digital transformation review engaged the subject: " + JSON.stringify(r));
});

await test("the creatine cited set engages through the supplement paper, not through the hair oil trial", () => {
  const q = "does the powder guys take for muscles make your hair fall out";
  const hairOil = {
    title: "A randomised trial of herbal hair oil for scalp and hair care",
    abstract: "We evaluated a herbal hair oil preparation in adults with dry scalp. Participants applied the oil twice weekly for twelve weeks and reported changes in hair shedding, scalp comfort, and hair shine on standardised questionnaires administered at a dermatology clinic.",
    year: "2022", citations: 45,
  };
  const creatineRct = {
    title: "Creatine monohydrate supplementation and hair loss: a randomised controlled trial",
    abstract: "Creatine monohydrate is a powder widely used by men who train for muscle strength. We randomised resistance trained men to creatine powder or placebo for twelve weeks and measured dihydrotestosterone, total testosterone, and hair follicle density to test whether the supplement affects **hair loss**.",
    year: "2024", citations: 130,
  };
  const papers = [hairOil, creatineRct];
  const junk = citedSetEngagesSubject(papers, new Set([1]), q, dynFor(q));
  assert.equal(junk.engaged, false, "the hair oil trial engaged the subject: " + JSON.stringify(junk));
  const good = citedSetEngagesSubject(papers, new Set([2]), q, dynFor(q));
  assert.equal(good.judged, true);
  assert.equal(good.engaged, true, "the creatine trial did not engage the subject: " + JSON.stringify(good));
});

await test("the ankle surgery cited set does not engage, and the sprain pilot does", () => {
  const q = "i twisted my ankle what should i do for it";
  const fascia = {
    title: "Plantar fascia release surgery for chronic heel pain: outcomes of endoscopic release",
    abstract: "Endoscopic plantar fascia release is a surgical option for chronic plantar fasciitis unresponsive to conservative care. We report outcomes of surgical release in 84 patients, including pain scores, return to activity, and complications of the release procedure at **two year** follow up.",
    year: "2021", citations: 480,
  };
  const fracture = {
    title: "Management of neglected ankle fractures: surgical reconstruction and outcomes",
    abstract: "Neglected ankle fractures present late after injury and often require surgical reconstruction. We reviewed fixation strategies, bone grafting, and functional outcomes after reconstruction of neglected fractures of the ankle in a tertiary referral cohort.",
    year: "2020", citations: 390,
  };
  const pilot = {
    title: "Early mobilisation versus immobilisation after lateral ankle sprain: a randomised pilot study",
    abstract: "Lateral ankle sprain is among the most common musculoskeletal injuries. This randomised pilot compared early mobilisation with cast immobilisation after acute ankle sprain, measuring pain, swelling, and time to return to work and sport.",
    year: "2023", citations: 60,
  };
  const junk = citedSetEngagesSubject([fascia, fracture], new Set([1, 2]), q, dynFor(q));
  assert.equal(junk.engaged, false, "the surgery papers engaged the subject: " + JSON.stringify(junk));
  const good = citedSetEngagesSubject([pilot], new Set([1]), "how do you treat a sprained ankle at home", dynFor("how do you treat a sprained ankle at home"));
  assert.equal(good.engaged, true, "the sprain pilot did not engage the subject: " + JSON.stringify(good));
});

await test("an empty cited set is not judged (the serve never fires on nothing)", () => {
  const r = citedSetEngagesSubject([{ title: "Anything", abstract: "Anything at all." }], new Set(), "why is the sky blue", dynFor("why is the sky blue"));
  assert.equal(r.judged, false);
  assert.equal(r.engaged, false);
});

// ═══════════════════════════════════════════════════════════════
group("Item 1 — the subject serve (handler)");

const GROCERY_POOL_16 = [
  epmc16("g1", "Digital transformation in retail and grocery: a systematic review",
    "Digital transformation is reshaping retail and grocery organisations. This review synthesises studies of digital strategy, store operations, checkout technology adoption, and customer experience in supermarkets and grocery chains, and discusses implications for retail managers working through digital change in the store estate and at the checkout.", 640, 2023),
  epmc16("g2", "Self checkout systems in supermarkets: adoption and shopper behaviour",
    "Self checkout systems are now common in supermarkets. We surveyed shoppers about self checkout adoption, perceived ease of use, and store satisfaction, and observed how checkout technology changes the way customers move through the grocery store and pay for goods.", 210, 2022),
  epmc16("g3", "Customer experience in grocery retail: an empirical study of store loyalty",
    "Customer experience drives loyalty in grocery retail. This study models how store atmosphere, staff interaction, and the checkout experience shape repeat visits to the grocery store, using survey data from supermarket shoppers in three regions.", 180, 2021),
  epmc16("g4", "Payment technology and retail operations: mobile wallets at the point of sale",
    "Mobile wallet payment technology is changing retail operations at the grocery store checkout. We examine adoption of contactless payment in grocery and convenience retail, transaction speed at the supermarket checkout, and the operational changes payment systems bring to the store and its customers.", 150, 2022),
  epmc16("g5", "Service operations and customer waiting: a systematic review of waiting time research",
    "Waiting time shapes how customers judge service operations in the grocery store and at the supermarket checkout. This systematic review covers research on customer waiting in banks, hospitals, call centres, and retail settings, and on the psychology of the wait, perceived fairness, and service design that reduces the cost of waiting in the store.", 320, 2020),
  epmc16("g6", "Store layout and shopper movement in supermarkets: an observational study",
    "Store layout guides shopper movement in supermarkets. We tracked how customers move through grocery store aisles toward the checkout, where they pause, and how layout changes dwell time and basket size in the retail store environment.", 95, 2019),
];
const GROCERY_ANSWER_16 = "## Short answer\n\nDigital transformation of the grocery store has changed how the **checkout** works, and reviews of retail technology describe stores redesigning the checkout around **digital systems** [1].\n\nSelf checkout systems are now a standard part of the supermarket, and studies of shopper behaviour at self checkout describe how customers scan and pay without staff assistance [2]. Stores weigh the checkout experience heavily because customers judge the whole store by it [1][2].";
const GROCERY_FACTCHECK_16 = JSON.stringify({ claims: [
  { claim: "Digital transformation of the grocery store has changed how the checkout works",
    source_index: 1,
    quote: "Digital transformation is reshaping retail and grocery organisations",
    status: "supported",
    justification: "The first source is a systematic review of digital transformation in retail and grocery and discusses checkout technology adoption directly, so the claim about digital change at the checkout is backed by the cited review." },
  { claim: "Self checkout systems are now a standard part of the supermarket",
    source_index: 2,
    quote: "Self checkout systems are now common in supermarkets",
    status: "supported",
    justification: "The second source studies self checkout adoption in supermarkets and states that self checkout systems are now common there, which supports the claim as written." },
] });

await test("grocery: a cited set that cannot address the subject falls to the honest no evidence state", async () => {
  scenPapers = GROCERY_POOL_16;
  scenAnswer = GROCERY_ANSWER_16;
  scenRetryAnswer = null;
  scenFactCheck = GROCERY_FACTCHECK_16;
  scenFactCheckMode = "ok";
  // The production shape: the model expansion lands and names
  // the queue concept the question's "line" carries. (Under
  // the harness's cannot group stub the deterministic
  // fallback drops "line" as a term before any gate runs, so
  // no subject resolves at all — a harness artifact the
  // cannot group suites already cover from the other side.)
  scenExpansion = JSON.stringify([
    { term: "line", alternates: ["queue", "queueing", "waiting line", "checkout line"] },
    { term: "checkout", alternates: ["checkout lane", "point of sale"] },
    { term: "grocery store", alternates: ["supermarket", "grocery retail"] },
  ]);
  const { data } = await runScenario("which line at the grocery store checkout moves the fastest", { settings: { factCheck: true } });
  assert.equal(data.responseKind, "no-results",
    "the grocery run did not land in the honest state: " + data.responseKind + " / " + String(data.answer || "").slice(0, 160));
  assert.ok(String(data.answer || "").startsWith("## No citable literature surfaced"),
    "the honest state's own copy did not ship: " + String(data.answer || "").slice(0, 120));
  const rec = data._record || {};
  assert.ok(rec.subjectServe && rec.subjectServe.fired === true,
    "the subject serve did not record itself as the actor (gate audit: " +
    JSON.stringify(rec.gateAudit || null) + ", subjectServe: " + JSON.stringify(rec.subjectServe || null) + ")");
  assert.ok(!/Digital transformation in retail/.test(JSON.stringify(rec.sources || [])) ||
    (rec.sources || []).every((s) => !s.cited),
    "the digital transformation review still shipped as a cited source");
});

const CREATINE_POOL_16 = [
  epmc16("c1", "Creatine monohydrate supplementation and hair loss: a randomised controlled trial",
    "Creatine monohydrate is a powder widely used by men who train for muscle strength. We randomised resistance trained men to creatine powder or placebo for twelve weeks and measured dihydrotestosterone, total testosterone, and hair follicle density to test whether the supplement affects **hair loss**.", 130, 2024),
  epmc16("c2", "A randomised trial of herbal hair oil for scalp and hair care",
    "We evaluated a herbal hair oil preparation in adults with dry scalp. Participants applied the oil twice weekly for twelve weeks and reported changes in hair shedding, scalp comfort, and hair shine on standardised questionnaires administered at a dermatology clinic.", 45, 2022),
  epmc16("c3", "Shampoo advertising claims and consumer perception: a content analysis",
    "Shampoo advertisements make wide claims about hair strength and shine. We analysed advertising content from major shampoo brands and surveyed consumers about which claims they believed, and how advertising shapes expectations of hair care products.", 30, 2021),
  epmc16("c4", "Protein supplementation and resistance training: a meta analysis of muscle strength outcomes",
    "Protein supplementation is used alongside resistance training for muscle strength. This meta analysis pooled trials of protein supplements in trained adults and estimated effects on muscle strength and lean mass over twelve week programmes.", 890, 2023),
];
const CREATINE_ANSWER_16 = "## Short answer\n\n**Creatine monohydrate** is a powder supplement used by men who train for muscle strength, and a randomised trial measured hormone levels and **hair follicle density** in men taking creatine powder for twelve weeks [1].\n\nThe trial tracked dihydrotestosterone and hair measures directly, so it speaks to whether the supplement is linked to hair loss in the men studied [1].";
const CREATINE_FACTCHECK_16 = JSON.stringify({ claims: [
  { claim: "Creatine monohydrate is a powder supplement used by men who train for muscle strength",
    source_index: 1,
    quote: "Creatine monohydrate is a powder widely used by men who train for muscle strength",
    status: "supported",
    justification: "The first source states in its opening sentence that creatine monohydrate is a powder widely used by men who train for muscle strength, so the claim is backed by the cited trial." },
  { claim: "A randomised trial measured hormone levels and **hair follicle density** in men taking creatine",
    source_index: 1,
    quote: "measured dihydrotestosterone, total testosterone, and hair follicle density",
    status: "supported",
    justification: "The first source randomised men to creatine or placebo and measured dihydrotestosterone, testosterone, and hair follicle density, matching the claim's description of the trial." },
] });

await test("creatine in plain words: the supplement paper engages the subject and the answer stands", async () => {
  scenPapers = CREATINE_POOL_16;
  scenAnswer = CREATINE_ANSWER_16;
  scenRetryAnswer = null;
  scenFactCheck = CREATINE_FACTCHECK_16;
  scenFactCheckMode = "ok";
  // The expansion assembles the supplement concept the plain
  // words hide: the powder guys take for muscles IS creatine,
  // which is the brief's first sanctioned outcome for this
  // phrasing (cite the creatine literature).
  scenExpansion = JSON.stringify([
    { term: "powder", alternates: ["supplement powder", "creatine"] },
    { term: "hair", alternates: ["hair loss", "baldness"] },
    { term: "muscles", alternates: ["muscle mass", "strength training"] },
  ]);
  const { data } = await runScenario("does the powder guys take for muscles make your hair fall out", { settings: { factCheck: true } });
  assert.notEqual(data.responseKind, "no-results",
    "the creatine run fell to the honest state although its cited paper engages the subject: " + String(data.answer || "").slice(0, 160));
  const rec = data._record || {};
  assert.ok(!rec.subjectServe, "the subject serve fired on an engaging cited set");
  assert.ok(/Creatine monohydrate/.test(String(data.answer || "")),
    "the shipped answer is not the creatine answer: " + String(data.answer || "").slice(0, 160));
});

await test("creatine in plain words without the supplement paper: the honest state, not the hair oil trial", async () => {
  // Without the supplement paper (and without the protein
  // paper, whose supplement vocabulary would muddy which
  // layer answers), nothing in the pool can address the
  // subject: the state fires rather than the hair oil trial.
  scenPapers = CREATINE_POOL_16.slice(1, 3);
  scenAnswer = "## Short answer\n\nA randomised trial of **herbal hair oil** tracked hair shedding and scalp comfort in adults who applied the oil **twice weekly** [1].\n\nHair shedding was reported on standardised questionnaires at a dermatology clinic over twelve weeks of oil use [1].";
  scenRetryAnswer = null;
  scenExpansion = JSON.stringify([
    { term: "powder", alternates: ["supplement powder", "creatine"] },
    { term: "hair", alternates: ["hair loss", "baldness"] },
    { term: "muscles", alternates: ["muscle mass", "strength training"] },
  ]);
  scenFactCheck = JSON.stringify({ claims: [
    { claim: "A randomised trial of **herbal hair oil** tracked hair shedding and scalp comfort",
      source_index: 1,
      quote: "reported changes in hair shedding, scalp comfort, and hair shine",
      status: "supported",
      justification: "The first source evaluated a herbal hair oil in adults and reported changes in hair shedding and scalp comfort, so the claim about the trial is backed by the cited source." },
    { claim: "Hair shedding was reported on standardised questionnaires at a dermatology clinic",
      source_index: 1,
      quote: "standardised questionnaires administered at a dermatology clinic",
      status: "supported",
      justification: "The first source states that outcomes were reported on standardised questionnaires administered at a dermatology clinic, matching the claim as written." },
  ] });
  scenFactCheckMode = "ok";
  const { data } = await runScenario("does the powder guys take for muscles make your hair fall out", { settings: { factCheck: true } });
  assert.equal(data.responseKind, "no-results",
    "without the supplement paper the run shipped a research answer off the hair oil trial: " + data.responseKind);
  // The honest copy may NAME the gated papers it set aside
  // (that is its job); what must not ship is the draft built
  // on them — its claims and its citations.
  assert.ok(!/twice weekly/.test(String(data.answer || "")),
    "the hair oil draft shipped as the answer: " + String(data.answer || "").slice(0, 160));
  const rec2 = data._record || {};
  assert.ok((rec2.sources || []).every((s) => !s.cited),
    "a source still shipped as cited in the honest state");
});

const ANKLE_POOL_16 = [
  epmc16("a1", "Plantar fascia release surgery for chronic heel pain: outcomes of endoscopic release",
    "Endoscopic plantar fascia release is a surgical option for chronic plantar fasciitis unresponsive to conservative care. We report outcomes of surgical release in 84 patients, including pain scores, return to activity, and complications of the release procedure at **two year** follow up.", 480, 2021),
  epmc16("a2", "Management of neglected ankle fractures: surgical reconstruction and outcomes",
    "Neglected ankle fractures present late after the original injury and often require surgical reconstruction. We reviewed fixation strategies, bone grafting, and functional outcomes after reconstruction of neglected fractures of the ankle in a tertiary referral cohort of injury patients.", 390, 2020),
  epmc16("a3", "Achilles tendon repair surgery: a comparison of open and percutaneous techniques",
    "Achilles tendon rupture is treated by open or percutaneous surgical repair. We compared re rupture rates, infection, and return to sport after the two repair techniques in 212 patients treated at three surgical centres.", 350, 2019),
  epmc16("a4", "Ankle arthroscopy for osteochondral lesions: indications and surgical outcomes",
    "Ankle arthroscopy is used for osteochondral lesions and other joint injury problems of the ankle. We report indications, arthroscopic findings, and surgical outcomes in 156 patients undergoing ankle arthroscopy for injury related lesions.", 300, 2022),
  epmc16("a5", "Jones fractures of the fifth metatarsal: intramedullary screw fixation outcomes",
    "Jones fractures of the fifth metatarsal are treated with intramedullary screw fixation when healing stalls. We report union rates and return to sport after screw fixation in athletes with this fracture.", 275, 2018),
];
const ANKLE_ANSWER_16 = "## Short answer\n\nSurgical series describe **fascia release** outcomes for chronic heel pain, including pain scores and return to activity after the release procedure [1].\n\nNeglected ankle fractures often need **surgical reconstruction**, and reviews of fixation strategies report functional outcomes after reconstruction of the ankle [2].";
const ANKLE_FACTCHECK_16 = JSON.stringify({ claims: [
  { claim: "Surgical series describe **fascia release** outcomes for chronic heel pain",
    source_index: 1,
    quote: "We report outcomes of surgical release in 84 patients, including pain scores",
    status: "supported",
    justification: "The first source reports outcomes of endoscopic plantar fascia release in 84 patients including pain scores, so the claim about the surgical series is backed by the cited source." },
  { claim: "Neglected ankle fractures often need **surgical reconstruction**",
    source_index: 2,
    quote: "often require surgical reconstruction",
    status: "supported",
    justification: "The second source states that neglected ankle fractures often require surgical reconstruction and reviews fixation strategies, matching the claim as written." },
] });

await test("ankle with a surgery only pool: the honest state rather than fascia citations", async () => {
  scenPapers = ANKLE_POOL_16;
  scenAnswer = ANKLE_ANSWER_16;
  scenRetryAnswer = null;
  scenFactCheck = ANKLE_FACTCHECK_16;
  scenFactCheckMode = "ok";
  scenExpansion = JSON.stringify([
    { term: "twisted", alternates: ["sprained", "sprain", "rolled"] },
    { term: "ankle", alternates: ["ankle joint", "lateral ankle"] },
  ]);
  const { data } = await runScenario("i twisted my ankle what should i do for it", { settings: { factCheck: true } });
  assert.equal(data.responseKind, "no-results",
    "the surgery only ankle pool shipped a research answer: " + data.responseKind + " / " + String(data.answer || "").slice(0, 160));
  assert.ok(!/fascia/i.test(String(data.answer || "")),
    "the fascia paper shipped as the answer's substance: " + String(data.answer || "").slice(0, 160));
});

const YOGURT_POOL_16 = [
  epmc16("y1", "Yogurt consumption and gut microbiota in healthy adults: a randomised controlled trial",
    "Yogurt is a fermented milk food eaten worldwide. We randomised healthy adults to daily yogurt or control for eight weeks and profiled gut microbiota, stool consistency, and gastrointestinal symptoms to test whether yogurt consumption changes the adult **gut microbiota**.", 210, 2023),
  epmc16("y2", "A fermented milk feed additive improves growth in broiler chickens",
    "Fermented milk products are used as feed additives in poultry production. We fed broiler chickens a fermented milk additive and measured growth, feed conversion, and intestinal morphology over a production cycle.", 65, 2021),
  epmc16("y3", "Probiotic supplements and antibiotic associated diarrhoea: a systematic review",
    "Probiotic supplements are taken to prevent antibiotic associated diarrhoea. This systematic review pooled trials of probiotic preparations in patients receiving antibiotics and estimated effects on diarrhoea incidence.", 540, 2022),
];
const YOGURT_ANSWER_16 = "## Short answer\n\n**Yogurt** is a fermented milk food, and a randomised trial in healthy adults profiled the **gut microbiota** after eight weeks of daily yogurt [1].\n\nThe trial measured stool consistency and gastrointestinal symptoms alongside the microbiota, so it speaks to what yogurt does in the adult gut [1].";
const YOGURT_FACTCHECK_16 = JSON.stringify({ claims: [
  { claim: "A randomised trial in healthy adults profiled the gut microbiota after daily yogurt",
    source_index: 1,
    quote: "randomised healthy adults to daily yogurt or control for eight weeks and profiled gut microbiota",
    status: "supported",
    justification: "The first source randomised healthy adults to daily yogurt or control for eight weeks and profiled gut microbiota, matching the claim as written." },
  { claim: "Yogurt is a fermented milk food eaten worldwide",
    source_index: 1,
    quote: "Yogurt is a fermented milk food eaten worldwide",
    status: "supported",
    justification: "The first source opens by stating that yogurt is a fermented milk food eaten worldwide, so the claim is backed by the cited trial." },
] });

await test("yogurt control: the human yogurt paper engages and the answer stands", async () => {
  scenPapers = YOGURT_POOL_16;
  scenAnswer = YOGURT_ANSWER_16;
  scenRetryAnswer = null;
  scenFactCheck = YOGURT_FACTCHECK_16;
  scenFactCheckMode = "ok";
  scenExpansion = JSON.stringify([
    { term: "yogurt", alternates: ["yoghurt", "fermented milk"] },
    { term: "gut", alternates: ["gut microbiota", "digestive tract"] },
  ]);
  const { data } = await runScenario("is yogurt good for your gut", { settings: { factCheck: true } });
  assert.notEqual(data.responseKind, "no-results",
    "the yogurt run fell to the honest state although its cited paper engages the subject");
  const rec = data._record || {};
  assert.ok(!rec.subjectServe, "the subject serve fired on the yogurt run");
  assert.ok(/yogurt/i.test(String(data.answer || "")), "the shipped answer is not the yogurt answer");
});

// ═══════════════════════════════════════════════════════════════
group("Item 2 — unsupported claims leave the shipped body (unit)");

await test("the soft rule removes a markerless flagged sentence and keeps a sentence whose marker survives", () => {
  const text = "## Short answer\n\nFirst claim stands here [1]. Second claim falls today.\n\nBody claim with support [1][2] stays in place.";
  const rm = removeUnsupportedClaimsFromAnswer(text, [
    { claim: "Second claim falls today", hard: false },
    { claim: "Body claim with support stays in place", hard: false },
  ]);
  assert.equal(rm.removed, 1, "the soft rule removed the wrong sentences: " + JSON.stringify(rm));
  assert.ok(!/Second claim falls/.test(rm.text), "the markerless flagged sentence survived");
  assert.ok(/Body claim with support/.test(rm.text), "the sentence with a surviving marker was removed");
});

await test("a hard target removes its sentence even when the sentence still carries a marker", () => {
  const text = "## Short answer\n\nFirst claim stands here [1]. Second claim falls today [2].";
  const rm = removeUnsupportedClaimsFromAnswer(text, [
    { claim: "First claim stands here", sourceIndex: 1, hard: true },
  ]);
  assert.equal(rm.removed, 1);
  assert.ok(!/First claim stands/.test(rm.text));
  assert.ok(/Second claim falls/.test(rm.text), "an untargeted sentence was removed");
});

await test("tidyCitationArtifacts removes the orphaned punctuation the panel photographed", () => {
  const tidied = tidyCitationArtifacts("Hair loss was associated with aging [1],. Other factors mattered too.");
  assert.ok(!/,\./.test(tidied), "the orphaned comma period pair survived: " + tidied);
  assert.ok(tidied.includes("aging [1]."), "the surviving marker or sentence was damaged: " + tidied);
  const untouched = tidyCitationArtifacts("Results were clear [2], and the effect held in 1,000.5 cases overall.");
  assert.equal(untouched, "Results were clear [2], and the effect held in 1,000.5 cases overall.",
    "the tidy damaged ordinary prose: " + untouched);
  assert.equal(tidyCitationArtifacts("A husk [] remains here."), "A husk remains here.");
});

// ═══════════════════════════════════════════════════════════════
group("Item 2 — unsupported claims leave the shipped body (handler)");

const SKY_POOL_16 = [
  epmc16("s1", "Why is the sky blue? Rayleigh scattering and the colour of the sky",
    "The blue colour of the sky is explained by Rayleigh scattering. Air molecules scatter short wavelength **blue light** far more strongly than longer wavelengths, so scattered sunlight reaches the eye from every direction and the sky appears blue. The same scattering explains why the sky pales near the horizon.", 900, 2019),
  epmc16("s2", "Aerosols, horizon whitening, and the colour of the sky near the ground",
    "Aerosol particles scatter all wavelengths of light, whitening the blue of the sky near the horizon. We measured aerosol loading and sky brightness at several sites and modelled how particles change the colour of the blue sky close to the ground.", 300, 2020),
  epmc16("s3", "Sunset colours and the long path of sunlight through the air",
    "At sunset, sunlight crosses a long path through the air, and the blue light is scattered away before it arrives, leaving red and orange colours in the sky. We review the optics of sunset colours and twilight.", 240, 2018),
  epmc16("s4", "Ocean wave energy converters: mooring loads and fatigue in device arrays",
    "Ocean wave energy converters convert wave motion into electricity. We studied mooring loads and fatigue in arrays of wave energy devices deployed in energetic seas, and the maintenance regimes the converters require.", 150, 2021),
];

await test("the panel probe shape: two unsupported claims in the short answer do not ship", async () => {
  scenPapers = SKY_POOL_16;
  scenAnswer = "## Short answer\n\nThe sky looks blue because the air itself glows with blue light at midday [1]. Sunlight bouncing off the ocean surface is what paints the sky blue during the day [2].\n\nAir molecules scatter short wavelength **blue light** far more strongly than longer wavelengths, so the sky appears blue from the ground [1]. Aerosol particles scatter **all wavelengths** and whiten the sky near the horizon [2].";
  scenRetryAnswer = null;
  scenFactCheck = JSON.stringify({ claims: [
    { claim: "The sky looks blue because the air itself glows with blue light at midday",
      source_index: 1,
      quote: "The blue colour of the sky is explained by Rayleigh scattering",
      status: "unsupported",
      justification: "The first source explains the colour by Rayleigh scattering of sunlight; nothing in it says the air itself glows, so the claim as written is not supported by the cited source." },
    { claim: "Sunlight bouncing off the ocean surface is what paints the sky blue during the day",
      source_index: 2,
      quote: "Aerosol particles scatter all wavelengths of light, whitening the sky near the horizon",
      status: "unsupported",
      justification: "The second source is about aerosol scattering near the horizon; it says nothing about sunlight bouncing off the ocean painting the sky, so the claim is not supported by the cited source." },
    { claim: "Air molecules scatter short wavelength **blue light** far more strongly than longer wavelengths",
      source_index: 1,
      quote: "Air molecules scatter short wavelength **blue light** far more strongly than longer wavelengths",
      status: "supported",
      justification: "The first source states the scattering claim directly, so the teaching claim is backed by the cited source's own text." },
    { claim: "Aerosol particles scatter **all wavelengths** and whiten the sky near the horizon",
      source_index: 2,
      quote: "Aerosol particles scatter all wavelengths of light, whitening the sky near the horizon",
      status: "supported",
      justification: "The second source states the aerosol claim directly in its abstract, so the claim is backed by the cited source." },
  ] });
  scenFactCheckMode = "ok";
  const { data } = await runScenario("why is the sky blue", { settings: { factCheck: true } });
  assert.notEqual(data.responseKind, "no-results",
    "the run degraded although a supported teaching claim stands: " + String(data.answer || "").slice(0, 200));
  assert.ok(!/glows with blue light/.test(data.answer || ""),
    "the first unsupported claim shipped: " + String(data.answer || "").slice(0, 240));
  assert.ok(!/bouncing off the ocean/.test(data.answer || ""),
    "the second unsupported claim shipped: " + String(data.answer || "").slice(0, 240));
  const plainProbe = String(data.answer || "").replace(/\*\*/g, "");
  assert.ok(/scatter short wavelength blue light/.test(plainProbe),
    "the supported teaching claim was removed with the unsupported ones");
  assert.ok(/whiten the sky near the horizon/.test(plainProbe),
    "the second supported claim was removed with the unsupported ones");
  const panel = (data.factCheck && data.factCheck.claims) || [];
  assert.ok(panel.some((c) => /glows with blue light/.test(c.claim || "") && c.status === "unsupported"),
    "the panel lost the unsupported verdict the body removal acted on");
  assert.ok(!/\[1\],\.|\[\],/.test(data.answer || ""),
    "an orphaned citation fragment survived in the shipped prose: " + String(data.answer || "").slice(0, 240));
});

await test("a stripped kind claim leaves the body under the soft rule", async () => {
  scenPapers = SKY_POOL_16;
  scenAnswer = "## Short answer\n\nAir molecules scatter short wavelength **blue light** far more strongly than longer wavelengths, so the sky appears blue from the ground [1].\n\nRegular sessions improve overall wellbeing and daily energy levels in adults following the **programme** [3].";
  scenRetryAnswer = null;
  scenFactCheck = JSON.stringify({ claims: [
    { claim: "Air molecules scatter short wavelength **blue light** far more strongly than longer wavelengths",
      source_index: 1,
      quote: "Air molecules scatter short wavelength **blue light** far more strongly than longer wavelengths",
      status: "supported",
      justification: "The first source states the scattering claim directly, so the teaching claim is backed by the cited source's own text." },
    { claim: "The sky appears blue from the ground",
      source_index: 1,
      quote: "the sky appears blue",
      status: "supported",
      justification: "The first source states that scattered sunlight reaches the eye from every direction and the sky appears blue, supporting the claim as written." },
  ] });
  scenFactCheckMode = "ok";
  const { data } = await runScenario("why is the sky blue", { settings: { factCheck: true } });
  assert.ok(!/wellbeing/.test(data.answer || ""),
    "the stripped claim's sentence shipped: " + String(data.answer || "").slice(0, 240));
  assert.ok(/scatter short wavelength blue light/.test(String(data.answer || "").replace(/\*\*/g, "")),
    "the supported sentence was removed with the stripped one");
  const panel = (data.factCheck && data.factCheck.claims) || [];
  assert.ok(panel.some((c) => c.kind === "stripped" && c.status === "unsupported"),
    "no stripped flag reached the panel, so the removal had nothing to act on: " + JSON.stringify(panel.map((c) => c.kind)));
});

await test("when removal guts the answer (the central claim goes, nothing supported stands) the run degrades", async () => {
  scenPapers = SKY_POOL_16;
  scenAnswer = "## Short answer\n\nThe sky is blue because tiny air particles reflect **blue light** back down to the ground like a mirror [1].\n\nThis is the basic picture taught for the colour of the **daytime sky**.";
  scenRetryAnswer = null;
  scenFactCheck = JSON.stringify({ claims: [
    { claim: "The sky is blue because tiny air particles reflect **blue light** back down to the ground like a mirror",
      source_index: 1,
      quote: "The blue colour of the sky is explained by Rayleigh scattering",
      status: "unsupported",
      justification: "The first source explains the colour by scattering, not by particles reflecting light back down like a mirror, so the claim as written is not supported by the cited source." },
    { claim: "This is the basic picture taught for the colour of the **daytime sky**",
      source_index: 1,
      quote: "The blue colour of the sky is explained by Rayleigh scattering",
      status: "unsupported",
      justification: "The cited source does not characterise any picture as the basic one taught for the colour of the sky, so the claim is not supported by the cited source." },
  ] });
  scenFactCheckMode = "ok";
  const { data } = await runScenario("why is the sky blue", { settings: { factCheck: true } });
  assert.ok(!/like a mirror/.test(data.answer || ""),
    "the unsupported central claim shipped: " + String(data.answer || "").slice(0, 240));
  assert.ok(data.responseKind === "no-results" || /Rayleigh/.test(data.answer || ""),
    "the gutted answer neither fell to the honest state nor rebuilt from the sources: " +
    data.responseKind + " / " + String(data.answer || "").slice(0, 200));
  const synth = (data.stageHealth || []).find((s) => s.name === "synthesis");
  assert.ok(synth && synth.ok === false && /unsupported/.test(synth.skipReason || ""),
    "the synthesis stage record does not name the degrade: " + JSON.stringify(synth || null));
});

// ═══════════════════════════════════════════════════════════════
group("Item 3 — the confidence level and line cannot disagree");

const LINE_PARTS_16 = { n: 2, status: null, sides: null, conflictCount: 0, avgRelevance: 62, capReasons: [], supClause: "" };

await test("the panel specimen: a moderate line calibrated below the band ships as low, line regenerated", () => {
  const conf = {
    level: "moderate", score: 58,
    line: confidenceLineText("moderate", LINE_PARTS_16),
    lineParts: LINE_PARTS_16, verdictStatus: null, cap: null, capReasons: [], factors: [],
  };
  assert.ok(conf.line.startsWith("Moderate confidence"), "fixture line is not the moderate line");
  const cal = calibrateConfidenceScore(conf, { strippedCitations: 2, totalCitations: 2 });
  assert.equal(cal.level, "thin", "the calibrated level did not drop: " + cal.level + " / " + cal.score);
  const pub = publicConfidence(cal);
  assert.equal(pub.level, "thin");
  assert.ok(pub.line.startsWith("Low confidence"),
    "the shipped line still speaks the old level: " + pub.line);
  assert.ok(pub.line.includes("only 2 cited sources"),
    "the regenerated line lost the builder's own facts: " + pub.line);
  assert.equal(pub.line, confidenceLineText("thin", LINE_PARTS_16),
    "the shipped line is not the renderer output at the shipped level");
});

await test("a strong line discounted into the moderate band reads moderate", () => {
  const parts = { n: 9, status: null, sides: null, conflictCount: 0, avgRelevance: 88, capReasons: [], supClause: "" };
  const conf = {
    level: "strong", score: 80,
    line: confidenceLineText("strong", parts),
    lineParts: parts, verdictStatus: null, cap: null, capReasons: [], factors: [],
  };
  const cal = calibrateConfidenceScore(conf, { strippedCitations: 1, totalCitations: 2, integrityFlags: 2 });
  assert.equal(cal.level, "moderate", "the discounted level is not moderate: " + cal.level + " / " + cal.score);
  assert.ok(cal.line.startsWith("Moderate confidence"), "the line did not follow the level: " + cal.line);
});

await test("a thin verdict status holds the level at moderate through calibration", () => {
  const parts = { n: 8, status: "thin", sides: null, conflictCount: 0, avgRelevance: 90, capReasons: [], supClause: "" };
  const conf = {
    level: "moderate", score: 90,
    line: confidenceLineText("moderate", parts),
    lineParts: parts, verdictStatus: "thin", cap: null, capReasons: [], factors: [],
  };
  const cal = calibrateConfidenceScore(conf, {});
  assert.equal(cal.level, "moderate",
    "calibration promoted a thin verdict answer to strong on score alone: " + cal.level);
  assert.ok(cal.line.startsWith("Moderate confidence"));
});

await test("a confidence object built without parts keeps its line (nothing faithful to regenerate from)", () => {
  const conf = { level: "moderate", score: 55, line: "Moderate confidence: this answer rests on 2 cited sources.", verdictStatus: null, cap: null, capReasons: [], factors: [] };
  const cal = calibrateConfidenceScore(conf, { strippedCitations: 1, totalCitations: 1 });
  assert.equal(cal.level, "thin");
  assert.equal(cal.line, conf.line, "a partless object's line was rewritten");
});

await test("build then calibrate round trip: the shipped pair always agrees", () => {
  const papers = Array.from({ length: 8 }, (_, i) => ({
    title: "Study of scattering in air " + i,
    abstract: "Air molecules scatter short wavelength **blue light** far more strongly than longer wavelengths in this controlled study of atmospheric optics and scattering.",
    year: "2025", relevance: 85, journal: "Journal of Atmospheric Optics",
  }));
  const conf = buildConfidenceLine(papers, null, {});
  assert.ok(conf.lineParts, "the builder did not keep the line's parts");
  assert.equal(conf.line, confidenceLineText(conf.level, conf.lineParts),
    "the builder's line is not its own renderer's output");
  const cal = calibrateConfidenceScore(conf, { strippedCitations: 10, totalCitations: 10, integrityFlags: 4 });
  const prefix = { strong: "Strong confidence", moderate: "Moderate confidence", thin: "Low confidence" }[cal.level];
  assert.ok(cal.line.startsWith(prefix),
    "after calibration the line (" + cal.line.slice(0, 40) + ") disagrees with the level (" + cal.level + ")");
});

await test("the provenance cap reason prints once: the dedupe sees the standalone sentence inside the joined line", () => {
  const paragraph = "Low confidence: this answer rests on only 2 cited sources. Treat this answer as provisional. Confidence is capped because the answer was assembled from source excerpts and part of the answer pipeline degraded. Confidence is capped because the answer was assembled from source excerpts.";
  const out = dedupeRepeatedSentences(paragraph);
  const occurrences = (out.match(/assembled from source excerpts/g) || []).length;
  assert.equal(occurrences, 1, "the cap reason still prints twice: " + out);
  const control = "The first finding stands on its own evidence. The second finding is a different sentence entirely.";
  assert.equal(dedupeRepeatedSentences(control), control, "distinct sentences were deduped away");
});

// ═══════════════════════════════════════════════════════════════
group("Item 4 — the fact check stage record and the record page");

const FLAGS_ANSWER_16 = "## Short answer\n\nThe colour comes from the way air scatters **sunlight**, sending more of the short wavelength light toward the eye [1].\n\nRegular sessions improve overall wellbeing and daily energy levels in adults following the **programme** [3].";

await test("flags only panel, every deep tier failed: the stage reports its named skip state, not ok", async () => {
  scenPapers = SKY_POOL_16;
  scenAnswer = FLAGS_ANSWER_16;
  scenRetryAnswer = null;
  scenFactCheck = null;
  scenFactCheckMode = "429-all";
  const { data } = await runScenario("why is the sky blue", { settings: { factCheck: true } });
  const stage = (data.stageHealth || []).find((s) => s.name === "fact-check");
  assert.ok(stage, "no fact check stage record shipped");
  assert.equal(stage.ok, null,
    "the stage called itself ok although its trace shows no verdict landed: " + JSON.stringify(stage));
  assert.ok(/deep tiers/.test(stage.skipReason || "") && /http-429/.test(stage.skipReason || ""),
    "the skip reason does not name the trace's cause: " + (stage.skipReason || ""));
  const trace = (data._record && data._record.factCheckTrace) || [];
  assert.ok(trace.some((t) => t.tier === "openrouter" && t.outcome === "http-429"),
    "the record's trace lost the failed tiers: " + JSON.stringify(trace));
  assert.ok(data.factCheck && (data.factCheck.claims || []).some((c) => c.kind === "stripped"),
    "the flags panel itself did not ship (the fixture's premise): " + JSON.stringify(data.factCheck && data.factCheck.claims));
});

await test("a landed deep verdict still reports the stage ok", async () => {
  scenPapers = SKY_POOL_16;
  scenAnswer = FLAGS_ANSWER_16;
  scenRetryAnswer = null;
  scenFactCheck = JSON.stringify({ claims: [
    { claim: "The colour comes from the way air scatters sunlight",
      source_index: 1,
      quote: "Air molecules scatter short wavelength blue light",
      status: "supported",
      justification: "The first source states that air molecules scatter the short wavelength light, supporting the claim as written." },
    { claim: "Air sends more of the short wavelength light toward the eye",
      source_index: 1,
      quote: "scattered sunlight reaches the eye from every direction",
      status: "supported",
      justification: "The first source states that scattered sunlight reaches the eye from every direction, supporting the claim as written." },
  ] });
  scenFactCheckMode = "ok";
  const { data } = await runScenario("why is the sky blue", { settings: { factCheck: true } });
  const stage = (data.stageHealth || []).find((s) => s.name === "fact-check");
  assert.ok(stage && stage.ok === true,
    "a landed verdict no longer reports ok: " + JSON.stringify(stage || null));
});

function recordDb(record) {
  return {
    prepare: () => {
      const s = { bind: () => s, first: async () => ({ record: JSON.stringify(record) }) };
      return s;
    },
  };
}

await test("the record page renders the fact check trace lines", async () => {
  const record = {
    question: "why is the sky blue",
    askedAt: "2026-10-14T12:00:00.000Z",
    sources: [],
    factCheckTrace: [
      { tier: "gemini", outcome: "ok" },
      { tier: "openrouter", outcome: "http-429", detail: "the validate model answered HTTP 429" },
    ],
  };
  const res = await onRequestGet({
    request: new Request("https://askcerebrum.org/record/w16record1"),
    env: { DB: recordDb(record) },
    params: { id: "w16record1" },
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("<h2>Fact check</h2>"), "the fact check section is missing from the record page");
  assert.ok(html.includes("gemini: ok"), "the gemini trace line did not render: " + html.slice(html.indexOf("Fact check"), html.indexOf("Fact check") + 300));
  assert.ok(html.includes("openrouter: http-429"), "the openrouter trace line did not render");
});

await test("the record page says the trace was not recorded when the record has none", async () => {
  const record = { question: "why is the sky blue", askedAt: "2026-10-14T12:00:00.000Z", sources: [] };
  const res = await onRequestGet({
    request: new Request("https://askcerebrum.org/record/w16record2"),
    env: { DB: recordDb(record) },
    params: { id: "w16record2" },
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("Fact check attempts were not recorded for this search."),
    "the not recorded sentence did not render");
});

// ═══════════════════════════════════════════════════════════════
group("Item 5 — the claim check's legs, the reserve, the caps, the close window");

const DEEP_VERDICT_16 = JSON.stringify({ claims: [
  { claim: "Air molecules scatter blue light", source_index: 1, quote: "Air molecules scatter short wavelength blue light", status: "supported", justification: "The source states the claim directly." },
  { claim: "The sky appears blue", source_index: 1, quote: "the sky appears blue", status: "supported", justification: "The source states the claim directly." },
] });
const DEEP_PAPERS_16 = [{ title: "Rayleigh scattering and the colour of the sky", abstract: "Air molecules scatter short wavelength **blue light** far more strongly than longer wavelengths, and the sky appears blue." }];
const DEEP_ANSWER_16 = "Air molecules scatter blue light [1]. The sky appears blue [1].";

async function runDeepFactCheck({ env, geminiStatus = 200, orStatus = 200 }) {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("generativelanguage.googleapis.com")) {
      if (geminiStatus !== 200) return new Response("limited", { status: geminiStatus });
      return chatRes(DEEP_VERDICT_16);
    }
    if (u.includes("openrouter.ai")) {
      if (orStatus !== 200) return new Response("limited", { status: orStatus });
      return chatRes(DEEP_VERDICT_16);
    }
    return jsonRes({});
  };
  try {
    const ledger = createSubrequestLedger();
    const trace = [];
    const claims = await deepFactCheck(DEEP_ANSWER_16, DEEP_PAPERS_16, env, ledger, trace);
    return { claims, trace, calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

await test("the deep check leads with the independent quota Gemini tier", async () => {
  const { claims, trace, calls } = await runDeepFactCheck({
    env: { GEMINI_KEY: "w16-gemini-key", OPENROUTER_KEY: "w16-or-key" },
  });
  assert.ok(claims && claims.length === 2, "the Gemini tier's verdict did not land");
  assert.ok(calls.length >= 1 && calls[0].includes("generativelanguage.googleapis.com"),
    "the first fact check fetch was not the Gemini tier: " + JSON.stringify(calls));
  assert.deepEqual(trace[0], { tier: "gemini", outcome: "ok" });
});

await test("a Gemini 429 falls through to the shared quota tiers in their established order", async () => {
  const { claims, trace, calls } = await runDeepFactCheck({
    env: { GEMINI_KEY: "w16-gemini-key", OPENROUTER_KEY: "w16-or-key" },
    geminiStatus: 429,
  });
  assert.ok(claims && claims.length === 2, "no tier landed after the Gemini 429");
  assert.equal(trace[0].tier, "gemini");
  assert.equal(trace[0].outcome, "http-429");
  // The shared quota tiers follow in their established order:
  // Workers AI (here without a binding, so it notes and makes
  // no fetch) and then OpenRouter, which lands.
  assert.equal(trace[1].tier, "workers-ai", "the trace order is not quota diverse first: " + JSON.stringify(trace));
  assert.equal(trace[2].tier, "openrouter");
  assert.equal(trace[2].outcome, "ok");
  assert.ok(calls[0].includes("generativelanguage.googleapis.com") && calls[1].includes("openrouter.ai"));
});

await test("without a Gemini key the tier is absent, not a failed attempt", async () => {
  const { claims, trace, calls } = await runDeepFactCheck({
    env: { OPENROUTER_KEY: "w16-or-key" },
  });
  assert.ok(claims && claims.length === 2);
  assert.ok(!calls.some((u) => u.includes("generativelanguage.googleapis.com")),
    "a Gemini fetch fired without a key");
  assert.ok(!trace.some((t) => t.tier === "gemini"), "the absent tier left a trace entry");
  assert.equal(trace[0].tier, "workers-ai", "the established order shifted: " + JSON.stringify(trace));
});

await test("the fact check window is reserved before synthesis (the reserve arithmetic)", () => {
  assert.equal(FACT_CHECK_RESERVE_MS, 5000);
  const now = 1000000;
  const deadline = now + 19000;
  assert.equal(synthesisDeadlineFor(now, deadline, true), deadline - 2500 - 5000,
    "with the check on, synthesis kept the check's window");
  assert.equal(synthesisDeadlineFor(now, deadline, false), deadline - 2500,
    "with the check off, the deadline changed");
  assert.equal(synthesisDeadlineFor(0, 10000000, true), 90000, "the 90 second cap moved");
  assert.ok(src.includes("synthesisDeadlineFor(Date.now(), requestDeadline"),
    "the handler does not compute its synthesis deadline through the reserve");
});

await test("gpt-oss-20b takes the standard cap, in the map and at the rescue call site", () => {
  assert.equal(cfLegTimeoutMs("@cf/openai/gpt-oss-20b", 10000), 3000);
  assert.equal(cfLegTimeoutMs("@cf/openai/gpt-oss-20b", 12000), 3000);
  assert.equal(cfLegTimeoutMs("@cf/meta/llama-4-scout-17b-16e-instruct", 10000), 3000,
    "an existing cap moved");
  assert.equal(cfLegTimeoutMs("@cf/meta/llama-3.3-70b-instruct-fp8-fast", 3500), 3500,
    "an unlisted leg no longer passes its timeout through");
  assert.ok(src.includes("callCF(CF_WAVE1[0], rescueMsgs, maxTokens, cfLegTimeoutMs(CF_WAVE1[0], 12000))"),
    "the rescue wave still passes its 12 second timeout raw");
});

await test("the retry race closes on its window: slow legs close, fast legs land, failures read as no retry", async () => {
  assert.equal(RETRY_RACE_CLOSE_MS, 5000);
  const slow = new Promise((res) => setTimeout(() => res({ answer: "slow" }), 250));
  assert.equal(await raceWithCloseWindow(slow, 40), "closed", "the window did not close the slow race");
  const fast = new Promise((res) => setTimeout(() => res({ answer: "fast" }), 5));
  const fastResult = await raceWithCloseWindow(fast, 1000);
  assert.ok(fastResult && fastResult.answer === "fast", "the fast winner was closed out");
  const failing = new Promise((_, rej) => setTimeout(() => rej(new Error("leg failed")), 5));
  assert.equal(await raceWithCloseWindow(failing, 1000), null, "a rejected race did not read as no retry");
  assert.ok(src.includes("raceWithCloseWindow(raceBest(legs, query, 500), RETRY_RACE_CLOSE_MS)"),
    "plannedRetryRace does not close on the window");
});

await test("the trace summary and stage wiring name the new tier (source pins)", () => {
  assert.ok(src.includes('note("gemini", "ok")'), "the Gemini tier does not record its outcome in the trace");
  assert.equal(factCheckTraceSummary([{ tier: "gemini", outcome: "ok" }]), "gemini ok");
  assert.ok(/\/\/ v51 \(2026-10-14, wave sixteen\)/.test(src), "the v51 chain entry is missing");
  // PIN UPDATED (2026-10-15, wave seventeen): the constant
  // moved to v52, the citation depth wave; the v51 chain
  // entry above stays as history.
  assert.ok(src.includes('const CACHE_SCHEMA_VERSION = "v52";'), "CACHE_SCHEMA_VERSION is not v52");
});

console.log(`\nsearch-wave-sixteen: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
