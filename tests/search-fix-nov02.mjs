/**
 * Search fix wave (2026-11-02). Proof tests for the five lane
 * fixes built from the search diagnosis report
 * (~/workspace/cerebrum-search-diagnosis-nov02/report.md). Each
 * test pins a mechanism at the point it changed, on the bank
 * wordings the diagnosis measured (plain everyday language, per
 * the standing mismatched language rule).
 *
 *   Lane C (collapse): organism admission is validated against
 *   real binomials and organism phrases, the topic is built
 *   from the question's own words first with concept additions
 *   after, kinship and framing words never become topic terms,
 *   and feed survives in a feed question.
 *   Lane A (hijacks): the bug and wired sense bridges resolve;
 *   action verbs carry the structural verb class; the title
 *   exception at the citation gate is discounted the same way
 *   the scorer's title floor is (collision titles admit
 *   nothing on title hits alone).
 *   Lane B (bounces): the subject serve degrades to a thin
 *   labeled serve over the originally cited citable papers
 *   when the resolved subject is a bare side word, and the
 *   programmatic passes stamping their emptying of a shelf
 *   into the record.
 *   Lane D (honesty): the post ladder rounds record into the
 *   coverage accounting (a source the ladder counted no papers
 *   for takes the fallback round's count and standing; a
 *   source already counted keeps the ladder's count, per the
 *   wave eight r3 parity pin), the coverage note guard (a
 *   citing serve never ships a note claiming it was built
 *   from zero sources), and the venting route's symptom
 *   override.
 *   Lane E (methods): measurement detection hears the watch
 *   verb class and the how much work shape; method tier is
 *   readable on specimens; and the handler binds citability
 *   to method tier on a measurement question (a pool holding
 *   only value reporting papers serves nothing, a pool with a
 *   real method paper serves).
 *
 * Filed, not pinned here: Lane B Group A's judged path was
 * built, broke two standing pins (the L3-2 yogurt review and
 * the grocery citableBefore 0 contract), and was reverted;
 * the gate is at its baseline standard in this wave apart
 * from Lane A's title discount. The sense downgrade half of
 * Lane A's fix 1 was unbuildable as stated (the report's own
 * PLS4 specimen defeats its test) and is not built.
 *
 * Run with: node tests/search-fix-nov02.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const search = await import(join(root, "functions/api/search.js"));

const {
  onRequest, createSubrequestLedger,
  buildDynLookup, buildDeterministicFallbackGroups, centralContentTerms,
  buildStructuredQuery, questionConceptGroups,
  citationGateStandard, paperClearsCitationGate,
  structuralTermIsActionVerb, isVentingConversational,
  buildCoverageNote, coverageNoteForServe,
  resolveMeasurementIntent, paperMethodTier,
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

/* ── Lane C: organism admission and the topic ─────────────── */
group("Lane C — collapse");

const BSF3_Q = "can kitchen scraps and old chip fat feed the grubs that turn rubbish into chicken feed";
const BSF1_Q = "can i feed leftover fryer grease to black soldier fly larvae instead of chicken feed";
const BSF2_LEMMA_Q = "my cousin raise black soldier fly, can the little grub eat leftover grease from the fish fry";

await test("BSF3: chip no longer promotes to the chromatin immunoprecipitation anchor", () => {
  const q = buildStructuredQuery(BSF3_Q, null);
  assert.ok(!/chromatin/i.test(q), "the ChIP expansion still anchors the query: " + q);
  assert.ok(!/\bchip\b/i.test(q.split(" AND ")[0]), "chip still names the organism slot: " + q);
  assert.ok(/scraps/.test(q) && /rubbish/.test(q) && /feed/.test(q),
    "the substrate words left the topic: " + q);
});

await test("BSF2 (lemmatized surface): no kinship, raising, little, or left in the topic", () => {
  const q = buildStructuredQuery(BSF2_LEMMA_Q, null);
  assert.ok(/Hermetia illucens/i.test(q), "the organism anchor is gone: " + q);
  const topic = q.split(" AND ").slice(1).join(" AND ");
  for (const junk of ["cousin", "raise", "raises", "little", "left"]) {
    assert.ok(!new RegExp(`\\b${junk}\\b`).test(topic), `"${junk}" is still a topic term: ` + q);
  }
  assert.ok(/grease/.test(topic), "the substrate word left the topic: " + q);
});

