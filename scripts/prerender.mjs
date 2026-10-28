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
/* Marketing pages (/features, /pricing, /document-mode, /diagram-studio,
   /investigations) share the same data shape as PAGES, so the same render
   pipeline produces their documents. */
const { MARKETING_PAGES, DEMO_QUESTIONS, demoForPage } = await import(join(root, "src/marketingContent.js"));
const ALL_PAGES = { ...PAGES, ...MARKETING_PAGES };
const { demoteNoscriptH1 } = await import("./prerender-lib.mjs");

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
  const title = `${data.title} · Cerebrum`;
  const description = String(data.lede || "").slice(0, 300);
  const canonical = `${ORIGIN}/${slug}`;
  const body = (data.blocks || []).map(renderBlock).join("\n");

  /* FAQ section. data.faq is the same array the in-app InfoPage renders,
   * so the static document and the app cannot drift. Questions become h3s
   * under one h2, and the whole set is also emitted as FAQPage structured
   * data, the format search engines and AI answer products lift most. */
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

  /* SoftwareApplication structured data. Marketing pages carry
   * softwareApp: true (see src/marketingContent.js); the pricing page also
   * carries its real offers so search engines see the actual $20/mo and
   * $144/yr plans instead of a generic "free app". */
  const softwareJsonLd = data.softwareApp
    ? `\n    <script type="application/ld+json">\n    ${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "Cerebrum",
        "applicationCategory": data.applicationCategory || "EducationalApplication",
        "operatingSystem": data.operatingSystem || "Web",
        "url": `${ORIGIN}/`,
        "description": String(data.lede || "").slice(0, 300),
        "offers": Array.isArray(data.offers) && data.offers.length
          ? data.offers.map((o) => ({ "@type": "Offer", ...o }))
          : { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      })}\n    </script>`
    : "";

  /* One-question live demo, static edition. /about and /features get
   * their own cached sample answers (demoForPage, 2026-10-26: the two
   * pages no longer repeat the same answers verbatim), as plain
   * HTML with real citation links, so crawlers and readers without
   * JavaScript see the product proof too. */
  const demoHtml = (slug === "about" || slug === "features") && Array.isArray(DEMO_QUESTIONS) && DEMO_QUESTIONS.length
    ? `<hr style="border:0;border-top:1px solid #e0ddd8;margin:2.5rem 0 1.5rem" />\n` +
      `<div>\n<h2>See what an answer looks like</h2>\n` +
      demoForPage(slug).map((d) =>
        `<h3 style="font-size:1.05rem;margin:1.4rem 0 .4rem">${esc(d.q)}</h3>\n` +
        d.paragraphs.map((para) =>
          `<p>${esc(para.text)}${(para.cites || []).map((n) => ` [${n}]`).join("")}</p>`
        ).join("\n") + `\n` +
        `<ol style="font-size:.9rem;color:#555">` +
        d.sources.map((s) =>
          `<li><a href="${esc(s.url)}" style="color:#555">${esc(s.title)}</a> ${esc(s.venue)}, ${esc(s.year)}</li>`
        ).join("") + `</ol>`
      ).join("\n") + `\n<p style="font-size:.9rem;color:#6b6b6b">A cached sample, not a live search. Every citation above is a real paper you can open.</p>\n</div>`
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
    <meta property="og:image" content="${ORIGIN}/og-image.png?v=20261015b" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Cerebrum · scientific literature search, with Nova the axolotl mascot" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${ORIGIN}/og-image.png?v=20261015b" />
    <meta name="robots" content="index, follow" />${faqJsonLd}${softwareJsonLd}`;

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
      ${demoHtml}
      ${faqHtml}
      <hr style="border:0;border-top:1px solid #e0ddd8;margin:2.5rem 0 1.5rem" />
      <p style="font:400 13px/1.6 system-ui,sans-serif;color:#6b6b6b">
        <a href="/about" style="color:#6b6b6b">About</a> &middot;
        <a href="/features" style="color:#6b6b6b">Features</a> &middot;
        <a href="/pricing" style="color:#6b6b6b">Pricing</a> &middot;
        <a href="/document-mode" style="color:#6b6b6b">Document Mode</a> &middot;
        <a href="/diagram-studio" style="color:#6b6b6b">Diagram Studio</a> &middot;
        <a href="/investigations" style="color:#6b6b6b">Investigations</a> &middot;
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
  html = html.replace(/<div id="root">[\s\S]*?<\/style><\/div>/, `<div id="root">${noscriptDoc}</div>`);
  if (!html.includes("cb-prerender")) {
    html = html.replace('<div id="root"></div>', `<div id="root">${noscriptDoc}</div>`);
  }
  // 2026-10-26 (AI feel purge): the shell's <noscript> fallback used to
  // ride along at the foot of every prerendered page, the same five
  // paragraph boilerplate repeated next to each page's own document.
  // The <main> above serves crawlers and no-JS readers on its own, so
  // the shell fallback is stripped from slug pages. demoteNoscriptH1
  // only existed to keep that fallback from adding a second <h1>; with
  // the fallback gone there is nothing left to demote.
  html = html.replace(/<noscript>[\s\S]*?<\/noscript>/, "");

  return html;
}

const shell = await readFile(join(dist, "index.html"), "utf8");
const slugs = Object.keys(ALL_PAGES);
let written = 0;

for (const slug of slugs) {
  const data = ALL_PAGES[slug];
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

/* 2026-10-26 (AI feel purge): the root door route. It used to serve the
 * bare app shell, about 14 KB with none of the door copy in the
 * document, so anything reading the served page without running the app
 * found an empty room. The door's real content now ships in the
 * document, copied verbatim from src/intro.jsx: the door headline, the
 * Start researching entry, and its SPECIMENS with the papers they
 * trace to. React replaces the root's contents on mount, so the
 * rendered door, its arrangement, and its film are unchanged. The
 * shell's <noscript> fallback is stripped here too, for the same
 * reason as on the slug pages: the door document now stands on its own
 * and the boilerplate would only duplicate it.
 * 2026-10-28: the contents were cut to the app door's own set and the
 * layer repainted dark; see the doorMain note below. */
/* 2026-10-28 (round 4 cut): the static layer carries ONE specimen
 * card, the claim the app door opens on (SPECIMENS[0] in
 * src/intro.jsx), with its citation shortened to author, journal,
 * year. The claim wording matches the app verbatim, including the
 * 2026-10-28 wording fix there: the paper's conclusion is deficits
 * equivalent to UP TO two nights of total sleep deprivation, and
 * "can impair" carries that qualifier in plain words. */
const DOOR_SPECIMEN = {
  claim: "Two weeks of six-hour nights can impair your thinking as much as two nights with no sleep at all.",
  cite: "H. P. A. Van Dongen et al., Sleep, 2003.",
  doi: "https://doi.org/10.1093/sleep/26.2.117",
};
/* 2026-10-28 (door fallback fix, with the round 4 cut): this static
 * layer is also what a visitor stares at when the app stalls or
 * fails before mount, and on the owner's phone it read as a broken
 * white page: light ground, the headline, a long paragraph naming
 * all 14 databases, six specimen claims, a free terms paragraph,
 * and Start researching as a plain link. Its contents now match the
 * app door itself: wordmark, headline, one short line (the honest
 * count, no database roll call; the full source list lives on About
 * and Features), the way in, Nova's line word for word, and one
 * specimen with the proof line under it. The visible
 * text fell from 337 words to 101. The layer is painted as
 * the door's face, with the shipped door's own values from
 * src/intro.jsx: ground #05070a, ink #eef1ee, secondary text at
 * 0.72 alpha, faintest at 0.58, hairlines at 0.10 white, and
 * Start researching as the door's button (sage #8ba888 fill,
 * #0f172a ink, radius 10, padding 14px 44px, min height 48).
 * 2026-10-28 (the reimagined door): the static specimen drops
 * its card to match the new face; it stands as three lines over
 * a hairline, the static echo of the app's caption strip.
 * React still replaces this on mount, so the rendered door is
 * unchanged. */
const doorMain = `
    <main class="cb-prerender" style="min-height:100dvh;background:#05070a;color:#eef1ee;font:16px/1.7 'Inter Tight','Inter',system-ui,-apple-system,'Segoe UI',sans-serif">
      <div style="max-width:44rem;margin:0 auto;padding:3rem 1.25rem">
      <nav style="margin-bottom:2.5rem;font:600 14px/1.5 system-ui,sans-serif">
        <a href="/" style="color:#eef1ee;text-decoration:none">Cerebrum</a>
      </nav>
      <h1 style="font-family:'Source Serif 4',Charter,Georgia,'Times New Roman',serif;font-weight:400;font-size:2rem;line-height:1.2;margin:0 0 1rem">Ask a question and get an answer from the research papers, with the sources attached.</h1>
      <p style="font-size:1.05rem;color:rgba(238,241,238,0.72)">Cerebrum searches 14 open scholarly databases and answers from the papers it finds. Every claim links to a paper you can open, and when nothing is found, it says so plainly.</p>
      <p><a href="/" style="display:inline-block;box-sizing:border-box;background:#8ba888;color:#0f172a;border:1px solid transparent;border-radius:10px;padding:14px 44px;min-height:48px;font:500 16px/1.25 'Inter Tight','Inter',system-ui,sans-serif;text-decoration:none">Start researching</a></p>
      <p style="font-family:'Source Serif 4',Charter,Georgia,'Times New Roman',serif;font-size:1rem;color:rgba(238,241,238,0.72);margin:2.5rem 0 1rem">Good specimens, these. The lab is open when you are ready.</p>
      <div style="border-top:1px solid rgba(255,255,255,0.10);padding-top:1.25rem">
        <p style="font-family:'Source Serif 4',Charter,Georgia,'Times New Roman',serif;font-size:1.1rem;line-height:1.55;margin:0">&ldquo;${DOOR_SPECIMEN.claim}&rdquo;</p>
        <p style="font-size:.9rem;color:rgba(238,241,238,0.72);margin:.6rem 0 0">${DOOR_SPECIMEN.cite} <a href="${DOOR_SPECIMEN.doi}" style="color:#8ba888">Open the paper</a></p>
        <p style="font-size:.8rem;color:rgba(238,241,238,0.58);margin:.9rem 0 0"><span style="display:inline-block;width:7px;height:7px;background:#8ba888;margin-right:8px"></span>Traced to a real paper &middot; Searched across 14 scholarly indexes</p>
      </div>
      </div>
    </main>`;

let doorHtml = shell;
doorHtml = doorHtml.replace(/<div id="root">[\s\S]*?<\/style><\/div>/, `<div id="root">${doorMain}</div>`);
if (!doorHtml.includes("cb-prerender")) {
  doorHtml = doorHtml.replace('<div id="root"></div>', `<div id="root">${doorMain}</div>`);
}
if (!doorHtml.includes("cb-prerender")) {
  throw new Error("prerender: failed to inject door content for /");
}
doorHtml = doorHtml.replace(/<noscript>[\s\S]*?<\/noscript>/, "");
/* 2026-10-28 (round 4): the door route presents dark browser chrome
 * in both OS schemes. The shell's light scheme theme color is
 * #fafaf9, which flashed pale around the dark door on a phone in
 * light OS mode; only the door document rewrites it, to the door
 * ground. The slug pages keep the shell's pair: their documents
 * are light. */
doorHtml = doorHtml.replace(
  'content="#fafaf9" media="(prefers-color-scheme: light)"',
  'content="#05070a" media="(prefers-color-scheme: light)"'
);
await writeFile(join(dist, "index.html"), doorHtml, "utf8");

console.log(`prerender: wrote ${written} static document${written === 1 ? "" : "s"} plus the door document`);
