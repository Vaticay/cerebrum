/**
 * 404-route tests.
 *
 * Unknown paths that reach the SPA shell must render the NotFound view
 * (correct <title>, plain wording, links to the pages that do exist) rather
 * than the search UI. The shell's route dispatch (src/main.jsx Root) is
 * driven by the pure classifier in src/routeClassify.js, which this suite
 * pins directly; a wiring check confirms main.jsx actually dispatches
 * through it, and source checks confirm the NotFound view's title and
 * wayfinding links.
 *
 * Run with: node tests/seo-404.mjs
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyRoute, INFO_SLUGS } from "../src/routeClassify.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mainJsx = readFileSync(join(root, "src/main.jsx"), "utf8");

let passed = 0;
function t(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// --- classification: the app itself ----------------------------------------
t('"/" is the application', () => {
  assert.equal(classifyRoute("/").kind, "app");
});
t('empty path is the application', () => {
  assert.equal(classifyRoute("").kind, "app");
});
t('"/index.html" is the application', () => {
  assert.equal(classifyRoute("/index.html").kind, "app");
});

// --- classification: prerendered info pages --------------------------------
for (const slug of INFO_SLUGS) {
  t(`"/${slug}" is an info page`, () => {
    const r = classifyRoute(`/${slug}`);
    assert.equal(r.kind, "info");
    assert.equal(r.slug, slug);
  });
}
t('"/about.html" folds to the info page', () => {
  assert.equal(classifyRoute("/about.html").kind, "info");
});
t('trailing slash folds away', () => {
  assert.equal(classifyRoute("/privacy/").kind, "info");
});

// --- classification: everything else is a 404 ------------------------------
for (const p of ["/nope", "/some-made-up-page-xyz", "/search/crystals", "/api-fake", "/About", "/ABOUT"]) {
  t(`"${p}" is a 404`, () => {
    assert.equal(classifyRoute(p).kind, "notfound");
  });
}

// --- wiring: the shell dispatches through the classifier --------------------
t("main.jsx imports classifyRoute", () => {
  assert.ok(mainJsx.includes('from "./routeClassify.js"'), "must import the classifier");
});
t("Root renders NotFound for the notfound kind", () => {
  assert.ok(/<NotFound\s*\/>/.test(mainJsx), "Root must render <NotFound />");
  assert.ok(mainJsx.includes("classifyRoute("), "Root must call classifyRoute");
});

// --- the NotFound view itself -----------------------------------------------
t('NotFound sets the "Page not found — Cerebrum" title', () => {
  assert.ok(
    mainJsx.includes('document.title = "Page not found — Cerebrum"'),
    "NotFound must set the 404 title"
  );
});
t("NotFound links back to search, about, and contact", () => {
  for (const href of ['href="/"', 'href="/about"', 'href="/contact"']) {
    assert.ok(mainJsx.includes(href), `NotFound should link ${href}`);
  }
});

console.log(`\nseo-404: ${passed} assertions passed`);
