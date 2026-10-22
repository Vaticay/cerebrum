/**
 * Retrieval budget and ladder (2026-10-22, logic audit L2-2 and L2-3).
 *
 * The audit's signature across all 34 saved probe records:
 * retrievalRefused 5 to 10 per run with exactly one executed rung.
 * Two defects produced it. L2-2: the subrequest budget could not
 * fund the fanout it scheduled, and a fetcher whose ledger grant
 * was refused was caught inside the fetcher, returned as an empty
 * list, and recorded by the rung recorder as a fulfilled zero, so
 * a source that was never searched read as a source that answered
 * with nothing. L2-3: raw paper count was treated as retrieval
 * success, so the ladder stopped loosening at 8 raw papers and
 * every fallback net gated on raw counts, while inside europePMC
 * and pubmed the better query forms fired only when the first
 * form returned exactly zero rows.
 *
 * What is pinned here, at the smallest exported unit carrying
 * each decision (gatherPapers and its rung recorder are not
 * exported, so the handler is not driven; the units below are
 * the exact functions those internals call):
 *   1. planFanoutFunding: the whole fanout is priced before it
 *      fires, sources fund in priority order, a pair that does
 *      not fit is skipped (not fired, and named in notFunded,
 *      which runFanoutPairs settles as status "not_searched").
 *   2. The record: buildSearchRecord carries a not searched
 *      source as not searched (never ok, never a zero yield
 *      answer) and carries the run's real refusal counts in
 *      retrievalBudget when the gather stamped them.
 *   3. The ladder continuation signal: countOnTopicPapers against
 *      RETRIEVAL_CITABLE_FLOOR, the pair the ladder break and
 *      every fallback gate now read. Eight or more raw papers
 *      scoring zero on topic do not meet the floor; the floor
 *      being met is what stops the loosening.
 *   4. The fetcher internal fallback: fetcherRowsNeedFallback
 *      (the documented proxy both fetchers consult), plus
 *      mocked fetch behaviour of the exported europePMC and
 *      pubmed: the structured form fires when the first form
 *      returns only off topic rows, and does not fire when the
 *      first form returns on topic rows.
 *
 * Run with: node tests/retrieval-budget-ladder.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const {
  planFanoutFunding,
  FANOUT_PAIR_COSTS,
  retrievalHeadroomOf,
  createSubrequestLedger,
  countOnTopicPapers,
  RETRIEVAL_CITABLE_FLOOR,
  fetcherRowsNeedFallback,
  fetcherRowsOnTopicCount,
  europePMC,
  pubmed,
  buildSearchRecord,
} = await import("../functions/api/search.js");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const searchSrc = await readFile(join(root, "functions/api/search.js"), "utf8");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL - ${name}: ${err.message}`);
  }
}

const ROSTER = ["europePMC", "pubmed", "openAlex", "openAlexCommon", "crossref", "arxiv",
  "semanticScholar", "doaj", "biorxiv", "plos", "CORE", "BASE", "pmcFullText", "openAire", "preprints"];

// ── 1. Fanout pricing and funding (L2-2) ─────────────────────

await test("the full fanout roster is priced, and the priced total fits the rung cost", () => {
  for (const name of ROSTER) assert.equal(typeof FANOUT_PAIR_COSTS[name], "number", name);
  const plan = planFanoutFunding(ROSTER, null);
  // europePMC 3 (its query formulations) + pubmed 4 (esearch
  // formulations plus efetch) + 1 for every other fetcher.
  assert.equal(plan.totalCost, 20);
  assert.equal(plan.funded.length, ROSTER.length);
  assert.equal(plan.notFunded.length, 0);
});

await test("no ledger pricing the rung funds every pair, as before", () => {
  const plan = planFanoutFunding(ROSTER, null);
  assert.deepEqual(plan.funded, ROSTER);
  const planUndef = planFanoutFunding(ROSTER, undefined);
  assert.deepEqual(planUndef.funded, ROSTER);
});

await test("funding walks priority order and funds first calls until the headroom runs out", () => {
  // Headroom 5 funds the first five first calls in pairs list
  // order; the rest of the roster is not fired and is named in
  // notFunded, which the rung runner records as not searched.
  const plan = planFanoutFunding(ROSTER, 5);
  assert.deepEqual(plan.funded, ["europePMC", "pubmed", "openAlex", "openAlexCommon", "crossref"]);
  assert.equal(plan.fundedCost, 5);
  assert.equal(plan.totalCost, 20, "the plan still prices the whole fanout, internal calls included");
  assert.ok(plan.notFunded.includes("preprints"));
  // Every name is accounted for exactly once across the two lists.
  assert.deepEqual([...plan.funded, ...plan.notFunded].sort(), [...ROSTER].sort());
});

await test("a clinical or headroom short rung funds the priority trio first", () => {
  const plan = planFanoutFunding(ROSTER, 8, { prioritizeTrio: true });
  assert.deepEqual(plan.priorityOrder.slice(0, 4), ["pubmed", "europePMC", "openAlex", "openAlexCommon"]);
  // The trio's first calls are funded before any long tail source
  // sees a grant, so the sequential PubMed fetcher and the two
  // OpenAlex queries are never the plan's casualties.
  assert.deepEqual(plan.funded.slice(0, 4), ["pubmed", "europePMC", "openAlex", "openAlexCommon"]);
  assert.equal(plan.funded.length, 8);
});

await test("zero headroom funds nothing, so every source is recorded not searched", () => {
  const plan = planFanoutFunding(ROSTER, 0);
  assert.deepEqual(plan.funded, []);
  assert.deepEqual(plan.notFunded, ROSTER);
});

await test("the ledger headroom a rung prices against is the tighter ceiling distance", () => {
  const ledger = createSubrequestLedger();
  ledger.beginRetrievalPhase();
  try {
    // Fresh ledger: the retrieval ceiling (23) binds before the
    // invocation total (50) does.
    assert.equal(retrievalHeadroomOf(ledger), 23);
    for (let i = 0; i < 18; i++) ledger.spend();
    assert.equal(retrievalHeadroomOf(ledger), 5);
    const plan = planFanoutFunding(ROSTER, retrievalHeadroomOf(ledger));
    assert.deepEqual(plan.funded, ["europePMC", "pubmed", "openAlex", "openAlexCommon", "crossref"]);
  } finally {
    ledger.endRetrievalPhase();
  }
  assert.equal(retrievalHeadroomOf(null), null);
});

// ── 2. The record says not searched (L2-2) ───────────────────

await test("a source the funding never reached is recorded not searched, not answered zero", () => {
  const record = buildSearchRecord({
    question: "how does crispr cas9 cut dna",
    diag: {
      sourceOutcomes: [
        { source: "europePMC", ok: true, count: 5, attempts: 1, notSearched: 0 },
        { source: "pubmed", ok: false, count: 0, attempts: 0, notSearched: 2 },
      ],
      funnel: { gathered: 5, deduped: 5, ranked: 5 },
      retrievalBudget: {
        retrievalRefused: 7, retrievalSpent: 23, retrievalAllowance: 23,
        notSearchedSources: ["pubmed"],
      },
    },
    sources: [],
  });
  assert.ok(record, "record builds");
  const pubmedEntry = record.databases.find((d) => d.source === "pubmed");
  assert.equal(pubmedEntry.ok, false);
  assert.equal(pubmedEntry.count, 0);
  assert.equal(pubmedEntry.notSearched, 2);
  const epmcEntry = record.databases.find((d) => d.source === "europePMC");
  assert.equal(epmcEntry.ok, true);
  assert.ok(!("notSearched" in epmcEntry), "a searched source carries no notSearched field");
  // The run's refusal counts are the ledger's own, carried whole.
  assert.deepEqual(record.retrievalBudget, {
    retrievalRefused: 7, retrievalSpent: 23, retrievalAllowance: 23,
    notSearchedSources: ["pubmed"],
  });
});

await test("a run with no refusals recorded carries no retrievalBudget field", () => {
  const record = buildSearchRecord({
    question: "how does crispr cas9 cut dna",
    diag: {
      sourceOutcomes: [{ source: "europePMC", ok: true, count: 5, attempts: 1 }],
      funnel: { gathered: 5, deduped: 5, ranked: 5 },
    },
    sources: [],
  });
  assert.ok(record, "record builds");
  assert.ok(!("retrievalBudget" in record));
  assert.ok(!("notSearched" in record.databases[0]));
});

await test("the rung runner and recorder carry the not searched state (source pin)", () => {
  assert.ok(searchSrc.includes("planFanoutFunding(pairs.map((p) => p.name), available"),
    "runFanoutPairs prices the rung through planFanoutFunding before firing");
  assert.ok(searchSrc.includes('status: "not_searched"'),
    "an unfunded pair settles with the not_searched status");
  assert.ok(searchSrc.includes('notSearched: r.status === "not_searched"'),
    "recordRungResults records the status as notSearched");
  assert.ok(searchSrc.includes("diag.retrievalBudget = {"),
    "the gather stamps the ledger counts on the diag");
});

// ── 3. The ladder continuation signal (L2-3) ─────────────────

const CRISPR_Q = "how does crispr cas9 cut dna";
const onTopicPaper = (n) => ({
  title: "CRISPR Cas9 DNA cleavage study " + n,
  abstract: "The Cas9 endonuclease cleaves DNA guided by a guide RNA. " +
    "CRISPR Cas9 cutting of DNA requires the guide and the Cas9 protein, study " + n + ".",
  url: "https://doi.org/10.1000/crispr." + n,
  year: "2020",
});
const offTopicPaper = (n) => ({
  title: "Soil moisture and irrigation scheduling study " + n,
  abstract: "Irrigation scheduling for maize fields under drought conditions " +
    "and fertilizer regimes, with soil moisture sensors, trial " + n + ".",
  url: "https://doi.org/10.1000/soil." + n,
  year: "2021",
});

await test("8 or more raw papers scoring zero on topic do not meet the citable floor", () => {
  const raw = Array.from({ length: 9 }, (_, i) => offTopicPaper(i));
  assert.ok(raw.length >= 8, "the old raw count rule stopped here");
  const onTopic = countOnTopicPapers(raw, CRISPR_Q, null);
  assert.equal(onTopic, 0);
  assert.ok(onTopic < RETRIEVAL_CITABLE_FLOOR,
    "the ladder break and every fallback gate read this pair, so retrieval continues");
});

await test("the citable floor being met is what stops the loosening", () => {
  const raw = Array.from({ length: RETRIEVAL_CITABLE_FLOOR }, (_, i) => onTopicPaper(i));
  const onTopic = countOnTopicPapers(raw, CRISPR_Q, null);
  assert.ok(onTopic >= RETRIEVAL_CITABLE_FLOOR,
    "expected at least the floor of on topic papers, got " + onTopic);
});

await test("duplicate records of one paper count once toward the floor", () => {
  const p = onTopicPaper(1);
  assert.equal(countOnTopicPapers([p, p, p], CRISPR_Q, null), 1);
});

await test("a compound question counts a paper that clears one clause's standard", () => {
  // The full question standard can demand engagement with both
  // clauses at once, which neither primary below shows; each
  // still answers one clause of the question, so both count.
  const jinek = {
    title: "A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity",
    abstract: "Clustered regularly interspaced short palindromic repeats (CRISPR) and CRISPR associated (Cas) proteins form an adaptive immune system in bacteria and archaea. Here we show that Cas9 is a dual RNA guided DNA endonuclease. Cas9 is guided by a crRNA and a tracrRNA to a target DNA sequence, where its two nuclease domains cleave each strand of the DNA and generate a double strand break. Guide RNA recognition of the target determines where cleavage occurs. These findings establish the mechanism by which the CRISPR Cas system recognizes and cuts foreign DNA.",
    url: "https://doi.org/10.1000/w2-jinek", year: "2012",
  };
  const pcrPrimary = {
    title: "Enzymatic amplification of beta-globin genomic sequences and restriction site analysis",
    abstract: "A method for amplifying DNA sequences in vitro is described. Cycles of denaturation, primer annealing, and extension by a thermostable DNA polymerase double the amount of the target template in each cycle, producing exponential amplification of the segment defined by the two primers. The polymerase chain reaction (PCR) allows a specific DNA strand to be copied many times from a complex template mixture.",
    url: "https://doi.org/10.1000/w2-pcr", year: "1987",
  };
  const q = "how does crispr cas9 cut dna and how does pcr amplify dna";
  assert.equal(countOnTopicPapers([jinek, pcrPrimary], q, null), 2,
    "single clause papers on a compound question must count as on topic");
});

await test("every fallback gate reads the on topic count (source pin)", () => {
  for (const needle of [
    "onTopicOf(accumulated) >= RETRIEVAL_CITABLE_FLOOR",
    "onTopicSoFar < RETRIEVAL_CITABLE_FLOOR",
    "onTopicAfterRaw < RETRIEVAL_CITABLE_FLOOR",
    "onTopicBeforeBroad < RETRIEVAL_CITABLE_FLOOR",
    "onTopicAfterConcept < RETRIEVAL_CITABLE_FLOOR",
    "onTopicAfterExpand < RETRIEVAL_CITABLE_FLOOR",
    "onTopicAfterNL < RETRIEVAL_CITABLE_FLOOR",
  ]) {
    assert.ok(searchSrc.includes(needle), "missing gate: " + needle);
  }
});

// ── 4. Fetcher internal fallbacks (L2-3) ─────────────────────

await test("the fetcher proxy: empty rows and off topic rows need the fallback form", () => {
  const q = "sleep apnea treatment";
  assert.equal(fetcherRowsNeedFallback([], q), true);
  const off = [{ title: "Quantum entanglement in superconducting circuits",
    abstractText: "We study qubits and entanglement in superconducting circuits." }];
  assert.equal(fetcherRowsOnTopicCount(off, q), 0);
  assert.equal(fetcherRowsNeedFallback(off, q), true);
  const on = [{ title: "Sleep apnea treatment outcomes",
    abstract: "Patients with sleep apnea received treatment and their outcomes improved." }];
  assert.ok(fetcherRowsOnTopicCount(on, q) >= 1);
  assert.equal(fetcherRowsNeedFallback(on, q), false);
});

const jsonRes = (obj) => ({
  status: 200, ok: true,
  json: async () => obj,
  text: async () => JSON.stringify(obj),
});
const textRes = (s) => ({
  status: 200, ok: true,
  json: async () => { throw new Error("not json"); },
  text: async () => s,
});

await test("europePMC fires its structured form when the first form returns only off topic rows", async () => {
  const realFetch = globalThis.fetch;
  const offRow = {
    title: "Quantum entanglement in superconducting circuits",
    abstractText: "We study qubits and entanglement in superconducting circuits for quantum computing.",
    doi: "10.1000/quantum.1", pubYear: "2022", authorString: "Doe J",
    journalTitle: "Physical Review", citedByCount: 3, source: "MED", id: "1",
  };
  const onRow = {
    title: "Sleep apnea treatment outcomes with CPAP therapy",
    abstractText: "Patients with sleep apnea received treatment. Sleep apnea treatment outcomes improved over one year.",
    doi: "10.1000/sleep.1", pubYear: "2023", authorString: "Roe K",
    journalTitle: "Sleep Medicine", citedByCount: 9, source: "MED", id: "2",
  };
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonRes({ resultList: { result: [calls === 1 ? offRow : onRow] } });
  };
  try {
    const papers = await europePMC("sleep apnea treatment outcomes", 8, null);
    assert.ok(calls >= 2, "the fallback form fired, calls=" + calls);
    assert.equal(papers.length, 1);
    assert.ok(papers[0].title.includes("Sleep apnea"), "the on topic form's rows were adopted");
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("europePMC does not fire a fallback form when the first form is on topic", async () => {
  const realFetch = globalThis.fetch;
  const onRow = {
    title: "Sleep apnea treatment outcomes with CPAP therapy",
    abstractText: "Patients with sleep apnea received treatment. Sleep apnea treatment outcomes improved over one year.",
    doi: "10.1000/sleep.1", pubYear: "2023", authorString: "Roe K",
    journalTitle: "Sleep Medicine", citedByCount: 9, source: "MED", id: "2",
  };
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return jsonRes({ resultList: { result: [onRow] } });
  };
  try {
    const papers = await europePMC("sleep apnea treatment outcomes", 8, null);
    assert.equal(calls, 1);
    assert.equal(papers.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

const pubmedXml = (pmid, title, abstract) =>
  "<PubmedArticleSet><PubmedArticle>" +
  "<PMID>" + pmid + "</PMID>" +
  "<ArticleTitle>" + title + "</ArticleTitle>" +
  "<AbstractText>" + abstract + "</AbstractText>" +
  "<Journal><Title>Sleep Medicine</Title></Journal>" +
  "<PubDate><Year>2023</Year></PubDate>" +
  "</PubmedArticle></PubmedArticleSet>";

await test("pubmed fires its structured form when the fetched records are all off topic", async () => {
  const realFetch = globalThis.fetch;
  const q = "sleep apnea treatment";
  let esearchCalls = 0;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.includes("esearch.fcgi")) {
      esearchCalls++;
      const term = u.searchParams.get("term") || "";
      return jsonRes({ esearchresult: { idlist: [term === q ? "111" : "222"] } });
    }
    if (u.pathname.includes("efetch.fcgi")) {
      const id = u.searchParams.get("id") || "";
      return textRes(id.includes("111")
        ? pubmedXml("111", "Quantum entanglement in superconducting circuits",
            "We study qubits and entanglement in superconducting circuits for quantum computing.")
        : pubmedXml("222", "Sleep apnea treatment outcomes with CPAP",
            "Patients with sleep apnea received treatment. Treatment outcomes for sleep apnea improved."));
    }
    throw new Error("unexpected fetch " + url);
  };
  try {
    const papers = await pubmed(q, 10, "", null);
    assert.ok(esearchCalls >= 2, "the structured esearch fired, esearchCalls=" + esearchCalls);
    assert.equal(papers.length, 1);
    assert.ok(papers[0].title.includes("Sleep apnea"), "the on topic form's papers were adopted");
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("pubmed does not fire a fallback form when the fetched records are on topic", async () => {
  const realFetch = globalThis.fetch;
  const q = "sleep apnea treatment";
  let esearchCalls = 0;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.includes("esearch.fcgi")) {
      esearchCalls++;
      return jsonRes({ esearchresult: { idlist: ["222"] } });
    }
    if (u.pathname.includes("efetch.fcgi")) {
      return textRes(pubmedXml("222", "Sleep apnea treatment outcomes with CPAP",
        "Patients with sleep apnea received treatment. Treatment outcomes for sleep apnea improved."));
    }
    throw new Error("unexpected fetch " + url);
  };
  try {
    const papers = await pubmed(q, 10, "", null);
    assert.equal(esearchCalls, 1);
    assert.equal(papers.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
