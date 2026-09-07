/**
 * Build-consistency checks.
 *
 * These exist because the repository has repeatedly shipped two different
 * answers to the same factual question: the scholarly-database count was 14 in
 * index.html and 16 in the README; the sitemap listed five URLs that all
 * canonicalised to "/"; `_headers` sat at the repo root where the build never
 * copied it, so every security header was written and never served.
 *
 * Each of those is a class of bug that no test would catch and no reviewer
 * would notice, because the two halves live in different files. So they are
 * checked mechanically, and the build fails rather than quietly disagreeing
 * with itself.
 *
 * Run via `npm run check` and as part of `npm run build`.
 */

import { readFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

const failures = [];
const notes = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

// ── 1. Security headers are actually in the build output ──────────────────
check(await exists(join(dist, "_headers")),
  "_headers is missing from dist/. It must live in public/, not the repo root — Vite only copies public/. Every security header is unserved without it.");

if (await exists(join(dist, "_headers"))) {
  const raw = await readFile(join(dist, "_headers"), "utf8");
  // Strip comment lines before matching. The file explains WHY it does not
  // use 'unsafe-eval', and a naive search finds that sentence and reports the
  // documentation as the vulnerability.
  const headers = raw.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  check(/Content-Security-Policy:/.test(headers), "dist/_headers has no Content-Security-Policy.");
  check(/Strict-Transport-Security:/.test(headers), "dist/_headers has no Strict-Transport-Security.");
  check(!/'unsafe-eval'/.test(headers), "CSP contains 'unsafe-eval'.");
  check(!/script-src[^;]*'unsafe-inline'/.test(headers), "CSP allows inline scripts.");
  check(/worker-src/.test(headers), "CSP has no worker-src; the pdf.js worker will be blocked by default-src.");
}

// ── 2. Every legal route is a real document ───────────────────────────────
const { PAGES } = await import(join(root, "src/legalContent.js"));
const slugs = Object.keys(PAGES);

for (const slug of slugs) {
  const file = join(dist, `${slug}.html`);
  if (!(await exists(file))) {
    failures.push(`dist/${slug}.html is missing — /${slug} would fall through to the SPA shell.`);
    continue;
  }
  const html = await readFile(file, "utf8");
  check(html.includes(`href="https://askcerebrum.org/${slug}"`),
    `dist/${slug}.html has the wrong canonical URL.`);
  check(html.includes("cb-prerender"),
    `dist/${slug}.html contains no prerendered content.`);
  check(!/<title>Cerebrum — Free Scientific Literature Search<\/title>/.test(html),
    `dist/${slug}.html still carries the homepage title.`);
}

// ── 3. The sitemap and the content agree ──────────────────────────────────
const sitemap = await readFile(join(root, "public/sitemap.xml"), "utf8");
const sitemapPaths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => new URL(m[1]).pathname.replace(/^\/|\/$/g, ""))
  .filter(Boolean);

for (const slug of slugs) {
  check(sitemapPaths.includes(slug), `/${slug} exists but is not in sitemap.xml.`);
}
for (const p of sitemapPaths) {
  check(slugs.includes(p), `sitemap.xml lists /${p}, which has no content and will 404 or fall through.`);
}

// ── 4. One answer to the database count ───────────────────────────────────
const { SOURCE_COUNT } = await import(join(root, "functions/lib/product.js"));
const indexHtml = await readFile(join(root, "index.html"), "utf8");
const readme = await readFile(join(root, "README.md"), "utf8");

const claimed = new Set();
for (const text of [indexHtml, readme]) {
  for (const m of text.matchAll(/(\d+)\s+open scholarly databases/g)) claimed.add(Number(m[1]));
  for (const m of text.matchAll(/(\d+)\s+(?:public )?research databases/g)) claimed.add(Number(m[1]));
}
for (const n of claimed) {
  check(n === SOURCE_COUNT,
    `Copy claims ${n} scholarly databases but SCHOLARLY_SOURCES defines ${SOURCE_COUNT}. Derive the number, do not type it.`);
}
if (claimed.size === 0) notes.push("No database-count claim found in copy (nothing to verify).");

// ── 5. No third-party assets we said we self-host ─────────────────────────
if (await exists(join(dist, "index.html"))) {
  const shell = await readFile(join(dist, "index.html"), "utf8");
  const body = shell.replace(/<!--[\s\S]*?-->/g, ""); // ignore comments
  check(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(body),
    "dist/index.html still references Google Fonts. Fonts are meant to be self-hosted in /fonts.");
  check(!/cdn\.jsdelivr\.net/.test(body),
    "dist/index.html still references jsDelivr.");
  check(!/\son[a-z]+\s*=\s*["']/.test(body),
    "dist/index.html contains an inline event handler, which the CSP forbids.");
}

// ── 6. Every component used in JSX actually exists ───────────────────────
/* This exists because of a real incident. Deleting two superseded WebGL
 * renderers took an unrelated component out with them, the production build
 * succeeded, and the failure only appeared at runtime as "Intro is not
 * defined" on a blank page. Vite does not resolve JSX identifiers, so a
 * missing component is invisible to the build.
 *
 * The parse is deliberately crude — regex over the source, not an AST — but
 * it catches the case that matters: a capitalised tag with no function,
 * const, class or import behind it anywhere in the file. */
for (const file of ["src/CerebrumApp.jsx", "src/main.jsx"]) {
  if (!(await exists(join(root, file)))) continue;
  const src = await readFile(join(root, file), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  const defined = new Set([
    // React's own, plus anything the runtime provides.
    "React", "Fragment", "StrictMode", "Suspense",
  ]);
  for (const m of code.matchAll(/(?:function|class)\s+([A-Z]\w*)/g)) defined.add(m[1]);
  for (const m of code.matchAll(/(?:const|let|var)\s+([A-Z]\w*)\s*=/g)) defined.add(m[1]);
  for (const m of code.matchAll(/import\s+\{([^}]+)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.split(/\s+as\s+/).pop().trim();
      if (name) defined.add(name);
    }
  }
  for (const m of code.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) defined.add(m[1]);

  const used = new Set();
  for (const m of code.matchAll(/<([A-Z][\w.]*)/g)) used.add(m[1].split(".")[0]);

  const missing = [...used].filter((n) => !defined.has(n));
  for (const n of missing) {
    failures.push(`${file}: <${n}> is used in JSX but never defined or imported. The build will succeed and the page will fail at runtime.`);
  }
}

// ── Report ────────────────────────────────────────────────────────────────
for (const n of notes) console.log(`note: ${n}`);
if (failures.length) {
  console.error(`\ncheck: ${failures.length} problem${failures.length === 1 ? "" : "s"}\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`check: passed (${slugs.length} routes, ${SOURCE_COUNT} sources, headers present)`);