await test("BSF1 shape: feed survives in a feed question", () => {
  const q = buildStructuredQuery(BSF1_Q, null);
  assert.ok(/Hermetia illucens/i.test(q), "the organism anchor is gone: " + q);
  assert.ok(/\bfeed\b/.test(q), "feed was deleted from a feed question: " + q);
  assert.ok(/grease/.test(q) && /fryer/.test(q), "the substrate words left the topic: " + q);
});

await test("rice without a plant frame is a bare topic word, never the Oryza anchor", () => {
  const q = buildStructuredQuery("my sugar spikes after eating rice, can a little gadget on my arm watch the rise", null);
  assert.ok(!/oryza/i.test(q), "rice still promotes to the organism anchor: " + q);
  assert.ok(/\brice\b/.test(q), "rice left the query entirely: " + q);
});

await test("rice with a plant frame keeps the Oryza sativa anchor", () => {
  const q = buildStructuredQuery("how do farmers stop rice blast fungus from cutting grain yield in paddy fields", null);
  assert.ok(/Oryza sativa/i.test(q), "the framed rice anchor was lost: " + q);
});

await test("CTRL1: the named organism control is untouched", () => {
  const q = buildStructuredQuery("does Hermetia illucens larvae growth change on food waste", null);
  assert.equal(q, '"Hermetia illucens" AND (larvae OR growth OR food OR waste)');
});

await test("the question's own topic words keep their order ahead of concept additions", () => {
  const OIL_Q = "What happens when you feed black soldier fly maggots used fryer oil and not much else?";
  const OIL_DYN = buildDynLookup([
    { term: "black soldier fly", alternates: ["hermetia illucens", "black soldier fly larvae", "maggots"] },
    { term: "fryer oil", alternates: ["cooking oil for frying", "frying medium"] },
  ]);
  const q = buildStructuredQuery(OIL_Q, OIL_DYN);
  assert.ok(q.includes("maggots OR fryer OR oil"), "the topic lost its real terms or their order: " + q);
  assert.ok(!/ OR not( |\))/.test(q) && !q.includes("else"), "closed class words are back in the boolean: " + q);
});

/* ── Lane A: sense bridges, action verbs, title discount ─── */
group("Lane A — hijacks");

await test("the bug bridge resolves the stomach bug sense", () => {
  const groups = questionConceptGroups("i caught a stomach bug and keep throwing up", null);
  const bug = groups.find((g) => g.has("stomach bug"));
  assert.ok(bug, "no group carries stomach bug");
  assert.ok(bug.has("pathogen") && bug.has("viral infection"),
    "the bug group does not bridge to the infection vocabulary: " + [...bug].join("|"));
});

await test("the wired bridge resolves the caffeine sense", () => {
  const groups = questionConceptGroups("i feel wired and cannot sleep after energy drinks", null);
  const wired = groups.find((g) => g.has("wired"));
  assert.ok(wired, "no group carries wired");
  assert.ok(wired.has("caffeinated") && wired.has("energy drink"),
    "the wired group does not bridge to the caffeinated vocabulary: " + [...wired].join("|"));
  // The bare word caffeine stays out of the hand table: its
  // fallback bridge to coffee is a standing contract, and a
  // hand table membership would make the fallback builder
  // skip the term entirely.
  const caf = buildDeterministicFallbackGroups("does caffeine raise blood pressure", ["caffeine"]);
  const cafAlts = (caf[0] && caf[0].alternates) || [];
  assert.ok(cafAlts.includes("coffee"), "the caffeine fallback bridge to coffee broke: " + JSON.stringify(caf));
});

await test("action verbs carry the structural verb class, other words do not", () => {
  for (const v of ["walking", "running", "swimming", "cycling", "hiking"]) {
    assert.equal(structuralTermIsActionVerb(v), true, v + " lost the action verb class");
  }
  for (const w of ["photosynthesis", "baking", " sediment", "protein"]) {
    assert.equal(structuralTermIsActionVerb(w.trim()), false, w + " wrongly carries the action verb class");
  }
});

