/**
 * Search fix wave 5 proofs (2026-11-05, fever expansion:
 * the authored concept pairing).
 *
 * Spec: the fever expansion diagnosis (~/workspace/cerebrum
 * -fever-expansion-diagnosis-nov05/report.md). Wave 4 removed
 * the collision from FEV2 ("what makes your temperature go
 * up when you have a bug") and its cited set came back clean
 * of entomology, but the full mark failed on its second half:
 * no on topic fever citation, because no executed query for
 * the question contains the word fever at all. The diagnosis
 * named all three routes closed: bare "temperature" resolves
 * through the climate group by design and no link joins the
 * resolved groups (climate, bug) to the fever group; the
 * model expansion leg never fires (every word tabled, and
 * the question's mechanism shape is one its adequacy test
 * does not know); and even fired, the model could seat fever
 * only as an alternate. Its recommended Candidate 1 is what
 * this suite proves: an authored pairing (CONCEPT_PAIRINGS)
 * in the wave 4 collision idiom. When bare "temperature" has
 * resolved through the climate group AND an illness frame
 * concept is also resolved (the bug group or the sickness
 * group), the existing fever group is seated for RETRIEVAL
 * ONLY: its own AND group in the boolean, "fever" in the
 * plain strings, "fever" available to the PubMed central
 * composer. The gate's central set stays exactly
 * [temperature, bug]; the gate is not touched. Probed in the
 * diagnosis: Europe PMC boolean plus the fever group counted
 * 189,881 with the mechanism paper at rank 1 against 867,834
 * shipped; PubMed's wave 4 string plus fever counted 65,
 * fever concentrated, against 462 diffuse.
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  onRequest, createSubrequestLedger, keywordPlainTerms, pubmedCentralString,
  buildStructuredQuery, rebuildStructuredQueryFromGroups, questionCentralConcepts,
  CONCEPT_PAIRINGS, retrievalPairingSeat, retrievalPairingSeatForTerms,
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

/* Harness identical in shape to the wave 4 suite: the real
 * handler, a Europe PMC fixture pool, the model fleet mock
 * answering with no concept groups, and every outbound URL
 * captured. */
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const realRandom = Math.random;
globalThis.caches = { default: { match: async () => undefined, put: async () => undefined } };
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
const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json" },
});
const chatRes = (text) => jsonRes({
  choices: [{ message: { role: "assistant", content: text } }],
});

let capturedUrls = [];
let scenPapers = [];
let scenAnswer = "## Short answer\n\nA recorded answer [1].";

async function runScenario(query, opts = {}) {
  capturedUrls = [];
  globalThis.fetch = async (url, opts2 = {}) => {
    const u = String(url);
    const body = typeof opts2.body === "string" ? opts2.body : "";
    if (u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("openrouter.ai") || u.includes("api.groq.com")) {
      if (body.includes("rigorous scientific fact-checker")) {
        return chatRes("no verdict available");
      }
      if (body.includes("Cite at least two different sources inline")) {
        return chatRes(scenAnswer);
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));
      }
      return chatRes("I cannot group those terms today.");
    }
    if (u.includes("api.crossref.org") ||
        u.includes("ebi.ac.uk/europepmc") || u.includes("api.openalex.org") ||
        u.includes("api.semanticscholar.org") || u.includes("eutils.ncbi.nlm.nih.gov") ||
        u.includes("doaj.org") || u.includes("api.core.ac.uk") || u.includes("base-search.net")) {
      capturedUrls.push(u);
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
      return jsonRes({});
    }
    if (u.includes("export.arxiv.org")) return new Response("", { status: 200 });
    return jsonRes({});
  };
  Math.random = () => 0.99;
  try {
    const ledger = createSubrequestLedger(undefined);
    const env = {
      DB: rgDb(),
      OPENROUTER_KEY: "fix5-nov05-test-openrouter-key-123456",
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
    return { data, captured: capturedUrls.slice() };
  } finally {
    globalThis.fetch = realFetch;
    Math.random = realRandom;
  }
}

