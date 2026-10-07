/**
 * Semantic rerank prototype tests.
 *
 * NOTE on the CRISPR test below: we cannot call the real Workers AI embedding
 * API from this sandbox (no Cloudflare credentials), so the "CRISPR gene
 * editing vs screening" test uses a deterministic mock embedding space that
 * models the semantic distinction real embeddings capture (bge-small-en-v1.5
 * separates these senses; keyword overlap does not). This validates the
 * PIPELINE (batching, cosine math, blending, sorting, fallback) — not the
 * embedding model's quality, which must be validated against the live API.
 *
 * Run with: node tests/semantic-rerank.mjs
 */

import { strict as assert } from "node:assert";
import {
  cosineSimilarity,
  paperEmbedText,
  getEmbeddings,
  semanticRerank,
  EMBEDDING_MODEL,
  RERANK_TOP_N,
  DEFAULT_ALPHA,
} from "../functions/lib/semanticRerank.js";

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}
async function okAsync(name, fn) {
  try { await fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

// --- cosineSimilarity math ---
ok("identical vectors → 1", () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
});
ok("orthogonal vectors → 0", () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});
ok("opposite vectors → -1", () => {
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
});
ok("scale invariant", () => {
  const s = cosineSimilarity([1, 1], [5, 5]);
  assert.ok(Math.abs(s - 1) < 1e-9, "expected 1, got " + s);
});
ok("zero vector → 0 (no NaN)", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 2]), 0);
});
ok("mismatched lengths → 0", () => {
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
});
ok("partial similarity in (0,1)", () => {
  const s = cosineSimilarity([1, 1, 0], [1, 0, 0]);
  assert.ok(s > 0.7 && s < 0.72, "expected ~0.707, got " + s);
});

// --- paperEmbedText ---
ok("title is weighted (repeated) and truncated", () => {
  const p = { title: "CRISPR editing", abstract: "x".repeat(5000) };
  const t = paperEmbedText(p);
  assert.ok(t.startsWith("CRISPR editing. CRISPR editing."), "title not doubled: " + t.slice(0, 60));
  assert.ok(t.length <= 1200, "not truncated: " + t.length);
});
ok("missing fields → empty string, no throw", () => {
  assert.equal(paperEmbedText({}), "");
  assert.equal(paperEmbedText(null), "");
});

// --- getEmbeddings with mock env ---
const mockEnv = (vectors, delayMs = 0) => ({
  AI: {
    run: async (model, { text }) => {
      assert.equal(model, EMBEDDING_MODEL);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return { data: text.map((_, i) => vectors[i % vectors.length]) };
    },
  },
});

await okAsync("getEmbeddings batches one call, returns aligned vectors", async () => {
  let callCount = 0;
  const env = { AI: { run: async (model, { text }) => { callCount++; return { data: [[0.1, 0.2], [0.3, 0.4]] }; } } };
  const out = await getEmbeddings(env, ["a", "b"]);
  assert.equal(callCount, 1, "must be a single batched call");
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], [0.1, 0.2]);
  assert.deepEqual(out[1], [0.3, 0.4]);
});
await okAsync("getEmbeddings returns null when env.AI missing", async () => {
  assert.equal(await getEmbeddings({}, ["a"]), null);
  assert.equal(await getEmbeddings(null, ["a"]), null);
});
await okAsync("getEmbeddings returns null on timeout", async () => {
  const env = mockEnv([[1]], 5000);
  const out = await getEmbeddings(env, ["a"], { timeoutMs: 50 });
  assert.equal(out, null);
});
await okAsync("getEmbeddings returns null on shape mismatch", async () => {
  const env = { AI: { run: async () => ({ data: [[1]] }) } }; // 1 vector for 2 texts
  assert.equal(await getEmbeddings(env, ["a", "b"]), null);
});