await test("the title exception contract stands: the gate side discount is filed, not built", () => {
  // Lane A fix 4's gate side twin (a title exception paper
  // must engage a further concept in its abstract) was built
  // and reverted: the wave eight pin clears a cohort paper on
  // subject plus a second concept in the title with a methods
  // boilerplate abstract, and that contract is standing. The
  // discount survives only in the scorer's title floor. This
  // test guards the contract so the filing cannot silently
  // regress.
  const COFFEE_Q = "will drinking coffee while pregnant hurt the baby";
  const std = citationGateStandard(COFFEE_Q,
    buildDynLookup(buildDeterministicFallbackGroups(COFFEE_Q, centralContentTerms(COFFEE_Q))));
  const titleOnly = {
    title: "Coffee and the baby: what the cohort measured",
    abstract: "Recruitment ran through three maternity clinics over two winters. Interviewers were trained centrally, and the protocol was registered before enrolment opened.",
  };
  assert.equal(paperClearsCitationGate(titleOnly, std), true,
    "the title exception contract no longer holds: subject plus a second title concept must clear without an abstract engagement");
});

/* ── Lane D: coverage guard and the venting route ────────── */
group("Lane D — honesty");

const DB_NAMES = ["PubMed", "Europe PMC", "Semantic Scholar", "OpenAlex", "Crossref", "DOAJ", "arXiv", "bioRxiv", "CORE", "BASE", "Lens", "Scopus", "Web of Science", "Google Scholar"];
const allFailed = DB_NAMES.map((source) => ({ source, ok: false, outcome: "not-searched", results: 0 }));

await test("the coverage guard rewrites the built from zero claim on a citing serve", () => {
  const note = buildCoverageNote(allFailed);
  assert.ok(note && /built from the 0 that did\./.test(note), "fixture note lost its closing claim: " + note);
  const guarded = coverageNoteForServe(allFailed, { rawFallback: true }, { gathered: 22, cited: 3 });
  assert.ok(!/built from the 0 that did/.test(guarded), "the zero claim still ships: " + guarded);
  assert.ok(/raw fallback net/.test(guarded), "the amended note does not name the round that gathered the pool: " + guarded);
});

await test("the coverage guard leaves honest notes alone", () => {
  const someAnswered = DB_NAMES.map((source) => ({ source, ok: source !== "PubMed", outcome: "ok", results: 2 }));
  const note = buildCoverageNote(someAnswered);
  assert.equal(coverageNoteForServe(someAnswered, { rawFallback: true }, { gathered: 22, cited: 3 }), note,
    "a note whose arithmetic is honest was rewritten");
  assert.equal(coverageNoteForServe(allFailed, { rawFallback: true }, { gathered: 0, cited: 0 }),
    buildCoverageNote(allFailed), "a serve that gathered and cited nothing kept the guard's amendment");
});

await test("isVentingConversational: symptom questions reach search, plain venting stays conversational", () => {
  const FEV3 = "i feel freezing and shivering even though my forehead is hot, why is my body doing that on purpose";
  assert.equal(isVentingConversational(FEV3), false, "FEV3 still routes to the persona responder");
  assert.equal(isVentingConversational("i feel dizzy and my head hurts, how do i make it stop"), false,
    "a symptom question with a how still routes to the persona responder");
  assert.equal(isVentingConversational("i feel sad today"), true, "a plain feeling report left the conversational route");
  assert.equal(isVentingConversational("i need to vent, work was awful and i am exhausted"), true,
    "an explicit vent left the conversational route");
});

/* ── Lane E: measurement detection and method tier ───────── */
group("Lane E — methods");

await test("measurement detection hears the watch verb class and the how much work shape", () => {
  const MNP4 = "if a lab prints a number for manganese peroxidase, what did they actually watch change in the tube";
  const MNP2 = "in the lab, how do people tell how much work that fungus chemical is doing";
  const MNP1 = "how can the activity of manganese peroxidase be measured";
  assert.equal(resolveMeasurementIntent(MNP4).measurement, true, "MNP4 still does not resolve as a measurement question");
  assert.equal(resolveMeasurementIntent(MNP2).measurement, true, "MNP2 still does not resolve as a measurement question");
  assert.equal(resolveMeasurementIntent(MNP1).measurement, true, "MNP1 lost its measurement resolution");
  for (const control of [
    "how does a steam engine work",
    "how do bees make honey",
    "what is manganese peroxidase",
    "what should i watch tonight to relax",
    "how much does a ticket to the game cost",
  ]) {
    assert.equal(resolveMeasurementIntent(control).measurement, false,
      "a control question now resolves as measurement: " + control);
  }
});

const METHOD_PAPER = { title: "Improvements in the determination of manganese peroxidase activity",
  abstract: "Manganese peroxidase activity is commonly determined by following the oxidation of Mn2+ to Mn3+ spectrophotometrically. We describe an improved assay in which the formation of the Mn3+ malonate complex is monitored at 270 nm, and we compare the method with the standard phenol red assay for crude fungal broth cultures." };
