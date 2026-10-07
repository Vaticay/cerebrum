/**
 * semanticRerank.js — Semantic reranking prototype for Cerebrum search.
 *
 * Replaces/augments keyword-overlap relevance scoring with embedding-based
 * cosine similarity, so "CRISPR gene editing" and "CRISPR screening" —
 * which share vocabulary but not meaning — score differently.
 *
 * DESIGN
 * - Provider: Cloudflare Workers AI `@cf/baai/bge-small-en-v1.5`
 *   (384 dims, 512 max input tokens, batch-capable). Chosen because:
 *   1. `env.AI` is already bound in this project (wrangler.toml `[ai]`,
 *      used by search.js, conversation.js, document.js, tts.js).
 *   2. Free tier: 10,000 neurons/day; embeddings cost ~5-20 neurons/req.
 *      One rerank = ONE batched call (query + up to 20 papers) = ~20 neurons.
 *      Budget: ~500 reranked searches/day on the free tier, zero new keys.
 *   3. Edge inference, no new vendor, no new secrets to manage.
 * - Runs AFTER keyword scoring, on the top N candidates only (default 20).
 * - Blends: blended = alpha * semantic(0-100) + (1-alpha) * keyword(0-100).
 *   Default alpha 0.5. Both scores are reported per paper for transparency.
 * - Graceful degradation: no env.AI, API error, or timeout → papers returned
 *   unchanged with `semanticSkipped: true`. Search never breaks because of this.
 * - Latency target: <2s. One batched call + Promise.race timeout (default 3s).
 *
 * This file is a PROTOTYPE. It does not modify search.js. Integration plan
 * is documented at the bottom of this file.
 */

/** Embedding model used for reranking. */
export const EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";

/** Max papers reranked per search (keeps it to one batched embedding call). */
export const RERANK_TOP_N = 20;

/** Default blend weight for the semantic score (0-1). */
export const DEFAULT_ALPHA = 0.5;

/** Timeout for the embedding call in ms. Exceeding it falls back to keyword-only. */
export const EMBED_TIMEOUT_MS = 3000;

/** Max characters of title+abstract sent to the embedding model. */
export const MAX_EMBED_CHARS = 1200;

/**
 * Cosine similarity between two equal-length vectors. Pure function.
 * Returns 0-1 for normalized embeddings (bge outputs are ~unit norm, but we
 * normalize defensively against zero vectors).
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Build the text we embed for a paper. Title carries the topic; abstract
 * carries the method. Truncated to stay well under the 512-token model limit.
 */
export function paperEmbedText(p) {
  const title = String(p?.title || "").trim();
  const abstract = String(p?.abstract || "").trim();
  if (!title && !abstract) return "";
  // Repeat the title once: cheap way to weight it without a second call.
  const text = (title + ". " + title + ". " + abstract).trim();
  return text.slice(0, MAX_EMBED_CHARS);
}

/**
 * Fetch embeddings for an array of texts in ONE batched call.
 * Returns array of vectors aligned with `texts`, or null on any failure.
 */
export async function getEmbeddings(env, texts, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? EMBED_TIMEOUT_MS;
  const model = opts.model ?? EMBEDDING_MODEL;
  try {
    if (!env?.AI || typeof env.AI.run !== "function") return null;
    const clean = (texts || []).map((t) => String(t || "").slice(0, MAX_EMBED_CHARS));
    if (clean.length === 0 || clean.every((t) => !t.trim())) return null;
    const run = env.AI.run(model, { text: clean });
    const res = await Promise.race([
      run,
      new Promise((_, reject) => setTimeout(() => reject(new Error("embed timeout")), timeoutMs)),
    ]);
    const data = res?.data;
    if (!Array.isArray(data) || data.length !== clean.length) return null;
    if (!data.every((v) => Array.isArray(v) && v.length > 0)) return null;
    return data;
  } catch {
    return null; // Never throw: caller falls back to keyword-only.
  }
}

