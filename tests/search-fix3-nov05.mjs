/**
 * Search fix wave 3 proofs (2026-11-05, post rung diagnosis).
 *
 * The post rung diagnosis (~/workspace/cerebrum-postrung-diag-
 * nosis-nov05/report.md) located pass 4's remaining loss one
 * level below the executed rung wave 2 fixed: the fanout
 * rewrites the rung's terms per source, and three of those
 * rewrites destroy the topic before any source is consulted.
 * Each lane is proven at the composition level the diagnosis
 * measured, on the real bank wordings.
 *
 * Lane A: keywordPlainTerms replaced a bridged term with its
 * group alternates and dropped the term itself — on FEV2, no
 * string sent to any source contained the question's own
 * temperature vocabulary ("temperature" became only its
 * climate group), CORE answered the climate literature, and
 * rice and salt vanished behind "oryza sativa" and the
 * sodium forms the same way. The fix keeps the term itself
 * as the first plain term with its alternates after it.
 *
 * Lane B: the constraint phrase override fed PubMed either a
 * multi phrase salad every rung probed at exactly 0 against
 * PubMed itself (WLK4, WLK2, SLT4), or a lone word mapping
 * to over a million records (FEV2's "temperature"). When the
 * override is a salad or a lone word, PubMed now receives a
 * short string built from the rung's central terms
 * (pubmedCentralString). A single multi word phrase (the
 * WLK3 control shape) keeps its form exactly.
 *
 * Lane C: the Europe PMC boolean ANDed incidental groups the
 * target literature cannot match (WLK2's pasta and anything,
 * SLT4's itself and problem, WLK4's monitor with no movement
 * concept). BUILT AND REVERTED IN FULL (2026-11-05): the
 * centrality pass (keep only questionCentralConcepts backed
 * anchors in the AND chain, seat the action verb, rebuild an
 * all incidental chain from the central concepts) composed
 * the diagnosed shapes on all four specimens, but it broke
 * the pinned anchor doctrine in tests/query-expansion.mjs
 * (9 tests: the sea turtle question's "mother", branches,
 * rivers, snakes, catch, the frog OR form, the "easier catch
 * cold" phrase group) and tests/query-understanding-repair
 * .mjs (2 tests: a stated quantity beside "night", the
 * operative noun beside "activity"), both green on the
 * pristine tree. The gate's central concept accounting is a
 * citation device; the boolean's anchors are a different
 * doctrine, and content words the gate does not name are
 * pinned anchors. Filed unbuilt, the Group A pattern: the
 * incidentals need a droppable class named against those
 * suites' specimens before any new pass is built. The two
 * control tests below (FEV2 byte exact, WLK3 unchanged) pin
 * that the revert left the builder exactly as it stood.
 *
 * Lane D: the BSF4 specimen engaged exactly one central
 * concept (the substrate through the scraps bridge) and the
 * gate demanded two — but the two concepts it missed and hit
 * are two phrasings of one concept (the substrate, stated as
 * the used cooking oil and as the scraps). An authored family
 * (CONCEPT_GROUP_FAMILIES) now counts a family's concepts in
 * the judged set as engaged when any one of them engages.
 * Genuinely distinct concepts still each require engagement.
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  onRequest, createSubrequestLedger, keywordPlainTerms, buildStructuredQuery,
  pubmedCentralString, conceptGroupFamilyOf, citationGateStandard,
  gateJudgedConcepts, paperClearsCitationGate,
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

/* Harness identical in shape to the wave 2 suite: the real
 * handler, a Europe PMC fixture pool, the model fleet mock
 * answering with no concept groups (the deterministic shape
 * the diagnosis probed), and every outbound URL captured. */
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
      OPENROUTER_KEY: "fix3-nov05-test-openrouter-key-123456",
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
  doi: "10.1000/fix3nov05-" + id,
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
    try { out.push(decodeURIComponent(new URL(u).searchParams.get("query") || "")); } catch { /* skip */ }
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
/* The rung's bare form as any plain keyword source received
 * it: CORE's ?q= or OpenAlex's ?search= carry the same string.
 * Which of them fires inside the budget varies run to run;
 * the form under proof does not. */
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

const FEV2_Q = "what makes your temperature go up when you have a bug";
const FEV2_RUNG = ["temperature", "bug", "have", "viral infection", "bacterial infection"];
const WLK4_Q = "my glucose monitor spikes after rice, is moving around right after eating a real fix or just health advice people repeat";
const WLK4_RUNG = ["glucose", "spikes", "around", "rice", "real", "right", "moving"];
const WLK2_Q = "i eat a huge bowl of pasta then sit on the couch, would ten minutes walking after actually change anything in my blood";
const WLK2_RUNG = ["ten minutes", "walking", "eat", "bowl", "couch", "pasta", "huge"];
const SLT4_Q = "people say the white stuff on chips is bad for your heart, but is the problem the salt itself or just junk food in general";
const SLT4_RUNG = ["white", "bad", "stuff", "but", "heart", "chips", "salt", "sodium chloride", "dietary sodium"];
const WLK3_Q = "after meal walk glucose";

