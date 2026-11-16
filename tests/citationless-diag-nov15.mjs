/**
 * Citationless win instrumentation (2026-11-16, citationless
 * trace lane).
 *
 * The Nov 15 live diagnosis found six probes (MNP1, SLT1, WLK3,
 * DRP3, FRS5, FRS8) where exactly one synthesis draft completed
 * and was then discarded for carrying no citations, and the
 * extractive fallback served instead. The payloads proved the
 * shape arithmetically (legs minus failedLegs minus parkedLegs
 * equals 1 in all six) but carried nothing that could separate
 * the three cases: the draft arrived uncited, the strips removed
 * every marker, or the repair gate closed / the repair failed.
 * The record had no draft text, no marker count before or after
 * the strips, no flag for either citation repair retry, and no
 * time left at the flip, so all three cases produce byte
 * equivalent records. See
 * ~/workspace/cerebrum-citationless-trace-nov15/payload-analysis-nov15.md.
 *
 * This suite pins the instrumentation the lane shipped in
 * functions/api/search.js: the synthesis stage entry now carries
 * citationDiag with four readings and no draft text, and
 * publicStageHealth passes it through to the shipped payload.
 * Handler level, with the provider fleet stubbed the way the
 * follow up trace lane stubbed it (the OpenRouter resolver leg
 * failing, the Groq family answering), the melatonin topic from
 * that suite reused so the cited control draft is known to bind:
 *
 *   A. Case 1 shape: the winning draft arrives with no citation
 *      markers. Site 1 fires and fails (the retry draft is
 *      uncited too), site 2 reads already-attempted, the flip
 *      records draftHadMarkers false, markersAfterStrips 0, and
 *      the time left at the flip.
 *   B. Case 2 shape: the winning draft arrives cited, but every
 *      cited sentence carries a number the cited paper does not
 *      contain, so the support strip removes every marker (the
 *      numbers facet in bindSentenceToPaper). Site 1 is not
 *      needed, site 2 fires and fails, the flip records
 *      draftHadMarkers true and markersAfterStrips 0.
 *   C. Control: a cited draft whose claims bind to the papers
 *      ships as an AI answer, and the entry records
 *      draftHadMarkers true, markersAfterStrips at least 2, both
 *      retry sites not needed, and the time left at the flip.
 *   D. All legs failed: the citation block never runs, so the
 *      entry carries no citationDiag at all, and publicStageHealth
 *      omits it from the shipped record.
 */
import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { onRequest, createSubrequestLedger, publicStageHealth } = await import(join(root, "functions/api/search.js"));

const failures = [];
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("ok   " + name); }
  catch (e) { failures.push({ name, error: e }); console.log("FAIL " + name + "\n     " + String(e && e.message || e)); }
}

const errors = [];
console.error = (...a) => { errors.push(a.map((x) => String((x && x.stack) || x)).join(" ")); };

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function chatRes(content) { return jsonRes({ choices: [{ message: { content } }] }); }

function makeCounts(cap = 200) { return { fetch: 0, d1: 0, ai: 0, attempts: 0, refused: 0, cap }; }
function attempt(counts, kind) {
  counts[kind]++; counts.attempts++;
  if (counts.attempts > counts.cap) { counts.refused++; throw new Error("Too many subrequests by single Worker invocation"); }
}
function countingDb(counts) {
  const st = () => {
    const s = {
      bind: () => s,
      first: async () => { attempt(counts, "d1"); return null; },
      all: async () => { attempt(counts, "d1"); return { results: [] }; },
      run: async () => { attempt(counts, "d1"); return { success: true, meta: { changes: 1 } }; },
    };
    return s;
  };
  return {
    prepare: () => st(),
    batch: async (arr) => { attempt(counts, "d1"); return (arr || []).map(() => ({ success: true, results: [] })); },
    exec: async () => { attempt(counts, "d1"); return { results: [] }; },
  };
}

