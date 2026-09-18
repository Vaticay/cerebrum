/**
 * Canonical-host middleware tests (functions/_middleware.js).
 *
 * The duplicate-host bug: cerebrum-2pz.pages.dev serves the full site with
 * no redirect and no noindex, splitting ranking signals with
 * askcerebrum.org. The middleware must 301 every non-canonical hostname to
 * the canonical one (preserving path + query), never redirect the canonical
 * host or local dev hosts, and never loop.
 *
 * Run with: node tests/seo-host-redirect.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { onRequest } = await import(join(root, "functions/_middleware.js"));

let passed = 0;
let failed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}: ${e.message}`); }
};

function ctx(url) {
  let nextCalled = false;
  return {
    context: {
      request: new Request(url),
      async next() { nextCalled = true; return new Response("passthrough"); },
    },
    wasNextCalled: () => nextCalled,
  };
}

await t("pages.dev host 301s to canonical, preserving path + query", async () => {
  const { context, wasNextCalled } = ctx("https://cerebrum-2pz.pages.dev/about?x=1");
  const res = await onRequest(context);
  assert.equal(wasNextCalled(), false);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://askcerebrum.org/about?x=1");
});

await t("unknown non-canonical host redirects too", async () => {
  const { context } = ctx("http://evil.example/deep/path");
  const res = await onRequest(context);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "https://askcerebrum.org/deep/path");
});

await t("canonical host passes through untouched", async () => {
  const { context, wasNextCalled } = ctx("https://askcerebrum.org/api/search");
  const res = await onRequest(context);
  assert.equal(wasNextCalled(), true);
  assert.equal(await res.text(), "passthrough");
});

await t("localhost and 127.0.0.1 pass through (wrangler pages dev)", async () => {
  for (const url of ["http://localhost:8788/api/search", "http://127.0.0.1:8788/about"]) {
    const { context, wasNextCalled } = ctx(url);
    await onRequest(context);
    assert.equal(wasNextCalled(), true, `${url} was redirected`);
  }
});

await t("hostname comparison is case-insensitive", async () => {
  const { context, wasNextCalled } = ctx("https://ASKCEREBRUM.ORG/");
  await onRequest(context);
  assert.equal(wasNextCalled(), true, "uppercase canonical host was redirected");
});

await t("redirect cannot loop: target is always the canonical host", async () => {
  const { context } = ctx("https://cerebrum-2pz.pages.dev/");
  const res = await onRequest(context);
  const loc = new URL(res.headers.get("location"));
  assert.equal(loc.hostname, "askcerebrum.org");
});

await t("root path redirects cleanly", async () => {
  const { context } = ctx("https://cerebrum-2pz.pages.dev/");
  const res = await onRequest(context);
  assert.equal(res.headers.get("location"), "https://askcerebrum.org/");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
