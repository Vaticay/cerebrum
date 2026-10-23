/**
 * Gate repair (2026-10-22, logic audit L3-2 and L3-5, owner
 * order "fix all of it").
 *
 *   L3-2: the citation gate was absolute and self overriding.
 *     Zero citable shipped as a verdict about the literature
 *     and blocked synthesis, while the gate audit readmitted
 *     papers under the retired pre wave eight standard, tagged
 *     them past the choke point, and exempted them from the
 *     later gates. The repair: one standard, applied once, its
 *     verdict final. The legacy comparison survives as a
 *     record only count and admits nothing; a zero citable run
 *     ships a retrieval state answer (what was searched, how
 *     many papers were gathered, how many were withheld and
 *     why in aggregate) instead of a literature verdict.
 *   L3-5: candidates added after scoring (the LLM rescue, the
 *     contradiction adjudicators) carried no relevance, and
 *     the missing score default read that as below every
 *     floor, so the gate silently discarded them while
 *     diagnostics recorded them as added. The repair: score
 *     provenance as a class. A post scoring merge stamps its
 *     papers with the explicit unscored flag; the gate judges
 *     a flagged paper on the citation standard alone, the same
 *     standard half every scored paper must clear, and never
 *     on a numeric threshold it had no chance to meet. No
 *     score is invented for it.
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 * Handler scenarios run the real onRequest against a stub env
 * modeled on tests/search-wave-ten.mjs.
 *
 * Run with: node tests/gate-one-standard.mjs
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
  buildNoResultsPayload, renderNoResultsAnswer,
  paperIsCitable, paperIsUnscored, paperRelevance, applyRelevanceGate,
  conceptGateContext, paperClearsLegacyStandard,
  buildDynLookup, buildDeterministicFallbackGroups, centralContentTerms,
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

const BANNED_SENTENCE = "No citable primary literature was found for this question.";

// ═══════════════════════════════════════════════════════════════
group("L3-2 (a) — zero citable ships a retrieval state, never a literature verdict");

await test("the banned literature verdict sentence appears nowhere in the shipped source", () => {
  assert.ok(!src.includes(BANNED_SENTENCE),
    "the literature verdict sentence is still present in search.js");
});

await test("the payload reports gathered total and aggregate exclusion reasons when the audit rides along", () => {
  // The Oct 21 waste oil pool shape at the payload: retrieval
  // gathered a healthy pool, the gate emptied the citable set.
  const p = buildNoResultsPayload({
    query: "if baby black soldier flies eat used cooking oil from restaurants do they turn out healthy",
    sourcesQueried: [{ name: "Europe PMC", ok: true }, { name: "OpenAlex", ok: true }],
    rungsTried: ["exact", "expanded"],
    gatedOut: 12,
    gatedExamples: ["Waste oil substrates reshape the black soldier fly larval gut microbiome and biomass composition during bioconversion"],
    gatheredCount: 34,
    exclusionReasonCounts: { belowFloor: 3, noConcept: 5, shortOfStandard: 4, applicationOnly: 0 },
  });
  const line = p.whatWasTried.find((w) => /cited none/.test(w));
  assert.ok(line, "no withheld line in the payload: " + JSON.stringify(p.whatWasTried));
  assert.ok(line.startsWith("Retrieval gathered 34 papers in total."),
    "the gathered total is not stated first: " + line);
  assert.ok(/3 papers scored below the relevance floor/.test(line), "the below floor count is missing: " + line);
  assert.ok(/5 papers engaged none of the central concepts/.test(line), "the no concept count is missing: " + line);
  assert.ok(/4 papers engaged some central concepts but fell short of the citation standard/.test(line),
    "the short of standard count is missing: " + line);
  assert.ok(!/[-–—]/.test(line), "the retrieval state line carries a dash character: " + line);
  const md = renderNoResultsAnswer("if baby black soldier flies eat used cooking oil from restaurants do they turn out healthy", p);
  assert.ok(md.includes("Retrieval gathered 34 papers in total."), "the rendered answer lost the gathered total");
  assert.ok(!md.includes(BANNED_SENTENCE), "the rendered answer carries the literature verdict sentence");
});

await test("without audit counts the payload keeps its older plainer withheld line", () => {
  const p = buildNoResultsPayload({
    query: "quantum soil entanglement",
    sourcesQueried: [{ source: "OpenAlex", ok: true, count: 3 }],
    rungsTried: [],
    gatedOut: 3,
    gatedExamples: ["Quantum coherence in earthworms"],
  });
  assert.ok(p.whatWasTried.some((w) => /cited none/.test(w) && /clear the relevance bar/.test(w)),
    "the plain withheld line changed for callers that never emptied at the gate");
});

// ═══════════════════════════════════════════════════════════════
group("L3-2 (b) — one standard: the legacy comparison admits nothing");

await test("no code path tags a paper past the binding or ships a limited admission (source pins)", () => {
  assert.ok(!src.includes("r.paper._gateAuditAdmitted = true"),
    "a paper is still tagged as gate audit admitted");
  assert.ok(!src.includes("gateAudit.shippedLimited = true"),
    "the gate audit still ships a limited admission somewhere");
  const choke = src.match(/evidencePapers = evidencePapers\.filter\(\(p, i\) => ([^;]+)\)/);
  assert.ok(choke, "the choke point filter was not found");
  assert.ok(!choke[1].includes("_gateAuditAdmitted"),
    "the choke point still exempts a tagged paper: " + choke[1]);
  assert.ok(choke[1].includes("paperIsCitable"), "the choke point no longer re judges with the one predicate");
});

await test("a paper the legacy standard admits but the current standard rejects is not citable", () => {
  // The wave ten yogurt funnel at the binding: the narrative
  // review clears the retired standard and fails the current
  // one, at a relevance far above the floor. Before the
  // repair the gate audit could readmit exactly this paper
  // and tag it past every later gate. Now the binding knows
  // one standard, and this paper is out, full stop.
  const q = "does eating yogurt actually help your gut";
  const dyn = dynFor(q);
  const review = {
    title: "Yogurt consumption and the intestinal microbiota: a narrative review",
    abstract: "This review discusses yogurt and fermented dairy foods. Yogurt provides live bacterial cultures that pass through the stomach and reach the intestine, where they interact with the resident microbiota. Trials report small changes in stool consistency and bloating after daily yogurt intake. The evidence that yogurt improves gut function in healthy adults remains limited and mixed.",
    relevance: 90,
  };
  assert.equal(paperClearsLegacyStandard(review, q, dyn), true,
    "fixture drift: the review no longer clears the legacy standard, so it exercises nothing");
  const ctx = conceptGateContext([review], q, dyn);
  assert.equal(paperIsCitable(review, 1, ctx), false,
    "a legacy only paper is citable at the binding");
});

// ═══════════════════════════════════════════════════════════════
group("L3-5 (c) — unscored candidates are judged on the standard, not on a missing number");

const OIL_Q = "if baby black soldier flies eat used cooking oil from restaurants do they turn out healthy";
const OIL_PAPER = {
  title: "Waste oil substrates reshape the black soldier fly larval gut microbiome and biomass composition during bioconversion",
  abstract: "Black soldier fly larvae (BSFL) are generalist decomposers with promise for converting agricultural and food-processing by-products into value-added bioproducts, but BSFL performance on lipid-rich waste oil streams and the role of the gut microbiome in this process remain unclear. Here, we evaluated BSFL bioconversion of a standard chicken feed diet supplemented with three chemically distinct waste oils: acidulated vegetable oil (AVO), pork grease (PG), and used cooking oil (UCO). Larval performance, bioconversion rate, gut microbiome composition, total protein and fat content, and fatty-acid profiles were measured across bioconversion. Larval age was a major driver of gut microbiome structure, but waste oil supplementation further reshaped community membership and structure, with the strongest diet-associated effects occurring during early-to-intermediate bioconversion.",
};

await test("an unscored on point rescue paper survives the gate to the citable set", () => {
  const rescued = { ...OIL_PAPER, _unscored: true };
  assert.equal(paperRelevance(rescued), -1, "a score was invented for the rescue paper");
  assert.equal(paperIsUnscored(rescued), true, "the provenance flag does not read as unscored");
  const ctx = conceptGateContext([rescued], OIL_Q, null);
  assert.equal(paperIsCitable(rescued, 1, ctx), true,
    "the unscored on point paper was discarded by a threshold it never had the chance to meet");
  // The same record without the provenance flag keeps the old
  // reading exactly: no score, no flag, below the floor, out.
  const unflagged = { ...OIL_PAPER };
  assert.equal(paperIsUnscored(unflagged), false);
  assert.equal(paperIsCitable(unflagged, 1, ctx), false,
    "an unflagged scoreless record became citable");
  // A real score, once present, governs over the flag.
  // PIN UPDATED (2026-10-23, wave 3 lane S3, L3-4): the score
  // sits below the rescue band on the calibrated topical
  // scale (band 15 to 24 under the topical floor of 25); the
  // old fixture value 20 was below the old band (40 to 49)
  // and is inside the new one.
  const scored = { ...OIL_PAPER, _unscored: true, relevance: 10 };
  assert.equal(paperIsUnscored(scored), false, "a scored paper still reads as unscored");
  assert.equal(paperIsCitable(scored, 1, ctx), false, "a scored paper below the band rode in on its stale flag");
});

await test("an unscored off point paper is still out: the standard half binds in full", () => {
  const junk = {
    title: "Soil desiccation cracks in ophthalmology patients",
    abstract: "A study of soil desiccation cracks observed in a clinic garden and eye surface dryness in patients attending an ophthalmology service in a dry season.",
    _unscored: true,
  };
  const ctx = conceptGateContext([junk], OIL_Q, null);
  assert.equal(paperIsCitable(junk, 1, ctx), false,
    "an unscored junk paper became citable: the flag must waive the floor only, never the standard");
});

await test("the floor only recheck keeps flagged papers and drops unflagged scoreless ones", () => {
  const flagged = { title: "a", _unscored: true };
  const unflagged = { title: "b" };
  const scoredLow = { title: "c", relevance: 20 };
  assert.deepEqual(applyRelevanceGate([flagged, unflagged, scoredLow]), [flagged],
    "the recheck's provenance discipline is wrong");
});

await test("the post scoring merges stamp the provenance flag (source pins)", () => {
  assert.ok(src.includes("p._unscored = true"),
    "the LLM rescue merge does not stamp its papers as unscored");
  assert.ok(src.includes("gResult._diag.llmRescueAdded"),
    "the rescue count diagnostic vanished instead of being kept honest");
  assert.ok(src.includes("gResult._diag.unscoredCitable"),
    "no diagnostic counts how many unscored papers survived to citable");
});

// ═══════════════════════════════════════════════════════════════
// Handler scenarios (stub env modeled on search-wave-ten).
// ═══════════════════════════════════════════════════════════════
function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function chatRes(content) { return jsonRes({ choices: [{ message: { content } }] }); }
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
let scenFailSynthesis = false;

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
      if (scenFailSynthesis) return jsonRes({ error: { message: "rate limited" } }, 429);
      if (body.includes("literature search specialist")) {
        if (body.includes("creatine")) return chatRes(JSON.stringify([
          { term: "creatine", alternates: ["creatine monohydrate", "supplementation"] },
          { term: "kidneys", alternates: ["renal", "kidney function", "renal function"] },
        ]));
        return chatRes(JSON.stringify([
          { term: "yogurt", alternates: ["fermented milk", "cultured dairy", "kefir"] },
          { term: "gut", alternates: ["intestinal", "digestive", "microbiota"] },
        ]));
      }
      if (body.includes("relevance validator")) return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
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
      OPENROUTER_KEY: "gate-one-standard-test-key-123456",
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
    return { data };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

const epmc = (id, title, abstractText, citedByCount = 40, pubYear = "2021") => ({
  title,
  doi: "10.1000/gos-" + id,
  pubYear: String(pubYear),
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});

group("Handler — a gate emptied pool ships the retrieval state and cites nothing");

await test("the creatine shaped pool: legacy would admit, the one standard does not, the answer reports the search", async () => {
  scenFailSynthesis = true;
  // The wave ten fixture shape: titles name the subject, the
  // abstracts then speak of "the supplement", so the current
  // standard admits none of them while the retired standard
  // admitted them at the floor. The gate empties the set.
  scenPapers = [
    epmc(1, "Creatine supplementation and renal function: a systematic review",
      "This systematic review examines the supplement and kidney outcomes in healthy adults. Across trials, the supplement at recommended doses did not impair renal function. Serum creatinine rose slightly during loading without changes in measured glomerular filtration. The review concludes the supplement is not harmful to the kidneys of healthy users.", 120),
    epmc(2, "Long term creatine use and kidney health in athletes",
      "Athletes taking the supplement for two years were monitored for kidney health. Renal function markers, including serum creatinine and estimated glomerular filtration, stayed within reference ranges throughout the monitoring period. No adverse kidney outcomes were recorded.", 60),
    epmc(3, "Editorial: the athlete's brain and the substances of sport",
      "This editorial comments on neuroscience and sport, discussing how athletes think about supplements, training, and the culture of performance in modern athletics.", 30),
    epmc(4, "Creatine loading and serum creatinine in resistance trained men",
      "Resistance trained men completed a loading phase of twenty grams daily for five days. Serum creatinine rose during loading, while estimated glomerular filtration rate stayed within reference ranges. The authors note the loading protocol raises creatinine readings without indicating kidney damage.", 45),
    epmc(5, "Creatine intake and estimated glomerular filtration: a cohort analysis",
      "This cohort analysis followed adults taking the supplement for three years. Estimated glomerular filtration rate, the standard kidney function measure, did not decline faster in the supplement group than in matched non users. No excess of kidney diagnoses was recorded.", 80),
  ];
  scenAnswer = "";
  const { data } = await runScenario("is creatine bad for your kidneys");
  assert.equal(data.responseKind, "no-results",
    "the gate emptied pool did not land in the retrieval state: " + data.responseKind);
  assert.ok((data.sources || []).every((s) => !s.cited),
    "a paper the current standard excluded shipped as cited");
  const ga = data._record && data._record.gateAudit;
  assert.ok(ga, "the record carries no gate audit for a gate emptied run");
  assert.equal(ga.citableBefore, 0, "the strict standard admitted papers the fixture says it should not");
  assert.equal(ga.shippedLimited, false, "the run shipped a limited admission under the retired standard");
  assert.ok(ga.comparisonAdmitted >= 1,
    "the record only comparison no longer counts what the legacy standard would have admitted");
  const answerText = String(data.answer || "");
  assert.ok(/Retrieval gathered \d+ papers in total/.test(answerText),
    "the shipped answer does not state how many papers were gathered: " + answerText.slice(0, 300));
  assert.ok(/Counted once per paper under the first reason it failed/.test(answerText),
    "the shipped answer carries no aggregate exclusion accounting: " + answerText.slice(0, 400));
  assert.ok(!answerText.includes(BANNED_SENTENCE),
    "the literature verdict sentence shipped as an answer claim");
});

console.log(`\ngate-one-standard: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
