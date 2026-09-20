// /api/pro — the Pro tier.
//
//   GET  /api/pro                              → subscription + quota status for the caller
//   POST /api/pro {action:"create-checkout"}   → Stripe Checkout Session URL (signed in)
//   POST /api/pro {action:"create-portal"}     → Stripe Customer Portal URL (signed in)
//   POST /api/pro {action:"verify-session"}    → close the paid-but-webhook-pending gap
//   POST /api/pro/webhook (+ Stripe-Signature) → Stripe webhook endpoint
//     (the URL configured in the Stripe Dashboard; delegates here — see
//     functions/api/pro/webhook.js — so there is one handler to audit)
//   POST /api/pro {action:"student-request-code"} → 6-digit code to a .edu email (signed in)
//   POST /api/pro {action:"student-verify-code"}  → confirm the code (signed in)
//   POST /api/pro {action:"grant"|"revoke"}   → founder-only lifetime Pro
//   POST /api/pro + Stripe-Signature header    → Stripe webhook (signature is the auth)
//
// Money only moves on Stripe's hosted pages. This endpoint never sees card
// numbers. Billing is inert until the Stripe env vars are set; every paid
// path fails closed with billing_not_configured instead of half-working.

import {
  corsHeaders, requireTrustedOrigin, forbiddenOrigin, errorResponse,
  tooManyRequests, unauthorized, json, readJsonBody, clientIp, privacyKey,
} from "../../lib/http.js";
import { checkRateLimit } from "../../lib/rateLimit.js";
import { getSessionUser } from "../../lib/authHelpers.js";
import {
  FREE_AI_ANSWERS_PER_MONTH, FREE_DOC_READS_PER_MONTH, FREE_FLOWCHARTS_PER_MONTH,
  LITE_AI_ANSWERS, LITE_DOC_READS, LITE_FLOWCHARTS,
  FREE_QUOTA_PERIOD_DAYS, periodKey, quotaResetsInMs,
  PRO_PLANS, isValidProPlan, isLiteRow, tierOfRow, capsForTier, tierForCheckoutPlan,
  ensureProTables, getUserProRow, resolveAiGate,
  getDocReads, getFlowchartCount, consumeFlowchart,
  verifyStripeWebhookSignature, verifyWebhookSignatureAny, applyStripeEvent,
  normalizeEmail, validateGrantTarget,
  grantLifetimePro, revokeLifetimePro, listLifetimePros,
  stripeRequest, priceIdForPlan, buildCheckoutParams,
  intervalToPlan, subscriptionInterval,
  isStudentEmail, issueStudentCode, checkStudentCode,
  getUsableStudentVerification, consumeStudentVerification,
} from "../../lib/proEntitlement.js";

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
    monthly: { usd: PRO_PLANS.monthly.usd, interval: "month", label: "Pro Monthly", tier: "pro" },
    annual: { usd: PRO_PLANS.annual.usd, interval: "year", label: "Pro Annual", perMonth: 12, tier: "pro" },
    student: {
      usd: PRO_PLANS.student.usd, interval: "month", label: "Pro Student", tier: "pro",
      couponMonths: PRO_PLANS.student.couponMonths,
      note: "Verified college students only. $7.99/mo for 12 months, then renews at the standard monthly price.",
    },
    // Pro Lite: the middle rung — 10x free usage, metered, none of Pro's perks.
    "lite-monthly": {
      usd: PRO_PLANS["lite-monthly"].usd, interval: "month", label: "Lite Monthly", tier: "lite",
      note: "10x the free usage. Not unlimited — and none of Pro's badge, theme, or reel.",
    },
    "lite-annual": {
      usd: PRO_PLANS["lite-annual"].usd, interval: "year", label: "Lite Annual", tier: "lite",
      perMonth: PRO_PLANS["lite-annual"].perMonth,
      note: "10x the free usage. Not unlimited — and none of Pro's badge, theme, or reel.",
    },
    freeAiCap: FREE_AI_ANSWERS_PER_MONTH,
    freeDocReadsCap: FREE_DOC_READS_PER_MONTH,
    freeFlowchartsCap: FREE_FLOWCHARTS_PER_MONTH,
    liteAiCap: LITE_AI_ANSWERS,
    liteDocReadsCap: LITE_DOC_READS,
    liteFlowchartsCap: LITE_FLOWCHARTS,
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
  const tier = tierOfRow(row); // "pro" | "lite" | "free" — the single tier readout
  const isPro = tier === "pro";
  const isLite = tier === "lite";
  const caps = capsForTier(tier);
  // Metered buckets beyond AI answers: document reads and flowchart saves.
  // Pro reports null caps (unlimited); the client renders "Unlimited".
  const docReads = isPro ? { used: 0, cap: null } : { used: await getDocReads(env, user.id), cap: caps.docs };
  const flowcharts = isPro ? { used: 0, cap: null } : { used: await getFlowchartCount(env, user.id), cap: caps.flowcharts };
  return json({
    ...base,
    signedIn: true,
    kind: gate.kind,
    tier,
    isPro,
    isLite,
    proSource: gate.proSource,
    aiUsed: gate.aiUsed,
    // null cap = unlimited (Pro). The client renders "Unlimited".
    aiCap: isPro ? null : gate.aiCap,
    // Convenience shapes for the settings UI (same values, friendlier names).
    quota: { used: gate.aiUsed, cap: isPro ? null : gate.aiCap },
    docReads,
    flowcharts,
    // Free-quota refill info: every metered bucket refills together when this
    // countdown hits zero. Pro ignores it (unlimited).
    quotaPeriod: { days: FREE_QUOTA_PERIOD_DAYS, resetsInMs: quotaResetsInMs() },
    billing: {
      plan: gate.proSource === "lifetime" ? "lifetime" : intervalToPlan(row && row.pro_interval),
      tier,
      status: row && (row.plan === "pro" || row.plan === "lite") ? "active" : "none",
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
    return errorResponse(400, "invalid_plan", "Choose a plan: monthly, annual, lite-monthly, lite-annual, or student.", cors);
  }
  const isLitePlan = plan === "lite-monthly" || plan === "lite-annual";
  const liteConfigured = !!(env.STRIPE_PRICE_LITE_MONTHLY && env.STRIPE_PRICE_LITE_ANNUAL);
  if (!isBillingConfigured(env)) {
    return errorResponse(503, "billing_not_configured", "Checkout isn't switched on yet.", cors);
  }
  if (isLitePlan && !liteConfigured) {
    return errorResponse(503, "billing_not_configured", "The Lite plan isn't switched on yet.", cors);
  }
  // Student perk: the monthly price with the student coupon applied. Requires
  // a verified, unused .edu verification bound to this account. The coupon
  // (60.05% off, repeating 12 months) comes from env — never from the client.
  let priceId = priceIdForPlan(env, plan);
  let couponId = null;
  let studentVerificationId = null;
  if (plan === "student") {
    priceId = env.STRIPE_PRICE_MONTHLY || "";
    couponId = env.STRIPE_COUPON_STUDENT || "";
    if (!couponId) {
      return errorResponse(503, "billing_not_configured", "The student plan isn't switched on yet.", cors);
    }
    const verification = await getUsableStudentVerification(env, user.id);
    if (!verification) {
      return errorResponse(403, "student_not_verified",
        "Verify your student email first — the discount unlocks after verification.", cors);
    }
    studentVerificationId = verification.id;
    // Consume first (atomic conditional UPDATE: exactly one request wins a
    // race). If Stripe then fails, the verification is released below.
    const consumed = await consumeStudentVerification(env, studentVerificationId);
    if (!consumed) {
      return errorResponse(409, "verification_used",
        "That verification was already used. Request a new code if you need one.", cors);
    }
  }
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
        priceId, plan, origin, couponId,
      }),
      // Nuance #26: a double-tapped "Upgrade" (or a retried request after a
      // dropped response) reuses the same Checkout Session within the hour
      // instead of minting a second one on Stripe's side.
      { idempotencyKey: `checkout:${user.id}:${plan}:${Math.floor(Date.now() / 3600000)}` });
    if (!session || !session.url) throw new Error("stripe_error: no checkout url");
    return json({ url: session.url }, 200, cors);
  } catch (e) {
    // Release the student verification so a Stripe failure doesn't burn the
    // one-time discount. Only this request could have consumed it (the
    // conditional UPDATE above), so clearing used_at is safe.
    if (studentVerificationId) {
      try {
        await env.DB.prepare(
          "UPDATE student_verifications SET used_at = NULL WHERE id = ?"
        ).bind(studentVerificationId).run();
      } catch { /* best effort; the row stays consumed rather than corrupt */ }
    }
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
    },
      // Nuance #26: same double-tap protection for portal sessions —
      // harmless to create twice, but pointless and noisy in Stripe logs.
      { idempotencyKey: `portal:${user.id}:${Math.floor(Date.now() / 60000)}` });
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
      // The tier comes from the checkout metadata the server itself wrote.
      // Lifetime guard included: a hand-granted row is never overwritten.
      // COALESCE keeps the webhook-set interval when this check runs first.
      const paidTier = tierForCheckoutPlan(session.metadata && session.metadata.plan);
      await env.DB.prepare(
        "UPDATE users SET plan = ?, pro_source = 'subscription', " +
          "pro_interval = COALESCE(?, pro_interval) WHERE id = ? " +
          "AND (pro_source IS NULL OR pro_source = 'subscription')"
      ).bind(paidTier, subscriptionInterval(session), user.id).run();
      return json({ isPro: paidTier === "pro", isLite: paidTier === "lite", tier: paidTier }, 200, cors);
    }
    const gate = await resolveAiGate(env, user);
    return json({ isPro: gate.kind === "pro", isLite: gate.kind === "lite", tier: gate.kind === "anonymous" ? "free" : gate.kind }, 200, cors);
  } catch (e) {
    console.error("pro verify-session:", String((e && e.message) || e).slice(0, 200));
    return errorResponse(502, "verify_failed", "Couldn't confirm that payment yet. It usually lands within a minute.", cors);
  }
}

