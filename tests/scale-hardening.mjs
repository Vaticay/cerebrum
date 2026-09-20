/**
 * Scale-hardening tests (2026-09-14).
 *
 * The three fixes that keep Cerebrum alive at hundreds of concurrent users:
 *   1. Wave-1 race losers are ABORTED the moment a winner is accepted
 *      (~15x AI quota burn otherwise -> mass Wave-4 fallback at ~50-100 users).
 *   2. Semantic Scholar requests carry `x-api-key` when SEMANTIC_SCHOLAR_KEY
 *      is set (unauthenticated pool is 100 req/5min shared).
 *   3. The retrieval ladder is capped at 3 rungs (Cloudflare free plan:
 *      50 subrequests/invocation).
 *
 * Unit tests against the real exports + structural assertions over
 * functions/api/search.js — no server, no network (fetch is stubbed).
 *
 * Run with: node tests/scale-hardening.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { linkWaveAbort, semanticScholar } = await import(
  join(root, "functions/api/search.js")
);
const src = await readFile(join(root, "functions/api/search.js"), "utf8");

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

// ══════════════════════════════════════════════════════════════════════════
group("1. linkWaveAbort — the real exported linker");

await test("aborting the wave signal aborts the linked leg controller", () => {
  const leg = new AbortController();
  const wave = new AbortController();
  linkWaveAbort(leg, wave.signal);
  assert.equal(leg.signal.aborted, false);
  wave.abort();
  assert.equal(leg.signal.aborted, true);
});

await test("no wave signal -> no-op unlink, leg untouched", () => {
  const leg = new AbortController();
  const unlink = linkWaveAbort(leg, undefined);
  assert.equal(typeof unlink, "function");
  unlink();
  assert.equal(leg.signal.aborted, false);
});

await test("already-aborted wave signal aborts the leg immediately", () => {
  const leg = new AbortController();
  const wave = new AbortController();
  wave.abort();
  linkWaveAbort(leg, wave.signal);
  assert.equal(leg.signal.aborted, true);
});

await test("unlink() detaches: later wave abort does not touch the leg", () => {
  const leg = new AbortController();
  const wave = new AbortController();
  const unlink = linkWaveAbort(leg, wave.signal);
  unlink();
  wave.abort();
  assert.equal(leg.signal.aborted, false);
});

// ══════════════════════════════════════════════════════════════════════════
group("1b. wave-1 race — winner cancels losers, selection unchanged");

/**
 * Faithful re-implementation of what callOR/callCompat do with the signal:
 * private AbortController + timeout, linked to the wave signal, fetch bound
 * to the private signal. Uses the REAL linkWaveAbort.
 */
function makeLeg(waveSignal, stubFetch, timeoutMs = 10000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  const unlink = linkWaveAbort(c, waveSignal);
  const p = stubFetch("https://provider.example/v1/chat", { signal: c.signal });
  return p.finally(() => {
    clearTimeout(t);
    unlink();
  });
}

function abortableFetch(url, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      return;
    }
    const onAbort = () =>
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    // never resolves on its own — a slow losing provider leg
  });
}

await test("loser fetch is aborted when the winner is accepted", async () => {
  const w1Abort = new AbortController();
  const winner = Promise.resolve({ answer: "grounded answer", model: "fast" });
  const loser = makeLeg(w1Abort.signal, abortableFetch);
  const loserSettled = loser.then(
    () => "resolved",
    (e) => e.name
  );
  // Promise.any picks the winner; the wave then aborts the losers —
  // exactly what the wave-1 finally block does.
  const won = await Promise.any([winner, loser]);
  assert.equal(won.model, "fast");
  w1Abort.abort();
  assert.equal(await loserSettled, "AbortError");
});

await test("aborted loser rejects like an ordinary leg failure (no hang, no unhandled rejection)", async () => {
  const w1Abort = new AbortController();
  const loser = makeLeg(w1Abort.signal, abortableFetch);
  let rejection = null;
  const observed = loser.catch((e) => {
    rejection = e;
  });
  w1Abort.abort();
  await observed;
  assert.ok(rejection, "loser promise rejected");
  assert.equal(rejection.name, "AbortError");
});

