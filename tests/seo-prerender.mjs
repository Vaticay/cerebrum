/**
 * Prerender h1-demotion tests (scripts/prerender-lib.mjs).
 *
 * index.html's <noscript> fallback carries its own <h1> ("Cerebrum"). Once
 * prerender.mjs injects an info page's own <h1>, the document would carry
 * two top-level headings. demoteNoscriptH1 must demote the noscript one —
 * and only that one.
 *
 * Run with: node tests/seo-prerender.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { demoteNoscriptH1 } = await import(join(root, "scripts/prerender-lib.mjs"));

let passed = 0;
let failed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
};

const count = (html, re) => (html.match(re) || []).length;

t("noscript h1 becomes p, keeping attributes and text", () => {
  const html = `<html><body><noscript><div><h1 style="font-size:32px">Cerebrum</h1></div></noscript></body></html>`;
  const out = demoteNoscriptH1(html);
  assert.equal(count(out, /<h1/g), 0);
  assert.ok(out.includes('<p style="font-size:32px">Cerebrum</p>'), out);
});

t("h1 outside the noscript block is untouched", () => {
  const html = `<h1>Page title</h1><noscript><h1>Cerebrum</h1></noscript>`;
  const out = demoteNoscriptH1(html);
  assert.equal(count(out, /<h1/g), 1);
  assert.ok(out.includes("<h1>Page title</h1>"));
  assert.ok(out.includes("<p>Cerebrum</p>"));
});

t("bare <h1> without attributes is handled", () => {
  const out = demoteNoscriptH1(`<noscript><h1>Cerebrum</h1></noscript>`);
  assert.ok(out.includes("<p>Cerebrum</p>"));
});

t("document without noscript is unchanged", () => {
  const html = `<h1>Title</h1><p>body</p>`;
  assert.equal(demoteNoscriptH1(html), html);
});

t("prerender.mjs actually applies the demotion", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(root, "scripts/prerender.mjs"), "utf8");
  assert.match(src, /demoteNoscriptH1\(html\)/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
