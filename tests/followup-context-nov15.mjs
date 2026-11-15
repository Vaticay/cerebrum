/**
 * Follow up context (2026-11-15, follow up trace lane).
 *
 * The live diagnosis of 2026-11-15 proved three of three follow up
 * questions returned no results in production:
 *
 *   FU1  "does melatonin actually help you sleep" then "how much of
 *        it should someone take then": the classifier DID return a
 *        followup verdict, but the handler's new substance check
 *        counted the leftover words "someone" and "then" as a new
 *        substance and forced a fresh standalone search.
 *   FU3  "can exercise help with anxiety" then "how often do you
 *        need to do it to get that effect": the classifier returned
 *        "new" outright (the text is not short and opens with no
 *        follow up marker) despite back references ("do it", "that
 *        effect") and no new substance, so nothing resolved the
 *        context and "often" became a mandatory constraint.
 *   FU2  "why do we dream" then "what about nightmares then, are
 *        they the same thing": follow up mode DID engage, and the
 *        final response assembly then threw
 *        "TypeError: Cannot read properties of null (reading
 *        'length')" at publicSourcesQueried().length, because the
 *        follow up branch builds its gather result with no _diag
 *        and publicSourcesQueried returns null without one. The
 *        top level catch served the degraded request failure shape.
 *
 * Two further defects sat behind those, proven by the same trace
 * once the first three were fixed locally: the follow up branch
 * never assigned searchQuery, so it stayed the raw fragment, and
 * the programmatic validation passes plus the LLM validator judged
 * the anchored shelf against that fragment and emptied it, which
 * is the "no citable evidence" the live payloads showed.
 *
 * What is pinned here, at handler level with the provider fleet
 * stubbed the way production behaved that day (the OpenRouter
 * resolver leg failing, the Groq family answering):
 *   A. A follow up whose text contains no subject word still
 *      searches the prior subject: a literature query that runs
 *      during turn 2 names the first turn's subject (melatonin,
 *      exercise), and turn 2 serves a research answer with
 *      sources, not a no results state.
 *   B. A follow up turn carrying previous sources never serves
 *      the request failure shape (a stageHealth entry named
 *      "request" with ok false).
 */
import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { onRequest, createSubrequestLedger } = await import(join(root, "functions/api/search.js"));

const failures = [];
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("ok   " + name); }
  catch (e) { failures.push({ name, error: e }); console.log("FAIL " + name + "\n     " + String(e && e.message || e)); }
}

const errors = [];
console.error = (...a) => { errors.push(a.map((x) => String((x && x.stack) || x)).join(" ")); };

const epmcQueries = [];
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

const TOPICS = [
  { word: "melatonin", title: "Melatonin dosage and sleep onset in adults", abstract: "Melatonin supplementation reduced sleep onset latency in adults with insomnia. A dose of 0.5 mg to 5 mg melatonin taken before bed improved sleep quality scores and shortened the time to fall asleep across randomized trials." },
  { word: "dream", title: "Dream content and nightmare frequency in adults", abstract: "Dream reports collected over fourteen nights showed that nightmare frequency correlated with daytime stress. Dreaming during REM sleep involved emotional memory processing, and nightmares differed from ordinary dreams in intensity and recall." },
  { word: "nightmare", title: "Nightmares and REM sleep behaviour in adults", abstract: "Nightmares occurred during REM sleep and were associated with heightened arousal. Participants reporting frequent nightmares showed fragmented sleep and greater dream recall than controls in this cohort study of dreaming adults." },
  { word: "exercise", title: "Exercise frequency and anxiety symptom reduction", abstract: "Exercise performed three times per week reduced anxiety symptoms in adults with generalized anxiety. Participants who exercised regularly showed lower anxiety scores than sedentary controls after twelve weeks of aerobic exercise training." },
  { word: "sleep", title: "Sleep quality and next day functioning", abstract: "Sleep quality predicted next day cognitive functioning in this cohort. Participants with longer sleep duration and fewer awakenings performed better on attention tasks the following morning." },
];
function papersFor(url) {
  const q = decodeURIComponent(String(url)).toLowerCase();
  const hits = TOPICS.filter((t) => q.includes(t.word));
  const chosen = (hits.length ? hits : [TOPICS[4]]).slice(0, 2);
  const out = [];
  chosen.forEach((t) => {
    for (let n = 1; n <= 3; n++) {
      out.push({
        title: t.title + " (study " + n + ")",
        doi: "10.1000/fupin" + t.word + n,
        pubYear: "2024",
        citedByCount: 7,
        authorString: "Doe J, Roe K",
        journalTitle: "Journal of Followup Studies",
        abstractText: t.abstract,
      });
    }
  });
  return out;
}

const SYNTH_ANSWER = [
  "## The short answer",
  "",
  "The evidence points to a real effect, described in the studies below [1].",
  "",
  "## What the research shows",
  "",
  "The first study reports the measured effect with specific numbers and a clear comparison group [1]. A second study found a consistent pattern across its cohort and reported the same direction of effect [2]. Together the studies support the finding while leaving the size of the effect approximate [1][2].",
].join("\n");