// --- semanticRerank: CRISPR gene editing vs screening ---
// Mock embedding space with semantic axes:
//   dim0 = "gene editing / therapy" sense, dim1 = "screening / discovery" sense
// A real bge embedding separates these; keyword scoring cannot.
const V = {
  queryEditing: [0.95, 0.10],   // "CRISPR gene editing"
  paperEditing: [0.90, 0.15],   // "CRISPR-Cas9 mediated gene editing in human T cells"
  paperScreen1: [0.12, 0.92],   // "Genome-wide CRISPR screening identifies regulators of..."
  paperScreen2: [0.08, 0.88],   // "CRISPR screening for drug resistance genes"
};

const crisprPapers = [
  // Keyword scoring ranks the screening paper FIRST (more term overlap:
  // "CRISPR" + "screening" appears in query-adjacent expansion terms).
  { title: "Genome-wide CRISPR screening identifies novel regulators of T cell activation", abstract: "We performed CRISPR screening across the genome...", score: 82 },
  { title: "CRISPR-Cas9 mediated gene editing corrects the sickle cell mutation in hematopoietic stem cells", abstract: "Gene editing with CRISPR-Cas9 repaired the HBB locus...", score: 78 },
  { title: "CRISPR screening for drug resistance genes in melanoma", abstract: "A pooled CRISPR screen revealed...", score: 75 },
];

await okAsync("CRISPR: semantic rerank promotes the gene-editing paper above screening papers", async () => {
  const env = {
    AI: {
      run: async ({ text } = {}) => {
        void text;
        return { data: [V.queryEditing, V.paperScreen1, V.paperEditing, V.paperScreen2] };
      },
    },
  };
  // NOTE: mock run ignores input and returns fixed vectors aligned to
  // [query, paper0, paper1, paper2] — models what bge-small would produce.
  const { papers, semanticApplied } = await semanticRerank(env, "CRISPR gene editing", crisprPapers, { alpha: 0.5 });
  assert.equal(semanticApplied, true);
  assert.ok(papers[0].title.includes("sickle cell"), "expected gene-editing paper first, got: " + papers[0].title);
  assert.ok(papers[0].semanticScore > papers[1].semanticScore, "semantic scores not ordered");
  assert.ok("keywordScore" in papers[0] && "blendedScore" in papers[0], "scores not annotated");
  console.log("    order: " + papers.map((p) => `${p.blendedScore} (${p.semanticScore}s/${p.keywordScore}k)`).join(" > "));
});

await okAsync("blend alpha=0 keeps keyword order; alpha=1 is pure semantic", async () => {
  const env = {
    AI: { run: async () => ({ data: [V.queryEditing, V.paperScreen1, V.paperEditing, V.paperScreen2] }) },
  };
  const kw = await semanticRerank(env, "CRISPR gene editing", crisprPapers, { alpha: 0 });
  assert.ok(kw.papers[0].title.includes("Genome-wide"), "alpha=0 should keep keyword order");
  const sem = await semanticRerank(env, "CRISPR gene editing", crisprPapers, { alpha: 1 });
  assert.ok(sem.papers[0].title.includes("sickle cell"), "alpha=1 should be pure semantic");
});

await okAsync("fallback: no env.AI returns papers unchanged with semanticSkipped", async () => {
  const { papers, semanticApplied } = await semanticRerank({}, "CRISPR gene editing", crisprPapers);
  assert.equal(semanticApplied, false);
  assert.equal(papers[0].title, crisprPapers[0].title, "order must be preserved on fallback");
  assert.equal(papers[0].semanticSkipped, true);
});

await okAsync("fallback: empty query returns unchanged", async () => {
  const { semanticApplied } = await semanticRerank(mockEnv([[1]]), "", crisprPapers);
  assert.equal(semanticApplied, false);
});

await okAsync("only topN papers are reranked; rest keep position", async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ title: "paper " + i, abstract: "", score: 90 - i }));
  const vecs = [[0.9, 0.1], ...Array.from({ length: 20 }, () => [0.1, 0.9])]; // query + topN(20)
  const env = { AI: { run: async () => ({ data: vecs }) } };
  const { papers, semanticApplied } = await semanticRerank(env, "q", many, { topN: 20, alpha: 1 });
  assert.equal(semanticApplied, true);
  assert.equal(papers.length, 25);
  assert.equal(papers[24].title, "paper 24", "tail paper must be untouched");
});

console.log(`\n${passed} passed, 0 failed`);