const epmcFix = (id, title, abstractText, citedByCount, pubYear) => ({
  title,
  doi: "10.1000/fix5nov05-" + id,
  pubYear: String(pubYear),
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});
const GENERIC_POOL = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => epmcFix("g" + i,
  "A recorded field study part " + i,
  "Measurements were recorded across the study sites and tabulated by site and season, with every reading reported in full for each condition in the survey.",
  40, 2021));

function pubmedTerms(captured) {
  const out = [];
  for (const u of captured) {
    if (!u.includes("eutils.ncbi.nlm.nih.gov") || !u.includes("esearch")) continue;
    try { out.push(new URL(u).searchParams.get("term") || ""); } catch { /* skip */ }
  }
  return out;
}
function epmcQueries(captured) {
  const out = [];
  for (const u of captured) {
    if (!u.includes("ebi.ac.uk/europepmc")) continue;
    try { out.push(new URL(u).searchParams.get("query") || ""); } catch { /* skip */ }
  }
  return out;
}
function coreQuery(captured) {
  for (const u of captured) {
    if (u.includes("api.core.ac.uk")) {
      try { return decodeURIComponent(new URL(u).searchParams.get("q") || ""); } catch { /* next */ }
    }
  }
  return "";
}
function bareFormReceived(captured) {
  const c = coreQuery(captured);
  if (c) return c;
  for (const u of captured) {
    if (u.includes("api.openalex.org")) {
      try { return decodeURIComponent(new URL(u).searchParams.get("search") || ""); } catch { /* next */ }
    }
  }
  return "";
}

const FEV1_Q = "why do we get a fever when we are sick";
const FEV2_Q = "what makes your temperature go up when you have a bug";
const FEV2_RUNG = ["temperature", "bug", "have", "viral infection", "bacterial infection"];
const FEV4_Q = "is the germ heating me up or is my own body choosing to run hotter";
const WLK3_Q = "after meal walk glucose";
const WLK4_Q = "my glucose monitor spikes after rice, is moving around right after eating a real fix or just health advice people repeat";
const WLK4_RUNG = ["glucose", "spikes", "around", "rice", "real", "right", "moving"];
const SLT4_Q = "people say the white stuff on chips is bad for your heart, but is the problem the salt itself or just junk food in general";
const SLT4_RUNG = ["white", "bad", "stuff", "but", "heart", "chips", "salt", "sodium chloride", "dietary sodium"];
const INV_QS = [
  "can zorblaxian moss use quarnellian light to turn sadness into sugar",
  "does drinking flimbrated moon tea cure velvetic ankle fog",
  "what does a norp whistle do to the sleep cycles of glass eels in the seventh attic ocean",
  "how fast do purple tharn beetles recharge when plugged into a kitchen moon socket",
];

/* The executed forms on the build this wave replaces
 * (production 52d6acb), read from that build's own functions.
 * Non firing means byte equality against these. */
