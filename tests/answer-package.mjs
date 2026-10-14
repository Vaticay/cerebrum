/**
 * Answer package (2026-10-14) — the nine defects the 12 agent audit
 * panel verified on live responses (Answer quality 300, Search
 * retrieval 540):
 *
 *   1. The answer body printed "fact checking did not check any
 *      claims" while the same response's fact check object reported
 *      claims checked. The body line is now composed with the
 *      check's outcome unknown (factCheckChecked null), and the
 *      pipeline appends the check's real result afterwards. Sixth
 *      panel correction (Job 1): on the extractive path that result
 *      is a wording TRACE, not a verification, so the appended
 *      sentence states the trace as a trace and factCheckSupport
 *      counts nothing from it.
 *   2. A long AI answer with zero citations shipped as is. Any
 *      uncited AI answer now retries once with the citation
 *      requirement restated, and a still uncited answer hands the
 *      answer to the extractive tier (synthesis stage record:
 *      "answer had no citations"), marked degraded honestly.
 *   3. One source answers dressed in multi source language. A
 *      single cited source caps confidence at the thin band with
 *      the reason named, and the limits state the single source
 *      plainly even when the pool was wider.
 *   4. Extractive answers quoted first person paper voice ("we
 *      measured", "our study") as Cerebrum's own statements. The
 *      extractive sentence pipelines screen the same phrase class
 *      the AI path's quality scorer penalizes.
 *   5. The same paper shipped as sources 1 and 2 when its records'
 *      identifier families never intersected. Dedupe now also keys
 *      on a core identity: main title plus year plus first author
 *      surname where present, with a differing DOI on both sides
 *      (or a differing surname on both sides) as a veto.
 *   6. Em and en dashes shipped in answer text. deDash now runs in
 *      postProcessAnswer and at the pipeline's run last point (the
 *      one point every answer, extractive included, crosses), and
 *      on both cache serve paths.
 *   7. Species italics failed in extractive answers and in record
 *      page source titles. italicizeScientificTerms now also wraps
 *      validated organism binomials the text itself names (the
 *      curated ORGANISM_BINOMIALS set), collapses __Name__ to
 *      _Name_ instead of stranding raw markers, the record page
 *      restores <i> in titles as real italics, and the Markdown
 *      export translates <i> to the underscore marker.
 *   8. stageHealth said retrieval ok while the record disagreed.
 *      The retrieval stage record is reconciled from the final
 *      diag (the same object the record is built from) once
 *      retrieval settles: one derivation for both surfaces.
 *   9. The fact check starved because bookkeeping writes (the
 *      learning batch, query intelligence, the answer cache) spent
 *      the subrequest tail before it. The check now runs BEFORE
 *      those writes; the writes keep their gates and their ledger
 *      labels, and protect the record store behind them instead.
 *
 * Fixtures use mismatched language per the standing rule: the
 * questions are worded the way a person asks, the papers the way
 * papers are written. The end to end scenario drives the real
 * onRequest with a counting stub env in the subrequest budget
 * suite's shape: every synthesis leg returns the same long uncited
 * answer, so the citation retry fires, fails to fix it, and the
 * extractive tier must ship, with the fact check present.
 *
 * Run with: node tests/answer-package.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const searchSrc = readFileSync(join(root, "functions/api/search.js"), "utf8");
const appSrc = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");

const {
  buildExtractiveSynthesis,
  buildConfidenceLine,
  buildEvidenceGaps,
  verifyExtractiveAlignment,
  factCheckSupport,
  factCheckProvenance,
  appendClaimCheckSentence,
  dedupePapers,
  deDash,
  italicizeScientificTerms,
  reconcileRetrievalStageRecord,
  hasFirstPersonPaperVoice,
  onRequest,
  createSubrequestLedger,
} = await import(join(root, "functions/api/search.js"));
const recordRoute = await import(join(root, "functions/record/[id].js"));

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

// ═══════════════════════════════════════════════════════════════════
group("defect 1 — the body line and the fact check object agree");

const BSFL_PAPERS = [
  { title: "Diet shifts reshape the gut microbiome of Hermetia illucens larvae",
    abstract: "Larvae fed on food waste harboured a gut community dominated by Providencia and Morganella species across all rearing trials. The gut microbiome of Hermetia illucens shifted measurably when the diet changed from chicken feed to food waste, with diversity falling by 32 percent over ten days. Bacillus counts increased significantly in the waste fed group compared with controls.",
    year: 2023, journal: "Waste Management", authors: "Klammsteiner T", citations: 41, relevance: 90 },
  { title: "Microbial succession during black soldier fly rearing on brewery spent grain",
    abstract: "Succession analysis showed that Lactobacillus replaced Leuconostoc as the dominant genus by day six of rearing. Salmonella enterica was never detected in any sample, and total aerobic counts declined steadily during larval development. The findings show that substrate choice governs which microbes persist in the larval gut.",
    year: 2022, journal: "Insects", authors: "Wynants E", citations: 18, relevance: 85 },
];
const BSFL_QUERY = "how does diet change the gut microbiome of black soldier fly larvae";

await test("an extractive body never claims the check checked nothing", () => {
  const md = buildExtractiveSynthesis(BSFL_PAPERS, null, { query: BSFL_QUERY, queryAnalysis: null });
  assert.ok(md, "expected an extractive synthesis");
  assert.ok(!md.includes("did not check any claims"),
    "the pre check body asserted the check's outcome: " + md);
  // The same answer's own check then genuinely checks claims, which
  // is exactly the pairing the panel caught contradicting itself.
  const aligned = verifyExtractiveAlignment(md, BSFL_PAPERS);
  assert.ok(aligned && aligned.checked && aligned.claims.length > 0,
    "the alignment check found nothing to check in a cited extractive answer");
});

await test("the trace's result is appended to the body as a trace, and counts as no support anywhere", () => {
  // CORRECTED CONTRACT (2026-10-14, sixth panel, Job 1): this pin
  // used to derive a "The claim check supports X of Y" sentence for
  // the EXTRACTIVE body from factCheckSupport(aligned) — the exact
  // circularity the panel scored: the alignment check verifies
  // copying (the wording traces to the cited paper), and its marks
  // were presented as verified support in the body, the confidence
  // line, and the panel. The extractive check is provenance now:
  // factCheckSupport returns null for it, the body states the
  // trace as a trace, and a provenance only run ships thin.
  const md = buildExtractiveSynthesis(BSFL_PAPERS, null, { query: BSFL_QUERY, queryAnalysis: null });
  const aligned = verifyExtractiveAlignment(md, BSFL_PAPERS);
  assert.equal(aligned.checkKind, "provenance", "the extractive result is not labeled provenance");
  assert.equal(factCheckSupport(aligned), null,
    "provenance marks were counted as support: " + JSON.stringify(factCheckSupport(aligned)));
  const prov = factCheckProvenance(aligned);
  assert.ok(prov && prov.checked > 0, "no trace count to state");
  const sentence = "The wording of " + prov.traced + " of " + prov.checked +
    " cited claims traces to the papers they cite. A wording trace is not a verification.";
  const out = appendClaimCheckSentence(md, sentence);
  const section = out.slice(out.indexOf("## How solid is this?"));
  assert.ok(section.startsWith("## How solid is this?"), "confidence section lost");
  assert.ok(section.split("\n\n")[1].includes(sentence),
    "the trace sentence did not land in the confidence paragraph: " + section.split("\n\n")[1]);
  assert.ok(!section.includes("claim check supports"),
    "the body still presents trace marks as support: " + section);
  // The shipped confidence for the same run: thin, always, with no
  // support clause — provenance is not verification.
  const line = buildConfidenceLine(BSFL_PAPERS, { status: "settled" },
    { support: factCheckSupport(aligned), provenanceOnly: true });
  assert.equal(line.level, "thin", "a provenance only run shipped above thin: " + line.line);
  assert.ok(!line.line.includes("claim check supports"),
    "the shipped line claims support from a trace: " + line.line);
  assert.ok(line.line.includes("not a verification"),
    "the shipped line does not name the trace cap: " + line.line);
});

await test("the definition body takes the sentence on its Evidence Strength line", () => {
  const def = "## What is a biofilm?\n\nA biofilm is a structured community of microbes [1].\n\n**Evidence Strength** Moderate confidence: this answer rests on 2 cited sources.\n";
  const out = appendClaimCheckSentence(def, "The claim check supports 1 of 1 checked claims.");
  assert.ok(out.includes("**Evidence Strength** Moderate confidence: this answer rests on 2 cited sources. The claim check supports 1 of 1 checked claims."),
    "definition line did not gain the sentence: " + out);
  // A body with no confidence line is returned untouched.
  const plain = "## Summary\n\nJust prose, no instruments.";
  assert.equal(appendClaimCheckSentence(plain, "The claim check supports 1 of 1 checked claims."), plain);
});

await test("factCheckChecked null asserts nothing; false still names the empty check", () => {
  const papers = [BSFL_PAPERS[0], BSFL_PAPERS[1],
    { title: "Substrate moisture and larval growth in Hermetia illucens", abstract: "Moisture content shaped larval growth.", year: 2021, journal: "Insects", authors: "Doe J", relevance: 80 }];
  const unknown = buildConfidenceLine(papers, { status: "settled" }, { extractive: true, factCheckChecked: null });
  assert.ok(!unknown.line.includes("did not check any claims"),
    "a pre check line claimed the check checked nothing: " + unknown.line);
  const empty = buildConfidenceLine(papers, { status: "settled" }, { extractive: true, factCheckChecked: false });
  assert.ok(empty.line.includes("fact checking did not check any claims"),
    "an explicitly unchecked line lost its honest cap reason: " + empty.line);
});

// ═══════════════════════════════════════════════════════════════════
group("defect 3 — a single source reads as a single source");

await test("one cited paper caps confidence at thin and says why", () => {
  const conf = buildConfidenceLine([BSFL_PAPERS[0]], { status: "settled" }, {});
  assert.equal(conf.level, "thin", "a single source reached a multi source band: " + conf.line);
  assert.ok(conf.line.includes("single source"), "the cap reason is not named: " + conf.line);
  assert.ok(conf.line.includes("only 1 cited source"), "the basis is not stated: " + conf.line);
});

await test("the limits name a single cited source even when the pool was wider", () => {
  const pool = [BSFL_PAPERS[0], BSFL_PAPERS[1],
    { title: "Substrate moisture and larval growth in Hermetia illucens", abstract: "Moisture content shaped larval growth.", year: 2021, journal: "Insects", authors: "Doe J", relevance: 80 }];
  const gaps = buildEvidenceGaps({ papers: pool, sourcesQueried: null, relevanceGatedOut: 0, citedCount: 1 });
  assert.ok(gaps.some((g) => g.includes("The answer rests on a single source")),
    "no single source limit for a one citation answer: " + JSON.stringify(gaps));
  const two = buildEvidenceGaps({ papers: pool, sourcesQueried: null, relevanceGatedOut: 0, citedCount: 2 });
  assert.ok(!two.some((g) => g.includes("rests on a single source")),
    "a two citation answer was limited as single source: " + JSON.stringify(two));
  // The pipeline passes the cited set's size, not the pool's.
  assert.ok(searchSrc.includes("citedCount: citedEvidencePapers.length"),
    "the pipeline does not pass the cited count to the gaps builder");
});

// ═══════════════════════════════════════════════════════════════════
group("defect 4 — first person paper voice never ships as Cerebrum's own");

await test("the shared predicate names the paper voice phrases", () => {
  assert.equal(hasFirstPersonPaperVoice("We measured protease activity in the gut."), true);
  assert.equal(hasFirstPersonPaperVoice("Our study tracked enzyme levels across instars."), true);
  assert.equal(hasFirstPersonPaperVoice("In our work, survival doubled."), true);
  assert.equal(hasFirstPersonPaperVoice("Protease activity rose by 48 percent after feeding."), false);
  assert.equal(hasFirstPersonPaperVoice("The findings show that substrate choice governs persistence."), false);
});

await test("an abstract whose best sentences are first person yields a voiceless answer", () => {
  // The temptation is deliberate: the first person sentences carry
  // the same fact (48 percent, protease, feeding) in the highest
  // density wording, so the old ranking led with them.
  const p1 = { title: "Enzyme activity in the larval gut across instars", journal: "Insect Biochemistry", year: 2021, relevance: 88,
    abstract: "We measured protease activity in the larval gut and found that it rose by 48 percent after feeding. Our study tracked enzyme levels across three instars in 120 larvae. Protease activity in the larval gut rose by 48 percent after feeding in the final instar. Gut enzyme levels differed significantly between fed and starved larvae across all trials." };
  const p2 = { title: "Feeding state and digestive enzyme output in caterpillars", journal: "Journal of Insect Physiology", year: 2020, relevance: 82,
    abstract: "Digestive enzyme output doubled within two hours of a meal in the caterpillar midgut. Starved larvae showed protease activity 35 percent lower than fed larvae in matched trials. The response was consistent across all three species examined in the feeding trials." };
  const md = buildExtractiveSynthesis([p1, p2], [], { query: "does feeding change enzyme activity in the larval gut" });
  assert.ok(md, "expected an extractive synthesis");
  assert.ok(!/\b(we measured|our study|we found|in our work)\b/i.test(md),
    "first person paper voice shipped: " + md);
  assert.ok(md.includes("48 percent"), "the finding itself was lost with its voice: " + md);
});

// ═══════════════════════════════════════════════════════════════════
group("defect 5 — the same paper ships once, however it was fetched");

const SOIL_DOI_RECORD = { title: "Desiccation Cracking in Clay Soils: Mechanisms and Measurement", doi: "10.1000/soil1", year: 2019, authors: "Smith J, Doe A", url: "https://doi.org/10.1000/soil1" };

await test("a DOI record and a publisher URL record of one paper merge", () => {
  // The panel's shape: one record with a DOI, the other with only
  // a publisher URL, a differently cased title, and the subtitle
  // one source carries dropped by the other.
  const publisherRecord = { title: "desiccation cracking in clay soils", year: "2019", authors: "Smith J", url: "https://publisher.example/soil1" };
  const out = dedupePapers([SOIL_DOI_RECORD, publisherRecord]);
  assert.equal(out.length, 1, "the same paper survived dedupe twice: " + JSON.stringify(out.map((p) => p.title)));
});

await test("a DOI record and a PMID record of one paper merge", () => {
  const pmidRecord = { title: "Desiccation cracking in clay soils", pmid: "12345678", year: 2019, authors: "Smith J", url: "https://pubmed.ncbi.nlm.nih.gov/12345678/" };
  const out = dedupePapers([SOIL_DOI_RECORD, pmidRecord]);
  assert.equal(out.length, 1, "different identifier families kept one paper twice");
});

await test("two different DOIs on one core stay two papers", () => {
  const companion = { title: "Desiccation Cracking in Clay Soils", doi: "10.2000/other9", year: 2019, authors: "Smith J, Doe A", url: "https://doi.org/10.2000/other9" };
  const out = dedupePapers([SOIL_DOI_RECORD, companion]);
  assert.equal(out.length, 2, "the DOI veto failed: distinct works were merged");
});

await test("a different first author on one core stays two papers", () => {
  const otherTeam = { title: "Desiccation cracking in clay soils", year: 2019, authors: "Garcia M", url: "https://publisher.example/other" };
  const out = dedupePapers([SOIL_DOI_RECORD, otherTeam]);
  assert.equal(out.length, 2, "the surname veto failed: distinct works were merged");
});

// ═══════════════════════════════════════════════════════════════════
group("defect 6 — no em or en dashes in shipped answer text");

await test("deDash rewrites pairs, clauses, and ranges as a person would", () => {
  const drafted = "Larvae grew fast — the waste diet worked — and survival stayed high. The trial ran 5–60 minutes per batch — a short window, but the effect is clear.";
  const out = deDash(drafted);
  assert.ok(!/[—–]/.test(out), "a long dash survived: " + out);
  assert.ok(out.includes("5 to 60 minutes"), "the range lost its meaning: " + out);
  assert.ok(out.includes("the waste diet worked"), "the parenthetical was mangled: " + out);
});

await test("the ship paths run deDash: post process, run last, both cache serves", () => {
  assert.ok(searchSrc.includes("answer = deDash(answer);"), "postProcessAnswer does not deDash");
  assert.ok(searchSrc.includes("answer = deDash(answer);\n    answer = italicizeScientificTerms(answer, query);"),
    "the pipeline run last point does not deDash before italicizing");
  // The cache serves deDash the trust builder's bound body
  // (earlyTrust/laterTrust.answer, the stored text with its
  // baked confidence line bound — 2026-10-14 cached serve
  // parity), not the raw stored text.
  assert.ok(searchSrc.includes("italicizeScientificTerms(deDash(earlyTrust.answer), query)"), "the early cache serve does not deDash its bound body");
  assert.ok(searchSrc.includes("italicizeScientificTerms(deDash(laterTrust.answer), query)"), "the late cache serve does not deDash its bound body");
});

// ═══════════════════════════════════════════════════════════════════
group("defect 7 — species italics on the extractive and record surfaces");

await test("a common name question still italicizes the species the text names", () => {
  const out = italicizeScientificTerms(
    "The gut microbiome of Hermetia illucens shifted as the diet changed.",
    "can black soldier fly larvae eat fryer grease");
  assert.ok(out.includes("_Hermetia illucens_"), "the validated species stayed roman: " + out);
});

await test("double underscores collapse instead of stranding raw markers", () => {
  const out = italicizeScientificTerms("We studied __Hermetia illucens__ larvae.", "black soldier fly");
  assert.ok(out.includes("_Hermetia illucens_"), "the name is not italicized: " + out);
  assert.ok(!out.includes("__"), "raw double markers survived: " + out);
  const bold = italicizeScientificTerms("This is **very important** text.", "black soldier fly");
  assert.equal(bold, "This is **very important** text.", "unrelated bold was disturbed");
});

await test("an extractive answer ships its species italicized end to end", () => {
  const md = buildExtractiveSynthesis(BSFL_PAPERS, null, { query: BSFL_QUERY, queryAnalysis: null });
  const shipped = italicizeScientificTerms(deDash(md), BSFL_QUERY);
  assert.ok(shipped.includes("_Hermetia illucens_"), "the extractive species stayed roman: " + shipped);
  assert.ok(!shipped.includes("___"), "a triple marker shipped: " + shipped);
});

await test("the record page prints italic species in source titles, and nothing else as markup", async () => {
  const record = {
    id: "r_answerpkg1", question: "can frogs <script>alert(1)</script> freeze", askedAt: "2026-10-14T00:00:00.000Z",
    sources: [
      { n: 1, title: "Gut microbiota of <i>Hermetia illucens</i> larvae", year: 2023, authors: "Doe J", journal: "Insects", doi: null, url: null, cited: true },
      { n: 2, title: "A <b>bold</b> claim", year: 2020, authors: "Roe K", journal: "J", doi: null, url: null, cited: false },
    ],
  };
  const db = { prepare: () => ({ bind: () => ({ first: async () => ({ record: JSON.stringify(record) }) }) }) };
  const res = await recordRoute.onRequestGet({
    request: new Request("https://askcerebrum.org/record/r_answerpkg1"),
    env: { DB: db }, params: { id: "r_answerpkg1" },
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("<i>Hermetia illucens</i>"), "the species did not render italic: " + html);
  assert.ok(!html.includes("&lt;i&gt;"), "the species tag printed literally");
  assert.ok(html.includes("A &lt;b&gt;bold&lt;/b&gt; claim"), "non species markup stopped being escaped");
  assert.ok(!html.includes("<script>alert(1)</script>"), "stored question reached the page as markup");
});

await test("the Markdown export translates species tags to underscore italics", () => {
  const at = appSrc.indexOf("function searchRecordMarkdown");
  const md = appSrc.slice(at, appSrc.indexOf("function SearchRecordPanel"));
  assert.ok(md.includes("recordTitleMarkdown(s.title)"), "the export does not format source titles");
  assert.ok(appSrc.includes('replace(/<i>([^<]*)<\\/i>/gi, "_$1_")'), "the title translator is missing");
});

// ═══════════════════════════════════════════════════════════════════
group("defect 8 — stage health and the record derive from the same diag");

await test("a fatal retrieval inside a resolved result fails the stage record", () => {
  const sh = [{ name: "retrieval", ok: true, ms: 5 }];
  reconcileRetrievalStageRecord(sh, { fatalError: "retrieval blew up" }, 0);
  assert.equal(sh[0].ok, false);
  assert.equal(sh[0].skipReason, "stage failed");
});

await test("every database failing fails the stage record when no papers came back", () => {
  const sh = [{ name: "retrieval", ok: true, ms: 5 }];
  reconcileRetrievalStageRecord(sh, { sourceOutcomes: [{ source: "A", ok: false }, { source: "B", ok: false }] }, 0);
  assert.equal(sh[0].ok, false);
  assert.equal(sh[0].skipReason, "no database responded");
});

await test("papers on hand keep the record ok even when the live databases failed", () => {
  const sh = [{ name: "retrieval", ok: true, ms: 5 }];
  reconcileRetrievalStageRecord(sh, { sourceOutcomes: [{ source: "A", ok: false }] }, 3);
  assert.equal(sh[0].ok, true, "a recovered retrieval was marked failed");
});

await test("a record the runner already failed is left exactly as recorded", () => {
  const sh = [{ name: "retrieval", ok: false, ms: 9, skipReason: "stage timed out" }];
  reconcileRetrievalStageRecord(sh, { fatalError: "retrieval blew up" }, 0);
  assert.equal(sh[0].skipReason, "stage timed out");
  assert.ok(searchSrc.includes("reconcileRetrievalStageRecord(stageHealth, gResult"),
    "the pipeline never reconciles the retrieval record");
});

// ═══════════════════════════════════════════════════════════════════
group("defect 9 — the fact check runs before the bookkeeping writes");

await test("the bookkeeping blocks stand after the fact check in the pipeline", () => {
  const fcAt = searchSrc.indexOf("FACT-CHECK PASS");
  assert.ok(fcAt > 0, "fact check pass not found");
  for (const marker of ["BOOKKEEPING (2026-10-14", "D1 PAPER-LEVEL LEARNING (write)", "D1 QUERY INTELLIGENCE LEARNING", "CACHE THE ANSWER (D1)"]) {
    const at = searchSrc.indexOf(marker);
    assert.ok(at > fcAt, marker + " still stands before the fact check");
    assert.equal(searchSrc.indexOf(marker, at + 1), -1, marker + " appears twice");
  }
});

await test("the uncited guard is wired: retry restated, flip, stage reason, closing line", () => {
  assert.ok(searchSrc.includes("A previous draft of this answer carried no citations at all."),
    "the citation retry does not restate the requirement");
  assert.ok(/uncitedAnswerFallback = true;\s*\n\s*aiOK = false;/.test(searchSrc),
    "a still uncited answer does not flip aiOK");
  assert.ok(searchSrc.includes('uncitedAnswerFallback ? "answer had no citations"'),
    "the synthesis stage record cannot name the uncited fallback");
  assert.ok(searchSrc.includes('? "uncited-answer"'), "wave 4 is not told the uncited reason");
  assert.ok(searchSrc.includes('gateReason === "uncited-answer"'), "the extractive closing line has no uncited branch");
  assert.ok(!searchSrc.includes("the model chose not to cite because papers"),
    "the old accept a long uncited answer rationale survives");
  assert.ok(!searchSrc.includes("Related papers found (may not directly address this question)"),
    "the old related papers consolation survives");
});

// ═══════════════════════════════════════════════════════════════════
group("end to end — a long uncited winner is retried, then replaced, and still fact checked");

const E2E_QUERY = "Do the germs in a baby belly change how well the baby grows";
const e2eWords = E2E_QUERY.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
const e2eAbstract = (n) =>
  ("Study " + n + " on " + e2eWords.join(" ") + ". " +
   "This paper examines " + e2eWords.join(", ") + " in detail. " +
   "The findings show clear effects for " + e2eWords.slice(0, 4).join(" and ") + " across the first year of life. ").repeat(2);
// Long, fluent, and entirely uncited: the defect 2 specimen. Every
// synthesis leg and the citation retry return this same text.
const UNCITED_ANSWER =
  "The microbes living in an infant gut **shape growth** from the first weeks of life. " +
  "Studies show that **gut microbes** influence how nutrients are absorbed and how weight is gained over time, " +
  "and the community changes quickly as feeding changes. When the microbial community is disturbed early, " +
  "growth can slow until the community recovers, and later feeding patterns partly restore the earlier " +
  "trajectory. Diversity rises across the first year as new foods arrive, and the mix of microbes tracks " +
  "what the infant eats from week to week across every cohort examined.";

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function chatRes(content) {
  return jsonRes({ choices: [{ message: { content } }] });
}
function e2eDb() {
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
function e2eAi() {
  return {
    run: async (model, input) => {
      if (model === "@cf/baai/bge-small-en-v1.5") {
        const texts = (input && input.text) || [];
        return { data: texts.map((_, i) => [1, 0.01 * (i + 1), 0.5, 0.25]) };
      }
      const msgs = (input && input.messages) || [];
      const joined = msgs.map((mm) => String(mm.content || "")).join("\n");
      if (joined.includes("ANSWER TO FACT-CHECK:")) return { response: "not json" };
      return { response: UNCITED_ANSWER };
    },
  };
}

await test("the uncited winner is retried once, replaced by the extractive tier, and the answer is fact checked", async () => {
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  const fetchCalls = [];
  let epmcCalls = 0;
  globalThis.caches = {
    default: {
      match: async () => undefined,
      put: async () => {},
      delete: async () => false,
    },
  };
  Math.random = () => 0.99;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = typeof opts.body === "string" ? opts.body : "";
    fetchCalls.push({ u, body });
    if (u.includes("api.groq.com") || u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("openrouter.ai")) {
      if (body.includes("literature search specialist")) {
        return chatRes(JSON.stringify([{ term: "germ", alternates: ["gut microbes", "microbiota", "microbial community"] }]));
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      }
      return chatRes(UNCITED_ANSWER);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      epmcCalls++;
      const mk = (n) => ({
        title: "Gut germs and infant growth patterns study " + n,
        doi: "10.1000/pkg" + n,
        pubYear: "2024",
        citedByCount: 7,
        authorString: "Doe J, Roe K",
        journalTitle: "Journal of Infant Studies",
        abstractText: e2eAbstract(n),
      });
      if (u.includes("BODY")) return jsonRes({ resultList: { result: [] } });
      return jsonRes({ resultList: { result: [mk(epmcCalls * 2 - 1), mk(epmcCalls * 2)] } });
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
    const ledger = createSubrequestLedger();
    const env = {
      DB: e2eDb(),
      AI: e2eAi(),
      GROQ_KEY: "pkg-test-groq-key-123456",
      GEMINI_KEY: "pkg-test-gemini-key-123456",
      MISTRAL_KEY: "pkg-test-mistral-key-123456",
      NVIDIA_KEY: "pkg-test-nvidia-key-123456",
      OPENROUTER_KEY: "pkg-test-openrouter-key-123456",
    };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: E2E_QUERY }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));

    // Defect 2: the retry fired with the requirement restated...
    const retries = fetchCalls.filter((c) => c.body.includes("carried no citations at all"));
    assert.ok(retries.length >= 1, "the citation retry never fired for a long uncited answer");
    // ...and the still uncited answer was replaced, honestly marked.
    assert.equal(data.synthesisMode, "extractive", "the uncited AI answer shipped as the answer");
    assert.equal(data.degraded, true, "the replacement was not marked degraded");
    assert.equal(data.modelUsed, null, "a model was named as author of the extractive answer");
    assert.ok(data.answer.includes("did not cite its sources"),
      "the closing line does not name the real reason: " + data.answer.slice(-300));
    assert.ok(/\[\d+\]/.test(data.answer), "the extractive replacement carries no citations");
    assert.ok(!data.answer.includes("microbes living in an infant gut shape growth"),
      "the uncited draft itself shipped");
    const synth = (data.stageHealth || []).find((s) => s.name === "synthesis");
    assert.ok(synth && synth.ok === false && synth.skipReason === "answer had no citations",
      "the synthesis stage record does not name the fallback: " + JSON.stringify(synth));

    // Defects 1 and 9, as corrected by the sixth panel's Job 1:
    // the fact check ran (it stands before the bookkeeping writes
    // now), and the body states its real result — as a TRACE, not
    // as support. The extractive check verifies copying; the old
    // pin here asserted a "The claim check supports X of Y"
    // sentence counted from its marks, which is the circularity
    // the panel scored.
    assert.ok(data.factCheck && Array.isArray(data.factCheck.claims) && data.factCheck.claims.length > 0,
      "the fact check did not run on the shipped answer");
    assert.equal(data.factCheck.mode, "extractive");
    assert.equal(data.factCheck.checkKind, "provenance",
      "the shipped fact check is not labeled provenance");
    // The expected sentence is derived from the fact check's own
    // claims, in the vocabulary the check ships (wave eight round
    // two: a traced claim's status is "traced"; this derivation
    // counted "supported" until the vocabulary changed, which is
    // how the stale word survived in a test about the correction).
    const traced = data.factCheck.claims.filter((c) => c.status === "traced").length;
    const checkedN = data.factCheck.claims.length;
    const sentence = "The wording of " + traced + " of " + checkedN +
      " cited claim" + (checkedN === 1 ? "" : "s") + " traces to the papers they cite. A wording trace is not a verification.";
    assert.ok(data.answer.includes(sentence),
      "the body does not state the trace's result (" + sentence + "): " + data.answer.slice(0, 400));
    assert.ok(!data.answer.includes("claim check supports"),
      "the body presents trace marks as verified support");
    assert.ok(!data.answer.includes("did not check any claims"), "the body contradicts its fact check object");
    assert.ok(!String((data.confidence && data.confidence.line) || "").includes("did not check any claims"),
      "the response confidence line contradicts its fact check object: " + (data.confidence && data.confidence.line));
    // Job 1b: a run whose only check is the trace ships thin.
    assert.equal(data.confidence && data.confidence.level, "thin",
      "a provenance only run shipped above thin: " + JSON.stringify(data.confidence));
    // Sixth panel follow up: the body's baked line agrees with
    // the shipped level. The extractive builder composed its
    // line before the check ran, from the pre check shelf, and
    // asserted Moderate over the object that ships thin (its own
    // cited count had already shrunk by ship time). The shipped
    // line now stands in the body where the baked assertion
    // stood; the trace sentence (asserted above) and the
    // section's computed bullets survive beside it.
    assert.ok(!data.answer.includes("Moderate confidence"),
      "the body still asserts the builder's pre check Moderate line over a thin ship");
    assert.ok(data.confidence && data.confidence.line && data.answer.includes(data.confidence.line),
      "the shipped confidence line does not stand in the body");
    const solidAt = data.answer.indexOf("## How solid is this?");
    assert.ok(solidAt >= 0 && /\n- /.test(data.answer.slice(solidAt)),
      "the binding emptied the How solid section's computed bullets");
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