function installFetch(counts) {
  globalThis.fetch = async (url, opts = {}) => {
    attempt(counts, "fetch");
    const u = String(url);
    const body = typeof opts.body === "string" ? opts.body : "";
    if (u.includes("openrouter.ai")) {
      // The resolver leg fails, exactly as production payloads
      // showed on 2026-11-15 (_resolver null in every draw).
      return jsonRes({ error: { message: "Rate limit reached" } }, 429);
    }
    if (u.includes("api.groq.com") || u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("api.cerebras.ai")) {
      if (body.includes("literature search specialist")) {
        return chatRes(JSON.stringify([{ term: "sleep", alternates: ["sleep quality", "sleep duration"] }]));
      }
      if (body.includes("relevance validator")) {
        return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
      }
      return chatRes(SYNTH_ANSWER);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      epmcQueries.push(decodeURIComponent(u).toLowerCase());
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

function makeEnv(counts) {
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
        return { response: SYNTH_ANSWER };
      },
    },
    GROQ_KEY: "fupin-groq-key-123456",
    GEMINI_KEY: "fupin-gemini-key-123456",
    MISTRAL_KEY: "fupin-mistral-key-123456",
    NVIDIA_KEY: "fupin-nvidia-key-123456",
    OPENROUTER_KEY: "fupin-openrouter-key-123456",
  };
}

async function ask(query, history) {
  const counts = makeCounts(200);
  installFetch(counts);
  const ledger = createSubrequestLedger(200);
  const env = makeEnv(counts);
  const request = new Request("https://askcerebrum.org/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://askcerebrum.org" },
    body: JSON.stringify({ query, history, settings: { factCheck: true } }),
  });
  const epmcBefore = epmcQueries.length;
  const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
  const data = await res.json();
  await new Promise((r) => setTimeout(r, 150));
  return { status: res.status, data, epmc: epmcQueries.slice(epmcBefore) };
}

function requestFailure(data) {
  const sh = Array.isArray(data.stageHealth) ? data.stageHealth : [];
  return sh.some((s) => s && s.name === "request" && s.ok === false);
}

async function runSequence(q1, q2) {
  const t1 = await ask(q1, []);
  const history = [
    { role: "user", content: q1 },
    { role: "assistant", content: t1.data.answer || "", sources: Array.isArray(t1.data.sources) ? t1.data.sources : [] },
  ];
  const t2 = await ask(q2, history);
  return { t1, t2 };
}

await test("FU1: a follow up with no subject word still searches the prior subject (melatonin)", async () => {
  const { t2 } = await runSequence("does melatonin actually help you sleep", "how much of it should someone take then");
  assert.equal(requestFailure(t2.data), false, "turn 2 served the request failure shape");
  assert.equal(t2.data.responseKind, "research", "turn 2 did not serve a research answer: " + JSON.stringify({ kind: t2.data.responseKind, mode: t2.data.synthesisMode }));
  assert.ok(Array.isArray(t2.data.sources) && t2.data.sources.length >= 1, "turn 2 cited no sources");
  assert.ok(t2.epmc.some((q) => q.includes("melatonin")), "no literature query that ran during turn 2 named melatonin: " + JSON.stringify(t2.epmc.slice(0, 4)));
});

await test("FU3: a follow up the classifier calls new still resolves context when it carries back references and no new substance (exercise)", async () => {
  const { t2 } = await runSequence("can exercise help with anxiety", "how often do you need to do it to get that effect");
  assert.equal(requestFailure(t2.data), false, "turn 2 served the request failure shape");
  assert.equal(t2.data.responseKind, "research", "turn 2 did not serve a research answer: " + JSON.stringify({ kind: t2.data.responseKind, mode: t2.data.synthesisMode }));
  assert.ok(Array.isArray(t2.data.sources) && t2.data.sources.length >= 1, "turn 2 cited no sources");
  assert.ok(t2.epmc.some((q) => q.includes("exercise")), "no literature query that ran during turn 2 named exercise: " + JSON.stringify(t2.epmc.slice(0, 4)));
});

await test("FU2: a follow up turn carrying previous sources never serves the request failure shape", async () => {
  const history = [
    { role: "user", content: "why do we dream" },
    {
      role: "assistant",
      content: "Dreams are thought to play a role in emotional memory processing during REM sleep [1].",
      sources: [
        { title: "Dream content and nightmare frequency in adults", url: "https://europepmc.org/article/MED/1001", journal: "Journal of Followup Studies", authors: "Doe J", year: 2024, doi: "10.1000/fupindream1" },
        { title: "Nightmares and REM sleep behaviour in adults", url: "https://europepmc.org/article/MED/1002", journal: "Journal of Followup Studies", authors: "Roe K", year: 2024, doi: "10.1000/fupinnightmare1" },
      ],
    },
  ];
  const t2 = await ask("what about nightmares then, are they the same thing", history);
  assert.equal(requestFailure(t2.data), false, "turn 2 served the request failure shape (the assembly crash)");
  assert.equal(t2.data.responseKind, "research", "turn 2 did not serve a research answer: " + JSON.stringify({ kind: t2.data.responseKind, mode: t2.data.synthesisMode }));
  assert.ok(Array.isArray(t2.data.sources) && t2.data.sources.length >= 1, "turn 2 cited no sources");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
