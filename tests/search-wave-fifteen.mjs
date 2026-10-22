/**
 * Search wave fifteen (2026-10-14). One defect, diagnosed live
 * before any code changed: on "how does crispr cas9 cut dna"
 * the foundational lane fires (admitted 24 on the parent's
 * probe of build 0187c6e) and the wave fourteen fate diagnostic
 * tracks five primaries — but the 2012 founding paper (Jinek
 * et al., "A programmable dual-RNA-guided DNA endonuclease in
 * adaptive bacterial immunity", Science 2012) is not among
 * them, because it never becomes a primary at all.
 *
 * The live leg probe (standalone, not shipped; run against the
 * real Europe PMC, OpenAlex, and Semantic Scholar APIs with
 * the lane's exact query, sorts, and limits):
 *
 *   - Europe PMC, lane query "Deoxyribonucleic acid crispr
 *     cas9 cut mechanism cleavage structure guide", sort=CITED
 *     desc, pageSize 12: 95 hits total, and the founding paper
 *     is NOT in the match set — the set's most cited paper
 *     holds 1,064 citations while the founding paper holds
 *     11,954 at Europe PMC, so had it matched it would rank
 *     first. Its abstract says "cleave" and "guide"; it never
 *     says the expansion "Deoxyribonucleic acid", "mechanism",
 *     or "cut", and the engines match the loaded query against
 *     title and abstract.
 *   - OpenAlex, same query, sort=cited_by_count:desc,
 *     per_page 12: 252 matches, top match 634 citations; the
 *     founding paper (17,051 at OpenAlex) absent — excluded
 *     from the match set the same way.
 *   - Semantic Scholar: the unauthenticated shared pool
 *     answered 429 on twelve attempts over four minutes for
 *     every query form, so that leg could not be read; the
 *     production count of 24 admitted is exactly Europe PMC's
 *     12 plus OpenAlex's 12, and the diagnosis does not depend
 *     on the third leg.
 *   - The founding form (the unexpanded system name alone):
 *     Europe PMC "crispr cas9" CITED desc returns the paper
 *     SECOND (11,954 citations, abstract present, 997 chars);
 *     "crispr" returns it third. OpenAlex "crispr cas9" and
 *     "crispr" both return it second (17,051, abstract
 *     present). The paper arrives rich — no abstract
 *     enrichment is needed.
 *
 * What this wave ships:
 *
 *   1. The founding form legs: the lane fires its citation
 *      sorted Europe PMC and OpenAlex legs a second time over
 *      foundationalFormQuery(rawQuery, dynLookup) — the
 *      question's subject concept in the asker's own words,
 *      plus its adjacent name word. The lane's gate price is
 *      unchanged (the founding legs bring the typical
 *      composition to the five single calls the price has
 *      carried since wave nine).
 *   2. The near miss diagnostic: gatherFoundationalNearMisses
 *      names the lane returned papers that stand at or above
 *      the capture's citation median (or in the lane's top
 *      citation ranks) yet fail the primary test, each with
 *      its failing properties from the closed set
 *      FOUNDATIONAL_NEAR_MISS_REASONS. The fates could only
 *      ever track a paper after it formed a primary; a
 *      founding paper that never forms one is now visible to
 *      the record instead of invisible to it.
 *
 * The handler scenario below scripts the primary lane legs to
 * return the live shaped sets WITHOUT the founding paper (the
 * probe's finding), and the founding form legs to return it.
 * The paper must present, its fate must record it, the lane
 * entry must name the founding query, and the 2025 mechanism
 * review in the primary lane's returns must appear as a near
 * miss failing only "not-early".
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 *
 * Run with: node tests/search-wave-fifteen.mjs
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
  foundationalFormQuery, gatherFoundationalNearMisses,
  foundationalPrimaryFailureReasons, FOUNDATIONAL_NEAR_MISS_REASONS,
  paperIsFoundationalPrimary, foundationalPoolStats,
  gatherFoundationalFates,
  buildDeterministicFallbackGroups, buildDynLookup, centralContentTerms,
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

// ═══════════════════════════════════════════════════════════════
group("The founding form — the unexpanded system name");

await test("the CRISPR question's founding form is the system name as asked", () => {
  const q = "how does crispr cas9 cut dna";
  assert.equal(foundationalFormQuery(q, dynFor(q)), "crispr cas9");
});

await test("the measurement question's founding form keeps the system's two word name", () => {
  const q = "how is manganese peroxidase activity measured";
  assert.equal(foundationalFormQuery(q, dynFor(q)), "manganese peroxidase");
});

await test("the founding form follows the subject machinery and never invents one", () => {
  assert.equal(foundationalFormQuery("", null), null);
  assert.equal(foundationalFormQuery("how does pcr make more copies of dna", dynFor("how does pcr make more copies of dna")), "dna",
    "the subject machinery names dna the subject of the PCR question; the form follows it rather than second guessing it");
});

// ═══════════════════════════════════════════════════════════════
group("Near misses — the closed set and the primary test agree");

const J15_TITLE = "A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity";
const J15_ABSTRACT = "Clustered regularly interspaced short palindromic repeats (CRISPR) and CRISPR associated (Cas) proteins form an adaptive immune system in bacteria and archaea. Here we show that Cas9 is a dual RNA guided DNA endonuclease. Cas9 is guided by a crRNA and a tracrRNA to a target DNA sequence, where its two nuclease domains cleave each strand of the DNA and generate a double strand break. Guide RNA recognition of the target, together with the requirement for a protospacer adjacent motif, determines where cleavage occurs. These findings establish the mechanism by which the CRISPR Cas system recognizes and cuts foreign DNA, and show that the guide can be reprogrammed to direct cleavage to new targets.";
const lanePaper = (over = {}) => ({
  title: "Untitled lane paper",
  abstract: "",
  year: "2020",
  citations: 0,
  journal: "Science",
  doi: "10.1000/w15-" + Math.random().toString(36).slice(2, 9),
  url: "",
  _foundationalLane: true,
  ...over,
});

const CAPTURE_15 = [
  { citations: 100, year: "2020" }, { citations: 200, year: "2021" }, { citations: 300, year: "2022" },
];
const STATS_15 = foundationalPoolStats(CAPTURE_15);

const FIXTURES_15 = {
  primary: lanePaper({
    title: J15_TITLE, abstract: J15_ABSTRACT, year: "2012", citations: 11954,
    doi: "10.1000/w15-jinek", url: "https://doi.org/10.1000/w15-jinek",
  }),
  recentReview: lanePaper({
    title: "Mechanism of CRISPR Cas9 DNA cleavage: a synthesis of the checkpoints",
    abstract: "This synthesis reviews the mechanism of CRISPR Cas9 DNA cleavage. Guide RNA loading, DNA unwinding, and cleavage by the two nuclease domains are described step by step, and the structural checkpoints before cleavage are compared across recent studies.",
    year: "2025", citations: 4000, doi: "10.1000/w15-recent", url: "https://doi.org/10.1000/w15-recent",
  }),
  noEngagement: lanePaper({
    title: "A survey of validation strategies for genome editing projects in core facilities",
    abstract: "A survey of validation strategies for genome editing projects in core facilities. Responses were collected from forty facilities about their standard workflows, staffing, and reporting practices for editing projects.",
    year: "2014", citations: 500, doi: "10.1000/w15-survey", url: "https://doi.org/10.1000/w15-survey",
  }),
  belowMedian: lanePaper({
    title: "Nuclease cleavage mechanism of a bacterial immune effector",
    abstract: "", year: "2013", citations: 150,
    doi: "10.1000/w15-below", url: "https://doi.org/10.1000/w15-below",
  }),
  guard: lanePaper({
    title: "Antimicrobial resistance in commensal bacteria from retail meat: a prevalence survey",
    abstract: "We sampled retail meat in twelve regions and counted resistant isolates of common commensal bacteria. Prevalence varied by region and by the animal the meat came from, and the counts are reported region by region.",
    year: "2018", citations: 21000, doi: "10.1000/w15-guard", url: "https://doi.org/10.1000/w15-guard",
  }),
  invisible: lanePaper({
    title: "Field notes on a nuclease survey in soil samples",
    abstract: "", year: "2013", citations: 50,
    doi: "10.1000/w15-invisible", url: "https://doi.org/10.1000/w15-invisible",
  }),
};
const ALL_15 = Object.values(FIXTURES_15);
const missesOf = (papers) => gatherFoundationalNearMisses({
  preDedupe: papers, merged: papers, scoredAllCapture: CAPTURE_15,
});

await test("the failure reasons and the primary test never disagree", () => {
  assert.equal(STATS_15.medianCitations, 200, "fixture median drifted");
  for (const [name, p] of Object.entries(FIXTURES_15)) {
    const reasons = foundationalPrimaryFailureReasons(p, STATS_15)
      .filter((r) => r !== "no-usable-abstract");
    assert.equal(paperIsFoundationalPrimary(p, STATS_15), reasons.length === 0,
      `${name}: primary=${paperIsFoundationalPrimary(p, STATS_15)} but test blocking reasons=${JSON.stringify(reasons)}`);
    for (const r of foundationalPrimaryFailureReasons(p, STATS_15)) {
      assert.ok(FOUNDATIONAL_NEAR_MISS_REASONS.includes(r), `${name}: reason ${r} is outside the closed set`);
    }
  }
});

await test("a recent mechanism review above the median is a near miss failing only not-early", () => {
  const misses = missesOf(ALL_15);
  const m = misses.find((x) => x.title === FIXTURES_15.recentReview.title);
  assert.ok(m, "the recent review is not among the near misses: " + JSON.stringify(misses.map((x) => x.title)));
  assert.deepEqual(m.failing, ["not-early"]);
  assert.equal(m.citations, 4000);
});

await test("an early, cited paper with no engagement is a near miss failing only no-engagement", () => {
  const misses = missesOf(ALL_15);
  const m = misses.find((x) => x.title === FIXTURES_15.noEngagement.title);
  assert.ok(m, "the survey paper is not among the near misses");
  assert.deepEqual(m.failing, ["no-engagement"]);
});

await test("a below median lane paper in the lane's top ranks is a near miss naming citations and the missing abstract", () => {
  const misses = missesOf(ALL_15);
  const m = misses.find((x) => x.title === FIXTURES_15.belowMedian.title);
  assert.ok(m, "the below median paper is not among the near misses: " + JSON.stringify(misses.map((x) => x.title)));
  assert.deepEqual(m.failing, ["citations-below-median", "no-usable-abstract"]);
});

await test("the guard: 21,000 citations with no engagement forms no primary and no fate, only a named near miss", () => {
  assert.equal(paperIsFoundationalPrimary(FIXTURES_15.guard, STATS_15), false);
  const fates = gatherFoundationalFates({
    preDedupe: ALL_15, merged: ALL_15, scoredAllCapture: CAPTURE_15,
    scoredPostFloor: [], finalScored: [], returnedShelf: [],
  });
  assert.ok(!fates.some((f) => f.title === FIXTURES_15.guard.title),
    "the guard paper produced a fate, so some layer treats it as a primary");
  const m = missesOf(ALL_15).find((x) => x.title === FIXTURES_15.guard.title);
  assert.ok(m && m.failing.includes("no-engagement"), "the guard paper is not named as a no-engagement near miss");
});

await test("the primary itself and the invisible paper are not near misses", () => {
  const misses = missesOf(ALL_15);
  assert.ok(!misses.some((x) => x.title === FIXTURES_15.primary.title),
    "a formed primary was also reported as a near miss");
  assert.ok(!misses.some((x) => x.title === FIXTURES_15.invisible.title),
    "a below median paper outside the lane's top ranks was reported");
  assert.ok(misses.length <= 5, "the near miss section exceeds its cap");
});

// ═══════════════════════════════════════════════════════════════
group("Source wiring pins");

await test("the founding form legs, the near miss wiring, and the record sections are wired in source", () => {
  assert.ok(src.includes("foundationalFormQuery(rawQuery, dynLookup)"),
    "the lane does not derive the founding form");
  assert.ok(src.includes('europePMC(foundingForm, 12, ledger, { sort: "CITED desc" })'),
    "the Europe PMC founding leg is missing");
  assert.ok(src.includes('openAlex(foundingForm, 12, openAlexKey, ledger, { sort: "cited_by_count:desc" })'),
    "the OpenAlex founding leg is missing");
  assert.ok(src.includes("foundingQuery: foundingForm || null"),
    "the lane diagnostic does not record the founding query");
  assert.ok(src.includes("diag.foundationalNearMisses = gatherFoundationalNearMisses({"),
    "the gather does not compute the near misses");
  const funnelStart = src.indexOf("function recordFunnelOf");
  const funnelEnd = src.indexOf("function recordAuthorsOf");
  assert.ok(funnelStart >= 0 && funnelEnd > funnelStart, "recordFunnelOf was not located");
  const funnelSrc = src.slice(funnelStart, funnelEnd);
  assert.ok(funnelSrc.includes("diag.foundationalNearMisses"),
    "recordFunnelOf does not read diag.foundationalNearMisses");
  assert.ok(funnelSrc.includes("foundingQuery"),
    "recordFunnelOf does not carry the founding query");
  assert.ok(src.includes("SUBREQUEST_FOUNDATIONAL_LANE_COST = 6"),
    "the lane's gate price changed; the founding legs were funded inside it, not by raising it");
  // PIN UPDATED (2026-10-21, search diagnosis): the price rises
  // from 5 to 6 because the method shape's lane gains a genuinely
  // new sixth call — a Crossref leg carrying the lane's
  // determination vocabulary to the one index that holds the
  // dedicated method papers (absent from Europe PMC and PubMed,
  // ranked first by Crossref for that phrasing). This is not the
  // wave fifteen re-funding the pin guards against: no existing
  // leg changed price; a new leg was added and priced.
  // PIN UPDATED (2026-10-14, wave sixteen): v51, the serve
  // side honesty wave. The v50 entry stays as history below.
  // PIN UPDATED (2026-10-15, wave seventeen): v52, the
  // citation depth wave. The v51 entry stays as history below.
  assert.ok(src.includes('const CACHE_SCHEMA_VERSION = "v54";'),
    "CACHE_SCHEMA_VERSION was not bumped to v54");
  assert.ok(/\/\/ v51 \(2026-10-14, wave sixteen\)/.test(src),
    "the v51 chain entry is missing its dated reason");
  assert.ok(/\/\/ v50 \(2026-10-14, wave fifteen\)/.test(src),
    "the v50 chain entry is missing its dated reason");
});

// ═══════════════════════════════════════════════════════════════
group("Handler — the founding form legs deliver the founding paper");

const epmc15 = (id, title, abstractText, citedByCount, pubYear, journalTitle) => ({
  title,
  doi: "10.1000/w15-" + id,
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
const oa15 = (id, title, abstractText, citedByCount, year) => ({
  title,
  doi: "https://doi.org/10.1000/w15-" + id,
  publication_year: year,
  cited_by_count: citedByCount,
  authorships: [{ author: { display_name: "Doe J" } }],
  primary_location: { source: { display_name: "Science" }, landing_page_url: "https://example.org/" + id },
  abstract_inverted_index: inverted(abstractText),
  type: "article",
});

// The main gather's pool: on topic reviews, none of them the
// founding paper (the live shape: a healthy presented list
// with the founding paper simply absent).
const MAIN_POOL_15 = [
  ["r1", "CRISPR Cas9 DNA cleavage: how the guide RNA directs Cas9 to cut DNA", "How CRISPR Cas9 cuts DNA is reviewed step by step. The guide RNA recognizes the target DNA sequence next to a protospacer adjacent motif, Cas9 unwinds the DNA, and its two nuclease domains cleave the two DNA strands three bases upstream. Structures of Cas9 bound to guide RNA and target DNA show the conformational checkpoints that license DNA cleavage, and repair of the cut DNA completes the edit.", 2600, 2025, "Nature"],
  ["r2", "Cas9 nuclease mechanism: guide recognition, DNA unwinding and strand cleavage", "The Cas9 nuclease mechanism is dissected here. Guide RNA loading rearranges Cas9 into a DNA surveillance complex; target DNA binding triggers unwinding, R loop formation, and cleavage of both DNA strands by the HNH and RuvC nuclease domains. Kinetic measurements of DNA cutting and structural snapshots of the cleavage state explain how CRISPR Cas9 achieves precise DNA cleavage.", 2100, 2024, "Science"],
  ["r3", "CRISPR Cas9 genome editing: the DNA cut and what happens after cleavage", "CRISPR Cas9 genome editing begins with a DNA cut. This review follows the cleavage event: guide RNA directed Cas9 binding to DNA, double strand DNA cleavage, and the repair pathways that resolve the break. It compares cleavage efficiency across guide designs and DNA contexts and summarizes how the DNA cut is converted into a permanent genome edit in cells.", 1900, 2025, "Cell"],
  ["r4", "Structural basis of CRISPR Cas9 guide RNA recognition and DNA cleavage", "Crystal and cryo electron microscopy structures reveal how CRISPR Cas9 recognizes guide RNA and cleaves DNA. The guide RNA scaffold docks into Cas9, the seed region interrogates DNA for a matching protospacer, and DNA unwinding positions both strands for cleavage by the two nuclease domains. The structural basis of DNA cleavage specificity is reviewed in detail.", 1750, 2024, "Nature"],
  ["r5", "How CRISPR Cas9 cuts DNA: conformational checkpoints before cleavage", "How does CRISPR Cas9 cut DNA without cutting the wrong DNA? This review describes the checkpoints: guide RNA and Cas9 first survey DNA for the protospacer adjacent motif, then DNA unwinding and guide pairing proceed stepwise, and only a fully paired guide licenses the nuclease domains to cleave both DNA strands. Mismatched DNA stalls before cleavage, which explains specificity.", 1500, 2026, "Molecular Cell"],
  ["r6", "Guide RNA design for efficient CRISPR Cas9 DNA cleavage in human cells", "Guide RNA design determines how efficiently CRISPR Cas9 cleaves DNA in human cells. Sequence features of the guide, DNA accessibility, and Cas9 delivery are compared across large cleavage datasets. Rules are derived for choosing guides that maximize DNA cutting at the intended site while minimizing cleavage at similar DNA sequences elsewhere in the genome.", 1400, 2025, "Nature Biotechnology"],
].map(([id, t, a, c, y, j]) => epmc15(id, t, a, c, y, j));

// The primary lane legs, as the live probe found them: review
// heavy, the founding paper nowhere. The 2025 synthesis is
// the near miss specimen (mechanism engaged, abstract
// present, citations at the lane's top — failing only early).
const LANE_EPMC_15 = [
  epmc15("lane1", "The next generation of CRISPR-Cas technologies and applications", "CRISPR Cas systems continue to expand. This review surveys new Cas nucleases, guide RNA engineering, and DNA cleavage applications across medicine and agriculture, and describes the mechanism families the new tools belong to.", 1064, 2019, "Nature Reviews"),
  epmc15("lane2", FIXTURES_15.recentReview.title, FIXTURES_15.recentReview.abstract, 4000, 2025, "Cell"),
];
const LANE_OA_15 = [
  oa15("lane3", "CRISPR/Cas9 systems have off-target activity with insertions or deletions between target DNA and guide RNA", "CRISPR Cas9 systems can cleave DNA at sites that differ from the guide RNA target. We measured off target cleavage across the genome and found insertions and deletions between the target DNA and the guide sequence, which the mechanism of guide recognition explains.", 634, 2014),
  oa15("lane4", "Mechanism and applications of CRISPR Cas9 mediated genome editing", "The mechanism of CRISPR Cas9 genome editing is reviewed: guide RNA recognition of target DNA, unwinding, and cleavage of both strands by the nuclease domains, followed by repair. Applications of the DNA cut in research and therapy are surveyed.", 453, 2021),
];
const LANE_S2_15 = [{
  title: "CRISPR Cas9: a tool for genome editing",
  abstract: "CRISPR Cas9 genome editing is reviewed. The guide RNA directs the Cas9 nuclease to target DNA, where cleavage of both strands produces the break that repair converts into an edit.",
  year: 2019, citationCount: 800,
  authors: [{ name: "Doe J" }], venue: "Nature",
  externalIds: { DOI: "10.1000/w15-s2review" },
}];
// The founding form legs: the founding paper, rich, exactly
// as both engines return it under the system name alone.
const FOUNDING_EPMC_15 = [{
  title: J15_TITLE, doi: "10.1000/w15-jinek", pubYear: "2012", citedByCount: 11954,
  authorString: "Jinek M, Chylinski K, Fonfara I, Hauer M, Doudna JA, Charpentier E",
  journalTitle: "Science", abstractText: J15_ABSTRACT,
}];
const FOUNDING_OA_15 = [oa15("jinek", J15_TITLE, J15_ABSTRACT, 17051, 2012)];
// oa15 builds the DOI as 10.1000/w15-jinek for id "jinek" — the
// same work as the Europe PMC founding row, so dedupe folds.

const ANSWER_15 = "CRISPR Cas9 cuts DNA when a guide RNA leads the Cas9 protein to a matching DNA sequence and Cas9 cleaves both strands of the DNA, making a double strand break at that spot. [1][2]\n\n**How the cut happens:**\n\n- **Guided targeting:** the guide RNA recognizes the target DNA next to a short motif, positioning the Cas9 endonuclease for cleavage of the DNA [1][2].\n- **Two strand cuts:** the nuclease domains of Cas9 each cleave one strand of the DNA, so the break goes through both strands, and the cell then repairs the broken DNA, which is where the edit becomes permanent [1][2].";

let scenFetchLog = [];
async function runScenario15(query) {
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
        return chatRes("no verdict available");
      }
      if (body.includes("Cite at least two different sources inline")) {
        return chatRes(ANSWER_15);
      }
      if (body.includes("literature search specialist")) {
        return chatRes("I cannot group those terms today.");
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));
      }
      return chatRes(ANSWER_15);
    }
    const dec = (() => { try { return decodeURIComponent(u); } catch { return u; } })();
    if (u.includes("ebi.ac.uk/europepmc")) {
      // Only lane calls carry the CITED sort; among them the
      // primary query carries the shape vocabulary.
      if (dec.includes("CITED")) return jsonRes({ resultList: { result: dec.includes("cleavage") ? LANE_EPMC_15 : FOUNDING_EPMC_15 } });
      return jsonRes({ resultList: { result: MAIN_POOL_15 } });
    }
    if (u.includes("api.openalex.org")) {
      if (dec.includes("cited_by_count")) return jsonRes({ results: dec.includes("cleavage") ? LANE_OA_15 : FOUNDING_OA_15 });
      return jsonRes({ results: [] });
    }
    if (u.includes("api.semanticscholar.org")) {
      if (dec.includes("citationCount")) return jsonRes({ data: LANE_S2_15 });
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
    const ledger = createSubrequestLedger(undefined);
    const env = { DB: rgDb(), OPENROUTER_KEY: "w15-test-openrouter-key-123456" };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, settings: {} }),
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

await test("the founding paper presents, its fate records it, and the near miss is named", async () => {
  const { data, fetchLog } = await runScenario15("how does crispr cas9 cut dna");
  const titles = (data.sources || []).map((s) => s.title || "");
  assert.ok(titles.some((t) => t.includes("dual-RNA-guided")),
    "the founding paper is not in the presented list: " + JSON.stringify(titles));

  const funnel = (data._record && data._record.funnel) || {};
  const lane = funnel.foundationalLane || {};
  assert.equal(lane.foundingQuery, "crispr cas9",
    "the record's lane entry does not name the founding query: " + JSON.stringify(lane));

  const fates = funnel.foundationalFates || [];
  const fate = fates.find((f) => (f.title || "").includes("dual-RNA-guided"));
  assert.ok(fate, "no fate was recorded for the founding paper: " + JSON.stringify(fates.map((f) => f.title)));
  assert.equal(fate.presented, true, "the founding paper's fate does not record it presented: " + JSON.stringify(fate));

  const misses = funnel.foundationalNearMisses || [];
  const nm = misses.find((m) => (m.title || "").includes("synthesis of the checkpoints"));
  assert.ok(nm, "the 2025 mechanism review is not in the record's near misses: " + JSON.stringify(misses));
  assert.deepEqual(nm.failing, ["not-early"]);

  // The founding legs actually fired, on both engines, with
  // the citation sorts — not merely derived in the abstract.
  const decLog = fetchLog.map((f) => { try { return decodeURIComponent(f.url); } catch { return f.url; } });
  assert.ok(decLog.some((u) => u.includes("ebi.ac.uk") && u.includes("CITED") && !u.includes("cleavage") && u.includes("crispr")),
    "no Europe PMC founding form call in the fetch log");
  assert.ok(decLog.some((u) => u.includes("api.openalex.org") && u.includes("cited_by_count") && !u.includes("cleavage")),
    "no OpenAlex founding form call in the fetch log");

  if (data._ledger) {
    assert.ok(data._ledger.used <= 50, "the ledger exceeded its ceiling: " + data._ledger.used);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
