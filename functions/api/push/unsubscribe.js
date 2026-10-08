// POST /api/push/unsubscribe — remove a Web Push subscription.
//
// Body: { endpoint?: string }. With an endpoint, removes just that
// browser's subscription; without, removes all of the user's (e.g. the
// "disable on all devices" case). Always 200 — unsubscribing something
// already gone is not an error.

import { corsHeaders, readOriginAllowed, forbiddenOrigin, errorResponse, unauthorized, tooManyRequests, privacyKey } from "../../lib/http.js";
import { getSessionUser } from "../../lib/authHelpers.js";
import { checkRateLimit } from "../../lib/rateLimit.js";
import { PUSH_SUBSCRIPTIONS_DDL, removePushSubscription } from "../../lib/webpush.js";

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env, { methods: "POST, OPTIONS" });
  if (!readOriginAllowed(request, env)) return forbiddenOrigin(cors);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "Method not allowed.", cors);
  if (!env.DB) return errorResponse(503, "unavailable", "Push subscriptions are not available right now.", cors);

  const user = await getSessionUser(request, env).catch(() => null);
  if (!user) return unauthorized(cors);

  const rlKey = await privacyKey("push-unsub", user.id, env);
  if (!(await checkRateLimit(env, rlKey, 20, 60000))) {
    return tooManyRequests(cors, 30);
  }

  let endpoint = null;
  try {
    const body = await request.json();
    if (body && typeof body.endpoint === "string" && body.endpoint.length < 2000) {
      endpoint = body.endpoint;
    }
  } catch { /* no body — remove all */ }

  try {
    await env.DB.exec(PUSH_SUBSCRIPTIONS_DDL);
    await removePushSubscription(env.DB, user.id, endpoint);
  } catch (e) {
    console.error("push unsubscribe failed:", e);
    return errorResponse(500, "remove_failed", "Couldn't remove the subscription.", cors);
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
}
