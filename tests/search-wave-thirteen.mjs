/**
 * Search wave thirteen (2026-10-14). Four brief items from the
 * parent's live probes on the wave twelve build (5615b75).
 *
 * Item 1 — foundational primaries must PRESENT, not just be
 * admitted. The live CRISPR run fired the foundational lane
 * (admitted 24) and presented 15 papers with the 2012 founding
 * paper nowhere among them: wave twelve fixed admission, but
 * the paper still lost the presentation ranking to recent
 * reviews. The fix works at the two presentation layers the
 * harness can bind: a gather level shelf rescue (a primary the
 * score sort strands below the shelf cut displaces the shelf's
 * lowest scored non primary, the title rescue's discipline),
 * and presented list priority (primaries iterate first in the
 * further reading tail and are judged there by the citation
 * gate standard itself — abstract aware — instead of the title
 * only rule a titleless founding paper cannot pass, with the
 * tail's score floor likewise replaced by that standard for
 * primaries). The handler's gathered pool in this harness tops
 * out around 35 papers against the live run's 72, and the live
 * validator is scripted permissive here, so the exact live
 * burial step is NOT reproducible offline — the suite header
 * says so plainly, the unit fixtures pin the mechanisms that
 * close each reproducible layer, and the handler fixture pins
 * the outcome (the founding paper in the presented list on a
 * crowded draw) against regression.
 *
 * Item 2 — presented tail gate asymmetry. The same live run
 * presented a vascular remodeling paper and an extrachromosomal
 * circular DNA drug resistance paper while the gates elsewhere
 * excluded on point work. On their published abstracts both
 * specimens fail every standard in the shipped code (verified
 * by unit probe against the deterministic, expansion derived,
 * and null lookups alike): their live admission is not
 * reproducible offline and is reported to the parent as such.
 * The reproducible asymmetry the fixtures close is the tail
 * title rule's company gap: wave twelve required topical
 * company only to CONFIRM a fused sighting, while a free
 * standing single concept sighting counted with no company at
 * all — the exact shape of the quantum dot LED paper still
 * standing in the wave twelve build's sky list (title's free
 * "Blue", abstract engaging blue alone). Now every sighting on
 * a multi concept question needs company: a second central
 * concept engaged anywhere, or the subject concept engaged in
 * the abstract. The LED fixture below is the discriminating
 * one (true before this wave, false after, verified against
 * the pre wave build); the two named specimens are pinned at
 * the unit and handler layers so no future path re admits them.
 *
 * Item 3 — claim check coverage when the fleet saturates.
 * Diagnosis, from the shipped record of the live sky run on
 * 5615b75: the fact check stage recorded ok null, ms 0,
 * "fact check did not run" on a run that was not degraded —
 * the stage never attempted, because that probe's request
 * carried no factCheck setting, and nothing in the record
 * could distinguish that cause from a spent budget or two
 * dead tiers (both tiers swallowed their errors in bare
 * catches). The fix: deepFactCheck records a trace of every
 * attempt with named outcomes (ok, no-binding, no-key, budget,
 * timeout, http-<status>, error, unparseable), the trace rides
 * the search record as factCheckTrace, the stage's skip reason
 * is built from the trace and from named non attempt causes,
 * and on the saturation signature (the validate model answers
 * HTTP 429) one more attempt fires on a second validate class
 * free model under the same ledger gate tier two uses — the
 * attempt replaces the failed tier two fetch one for one, and
 * the ledger's hard cap refuses ahead of the call, so the
 * invocation total can never pass 50.
 *
 * Item 4 — the checker must catch literature denying claims
 * (wave twelve item 6's leftover). The checker's prompt now
 * names claims that characterize the sources themselves as a
 * selection class, judged against what the cited sources
 * actually contain, and the checker's source block carries
 * fuller text (1000 characters) for the first eight sources
 * instead of cutting every abstract at 600. The handler
 * fixture is the a269429 sky shape: an answer whose short
 * answer denies an explanation its cited source contains is
 * caught, and the denying sentence does not survive. The
 * synthesis evidence block is deliberately unchanged: on the
 * measured run the cited source's abstract states the cause
 * in its opening sentences, so slice length did not form the
 * false impression — a synthesis overgeneralization did, and
 * catching synthesis claims is the checker's layer.
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 *
 * Run with: node tests/search-wave-thirteen.mjs
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
  factCheckSupport, factCheckTraceSummary,
  paperTitleEngagesConcepts, buildFurtherReadingTail,
  buildDeterministicFallbackGroups, buildDynLookup, centralContentTerms,
  questionCentralConcepts,
  foundationalPoolStats, paperIsFoundationalPrimary,
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

// ── Scenario runner (wave twelve pattern, extended: the deep
// fact check's per model outcomes can be scripted — the primary
// validate model rate limited with the fallback answering, or
// every fact check call rate limited) ────────────────────────
let scenPapers = [];
let scenAnswer = "";
let scenRetryAnswer = null;
let scenFactCheck = null;
let scenFactCheckMode = "ok"; // "ok" | "429-primary" | "429-all"
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
    if (u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("openrouter.ai")) {
      if (body.includes("rigorous scientific fact-checker")) {
        if (scenFactCheckMode === "429-all") {
          return new Response("rate limited", { status: 429 });
        }
        if (scenFactCheckMode === "429-primary" && body.includes("gemma-4-31b-it")) {
          return new Response("rate limited", { status: 429 });
        }
        return chatRes(scenFactCheck || "no verdict available");
      }
      if (body.includes("Cite at least two different sources inline")) {
        return chatRes(scenRetryAnswer || scenAnswer);
      }
      if (body.includes("literature search specialist")) {
        return chatRes("I cannot group those terms today.");
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));
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
      OPENROUTER_KEY: "w13-test-openrouter-key-123456",
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

const epmc13 = (id, title, abstractText, citedByCount, pubYear, journalTitle) => ({
  title,
  doi: "10.1000/w13-" + id,
  pubYear: String(pubYear),
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: journalTitle || "Journal of Recorded Studies",
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

// ═══════════════════════════════════════════════════════════════
group("Item 1 — foundational primaries get presentation priority");

await test("the tail helper orders primaries first and the primary test replaces its score floor", () => {
  const ordinary1 = { title: "CRISPR Cas9 genome editing: recent advances", abstract: "A review of CRISPR Cas9 genome editing advances.", year: "2025", citations: 300, doi: "10.1000/w13-t1", url: "https://doi.org/10.1000/w13-t1", relevance: 82 };
  const primary = { title: "A programmable dual-RNA-guided protein in adaptive bacterial immunity", abstract: "Cas9 is a dual RNA guided DNA endonuclease that cleaves target DNA.", year: "2012", citations: 9500, doi: "10.1000/w13-t2", url: "https://doi.org/10.1000/w13-t2", relevance: 20, _testPrimary: true };
  const ordinary2 = { title: "Guide RNA design for CRISPR Cas9 cleavage", abstract: "Guide RNA design rules for CRISPR Cas9 cleavage efficiency.", year: "2024", citations: 200, doi: "10.1000/w13-t3", url: "https://doi.org/10.1000/w13-t3", relevance: 74 };
  const shelf = [ordinary1, primary, ordinary2];
  const untested = buildFurtherReadingTail(shelf, []);
  assert.ok(!untested.includes(primary),
    "without a primary test the sub floor primary still enters the tail — the floor substitution is not what changed");
  const tested = buildFurtherReadingTail(shelf, [], (p) => !!p._testPrimary);
  assert.equal(tested[0], primary,
    "the primary is not first in the tail: " + tested.map((p) => p.title).join(" | "));
  assert.ok(tested.includes(ordinary1) && tested.includes(ordinary2),
    "ordinary members lost their tail places to the reordering");
});

await test("the wave twelve burden guard is not a primary, and a first description is", () => {
  const burden = {
    title: "Global burden of bacterial antimicrobial resistance in 2019: a systematic analysis",
    abstract: "Antimicrobial resistance is a leading global health threat. We estimated deaths attributable to bacterial antimicrobial resistance across 204 countries in 2019 using statistical modelling of surveillance data, hospital records, and published studies. Resistance was associated with millions of deaths, making it a leading cause of mortality worldwide.",
    year: "2022", citations: 21000, journal: "Lancet",
  };
  const firstDescription = {
    title: "A programmable dual-RNA-guided protein in adaptive bacterial immunity",
    abstract: "Clustered regularly interspaced short palindromic repeats (CRISPR) and CRISPR associated (Cas) proteins form an adaptive immune system in bacteria and archaea. Here we show that Cas9 is a dual RNA guided DNA endonuclease. Cas9 is guided by a crRNA and a tracrRNA to a target DNA sequence, where its two nuclease domains cleave each strand of the DNA and generate a double strand break.",
    year: "2012", citations: 9500, journal: "Science", _foundationalLane: true,
  };
  const recentReview = {
    title: "CRISPR Cas9 genome editing: recent advances and future prospects",
    abstract: "This review covers recent advances in CRISPR Cas9 genome editing, including guide RNA design, screening applications, and delivery.",
    year: "2024", citations: 420, journal: "Nature",
  };
  const stats = foundationalPoolStats([burden, firstDescription, recentReview]);
  assert.equal(paperIsFoundationalPrimary(burden, stats), false,
    "a huge citation count with no mechanism engagement became a primary — the guard fell");
  assert.equal(paperIsFoundationalPrimary(firstDescription, stats), true,
    "the early, cited, mechanism engaged first description is not a primary under its own pool stats");
});

await test("the shelf rescue and the tail gate substitution are wired in the handler", () => {
  assert.ok(src.includes("FOUNDATIONAL PRIMARY SHELF RESCUE"),
    "the gather level shelf rescue for stranded primaries is missing");
  assert.ok(src.includes("diag.foundationalRescued"),
    "the shelf rescue does not record itself in the retrieval diag");
  assert.ok(src.includes("paperClearsCitationGate(p, tailGateStandard)"),
    "the tail does not judge primaries by the citation gate standard");
});

// ═══════════════════════════════════════════════════════════════
group("Item 2 — the presented tail requires topical company for every sighting");

const SKY_Q = "why is the sky blue";
const LED_SPECIMEN = {
  title: "Blue light-emitting diodes based on colloidal quantum dots with reduced surface-bulk defect states",
  abstract: "Colloidal quantum dot light emitting diodes emit blue light with high efficiency. Surface passivation reduces defect states and improves the operational stability of the blue emission in electroluminescent devices driven at high brightness.",
};
const ITGA2_SPECIMEN = {
  title: "Enhancer-Associated LncRNA-ITGA2 Promotes Vascular Remodeling Through ITGA2",
  abstract: "Vascular remodeling contributes to pulmonary arterial hypertension. A long noncoding RNA transcribed from an enhancer near the integrin alpha 2 gene is induced in pulmonary artery smooth muscle cells by platelet derived growth factor BB and promotes their proliferation and migration. The RNA binds the DNA binding protein NONO and increases histone acetylation at the integrin alpha 2 promoter. Knockout of the RNA in mice attenuates vascular remodeling and right ventricular hypertrophy after hypoxia.",
};
const ECCDNA_SPECIMEN = {
  title: "Enhancer Extrachromosomal Circular DNA ANKRD28 Elicits Drug Resistance via POU2F2-Mediated Transcriptional Network in Multiple Myeloma",
  abstract: "Extrachromosomal circular DNA is abundant in cancer cells and can carry enhancers that rewire transcription. A circular DNA element from the ANKRD28 locus is enriched in drug resistant multiple myeloma cells and raises expression of neighboring genes through the transcription factor POU2F2. Depleting the circular DNA restores drug sensitivity, identifying enhancer carrying circular DNA as a driver of resistance in this blood cancer.",
};

await test("the LED specimen's lone free standing concept no longer engages the sky question", () => {
  const dyn = dynFor(SKY_Q);
  const concepts = questionCentralConcepts(SKY_Q, dyn);
  assert.ok(concepts.length >= 2,
    "the fixture's precondition failed: the sky question resolves fewer than two central concepts");
  assert.equal(paperTitleEngagesConcepts(LED_SPECIMEN, SKY_Q, dyn), false,
    "a device paper engaging only the color concept, in title and abstract alike, still passes the presented list's title rule");
});

await test("genuine sky papers keep their title engagement under the company rule", () => {
  const dyn = dynFor(SKY_Q);
  const control = {
    title: "Rayleigh scattering and the color of the sky",
    abstract: "The blue color of the sky is explained by Rayleigh scattering. Air molecules scatter short wavelength blue light far more strongly than longer wavelengths, so scattered sunlight reaches the eye from every direction.",
  };
  assert.equal(paperTitleEngagesConcepts(control, SKY_Q, dyn), true,
    "a paper engaging both of the question's concepts lost its title engagement");
  const subjectInAbstract = {
    title: "The daytime sky: brightness measurements across the solar day",
    abstract: "Measurements of sky brightness across the solar day show how air molecules scatter sunlight, with the strongest scattering near the zenith at noon and a pale band of scattered light near the horizon at dusk.",
  };
  assert.equal(paperTitleEngagesConcepts(subjectInAbstract, SKY_Q, dyn), true,
    "a paper about the subject itself, title naming one facet and abstract on the subject, lost its title engagement");
});

await test("the two named CRISPR specimens do not engage the CRISPR question at the title rule", () => {
  const q = "how does crispr cas9 cut dna";
  const dyn = dynFor(q);
  assert.equal(paperTitleEngagesConcepts(ITGA2_SPECIMEN, q, dyn), false,
    "the vascular remodeling specimen engages the CRISPR question's title rule");
  assert.equal(paperTitleEngagesConcepts(ECCDNA_SPECIMEN, q, dyn), false,
    "the extrachromosomal circular DNA specimen engages the CRISPR question's title rule");
});

// ═══════════════════════════════════════════════════════════════
group("Items 1 and 2 — handler: the crowded CRISPR draw");

const J2_TITLE = "A programmable dual-RNA-guided protein in adaptive bacterial immunity";
const J2_ABSTRACT = "Clustered regularly interspaced short palindromic repeats (CRISPR) and CRISPR associated (Cas) proteins form an adaptive immune system in bacteria and archaea. Here we show that Cas9 is a dual RNA guided DNA endonuclease. Cas9 is guided by a crRNA and a tracrRNA to a target DNA sequence, where its two nuclease domains cleave each strand of the DNA and generate a double strand break. Guide RNA recognition of the target, together with the requirement for a protospacer adjacent motif, determines where cleavage occurs. These findings establish the mechanism by which the CRISPR Cas system recognizes and cuts foreign DNA, and show that the guide can be reprogrammed to direct cleavage to new targets.";
const J2_DOI = "10.1000/w13-jinek";

const CRISPR_POOL_13 = [
  ["r1", "CRISPR Cas9 DNA cleavage: how the guide RNA directs Cas9 to cut DNA", "How CRISPR Cas9 cuts DNA is reviewed step by step. The guide RNA recognizes the target DNA sequence next to a protospacer adjacent motif, Cas9 unwinds the DNA, and its two nuclease domains cleave the two DNA strands three bases upstream. Structures of Cas9 bound to guide RNA and target DNA show the conformational checkpoints that license DNA cleavage, and repair of the cut DNA completes the edit.", 2600, 2025, "Nature"],
  ["r2", "Cas9 nuclease mechanism: guide recognition, DNA unwinding and strand cleavage", "The Cas9 nuclease mechanism is dissected here. Guide RNA loading rearranges Cas9 into a DNA surveillance complex; target DNA binding triggers unwinding, R loop formation, and cleavage of both DNA strands by the HNH and RuvC nuclease domains. Kinetic measurements of DNA cutting and structural snapshots of the cleavage state explain how CRISPR Cas9 achieves precise DNA cleavage.", 2100, 2024, "Science"],
  ["r3", "CRISPR Cas9 genome editing: the DNA cut and what happens after cleavage", "CRISPR Cas9 genome editing begins with a DNA cut. This review follows the cleavage event: guide RNA directed Cas9 binding to DNA, double strand DNA cleavage, and the repair pathways that resolve the break. It compares cleavage efficiency across guide designs and DNA contexts and summarizes how the DNA cut is converted into a permanent genome edit in cells.", 1900, 2025, "Cell"],
  ["r4", "Structural basis of CRISPR Cas9 guide RNA recognition and DNA cleavage", "Crystal and cryo electron microscopy structures reveal how CRISPR Cas9 recognizes guide RNA and cleaves DNA. The guide RNA scaffold docks into Cas9, the seed region interrogates DNA for a matching protospacer, and DNA unwinding positions both strands for cleavage by the two nuclease domains. The structural basis of DNA cleavage specificity is reviewed in detail.", 1750, 2024, "Nature"],
  ["r5", "How CRISPR Cas9 cuts DNA: conformational checkpoints before cleavage", "How does CRISPR Cas9 cut DNA without cutting the wrong DNA? This review describes the checkpoints: guide RNA and Cas9 first survey DNA for the protospacer adjacent motif, then DNA unwinding and guide pairing proceed stepwise, and only a fully paired guide licenses the nuclease domains to cleave both DNA strands. Mismatched DNA stalls before cleavage, which explains specificity.", 1500, 2026, "Molecular Cell"],
  ["r6", "Guide RNA design for efficient CRISPR Cas9 DNA cleavage in human cells", "Guide RNA design determines how efficiently CRISPR Cas9 cleaves DNA in human cells. Sequence features of the guide, DNA accessibility, and Cas9 delivery are compared across large cleavage datasets. Rules are derived for choosing guides that maximize DNA cutting at the intended site while minimizing cleavage at similar DNA sequences elsewhere in the genome.", 1400, 2025, "Nature Biotechnology"],
  ["r7", "DNA cleavage by CRISPR Cas9: single molecule measurements of cutting kinetics", "Single molecule measurements watch CRISPR Cas9 cut DNA in real time. Cas9 bound to guide RNA searches DNA, pauses at protospacer adjacent motifs, unwinds the DNA duplex, and cleaves the two strands in a defined order. Dwell times at each step are reported, giving a kinetic mechanism for DNA cleavage by the CRISPR Cas9 nuclease.", 1200, 2024, "Science"],
  ["r8", "CRISPR Cas9 DNA repair outcomes: how cells fix the Cas9 cut", "After CRISPR Cas9 cleaves DNA, the cell repairs the double strand break. This review catalogs repair outcomes at Cas9 cut sites across cell types: small insertions and deletions, large deletions, and templated repair using a supplied DNA donor. Predicting which outcome follows DNA cleavage is now possible from the guide RNA sequence and the DNA around the cut.", 1100, 2025, "Nature"],
  ["r9", "Cas9 and Cas12a DNA cleavage compared: two CRISPR nucleases that cut DNA differently", "Cas9 and Cas12a both cleave DNA under guide RNA direction, but their DNA cutting differs. Cas9 creates a blunt DNA cut with two nuclease domains, while Cas12a processes its own guide and cuts DNA with a single domain, leaving staggered ends. The review compares guide requirements, DNA target recognition, and cleavage products of the two CRISPR systems.", 1000, 2024, "Cell"],
  ["r10", "CRISPR Cas9 cleavage specificity: off target DNA cutting and how to avoid it", "CRISPR Cas9 can cleave DNA at sites that resemble the guide RNA target. This review measures off target DNA cleavage genome wide, explains which guide and DNA features permit cleavage at mismatched sites, and evaluates engineered Cas9 variants and guide designs that suppress off target DNA cutting while keeping on target cleavage strong.", 950, 2026, "Nature Reviews Genetics"],
  ["r11", "The CRISPR Cas9 cut in plants: DNA cleavage and repair in crop genomes", "In plant cells, CRISPR Cas9 DNA cleavage follows the same guide RNA mechanism: Cas9 binds the target DNA, cleaves both strands, and repair creates the edit. This review covers DNA cleavage efficiency in crop species, guide RNA expression, and how DNA repair outcomes differ in plants, with protocols for measuring cleavage at target DNA sites.", 800, 2023, "Nature Plants"],
  ["r12", "CRISPR Cas9 DNA cleavage in bacteria: the original immune cut", "In bacteria, CRISPR Cas9 cleaves invading DNA as an immune defense. The guide RNA, transcribed from the CRISPR array and matured with a second RNA, directs Cas9 to cleave matching foreign DNA. This review reconstructs how DNA recognition and cleavage work in the native system, including guide maturation and the DNA cleavage step that destroys the invader genome.", 760, 2023, "Science"],
  ["r13", "Measuring CRISPR Cas9 DNA cleavage: assays for the cut", "Assays that measure CRISPR Cas9 DNA cleavage are compared: in vitro cleavage of labeled DNA substrates by Cas9 and guide RNA, sequencing of repair outcomes at cut DNA sites in cells, and genome wide capture of DNA breaks. Sensitivity and bias of each cleavage assay are quantified so researchers can choose how to verify that Cas9 cut the intended DNA.", 700, 2025, "Nature Methods"],
  ["r14", "CRISPR Cas9 guide RNA: from bacterial immunity to the DNA cutting tool", "The guide RNA is what makes CRISPR Cas9 programmable. This review traces how the dual guide of the bacterial system was simplified into a single guide RNA that directs Cas9 to cleave any chosen DNA sequence, and how guide chemistry and Cas9 engineering since then have sharpened DNA cleavage for genome editing applications.", 680, 2024, "Nature"],
  ["r15", "CRISPR Cas9 DNA cleavage atlas: guide by guide cutting maps", "A cleavage atlas maps CRISPR Cas9 DNA cutting at thousands of guide targets. For each guide RNA, DNA cleavage position, cutting rate, and repair outcome are recorded, showing how guide sequence and DNA context govern where and how fast Cas9 cleaves DNA.", 640, 2025, "Nature"],
  ["r16", "How Cas9 finds its DNA target: guide RNA search and cleavage activation", "How Cas9 finds its DNA target is answered with imaging and biochemistry. The Cas9 guide RNA complex samples DNA at protospacer adjacent motifs, unwinds short DNA stretches to test guide pairing, and activates DNA cleavage only on a full match, explaining fast search with accurate cutting.", 620, 2024, "Cell"],
].map(([id, t, a, c, y, j]) => epmc13(id, t, a, c, y, j));
CRISPR_POOL_13.push(epmc13("itga2", ITGA2_SPECIMEN.title, ITGA2_SPECIMEN.abstract, 12, 2025, "Circulation Research"));
CRISPR_POOL_13.push(epmc13("eccdna", ECCDNA_SPECIMEN.title, ECCDNA_SPECIMEN.abstract, 8, 2025, "Advanced Science"));

const LANE_EPMC_13 = [{
  title: J2_TITLE, doi: J2_DOI, pubYear: "2012", citedByCount: null,
  authorString: "Jinek M, Chylinski K, Fonfara I, Hauer M, Doudna JA, Charpentier E",
  journalTitle: "Science", abstractText: "",
}];
const LANE_OA_13 = [{
  title: J2_TITLE, doi: "https://doi.org/" + J2_DOI, publication_year: 2012,
  cited_by_count: 9500,
  authorships: [{ author: { display_name: "Jinek M" } }],
  primary_location: { source: { display_name: "Science" }, landing_page_url: "https://example.org/j2" },
  abstract_inverted_index: inverted(J2_ABSTRACT), type: "article",
}];
const LANE_S2_13 = [{
  title: J2_TITLE, abstract: J2_ABSTRACT, year: 2012, citationCount: 9500,
  authors: [{ name: "Jinek M" }], venue: "Science", externalIds: { DOI: J2_DOI },
}];
const CRISPR_ANSWER_13 = "CRISPR Cas9 cuts DNA when a guide RNA leads the Cas9 protein to a matching DNA sequence and Cas9 cleaves both strands of the DNA, making a double strand break at that spot. [1][2]\n\n**How the cut happens:**\n\n- **Guided targeting:** the guide RNA recognizes the target DNA next to a short motif, positioning the Cas9 endonuclease for cleavage of the DNA, and recent reviews of CRISPR Cas9 genome editing describe the same guided targeting step [1][2].\n- **Two strand cuts:** the nuclease domains of Cas9 each cleave one strand of the DNA, so the break goes through both strands, and the cell then repairs the broken DNA, which is where the edit becomes permanent [1][2].\n- **Why it is precise:** because the guide RNA is what recognizes the target, changing the guide changes where Cas9 cuts the DNA, a point the primary description of the system and the later reviews both make [1][2].";

await test("on a crowded draw the founding paper is presented and both off topic specimens are absent", async () => {
  scenPapers = CRISPR_POOL_13;
  scenLaneEpmc = LANE_EPMC_13;
  scenLaneOpenAlex = LANE_OA_13;
  scenLaneS2 = LANE_S2_13;
  scenAnswer = CRISPR_ANSWER_13;
  scenFactCheck = null;
  scenFactCheckMode = "ok";
  scenRetryAnswer = null;
  const { data } = await runScenario("how does crispr cas9 cut dna");
  const titles = (data.sources || []).map((s) => s.title);
  assert.ok(titles.includes(J2_TITLE),
    "the 2012 founding paper is admitted by the lane but absent from the presented list: " + titles.join(" | "));
  assert.ok(!titles.some((t) => t.includes("LncRNA-ITGA2")),
    "the vascular remodeling specimen reached the presented list");
  assert.ok(!titles.some((t) => t.includes("Extrachromosomal Circular DNA")),
    "the extrachromosomal circular DNA specimen reached the presented list");
  const lane = (data._record && data._record.funnel && data._record.funnel.foundationalLane);
  assert.ok(lane && lane.fired === true,
    "the foundational lane did not fire on the brief's exact wording: " + JSON.stringify(lane || null));
  assert.ok(data._ledger && data._ledger.used <= 50 &&
    data._ledger.used + data._ledger.remaining === data._ledger.limit,
    "the ledger does not close at its limit on the crowded CRISPR run");
});

// ═══════════════════════════════════════════════════════════════
group("Items 3 and 4 — the sky shape, the claim check's named behavior");

const SKY_POOL_13 = [
  epmc13("sky1", "Why is the sky blue?",
    "The blue color of the sky is explained by Rayleigh scattering. Air molecules scatter short wavelength blue light far more strongly than longer wavelengths, so scattered sunlight reaches the eye from every direction and the sky appears blue. The article also explains why the sky pales near the horizon and why sunsets turn red.", 210, "2006"),
  epmc13("sky2", "Rayleigh scattering and the color of the sky: measurements and models",
    "Measurements of the spectrum of scattered sunlight confirm that air molecules scatter light with an intensity that follows the inverse fourth power of the wavelength, the signature of Rayleigh scattering. The models reproduce the observed blue of the daytime sky and its variation with solar angle and aerosol load.", 480, "2015"),
  epmc13("sky3", "Painting the sky: an evaluation of how artists render daylight color",
    "This evaluation studies how landscape painters across three centuries have rendered the color of the sky. It analyzes the perceptual choices in their treatment of daylight, comparing painted skies with the colors observers report, and discusses what the paintings reveal about color perception rather than about optics.", 95, "2007"),
  epmc13("sky4", "Aerosols and the whitening of the daytime sky near the horizon",
    "Aerosol particles scatter sunlight across all wavelengths, which whitens the blue of the sky near the horizon on hazy days. Field measurements relate particle counts to the measured paling, extending the molecular scattering account to real atmospheres.", 130, "2019"),
];
// The scenario answers track their cited sources' abstracts
// closely: the harness's citation alignment pass flags
// sentences whose citations do not support them, and a flags
// panel would mask the stage outcomes these fixtures exist to
// pin (the wave twelve sky fixture's longer answer accrued
// exactly such flags on its sunset sentence).
const SKY_ANSWER_13 = "The sky is blue because of **Rayleigh scattering**: air molecules scatter short wavelength blue light far more strongly than longer wavelengths, so scattered sunlight reaches the eye from every direction and the sky appears blue [1][2].\n\nThe same scattering explains why the sky pales near the horizon and why sunsets turn red: light from those directions has crossed more air, and aerosol particles scatter all wavelengths, whitening the blue near the horizon [1][4].";
const SKY_FACTCHECK_13 = JSON.stringify({ claims: [
  { claim: "The sky is blue because air molecules scatter short wavelength blue light far more strongly than longer wavelengths (Rayleigh scattering)",
    source_index: 1,
    quote: "Air molecules scatter short wavelength blue light far more strongly than longer wavelengths",
    status: "supported",
    justification: "The first source states the scattering claim directly in its abstract and names Rayleigh scattering as the explanation of the sky's blue color, so the claim as the answer states it is backed by the cited source's own text." },
  { claim: "Aerosol particles whiten the sky near the horizon",
    source_index: 4, quote: "Aerosol particles scatter sunlight across all wavelengths, which whitens the blue of the sky near the horizon", status: "thin",
    justification: "The fourth source states the whitening directly, but ties it to hazy days, a qualifier the claim omits, so the support is partial rather than direct. (Fixture corrected 2026-10-22 at the Wave 1-C landing: this claim previously pointed at source 2 with the quote \"aerosol load\", a mis binding the L5-3 quote verification now rejects; the claim's own sentence cites [1][4] and source 4 states it verbatim.)" },
] });

await test("a request with no factCheck setting names that cause in the stage record and the search record", async () => {
  scenPapers = SKY_POOL_13;
  scenLaneEpmc = []; scenLaneOpenAlex = []; scenLaneS2 = [];
  scenAnswer = SKY_ANSWER_13;
  scenFactCheck = SKY_FACTCHECK_13;
  scenFactCheckMode = "ok";
  scenRetryAnswer = null;
  const { data } = await runScenario("why is the sky blue", { settings: {} });
  const stage = (data.stageHealth || []).find((s) => s.name === "fact-check");
  assert.ok(stage, "the fact check stage record is missing");
  assert.equal(stage.ok, null, "a stage that never attempted is recorded as something other than a skip");
  assert.equal(stage.skipReason, "fact check off for this request",
    "the stage does not name the toggle cause: " + JSON.stringify(stage));
  const trace = (data._record && data._record.factCheckTrace) || [];
  assert.ok(trace.some((t) => t.tier === "stage" && t.outcome === "off"),
    "the search record carries no named non attempt cause: " + JSON.stringify(trace));
});

await test("when the validate model is rate limited, the fallback model lands the check and the trace says so", async () => {
  scenPapers = SKY_POOL_13;
  scenLaneEpmc = []; scenLaneOpenAlex = []; scenLaneS2 = [];
  scenAnswer = SKY_ANSWER_13;
  scenFactCheck = SKY_FACTCHECK_13;
  scenFactCheckMode = "429-primary";
  scenRetryAnswer = null;
  const { data, fetchLog } = await runScenario("why is the sky blue", { settings: { factCheck: true } });
  assert.ok(data.factCheck && data.factCheck.mode === "claims",
    "no claims mode fact check shipped under saturation: " + JSON.stringify(data.factCheck && data.factCheck.mode));
  assert.deepEqual(factCheckSupport(data.factCheck), { supported: 1, checked: 2 },
    "the fallback model's verdicts are not the shipped counts: " + JSON.stringify(factCheckSupport(data.factCheck)));
  const fallbackCall = fetchLog.some((f) => f.body.includes("rigorous scientific fact-checker") && f.body.includes("gemma-4-26b-a4b-it"));
  assert.ok(fallbackCall, "the fallback validate model was never called after the primary's 429");
  const trace = (data._record && data._record.factCheckTrace) || [];
  const orEntry = trace.findIndex((t) => t.tier === "openrouter");
  const fbEntry = trace.findIndex((t) => t.tier === "openrouter-fallback");
  assert.ok(orEntry >= 0 && trace[orEntry].outcome === "http-429",
    "the trace does not record the primary tier's 429: " + JSON.stringify(trace));
  assert.ok(fbEntry > orEntry && trace[fbEntry].outcome === "ok",
    "the trace does not record the fallback tier's success after the 429: " + JSON.stringify(trace));
  assert.ok(trace.some((t) => t.tier === "workers-ai" && t.outcome === "no-binding"),
    "the trace does not record the missing Workers AI binding: " + JSON.stringify(trace));
  const stage = (data.stageHealth || []).find((s) => s.name === "fact-check");
  assert.ok(stage && stage.ok === true, "the fact check stage is not ok after the fallback landed");
  assert.ok(data._ledger && data._ledger.used <= 50 &&
    data._ledger.used + data._ledger.remaining === data._ledger.limit,
    "the ledger does not close at its limit on the saturation run");
});

await test("when every tier is rate limited, the stage and the record name each failure", async () => {
  scenPapers = SKY_POOL_13;
  scenLaneEpmc = []; scenLaneOpenAlex = []; scenLaneS2 = [];
  scenAnswer = SKY_ANSWER_13;
  scenFactCheck = SKY_FACTCHECK_13;
  scenFactCheckMode = "429-all";
  scenRetryAnswer = null;
  const { data } = await runScenario("why is the sky blue", { settings: { factCheck: true } });
  const trace = (data._record && data._record.factCheckTrace) || [];
  assert.ok(trace.some((t) => t.tier === "workers-ai" && t.outcome === "no-binding"),
    "the trace omits the Workers AI outcome: " + JSON.stringify(trace));
  assert.ok(trace.some((t) => t.tier === "openrouter" && t.outcome === "http-429"),
    "the trace omits the primary validate model's 429: " + JSON.stringify(trace));
  assert.ok(trace.some((t) => t.tier === "openrouter-fallback" && t.outcome === "http-429"),
    "the trace omits the fallback model's 429 — the cheapest tier was not attempted: " + JSON.stringify(trace));
  const stage = (data.stageHealth || []).find((s) => s.name === "fact-check");
  assert.ok(stage && stage.ok === null,
    "a fully saturated check is recorded as something other than a named skip: " + JSON.stringify(stage));
  assert.ok(stage.skipReason && stage.skipReason.includes("openrouter http-429"),
    "the stage skip reason does not name the tier failures: " + JSON.stringify(stage));
  assert.ok(data._ledger && data._ledger.used <= 50 &&
    data._ledger.used + data._ledger.remaining === data._ledger.limit,
    "the ledger does not close at its limit on the fully saturated run");
});

await test("the trace summary names tier outcomes and skips stage entries", () => {
  const summary = factCheckTraceSummary([
    { tier: "stage", outcome: "off" },
    { tier: "workers-ai", outcome: "timeout" },
    { tier: "openrouter", outcome: "http-429" },
    { tier: "openrouter-fallback", outcome: "ok" },
  ]);
  assert.equal(summary, "workers-ai timeout; openrouter http-429; openrouter-fallback ok");
  assert.equal(factCheckTraceSummary([]), "");
  assert.equal(factCheckTraceSummary(null), "");
});

await test("the fallback tier keys on the rate limit outcome and the trace outcomes are wired in source", () => {
  assert.ok(src.includes('const OR_VALIDATE_FALLBACK = "google/gemma-4-26b-a4b-it:free";'),
    "the fallback validate model constant is missing");
  // PIN UPDATED (2026-10-14, wave sixteen): the outcome variable
  // was renamed orTierOutcome when the Gemini tier took the
  // lead slot and the OpenRouter tier became tier three; the
  // contract it pins (the fallback fires on the OpenRouter
  // tier's 429 outcome) is unchanged.
  assert.ok(src.includes('orTierOutcome === "http-429"'),
    "the fallback tier does not key on the rate limit outcome");
  assert.ok(src.includes('note("openrouter-fallback", "ok")'),
    "the fallback tier does not record its outcome in the trace");
});

// ═══════════════════════════════════════════════════════════════
group("Item 4 — the checker catches a claim that denies its own cited source");

await test("the checker prompt names literature claims and the source block carries fuller text", () => {
  assert.ok(src.includes("characterizes the sources or the literature themselves"),
    "the checker prompt does not name claims about the sources as a selection class");
  assert.ok(src.includes("i < 8 ? 1000 : 600"),
    "the checker source block does not carry fuller text for the first eight sources");
});

// The denial is the short answer's own sentence, the a269429
// shape: a literature characterizing claim standing alone and
// citing the very source that contains the explanation it
// denies (the removal matcher binds a claim to the sentence
// that cites the claim's judged source, so the fixture uses
// the citation shape the live run shipped; a denial citing a
// DIFFERENT source than the one refuting it is a residual gap
// named in the wave report, not silently folded in here).
const DENYING_ANSWER_13 = "The literature does not explain the physical cause of the sky's color [1].\n\nThe sky is blue because of **Rayleigh scattering**: air molecules scatter short wavelength blue light far more strongly than longer wavelengths, so scattered sunlight reaches the eye from every direction and the sky appears blue [1][2].\n\nThe same scattering explains why the sky pales near the horizon and why sunsets turn red: light from those directions has crossed more air, and aerosol particles scatter all wavelengths, whitening the blue near the horizon [1][4].";
const DENIAL_FACTCHECK_13 = JSON.stringify({ claims: [
  { claim: "The literature does not explain the physical cause of the sky's color",
    source_index: 1,
    quote: "The blue color of the sky is explained by Rayleigh scattering",
    status: "unsupported",
    justification: "The first cited source states the explanation outright in its opening sentence: the blue color of the sky is explained by Rayleigh scattering, and it goes on to give the mechanism. The answer's claim that the literature does not explain the physical cause is therefore contradicted by the very source the sentence cites." },
  { claim: "The sky is blue because air molecules scatter short wavelength blue light far more strongly than longer wavelengths (Rayleigh scattering)",
    source_index: 1,
    quote: "Air molecules scatter short wavelength blue light far more strongly than longer wavelengths",
    status: "supported",
    justification: "The first source states the scattering claim directly in its abstract and names Rayleigh scattering as the explanation of the sky's blue color, so the teaching claim is backed by the cited source's own text." },
] });

await test("the literature denying sentence is caught by the checker and does not survive", async () => {
  scenPapers = SKY_POOL_13;
  scenLaneEpmc = []; scenLaneOpenAlex = []; scenLaneS2 = [];
  scenAnswer = DENYING_ANSWER_13;
  scenFactCheck = DENIAL_FACTCHECK_13;
  scenFactCheckMode = "ok";
  scenRetryAnswer = null;
  const { data } = await runScenario("why is the sky blue", { settings: { factCheck: true } });
  assert.ok(data.factCheck && data.factCheck.mode === "claims",
    "no claims mode fact check shipped on the denial run: " + JSON.stringify(data.factCheck && data.factCheck.mode));
  assert.deepEqual(factCheckSupport(data.factCheck), { supported: 1, checked: 2 },
    "the denial verdict is not counted as a checked failure: " + JSON.stringify(factCheckSupport(data.factCheck)));
  const denial = (data.factCheck.claims || []).find((c) => /not explain the physical cause/.test(c.claim || ""));
  assert.ok(denial && denial.status === "unsupported",
    "the literature denying claim is not in the panel as unsupported: " + JSON.stringify((data.factCheck.claims || []).map((c) => c.claim)));
  assert.ok(!/not explain the physical cause/.test(data.answer || ""),
    "the denying sentence survived into the shipped answer: " + String(data.answer || "").slice(0, 200));
  assert.ok(/Rayleigh scattering/.test(data.answer || ""),
    "the supported Rayleigh teaching was removed along with the denial");
});

console.log(`\nsearch-wave-thirteen: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
