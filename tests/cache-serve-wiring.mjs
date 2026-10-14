/**
 * Cache serve trust wiring — handler level (2026-10-14, seventh
 * panel, wave eight round two).
 *
 * The defect: buildCachedServeTrust has accepted the stored
 * payload's factCheck and synthesisMode since the wave seven
 * rider, and applies the provenance thin cap and the baked
 * confidence line binding only when they are supplied — but
 * neither live cache caller passed them, and the cache write
 * stored neither signal, so the rider was inert in production
 * while its builder fixtures (which hand the inputs in) passed.
 *
 * This suite drives the REAL handler end to end against a D1
 * stub whose answer_cache actually stores: a fresh run's own
 * INSERT (the payload envelope included) is read back by the
 * handler's own SELECTs on the repeat request. Three scenarios:
 *
 *   A. A fresh AI run stores the envelope; the repeat request
 *      serves from the early cache path carrying the original
 *      run's fact check, disagreement verdict, and recorded mode
 *      at parity with the fresh response — not null, not absent,
 *      not the legacy "extractive" resolution.
 *   B. A seeded provenance payload (an extractive answer with a
 *      baked Moderate line and a wording trace as its only check)
 *      serves with the provenance cap and the baked line binding
 *      firing through the real read path: level thin, the stored
 *      body bound, the trace shipped with "traced" statuses.
 *   C. A pre envelope row (the bare source list shape older
 *      builds stored) still serves, degrading to exactly the old
 *      behavior: fact check null, verdict null, mode resolved to
 *      extractive.
 *
 * Fixture wording follows the standing rule: questions in plain
 * everyday language, papers in the literature's own phrasing.
 *
 * Seed version note (2026-10-14, wave eleven): scenarios B and
 * C seed their rows under the CURRENT schema version ("v45-"
 * plus the length): since wave ten the handler derives its
 * lookup key from CACHE_SCHEMA_VERSION, so the seed literal
 * must move with every bump or the seeded rows model rows the
 * current build would have retired, and the serve assertions
 * fail on the key rather than on the wiring. Wave eleven moved
 * the literal from "v44-medium" to "v45-medium" for exactly
 * that reason; the scenarios' behavior is unchanged. The
 * wave eleven live probe addendum (mechanism detector copying
 * words, v46) moved the literal again the same day, to
 * "v48-medium". Wave twelve (claim check counting, dedupe
 * field folds, lane citation sorts, topical company for the
 * compound clause, the generalized single source retry, v47)
 * moved it again, to "v48-medium". Wave thirteen (foundational
 * presentation priority, topical company for every title
 * sighting, the claim check tier trace and literature claim
 * selection, v48) moved it again, to "v48-medium".
 *
 * Run with: node tests/cache-serve-wiring.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  onRequest,
  createSubrequestLedger,
  packAnswerCachePayload,
  unpackAnswerCachePayload,
} = await import(join(root, "functions/api/search.js"));
const { cacheKey } = await import(join(root, "functions/lib/queryPrivacy.js"));

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

// A D1 stub whose answer_cache actually stores: rows keyed by the
// derived cache key, written by the handler's own INSERT and read
// back by its SELECTs (single reads and the batched preflight,
// whose contract is one result object per statement). Everything
// else is the generic empty stub the other handler suites use.
function storingDb(rows) {
  const serveRow = (binds, minScore) => {
    const row = rows.get(binds[0]);
    if (!row || row.score < minScore || !(row.created_at > binds[1])) return null;
    return { answer: row.answer, sources: row.sources, score: row.score, created_at: row.created_at };
  };
  const stmt = (sql) => {
    let binds = [];
    const s = {
      _sql: sql,
      _binds: () => binds,
      bind: (...args) => { binds = args; return s; },
      first: async () => {
        if (sql.includes("FROM answer_cache")) {
          return serveRow(binds, sql.includes("score >= 2") ? 2 : 0);
        }
        if (/CASE WHEN search_slots\.expires_at/.test(sql)) return { n: 1 };
        return null;
      },
      all: async () => {
        if (/sqlite_master/.test(sql)) {
          return { results: [
            { name: "pro_usage", sql: "CREATE TABLE pro_usage (user_id TEXT NOT NULL, month TEXT NOT NULL, ai_answers INTEGER NOT NULL DEFAULT 0, doc_reads INTEGER NOT NULL DEFAULT 0, flowcharts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, month))" },
            { name: "stripe_events", sql: "CREATE TABLE stripe_events (event_id TEXT PRIMARY KEY, received_at INTEGER NOT NULL)" },
            { name: "student_verifications", sql: "CREATE TABLE student_verifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)" },
          ] };
        }
        return { results: [] };
      },
      run: async () => {
        if (sql.includes("INSERT OR REPLACE INTO answer_cache")) {
          // PIN UPDATED (2026-10-14, wave ten, item 10): the
          // write binds its computed serve score (binds[4])
          // since wave ten — clean full AI answers write 2,
          // everything else 0 — so created_at moves to binds[5].
          rows.set(binds[0], {
            query_key: binds[0], answer_id: binds[1], answer: binds[2],
            sources: binds[3], score: binds[4], created_at: binds[5],
          });
        }
        return { success: true, meta: { changes: 1 } };
      },
    };
    return s;
  };
  return {
    prepare: (sql) => stmt(String(sql)),
    batch: async (arr) => (arr || []).map((st) => {
      if (st._sql.includes("FROM answer_cache")) {
        const row = serveRow(st._binds(), 2);
        return { results: row ? [row] : [] };
      }
      return { results: [] };
    }),
    exec: async () => ({ results: [] }),
  };
}

// One handler run against the storing stub, with a collecting
// waitUntil so the background cache write has landed before the
// test reads the store back.
async function runSearch({ rows, ai, fetchImpl, body }) {
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  globalThis.caches = {
    default: { match: async () => undefined, put: async () => {}, delete: async () => false },
  };
  Math.random = () => 0.99;
  globalThis.fetch = fetchImpl;
  const pending = [];
  try {
    const ledger = createSubrequestLedger(160);
    const env = { DB: storingDb(rows), AI: ai };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await onRequest({
      request, env,
      waitUntil: (p) => { pending.push(Promise.resolve(p).catch(() => {})); },
      data: { ledger },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    await Promise.all(pending);
    await new Promise((r) => setTimeout(r, 150));
    return data;
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

const noNetwork = async () => jsonRes({});

// ═══════════════════════════════════════════════════════════════════
group("the payload envelope — pack and unpack");

await test("pack and unpack round trip the sources and the trust signals", () => {
  const sources = [{ title: "A paper", year: 2024 }, { title: "B paper", year: 2023 }];
  const trust = {
    factCheck: { mode: "claims", overall: "supported", claims: [{ claim: "x", status: "supported" }] },
    synthesisMode: "ai",
    disagreementVerdict: { status: "settled", conflictCount: 0, summary: "s" },
  };
  const out = unpackAnswerCachePayload(packAnswerCachePayload(sources, trust));
  assert.deepEqual(out.sources, sources);
  assert.deepEqual(out.trust, trust);
});

await test("a pre envelope payload unpacks to its sources with no trust signals", () => {
  const legacy = JSON.stringify([{ title: "Old row paper", year: 2020 }]);
  const out = unpackAnswerCachePayload(legacy);
  assert.deepEqual(out.sources, [{ title: "Old row paper", year: 2020 }]);
  assert.equal(out.trust, null, "a legacy row gained signals nobody stored");
});

await test("unparseable and empty payloads unpack to nothing, never throw", () => {
  assert.deepEqual(unpackAnswerCachePayload("not json {"), { sources: [], trust: null });
  assert.deepEqual(unpackAnswerCachePayload(""), { sources: [], trust: null });
  assert.deepEqual(unpackAnswerCachePayload(null), { sources: [], trust: null });
  assert.deepEqual(unpackAnswerCachePayload('{"v":1,"sources":[]}'), { sources: [], trust: null });
});

// ═══════════════════════════════════════════════════════════════════
group("A — a fresh AI run stores its signals; the repeat serve ships them");

const A_PAPERS = [
  {
    title: "Magnesium supplementation and sleep quality in older adults with insomnia: a randomized controlled trial",
    doi: "10.1000/cw1",
    pubYear: "2024",
    citedByCount: 31,
    authorString: "Osei M, Lindqvist A",
    journalTitle: "Journal of Sleep Research",
    abstractText: "Adults over sixty with insomnia received magnesium supplementation or placebo for eight weeks. Sleep quality scores improved in the magnesium group, and insomnia severity fell compared with placebo, with no serious adverse events reported during the trial period.",
  },
  {
    title: "Magnesium and sleep disturbance: a systematic review of clinical trials",
    doi: "10.1000/cw2",
    pubYear: "2023",
    citedByCount: 58,
    authorString: "Ferrante R, Okafor N",
    journalTitle: "Sleep Medicine Reviews",
    abstractText: "Across eleven trials of magnesium supplementation for sleep disturbance, most found shorter time to fall asleep and fewer night wakings than placebo. The review notes the trials were small and the doses varied widely between studies.",
  },
  {
    title: "Magnesium status and restless legs symptoms in adults",
    doi: "10.1000/cw3",
    pubYear: "2022",
    citedByCount: 19,
    authorString: "Halvorsen T",
    journalTitle: "Journal of Neurology",
    abstractText: "Lower magnesium status tracked with more frequent restless legs symptoms in a cohort of adults attending a sleep clinic. The association weakened after adjustment for iron status, and no intervention was tested in this observational design.",
  },
];

const A_ANSWER =
  "## Summary\n\n" +
  "Magnesium helped older adults with insomnia sleep better in the trial that tested it, with sleep quality scores improving over eight weeks [1]. " +
  "Reviews of the magnesium trials find shorter time to fall asleep and fewer night wakings than placebo [2].\n\n" +
  "## Limits\n\n" +
  "The trials are small, the doses vary widely, and most ran only a few weeks.";

const A_VERDICT = {
  claims: [
    {
      claim: "Magnesium helped older adults with insomnia sleep better in the trial that tested it, with sleep quality scores improving over eight weeks",
      source_index: 1,
      quote: "Sleep quality scores improved in the magnesium group",
      status: "supported",
      justification: "The trial abstract states the outcome directly: sleep quality scores improved in the magnesium group and insomnia severity fell against placebo over the eight weeks the claim names. The claim adds nothing the abstract does not say.",
    },
    {
      claim: "Reviews of the magnesium trials find shorter time to fall asleep and fewer night wakings than placebo",
      source_index: 2,
      quote: "shorter time to fall asleep and fewer night wakings than placebo",
      status: "supported",
      justification: "The review's abstract reports exactly these two outcomes across its eleven trials of magnesium for sleep disturbance. The claim keeps the review's own scope and does not widen it beyond the trials the review covered.",
    },
  ],
};

function scenarioAFetch(url) {
  const u = String(url);
  if (u.includes("ebi.ac.uk/europepmc")) {
    if (u.includes("BODY")) return jsonRes({ resultList: { result: [] } });
    return jsonRes({ resultList: { result: A_PAPERS } });
  }
  if (u.includes("eutils.ncbi.nlm.nih.gov")) {
    if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: [] } });
    if (u.includes("esummary")) return jsonRes({ result: {} });
    return new Response("", { status: 200 });
  }
  if (u.includes("export.arxiv.org")) return new Response("", { status: 200 });
  return jsonRes({});
}

function scenarioAAi() {
  return {
    run: async (model, input) => {
      if (model === "@cf/baai/bge-small-en-v1.5") {
        const texts = (input && input.text) || [];
        return { data: texts.map((_, i) => [1, 0.01 * (i + 1), 0.5, 0.25]) };
      }
      const msgs = (input && input.messages) || [];
      const joined = msgs.map((mm) => String(mm.content || "")).join("\n");
      if (joined.includes("ANSWER TO FACT-CHECK:")) return { response: JSON.stringify(A_VERDICT) };
      return { response: A_ANSWER };
    },
  };
}

await test("the write stores the envelope and the early serve ships the stored check, verdict, and mode", async () => {
  const rows = new Map();
  const body = { query: "does magnesium help you sleep better at night", settings: { factCheck: true } };
  const fresh = await runSearch({ rows, ai: scenarioAAi(), fetchImpl: scenarioAFetch, body });
  // Control: run one is the fresh AI serve with its full trust set.
  assert.equal(fresh._cached, undefined, "the first run must not be a cache serve");
  assert.equal(fresh.synthesisMode, "ai", "control: the first run must synthesize, got: " + fresh.synthesisMode);
  assert.ok(fresh.factCheck && fresh.factCheck.mode === "claims",
    "control: the deep fact check must have run: " + JSON.stringify(fresh.factCheck));
  assert.equal(fresh.factCheck.overall, "supported");
  assert.ok(fresh.disagreementVerdict && typeof fresh.disagreementVerdict.status === "string",
    "control: the fresh serve ships a disagreement verdict");

  // THE WRITE: exactly one row, and its sources column is the
  // versioned envelope carrying this run's own signals — the same
  // objects the fresh response shipped.
  assert.equal(rows.size, 1, "the fresh run stored no answer cache row");
  const stored = [...rows.values()][0];
  const payload = unpackAnswerCachePayload(stored.sources);
  assert.ok(payload.trust, "the stored payload carries no trust block: " + stored.sources.slice(0, 120));
  assert.equal(payload.sources.length, fresh.sources.length,
    "the envelope's source list is not the served list");
  assert.equal(payload.trust.synthesisMode, "ai");
  assert.deepEqual(payload.trust.factCheck, fresh.factCheck,
    "the stored fact check is not the fresh response's fact check");
  assert.deepEqual(payload.trust.disagreementVerdict, fresh.disagreementVerdict,
    "the stored verdict is not the fresh response's verdict");

  // Upvotes verify the row (vote.js raises the score; only a
  // score of 2 or more is ever served). Since wave ten a clean
  // run also writes 2 itself; the bump to 3 here keeps this
  // scenario on the legacy vote verified path it was written
  // for, and either value serves.
  stored.score = 3;

  // THE READ: the repeat request serves from the early cache path
  // (its stage health is the cache stage alone) and ships the
  // stored signals at parity with the fresh response.
  const served = await runSearch({ rows, ai: scenarioAAi(), fetchImpl: scenarioAFetch, body });
  assert.equal(served._cached, true, "the repeat request was not served from the cache");
  assert.equal(served.stageHealth.length, 1);
  assert.equal(served.stageHealth[0].name, "cache",
    "the serve did not come through the early cache path: " + JSON.stringify(served.stageHealth));
  assert.deepEqual(served.factCheck, fresh.factCheck,
    "the cached serve's fact check is not the stored run's check");
  assert.deepEqual(served.disagreementVerdict, fresh.disagreementVerdict,
    "the cached serve's verdict is not the stored run's verdict");
  assert.equal(served.synthesisMode, "ai",
    "the cached serve resolved the recorded AI mode to something else: " + served.synthesisMode);
});

// ═══════════════════════════════════════════════════════════════════
group("B — a seeded provenance payload: the cap and the binding fire through the read path");

const B_SOURCES = Array.from({ length: 8 }, (_, i) => ({
  title: "Infant gut colonization study " + (i + 1),
  authors: "Researcher " + (i + 1),
  journal: "Journal of Infant Microbiology",
  year: 2025,
  relevance: 90,
  type: "journal article",
  abstract: "A cohort study of how the infant gut community assembles across the first year of life, with feeding mode and delivery mode recorded for every participant.",
  url: "https://doi.org/10.1000/cwb" + (i + 1),
}));

const B_ANSWER =
  "## Summary\n\n" +
  "Germs in the gut change across the first year of life [1], and feeding shapes which germs take hold [2]. " +
  "The gut community steadies as solid foods arrive [3], and delivery mode leaves an early mark [4]. " +
  "By the first birthday the community looks more adult [5], though it keeps changing [6]. " +
  "Antibiotic courses interrupt the pattern [7], and recovery takes weeks [8].\n\n" +
  "## How solid is this?\n\n" +
  "Moderate confidence: this answer rests on 8 cited sources. " +
  "No opposing findings were detected among them, but the evidence base is not broad enough for a stronger claim. " +
  "Confidence is capped because the answer was assembled from source excerpts. " +
  "The wording of 6 of 7 cited claims traces to the papers they cite. A wording trace is not a verification.\n\n" +
  "- Only 8 sources cleared the relevance bar. Treat this as a starting point, not a settled answer.\n" +
  "- 3 more papers were found but withheld: they didn't clear the relevance bar for this question.\n\n" +
  "## What would change this\n\n" +
  "- A direct replication in a second cohort.\n";

const B_TRACE = {
  mode: "extractive",
  checkKind: "provenance",
  checked: true,
  overall: "traced",
  summary: "Traced 7 cited claims against the wording of the papers they cite: 6 traced to the cited paper's wording, 1 overlap only weakly, 0 do not trace. A wording trace is not a verification of the claims.",
  claims: Array.from({ length: 7 }, (_, i) => ({
    claim: "Stored claim " + (i + 1),
    status: i < 6 ? "traced" : "thin",
    note: "The claim's wording traces to the cited paper's title/abstract.",
  })),
};

const B_VERDICT = { status: "settled", conflictCount: 0, summary: "No conflicting claim pairs were found among the cited sources." };

await test("the provenance cap caps the level and the baked line is bound on a real cache serve", async () => {
  const rows = new Map();
  const query = "what happens to a baby's gut germs in the first year";
  const key = await cacheKey(query, {}, "v48-medium");
  rows.set(key, {
    query_key: key,
    answer_id: "seed-b",
    answer: B_ANSWER,
    sources: packAnswerCachePayload(B_SOURCES, {
      factCheck: B_TRACE,
      synthesisMode: "extractive",
      disagreementVerdict: B_VERDICT,
    }),
    score: 3,
    created_at: Date.now(),
  });
  const served = await runSearch({ rows, ai: scenarioAAi(), fetchImpl: noNetwork, body: { query } });
  assert.equal(served._cached, true, "the seeded row was not served");
  // The provenance cap fired through the wiring: without the
  // stored fact check reaching the builder, this shelf recomputes
  // to the unchecked moderate (the search-record builder fixture
  // pins exactly that contrast).
  assert.equal(served.confidence && served.confidence.level, "thin",
    "the provenance cap did not fire on the cached serve: " + JSON.stringify(served.confidence));
  // The baked line binding fired through the wiring: the stored
  // Moderate assertion is replaced by the recomputed line, and
  // the trace sentence and bullets survive.
  assert.ok(!served.answer.includes("Moderate confidence"),
    "the baked Moderate assertion shipped over a thin cached serve: " + served.answer.slice(0, 500));
  assert.ok(served.answer.includes("The wording of 6 of 7 cited claims traces to the papers they cite."),
    "the appended trace sentence was harmed: " + served.answer.slice(0, 500));
  assert.ok(served.answer.includes("- Only 8 sources cleared the relevance bar."),
    "the section's gap bullets were removed: " + served.answer.slice(0, 500));
  // The stored signals ship at parity, in the corrected
  // vocabulary: the trace's claims are "traced", none "supported".
  assert.deepEqual(served.factCheck, B_TRACE,
    "the cached serve's fact check is not the stored trace");
  assert.ok(served.factCheck.claims.every((c) => c.status !== "supported"),
    "a provenance claim shipped as supported from the cache");
  assert.deepEqual(served.disagreementVerdict, B_VERDICT,
    "the cached serve's verdict is not the stored verdict");
  assert.equal(served.synthesisMode, "extractive",
    "the recorded extractive mode did not ship: " + served.synthesisMode);
});

// ═══════════════════════════════════════════════════════════════════
group("C — a pre envelope row degrades to the old behavior, exactly");

await test("a legacy row serves with null check, null verdict, and the extractive mode resolution", async () => {
  const rows = new Map();
  const query = "can wood frogs survive being frozen solid";
  const key = await cacheKey(query, {}, "v48-medium");
  const legacySources = [
    { title: "Freeze tolerance in the wood frog", authors: "Storey KB, Storey JM", journal: "Journal of Experimental Biology", year: 2021, relevance: 92, abstract: "Wood frogs tolerate the freezing of up to two thirds of their body water, with ice confined to extracellular spaces.", url: "https://doi.org/10.1000/cwc1" },
    { title: "Glucose as a cryoprotectant in a freeze tolerant frog", authors: "Costanzo JP", journal: "Cryobiology", year: 2019, relevance: 88, abstract: "Glucose accumulates in the tissues of frozen frogs and acts as a colligative cryoprotectant during thaw recovery.", url: "https://doi.org/10.1000/cwc2" },
  ];
  const legacyAnswer =
    "A wood frog can survive being frozen solid for weeks at a time, with ice forming only in the spaces outside its cells [1]. " +
    "Its heart stops completely while it is frozen and starts beating again after the thaw [2].";
  rows.set(key, {
    query_key: key,
    answer_id: "seed-c",
    answer: legacyAnswer,
    sources: JSON.stringify(legacySources),
    score: 3,
    created_at: Date.now(),
  });
  const served = await runSearch({ rows, ai: scenarioAAi(), fetchImpl: noNetwork, body: { query } });
  assert.equal(served._cached, true, "the legacy row was not served");
  assert.equal(served.answer, legacyAnswer, "the legacy answer text itself changed");
  assert.equal(served.factCheck, null, "a legacy serve invented a fact check");
  assert.equal(served.disagreementVerdict, null, "a legacy serve invented a verdict");
  assert.equal(served.synthesisMode, "extractive",
    "an unrecorded mode must resolve to extractive, never AI: " + served.synthesisMode);
  // The recomputed artifacts still ship, as they always have.
  assert.ok(served._record, "the legacy serve lost its recomputed record");
  assert.equal(served.confidence && served.confidence.level, "moderate",
    "the legacy serve's unchecked cap changed: " + JSON.stringify(served.confidence));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