const MELATONIN_ABSTRACT = "Melatonin supplementation reduced sleep onset latency in adults with insomnia. A dose of 0.5 mg to 5 mg melatonin taken before bed improved sleep quality scores and shortened the time to fall asleep across randomized trials.";
function papersFor(url) {
  const out = [];
  for (let n = 1; n <= 3; n++) {
    out.push({
      title: "Melatonin dosage and sleep onset in adults (study " + n + ")",
      doi: "10.1000/cdiagmel" + n,
      pubYear: "2024",
      citedByCount: 7,
      authorString: "Doe J, Roe K",
      journalTitle: "Journal of Citationless Studies",
      abstractText: MELATONIN_ABSTRACT,
    });
  }
  return out;
}

const CITED_BOUND_DRAFT = [
  "## The short answer",
  "",
  "Melatonin supplementation reduced sleep onset latency in adults with insomnia [1].",
  "",
  "## What the research shows",
  "",
  "A dose of 0.5 mg to 5 mg melatonin taken before bed improved sleep quality scores and shortened the time to fall asleep across randomized trials [2]. The evidence points to a real effect on sleep onset in adults with insomnia [1].",
].join("\n");

// Every cited sentence carries a number no cited paper contains
// (73 percent, 412 adults), so the numbers facet in
// bindSentenceToPaper contradicts every marker and the support
// strip removes them all.
const CITED_UNBOUND_DRAFT = [
  "## The short answer",
  "",
  "Melatonin reduced sleep onset latency by 73 percent in a trial of 412 adults with insomnia [1].",
  "",
  "## What the research shows",
  "",
  "A dose of 0.5 mg melatonin taken before bed improved sleep quality scores by 73 percent across 412 adults in randomized trials [2]. The effect held in 73 percent of the 412 adults studied [1].",
].join("\n");

const UNCITED_DRAFT = [
  "## The short answer",
  "",
  "Melatonin appears to help people fall asleep faster, and the effect is modest but real.",
  "",
  "## What the research shows",
  "",
  "People who take melatonin before bed tend to fall asleep sooner and report better sleep quality, though the size of the effect varies from person to person.",
].join("\n");

function installFetch(counts, opts) {
  globalThis.fetch = async (url, fetchOpts = {}) => {
    attempt(counts, "fetch");
    const u = String(url);
    const body = typeof fetchOpts.body === "string" ? fetchOpts.body : "";
    if (u.includes("openrouter.ai")) {
      return jsonRes({ error: { message: "Rate limit reached" } }, 429);
    }
    if (u.includes("api.groq.com") || u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("api.cerebras.ai")) {
      if (opts.allChatFail) return jsonRes({ error: { message: "Rate limit reached" } }, 429);
      if (body.includes("literature search specialist")) {
        return chatRes(JSON.stringify([{ term: "sleep", alternates: ["sleep quality", "sleep duration"] }]));
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      }
      if (body.includes("carried no citations at all")) return chatRes(opts.retryAnswer);
      return chatRes(opts.synthAnswer);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      return jsonRes({ resultList: { result: papersFor(u) } });
    }
    if (u.includes("eutils.ncbi.nlm.nih.gov")) {
      if (u.includes("esearch")) return jsonRes({ esearchresult: { idlist: [] } });
      if (u.includes("esummary")) return jsonRes({ result: {} });
      return new Response("", { status: 200 });
    }
    return jsonRes({});
  };
  globalThis.caches = { default: { match: async () => undefined, put: async () => {}, delete: async () => false } };
}

function makeEnv(counts, opts) {
  return {
    DB: countingDb(counts),
    AI: {
      run: async (model, input) => {
        attempt(counts, "ai");
        if (model === "@cf/baai/bge-small-en-v1.5") {
          const texts = (input && input.text) || [];
          return { data: texts.map((_, i) => [1, 0.01 * (i + 1), 0.5, 0.25]) };
        }
        const msgs = (input && input.messages) || [];
        const joined = msgs.map((m) => String(m.content || "")).join("\n");
        if (joined.includes("ANSWER TO FACT-CHECK:")) return { response: "not json" };
        if (opts.allChatFail) throw new Error("Workers AI leg failed");
        return { response: opts.synthAnswer };
      },
    },
    GROQ_KEY: "cdiag-groq-key-123456",
    GEMINI_KEY: "cdiag-gemini-key-123456",
    MISTRAL_KEY: "cdiag-mistral-key-123456",
    NVIDIA_KEY: "cdiag-nvidia-key-123456",
    OPENROUTER_KEY: "cdiag-openrouter-key-123456",
  };
}

