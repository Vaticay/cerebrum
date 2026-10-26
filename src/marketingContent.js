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
 * - Rendered <title> is the raw title, then an em dash, then "Cerebrum",
 *   and it must stay within 50 to 60 chars (tests/seo-marketing.mjs
 *   enforces the rendered length). With the 11 char suffix that means raw
 *   titles of roughly 38 to 49 chars.
 * - The lede becomes the meta description and must be 140 to 160 chars
 *   (also enforced by the test).
 * - Database counts derive from functions/lib/product.js SOURCE_COUNT
 *   (imported below); never type the number into copy. The count is
 *   the fanout slot count: one entry per source a search queries in
 *   parallel, preprint index included (see scripts/check.mjs).
 * - The slogan below is Dusty's, word for word. Never reword it; only the
 *   labeling/styling around it may change.
 */
export const SLOGAN = "Ask a real research question. Every claim traces to a paper you can open.";

import { SOURCE_COUNT } from "../functions/lib/product.js";

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
    lede: `Cerebrum searches ${SOURCE_COUNT} scholarly databases in parallel and answers with citations you can check. Searching and AI answers are free, with no account needed.`,
    blocks: [
      {
        h: "The promise",
        p: SLOGAN + " You ask in plain language; Cerebrum queries Europe PMC, PubMed, OpenAlex, Semantic Scholar, Crossref, arXiv, bioRxiv, DOAJ, PLOS, CORE, BASE, PMC full text, OpenAIRE and more in parallel, scores the results for relevance, and writes a summary constrained by what those papers actually say.",
      },
      {
        h: "What is in Cerebrum",
        list: [
          "Answers graded against the evidence: every claim links to a real paper you can open, with a confidence note on how strongly the literature supports it.",
          "Search record and coverage on every answer: what the answer rests on, what was asked, and what ran, at a permanent link of its own, with copy and download and a JSON form.",
          "A budget ledger on every search: each search runs on a stated budget of 50 platform calls, and the response and the record show what each stage spent against it.",
          "Document Mode: paste or upload a long paper and get a structured summary built section by section, with live progress. Reading a document needs a free account.",
          "Diagram Studio: turn an answer, a paper, or your own steps into one clear diagram, and export it as SVG, PNG, or a text outline.",
          "Investigations and Library: save papers, questions, and threads into collections you can revisit.",
          "Watched topics: watch a subject from the end of an answer, and your home screen counts the new papers indexed on it since you last looked.",
          "Nova: taught lessons on a topic you pick, with practice activities, daily practice, and progress you can export as a file you keep.",
          "Private Vault: optional end to end encrypted sync for your saved work, with a 24 word recovery phrase only you hold.",
        ],
      },
      {
        h: "Every answer shows its coverage",
        p: "Under each answer, a short line states what the answer rests on: how many papers were gathered, how many the answer actually cites, how many more sit alongside as further reading, which databases answered, and the years the sources span. When the shelf is thin, the line says so. You can judge an answer before you trust it.",
      },
      {
        h: "The Search record",
        p: "Every answer carries a record of its own search, and the record does not live only inside the answer. Each one gets a permanent page of its own on askcerebrum.org, at an address that keeps working, so you can link to it from your notes, a methods draft, or a message to a collaborator, and anyone can open it. Add ?format=json to that address and the same record comes back as JSON, for tools that would rather read it that way. You can still copy the record or download it as a file from under the answer. The record freezes the search exactly as it ran: the question as asked and the time it was asked, the queries Cerebrum built from it, every database it asked and how much each one returned, what the funnel kept and what it dropped, the model that wrote the answer, and the full source list with each paper marked cited or further reading. And the record is not a dead end: ask the same question again from it, and the new run is compared against the earlier one, naming the sources the new run added and the sources it dropped. Months later, a reviewer, a collaborator, or your future self can see exactly what a methods section rests on.",
      },
      {
        h: "Why a record, not just an answer",
        p: "A summary on its own asks to be trusted. A record can be checked. When your methods section has to say how the literature was found, the Search record is the thing you point to: the search itself, documented and kept, instead of a result you have to take on faith.",
      },
      {
        h: "A stated budget behind every search",
        p: "Every search also runs on a stated budget of platform calls, the requests Cerebrum makes to databases and models while it works: 50 in total, divided before the search starts. Up to 23 calls gather papers, 5 cover the work that follows gathering, 5 validate candidate papers, 5 authorize the answer, 5 write it, and 7 are held for the closing steps, fact checking, metering, and storing the record. The plan closes exactly (23 + 5 + 5 + 5 + 5 + 7 = 50), and the total is a hard cap enforced while the search runs, so no stage can spend the search past it. The spending is published rather than hidden: every search response carries its ledger, the calls each stage used against the limit of 50, and the same ledger is frozen into the Search record, so what an answer cost is as checkable as what it rests on.",
      },
      {
        h: "Watch a topic and we count the new papers",
        p: "At the end of an answer, the Watch this topic button starts tracking the subject of that answer, not the wording of one question. Your home screen then carries a Topics you're watching card. For every topic it counts, from Europe PMC, the papers indexed since you last looked, and shows the count beside the topic. Cerebrum can also send a browser notification when new papers land on a watched topic. Open a topic and the count clears while Cerebrum asks what is new in it and summarizes the most recent findings. When nothing new has been published, the count stays at zero and the card says nothing new yet. The counts are real literature counts, never invented to pull you back.",
        list: [
          "Watching needs a free account, because the list lives in your account. No plan gates it, and Pro does not raise it.",
          "Watch up to 40 topics at once, and stop watching any of them with one click.",
        ],
      },
      {
        h: "Use Cerebrum inside ChatGPT and Claude",
        p: "Cerebrum speaks MCP, the open protocol that AI assistants use to call outside tools. Connect a compatible assistant to the endpoint below and it can search the literature through Cerebrum and bring back a cited answer with a numbered source list, or fetch the current Today in Science edition.",
        list: [
          "Endpoint: https://askcerebrum.org/mcp",
          "search_literature: a cited answer from the literature for a research question you give it.",
          "get_trending: the current Today in Science edition, headlines grouped by section with links.",
          "When a search stores a record, the result carries the Search record with it: the permanent link to the record page, the question as asked, and the source and database counts.",
        ],
      },
      {
        h: "Nova: learn the topic, lesson by lesson",
        widget: "nova-figure",
        p: "Nova teaches the topic itself, in plain language, and never asks you to read a paper. Pick a topic from six shelves of science, or start from a subject you care about, and Nova lays out a path of short lessons that teach the ideas first. The practice then checks what the lessons taught: quizzes, fill in the blank cards, true or false checks, and matching and ordering activities. A daily practice session brings back what is due for review. A streak counts the days you practice, and two freezes cover the days you miss.",
        list: [
          "Progress lives in this browser only: your courses, streak, and practice history are stored on your device, not in an account, and there is no cloud copy.",
          "Export saves your Nova progress as one file you keep. Import that file in another browser and your progress comes with you.",
        ],
      },
      {
        h: "Built for researchers without a library",
        p: "Serious research happens far from any campus. Independent and unaffiliated researchers, clinicians between posts, engineers, writers, and graduates whose library access ended with their degree all read the same literature and get shut out of the same paywalls. Cerebrum is built for you as well: searching and AI answers need no account, a free account carries the same allowances under your name on any device and adds document reads, and free answers carry the same coverage line and Search record, permanent link included, as any other answer. If a tool you relied on moved features you used behind a paywall, the core work here is free.",
      },
      {
        h: "When no papers come back",
        p: "If no papers are retrieved for a question, Cerebrum says so plainly rather than inventing sources. A confident guess dressed up as science is worse than an honest \u201cnothing found.\u201d",
      },
      {
        h: "What nothing found looks like",
        p: "When a search finds nothing that matches, the answer says so in the same plain words you see in the app: \u201cNo papers in the literature matched this question.\u201d Nothing is padded out with a guess. Under it, Cerebrum offers a next search that changes the strategy rather than the wording: a broader question, a different evidence filter, a related term.",
      },
      {
        h: "What is free, and what needs an account",
        p: "Searching and AI answers are free and need no account. The free cap is 50 AI answers every 5 days, counted by network when you are signed out and carried under your name with a free account. Nothing about the cap is revealed at the moment you hit it; it is stated here and on the pricing page, before you start.",
        list: [
          "Reading a document in Document Mode needs a free account: 3 document reads every 5 days.",
          "Saving a diagram needs a free account: 1 saved diagram every 5 days.",
          "Watching topics needs a free account, up to 40 topics at once.",
          "A free account also syncs your saved articles, collections, and history across your devices.",
          "Pro removes the caps: unlimited answers, document reads, and diagrams.",
        ],
      },
    ],
    faq: [
      {
        q: "Is Cerebrum free?",
        a: "Yes. Searching and AI answers are free with no account at all. A free account carries 50 AI answers, 3 document reads, and 1 diagram every 5 days, and document reads need that account. Cerebrum Pro ($20/month or $144/year) removes the limits.",
      },
      {
        q: "Where do the answers come from?",
        a: `From ${SOURCE_COUNT} open scholarly databases, including PubMed, Europe PMC, OpenAlex, Semantic Scholar, Crossref, arXiv, and bioRxiv, searched in parallel. Every claim in an answer links to a real paper you can open.`,
      },
      {
        q: "Do I need an account?",
        a: "Not to search, and not for AI answers: anonymous use is metered by network up to the same 50 AI answers every 5 days. A free account carries those allowances under your name on any device, adds 3 document reads and 1 saved diagram every 5 days (document reads and saved diagrams need an account), and syncs what you save: articles, collections, history, and your Pro status.",
      },
      {
        q: "What is the Search record?",
        a: "A frozen account of one search that ships with the answer: the question as asked, the queries that ran, every database and how much it returned, the funnel, the model that wrote the answer, and the source list with each paper marked cited or further reading. Every record gets a permanent page of its own on askcerebrum.org, so you can link to it from your notes or your methods draft and anyone can open it. Add ?format=json to that address and the same record comes back as JSON. Ask the question again from the record and the new run is compared with the earlier one, naming the sources added and dropped. You can also copy it or download it from under any answer.",
      },
      {
        q: "Can I use Cerebrum from inside ChatGPT or Claude?",
        a: "Yes. Cerebrum runs a live MCP endpoint at https://askcerebrum.org/mcp. A compatible assistant can call search_literature for a cited answer from the literature, or get_trending for the current Today in Science edition. Search results carry their Search record with them, permanent link included.",
      },
      {
        q: "Can Cerebrum tell me when new papers appear on a topic?",
        a: "Yes. Use the Watch this topic button at the end of an answer. Your home screen watchlist then counts, for each topic, the papers Europe PMC has indexed since you last looked, and opening a topic clears its count and summarizes what is new. Watching needs a free account, covers up to 40 topics at once, and no plan gates it.",
      },
    ],
  },

  pricing: {
    ...SOFTWARE_APP_BASE,
    eyebrow: "Pricing",
    title: "Cerebrum pricing, from free to Pro plans",
    lede: "Cerebrum is free for everyday research. Cerebrum Pro is $20 a month or $144 a year: unlimited answers and funding for independent science search with no ads.",
    offers: [
      { name: "Cerebrum Pro, monthly", price: "20", priceCurrency: "USD", billingIncrement: "P1M" },
      { name: "Cerebrum Pro, annual", price: "144", priceCurrency: "USD", billingIncrement: "P1Y" },
      { name: "Lite Monthly", price: "3.99", priceCurrency: "USD", billingIncrement: "P1M" },
      { name: "Lite Annual", price: "39", priceCurrency: "USD", billingIncrement: "P1Y" },
      { name: "Pro Student", price: "7.99", priceCurrency: "USD", billingIncrement: "P1M" },
    ],
    blocks: [
      {
        h: "Free",
        p: "50 AI answers, 3 document reads, and 1 diagram every 5 days with a free account. No ads, no tracking pixels, no sale of personal information.",
        list: [
          "Cost: $0, with no payment required.",
          "Searching works with no account at all, and AI answers too, metered by network up to the same free cap.",
          "Every free answer carries the coverage line and the full Search record, permanent link and JSON form included, the same as any other answer.",
          "Any compatible AI assistant can call Cerebrum through the MCP endpoint at https://askcerebrum.org/mcp, free included.",
          "A free account can watch up to 40 topics, and the home screen counts the new papers indexed on each one.",
          "Nova is included: taught lessons on the topics you pick, daily practice, and progress stored in your browser that exports as a file you keep.",
        ],
      },
      {
        h: "Cerebrum Pro",
        list: [
          "$20 per month or $144 per year, renewing automatically until you cancel.",
          "Unlimited AI answers, document reads, and diagrams.",
          "The Pro badge and four Pro themes.",
          "Investigation templates for Pro members.",
          "When the search system is busy, Pro searches take the priority queue and go first.",
          "API access with personal keys.",
          "Cancel anytime from the billing portal. A 7 day money back guarantee covers the first charge of a new subscription. Email dusty@askcerebrum.org within 7 days for a full refund, no questions asked.",
        ],
      },
      {
        h: "Pro Lite",
        p: "Lite Monthly costs $3.99 per month. Lite Annual costs $39 per year.",
        list: [
          "500 AI answers, 30 document reads, and 10 diagrams every 5 days.",
          "Ten times the free allowances, with a fixed allowance rather than unlimited use.",
          "The Pro badge and the Pro themes stay with Cerebrum Pro.",
        ],
      },
      {
        h: "Pro Student",
        p: "Verified college students can get Cerebrum Pro for $7.99 per month for the first 12 months. Verification uses the email address on your account, and only addresses ending in .edu or .ac.uk qualify.",
        list: [
          "Full Cerebrum Pro while subscribed, including unlimited AI answers, document reads, and diagrams.",
          "After the first 12 months, the subscription renews at the standard $20 monthly price unless cancelled.",
        ],
      },
      {
        h: "Why Pro exists",
        p: "Cerebrum is an independent project, not an advertising business. Pro subscriptions pay for the search infrastructure directly, so Cerebrum never has to sell your attention.",
      },
      {
        h: "Will free cover you?",
        p: "Drag the slider to your typical week. The free tier gives you 50 AI answers every 5 days, which works out to about 70 a week.",
        widget: "quota-calc",
      },
    ],
    faq: [
      {
        q: "How much is Cerebrum Pro?",
        a: "$20 per month or $144 per year, renewing automatically until you cancel. Prices are shown in USD at checkout.",
      },
      {
        q: "What is Pro Lite?",
        a: "A paid plan with larger allowances than Free: 500 AI answers, 30 document reads, and 10 diagrams every 5 days. Lite Monthly is $3.99 per month, and Lite Annual is $39 per year.",
      },
      {
        q: "How does Pro Student pricing work?",
        a: "Verified college students get Cerebrum Pro for $7.99 per month for the first 12 months. Verification uses the email address on your account, and only addresses ending in .edu or .ac.uk qualify. The subscription then renews at the standard $20 monthly price unless cancelled.",
      },
      {
        q: "Can I cancel?",
        a: "Yes, anytime from the billing portal. There are no refunds for part of a period outside the money back window, but you keep Pro until the end of the paid period.",
      },
      {
        q: "Is there a refund policy?",
        a: "Yes: a 7 day money back guarantee on the first charge of a new subscription (monthly or annual). Email dusty@askcerebrum.org within 7 days for a full refund.",
      },
      {
        q: "What happens to my saved work if I cancel Pro?",
        a: "Nothing is deleted. Your saved articles, collections, and history stay exactly where they were; only the Pro limits and badge go away.",
      },
      {
        q: "Are the Search record and MCP access Pro only?",
        a: "No. The coverage line and the Search record ship on answers generally, free answers included, and every record keeps its own permanent page. The MCP endpoint is open, and search results there carry the record with them. Pro removes the limits on answers, reads, and diagrams; it does not gate the record.",
      },
    ],
  },

  "document-mode": {
    ...SOFTWARE_APP_BASE,
    eyebrow: "Document Mode",
    title: "Reading long papers and PDFs section by section",
    lede: "Paste or upload a long paper and Cerebrum reads it section by section, then builds a structured summary, with a live progress bar throughout.",
    blocks: [
      {
        h: "How it works",
        p: "Long documents are split on paragraph boundaries and digested section by section in parallel, then synthesized into a structured summary. You watch it happen: \u201cReading section 3 of 11\u201d with a real progress bar, instead of a spinner and a timeout.",
      },
      {
        h: "What the summary includes",
        list: [
          "A structured summary of the whole document, grounded in its actual sections.",
          "Question answering against the document you provided.",
          "Comparison views for reading two documents side by side.",
        ],
      },
      {
        h: "When a section fails",
        p: "If a section fails to digest, the summary says so with a placeholder rather than inventing content for it. Document Mode needs an account: a free account gets 3 document reads every 5 days, and Pro is unlimited.",
      },
    ],
    faq: [
      {
        q: "What can I load into Document Mode?",
        a: "Pasted text and uploaded documents, including long papers and PDFs. Very long documents are read section by section with a progress bar.",
      },
      {
        q: "Does Document Mode work without an account?",
        a: "No. Reading a document spends Cerebrum's AI budget, so document reads belong to accounts. A free account gets 3 document reads every 5 days, and Cerebrum Pro ($20/month or $144/year) removes the limit.",
      },
    ],
  },

  "diagram-studio": {
    ...SOFTWARE_APP_BASE,
    eyebrow: "Diagram Studio",
    title: "Step diagrams built from papers and answers",
    lede: "Diagram Studio turns a pathway, method, or mechanism into one clear diagram of steps with arrows, built from an answer, a paper, or steps you write.",
    blocks: [
      {
        h: "What it does",
        p: "Pick a source and Diagram Studio builds the diagram from it: the steps of an answer you just read, the steps in a saved paper, or your own steps written one per line. Every label comes from the source text. Nothing is invented to fill a box.",
      },
      {
        h: "Built for real work",
        list: [
          "One screen, one diagram: edit the step list and the diagram follows.",
          "Steps can be plain steps, decisions, or evidence tied to a real paper.",
          "Diagrams save to your Library and sync to your account.",
          "Export to SVG or PNG for papers, slides, and posters, or a text outline you can paste anywhere.",
        ],
      },
    ],
    faq: [
      {
        q: "Which diagram types are supported?",
        a: "One kind: a chain of steps with arrows, running down the page or across it. Steps can be marked as decisions or as evidence where the source supports that.",
      },
      {
        q: "Can I export my diagrams?",
        a: "Yes: SVG and PNG for slides and posters, and a text outline in Markdown for notes and drafts.",
      },
    ],
  },

  investigations: {
    ...SOFTWARE_APP_BASE,
    eyebrow: "Investigations",
    title: "Keeping a research thread alive across sessions",
    lede: "Investigations keep a research thread alive across sessions: save papers, questions, and notes in one place you can reopen and keep adding to over time.",
    blocks: [
      {
        h: "One thread, kept together",
        p: "A search answers one question. An investigation follows what the answer raised: save the papers that matter, the questions they opened, and your own notes into a single investigation you can reopen weeks later and keep building.",
      },
      {
        h: "Investigations vs. Library",
        p: "The Library is what you saved: papers and collections, organized your way. An investigation is the work still in progress, with questions, papers, and notes kept together while you work.",
      },
      {
        h: "Kept in your account",
        p: "Your investigations live in your account, and with the Private Vault's end to end encryption, even the server cannot read them. Delete anytime; nothing is kept after you do.",
      },
    ],
    faq: [
      {
        q: "What is an investigation?",
        a: "A saved research thread: the questions you asked, the papers that mattered, and your notes, kept together so you can reopen the thread later and keep going.",
      },
      {
        q: "How is that different from the Library?",
        a: "The Library organizes saved papers into collections. Investigations keep the active work, questions, papers, and notes, together while a research thread is in progress.",
      },
    ],
  },
};

