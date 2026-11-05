/**
 * Search fix wave 2 (2026-11-05). Proof tests for the three
 * lane fixes built from the November 5 diagnoses
 * (~/workspace/cerebrum-hijack-diagnosis-nov05/report.md,
 * ~/workspace/cerebrum-bsf-diagnosis-nov05/report.md,
 * ~/workspace/cerebrum-crossref-diagnosis-nov05/report.md).
 * Each test pins a mechanism at the point it changed, on the
 * bank wordings the diagnoses measured (plain everyday
 * language, per the standing mismatched language rule), and
 * Lane A is proven on the queries retrieval actually executes
 * (the per source strings and the record's rung list), not on
 * the structured boolean — the hijack diagnosis's own lesson.
 *
 *   Lane A (the rung): the widest rung is composed after the
 *   wave eight lead pass, which reorders the ranked list and
 *   silently unseated the November 2 action verb swap (WLK4's
 *   "moving" sat at index 6 in the live trace). The swap now
 *   re runs on the post lead order, and a widest rung
 *   guarantee seats the question's bridged central terms the
 *   slice dropped (salt on SLT4, blood on WLK2, rice on WLK4)
 *   and the sense bridge phrases of a rung term whose hand
 *   group qualifies the bare word with a phrasal form of
 *   itself (bug -> viral infection, bacterial infection, on
 *   FEV2). The citation gate is untouched: the fix puts on
 *   topic papers into the pool, it does not change what the
 *   gate certifies. WLK3, the control whose rung already
 *   carries its action and outcome words, is byte exact.
 *   Lane B (BSF downstream): the citation gate is cleared by
 *   the diagnosis and its standard is untouched. The two
 *   named filter stages (verifyPaperConstraints at the
 *   handler's constraint filter, topicOverlapFilter inside
 *   programmaticValidationPasses) both judge with concept
 *   vocabulary, and the substrate bridge was missing: people
 *   write "scraps", the black soldier fly diet literature
 *   writes "food waste" and "organic waste". One hand
 *   authored group in the wave seventeen bridge style joins
 *   them, so the BSF4 specimen (genetics, age, and diet,
 *   Hermetia illucens on food waste diets) reads partial at
 *   the constraint filter and touches two resolved groups at
 *   the passes, while junk pools still empty honestly.
 *   The BSF2 structured query instability is NAMED here, not
 *   fixed: the stored record's form is reproduced byte for
 *   byte from the minimum results guarantee's bare terms
 *   candidate ("cousin raises those black") and its fallback
 *   groups, which is where that draw's record came from.
 *   Lane C (Crossref): the leg's own budget (a 4,000 ms
 *   timeout plus one retry, about 8,300 ms) can never fit
 *   the retrieval slice it is given (4,000 ms from request
 *   start with fact check on). The fetcher now derives its
 *   per attempt timeout and retry count from the remaining
 *   deadline its callers settle against, and a Crossref slot
 *   the slice cuts gets one re ask inside the same fanout,
 *   bounded to a short window and gated on the ledger's
 *   retrieval room and the gather's own time budget.
 *
 * Run with: node tests/search-fix2-nov05.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const search = await import(join(root, "functions/api/search.js"));

const {
  onRequest, createSubrequestLedger,
  buildDynLookup, resolveExpansionCoverage, canonicalQueryForms,
  buildStructuredQuery,
  analyzeQuery, verifyPaperConstraints,
  topicOverlapFilter, programmaticValidationPasses,
  crossrefAttemptBudget,
} = search;

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

/* ── Handler harness (wave sixteen/seventeen pattern) ────── */
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
let scenFactCheck = null;
let scenExpansion = null;
let scenCrossref = null; // (callNo) => Response | Promise<Response>
let crossrefCalls = 0;
let capturedUrls = [];

