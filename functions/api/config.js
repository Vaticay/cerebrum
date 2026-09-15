import { getSessionUser } from "../lib/authHelpers.js";

/* ══════════════════════════════════════════════════════════════════
   Commit 91 — which variables are actually live?

   Cerebrum now reads about twenty environment variables spread across
   two dashboards, and until this endpoint existed there was no way to
   see which of them had landed. The failure mode is always the same and
   always expensive: a variable is added to Preview instead of Production,
   or saved without redeploying, or pasted with a trailing newline — and
   the only symptom is a feature quietly not working. Diagnosing TURN that
   way cost a full round trip, and there are nineteen more variables where
   that came from.

   This returns PRESENCE ONLY — a boolean per variable, never a value,
   never a prefix, never a length. There is nothing here an attacker could
   use to reconstruct a secret. It is still gated to the founder account
   (FOUNDER_EMAIL), because "which providers is this site configured with"
   is operational detail that belongs to the operator, not to visitors.

   `trimmedDiffers` is the one extra bit worth reporting: it says the value
   is present but has leading or trailing whitespace. That is the single
   most common way a pasted key fails, it is invisible in a dashboard, and
   it is not a secret — it is a typo.

   Commit 101 — this file referenced a `WATCHED` list that was never
   defined, so every request threw a ReferenceError and the endpoint always
   answered 500. The list now lives here, next to the code that reads it.
   ══════════════════════════════════════════════════════════════════ */

import { corsHeaders, readOriginAllowed, forbiddenOrigin, tooManyRequests, clientIp, privacyKey } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";

// [group, name, does, breaks]
//   group  — how the Settings UI clusters the row
//   name   — the exact Pages variable/secret name (names are not secrets)
//   does   — what the variable enables, in plain words
//   breaks — what stops working (or degrades) when it is absent
const WATCHED = [
  // ── Search & AI providers ──
  ["Search & AI", "OPENROUTER_KEY", "LLM gateway for answer synthesis", "AI answers"],
  ["Search & AI", "GROQ_KEY", "Fast-inference provider for synthesis waves", "Synthesis waves routed to Groq"],
  ["Search & AI", "GEMINI_KEY", "Google model provider for synthesis", "Synthesis waves routed to Gemini"],
  ["Search & AI", "MISTRAL_KEY", "Mistral model provider for synthesis", "Synthesis waves routed to Mistral"],
  ["Search & AI", "NVIDIA_KEY", "NVIDIA NIM model provider", "Synthesis waves routed to NVIDIA models"],
  ["Search & AI", "GITHUB_MODELS_KEY", "GitHub Models provider", "Synthesis waves routed to GitHub Models"],
  ["Search & AI", "CEREBRAS_KEY", "Cerebras fast-inference provider", "Synthesis waves routed to Cerebras"],
  ["Search & AI", "CONTEXT_MODEL", "Model name for follow-up/context generation", "Follow-up question generation"],
  ["Search & AI", "CONTEXT_CF_MODEL", "Workers AI model for context tasks", "Workers-AI-backed context tasks"],
  ["Search & AI", "NCBI_API_KEY", "NCBI E-utilities key (higher rate limits)", "PubMed lookups fall back to anonymous limits"],
  ["Search & AI", "OPENALEX_KEY", "OpenAlex key (higher rate limits)", "OpenAlex lookups fall back to anonymous limits"],
  ["Search & AI", "QUERY_KEY_SECRET", "Secret for signing internal query cache keys", "Signed query-key verification"],
  ["Search & AI", "RAW_QUERY_PURGE", "Enables purging stored raw queries (privacy)", "Raw-query purge control"],
  // ── Media ──
  ["Media", "PEXELS_KEY", "Pexels API key for background footage", "Background video search"],
  ["Media", "UNSPLASH_KEY", "Unsplash API key for imagery", "Image search"],
  ["Media", "CUSTOM_IMAGE_BASE", "Base URL for generated imagery", "Custom image generation"],
  ["Media", "TTS_PREMIUM", "Enables premium text-to-speech voices", "Premium voice options"],
  // ── Auth & sessions ──
  ["Auth & sessions", "JWT_SECRET", "Signs stateless session tokens", "Sign-in sessions"],
  ["Auth & sessions", "OTP_PEPPER", "Server secret keying one-time-code hashes", "OTP hashes fall back to an unkeyed hash"],
  ["Auth & sessions", "IP_HASH_SECRET", "Secret for hashing IPs in rate-limit keys", "Rate-limit keys use a default salt"],
  // ── Email ──
  ["Email", "RESEND_API_KEY", "Resend API key for transactional email", "Sign-in code emails"],
  ["Email", "RESEND_FROM", "Verified sender address for outgoing mail", "Falls back to noreply@askcerebrum.org"],
  ["Email", "CEREBRUM_DEV_OTP", "Dev-only: log OTP codes instead of emailing", "Local sign-in testing"],
  // ── Calls ──
  ["Calls", "TURN_KEY_ID", "Cloudflare Realtime TURN key ID", "Minted TURN relay credentials"],
  ["Calls", "TURN_KEY_API_TOKEN", "Cloudflare Realtime TURN API token", "Minted TURN relay credentials"],
  ["Calls", "TURN_URLS", "Static TURN server URLs (fallback path)", "Static TURN relay"],
  ["Calls", "TURN_USERNAME", "Static TURN username (fallback path)", "Static TURN relay"],
  ["Calls", "TURN_CREDENTIAL", "Static TURN credential (fallback path)", "Static TURN relay"],
  // ── Site & admin ──
  ["Site & admin", "FOUNDER_EMAIL", "Founder account email (admin gates)", "Founder-only diagnostics"],
  ["Site & admin", "PREVIEW_ORIGINS", "Set to 'off' to distrust Pages preview origins", "Preview-origin CORS trust"],
  ["Site & admin", "TRENDING_REFRESH_SECRET", "Secret authorizing trending refresh jobs", "Scheduled trending refresh"],
];

