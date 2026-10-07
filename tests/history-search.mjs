/**
 * Investigation history search tests.
 *
 * Static source assertions on functions/api/data.js pinning the
 * history/search endpoint: query validation, user scoping, snippet
 * generation, and the 2-character minimum.
 *
 * Run with: node tests/history-search.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataJs = await readFile(join(root, "functions/api/data.js"), "utf8");

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL - ${name}: ${err.message}`);
  }
}

function srcHas(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `missing: ${label || needle}`);
}

// ── Backend: history/search ─────────────────────────────────────────────

await test("history search action exists", async () => {
  srcHas(dataJs, 'resource === "history" && action === "search"', "history search route");
});

await test("search requires 2+ character query", async () => {
  srcHas(dataJs, "query_too_short", "short query error code");
  srcHas(dataJs, "at least 2 characters", "short query message");
});

await test("search is scoped to requesting user", async () => {
  srcHas(dataJs, "WHERE user_id = ? AND (title LIKE ?", "user-scoped search query");
});

await test("search covers titles and turn content", async () => {
  srcHas(dataJs, "title LIKE ? ESCAPE", "title search");
  srcHas(dataJs, "turns_json LIKE ? ESCAPE", "turn content search");
});

await test("search escapes LIKE wildcards", async () => {
  srcHas(dataJs, 'replace(/[%_\\\\]/g', "LIKE escaping");
});

await test("search returns snippets", async () => {
  srcHas(dataJs, "snippet", "snippet in response");
});

await test("search caps results at 50", async () => {
  srcHas(dataJs, "LIMIT 50", "result cap");
});

await test("search returns turn count", async () => {
  srcHas(dataJs, "turnCount", "turn count in response");
});

// ── Summary ─────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.log(`\n${failures.length} FAILURES, ${passed} passed`);
  process.exit(1);
} else {
  console.log(`\n${passed} passed, 0 failed`);
}
