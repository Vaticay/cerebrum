/**
 * Search wave seven (2026-10-14, sixth panel): per paper
 * citation binding in every mode, retrieval that actually runs
 * and reaches the clinical literature, and auditability.
 *
 * The sixth panel's central finding, converged on by three
 * auditors: the citation gate checked the SERVE, not the
 * CITATIONS. Across 7 probes, 202 gathered, 15 cited, 0 of the
 * 15 directly answered the question, and cited papers carried
 * relevance scores of 10, 24, 26, and 45 against a floor of 50.
 * The fixtures below pin the corrected contract on the panel's
 * own specimen shapes:
 *
 *   Job 1a: every shipped citation clears the gate standard AND
 *     the relevance floor individually; the cascade never
 *     promotes into the cited set; the gerund creatine phrasing
 *     identifies the creatine subject group and the hair
 *     sociology paper never cites under it.
 *   Job 1c: the sock collision shape ships the no evidence
 *     state (the scorer's title phrase carry rule).
 *   Job 2a: a stubbed PubMed receives natural language terms
 *     only (no stemmed fragments, no boolean text) on a clinical
 *     question, and its returned trial enters the shipped set.
 *   Job 2b: a first rung that gathers 30 junk papers and zero
 *     clearing papers does not end retrieval: the ladder
 *     continues on the citable count and finds the clearing
 *     trial on the looser rung.
 *   Job 2c: the black soldier fly feed shape anchors its
 *     organism group on the fly, never on Gallus gallus.
 *   Job 2d: the panel's specimen tokens produce no non word
 *     fallback alternates; reformulations carry no stems.
 *   Job 3: _funnel.excludedWeakTitles names the first few
 *     excluded papers so the floor's drops can be audited from
 *     the response.
 *
 * Questions are worded the way a person asks; papers the way
 * papers are written (the standing mismatched language rule).
 * Handler scenarios run the real onRequest against a counting
 * stub env modeled on tests/relevance-gate.mjs.
 *
 * Run with: node tests/search-wave-seven.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const search = await import(join(root, "functions/api/search.js"));
const { onRequest, createSubrequestLedger } = search;
const {
  citationGateStandard, buildStructuredQuery, buildDeterministicFallbackGroups,
  deriveReformulations, cleanSurfaceQuery, centralContentTerms, buildDynLookup,
} = search;

// The standard the handler actually judges with: the deterministic
// fallback lookup for the question's uncovered central terms (the
// model expansion leg is weather in these fixtures, exactly as
// the relevance gate suite models it).
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

let scenPapers = [];
let scenAnswer = "";
let scenPapersFn = null;
let scenQueryLog = [];
let scenPubmedTerms = null; // non null: the eutils stub answers with the trial

const PUBMED_TRIAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PubmedArticleSet><PubmedArticle>
<MedlineCitation><PMID Version="1">777001</PMID>
<Article><ArticleTitle>Probiotic yogurt and antibiotic associated diarrhoea: a randomized controlled trial</ArticleTitle>
<Abstract>
<AbstractText>Adults taking antibiotics were randomized to probiotic yogurt or a plain drink for the whole antibiotic course. Antibiotic associated diarrhoea and stomach upset were recorded daily. The yogurt group reported less diarrhoea and less stomach discomfort, fewer missed antibiotic doses, and Lactobacillus cultures from the yogurt were recovered from stool samples, showing the cultures survived transit through the stomach.</AbstractText>
</Abstract>
<Journal><Title>Journal of Clinical Nutrition</Title><JournalIssue><PubDate><Year>2024</Year></PubDate></JournalIssue></Journal>
<AuthorList><Author><LastName>Doe</LastName><Initials>J</Initials></Author><Author><LastName>Roe</LastName><Initials>K</Initials></Author></AuthorList>
</Article></MedlineCitation>
<PubmedData><ArticleIdList><ArticleId IdType="doi">10.1000/w7pubmed</ArticleId></ArticleIdList></PubmedData>
</PubmedArticle></PubmedArticleSet>`;

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
      let qParam = "";
      try { qParam = new URL(u).searchParams.get("query") || ""; } catch { qParam = ""; }
      scenQueryLog.push(qParam);
      if (scenPapersFn) return jsonRes({ resultList: { result: scenPapersFn(qParam) } });
      return jsonRes({ resultList: { result: scenPapers } });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (scenPubmedTerms) {
        if (u.includes("esearch")) {
          let term = "";
          try { term = new URL(u).searchParams.get("term") || ""; } catch { term = ""; }
          scenPubmedTerms.push(term);
          // The clinical topic in any of its surface forms: the
          // fanout's organism logic prepends the yogurt group's
          // "Fermented milk" alternate to this question's PubMed
          // query (a pre-existing quirk, noted in the wave seven
          // report), so the stub answers on the topic's words,
          // not on one exact phrasing.
          if (/yogurt|fermented|probiotic|antibiotic/i.test(term)) {
            return jsonRes({ esearchresult: { idlist: ["777001"] } });
          }
          return jsonRes({ esearchresult: { idlist: [] } });
        }
        if (u.includes("efetch")) return new Response(PUBMED_TRIAL_XML, { status: 200, headers: { "Content-Type": "text/xml" } });
        if (u.includes("esummary")) {
          return jsonRes({ result: { "777001": {
            title: "Probiotic yogurt and antibiotic associated diarrhoea: a randomized controlled trial",
            pubdate: "2024", fulljournalname: "Journal of Clinical Nutrition",
            authors: [{ name: "Doe J" }, { name: "Roe K" }],
          } } });
        }
      }
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
      OPENROUTER_KEY: "w7-test-openrouter-key-123456",
    };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return { data, queries: scenQueryLog.slice() };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
    scenQueryLog = [];
  }
}

const epmc = (n, title, abstractText, citedByCount) => ({
  title,
  doi: "10.1000/w7" + n,
  pubYear: "2024",
  citedByCount,
  authorString: "Doe J, Roe K",
  journalTitle: "Journal of Recorded Studies",
  abstractText,
});

const HAIR_TRIAL = () => epmc(13, "Creatine monohydrate supplementation and hair shedding: a randomized controlled trial",
  "Adults taking creatine monohydrate at five grams daily were followed for twelve weeks against placebo. Hair shedding counts and scalp hair density did not increase on creatine, and dihydrotestosterone remained within the normal range in both groups throughout the trial.", 300);
const HAIR_SOCIOLOGY = () => epmc(11, "Hair in the schoolyard: hair policies and belonging in English schools",
  "This sociology paper examines how school hair rules shape pupils' sense of identity and belonging. Hair is treated as culture and self expression throughout, and hair length rules are traced through school policy documents and pupil interviews about hair.", 900);

// ═══════════════════════════════════════════════════════════════════
group("subject identification — gerund openings (Job 1b)");

await test("the gerund creatine phrasing identifies the creatine subject group", () => {
  const q = "does taking creatine powder make hair come out in men";
  const std = citationGateStandard(q, dynFor(q));
  assert.ok(std.subjectGroup, "no subject group identified for the gerund phrasing");
  assert.ok(std.subjectGroup.has("creatine"),
    "the gerund subject is not the creatine group: " + JSON.stringify([...std.subjectGroup]));
});

await test("the plain phrasing's subject is unchanged, and the sleep clause still identifies none", () => {
  const plainQ = "does creatine make your hair fall out";
  const plain = citationGateStandard(plainQ, dynFor(plainQ));
  assert.ok(plain.subjectGroup && plain.subjectGroup.has("creatine"),
    "the plain phrasing lost its creatine subject");
  const sleepQ = "does not getting enough sleep make it easier to catch a cold";
  const sleep = citationGateStandard(sleepQ, dynFor(sleepQ));
  assert.equal(sleep.subjectGroup, null,
    "the sleep clause question must still identify no subject group");
});

await test("handler level: under the gerund phrasing the hair sociology paper never cites", async () => {
  scenPapersFn = null;
  scenPubmedTerms = null;
  scenPapers = [HAIR_SOCIOLOGY(), HAIR_TRIAL()];
  scenAnswer =
    "**Creatine** did not increase hair shedding or scalp hair density loss in the randomized trial that measured both [1]. " +
    "School hair policies shape how pupils feel they belong, a separate literature about hair as culture [2].";
  const { data } = await runScenario("does taking creatine powder make hair come out in men");
  assert.equal(data.synthesisMode, "ai", "the scenario must ship the AI answer, got: " + data.synthesisMode);
  const citedTitles = (data.sources || []).filter((s) => !s.uncited).map((s) => s.title);
  assert.deepEqual(citedTitles, [
    "Creatine monohydrate supplementation and hair shedding: a randomized controlled trial",
  ], "under the gerund phrasing only the creatine trial may cite: " + JSON.stringify(citedTitles));
  for (const s of data.sources || []) {
    if (s.title.startsWith("Hair in the schoolyard")) {
      assert.equal(s.uncited, true, "the hair sociology paper shipped as cited under the gerund phrasing");
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
group("the sock collision ships the no evidence state (Jobs 1c and 3)");

await test("a joke title collision plus junk ships no results, and the funnel names the excluded", async () => {
  scenPapersFn = null;
  scenPubmedTerms = null;
  const junk = [];
  for (let i = 1; i <= 28; i++) {
    junk.push(epmc(100 + i, "Galaxy survey catalogue entry " + i,
      "We present a catalogue of galaxies observed with a wide field telescope. Star formation rates, stellar masses, and morphologies are tabulated for each galaxy, and the survey volume is complete to a stated magnitude limit.", 50));
  }
  scenPapers = [
    epmc(41, "Captain Oates' left sock: the other famous Antarctic departure",
      "On the return from the South Pole in 1912, Captain Lawrence Oates, suffering from frostbite, walked from the tent into a blizzard and was never seen again. This account reconstructs the final days of the Terra Nova expedition, the state of the party's boots and socks, and the words recorded in Scott's diary.", 900),
    ...junk,
  ];
  scenAnswer = "Your left sock disappears because of static and the dryer drum gap [1].";
  const { data } = await runScenario("why does my left sock keep disappearing in the dryer");
  assert.equal(data.responseKind, "no-results",
    "the sock shape shipped an answer instead of the no evidence state: " + data.responseKind);
  assert.ok(!(data.sources || []).some((s) => !s.uncited),
    "a paper shipped as cited on the sock shape: " + JSON.stringify(data.sources));
  // Job 3: the excluded sample rides the funnel, titles only.
  const titles = data._funnel && data._funnel.excludedWeakTitles;
  assert.ok(Array.isArray(titles), "excludedWeakTitles missing from the funnel: " + JSON.stringify(data._funnel));
  assert.ok(titles.length >= 1 && titles.length <= 5,
    "the excluded sample must carry between one and five titles: " + JSON.stringify(titles));
  const poolTitles = new Set(scenPapers.map((p) => p.title));
  for (const t of titles) {
    assert.equal(typeof t, "string", "an excluded sample entry is not a title string");
    assert.ok(poolTitles.has(t), "an excluded sample title did not come from the pool: " + t);
  }
  assert.ok(data._funnel.excludedWeak >= titles.length,
    "the excluded count must cover its own title sample");
});

// ═══════════════════════════════════════════════════════════════════
group("PubMed receives natural language and its trial enters the pool (Job 2a)");

await test("stubbed PubMed: no stemmed fragments, no boolean text, the trial ships cited", async () => {
  scenPapersFn = null;
  scenPapers = [];
  scenPubmedTerms = [];
  scenAnswer =
    "Eating probiotic yogurt during an antibiotic course reduced diarrhoea and stomach upset in the randomized trial [1].";
  // A larger ledger limit, as in the budget suite's scenarios:
  // the stubbed engines answer and retry more than the
  // production draw, and at the default limit the retrieval
  // grants are trimmed before the fanout's PubMed leg is priced.
  // The fixture exercises the query shape and the pool entry;
  // budget behavior at the real limit is pinned by the budget
  // suite.
  const { data } = await runScenario("does eating yogurt help an upset stomach while taking antibiotics", { limit: 300 });
  const terms = scenPubmedTerms;
  scenPubmedTerms = null;
  assert.ok(terms.length >= 1, "PubMed was never asked");
  const stemTokens = new Set(["rais", "flie", "chang", "eatin", "takin", "studi", "antibiot", "probio"]);
  for (const term of terms) {
    assert.ok(!/\b(AND|OR)\b/.test(term), "PubMed received boolean text: " + term);
    const tokens = term.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (const tok of tokens) {
      assert.ok(!stemTokens.has(tok), `PubMed received the stemmed fragment "${tok}": ` + term);
    }
  }
  const trial = (data.sources || []).find((s) => s.title && s.title.includes("Probiotic yogurt and antibiotic associated diarrhoea"));
  assert.ok(trial, "the PubMed trial never entered the shipped set: " + JSON.stringify((data.sources || []).map((s) => s.title)));
  assert.ok(!trial.uncited, "the PubMed trial shipped uncited: " + JSON.stringify(trial));
});

// ═══════════════════════════════════════════════════════════════════
group("the ladder continues on the citable count (Job 2b)");

await test("30 junk papers and zero clearing papers do not end retrieval; the looser rung finds the trial", async () => {
  scenPubmedTerms = null;
  const junk = [];
  for (let i = 1; i <= 30; i++) {
    junk.push(epmc(200 + i, "Galaxy survey catalogue entry " + i,
      "We present a catalogue of galaxies observed with a wide field telescope. Star formation rates, stellar masses, and morphologies are tabulated for each galaxy, and the survey volume is complete to a stated magnitude limit.", 50));
  }
  scenPapersFn = (q) => {
    // The first ladder rung's structured boolean (the full
    // anchor set) gathers junk only. The continuation's looser
    // rung asks the plain bag the fanout sends for a non boolean
    // rung, which Europe PMC wraps as "(creatine your hair) ...".
    if (q.startsWith("(creatine your hair)")) return [HAIR_TRIAL()];
    return junk;
  };
  scenAnswer =
    "**Creatine** did not increase hair shedding or scalp hair density loss in the randomized trial that measured both [1].";
  // A larger ledger limit, as in the budget suite's NL scenario:
  // the fixture exercises the continuation decision, and the
  // stub fanout costs more per rung than the production draw the
  // panel measured (retrieval spend 10 to 11 of 23) because every
  // stubbed engine answers and retries.
  const { data, queries } = await runScenario("does creatine make your hair fall out", { limit: 200 });
  scenPapersFn = null;
  assert.ok(queries.some((q) => q.startsWith("(creatine your hair)")),
    "the looser continuation rung never executed: " + JSON.stringify(queries.slice(0, 8)));
  const citedTitles = (data.sources || []).filter((s) => !s.uncited).map((s) => s.title);
  assert.ok(citedTitles.includes("Creatine monohydrate supplementation and hair shedding: a randomized controlled trial"),
    "the clearing trial from the continuation rung did not ship cited: " + JSON.stringify(citedTitles));
});

// ═══════════════════════════════════════════════════════════════════
group("anchors come from the question's own subject and organism (Job 2c)");

await test("the black soldier fly feed shape anchors on the fly, not the chicken", () => {
  const q = buildStructuredQuery("can black soldier fly larvae replace soybean meal in chicken feed");
  const orgPart = q.split(" AND ")[0];
  assert.ok(/hermetia illucens/i.test(orgPart),
    "the organism group does not anchor on the fly: " + q);
  assert.ok(!/gallus/i.test(q),
    "Gallus gallus leaked into the structured query: " + q);
  assert.ok(!/gallus/i.test(orgPart) && /chicken/.test(q.split(" AND ")[1] || ""),
    "the chicken belongs on the topic side only: " + q);
});

// ═══════════════════════════════════════════════════════════════════
group("fallback inflection and surface terms (Job 2d)");

await test("the panel's specimen tokens produce no non word alternates", () => {
  const nonWords = new Set(["sinces", "looses", "evers", "runnies", "sixes", "alives", "thaws"]);
  for (const token of ["since", "loose", "ever", "runny", "six", "alive", "thaw"]) {
    const groups = buildDeterministicFallbackGroups("does soil change in spring", [token]);
    const g = groups.find((x) => x.term === token);
    assert.ok(g, "no fallback group built for the specimen token: " + token);
    for (const alt of g.alternates || []) {
      assert.ok(!nonWords.has(alt), `specimen token ${token} produced the non word alternate "${alt}"`);
    }
    assert.equal((g.alternates || []).length, 0,
      `specimen token ${token} must carry no manufactured alternates under the corrected contract: ` +
      JSON.stringify(g.alternates));
  }
});

await test("reformulations and fetcher facing cleaning carry no stems", () => {
  const cleaned = cleanSurfaceQuery("why do flies keep raising their legs");
  const cleanedTokens = cleaned.split(/[^a-z0-9]+/).filter(Boolean);
  assert.ok(cleanedTokens.includes("flies") && cleanedTokens.includes("raising"),
    "the surface cleaning lost the question's own words: " + cleaned);
  assert.ok(!cleanedTokens.includes("flie") && !cleanedTokens.includes("rais"),
    "the surface cleaning carries stems: " + cleaned);
  const reformulations = deriveReformulations("why do flies keep raising their legs");
  assert.ok(Array.isArray(reformulations) && reformulations.length > 0, "no reformulations produced");
  let sawSurface = false;
  for (const r of reformulations) {
    const text = typeof r === "string" ? r : (r && r.query) || "";
    const tokens = String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    assert.ok(!tokens.includes("rais") && !tokens.includes("flie"),
      "a reformulation carries a stem token: " + text);
    if (tokens.includes("raising") || tokens.includes("flies")) sawSurface = true;
  }
  assert.ok(sawSurface, "no reformulation carries the question's surface words: " + JSON.stringify(reformulations));
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
