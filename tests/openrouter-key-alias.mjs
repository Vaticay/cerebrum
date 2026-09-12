/**
 * OpenRouter key alias — the dashboard may carry the key under the
 * conventional OPENROUTER_API_KEY name while the code historically read
 * only OPENROUTER_KEY. A name mismatch silently built zero OpenRouter
 * legs, so production degraded with keys configured.
 *
 * Asserts: a single alias-aware lookup honors both names (OPENROUTER_KEY
 * wins), every provider path in functions/api/search.js goes through it,
 * and no bare env.OPENROUTER_KEY read remains outside the helper itself.
 *
 * Run with: node tests/openrouter-key-alias.mjs
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

group("OpenRouter key alias");

const src = await readFile(join(root, "functions/api/search.js"), "utf8");

// Extract the real helper from the shipped code and exercise it — a pure
// function, no imports or side effects.
const helperMatch = src.match(/function openRouterKey\(env\) \{[^}]*\}/);
assert.ok(helperMatch, "openRouterKey(env) helper must exist in functions/api/search.js");
const openRouterKey = new Function(`${helperMatch[0]}; return openRouterKey;`)();

await test("honors OPENROUTER_KEY", () => {
  assert.equal(openRouterKey({ OPENROUTER_KEY: "sk-or-abc" }), "sk-or-abc");
});

await test("honors the OPENROUTER_API_KEY alias", () => {
  assert.equal(openRouterKey({ OPENROUTER_API_KEY: "sk-or-xyz" }), "sk-or-xyz");
});

await test("OPENROUTER_KEY wins when both are set", () => {
  assert.equal(
    openRouterKey({ OPENROUTER_KEY: "sk-or-first", OPENROUTER_API_KEY: "sk-or-second" }),
    "sk-or-first"
  );
});

await test("returns empty string when neither is set", () => {
  assert.equal(openRouterKey({}), "");
});

await test("every provider path goes through the alias-aware lookup", () => {
  // Strip the helper definition itself, then require zero remaining bare reads.
  const withoutHelper = src.replace(/function openRouterKey\(env\) \{[^}]*\}/, "");
  const bare = withoutHelper.match(/env\.OPENROUTER_KEY/g) || [];
  assert.equal(bare.length, 0, `found ${bare.length} bare env.OPENROUTER_KEY read(s) bypassing the alias`);
});

await test("missing-key error names both accepted variables", () => {
  assert.ok(
    src.includes("OPENROUTER_KEY or OPENROUTER_API_KEY"),
    "the no-key error should tell the operator both names work"
  );
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
