// /api/pro — the Pro tier.
//
//   GET  /api/pro                              → subscription + quota status for the caller
//   POST /api/pro {action:"create-checkout"}   → Stripe Checkout Session URL (signed in)
//   POST /api/pro {action:"create-portal"}     → Stripe Customer Portal URL (signed in)
//   POST /api/pro {action:"verify-session"}    → close the paid-but-webhook-pending gap
//   POST /api/pro {action:"grant"|"revoke"}   → founder-only lifetime Pro
//   POST /api/pro + Stripe-Signature header    → Stripe webhook (signature is the auth)
//
// Money only moves on Stripe's hosted pages. This endpoint never sees card
// numbers. Billing is inert until the Stripe env vars are set; every paid
// path fails closed with billing_not_configured instead of half-working.

import {
  corsHeaders, requireTrustedOrigin, forbiddenOrigin, errorResponse,
  tooManyRequests, unauthorized, json, readJsonBody, clientIp, privacyKey,
} from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { getSessionUser } from "../lib/authHelpers.js";
import {
  FREE_AI_ANSWERS_PER_MONTH, PRO_PLANS, isValidProPlan,
  ensureProTables, getUserProRow, resolveAiGate,
  verifyStripeWebhookSignature, applyStripeEvent,
  normalizeEmail, validateGrantTarget,
  grantLifetimePro, revokeLifetimePro, listLifetimePros,
  stripeRequest, priceIdForPlan, buildCheckoutParams,
  intervalToPlan, subscriptionInterval,
} from "../lib/proEntitlement.js";

function isBillingConfigured(env) {
  return !!(
    env.STRIPE_SECRET_KEY &&
    env.STRIPE_PRICE_MONTHLY &&
    env.STRIPE_PRICE_ANNUAL
  );
}

// Same founder gate as config.js / data.js: the FOUNDER_EMAIL env var is the
// entire allowlist, and the 403 shape is identical for signed-out, wrong-user,
// and unset — not probeable.
async function founderCheck(request, env) {
  const founderEmail = (env.FOUNDER_EMAIL || "").trim().toLowerCase();
  let user = null;
  try { user = await getSessionUser(request, env); } catch { user = null; }
  const isFounder =
    !!user && !!founderEmail &&
    String(user.email || "").trim().toLowerCase() === founderEmail;
  return { isFounder, user };
}

function publicPlans() {
  return {
    monthly: { usd: PRO_PLANS.monthly.usd, interval: "month", label: "Pro Monthly" },
    annual: { usd: PRO_PLANS.annual.usd, interval: "year", label: "Pro Annual", perMonth: 12 },
    freeAiCap: FREE_AI_ANSWERS_PER_MONTH,
  };
}

// ── GET: status ───────────────────────────────────────────────────────────

async function handleStatus(request, env, cors) {
  let user = null;
  try { user = await getSessionUser(request, env); } catch { user = null; }
  const base = { proConfigured: isBillingConfigured(env), plans: publicPlans() };
  if (!user) {
    return json({ ...base, signedIn: false, kind: "anonymous", isPro: false, aiUsed: 0, aiCap: 0 }, 200, cors);
  }
  const gate = await resolveAiGate(env, user);
  const row = await getUserProRow(env, user.id);
  const isPro = gate.kind === "pro";
  return json({
    ...base,
    signedIn: true,
    kind: gate.kind,
    isPro,
    proSource: gate.proSource,
    aiUsed: gate.aiUsed,
    // null cap = unlimited (Pro). The client renders "Unlimited".
    aiCap: isPro ? null : gate.aiCap,
    // Convenience shapes for the settings UI (same values, friendlier names).
    quota: { used: gate.aiUsed, cap: isPro ? null : gate.aiCap },
    billing: {
      plan: gate.proSource === "lifetime" ? "lifetime" : intervalToPlan(row && row.pro_interval),
      status: row && row.plan === "pro" ? "active" : "none",
    },
    hasBilling: !!(row && row.stripe_customer_id),
  }, 200, cors);
}

