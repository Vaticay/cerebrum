/**
 * Search wave twelve (2026-10-14). Four brief items plus one
 * live probe addition from the parent:
 *
 * Item 1 — the claim check scored correct answers at zero.
 * The live sky run on c2597fa taught Rayleigh scattering
 * correctly, cited to a real source, and still shipped
 * "the claim check supports 0 of 5": the five were mechanical
 * integrity flags (alignment, stripped, demoted) appended to
 * the panel and then counted as checked claims the check had
 * failed. The fix is at the binding layer: flags and deep
 * claims attributed to a source outside the set the checker
 * was given are tagged with their kind, stay visible in the
 * panel, and leave every support count — a claim that cannot
 * be checked is excluded from the denominator rather than
 * counted as failed. A deliberately wrong claim the checker
 * does judge still counts, still scores unsupported, and is
 * still removed. Building the handler fixture below exposed
 * the deeper half of the same defect: the deep check's
 * OpenRouter tier armed its abort timer as a const inside
 * the try whose finally cleared it, so the finally threw a
 * ReferenceError on every execution and the caller's catch
 * turned each parsed verdict into null — that tier had never
 * landed a verdict at all, in the harness or in production.
 * The timer now lives outside the try, and the sky fixture
 * (which runs with no Workers AI binding, so tier two is the
 * only tier) pins the repair end to end.
 *
 * Item 2 — founding papers whose titles carry none of the
 * query words. The wave nine fixture's Jinek carried its
 * abstract and citation count through every lane leg; live,
 * the same work arrives as several copies of unequal
 * richness, dedupe kept the first copy whole and discarded
 * the lane's rich copy, and the lane's legs ranked by
 * relevance so the founding paper was not even on the first
 * page (probed live 2026-10-14: Europe PMC's default order
 * for the lane query returned 2026 papers with zero
 * citations; its documented CITED desc order returned the
 * 2012 founding paper first). Dedupe now folds a dropped
 * duplicate's richer fields into the kept record, and the
 * lane's three legs sort by citations. The handler fixture
 * below is the brief's exact shape: a first description
 * whose title shares no word with the question, whose
 * engagement lives in its abstract, arriving first as a thin
 * copy with no abstract and no citation count.
 *
 * Item 3 — the PCR thin pool, verification. Wave eleven's
 * detector widening made "how does pcr make more copies of
 * dna" fire the foundational lane; the parent's live probe
 * on a269429 confirmed the recovery (lane fired, admitted
 * 34, presented 7 on point papers, cited 7). The handler
 * fixture here pins the same shape at the handler level so a
 * regression is caught without a deploy.
 *
 * Item 4 — single source clean answers get one retry. Wave
 * ten's minimum cited support retry was fenced to mechanism
 * and measurement shapes; the wave ten build's clean sky run
 * presented 11 sources and cited 1, outside both shapes. The
 * fence is gone: every clean AI answer over a healthy pool
 * that lands on exactly one cited source gets the same one
 * retry with a different model, labeled in the record.
 *
 * Item 5 (parent addition, live proof on a269429) — the
 * compound clause's abstract confirmation was too literal:
 * device papers titled through "Sky-Blue" still presented on
 * "why is the sky blue" because their abstracts stand the
 * word "blue" alone in emission region language. The
 * confirmation now requires topical company: another central
 * concept of the question standing uncompounded in the same
 * abstract. The three live device titles, with realistic
 * device abstracts, are fixtures below; the wave eleven
 * positive controls must stay (they are re-run in the wave
 * eleven suite).
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 *
 * Run with: node tests/search-wave-twelve.mjs
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
  factCheckSupport, factCheckClaimCountable, dedupeFactCheckClaims,
  dedupePapers, paperTitleEngagesConcepts,
  citationGateStandard, paperClearsCitationGate, paperIsCitable,
  conceptGateContext,
  buildDeterministicFallbackGroups, buildDynLookup, centralContentTerms,
  detectMeasurementIntent,
  isMechanismShapeQuery, paperMechanismTier,
  foundationalPoolStats, paperIsFoundationalPrimary,
  removeUnsupportedClaimsFromAnswer,
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

// ── Scenario runner (wave nine pattern, extended: a scripted
// deep fact check verdict and a scripted minimum support
// retry answer) ────────────────────────────────────────────
let scenPapers = [];
let scenAnswer = "";
let scenRetryAnswer = null;
let scenFactCheck = null;
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
        return chatRes(scenFactCheck || "no verdict available");
      }
      if (body.includes("Cite at least two different sources inline")) {
        return chatRes(scenRetryAnswer || scenAnswer);
      }
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
      OPENROUTER_KEY: "w12-test-openrouter-key-123456",
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

const epmc12 = (id, title, abstractText, citedByCount, pubYear) => ({
  title,
  doi: "10.1000/w12-" + id,
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
const paper = (title, abstract, year = "2024", citations = 50) => ({
  title, abstract, year: String(year), citations,
  citedByCount: citations, citationCount: citations,
  authors: "Doe J et al.", journal: "Journal of Recorded Studies",
  doi: "10.1000/w12-" + Math.abs([...title].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7)),
  url: "https://doi.org/10.1000/w12-unit",
  relevance: 90,
});

// ═══════════════════════════════════════════════════════════════
group("Item 1 — the claim check counts only the claims it checked");

await test("a panel of mechanical flags alone has no support count at all", () => {
  const flagsOnly = {
    overall: "partly", mode: "claims",
    summary: "Checked cited claims against their papers: 5 claims share almost no vocabulary with the paper cited.",
    claims: [
      { claim: "Sentence one.", status: "unsupported", kind: "alignment", note: "n" },
      { claim: "Sentence two.", status: "unsupported", kind: "alignment", note: "n" },
      { claim: "Sentence three.", status: "unsupported", kind: "stripped", note: "n" },
      { claim: "Sentence four.", status: "unsupported", kind: "demoted", note: "n" },
      { claim: "Sentence five.", status: "unsupported", kind: "demoted", note: "n" },
    ],
  };
  assert.equal(factCheckSupport(flagsOnly), null,
    "five mechanical flags still read as a claim check that supports 0 of 5");
});

await test("flags riding on a real check leave its denominator untouched", () => {
  const mixed = {
    overall: "partly", mode: "claims",
    claims: [
      { claim: "Air molecules scatter blue light more strongly than red.", status: "supported", note: "n" },
      { claim: "The sky is blue because it reflects the ocean.", status: "unsupported", note: "n" },
      { claim: "A paraphrased sentence.", status: "unsupported", kind: "alignment", note: "n" },
      { claim: "A decited sentence.", status: "unsupported", kind: "stripped", note: "n" },
      { claim: "A demoted sentence.", status: "unsupported", kind: "demoted", note: "n" },
    ],
  };
  assert.deepEqual(factCheckSupport(mixed), { supported: 1, checked: 2 },
    "the support count is not the check's own two claims: " + JSON.stringify(factCheckSupport(mixed)));
});

await test("an unattributed claim is excluded, and the countable predicate names the kinds", () => {
  const panel = {
    overall: "partly", mode: "claims",
    claims: [
      { claim: "A checked claim.", status: "supported", note: "n" },
      { claim: "A claim bound to a source that is not in the set.", status: "unsupported", kind: "unattributed", note: "n" },
    ],
  };
  assert.deepEqual(factCheckSupport(panel), { supported: 1, checked: 1 },
    "an unattributed verdict still counts as a checked failure");
  for (const kind of ["alignment", "stripped", "demoted", "unattributed"]) {
    assert.equal(factCheckClaimCountable({ claim: "x", status: "unsupported", kind }), false,
      `kind ${kind} still counts as a checked claim`);
  }
  assert.equal(factCheckClaimCountable({ claim: "x", status: "supported" }), true,
    "an untagged claim no longer counts as checked");
  assert.equal(factCheckClaimCountable({ claim: "x", status: "thin", kind: "terms" }), true,
    "a kind outside the uncheckable set stopped counting");
});

await test("the dedupe recount restates the check's own counts, flags still listed", () => {
  const fc = {
    overall: "supported", mode: "claims",
    summary: "Checked 2 claims against the cited sources: 2 supported, 0 thin, 0 unsupported.",
    claims: [
      { claim: "Air molecules scatter blue light more strongly than red.", status: "supported", note: "n" },
      { claim: "Air molecules scatter blue light more strongly than red.", status: "supported", note: "duplicate" },
      { claim: "The sky is blue because it reflects the ocean.", status: "unsupported", note: "n" },
      { claim: "A paraphrased sentence.", status: "unsupported", kind: "alignment", note: "n" },
    ],
  };
  const out = dedupeFactCheckClaims(fc);
  assert.equal(out.claims.length, 3, "the fold did not happen or ate the flag: " + out.claims.length);
  assert.equal(out.summary,
    "Checked 2 claims against the cited sources: 1 supported, 0 thin, 1 unsupported.",
    "the recounted summary is not the check's own counts: " + out.summary);
  assert.equal(out.overall, "partly", "the recounted overall does not follow the check's own verdicts");
  assert.ok(out.claims.some((c) => c.kind === "alignment"),
    "the flag left the panel — the exclusion must be from the counts, not from view");
});

await test("the provenance trace still presents no support count", () => {
  const trace = { checkKind: "provenance", mode: "extractive", claims: [{ claim: "x", status: "traced" }] };
  assert.equal(factCheckSupport(trace), null, "the wording trace now reports a support count");
});

// ═══════════════════════════════════════════════════════════════
group("Item 6 (layer evidence) — a literature denying claim is removal grade when the checker judges it");

await test("the removal machinery strips a claim that denies its own cited literature, and keeps the teaching", () => {
  // The parent's live shape on a269429: a clean answer cited
  // the 2006 "Why is the sky blue?" paper and still claimed
  // the retrieved literature does not explain the physical
  // cause. This fixture pins the layer, not the verdict: when
  // the deep checker judges such a claim unsupported against
  // its source, the pipeline's removal point strips it. (The
  // coordinator's report states plainly where the verdict
  // itself is and is not guaranteed.)
  const answer =
    "The sky is blue because air molecules scatter short wavelength blue light far more strongly than longer wavelengths, an effect called Rayleigh scattering [1]. " +
    "The retrieved literature does not explain the physical cause of the sky's color; it only discusses perceptual analysis [2]. " +
    "Near the horizon the sky pales because the scattered light passes through more air and more of it reaches the eye mixed [1].";
  const rm = removeUnsupportedClaimsFromAnswer(answer, [
    { claim: "The retrieved literature does not explain the physical cause of the sky's color; it only discusses perceptual analysis", sourceIndex: 2, hard: true },
  ]);
  assert.ok(rm.removed >= 1, "the literature denying claim was not removed");
  assert.ok(!/does not explain the physical cause/.test(rm.text), "the denying sentence still stands in the text");
  assert.ok(/Rayleigh scattering/.test(rm.text), "the supported teaching sentence was removed with it");
});

// ═══════════════════════════════════════════════════════════════
group("Item 5 — the compound clause confirmation must be topical, not literal");

const skyQ = "why is the sky blue";
const skyDyn = dynFor(skyQ);

await test("the live OLED specimen bars even though its abstract stands blue alone", () => {
  const oled = paper(
    "High-Performance Sky-Blue Hyperfluorescence Organic Light-Emitting Diodes Enabled by Efficient Thermally Activated Delayed Fluorescence Sensitizers with Suppressed Efficiency Roll-Off",
    "We report a thermally activated delayed fluorescence sensitizer for hyperfluorescence organic light emitting diodes. The device emits in the blue region with an external quantum efficiency of 27 percent and suppressed roll off at high luminance. Blue emission is achieved at a peak of 478 nanometers with a narrow spectral width, and operational lifetime is extended by suppressing exciton annihilation in the emissive layer.");
  assert.equal(paperTitleEngagesConcepts(oled, skyQ, skyDyn), false,
    "the OLED device paper still presents: a lone free standing blue in emission language confirmed the fused title");
});

await test("the live perovskite specimen bars: sky appears only inside the compound", () => {
  const perovskite = paper(
    "Sky-blue perovskite light-emitting diodes with high efficiency and spectral stability",
    "Metal halide perovskites are promising emitters for light emitting diodes. We demonstrate devices with sky-blue emission and high color purity, where the blue emission arises from mixed halide quantum wells and the emission wavelength is tuned by the bromide to chloride ratio. The diodes reach an external quantum efficiency of 12 percent with stable blue electroluminescence over hundreds of hours.");
  assert.equal(paperTitleEngagesConcepts(perovskite, skyQ, skyDyn), false,
    "the perovskite device paper still presents on the sky question");
});

await test("the live quantum dot specimen bars with a device abstract that frees blue", () => {
  const qd = paper(
    "Sky blue quantum dot light-emitting diodes via surface ligand engineering",
    "Colloidal quantum dots engineered for display applications emit blue light with a narrow linewidth. Ligand exchange is shown to raise the photoluminescence yield of the films, and the efficiency and color purity of the blue devices are reported alongside their electroluminescence spectra and operational stability under constant current driving.");
  assert.equal(paperTitleEngagesConcepts(qd, skyQ, skyDyn), false,
    "the quantum dot device paper still presents: blue stands alone in its abstract and that was enough");
});

await test("the wave eleven positive control stays: both concepts stand free in a genuine abstract", () => {
  const control = paper(
    "Why the daytime sky-blue appearance depends on molecular scattering",
    "The blue of the sky is caused by Rayleigh scattering: air molecules scatter short wavelength blue sunlight far more strongly than longer wavelengths, so the sky appears blue in every direction away from the sun. We summarize the measurements that established the effect and the corrections for aerosols.");
  assert.equal(paperTitleEngagesConcepts(control, skyQ, skyDyn), true,
    "the positive control was barred — topical company is eating genuine papers");
});

await test("a single concept question keeps the wave eleven confirmation rule", () => {
  const q = "what is entropy";
  const rec = paper(
    "Entropy-driven ordering in colloidal suspensions",
    "The entropy of the suspension rises as the colloids order, and the free energy balance that results explains the transition without any attraction between the particles.");
  assert.equal(paperTitleEngagesConcepts(rec, q, dynFor(q)), true,
    "a single concept question now demands company that cannot exist");
});

// ═══════════════════════════════════════════════════════════════
group("Item 2 — dedupe folds the rich copy, the lane's reason to exist");

const J2_TITLE = "A programmable dual-RNA-guided protein in adaptive bacterial immunity";
const J2_ABSTRACT = "Clustered regularly interspaced short palindromic repeats (CRISPR) and CRISPR associated (Cas) proteins form an adaptive immune system in bacteria and archaea. Here we show that Cas9 is a dual RNA guided DNA endonuclease. Cas9 is guided by a crRNA and a tracrRNA to a target DNA sequence, where its two nuclease domains cleave each strand of the DNA and generate a double strand break. Guide RNA recognition of the target, together with the requirement for a protospacer adjacent motif, determines where cleavage occurs. These findings establish the mechanism by which the CRISPR Cas system recognizes and cuts foreign DNA, and show that the guide can be reprogrammed to direct cleavage to new targets.";
const J2_DOI = "10.1000/w12-jinek2";
const j2Rich = () => ({
  title: J2_TITLE, abstract: J2_ABSTRACT, year: "2012", citations: 9500,
  citedByCount: 9500, citationCount: 9500,
  authors: "Jinek M et al.", journal: "Science", doi: J2_DOI,
  url: "https://doi.org/" + J2_DOI, relevance: 96, _foundationalLane: true,
});
const j2Thin = () => ({
  title: J2_TITLE, abstract: "", year: "2012", citations: null,
  authors: "Jinek M et al.", journal: "Science", doi: J2_DOI,
  url: "https://doi.org/" + J2_DOI,
});

await test("the thin first copy no longer buries the lane's rich copy of the same work", () => {
  const out = dedupePapers([j2Thin(), j2Rich()]);
  assert.equal(out.length, 1, "the two copies of one work did not dedupe to one record");
  assert.equal(out[0].abstract, J2_ABSTRACT,
    "the kept record still carries the thin copy's empty abstract — the fold did not land");
  assert.equal(out[0].citations, 9500,
    "the kept record still carries no citation count: " + out[0].citations);
  assert.equal(out[0]._foundationalLane, true, "the lane tag was lost in the fold");
});

await test("the fold never downgrades, and provably different works are never folded", () => {
  const richFirst = dedupePapers([j2Rich(), { ...j2Thin(), abstract: "A shorter note.", citations: 30 }]);
  assert.equal(richFirst[0].abstract, J2_ABSTRACT, "a weaker later copy replaced the rich abstract");
  assert.equal(richFirst[0].citations, 9500, "a lower later citation count replaced the higher one");
  const twoWorks = dedupePapers([
    { title: "Studies of a bacterial immune system", abstract: "First work abstract.", year: "2012", citations: 10, doi: "10.1000/w12-a", url: "https://doi.org/10.1000/w12-a", authors: "Jinek M" },
    { title: "Studies of a bacterial immune system", abstract: "Second work abstract, different paper.", year: "2012", citations: 20, doi: "10.1000/w12-b", url: "https://doi.org/10.1000/w12-b", authors: "Jinek M" },
  ]);
  assert.equal(twoWorks.length, 2, "two works with different DOIs on one core were folded into one");
  assert.equal(twoWorks[0].abstract, "First work abstract.", "the first work's abstract was overwritten by its namesake");
});

await test("a title carrying none of the query words engages on its abstract alone, at tier 1", () => {
  const rec = { ...j2Rich(), relevance: 96 };
  assert.equal(paperMechanismTier(rec), 1,
    "abstract engagement alone does not earn a mechanism tier for a title with no mechanism words");
  const pool = [rec,
    paper("CRISPR Cas9 genome editing: recent advances and future prospects",
      "This review covers recent advances in CRISPR Cas9 genome editing, including guide RNA design, screening applications, and delivery. Progress in understanding DNA cleavage by Cas9 and in repairing the resulting breaks is summarized for researchers entering the field.", "2024", 420),
    paper("Genome engineering with CRISPR Cas9 in mammalian cells: a review",
      "Genome engineering with CRISPR Cas9 in mammalian cells has matured rapidly. This review discusses cleavage efficiency, guide selection, and the cellular response to double strand breaks, and compares engineering outcomes across cell types.", "2023", 180),
  ];
  const stats = foundationalPoolStats(pool);
  assert.equal(paperIsFoundationalPrimary(rec, stats), true,
    "the 2012 abstract engaged record is not a foundational primary: " + JSON.stringify(stats));
  const q = "how does crispr cas9 actually cut dna";
  const dyn = dynFor(q);
  const std = citationGateStandard(q, dyn);
  assert.equal(paperClearsCitationGate(rec, std), true,
    "the titleless primary does not clear the citation gate on abstract engagement");
  const ctx = conceptGateContext(pool, q, dyn);
  assert.equal(paperIsCitable(rec, 1, ctx), true, "the titleless primary is not citable");
});

await test("guard: citation weight alone promotes nothing without abstract engagement", () => {
  const offTopic = paper(
    "Global burden of bacterial antimicrobial resistance: a systematic analysis",
    "Antimicrobial resistance was associated with an estimated 4.95 million deaths in 2019, of which 1.27 million were directly attributable to resistance. Six pathogens account for most deaths, and resistance in lower respiratory infections carries the largest burden. The analysis covers 204 countries and argues for infection prevention, vaccination, and stewardship programs.",
    "2022", 21000);
  const q = "how does crispr cas9 actually cut dna";
  const dyn = dynFor(q);
  assert.equal(paperMechanismTier(offTopic), 0, "the resistance burden paper earns a mechanism tier");
  assert.equal(paperClearsCitationGate(offTopic, citationGateStandard(q, dyn)), false,
    "a 21000 citation off topic paper clears the mechanism gate on weight alone");
  const ctx = conceptGateContext([offTopic], q, dyn);
  assert.equal(paperIsCitable(offTopic, 1, ctx), false,
    "a 21000 citation off topic paper is citable on a question it does not engage");
});

// ═══════════════════════════════════════════════════════════════
group("Item 1 — handler: the sky shape scores its Rayleigh claim as supported");

const SKY_POOL = [
  epmc12("sky1", "Why is the sky blue?",
    "The blue color of the sky is explained by Rayleigh scattering. Air molecules scatter short wavelength blue light far more strongly than longer wavelengths, so scattered sunlight reaches the eye from every direction and the sky appears blue. The article also explains why the sky pales near the horizon and why sunsets turn red.", 210, "2006"),
  epmc12("sky2", "Rayleigh scattering and the color of the sky: measurements and models",
    "Measurements of the spectrum of scattered sunlight confirm that air molecules scatter light with an intensity that follows the inverse fourth power of the wavelength, the signature of Rayleigh scattering. The models reproduce the observed blue of the daytime sky and its variation with solar angle and aerosol load.", 480, "2015"),
  epmc12("sky3", "Painting the sky: an evaluation of how artists render daylight color",
    "This evaluation studies how landscape painters across three centuries have rendered the color of the sky. It analyzes the perceptual choices in their treatment of daylight, comparing painted skies with the colors observers report, and discusses what the paintings reveal about color perception rather than about optics.", 95, "2007"),
  epmc12("sky4", "Aerosols and the whitening of the daytime sky near the horizon",
    "Aerosol particles scatter sunlight across all wavelengths, which whitens the blue of the sky near the horizon on hazy days. Field measurements relate particle counts to the measured paling, extending the molecular scattering account to real atmospheres.", 130, "2019"),
];
const SKY_ANSWER = "The sky is blue because of **Rayleigh scattering**: air molecules scatter short wavelength blue light far more strongly than longer wavelengths, so blue light reaches your eyes from every direction of the sky [1][2].\n\n**Why blue and not violet:**\n\n- **Scattering strength:** the shorter the wavelength, the stronger the scattering, following the inverse fourth power of the wavelength, which is why the effect picks out the blue end of sunlight [1][2].\n- **Near the horizon:** the sky pales toward the horizon because scattered light from that direction has crossed more air, and aerosol particles scatter all wavelengths and whiten it further [1][2].\n- **At sunset:** the long path through the air removes the blue from the direct beam, leaving the reds and oranges behind [1][2].";
const SKY_FACTCHECK = JSON.stringify({ claims: [
  { claim: "The sky is blue because air molecules scatter short wavelength blue light far more strongly than longer wavelengths (Rayleigh scattering)",
    source_index: 1,
    quote: "Air molecules scatter short wavelength blue light far more strongly than longer wavelengths",
    status: "supported",
    justification: "The first source states the scattering claim directly in its abstract and names Rayleigh scattering as the explanation of the sky's blue color, so the claim as the answer states it is backed by the cited source's own text." },
  { claim: "The sky is blue because the atmosphere reflects the color of the ocean",
    source_index: 2, quote: "", status: "unsupported",
    justification: "The second source reports measurements of scattered sunlight and its wavelength law. Nothing in it, or in any cited source, states or implies that the sky takes its color from the ocean, so the claim has no support in the set." },
  { claim: "Aerosol particles whiten the sky near the horizon",
    source_index: 99, quote: "aerosols whiten the sky", status: "unsupported",
    justification: "The verdict is attributed to a source index that does not exist in the set the checker was given, so no source text stands behind it either way." },
] });

await test("the correct sky answer scores 1 of 2, the wrong claim counts, the unattributed claim does not", async () => {
  scenPapers = SKY_POOL;
  scenLaneEpmc = []; scenLaneOpenAlex = []; scenLaneS2 = [];
  scenAnswer = SKY_ANSWER;
  scenFactCheck = SKY_FACTCHECK;
  scenRetryAnswer = null;
  // The fact check stage gates on the request's settings, the
  // way the production client sends it.
  const { data } = await runScenario("why is the sky blue", { settings: { factCheck: true } });
  assert.ok(data.factCheck && data.factCheck.mode === "claims",
    "no claims mode fact check shipped: " + JSON.stringify(data.factCheck && data.factCheck.mode));
  assert.deepEqual(factCheckSupport(data.factCheck), { supported: 1, checked: 2 },
    "the shipped support count is not the check's own verdicts: " + JSON.stringify(factCheckSupport(data.factCheck)));
  assert.equal(data.factCheck.summary,
    "Checked 2 claims against the cited sources: 1 supported, 0 thin, 1 unsupported.",
    "the panel summary does not state the check's own counts: " + data.factCheck.summary);
  assert.equal(data.factCheck.claims.filter((c) => factCheckClaimCountable(c)).length, 2,
    "the panel's countable claims are not the check's own two");
  assert.equal(data.factCheck.claims.filter((c) => c.kind === "unattributed").length, 1,
    "the out of set claim is not tagged unattributed in the shipped panel — " +
    "it must stay visible there while leaving the denominator");
  assert.ok(/Rayleigh scattering/.test(data.answer || ""),
    "the answer degraded away from its supported teaching");
  const line = (data.confidence && data.confidence.line) || "";
  assert.ok(line.includes("The claim check supports 1 of 2 checked claims"),
    "the confidence line does not carry the corrected count: " + line);
  assert.ok(data._ledger && data._ledger.used <= 50 &&
    data._ledger.used + data._ledger.remaining === data._ledger.limit,
    "the ledger does not close at its limit on the sky run");
});

// ═══════════════════════════════════════════════════════════════
group("Item 2 — handler: the titleless founding paper enters the cited set");

const CRISPR_REVIEWS_EPMC = [
  epmc12("rev1", "CRISPR Cas9 genome editing: recent advances and future prospects",
    "This review covers recent advances in CRISPR Cas9 genome editing, including guide RNA design, screening applications, and delivery. Progress in understanding DNA cleavage by Cas9 and in repairing the resulting breaks is summarized for researchers entering the field.", 420, "2024"),
  epmc12("rev2", "Mechanisms of CRISPR Cas9 DNA cleavage: a review",
    "This review surveys how CRISPR Cas9 cuts DNA. Guide RNA recognition of the target sequence positions the Cas9 endonuclease, whose two nuclease domains cleave the two DNA strands at a defined site. Structural work on binding of the guide and the target strand, and on the conformational changes that license cleavage, is summarized, together with open questions about repair after the break.", 340, "2023"),
  epmc12("rev3", "CRISPR Cas systems in bacteria and their use in genome engineering",
    "Bacterial CRISPR Cas systems are reviewed as immune systems and as engineering tools. The diversity of Cas endonuclease families, guide processing, and target recognition across species is described, with attention to how recognition differs between systems.", 260, "2022"),
  epmc12("rev4", "Repair of CRISPR Cas9 induced DNA breaks: pathways and outcomes",
    "After Cas9 cleavage, cells repair double strand breaks by competing pathways. This review compares the repair outcomes reported across studies and the factors that shift the balance between them, including cell cycle stage and template availability for repair synthesis.", 150, "2024"),
];
const J2_THIN_EPMC = {
  title: J2_TITLE, doi: J2_DOI, pubYear: "2012", citedByCount: null,
  authorString: "Jinek M, Chylinski K, Fonfara I, Hauer M, Doudna JA, Charpentier E",
  journalTitle: "Science", abstractText: "",
};
const J2_OA = {
  title: J2_TITLE, doi: "https://doi.org/" + J2_DOI, publication_year: 2012,
  cited_by_count: 9500,
  authorships: [{ author: { display_name: "Jinek M" } }],
  primary_location: { source: { display_name: "Science" }, landing_page_url: "https://example.org/j2" },
  abstract_inverted_index: inverted(J2_ABSTRACT), type: "article",
};
const J2_S2 = {
  title: J2_TITLE, abstract: J2_ABSTRACT, year: 2012, citationCount: 9500,
  authors: [{ name: "Jinek M" }], venue: "Science", externalIds: { DOI: J2_DOI },
};
const CRISPR_ANSWER_12 = "CRISPR Cas9 cuts DNA when a guide RNA leads the Cas9 protein to a matching DNA sequence and Cas9 cleaves both strands of the DNA, making a double strand break at that spot. [1][2]\n\n**How the cut happens:**\n\n- **Guided targeting:** the guide RNA recognizes the target DNA next to a short motif, positioning the Cas9 endonuclease for cleavage of the DNA, and recent reviews of CRISPR Cas9 genome editing describe the same guided targeting step [1][2].\n- **Two strand cuts:** the nuclease domains of Cas9 each cleave one strand of the DNA, so the break goes through both strands, and the cell then repairs the broken DNA, which is where the edit becomes permanent [1][2].\n- **Why it is precise:** because the guide RNA is what recognizes the target, changing the guide changes where Cas9 cuts the DNA, a point the primary description of the system and the later reviews both make [1][2].";

await test("the founding paper arrives thin, folds rich, and is cited; the lane legs ask for citation order", async () => {
  scenPapers = CRISPR_REVIEWS_EPMC;
  scenLaneEpmc = [J2_THIN_EPMC];
  scenLaneOpenAlex = [J2_OA];
  scenLaneS2 = [J2_S2];
  scenAnswer = CRISPR_ANSWER_12;
  scenFactCheck = null;
  scenRetryAnswer = null;
  const { data, fetchLog } = await runScenario("how does crispr cas9 actually cut dna");
  const laneEpmc = fetchLog.find((f) => f.url.includes("ebi.ac.uk") && isLaneUrl(f.url));
  assert.ok(laneEpmc, "the foundational lane did not fire on the CRISPR question");
  assert.ok(decoded(laneEpmc.url).includes("sort=CITED"),
    "the lane's Europe PMC leg does not ask for citation order: " + decoded(laneEpmc.url));
  assert.ok(fetchLog.some((f) => f.url.includes("api.openalex.org") && decoded(f.url).includes("cited_by_count:desc")),
    "the lane's OpenAlex leg does not ask for citation order");
  assert.ok(fetchLog.some((f) => f.url.includes("api.semanticscholar.org") && decoded(f.url).includes("citationCount:desc")),
    "the lane's Semantic Scholar leg does not ask for citation order");
  const titles = (data.sources || []).map((s) => s.title);
  assert.ok(titles.some((t) => t === J2_TITLE),
    "the titleless founding paper is not in the shipped source list: " + titles.join(" | "));
  const recEntry = ((data._record && data._record.sources) || []).find((s) => s.title === J2_TITLE);
  assert.ok(recEntry && recEntry.cited === true,
    "the founding paper is listed but never cited: " + JSON.stringify(recEntry || null));
  const lane = (data._funnel && data._funnel.foundationalLane) ||
    (data._record && data._record.funnel && data._record.funnel.foundationalLane);
  assert.ok(lane && lane.shape === "mechanism",
    "the funnel does not record the mechanism lane: " + JSON.stringify(lane || null));
  assert.ok(data._ledger && data._ledger.used <= 50 &&
    data._ledger.used + data._ledger.remaining === data._ledger.limit,
    "the ledger does not close at its limit on the CRISPR run");
});

// ═══════════════════════════════════════════════════════════════
group("Item 3 — handler: the plain PCR wording presents a real pool (live recovery verified by the parent)");

const MULLIS_TITLE = "Specific synthesis of DNA in vitro via a polymerase catalyzed chain reaction";
const MULLIS_ABSTRACT = "A method is described for the in vitro synthesis of specific DNA segments. Oligonucleotide primers that flank the segment are annealed to the template, and a DNA polymerase extends them; repeated cycles of denaturation, primer annealing, and extension double the amount of the target segment in each cycle, so millions of copies of the segment accumulate. The polymerase chain reaction (PCR) makes a chosen DNA sequence available in quantity from a complex mixture.";
const PCR_POOL = [
  epmc12("pcr1", "Plasmid copy number determination by quantitative PCR",
    "A quantitative PCR method is described for determining plasmid copy number in bacterial cultures. Amplification of a plasmid target and a chromosomal reference in the same reaction gives the copy ratio directly from the copies of each segment counted per cycle, and the method agrees with sequencing based estimates across a range of copy numbers of plasmid DNA.", 640, "2009"),
  epmc12("pcr2", "Real time quantitative PCR: principles and applications",
    "Real time PCR monitors amplification as it happens by fluorescence. This review explains how the cycle at which signal crosses a threshold reports the starting number of template copies, and covers probe chemistries, calibration curves, and the quantification of DNA copy number and RNA targets in research and diagnostics. Each cycle doubles the copies of the target segment, so the fluorescence traces the exponential growth of copies directly.", 890, "2018"),
  epmc12("pcr3", "Optimization of PCR conditions for amplifying GC rich templates",
    "GC rich DNA templates resist amplification because of stable secondary structure. Additives and modified cycling conditions that relax the structure are compared, and conditions are reported under which polymerase extension proceeds through GC rich segments to give full length copies of the target DNA at yields matching ordinary templates, doubling the copies each cycle once extension succeeds.", 210, "2016"),
  epmc12("pcr4", "Digital PCR for absolute quantification of nucleic acids",
    "Digital PCR partitions a sample into thousands of reactions so that each partition holds zero or one template molecules. Counting positive partitions after amplification gives the absolute number of DNA copies without a standard curve, with applications in rare variant detection and copy number measurement.", 720, "2020"),
  epmc12("pcr5", "PCR based detection of bacterial pathogens in clinical samples",
    "PCR assays that amplify pathogen DNA from clinical samples are evaluated against culture. Because each cycle doubles the copies of the pathogen target segment, amplification based detection identified infections hours earlier than culture, and the study reports sensitivity and specificity for the primer sets used across three hospitals, with detection down to tens of copies per sample.", 340, "2021"),
  epmc12("pcr6", "Amplification of ancient DNA from museum specimens",
    "DNA recovered from museum specimens is fragmented and scarce. This study reports amplification of short target segments from century old skins, the controls used to exclude modern contamination, and the yields obtained from polymerase chain reaction under low template conditions.", 480, "2015"),
];
const PCR_ANSWER = "PCR makes more copies of DNA by repeating a three step cycle that doubles the target segment every round. [1][2][3]\n\n**The cycle:**\n\n- **Denaturation and annealing:** heat separates the two DNA strands, and short primers anneal to the segment the researcher wants to copy, one on each strand flanking the target [1][2].\n- **Extension:** a heat stable DNA polymerase extends each primer, building a new strand, so each cycle ends with twice as many copies of the segment as it began with [1][3].\n- **Exponential growth:** because the new copies themselves become templates, the segment defined by the two primers accumulates exponentially while everything outside the primers is copied only linearly [1][2][3].\n- **Counting copies:** the same doubling is what quantitative PCR reads: the cycle at which a reaction's fluorescence crosses its threshold reports how many copies of the target it started with [4].";

await test("the parent's exact wording fires the lane and presents at least six sources with at least four cited", async () => {
  scenPapers = PCR_POOL;
  scenLaneEpmc = [epmc12("mullis", MULLIS_TITLE, MULLIS_ABSTRACT, 12000, "1987")];
  scenLaneOpenAlex = [{
    title: MULLIS_TITLE, doi: "https://doi.org/10.1000/w12-mullis", publication_year: 1987,
    cited_by_count: 12000, authorships: [{ author: { display_name: "Mullis K" } }],
    primary_location: { source: { display_name: "Methods in Enzymology" }, landing_page_url: "https://example.org/mullis" },
    abstract_inverted_index: inverted(MULLIS_ABSTRACT), type: "article",
  }];
  scenLaneS2 = [{
    title: MULLIS_TITLE, abstract: MULLIS_ABSTRACT, year: 1987, citationCount: 12000,
    authors: [{ name: "Mullis K" }], venue: "Methods in Enzymology", externalIds: { DOI: "10.1000/w12-mullis" },
  }];
  scenAnswer = PCR_ANSWER;
  scenFactCheck = null;
  scenRetryAnswer = null;
  const { data } = await runScenario("how does pcr make more copies of dna");
  const lane = (data._funnel && data._funnel.foundationalLane) ||
    (data._record && data._record.funnel && data._record.funnel.foundationalLane);
  assert.ok(lane && lane.shape === "mechanism",
    "the lane did not fire as a mechanism lane for the plain PCR wording: " + JSON.stringify(lane || null));
  const sources = data.sources || [];
  assert.ok(sources.length >= 6,
    `only ${sources.length} sources presented for the PCR question — the thin pool is back`);
  const citedCount = ((data._record && data._record.sources) || []).filter((s) => s.cited).length;
  assert.ok(citedCount >= 4,
    `only ${citedCount} sources cited for the PCR question — the thin pool is back at the citation layer`);
  const mullis = ((data._record && data._record.sources) || []).find((s) => s.title === MULLIS_TITLE);
  assert.ok(mullis && mullis.cited === true,
    "the 1987 first description is not among the cited sources: " + JSON.stringify(mullis || null));
  assert.ok(data._ledger && data._ledger.used <= 50 &&
    data._ledger.used + data._ledger.remaining === data._ledger.limit,
    "the ledger does not close at its limit on the PCR run");
});

// ═══════════════════════════════════════════════════════════════
group("Item 4 — handler: a clean single source answer outside the old shapes gets its one retry");

const LEAF_Q = "why do leaves change color in the fall";
const LEAF_POOL = [
  epmc12("leaf1", "Chlorophyll breakdown and the color change of autumn leaves",
    "As days shorten in autumn, chlorophyll in leaves is broken down and not replaced. The green pigment's disappearance unmasks yellow carotenoid pigments that were present all along, and the breakdown products are moved out of the leaf before it is shed. The study tracks pigment concentrations through senescence in three tree species.", 260, "2011"),
  epmc12("leaf2", "Anthocyanin production in autumn leaves protects against light damage",
    "Red autumn leaves synthesize anthocyanin pigments as chlorophyll declines. The pigments screen the leaf from excess light while nutrients are withdrawn, and leaves that redden resorb more nitrogen than leaves that only yellow, supporting a protective role for the red pigments during senescence.", 310, "2008"),
  epmc12("leaf3", "Photoperiod and cooling temperatures trigger leaf senescence in autumn",
    "Shortening day length, sensed through photoreceptors, initiates leaf senescence in autumn, and cooling temperatures accelerate it. The hormonal signals that start chlorophyll breakdown are described, together with experiments separating the day length signal from the temperature signal in poplar.", 190, "2015"),
  epmc12("leaf4", "Nutrient resorption from senescing leaves before they fall",
    "Trees withdraw nitrogen and phosphorus from leaves before abscission. Resorption efficiency varies with species and soil fertility, and the timing of withdrawal is coordinated with pigment breakdown so that the leaf's nutrients are recovered before the leaf is shed in autumn.", 150, "2013"),
  epmc12("leaf5", "The signaling hypothesis for red autumn leaf colors",
    "Bright red autumn leaves may signal a tree's vigor to aphids choosing where to lay eggs. This paper tests the signaling hypothesis across tree species and finds aphids avoid the reddest trees, while noting the photoprotection account explains part of the same pattern.", 220, "2001"),
  epmc12("leaf6", "Carotenoid pigments unmasked as chlorophyll disappears from fall leaves",
    "Yellow fall color comes from carotenoid pigments that sit in the leaf all summer, masked by chlorophyll. Spectroscopic measurements follow the carotenoids as chlorophyll vanishes and show the yellows are revealed rather than newly made, unlike the red anthocyanins.", 130, "2019"),
];
const LEAF_ANSWER_ONE = "Leaves change color in the fall because **chlorophyll**, the green pigment that runs photosynthesis, is broken down as the days shorten and is not replaced [1].\n\n**What the breakdown reveals:**\n\n- **Yellows were already there:** once the green pigment disappears, the yellow carotenoid pigments that sat in the leaf all summer become visible, which is why so many species turn yellow first [1].\n- **Nutrients leave before the leaf does:** as the pigment breaks down, the tree pulls nitrogen and other nutrients out of the leaf and stores them, and the emptying leaf is then shed [1].\n- **The trigger is the season:** shortening days start the shutdown of the leaf's green machinery, so the color change sweeps in with autumn rather than with the first frost [1].";
const LEAF_ANSWER_TWO = "Leaves change color in the fall because **chlorophyll**, the green pigment that runs photosynthesis, is broken down as the days shorten and is not replaced [1][3].\n\n**What the breakdown reveals:**\n\n- **Yellows were already there:** once the green pigment disappears, the yellow carotenoid pigments that sat in the leaf all summer become visible, which is why so many species turn yellow first [1].\n- **The trigger is the season:** shortening day length, sensed by the leaf, initiates senescence, and cooling temperatures then accelerate the breakdown of chlorophyll [3].\n- **Nutrients leave before the leaf does:** as senescence proceeds the tree withdraws nitrogen from the leaf before it is shed, a withdrawal the photoperiod signal and the pigment breakdown are coordinated with [1][3].";

await test("the leaves question is outside both old shapes, yet the single source outcome is retried and recovered", async () => {
  assert.equal(isMechanismShapeQuery(LEAF_Q), false, "the leaves question reads as a mechanism shape");
  assert.equal(detectMeasurementIntent(LEAF_Q), false, "the leaves question reads as a measurement question");
  scenPapers = LEAF_POOL;
  scenLaneEpmc = []; scenLaneOpenAlex = []; scenLaneS2 = [];
  scenAnswer = LEAF_ANSWER_ONE;
  scenRetryAnswer = LEAF_ANSWER_TWO;
  scenFactCheck = null;
  // The harness's fixed overhead runs within a subrequest or
  // two of the tail reserve at the production limit (the next
  // test pins that boundary), so the recovery path is exercised
  // at a raised ledger limit, the wave nine trade test's
  // precedent. The closure assertion still binds: the retry's
  // spend lands inside the ledger, never past it.
  const { data } = await runScenario(LEAF_Q, { limit: 60 });
  const ms = data._record && data._record.minSupport;
  assert.ok(ms, "the record carries no minimum cited support outcome for a single source clean answer");
  assert.equal(ms.citedBefore, 1, "the run did not land on exactly one cited source: " + JSON.stringify(ms));
  assert.equal(ms.retried, true, "no retry fired for a clean single source answer outside the old shapes");
  assert.ok(typeof ms.retryModel === "string" && ms.retryModel.length > 0,
    "the retry is not labeled with its model in the record");
  assert.ok(ms.citedAfter >= 2, "the retry did not lift the answer to two sources: " + JSON.stringify(ms));
  assert.equal(ms.singleSource, false, "the record still labels the shipped answer single source");
  assert.equal(ms.reason, "recovered", "the record's reason is not recovered: " + ms.reason);
  assert.ok((data.answer || "").includes("[1]") && (data.answer || "").includes("[3]"),
    "the shipped answer does not cite the two sources the record claims");
  assert.ok(data._ledger && data._ledger.used <= data._ledger.limit &&
    data._ledger.used + data._ledger.remaining === data._ledger.limit,
    "the ledger does not close at its limit with the retry spent: " + JSON.stringify(data._ledger));
});

await test("at the production limit the retry fires on the tail the ship point meter freed, and the record labels the recovery", async () => {
  // PIN UPDATED (2026-10-16, finding 6): this scenario used to
  // land on the budget refusal — the harness's fixed overhead
  // left the tail reserve spent by the time the minimum support
  // block read it. The AI answer meter then moved from the wave
  // win to the ship point (a caller is now charged only when an
  // AI answer actually ships, after every gate that can discard
  // the draft), so the unit the mid pipeline meter used to spend
  // no longer eats the tail before the retry gate: the same
  // harness spend now deterministically lands on the firing
  // side. The retry fires, recovers the answer to two cited
  // sources, the shipped mode is AI (and is metered at the ship
  // point — the usage spend is in the ledger below), the record
  // labels the outcome recovered rather than single source, and
  // the ledger still closes at exactly 50. The contract this
  // pin protects — the record tells the truth about the retry
  // outcome and the ledger closes — is unchanged; which side of
  // the gate this harness lands on moved with the meter.
  scenPapers = LEAF_POOL;
  scenLaneEpmc = []; scenLaneOpenAlex = []; scenLaneS2 = [];
  scenAnswer = LEAF_ANSWER_ONE;
  scenRetryAnswer = LEAF_ANSWER_TWO;
  scenFactCheck = null;
  const { data } = await runScenario(LEAF_Q);
  const ms = data._record && data._record.minSupport;
  assert.ok(ms, "the record carries no minimum cited support outcome at the production limit");
  assert.equal(ms.citedBefore, 1, "the run did not land on exactly one cited source: " + JSON.stringify(ms));
  assert.equal(ms.retried, true, "the retry did not fire on the freed tail: " + JSON.stringify(ms));
  assert.equal(ms.citedAfter, 2, "the retry did not recover the answer to two cited sources: " + JSON.stringify(ms));
  assert.equal(ms.reason, "recovered", "the outcome is not recorded as a recovery: " + JSON.stringify(ms));
  assert.equal(ms.singleSource, false, "the recovered outcome is mislabeled single source in the record");
  assert.equal(data.synthesisMode, "ai", "the recovered answer did not ship as AI");
  assert.ok(data._ledger && data._ledger.used <= 50 &&
    data._ledger.used + data._ledger.remaining === data._ledger.limit,
    "the ledger does not close at exactly 50 on the recovered run: " + JSON.stringify(data._ledger));
});

// ═══════════════════════════════════════════════════════════════
group("Wave twelve — the cache version pin");

await test("CACHE_SCHEMA_VERSION is v49 with the wave fourteen chain entry, v47 kept as history", () => {
  // PIN UPDATED (2026-10-14, wave thirteen): v48 —
  // foundational primaries get presentation priority, the
  // title rule requires topical company for every sighting,
  // and the claim check records a named tier trace with a
  // fallback model attempt and literature claim selection.
  // The wave twelve entry stays as history; this pin follows
  // the constant.
  // PIN UPDATED (2026-10-14, wave fourteen): v49 — the
  // search record carries the foundational fate diagnostic,
  // and the LLM validation pass can no longer remove a gate
  // cleared foundational primary.
  // PIN UPDATED (2026-10-14, wave fifteen): v50 — the
  // foundational lane gains founding form legs over the
  // unexpanded system name, and the record gains the
  // foundational near miss section.
  // PIN UPDATED (2026-10-14, wave sixteen): v51, the serve
  // side honesty wave. The v50 entry stays as history below.
  // PIN UPDATED (2026-10-15, wave seventeen): v52, the
  // citation depth wave. The v51 entry stays as history below.
  assert.ok(src.includes('const CACHE_SCHEMA_VERSION = "v52";'),
    "CACHE_SCHEMA_VERSION was not bumped to v52");
  assert.ok(/\/\/ v51 \(2026-10-14, wave sixteen\)/.test(src),
    "the v51 chain entry is missing its dated reason");
  assert.ok(/\/\/ v50 \(2026-10-14, wave fifteen\)/.test(src),
    "the v50 chain entry is missing its dated reason");
  assert.ok(/\/\/ v49 \(2026-10-14, wave fourteen\)/.test(src),
    "the v49 chain entry is missing its dated reason");
  assert.ok(/\/\/ v48 \(2026-10-14, wave thirteen\)/.test(src),
    "the v48 chain entry is missing its dated reason");
  assert.ok(/\/\/ v47 \(2026-10-14, wave twelve\)/.test(src),
    "the v47 chain entry was removed — the chain is history and stays");
});

console.log(`\nsearch-wave-twelve: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