// ── Student verification ────────────────────────────────────────────────
// The college perk: $7.99/mo for 12 months, verified through a 6-digit code
// sent to the student's academic email via Resend (same sender as sign-in
// codes). One verified discount per account, one per academic email, codes
// expire in 15 minutes and die after 5 wrong guesses.

async function sendStudentCodeEmail(env, email, code) {
  if (!env.RESEND_API_KEY) {
    console.error("student-verify: RESEND_API_KEY is not configured — cannot deliver verification codes");
    return false;
  }
  const from = env.RESEND_FROM || "Cerebrum <noreply@askcerebrum.org>";
  const html = `<div style="background:#040508;padding:48px 24px;font-family:'Space Grotesk','Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:420px;margin:0 auto;">
    <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;margin-bottom:32px;">Cerebrum&#8482;</div>
    <div style="background:#0c0e14;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:32px;">
      <div style="font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.45);margin-bottom:18px;">Your student verification code</div>
      <div style="font-size:38px;font-weight:700;letter-spacing:0.18em;color:#ffffff;font-family:'Space Grotesk',monospace;margin-bottom:18px;">${code}</div>
      <div style="font-size:14px;line-height:1.6;color:rgba(255,255,255,0.7);">Enter this in Cerebrum to unlock the student price — $7.99/mo for 12 months. This code expires in 15 minutes and can only be used once. If you didn't request this, you can safely ignore this email.</div>
    </div>
    <div style="font-size:12px;color:rgba(255,255,255,0.35);margin-top:24px;line-height:1.6;">Cerebrum is a research instrument that searches real scholarly databases. This is an automated message — replies aren't monitored.</div>
  </div>
</div>`;
  try {
    const { fetchWithTimeout } = await import("../../lib/resilience.js");
    const res = await fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: email, subject: "Your Cerebrum student verification code", html }),
    }, 12000);
    if (!res.ok) {
      const detail = await res.text().catch(() => "<unreadable response body>");
      console.error("student code email rejected by Resend:", res.status, detail);
    }
    return res.ok;
  } catch (e) {
    console.error("student code email threw:", e);
    return false;
  }
}

