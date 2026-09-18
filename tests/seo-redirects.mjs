/**
 * _redirects safety tests.
 *
 * The prerendered info pages are served because static files take
 * precedence over the /* catch-all (verified live on askcerebrum.org) —
 * NOT via explicit rewrite rules. 2026-09-18 proved the alternative
 * broken: `/about /about.html 200` 308-loops every info page in
 * production (the rewrite turns /about into /about.html, Pages'
 * pretty-URL canonicalization 308s it back to /about, forever).
 * scripts/check.mjs enforces this at build time; these tests pin the live
 * file independently of the build.
 *
 * Run with: node tests/seo-redirects.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(join(root, "public/_redirects"), "utf8");
const rules = raw.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

let passed = 0;
let failed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
};

const catchAllIdx = rules.findIndex((l) => /^\/\*/.test(l));

t("catch-all /* -> /index.html 200 exists", () => {
  assert.ok(catchAllIdx !== -1, "no /* catch-all rule found");
  assert.ok(/\/index\.html/.test(rules[catchAllIdx]), "catch-all does not target /index.html");
  assert.ok(/\b200\b/.test(rules[catchAllIdx]), "catch-all is not a 200 rewrite");
});

t("catch-all is the only dynamic rule", () => {
  const dynamic = rules.filter((l) => /[*:]/.test(l.split(/\s+/)[0]));
  assert.equal(dynamic.length, 1, `expected only the /* catch-all, found: ${dynamic.join(" | ")}`);
});

for (const slug of ["about", "privacy", "terms", "disclosures", "contact"]) {
  t(`no slug-specific rule for /${slug} (would 308-loop on Pages)`, () => {
    const idx = rules.findIndex(
      (l, i) => i !== catchAllIdx && new RegExp(`^/${slug}(\\s|$|/)`).test(l)
    );
    assert.equal(idx, -1, `rule would loop: ${rules[idx]}`);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