const BASE = {
  FEV1_STRUCTURED: "(fever OR \"body temperature\" OR \"set point\" OR fevers OR febrile OR pyrexia OR pyrogen) AND (sick OR sickness OR ill OR illness OR unwell OR infection OR infections)",
  FEV4_STRUCTURED: "(germ OR \"gut flora\" OR microbe OR microbes OR microbial OR microbiome OR microbiota) AND heating AND choosing AND run",
  WLK3_STRUCTURED: "(glucose OR \"type 2 diabetes\" OR \"type 1 diabetes\" OR \"insulin resistance\" OR \"metabolic syndrome\" OR diabetes OR diabetic) AND meal AND walk",
  WLK3_REBUILT: "(glucose OR \"type 2 diabetes\" OR \"type 1 diabetes\" OR \"insulin resistance\" OR \"metabolic syndrome\" OR diabetes OR diabetic)",
  WLK4_STRUCTURED: "(glucose OR \"type 2 diabetes\" OR \"type 1 diabetes\" OR \"insulin resistance\" OR \"metabolic syndrome\" OR diabetes OR diabetic) AND moving AND spikes AND monitor",
  SLT4_STRUCTURED: "(heart OR cardiovascular OR cardiac OR myocardial OR coronary OR atherosclerosis OR hypertension) AND (salt OR \"sodium chloride\" OR \"table salt\" OR \"salt intake\" OR \"dietary sodium\" OR salts OR sodium) AND itself AND problem",
  SLT4_REBUILT: "(heart OR cardiovascular OR cardiac OR myocardial OR coronary OR atherosclerosis OR hypertension) AND (salt OR \"sodium chloride\" OR \"table salt\" OR \"salt intake\" OR \"dietary sodium\" OR salts OR sodium)",
  INV_STRUCTURED: [
    "zorblaxian OR quarnellian OR sugar OR sadness",
    "flimbrated OR ankle OR drinking OR velvetic",
    "(sleep OR \"sleep deprivation\" OR \"sleep duration\" OR \"sleep quality\" OR \"sleep restriction\" OR \"sleep restricted\" OR \"chronic sleep restriction\") AND (ocean OR oceanic OR marine OR sea OR seawater OR pelagic OR benthic) AND cycles AND whistle",
    "kitchen OR beetles OR recharge OR plugged",
  ],
  FEV2_STRUCTURED_OLD: "(temperature OR climate OR warming OR thermal OR heat) AND (bug OR \"stomach bug\" OR \"viral infection\" OR \"bacterial infection\" OR bugs OR pathogen OR pathogens)",
  SLT4_PLAIN: ["white", "bad", "stuff", "but", "heart", "cardiovascular", "cardiac", "myocardial", "coronary", "chips", "salt", "sodium", "sodium chloride", "table salt", "salt intake", "sodium chloride", "dietary sodium"],
  WLK4_PLAIN: ["glucose", "diabetes", "diabetic", "insulin", "glycemic", "spikes", "around", "rice", "oryza sativa", "real", "right", "moving"],
};
const FEVER_GROUP_RENDER = "(fever OR \"body temperature\" OR \"set point\" OR fevers OR febrile OR pyrexia OR pyrogen)";
const tokens = (s) => String(s || "").split(/[,\s]+/).filter(Boolean);

/* ── The table ───────────────────────────────────────────── */
group("Pairing table — one authored entry, the FEV2 specimen");

await test("the table holds the temperature pairing as its only entry this wave", () => {
  assert.equal(CONCEPT_PAIRINGS.length, 1);
  const e = CONCEPT_PAIRINGS[0];
  assert.equal(e.term, "temperature");
  assert.equal(e.seatHead, "fever");
  assert.deepEqual(e.frameHeads, ["bug", "sick"]);
});

await test("the seat fires on FEV2 and names the existing fever group", () => {
  const hit = retrievalPairingSeat(FEV2_Q, null);
  assert.ok(hit, "no seat on FEV2");
  assert.ok(hit.seat.has("fever") && hit.seat.has("febrile") && hit.seat.has("pyrexia"),
    "the seat is not the fever group");
  const hitT = retrievalPairingSeatForTerms(FEV2_RUNG, null);
  assert.ok(hitT && hitT.entry.seatHead === "fever", "the terms form does not seat fever");
});

await test("the seat does not fire on FEV1 (fever already resolved), FEV4 (no bare temperature), or the controls and guards", () => {
  for (const q of [FEV1_Q, FEV4_Q, WLK3_Q, WLK4_Q, SLT4_Q, ...INV_QS]) {
    assert.equal(retrievalPairingSeat(q, null), null, "seat fired on: " + q);
    assert.equal(retrievalPairingSeatForTerms([q], null), null);
  }
});

/* ── The boolean ─────────────────────────────────────────── */
group("buildStructuredQuery — the fever group joins as its own AND group");

