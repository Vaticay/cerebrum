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
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
