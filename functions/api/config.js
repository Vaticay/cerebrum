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
   ══════════════════════════════════════════════════════════════════ */

const ALLOWED_ORIGINS = [
  "https://askcerebrum.org",
  "https://www.askcerebrum.org",
  "https://cerebrum-2pz.pages.dev",
];
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.cerebrum-2pz\.pages\.dev$/i;

// group, variable name, what it does, what breaks without it
const WATCHED = [
  ["Sign-in",    "RESEND_API_KEY",     "Sends sign-in codes and magic links", "Nobody can sign in by email"],
  ["Sign-in",    "RESEND_FROM",        "The From address on those emails",    "Falls back to a default sender"],
  ["Sign-in",    "JWT_SECRET",         "Signs session tokens",                "Sessions fall back to a weaker mode"],
  ["Sign-in",    "FOUNDER_EMAIL",      "Marks the owner account",             "No founder badge or verified check"],

  ["Literature", "OPENALEX_KEY",       "Higher OpenAlex rate limit",          "Shared anonymous pool"],
  ["Literature", "NCBI_API_KEY",       "PubMed 3/sec to 10/sec",              "PubMed results drop under load"],

  ["Models",     "OPENROUTER_KEY",     "OpenRouter free models",              "That whole bucket is unavailable"],
  ["Models",     "GROQ_KEY",           "Independent quota, very fast",        "One fewer bucket"],
  ["Models",     "CEREBRAS_KEY",       "Independent quota, very fast",        "One fewer bucket"],
  ["Models",     "GEMINI_KEY",         "Independent quota",                   "One fewer bucket"],
  ["Models",     "MISTRAL_KEY",        "Independent quota",                   "One fewer bucket"],
  ["Models",     "GITHUB_MODELS_KEY",  "Independent quota",                   "One fewer bucket"],
  ["Models",     "NVIDIA_KEY",         "Independent quota",                   "One fewer bucket"],
  ["Models",     "TTS_PREMIUM",        "Paid Deepgram Aura voices",           "Free voices only (this is fine)"],

  ["Calling",    "TURN_KEY_ID",        "Cloudflare TURN relay",               "Calls fail between some networks"],
  ["Calling",    "TURN_KEY_API_TOKEN", "Cloudflare TURN relay",               "Calls fail between some networks"],

  ["Media",      "UNSPLASH_KEY",       "Last-resort card photography",        "Tonal gradient fallback"],
  ["Media",      "PEXELS_KEY",         "Last-resort card photography",        "Tonal gradient fallback"],
  ["Media",      "CUSTOM_IMAGE_BASE",  "Your own image source",               "Not used"],
];

export async function onRequest(context) {
  const { request, env } = context;
  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin =
    ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin)
      ? reqOrigin
      : "https://askcerebrum.org";
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: cors });
  }

  const founderEmail = (env.FOUNDER_EMAIL || "").trim().toLowerCase();
  let user = null;
  try { user = await getSessionUser(request, env); } catch { user = null; }
  const isFounder =
    !!user && !!founderEmail && String(user.email || "").trim().toLowerCase() === founderEmail;

  if (!isFounder) {
    // Deliberately the same shape whether you are signed out, signed in as
    // someone else, or FOUNDER_EMAIL is unset — so this cannot be used to
    // probe who the founder is.
    return new Response(JSON.stringify({ error: "Not authorized." }), { status: 403, headers: cors });
  }

  const vars = WATCHED.map(([group, name, does, breaks]) => {
    const raw = env[name];
    const present = typeof raw === "string" && raw.trim().length > 0;
    return {
      group, name, does, breaks, present,
      // Present but padded — the invisible typo.
      trimmedDiffers: present && raw !== raw.trim(),
    };
  });

  return new Response(JSON.stringify({
    vars,
    bindings: {
      // Not variables — platform bindings, which fail differently and are
      // just as easy to forget.
      DB: !!(env.DB && typeof env.DB.prepare === "function"),
      AI: !!(env.AI && typeof env.AI.run === "function"),
      RATE_LIMIT_KV: !!(env.RATE_LIMIT_KV && typeof env.RATE_LIMIT_KV.get === "function"),
    },
    checkedAt: Date.now(),
  }), { status: 200, headers: cors });
}