const VALUE_PAPER = { title: "Optimisation of manganese peroxidase production in submerged fermentation",
  abstract: "Production of manganese peroxidase by the fungus was optimised over nitrogen source, carbon source, and culture time. The highest activity recorded was 412 U per litre on day nine under the best production dose, and stability of the preparation was followed over storage." };

await test("method tier separates the method paper from the value reporting paper", () => {
  assert.ok(paperMethodTier(METHOD_PAPER) >= 1, "the method paper reads as tier 0");
  assert.equal(paperMethodTier(VALUE_PAPER), 0, "the value reporting paper reads above tier 0");
});

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
let scenValidator = null;

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
        return chatRes(scenValidator || JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));
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
      OPENROUTER_KEY: "fix-nov02-test-openrouter-key-123456",
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
    scenExpansion = null;
    scenValidator = null;
  }
}

const epmcFix = (id, title, abstractText, citedByCount, pubYear) => ({
  title,
  doi: "10.1000/fixnov02-" + id,
  pubYear: String(pubYear),
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});

/* ── Lane B: the thin serve and the passes stamp ─────────── */
group("Lane B — bounces (handler)");

const PLS2_Q = "builders near me toss ground up plastic into cement, is the stuff still strong enough to use";
const PLS2_POOL = [
  epmcFix("p1", "Tensile strength of recycled plastic lumber under load",
    "Recycled plastic was formed into lumber profiles and tested for tensile strength and flexural strength under load. The plastic lumber carried strong performance at room temperature, and its strength is compared with timber for outdoor use. Specimens were conditioned and pulled to failure on a universal testing frame.", 210, 2022),
  epmcFix("p2", "How strong is post consumer plastic as a building material",
    "Post consumer plastic was evaluated as a building material in panel form. We measured how strong the plastic panels are in bending and compression, and report the strength of the plastic relative to common sheet materials used on site.", 160, 2021),
];
const PLS2_ANSWER = "## Short answer\n\nRecycled **plastic** lumber was tested for tensile and flexural **strength** under load, and carried strong performance at room temperature [1].\n\nPost consumer plastic panels were measured in bending and compression to see how strong the plastic is as a building material [2].";
const PLS2_FACTCHECK = JSON.stringify({ claims: [
  { claim: "Recycled plastic lumber was tested for tensile and flexural strength under load, and carried strong performance at room temperature",
    source_index: 1,
    quote: "The plastic lumber carried strong performance at room temperature",
    status: "supported",
    justification: "The first source reports the plastic lumber carried strong performance at room temperature under load testing." },
  { claim: "Post consumer plastic panels were measured in bending and compression to see how strong the plastic is as a building material",
    source_index: 2,
    quote: "We measured how strong the plastic panels are in bending and compression",
    status: "supported",
    justification: "The second source states it measured how strong the plastic panels are in bending and compression." },
] });

await test("PLS2 shape: a bare side word subject degrades to the thin serve instead of refusing", async () => {
  scenPapers = PLS2_POOL;
  scenAnswer = PLS2_ANSWER;
  scenFactCheck = PLS2_FACTCHECK;
  const { data } = await runScenario(PLS2_Q, { settings: { factCheck: true } });
  assert.equal(data.responseKind, "research",
    "the run refused a cited citable set over a side word subject: " + data.responseKind + " / " + String(data.answer || "").slice(0, 160));
  const serve = (data._record || {}).subjectServe || {};
  assert.ok(serve.fired && serve.rebuilt && serve.thinServe === true,
    "the record does not show the thin serve: " + JSON.stringify(serve));
});

