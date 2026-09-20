/**
 * E2EE lazy-facade parity tests (src/e2ee/lazyMessaging.js, lazyRecovery.js).
 *
 * The vite build aliases "./e2ee/messaging.js" and "./e2ee/recovery.js" to
 * these facades so the crypto stack (vodozemac, bip39 wordlists, hash-wasm)
 * leaves the initial JS bundle. If the facades ever drift from the real
 * modules — a renamed export, a changed normalizePhrase — the app breaks
 * silently at runtime (the import still resolves; the call just fails).
 * These tests fail the build on any drift.
 *
 * Run with: node tests/e2ee-lazy.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const realMessaging = await import(join(root, "src/e2ee/messaging.js"));
const realRecovery = await import(join(root, "src/e2ee/recovery.js"));
const lazyMessaging = await import(join(root, "src/e2ee/lazyMessaging.js"));
const lazyRecovery = await import(join(root, "src/e2ee/lazyRecovery.js"));

let passed = 0;
let failed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
};

t("lazyMessaging exports every function messaging.js exports", () => {
  const realNames = Object.keys(realMessaging).sort();
  const lazyNames = Object.keys(lazyMessaging).sort();
  assert.deepEqual(lazyNames, realNames,
    `facade exports [${lazyNames}] but real module exports [${realNames}]`);
});

t("every lazyMessaging export is a function", () => {
  for (const name of Object.keys(lazyMessaging)) {
    assert.equal(typeof lazyMessaging[name], "function", `${name} is not a function`);
  }
});

t("lazyRecovery.normalizePhrase is byte-identical to the real one", () => {
  const inputs = [
    "  apple BANANA  cherry  ",
    "HELLO\tWORLD\nnew line",
    "already-normalized phrase",
    "  Mixed\t  Whitespace\n\nEverywhere  ",
    "UPPER",
    " a  b   c    d ",
    "",
    "   ",
  ];
  for (const input of inputs) {
    assert.equal(lazyRecovery.normalizePhrase(input), realRecovery.normalizePhrase(input),
      `mismatch on ${JSON.stringify(input)}`);
  }
});

t("lazyRecovery covers the async recovery helpers", () => {
  for (const name of ["generateRecoveryPhrase", "isValidRecoveryPhrase", "encryptBackupBundle", "decryptBackupBundle"]) {
    assert.equal(typeof lazyRecovery[name], "function", `lazyRecovery missing ${name}`);
  }
});

t("lazyMessaging functions are async (except the documented fire-and-forget clear)", () => {
  for (const name of Object.keys(lazyMessaging)) {
    const isAsync = lazyMessaging[name].constructor.name === "AsyncFunction";
    if (name === "clearE2EEMemory") {
      assert.ok(!isAsync, "clearE2EEMemory should stay a sync-shaped fire-and-forget wrapper");
    } else {
      assert.ok(isAsync, `${name} should be an async facade`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
