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
import { parse } from "@babel/parser";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { MARKETING_PAGES, MARKETING_SLUGS, SLOGAN, DEMO_QUESTIONS } = await import(join(root, "src/marketingContent.js"));
const { PAGES: LEGAL_PAGES } = await import(join(root, "src/legalContent.js"));
const widgetsSrc = await readFile(join(root, "src/marketingWidgets.jsx"), "utf8");
const searchSrc = await readFile(join(root, "functions/api/search.js"), "utf8");
const appSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
const llmsTxt = await readFile(join(root, "public/llms.txt"), "utf8");
const { INFO_SLUGS, classifyRoute } = await import(join(root, "src/routeClassify.js"));
const { SCHOLARLY_SOURCES, SOURCE_COUNT } = await import(join(root, "functions/lib/product.js"));

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
    const rendered = `${p.title} · Cerebrum`;
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
  // Updated 2026-10-14 (wave eight round three, Job 1): the
  // canonical list dropped Zenodo (the fanout never called it),
  // so the sanctioned count is 14 — the number of fetchers the
  // search actually runs.
  assert.equal(SOURCE_COUNT, 14, `SOURCE_COUNT is ${SOURCE_COUNT}, copy says 14`);
  const copy = JSON.stringify(MARKETING_PAGES);
  const claims = [...copy.matchAll(/(\d+)\s+open scholarly databases/g)].map((m) => Number(m[1]));
  assert.ok(claims.length > 0, "no database-count claim found in marketing copy");
  for (const n of claims) assert.equal(n, SOURCE_COUNT, `copy claims ${n} databases`);
});

t("the canonical source list is the search fanout, slot for slot", () => {
  // The count is only canonical if product.js's list IS the fanout:
  // same ids, same order, as the sourceNames array the search ships.
  // The preprint slot is one entry (the Europe PMC preprint index);
  // medRxiv is reached through it and must not appear as its own id.
  const m = searchSrc.match(/const sourceNames = \[([\s\S]*?)\];/);
  assert.ok(m, "sourceNames array not found in functions/api/search.js");
  const fanoutIds = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(fanoutIds, SCHOLARLY_SOURCES.map((s) => s.id),
    "product.js SCHOLARLY_SOURCES and the search fanout disagree");
  assert.ok(!fanoutIds.includes("medrxiv"), "medRxiv is not a fanout slot; it is reached through the preprint index");
});

t("legal copy count claims derive from the same canonical list", () => {
  const copy = JSON.stringify(LEGAL_PAGES);
  const claims = [
    ...[...copy.matchAll(/(\d+)\s+open scholarly databases/g)].map((m) => Number(m[1])),
    ...[...copy.matchAll(/queries (\d+) sources/g)].map((m) => Number(m[1])),
  ];
  assert.ok(claims.length >= 3, `expected at least 3 legal count claims, found ${claims.length}`);
  for (const n of claims) assert.equal(n, SOURCE_COUNT, `legal copy claims ${n} databases`);
  const faq = LEGAL_PAGES.about.faq.find((f) => f.q === "Which databases does Cerebrum search?");
  assert.ok(faq, "About FAQ lost its database list answer");
  assert.ok(faq.a.startsWith(`${SOURCE_COUNT} open scholarly sources`),
    `database FAQ does not lead with the canonical count: ${faq.a.slice(0, 80)}`);
  for (const s of SCHOLARLY_SOURCES) {
    if (s.id === "preprints") continue;
    assert.ok(faq.a.includes(s.name), `database FAQ omits ${s.name}`);
  }
  assert.ok(faq.a.includes("preprint index"), "database FAQ does not name the preprint index slot");
  assert.ok(faq.a.includes("medRxiv"), "database FAQ does not say medRxiv is reached through the index");
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
    "Free",
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
 * product rule of no dash characters of any kind. The dash check
 * below is scoped to the new strings; the guard at the end of this
 * file covers every string in the marketing and legal modules. */
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
  const freeBlock = blockByHeading(MARKETING_PAGES.pricing, "Free");
  assert.ok(freeBlock, "pricing page lost its Free block");
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

t("no page copy promises the free tier is permanent", () => {
  // The Terms reserve changing free limits (section 5) and
  // discontinuing parts of the service (section 14), so copy must
  // state what the free tier is today, never that it lasts forever.
  // The pricing block was headed "Free, forever" and the features
  // page said the core work "stays free" until wave seven (sixth
  // panel, Product). Both are corrected contract, pinned here.
  const copy = JSON.stringify(MARKETING_PAGES) + JSON.stringify(LEGAL_PAGES);
  assert.ok(!/free, forever/i.test(copy), "a page still promises 'Free, forever'");
  assert.ok(!/stays free/i.test(copy), "a page still says the core work 'stays free'");
  // The same rule binds the app's own user visible copy: the Pro
  // checkout modal promised permanence twice ("Everything free stays
  // free" in its subheading, "Free stays free:" in its trust block)
  // until wave eight (seventh panel, Product). The scan reads the
  // app file's parsed string literals and template quasis, never a
  // raw grep, so comments and identifiers cannot hide or fake a hit.
  const appAst = parse(appSrc, { sourceType: "module", plugins: ["jsx"] });
  const literals = [];
  (function walk(node) {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "StringLiteral") literals.push(node.value);
    if (node.type === "JSXText") literals.push(node.value);
    if (node.type === "TemplateLiteral") for (const q of node.quasis) literals.push(q.value.cooked || "");
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "range") continue;
      const child = node[key];
      if (Array.isArray(child)) for (const c of child) walk(c);
      else walk(child);
    }
  })(appAst.program);
  assert.ok(literals.length > 1000, `the app literal scan went blind: only ${literals.length} literals`);
  const appCopy = literals.join("\n");
  assert.ok(!/free, forever/i.test(appCopy), "app copy still promises 'Free, forever'");
  assert.ok(!/stays free/i.test(appCopy), "app copy still says something 'stays free'");
  assert.ok(!/free stays free/i.test(appCopy), "app copy still carries the 'Free stays free' line");
  const freeBlock = blockByHeading(MARKETING_PAGES.pricing, "Free");
  assert.ok(freeBlock, "pricing page lost its Free block");
  assert.ok(JSON.stringify(freeBlock).includes("50 AI answers"),
    "the Free block no longer states what the free tier includes today");
});