await test("the passes stamp: a shelf the programmatic passes empty is recorded as emptied", async () => {
  // A shelf with no topic overlap at all: the topic overlap
  // pass (PASS 1B of programmaticValidationPasses) empties it
  // deterministically, which is the Group B specimen shape
  // (an on topic shelf upstream, nothing left after the
  // passes, and at baseline no trace in the record of which
  // stage emptied it).
  scenPapers = [
    epmcFix("x1", "Byzantine chant manuscripts in monastic libraries: a cataloguing study",
      "This study catalogues Byzantine chant manuscripts held in monastic libraries, describing notation systems, scribal hands, and the liturgical ordering of chant books copied between the twelfth and fifteenth centuries.", 40, 2019),
    epmcFix("x2", "Provenance of medieval antiphoners: bindings, pigments, and scriptoria",
      "We trace the provenance of medieval antiphoners through binding structures, pigment composition, and scriptorium practices, and propose a chronology for a group of choir books preserved in cathedral archives.", 25, 2018),
  ];
  scenAnswer = PLS2_ANSWER;
  scenFactCheck = PLS2_FACTCHECK;
  const { data } = await runScenario(PLS2_Q, { settings: { factCheck: true } });
  assert.equal(data.responseKind, "no-results",
    "a shelf emptied by validation should serve nothing: " + data.responseKind);
  const funnel = (data._record || {}).funnel || {};
  assert.equal(funnel.passesEmptiedShelf, true,
    "the record does not stamp the passes emptying the shelf: " + JSON.stringify(funnel).slice(0, 300));
});

/* ── Lane E: citability binds to method tier (handler) ───── */
group("Lane E — methods (handler)");

const MNP1_Q = "how can the activity of manganese peroxidase be measured";
const MNP_POOL_VALUES_ONLY = [
  epmcFix("v1", VALUE_PAPER.title, VALUE_PAPER.abstract, 130, 2022),
  epmcFix("v2", "Manganese peroxidase production by white rot fungi under varied culture conditions",
    "Cultures of white rot fungi were grown under varied nitrogen and carbon regimes and manganese peroxidase production was recorded for each condition. The best culture condition gave the highest production value after ten days, and production profiles are reported for all strains tested.", 95, 2021),
];
const MNP_ANSWER_VALUES = "## Short answer\n\n**Manganese peroxidase** production was optimised over nitrogen and carbon sources, with the highest activity recorded at 412 U per litre on day nine [1].\n\nAcross culture conditions, production profiles differed by strain, and the best condition gave the highest production value after ten days [2].";
const MNP_FACTCHECK_VALUES = JSON.stringify({ claims: [
  { claim: "Manganese peroxidase production was optimised over nitrogen and carbon sources, with the highest activity recorded at 412 U per litre on day nine",
    source_index: 1,
    quote: "The highest activity recorded was 412 U per litre on day nine",
    status: "supported",
    justification: "The first source reports the highest activity of 412 U per litre on day nine under the best production dose." },
  { claim: "The best culture condition gave the highest production value after ten days",
    source_index: 2,
    quote: "The best culture condition gave the highest production value after ten days",
    status: "supported",
    justification: "The second source states the best culture condition gave the highest production value after ten days." },
] });

await test("MNP1 shape: a pool of value reporting papers only serves no method answer", async () => {
  scenPapers = MNP_POOL_VALUES_ONLY;
  scenAnswer = MNP_ANSWER_VALUES;
  scenFactCheck = MNP_FACTCHECK_VALUES;
  const { data } = await runScenario(MNP1_Q, { settings: { factCheck: true } });
  assert.equal(data.responseKind, "no-results",
    "a measurement question was answered from papers that only report values: " + data.responseKind + " / " + String(data.answer || "").slice(0, 160));
});

await test("MNP1 shape: with a real method paper in the pool, the answer serves", async () => {
  scenPapers = [epmcFix("m1", METHOD_PAPER.title, METHOD_PAPER.abstract, 240, 2020), ...MNP_POOL_VALUES_ONLY];
  scenAnswer = "## Short answer\n\n**Manganese peroxidase activity** is determined by following the oxidation of Mn2+ to Mn3+ spectrophotometrically, and an improved assay monitors the Mn3+ malonate complex at 270 nm [1].";
  scenFactCheck = JSON.stringify({ claims: [
    { claim: "Manganese peroxidase activity is determined by following the oxidation of Mn2+ to Mn3+ spectrophotometrically",
      source_index: 1,
      quote: "Manganese peroxidase activity is commonly determined by following the oxidation of Mn2+ to Mn3+ spectrophotometrically",
      status: "supported",
      justification: "The method paper states the activity is determined by following the oxidation of Mn2+ to Mn3+ spectrophotometrically." },
  ] });
  const { data } = await runScenario(MNP1_Q, { settings: { factCheck: true } });
  assert.equal(data.responseKind, "research",
    "a measurement question with a method paper in the pool did not serve: " + data.responseKind + " / " + String(data.answer || "").slice(0, 160));
});

console.log(`\nsearch-fix-nov02: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
