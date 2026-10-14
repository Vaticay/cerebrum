/**
 * Search pipeline smoke test.
 *
 * Regression guard for the 2026-09-20 total search outage: the SSE-streaming
 * refactor extracted onRequest's body into runSearchPipeline() and dropped
 * the `let catchQuery` declaration. In ESM strict mode the bare assignment
 * `catchQuery = query` threw ReferenceError on EVERY request before
 * retrieval ran, and the top-level catch returned the "internal error"
 * degraded response. 138 unit tests passed with the outage live because
 * nothing invoked the pipeline with a real request.
 *
 * This test invokes the real onRequest with a real query and a fetch stub
 * that fails fast, and asserts the pipeline runs to its honest no-results
 * shape instead of the internal-error degraded shape.
 *
 * Run with: node tests/search-pipeline-smoke.mjs
 */

import { strict as assert } from "node:assert";
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

// Every outbound fetch fails fast: retrieval genuinely finds nothing, but
// the pipeline must still run to completion (no ReferenceError, no throw
// before retrieval, honest no-results — not "internal error").
const realFetch = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new Error("smoke-test: network stubbed"));

try {
  const { onRequest } = await import(join(root, "functions/api/search.js"));

  await test("a real query runs the pipeline without throwing (no undeclared-variable ReferenceError)", async () => {
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "waste oil substrates for black soldier fly larvae" }),
    });
    const res = await onRequest({ request, env: {}, waitUntil: () => {}, data: {} });
    assert.equal(res.status, 200, "pipeline returns 200 even when everything downstream fails");
    const data = await res.json();
    assert.ok(data && typeof data.answer === "string", "response carries an answer");
    assert.ok(
      !data.answer.includes("hit an internal error"),
      "must not take the top-level-catch internal-error path (undeclared variable?)"
    );
    assert.ok(
      ["none", "extractive", "ai"].includes(data.synthesisMode),
      `synthesisMode is an honest value, got ${data.synthesisMode}`
    );
  });

  await test("the stream path (?stream=1) emits a done frame with the final answer", async () => {
    const request = new Request("https://askcerebrum.org/api/search?stream=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "waste oil substrates for black soldier fly larvae" }),
    });
    const res = await onRequest({ request, env: {}, waitUntil: () => {}, data: {} });
    assert.equal(res.status, 200);
    assert.ok((res.headers.get("content-type") || "").includes("text/event-stream"), "stream path returns SSE");
    const text = await res.text();
    // A broken pipeline emits "error" (or nothing after connect); a working
    // one always terminates with a done frame carrying the final payload.
    const frames = text.split("\n\n");
    const doneFrame = frames.find((f) => /(^|\n)event: done(\n|$)/.test(f));
    assert.ok(doneFrame, "stream terminates with a done frame");
    const dataLine = doneFrame.split("\n").find((l) => l.startsWith("data:"));
    const payload = JSON.parse(dataLine.slice(5));
    assert.ok(payload && typeof payload.answer === "string", "done frame carries the final answer");
    assert.ok(!payload.answer.includes("hit an internal error"), "done payload is not the internal-error path");
  });

  // Wave two part two (2026-10-13): the early cache return used to
  // ship the bare answer with none of the trust artifacts. This runs
  // the handler's real cache read path end to end: a fake D1 whose
  // answer_cache holds one verified row (the payload shape the cache
  // write side stores: answer text + JSON source list + store time),
  // everything else empty, all network stubbed off above. The serve
  // must carry the trust artifacts RECOMPUTED from that payload under
  // current rules: coverage, the honest partial funnel, the record,
  // a confidence line under the current caps, and stage health.
  await test("an early cache hit serves recomputed trust artifacts end to end", async () => {
    const storedAt = Date.now() - 5 * 60 * 1000;
    const storedAnswer =
      "A wood frog can survive being frozen solid for weeks at a time, with ice forming only in the spaces outside its cells [1]. " +
      "Its heart stops completely while it is frozen and starts beating again after the thaw [2].";
    const storedSources = [
      { title: "Freeze tolerance in the wood frog", authors: "Storey KB, Storey JM", journal: "Journal of Experimental Biology", year: 2021, relevance: 92, abstract: "Wood frogs tolerate the freezing of up to two thirds of their body water, with ice confined to extracellular spaces.", url: "https://doi.org/10.1000/frog1" },
      { title: "Glucose as a cryoprotectant in a freeze tolerant frog", authors: "Costanzo JP", journal: "Cryobiology", year: 2019, relevance: 88, abstract: "Glucose accumulates in the tissues of frozen frogs and acts as a colligative cryoprotectant during thaw recovery.", url: "https://doi.org/10.1000/frog2" },
      { title: "Winter ecology of northern amphibians", authors: "Pinder AW", journal: "Amphibia Notes", year: 2015, relevance: 40, abstract: "A general survey of overwintering strategies across northern amphibian species and their habitats.", url: "https://doi.org/10.1000/frog3" },
    ];
    const cacheRow = { answer: storedAnswer, sources: JSON.stringify(storedSources), created_at: storedAt };
    const fakeStatement = (sql) => {
      const st = {
        bind: () => st,
        first: async () => (sql.includes("FROM answer_cache") && sql.includes("score >= 2") ? cacheRow : null),
        all: async () => ({ results: [] }),
        run: async () => ({ success: true, meta: { changes: 0 } }),
      };
      return st;
    };
    const env = { DB: { prepare: (sql) => fakeStatement(String(sql)), batch: async () => [], exec: async () => ({ results: [] }) } };
    const request = new Request("https://askcerebrum.org/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "can wood frogs survive being frozen" }),
    });
    const res = await onRequest({ request, env, waitUntil: () => {}, data: {} });
    assert.equal(res.status, 200, "cache serve returns 200");
    const data = await res.json();
    assert.equal(data._cached, true, "response is the cache serve");
    assert.equal(data.source, "Cached (verified)");
    assert.equal(data.answer, storedAnswer, "the answer text itself is served unchanged");
    // Cited set recovered from the stored answer's markers.
    assert.equal(data.sources.length, 3);
    assert.equal(data.sources[2].uncited, true, "the never cited stored source is flagged on serve");
    // The honest partial funnel: cited is real, retrieval counts null.
    assert.equal(data._funnel.cited, 2);
    assert.equal(data._funnel.gathered, null);
    // Coverage rebuilt on the cited set.
    assert.equal(data._coverage.cited, 2);
    assert.equal(data._coverage.furtherReading, 1);
    assert.equal(data._coverage.earliestYear, 2019);
    assert.equal(data._coverage.latestYear, 2021);
    // The record travels with the serve: store time, no invented model.
    assert.ok(data._record, "cache serve carries a search record");
    assert.equal(data._record.version, 2);
    assert.equal(data._record.question, "can wood frogs survive being frozen");
    assert.equal(data._record.askedAt, new Date(storedAt).toISOString());
    assert.equal(data._record.synthesisModel, null);
    assert.deepEqual(data._record.sources.map((s) => s.cited), [true, true, false]);
    // Confidence recomputed under current rules: strong papers, but
    // no fact check ran on a cache serve, so the unchecked cap binds.
    // Corrected contract (2026-10-14 verdict correctness pass): this
    // pin used to assert the response's numeric score (59). The
    // numeric score and its point factors are internal only and never
    // ship (Dusty's ban on pseudo precise confidence scores); the
    // shipped shape is { level, line }, and the cap's observable
    // effect is the moderate band plus the cap reason in the line.
    // (The builder level cap itself stays pinned in search-record.)
    assert.deepEqual(Object.keys(data.confidence).sort(), ["level", "line"]);
    assert.equal(data.confidence.level, "moderate");
    assert.match(data.confidence.line, /Confidence is capped because fact checking did not check any claims/);
    assert.equal(data.confidence.score, undefined);
    assert.equal(data.confidence.factors, undefined);
    // Stage health names the serve for what it is, and nothing failed.
    assert.equal(data.degraded, false);
    assert.equal(data.stageHealth.length, 1);
    assert.equal(data.stageHealth[0].name, "cache");
    assert.equal(data.stageHealth[0].ok, true);
    assert.ok(typeof data.stageHealth[0].ms === "number" && data.stageHealth[0].ms >= 0);
  });
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