t("new product copy strings contain no dash characters of any kind", () => {
  const DASHES = ["-", "–", "—"];
  const pieces = [];
  for (const h of NEW_FEATURE_HEADINGS) {
    const b = blockByHeading(MARKETING_PAGES.features, h);
    assert.ok(b, `missing block for dash check: ${h}`);
    pieces.push(JSON.stringify(b));
  }
  const freeBlock = blockByHeading(MARKETING_PAGES.pricing, "Free");
  assert.ok(freeBlock && Array.isArray(freeBlock.list), "Free list missing for dash check");
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

/* ── Watched topics copy pass (2026-10-13) ─────────────────────────
 * The watch topic flow shipped in the app (WatchTopicButton in
 * src/CerebrumApp.jsx, watch-topic actions in functions/api/data.js)
 * with zero marketing presence. These pins keep the published claims
 * tied to the shipped mechanics: the button's real name, the home
 * screen card's real name, counts from Europe PMC, the server's real
 * 40 topic cap, and no tier gate (the API actions carry no plan
 * check, so the copy names the flow with the free offer and keeps it
 * out of the Pro list, like the record and MCP above). */
const WATCH_BLOCK_HEADING = "Watch a topic and new papers surface for you";
const WATCH_FAQ_QUESTION = "Can Cerebrum tell me when new papers appear on a topic?";

t("features page presents watched topics with the real mechanics", () => {
  const block = blockByHeading(MARKETING_PAGES.features, WATCH_BLOCK_HEADING);
  assert.ok(block, "features page is missing the watched topics block");
  const blockJson = JSON.stringify(block);
  for (const text of ["Watch this topic", "Topics you're watching", "Europe PMC", "40 topics"]) {
    assert.ok(blockJson.includes(text), `watched topics copy is missing: ${text}`);
  }
  const whatYouGet = blockByHeading(MARKETING_PAGES.features, "What you get");
  assert.ok(whatYouGet, "features page lost its What you get block");
  const bullet = (whatYouGet.list || []).find((li) => li.includes("Watched topics"));
  assert.ok(bullet, "What you get lost its Watched topics bullet");
  const faq = faqByQuestion(MARKETING_PAGES.features, WATCH_FAQ_QUESTION);
  assert.ok(faq, "features FAQ lost the watched topics answer");
  assert.ok(faq.a.includes("Europe PMC"), "watched topics FAQ never names Europe PMC");
  assert.ok(faq.a.includes("40 topics"), "watched topics FAQ never states the 40 topic cap");
});

t("pricing names watched topics with the free offer, not as a Pro gate", () => {
  const freeBlock = blockByHeading(MARKETING_PAGES.pricing, "Free");
  assert.ok(freeBlock, "pricing page lost its Free block");
  const freeJson = JSON.stringify(freeBlock);
  assert.ok(/watch/i.test(freeJson), "watched topics not listed with the free offer");
  const proBlock = blockByHeading(MARKETING_PAGES.pricing, "Cerebrum Pro");
  assert.ok(proBlock, "pricing page lost its Cerebrum Pro block");
  const proJson = JSON.stringify(proBlock.list || []);
  assert.ok(!/watch/i.test(proJson), "watched topics must not be listed as a Pro feature");
});

t("watched topics copy strings contain no dash characters of any kind", () => {
  const DASHES = ["-", "–", "—"];
  const pieces = [];
  const block = blockByHeading(MARKETING_PAGES.features, WATCH_BLOCK_HEADING);
  assert.ok(block, "missing watched topics block for dash check");
  pieces.push(JSON.stringify(block));
  const faq = faqByQuestion(MARKETING_PAGES.features, WATCH_FAQ_QUESTION);
  assert.ok(faq, "missing watched topics FAQ entry for dash check");
  pieces.push(JSON.stringify(faq));
  const whatYouGet = blockByHeading(MARKETING_PAGES.features, "What you get");
  assert.ok(whatYouGet, "features page lost its What you get block for dash check");
  const bullet = (whatYouGet.list || []).find((li) => li.includes("Watched topics"));
  assert.ok(bullet, "missing Watched topics bullet for dash check");
  pieces.push(JSON.stringify(bullet));
  const freeBlock = blockByHeading(MARKETING_PAGES.pricing, "Free");
  assert.ok(freeBlock && Array.isArray(freeBlock.list), "Free list missing for dash check");
  const freeBullet = freeBlock.list.find((li) => /watch/i.test(li));
  assert.ok(freeBullet, "missing pricing free watch bullet for dash check");
  pieces.push(JSON.stringify(freeBullet));
  for (const piece of pieces) {
    for (const d of DASHES) {
      assert.ok(!piece.includes(d), `dash character ${JSON.stringify(d)} found in watch copy: ${piece.slice(0, 110)}`);
    }
  }
});

/* ── Dash guard (2026-10-13 polish pass) ───────────────────────────
 * The rule is absolute: no em or en dash in user visible copy,
 * because they read as AI generated. The product copy pins above
 * cover only the strings they added; older marketing and legal copy
 * predated the rule and shipped dashes on the prerendered routes.
 * This guard walks every string value exported by the two content
 * modules, which are the exact strings the prerender pipeline and
 * the in app InfoPage render, and fails if an em or en dash appears
 * in any of them. marketingWidgets.jsx cannot be imported by Node
 * (JSX with React imports), so its string literals are extracted
 * from source instead; template literal expressions are code, not
 * copy, and are blanked before extraction. */
const collectStrings = (value, out = []) => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out);
  return out;
};
const stringLiteralsOf = (src) => {
  const out = [];
  const blanked = src.replace(/\$\{[^}]*\}/g, " ");
  for (const m of blanked.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g)) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
};

