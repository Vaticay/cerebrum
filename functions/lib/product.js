/**
 * Canonical product facts.
 *
 * Every number and name a user can read about Cerebrum is declared once, here,
 * and derived everywhere else. Before this file the scholarly-database count
 * appeared as "14" in five places in index.html, "16" in the README, a list of
 * 13 names in one place and 10 in another — four different answers to one
 * factual question, all shipped. The count is now computed from the list, so
 * adding a source updates the marketing copy by construction and it is not
 * possible for them to disagree again.
 *
 * If you add a provider, add it here. Do not hardcode a count anywhere.
 */

export const PRODUCT = {
  name: "Cerebrum",
  origin: "https://askcerebrum.org",
  contactEmail: "contact@askcerebrum.org",
  securityEmail: "security@askcerebrum.org",
};

/**
 * The scholarly sources the search fanout actually queries.
 *
 * `id` matches the identifier used in functions/api/search.js's fanout so the
 * two cannot drift. `peerReviewed` describes what the source predominantly
 * indexes and is what lets the UI label a preprint honestly rather than
 * implying everything returned has been reviewed.
 */
export const SCHOLARLY_SOURCES = [
  { id: "europePMC",      name: "Europe PMC",       category: "biomedical",     peerReviewed: "mixed" },
  { id: "pubmed",         name: "PubMed",           category: "biomedical",     peerReviewed: "mostly" },
  { id: "openAlex",       name: "OpenAlex",         category: "multi",          peerReviewed: "mixed" },
  { id: "crossref",       name: "Crossref",         category: "multi",          peerReviewed: "mixed" },
  { id: "arxiv",          name: "arXiv",            category: "preprint",       peerReviewed: "no" },
  { id: "semanticScholar",name: "Semantic Scholar", category: "multi",          peerReviewed: "mixed" },
  { id: "doaj",           name: "DOAJ",             category: "open-access",    peerReviewed: "yes" },
  { id: "biorxiv",        name: "bioRxiv",          category: "preprint",       peerReviewed: "no" },
  { id: "zenodo",         name: "Zenodo",           category: "repository",     peerReviewed: "no" },
  { id: "plos",           name: "PLOS",             category: "open-access",    peerReviewed: "yes" },
  { id: "CORE",           name: "CORE",             category: "aggregator",     peerReviewed: "mixed" },
  { id: "BASE",           name: "BASE",             category: "aggregator",     peerReviewed: "mixed" },
  { id: "pmcFullText",    name: "PMC Full Text",    category: "biomedical",     peerReviewed: "mostly" },
  { id: "openAire",       name: "OpenAIRE",         category: "aggregator",     peerReviewed: "mixed" },
  { id: "preprints",      name: "bioRxiv/medRxiv",  category: "preprint",       peerReviewed: "no" },
];

/** Derived, never hand-written. */
export const SOURCE_COUNT = SCHOLARLY_SOURCES.length;

/** The handful named in marketing copy, in the order they are listed. */
export const HEADLINE_SOURCES = ["Europe PMC", "PubMed", "OpenAlex", "Crossref", "Semantic Scholar", "arXiv"];

/**
 * Third parties that receive data, and exactly what they receive.
 *
 * This is the machine-readable source for the Privacy Center. It exists so the
 * privacy page describes the code rather than someone's memory of the code:
 * if an integration is added and not declared here, it will be missing from
 * the disclosure, which is a visible bug rather than a silent one.
 *
 * `receivesQuery` is the field that matters most — it is true only where the
 * user's actual research question leaves our infrastructure.
 */
export const DATA_RECIPIENTS = [
  {
    id: "scholarly",
    name: "Scholarly databases",
    detail: SCHOLARLY_SOURCES.map((s) => s.name).join(", "),
    receivesQuery: true,
    note: "Search terms derived from your question are sent to each database so it can return matching papers. Requests are made from Cerebrum's servers, so these services never see your IP address or browser.",
    serverSide: true,
  },
  {
    id: "ai",
    name: "AI model providers",
    detail: "Whichever providers the operator has configured (Groq, Cerebras, Google, Mistral, GitHub Models, NVIDIA, OpenRouter, Cloudflare Workers AI)",
    receivesQuery: true,
    note: "Your question and the abstracts of the retrieved papers are sent to a model to write the answer. Sent from Cerebrum's servers; these providers never see your IP address.",
    serverSide: true,
  },
  {
    id: "email",
    name: "Resend",
    detail: "Sign-in emails",
    receivesQuery: false,
    note: "Receives your email address to deliver a sign-in code. Never receives anything you search for.",
    serverSide: true,
  },
  {
    id: "youtube",
    name: "YouTube",
    detail: "Embedded lecture and explainer video",
    receivesQuery: false,
    note: "Embeds use youtube-nocookie.com and only load when you play a video. At that point YouTube sees your IP address, from your browser.",
    serverSide: false,
  },
  {
    id: "zotero",
    name: "Zotero",
    detail: "Optional reference-manager export",
    receivesQuery: false,
    note: "Only if you connect it. Receives the citations you choose to export, from your browser using your key. Off by default.",
    serverSide: false,
  },
  {
    id: "turn",
    name: "Cloudflare Realtime (TURN)",
    detail: "Relay for calls that cannot connect directly",
    receivesQuery: false,
    note: "Used only during a call, and only when a direct peer connection fails. Relays encrypted media; sees IP addresses of both participants.",
    serverSide: false,
  },
];

/**
 * What Cerebrum stores, where, and for how long. Drives the Privacy Center.
 * `scope` is the honest answer to "who can see this".
 */
export const DATA_INVENTORY = [
  { id: "history",   label: "Your question history",   scope: "server",  retention: "Until you delete it or delete your account", note: "Synced only if you are signed in. Signed out, it stays in this browser." },
  { id: "saved",     label: "Saved papers and collections", scope: "server", retention: "Until you delete them or delete your account" },
  { id: "profile",   label: "Profile: name, username, bio, avatar, links", scope: "public", retention: "Until you delete your account" },
  { id: "email",     label: "Your email address",      scope: "private", retention: "Until you delete your account", note: "Used to sign you in. Never shown on your profile and never sent to anyone you message." },
  { id: "messages",  label: "Direct messages and attachments", scope: "participants", retention: "Until you delete your account", note: "Stored unencrypted on the server. Cerebrum can technically read them; they are not end-to-end encrypted." },
  { id: "social",    label: "Follows, blocks",         scope: "mixed",   retention: "Until you delete your account" },
  { id: "answercache", label: "Answers to non-sensitive questions", scope: "shared", retention: "30 days", note: "Cached to make common questions fast. Questions classified as sensitive are never cached." },
  { id: "local",     label: "Theme, settings, API keys you add", scope: "device", retention: "Until you clear this browser", note: "Never sent to Cerebrum's servers." },
  { id: "ratelimit", label: "Abuse-prevention counters", scope: "server", retention: "Minutes", note: "Keyed by a rotating one-way hash, not by your IP address." },
];