async function handleStudentRequestCode(request, env, cors, body) {
  let user = null;
  try { user = await getSessionUser(request, env); } catch { user = null; }
  if (!user) return unauthorized(cors);
  const rlKey = await privacyKey("pro-student-code", user.id, env);
  if (!(await checkRateLimit(env, rlKey, 5, 3600000))) return tooManyRequests(cors, 3600);
  const email = body && typeof body.email === "string" ? body.email.trim() : "";
  if (!isStudentEmail(email)) {
    return errorResponse(400, "not_student_email",
      "That doesn't look like a college email — it needs to end in .edu (or .ac.uk).", cors);
  }
  if (!isBillingConfigured(env)) {
    return errorResponse(503, "billing_not_configured", "Checkout isn't switched on yet.", cors);
  }
  const issued = await issueStudentCode(env, user.id, email);
  if (!issued.ok) {
    if (issued.reason === "already_verified") {
      return errorResponse(409, "already_verified",
        "That email already has its student discount — one per student email.", cors);
    }
    return errorResponse(409, "already_verified",
      "This account already has a verified student discount — one per account.", cors);
  }
  const sent = await sendStudentCodeEmail(env, normalizeEmail(email), issued.code);
  if (!sent) {
    return errorResponse(502, "code_send_failed",
      "Couldn't send the code. Check the address and try again in a moment.", cors);
  }
  return json({ ok: true, sentTo: normalizeEmail(email) }, 200, cors);
}