async function ask(query, opts) {
  const counts = makeCounts(200);
  installFetch(counts, opts);
  const ledger = createSubrequestLedger(200);
  const env = makeEnv(counts, opts);
  const request = new Request("https://askcerebrum.org/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://askcerebrum.org" },
    body: JSON.stringify({ query, settings: { factCheck: true } }),
  });
  const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
  const data = await res.json();
  await new Promise((r) => setTimeout(r, 150));
  return { status: res.status, data };
}

function synthEntry(data) {
  const sh = Array.isArray(data.stageHealth) ? data.stageHealth : [];
  return sh.find((s) => s && s.name === "synthesis") || null;
}

function assertDiagShape(diag) {
  assert.ok(diag && typeof diag === "object", "synthesis entry carries no citationDiag: " + JSON.stringify(diag));
  assert.equal(typeof diag.draftHadMarkers, "boolean", "draftHadMarkers is not a boolean");
  assert.equal(typeof diag.markersAfterStrips, "number", "markersAfterStrips is not a number");
  assert.equal(typeof diag.retrySite1, "string", "retrySite1 is not a string");
  assert.equal(typeof diag.retrySite2, "string", "retrySite2 is not a string");
  assert.equal(typeof diag.msLeftAtFlip, "number", "msLeftAtFlip is not a number");
  assert.ok(diag.msLeftAtFlip >= 0, "msLeftAtFlip is negative");
}

await test("Case 1: a draft arriving uncited records draftHadMarkers false and both retry sites", async () => {
  const { data } = await ask("does melatonin actually help you sleep", { synthAnswer: UNCITED_DRAFT, retryAnswer: UNCITED_DRAFT });
  assert.equal(data.synthesisMode, "extractive", "uncited draft did not degrade to extractive: " + JSON.stringify({ mode: data.synthesisMode, kind: data.responseKind }));
  const entry = synthEntry(data);
  assert.ok(entry, "no synthesis stage entry in stageHealth");
  assert.equal(entry.ok, false, "synthesis stage did not fail");
  assert.equal(entry.skipReason, "answer had no citations", "skipReason is not the citationless reason: " + JSON.stringify(entry.skipReason));
  assertDiagShape(entry.citationDiag);
  assert.equal(entry.citationDiag.draftHadMarkers, false, "draftHadMarkers should be false for an uncited draft");
  assert.equal(entry.citationDiag.markersAfterStrips, 0, "markersAfterStrips should be 0");
  assert.equal(entry.citationDiag.retrySite1, "fired-failed", "site 1 should have fired and failed, got: " + entry.citationDiag.retrySite1);
  assert.equal(entry.citationDiag.retrySite2, "already-attempted", "site 2 should read already-attempted, got: " + entry.citationDiag.retrySite2);
  assert.ok(entry.citationDiag.msLeftAtFlip > 0, "msLeftAtFlip should be positive, got: " + entry.citationDiag.msLeftAtFlip);
});

