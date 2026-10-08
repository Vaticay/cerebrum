// GET /api/llm/export — export high-quality answers as instruction-tuning JSONL.
// Founder-only. This is the "tune the model" button: pulls the learning loop
// dataset (llm_training_data) filtered by quality score, formatted for QLoRA.
//
// Query params:
//   min_score (default 70): minimum quality_score to include
//   limit (default 1000, max 10000): max rows
//   format: "jsonl" (default) | "json"
//
// Each JSONL line: {"instruction": ..., "input": ..., "output": ...}
//   instruction: the CEREBRUM_SYSTEM_v1 prompt version tag + task
//   input: "Question: ...\n\nEvidence:\n..."
//   output: the answer text

import { corsHeaders, readOriginAllowed, forbiddenOrigin, errorResponse, unauthorized } from "../../lib/http.js";
import { getSessionUser } from "../../lib/authHelpers.js";

function isFounder(user, env) {
  const founderEmail = (env.FOUNDER_EMAIL || "").trim().toLowerCase();
  const emailLower = (user && (user.email_lower || user.email || "")).toLowerCase();
  return !!(founderEmail && emailLower && emailLower === founderEmail);
}

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env, { methods: "GET, OPTIONS" });
  if (!readOriginAllowed(request, env)) return forbiddenOrigin(cors);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") return errorResponse(405, "method_not_allowed", "Method not allowed.", cors);
  if (!env.DB) return errorResponse(503, "unavailable", "Database not available.", cors);

  const user = await getSessionUser(request, env).catch(() => null);
  if (!user || !isFounder(user, env)) return unauthorized(cors);

  const url = new URL(request.url);
  const minScore = Math.max(0, parseInt(url.searchParams.get("min_score") || "70", 10) || 70);
  const limit = Math.min(10000, Math.max(1, parseInt(url.searchParams.get("limit") || "1000", 10) || 1000));
  const format = url.searchParams.get("format") || "jsonl";

  let rows;
  try {
    rows = await env.DB.prepare(
      "SELECT question, evidence_summary, answer_text, model_used, quality_score, " +
      "system_prompt_version, answer_tier, created_at " +
      "FROM llm_training_data WHERE quality_score >= ? " +
      "ORDER BY quality_score DESC, created_at DESC LIMIT ?"
    ).bind(minScore, limit).all();
  } catch (e) {
    console.error("llm export query failed:", e);
    return errorResponse(500, "query_failed", "Couldn't read training data.", cors);
  }

  const triples = (rows.results || []).map((r) => ({
    instruction: "You are Cerebrum, a scientific research engine (system prompt " + (r.system_prompt_version || "v1") + "). Write a cited, synthesis-grade answer from the evidence.",
    input: "Question: " + (r.question || "") + "\n\nEvidence:\n" + (r.evidence_summary || ""),
    output: r.answer_text || "",
    _meta: {
      model_used: r.model_used,
      quality_score: r.quality_score,
      answer_tier: r.answer_tier,
      created_at: r.created_at,
    },
  }));

  if (format === "json") {
    return new Response(JSON.stringify({ count: triples.length, min_score: minScore, data: triples }, null, 2), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Default: JSONL, one triple per line (QLoRA-ready)
  const jsonl = triples.map((t) => JSON.stringify(t)).join("\n");
  return new Response(jsonl, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "application/jsonl",
      "Content-Disposition": 'attachment; filename="cerebrum-training-v1.jsonl"',
      "X-Export-Count": String(triples.length),
    },
  });
}