// ── Stripe helpers ────────────────────────────────────────────────────────

async function findOrCreateCustomer(env, user, row) {
  if (row && row.stripe_customer_id) return row.stripe_customer_id;
  const customer = await stripeRequest(env, "POST", "/customers", {
    email: user.email,
    "metadata[user_id]": user.id,
  });
  if (!customer || !customer.id) throw new Error("stripe_error: customer create failed");
  await env.DB.prepare(
    "UPDATE users SET stripe_customer_id = ? WHERE id = ?"
  ).bind(customer.id, user.id).run();
  return customer.id;
}

// ── POST: create-checkout ─────────────────────────────────────────────────

async function handleCreateCheckout(request, env, cors, body) {
  let user = null;
  try { user = await getSessionUser(request, env); } catch { user = null; }
  if (!user) return unauthorized(cors);
  const rlKey = await privacyKey("pro-checkout", user.id, env);
  if (!(await checkRateLimit(env, rlKey, 10, 60000))) return tooManyRequests(cors, 60);

  const plan = body && body.plan;
  if (!isValidProPlan(plan)) {
    return errorResponse(400, "invalid_plan", "Choose a plan: monthly or annual.", cors);
  }
  if (!isBillingConfigured(env)) {
    return errorResponse(503, "billing_not_configured", "Checkout isn't switched on yet.", cors);
  }
  const priceId = priceIdForPlan(env, plan);
  if (!priceId) {
    return errorResponse(503, "billing_not_configured", "That plan has no price configured.", cors);
  }
  try {
    const row = await getUserProRow(env, user.id);
    const customerId = await findOrCreateCustomer(env, user, row);
    const origin = new URL(request.url).origin;
    const session = await stripeRequest(env, "POST", "/checkout/sessions",
      buildCheckoutParams({
        userId: user.id, email: user.email, customerId,
        priceId, plan, origin,
      }));
    if (!session || !session.url) throw new Error("stripe_error: no checkout url");
    return json({ url: session.url }, 200, cors);
  } catch (e) {
    const msg = String((e && e.message) || "");
    if (msg.startsWith("stripe_not_configured") || msg.startsWith("stripe_error")) {
      console.error("pro checkout:", msg.slice(0, 200));
      return errorResponse(502, "checkout_failed", "Couldn't start checkout. Try again in a moment.", cors);
    }
    throw e;
  }
}

// ── POST: create-portal ───────────────────────────────────────────────────

async function handleCreatePortal(request, env, cors) {
  let user = null;
  try { user = await getSessionUser(request, env); } catch { user = null; }
  if (!user) return unauthorized(cors);
  const rlKey = await privacyKey("pro-portal", user.id, env);
  if (!(await checkRateLimit(env, rlKey, 10, 60000))) return tooManyRequests(cors, 60);
  if (!isBillingConfigured(env)) {
    return errorResponse(503, "billing_not_configured", "Billing isn't switched on yet.", cors);
  }
  const row = await getUserProRow(env, user.id);
  if (!row || !row.stripe_customer_id) {
    return errorResponse(400, "no_subscription", "No billing account on file.", cors);
  }
  try {
    const origin = new URL(request.url).origin;
    const portal = await stripeRequest(env, "POST", "/billing_portal/sessions", {
      customer: row.stripe_customer_id,
      return_url: origin + "/#pro=portal",
    });
    if (!portal || !portal.url) throw new Error("stripe_error: no portal url");
    return json({ url: portal.url }, 200, cors);
  } catch (e) {
    console.error("pro portal:", String((e && e.message) || e).slice(0, 200));
    return errorResponse(502, "portal_failed", "Couldn't open billing management. Try again in a moment.", cors);
  }
}

