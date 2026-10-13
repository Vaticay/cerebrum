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

const EXPECTED_PRICING_OFFERS = [
  { name: "Cerebrum Pro, monthly", price: "20", billingIncrement: "P1M" },
  { name: "Cerebrum Pro, annual", price: "144", billingIncrement: "P1Y" },
  { name: "Lite Monthly", price: "3.99", billingIncrement: "P1M" },
  { name: "Lite Annual", price: "39", billingIncrement: "P1Y" },
  { name: "Pro Student", price: "7.99", billingIncrement: "P1M" },
];

t("pricing offers cover every verified paid plan", () => {
  const offers = MARKETING_PAGES.pricing.offers;
  assert.ok(Array.isArray(offers), "pricing offers are missing");
  for (const expected of EXPECTED_PRICING_OFFERS) {
    assert.ok(
      offers.some((o) => o.name === expected.name && o.price === expected.price &&
        o.priceCurrency === "USD" && o.billingIncrement === expected.billingIncrement),
      `pricing offers are missing ${expected.name} at USD ${expected.price}`
    );
  }
});

t("pricing copy presents every verified tier and its headline allowances", () => {
  const pricingCopy = JSON.stringify(MARKETING_PAGES.pricing);
  const required = [
    "Free, forever",
    "Cost: $0, with no payment required.",
    "50 AI answers, 3 document reads, and 1 flowchart every 5 days",
    "Pro Lite",
    "Lite Monthly costs $3.99 per month",
    "Lite Annual costs $39 per year",
    "500 AI answers, 30 document reads, and 10 flowcharts every 5 days",
    "Pro Student",
    "$7.99 per month for the first 12 months",
    "standard $20 monthly price",
    "Cerebrum Pro",
    "$20 per month or $144 per year",
    "Unlimited AI answers, document reads, and flowcharts",
  ];
  for (const text of required) {
    assert.ok(pricingCopy.includes(text), `pricing copy is missing: ${text}`);
  }
});

/* ── Product copy pass (2026-10-13) ────────────────────────────────
 * The Search record, the coverage disclosure, MCP access, and the
 * unaffiliated researcher audience are real and live, and the copy
 * has to say so. These pins keep the presences from silently
 * disappearing in a future copy edit, keep the two features out of
 * the Pro only list (they ship on answers generally; the MCP
 * endpoint has no tier gate), and hold the new strings to the
 * product rule of no dash characters of any kind. The dash check is
 * scoped to the new strings on purpose: older copy predates the
 * check and is out of scope for this pin. */
const featuresJson = JSON.stringify(MARKETING_PAGES.features);
const pricingJson = JSON.stringify(MARKETING_PAGES.pricing);
const blockByHeading = (page, h) => (page.blocks || []).find((b) => b.h === h);
const faqByQuestion = (page, q) => (page.faq || []).find((f) => f.q === q);

const NEW_FEATURE_HEADINGS = [
  "Every answer shows its coverage",
  "The Search record",
  "Why a record, not just an answer",
  "Use Cerebrum inside ChatGPT and Claude",
  "Built for researchers without a library",
];
const NEW_FAQ_QUESTIONS = [
  "What is the Search record?",
  "Can I use Cerebrum from inside ChatGPT or Claude?",
  "Are the Search record and MCP access Pro only?",
];
const NEW_PRICING_HEADINGS = ["Pro Lite", "Pro Student"];
const NEW_PRICING_FAQ_QUESTIONS = [
  "What is Pro Lite?",
  "How does Pro Student pricing work?",
];
const NEW_PRICING_OFFER_NAMES = ["Lite Monthly", "Lite Annual", "Pro Student"];

t("features page presents the Search record and the coverage disclosure", () => {
  assert.ok(featuresJson.includes("Search record"), "features copy never says Search record");
  assert.ok(/coverage/.test(featuresJson), "features copy never says coverage");
  for (const h of NEW_FEATURE_HEADINGS.slice(0, 3)) {
    assert.ok(blockByHeading(MARKETING_PAGES.features, h), `features page is missing the block: ${h}`);
  }
});

