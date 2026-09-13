/**
 * Build-time prerender for the informational and legal routes.
 *
 * THE PROBLEM THIS SOLVES
 * /privacy, /terms, /about, /contact and /disclosures were listed in
 * sitemap.xml and served by a single catch-all SPA rewrite. Fetching any of
 * them returned the homepage shell: the homepage's <title>, the homepage's
 * description, and a canonical tag pointing at "/". So the sitemap asked
 * search engines to index five URLs that each declared themselves to be a
 * copy of the root, and the actual policy text existed only after React had
 * run. security.txt pointed its Policy: field at /terms, which a researcher
 * fetching with curl would find empty.
 *
 * Each route now gets a real HTML document with its own title, description
 * and canonical URL, containing the full text. The document also boots the
 * SPA, so a visitor with JavaScript gets the normal application and a visitor
 * without one still gets the policy. Same source object either way, so the
 * two cannot disagree.
 *
 * Run automatically after `vite build` — see package.json.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");

const { PAGES } = await import(join(root, "src/legalContent.js"));

const ORIGIN = "https://askcerebrum.org";

/** Minimal HTML escaping for text placed into an element or attribute. */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render one content block to semantic HTML. */
function renderBlock(b) {
  const out = [];
  if (b.h) out.push(`<h2>${esc(b.h)}</h2>`);
  if (b.p) out.push(`<p>${esc(b.p)}</p>`);
  if (b.email) out.push(`<p><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></p>`);
  if (Array.isArray(b.list) && b.list.length) {
    out.push("<ul>" + b.list.map((li) => `<li>${esc(li)}</li>`).join("") + "</ul>");
  }
  return out.join("\n");
}

/**
 * A self-contained document. The styling is deliberately plain and inline:
 * this file is what a crawler and a JS-less reader see, it must be legible on
 * its own, and it must not depend on the application's stylesheet loading.
 */
function renderPage(slug, data, shell) {
  const title = `${data.title} — Cerebrum`;
  const description = String(data.lede || "").slice(0, 300);
  const canonical = `${ORIGIN}/${slug}`;
  const body = (data.blocks || []).map(renderBlock).join("\n");

  /* FAQ section. data.faq is the same array the in-app InfoPage renders,
   * so the static document and the app cannot drift. Questions become h3s
   * under one h2, and the whole set is also emitted as FAQPage structured
   * data — the format search engines and AI answer products lift most. */
  const faqHtml = Array.isArray(data.faq) && data.faq.length
    ? `<hr style="border:0;border-top:1px solid #e0ddd8;margin:2.5rem 0 1.5rem" />\n` +
      `<div id="frequently-asked-questions">\n<h2>Frequently asked questions</h2>\n` +
      data.faq.map((item) =>
        `<h3 style="font-size:1.05rem;margin:1.4rem 0 .4rem">${esc(item.q)}</h3>\n<p>${esc(item.a)}</p>`
      ).join("\n") + `\n</div>`
    : "";
  const faqJsonLd = Array.isArray(data.faq) && data.faq.length
    ? `\n    <script type="application/ld+json">\n    ${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": data.faq.map((item) => ({
          "@type": "Question",
          "name": item.q,
          "acceptedAnswer": { "@type": "Answer", "text": item.a },
        })),
      })}\n    </script>`
    : "";

  const head = `
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${esc(canonical)}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Cerebrum" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${esc(canonical)}" />
    <meta property="og:image" content="${ORIGIN}/og-image.png?v=20260912" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Cerebrum — scientific literature search" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${ORIGIN}/og-image.png?v=20260912" />
    <meta name="robots" content="index, follow" />${faqJsonLd}`;

  /* The prerendered content sits inside the SPA's mount point. React replaces
   * it on hydration, so a normal visitor sees the application and never this
   * markup; a crawler or a reader without JavaScript sees the document. */
  const noscriptDoc = `
    <main class="cb-prerender" style="max-width:44rem;margin:0 auto;padding:3rem 1.25rem;font:16px/1.7 Georgia,'Times New Roman',serif;color:#1a1a1a;background:#fafaf9">
      <nav style="margin-bottom:2.5rem;font:600 14px/1.5 system-ui,sans-serif">
        <a href="/" style="color:#1a1a1a;text-decoration:none">&#8592; Cerebrum</a>
      </nav>
      <p style="font:600 12px/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#6b6b6b;margin:0 0 .5rem">${esc(data.eyebrow || "")}</p>
      <h1 style="font-size:2rem;line-height:1.2;margin:0 0 1rem">${esc(data.title)}</h1>
      <p style="font-size:1.05rem;color:#444">${esc(data.lede || "")}</p>
      ${data.updated ? `<p style="font:500 13px/1.5 system-ui,sans-serif;color:#6b6b6b">${esc(data.updated)}</p>` : ""}
      <hr style="border:0;border-top:1px solid #e0ddd8;margin:2rem 0" />
      ${body}
      ${faqHtml}
      <hr style="border:0;border-top:1px solid #e0ddd8;margin:2.5rem 0 1.5rem" />
      <p style="font:400 13px/1.6 system-ui,sans-serif;color:#6b6b6b">
        <a href="/about" style="color:#6b6b6b">About</a> &middot;
        <a href="/privacy" style="color:#6b6b6b">Privacy</a> &middot;
        <a href="/terms" style="color:#6b6b6b">Terms</a> &middot;
        <a href="/disclosures" style="color:#6b6b6b">Disclosures</a> &middot;
        <a href="/contact" style="color:#6b6b6b">Contact</a>
      </p>
    </main>`;

  let html = shell;

  // Swap the homepage's head metadata for this page's.
  html = html.replace(/<title>[\s\S]*?<\/title>/, "");
  html = html.replace(/<meta name="description"[^>]*>/, "");
  html = html.replace(/<link rel="canonical"[^>]*>/, "");
  html = html.replace(/<meta property="og:title"[^>]*>/, "");
  html = html.replace(/<meta property="og:description"[^>]*>/, "");
  html = html.replace(/<meta property="og:url"[^>]*>/, "");
  html = html.replace(/<meta property="og:image[^>]*>/g, "");
  html = html.replace(/<meta name="twitter:[^>]*>/g, "");
  html = html.replace("</head>", `${head}\n  </head>`);

  // Put the document inside the React root.
  html = html.replace(/<div id="root">[\s\S]*?<\/div>/, `<div id="root">${noscriptDoc}</div>`);
  if (!html.includes("cb-prerender")) {
    html = html.replace('<div id="root"></div>', `<div id="root">${noscriptDoc}</div>`);
  }
  return html;
}

const shell = await readFile(join(dist, "index.html"), "utf8");
const slugs = ["about", "privacy", "terms", "disclosures", "contact"];
let written = 0;

for (const slug of slugs) {
  const data = PAGES[slug];
  if (!data) {
    console.error(`prerender: no content for /${slug} — skipping`);
    continue;
  }
  const html = renderPage(slug, data, shell);
  if (!html.includes("cb-prerender")) {
    // Fail loudly rather than shipping a page that silently fell back to the
    // homepage shell — that is the exact bug this script exists to fix.
    throw new Error(`prerender: failed to inject content for /${slug}`);
  }
  /* Written as /slug.html, not /slug/index.html. Both are served by
   * Cloudflare Pages at /slug, but the directory form answers with a 308 to
   * /slug/ first — an extra hop for every crawler and every link. The flat
   * file answers 200 directly at the canonical URL. */
  await writeFile(join(dist, `${slug}.html`), html, "utf8");
  written++;
}

console.log(`prerender: wrote ${written} static document${written === 1 ? "" : "s"}`);
