/**
 * _redirects precedence tests.
 *
 * The prerendered info pages must be served as their real static documents,
 * not the SPA shell. public/_redirects therefore needs explicit
 * /slug -> /slug.html 200 rules ABOVE the /* catch-all (first match wins).
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

for (const slug of ["about", "privacy", "terms", "disclosures", "contact"]) {
  t(`explicit /${slug} -> /${slug}.html 200 rule exists above the catch-all`, () => {
    const idx = rules.findIndex(
      (l) => new RegExp(`^/${slug}(\\s|$)`).test(l) && l.includes(`/${slug}.html`) && /\b200\b/.test(l)
    );
    assert.ok(idx !== -1, `no explicit /${slug} rule`);
    assert.ok(idx < catchAllIdx, `/${slug} rule is below the catch-all and would never match`);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
