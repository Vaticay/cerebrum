/**
 * Crawlable marketing pages: /features, /pricing, /document-mode,
 * /diagram-studio, /investigations.
 *
 * Same data shape as src/legalContent.js PAGES so scripts/prerender.mjs can
 * render them with the same pipeline (title, meta description, OG/Twitter,
 * canonical, one H1, FAQ + SoftwareApplication JSON-LD). The SPA's InfoPage
 * renders from this same object once the frontend worker wires it in, so the
 * static document and the app cannot drift.
 *
 * Constraints honored here:
 * - Rendered <title> is `${title} — Cerebrum`, which must stay within
 *   50–60 chars, so each title below is 38–48 chars (tests/seo-marketing.mjs
 *   enforces this).
 * - The lede becomes the meta description and must be 140–160 chars
 *   (also enforced by the test).
 * - Database counts must say "15 open scholarly databases" — the sanctioned
 *   number (functions/lib/product.js SOURCE_COUNT; see scripts/check.mjs).
 * - The slogan below is Dusty's, word for word. Never reword it; only the
 *   labeling/styling around it may change.
 */
export const SLOGAN = "Ask a real research question. Every claim traces to a paper you can open.";

const SOFTWARE_APP_BASE = {
  softwareApp: true,
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web",
};

export const MARKETING_PAGES = {
  features: {
    ...SOFTWARE_APP_BASE,
    eyebrow: "Features",
    title: "Search, read, and map the scientific literature",
    lede: "Cerebrum searches 15 open scholarly databases in parallel and answers with citations you can open and check. Free to use, no account required.",
    updated: "Updated September 2026.",
    blocks: [
      {
        h: "The promise",
        p: SLOGAN + " You ask in plain language; Cerebrum queries Europe PMC, PubMed, OpenAlex, Semantic Scholar, Crossref, arXiv, bioRxiv, DOAJ, PLOS, Zenodo, CORE, BASE, PMC full-text, OpenAIRE and more in parallel, scores the results for genuine relevance, and writes a summary constrained by what those papers actually say.",
      },
      {
        h: "What you get",
        list: [
          "Evidence-graded answers: every claim links to a real paper you can open, with a confidence note on how strongly the literature supports it.",
          "Document Mode: paste or upload a long paper and get a structured, section-by-section summary with live progress.",
          "Diagram Studio: turn a pathway, method, or mechanism into an editable Mermaid diagram with SVG, PNG, and .mmd export.",
          "Investigations and Library: save papers, questions, and threads into collections you can revisit.",
          "Private Vault: optional end-to-end encrypted sync for your saved work, with a 24-word recovery phrase only you hold.",
        ],
      },
      {
        h: "What it refuses to do",
        p: "If no papers are retrieved for a question, Cerebrum says so plainly rather than inventing sources. A confident guess dressed up as science is worse than an honest \u201cnothing found.\u201d",
      },
    ],
    faq: [
      {
        q: "Is Cerebrum free?",
        a: "Yes. The free tier includes 15 AI answers, 3 document reads, and 1 flowchart every 5 days, with no account required. Cerebrum Pro ($20/month or $144/year) removes the limits.",
      },
      {
        q: "Where do the answers come from?",
        a: "From 15 open scholarly databases — including PubMed, Europe PMC, OpenAlex, Semantic Scholar, Crossref, arXiv, and bioRxiv — searched in parallel. Every claim in an answer links to a real paper you can open.",
      },
      {
        q: "Do I need an account?",
        a: "No. An account is optional and only syncs what you explicitly save: articles, collections, history, and your Pro status.",
      },
    ],
  },

  pricing: {
    ...SOFTWARE_APP_BASE,
    eyebrow: "Pricing",
    title: "Cerebrum Pro pricing: plans for every researcher",
    lede: "Cerebrum is free for everyday research. Cerebrum Pro is $20 a month or $144 a year: unlimited answers and funding for independent, ad-free science search.",
    updated: "Updated September 2026.",
    offers: [
      { name: "Cerebrum Pro, monthly", price: "20", priceCurrency: "USD", billingIncrement: "P1M" },
      { name: "Cerebrum Pro, annual", price: "144", priceCurrency: "USD", billingIncrement: "P1Y" },
    ],
    blocks: [
      {
        h: "Free, forever",
        p: "15 AI answers, 3 document reads, and 1 flowchart every 5 days. No account required, no ads, no tracking pixels, no sale of personal information.",
      },
      {
        h: "Cerebrum Pro",
        list: [
          "$20 per month or $144 per year, auto-renewing until you cancel.",
          "Unlimited AI answers, document reads, and flowcharts.",
          "The Pro badge, the exclusive Pro theme, and the members' cinematic reels.",
          "Cancel anytime from the billing portal. 7-day money-back guarantee on the first charge of a new subscription — email dusty@askcerebrum.org within 7 days for a full refund, no questions asked.",
        ],
      },
      {
        h: "Why Pro exists",
        p: "Cerebrum is an independent project, not an advertising business. Pro subscriptions pay for the search infrastructure directly, so the product never needs to monetize your attention.",
      },
    ],
    faq: [
      {
        q: "How much is Cerebrum Pro?",
        a: "$20 per month or $144 per year, auto-renewing until you cancel. Prices are shown in USD at checkout.",
      },
      {
        q: "Can I cancel?",
        a: "Yes, anytime from the billing portal. There are no partial-period refunds outside the money-back window, but you keep Pro until the end of the paid period.",
      },
      {
        q: "Is there a refund policy?",
        a: "Yes: a 7-day money-back guarantee on the first charge of a new subscription (monthly or annual). Email dusty@askcerebrum.org within 7 days for a full refund.",
      },
      {
        q: "What happens to my saved work if I cancel Pro?",
        a: "Nothing is deleted. Your saved articles, collections, and history stay exactly where they were; only the Pro limits and badge go away.",
      },
    ],
  },

  "document-mode": {
    ...SOFTWARE_APP_BASE,
    eyebrow: "Document Mode",
    title: "Document Mode: understand long papers and PDFs",
    lede: "Paste or upload a long paper and Cerebrum reads it section by section, then synthesizes a structured summary — with a live progress bar throughout.",
    updated: "Updated September 2026.",
    blocks: [
      {
        h: "How it works",
        p: "Long documents are split on paragraph boundaries and digested section by section in parallel, then synthesized into a structured summary. You watch it happen: \u201cReading section 3 of 11\u201d with a real progress bar, instead of a spinner and a timeout.",
      },
      {
        h: "What you get",
        list: [
          "A structured summary of the whole document, grounded in its actual sections.",
          "Question answering against the document you provided.",
          "Comparison views for reading two documents side by side.",
        ],
      },
      {
        h: "Honest about limits",
        p: "If a section fails to digest, the summary says so with a placeholder rather than inventing content for it. Free accounts get 3 document reads every 5 days; Pro is unlimited.",
      },
    ],
    faq: [
      {
        q: "What can I load into Document Mode?",
        a: "Pasted text and uploaded documents, including long papers and PDFs. Very long documents are read section by section with a progress bar.",
      },
      {
        q: "Does Document Mode work without an account?",
        a: "Yes. Free accounts get 3 document reads every 5 days; Cerebrum Pro ($20/month or $144/year) removes the limit.",
      },
    ],
  },

  "diagram-studio": {
    ...SOFTWARE_APP_BASE,
    eyebrow: "Diagram Studio",
    title: "Diagram Studio: turn papers into clear diagrams",
    lede: "Diagram Studio turns a pathway, method, or mechanism into an editable diagram: Mermaid v12 engine, templates, pan/zoom, and SVG, PNG, and .mmd export.",
    updated: "Updated September 2026.",
    blocks: [
      {
        h: "What it does",
        p: "Describe the pathway, process, or system you want to show — or import an existing .mmd file verbatim — and Diagram Studio renders it with the Mermaid v12 engine: flowcharts, sequence diagrams, class diagrams, and more.",
      },
      {
        h: "Built for real work",
        list: [
          "Verbatim .mmd import: bring diagrams you already have.",
          "Templates for common scientific diagram shapes.",
          "Pan, zoom, and fit-to-view, with diagrams saved to a local library.",
          "Export to SVG, PNG, or .mmd for papers, slides, and posters.",
        ],
      },
    ],
    faq: [
      {
        q: "Which diagram types are supported?",
        a: "Everything Mermaid v12 supports: flowcharts, sequence diagrams, class diagrams, state diagrams, entity-relationship diagrams, Gantt charts, and more — plus verbatim import of your own .mmd files.",
      },
      {
        q: "Can I export my diagrams?",
        a: "Yes: SVG and PNG for slides and posters, and .mmd to keep editing the source elsewhere.",
      },
    ],
  },

  investigations: {
    ...SOFTWARE_APP_BASE,
    eyebrow: "Investigations",
    title: "Investigations: save and revisit research threads",
    lede: "Investigations keep a research thread alive across sessions: save papers, questions, and notes in one place you can reopen, extend, and build on over time.",
    updated: "Updated September 2026.",
    blocks: [
      {
        h: "A case file for your curiosity",
        p: "A search answers one question; an investigation follows the thread. Save the papers that matter, the questions they raised, and your own notes into a single investigation you can reopen weeks later and keep building.",
      },
      {
        h: "Investigations vs. Library",
        p: "The Library is your shelf: saved papers and collections, organized your way. Investigations are your desk: the active thread, with questions, papers, and notes kept together while the work is in progress.",
      },
      {
        h: "Private by default",
        p: "Your investigations live in your account, and with the Private Vault's end-to-end encryption even the server can't read them. Delete anytime; nothing is kept after you do.",
      },
    ],
    faq: [
      {
        q: "What is an investigation?",
        a: "A saved research thread: the questions you asked, the papers that mattered, and your notes, kept together so you can reopen the thread later and keep going.",
      },
      {
        q: "How is that different from the Library?",
        a: "The Library organizes saved papers into collections. Investigations keep the active work — questions, papers, and notes — together while a research thread is in progress.",
      },
    ],
  },
};

/** Slugs that get prerendered documents, in sitemap order. */
export const MARKETING_SLUGS = Object.keys(MARKETING_PAGES);