/* Pure report builder, exported so tests can assert the leak contract —
 * presence booleans only, never a value, prefix, or length — without a
 * request, a database, or any real secrets. */
export function buildConfigReport(env) {
  const vars = WATCHED.map(([group, name, does, breaks]) => {
    const raw = env[name];
    const present = typeof raw === "string" && raw.trim().length > 0;
    return {
      group, name, does, breaks, present,
      // Present but padded — the invisible typo.
      trimmedDiffers: present && raw !== raw.trim(),
    };
  });

  return {
    vars,
    bindings: {
      // Not variables — platform bindings, which fail differently and are
      // just as easy to forget.
      DB: !!(env.DB && typeof env.DB.prepare === "function"),
      AI: !!(env.AI && typeof env.AI.run === "function"),
      RATE_LIMIT_D1: !!(env.DB && typeof env.DB.prepare === "function"),
    },
    checkedAt: Date.now(),
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env);
  if (!readOriginAllowed(request, env)) return forbiddenOrigin(cors);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: cors });
  }

  // Founder-only, but still throttled: a credentialed probe loop against
  // this endpoint should not be free.
  const rlKey = await privacyKey("config", clientIp(request), env);
  if (!(await checkRateLimit(env, rlKey, 20, 60000))) return tooManyRequests(cors, 60);

  const founderEmail = (env.FOUNDER_EMAIL || "").trim().toLowerCase();
  let user = null;
  try { user = await getSessionUser(request, env); } catch { user = null; }
  const isFounder =
    !!user && !!founderEmail && String(user.email || "").trim().toLowerCase() === founderEmail;

  if (!isFounder) {
    // Deliberately the same shape whether you are signed out, signed in as
    // someone else, or FOUNDER_EMAIL is unset — so this cannot be used to
    // probe who the founder is. An unset FOUNDER_EMAIL fails closed: nobody
    // is the founder, including the actual operator, until it is set.
    return new Response(JSON.stringify({ error: "Not authorized." }), { status: 403, headers: cors });
  }

  return new Response(JSON.stringify(buildConfigReport(env)), { status: 200, headers: cors });
}