async function handleStudentVerifyCode(request, env, cors, body) {
  let user = null;
  try { user = await getSessionUser(request, env); } catch { user = null; }
  if (!user) return unauthorized(cors);
  const rlKey = await privacyKey("pro-student-verify", user.id, env);
  if (!(await checkRateLimit(env, rlKey, 10, 60000))) return tooManyRequests(cors, 60);
  const email = body && typeof body.email === "string" ? body.email.trim() : "";
  const code = body && typeof body.code === "string" ? body.code.trim() : "";
  if (!isStudentEmail(email) || !/^\d{6}$/.test(code)) {
    return errorResponse(400, "invalid_code", "Enter the 6-digit code we sent to your college email.", cors);
  }
  const result = await checkStudentCode(env, user.id, email, code);
  if (!result.ok) {
    const messages = {
      expired: "That code expired — request a fresh one.",
      too_many_attempts: "Too many wrong tries — request a fresh code.",
      wrong_code: "That code doesn't match — check and try again.",
      no_pending_code: "No active code for that email — request one first.",
    };
    const status = result.reason === "wrong_code" ? 400 : 410;
    return errorResponse(status, result.reason, messages[result.reason] || "Verification failed.", cors);
  }
  return json({ ok: true, verified: true }, 200, cors);
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

// Nuance #26 — the old handler verified, claimed the event id, applied the
// entitlement SYNCHRONOUSLY, and only then returned. Stripe's delivery clock
// runs during our D1 writes: a slow apply risks Stripe's timeout, and a
// duplicate delivery racing the first could only be contained by deleting an
// already-acknowledged claim row on failure — exactly the wrong shape once
// the 200 has gone out.
//
// New shape:
//   1. verify signature (HMAC is the auth — no origin gate, same as before)
//   2. atomically claim the event id (INSERT OR IGNORE — the race guard)
//   3. return 200 IMMEDIATELY
//   4. apply the entitlement in the background via context.waitUntil
//   5. the claim row carries a status (pending → processed | failed), so an
//      event that fails AFTER we acknowledged it is a visible dead letter,
//      not a silent drop — Stripe will never resend it.
//
// ensureStripeEventStatusColumn runs an idempotent ALTER TABLE so D1
// databases created before this column existed self-heal on first delivery.
async function ensureStripeEventStatusColumn(env) {
  for (const ddl of [
    "ALTER TABLE stripe_events ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE stripe_events ADD COLUMN error TEXT",
  ]) {
    try { await env.DB.prepare(ddl).run(); }
    catch (e) {
      // "duplicate column name" is the expected steady state — the column
      // already exists. Anything else is worth hearing about but must not
      // fail the webhook: the status writes below are best-effort.
      if (!/duplicate column/i.test(String((e && e.message) || e))) {
        console.error("pro webhook: stripe_events migration:", String((e && e.message) || e).slice(0, 200));
      }
    }
  }
}

async function handleWebhook(context, cors) {
  const { request, env } = context;
  if (!env.DB) {
    return errorResponse(503, "no_db", "No database.", cors);
  }
  const sig = request.headers.get("stripe-signature") || "";
  const raw = await request.text();
  // Stripe signs test-mode events with the test endpoint secret and live
  // events with the live one. Accept either configured secret so a single
  // endpoint serves both modes — a valid HMAC is still required.
  const secrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_WEBHOOK_SECRET_TEST].filter(Boolean);
  if (!(await verifyWebhookSignatureAny(raw, sig, secrets))) {
    return errorResponse(400, "bad_signature", "Bad signature.", cors);
  }
  let event;
  try { event = JSON.parse(raw); } catch {
    return errorResponse(400, "bad_payload", "Bad payload.", cors);
  }
  if (!event || !event.id) return errorResponse(400, "bad_payload", "Bad payload.", cors);
  try {
    await ensureProTables(env);
    await ensureStripeEventStatusColumn(env);
    // Claim the event id FIRST: a retried delivery that arrives while the
    // first is still applying must not double-apply the transition.
    const claimed = await env.DB.prepare(
      "INSERT OR IGNORE INTO stripe_events (event_id, received_at, status) VALUES (?, ?, 'pending')"
    ).bind(event.id, Date.now()).run();
    const changes = claimed && claimed.meta ? claimed.meta.changes : 0;
    if (changes === 0) {
      // A concurrent duplicate, or a Stripe retry. One exception: an event
      // whose previous attempt FAILED is re-armed so the retry can actually
      // apply — swallowing it as "duplicate" would cement the failure.
      let priorStatus = null;
      try {
        const row = await env.DB.prepare(
          "SELECT status FROM stripe_events WHERE event_id = ?"
        ).bind(event.id).first();
        priorStatus = row && row.status;
      } catch {}
      if (priorStatus !== "failed") {
        return json({ received: true, duplicate: true }, 200, cors);
      }
      try {
        await env.DB.prepare(
          "UPDATE stripe_events SET status = 'pending', error = NULL WHERE event_id = ?"
        ).bind(event.id).run();
      } catch {}
    }
    // The background settlement: apply the entitlement AFTER the 200.
    // Stripe's retry clock is the enemy here — the 200 below lands in
    // milliseconds while D1 does the real work on waitUntil time.
    const settle = (async () => {
      try {
        await applyStripeEvent(env, event);
        try {
          await env.DB.prepare(
            "UPDATE stripe_events SET status = 'processed', error = NULL WHERE event_id = ?"
          ).bind(event.id).run();
        } catch {}
      } catch (applyErr) {
        // Stripe will NOT retry after the 200 we already sent, so a failure
        // here would be a silent drop without the dead letter below: the
        // claim row keeps the error, and this structured log is the alert.
        const errMsg = String((applyErr && applyErr.message) || applyErr).slice(0, 500);
        try {
          await env.DB.prepare(
            "UPDATE stripe_events SET status = 'failed', error = ? WHERE event_id = ?"
          ).bind(errMsg, event.id).run();
        } catch { /* best effort — the log below is the backstop */ }
        console.error(JSON.stringify({
          level: "error",
          kind: "stripe_webhook_dlq",
          event_id: event.id,
          event_type: event.type || null,
          error: errMsg.slice(0, 300),
          hint: "Reconcile via the Stripe Dashboard (resend event) or POST /api/pro {action:\"verify-session\"} for checkout events.",
        }));
      }
    })();
    if (context && typeof context.waitUntil === "function") {
      context.waitUntil(settle);
    } else {
      // Outside the worker runtime (tests, direct invocation) there is no
      // waitUntil — settle inline so behavior stays observable.
      await settle;
    }
    return json({ received: true }, 200, cors);
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
    return handleWebhook(context, cors);
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
    case "student-request-code": return handleStudentRequestCode(request, env, cors, parsed.body);
    case "student-verify-code": return handleStudentVerifyCode(request, env, cors, parsed.body);
    case "grant": return handleGrant(request, env, cors, parsed.body);
    case "revoke": return handleRevoke(request, env, cors, parsed.body);
    case "list-lifetime": return handleListLifetime(request, env, cors);
    case "flowchart-allow": return handleFlowchartAllow(request, env, cors);
    default:
      return errorResponse(400, "unknown_action", "Unknown action.", cors);
  }
}