await test("FEV2: the boolean is the shipped boolean plus the fever group as a third AND group", () => {
  assert.equal(buildStructuredQuery(FEV2_Q, null),
    BASE.FEV2_STRUCTURED_OLD + " AND " + FEVER_GROUP_RENDER);
  assert.equal(rebuildStructuredQueryFromGroups(FEV2_Q, null),
    BASE.FEV2_STRUCTURED_OLD + " AND " + FEVER_GROUP_RENDER);
});

await test("non firing: the booleans for FEV1, FEV4, WLK3, WLK4, SLT4 and INV1 to INV4 are byte unchanged", () => {
  assert.equal(buildStructuredQuery(FEV1_Q, null), BASE.FEV1_STRUCTURED);
  assert.equal(buildStructuredQuery(FEV4_Q, null), BASE.FEV4_STRUCTURED);
  assert.equal(buildStructuredQuery(WLK3_Q, null), BASE.WLK3_STRUCTURED);
  assert.equal(buildStructuredQuery(WLK4_Q, null), BASE.WLK4_STRUCTURED);
  assert.equal(buildStructuredQuery(SLT4_Q, null), BASE.SLT4_STRUCTURED);
  INV_QS.forEach((q, i) => assert.equal(buildStructuredQuery(q, null), BASE.INV_STRUCTURED[i], "INV" + (i + 1)));
  assert.equal(rebuildStructuredQueryFromGroups(FEV1_Q, null), BASE.FEV1_STRUCTURED);
  assert.equal(rebuildStructuredQueryFromGroups(WLK3_Q, null), BASE.WLK3_REBUILT);
  assert.equal(rebuildStructuredQueryFromGroups(SLT4_Q, null), BASE.SLT4_REBUILT);
  assert.equal(rebuildStructuredQueryFromGroups(INV_QS[0], null), null);
  assert.equal(rebuildStructuredQueryFromGroups(INV_QS[1], null), null);
  assert.equal(rebuildStructuredQueryFromGroups(INV_QS[2], null),
    "(sleep OR \"sleep deprivation\" OR \"sleep duration\" OR \"sleep quality\" OR \"sleep restriction\" OR \"sleep restricted\" OR \"chronic sleep restriction\") AND (ocean OR oceanic OR marine OR sea OR seawater OR pelagic OR benthic)");
  assert.equal(rebuildStructuredQueryFromGroups(INV_QS[3], null), null);
});

/* ── The plain strings ───────────────────────────────────── */
group("keywordPlainTerms — fever joins the plain string, the wave 4 form otherwise intact");

await test("FEV2: the plain terms gain fever at the tail, no bare bug, the bridge alternates ride", () => {
  const plain = keywordPlainTerms(FEV2_RUNG, null);
  assert.equal(plain[plain.length - 1], "fever");
  assert.ok(!plain.includes("bug") && !plain.includes("stomach bug"), "the bare form rides: " + plain.join(" "));
  assert.ok(plain.includes("viral infection") && plain.includes("bacterial infection"),
    "the bridge alternates are missing: " + plain.join(" "));
  assert.equal(plain[0], "temperature");
});

await test("non firing: the SLT4 and WLK4 plain forms are byte unchanged", () => {
  assert.deepEqual(keywordPlainTerms(SLT4_RUNG, null), BASE.SLT4_PLAIN);
  assert.deepEqual(keywordPlainTerms(WLK4_RUNG, null), BASE.WLK4_PLAIN);
});

/* ── The PubMed central string ───────────────────────────── */
group("pubmedCentralString — the probed form plus fever, the wave 3 forms elsewhere");

await test("FEV2: the central string is the diagnosis's probed form, the wave 4 string plus fever", () => {
  assert.equal(pubmedCentralString(FEV2_RUNG, FEV2_Q, null),
    "temperature viral infection bacterial infection pathogen fever");
});