/** Slugs that get prerendered documents, in sitemap order. */
export const MARKETING_SLUGS = Object.keys(MARKETING_PAGES);

/**
 * One-question live demo: three sample questions with cached sample answers
 * and real citations, embedded on /about and /features.
 *
 * These are fixed, honest snapshots, not live search results. Every cited
 * paper is real and links to its DOI. The demo exists so a visitor sees what
 * a Cerebrum answer looks like, citations and all, before signing up for
 * anything. Copy is written dash free per the product voice rule.
 *
 * Look modernization, 2026-10-26: each sample now belongs to ONE page
 * (the page field). The panel baseline flagged the old arrangement,
 * the same three answers verbatim on both About and Features, as
 * making the two flagship pages feel templated rather than written.
 * About carries two worked answers, Features carries one plus its
 * own how it works strip. No answer appears on both pages.
 */
export const DEMO_QUESTIONS = [
  {
    page: "about",
    q: "Does creatine cause hair loss?",
    paragraphs: [
      {
        text: "No study has directly shown that creatine causes hair loss. The concern comes from one small 2009 trial of 20 college rugby players, which found a rise in dihydrotestosterone (DHT), the hormone most tied to male pattern baldness, during three weeks of creatine use. But the trial never measured hair loss, and nothing since has replicated even the DHT finding in a way that points to baldness.",
        cites: [2],
      },
      {
        text: "Against that sits the much larger safety literature. The International Society of Sports Nutrition's 2017 position stand, reviewing the full body of creatine research, reports no hair loss signal across hundreds of studies. If creatine caused baldness at any meaningful rate, it would be visible in that data by now.",
        cites: [1],
      },
    ],
    sources: [
      {
        title: "International Society of Sports Nutrition position stand: safety and efficacy of creatine supplementation in exercise, sport, and medicine",
        venue: "J Int Soc Sports Nutr",
        year: "2017",
        url: "https://doi.org/10.1186/s12970-017-0173-z",
      },
      {
        title: "Three weeks of creatine monohydrate supplementation affects dihydrotestosterone to testosterone ratio in college-aged rugby players",
        venue: "Clin J Sport Med",
        year: "2009",
        url: "https://doi.org/10.1097/JSM.0b013e3181b8b52b",
      },
    ],
  },
  {
    page: "about",
    q: "Have microplastics been found inside the human body?",
    paragraphs: [
      {
        text: "Yes, in blood. A 2022 Dutch study detected plastic particles in blood samples from 17 of 22 healthy donors, the first time quantities were measured in human blood.",
        cites: [1],
      },
      {
        text: "And in stool, earlier: a 2019 Austrian pilot study found microplastics in every stool sample from 8 volunteers across 8 countries. Both studies are small and say nothing about health effects, which remain unstudied at these exposures.",
        cites: [2],
      },
    ],
    sources: [
      {
        title: "Discovery and quantification of plastic particle pollution in human blood",
        venue: "Environ Int",
        year: "2022",
        url: "https://doi.org/10.1016/j.envint.2022.107199",
      },
      {
        title: "Detection of various microplastics in human stool: a prospective case series",
        venue: "Ann Intern Med",
        year: "2019",
        url: "https://doi.org/10.7326/M19-0618",
      },
    ],
  },
  {
    page: "features",
    q: "Is coffee linked to a longer life?",
    paragraphs: [
      {
        text: "In large observational studies, yes, modestly. A US study of over 400,000 adults found coffee drinkers had slightly lower mortality than non drinkers, with the effect leveling around 4 to 5 cups a day.",
        cites: [1],
      },
      {
        text: "But these are associations, not proof. Coffee drinkers differ from non drinkers in many ways, and no trial has randomized people to drink coffee for decades. A 2014 meta analysis of 21 studies found the same pattern, dose dependent up to about 4 cups.",
        cites: [1, 2],
      },
    ],
    sources: [
      {
        title: "Association of coffee drinking with total and cause-specific mortality",
        venue: "N Engl J Med",
        year: "2012",
        url: "https://doi.org/10.1056/NEJMoa1112010",
      },
      {
        title: "Coffee consumption and mortality from all causes, cardiovascular disease, and cancer: a dose-response meta-analysis",
        venue: "Am J Epidemiol",
        year: "2014",
        url: "https://doi.org/10.1093/aje/kwu194",
      },
    ],
  },
];

/** The demo samples that belong to one marketing page (see the
 * 2026-10-26 note on DEMO_QUESTIONS). Falls back to the full set for
 * any other slug so a future page opts in by tagging, not by code. */
export const demoForPage = (slug) => {
  const tagged = DEMO_QUESTIONS.filter((d) => d.page === slug);
  return tagged.length ? tagged : DEMO_QUESTIONS;
};