await test("Case 2: a cited draft whose markers do not bind records draftHadMarkers true and markersAfterStrips 0", async () => {
  const { data } = await ask("does melatonin actually help you sleep", { synthAnswer: CITED_UNBOUND_DRAFT, retryAnswer: CITED_UNBOUND_DRAFT });
  assert.equal(data.synthesisMode, "extractive", "unbound cited draft did not degrade to extractive: " + JSON.stringify({ mode: data.synthesisMode, kind: data.responseKind }));
  const entry = synthEntry(data);
  assert.ok(entry, "no synthesis stage entry in stageHealth");
  assert.equal(entry.ok, false, "synthesis stage did not fail");
  assert.equal(entry.skipReason, "answer had no citations", "skipReason is not the citationless reason: " + JSON.stringify(entry.skipReason));
  assertDiagShape(entry.citationDiag);
  assert.equal(entry.citationDiag.draftHadMarkers, true, "draftHadMarkers should be true for a cited draft");
  assert.equal(entry.citationDiag.markersAfterStrips, 0, "markersAfterStrips should be 0 after the strips emptied the draft");
  assert.equal(entry.citationDiag.retrySite1, "not-needed", "site 1 should be not-needed for a cited draft, got: " + entry.citationDiag.retrySite1);
  assert.equal(entry.citationDiag.retrySite2, "fired-failed", "site 2 should have fired and failed, got: " + entry.citationDiag.retrySite2);
  assert.ok(entry.citationDiag.msLeftAtFlip > 0, "msLeftAtFlip should be positive, got: " + entry.citationDiag.msLeftAtFlip);
});

await test("Control: a cited draft that binds ships as AI and records markers surviving the strips", async () => {
  const { data } = await ask("does melatonin actually help you sleep", { synthAnswer: CITED_BOUND_DRAFT, retryAnswer: CITED_BOUND_DRAFT });
  assert.equal(data.synthesisMode, "ai", "bound cited draft did not ship as AI: " + JSON.stringify({ mode: data.synthesisMode, kind: data.responseKind }));
  const entry = synthEntry(data);
  assert.ok(entry, "no synthesis stage entry in stageHealth");
  assert.equal(entry.ok, true, "synthesis stage did not succeed");
  assertDiagShape(entry.citationDiag);
  assert.equal(entry.citationDiag.draftHadMarkers, true, "draftHadMarkers should be true");
  assert.ok(entry.citationDiag.markersAfterStrips >= 2, "markersAfterStrips should be at least 2, got: " + entry.citationDiag.markersAfterStrips);
  assert.equal(entry.citationDiag.retrySite1, "not-needed", "site 1 should be not-needed, got: " + entry.citationDiag.retrySite1);
  assert.equal(entry.citationDiag.retrySite2, "not-needed", "site 2 should be not-needed, got: " + entry.citationDiag.retrySite2);
  assert.ok(entry.citationDiag.msLeftAtFlip > 0, "msLeftAtFlip should be positive, got: " + entry.citationDiag.msLeftAtFlip);
});

await test("All legs failed: the entry carries no citationDiag when the citation block never runs", async () => {
  const { data } = await ask("does melatonin actually help you sleep", { synthAnswer: CITED_BOUND_DRAFT, retryAnswer: CITED_BOUND_DRAFT, allChatFail: true });
  const entry = synthEntry(data);
  assert.ok(entry, "no synthesis stage entry in stageHealth");
  assert.equal(entry.ok, false, "synthesis stage did not fail");
  assert.equal("citationDiag" in entry, false, "citationDiag should be absent when the block never ran: " + JSON.stringify(entry.citationDiag));
});

await test("publicStageHealth passes citationDiag through for the synthesis entry and omits it when absent", async () => {
  const withDiag = publicStageHealth([{ name: "synthesis", ok: false, ms: 100, skipReason: "answer had no citations", citationDiag: { draftHadMarkers: true, markersAfterStrips: 0, retrySite1: "not-needed", retrySite2: "fired-failed", msLeftAtFlip: 8123 } }]);
  assert.deepEqual(withDiag[0].citationDiag, { draftHadMarkers: true, markersAfterStrips: 0, retrySite1: "not-needed", retrySite2: "fired-failed", msLeftAtFlip: 8123 });
  const withoutDiag = publicStageHealth([{ name: "synthesis", ok: false, ms: 100, skipReason: "all legs failed", winner: null, winnerMs: null, legs: 4, failedLegs: [] }]);
  assert.equal("citationDiag" in withoutDiag[0], false, "publicStageHealth should not invent citationDiag");
  const other = publicStageHealth([{ name: "retrieval", ok: true, ms: 10, citationDiag: { draftHadMarkers: true } }]);
  assert.equal("citationDiag" in other[0], false, "publicStageHealth should not leak citationDiag onto other stages");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
