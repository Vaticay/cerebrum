// Simplify endpoint: rewrites an answer one reading level down.
//
// Takes the full answer text (with citation markers like [1], [2]) and
// rewrites it in simpler language while keeping every citation marker
// exactly where it belongs. Graduate -> undergrad -> plain language.
//
// This is a rendering concern, not a retrieval one: no new search runs,
// no papers are fetched. The citations stay attached to the claims they
// support; only the prose around them gets simpler.

import { corsHeaders, requireTrustedOrigin, forbiddenOrigin, errorResponse, tooManyRequests, json, readJsonBody, clientIp } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";

function openRouterKey(env) {
  return env.OPENROUTER_KEY || env.OPENROUTER_API_KEY || "";
}

const LEVEL_PROMPTS = {
  undergrad: "Rewrite the following scientific answer for an undergraduate student. Use simpler vocabulary and shorter sentences. Explain jargon when you use it. Keep the structure and all section headers. Do NOT remove, move, or renumber any citation markers like [1], [2] — they must stay attached to the claims they support. Do not add new claims. Do not remove claims.",
  plain: "Rewrite the following scientific answer in plain language a curious non-scientist can follow. Use everyday words, short sentences, and concrete examples. Keep the structure and all section headers. Do NOT remove, move, or renumber any citation markers like [1], [2] — they must stay attached to the claims they support. Do not add new claims. Do not remove claims.",
};

export async function onRequestPost({ request, env }) {
  const cors = corsHeaders(request, env);
  if (!requireTrustedOrigin(request, env)) return forbiddenOrigin(cors);

  const ip = clientIp(request);
  const rl = await checkRateLimit(env, "simplify:" + ip, 20, 3600);
  if (!rl.ok) return tooManyRequests(cors);

  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return errorResponse(cors, 400, "bad_request", "Could not read request body.");
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const level = body.level === "plain" ? "plain" : "undergrad";
  if (!text || text.length < 50) {
    return errorResponse(cors, 400, "bad_request", "Nothing to simplify.");
  }
  if (text.length > 30000) {
    return errorResponse(cors, 400, "too_long", "Answer too long to simplify.");
  }

  const token = openRouterKey(env);
  if (!token) {
    return errorResponse(cors, 503, "no_model", "Simplification is unavailable right now.");
  }

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "HTTP-Referer": "https://askcerebrum.org",
        "X-Title": "Cerebrum",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0.3,
        max_tokens: 6000,
        messages: [
          { role: "system", content: LEVEL_PROMPTS[level] },
          { role: "user", content: text },
        ],
      }),
    });
    if (!r.ok) throw new Error("model returned " + r.status);
    const data = await r.json();
    const out = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!out || !out.trim()) throw new Error("empty simplification");
    // Safety: the rewrite must not drop citations. If more than a quarter
    // of the original markers vanished, refuse rather than ship a version
    // whose claims lost their evidence.
    const origCites = new Set((text.match(/\[\d+\]/g) || []));
    const newCites = new Set((out.match(/\[\d+\]/g) || []));
    let kept = 0;
    origCites.forEach((c) => { if (newCites.has(c)) kept += 1; });
    if (origCites.size > 0 && kept / origCites.size < 0.75) {
      throw new Error("simplification dropped citations");
    }
    return json(cors, { text: out.trim(), level });
  } catch (e) {
    console.error("[simplify] failed:", e && e.message);
    return errorResponse(cors, 502, "simplify_failed", "Could not simplify this answer right now.");
  }
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}
