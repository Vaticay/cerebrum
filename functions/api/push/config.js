// GET /api/push/config — the VAPID public key clients must subscribe
// with, served by the server itself.
//
// The key is public by design (it goes into PushManager.subscribe in
// every browser), so this needs no session. It exists because Settings
// used to subscribe with a copy of the key hardcoded into the client
// bundle: the moment the server key changed, or the two copies were
// ever generated separately, every subscription was created under the
// wrong key and every push failed silently at the push service. One
// source of truth, derived from the server's own private key.

import { corsHeaders, readOriginAllowed, forbiddenOrigin, errorResponse } from "../../lib/http.js";
import { vapidPublicKeyForEnv } from "../../lib/webpush.js";

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env, { methods: "GET, OPTIONS" });
  if (!readOriginAllowed(request, env)) return forbiddenOrigin(cors);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") return errorResponse(405, "method_not_allowed", "Method not allowed.", cors);
  return new Response(JSON.stringify({ publicKey: vapidPublicKeyForEnv(env) }), { status: 200, headers: cors });
}
