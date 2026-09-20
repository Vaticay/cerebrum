/**
 * Marketing-page SEO tests (src/marketingContent.js + routing + sitemap).
 *
 * These pages (/features, /pricing, /document-mode, /diagram-studio,
 * /investigations) are the site's crawlable surface beyond the legal/info
 * pages. The checks here are the ones a reviewer will not do by hand:
 * title/description length budgets, the slogan staying word-for-word,
 * structured-data flags, route classification, and sitemap agreement.
 *
 * Run with: node tests/seo-marketing.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { MARKETING_PAGES, MARKETING_SLUGS, SLOGAN } = await import(join(root, "src/marketingContent.js"));
const { INFO_SLUGS, classifyRoute } = await import(join(root, "src/routeClassify.js"));
const { SOURCE_COUNT } = await import(join(root, "functions/lib/product.js"));

let passed = 0;
let failed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
};

const EXPECTED_SLUGS = ["features", "pricing", "document-mode", "diagram-studio", "investigations"];
const SLOGAN_VERBATIM = "Ask a real research question. Every claim traces to a paper you can open.";

t("all five marketing slugs exist", () => {
  assert.deepEqual([...MARKETING_SLUGS].sort(), [...EXPECTED_SLUGS].sort());
  assert.deepEqual(Object.keys(MARKETING_PAGES).sort(), [...EXPECTED_SLUGS].sort());
});

for (const slug of EXPECTED_SLUGS) {
  const p = MARKETING_PAGES[slug];
  t(`/${slug}: rendered title is 50–60 chars`, () => {
    const rendered = `${p.title} — Cerebrum`;
    assert.ok(rendered.length >= 50 && rendered.length <= 60,
      `got ${rendered.length} chars: "${rendered}"`);
  });
  t(`/${slug}: meta description (lede) is 140–160 chars`, () => {
    assert.ok(p.lede.length >= 140 && p.lede.length <= 160,
      `got ${p.lede.length} chars`);
  });
  t(`/${slug}: has eyebrow, title, blocks, and updated stamp`, () => {
    assert.ok(p.eyebrow && p.eyebrow.length > 0);
    assert.ok(Array.isArray(p.blocks) && p.blocks.length > 0);
    for (const b of p.blocks) assert.ok(b.h && (b.p || b.list || b.email), "block without heading/content");
    assert.ok(p.updated, "missing updated stamp");
  });
  t(`/${slug}: carries SoftwareApplication structured-data flag`, () => {
    assert.equal(p.softwareApp, true);
  });
  t(`/${slug}: route classifies as an info page`, () => {
    assert.ok(INFO_SLUGS.includes(slug), `${slug} not in INFO_SLUGS`);
    assert.deepEqual(classifyRoute(`/${slug}`), { kind: "info", slug });
    assert.deepEqual(classifyRoute(`/${slug}/`), { kind: "info", slug });
  });
  if (Array.isArray(p.faq) && p.faq.length) {
    t(`/${slug}: FAQ entries are well-formed`, () => {
      for (const item of p.faq) {
        assert.ok(item.q && item.q.length > 8, "faq question too short/missing");
        assert.ok(item.a && item.a.length > 20, "faq answer too short/missing");
      }
    });
  }
}

t("slogan is exported verbatim, word for word", () => {
  assert.equal(SLOGAN, SLOGAN_VERBATIM);
});

t("slogan appears verbatim in the features page copy", () => {
  const copy = JSON.stringify(MARKETING_PAGES.features);
  assert.ok(copy.includes(SLOGAN_VERBATIM), "features page does not contain the exact slogan");
});

t("sitemap.xml lists all five marketing URLs", async () => {
  const sitemap = await readFile(join(root, "public/sitemap.xml"), "utf8");
  for (const slug of EXPECTED_SLUGS) {
    assert.ok(sitemap.includes(`<loc>https://askcerebrum.org/${slug}</loc>`),
      `sitemap missing /${slug}`);
  }
});

t("database-count claims match the sanctioned number", () => {
  assert.equal(SOURCE_COUNT, 15, `SOURCE_COUNT is ${SOURCE_COUNT}, copy says 15`);
  const copy = JSON.stringify(MARKETING_PAGES);
  const claims = [...copy.matchAll(/(\d+)\s+open scholarly databases/g)].map((m) => Number(m[1]));
  assert.ok(claims.length > 0, "no database-count claim found in marketing copy");
  for (const n of claims) assert.equal(n, SOURCE_COUNT, `copy claims ${n} databases`);
});

t("pricing offers are the real plans ($20/mo, $144/yr USD)", () => {
  const offers = MARKETING_PAGES.pricing.offers;
  assert.ok(Array.isArray(offers) && offers.length >= 2);
  const prices = offers.map((o) => `${o.priceCurrency} ${o.price}`).join(" | ");
  assert.ok(offers.some((o) => o.price === "20" && o.priceCurrency === "USD"), `no $20 USD offer (${prices})`);
  assert.ok(offers.some((o) => o.price === "144" && o.priceCurrency === "USD"), `no $144 USD offer (${prices})`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
