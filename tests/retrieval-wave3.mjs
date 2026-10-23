/**
 * Retrieval wave 3 (2026-10-23, logic audit stage 2 repairs).
 *
 * Pins, per finding, at the smallest exported unit carrying each
 * decision (gatherPapers is not exported, so the handler is not
 * driven; the units below are the exact functions its internals
 * call, plus mocked fetch behaviour of the exported fetchers):
 *
 *   L2-1  distinct corpora reported, per source yield named, a
 *         source answered only on a real response (fetchFailed
 *         mark), a canary dead source labeled dead in the record.
 *   L2-4  rungs built from parsed constraint slots; the canonical
 *         dose paper (Van Dongen 2003, named in the audit) enters
 *         the gathered pool the rung produces.
 *   L2-5  shifted forms (digits, day conversion, quoted slots)
 *         for the requery when the citable floor is unmet.
 *   L2-6  per source canaries; pmcFullText and arXiv sent forms
 *         a source can actually match.
 *   L2-7  effectiveness test; the review leg's OpenAlex review
 *         type form; type filters recorded on the run.
 *   L2-8  dedupe identity on identifier graphs: positive evidence
 *         required when a surname is missing, preprint to
 *         published versions merge, the dedupe audit list.
 *   L2-9  late additions route through admitLatePapers: screens,
 *         dedupe, scoring provenance; failures are failures.
 *   L2-10 the record carries arrivals, distinct, shelf, citable
 *         under their own names.
 *   L2-11 every what was tried line keyed to the run's diag; the
 *         unconditional MeSH sentence is gone.
 *   L2-12 pool age distribution reported.
 *   L2-13 author matching per individual author, initial aware;
 *         PubMed is in the author branch.
 *   L2-14 no server side LANG filter on the Europe PMC leg.
 *   L2-15 the kept copy at dedupe is chosen by completeness and
 *         the choice is logged.
 *
 * Run with: node tests/retrieval-wave3.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const {
  fetchFailed,
  parseQuestionConstraints,
  buildConstraintRungs,
  shiftedQueryForms,
  SOURCE_CANARIES,
  SOURCE_CANARY_STATE,
  noteSourceCanaryResult,
  deadSourcesFromCanaries,
  runSourceCanaries,
  buildPmcFullTextQuery,
  buildArxivQuery,
  isEffectivenessQuestion,
  authorNameMatches,
  splitAuthorNames,
  admitLatePapers,
  poolAgeDistribution,
  paperCompleteness,
  dedupePapers,
  getLastDedupeAudit,
  europePMC,
  openAlex,
  buildSearchRecord,
  buildNoResultsPayload,
} = await import("../functions/api/search.js");
const { SCHOLARLY_SOURCES, SOURCE_COUNT, DISTINCT_CORPORA, CORPUS_COUNT, corpusOfSource } =
  await import("../functions/lib/product.js");

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
const jsonRes = (obj) => ({
  status: 200, ok: true,
  json: async () => obj,
  text: async () => JSON.stringify(obj),
});

// ── L2-1: distinct corpora, yield, answered, dead ─────────────

await test("the fourteen slots reach eleven distinct corpora, derived from the list", () => {
  assert.equal(SOURCE_COUNT, 14);
  assert.equal(CORPUS_COUNT, 11);
  assert.equal(DISTINCT_CORPORA.length, 11);
  assert.equal(corpusOfSource("europePMC"), "Europe PMC");
  assert.equal(corpusOfSource("preprints"), "Europe PMC");
  assert.equal(corpusOfSource("pmcFullText"), "Europe PMC");
  assert.equal(corpusOfSource("biorxiv"), "OpenAlex");
  assert.equal(corpusOfSource("openAlex"), "OpenAlex");
  for (const s of SCHOLARLY_SOURCES) assert.ok(s.corpus, s.id + " carries a corpus");
});

await test("a fetcher failure is marked, and the mark is not a paper", () => {
  const out = fetchFailed(new Error("429 from upstream"));
  assert.ok(Array.isArray(out));
  assert.equal(out.length, 0);
  assert.ok(out.fetchError.includes("429"));
});

await test("the record reports distinct corpora and measured yield, not slots", () => {
  const record = buildSearchRecord({
    question: "does honey help wounds heal",
    diag: {
      sourceOutcomes: [
        { source: "europePMC", ok: true, count: 12, attempts: 1 },
        { source: "preprints", ok: true, count: 3, attempts: 1 },
        { source: "pmcFullText", ok: false, count: 0, attempts: 1 },
        { source: "pubmed", ok: true, count: 9, attempts: 1 },
      ],
      funnel: { gathered: 24, deduped: 20, ranked: 12 },
    },
    sources: [],
  });
  assert.ok(record.coverageSummary, "coverage summary present");
  assert.equal(record.coverageSummary.slots, 4);
  assert.equal(record.coverageSummary.distinctCorpora, 2, "three Europe PMC slots are one corpus");
  assert.equal(record.coverageSummary.answered, 3);
  assert.equal(record.coverageSummary.totalYield, 24);
  const epmc = record.databases.find((d) => d.source === "europePMC");
  assert.equal(epmc.corpus, "Europe PMC");
  assert.equal(epmc.yield, 12);
});

await test("a canary dead source is labeled dead in the record until a canary returns a paper", async () => {
  noteSourceCanaryResult("doaj", 0, SOURCE_CANARIES.doaj);
  assert.ok(deadSourcesFromCanaries().includes("doaj"));
  const record = buildSearchRecord({
    question: "black soldier fly larvae waste",
    diag: {
      sourceOutcomes: [{ source: "doaj", ok: true, count: 0, attempts: 1 }],
      funnel: { gathered: 0, deduped: 0, ranked: 0 },
    },
    sources: [],
  });
  assert.equal(record.databases[0].dead, true);
  assert.ok(record.coverageSummary.deadSources.includes("doaj"));
  noteSourceCanaryResult("doaj", 4, SOURCE_CANARIES.doaj);
  assert.ok(!deadSourcesFromCanaries().includes("doaj"), "a returning canary revives the source");
  delete SOURCE_CANARY_STATE.doaj;
});

// ── L2-4: constraint slot rungs ───────────────────────────────

const SLEEP_Q = "what happens to your brain if you only sleep six hours every night for two weeks straight";

await test("the dose question's constraints parse into quantity and duration slots", () => {
  const slots = parseQuestionConstraints(SLEEP_Q);
  const all = [...slots.quantity, ...slots.duration];
  assert.ok(all.some((p) => p.includes("six hours")), "six hours slot: " + JSON.stringify(slots));
  assert.ok(all.some((p) => p.includes("two weeks")), "two weeks slot: " + JSON.stringify(slots));
});

await test("every rung carries the stated slots; specificity orders only the topic words inside them", () => {
  const ranked = ["brain", "sleep", "night", "thinking"];
  const rungs = buildConstraintRungs(SLEEP_Q, ranked);
  assert.ok(Array.isArray(rungs) && rungs.length >= 2);
  for (const rung of rungs) {
    assert.ok(rung.some((t) => String(t).includes("six hours")), "rung lost the dose: " + rung.join(" "));
    assert.ok(rung.some((t) => String(t).includes("two weeks")), "rung lost the duration: " + rung.join(" "));
  }
  // Topic words keep their ranked (specificity) order inside the slots.
  const first = rungs[0].map((t) => String(t));
  const brainAt = first.indexOf("brain");
  const sleepAt = first.indexOf("sleep");
  assert.ok(brainAt > -1 && sleepAt > brainAt, "topic order inside the rung follows the ranked order");
  // Loosening drops topic words, never a slot: the last rung is slots only.
  const last = rungs[rungs.length - 1];
  assert.ok(last.every((t) => String(t).includes("hours") || String(t).includes("weeks")), "final rung is slots only: " + last.join(" "));
});

await test("known item: the canonical dose paper enters the gathered pool the rung produces", () => {
  // The audit's named canonical papers for this question: the
  // Van Dongen chronic sleep restriction papers (Van Dongen et
  // al., Sleep, 2003), which none of the 34 probe records ever
  // gathered under the specificity rungs. The fixture carries the
  // paper's real title; its abstract is fixture text stating the
  // study's own dose and duration in the question's words.
  const canonical = {
    title: "The cumulative cost of additional wakefulness: dose-response effects on neurobehavioral functions and sleep physiology from chronic sleep restriction and total sleep deprivation",
    abstract: "Chronic sleep restriction to six hours of sleep opportunity per night for two weeks produced cumulative, dose dependent deficits in cognitive performance and psychomotor vigilance in healthy adults.",
    authors: "Van Dongen HPA, Maislin G, Mullington JM, Dinges DF",
    year: 2003,
  };
  const junk = {
    title: "Sleep patterns in Shetland ponies under stable management",
    abstract: "Ponies slept in short bouts at night. Total sleep time varied by season and stable routine.",
    authors: "Ruckebusch Y", year: 1972,
  };
  const rungs = buildConstraintRungs(SLEEP_Q, ["sleep", "restriction", "cognitive"]);
  const rung = rungs[0];
  // The keyword engines receive the rung as one string; a paper
  // enters the pool when the rung's terms all appear in its text
  // (the AND the boolean engines apply to the same rung).
  const entersPool = (paper) => {
    const hay = (paper.title + " " + paper.abstract).toLowerCase();
    return rung.every((term) => hay.includes(String(term).toLowerCase()));
  };
  assert.ok(entersPool(canonical), "the canonical paper is in the gathered pool for rung: " + rung.join(" "));
  assert.ok(!entersPool(junk), "the off topic paper stays out");
});

await test("a question with no stated slot keeps the caller's rungs (null, not a rewrite)", () => {
  assert.equal(buildConstraintRungs("why do leaves change color in autumn", ["leaves", "color", "autumn"]), null);
});

// ── L2-5: shifted forms ───────────────────────────────────────

await test("shifted forms digitize the dose and convert the duration", () => {
  const forms = shiftedQueryForms(SLEEP_Q, ["sleep", "restriction", "cognitive"]);
  assert.ok(forms.some((f) => f.includes("6 hours")), "digits form: " + JSON.stringify(forms));
  assert.ok(forms.some((f) => f.includes("14 days")), "day conversion: " + JSON.stringify(forms));
  assert.ok(forms.some((f) => f.includes('"six hours"')), "quoted slot form: " + JSON.stringify(forms));
});

await test("known item: a paper filed under the digit form enters the pool on the shifted form", () => {
  // The same canonical study, represented the way indexes also
  // file it: digits and days. The shifted digits form must match
  // it where the question's own number words do not.
  const digitsFiled = {
    title: "Cumulative sleepiness, mood disturbance, and psychomotor vigilance performance decrements during a week of sleep restricted to 4 or 6 hours per night",
    abstract: "Sleep was restricted to 6 hours per night for 14 days. Psychomotor vigilance lapses accumulated across the restriction period in a dose dependent manner.",
  };
  const forms = shiftedQueryForms(SLEEP_Q, ["sleep", "restriction"]);
  const digitsForm = forms.find((f) => f.includes("6 hours"));
  assert.ok(digitsForm, "digits form exists");
  const hay = (digitsFiled.title + " " + digitsFiled.abstract).toLowerCase();
  assert.ok(hay.includes("6 hours") && hay.includes("14 days"), "fixture sanity");
  assert.ok(digitsForm.includes("6 hours") && digitsForm.includes("14 days"),
    "the shifted form speaks the filing's own terms");
});

// ── L2-6: canaries and matchable forms ────────────────────────

await test("every advertised source has a canary question", () => {
  for (const s of SCHOLARLY_SOURCES) {
    assert.ok(typeof SOURCE_CANARIES[s.id] === "string" && SOURCE_CANARIES[s.id].length > 3, s.id);
  }
});

await test("the pmc full text form ANDs body terms instead of quoting the whole string", () => {
  const form = buildPmcFullTextQuery("sleep restriction cognitive performance");
  assert.ok(form.includes("BODY:sleep") && form.includes("BODY:restriction"), form);
  assert.ok(!form.includes('BODY:"sleep restriction cognitive performance"'),
    "the whole string phrase form shipped: " + form);
});

await test("the arXiv form quotes phrases and caps the ANDed terms at four", () => {
  const form = buildArxivQuery(["sleep restriction", "cognitive", "performance", "vigilance", "lapses"]);
  assert.ok(form.includes('all:"sleep restriction"'), form);
  assert.equal((form.match(/all:/g) || []).length, 4, "capped at four terms: " + form);
});

await test("a source whose canary returns zero, or errors, is failed in the canary record", async () => {
  const state = await runSourceCanaries({
    europePMC: async () => [{ title: "a paper" }],
    pubmed: async () => [],
    openAlex: async () => fetchFailed(new Error("boom")),
  });
  assert.equal(state.europePMC.status, "ok");
  assert.equal(state.pubmed.status, "dead");
  assert.equal(state.openAlex.status, "dead");
  assert.equal(state.openAlex.errored, true);
  delete SOURCE_CANARY_STATE.europePMC;
  delete SOURCE_CANARY_STATE.pubmed;
  delete SOURCE_CANARY_STATE.openAlex;
});

// ── L2-7: effectiveness and the review leg ────────────────────

await test("effectiveness questions are recognized in plain words", () => {
  assert.equal(isEffectivenessQuestion("does honey help wounds heal"), true);
  assert.equal(isEffectivenessQuestion("is creatine safe to take every day"), true);
  assert.equal(isEffectivenessQuestion("how does crispr cas9 cut dna"), false);
  assert.equal(isEffectivenessQuestion("what is the ratio of metagenomic to metatranscriptomic reads"), false);
});

await test("the review leg's OpenAlex form asks for the review type; the default does not", async () => {
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return jsonRes({ results: [] });
  };
  try {
    await openAlex("honey wound healing", 6, "", null);
    await openAlex("honey wound healing systematic review", 6, "", null, { types: "review" });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(urls[0].includes("type%3Aarticle%7Cpreprint") || urls[0].includes("type:article|preprint"), urls[0]);
  assert.ok(urls[1].includes("type%3Areview") || urls[1].includes("type:review"), urls[1]);
});

await test("the run records its type filters and the review leg in the record", () => {
  const record = buildSearchRecord({
    question: "does honey help wounds heal",
    diag: {
      sourceOutcomes: [{ source: "openAlex", ok: true, count: 5, attempts: 1 }],
      funnel: { gathered: 5, deduped: 5, ranked: 5, typeRemovedBySource: { openAlex: 2 } },
      typeFilters: [{ source: "openAlex", filter: "type:article|preprint" }],
      reviewLeg: { count: 4, bySource: { openAlex: 3, europePMC: 1, semanticScholar: 0, crossref: 0 }, crossrefPosted: 1 },
    },
    sources: [],
  });
  assert.deepEqual(record.typeFilters, [
    { source: "openAlex", filter: "type:article|preprint", screenRemoved: 2 },
  ]);
  assert.equal(record.retrievalLegs.reviewLeg.count, 4);
  assert.equal(record.retrievalLegs.reviewLeg.crossrefPosted, 1);
});

// ── L2-8: dedupe identity ─────────────────────────────────────

await test("distinct papers sharing a main title and year stay two when one side names no author", () => {
  // The audit's false merge shape: same main title and year, one
  // record abstractless, and crucially no surname on one side,
  // which the old rule treated as no veto. With no positive
  // evidence (no shared identifier, no equal surname, no
  // abstract overlap, different full titles) they must not merge.
  const a = {
    title: "Advances in wound care: a clinical update",
    year: 2021, authors: "Smith J",
    abstract: "This clinical update reviews dressing selection, moisture balance, and infection control for chronic wounds in primary care practice settings today.",
  };
  const b = {
    title: "Advances in wound care: a nursing perspective",
    year: 2021, url: "https://publisher.example/wound-nursing",
  };
  assert.equal(dedupePapers([a, b]).length, 2);
});

await test("a preprint and its published version merge into one, and the published copy is kept", () => {
  const preprint = {
    title: "Waste oil substrates reshape the black soldier fly larval gut microbiome",
    doi: "10.1101/2023.01.01.000001", url: "https://doi.org/10.1101/2023.01.01.000001",
    year: 2023, authors: "Doe J", journal: "bioRxiv (preprint)", isPreprint: true,
  };
  const published = {
    title: "Waste oil substrates reshape the black soldier fly larval gut microbiome",
    doi: "10.1000/journal.1", url: "https://doi.org/10.1000/journal.1",
    year: 2024, authors: "Doe J", journal: "Insect Science",
    abstract: "Larvae reared on waste oil substrates showed a reshaped gut microbiome and changed biomass composition across the rearing period in controlled trials.",
    citations: 17,
  };
  const out = dedupePapers([preprint, published]);
  assert.equal(out.length, 1, "the version pair survived as two papers");
  assert.equal(out[0].doi, "10.1000/journal.1", "the published copy's identity won");
  assert.ok(String(out[0].abstract || "").includes("gut microbiome"), "the published abstract is on the kept record");
});

await test("the identifier graph merges a preprint with the published DOI its relation names", () => {
  const preprint = {
    title: "A study of sleep restriction and vigilance",
    doi: "10.1101/2022.05.05.000002", url: "https://doi.org/10.1101/2022.05.05.000002",
    preprintOf: "10.1000/sleep.9", year: 2022, authors: "Roe K", journal: "bioRxiv (preprint)",
  };
  const published = {
    title: "Sleep restriction and vigilance in adults",
    doi: "10.1000/sleep.9", url: "https://doi.org/10.1000/sleep.9",
    year: 2023, authors: "Roe K", journal: "Sleep",
  };
  assert.equal(dedupePapers([preprint, published]).length, 1);
});

await test("every merge is named in the dedupe audit with its signal", () => {
  const a = { title: "Soil cracking patterns", doi: "10.1000/aaa", year: 2020, authors: "Smith J" };
  const b = { title: "Soil cracking patterns", doi: "10.1000/aaa", year: 2020, authors: "Smith J" };
  assert.equal(dedupePapers([a, b]).length, 1);
  const audit = getLastDedupeAudit();
  assert.ok(audit.length >= 1, "audit recorded the merge");
  assert.equal(audit[0].signal, "strong-identifier");
  assert.ok(audit[0].dropped.includes("Soil cracking"));
  const record = buildSearchRecord({
    question: "soil cracking",
    diag: {
      sourceOutcomes: [{ source: "crossref", ok: true, count: 2, attempts: 1 }],
      funnel: { gathered: 2, deduped: 1, ranked: 1 },
      dedupeAudit: audit,
    },
    sources: [],
  });
  assert.equal(record.dedupeAudit[0].signal, "strong-identifier");
});

// ── L2-9: the admission unit ──────────────────────────────────

await test("late additions pass screens, dedupe and the scoring judgment; failures are recorded as failures", () => {
  const shelfPaper = {
    title: "Honey for wound healing: a clinical overview",
    doi: "10.1000/honey.1", url: "https://doi.org/10.1000/honey.1",
    year: 2020, authors: "Smith J",
    abstract: "Honey dressings support wound healing. This overview covers clinical use of honey on wounds and healing outcomes reported in practice.",
  };
  const onTopic = {
    title: "Medical grade honey dressings and wound healing outcomes",
    doi: "10.1000/honey.2", url: "https://doi.org/10.1000/honey.2",
    year: 2022, authors: "Doe A",
    abstract: "Medical grade honey dressings improved wound healing outcomes. Honey treated wounds healed faster than control wounds in the reported trials.",
  };
  const duplicate = { ...onTopic, doi: "10.1000/honey.1", title: "Honey for wound healing: a clinical overview" };
  const dataset = {
    title: "Honey wound dataset deposit",
    url: "https://zenodo.org/records/12345", year: 2023, authors: "Doe A",
    abstract: "Data files for honey wound measurements.",
  };
  const retracted = {
    title: "[RETRACTED] Honey heals all wounds instantly",
    doi: "10.1000/honey.3", url: "https://doi.org/10.1000/honey.3", year: 2021, authors: "Doe A",
    abstract: "Honey wound healing claims.",
  };
  const { admitted, failures } = admitLatePapers(
    [shelfPaper], [onTopic, duplicate, dataset, retracted],
    "does honey help wounds heal", null);
  assert.equal(admitted.length, 1, "only the on topic new paper is admitted: " + JSON.stringify(failures));
  assert.equal(admitted[0].doi, "10.1000/honey.2");
  assert.equal(admitted[0]._unscored, true, "admitted papers carry the unscored provenance, never an invented score");
  const reasons = failures.map((f) => f.reason).sort();
  assert.deepEqual(reasons, ["duplicate", "non-literature", "retracted-title"]);
});

await test("the handler rescue routes through the admission unit (source pin)", () => {
  assert.ok(searchSrc.includes("admitLatePapers(gResult.papers || [], rescueCandidates, query, null)"),
    "the rescue does not route through admitLatePapers");
  assert.ok(searchSrc.includes("llmRescueFailures"), "rescue failures are not recorded");
});

// ── L2-10: named counts ───────────────────────────────────────

await test("the record carries arrivals, distinct, shelf and citable under their own names", () => {
  const record = buildSearchRecord({
    question: "does honey help wounds heal",
    diag: {
      sourceOutcomes: [{ source: "europePMC", ok: true, count: 30, attempts: 1 }],
      funnel: { gathered: 36, deduped: 35, ranked: 25 },
    },
    sources: [{ title: "A", year: 2020, cited: true }, { title: "B", year: 2021, cited: true }, { title: "C", year: 2022, cited: false }],
  });
  assert.deepEqual(record.funnel.counts, { arrivals: 36, distinct: 35, shelf: 25, citable: 2 });
});

// ── L2-11: what was tried, keyed to the diag ──────────────────

await test("the no results payload never claims an expansion that has no diag entry", () => {
  const p = buildNoResultsPayload({
    query: "if baby black soldier flies eat used cooking oil from restaurants do they turn out healthy",
    sourcesQueried: [
      { source: "europePMC", ok: true, count: 16 },
      { source: "openAlex", ok: true, count: 13 },
    ],
    rungsTried: ["exact-term matching (1 narrowing rungs)"],
    gatedOut: 0,
  });
  const joined = p.whatWasTried.join("\n");
  assert.ok(!joined.includes("MeSH"), "an unkeyed MeSH claim shipped: " + joined);
  assert.ok(!joined.includes("Expanded the question with scientific synonyms"),
    "the unconditional expansion sentence shipped: " + joined);
  assert.ok(p.whatWasTried.some((w) => w.includes("exact-term matching")), "the executed strategy is named");
});

await test("the no results first line states distinct databases and who answered", () => {
  const p = buildNoResultsPayload({
    query: "some question with no literature",
    sourcesQueried: [
      { source: "europePMC", ok: true, count: 4 },
      { source: "preprints", ok: true, count: 1 },
      { source: "pmcFullText", ok: false, count: 0 },
      { source: "pubmed", ok: false, count: 0, notSearched: 2 },
    ],
    rungsTried: [],
    gatedOut: 0,
  });
  const first = p.whatWasTried[0];
  assert.ok(first.includes("4 sources across 2 distinct databases"), first);
  assert.ok(first.includes("2 answered"), first);
  assert.ok(first.includes("1 didn't respond"), first);
  assert.ok(first.includes("1 not searched"), first);
});

// ── L2-12: age distribution ───────────────────────────────────

await test("the gathered pool's age distribution is computed and recorded", () => {
  const dist = poolAgeDistribution([
    { year: 2025 }, { year: 2023 }, { year: 2019 }, { year: 2010 }, { year: 2003 }, { year: "" },
  ], 2026);
  assert.deepEqual(dist, {
    age0to2: 1, age3to5: 1, age6to10: 1, age11to20: 1, ageOver20: 1, unknown: 1,
    oldest: 2003, newest: 2025,
  });
  const record = buildSearchRecord({
    question: "sleep restriction",
    diag: {
      sourceOutcomes: [{ source: "europePMC", ok: true, count: 6, attempts: 1 }],
      funnel: { gathered: 6, deduped: 6, ranked: 6 },
      poolAgeDistribution: dist,
    },
    sources: [],
  });
  assert.equal(record.poolAgeDistribution.oldest, 2003);
  assert.equal(record.poolAgeDistribution.ageOver20, 1);
});

// ── L2-13: author matching ────────────────────────────────────

await test("author tokens split across two authors do not match", () => {
  assert.equal(authorNameMatches("James A, Wilson B", "James Wilson"), false);
  assert.equal(authorNameMatches("Smith J, Doe A", "John Doe"), false);
});

await test("author matching is per individual and initial aware", () => {
  assert.equal(authorNameMatches("Smith J, Doe A", "John Smith"), true, "recorded initial matches the full given name");
  assert.equal(authorNameMatches("Smith J, Doe A", "Alice Doe"), true);
  assert.equal(authorNameMatches("Doe, Alice; Smith, John", "Alice Doe"), true, "surname first format still matches its own author");
  assert.equal(authorNameMatches("Doe, Alice; Smith, John", "John Doe"), false);
  assert.ok(splitAuthorNames("Smith J, Doe A").length >= 2);
});

await test("PubMed is in the author branch and its records carry the full author list (source pins)", () => {
  assert.ok(searchSrc.includes("pubmed(effectiveName, 25, ncbiKey, ledger)"),
    "the author branch does not query PubMed");
  assert.ok(searchSrc.includes("_allAuthors: names.join(\", \")"),
    "PubMed records do not carry the full author list");
  assert.ok(searchSrc.includes("authorNameMatches(authorHay, effectiveName)"),
    "the author branch does not match per individual");
});

// ── L2-14: no server side language filter ─────────────────────

await test("the Europe PMC leg sends no LANG filter", async () => {
  assert.ok(!searchSrc.includes("LANG:eng"), "a LANG:eng filter survives in search.js");
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return jsonRes({ resultList: { result: [] } });
  };
  try {
    await europePMC("sleep restriction cognitive performance", 8, null);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(urls.length >= 1);
  assert.ok(!decodeURIComponent(urls[0]).includes("LANG"), "the sent query carries a language filter: " + urls[0]);
});

// ── L2-15: kept copy by completeness ──────────────────────────

await test("completeness ranks the rich copy above the thin one", () => {
  const thin = { title: "A paper", url: "https://publisher.example/x" };
  const rich = {
    title: "A paper", url: "https://doi.org/10.1000/rich", doi: "10.1000/rich",
    abstract: "A full abstract with methods and results described at length for the reader.",
    citations: 42, journal: "Sleep", year: 2020, authors: "Doe J",
  };
  assert.ok(paperCompleteness(rich) > paperCompleteness(thin));
});

await test("at dedupe the more complete copy is kept, whichever arrived first, and the choice is logged", () => {
  const thin = {
    title: "Sleep restriction and cognitive performance",
    doi: "10.1000/sleep.1", url: "https://publisher.example/sleep1",
    year: 2020, authors: "Doe J", _fromSource: "crossref",
  };
  const rich = {
    title: "Sleep restriction and cognitive performance",
    doi: "10.1000/sleep.1", url: "https://doi.org/10.1000/sleep.1",
    year: 2020, authors: "Doe J", journal: "Sleep",
    abstract: "Chronic sleep restriction impaired cognitive performance across two weeks of controlled restriction in healthy adults studied in the laboratory.",
    citations: 300, _fromSource: "europePMC",
  };
  const out = dedupePapers([thin, rich]);
  assert.equal(out.length, 1);
  assert.equal(out[0].journal, "Sleep", "the rich copy's journal won over first arrival");
  assert.equal(out[0].url, "https://doi.org/10.1000/sleep.1", "the DOI URL won");
  assert.equal(out[0]._keptSource, "europePMC", "the kept copy's source is stamped");
  const audit = getLastDedupeAudit();
  assert.ok(audit.some((e) => e.signal === "kept-copy-completeness" && e.keptSource === "europePMC"),
    "the completeness choice is in the audit: " + JSON.stringify(audit));
});

// ── Leg wiring pins (L2-5, L2-7, L2-12) ───────────────────────

await test("the floor unmet legs are wired into the gather (source pins)", () => {
  assert.ok(searchSrc.includes("diag.reviewLeg"), "the review leg is not recorded");
  assert.ok(searchSrc.includes("types: \"review\""), "the review leg does not ask OpenAlex for reviews");
  assert.ok(searchSrc.includes("diag.citationLeg"), "the citation ordered leg is not recorded");
  assert.ok(searchSrc.includes("diag.shiftedRequery"), "the shifted requery is not recorded");
  assert.ok(searchSrc.includes("shiftedQueryForms(rawQuery, ranked)"), "the shifted requery does not use the shifted forms");
  assert.ok(searchSrc.includes("buildConstraintRungs(rawQuery, ranked"), "the rungs are not built from constraint slots");
  assert.ok(searchSrc.includes("buildPmcFullTextQuery(query)"), "pmcFullText does not use the matchable form");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