/* ── Lane A: the bridged term is kept ────────────────────── */
group("Lane A — keywordPlainTerms keeps the bridged term");

const plainTokens = (s) => String(s || "").split(/[,\s]+/).filter(Boolean);
await test("FEV2: the plain string carries temperature itself, not only its climate group", () => {
  const plain = keywordPlainTerms(FEV2_RUNG);
  const toks = plainTokens(plain);
  assert.ok(toks.includes("temperature"), "temperature missing: " + plain);
  // WITNESS UPDATED (2026-11-05, search fix wave 4): this
  // assertion also required the bare token "bug" to ride,
  // pinning the wave 3 kept term form. The collision
  // diagnosis traced that kept bare word as the FEV2
  // regression's carrier (PubMed's "temperature bug" slice
  // supplied all 8 live citations, all entomology), and
  // wave 4 withholds the bare form for tabled collision
  // terms: bug's bridge alternates now carry its sense in
  // the plain string. Temperature's kept form, the property
  // this test exists to pin, is unchanged.
  assert.ok(!toks.includes("bug"), "the bare collision token rides again: " + plain);
  assert.ok(/viral infection/.test(plain), "bug's bridge alternates should ride: " + plain);
  assert.ok(/climate/.test(plain), "the group alternates should still ride: " + plain);
});

await test("WLK4: the plain string carries rice itself, not only oryza sativa", () => {
  const plain = keywordPlainTerms(WLK4_RUNG);
  const toks = plainTokens(plain);
  assert.ok(toks.includes("rice"), "rice missing: " + plain);
  assert.ok(toks.includes("glucose"), "glucose missing: " + plain);
});

await test("SLT4: the plain string carries salt itself beside its sodium forms", () => {
  const plain = keywordPlainTerms(SLT4_RUNG);
  const toks = plainTokens(plain);
  assert.ok(toks.includes("salt"), "salt missing: " + plain);
  assert.ok(/sodium/.test(plain), "the sodium forms should still ride: " + plain);
});

await test("FEV2 handler: the bare form a plain keyword source receives contains temperature", async () => {
  scenPapers = GENERIC_POOL;
  const { captured } = await runScenario(FEV2_Q, { settings: {} });
  const q = bareFormReceived(captured);
  assert.ok(plainTokens(q).includes("temperature"), "the bare form lacks temperature: " + q);
});

/* ── Lane B: PubMed's string ─────────────────────────────── */
group("Lane B — PubMed receives a composable central string");

await test("central strings compose from the rungs' own central terms", () => {
  // WITNESS UPDATED (2026-11-05, search fix wave 4): FEV2's
  // expectation was "temperature bug", the wave 3 form. The
  // collision diagnosis probed that exact string on PubMed
  // (count 346, 11 entomology papers in the top 12) and
  // named it the live regression's largest carrier; wave 4
  // seats a tabled collision term's bridge alternates in
  // its place, the probed C1 form. The other three strings,
  // the property this test pins for untabled words, are
  // unchanged.
  // WITNESS UPDATED (2026-11-05, search fix wave 5): FEV2's
  // expectation gains the word fever at the tail. The fever
  // expansion diagnosis probed the wave 4 string plus fever
  // on PubMed (count 65, fever concentrated, against 462
  // diffuse) and wave 5's authored pairing seats the fever
  // group's head in the central string when the rung carries
  // the pairing (bare temperature through the climate group
  // beside an illness frame concept). The C1 body, the
  // property this test pins for the collision term, is
  // unchanged in front of it.
  assert.equal(pubmedCentralString(FEV2_RUNG, FEV2_Q, null), "temperature viral infection bacterial infection pathogen fever");
  assert.equal(pubmedCentralString(WLK4_RUNG, WLK4_Q, null), "moving glucose rice");
  assert.equal(pubmedCentralString(WLK2_RUNG, WLK2_Q, null), "ten minutes walking");
  assert.equal(pubmedCentralString(SLT4_RUNG, SLT4_Q, null), "heart salt");
});

await test("WLK4 handler: PubMed's first term is no salad and carries the movement verb", async () => {
  scenPapers = GENERIC_POOL;
  const { captured } = await runScenario(WLK4_Q, { settings: {} });
  const terms = pubmedTerms(captured);
  assert.ok(terms.length > 0, "no PubMed term captured");
  assert.ok(!/monitor spikes after rice/.test(terms[0]), "the salad stands: " + terms[0]);
  assert.ok(/moving/.test(terms[0]) && /glucose/.test(terms[0]),
    "the central string lacks its core: " + terms[0]);
});

