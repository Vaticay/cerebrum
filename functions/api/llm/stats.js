// GET /api/llm/stats — quality dashboard for the learning loop.
// Founder-only. Shows: which provider wins most, average quality by provider,
// quality by system prompt version, and dataset growth.
//
// Returns JSON:
// {
//   byProvider: [{ model_used, races_won, avg_quality }],
//   byPromptVersion: [{ system_prompt_version, count, avg_quality }],
//   totalRows, highQualityRows (score >= 70),
// }

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

  try {
    const byProvider = await env.DB.prepare(
      "SELECT model_used, COUNT(*) as races_won, " +
      "ROUND(AVG(quality_score), 1) as avg_quality, " +
      "MAX(created_at) as last_seen " +
      "FROM llm_training_data GROUP BY model_used " +
      "ORDER BY races_won DESC"
    ).all();

    const byPromptVersion = await env.DB.prepare(
      "SELECT system_prompt_version, COUNT(*) as count, " +
      "ROUND(AVG(quality_score), 1) as avg_quality " +
      "FROM llm_training_data GROUP BY system_prompt_version " +
      "ORDER BY system_prompt_version"
    ).all();

    const totals = await env.DB.prepare(
      "SELECT COUNT(*) as total, " +
      "SUM(CASE WHEN quality_score >= 70 THEN 1 ELSE 0 END) as high_quality " +
      "FROM llm_training_data"
    ).first();

    return new Response(JSON.stringify({
      byProvider: byProvider.results || [],
      byPromptVersion: byPromptVersion.results || [],
      totalRows: (totals && totals.total) || 0,
      highQualityRows: (totals && totals.high_quality) || 0,
      systemPromptVersion: "v1",
    }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("llm stats failed:", e);
    return errorResponse(500, "query_failed", "Couldn't read stats.", cors);
  }
}
