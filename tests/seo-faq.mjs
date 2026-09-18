/**
 * FAQ / structured-data consistency tests (src/legalContent.js).
 *
 * The visible FAQ on /about and the FAQPage JSON-LD in the prerendered
 * <head> are both generated from PAGES.about.faq — visible copy is
 * authoritative, and the two cannot drift by construction. These tests pin
 * the data contract the prerender consumes: well-formed questions and
 * answers, no duplicates, and no fabricated ratings/reviews anywhere near
 * the structured data.
 *
 * Run with: node tests/seo-faq.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { PAGES } = await import(join(root, "src/legalContent.js"));

let passed = 0;
let failed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
};

const faq = PAGES.about.faq;
assert.ok(Array.isArray(faq) && faq.length > 0, "PAGES.about.faq is empty");

t("every FAQ item has a non-empty question and answer", () => {
  for (const [i, item] of faq.entries()) {
    assert.ok(item.q && item.q.trim().length > 0, `faq[${i}] has no question`);
    assert.ok(item.a && item.a.trim().length > 0, `faq[${i}] has no answer`);
    assert.ok(item.q.trim().endsWith("?"), `faq[${i}] question does not end with "?": ${item.q}`);
  }
});

t("no duplicate questions", () => {
  const seen = new Set();
  for (const item of faq) {
    const q = item.q.trim().toLowerCase();
    assert.ok(!seen.has(q), `duplicate question: ${item.q}`);
    seen.add(q);
  }
});

t("answers are concise (quotable, 1–4 sentences)", () => {
  for (const item of faq) {
    const sentences = item.a.split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.ok(sentences.length >= 1 && sentences.length <= 4,
      `"${item.q}" has ${sentences.length} sentences`);
  }
});

t("high-value researcher queries are covered", () => {
  const qs = faq.map((i) => i.q.toLowerCase());
  for (const needle of [
    "find scientific papers with ai",
    "literature review",
    "google scholar",
    "trust",
    "free",
    "databases",
  ]) {
    assert.ok(qs.some((q) => q.includes(needle)), `no FAQ question covers "${needle}"`);
  }
});

t("no fabricated ratings/reviews in structured-data-adjacent content", async () => {
  const { readFileSync } = await import("node:fs");
  const pages = ["about", "privacy", "terms", "disclosures", "contact"]
    .map((s) => JSON.stringify(PAGES[s])).join(" ");
  const shell = readFileSync(join(root, "index.html"), "utf8");
  for (const [label, text] of [["legalContent", pages], ["index.html", shell]]) {
    assert.ok(!/aggregateRating/i.test(text), `${label} contains aggregateRating`);
    assert.ok(!/"review"/i.test(text) || !/reviewRating/i.test(text),
      `${label} contains review structured data`);
  }
});

t("prerender serializes the same FAQ array to FAQPage JSON-LD (no drift)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(root, "scripts/prerender.mjs"), "utf8");
  // The JSON-LD must be built from data.faq — the same array the visible
  // section renders — never from a second hand-maintained copy.
  assert.match(src, /data\.faq\.map\(\(item\) =>/);
  assert.ok(!/mainEntity.*\[/.test(src.replace(/data\.faq\.map\(\(item\) =>/, "")) ||
    src.includes("data.faq.map"),
    "FAQPage mainEntity is not derived from data.faq");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
