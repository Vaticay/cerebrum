# Cerebrum v4.0

A scientific literature search engine at [askcerebrum.org](https://askcerebrum.org).

Ask a question. Cerebrum searches 16 open scholarly databases in parallel, then writes an answer where every claim traces back to a real, citable paper.

## Stack

- **Frontend**: React + Vite, deployed as static site on Cloudflare Pages
- **Backend**: Cloudflare Pages Functions (`functions/api/search.js`)
- **AI**: OpenRouter free models (Gemini Flash, DeepSeek, Llama, Qwen, Mistral) + Cloudflare Workers AI fallback
- **Databases**: Europe PMC, PubMed, OpenAlex, Semantic Scholar, Crossref, arXiv, bioRxiv, medRxiv, DOAJ, PLOS, Zenodo, CORE, DataCite, and more
- **Animations**: Three.js + Vanta.js (loaded from CDN)

## Deploy

```bash
npm install
npx wrangler login
npm run deploy
```

Then add secrets (once):
```bash
npx wrangler pages secret put OPENROUTER_KEY
npx wrangler pages secret put OPENALEX_KEY          # optional
npx wrangler pages secret put NCBI_API_KEY          # optional
```

## Local development

```bash
npm install
cp dev.vars.example .dev.vars    # fill in your OPENROUTER_KEY
npm run dev
```

## Cost

Everything runs on free tiers. Cloudflare Pages (100k requests/day), OpenRouter free models, and free scholarly APIs.

## Built by

[Vaticay](https://github.com/Vaticay)
