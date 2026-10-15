/**
 * Search wave seventeen (2026-10-15). The citation depth wave,
 * built from the instrumented diagnosis of the wave sixteen
 * live probe batch (cited 0, 1, 1, 0, 0 on five everyday
 * questions while the honesty machinery held): the cull, not
 * the synthesis fleet, was starving the cited set. Four fixes,
 * in the diagnosis's stated order of expected recovery:
 *
 *   1. Gate hygiene: filler and closed class words ("enough",
 *      "easier", "else") are screened out of the judged concept
 *      set at every admission site, and the strict citation
 *      gate degrades to a one real concept rule when the
 *      judged set carries exactly one grouped or subject
 *      concept — the topical papers the union with bare stand
 *      ins demoted become citable, and the paper that cleared
 *      on "sleeping" plus the filler "enough" stops clearing.
 *   2. Subject serve: when the serve would refuse, the answer
 *      is demoted and rebuilt over subject engaging citable
 *      papers first; the refusal stands only when that set is
 *      truly empty. Gate audit rescue: minAdmitted 2 to 1
 *      when citable is 1.
 *   3. Retrieval wording: static everyday vocabulary bridges
 *      in the concept groups (puff to swelling and edema, the
 *      sleep and cold groups, the waste oil phrases), so the
 *      bridge exists on every draw instead of depending on a
 *      lucky model expansion; known collision tokens are never
 *      sent bare to the plain keyword engines (the group's
 *      alternates go instead); closed class words are out of
 *      boolean group alternates and keyword rungs.
 *   4. Citable aware readmission: papers that miss the
 *      quality floor's core hit requirement by exactly one
 *      hit are readmitted when the shelf's citable shaped
 *      count (the diagnosis's cheap proxy: organism gate plus
 *      core hits at the requirement) is below the shelf
 *      minimum, capped at three.
 *
 * The hard guards: the relevance floor is not lowered, the
 * old cascade does not return, and the diagnosis's named junk
 * specimens (the Beijing air quality paper cited for the sky,
 * the hair oil trial cited for creatine, the twisted tube
 * paper presented for an ankle) still fail under the fixed
 * chain.
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 *
 * Run with: node tests/search-wave-seventeen.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
const search = await import(join(root, "functions/api/search.js"));

const {
  onRequest, createSubrequestLedger,
  buildDeterministicFallbackGroups, buildDynLookup, centralContentTerms,
  citationGateStandard, gateJudgedConcepts, paperClearsCitationGate,
  paperIsCitable, conceptGateContext, questionCentralConcepts, buildStructuredQuery,
  keywordPlainTerms, subjectEngagingEvidence, citedSetEngagesSubject,
} = search;

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

// ── Scenario runner (wave sixteen pattern) ──────────────────
let scenPapers = [];
let scenAnswer = "";
let scenRetryAnswer = null;
let scenFactCheck = null;
let scenFactCheckMode = "ok";
let scenExpansion = null;
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
      OPENROUTER_KEY: "w17-test-openrouter-key-123456",
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

const epmc17 = (id, title, abstractText, citedByCount, pubYear) => ({
  title,
  doi: "10.1000/w17-" + id,
  pubYear: String(pubYear),
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});

// ═══════════════════════════════════════════════════════════════
group("Fix 1 — gate hygiene (unit)");

const SLEEP_Q = "does not sleeping enough make it easier to catch a cold";

await test("the filler words never become central terms", () => {
  const terms = centralContentTerms(SLEEP_Q);
  assert.deepEqual(terms, ["sleeping", "catch"],
    "central terms still carry filler: " + JSON.stringify(terms));
});

await test("a hand built standard cannot seat filler at the judging table", () => {
  const judged = gateJudgedConcepts({
    groups: [],
    centralTerms: ["sleeping", "enough", "easier", "catch"],
    subjectGroup: null,
    centralConcepts: [
      { term: "sleeping", group: null, subject: false },
      { term: "cold", group: null, subject: false },
    ],
    mechanismShape: false,
  });
  assert.deepEqual(judged.map((c) => c.term), ["sleeping", "cold", "catch"],
    "the judged set still seats filler: " + JSON.stringify(judged.map((c) => c.term)));
});

await test("else and wear never become concepts", () => {
  const oilQ = "What happens when you feed black soldier fly maggots used fryer oil and not much else?";
  const oilConcepts = questionCentralConcepts(oilQ, dynFor(oilQ)).map((c) => c.term);
  assert.ok(!oilConcepts.includes("else"), "'else' became a concept: " + JSON.stringify(oilConcepts));
  const sockQ = "my ankles puff up when i wear tight socks all day is that bad";
  const sockConcepts = questionCentralConcepts(sockQ, dynFor(sockQ)).map((c) => c.term);
  assert.ok(!sockConcepts.includes("wear"), "'wear' became a concept: " + JSON.stringify(sockConcepts));
});

const PRATHER = { title: "Behaviorally Assessed Sleep and Susceptibility to the Common Cold",
  abstract: "Sleep is implicated in resistance to infectious illness. Adults had sleep duration and sleep efficiency assessed behaviorally over 14 consecutive days, were quarantined, exposed to a rhinovirus, and monitored for the development of a clinical cold. Poorer sleep efficiency and shorter sleep duration were associated with lowered resistance to illness." };
const COHEN = { title: "Sleep Habits and Susceptibility to the Common Cold",
  abstract: "Participants reported their sleep habits, including sleep duration and sleep efficiency, for 14 days. They were then exposed to a rhinovirus and monitored in quarantine for signs of infection and clinical illness. Participants with less than 7 hours of sleep were more likely to develop a cold than those with 8 hours or more of sleep." };
const ATHLETE = { title: "Are Adolescent Athletes Sleeping Enough?",
  abstract: "We surveyed adolescent athletes about sleeping habits, training load, and daytime sleepiness. Many athletes reported sleeping less than the recommended duration for their age, and sleeping hours were shortest during competition weeks. Coaches should monitor sleeping time in young athletes." };

await test("the sleep leak is closed: the athlete paper fails, the cold papers clear", () => {
  const std = citationGateStandard(SLEEP_Q, dynFor(SLEEP_Q));
  assert.equal(paperClearsCitationGate(ATHLETE, std), false,
    "the athlete survey still clears on sleeping plus filler");
  assert.equal(paperClearsCitationGate(PRATHER, std), true,
    "the Prather shaped paper no longer clears");
  assert.equal(paperClearsCitationGate(COHEN, std), true,
    "the Cohen shaped paper no longer clears");
});

const OIL_Q = "What happens when you feed black soldier fly maggots used fryer oil and not much else?";
const OIL_DYN = buildDynLookup([
  { term: "black soldier fly", alternates: ["hermetia illucens", "black soldier fly larvae", "maggots"] },
  { term: "fryer oil", alternates: ["cooking oil for frying", "frying medium"] },
]);
const SUBJECT_ONLY = { title: "Leveraging black soldier fly larvae for sustainable poultry waste management",
  abstract: "Black soldier fly larvae convert poultry manure into protein rich biomass. Farms adopting black soldier fly systems reduced poultry waste volumes substantially. Larval meal from the process replaced a share of conventional feed protein in broiler diets." };
const STANDINS_ONLY = { title: "Heat recovery from fryer oil in commercial kitchens",
  abstract: "Commercial kitchens discharge fryer oil at high temperature after frying cycles. We measured heat recovery from the oil stream and modelled energy savings for restaurants reusing fryer oil heat in water heating. The oil temperature profile during frying drove the recovery rate." };

await test("one real concept: subject only papers clear, stand in only papers fail", () => {
  const std = citationGateStandard(OIL_Q, OIL_DYN);
  assert.equal(paperClearsCitationGate(SUBJECT_ONLY, std), true,
    "the subject only paper still fails the degraded standard");
  assert.equal(paperClearsCitationGate(STANDINS_ONLY, std), false,
    "a paper engaging only bare stand ins still clears");
});

// ═══════════════════════════════════════════════════════════════
group("Guards — the named junk specimens still fail");

await test("the Beijing air quality paper still fails for the sky", () => {
  const q = "why is the sky blue";
  const std = citationGateStandard(q, dynFor(q));
  const junk = { title: "Air quality in Beijing: PM2.5 concentrations and health effects",
    abstract: "We measured PM2.5 concentrations across Beijing over two winters and modelled associations with hospital admissions for respiratory disease. Air pollution levels exceeded national standards on most sampled days." };
  assert.equal(paperClearsCitationGate(junk, std), false, "the sky junk specimen clears the gate");
  assert.equal(paperIsCitable({ ...junk, relevance: 88 }, 1, conceptGateContext([junk], q, dynFor(q))), false,
    "the sky junk specimen is citable at high relevance");
});

await test("the hair oil trial still fails for the creatine question", () => {
  const q = "does the powder guys take for muscles make your hair fall out";
  const dyn = buildDynLookup([
    { term: "powder", alternates: ["supplement powder", "creatine"] },
    { term: "hair", alternates: ["hair loss", "baldness"] },
    { term: "muscles", alternates: ["muscle mass", "strength training"] },
  ]);
  const std = citationGateStandard(q, dyn);
  const hairOil = { title: "A randomised trial of herbal hair oil for scalp and hair care",
    abstract: "We evaluated a herbal hair oil preparation in adults with dry scalp. Participants applied the oil twice weekly for twelve weeks and reported changes in hair shedding, scalp comfort, and hair shine on standardised questionnaires administered at a dermatology clinic." };
  assert.equal(paperClearsCitationGate(hairOil, std), false, "the hair oil trial clears the gate");
  const serve = citedSetEngagesSubject([hairOil], new Set([1]), q, dyn);
  assert.equal(serve.engaged, false, "the hair oil trial engages the creatine subject");
});

await test("the twisted tube paper still fails for the ankle question", () => {
  const q = "my ankles puff up when i wear tight socks all day is that bad";
  const std = citationGateStandard(q, dynFor(q));
  const tube = { title: "Heat transfer enhancement in twisted tube exchangers",
    abstract: "Twisted tube geometry enhances heat transfer in shell and tube exchangers. We measured Nusselt numbers across Reynolds numbers for three twist ratios and report friction factors for each configuration in turbulent flow." };
  assert.equal(paperClearsCitationGate(tube, std), false, "the twisted tube specimen clears the gate");
  assert.equal(paperIsCitable({ ...tube, relevance: 91 }, 1, conceptGateContext([tube], q, dynFor(q))), false,
    "the twisted tube specimen is citable at high relevance");
});

// ═══════════════════════════════════════════════════════════════
group("Fix 3 — retrieval wording (unit)");

await test("the puff bridge exists statically: the concept group resolves", () => {
  const q = buildStructuredQuery("my ankles puff up when i wear tight socks all day is that bad", null);
  assert.ok(q.includes("(puff OR swelling OR edema OR swollen)"),
    "the structured query does not carry the puff bridge: " + q);
});

await test("collision tokens are never sent bare to the plain keyword engines", () => {
  const bridged = keywordPlainTerms(["puff"], null);
  assert.ok(!bridged.includes("puff"), "the bare collision token survived: " + JSON.stringify(bridged));
  assert.ok(bridged.includes("swelling") && bridged.includes("edema"),
    "the bridge alternates missing: " + JSON.stringify(bridged));
  assert.deepEqual(keywordPlainTerms(["else"], null), [],
    "a closed class word reached the plain terms");
  assert.deepEqual(keywordPlainTerms(["socks"], null), ["socks"],
    "an unbridged term did not pass through untouched");
});

await test("closed class words are out of the boolean groups", () => {
  const q = buildStructuredQuery(OIL_Q, OIL_DYN);
  assert.ok(!/ OR not( |\))/.test(q) && !/else/.test(q),
    "the structured query still carries filler alternates: " + q);
  assert.ok(q.includes("maggots OR fryer OR oil"),
    "the topic group lost its real terms: " + q);
  const sleep = buildStructuredQuery(SLEEP_Q, null);
  assert.ok(sleep.includes("insomnia"),
    "the sleep bridge does not render in the structured query: " + sleep);
});

// ═══════════════════════════════════════════════════════════════
group("Fix 2 — subject serve pieces (unit)");

await test("subjectEngagingEvidence selects exactly the subject engaging papers", () => {
  const pool = [STANDINS_ONLY, SUBJECT_ONLY];
  const r = subjectEngagingEvidence(pool, OIL_Q, OIL_DYN);
  assert.equal(r.judged, true, "the subject did not resolve");
  assert.deepEqual(r.papers.map((p) => p.title), [SUBJECT_ONLY.title],
    "the rebuild pool is wrong: " + JSON.stringify(r.papers.map((p) => p.title)));
});

await test("the gate audit minimum is 1 when citable is 1 (source pin)", () => {
  assert.ok(!src.includes("citablePapers.length === 0 ? 1 : 2"),
    "the old minAdmitted split survives");
  assert.ok(src.includes("the minimum is 1 in both"),
    "the wave seventeen minAdmitted note is missing");
});

// ═══════════════════════════════════════════════════════════════
group("Fix 2 — the subject serve rebuilds before it refuses (handler)");

const CREATINE_Q = "does the powder guys take for muscles make your hair fall out";
const CREATINE_EXPANSION = JSON.stringify([
  { term: "powder", alternates: ["supplement powder", "creatine"] },
  { term: "hair", alternates: ["hair loss", "baldness"] },
  { term: "muscles", alternates: ["muscle mass", "strength training"] },
]);
// Citable on two backed concepts (hair, muscles) but never
// engaging the subject (the supplement concept): the shape
// that used to zero the whole run.
const OFF_SUBJECT_CITABLE = epmc17("h1", "Hair loss and muscle mass in resistance trained men: a cohort study",
  "Hair loss concerns are common among resistance trained men. We followed 412 gym members for two years, recording hair loss scores, muscle mass by bioimpedance, strength training volume, and supplement habits in general terms. Hair loss progressed fastest in men with the highest training volume, and muscle mass gains tracked training load across the cohort.", 720, 2023);
const SUBJECT_PAPER = epmc17("c1", "Creatine monohydrate supplementation and hair loss: a randomised controlled trial",
  "Creatine monohydrate is a powder widely used by men who train for muscle strength. We randomised resistance trained men to creatine powder or placebo for twelve weeks and measured dihydrotestosterone, total testosterone, and hair follicle density to test whether the supplement affects hair loss.", 130, 2024);
const OFF_SUBJECT_ANSWER = "## Short answer\n\n**Hair loss** in men who train is common, and a cohort study of gym members tracked **hair loss** scores alongside **muscle mass** over two years [1].\n\nHair loss progressed fastest in the men with the highest training volume, and muscle mass gains tracked training load across the cohort [1].";
const OFF_SUBJECT_FACTCHECK = JSON.stringify({ claims: [
  { claim: "Hair loss in men who train is common, and a cohort study tracked hair loss scores alongside muscle mass",
    source_index: 1,
    quote: "recording hair loss scores, muscle mass by bioimpedance",
    status: "supported",
    justification: "The first source followed gym members and recorded hair loss scores and muscle mass by bioimpedance over two years, matching the claim as written." },
  { claim: "Hair loss progressed fastest in the men with the highest training volume",
    source_index: 1,
    quote: "Hair loss progressed fastest in men with the highest training volume",
    status: "supported",
    justification: "The first source states directly that hair loss progressed fastest in men with the highest training volume in its cohort." },
] });

await test("a citable off subject citation with a subject paper in the pool: rebuilt, not refused", async () => {
  scenPapers = [OFF_SUBJECT_CITABLE, SUBJECT_PAPER];
  scenAnswer = OFF_SUBJECT_ANSWER;
  scenRetryAnswer = null;
  scenFactCheck = OFF_SUBJECT_FACTCHECK;
  scenFactCheckMode = "ok";
  scenExpansion = CREATINE_EXPANSION;
  const { data } = await runScenario(CREATINE_Q, { settings: { factCheck: true } });
  assert.notEqual(data.responseKind, "no-results",
    "the run refused although a subject engaging citable paper stood in the pool: " + String(data.answer || "").slice(0, 200));
  const rec = data._record || {};
  assert.ok(rec.subjectServe && rec.subjectServe.fired === true && rec.subjectServe.rebuilt === true,
    "the subject serve did not record a rebuild: " + JSON.stringify(rec.subjectServe || null));
  assert.ok(/Creatine monohydrate/.test(String(data.answer || "")),
    "the rebuilt answer is not built on the subject paper: " + String(data.answer || "").slice(0, 200));
});

await test("the same citation with no subject paper in the pool: the refusal stands", async () => {
  scenPapers = [OFF_SUBJECT_CITABLE];
  scenAnswer = OFF_SUBJECT_ANSWER;
  scenRetryAnswer = null;
  scenFactCheck = OFF_SUBJECT_FACTCHECK;
  scenFactCheckMode = "ok";
  scenExpansion = CREATINE_EXPANSION;
  const { data } = await runScenario(CREATINE_Q, { settings: { factCheck: true } });
  assert.equal(data.responseKind, "no-results",
    "the run shipped an answer although no citable paper engages the subject: " + data.responseKind + " / " + String(data.answer || "").slice(0, 160));
  const rec = data._record || {};
  assert.ok(rec.subjectServe && rec.subjectServe.fired === true && !rec.subjectServe.rebuilt,
    "the subject serve did not record a plain refusal: " + JSON.stringify(rec.subjectServe || null));
});

// ═══════════════════════════════════════════════════════════════
group("Fix 4 — citable aware readmission (source pins)");

await test("the readmission carries the diagnosis's exact conditions", () => {
  assert.ok(src.includes("CITABLE AWARE SHELF READMISSION"),
    "the readmission block is missing");
  assert.ok(src.includes("coreHitsOf(p) === requiredC - 1"),
    "the exactly one hit short condition is missing");
  assert.ok(src.includes("admittedC.length >= 3"),
    "the three paper cap is missing");
  assert.ok(src.includes("diag.citableReadmission"),
    "the readmission does not record itself");
});

// ═══════════════════════════════════════════════════════════════
group("Cache version");

await test("CACHE_SCHEMA_VERSION is v52 with the dated chain entry, v51 kept as history", () => {
  assert.ok(src.includes('const CACHE_SCHEMA_VERSION = "v52";'),
    "CACHE_SCHEMA_VERSION was not bumped to v52");
  assert.ok(/\/\/ v52 \(2026-10-15, wave seventeen\)/.test(src),
    "the v52 chain entry is missing its dated reason");
  assert.ok(/\/\/ v51 \(2026-10-14, wave sixteen\)/.test(src),
    "the v51 chain entry was not kept as history");
});

console.log(`\nsearch-wave-seventeen: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
