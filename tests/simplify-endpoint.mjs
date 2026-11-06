/**
 * Simplify endpoint tests (functions/api/simplify.js).
 *
 * Unit tests against the real module — no network, no database. The env
 * stub carries no DB binding, so the shared limiter runs its in memory
 * fallback, and no OPENROUTER key, so an allowed request stops at the
 * no_model gate instead of calling a model. One test stubs fetch to
 * prove the success path end to end.
 *
 * Covers the 2026-11-06 site debug hostile inputs findings H5 and H6,
 * plus the signature drift they were hiding: the endpoint used to read
 * checkRateLimit's boolean as an object with an .ok field, so EVERY
 * request came back 429, and its readJsonBody, errorResponse, and json
 * calls used argument orders the canonical helpers do not take.
 *
 * Standalone: run with `node tests/simplify-endpoint.mjs`.
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

function group(name) {
  console.log(`\n${name}`);
}

const { onRequestPost } = await import(join(root, "functions/api/simplify.js"));

const LONG_TEXT =
  "Photosynthesis is the process by which green plants convert sunlight, " +
  "water, and carbon dioxide into oxygen and glucose. [1] It takes place " +
  "in chloroplasts and underpins nearly all life on Earth.";

function makeRequest(body, { ip, cookie } = {}) {
  const headers = {
    Origin: "https://askcerebrum.org",
    "Content-Type": "application/json",
    "CF-Connecting-IP": ip,
  };
  if (cookie) headers.Cookie = cookie;
  return new Request("https://askcerebrum.org/api/simplify", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// Unique IPs per test keep the module level limiter buckets isolated.
let ipCounter = 20;
function freshIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

async function call(body, opts = {}) {
  const res = await onRequestPost({ request: makeRequest(body, opts), env: opts.env || {} });
  let data = null;
  try { data = await res.json(); } catch { /* body was not JSON */ }
  return { res, data };
}

group("simplify.js — the limiter no longer refuses everyone");

await test("a first ever call is not rate limited", async () => {
  const { res, data } = await call({ text: LONG_TEXT, level: "plain" }, { ip: freshIp() });
  assert.equal(res.status, 503);
  assert.equal(data.code, "no_model");
});

await test("empty text still says there is nothing to simplify", async () => {
  const { res, data } = await call({ text: "   ", level: "plain" }, { ip: freshIp() });
  assert.equal(res.status, 400);
  assert.equal(data.code, "bad_request");
  assert.equal(data.error, "Nothing to simplify.");
});

await test("malformed JSON gets the shared reader's 400, not a crash", async () => {
  const { res, data } = await call("{not json", { ip: freshIp() });
  assert.equal(res.status, 400);
  assert.equal(data.code, "invalid_json");
});

group("simplify.js — H6: short text tells the truth");

await test("a real short sentence is told it is too short, and the length it needs", async () => {
  const { res, data } = await call({ text: "Water is wet and fire is hot.", level: "plain" }, { ip: freshIp() });
  assert.equal(res.status, 400);
  assert.equal(data.code, "too_short");
  assert.ok(data.error.includes("too short"), `copy does not say too short: ${data.error}`);
  assert.ok(data.error.includes("50 characters"), `copy does not state the needed length: ${data.error}`);
  assert.ok(!data.error.includes("Nothing to simplify."), "short text got the empty text sentence");
});

await test("text of exactly 50 characters is accepted past the length gate", async () => {
  const fifty = "a".repeat(50);
  const { res, data } = await call({ text: fifty, level: "undergrad" }, { ip: freshIp() });
  assert.equal(res.status, 503);
  assert.equal(data.code, "no_model");
});

group("simplify.js — H5: the hourly cap, its copy, and its keying");

await test("the 21st anonymous call in the window is a 429 that states the real limit and window", async () => {
  const ip = freshIp();
  for (let i = 0; i < 20; i++) {
    const { res } = await call({ text: LONG_TEXT, level: "plain" }, { ip });
    assert.notEqual(res.status, 429, `call ${i + 1} was refused early`);
  }
  const { res, data } = await call({ text: LONG_TEXT, level: "plain" }, { ip });
  assert.equal(res.status, 429);
  assert.equal(data.code, "rate_limited");
  assert.ok(data.error.includes("20"), `copy does not state the limit: ${data.error}`);
  assert.ok(data.error.includes("hour"), `copy does not state the window: ${data.error}`);
  assert.ok(!data.error.includes("few seconds"), "copy still understates the window");
  assert.equal(res.headers.get("Retry-After"), "3600");
});

await test("the window is an hour, not the old 3600 millisecond unit slip", async () => {
  const ip = freshIp();
  for (let i = 0; i < 20; i++) {
    await call({ text: LONG_TEXT, level: "plain" }, { ip });
  }
  // With a 3600 ms window every stamp would have expired by now.
  await new Promise((r) => setTimeout(r, 4200));
  const { res } = await call({ text: LONG_TEXT, level: "plain" }, { ip });
  assert.equal(res.status, 429, "bucket reset after 4.2 seconds, so the window is not an hour");
});

await test("signed in callers behind one address get separate buckets", async () => {
  const ip = freshIp();
  for (let i = 0; i < 20; i++) {
    await call({ text: LONG_TEXT, level: "plain" }, { ip });
  }
  const anon = await call({ text: LONG_TEXT, level: "plain" }, { ip });
  assert.equal(anon.res.status, 429, "anonymous bucket should be spent");

  const sessA = await call({ text: LONG_TEXT, level: "plain" }, { ip, cookie: "cb_sess=session-token-a" });
  assert.equal(sessA.res.status, 503, "a signed in caller shared the anonymous bucket");
  const sessB = await call({ text: LONG_TEXT, level: "plain" }, { ip, cookie: "cb_sess=session-token-b" });
  assert.equal(sessB.res.status, 503, "two signed in callers shared one bucket");
});

await test("one signed in caller still hits their own cap", async () => {
  const ip = freshIp();
  const cookie = "cb_sess=session-token-c";
  for (let i = 0; i < 20; i++) {
    const { res } = await call({ text: LONG_TEXT, level: "plain" }, { ip, cookie });
    assert.notEqual(res.status, 429, `session call ${i + 1} was refused early`);
  }
  const { res } = await call({ text: LONG_TEXT, level: "plain" }, { ip, cookie });
  assert.equal(res.status, 429, "the session bucket never capped");
});

group("simplify.js — success path end to end");

await test("a model rewrite comes back as a 200 with the simplified text", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "Plants turn sunlight, water, and air into oxygen and sugar. [1] That is how they grow." } }],
    }),
  });
  try {
    const { res, data } = await call(
      { text: LONG_TEXT, level: "plain" },
      { ip: freshIp(), env: { OPENROUTER_KEY: "test-key" } }
    );
    assert.equal(res.status, 200);
    assert.equal(data.level, "plain");
    assert.ok(data.text.includes("[1]"), "citation marker lost");
  } finally {
    globalThis.fetch = realFetch;
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