await test("WLK3 handler: the healthy control form keeps its exact PubMed string", async () => {
  scenPapers = GENERIC_POOL;
  const { captured } = await runScenario(WLK3_Q, { settings: {} });
  const terms = pubmedTerms(captured);
  assert.ok(terms.length > 0, "no PubMed term captured");
  assert.equal(terms[0], "meal walk glucose");
});

/* ── Lane C: REVERTED — the controls pin the revert ─────── */
group("Lane C — reverted in full; controls pin the pre wave builder");

await test("FEV2 boolean: the pre wave form, plus the wave 5 fever seat", () => {
  // WITNESS UPDATED (2026-11-05, search fix wave 5): this
  // test pinned the FEV2 boolean byte identical to the pre
  // wave 3 form as the Lane C revert control. Wave 5 changes
  // that form by design: the fever expansion diagnosis named
  // the boolean as one of the three executed forms carrying
  // no fever vocabulary, and its Candidate 1 seats the
  // existing fever group as its own AND group for retrieval
  // only (Europe PMC probe: 189,881 with the mechanism paper
  // at rank 1, against 867,834 on the form pinned here). The
  // expectation is now the pre wave form plus that seat,
  // exactly; the WLK3 control below still pins the unchanged
  // builder behavior this group exists to protect.
  const b = buildStructuredQuery(FEV2_Q, null);
  assert.equal(b, "(temperature OR climate OR warming OR thermal OR heat) AND (bug OR \"stomach bug\" OR \"viral infection\" OR \"bacterial infection\" OR bugs OR pathogen OR pathogens) AND (fever OR \"body temperature\" OR \"set point\" OR fevers OR febrile OR pyrexia OR pyrogen)");
});

await test("WLK3 boolean: the control's behavior is unchanged", () => {
  const b = buildStructuredQuery(WLK3_Q, null);
  assert.ok(/glucose/.test(b) && /AND meal AND walk/.test(b) && !/ OR /.test(b.replace(/\(([^)]*)\)/, "")),
    "the control boolean changed shape: " + b);
});

/* ── Lane D: the family count ────────────────────────────── */
group("Lane D — bridged equivalent concepts count as one family");

const BSF4_Q = "used cooking oil mixed in for the fly babies that eat our scraps, do they put on weight or get sick";
const BSF4_SPECIMEN = {
  title: "Genetics, age, and diet influence gut bacterial communities and performance of black soldier fly larvae (Hermetia illucens)",
  abstract: "The black soldier fly (Hermetia illucens) is a promising insect for the bioconversion of organic waste. Here, two black soldier fly lines were raised on ten diets based on agricultural byproducts and food waste, and the gut bacterial communities and larval performance were measured. Genetics, age, and diet all influenced the composition of the gut bacterial communities, and diet quality affected larval growth and survival on the waste based diets.",
};

await test("BSF4: the oil and scraps concepts share one authored family", () => {
  const std = citationGateStandard(BSF4_Q, null);
  const judged = gateJudgedConcepts(std);
  const oil = judged.find((c) => c.term === "used cooking oil");
  const scraps = judged.find((c) => c.term === "scraps");
  assert.ok(oil && scraps, "the traced concepts are not judged: " + judged.map((c) => c.term).join(","));
  const f = conceptGroupFamilyOf(oil);
  assert.ok(f >= 0 && f === conceptGroupFamilyOf(scraps), "the pair holds no shared family");
});

await test("BSF4: the traced specimen now clears the concept count", () => {
  const std = citationGateStandard(BSF4_Q, null);
  assert.equal(paperClearsCitationGate(BSF4_SPECIMEN, std), true);
});

await test("BSF4: a junk pool paper engaging no concept still fails", () => {
  const std = citationGateStandard(BSF4_Q, null);
  const junk = {
    title: "Byzantine chant in medieval antiphoners",
    abstract: "A study of chant notation in medieval antiphoners and the scribes who copied them.",
  };
  assert.equal(paperClearsCitationGate(junk, std), false);
});

await test("distinct concepts still each require engagement (SLT4 salt alone fails)", () => {
  const std = citationGateStandard(SLT4_Q, null);
  const saltOnly = {
    title: "Salt content of processed snacks",
    abstract: "The salt content of forty brands of chips was measured and tabulated by brand and serving size.",
  };
  assert.equal(paperClearsCitationGate(saltOnly, std), false);
  const both = {
    title: "Salt intake and heart outcomes",
    abstract: "Adults who lowered their salt intake saw lower blood pressure and fewer heart events over five years of follow up.",
  };
  assert.equal(paperClearsCitationGate(both, std), true);
});

console.log("\nsearch-fix3-nov05: " + passed + " passed, " + failures.length + " failed");
if (failures.length) {
  for (const f of failures) console.log("  FAILED:", f);
  process.exitCode = 1;
}
