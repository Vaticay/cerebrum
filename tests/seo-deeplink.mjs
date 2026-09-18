/**
 * `?q=` deep-link query parsing (src/deepLink.js).
 *
 * index.html's SearchAction advertises ?q={search_term_string}; arriving
 * with ?q= must prefill and run the search. The parser yields to ?magic=
 * (magic-link sign-in owns the URL) and returns null for empty input.
 *
 * Run with: node tests/seo-deeplink.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { getDeepLinkQuery } = await import(join(root, "src/deepLink.js"));

let passed = 0;
let failed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
};

t("plain ?q= returns the query", () => {
  assert.equal(getDeepLinkQuery("?q=crispr+gene+editing"), "crispr gene editing");
});

t("surrounding whitespace is trimmed", () => {
  assert.equal(getDeepLinkQuery("?q=%20%20soil%20cracking%20"), "soil cracking");
});

t("empty or missing ?q= returns null", () => {
  assert.equal(getDeepLinkQuery(""), null);
  assert.equal(getDeepLinkQuery("?"), null);
  assert.equal(getDeepLinkQuery("?q="), null);
  assert.equal(getDeepLinkQuery("?q=%20%20"), null);
  assert.equal(getDeepLinkQuery("?other=1"), null);
});

t("?magic= takes precedence over ?q=", () => {
  assert.equal(getDeepLinkQuery("?magic=abc123&q=crispr"), null);
});

t("coexists with unrelated params", () => {
  assert.equal(getDeepLinkQuery("?utm_source=x&q=lignin"), "lignin");
});

t("garbage input returns null, never throws", () => {
  assert.equal(getDeepLinkQuery(null), null);
  assert.equal(getDeepLinkQuery(undefined), null);
});

t("the App effect actually consumes ?q= (wiring check)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /getDeepLinkQuery\(window\.location\.search\)/);
  assert.match(src, /askRef\.current\?\.?\(deepQ\)/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