await test("non firing: SLT4 and WLK4 central strings are the wave 3 forms, unchanged", () => {
  assert.equal(pubmedCentralString(SLT4_RUNG, SLT4_Q, null), "heart salt");
  assert.equal(pubmedCentralString(WLK4_RUNG, WLK4_Q, null), "moving glucose rice");
});

/* ── The gate is untouched ───────────────────────────────── */
group("The gate — the central set is exactly what it was");

await test("questionCentralConcepts on FEV2 names temperature alone locally, as on the shipped build", () => {
  const terms = questionCentralConcepts(FEV2_Q, null).map((c) => c.term);
  assert.deepEqual(terms, ["temperature"]);
});

/* ── Handler level ───────────────────────────────────────── */
group("Handler — what the sources actually receive on FEV2");

await test("FEV2 handler: Europe PMC receives the boolean with the fever group as its own AND group", async () => {
  scenPapers = GENERIC_POOL;
  const { captured } = await runScenario(FEV2_Q, { settings: {} });
  const qs = epmcQueries(captured);
  assert.ok(qs.length > 0, "no Europe PMC query captured");
  assert.ok(qs.some((q) => q === BASE.FEV2_STRUCTURED_OLD + " AND " + FEVER_GROUP_RENDER),
    "the executed boolean lacks the seated fever group: " + qs[0]);
});

await test("FEV2 handler: PubMed's terms carry fever and no bare bug token", async () => {
  scenPapers = GENERIC_POOL;
  const { captured } = await runScenario(FEV2_Q, { settings: {} });
  const terms = pubmedTerms(captured);
  assert.ok(terms.length > 0, "no PubMed term captured");
  for (const t of terms) {
    assert.ok(!tokens(t).includes("bug"), "a PubMed term carries the bare token: " + t);
  }
  assert.ok(terms.some((t) => tokens(t).includes("fever")), "no PubMed term carries fever: " + terms.join(" | "));
});

await test("FEV2 handler: the plain keyword form carries fever, temperature, and no bare bug token", async () => {
  scenPapers = GENERIC_POOL;
  const { captured } = await runScenario(FEV2_Q, { settings: {} });
  const q = bareFormReceived(captured);
  assert.ok(q, "no plain keyword form captured");
  assert.ok(tokens(q).includes("fever"), "the plain form lacks fever: " + q);
  assert.ok(tokens(q).includes("temperature"), "the plain form lacks temperature: " + q);
  assert.ok(!tokens(q).includes("bug"), "the plain form carries the bare token: " + q);
});

await test("FEV2 handler: the record's gate central set stays exactly [temperature, bug]", async () => {
  scenPapers = GENERIC_POOL;
  const { data } = await runScenario(FEV2_Q, { settings: {} });
  const central = data && data._expansion && data._expansion.coverage
    ? data._expansion.coverage.central : null;
  assert.deepEqual(central, ["temperature", "bug"]);
});

await test("WLK3 handler: the control boolean reaches Europe PMC byte unchanged", async () => {
  scenPapers = GENERIC_POOL;
  const { captured } = await runScenario(WLK3_Q, { settings: {} });
  const qs = epmcQueries(captured);
  // The handler renders the boolean with singleton rungs
  // parenthesized; this exact form is what the production
  // build sends (verified by a two build capture diff over
  // the whole specimen set: every captured URL byte identical
  // except FEV2's fever additions).
  const handlerForm = "(glucose OR \"type 2 diabetes\" OR \"type 1 diabetes\" OR \"insulin resistance\" OR \"metabolic syndrome\" OR diabetes OR diabetic) AND (meal) AND (walk)";
  assert.ok(qs.some((q) => q === handlerForm),
    "the control boolean changed: " + qs[0]);
  assert.ok(!qs.some((q) => q.includes("fever")), "a fever group reached the control's boolean");
});

console.log("\nsearch-fix5-nov05: " + passed + " passed, " + failures.length + " failed");
if (failures.length) {
  for (const f of failures) console.log("  FAILED:", f);
  process.exitCode = 1;
}
