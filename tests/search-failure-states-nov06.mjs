/**
 * Search failure states (2026-11-06, site debug hostile inputs H1 + H2).
 *
 * H1: a zero source search could come back dressed as a normal
 * answer. Retrieval gathered nothing, yet the synthesis waves
 * fired on the from knowledge path (serveGateNoEvidence was only
 * ever set when a gate emptied a shelf that HAD papers), a model
 * wrote a "No papers were found" paragraph, responseKind stayed
 * "research", the turn was metered as an AI answer, and the
 * client never rendered the no results recovery block, which
 * mounts only for responseKind "no-results". Proven live in the
 * hostile lane's gibberish probe (probes/gibberish.json in the
 * lane folder): sources [], responseKind "research", aiQuota
 * used 1. The fix sets serveGateNoEvidence at the final gate
 * whenever the standard path's evidence set is empty, so the
 * waves close and wave 4 builds the designed no results answer,
 * unmetered.
 *
 * H2: on a platform 1102 death the client's stream first,
 * fallback second chain waited through two worker deaths before
 * the honest error panel. The fix teaches the stream attempt to
 * recognize the platform's death notice (HTTP 5xx with the plain
 * text body "error code: 1102") and throw PlatformDeath, which
 * the ask flow lands on the http5xx panel immediately, with no
 * single fetch retry. Ordinary failures keep the silent fallback.
 *
 * Run with: node tests/search-failure-states-nov06.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

const { onRequest, createSubrequestLedger } =
  await import(join(root, "functions/api/search.js"));

// ═══════════════════════════════════════════════════════════════
group("H1 — empty pool search takes the no results shape, unmetered");

// The live H1 answer, near verbatim: a model apologizing over an
// empty evidence set, junk suggestion included. The stub returns
// it for any synthesis shaped call, so the pre fix tree (waves
// open on an empty pool) reproduces the defect exactly, and the
// fixed tree must never ask for it at all.
const APOLOGY =
  "No papers were found for this topic in the **searched databases**. " +
  "For the **primary literature**, try searching: \"random string query\", " +
  "\"zxqvbnm\", \"kjjhgfd\". The databases returned nothing that could be " +
  "cited for this question, so there is no literature answer to give here.";

const CONTROL_ANSWER = [
  "The microbes living in an infant gut **shape growth** from the first weeks of life [1]. The community helps the baby draw energy from food and trains the immune system, and when it is disturbed early, weight gain can slow until the community recovers [2]. The mix of germs present in the first weeks tracks how the baby grows across the rest of the first year [1].",
  "",
  "## What the research shows",
  "",
  "**The first colonists arrive at birth.** The gut is seeded during and just after birth, and the early community is dominated by organisms that thrive on milk [1]. These first colonists set the conditions every later microbe lives with, so the order of arrival shapes the community that follows and the growth that comes with it [2].",
  "",
  "**Microbes help the baby use food.** Gut microbes break down parts of the diet the baby cannot digest alone, releasing energy the gut lining can absorb [1]. Studies show that **gut microbes** influence how nutrients are absorbed and how weight is gained over time [1][2]. A community with the right fermenters extracts more from the same feed, and babies whose communities lack them gain weight more slowly on identical diets [1].",
].join("\n");

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function chatRes(content) {
  return jsonRes({ choices: [{ message: { content } }] });
}
function makeCounts(cap = 100000) {
  return { fetch: 0, d1: 0, ai: 0, attempts: 0, refused: 0, cap };
}
function attempt(counts, kind) {
  counts[kind]++;
  counts.attempts++;
  if (counts.attempts > counts.cap) {
    counts.refused++;
    throw new Error("Too many subrequests by single Worker invocation");
  }
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
    batch: async (arr) => { attempt(counts, "d1"); return (arr || []).map(() => ({ success: true })); },
    exec: async () => { attempt(counts, "d1"); return { results: [] }; },
  };
}

const richAbstract = (n) =>
  `Gut microbes in the infant gut changed across the first year of life in cohort ${n}. ` +
  `Babies whose gut microbes included more fermenting species gained weight faster, growing ${12 + n}% more over six months than babies with fewer. ` +
  `Feeding mode shaped the gut microbes present: breastfed babies carried different gut microbes from formula fed babies, and the difference tracked growth. ` +
  `Antibiotic exposure thinned the gut microbes and slowed growth for several weeks before recovery.`;

async function runScenario({ query, epmcPapers, synthReply }) {
  const counts = makeCounts();
  let synthCalls = 0;
  const serveChat = (joined) => {
    if (joined.includes("literature search specialist")) {
      return chatRes(JSON.stringify([{ term: "germ", alternates: ["gut microbes", "microbiota", "microbial community"] }]));
    }
    if (joined.includes("relevance validator")) {
      return chatRes(JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]));
    }
    if (joined.includes("ANSWER TO FACT-CHECK:")) return chatRes("not json");
    synthCalls++;
    return chatRes(synthReply);
  };
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  const realRandom = Math.random;
  globalThis.caches = {
    default: {
      match: async () => undefined,
      put: async () => {},
      delete: async () => false,
    },
  };
  Math.random = () => 0.99;
  globalThis.fetch = async (url, opts = {}) => {
    attempt(counts, "fetch");
    const u = String(url);
    const body = typeof opts.body === "string" ? opts.body : "";
    if (u.includes("api.groq.com") || u.includes("generativelanguage.googleapis.com") ||
        u.includes("api.mistral.ai") || u.includes("integrate.api.nvidia.com") ||
        u.includes("openrouter.ai")) {
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch { parsed = {}; }
      const joined = ((parsed.messages || []).map((m) => String(m.content || ""))).join("\n") || body;
      return serveChat(joined);
    }
    if (u.includes("ebi.ac.uk/europepmc")) {
      return jsonRes({ resultList: { result: epmcPapers } });
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
    const ledger = createSubrequestLedger(200);
    const env = {
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
          if (joined.includes("literature search specialist")) {
            return { response: JSON.stringify([{ term: "germ", alternates: ["gut microbes", "microbiota", "microbial community"] }]) };
          }
          if (joined.includes("relevance validator")) {
            return { response: JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) };
          }
          if (joined.includes("ANSWER TO FACT-CHECK:")) return { response: "not json" };
          if (msgs.length) { synthCalls++; return { response: synthReply }; }
          return { response: "" };
        },
      },
      GROQ_KEY: "failure-states-groq-key-123456",
      GEMINI_KEY: "failure-states-gemini-key-123456",
      MISTRAL_KEY: "failure-states-mistral-key-123456",
      NVIDIA_KEY: "failure-states-nvidia-key-123456",
    };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, settings: { answerLength: "medium" } }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: { ledger } });
    assert.equal(res.status, 200);
    const data = await res.json();
    await new Promise((r) => setTimeout(r, 150));
    return { data, synthCalls };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
    Math.random = realRandom;
  }
}

await test("gibberish query, every database empty: no results kind, no synthesis burn, no quota used", async () => {
  const { data, synthCalls } = await runScenario({
    query: "zxqvbnm kjjhgfd asdflkj pqowieur",
    epmcPapers: [],
    synthReply: APOLOGY,
  });
  assert.equal(data.responseKind, "no-results",
    `expected the no results kind, got "${data.responseKind}" with answer starting: ${String(data.answer || "").slice(0, 80)}`);
  assert.ok(data.noResults && typeof data.noResults === "object",
    "the structured no results payload must ride along (the client's recovery block reads it)");
  assert.ok(Array.isArray(data.noResults.reformulations),
    "the payload must carry reformulations for the Try this instead block");
  assert.deepEqual(data.sources, [], "a no results answer ships zero sources");
  assert.notEqual(data.synthesisMode, "ai", "no AI synthesis may be claimed for an empty pool");
  assert.equal(synthCalls, 0,
    `no synthesis leg may fire on an empty evidence set (fired ${synthCalls})`);
  assert.equal(data.aiQuota && data.aiQuota.used, 0,
    "an empty pool answer must not consume AI answer quota");
  assert.ok(!String(data.answer || "").includes("random string query"),
    "the model's junk suggestion from the live defect must not reach the user");
});

await test("nonempty pool is unchanged: research kind, sources ship, waves still fire", async () => {
  const mk = (n) => ({
    title: "Gut germs and infant growth patterns study " + n,
    doi: "10.1000/failstate" + n,
    pubYear: "2024",
    citedByCount: 7,
    authorString: "Doe J, Roe K",
    journalTitle: "Journal of Infant Studies",
    abstractText: richAbstract(n),
  });
  const { data, synthCalls } = await runScenario({
    query: "Do the germs in a baby belly change how well the baby grows",
    epmcPapers: [mk(1), mk(2)],
    synthReply: CONTROL_ANSWER,
  });
  assert.equal(data.responseKind, "research",
    `a pool with citable papers must stay a research answer, got "${data.responseKind}"`);
  assert.ok(Array.isArray(data.sources) && data.sources.length >= 1,
    "the cited sources must ship");
  assert.ok(synthCalls >= 1, "the synthesis waves must still fire when evidence exists");
});

// ═══════════════════════════════════════════════════════════════
group("H2 — platform death fails over fast, ordinary failure still falls back");

// The client chain lives in src/CerebrumApp.jsx, which is not a
// module the suite can import. Extract the chain's own source
// (stage table, the two error types, the signature check, the
// stream pump, the runner, the JSON guard) and drive it with a
// stubbed fetch, the same extraction style other client suites
// use. The ask flow's catch decision is then replayed in the
// order the component performs it, and a source pin below holds
// the component to that same order.
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const sliceStart = appSrc.indexOf("const SEARCH_STREAM_STAGES = [");
const endHint = appSrc.indexOf("Search failure model");
const sliceEnd = appSrc.lastIndexOf("/*", endHint);
assert.ok(sliceStart > 0 && sliceEnd > sliceStart, "client chain slice must be found in CerebrumApp.jsx");
const chainSrc = appSrc.slice(sliceStart, sliceEnd);

function makeChain(fetchImpl) {
  const factory = new Function(
    "fetch", "console",
    chainSrc + "\nreturn { runStreamedSearch, StreamFallback, PlatformDeath, isPlatformDeathBody, safeJsonParse };"
  );
  return factory(fetchImpl, console);
}

// Replay of the ask flow's transport decision, in the component's
// own order: abort propagates, PlatformDeath lands the panel with
// no second request, anything else falls back to the single fetch
// whose own failure or success decides.
async function driveChain(chain, fetchImpl, body) {
  try {
    const r = await chain.runStreamedSearch({ body, signal: undefined, onStageEvent: null, onConnect: null });
    return { outcome: "data", data: r.data };
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    if (e && e.name === "PlatformDeath") {
      return { outcome: "panel", kind: "http5xx", status: e.status };
    }
    const res = await fetchImpl("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      return { outcome: "panel", kind: res.status === 429 ? "http429" : res.status >= 500 ? "http5xx" : "http", status: res.status };
    }
    const parsed = chain.safeJsonParse(await res.text());
    if (!parsed || typeof parsed !== "object") return { outcome: "panel", kind: "badbody", status: res.status };
    return { outcome: "data", data: parsed };
  }
}

await test("the death signature matches the platform body and nothing else", () => {
  const probe = makeChain(async () => { throw new Error("unused"); });
  assert.equal(typeof probe.PlatformDeath, "function", "PlatformDeath must exist in the chain");
  assert.equal(typeof probe.isPlatformDeathBody, "function", "the signature check must exist in the chain");
  assert.equal(probe.isPlatformDeathBody("error code: 1102"), true);
  assert.equal(probe.isPlatformDeathBody("  error code: 1102\n"), true);
  assert.equal(probe.isPlatformDeathBody("error code: 1101"), false);
  assert.equal(probe.isPlatformDeathBody(JSON.stringify({ error: "error code: 1102" })), false,
    "an app JSON error body must not be mistaken for the platform death notice");
  assert.equal(probe.isPlatformDeathBody(""), false);
  assert.equal(probe.isPlatformDeathBody(null), false);
});

await test("resource death on attempt one: panel after exactly one request, no fallback fetch", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Response("error code: 1102", { status: 503, headers: { "Content-Type": "text/plain" } });
  };
  const chain = makeChain(fetchImpl);
  const t0 = Date.now();
  const r = await driveChain(chain, fetchImpl, { query: "why do we dream" });
  assert.equal(r.outcome, "panel", "a platform death must land the error panel");
  assert.equal(r.kind, "http5xx");
  assert.equal(r.status, 503);
  assert.equal(calls.length, 1,
    `the fallback must not run after a platform death (saw ${calls.length} requests: ${calls.join(", ")})`);
  assert.ok(calls[0].includes("stream=1"), "the one request is the streamed attempt");
  assert.ok(Date.now() - t0 < 5000, "the panel must land without a second full attempt's wait");
});

await test("ordinary 5xx on attempt one: silent fallback still runs and can succeed", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("stream=1")) {
      return new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ answer: "A real answer", sources: [{ title: "Some paper" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const chain = makeChain(fetchImpl);
  const r = await driveChain(chain, fetchImpl, { query: "why do we dream" });
  assert.equal(r.outcome, "data", "an ordinary failure must still fall back and succeed");
  assert.equal(r.data.answer, "A real answer");
  assert.equal(calls.length, 2, "stream attempt plus exactly one fallback fetch");
});

await test("healthy stream still resolves from the done frame in one request", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode("id: 1\nevent: question_understood\ndata: {}\n\n"));
        c.enqueue(enc.encode("id: 2\nevent: done\ndata: " + JSON.stringify({ answer: "Streamed answer", sources: [] }) + "\n\n"));
        c.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream", "X-Request-ID": "req-test-1" } });
  };
  const chain = makeChain(fetchImpl);
  const r = await driveChain(chain, fetchImpl, { query: "why do we dream" });
  assert.equal(r.outcome, "data");
  assert.equal(r.data.answer, "Streamed answer");
  assert.equal(calls.length, 1);
});

await test("the ask flow itself handles PlatformDeath before the single fetch fallback", () => {
  const deathCheck = appSrc.indexOf('se.name === "PlatformDeath"');
  const fallbackFetch = appSrc.indexOf('await fetch("/api/search"');
  const panelCall = appSrc.indexOf('failSearch("http5xx"', deathCheck);
  assert.ok(deathCheck > 0, "the ask catch must name PlatformDeath");
  assert.ok(fallbackFetch > deathCheck,
    "the PlatformDeath branch must sit ahead of the single fetch fallback in the ask catch");
  assert.ok(panelCall > deathCheck && panelCall < fallbackFetch,
    "the PlatformDeath branch must land the http5xx panel before any fallback fetch");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log("  FAILED:", f.name);
  process.exit(1);
}