t("no em or en dash in any marketing or legal copy string", () => {
  const strings = [
    ...collectStrings(MARKETING_PAGES),
    ...collectStrings(DEMO_QUESTIONS),
    SLOGAN,
    ...collectStrings(LEGAL_PAGES),
    ...stringLiteralsOf(widgetsSrc),
  ];
  assert.ok(strings.length > 100, `dash guard collected only ${strings.length} strings`);
  for (const s of strings) {
    assert.ok(!s.includes("—"), `em dash in copy: ${s.slice(0, 110)}`);
    assert.ok(!s.includes("–"), `en dash in copy: ${s.slice(0, 110)}`);
  }
});

/* ── Hyphen guard + copy truth pins (third rescore fix wave) ─────
 * The no dash rule covers hyphens too, not only em and en dashes:
 * hyphenated compounds in authored copy (money back, auto renewing,
 * evidence graded) read as AI generated, and the third panel rescore
 * named them on the public pages. This guard walks every authored
 * string in the two content modules and fails on a hyphen between
 * word characters. Scrubbed before checking, because they are data
 * rather than compounds: URLs, DOIs, email addresses, and ISO dates.
 * Two proper technical names keep their hyphens by exemption: NCBI
 * E-utilities (a product name) and PBKDF2-SHA256 (an algorithm name).
 * The demo sources are quoted paper titles, not authored copy, so
 * only the demo questions and answer paragraphs are walked. Widget
 * and app literals cannot be walked this way (class names, CSS
 * values, and code identifiers all carry hyphens), so the false
 * claims this wave fixed there are pinned by source text below. */
