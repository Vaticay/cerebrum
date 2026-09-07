# Cerebrum

A scientific literature search engine at [askcerebrum.org](https://askcerebrum.org).

Ask a question. Cerebrum searches 15 open scholarly databases in parallel, then writes an answer whose citations link to papers you can open and check.

The count is not typed here — it is derived from `SCHOLARLY_SOURCES` in `functions/lib/product.js`, and `npm run check` fails the build if any copy in the repository disagrees with it.

## Stack

- **Frontend**: React + Vite, deployed as static site on Cloudflare Pages
- **Backend**: Cloudflare Pages Functions (`functions/api/search.js`)
- **AI**: OpenRouter free models (Gemini Flash, DeepSeek, Llama, Qwen, Mistral) + Cloudflare Workers AI fallback
- **Databases**: see `SCHOLARLY_SOURCES` in `functions/lib/product.js` for the authoritative list
- **Animation**: GSAP for choreography, OGL for the WebGL background. Both bundled; nothing is loaded from a CDN.

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
