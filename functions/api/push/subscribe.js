// POST /api/push/subscribe — store a Web Push subscription for the
// signed-in user.
//
// The browser creates the subscription via PushManager.subscribe() (see
// the "Background notifications" row in Settings → Privacy & data), then
// POSTs it here. The server validates the shape (endpoint must be https,
// keys must decode to the right lengths) before storing — a malformed
// subscription would fail at send time, so reject it at write time.
//
// The push_subscriptions table is created idempotently here; this endpoint
// is the only writer, so self-healing here covers the whole feature.

import { corsHeaders, readOriginAllowed, forbiddenOrigin, errorResponse, unauthorized, tooManyRequests, privacyKey } from "../../lib/http.js";
import { getSessionUser } from "../../lib/authHelpers.js";
import { checkRateLimit } from "../../lib/rateLimit.js";
import { PUSH_SUBSCRIPTIONS_DDL, validatePushSubscription, storePushSubscription } from "../../lib/webpush.js";

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env, { methods: "POST, OPTIONS" });
  if (!readOriginAllowed(request, env)) return forbiddenOrigin(cors);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "Method not allowed.", cors);
  if (!env.DB) return errorResponse(503, "unavailable", "Push subscriptions are not available right now.", cors);

  const user = await getSessionUser(request, env).catch(() => null);
  if (!user) return unauthorized(cors);

  const rlKey = await privacyKey("push-sub", user.id, env);
  if (!(await checkRateLimit(env, rlKey, 20, 60000))) {
    return tooManyRequests(cors, 30);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "bad_request", "Invalid JSON.", cors);
  }
  let sub;
  try {
    sub = validatePushSubscription(body && body.subscription);
  } catch (e) {
    return errorResponse(400, "bad_subscription", e && e.message ? e.message : "Invalid subscription.", cors);
  }

  try {
    await env.DB.exec(PUSH_SUBSCRIPTIONS_DDL);
    await storePushSubscription(env.DB, user.id, sub);
  } catch (e) {
    console.error("push subscribe failed:", e);
    return errorResponse(500, "store_failed", "Couldn't save the subscription.", cors);
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
}
