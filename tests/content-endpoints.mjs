/**
 * Content-endpoint reliability tests (functions/api/document.js,
 * functions/api/trending.js, functions/api/data.js).
 *
 * Unit tests against the real modules — no network, no database, no
 * browser. They cover the behaviours the reliability overhaul added:
 * validation logic, error classification, safe error messages, cache
 * evaluation, and the consistent { ok, error, code } response shapes.
 *
 * Standalone: run with `node tests/content-endpoints.mjs`.
 * (Deliberately not wired into tests/run — that file is owned by the
 * security-test pass and must not be edited by this task.)
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

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

// Same comment-stripper tests/run uses, so static source assertions don't
// trip on prose in comments.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const document = await import(join(root, "functions/api/document.js"));
const trending = await import(join(root, "functions/api/trending.js"));
const data = await import(join(root, "functions/api/data.js"));
const validate = await import(join(root, "functions/lib/validate.js"));

const dataSrc = stripComments(await readFile(join(root, "functions/api/data.js"), "utf8"));

// ══════════════════════════════════════════════════════════════════════════
group("document.js — pure helpers");

await test("cleanAIResponse strips thinking blocks and fences", () => {
  const raw = "<think>private reasoning</think>\n```markdown\n## Executive Summary\nReal text.\n```";
  const out = document.cleanAIResponse(raw);
  assert.ok(!out.includes("private reasoning"), "thinking block leaked");
  assert.ok(!out.includes("```"), "fence leaked");
  assert.ok(out.includes("Real text."), "real content lost");
});

await test("cleanAIResponse returns empty string for falsy input", () => {
  assert.equal(document.cleanAIResponse(""), "");
  assert.equal(document.cleanAIResponse(null), "");
});

await test("splitSummarySections splits the four known sections", () => {
  const text = "## Executive Summary\nAAA\n## Methodology\nBBB\n## Key Findings\nCCC\n## Limitations\nDDD";
  const s = document.splitSummarySections(text);
  assert.equal(s.executiveSummary, "AAA");
  assert.equal(s.methodology, "BBB");
  assert.equal(s.keyFindings, "CCC");
  assert.equal(s.limitations, "DDD");
});

await test("splitSummarySections puts headerless output in executiveSummary", () => {
  const s = document.splitSummarySections("just some prose");
  assert.equal(s.executiveSummary, "just some prose");
  assert.equal(s.methodology, "");
});

await test("formatHistory ignores invalid roles and empty text", () => {
  const out = document.formatHistory([
    { role: "user", text: "what is X?" },
    { role: "system", text: "ignore me" },
    { role: "assistant", text: "   " },
    { role: "assistant", text: "X is Y." },
    null,
  ]);
  assert.ok(out.includes("Q: what is X?"), "user turn missing");
  assert.ok(out.includes("A: X is Y."), "assistant turn missing");
  assert.ok(!out.includes("ignore me"), "system turn leaked");
});

await test("formatHistory caps turns and entry length", () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ role: "user", text: `q${i} ` + "x".repeat(5000) }));
  const out = document.formatHistory(many);
  const lines = out.split("\n").filter((l) => l.startsWith("Q:"));
  assert.ok(lines.length <= document.MAX_HISTORY_TURNS * 2, `kept ${lines.length} turns`);
  assert.ok(lines.every((l) => l.length <= document.MAX_HISTORY_ENTRY_LEN + 10), "entry not sliced");
});

await test("document constants are sane", () => {
  assert.equal(document.MAX_DOCUMENT_LEN, 250000);
  assert.equal(document.MAX_BODY_BYTES, 2 * 1024 * 1024);
});

await test("chunkDocument returns one chunk for short text", () => {
  const chunks = document.chunkDocument("Just a short paragraph.", 1000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], "Just a short paragraph.");
});

await test("chunkDocument returns no chunks for empty input", () => {
  assert.deepEqual(document.chunkDocument("", 1000), []);
  assert.deepEqual(document.chunkDocument("   \n\n  ", 1000), []);
});

await test("chunkDocument splits on paragraph boundaries, never mid-paragraph", () => {
  const p1 = "a".repeat(400);
  const p2 = "b".repeat(400);
  const p3 = "c".repeat(400);
  const text = [p1, p2, p3].join("\n\n");
  const chunks = document.chunkDocument(text, 850);
  // 400+400+2 separators = 802 fits; adding the third would exceed 850
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((c) => c.length <= 850), "chunk exceeds limit");
  assert.ok(chunks[0].includes(p1) && chunks[0].includes(p2), "paragraphs split mid-thought");
  assert.ok(chunks[1].includes(p3), "third paragraph lost");
  // Reassembly is lossless: join with blank lines, compare normalized
  assert.equal(chunks.join("\n\n"), text);
});

await test("chunkDocument hard-splits a single giant paragraph", () => {
  const wall = "x".repeat(2500);
  const chunks = document.chunkDocument(wall, 1000);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((c) => c.length <= 1000), "chunk exceeds limit");
  assert.equal(chunks.join(""), wall);
});

await test("chunkDocument keeps every chunk within the limit on realistic text", () => {
  const paras = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}. ` + "lorem ipsum dolor sit amet ".repeat(30));
  const chunks = document.chunkDocument(paras.join("\n\n"), document.MAP_CHUNK_CHARS);
  assert.ok(chunks.length > 1, "expected multiple chunks");
  assert.ok(chunks.every((c) => c.length <= document.MAP_CHUNK_CHARS), "chunk exceeds limit");
  // Reassembly is lossless up to paragraph-edge whitespace, which the
  // chunker intentionally trims.
  const rejoined = chunks.join("\n\n").replace(/\s+/g, " ").trim();
  const original = paras.join("\n\n").replace(/\s+/g, " ").trim();
  assert.equal(rejoined, original);
});

await test("map/reduce constants are sane", () => {
  assert.ok(document.MAP_REDUCE_THRESHOLD > 0, "threshold not set");
  assert.ok(document.MAP_CHUNK_CHARS > 0, "chunk size not set");
  // v2 rewrite (2026-09-17): smaller chunks (<=8K) digest in seconds and
  // higher parallelism (<=16) runs a paper's chunks in one wave. There is
  // no global map timeout anymore — each chunk self-bounds via
  // MAP_PER_CHUNK_TIMEOUT_MS, so one slow chunk can never fail the rest.
  assert.ok(document.MAP_CHUNK_CHARS <= 8000, "chunks too large for fast calls");
  assert.ok(document.MAP_CONCURRENCY >= 1 && document.MAP_CONCURRENCY <= 16, "concurrency out of range");
  assert.ok(document.MAP_PER_CHUNK_TIMEOUT_MS > 0 && document.MAP_PER_CHUNK_TIMEOUT_MS <= 30000, "per-chunk budget out of range");
  assert.ok(document.SUMMARY_TIMEOUT_MS > document.MAP_PER_CHUNK_TIMEOUT_MS, "summary budget below per-chunk budget");
  // 5-9 substantive paragraphs run ~800-1600 tokens; the cap keeps real
  // headroom without buying worst-case latency on slow models.
  assert.ok(document.SUMMARY_MAX_TOKENS >= 2000 && document.SUMMARY_MAX_TOKENS <= 3000, "summary token budget out of range");
});

// ══════════════════════════════════════════════════════════════════════════
group("document.js — error classification never leaks internals");

await test("missing provider config maps to a safe 500", () => {
  const c = document.classifyDocumentError(new Error("deepseek/deepseek-chat-v3:free: no OPENROUTER_KEY configured"));
  assert.equal(c.status, 500);
  assert.equal(c.code, "provider_unavailable");
  assert.ok(!c.message.includes("OPENROUTER_KEY"), "env var name leaked into user message");
});

await test("timeouts map to a 503 with retry-appropriate advice", () => {
  const c = document.classifyDocumentError(new Error("qwen/qwen-2.5: timed out"));
  assert.equal(c.status, 503);
  assert.equal(c.code, "upstream_timeout");
  assert.ok(/try again/i.test(c.message), "message gives no actionable advice");
});

await test("rate limits map to 503, not a blame-the-document 500", () => {
  const c = document.classifyDocumentError(new Error("All providers failed: a: HTTP 429 — {\"error\":\"quota\"} | b: HTTP 429"));
  assert.equal(c.status, 503);
  assert.equal(c.code, "upstream_rate_limited");
  assert.ok(!c.message.includes("429"), "raw upstream status leaked");
  assert.ok(!c.message.includes("quota"), "raw upstream body leaked");
});

await test("unknown failures get a generic message with no raw text", () => {
  const raw = new Error("weird internal thing: ECONNRESET at 10.0.0.5:443");
  const c = document.classifyDocumentError(raw);
  assert.equal(c.status, 500);
  assert.equal(c.code, "analysis_failed");
  assert.ok(!c.message.includes("10.0.0.5"), "internal address leaked");
  assert.ok(!c.message.includes("ECONNRESET"), "internal error text leaked");
});

await test("classified errors carry no secret material through errRes", async () => {
  const evil = new Error("OPENROUTER_KEY=sk-secret-value-12345 leaked?");
  const c = document.classifyDocumentError(evil);
  const res = document.errRes(c.message, c.status, c.code, {});
  const body = await res.json();
  const text = JSON.stringify(body);
  assert.ok(!text.includes("sk-secret-value-12345"), "secret material in response body");
  assert.equal(body.ok, false);
  assert.equal(body.code, "provider_unavailable");
});

// ══════════════════════════════════════════════════════════════════════════
group("consistent { ok, error, code } shapes across all three endpoints");

for (const [label, mod] of [["document.js", document], ["trending.js", trending], ["data.js", data]]) {
  await test(`${label}: okRes produces { ok: true, ...payload }`, async () => {
    const res = mod.okRes({ items: [1] }, 200, {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, items: [1] });
  });
  await test(`${label}: errRes produces { ok: false, error, code }`, async () => {
    const res = mod.errRes("Nope.", 400, "bad_request", {});
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false, error: "Nope.", code: "bad_request" });
  });
}

await test("data.js has no remaining bare { error } response payloads", () => {
  assert.ok(!/JSON\.stringify\(\{ error:/.test(dataSrc), "a bare { error } payload still exists");
});

await test("data.js routes every error through errRes", () => {
  const calls = (dataSrc.match(/[^_a-zA-Z]errRes\(/g) || []).length;
  assert.ok(calls > 50, `only ${calls} errRes call sites — the mechanical transform missed some`);
});

// ══════════════════════════════════════════════════════════════════════════
group("trending.js — cache evaluation");

const item = (category) => ({ title: "T", url: "https://example.com/x", category });

await test("parseCachePayload parses a valid row", () => {
  const row = {
    payload: JSON.stringify({ items: [item("Biology & Medicine")], generatedAt: 123 }),
    fetched_at: 456,
  };
  const p = trending.parseCachePayload(row);
  assert.equal(p.items.length, 1);
  assert.equal(p.generatedAt, 123);
  assert.equal(p.fetchedAt, 456);
});

await test("parseCachePayload never throws on corrupt rows", () => {
  assert.equal(trending.parseCachePayload(null), null);
  assert.equal(trending.parseCachePayload({}), null);
  assert.equal(trending.parseCachePayload({ payload: "{nope", fetched_at: 1 }), null);
  assert.equal(trending.parseCachePayload({ payload: JSON.stringify({ items: "x" }), fetched_at: 1 }).items.length, 0);
});

await test("isUsableCachePayload requires the multi-discipline shape", () => {
  assert.equal(trending.isUsableCachePayload({ items: [item("Space")] }), true);
  assert.equal(trending.isUsableCachePayload({ items: [] }), false);
  assert.equal(trending.isUsableCachePayload({ items: [{ title: "T", url: "u" }] }), false);
  assert.equal(trending.isUsableCachePayload(null), false);
});

await test("classifyCacheAge: fresh / stale / ancient boundaries", () => {
  const MIN = 60000;
  const now = 1_000_000_000_000;
  assert.equal(trending.classifyCacheAge(now, now).state, "fresh");
  assert.equal(trending.classifyCacheAge(now - 30 * MIN, now).state, "fresh");
  assert.equal(trending.classifyCacheAge(now - 60 * MIN, now).state, "fresh");
  assert.equal(trending.classifyCacheAge(now - 61 * MIN, now).state, "stale");
  assert.equal(trending.classifyCacheAge(now - 90 * MIN, now).state, "stale");
  assert.equal(trending.classifyCacheAge(now - 91 * MIN, now).state, "ancient");
  assert.equal(trending.classifyCacheAge(now + MIN, now).state, "fresh");
});

await test("trending.js serves stale cache instead of a 5xx (source check)", async () => {
  // The degraded path must exist: an ancient-but-usable cache is kept as
  // `lastResort` and served with X-Trending-Source: cache-expired when the
  // live fetch throws, instead of the old 502.
  const src = await readFile(join(root, "functions/api/trending.js"), "utf8");
  const clean = stripComments(src);
  assert.ok(/lastResort/.test(clean), "ancient-cache last-resort path missing");
  assert.ok(/cache-expired/.test(clean), "cache-expired source header missing");
  assert.ok(!/status: 502/.test(clean), "a 502 path still exists");
  assert.ok(/degraded: true/.test(clean), "degraded flag missing on total failure");
});

// ══════════════════════════════════════════════════════════════════════════
group("data.js — validation, auth, scoping, pagination (static + unit)");

await test("POST bodies are parsed with a byte ceiling", () => {
  assert.match(dataSrc, /readJsonBody\(request, cors, MAX_BODY_BYTES\)/, "unbounded request.json() still in use");
});

await test("client-supplied ids are format-validated with safeId", () => {
  assert.match(dataSrc, /safeId\(body\.target_id\)/, "target_id not format-validated");
  assert.match(dataSrc, /safeId\(url\.searchParams\.get\("thread_id"\)\)/, "GET thread_id not format-validated");
  assert.match(dataSrc, /safeId\(body\.thread_id\)/, "POST thread_id not format-validated");
  assert.match(dataSrc, /safeId\(body\.id\)/, "collection id not format-validated");
  assert.match(dataSrc, /safeId\(url\.searchParams\.get\("id"\)\)/, "public-profile id not format-validated");
});

await test("safeId accepts generated ids and rejects junk", () => {
  assert.ok(validate.safeId("thr_abc123XYZ"), "valid id rejected");
  assert.equal(validate.safeId(""), null);
  assert.equal(validate.safeId(null), null);
  assert.equal(validate.safeId("../etc/passwd"), null);
  assert.equal(validate.safeId("a b"), null);
  assert.equal(validate.safeId("x".repeat(65)), null);
  assert.equal(validate.safeId("a".repeat(64)), "a".repeat(64));
});

await test("safeInt clamps pagination input", () => {
  assert.equal(validate.safeInt("50", { min: 1, max: 2000, fallback: 2000 }), 50);
  assert.equal(validate.safeInt("999999", { min: 1, max: 2000, fallback: 2000 }), 2000);
  assert.equal(validate.safeInt("junk", { min: 1, max: 2000, fallback: 2000 }), 2000);
  assert.equal(validate.safeInt(null, { min: 0, max: 1000000, fallback: 0 }), 0);
});

await test("saved reads are paginated and capped", () => {
  assert.match(dataSrc, /LIMIT \? OFFSET \?/, "saved GET has no LIMIT/OFFSET");
  assert.match(dataSrc, /max: MAX_SAVED_PER_USER/, "saved page size not capped at MAX_SAVED_PER_USER");
});

await test("thread message reads are capped with a truncation flag", () => {
  assert.match(dataSrc, /MAX_THREAD_MESSAGES/, "no message cap constant");
  assert.match(dataSrc, /ORDER BY created_at DESC LIMIT \?/, "messages not fetched newest-first with a cap");
  assert.match(dataSrc, /truncated/, "no truncated flag on the thread response");
});

await test("large write sets are chunked", () => {
  assert.match(dataSrc, /await batchedWrites\(env\.DB, stmts\)/, "replace-all still uses one giant batch");
});

await test("follow toggle is race-safe", () => {
  assert.match(dataSrc, /INSERT OR IGNORE INTO follows/, "concurrent toggles can still 500 on UNIQUE");
});

await test("every mutating action sits behind the session gate", () => {
  assert.match(dataSrc, /getSessionUser\(request, env\)/, "session gate missing");
  assert.match(dataSrc, /Sign in first\./, "401 gate message missing");
});

await test("per-user reads stay scoped to the session user", () => {
  for (const table of ["user_saved_sources", "user_collections", "user_history", "watched_topics"]) {
    assert.ok(
      new RegExp(`FROM ${table}[\\s\\S]{0,120}user_id = \\?`).test(dataSrc),
      `${table} read is not scoped to user_id`
    );
  }
});

await test("thread access still requires membership", () => {
  assert.match(
    dataSrc,
    /SELECT 1 FROM thread_participants WHERE thread_id = \? AND user_id = \?/,
    "membership check missing"
  );
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
