// Simplify endpoint: rewrites an answer one reading level down.
//
// Takes the full answer text (with citation markers like [1], [2]) and
// rewrites it in simpler language while keeping every citation marker
// exactly where it belongs. Three tiers: graduate (the original) ->
// undergrad -> plain language. Each request rewrites from the original
// answer, never from a previous simplification, so quality never compounds
// downward.
//
// This is a rendering concern, not a retrieval one: no new search runs,
// no papers are fetched. The citations stay attached to the claims they
// support; only the prose around them gets simpler.

import { corsHeaders, requireTrustedOrigin, forbiddenOrigin, errorResponse, json, readJsonBody, clientIp, privacyKey } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { readSessionCookie } from "../lib/authHelpers.js";

// 20 calls per hour per bucket. checkRateLimit's window argument is
// MILLISECONDS (every other caller passes 60000 for one minute).
const SIMPLIFY_LIMIT = 20;
const SIMPLIFY_WINDOW_MS = 3600000;

function openRouterKey(env) {
  return env.OPENROUTER_KEY || env.OPENROUTER_API_KEY || "";
}

const LEVEL_PROMPTS = {
  undergrad: "Rewrite the following scientific answer for a college undergraduate who has taken intro science courses but is not a specialist. Use simpler vocabulary and shorter sentences. Define or replace graduate-level jargon with terms an undergrad would know. Aim for roughly two-thirds the length of the original — genuinely shorter, not just reworded. Keep the structure and all section headers. Do NOT remove, move, or renumber any citation markers like [1], [2] — they must stay attached to the claims they support. Do not add new claims. Do not remove claims.",
  plain: "Rewrite the following scientific answer in plain language a curious adult with no science background can follow. Use everyday words, short sentences, and a concrete analogy where one helps. A smart non-technical reader should understand every sentence on first read. Aim for roughly half the length of the original — cut ruthlessly, keep only what matters. Keep the section headers. Do NOT remove, move, or renumber any citation markers like [1], [2] — they must stay attached to the claims they support. Do not add new claims. Do not remove claims.",
};

export async function onRequestPost({ request, env }) {
  const cors = corsHeaders(request, env);
  if (!requireTrustedOrigin(request, env)) return forbiddenOrigin(cors);

  // 2026-11-06 (site debug, hostile inputs H5 and H6): this endpoint had
  // drifted from the shared lib contracts and refused every request.
  // It read checkRateLimit's boolean result as an object with an .ok
  // field (undefined on both true and false, so the 429 always fired),
  // passed its window as 3600 where the lib takes milliseconds, handed
  // the raw client IP to the limiter as a stored key, and called
  // readJsonBody, errorResponse, and json with argument orders the
  // canonical helpers do not take, so no request could ever reach the
  // model. All call sites below now match functions/lib/http.js and
  // functions/lib/rateLimit.js as the other endpoints use them.
  //
  // The bucket is the hashed client IP, like tts and videos. When the
  // caller carries a session cookie, the hashed session joins the key,
  // so people signed in behind one shared address (a classroom or an
  // office on one NAT) each get their own 20 instead of sharing one
  // bucket of 20. Anonymous callers stay on the per IP bucket, and the
  // cap itself is unchanged.
  const ipKey = await privacyKey("simplify-ip", clientIp(request), env);
  let rlKey = ipKey;
  const session = readSessionCookie(request);
  if (session) {
    rlKey = ipKey + "+" + (await privacyKey("simplify-session", session, env));
  }
  if (!(await checkRateLimit(env, rlKey, SIMPLIFY_LIMIT, SIMPLIFY_WINDOW_MS))) {
    return errorResponse(
      429,
      "rate_limited",
      "This connection has used all 20 simplifications for this hour. Please try again in the next hour.",
      { ...cors, "Retry-After": "3600" }
    );
  }

  const parsed = await readJsonBody(request, cors);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const level = body.level === "plain" ? "plain" : "undergrad";
  if (!text) {
    return errorResponse(400, "bad_request", "Nothing to simplify.", cors);
  }
  if (text.length < 50) {
    return errorResponse(400, "too_short", "That text is too short to simplify. Simplification needs at least 50 characters of text.", cors);
  }
  if (text.length > 30000) {
    return errorResponse(400, "too_long", "Answer too long to simplify.", cors);
  }

  const token = openRouterKey(env);
  if (!token) {
    return errorResponse(503, "no_model", "Simplification is unavailable right now.", cors);
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
    return json({ text: out.trim(), level }, 200, cors);
  } catch (e) {
    console.error("[simplify] failed:", e && e.message);
    return errorResponse(502, "simplify_failed", "Could not simplify this answer right now.", cors);
  }
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}