async function runScenario(query, opts = {}) {
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  globalThis.caches = {
    default: { match: async () => undefined, put: async () => {}, delete: async () => false },
  };
  Math.random = () => 0.99;
  capturedUrls = [];
  crossrefCalls = 0;
  globalThis.fetch = async (url, opts2 = {}) => {
    const u = String(url);
    const body = typeof opts2.body === "string" ? opts2.body : "";
    if (u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("openrouter.ai") || u.includes("api.groq.com")) {
      if (body.includes("rigorous scientific fact-checker")) {
        return chatRes(scenFactCheck || "no verdict available");
      }
      if (body.includes("Cite at least two different sources inline")) {
        return chatRes(scenAnswer);
      }
      if (body.includes("literature search specialist")) {
        return chatRes(scenExpansion || "I cannot group those terms today.");
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));
      }
      return chatRes(scenAnswer);
    }
    if (u.includes("api.crossref.org")) {
      crossrefCalls++;
      capturedUrls.push(u);
      if (scenCrossref) return scenCrossref(crossrefCalls);
      return jsonRes({ message: { items: [] } });
    }
    if (u.includes("ebi.ac.uk/europepmc") || u.includes("api.openalex.org") ||
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
  try {
    const ledger = createSubrequestLedger(opts.limit || undefined);
    const env = {
      DB: rgDb(),
      OPENROUTER_KEY: "fix2-nov05-test-openrouter-key-123456",
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
    return { data, captured: capturedUrls.slice(), crossrefCalls };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
    scenExpansion = null;
    scenCrossref = null;
  }
}

const epmcFix = (id, title, abstractText, citedByCount, pubYear) => ({
  title,
  doi: "10.1000/fix2nov05-" + id,
  pubYear: String(pubYear),
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});

/* The first plain keyword string the fanout sent (OpenAlex,
 * Crossref, Semantic Scholar and CORE all receive the rung's
 * bare form; CORE's ?q= shows it verbatim). */
function firstBareString(captured) {
  for (const u of captured) {
    if (u.includes("api.core.ac.uk")) {
      try { return decodeURIComponent(new URL(u).searchParams.get("q") || ""); } catch { /* next */ }
    }
  }
  return "";
}
function rungQueries(data) {
  return ((data._record || {}).executedQueries || [])
    .filter((q) => q && q.kind === "rung")
    .map((q) => q.query);
}

/* ── Lane A: the rung that actually executes ─────────────── */
group("Lane A — the executed rung");

const FEV2_Q = "what makes your temperature go up when you have a bug";
const FEV2_POOL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => epmcFix("f" + i,
  "Temperature and the bug: field observations part " + i,
  "Temperature and bug abundance were recorded across field sites. The temperature at which each bug was observed is reported, and bug counts per temperature band are tabulated for every site and season in the survey.",
  50, 2021));

await test("FEV2: the widest rung carries the bug bridge's illness phrases", async () => {
  scenPapers = FEV2_POOL;
  scenAnswer = "## Short answer\n\nA recorded answer [1].";
  scenFactCheck = null;
  const { data } = await runScenario(FEV2_Q, { settings: {} });
  const rungs = rungQueries(data);
  assert.ok(rungs.length > 0, "no rung recorded");
  assert.ok(/viral infection/.test(rungs[0]) && /bacterial infection/.test(rungs[0]),
    "the executed rung carries no illness bridge phrases: " + rungs[0]);
});

const WLK4_Q = "my glucose monitor spikes after rice, is moving around right after eating a real fix or just health advice people repeat";
const WALK_ABSTRACT = "Adults with type 2 diabetes wore a glucose monitor and took a ten minute walk after eating a rice meal on one day and sat after eating on another. Walking after the meal lowered the glucose spikes after rice compared with sitting, and the monitor recorded smaller rises on the walking days.";
const WLK4_POOL = [1, 2, 3, 4, 5, 6].map((i) => epmcFix("w" + i,
  "Walking after a rice meal and glucose spikes study " + i, WALK_ABSTRACT, 90, 2022));

await test("WLK4: the widest rung carries the action verb and rice", async () => {
  scenPapers = WLK4_POOL;
  scenAnswer = "## Short answer\n\nA recorded answer [1].";
  scenFactCheck = null;
  const { data } = await runScenario(WLK4_Q, { settings: {} });
  const rungs = rungQueries(data);
  assert.ok(rungs.length > 0, "no rung recorded");
  assert.ok(/\bmoving\b/.test(rungs[0]),
    "the action verb is not in the executed rung: " + rungs[0]);
  assert.ok(/\brice\b/.test(rungs[0]) && /\bglucose\b/.test(rungs[0]),
    "the rung lost the food or the outcome word: " + rungs[0]);
});

