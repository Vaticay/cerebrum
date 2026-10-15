/**
 * Search wave fourteen (2026-10-14), Item 1 only. (Item 2, the
 * device title subject rule at the presented layer, lands in
 * this same file from a second worker.)
 *
 * The problem: the 2012 CRISPR founding paper ("A programmable
 * dual-RNA-guided DNA endonuclease in adaptive bacterial
 * immunity") is admitted by the foundational lane on live runs
 * of "how does crispr cas9 cut dna" but never appears in the
 * presented list, and three waves of fixes passed their
 * fixtures while live it still buried — because no surface
 * could name the step that ended its path.
 *
 * What this wave ships, and what is reproducible offline:
 *
 *   1. A bounded fate diagnostic. At gather time
 *      gatherFoundationalFates names, for each paper the lane
 *      admits as a primary (cap five), the first gather step
 *      its path ended at (dedupe, language screen, quality
 *      floor, shelf cut, rerank, retraction screen) or that it
 *      was returned. In the handler, six named checkpoints
 *      (filters, passes, gate, slice, validation, final gate)
 *      continue each fate, and a completion pass against the
 *      shipped entry lists records presented / presentedVia.
 *      The diagnostic rides the search record's funnel as
 *      foundationalFates, bounded like the lane entry beside
 *      it (titles capped, keys stripped).
 *
 *   2. The fix, at the validation step. The LLM validation
 *      pass is the one judgment based removal layer no fixture
 *      ever exercised against a primary: a strict small
 *      validator told to default to rejection, judging a first
 *      description whose title names neither the product nor
 *      the protein. The citation gate — the pipeline's own
 *      abstract aware topicality standard — already admitted
 *      these papers, so a validator dropped foundational
 *      primary that still clears the gate standard (and is
 *      unstamped and not title retracted) is now restored, in
 *      pre validation order. The handler scenario below
 *      scripts the validator to mark the founding paper
 *      IRRELEVANT and everything else RELEVANT, locating the
 *      founding paper's index by parsing the validator request
 *      body, and pins that the paper still presents, in the
 *      evidence list, with its fate open and its validation
 *      step true.
 *
 * What is NOT reproducible offline, stated plainly: the
 * production burial step itself. The harness's validator is
 * scripted, production's is not; the harness's gathered pool
 * is leaner than the live run's; production input differences
 * (expansion state, live abstracts) cannot be recreated here.
 * The diagnostic is the instrument that names the production
 * step on the parent's post deploy probe, and the fix removes
 * the validator's power over gate cleared primaries regardless
 * of which verdict production's validator returned.
 *
 * Item 1, scenario 5 construction: the second handler scenario
 * uses a lane primary that dies at the programmatic topic
 * overlap pass, the alternative construction the brief's
 * handler item allows. The paper is a genuine primary at
 * gather (2011, 8,000 citations, a mechanism title) whose text
 * shares none of the CRISPR question's resolved concepts — a
 * soil bacterium nuclease paper — so the gather shelf rescue
 * returns it, the handler's filters pass it, and the topic
 * overlap pass removes it with its own stamp. The fate must
 * name "passes" and carry that stamp as passReason. (The
 * passReason lookup reads the stamped paper object from the
 * pre pass list as well as the post pass list: a rejected
 * paper's stamp lives on the shared object, which the post
 * pass list no longer contains.)
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 *
 * Run with: node tests/search-wave-fourteen.mjs
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
  gatherFoundationalFates, advanceFoundationalFates, completeFoundationalFates,
  paperTitleAnnouncesDevice, paperTailDeviceBarred, paperTitleEngagesConcepts,
  buildDeterministicFallbackGroups, buildDynLookup, centralContentTerms,
  questionCentralConcepts, centralConceptHits,
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

// ── Scenario runner (wave thirteen pattern, adapted: the
// validator's verdicts can be scripted to reject the founding
// paper, located by parsing the validator request body) ─────
let scenPapers = [];
let scenAnswer = "";
let scenLaneEpmc = [];
let scenLaneOpenAlex = [];
let scenLaneS2 = [];
let scenValidatorMode = "permissive"; // "permissive" | "reject-founding"
let scenFetchLog = [];

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
        return chatRes("no verdict available");
      }
      if (body.includes("Cite at least two different sources inline")) {
        return chatRes(scenAnswer);
      }
      if (body.includes("literature search specialist")) {
        return chatRes("I cannot group those terms today.");
      }
      if (body.includes("relevance validator")) {
        if (scenValidatorMode === "reject-founding") {
          try {
            const parsedBody = JSON.parse(body);
            const msgs = Array.isArray(parsedBody.messages) ? parsedBody.messages : [];
            const userMsg = msgs.map((m) => String((m && m.content) || ""))
              .find((c) => c.includes("Papers to evaluate")) || "";
            const entries = [...userMsg.matchAll(/\[(\d+)\] "([^"]+)"/g)]
              .map((m) => ({ id: parseInt(m[1], 10), title: m[2] }));
            if (entries.length > 0) {
              return chatRes(JSON.stringify(entries.map((e) => ({
                id: e.id,
                verdict: e.title.includes("dual-RNA-guided") ? "IRRELEVANT" : "RELEVANT",
              }))));
            }
          } catch { /* fall through to the permissive reply */ }
        }
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
      OPENROUTER_KEY: "w14-test-openrouter-key-123456",
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