const collectCopyStrings = (value, out = []) => {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectCopyStrings(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "widget") continue; // a widget id, not copy
      collectCopyStrings(v, out);
    }
  }
  return out;
};
const HYPHEN_EXEMPT = ["E-utilities", "PBKDF2-SHA256"];
const scrubForHyphenCheck = (s) => {
  let x = s
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/10\.\d{4,}\/\S+/g, " ")
    .replace(/[\w.]+@[\w.]+/g, " ")
    .replace(/\d{4}-\d{2}-\d{2}/g, " ");
  for (const e of HYPHEN_EXEMPT) x = x.split(e).join(" ");
  return x;
};

t("no hyphenated compounds in authored marketing or legal copy", () => {
  const strings = [
    ...collectCopyStrings(MARKETING_PAGES),
    ...collectCopyStrings(LEGAL_PAGES),
    SLOGAN,
  ];
  for (const d of DEMO_QUESTIONS) {
    strings.push(d.q);
    for (const p of d.paragraphs || []) strings.push(p.text);
  }
  assert.ok(strings.length > 100, `hyphen guard collected only ${strings.length} strings`);
  for (const s of strings) {
    const x = scrubForHyphenCheck(s);
    assert.ok(!/[A-Za-z0-9]-[A-Za-z0-9]/.test(x), `hyphenated compound in copy: ${s.slice(0, 110)}`);
    assert.ok(!x.includes(" - "), `spaced hyphen in copy: ${s.slice(0, 110)}`);
  }
});

t("llms.txt carries no hyphenated compounds outside its URLs", () => {
  const x = scrubForHyphenCheck(llmsTxt);
  assert.ok(!/[A-Za-z0-9]-[A-Za-z0-9]/.test(x), "hyphenated compound in llms.txt");
  assert.ok(!x.includes(" - "), "spaced hyphen in llms.txt");
});

t("public copy sells the Search record as it actually ships", () => {
  assert.ok(featuresJson.includes("permanent page"), "features copy never gives the record its permanent page");
  assert.ok(featuresJson.includes("?format=json"), "features copy never mentions the record JSON form");
  const mcpBlock = blockByHeading(MARKETING_PAGES.features, "Use Cerebrum inside ChatGPT and Claude");
  assert.ok(mcpBlock, "features page lost its MCP block");
  assert.ok(JSON.stringify(mcpBlock).includes("Search record"), "MCP block never mentions the Search record carriage");
  assert.ok(llmsTxt.includes("?format=json"), "llms.txt never mentions the record JSON form");
});

t("Wick is present on the public pages, described honestly", () => {
  // Rename pin (2026-10-14): the owner ordered the learning product
  // renamed from Cortex to Wick, so public copy names Wick now.
  const aboutJson = JSON.stringify(LEGAL_PAGES.about);
  assert.ok(featuresJson.includes("Wick"), "features copy never mentions Wick");
  assert.ok(pricingJson.includes("Wick"), "pricing copy never mentions Wick");
  assert.ok(aboutJson.includes("Wick"), "about copy never mentions Wick");
  assert.ok(featuresJson.includes("no cloud copy"), "features Wick copy must deny cloud storage plainly");
  assert.ok(aboutJson.includes("not synced to an account"), "about Wick copy must deny account sync plainly");
  assert.ok(llmsTxt.includes("Wick"), "llms.txt never mentions Wick");
});

t("account claims match the code: documents need an account, search does not", () => {
  const allCopy = JSON.stringify(MARKETING_PAGES) + JSON.stringify(LEGAL_PAGES) + llmsTxt;
  assert.ok(!allCopy.includes("works fully"), "a surface still claims guest mode works fully without an account");
  const docFaq = faqByQuestion(MARKETING_PAGES["document-mode"], "Does Document Mode work without an account?");
  assert.ok(docFaq, "document mode FAQ lost the account question");
  assert.ok(docFaq.a.startsWith("No."), "document mode FAQ must answer no: the document endpoint returns sign in required");
  assert.ok(!appSrc.includes("No account needed."), "an in app plan card still bundles the free tier under no account needed");
  assert.ok(!widgetsSrc.includes("no account needed"), "a marketing widget still claims no account needed");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