// ── POST: verify-session ──────────────────────────────────────────────────
// Closes the "paid, but the webhook hasn't landed yet" gap: after Stripe
// redirects back to the success hash, the client calls this with the
// session_id and the SERVER asks Stripe whether that session actually paid.
// Never trust the redirect alone.
async function handleVerifySession(request, env, cors, body) {
  let user = null;
  try { user = await getSessionUser(request, env); } catch { user = null; }
  if (!user) return unauthorized(cors);
  const sessionId = body && typeof body.session_id === "string" ? body.session_id.trim() : "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return errorResponse(400, "invalid_session", "That checkout session doesn't look right.", cors);
  }
  if (!isBillingConfigured(env)) {
    return errorResponse(503, "billing_not_configured", "Billing isn't switched on yet.", cors);
  }
  try {
    const session = await stripeRequest(env, "GET", "/checkout/sessions/" + encodeURIComponent(sessionId) + "?expand[]=line_items.data.price");
    const paid = session && session.payment_status === "paid";
    const forMe = session && session.metadata && session.metadata.user_id === user.id;
    if (paid && forMe) {
      const customerId = typeof session.customer === "string" ? session.customer : (session.customer && session.customer.id);
      if (customerId) {
        await env.DB.prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?")
          .bind(customerId, user.id).run();
      }
      // Lifetime guard included: a hand-granted row is never overwritten.
      // COALESCE keeps the webhook-set interval when this check runs first.
      await env.DB.prepare(
        "UPDATE users SET plan = 'pro', pro_source = 'subscription', " +
          "pro_interval = COALESCE(?, pro_interval) WHERE id = ? " +
          "AND (pro_source IS NULL OR pro_source = 'subscription')"
      ).bind(subscriptionInterval(session), user.id).run();
      return json({ isPro: true }, 200, cors);
    }
    const gate = await resolveAiGate(env, user);
    return json({ isPro: gate.kind === "pro" }, 200, cors);
  } catch (e) {
    console.error("pro verify-session:", String((e && e.message) || e).slice(0, 200));
    return errorResponse(502, "verify_failed", "Couldn't confirm that payment yet. It usually lands within a minute.", cors);
  }
}

// ── POST: grant / revoke (founder only) ───────────────────────────────────

async function handleGrant(request, env, cors, body) {
  const { isFounder } = await founderCheck(request, env);
  if (!isFounder) {
    return new Response(JSON.stringify({ error: "Not authorized." }), { status: 403, headers: cors });
  }
  const rlKey = await privacyKey("pro-grant", clientIp(request), env);
  if (!(await checkRateLimit(env, rlKey, 20, 60000))) return tooManyRequests(cors, 60);
  const v = validateGrantTarget(body && body.email);
  if (!v.ok) return errorResponse(400, "invalid_email", v.message, cors);
  const result = await grantLifetimePro(env, v.email);
  if (!result.ok) return errorResponse(404, result.code, result.message, cors);
  const lifetime = await listLifetimePros(env);
  return json({ ok: true, email: v.email, already: result.already, lifetime }, 200, cors);
}

async function handleRevoke(request, env, cors, body) {
  const { isFounder } = await founderCheck(request, env);
  if (!isFounder) {
    return new Response(JSON.stringify({ error: "Not authorized." }), { status: 403, headers: cors });
  }
  const rlKey = await privacyKey("pro-grant", clientIp(request), env);
  if (!(await checkRateLimit(env, rlKey, 20, 60000))) return tooManyRequests(cors, 60);
  const v = validateGrantTarget(body && body.email);
  if (!v.ok) return errorResponse(400, "invalid_email", v.message, cors);
  const result = await revokeLifetimePro(env, v.email);
  if (!result.ok) return errorResponse(400, result.code, result.message, cors);
  const lifetime = await listLifetimePros(env);
  return json({ ok: true, email: v.email, lifetime }, 200, cors);
}

// ── Stripe webhook ────────────────────────────────────────────────────────

