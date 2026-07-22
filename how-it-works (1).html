<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>How Cerebrum works</title>
<link rel="icon" href="data:,">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif; background: #fafaf7; color: #111; line-height: 1.65; }
  @media (prefers-color-scheme: dark) { html, body { background: #0f1116; color: #e5e5e5; } }
  main { max-width: 720px; margin: 0 auto; padding: 60px 24px 100px; }
  h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 8px; }
  .lede { color: #666; font-size: 15px; margin: 0 0 40px; }
  h2 { font-size: 20px; font-weight: 650; letter-spacing: -0.01em; margin: 40px 0 12px; padding-top: 20px; border-top: 1px solid #e5e5e5; }
  @media (prefers-color-scheme: dark) { h2 { border-color: #26282f; } .lede { color: #999; } }
  p { margin: 0 0 14px; }
  ul { padding-left: 22px; margin: 0 0 16px; }
  li { margin-bottom: 6px; }
  code { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 13px; background: rgba(0,0,0,0.05); padding: 1px 6px; border-radius: 4px; }
  @media (prefers-color-scheme: dark) { code { background: rgba(255,255,255,0.06); } }
  a { color: #10b981; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .back { display: inline-block; margin-bottom: 40px; color: #888; font-size: 13px; }
</style>
</head>
<body>
<main>
<a class="back" href="/">← Back to Cerebrum</a>

<h1>How Cerebrum works</h1>
<p class="lede">A short, honest technical explanation. No marketing.</p>

<h2>The retrieval layer</h2>
<p>Every query fans out to 10-plus scholarly databases in parallel. All are free and keyless:</p>
<ul>
<li><strong>Europe PMC</strong> — biomedical, includes preprints</li>
<li><strong>PubMed</strong> (via NCBI E-utilities) — biomedical, uses automatic MeSH term mapping</li>
<li><strong>OpenAlex</strong> — cross-disciplinary, includes concept graph</li>
<li><strong>Crossref</strong> — DOI-registered publications, checked for retraction status</li>
<li><strong>arXiv</strong> — physics, math, CS, quantitative biology</li>
<li><strong>Semantic Scholar</strong> — includes their auto-generated TL;DR summaries</li>
<li><strong>bioRxiv</strong> preprints (via OpenAlex)</li>
<li><strong>DOAJ</strong>, <strong>PLOS</strong>, <strong>Zenodo</strong>, <strong>DataCite</strong> — additional coverage</li>
</ul>
<p>Results are merged, deduplicated by title, and scored for relevance based on term coverage, title matches, citation count, and recency.</p>

<h2>Query intelligence</h2>
<ul>
<li><strong>Species queries</strong> (Latin binomials like <code>Populus angustifolia</code>) are wrapped in quoted phrases and enforce strict species-level filtering. Papers about sibling species in the same genus are dropped or flagged.</li>
<li><strong>Author queries</strong> hit OpenAlex's author disambiguation endpoint. Papers by that specific person are marked <code>AUTHOR-MATCHED</code>; papers that only mention the name are separated.</li>
<li><strong>Acronym expansion</strong> for common scientific abbreviations (BSFL, CRISPR, PCR, etc.).</li>
<li><strong>Fallback ladder</strong>: if the strict structured query returns nothing, we retry with organism-only, then the plain query. A search never comes back empty when papers exist.</li>
</ul>

<h2>Trust and safety</h2>
<ul>
<li><strong>Retraction flagging</strong>: the top papers in every result set are checked against Crossref's crossmark data. Retractions and expressions of concern are shown as warnings on the bibliography entry, and the AI is told to flag them in the answer.</li>
<li><strong>No fabricated citations</strong>: the AI is instructed to never invent DOIs, author names, or journal names. Citations map to real papers in the bibliography.</li>
<li><strong>Honest hedging</strong>: when the retrieved literature is thin, the model is told to say so plainly rather than fill the gap with confidence.</li>
</ul>

<h2>The AI layer</h2>
<p>Answers are synthesized by free tier language models, tried in this order:</p>
<ul>
<li>OpenRouter free models: Gemini 2.0 Flash, Llama 3.3 70B, Qwen 2.5 72B, Mistral Small 3.1, DeepSeek Chat, Llama 3.1 8B</li>
<li>Cloudflare Workers AI: Llama 3.1 8B, Mistral 7B</li>
<li>Pollinations AI (keyless fallback)</li>
</ul>
<p>The model that returns first wins. If all fail, the raw paper abstracts are returned instead of a fabricated answer.</p>

<h2>Full text access</h2>
<p>For the top papers with PMC IDs (open-access biomedical), we fetch the full text via NCBI's BioC API. This is night-and-day better than an abstract-only summary, because methods and results sections often contradict what an abstract implies.</p>

<h2>Known limitations</h2>
<ul>
<li>New preprints may not be indexed by any free API for hours or days after posting. Cerebrum can't find what isn't findable.</li>
<li>The AI can still misinterpret papers. Every claim should be verified against the cited source; that's why we make citations clickable and expose the bibliography.</li>
<li>Free AI models have rate limits. During peak load, answers may fall to slower fallback tiers.</li>
<li>Non-English literature is under-indexed by most of the databases we query. Multilingual retrieval is an open project.</li>
<li>Cerebrum does not currently deduplicate against preprint-to-published-version pairs. You may see the same work twice if it appears as both.</li>
</ul>

<h2>What Cerebrum is not</h2>
<ul>
<li>Not a replacement for reading the actual papers</li>
<li>Not a systematic review tool (it can help scope one, but you still need PRISMA methodology)</li>
<li>Not medical, legal, or financial advice</li>
<li>Not paywalled or ad-supported</li>
</ul>

<p style="margin-top: 40px; color: #888; font-size: 12.5px;">Cerebrum™ · Built by Vaticay · Open to feedback</p>
</main>
</body>
</html>