// ── POST: flowchart-allow (signed in) ─────────────────────────────────────
// The client calls this when a free user saves a NEW flowchart (re-saving an
// existing chart never touches this endpoint). Pro is always allowed.
// Free accounts get FREE_FLOWCHARTS_PER_MONTH new charts per quota period;
// the increment is atomic with the allowance check.
async function handleFlowchartAllow(request, env, cors) {
  let user = null;
  try { user = await getSessionUser(request, env); } catch { user = null; }
  if (!user) {
    return errorResponse(401, "auth_required", "Sign in to save flowcharts.", cors);
  }
  const gate = await resolveAiGate(env, user);
  const tier = gate.kind === "pro" ? "pro" : gate.kind === "lite" ? "lite" : "free";
  if (tier === "pro") {
    return json({ ok: true, allowed: true, pro: true, used: 0, cap: null }, 200, cors);
  }
  // Free accounts get FREE_FLOWCHARTS_PER_MONTH new charts per quota period
  // (Lite 10). The allowance check and the increment are ONE atomic consume:
  // concurrent saves can never overshoot the cap.
  const cap = capsForTier(tier).flowcharts;
  const consumed = await consumeFlowchart(env, user.id, cap);
  if (!consumed.allowed) {
    return json({
      ok: true, allowed: false, used: consumed.used, cap, tier,
      message: tier === "lite"
        ? "You've used your 10 Lite flowcharts for these 5 days. Pro saves unlimited flowcharts."
        : "Free accounts can save 1 flowchart every 5 days. Lite saves 10 — Pro saves unlimited.",
    }, 200, cors);
  }
  return json({ ok: true, allowed: true, used: consumed.used, cap, tier }, 200, cors);
}

// ── POST: list-lifetime (founder only) ─────────────────────────────────────
async function handleListLifetime(request, env, cors) {
  const { isFounder } = await founderCheck(request, env);
  if (!isFounder) {
    return new Response(JSON.stringify({ error: "Not authorized." }), { status: 403, headers: cors });
  }
  return json({ lifetime: await listLifetimePros(env) }, 200, cors);
}