const SLT4_Q = "people say the white stuff on chips is bad for your heart, but is the problem the salt itself or just junk food in general";
const SALT_ABSTRACT = "In a feeding trial, adults ate diets with different amounts of salt for four weeks while blood pressure was recorded. Higher salt intake raised blood pressure and strained the heart, and lowering salt brought blood pressure down. The salt itself, not the rest of the diet, accounted for the change.";
const SLT4_POOL = [1, 2, 3, 4, 5, 6].map((i) => epmcFix("s" + i,
  "Salt intake and blood pressure trial " + i, SALT_ABSTRACT, 120, 2021));

await test("SLT4: salt appears in the widest rung that executes", async () => {
  scenPapers = SLT4_POOL;
  scenAnswer = "## Short answer\n\nA recorded answer [1].";
  scenFactCheck = null;
  const { data, captured } = await runScenario(SLT4_Q, { settings: {} });
  const rungs = rungQueries(data);
  const bare = firstBareString(captured);
  assert.ok(/\bsalt\b/.test(rungs[0] || "") || /\bsalt\b/.test(bare),
    "salt is in no executed form: rung=" + (rungs[0] || "") + " bare=" + bare);
});

const WLK2_Q = "i eat a huge bowl of pasta then sit on the couch, would ten minutes walking after actually change anything in my blood";
const WLK2_POOL = [1, 2, 3, 4, 5, 6].map((i) => epmcFix("b" + i,
  "Ten minutes walking after a pasta meal and blood glucose study " + i,
  "After a large pasta meal, adults either sat on the couch or took ten minutes walking. Blood glucose was measured for two hours after eating. The walking group showed lower blood glucose after the meal than the sitting group.",
  80, 2022));

await test("WLK2: the constraint rung carries the outcome word blood", async () => {
  scenPapers = WLK2_POOL;
  scenAnswer = "## Short answer\n\nA recorded answer [1].";
  scenFactCheck = null;
  // The live record's condition: a resolved group for blood
  // (the model expansion's blood glucose group). The mock
  // model leg proposes exactly that group.
  scenExpansion = JSON.stringify([
    { term: "blood", alternates: ["blood glucose", "blood sugar", "glucose"] },
  ]);
  const { data, captured } = await runScenario(WLK2_Q, { settings: {} });
  const rungs = rungQueries(data);
  const bare = firstBareString(captured);
  assert.ok(/\bblood\b/.test(rungs[0] || "") || /\bblood\b/.test(bare),
    "the outcome word is in no executed form: rung=" + (rungs[0] || "") + " bare=" + bare);
});

await test("WLK3 control: the rung and its bare form are byte exact", async () => {
  scenPapers = WLK4_POOL;
  scenAnswer = "## Short answer\n\nA recorded answer [1].";
  scenFactCheck = null;
  const { data, captured } = await runScenario("after meal walk glucose", { settings: {} });
  const rungs = rungQueries(data);
  assert.equal(rungs[0], "meal glucose walk",
    "the control's rung changed: " + rungs[0]);
  assert.equal(firstBareString(captured), "meal diabetes diabetic insulin glycemic walk",
    "the control's bare form changed: " + firstBareString(captured));
});

/* ── Lane B: BSF downstream ──────────────────────────────── */
group("Lane B — black soldier fly downstream");

