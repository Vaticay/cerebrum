# Cerebrum (web, on Cloudflare)

A science search engine that lives at a URL. You ask a question; it pulls real
papers from scholarly databases, then answers grounded only in those papers with
inline citation links.

Frontend: static site (Vite + React) on Cloudflare Pages.
Backend: a Pages Function (Cloudflare Workers runtime) in `functions/api/search.js`
that queries the databases and calls Google Gemini (free tier). One deploy, one URL, free tier.

Sources: Europe PMC (bio/chem, keyless), Semantic Scholar (all fields, keyless),
OpenAlex (optional key), and UTK TRACE (University of Tennessee repository).

## Deploy — the fast way (dashboard, no CLI)

1. Put this folder in a GitHub repo (create a repo, push these files).
2. Go to the Cloudflare dashboard → Workers & Pages → Create → Pages →
   Connect to Git → pick your repo.
3. Build settings:
   - Framework preset: None (or Vite)
   - Build command: `npm run build`
   - Build output directory: `dist`
4. Before the first deploy finishes, go to the project's
   Settings → Variables and Secrets and add:
   - `GEMINI_API_KEY` (mark as Secret / Encrypt) — from aistudio.google.com/apikey
   - `OPENALEX_KEY` (optional) — from openalex.org
   - `SEMANTIC_SCHOLAR_KEY` (optional)
5. Redeploy (Deployments → Retry, or push a commit). Your site is live at
   `https://<project>.pages.dev`.

That's it. Type a question and search.

## Deploy — the CLI way

```
npm install
npx wrangler login
npm run deploy        # builds, then wrangler pages deploy ./dist
```

Then add the secrets (once):

```
npx wrangler pages secret put GEMINI_API_KEY
npx wrangler pages secret put OPENALEX_KEY          # optional
npx wrangler pages secret put SEMANTIC_SCHOLAR_KEY  # optional
```

Redeploy after adding secrets: `npm run deploy`.

## Run locally first (optional)

```
npm install
cp .dev.vars.example .dev.vars     # then paste your GEMINI_API_KEY into it
npm run build
npm run preview                    # wrangler serves site + functions together
```

Open the URL it prints. Local dev reads secrets from `.dev.vars` (never commit it).

## How it works

- The page (`src/Cerebrum.jsx`) calls `POST /api/search`.
- The Function (`functions/api/search.js`) calls `gatherPapers()` in
  `functions/api/_sources.js`, which queries the databases (with fallback) and
  merges in UTK TRACE results, then asks Gemini to answer using only those papers.
- Files starting with `_` in `functions/` are treated as shared modules, not
  routes, so `_sources.js` is imported, not exposed as an endpoint.

## Notes and limits

- Europe PMC is strongest for life sciences and chemistry. For physics/math,
  Semantic Scholar carries more of the load; the fallback handles it.
- TRACE has no keyword search (OAI-PMH), so it harvests theses/dissertations and
  filters them against your query. Lighter match than the big databases, but real
  UTK work. To change collections, edit the `sets` array in `traceUTK()` in
  `functions/api/_sources.js`.
- Keyless database pools are shared and can throttle. Add the optional keys to
  raise limits.
- Answers are only as good as the retrieved abstracts. Citations let you verify.

## Cost

Cloudflare Pages free tier covers a lot (static requests are free; Functions get
100k requests/day free). Gemini free tier covers the answer generation (1,500 requests/day). The
free database tiers are free.