const epmc14 = (id, title, abstractText, citedByCount, pubYear, journalTitle) => ({
  title,
  doi: "10.1000/w14-" + id,
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
group("Item 1 — gatherFoundationalFates (unit)");

const J2_TITLE = "A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity";
const J2_ABSTRACT = "Clustered regularly interspaced short palindromic repeats (CRISPR) and CRISPR associated (Cas) proteins form an adaptive immune system in bacteria and archaea. Here we show that Cas9 is a dual RNA guided DNA endonuclease. Cas9 is guided by a crRNA and a tracrRNA to a target DNA sequence, where its two nuclease domains cleave each strand of the DNA and generate a double strand break. Guide RNA recognition of the target, together with the requirement for a protospacer adjacent motif, determines where cleavage occurs. These findings establish the mechanism by which the CRISPR Cas system recognizes and cuts foreign DNA, and show that the guide can be reprogrammed to direct cleavage to new targets.";
const J2_DOI = "10.1000/w14-unit-jinek";

const unitPrimary = (over = {}) => ({
  title: J2_TITLE,
  abstract: J2_ABSTRACT,
  year: "2012",
  citations: 9500,
  journal: "Science",
  doi: J2_DOI,
  url: "https://doi.org/" + J2_DOI,
  _foundationalLane: true,
  ...over,
});
const unitRecent = (id, citations) => ({
  title: "CRISPR Cas9 genome editing review " + id,
  abstract: "A review of CRISPR Cas9 genome editing advances, guide RNA design and DNA cleavage.",
  year: "2025",
  citations,
  journal: "Nature",
  doi: "10.1000/w14-unit-recent-" + id,
  url: "https://doi.org/10.1000/w14-unit-recent-" + id,
});

await test("a primary surviving to the returned shelf has no ending and its shelf position", () => {
  const cand = unitPrimary();
  const mergedRec = unitPrimary({ _foundationalLane: undefined });
  const scoredRec = unitPrimary({ _foundationalLane: undefined, score: 61 });
  const r1 = unitRecent("a", 500);
  const r2 = unitRecent("b", 700);
  const fates = gatherFoundationalFates({
    preDedupe: [cand],
    merged: [mergedRec],
    scoredAllCapture: [scoredRec, r1, r2],
    scoredPostFloor: [scoredRec, r1],
    finalScored: [r1, scoredRec],
    returnedShelf: [scoredRec, r1],
  });
  assert.equal(fates.length, 1, "the admitted primary produced no fate: " + JSON.stringify(fates));
  const f = fates[0];
  assert.equal(f.title, J2_TITLE);
  assert.equal(f.endedAt, null, "a returned primary carries an ending: " + f.endedAt);
  assert.ok(f.steps.pool && f.steps.dedupe && f.steps.scored && f.steps.shelf && f.steps.returned,
    "a returned primary's gather steps are not all true: " + JSON.stringify(f.steps));
  assert.equal(f.shelfPosition, 1, "the shelf position is not the finalScored index");
});

await test("a lane primary whose keys never merge ends at dedupe", () => {
  const cand = unitPrimary();
  const fates = gatherFoundationalFates({
    preDedupe: [cand],
    merged: [],
    scoredAllCapture: [unitRecent("a", 500), unitRecent("b", 700)],
    scoredPostFloor: [],
    finalScored: [],
    returnedShelf: [],
  });
  assert.equal(fates.length, 1, "the unmerged primary produced no fate");
  assert.equal(fates[0].endedAt, "dedupe");
  assert.equal(fates[0].steps.dedupe, false);
});

await test("a lane primary failing the language screen ends at language-screen", () => {
  const cand = unitPrimary({
    title: "Les endonucleases guidees par ARN dans l'immunite bacterienne adaptative",
    year: "2010",
    citations: 6000,
    doi: "10.1000/w14-unit-les",
    url: "https://doi.org/10.1000/w14-unit-les",
  });
  const mergedRec = { ...cand, _foundationalLane: undefined };
  const scoredRec = { ...mergedRec, score: 58 };
  const fates = gatherFoundationalFates({
    preDedupe: [cand],
    merged: [mergedRec],
    scoredAllCapture: [scoredRec, unitRecent("a", 500), unitRecent("b", 700)],
    scoredPostFloor: [unitRecent("a", 500)],
    finalScored: [],
    returnedShelf: [],
  });
  assert.equal(fates.length, 1, "the French titled primary produced no fate");
  assert.equal(fates[0].steps.scored, true, "the paper never reached the scorer's capture");
  assert.equal(fates[0].endedAt, "language-screen",
    "a title the language screen rejects did not end at the screen: " + fates[0].endedAt);
});

await test("a lane primary past the floor but off the shelf ends at shelf-cut, with the rescue barrier named", () => {
  const cand = unitPrimary();
  const mergedRec = unitPrimary({ _foundationalLane: undefined });
  const scoredRec = unitPrimary({ _foundationalLane: undefined, score: 40 });
  const fates = gatherFoundationalFates({
    preDedupe: [cand],
    merged: [mergedRec],
    scoredAllCapture: [scoredRec, unitRecent("a", 500), unitRecent("b", 700)],
    scoredPostFloor: [scoredRec, unitRecent("a", 500)],
    finalScored: [unitRecent("a", 500), unitRecent("b", 700)],
    returnedShelf: [unitRecent("a", 500)],
  });
  assert.equal(fates.length, 1);
  assert.equal(fates[0].endedAt, "shelf-cut");
  assert.equal(fates[0].endedDetail, "below the shelf score cut and no rescue displaced for it");
  assert.equal(fates[0].shelfPosition, null);

  const noAbs = unitPrimary({ abstract: "", doi: "10.1000/w14-unit-noabs", url: "https://doi.org/10.1000/w14-unit-noabs" });
  const noAbsMerged = { ...noAbs, _foundationalLane: undefined };
  const noAbsScored = { ...noAbsMerged, score: 40 };
  const fates2 = gatherFoundationalFates({
    preDedupe: [noAbs],
    merged: [noAbsMerged],
    scoredAllCapture: [noAbsScored, unitRecent("a", 500), unitRecent("b", 700)],
    scoredPostFloor: [noAbsScored],
    finalScored: [unitRecent("a", 500)],
    returnedShelf: [],
  });
  assert.equal(fates2.length, 1, "the title mechanism primary without an abstract produced no fate");
  assert.equal(fates2[0].endedAt, "shelf-cut");
  assert.equal(fates2[0].endedDetail, "no abstract: the shelf rescues require one");
});

await test("the burden guard produces no fate entry", () => {
  const burden = {
    title: "Global burden of bacterial antimicrobial resistance in 2019: a systematic analysis",
    abstract: "Antimicrobial resistance is a leading global health threat. We estimated deaths attributable to bacterial antimicrobial resistance across 204 countries in 2019 using statistical modelling of surveillance data, hospital records, and published studies. Resistance was associated with millions of deaths, making it a leading cause of mortality worldwide.",
    year: "2022", citations: 21000, journal: "Lancet",
    doi: "10.1000/w14-unit-burden", url: "https://doi.org/10.1000/w14-unit-burden",
    _foundationalLane: true,
  };
  const fates = gatherFoundationalFates({
    preDedupe: [burden],
    merged: [burden],
    scoredAllCapture: [burden, unitPrimary({ _foundationalLane: undefined }), unitRecent("a", 500)],
    scoredPostFloor: [burden],
    finalScored: [burden],
    returnedShelf: [burden],
  });
  assert.deepEqual(fates, [],
    "a huge citation count with no mechanism or method engagement produced a fate — the guard fell");
});

// ═══════════════════════════════════════════════════════════════
group("Item 1 — advanceFoundationalFates and completeFoundationalFates (unit)");

function survivingFates() {
  const cand = unitPrimary();
  const mergedRec = unitPrimary({ _foundationalLane: undefined });
  const scoredRec = unitPrimary({ _foundationalLane: undefined, score: 61 });
  return gatherFoundationalFates({
    preDedupe: [cand],
    merged: [mergedRec],
    scoredAllCapture: [scoredRec, unitRecent("a", 500), unitRecent("b", 700)],
    scoredPostFloor: [scoredRec],
    finalScored: [scoredRec],
    returnedShelf: [scoredRec],
  });
}

await test("advance records presence, and a first absence names the ending step once", () => {
  const present = survivingFates();
  advanceFoundationalFates(present, "filters", [unitPrimary({ _foundationalLane: undefined })]);
  assert.equal(present[0].steps.filters, true);
  assert.equal(present[0].endedAt, null, "a present fate gained an ending");

  const missing = survivingFates();
  advanceFoundationalFates(missing, "filters", [unitRecent("z", 100)]);
  assert.equal(missing[0].steps.filters, false);
  assert.equal(missing[0].endedAt, "filters");
  advanceFoundationalFates(missing, "passes", []);
  assert.equal(missing[0].steps.passes, false);
  assert.equal(missing[0].endedAt, "filters", "a later absence overwrote the first ending");

  assert.doesNotThrow(() => advanceFoundationalFates(null, "filters", []));
  assert.doesNotThrow(() => advanceFoundationalFates([], "filters", []));
  assert.doesNotThrow(() => completeFoundationalFates(undefined, [], []));
});

await test("complete sets presentedVia evidence, then tail, and not-presented for a fate in neither list", () => {
  const entry = { title: J2_TITLE, url: "https://doi.org/" + J2_DOI, journal: "Science", year: "2012" };
  const viaEvidence = survivingFates();
  completeFoundationalFates(viaEvidence, [entry], []);
  assert.equal(viaEvidence[0].presented, true);
  assert.equal(viaEvidence[0].presentedVia, "evidence");

  const viaTail = survivingFates();
  completeFoundationalFates(viaTail, [], [entry]);
  assert.equal(viaTail[0].presented, true);
  assert.equal(viaTail[0].presentedVia, "tail");

  const nowhere = survivingFates();
  completeFoundationalFates(nowhere, [], []);
  assert.equal(nowhere[0].presented, false);
  assert.equal(nowhere[0].presentedVia, null);
  assert.equal(nowhere[0].endedAt, "not-presented");
});

// ═══════════════════════════════════════════════════════════════
group("Item 1 — source wiring pins");

await test("the six handler checkpoints, the restore, the record normalization, and the cache version are wired in source", () => {
  assert.ok(src.includes('advanceFoundationalFates(foundationalFates, "filters", papers)'),
    "the filters checkpoint is missing");
  assert.ok(src.includes('advanceFoundationalFates(foundationalFates, "passes", programmaticShelf)'),
    "the passes checkpoint is missing");
  assert.ok(src.includes('advanceFoundationalFates(foundationalFates, "gate", citablePapers)'),
    "the gate checkpoint is missing");
  assert.ok(src.includes('advanceFoundationalFates(foundationalFates, "slice", evidencePapers)'),
    "the slice checkpoint is missing");
  assert.ok(src.includes('advanceFoundationalFates(foundationalFates, "validation", evidencePapers)'),
    "the validation checkpoint is missing");
  assert.ok(src.includes('advanceFoundationalFates(foundationalFates, "final-gate", evidencePapers)'),
    "the final-gate checkpoint is missing");
  assert.ok(src.includes("validationDiag.primaryRestored"),
    "the validation restore does not record its count on validationDiag");
  assert.ok(src.includes("const evidenceBeforeValidation = evidencePapers;"),
    "the restore does not capture the pre validation list");
  assert.ok(src.includes("completeFoundationalFates(foundationalFates, sourceList, furtherReadingTail)"),
    "the completion pass against the shipped lists is missing");
  assert.ok(src.includes("const scoredFiltered = merged"),
    "the scored chain was not split at the post filter array");
  assert.ok(src.includes("scoredPostFloor: scoredFiltered"),
    "the gather fates are not judged against scoredFiltered");
  const funnelStart = src.indexOf("function recordFunnelOf");
  const funnelEnd = src.indexOf("function recordAuthorsOf");
  assert.ok(funnelStart >= 0 && funnelEnd > funnelStart, "recordFunnelOf was not located");
  assert.ok(src.slice(funnelStart, funnelEnd).includes("diag.foundationalFates"),
    "recordFunnelOf does not read diag.foundationalFates");
  // PIN UPDATED (2026-10-14, wave fifteen): v50 — the
  // foundational lane gains founding form legs over the
  // unexpanded system name, and the record gains the
  // foundational near miss section. The v49 entry stays as
  // history below.
  // PIN UPDATED (2026-10-14, wave sixteen): v51, the serve
  // side honesty wave. The v50 entry stays as history above.
  // PIN UPDATED (2026-10-15, wave seventeen): v52, the
  // citation depth wave. The v51 entry stays as history above.
  assert.ok(src.includes('const CACHE_SCHEMA_VERSION = "v52";'),
    "CACHE_SCHEMA_VERSION was not bumped to v52");
  assert.ok(/\/\/ v49 \(2026-10-14, wave fourteen\)/.test(src),
    "the v49 chain entry is missing its dated reason");
});

// ═══════════════════════════════════════════════════════════════
group("Item 1 — handler: the validator cannot bury a gate cleared primary");

const CRISPR_POOL_14 = [
  ["r1", "CRISPR Cas9 DNA cleavage: how the guide RNA directs Cas9 to cut DNA", "How CRISPR Cas9 cuts DNA is reviewed step by step. The guide RNA recognizes the target DNA sequence next to a protospacer adjacent motif, Cas9 unwinds the DNA, and its two nuclease domains cleave the two DNA strands three bases upstream. Structures of Cas9 bound to guide RNA and target DNA show the conformational checkpoints that license DNA cleavage, and repair of the cut DNA completes the edit.", 2600, 2025, "Nature"],
  ["r2", "Cas9 nuclease mechanism: guide recognition, DNA unwinding and strand cleavage", "The Cas9 nuclease mechanism is dissected here. Guide RNA loading rearranges Cas9 into a DNA surveillance complex; target DNA binding triggers unwinding, R loop formation, and cleavage of both DNA strands by the HNH and RuvC nuclease domains. Kinetic measurements of DNA cutting and structural snapshots of the cleavage state explain how CRISPR Cas9 achieves precise DNA cleavage.", 2100, 2024, "Science"],
  ["r3", "CRISPR Cas9 genome editing: the DNA cut and what happens after cleavage", "CRISPR Cas9 genome editing begins with a DNA cut. This review follows the cleavage event: guide RNA directed Cas9 binding to DNA, double strand DNA cleavage, and the repair pathways that resolve the break. It compares cleavage efficiency across guide designs and DNA contexts and summarizes how the DNA cut is converted into a permanent genome edit in cells.", 1900, 2025, "Cell"],
  ["r4", "Structural basis of CRISPR Cas9 guide RNA recognition and DNA cleavage", "Crystal and cryo electron microscopy structures reveal how CRISPR Cas9 recognizes guide RNA and cleaves DNA. The guide RNA scaffold docks into Cas9, the seed region interrogates DNA for a matching protospacer, and DNA unwinding positions both strands for cleavage by the two nuclease domains. The structural basis of DNA cleavage specificity is reviewed in detail.", 1750, 2024, "Nature"],
  ["r5", "How CRISPR Cas9 cuts DNA: conformational checkpoints before cleavage", "How does CRISPR Cas9 cut DNA without cutting the wrong DNA? This review describes the checkpoints: guide RNA and Cas9 first survey DNA for the protospacer adjacent motif, then DNA unwinding and guide pairing proceed stepwise, and only a fully paired guide licenses the nuclease domains to cleave both DNA strands. Mismatched DNA stalls before cleavage, which explains specificity.", 1500, 2026, "Molecular Cell"],
  ["r6", "Guide RNA design for efficient CRISPR Cas9 DNA cleavage in human cells", "Guide RNA design determines how efficiently CRISPR Cas9 cleaves DNA in human cells. Sequence features of the guide, DNA accessibility, and Cas9 delivery are compared across large cleavage datasets. Rules are derived for choosing guides that maximize DNA cutting at the intended site while minimizing cleavage at similar DNA sequences elsewhere in the genome.", 1400, 2025, "Nature Biotechnology"],
  ["r7", "DNA cleavage by CRISPR Cas9: single molecule measurements of cutting kinetics", "Single molecule measurements watch CRISPR Cas9 cut DNA in real time. Cas9 bound to guide RNA searches DNA, pauses at protospacer adjacent motifs, unwinds the DNA duplex, and cleaves the two strands in a defined order. Dwell times at each step are reported, giving a kinetic mechanism for DNA cleavage by the CRISPR Cas9 nuclease.", 1200, 2024, "Science"],
  ["r8", "CRISPR Cas9 DNA repair outcomes: how cells fix the Cas9 cut", "After CRISPR Cas9 cleaves DNA, the cell repairs the double strand break. This review catalogs repair outcomes at Cas9 cut sites across cell types: small insertions and deletions, large deletions, and templated repair using a supplied DNA donor. Predicting which outcome follows DNA cleavage is now possible from the guide RNA sequence and the DNA around the cut.", 1100, 2025, "Nature"],
].map(([id, t, a, c, y, j]) => epmc14(id, t, a, c, y, j));

const LANE_EPMC_14 = [{
  title: J2_TITLE, doi: "10.1000/w14-jinek", pubYear: "2012", citedByCount: null,
  authorString: "Jinek M, Chylinski K, Fonfara I, Hauer M, Doudna JA, Charpentier E",
  journalTitle: "Science", abstractText: "",
}];
const LANE_OA_14 = [{
  title: J2_TITLE, doi: "https://doi.org/10.1000/w14-jinek", publication_year: 2012,
  cited_by_count: 9500,
  authorships: [{ author: { display_name: "Jinek M" } }],
  primary_location: { source: { display_name: "Science" }, landing_page_url: "https://example.org/j2" },
  abstract_inverted_index: inverted(J2_ABSTRACT), type: "article",
}];
const LANE_S2_14 = [{
  title: J2_TITLE, abstract: J2_ABSTRACT, year: 2012, citationCount: 9500,
  authors: [{ name: "Jinek M" }], venue: "Science", externalIds: { DOI: "10.1000/w14-jinek" },
}];
const CRISPR_ANSWER_14 = "CRISPR Cas9 cuts DNA when a guide RNA leads the Cas9 protein to a matching DNA sequence and Cas9 cleaves both strands of the DNA, making a double strand break at that spot. [1][2]\n\n**How the cut happens:**\n\n- **Guided targeting:** the guide RNA recognizes the target DNA next to a short motif, positioning the Cas9 endonuclease for cleavage of the DNA, and recent reviews of CRISPR Cas9 genome editing describe the same guided targeting step [1][2].\n- **Two strand cuts:** the nuclease domains of Cas9 each cleave one strand of the DNA, so the break goes through both strands, and the cell then repairs the broken DNA, which is where the edit becomes permanent [1][2].\n- **Why it is precise:** because the guide RNA is what recognizes the target, changing the guide changes where Cas9 cuts the DNA, a point the primary description of the system and the later reviews both make [1][2].";

await test("the founding paper survives a validator that marks it IRRELEVANT, and its fate names presentation", async () => {
  scenPapers = CRISPR_POOL_14;
  scenLaneEpmc = LANE_EPMC_14;
  scenLaneOpenAlex = LANE_OA_14;
  scenLaneS2 = LANE_S2_14;
  scenAnswer = CRISPR_ANSWER_14;
  scenValidatorMode = "reject-founding";
  const { data } = await runScenario("how does crispr cas9 cut dna");
  const titles = (data.sources || []).map((s) => s.title);
  assert.ok(titles.includes(J2_TITLE),
    "the validator removed the founding paper and the restore did not return it: " + titles.join(" | "));
  const fates = (data._record && data._record.funnel && data._record.funnel.foundationalFates) || [];
  const fate = fates.find((f) => f.title === J2_TITLE);
  assert.ok(fate, "the record carries no fate for the founding paper: " + JSON.stringify(fates));
  assert.equal(fate.endedAt, null, "the restored primary's fate still names an ending: " + fate.endedAt);
  assert.equal(fate.steps.validation, true,
    "the restored primary is not recorded as surviving validation: " + JSON.stringify(fate.steps));
  assert.equal(fate.presented, true, "the restored primary is not recorded as presented");
  assert.equal(fate.presentedVia, "evidence",
    "the restored primary presented somewhere other than the evidence list: " + fate.presentedVia);
  assert.ok(data._ledger && data._ledger.used <= 50 &&
    data._ledger.used + data._ledger.remaining === data._ledger.limit,
    "the ledger does not close at its limit on the validator run");
});

// ═══════════════════════════════════════════════════════════════
group("Item 1 — handler: a primary the topic pass kills is named by the record");

const DOOMED_TITLE = "A restriction endonuclease from a soil bacterium: purification and strand cleavage";
const DOOMED_ABSTRACT = "A nuclease from a soil bacterium was purified and characterized. The enzyme performs cleavage of plasmid strands in vitro, and its catalytic domain was mapped by mutagenesis. Strand cleavage required magnesium ions, and the reaction rate was measured across a range of temperatures and salt conditions.";
const DOOMED_DOI = "10.1000/w14-doomed";

await test("a lane primary that dies at the topic overlap pass ends at passes, with its pass stamp recorded", async () => {
  scenPapers = CRISPR_POOL_14;
  scenLaneEpmc = [{
    title: DOOMED_TITLE, doi: DOOMED_DOI, pubYear: "2011", citedByCount: null,
    authorString: "Doe J", journalTitle: "Science", abstractText: "",
  }];
  scenLaneOpenAlex = [{
    title: DOOMED_TITLE, doi: "https://doi.org/" + DOOMED_DOI, publication_year: 2011,
    cited_by_count: 8000,
    authorships: [{ author: { display_name: "Doe J" } }],
    primary_location: { source: { display_name: "Science" }, landing_page_url: "https://example.org/doomed" },
    abstract_inverted_index: inverted(DOOMED_ABSTRACT), type: "article",
  }];
  scenLaneS2 = [{
    title: DOOMED_TITLE, abstract: DOOMED_ABSTRACT, year: 2011, citationCount: 8000,
    authors: [{ name: "Doe J" }], venue: "Science", externalIds: { DOI: DOOMED_DOI },
  }];
  scenAnswer = CRISPR_ANSWER_14;
  scenValidatorMode = "permissive";
  const { data } = await runScenario("how does crispr cas9 cut dna");
  const titles = (data.sources || []).map((s) => s.title);
  assert.ok(!titles.includes(DOOMED_TITLE),
    "the soil bacterium nuclease paper reached the presented list");
  const lane = (data._record && data._record.funnel && data._record.funnel.foundationalLane);
  assert.ok(lane && lane.fired === true,
    "the foundational lane did not fire on the brief's exact wording: " + JSON.stringify(lane || null));
  const fates = (data._record && data._record.funnel && data._record.funnel.foundationalFates) || [];
  const fate = fates.find((f) => f.title === DOOMED_TITLE);
  assert.ok(fate, "the record carries no fate for the doomed primary: " + JSON.stringify(fates));
  assert.equal(fate.steps.filters, true,
    "the doomed primary did not survive to the passes: " + JSON.stringify(fate.steps));
  assert.equal(fate.steps.passes, false,
    "the doomed primary is recorded as surviving the passes it died at");
  assert.equal(fate.endedAt, "passes",
    "the record does not name the topic overlap pass as the ending: " + fate.endedAt);
  assert.ok(typeof fate.passReason === "string" && /Paper (touches none|shares none)/.test(fate.passReason),
    "the pass's own stamp is not recorded as passReason: " + JSON.stringify(fate.passReason || null));
  assert.equal(fate.presented, false, "the doomed primary is recorded as presented");
  assert.ok(data._ledger && data._ledger.used <= 50 &&
    data._ledger.used + data._ledger.remaining === data._ledger.limit,
    "the ledger does not close at its limit on the passes run");
});

// ═══════════════════════════════════════════════════════════════
group("Item 2 — paperTitleAnnouncesDevice (unit)");

await test("device announcing titles match the pattern families", () => {
  const trues = [
    "Blue light-emitting diodes based on colloidal quantum dots with reduced surface-bulk defect states",
    "High-efficiency sky-blue perovskite light-emitting diodes",
    "Perovskite solar cells with record efficiency",
    "Laser diode pumped solid state lighting",
    "Efficient OLED devices for display lighting",
  ];
  for (const title of trues) {
    assert.equal(paperTitleAnnouncesDevice({ title }), true,
      "a device announcing title did not match: " + title);
  }
});

await test("non device titles do not match, including the bare display and led verb traps", () => {
  const falses = [
    "Rayleigh scattering and the color of the sky",
    "Measuring CRISPR Cas9 DNA cleavage: assays for the cut",
    "A spectrometer study of the daytime sky",
    "Courtship display and mate choice in birds",
    "Led by example: leadership in research teams",
  ];
  for (const title of falses) {
    assert.equal(paperTitleAnnouncesDevice({ title }), false,
      "a non device title matched the device patterns: " + title);
  }
  assert.equal(paperTitleAnnouncesDevice({ title: "" }), false,
    "an empty title announced a device");
  assert.equal(paperTitleAnnouncesDevice(null), false,
    "a missing paper announced a device");
});

// ═══════════════════════════════════════════════════════════════
group("Item 2 — paperTailDeviceBarred (unit)");

const SKY_Q_14 = "why is the sky blue";
const LED_TITLE_14 = "Blue light-emitting diodes based on colloidal quantum dots with reduced surface-bulk defect states";
const LED_ABSTRACT_14 = "Colloidal quantum dot light emitting diodes emit blue light with high efficiency. Surface passivation reduces defect states and improves the operational stability of the blue emission in electroluminescent devices driven at high brightness.";
const LED_SPECIMEN_14 = { title: LED_TITLE_14, abstract: LED_ABSTRACT_14 };

await test("the live LED specimen is barred: its abstract engages no subject", () => {
  const dyn = dynFor(SKY_Q_14);
  const concepts = questionCentralConcepts(SKY_Q_14, dyn);
  assert.ok(concepts.length >= 2,
    "the fixture's precondition failed: the sky question resolves fewer than two central concepts");
  const abstractHits = centralConceptHits({ ...LED_SPECIMEN_14, title: "" }, concepts);
  assert.equal(abstractHits.subjectHit, false,
    "the fixture's precondition failed: the LED abstract engages the subject after all");
  // Precondition, stated honestly: the brief assumed this
  // specimen passes the wave thirteen company rule (its
  // abstract engaging blue and light as two central
  // concepts). Under the deterministic lookup this suite
  // builds, the sky question resolves exactly two central
  // concepts (the sky subject and blue), light is not one of
  // them, and the wave thirteen suite already pins this
  // exact specimen as failing paperTitleEngagesConcepts
  // there. So offline the company rule already bars it, and
  // the device rule is the layer that bars it under the
  // live expansion state the brief observed, where it did
  // present. The discriminating case where title engagement
  // passes and the device rule alone bars is the next test.
  assert.equal(paperTitleEngagesConcepts(LED_SPECIMEN_14, SKY_Q_14, dyn), false,
    "the wave thirteen verdict on the live LED specimen moved under the deterministic lookup");
  assert.equal(paperTailDeviceBarred(LED_SPECIMEN_14, SKY_Q_14, dyn), true,
    "the live LED specimen is not barred by the device rule");
});

await test("a device paper that passes title engagement is still barred when its abstract engages no subject", () => {
  // Adjusted fixture (the brief's adjustment instruction):
  // same device family and same abstract as the live
  // specimen, with the title also carrying the subject word
  // as a non adjacent label (a sky simulation chamber is an
  // application context, not engagement with the sky). That
  // title genuinely engages two central concepts across
  // title and abstract, so paperTitleEngagesConcepts passes
  // it, while its abstract still engages no subject at all,
  // so the device rule alone closes the gap.
  const dyn = dynFor(SKY_Q_14);
  const variant = {
    title: "Blue light-emitting diodes with reduced surface-bulk defect states for sky simulation chambers",
    abstract: LED_ABSTRACT_14,
  };
  assert.equal(paperTitleEngagesConcepts(variant, SKY_Q_14, dyn), true,
    "the adjusted fixture does not pass the wave thirteen company rule, so it cannot discriminate the device rule");
  assert.equal(paperTailDeviceBarred(variant, SKY_Q_14, dyn), true,
    "a device paper passing title engagement with no abstract subject engagement is not barred");
});

await test("a device titled paper whose abstract engages the subject is not barred", () => {
  const dyn = dynFor(SKY_Q_14);
  const concepts = questionCentralConcepts(SKY_Q_14, dyn);
  const solar = {
    title: "Solar cell calibration under open sky conditions",
    abstract: "Photovoltaic reference cells were calibrated under the daytime sky. Rayleigh scattering shapes the spectrum of sunlight reaching the cells, and measurements across the sky track how scattered light changes with solar angle and atmosphere.",
  };
  assert.equal(paperTitleAnnouncesDevice(solar), true,
    "the fixture's precondition failed: the solar cell title does not announce a device");
  const abstractHits = centralConceptHits({ ...solar, title: "" }, concepts);
  assert.equal(abstractHits.subjectHit, true,
    "the fixture's precondition failed: the solar abstract does not engage the sky subject");
  assert.equal(paperTailDeviceBarred(solar, SKY_Q_14, dyn), false,
    "a device titled paper engaging the subject in its abstract was barred");
});

await test("a non device sky paper is not barred, whatever its abstract", () => {
  const dyn = dynFor(SKY_Q_14);
  const plain = {
    title: "Rayleigh scattering and the color of the sky",
    abstract: "The blue color of the sky is explained by Rayleigh scattering. Air molecules scatter short wavelength blue light far more strongly than longer wavelengths.",
  };
  assert.equal(paperTailDeviceBarred(plain, SKY_Q_14, dyn), false,
    "a paper whose title announces no device was barred by the device rule");
});

await test("a single concept question is exempt, and a garbage lookup fails open", () => {
  // A genuine single concept construction: this question
  // resolves exactly one central concept under the suite's
  // deterministic lookup, so it has no distinct subject for
  // a device abstract to engage.
  const singleQ = "how does photosynthesis work";
  const singleDyn = dynFor(singleQ);
  assert.equal(questionCentralConcepts(singleQ, singleDyn).length, 1,
    "the single concept fixture no longer resolves exactly one central concept");
  assert.equal(paperTailDeviceBarred(LED_SPECIMEN_14, singleQ, singleDyn), false,
    "a device paper was barred on a single concept question");
  // Fail open arm, pinned the same way: a garbage lookup
  // makes the concept resolution throw, and the rule must
  // return false rather than break the tail.
  assert.equal(paperTailDeviceBarred(LED_SPECIMEN_14, SKY_Q_14, "garbage"), false,
    "the device rule did not fail open on a garbage lookup");
});

// ═══════════════════════════════════════════════════════════════
group("Item 2 — source wiring pin");

await test("the tail filter calls paperTailDeviceBarred on the non primary branch only", () => {
  assert.ok(src.includes("paperTailDeviceBarred(p, query, _dynForValidation)"),
    "the tail filter does not call paperTailDeviceBarred");
  assert.ok(src.includes("return paperTitleEngagesConcepts(p, query, _dynForValidation)\n              && !paperTailDeviceBarred(p, query, _dynForValidation);"),
    "the tail filter's non primary branch is not the composed title engagement and device rule expression");
});

// ═══════════════════════════════════════════════════════════════
group("Item 2 — handler: the LED specimen stays out of the sky list");

const SKY_POOL_14 = [
  epmc14("sky1", "Why is the sky blue?",
    "The blue color of the sky is explained by Rayleigh scattering. Air molecules scatter short wavelength blue light far more strongly than longer wavelengths, so scattered sunlight reaches the eye from every direction and the sky appears blue. The article also explains why the sky pales near the horizon and why sunsets turn red.", 210, "2006"),
  epmc14("sky2", "Rayleigh scattering and the color of the sky: measurements and models",
    "Measurements of the spectrum of scattered sunlight confirm that air molecules scatter light with an intensity that follows the inverse fourth power of the wavelength, the signature of Rayleigh scattering. The models reproduce the observed blue of the daytime sky and its variation with solar angle and aerosol load.", 480, "2015"),
  epmc14("sky3", "Painting the sky: an evaluation of how artists render daylight color",
    "This evaluation studies how landscape painters across three centuries have rendered the color of the sky. It analyzes the perceptual choices in their treatment of daylight, comparing painted skies with the colors observers report, and discusses what the paintings reveal about color perception rather than about optics.", 95, "2007"),
  epmc14("sky4", "Aerosols and the whitening of the daytime sky near the horizon",
    "Aerosol particles scatter sunlight across all wavelengths, which whitens the blue of the sky near the horizon on hazy days. Field measurements relate particle counts to the measured paling, extending the molecular scattering account to real atmospheres.", 130, "2019"),
  epmc14("led1", LED_TITLE_14, LED_ABSTRACT_14, 180, "2023"),
];
const SKY_ANSWER_14 = "The sky is blue because of **Rayleigh scattering**: air molecules scatter short wavelength blue light far more strongly than longer wavelengths, so scattered sunlight reaches the eye from every direction and the sky appears blue [1][2].\n\nThe same scattering explains why the sky pales near the horizon and why sunsets turn red: light from those directions has crossed more air, and aerosol particles scatter all wavelengths, whitening the blue near the horizon [1][4].";

await test("the LED specimen is absent from the presented sky list and genuine sky papers present", async () => {
  scenPapers = SKY_POOL_14;
  scenLaneEpmc = [];
  scenLaneOpenAlex = [];
  scenLaneS2 = [];
  scenAnswer = SKY_ANSWER_14;
  scenValidatorMode = "permissive";
  const { data } = await runScenario("why is the sky blue");
  const titles = (data.sources || []).map((s) => s.title);
  assert.ok(!titles.includes(LED_TITLE_14),
    "the LED specimen reached the presented sky list: " + titles.join(" | "));
  const genuine = titles.filter((t) =>
    t === "Why is the sky blue?" ||
    t.startsWith("Rayleigh scattering and the color of the sky") ||
    t.startsWith("Aerosols and the whitening"));
  assert.ok(genuine.length >= 2,
    "fewer than two genuine sky papers presented: " + titles.join(" | "));
  assert.ok(data._ledger && data._ledger.used <= 50 &&
    data._ledger.used + data._ledger.remaining === data._ledger.limit,
    "the ledger does not close at its limit on the sky device run");
});

console.log(`\nsearch-wave-fourteen: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