async function handleWebhook(request, env, cors) {
  if (!env.DB) {
    return errorResponse(503, "no_db", "No database.", cors);
  }
  const secret = env.STRIPE_WEBHOOK_SECRET || "";
  const sig = request.headers.get("stripe-signature") || "";
  const raw = await request.text();
  if (!secret || !(await verifyStripeWebhookSignature(raw, sig, secret))) {
    return errorResponse(400, "bad_signature", "Bad signature.", cors);
  }
  let event;
  try { event = JSON.parse(raw); } catch {
    return errorResponse(400, "bad_payload", "Bad payload.", cors);
  }
  if (!event || !event.id) return errorResponse(400, "bad_payload", "Bad payload.", cors);
  try {
    await ensureProTables(env);
    // Claim the event id FIRST: a retried delivery that arrives while the
    // first is still applying must not double-apply the transition.
    const claimed = await env.DB.prepare(
      "INSERT OR IGNORE INTO stripe_events (event_id, received_at) VALUES (?, ?)"
    ).bind(event.id, Date.now()).run();
    const changes = claimed && claimed.meta ? claimed.meta.changes : 0;
    if (changes === 0) return json({ received: true, duplicate: true }, 200, cors);
    let outcome;
    try {
      outcome = await applyStripeEvent(env, event);
    } catch (applyErr) {
      // The claim above must not become a tombstone: if applying failed, a
      // Stripe retry must be allowed to re-apply instead of being swallowed
      // as a "duplicate". Release the claim, then report the failure (500
      // tells Stripe to retry).
      try {
        await env.DB.prepare("DELETE FROM stripe_events WHERE event_id = ?").bind(event.id).run();
      } catch { /* best effort — the 500 below still triggers a Stripe retry */ }
      throw applyErr;
    }
    return json({ received: true, outcome }, 200, cors);
  } catch (e) {
    console.error("pro webhook:", String((e && e.message) || e).slice(0, 300));
    // 500 tells Stripe to retry; the idempotency claim above makes retries safe.
    return errorResponse(500, "webhook_failed", "Webhook failed.", cors);
  }
}

// ── Router ────────────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env, { methods: "GET, POST, OPTIONS" });
  if (request.method === "OPTIONS") {
    if (!requireTrustedOrigin(request, env)) return forbiddenOrigin(cors);
    return new Response(null, { status: 204, headers: cors });
  }

  // Webhooks arrive from Stripe's servers, not our origin. The HMAC signature
  // is the authentication here, so this branch deliberately skips the origin
  // gate — but it must come BEFORE any body parsing, because verification
  // needs the exact raw bytes.
  if (request.method === "POST" && request.headers.get("stripe-signature")) {
    return handleWebhook(request, env, cors);
  }

  if (!requireTrustedOrigin(request, env)) return forbiddenOrigin(cors);
  if (request.method === "GET") return handleStatus(request, env, cors);
  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Method not allowed.", cors);
  }
  const parsed = await readJsonBody(request, cors, 32_000);
  if (!parsed.ok) return parsed.response;
  const action = parsed.body && parsed.body.action;

  switch (action) {
    case "create-checkout": return handleCreateCheckout(request, env, cors, parsed.body);
    case "create-portal": return handleCreatePortal(request, env, cors);
    case "verify-session": return handleVerifySession(request, env, cors, parsed.body);
    case "grant": return handleGrant(request, env, cors, parsed.body);
    case "revoke": return handleRevoke(request, env, cors, parsed.body);
    case "list-lifetime": return handleListLifetime(request, env, cors);
    default:
      return errorResponse(400, "unknown_action", "Unknown action.", cors);
  }
}

// ── POST: list-lifetime (founder only) ─────────────────────────────────────
async function handleListLifetime(request, env, cors) {
  const { isFounder } = await founderCheck(request, env);
  if (!isFounder) {
    return new Response(JSON.stringify({ error: "Not authorized." }), { status: 403, headers: cors });
  }
  return json({ lifetime: await listLifetimePros(env) }, 200, cors);
}