t("features page presents MCP access with the copyable endpoint", () => {
  assert.ok(blockByHeading(MARKETING_PAGES.features, "Use Cerebrum inside ChatGPT and Claude"),
    "features page is missing the MCP block");
  assert.ok(featuresJson.includes("https://askcerebrum.org/mcp"), "endpoint address missing from features copy");
  assert.ok(featuresJson.includes("search_literature"), "search_literature tool not named");
  assert.ok(featuresJson.includes("get_trending"), "get_trending tool not named");
  assert.ok(pricingJson.includes("https://askcerebrum.org/mcp"), "endpoint address missing from pricing copy");
});

t("features page names the unaffiliated researcher audience", () => {
  assert.ok(blockByHeading(MARKETING_PAGES.features, "Built for researchers without a library"),
    "features page is missing the audience block");
  assert.ok(featuresJson.includes("unaffiliated"), "copy never says unaffiliated");
  assert.ok(/independent/i.test(featuresJson), "copy never says independent");
});

t("pricing lists the record and MCP with the free offer, not as Pro gates", () => {
  const freeBlock = blockByHeading(MARKETING_PAGES.pricing, "Free, forever");
  assert.ok(freeBlock, "pricing page lost its Free, forever block");
  const freeJson = JSON.stringify(freeBlock);
  assert.ok(freeJson.includes("Search record"), "Search record not listed with the free offer");
  assert.ok(freeJson.includes("MCP"), "MCP not listed with the free offer");
  const proBlock = blockByHeading(MARKETING_PAGES.pricing, "Cerebrum Pro");
  assert.ok(proBlock, "pricing page lost its Cerebrum Pro block");
  const proJson = JSON.stringify(proBlock.list || []);
  assert.ok(!proJson.includes("Search record"), "Search record must not be listed as a Pro feature");
  assert.ok(!proJson.includes("MCP"), "MCP access must not be listed as a Pro feature");
  assert.ok(faqByQuestion(MARKETING_PAGES.pricing, "Are the Search record and MCP access Pro only?"),
    "pricing FAQ lost the not Pro only answer");
});

t("new product copy strings contain no dash characters of any kind", () => {
  const DASHES = ["-", "–", "—"];
  const pieces = [];
  for (const h of NEW_FEATURE_HEADINGS) {
    const b = blockByHeading(MARKETING_PAGES.features, h);
    assert.ok(b, `missing block for dash check: ${h}`);
    pieces.push(JSON.stringify(b));
  }
  const freeBlock = blockByHeading(MARKETING_PAGES.pricing, "Free, forever");
  assert.ok(freeBlock && Array.isArray(freeBlock.list), "Free, forever list missing for dash check");
  pieces.push(JSON.stringify(freeBlock.list));
  for (const h of NEW_PRICING_HEADINGS) {
    const b = blockByHeading(MARKETING_PAGES.pricing, h);
    assert.ok(b, `missing pricing block for dash check: ${h}`);
    pieces.push(JSON.stringify(b));
  }
  for (const q of NEW_PRICING_FAQ_QUESTIONS) {
    const f = faqByQuestion(MARKETING_PAGES.pricing, q);
    assert.ok(f, `missing pricing FAQ entry for dash check: ${q}`);
    pieces.push(JSON.stringify(f));
  }
  for (const name of NEW_PRICING_OFFER_NAMES) {
    const offer = (MARKETING_PAGES.pricing.offers || []).find((o) => o.name === name);
    assert.ok(offer, `missing pricing offer for dash check: ${name}`);
    pieces.push(JSON.stringify(offer));
  }
  for (const q of NEW_FAQ_QUESTIONS) {
    const f = faqByQuestion(MARKETING_PAGES.features, q) || faqByQuestion(MARKETING_PAGES.pricing, q);
    assert.ok(f, `missing FAQ entry for dash check: ${q}`);
    pieces.push(JSON.stringify(f));
  }
  const whatYouGet = blockByHeading(MARKETING_PAGES.features, "What you get");
  assert.ok(whatYouGet, "features page lost its What you get block");
  const recordBullet = (whatYouGet.list || []).find((li) => li.includes("Search record"));
  assert.ok(recordBullet, "What you get lost its Search record bullet");
  pieces.push(JSON.stringify(recordBullet));
  for (const piece of pieces) {
    for (const d of DASHES) {
      assert.ok(!piece.includes(d), `dash character ${JSON.stringify(d)} found in new copy: ${piece.slice(0, 110)}`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