await test("source: wave-1 aborts losers in a finally (win AND deadline paths)", () => {
  const wave1 = src.slice(src.indexOf("// WAVE 1: small, fast"));
  assert.ok(wave1.includes("const w1Abort = new AbortController()"), "per-wave AbortController");
  assert.ok(wave1.includes("finally"), "abort runs in finally");
  assert.ok(wave1.includes("w1Abort.abort()"), "losers aborted");
});

await test("source: every HTTP leg (OR, compat, fastpath) receives w1Abort.signal", () => {
  assert.match(
    src,
    /callOR\(m, messages, maxTokens, wave1Timeout, w1Abort\.signal\)/,
    "OpenRouter legs get the signal"
  );
  assert.match(
    src,
    /compatLegs\(1, "w1", messages, maxTokens, wave1Timeout, w1Abort\.signal\)/,
    "compat legs get the signal"
  );
  assert.match(
    src,
    /callOR\(fastpathModel, messages, maxTokens, clampLegTimeout\(8000\), w1Abort\.signal\)/,
    "fastpath leg gets the signal"
  );
});

await test("source: aborted legs surface as ordinary 'timed out' failures", () => {
  // callOR and callCompat both convert AbortError -> "<model>: timed out",
  // which raceEntry records as a normal failed attempt.
  assert.ok(src.includes('if (e && e.name === "AbortError") throw new Error(model + ": timed out")'));
  assert.ok(src.includes('if (e && e.name === "AbortError") throw new Error(tag + ": timed out")'));
});

// ══════════════════════════════════════════════════════════════════════════
group("2. Semantic Scholar API key");

await test("x-api-key header is sent when a key is provided", async () => {
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, opts) => {
    captured = { url: String(url), headers: (opts && opts.headers) || {} };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            title: "Soil cracking patterns",
            authors: [{ name: "A. Researcher" }],
            year: 2024,
            externalIds: {},
          },
        ],
      }),
    };
  };
  try {
    const papers = await semanticScholar("soil cracking", 2, "S2KEY-123");
    assert.ok(captured.url.startsWith("https://api.semanticscholar.org/graph/v1/paper/search?"));
    assert.equal(captured.headers["x-api-key"], "S2KEY-123");
    assert.equal(papers.length, 1);
    assert.equal(papers[0].title, "Soil cracking patterns");
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("no key -> no x-api-key header (previous behavior preserved)", async () => {
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, opts) => {
    captured = { headers: (opts && opts.headers) || {} };
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  };
  try {
    await semanticScholar("soil cracking", 2);
    assert.ok(!("x-api-key" in captured.headers), "header must be absent without a key");
    await semanticScholar("soil cracking", 2, "");
    assert.ok(!("x-api-key" in captured.headers), "header must be absent with empty key");
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("source: key threaded from env through gatherPapers to every S2 call", () => {
  assert.ok(src.includes("const s2Key = (opts && opts.s2Key) ||"), "gatherPapers reads opts.s2Key");
  // line-based scan: the paren regex chokes on rawQuery.slice(0, 200)'s nested paren
  const callLines = src.split("\n").filter((l) => l.includes("semanticScholar(") && !l.includes("async function"));
  assert.equal(callLines.length, 8, `expected 8 call sites, found ${callLines.length}`);
  for (const l of callLines) {
    assert.ok(
      l.includes("s2Key") || l.includes("SEMANTIC_SCHOLAR_KEY"),
      `call site missing key: ${l.trim()}`
    );
  }
  const envWired = (src.match(/s2Key: env\.SEMANTIC_SCHOLAR_KEY \|\| ""/g) || []).length;
  assert.equal(envWired, 2, `expected 2 gatherPapers call sites wiring env, found ${envWired}`);
});

// ══════════════════════════════════════════════════════════════════════════
group("3. ladder rung cap — worst-case subrequests under the 50 cap");

await test("source: ladder capped at 3 rungs", () => {
  assert.ok(src.includes("const MAX_LADDER_RUNGS = 3"), "cap constant present");
  assert.match(src, /for \(let i = 0; i < rungs\.length && i < MAX_LADDER_RUNGS; i\+\+\)/, "loop bounded by the cap");
});

await test("source: typical searches unaffected — early break on >=8 papers intact", () => {
  assert.ok(src.includes("if (totalAccumulated >= 8 || !_budgetLeft()) break;"), "rung-1 exit still present");
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
