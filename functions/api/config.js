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

import { corsHeaders, readOriginAllowed, forbiddenOrigin } from "../lib/http.js";

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env);
  if (!readOriginAllowed(request, env)) return forbiddenOrigin(cors);

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