/**
 * Rerank papers by semantic similarity to the query.
 *
 * @param {object} env - Worker env (needs env.AI binding).
 * @param {string} query - The user's search query.
 * @param {Array} papers - Candidate papers, each with { title, abstract, score }.
 *   `score` is the existing 0-100 keyword relevance; used as the blend input.
 * @param {object} opts - { topN, alpha, timeoutMs, model }
 * @returns {Promise<{ papers, semanticApplied, latencyMs }>} Papers sorted by
 *   blended score desc, each annotated with semanticScore (0-100),
 *   blendedScore (0-100), and keywordScore (0-100, the original).
 */
export async function semanticRerank(env, query, papers, opts = {}) {
  const t0 = Date.now();
  const topN = opts.topN ?? RERANK_TOP_N;
  const alpha = Math.max(0, Math.min(1, opts.alpha ?? DEFAULT_ALPHA));
  const list = (papers || []).slice(0, topN);
  const rest = (papers || []).slice(topN);

  const fail = (reason) => ({
    papers: (papers || []).map((p) => ({ ...p, semanticSkipped: true, semanticSkipReason: reason })),
    semanticApplied: false,
    latencyMs: Date.now() - t0,
  });

  const q = String(query || "").trim();
  if (!q || list.length === 0) return fail("empty query or papers");

  // One batched call: [query, ...paperTexts].
  const vectors = await getEmbeddings(env, [q, ...list.map(paperEmbedText)], opts);
  if (!vectors) return fail("embedding unavailable");

  const [qVec, ...pVecs] = vectors;
  const reranked = list.map((p, i) => {
    const sim = cosineSimilarity(qVec, pVecs[i]); // 0..1
    const semanticScore = Math.max(0, Math.min(100, Math.round(sim * 100)));
    const keywordScore = Math.max(0, Math.min(100, Math.round(Number(p.score ?? p.relevance ?? 50))));
    const blendedScore = Math.round(alpha * semanticScore + (1 - alpha) * keywordScore);
    return { ...p, keywordScore, semanticScore, blendedScore, score: blendedScore, relevance: blendedScore };
  });

  reranked.sort((a, b) => b.blendedScore - a.blendedScore);
  return { papers: [...reranked, ...rest], semanticApplied: true, latencyMs: Date.now() - t0 };
}

/* ---------------------------------------------------------------------------
 * INTEGRATION PLAN (for search.js — not applied by this prototype)
 *
 * 1. In gatherPapers(), after `p.relevance` is assigned (search.js ~7978) and
 *    BEFORE the relevance gate / final slice, call:
 *
 *      const { papers: reranked, semanticApplied } =
 *        await semanticRerank(env, query, scoredFinal, { topN: 20, alpha: 0.5 });
 *
 * 2. Gate it: only run when there are >= 2 candidates and the query is not a
 *    person-name search (name search uses authorship matching, not topicality —
 *    see the RELEVANCE_FLOOR comment at search.js ~285). Skip when
 *    `isPersonQuery` is true.
 *
 * 3. Cost control: one embedding call per search ≈ 20 neurons. At 10k
 *    neurons/day free tier → ~500 reranked searches/day. Add a D1-backed
 *    daily counter in costControl.js; when exhausted, skip rerank silently
 *    (keyword scores remain). Pro users could get priority when near the cap.
 *
 * 4. Cache: paper embeddings are stable per (title+abstract). Cache vectors
 *    in D1 keyed by sha256(title+abstract) with 30-day TTL → repeat searches
 *    and overlapping result sets cost ~1 embedding (the query) instead of 21.
 *
 * 5. Observability: log semanticApplied, latencyMs, and score delta
 *    (mean |blended - keyword|) to the existing search diagnostics so we can
 *    tune alpha from real traffic. Start alpha at 0.5, adjust after a week.
 *
 * 6. Safety: semanticRerank never throws and never reorders when embeddings
 *    are unavailable — the existing keyword pipeline is the fallback, so this
 *    is a strict improvement with no regression path.
 * ------------------------------------------------------------------------- */