const BSF4_Q = "used cooking oil mixed in for the fly babies that eat our scraps, do they put on weight or get sick";
const SPECIMEN = {
  title: "Genetics, age, and diet influence gut bacterial communities and performance of black soldier fly larvae (Hermetia illucens)",
  abstract: "The black soldier fly (Hermetia illucens) is a promising insect for the bioconversion of organic waste. Here, two black soldier fly lines were raised on ten diets based on agricultural byproducts and food waste, and the gut bacterial communities and larval performance were measured. Genetics, age, and diet all influenced the composition of the gut bacterial communities, and diet quality affected larval growth and survival on the waste based diets.",
};
const BSF_OIL = {
  title: "The in vitro effects of black soldier fly larvae oil as a high-functional active ingredient",
  abstract: "Black soldier fly larvae oil was extracted from larvae reared on food waste and its in vitro antioxidant and antimicrobial effects were evaluated. The oil showed functional activity in cell assays, supporting the use of larvae oil as an active ingredient.",
};
const BSF_LIPIDS = {
  title: "Insect Lipids as Novel Source for Future Applications",
  abstract: "Insect lipids, including those from black soldier fly larvae, are reviewed as a novel source of fatty acids for feed, food, and industrial applications. Production from larvae reared on organic waste substrates is discussed.",
};
const FOODWASTE_SURVEY = {
  title: "Household food waste management practices in urban areas: a survey",
  abstract: "A survey of household food waste management practices in urban areas, covering storage, disposal, and recycling habits of residents. ",
};
const JUNK_POOL = [
  { title: "Byzantine chant manuscripts in monastic libraries: a cataloguing study",
    abstract: "This study catalogues Byzantine chant manuscripts held in monastic libraries, describing notation systems, scribal hands, and the liturgical ordering of chant books copied between the twelfth and fifteenth centuries." },
  { title: "Provenance of medieval antiphoners: bindings, pigments, and scriptoria",
    abstract: "We trace the provenance of medieval antiphoners through binding structures, pigment composition, and scriptorium practices, and propose a chronology for a group of choir books preserved in cathedral archives." },
];

await test("BSF4: the specimen is no longer judged off topic by the constraint verdict", () => {
  const qa = analyzeQuery(BSF4_Q);
  const v = verifyPaperConstraints({ ...SPECIMEN }, qa);
  assert.notEqual(v.verdict, "off-topic",
    "the specimen still dies at the constraint filter: " + JSON.stringify(v));
});

await test("BSF4: the specimen and the substrate papers survive the programmatic passes", () => {
  const shelf = [SPECIMEN, BSF_OIL, BSF_LIPIDS, FOODWASTE_SURVEY].map((p) => ({ ...p }));
  const out = programmaticValidationPasses(BSF4_Q, shelf, null);
  const titles = out.map((p) => p.title);
  assert.ok(titles.includes(SPECIMEN.title), "the specimen died at the passes");
  assert.ok(titles.includes(BSF_OIL.title), "the larvae oil paper died at the passes");
  assert.ok(titles.includes(BSF_LIPIDS.title), "the insect lipids paper died at the passes");
  assert.ok(!titles.includes(FOODWASTE_SURVEY.title),
    "a paper with the substrate words but no organism survived the passes");
});

await test("BSF4: a junk pool still empties honestly at the passes", () => {
  const out = topicOverlapFilter(BSF4_Q, JUNK_POOL.map((p) => ({ ...p })), null);
  assert.equal(out.length, 0, "the junk pool no longer empties: " + out.map((p) => p.title).join(" | "));
});

await test("BSF2 instability, named: the stored form is the minimum results guarantee's bare terms gather", () => {
  // The November 5 record (r_89ba6d8cbe27358a6c2625d7dfbf4ac6)
  // carries structuredQuery "(black OR blacks) AND (cousin)",
  // expansionCoverage central ["black", "cousin"], and
  // llmExpansion holding only the black and cousin fallback
  // groups. Reproduced byte for byte from the guarantee's
  // first candidate (the question's first four significant
  // tokens) and the coverage fallback on its surface: this
  // pin documents the named cause, it is not a fix.
  const surface = canonicalQueryForms("cousin raises those black").surface;
  assert.equal(surface, "cousin raises black");
  const cov = resolveExpansionCoverage(surface, []);
  assert.deepEqual(cov.coverage.central, ["black", "cousin"]);
  const lookup = buildDynLookup(cov.fallbackGroups);
  assert.equal(buildStructuredQuery(surface, lookup), "(black OR blacks) AND (cousin)");
});

/* ── Lane C: Crossref ────────────────────────────────────── */
group("Lane C — Crossref slice bounding");

