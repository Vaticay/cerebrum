/**
 * Search wave eight, round three (2026-10-14, seventh panel):
 * the retrieval and source plumbing.
 *
 *   Job 1: the source count is true. Zenodo leaves the
 *     canonical list (the fanout never called it and its
 *     records are hard rejected at admission), the count is
 *     14 everywhere it is derived, the fanout's names and
 *     fetchers are one paired structure, and a full handler
 *     run proves every source's papers are counted under
 *     their own name (the old parallel arrays had shifted
 *     every label from slot 9 onward). The prompts derive
 *     the count and the name list from the canonical list.
 *   Job 2: PubMed returns. The fetcher is two calls (esearch,
 *     then efetch; esummary is gone), and on a capped ledger
 *     the fanout fires the clinical trio (PubMed, Europe PMC,
 *     OpenAlex) to completion before the long tail starts,
 *     so the refusals land on the tail, not on PubMed.
 *   Job 3: validation has a leg on a separate quota family.
 *     With the Workers AI leg throwing its quota error and
 *     no fetch pool keys at all, the Gemini leg still
 *     returns a verdict.
 *   Job 4: swimmer's ear bridges to otitis externa, and bare
 *     nutrient names (vitamin D and its class) resolve as
 *     central concepts, so both panel shapes cite their
 *     clinical papers.
 *   Job 5: the synthesis stage closes on a passing draft.
 *     A draft that passes the citation binding but scores
 *     under the quality bar no longer re fires the quality
 *     retry; a draft that fails the binding still does.
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 * Handler scenarios run the real onRequest against a stub env
 * modeled on tests/search-wave-eight.mjs.
 *
 * Run with: node tests/search-wave-eight-r3.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const search = await import(join(root, "functions/api/search.js"));

// The swimmer's ear question: the panel's Job 4a shape, used by
// the Job 1 parity run (it is the handler clean shape whose
// shelf fills on the first rung) and by the Job 4 fixtures.
const Q_SWIM = "why do I keep getting swimmer's ear and how do I stop it";
const { onRequest, createSubrequestLedger } = search;
const {
  citationGateStandard, paperClearsCitationGate, paperIsCitable,
  buildDeterministicFallbackGroups, buildDynLookup, centralContentTerms,
  questionCentralConcepts, defaultValidationCall, llmValidatePapers,
  SOURCE_NAMES_TEXT,
} = search;
const { SCHOLARLY_SOURCES, SOURCE_COUNT } = await import(join(root, "functions/lib/product.js"));

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

// ── Scenario runner (wave eight pattern, plus a fetch log) ──
let scenPapers = [];
let scenAnswer = "";
let scenFetchLog = [];

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
      if (u.includes("BODY")) return jsonRes({ resultList: { result: [] } });
      return jsonRes({ resultList: { result: scenPapers } });
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
      OPENROUTER_KEY: "r3-test-openrouter-key-123456",
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

const epmc = (n, title, abstractText, citedByCount) => ({
  title,
  doi: "10.1000/r3" + n,
  pubYear: "2024",
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});

// ═══════════════════════════════════════════════════════════════
group("Job 1 — the canonical list is the fanout, slot for slot");

await test("SOURCE_COUNT is 14 and Zenodo is not on the canonical list", () => {
  assert.equal(SOURCE_COUNT, 14, `SOURCE_COUNT is ${SOURCE_COUNT}`);
  assert.ok(!SCHOLARLY_SOURCES.some((s) => s.id === "zenodo"), "zenodo is still advertised");
  assert.equal(SCHOLARLY_SOURCES.length, 14);
});

await test("the search fanout's slots and pairs equal the canonical list in order", () => {
  const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
  const m = src.match(/const sourceNames = \[([\s\S]*?)\];/);
  assert.ok(m, "sourceNames array not found in search.js");
  const slotIds = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(slotIds, SCHOLARLY_SOURCES.map((s) => s.id),
    "the fanout slot list and product.js disagree");
  // The paired structure: every { name, fetch } pair in the
  // fanout, in order, is the canonical list (openAlexCommon is
  // an extra query on the openAlex slot, not a source).
  const fanoutStart = src.indexOf("const fanout = ");
  const fanoutEnd = src.indexOf("return { pairs", fanoutStart);
  assert.ok(fanoutStart > 0 && fanoutEnd > fanoutStart, "fanout pairs block not found");
  const pairNames = [...src.slice(fanoutStart, fanoutEnd).matchAll(/\{\s*name: "([^"]+)", fetch:/g)].map((x) => x[1]);
  assert.deepEqual(pairNames.filter((n) => n !== "openAlexCommon"), SCHOLARLY_SOURCES.map((s) => s.id),
    "the fanout pairs and the canonical list disagree: " + pairNames.join(","));
  assert.ok(!pairNames.includes("zenodo"), "the fanout still names zenodo");
});

await test("the prompts derive the count and the names from the canonical list", () => {
  const src = readFileSync(join(root, "functions/api/search.js"), "utf8");
  assert.equal(SOURCE_NAMES_TEXT, SCHOLARLY_SOURCES.map((s) => s.name).join(", "),
    "SOURCE_NAMES_TEXT is not the canonical name list");
  assert.ok(src.includes("You search ${SOURCE_COUNT} open scholarly databases in parallel: ${SOURCE_NAMES_TEXT}"),
    "the persona does not derive its source claim");
  assert.ok(src.includes("You search \" + SOURCE_COUNT + \" open scholarly databases simultaneously"),
    "the system prompt does not derive its count");
  assert.ok(src.includes("queries \" + SOURCE_COUNT + \" scholarly"),
    "the intelligence prompt does not derive its count");
  assert.ok(!/search 15 open scholarly|15 open scholarly databases|queries 14 scholarly|The 15-database/.test(src),
    "a hardcoded source count survives in a prompt");
  for (const name of SCHOLARLY_SOURCES.map((s) => s.name)) {
    assert.ok(SOURCE_NAMES_TEXT.includes(name), `the prompt name list omits ${name}`);
  }
});

// ═══════════════════════════════════════════════════════════════
group("Job 1 — a full run counts every source's papers under its own name");

// One topic (ankle sprain care), every source answering with a
// DISTINCT number of papers, so any label shift moves a count
// to the wrong name and fails the assertion. Under the old
// parallel arrays this run would have counted PLOS's 10 papers
// as "zenodo", CORE's 11 as "plos", and nothing at all as
// "preprints".
const ANKLE_ABSTRACTS = [
  "Otitis externa, often called swimmer's ear, is an inflammation of the external ear canal caused by water exposure and bacterial infection of the canal skin. This randomised trial tested topical antimicrobial therapy against acidifying ear drops for otitis externa, following swimmers through two weeks of treatment. The topical group reported faster resolution of ear pain and canal inflammation, with fewer recurrent episodes of swimmer's ear at follow up.",
  "The management of otitis externa remains debated despite its frequency. This systematic review pooled trials of topical antibiotics, antiseptics, and drying regimens for swimmer's ear, finding consistent evidence that topical therapy resolves otitis externa faster and that keeping the ear canal dry after swimming prevents recurrence of the infection.",
  "Recurrent otitis externa affects swimmers and surfers disproportionately. This cohort study followed patients with repeated swimmer's ear episodes over a season, testing whether acidifying ear drops after swimming and thorough canal drying reduced new otitis externa infections compared with no prevention, and found a clear reduction in episodes and in days of ear pain.",
];
const ANKLE_TITLES = [
  "Topical therapy for otitis externa",
  "Swimmer's ear prevention in regular swimmers",
  "Acidifying ear drops for otitis externa",
  "Antimicrobial drops and canal drying in otitis externa",
  "Recurrent otitis externa in swimmers",
  "Ear canal care after swimming",
  "Otitis externa treatment in primary care",
  "Water exposure and swimmer's ear",
  "Drying regimens for the external ear canal",
  "Otitis externa outcomes with topical therapy",
];
const ANKLE_SUBTITLES = ["a randomised trial", "a systematic review", "a cohort study", "a clinical trial", "a prospective study", "a controlled trial", "a follow up study", "a pragmatic trial", "a multicentre trial", "an outcomes study", "a pilot trial", "a registry study", "a comparative study", "a validation study"];
const parityTitle = (i) => ANKLE_TITLES[i % ANKLE_TITLES.length] + ": " + ANKLE_SUBTITLES[Math.floor(i / ANKLE_TITLES.length) % ANKLE_SUBTITLES.length];
const parityAbstract = (i) => ANKLE_ABSTRACTS[i % ANKLE_ABSTRACTS.length];
let paritySeq = 0;
const parityDoi = (tag) => "10.1000/par-" + tag + "-" + (paritySeq++);
const epmcRows = (tag, n) => Array.from({ length: n }, (_, i) => ({
  title: parityTitle(paritySeq),
  doi: parityDoi(tag),
  pubYear: "2023",
  citedByCount: 20 + i,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Ear Studies",
  abstractText: parityAbstract(i),
}));
const inverted = (text) => {
  const idx = {};
  text.split(/\s+/).forEach((w, i) => {
    const k = w.replace(/[^A-Za-z0-9-]/g, "");
    if (k) (idx[k] = idx[k] || []).push(i);
  });
  return idx;
};
const openAlexRows = (tag, n) => Array.from({ length: n }, (_, i) => ({
  title: parityTitle(paritySeq),
  doi: "https://doi.org/" + parityDoi(tag),
  publication_year: 2023,
  cited_by_count: 15 + i,
  authorships: [{ author: { display_name: "Doe J" } }, { author: { display_name: "Roe K" } }],
  primary_location: { source: { display_name: "Journal of Ear Studies" }, landing_page_url: "https://example.org/ankle" },
  abstract_inverted_index: inverted(parityAbstract(i)),
  type: "article",
}));
const pubmedXml = (n) => {
  const arts = Array.from({ length: n }, (_, i) => `
  <PubmedArticle><MedlineCitation><PMID Version="1">900${i}</PMID><Article>
    <ArticleTitle>${parityTitle(paritySeq)}</ArticleTitle>
    <Abstract><AbstractText>${parityAbstract(i)}</AbstractText></Abstract>
    <AuthorList><Author><LastName>Doe</LastName><Initials>J</Initials></Author><Author><LastName>Roe</LastName><Initials>K</Initials></Author></AuthorList>
    <Journal><Title>Journal of Ear Studies</Title><JournalIssue><PubDate><Year>2023</Year></PubDate></JournalIssue></Journal>
  </Article><PubmedData><ArticleIdList><ArticleId IdType="doi">${parityDoi("pubmed")}</ArticleId></ArticleIdList></PubmedData></MedlineCitation></PubmedArticle>`).join("");
  return `<?xml version="1.0"?><PubmedArticleSet>${arts}</PubmedArticleSet>`;
};

const PARITY_COUNTS = {
  europePMC: 3, pubmed: 2, openAlex: 4, crossref: 5, arxiv: 6,
  semanticScholar: 7, doaj: 8, biorxiv: 9, plos: 10, CORE: 11,
  BASE: 12, pmcFullText: 13, openAire: 14, preprints: 1,
};
function parityFetch(u) {
  if (u.includes("ebi.ac.uk/europepmc")) {
    let q = "";
    try { q = new URL(u).searchParams.get("query") || ""; } catch { q = ""; }
    if (q.includes("SRC:PPR")) return jsonRes({ resultList: { result: epmcRows("preprints", PARITY_COUNTS.preprints) } });
    if (q.includes("BODY:")) return jsonRes({ resultList: { result: epmcRows("pmc", PARITY_COUNTS.pmcFullText) } });
    return jsonRes({ resultList: { result: epmcRows("epmc", PARITY_COUNTS.europePMC) } });
  }
  if (u.includes("eutils.ncbi.nlm.nih.gov")) {
    if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: ["9000", "9001"] } });
    if (u.includes("efetch")) return new Response(pubmedXml(PARITY_COUNTS.pubmed), { status: 200, headers: { "Content-Type": "text/xml" } });
    return jsonRes({});
  }
  if (u.includes("api.openalex.org")) {
    if (u.includes("type%3Aarticle")) return jsonRes({ results: openAlexRows("openalex", PARITY_COUNTS.openAlex) });
    return jsonRes({ results: openAlexRows("biorxiv", PARITY_COUNTS.biorxiv) });
  }
  if (u.includes("api.crossref.org")) {
    return jsonRes({ message: { items: Array.from({ length: PARITY_COUNTS.crossref }, (_, i) => ({
      title: [parityTitle(paritySeq)],
      DOI: parityDoi("crossref"),
      published: { "date-parts": [[2023]] },
      issued: { "date-parts": [[2023]] },
      author: [{ given: "Jane", family: "Doe" }],
      "container-title": ["Journal of Ear Studies"],
      abstract: parityAbstract(i),
    })) } });
  }
  if (u.includes("export.arxiv.org")) {
    const entries = Array.from({ length: PARITY_COUNTS.arxiv }, (_, i) => `
    <entry><title>${parityTitle(paritySeq)}</title><summary>${parityAbstract(i)}</summary>
    <author><name>Doe J</name></author><id>http://arxiv.org/abs/2401.77${i}</id><published>2023-02-01T00:00:00Z</published></entry>`).join("");
    return new Response(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries}</feed>`, { status: 200, headers: { "Content-Type": "text/xml" } });
  }
  if (u.includes("api.semanticscholar.org")) {
    return jsonRes({ data: Array.from({ length: PARITY_COUNTS.semanticScholar }, (_, i) => ({
      title: parityTitle(paritySeq),
      abstract: parityAbstract(i),
      year: 2023,
      citationCount: 9 + i,
      authors: [{ name: "Doe J" }],
      venue: "Journal of Ear Studies",
      externalIds: { DOI: parityDoi("s2") },
    })) });
  }
  if (u.includes("doaj.org")) {
    return jsonRes({ results: Array.from({ length: PARITY_COUNTS.doaj }, (_, i) => ({
      bibjson: {
        title: parityTitle(paritySeq),
        year: "2023",
        identifier: [{ type: "doi", id: parityDoi("doaj") }],
        author: [{ name: "Doe J" }],
        journal: { title: "Journal of Ear Studies" },
        abstract: parityAbstract(i),
      },
    })) });
  }
  if (u.includes("api.plos.org")) {
    return jsonRes({ response: { docs: Array.from({ length: PARITY_COUNTS.plos }, (_, i) => ({
      id: parityDoi("plos"),
      title_display: parityTitle(paritySeq),
      author_display: ["Doe J"],
      journal: "Journal of Ear Studies",
      publication_date: "2023-03-01T00:00:00Z",
      abstract: [parityAbstract(i)],
    })) } });
  }
  if (u.includes("api.core.ac.uk")) {
    return jsonRes({ results: Array.from({ length: PARITY_COUNTS.CORE }, (_, i) => ({
      title: parityTitle(paritySeq),
      doi: parityDoi("core"),
      yearPublished: 2023,
      authors: [{ name: "Doe J" }],
      publisher: "Journal of Ear Studies",
      abstract: parityAbstract(i),
    })) });
  }
  if (u.includes("api.base-search.net")) {
    return jsonRes({ response: { docs: Array.from({ length: PARITY_COUNTS.BASE }, (_, i) => ({
      dctitle: [parityTitle(paritySeq)],
      dcidentifier: ["https://doi.org/" + parityDoi("base")],
      dcyear: ["2023"],
      dcperson: ["Doe J"],
      dcsource: ["Journal of Ear Studies"],
      dcdescription: [parityAbstract(i)],
    })) } });
  }
  if (u.includes("api.openaire.eu")) {
    return jsonRes({ response: { results: { result: Array.from({ length: PARITY_COUNTS.openAire }, (_, i) => ({
      metadata: { "oaf:entity": { "oaf:result": {
        title: parityTitle(paritySeq),
        creator: [{ $: "Doe J" }],
        pid: [{ "@classid": "doi", $: parityDoi("openaire") }],
        dateofacceptance: "2023-04-01",
        journal: { $: "Journal of Ear Studies" },
        description: parityAbstract(i),
      } } },
    })) } } });
  }
  return null;
}

await test("per source labels match the fetcher that produced each paper", async () => {
  paritySeq = 0;
  scenPapers = [];
  scenAnswer = "Otitis externa keeps coming back when water stays in the ear canal after swimming. [1][2]\n\n**What helps:**\n\n- **Treat the canal:** topical antimicrobial therapy resolves otitis externa, and the trial evidence supports it [1][2].\n- **Keep it dry:** drying the ear canal after swimming and using acidifying ear drops prevent recurrent swimmer\u2019s ear episodes [1][2].\n- **Avoid swabs:** cotton swabs push debris deeper and worsen canal inflammation, so the reviews advise against them in otitis externa care [1][2].";
  const { data } = await runScenario(Q_SWIM, { parityFetch, limit: 300 });
  assert.ok(Array.isArray(data.sourcesQueried), "the response carries no per source record: " + Object.keys(data).join(","));
  const byName = new Map(data.sourcesQueried.map((d) => [d.source, d.count]));
  assert.equal(data.sourcesQueried.length, 14, "the run should record exactly the 14 canonical sources: " + [...byName.keys()].join(","));
  assert.ok(!byName.has("zenodo"), "a source the fanout never calls is still being counted");
  for (const [name, expected] of Object.entries(PARITY_COUNTS)) {
    assert.equal(byName.get(name), expected,
      `${name} counted ${byName.get(name)} papers but its fetcher returned ${expected} (labels shifted?)`);
  }
});

// ═══════════════════════════════════════════════════════════════
group("Job 2 — PubMed: two calls, and it completes inside the allowance");

const VITD_XML = `<?xml version="1.0"?><PubmedArticleSet>
<PubmedArticle><MedlineCitation><PMID Version="1">7001</PMID><Article>
  <ArticleTitle>Vitamin D supplementation to prevent acute respiratory infections: a meta-analysis of randomised trials</ArticleTitle>
  <Abstract><AbstractText>Vitamin D supplementation reduced the risk of acute respiratory tract infection among all participants, with the strongest protective effects in those with baseline 25-hydroxyvitamin D deficiency. Daily or weekly cholecalciferol without large bolus doses was most effective against respiratory infections including the common cold.</AbstractText></Abstract>
  <AuthorList><Author><LastName>Jolliffe</LastName><Initials>DA</Initials></Author><Author><LastName>Martineau</LastName><Initials>AR</Initials></Author></AuthorList>
  <Journal><Title>The Lancet Diabetes and Endocrinology</Title><JournalIssue><PubDate><Year>2021</Year></PubDate></JournalIssue></Journal>
</Article><PubmedData><ArticleIdList><ArticleId IdType="doi">10.1000/r3-vitd-1</ArticleId></ArticleIdList></PubmedData></MedlineCitation></PubmedArticle>
<PubmedArticle><MedlineCitation><PMID Version="1">7002</PMID><Article>
  <ArticleTitle>Vitamin D and the common cold: a randomised controlled trial of cholecalciferol</ArticleTitle>
  <Abstract><AbstractText>This randomised trial tested whether vitamin D3 supplementation prevents the common cold. Adults receiving cholecalciferol over one winter had fewer colds and shorter illness duration than the placebo group, though the effect was modest and concentrated in participants deficient in vitamin D at baseline.</AbstractText></Abstract>
  <AuthorList><Author><LastName>Murdoch</LastName><Initials>DR</Initials></Author></AuthorList>
  <Journal><Title>JAMA</Title><JournalIssue><PubDate><Year>2020</Year></PubDate></JournalIssue></Journal>
</Article><PubmedData><ArticleIdList><ArticleId IdType="doi">10.1000/r3-vitd-2</ArticleId></ArticleIdList></PubmedData></MedlineCitation></PubmedArticle>
</PubmedArticleSet>`;

await test("the PubMed fetcher makes exactly esearch + efetch, never esummary, with full record fields", async () => {
  scenPapers = [];
  scenAnswer = "Vitamin D may modestly cut the risk of catching a cold, especially if you are low to start with. [1][2]\n\n**What the evidence says:**\n\n- **Fewer infections:** vitamin D supplementation reduced acute respiratory infections in the pooled trials, with the strongest effect in deficient participants [1][2].\n- **Daily dosing:** cholecalciferol taken daily or weekly, without large bolus doses, carried the benefit [1][2].\n- **Who benefits most:** the trial of vitamin D and the common cold found fewer colds and shorter illness in adults taking cholecalciferol through one winter, with the clearest gains in people whose vitamin D levels started low [1][2].\n- **The honest limit:** the effect is modest, not a shield; vitamin D did not prevent every cold, and the benefit concentrates in deficiency rather than appearing in everyone who supplements [1][2].";
  const eutils = (u) => {
    if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: ["7001", "7002"] } });
    if (u.includes("efetch")) return new Response(VITD_XML, { status: 200, headers: { "Content-Type": "text/xml" } });
    return jsonRes({});
  };
  const { data, fetchLog } = await runScenario("does vitamin D help you fight off colds", { eutils });
  const eutilsCalls = fetchLog.map((f) => f.url).filter((u) => u.includes("eutils.ncbi.nlm.nih.gov"));
  assert.ok(eutilsCalls.some((u) => u.includes("esearch")), "esearch never fired");
  assert.ok(eutilsCalls.some((u) => u.includes("efetch")), "efetch never fired");
  assert.ok(!eutilsCalls.some((u) => u.includes("esummary")),
    "esummary was called — the dropped third call is back: " + eutilsCalls.join(" | "));
  const byName = new Map((data.sourcesQueried || []).map((d) => [d.source, d.count]));
  assert.equal(byName.get("pubmed"), 2, "PubMed's two efetch papers were not counted under pubmed");
  const vitd = (data.sources || []).filter((s) => /Vitamin D/i.test(s.title || ""));
  assert.ok(vitd.length >= 1, "no vitamin D paper from efetch reached the shipped sources");
  const meta = vitd.find((s) => /meta-analysis/.test(s.title));
  assert.ok(meta, "the efetch meta-analysis is missing from the shipped sources");
  // Field parity with the esummary era: the efetch XML alone
  // carries title, journal, year, and authors.
  assert.equal(String(meta.year), "2021", "efetch year did not survive: " + JSON.stringify(meta).slice(0, 200));
  assert.ok(/Lancet/i.test(meta.journal || ""), "efetch journal did not survive: " + meta.journal);
  assert.ok(/Jolliffe/.test(meta.authors || ""), "efetch authors did not survive: " + meta.authors);
});

await test("on a capped ledger the clinical trio completes before the long tail, and the refusals land on the tail", async () => {
  scenPapers = [
    epmc(41, "Vitamin D supplementation to prevent acute respiratory infections: a meta-analysis of randomised trials",
      "Vitamin D supplementation reduced the risk of acute respiratory tract infection among all participants, with the strongest protective effects in those with baseline 25-hydroxyvitamin D deficiency. Daily or weekly cholecalciferol without large bolus doses was most effective against respiratory infections including the common cold.", 210),
    epmc(42, "Vitamin D and the common cold: a randomised controlled trial of cholecalciferol",
      "This randomised trial tested whether vitamin D3 supplementation prevents the common cold. Adults receiving cholecalciferol over one winter had fewer colds and shorter illness duration than the placebo group, though the effect was modest and concentrated in participants deficient in vitamin D at baseline.", 96),
  ];
  scenAnswer = "Vitamin D may modestly cut the risk of catching a cold, especially if you are low to start with. [1][2]\n\n**What the evidence says:**\n\n- **Fewer infections:** vitamin D supplementation reduced acute respiratory infections in the pooled trials, with the strongest effect in deficient participants [1][2].\n- **Daily dosing:** cholecalciferol taken daily or weekly, without large bolus doses, carried the benefit [1][2].\n- **Who benefits most:** the trial of vitamin D and the common cold found fewer colds and shorter illness in adults taking cholecalciferol through one winter, with the clearest gains in people whose vitamin D levels started low [1][2].\n- **The honest limit:** the effect is modest, not a shield; vitamin D did not prevent every cold, and the benefit concentrates in deficiency rather than appearing in everyone who supplements [1][2].";
  const eutils = (u) => {
    if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: ["7001", "7002"] } });
    if (u.includes("efetch")) return new Response(VITD_XML, { status: 200, headers: { "Content-Type": "text/xml" } });
    return jsonRes({});
  };
  // The platform's real cap (50): retrieval allowance 23, and
  // the handler's fixed overhead leaves roughly 13 of it when
  // rung 1 starts — less than the 15 pair fanout costs, the
  // exact exposure that starved PubMed's late calls before.
  const { data, fetchLog } = await runScenario("does vitamin D help you fight off colds",
    { eutils, settings: { answerLength: "long" } });
  const urls = fetchLog.map((f) => f.url);
  const efetchIdx = urls.findIndex((u) => u.includes("efetch"));
  const firstTailIdx = urls.findIndex((u) =>
    u.includes("api.crossref.org") || u.includes("export.arxiv.org") ||
    u.includes("api.plos.org") || u.includes("api.core.ac.uk") ||
    u.includes("api.openaire.eu") || u.includes("doaj.org") ||
    u.includes("api.base-search.net"));
  assert.ok(efetchIdx >= 0, "PubMed's efetch never fired on the capped run");
  assert.ok(firstTailIdx === -1 || efetchIdx < firstTailIdx,
    "a long tail fetcher fired before PubMed completed (efetch at " + efetchIdx + ", first tail at " + firstTailIdx + ")");
  const byName = new Map((data.sourcesQueried || []).map((d) => [d.source, d.count]));
  assert.equal(byName.get("pubmed"), 2, "PubMed did not complete inside the allowance");
  assert.ok((byName.get("europePMC") || 0) >= 2, "Europe PMC did not complete inside the allowance");
  assert.ok(data._ledger && typeof data._ledger.retrievalRefused === "number",
    "the response carries no ledger refusals to judge the trim by");
  // The trim is real on this shape (the rung cannot be funded
  // whole), and it lands on the tail: PubMed is complete above
  // while the ledger still records refused retrieval grants.
  assert.ok(data._ledger.retrievalRefused >= 1,
    "expected the capped rung to record refusals on the tail, got " + data._ledger.retrievalRefused);
});

// ═══════════════════════════════════════════════════════════════
group("Job 3 — validation answers on a separate quota family");

const quotaError = () => Object.assign(
  new Error("AiError: Too Many Requests — the account neuron quota is exhausted"),
  { name: "AiError" }
);
const verdictJson = (entries) => JSON.stringify(entries);

await test("defaultValidationCall returns a verdict through Gemini when the Workers AI quota is dead", async () => {
  const realFetch = globalThis.fetch;
  const urls = [];
  let aiCalls = 0;
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: verdictJson([{ id: 1, verdict: "RELEVANT" }]) } }] }) };
    }
    throw new Error("unexpected fetch " + url);
  };
  try {
    const env = {
      GEMINI_KEY: "r3-gemini-key",
      AI: { run: async () => { aiCalls++; throw quotaError(); } },
    };
    // No OpenRouter token and no Groq key: the only legs that
    // exist are Gemini and the exhausted Workers AI binding.
    const out = await defaultValidationCall([{ role: "user", content: "validate" }], "", env);
    assert.ok(out, "validation returned nothing with the Workers AI quota dead");
    assert.equal(out.via, "gemini");
    assert.ok(out.text.includes("RELEVANT"), "the Gemini verdict text did not come back");
    assert.ok(urls.some((u) => u.includes("generativelanguage.googleapis.com/v1beta/openai/chat/completions")),
      "the Gemini leg did not use the fleet's OpenAI compatible endpoint");
    assert.equal(aiCalls, 0, "the dead Workers AI leg was tried before the independent quota");
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("the Gemini leg uses gemini-3.5-flash-lite, and a dead Gemini plus a dead Workers AI still fails open", async () => {
  const realFetch = globalThis.fetch;
  let geminiBody = null;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      geminiBody = JSON.parse(init.body);
      return { ok: false, status: 500, json: async () => ({}) };
    }
    throw new Error("unexpected fetch " + url);
  };
  try {
    const env = {
      GEMINI_KEY: "r3-gemini-key",
      AI: { run: async () => { throw quotaError(); } },
    };
    const out = await defaultValidationCall([{ role: "user", content: "validate" }], "", env);
    assert.equal(out, null, "with every leg down the stage must fail open to null, not invent a verdict");
    assert.ok(geminiBody, "the Gemini leg never fired");
    assert.equal(geminiBody.model, "gemini-3.5-flash-lite");
    assert.equal(geminiBody.max_tokens, 400);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("llmValidatePapers validates through Gemini end to end in a Gemini only environment", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: verdictJson([{ id: 1, verdict: "RELEVANT" }, { id: 2, verdict: "IRRELEVANT" }]) } }] }) };
    }
    throw new Error("unexpected fetch " + url);
  };
  try {
    const papers = [
      { title: "Cryotherapy for acute ankle sprain: a randomised trial", abstract: "Ice applied after an acute ankle sprain reduced pain and swelling and shortened rehabilitation in this randomised trial of cryotherapy for lateral ankle sprain.", journal: "J Test", year: 2024, url: "https://example.com/r3-a" },
      { title: "Ankle sprain rehabilitation with early mobilisation", abstract: "Early mobilisation after ankle sprain improved ankle function and return to activity compared with immobilisation, in a cohort of patients with acute lateral ankle sprain.", journal: "J Test", year: 2023, url: "https://example.com/r3-b" },
    ];
    const diag = { llmValidatedVia: null };
    const env = {
      GEMINI_KEY: "r3-gemini-key",
      AI: { run: async () => { throw quotaError(); } },
    };
    const out = await llmValidatePapers("should I put ice on a sprained ankle", papers, "", null, env, diag);
    assert.equal(diag.llmValidatedVia, "gemini", "the validation was not attributed to the Gemini leg");
    assert.deepEqual(out.map((p) => p.url), ["https://example.com/r3-a"],
      "the Gemini verdicts did not filter the papers");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ═══════════════════════════════════════════════════════════════
group("Job 4 — swimmer's ear and the nutrient class resolve");

const Q_VITD = "does vitamin D help you fight off colds";
const SWIM_POOL = [
  { title: "Otitis externa: a practical guide to treatment and prevention",
    abstract: "Otitis externa, often called swimmer's ear, is an inflammation of the external ear canal commonly caused by water exposure and bacterial infection of the canal skin. Topical antimicrobial therapy is the mainstay of treatment for otitis externa, and prevention includes keeping the ear canal dry, avoiding cotton swabs, and using acidifying ear drops after swimming in patients with recurrent episodes of otitis externa.",
    journal: "American Family Physician", year: "2021", authors: "Schaefer P et al.", doi: "10.1000/r3-swim-1", url: "https://doi.org/10.1000/r3-swim-1", relevance: 86 },
  { title: "Topical antimicrobial therapy for acute otitis externa: a systematic review",
    abstract: "Acute otitis externa is a cellulitis of the ear canal skin and subdermis, frequently associated with swimming and moisture retention in the ear canal. This systematic review compared topical antibiotics, antiseptics, and corticosteroid preparations for uncomplicated acute otitis externa in adults and children, finding topical therapy for otitis externa effective with low systemic absorption and few adverse events.",
    journal: "Clinical Otolaryngology", year: "2022", authors: "Kaushik V et al.", doi: "10.1000/r3-swim-2", url: "https://doi.org/10.1000/r3-swim-2", relevance: 82 },
  { title: "Hearing loss in older adults: a cohort study",
    abstract: "Presbycusis affects a third of adults over 65. This cohort followed hearing thresholds over a decade and modelled risk factors for hearing loss including noise exposure and ototoxic medication, finding steady decline in high frequency hearing with age.",
    journal: "JAMA Otolaryngology", year: "2020", authors: "Lin F et al.", doi: "10.1000/r3-swim-3", url: "https://doi.org/10.1000/r3-swim-3", relevance: 38 },
];
const VITD_POOL = [
  { title: "Vitamin D supplementation to prevent acute respiratory infections: a meta-analysis of randomised trials",
    abstract: "Vitamin D supplementation reduced the risk of acute respiratory tract infection among all participants, with the strongest protective effects in those with baseline 25-hydroxyvitamin D deficiency. Daily or weekly cholecalciferol supplementation without large bolus doses was most effective against respiratory infections including the common cold, across 43 trials of vitamin D and respiratory outcomes.",
    journal: "The Lancet Diabetes and Endocrinology", year: "2021", authors: "Jolliffe DA et al.", doi: "10.1000/r3-vitd-1", url: "https://doi.org/10.1000/r3-vitd-1", relevance: 88 },
  { title: "Vitamin D and the common cold: a randomised controlled trial of cholecalciferol",
    abstract: "This randomised trial tested whether vitamin D3 supplementation prevents the common cold. Adults receiving cholecalciferol over one winter had fewer colds and shorter illness duration than the placebo group, though the effect of vitamin D on colds was modest and concentrated in participants deficient in vitamin D at baseline, measured as serum 25-hydroxyvitamin D.",
    journal: "JAMA", year: "2020", authors: "Murdoch DR et al.", doi: "10.1000/r3-vitd-2", url: "https://doi.org/10.1000/r3-vitd-2", relevance: 84 },
  { title: "Cholecalciferol and bone mineral density in postmenopausal women",
    abstract: "Cholecalciferol supplementation increased bone mineral density modestly over two years in postmenopausal women with vitamin D insufficiency, measured by dual energy X ray absorptiometry at the hip and spine. Fracture outcomes were secondary and infrequent, and calcium co supplementation was common across arms of the cholecalciferol bone trial.",
    journal: "Osteoporosis International", year: "2019", authors: "Bischoff-Ferrari HA et al.", doi: "10.1000/r3-vitd-3", url: "https://doi.org/10.1000/r3-vitd-3", relevance: 62 },
];

await test("the swimmer's ear question resolves the ear concept bridged to otitis externa", () => {
  const concepts = questionCentralConcepts(Q_SWIM, dynFor(Q_SWIM));
  const ear = concepts.find((c) => c.group && [...c.group].includes("otitis externa"));
  assert.ok(ear, "no concept carries the otitis externa bridge: " +
    concepts.map((c) => c.term + "=[" + (c.group ? [...c.group].join(",") : "") + "]").join(" "));
});

await test("the swimmer's ear pool cites its clinical papers under the standard", () => {
  const std = citationGateStandard(Q_SWIM, dynFor(Q_SWIM));
  assert.equal(paperClearsCitationGate(SWIM_POOL[0], std), true, "the otitis externa guide does not clear the gate");
  assert.equal(paperClearsCitationGate(SWIM_POOL[1], std), true, "the otitis externa review does not clear the gate");
  assert.equal(paperClearsCitationGate(SWIM_POOL[2], std), false, "the hearing loss paper clears a gate it should fail");
  assert.equal(paperIsCitable(SWIM_POOL[0], 1, std), true, "the otitis externa guide is not citable");
  assert.equal(paperIsCitable(SWIM_POOL[1], 2, std), true, "the otitis externa review is not citable");
  assert.equal(paperIsCitable(SWIM_POOL[2], 3, std), false, "the hearing loss paper is citable on an ear infection question");
});

await test("bare nutrient names resolve as central concepts across the class", () => {
  const vitd = questionCentralConcepts(Q_VITD, dynFor(Q_VITD));
  const d = vitd.find((c) => c.term === "vitamin d");
  assert.ok(d, "vitamin D never resolved as a concept: " + vitd.map((c) => c.term).join(", "));
  assert.equal(d.subject, true, "vitamin D is the question's subject and is not marked as such");
  assert.ok(d.group && [...d.group].includes("cholecalciferol"), "the vitamin D concept carries no bridge to cholecalciferol");
  const mg = questionCentralConcepts("does magnesium help you sleep", dynFor("does magnesium help you sleep"));
  assert.ok(mg.some((c) => c.term === "magnesium"), "magnesium never resolved: " + mg.map((c) => c.term).join(", "));
  const om = questionCentralConcepts("do omega 3 supplements lower triglycerides", dynFor("do omega 3 supplements lower triglycerides"));
  const o3 = om.find((c) => c.term === "omega 3");
  assert.ok(o3, "omega 3 never resolved as a unit: " + om.map((c) => c.term).join(", "));
  assert.ok(o3.group && [...o3.group].includes("fish oil"), "the omega 3 concept carries no fish oil bridge");
  const b12 = questionCentralConcepts("can vitamin B12 help with tiredness", dynFor("can vitamin B12 help with tiredness"));
  assert.ok(b12.some((c) => c.term === "vitamin b12"), "vitamin B12 never resolved: " + b12.map((c) => c.term).join(", "));
});

await test("the vitamin D pool cites its cold trials and not the bone paper", () => {
  const std = citationGateStandard(Q_VITD, dynFor(Q_VITD));
  assert.equal(paperClearsCitationGate(VITD_POOL[0], std), true, "the respiratory meta-analysis does not clear the gate");
  assert.equal(paperClearsCitationGate(VITD_POOL[1], std), true, "the common cold trial does not clear the gate");
  assert.equal(paperClearsCitationGate(VITD_POOL[2], std), false,
    "the bone density paper clears the gate on a colds question — the nutrient alone is being counted twice");
  assert.equal(paperIsCitable(VITD_POOL[0], 1, std), true, "the respiratory meta-analysis is not citable");
  assert.equal(paperIsCitable(VITD_POOL[1], 2, std), true, "the common cold trial is not citable");
  assert.equal(paperIsCitable(VITD_POOL[2], 3, std), false, "the bone density paper is citable on a colds question");
});

await test("the swimmer's ear handler run cites the otitis papers as an AI answer", async () => {
  scenPapers = [
    epmc(61, SWIM_POOL[0].title, SWIM_POOL[0].abstract, 130),
    epmc(62, SWIM_POOL[1].title, SWIM_POOL[1].abstract, 88),
    epmc(63, SWIM_POOL[2].title, SWIM_POOL[2].abstract, 210),
  ];
  scenAnswer = "Swimmer's ear is an infection of the outer ear canal, and it keeps coming back when water stays trapped there. [1][2]\n\n**What helps:**\n\n- **Dry the canal:** keeping the ear canal dry and avoiding cotton swabs prevents recurrent otitis externa episodes [1][2].\n- **Treat the infection:** topical antimicrobial drops are the mainstay treatment for otitis externa, with low systemic absorption [1][2].";
  const { data } = await runScenario(Q_SWIM);
  assert.equal(data.synthesisMode, "ai",
    "the swimmer's ear run did not ship an AI answer (mode " + data.synthesisMode + "): " + String(data.answer || "").slice(0, 200));
  const titles = (data.sources || []).map((s) => s.title);
  assert.equal(titles.length, 2, "the cited set should be exactly the two otitis papers: " + titles.join(" | "));
  assert.ok(titles.some((t) => /Otitis externa: a practical guide/.test(t)), "the otitis guide is not in the cited set: " + titles.join(" | "));
  assert.ok(titles.some((t) => /Topical antimicrobial therapy for acute otitis externa/.test(t)), "the otitis review is not in the cited set: " + titles.join(" | "));
});

// ═══════════════════════════════════════════════════════════════
group("Job 5 — the synthesis stage closes on a passing draft");

const Q_JOB5 = Q_SWIM;
const JOB5_POOL = [
  epmc(71, SWIM_POOL[0].title, SWIM_POOL[0].abstract, 130),
  epmc(72, SWIM_POOL[1].title, SWIM_POOL[1].abstract, 260),
  epmc(73, SWIM_POOL[2].title, SWIM_POOL[2].abstract, 40),
];
// A draft that passes the citation binding (real citations to
// the citable papers, on topic sentences) but scores under the
// quality bar on undefined abbreviations alone — a defect the
// post processor does not repair, so the score the retry gate
// sees is the score this text earns.
const PASSING_LOW_DRAFT = "Otitis externa keeps coming back when water stays trapped in the ear canal after swimming [1][2]. The ENT literature found topical ABX drops beat PO therapy for AOE, and RCT data plus OTC drying drops after swimming remain standard prevention; an MRI is rarely needed before FU review [1][2]. Topical antimicrobial therapy is the mainstay of treatment for otitis externa, and keeping the canal dry prevents recurrent episodes [1][2].";
// A draft that fails the binding: it cites a real evidence
// paper from sentences about a different field entirely, so
// the support strip removes every marker (the cited paper's
// vocabulary shares nothing with the claims) and no citation
// survives either of the ship gate's passes.
const FAILING_LOW_DRAFT = "Black holes bend light near the event horizon, and the ENT of a galaxy can outshine its host star cluster [1]. Neutron stars pack more mass than the Sun into a city sized sphere, spinning with MRI visible pulses and FU period changes timed by RCT grade clocks [1]. Cosmic rays are mostly protons accelerated in supernova remnants, and ABX style shielding plus OTC detector parts and PO supply chains keep deep space probes running for decades [1].";

const retryCalls = (fetchLog) => ({
  quality: fetchLog.filter((f) => f.body.includes("Previous attempt scored")).length,
  citation: fetchLog.filter((f) => f.body.includes("carried no citations at all")).length,
});

await test("a passing first wave draft ends the stage without firing the quality retry", async () => {
  scenPapers = JOB5_POOL;
  scenAnswer = PASSING_LOW_DRAFT;
  const { data, fetchLog } = await runScenario(Q_JOB5);
  assert.equal(data.synthesisMode, "ai", "the passing draft did not ship as an AI answer: " + String(data.answer || "").slice(0, 160));
  const calls = retryCalls(fetchLog);
  assert.equal(calls.quality, 0, "the quality retry fired on a draft that passes the citation binding");
  assert.equal(calls.citation, 0, "the citation retry fired on a cited draft");
});

await test("a failing draft still gets the quality retry", async () => {
  scenPapers = JOB5_POOL;
  scenAnswer = FAILING_LOW_DRAFT;
  const { data, fetchLog } = await runScenario(Q_JOB5);
  const calls = retryCalls(fetchLog);
  assert.ok(calls.quality >= 1,
    "the quality retry did not fire for a draft that fails the citation binding (mode " + data.synthesisMode + ")");
});

console.log(`\nsearch-wave-eight-r3: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
