/**
 * Search wave nine (2026-10-14): the retrieval foundation for
 * mechanism questions.
 *
 *   Job 1: a mechanism shape detector. "How does X work"
 *     questions (CRISPR cutting DNA, PCR amplifying DNA, a
 *     western blot detecting proteins, the heart pumping
 *     blood) are told apart from ethics, delivery outcome,
 *     and measurement questions. A western blot question is
 *     both shapes at once: it asks how a method works and
 *     its operative verb is a detection verb.
 *   Job 2: mechanism tiers and foundational primaries. A
 *     paper earns tier 2 with a mechanism word in its title
 *     and tier 1 with two distinct mechanism words in its
 *     abstract. A delivery or clinical paper with tier 0 is
 *     application only. A foundational primary is an early,
 *     heavily cited mechanism paper (the Jinek class) judged
 *     against its pool.
 *   Job 3: the citation gate bars application only papers
 *     on mechanism shapes even when they engage two central
 *     concepts, and the bar is shape scoped: the same paper
 *     clears on a delivery question.
 *   Job 4: ordering pulls foundational primaries from the
 *     gated pool into the shelf, first, size unchanged.
 *   Job 5: the handler fires a foundational lane (Europe
 *     PMC, OpenAlex, Semantic Scholar, queried with core
 *     terms plus mechanism vocabulary) before the clause
 *     fanout, orders the primary into the cited set, keeps
 *     the application paper out of it, and the synthesis
 *     prompt carries the mechanism block. The lane is gated
 *     at SUBREQUEST_FOUNDATIONAL_LANE_COST through the
 *     ledger, so capped runs trim clause fanouts instead.
 *   Job 6: the legal source lists name every fanout source
 *     and no refused source.
 *   Job 7: CACHE_SCHEMA_VERSION is v43 with a dated wave
 *     nine chain entry.
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 * Handler scenarios run the real onRequest against a stub env
 * modeled on tests/search-wave-eight-r3.mjs.
 *
 * Run with: node tests/search-wave-nine.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const search = await import(join(root, "functions/api/search.js"));

const {
  onRequest, createSubrequestLedger,
  citationGateStandard, paperClearsCitationGate, paperIsCitable,
  conceptGateContext,
  buildDeterministicFallbackGroups, buildDynLookup, centralContentTerms,
  detectMeasurementIntent,
  isMechanismShapeQuery, paperMechanismTier, paperApplicationOnly,
  foundationalPoolStats, paperIsFoundationalPrimary, orderShelfForMechanism,
  SUBREQUEST_FOUNDATIONAL_LANE_COST, BLOCKED_DOMAINS,
} = search;
const { SCHOLARLY_SOURCES } = await import(join(root, "functions/lib/product.js"));

const WAVE9_EXPORTS = [
  "isMechanismShapeQuery", "paperMechanismTier", "paperApplicationOnly",
  "foundationalPoolStats", "paperIsFoundationalPrimary", "orderShelfForMechanism",
  "SUBREQUEST_FOUNDATIONAL_LANE_COST",
];
const missingExports = WAVE9_EXPORTS.filter((n) => typeof search[n] === "undefined");
if (missingExports.length > 0) {
  console.log("  ! wave nine exports missing from functions/api/search.js: " + missingExports.join(", "));
}

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

// ── Scenario runner (wave eight r3 pattern, plus a fetch log
// and a foundational lane: the lane query is the one whose
// query text contains "cleavage") ─────────────────────────
let scenPapers = [];
let scenAnswer = "";
let scenFetchLog = [];
let scenLaneEpmc = [];
let scenLaneOpenAlex = [];
let scenLaneS2 = [];

const decoded = (u) => { try { return decodeURIComponent(String(u)); } catch { return String(u); } };
const isLaneUrl = (u) => decoded(u).includes("cleavage");

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
    if (opts.parityFetch) {
      const r = opts.parityFetch(u, body);
      if (r) return r;
    }
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
      if (isLaneUrl(u)) return jsonRes({ resultList: { result: scenLaneEpmc } });
      if (u.includes("BODY")) return jsonRes({ resultList: { result: [] } });
      return jsonRes({ resultList: { result: scenPapers } });
    }
    if (u.includes("api.openalex.org")) {
      if (isLaneUrl(u)) return jsonRes({ results: scenLaneOpenAlex });
      return jsonRes({ results: [] });
    }
    if (u.includes("api.semanticscholar.org")) {
      if (isLaneUrl(u)) return jsonRes({ data: scenLaneS2 });
      return jsonRes({ data: [] });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (opts.eutils) return opts.eutils(u);
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
      OPENROUTER_KEY: "w9-test-openrouter-key-123456",
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
  }
}

const epmc9 = (id, title, abstractText, citedByCount, pubYear) => ({
  title,
  doi: "10.1000/w9-" + id,
  pubYear: String(pubYear),
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});
const inverted = (text) => {
  const idx = {};
  text.split(/\s+/).forEach((w, i) => {
    const k = w.replace(/[^A-Za-z0-9-]/g, "");
    if (k) (idx[k] = idx[k] || []).push(i);
  });
  return idx;
};
// A plain internal paper (the shape the unit functions read:
// title, abstract, year, citations, relevance).
const paper = (title, abstract, year, citations, extra = {}) => ({
  title, abstract,
  year: String(year), citations,
  citedByCount: citations, citationCount: citations,
  authors: "Doe J et al.", journal: "Journal of Recorded Studies",
  doi: "10.1000/w9-" + Math.abs([...title].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7)),
  url: "https://doi.org/10.1000/w9-unit",
  relevance: 90,
  ...extra,
});

// ═══════════════════════════════════════════════════════════════
// The fixtures. Papers the way papers are written.
// ═══════════════════════════════════════════════════════════════

const JINEK_TITLE = "A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity";
const JINEK_ABSTRACT = "Clustered regularly interspaced short palindromic repeats (CRISPR) and CRISPR associated (Cas) proteins form an adaptive immune system in bacteria and archaea. Here we show that Cas9 is a dual RNA guided DNA endonuclease. Cas9 is guided by a crRNA and a tracrRNA to a target DNA sequence, where its two nuclease domains cleave each strand of the DNA and generate a double strand break. Guide RNA recognition of the target, together with the requirement for a protospacer adjacent motif, determines where cleavage occurs. These findings establish the mechanism by which the CRISPR Cas system recognizes and cuts foreign DNA, and show that the guide can be reprogrammed to direct cleavage to new targets.";
const JINEK = paper(JINEK_TITLE, JINEK_ABSTRACT, "2012", 9500, { authors: "Jinek M et al.", journal: "Science", relevance: 96 });

const LNP_TITLE = "Comparative analysis of lipid nanoparticle mediated delivery of CRISPR-Cas9 ribonucleoprotein complexes";
const LNP_ABSTRACT = "Lipid nanoparticles were compared as delivery vehicles for CRISPR Cas9 ribonucleoprotein complexes in cultured cells and in mice. Delivery efficiency and transfection rates differed across formulations, and editing was highest in tissues where the complexes were delivered by the lead nanoparticle after systemic administration. Editing of genomic DNA in target tissue, therapeutic outcomes, tolerability, and clinical translation potential were assessed, with efficacy in a disease model reported for the best performing formulation. The results support nanoparticle delivery of CRISPR Cas9 as a route toward therapeutic use in patients.";
const LNP = paper(LNP_TITLE, LNP_ABSTRACT, "2024", 210, { relevance: 88 });

const MECH_REVIEW_TITLE = "Mechanisms of CRISPR Cas9 DNA cleavage: a review";
const MECH_REVIEW_ABSTRACT = "This review surveys how CRISPR Cas9 cuts DNA. Guide RNA recognition of the target sequence positions the Cas9 endonuclease, whose two nuclease domains cleave the two DNA strands at a defined site. Structural work on binding of the guide and the target strand, and on the conformational changes that license cleavage, is summarized, together with open questions about repair after the break.";
const MECH_REVIEW = paper(MECH_REVIEW_TITLE, MECH_REVIEW_ABSTRACT, "2023", 340, { relevance: 86 });

const DELIVERY_MECH2_TITLE = "Lipid nanoparticle delivery of CRISPR Cas9: formulation and cellular uptake in vivo";
const DELIVERY_MECH2_ABSTRACT = "Lipid nanoparticles for delivery of CRISPR Cas9 were formulated and tested in vivo. Particle binding to the cell surface and crossing of the endosomal membrane were measured for each formulation, and delivery efficiency and therapeutic efficacy in a disease model were compared. Clinical translation will require higher uptake, but the binding and membrane crossing measurements explain most of the difference between formulations.";
const DELIVERY_MECH2 = paper(DELIVERY_MECH2_TITLE, DELIVERY_MECH2_ABSTRACT, "2024", 95, { relevance: 84 });

const PCR_PRIMARY_TITLE = "Primer directed enzymatic amplification of DNA with a thermostable DNA polymerase";
const PCR_PRIMARY_ABSTRACT = "A method for amplifying DNA sequences in vitro is described. Cycles of denaturation, primer annealing, and extension by a thermostable DNA polymerase double the amount of the target template in each cycle, producing exponential amplification of the segment defined by the two primers. The polymerase chain reaction (PCR) allows a specific DNA strand to be copied many times from a complex template mixture, and the product can be detected and cloned after amplification.";
const PCR_PRIMARY = paper(PCR_PRIMARY_TITLE, PCR_PRIMARY_ABSTRACT, "1987", 12000, { authors: "Mullis K et al.", journal: "Methods in Enzymology", relevance: 96 });

const PCR_APP_TITLE = "Point of care PCR testing in the emergency department: patient outcomes and time to treatment";
const PCR_APP_ABSTRACT = "Patients presenting to the emergency department with suspected respiratory infection were assigned to point of care PCR testing or to standard laboratory testing. PCR amplification of viral DNA from a nasal swab returned results during the visit, and clinicians recorded time to therapeutic decision, length of stay, and clinical outcomes for each patient group. Point of care testing shortened time to treatment and reduced unnecessary antibiotic use, with efficacy judged on patient outcomes rather than on the testing chemistry.";
const PCR_APP = paper(PCR_APP_TITLE, PCR_APP_ABSTRACT, "2023", 140, { relevance: 87 });

const WB_PRIMARY_TITLE = "Electrophoretic transfer of proteins from polyacrylamide gels to nitrocellulose sheets";
const WB_PRIMARY_ABSTRACT = "A method is described for the electrophoretic transfer of proteins from polyacrylamide gels onto nitrocellulose sheets. The transferred proteins retain their antigenic activity on the membrane and can be probed with antibody, and the bound antibody is then revealed by detection with a labeled second antibody. The procedure, later known as western blotting, allows proteins separated according to size to be identified and measured on the membrane with high sensitivity.";
const WB_PRIMARY = paper(WB_PRIMARY_TITLE, WB_PRIMARY_ABSTRACT, "1979", 60000, { authors: "Towbin H et al.", journal: "PNAS", relevance: 96 });

const WB_APP_TITLE = "Western blot biomarkers in patients with chronic liver disease: a clinical cohort study";
const WB_APP_ABSTRACT = "Serum samples from patients with chronic liver disease and from healthy controls were analysed by western blot, and western blot band intensities for three candidate proteins were compared with clinical stage. The protein patterns tracked disease severity, and the study assessed their value for therapeutic monitoring and for judging treatment efficacy in routine clinical care of patients. No new blotting procedure is described; the western blot was used as a clinical measurement tool throughout.";
const WB_APP = paper(WB_APP_TITLE, WB_APP_ABSTRACT, "2022", 120, { relevance: 87 });

const RECENT_REVIEWS = [
  MECH_REVIEW,
  paper("CRISPR Cas9 genome editing: recent advances and future prospects",
    "This review covers recent advances in CRISPR Cas9 genome editing, including guide RNA design, screening applications, and delivery. Progress in understanding DNA cleavage by Cas9 and in repairing the resulting breaks is summarized for researchers entering the field.", "2024", 420),
  paper("CRISPR Cas systems in bacteria and their use in genome engineering",
    "Bacterial CRISPR Cas systems are reviewed as immune systems and as engineering tools. The diversity of Cas endonuclease families, guide processing, and target recognition across species is described, with attention to how recognition differs between systems.", "2022", 260),
  paper("Genome engineering with CRISPR Cas9 in mammalian cells: a review",
    "Genome engineering with CRISPR Cas9 in mammalian cells has matured rapidly. This review discusses cleavage efficiency, guide selection, and the cellular response to double strand breaks, and compares engineering outcomes across cell types.", "2023", 180),
  paper("Repair of CRISPR Cas9 induced DNA breaks: pathways and outcomes",
    "After Cas9 cleavage, cells repair double strand breaks by competing pathways. This review compares the repair outcomes reported across studies and the factors that shift the balance between them, including cell cycle stage and template availability for repair synthesis.", "2024", 150),
];

const Q_CRISPR = "how does crispr cas9 actually cut dna";
const Q_PCR = "how does pcr amplify dna";
const Q_WB = "how does a western blot detect proteins";
// The brief names the block opening with an em dash. The
// shipped prompt de dashes it (the standing no dashes rule),
// so the opening ships as "MECHANISM QUESTION . READ THIS
// FIRST." — the assertion accepts either separator and pins
// the words, which are the contract.
const MECHANISM_BLOCK_RE = /MECHANISM QUESTION\s*[—.\-]\s*READ THIS FIRST\./;
const bodyHasMechanismBlock = (body) => MECHANISM_BLOCK_RE.test(body || "");

// ═══════════════════════════════════════════════════════════════
group("Group 1 — the mechanism shape detector");

await test("mechanism shapes are detected", () => {
  assert.equal(typeof isMechanismShapeQuery, "function", "isMechanismShapeQuery is not exported");
  for (const q of [
    "how does crispr cas9 actually cut dna",
    "how does pcr amplify dna",
    "how does a western blot detect proteins",
    "how does the heart pump blood",
    "mechanism of dna replication",
  ]) {
    assert.equal(isMechanismShapeQuery(q), true, `not a mechanism shape: ${q}`);
  }
});

await test("ethics, delivery outcome, and measurement shapes are not mechanism shapes", () => {
  for (const q of [
    "what are the ethics of crispr gene editing",
    "does crispr delivery work in patients",
    "how is manganese peroxidase activity measured",
  ]) {
    assert.equal(isMechanismShapeQuery(q), false, `wrongly a mechanism shape: ${q}`);
  }
});

await test("the western blot question is both shapes, the CRISPR question is mechanism only", () => {
  assert.equal(isMechanismShapeQuery(Q_WB), true, "the western blot question lost its mechanism shape");
  assert.equal(detectMeasurementIntent(Q_WB), true, "the western blot question lost its measurement intent");
  assert.equal(isMechanismShapeQuery(Q_CRISPR), true, "the CRISPR question lost its mechanism shape");
  assert.equal(detectMeasurementIntent(Q_CRISPR), false, "the CRISPR cutting question reads as a measurement question");
});

// ═══════════════════════════════════════════════════════════════
group("Group 2 — mechanism tiers, application only, foundational primaries");

await test("the Jinek class primary is tier 2 and a foundational primary against recent reviews", () => {
  assert.equal(paperMechanismTier(JINEK), 2, "the endonuclease title does not earn tier 2");
  const pool = [JINEK, ...RECENT_REVIEWS];
  const stats = foundationalPoolStats(pool);
  assert.ok(stats && typeof stats.medianCitations === "number", "foundationalPoolStats carries no medianCitations");
  assert.ok(typeof stats.earlyYearCutoff === "number", "foundationalPoolStats carries no earlyYearCutoff");
  assert.equal(paperIsFoundationalPrimary(JINEK, stats), true,
    "the 2012 primary with 9500 citations is not a foundational primary against its pool: " + JSON.stringify(stats));
  assert.equal(paperIsFoundationalPrimary(LNP, stats), false, "the 2024 delivery paper reads as a foundational primary");
});

await test("the lipid nanoparticle delivery paper is application only", () => {
  assert.equal(paperMechanismTier(LNP), 0, "the delivery abstract earns a mechanism tier");
  assert.equal(paperApplicationOnly(LNP), true, "the delivery paper is not application only");
});

await test("a recent mechanism review is not barred, and a delivery paper with two mechanism words is not application only", () => {
  assert.ok(paperMechanismTier(MECH_REVIEW) > 0, "the mechanism review earns no tier");
  assert.equal(paperApplicationOnly(MECH_REVIEW), false, "the mechanism review reads as application only");
  assert.equal(paperMechanismTier(DELIVERY_MECH2), 1,
    "two distinct mechanism words in the abstract (binding, membrane) do not earn tier 1");
  assert.equal(paperApplicationOnly(DELIVERY_MECH2), false,
    "a delivery paper engaging two mechanism words is still application only");
});

// PIN UPDATED (2026-10-21, search diagnosis): the cost rises
// from 5 to 6 because the method shape's lane gains a new sixth
// call, a Crossref leg carrying the determination vocabulary to
// the one index that holds the dedicated method papers. No
// existing leg changed price; a new leg was added and priced.
await test("the foundational lane cost is 6", () => {
  assert.equal(SUBREQUEST_FOUNDATIONAL_LANE_COST, 6,
    `SUBREQUEST_FOUNDATIONAL_LANE_COST is ${SUBREQUEST_FOUNDATIONAL_LANE_COST}`);
});

// ═══════════════════════════════════════════════════════════════
group("Group 3 — the citation gate bars application papers on mechanism shapes only");

const GATE_CASES = [
  { q: Q_CRISPR, primary: JINEK, app: LNP, label: "CRISPR" },
  { q: Q_PCR, primary: PCR_PRIMARY, app: PCR_APP, label: "PCR" },
  { q: Q_WB, primary: WB_PRIMARY, app: WB_APP, label: "western blot" },
];
for (const c of GATE_CASES) {
  await test(`${c.label}: the primary clears and the application paper is barred, at the gate and at citability`, () => {
    const dyn = dynFor(c.q);
    const std = citationGateStandard(c.q, dyn);
    assert.equal(std.mechanismShape, true, `the gate standard carries no mechanismShape for: ${c.q}`);
    assert.equal(paperClearsCitationGate(c.primary, std), true,
      `${c.label} primary does not clear its own mechanism gate: ${c.primary.title}`);
    assert.equal(paperClearsCitationGate(c.app, std), false,
      `${c.label} application paper clears a mechanism gate it should be barred from: ${c.app.title}`);
    const pool = [c.primary, c.app];
    const ctx = conceptGateContext(pool, c.q, dyn);
    assert.equal(paperIsCitable(c.primary, 1, ctx), true, `${c.label} primary is not citable`);
    assert.equal(paperIsCitable(c.app, 2, ctx), false, `${c.label} application paper is citable on a mechanism question`);
  });
}

await test("the bar is shape scoped: the CRISPR delivery paper clears on a delivery question", () => {
  const q = "how is crispr delivered into cells";
  const dyn = dynFor(q);
  const std = citationGateStandard(q, dyn);
  assert.notEqual(std.mechanismShape, true, "the delivery question reads as a mechanism shape");
  assert.equal(paperClearsCitationGate(LNP, std), true,
    "the delivery paper is barred on a delivery question, so the bar is not shape scoped");
  const ctx = conceptGateContext([LNP], q, dyn);
  assert.equal(paperIsCitable(LNP, 1, ctx), true, "the delivery paper is not citable on its own question");
});

// ═══════════════════════════════════════════════════════════════
group("Group 4 — ordering pulls foundational primaries into the shelf, first");

await test("orderShelfForMechanism puts the primary first, size unchanged, others unmoved", () => {
  // A shelf of recent reviews that are not themselves
  // foundational primaries: clinical and governance reviews
  // whose abstracts carry no mechanism vocabulary at all.
  const shelf = [
    paper("CRISPR genome editing in clinical trials: outcomes and safety",
      "Clinical trials of CRISPR genome editing for blood disorders have reported their first outcome data. Patients treated in these trials showed durable editing in blood cells, manageable safety profiles, and therapeutic benefit that persisted at two years of follow up. Regulatory review of further trials is ongoing.", "2024", 300),
    paper("Ethical and regulatory perspectives on human genome editing",
      "Human genome editing raises ethical questions that regulators in many countries are now addressing. This review surveys consent frameworks, governance proposals, and public attitudes toward clinical use of editing, and compares national rules for embryo research and for somatic therapies in patients.", "2023", 200),
    paper("CRISPR therapies for blood disorders: trial results and outlook",
      "Therapies using CRISPR editing for sickle cell disease and beta thalassemia have moved from trials toward approval. This review summarizes patient outcomes, durability of benefit, adverse events, and the manufacturing and cost questions that will decide how widely these therapies reach patients in routine care.", "2024", 260),
    paper("Delivery outcomes for genome editing in large animal models",
      "Large animal studies of genome editing delivery report outcomes in pigs and dogs treated for inherited disease. Efficacy, tolerability, and durability of editing in target organs are compared across studies, with attention to dose, repeat administration, and readiness for first clinical trials in patients.", "2023", 140),
  ];
  const gatedPool = [...shelf, JINEK];
  const out = orderShelfForMechanism(shelf, gatedPool);
  assert.equal(out.length, shelf.length, "the shelf size changed");
  assert.equal(out[0].title, JINEK_TITLE, "the foundational primary is not first in the shelf");
  assert.ok(out.some((p) => p.title === JINEK_TITLE), "the primary never entered the shelf");
  const rest = out.slice(1).map((p) => p.title);
  assert.deepEqual(rest, shelf.slice(0, shelf.length - 1).map((p) => p.title),
    "non primary papers were reordered or the wrong tail was replaced: " + rest.join(" | "));
});

// ═══════════════════════════════════════════════════════════════
// Handler fixtures: Europe PMC rows for the pools above.
// ═══════════════════════════════════════════════════════════════

const CRISPR_MAIN_EPMC = [
  epmc9("rev1", RECENT_REVIEWS[1].title, RECENT_REVIEWS[1].abstract, 420, "2024"),
  epmc9("rev2", RECENT_REVIEWS[2].title, RECENT_REVIEWS[2].abstract, 260, "2022"),
  epmc9("lnp", LNP_TITLE, LNP_ABSTRACT, 210, "2024"),
  epmc9("rev3", RECENT_REVIEWS[3].title, RECENT_REVIEWS[3].abstract, 180, "2023"),
];
const JINEK_EPMC = epmc9("jinek", JINEK_TITLE, JINEK_ABSTRACT, 9500, "2012");
const JINEK_OA = {
  title: JINEK_TITLE,
  doi: "https://doi.org/10.1000/w9-jinek",
  publication_year: 2012,
  cited_by_count: 9500,
  authorships: [{ author: { display_name: "Jinek M" } }],
  primary_location: { source: { display_name: "Science" }, landing_page_url: "https://example.org/jinek" },
  abstract_inverted_index: inverted(JINEK_ABSTRACT),
  type: "article",
};
const JINEK_S2 = {
  title: JINEK_TITLE,
  abstract: JINEK_ABSTRACT,
  year: 2012,
  citationCount: 9500,
  authors: [{ name: "Jinek M" }],
  venue: "Science",
  externalIds: { DOI: "10.1000/w9-jinek" },
};
const CRISPR_ANSWER = "CRISPR Cas9 cuts DNA when a guide RNA leads the Cas9 protein to a matching DNA sequence and Cas9 cleaves both strands of the DNA, making a double strand break at that spot. [1][2]\n\n**How the cut happens:**\n\n- **Guided targeting:** the guide RNA recognizes the target DNA next to a short motif, positioning the Cas9 endonuclease for cleavage of the DNA, and recent reviews of CRISPR Cas9 genome editing describe the same guided targeting step [1][2].\n- **Two strand cuts:** the nuclease domains of Cas9 each cleave one strand of the DNA, so the break goes through both strands, and the cell then repairs the broken DNA, which is where the edit becomes permanent [1][2].\n- **Why it is precise:** because the guide RNA is what recognizes the target, changing the guide changes where Cas9 cuts the DNA, a point the primary description of the system and the later reviews both make [1][2].";

function primeCrisprLane() {
  scenPapers = CRISPR_MAIN_EPMC;
  scenLaneEpmc = [JINEK_EPMC];
  scenLaneOpenAlex = [JINEK_OA];
  scenLaneS2 = [JINEK_S2];
  scenAnswer = CRISPR_ANSWER;
}
const laneFired = (fetchLog) => fetchLog.some((f) =>
  decoded(f.url).includes("cleavage") &&
  (f.url.includes("ebi.ac.uk") || f.url.includes("api.openalex.org") || f.url.includes("api.semanticscholar.org")));

// ═══════════════════════════════════════════════════════════════
group("Group 5 — handler: the foundational lane delivers the primary into the cited set");

await test("the lane fires, the primary is cited, the application paper is not, and the prompt carries the mechanism block", async () => {
  primeCrisprLane();
  const { data, fetchLog } = await runScenario(Q_CRISPR);
  assert.ok(laneFired(fetchLog), "no foundational lane fetch fired (no cleavage query in the fetch log)");
  const titles = (data.sources || []).map((s) => s.title);
  assert.ok(titles.some((t) => t === JINEK_TITLE),
    "the Jinek class primary is not in the shipped cited set: " + titles.join(" | "));
  assert.ok(!titles.some((t) => t === LNP_TITLE),
    "the lipid nanoparticle paper is in the cited set on a mechanism question: " + titles.join(" | "));
  assert.ok(fetchLog.some((f) => bodyHasMechanismBlock(f.body)),
    "the synthesis request body carries no mechanism block");
  assert.ok(data._ledger, "the response carries no ledger");
  assert.ok(data._ledger.used <= 50, `the ledger overspent: used ${data._ledger.used}`);
  assert.equal(data._ledger.used + data._ledger.remaining, data._ledger.limit,
    "the ledger does not close: used + remaining is not the limit");
});

// ═══════════════════════════════════════════════════════════════
group("Group 6 — handler: no lane and no mechanism block on a non mechanism question");

await test("the ethics question fires no lane and carries no mechanism block", async () => {
  scenPapers = [
    epmc9("eth1", "Ethical issues in human germline genome editing",
      "Genome editing of human embryos raises ethical questions about consent, safety, and the welfare of future children. This paper reviews the ethics debate around germline editing with CRISPR, the governance proposals offered by national academies, and the case for a moratorium while societal consensus is sought.", 310, "2023"),
    epmc9("eth2", "Public engagement and governance of CRISPR gene editing",
      "Public engagement is central to legitimate governance of gene editing. This study reports deliberative forums on CRISPR ethics in three countries, finding broad public support for somatic therapy, deep unease about heritable editing, and a consistent demand for transparent governance of genome editing research.", 190, "2024"),
    epmc9("eth3", "The ethics of heritable genome editing: societal debate and policy",
      "Heritable genome editing forces questions no laboratory result can settle: who decides which traits are diseases, and who bears the risk. This analysis surveys the ethics literature on CRISPR germline editing, comparing governance frameworks and the arguments for prohibition, permission, and staged oversight.", 150, "2022"),
  ];
  scenLaneEpmc = [JINEK_EPMC];
  scenLaneOpenAlex = [JINEK_OA];
  scenLaneS2 = [JINEK_S2];
  scenAnswer = "Editing human embryos raises ethical questions that the science alone cannot settle, and public deliberation has become part of the governance debate. [1][2]\n\n**The main concerns:**\n\n- **Consent and safety:** germline editing affects future children who cannot consent, and the ethics literature treats that as a central objection to heritable genome editing [1][2].\n- **Governance:** national academies and public forums have proposed oversight and staged permission rather than an open door, reflecting broad unease about heritable editing [1][2].";
  const { fetchLog } = await runScenario("what are the ethics of crispr gene editing");
  assert.ok(!fetchLog.some((f) => decoded(f.url).includes("cleavage")),
    "a lane fetch fired on an ethics question");
  assert.ok(!fetchLog.some((f) => f.body.includes("MECHANISM QUESTION")),
    "the synthesis body carries a mechanism block on an ethics question");
});

// ═══════════════════════════════════════════════════════════════
group("Group 7 — the ledger under pressure: the lane is funded before clause fanouts");

await test("capped mechanism run: the lane fired and the refusals landed on the tail", async () => {
  primeCrisprLane();
  const { data, fetchLog } = await runScenario(Q_CRISPR, { settings: { answerLength: "long" } });
  assert.ok(laneFired(fetchLog), "the lane did not fire on the capped run");
  assert.ok(data._ledger && typeof data._ledger.retrievalRefused === "number",
    "the response carries no ledger refusals to judge the trim by");
  assert.ok(data._ledger.retrievalRefused >= 1,
    "no retrieval refusals on the capped run, so nothing proves the tail was trimmed instead of the lane: " + data._ledger.retrievalRefused);
  assert.ok(data._ledger.used <= 50, `the capped run overspent: used ${data._ledger.used}`);
});

await test("the trade: a compound mechanism question funds the lane and no clause fanout reaches the tail sources twice", async () => {
  scenPapers = [
    ...CRISPR_MAIN_EPMC,
    epmc9("pcrprim", PCR_PRIMARY_TITLE, PCR_PRIMARY_ABSTRACT, 12000, "1987"),
    epmc9("pcrrev", "Polymerase chain reaction methods and applications: a review",
      "The polymerase chain reaction amplifies DNA through cycles of denaturation, primer annealing, and extension. This review covers PCR variants, primer design, polymerase choice, and the template requirements for reliable amplification of DNA targets.", 800, "2023"),
    epmc9("pcrmed", "PCR diagnostics for infectious disease: methods and practice",
      "PCR based diagnostics identify pathogen DNA in clinical samples. This review describes amplification protocols, primer selection, and controls for DNA amplification assays used in hospital laboratories, and compares turnaround with culture methods.", 350, "2022"),
    epmc9("crisprscreen", "CRISPR Cas9 screening in mammalian cells: a review of pooled screens",
      "Pooled CRISPR Cas9 screens use guide libraries to cut DNA across the genome and read out cell survival. This review covers guide library design, cleavage based selection, and analysis of screening hits in mammalian cells.", 220, "2024"),
  ];
  scenLaneEpmc = [JINEK_EPMC];
  scenLaneOpenAlex = [JINEK_OA];
  scenLaneS2 = [JINEK_S2];
  scenAnswer = "CRISPR Cas9 cuts DNA at a guide chosen site, and PCR copies DNA by repeated amplification cycles, so the two mechanisms are a targeted cut and a targeted copying reaction. [1][2]\n\n**The two mechanisms:**\n\n- **Cutting:** a guide RNA positions Cas9 on the target DNA and its nuclease domains cleave both strands of the DNA, producing a double strand break that the cell repairs [1][2].\n- **Copying:** PCR cycles of denaturation, primer annealing, and polymerase extension amplify the template DNA between the primers, doubling the target DNA each cycle until millions of copies exist [1][2].\n- **The shared idea:** both mechanisms get their specificity from a short nucleic acid, the guide RNA in one case and the two primers in the other, matching the DNA sequence of interest [1][2].";
  const { fetchLog } = await runScenario(
    "how does crispr cas9 cut dna and how does pcr amplify dna", { limit: 60 });
  assert.ok(laneFired(fetchLog), "the lane did not fire on the compound question");
  const arxivFetches = fetchLog.filter((f) => f.url.includes("export.arxiv.org")).length;
  assert.equal(arxivFetches, 1,
    `arXiv was searched ${arxivFetches} times, so more than one fanout round reached the tail sources (a clause fanout fired)`);
  const crossrefSearches = fetchLog.filter((f) => /api\.crossref\.org\/works\?/.test(f.url)).length;
  assert.equal(crossrefSearches, 1,
    `Crossref was searched ${crossrefSearches} times, so more than one fanout round reached the tail sources (a clause fanout fired)`);
});

// ═══════════════════════════════════════════════════════════════
group("Group 8 — the legal source lists tell the truth about the fanout");

await test("every fanout source is named in About and in the providers lists, and no refused source is named in either", () => {
  const legal = readFileSync(join(root, "src/legalContent.js"), "utf8");
  // (a) The About "The databases" list.
  const aboutMatch = legal.match(/"The databases", list: \[([^\]]*)\]/);
  assert.ok(aboutMatch, "the About databases list was not found in legalContent.js");
  const aboutText = [...aboutMatch[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join(" ").toLowerCase();
  assert.ok(aboutText.length > 0, "the About databases list is empty");
  // (b) Every string beginning "Scholarly data providers:".
  const providers = [...legal.matchAll(/"(Scholarly data providers:[^"]*)"/g)].map((m) => m[1]);
  assert.ok(providers.length >= 1, "no Scholarly data providers string was found in legalContent.js");

  // Explicit name map. Most fanout ids map to the product
  // name in functions/lib/product.js. Two ids are named
  // services whose legal names differ from a bare product
  // name, and the map spells those out:
  //   preprints is a named service, the Europe PMC preprint
  //     index, so its legal names are "preprint index",
  //     "preprint servers", and "medRxiv".
  //   pmcFullText is a named service, PMC full text, served
  //     through Europe PMC's BODY search (the fetcher
  //     queries ebi.ac.uk with a BODY: filter), so the About
  //     list must name "PMC full text" and the providers
  //     lists are covered by "Europe PMC".
  const LEGAL_NAMES = {
    europePMC: ["Europe PMC"],
    pubmed: ["PubMed"],
    openAlex: ["OpenAlex"],
    crossref: ["Crossref"],
    arxiv: ["arXiv"],
    semanticScholar: ["Semantic Scholar"],
    doaj: ["DOAJ"],
    biorxiv: ["bioRxiv"],
    plos: ["PLOS"],
    CORE: ["CORE"],
    BASE: ["BASE"],
    openAire: ["OpenAIRE"],
    preprints: ["preprint index", "preprint servers", "medRxiv"],
    pmcFullText: ["PMC full text"],
  };
  const providersNamesFor = (id) => (id === "pmcFullText" ? ["Europe PMC"] : LEGAL_NAMES[id]);
  const namedIn = (text, names) => names.some((n) => text.includes(n.toLowerCase()));

  for (const s of SCHOLARLY_SOURCES) {
    const names = LEGAL_NAMES[s.id];
    assert.ok(names, `no legal name mapping for fanout source ${s.id}: the map must be extended, not the source skipped`);
    assert.ok(namedIn(aboutText, names),
      `fanout source ${s.id} is not named in the About databases list (looked for: ${names.join(", ")})`);
    for (const p of providers) {
      assert.ok(namedIn(p.toLowerCase(), providersNamesFor(s.id)),
        `fanout source ${s.id} is not named in a providers list (looked for: ${providersNamesFor(s.id).join(", ")}): ${p.slice(0, 120)}`);
    }
  }

  // Refused sources, derived from BLOCKED_DOMAINS: a blocked
  // domain's service must not be advertised anywhere.
  const REFUSED_NAMES = {
    zenodo: "Zenodo",
    dryad: "Dryad",
    figshare: "Figshare",
    "osf.io": "OSF",
    "wwpdb.org": "PDB",
    wwpdb: "PDB",
    "clinicaltrials.gov": "ClinicalTrials.gov",
    "data.mendeley.com": "Mendeley",
  };
  assert.ok(Array.isArray(BLOCKED_DOMAINS) && BLOCKED_DOMAINS.length > 0, "BLOCKED_DOMAINS is not exported");
  for (const d of BLOCKED_DOMAINS) {
    const refused = REFUSED_NAMES[d];
    assert.ok(refused, `no refused name mapping for blocked domain ${d}: the map must be extended`);
    assert.ok(!aboutText.includes(refused.toLowerCase()),
      `refused source ${refused} (blocked domain ${d}) is named in the About databases list`);
    for (const p of providers) {
      assert.ok(!p.toLowerCase().includes(refused.toLowerCase()),
        `refused source ${refused} (blocked domain ${d}) is named in a providers list: ${p.slice(0, 120)}`);
    }
  }
});

// ═══════════════════════════════════════════════════════════════
group("Group 9 — the cache version pin");

await test("CACHE_SCHEMA_VERSION is v43 with a dated wave nine chain entry", () => {
  // PIN UPDATED (2026-10-14, wave ten): the version moved to
  // v44 (gate audit comparison admission, presented list
  // hygiene, solidity binding, bucket spread synthesis, and the
  // answer cache key finally derived from this constant). The
  // v43 chain entry must remain as history, and the key
  // derivation is pinned here so a future bump cannot silently
  // decouple from the key again.
  // PIN UPDATED (2026-10-14, wave eleven): the version moved
  // to v45 (the compound title clause for the presented list),
  // then to v46 by the same wave's live probe addendum (the
  // mechanism detector hears plain copying words). The v44
  // chain entry must likewise remain as history.
  // PIN UPDATED (2026-10-14, wave twelve): v47 — the claim
  // check counts only checked claims, dedupe folds richer
  // duplicate fields, the foundational lane sorts by
  // citations, the compound clause confirmation requires
  // topical company, and the single source retry extends to
  // every clean answer.
  // PIN UPDATED (2026-10-14, wave thirteen): v48 —
  // foundational primaries get presentation priority, the
  // title rule requires topical company for every sighting,
  // and the claim check records a named tier trace with a
  // fallback model attempt and literature claim selection.
  // PIN UPDATED (2026-10-14, wave fourteen): v49 — the
  // search record carries the foundational fate diagnostic,
  // and the LLM validation pass can no longer remove a gate
  // cleared foundational primary.
  // PIN UPDATED (2026-10-14, wave fifteen): v50 — the
  // foundational lane gains founding form legs over the
  // unexpanded system name, and the record gains the
  // foundational near miss section.
  const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
  // PIN UPDATED (2026-10-14, wave sixteen): v51, the serve
  // side honesty wave. The v50 entry stays as history above.
  // PIN UPDATED (2026-10-15, wave seventeen): v52, the
  // citation depth wave. The v51 entry stays as history above.
  assert.ok(src.includes("const CACHE_SCHEMA_VERSION = \"v52\""),
    "CACHE_SCHEMA_VERSION is not pinned to v52");
  const start = src.search(/\/\/ v43 \(/);
  assert.ok(start >= 0, "no dated v43 chain entry above the version constant");
  const entry = src.slice(start, start + 2500);
  assert.ok(/wave nine/i.test(entry), "the v43 chain entry does not mention wave nine");
  assert.ok(/\/\/ v44 \(2026-10-14, wave ten\)/.test(src), "the v44 chain entry is missing");
  assert.ok(/\/\/ v45 \(2026-10-14, wave eleven\)/.test(src), "the v45 chain entry is missing");
  assert.ok(/\/\/ v46 \(2026-10-14, wave eleven, live probe addendum\)/.test(src), "the v46 chain entry is missing");
  assert.ok(/\/\/ v47 \(2026-10-14, wave twelve\)/.test(src), "the v47 chain entry is missing");
  assert.ok(/\/\/ v48 \(2026-10-14, wave thirteen\)/.test(src), "the v48 chain entry is missing");
  assert.ok(/\/\/ v49 \(2026-10-14, wave fourteen\)/.test(src), "the v49 chain entry is missing");
  // PIN UPDATED (2026-10-16, finding 4): the key version now
  // appends answerSettingsKeyPart — the fold of the request
  // settings that change what answer is correct (mode, evidence
  // filter, stress filter and exclusion digest, scoped source
  // marker), empty for a default request so the default key is
  // unchanged. The derivation from CACHE_SCHEMA_VERSION plus the
  // depth, which this pin exists to protect, is unchanged.
  assert.ok(src.includes("const answerKeyVersion = CACHE_SCHEMA_VERSION + \"-\" + answerLength + answerSettingsKeyPart;"),
    "the answer cache key must derive from CACHE_SCHEMA_VERSION (wave ten)");
});

console.log(`\nsearch-wave-nine: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