await test("the attempt budget fits the slice it is given", () => {
  const now = 1000000;
  assert.equal(crossrefAttemptBudget(null, now), null, "no deadline must keep the baseline budget");
  const full = crossrefAttemptBudget(now + 60000, now);
  assert.equal(full.timeoutMs, 4000, "a roomy slice must keep the fetcher's own budget");
  assert.equal(full.retries, 1);
  for (const remaining of [4000, 2500, 1300, 900, 400]) {
    const b = crossrefAttemptBudget(now + remaining, now);
    assert.ok(!b.expired, "a positive remainder reads as expired at " + remaining);
    const worst = b.timeoutMs * (b.retries + 1) + 300 * b.retries;
    assert.ok(worst <= remaining,
      `the budget overruns its slice: ${b.timeoutMs} x${b.retries + 1} = ${worst} > ${remaining}`);
    assert.ok(b.timeoutMs >= 100, "the attempt window collapsed at " + remaining);
  }
  const dead = crossrefAttemptBudget(now - 1, now);
  assert.equal(dead.expired, true, "a spent deadline must read as expired");
});

const WLK1_Q = "does a short walk after dinner help your sugar come down";
const CROSSREF_ITEM = (id) => ({
  title: ["Postmeal walking and blood sugar control study " + id],
  DOI: "10.1000/fix2cr-" + id,
  published: { "date-parts": [[2022]] },
  author: [{ given: "Doe", family: "J" }],
  "container-title": ["Journal of Recorded Studies"],
  "is-referenced-by-count": 40,
  abstract: "Adults took a short walk after dinner on one evening and sat after dinner on another. Blood sugar after the meal was lower on the walking evening, and a short walk after dinner helped sugar come down compared with sitting.",
  type: "journal-article",
});

await test("a slice cut Crossref gets one re ask and its papers reach the pool", async () => {
  scenPapers = [];
  scenAnswer = "## Short answer\n\nA short walk after dinner lowered blood sugar after the meal [1]. The studies followed adults who ate the same evening meal on two nights, walking for a short while after one and sitting after the other, and the recorded blood sugar after the meal ran lower on the walking nights across the group [1].";
  scenFactCheck = JSON.stringify({ claims: [
    { claim: "A short walk after dinner lowered blood sugar after the meal",
      source_index: 1,
      quote: "Blood sugar after the meal was lower on the walking evening",
      status: "supported",
      justification: "The first source reports blood sugar after the meal was lower on the walking evening." },
  ] });
  scenCrossref = (callNo) => {
    if (callNo <= 2) {
      // Slower than any attempt the slice can fund: the
      // bounded first ask (attempt plus its one retry) is cut
      // exactly the way the pass 3 records show, and only the
      // re ask (the third call) answers.
      return new Promise((resolve) => setTimeout(
        () => resolve(jsonRes({ message: { items: [CROSSREF_ITEM(1), CROSSREF_ITEM(2), CROSSREF_ITEM(3)] } })), 9000));
    }
    return jsonRes({ message: { items: [CROSSREF_ITEM(1), CROSSREF_ITEM(2), CROSSREF_ITEM(3)] } });
  };
  const { data } = await runScenario(WLK1_Q, { settings: { factCheck: true }, limit: 400 });
  const dbs = (data._record && data._record.databases) || [];
  const cr = dbs.find((d) => d.source === "crossref");
  assert.ok(cr && cr.ok && cr.count >= 1,
    "crossref never answered even with the re ask: " + JSON.stringify(cr));
}, 30000);

await test("a Crossref that answers inside the slice is asked exactly once", async () => {
  scenPapers = WLK4_POOL;
  scenAnswer = "## Short answer\n\nA recorded answer [1].";
  scenFactCheck = null;
  scenCrossref = () => jsonRes({ message: { items: [] } });
  const { crossrefCalls } = await runScenario(WLK1_Q, { settings: { factCheck: true } });
  assert.equal(crossrefCalls, 1, "the re ask fired on a leg that answered: " + crossrefCalls);
});

console.log(`\nsearch-fix2-nov05: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
