// POST /api/pro/webhook — the Stripe webhook endpoint.
//
// This is the URL configured in the Stripe Dashboard (test and live modes),
// so it must accept deliveries. The one real webhook implementation lives in
// ./index.js (POST /api/pro with a stripe-signature header); this route
// rewrites the path and delegates, so there is exactly one handler to audit.
// The raw body and the stripe-signature header pass through untouched — the
// HMAC covers the body bytes, not the URL, so verification is unaffected.
import { onRequest as handlePro } from "./index.js";

export function webhookRequestFor(request) {
  const url = new URL(request.url);
  url.pathname = "/api/pro";
  return new Request(url, request);
}

export async function onRequest(context) {
  return handlePro({ ...context, request: webhookRequestFor(context.request) });
}
