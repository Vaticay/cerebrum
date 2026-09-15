// Pro tier — entitlements, AI-answer metering, and Stripe webhook verification.
//
// Design (2026-09-15):
//   - Stripe is the billing ledger, NOT the entitlement source. "Is Pro"
//     lives on the users row (plan='pro'), kept in sync by Stripe webhooks.
//     Enforcement reads the row at request time — no live Stripe calls in
//     the hot path.
//   - AI synthesis is the metered resource. Free accounts get
//     FREE_AI_ANSWERS_PER_MONTH AI answers per UTC calendar month, tracked
//     in pro_usage. Pro (paid or lifetime) is unlimited. Anonymous callers
//     get no AI synthesis at all — there is no identity to meter against —
//     and fall through to the deterministic Wave-4 extractive answer.
//   - Lifetime grants (the founder handing Pro to specific people, no
//     subscription involved) are stored as plan='pro', pro_source='lifetime'.
//     Webhook handlers must NEVER downgrade or overwrite a lifetime row.
//   - Webhook signature verification is hand-rolled on Web Crypto (no stripe
//     npm dependency): HMAC-SHA256 over "<t>.<rawBody>", timing-safe compare,
//     5-minute replay tolerance. Works in Workers and in node tests.
//
// Pure functions are exported so tests/pro.mjs can exercise them with no DB.

export const FREE_AI_ANSWERS_PER_MONTH = 15;

// Display metadata for the two paid plans. The actual money lives in Stripe
// Price objects; these IDs come from env (STRIPE_PRICE_MONTHLY /
// STRIPE_PRICE_ANNUAL) and are whitelisted server-side — the client only ever
// sends "monthly" | "annual", never a price ID.
export const PRO_PLANS = {
  monthly: { label: "Pro Monthly", usd: 20, interval: "month" },
  annual: { label: "Pro Annual", usd: 144, interval: "year", perMonth: 12 },
};

export function isValidProPlan(plan) {
  return plan === "monthly" || plan === "annual";
}

// ── Schema ────────────────────────────────────────────────────────────────

let _proTablesEnsured = false;
export async function ensureProTables(env) {
  if (_proTablesEnsured || !env || !env.DB) return;
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS pro_usage (" +
      "user_id TEXT NOT NULL, " +
      "month TEXT NOT NULL, " +
      "ai_answers INTEGER NOT NULL DEFAULT 0, " +
      "PRIMARY KEY (user_id, month))"
  );
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS stripe_events (" +
      "event_id TEXT PRIMARY KEY, " +
      "received_at INTEGER NOT NULL)"
  );
  _proTablesEnsured = true;
}

// New columns on users — appended to the self-healing ALTER list in
// authHelpers.js ensureUserProfileColumns (SQLite has no ADD COLUMN IF NOT
// EXISTS, so the existing try/swallow-duplicate pattern covers it).
export const USER_PRO_COLUMNS = [
  "ALTER TABLE users ADD COLUMN plan TEXT",
  "ALTER TABLE users ADD COLUMN pro_source TEXT",
  "ALTER TABLE users ADD COLUMN pro_granted_at INTEGER",
  "ALTER TABLE users ADD COLUMN pro_interval TEXT",
  "ALTER TABLE users ADD COLUMN stripe_customer_id TEXT",
];

// ── Month key ─────────────────────────────────────────────────────────────

// UTC calendar month: the free AI-answer bucket resets on the 1st.
export function monthKey(d = new Date()) {
  const iso = d instanceof Date ? d.toISOString() : new Date(d).toISOString();
  return iso.slice(0, 7);
}

// ── Entitlement reads ─────────────────────────────────────────────────────

export function isProRow(row) {
  return !!row && row.plan === "pro";
}

export async function getUserProRow(env, userId) {
  if (!env || !env.DB || !userId) return null;
  await ensureProTables(env);
  try {
    return await env.DB.prepare(
      "SELECT plan, pro_source, pro_interval, stripe_customer_id FROM users WHERE id = ?"
    ).bind(userId).first();
  } catch {
    return null;
  }
}

// Billing interval off a Stripe subscription, invoice, or expanded checkout
// session: 'month' | 'year' | null. Only the two intervals we sell are honored.
export function subscriptionInterval(obj) {
  try {
    const items = obj && (
      obj.items ? obj.items.data
        : obj.lines ? obj.lines.data
          : obj.line_items ? obj.line_items.data
            : null
    );
    const price = items && items[0] && items[0].price;
    const iv = price && price.recurring && price.recurring.interval;
    return iv === "month" || iv === "year" ? iv : null;
  } catch {
    return null;
  }
}

// 'month' → 'monthly', 'year' → 'annual' — the plan names the product uses.
export function intervalToPlan(interval) {
  return interval === "year" ? "annual" : interval === "month" ? "monthly" : null;
}

// The single choke point for "may this caller burn AI inference?".
// Returns { kind, userId, aiUsed, aiCap, proSource } where kind is one of:
//   "pro"       — unlimited AI synthesis
//   "free"      — AI synthesis until aiUsed >= aiCap this month
//   "anonymous" — no AI synthesis (no identity to meter)
export async function resolveAiGate(env, sessionUser) {
  const base = {
    kind: "anonymous",
    userId: null,
    aiUsed: 0,
    aiCap: FREE_AI_ANSWERS_PER_MONTH,
    proSource: null,
  };
  if (!sessionUser || !sessionUser.id) return base;
  const row = await getUserProRow(env, sessionUser.id);
  if (isProRow(row)) {
    return {
      kind: "pro",
      userId: sessionUser.id,
      aiUsed: 0,
      aiCap: Infinity,
      proSource: row.pro_source || "subscription",
    };
  }
  let used = 0;
  try {
    await ensureProTables(env);
    const u = await env.DB.prepare(
      "SELECT ai_answers FROM pro_usage WHERE user_id = ? AND month = ?"
    ).bind(sessionUser.id, monthKey()).first();
    used = u && typeof u.ai_answers === "number" ? u.ai_answers : 0;
  } catch {
    used = 0;
  }
  return { ...base, kind: "free", userId: sessionUser.id, aiUsed: used };
}

export function aiSynthesisAllowed(gate) {
  if (!gate) return false;
  if (gate.kind === "pro") return true;
  if (gate.kind === "free") return gate.aiUsed < gate.aiCap;
  return false;
}

// Atomically consume one AI answer from the caller's monthly bucket.
// Returns the new count. Check-then-act racy by design: worst case under
// heavy concurrency a free user lands one or two answers over the cap —
// immaterial for a soft product cap, and the atomic upsert means the count
// itself never loses increments.
export async function recordAiAnswer(env, userId) {
  await ensureProTables(env);
  const row = await env.DB.prepare(
    "INSERT INTO pro_usage (user_id, month, ai_answers) VALUES (?, ?, 1) " +
      "ON CONFLICT (user_id, month) DO UPDATE SET ai_answers = ai_answers + 1 " +
      "RETURNING ai_answers"
  ).bind(userId, monthKey()).first();
  return row && typeof row.ai_answers === "number" ? row.ai_answers : 1;
}

// ── Stripe webhook signature (Web Crypto, no SDK) ─────────────────────────

export async function verifyStripeWebhookSignature(rawBody, sigHeader, secret, opts = {}) {
  try {
    if (!rawBody || !sigHeader || !secret) return false;
    const parts = {};
    for (const piece of String(sigHeader).split(",")) {
      const i = piece.indexOf("=");
      if (i > 0) parts[piece.slice(0, i).trim()] = piece.slice(i + 1).trim();
    }
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) return false;
    const nowSec = Math.floor((opts.nowMs != null ? opts.nowMs : Date.now()) / 1000);
    if (Math.abs(nowSec - Number(t)) > (opts.toleranceSec != null ? opts.toleranceSec : 300)) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(t + "." + rawBody)
    );
    const hex = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (hex.length !== v1.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

// ── Subscription status → entitlement transition ──────────────────────────

// past_due keeps Pro: Stripe retries the payment, and yanking access during a
// retry window is how you manufacture angry "I paid!" support tickets.
// Downgrade happens only on terminal states (deleted/canceled/unpaid).
export function subscriptionTransition(status) {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
      return "grant";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "revoke";
    default:
      return "ignore";
  }
}

// ── Webhook → D1 ──────────────────────────────────────────────────────────

// Applies one verified Stripe event to the entitlement store. Idempotency is
// enforced by the caller via stripe_events (event.id claimed BEFORE apply).
// Lifetime rows are sacred: no webhook path may touch a row whose
// pro_source = 'lifetime'.
export async function applyStripeEvent(env, event) {
  await ensureProTables(env);
  const type = event && event.type;
  const obj = event && event.data && event.data.object ? event.data.object : {};
  if (!type || !obj) return { applied: false, reason: "malformed" };

  const userIdByCustomer = async (customerId) => {
    if (!customerId) return null;
    const r = await env.DB.prepare(
      "SELECT id FROM users WHERE stripe_customer_id = ?"
    ).bind(customerId).first();
    return r ? r.id : null;
  };
  const grantSubscriptionPro = async (userId, interval) => {
    if (!userId) return { applied: false, reason: "no-user" };
    // The pro_source guard is the lifetime-protection clause: a row the
    // founder granted by hand is never overwritten by billing events.
    // COALESCE keeps a known interval when an event arrives without one
    // (checkout.session.completed fires before subscription.created).
    await env.DB.prepare(
      "UPDATE users SET plan = 'pro', pro_source = 'subscription', " +
        "pro_interval = COALESCE(?, pro_interval) WHERE id = ? " +
        "AND (pro_source IS NULL OR pro_source = 'subscription')"
    ).bind(interval || null, userId).run();
    return { applied: true, action: "grant", userId };
  };
  const revokeSubscriptionPro = async (userId) => {
    if (!userId) return { applied: false, reason: "no-user" };
    await env.DB.prepare(
      "UPDATE users SET plan = NULL, pro_source = NULL, pro_interval = NULL WHERE id = ? AND pro_source = 'subscription'"
    ).bind(userId).run();
    return { applied: true, action: "revoke", userId };
  };

  switch (type) {
    case "checkout.session.completed": {
      const userId = (obj.metadata && obj.metadata.user_id) || null;
      const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer && obj.customer.id;
      if (userId && customerId) {
        await env.DB.prepare(
          "UPDATE users SET stripe_customer_id = ? WHERE id = ?"
        ).bind(customerId, userId).run();
      }
      // Money moved (payment_status=paid) → grant immediately; the
      // subscription.created event that follows confirms it. This closes the
      // "paid but webhook hasn't arrived" gap alongside the client-side
      // verify-session check.
      if (userId && obj.payment_status === "paid") {
        return grantSubscriptionPro(userId);
      }
      return { applied: !!userId, action: "link-customer", userId };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const userId =
        (obj.metadata && obj.metadata.user_id) ||
        (await userIdByCustomer(typeof obj.customer === "string" ? obj.customer : null));
      const t = subscriptionTransition(obj.status);
      if (t === "grant") return grantSubscriptionPro(userId, subscriptionInterval(obj));
      if (t === "revoke") return revokeSubscriptionPro(userId);
      return { applied: false, reason: "status-ignored", status: obj.status };
    }
    case "customer.subscription.deleted": {
      const userId =
        (obj.metadata && obj.metadata.user_id) ||
        (await userIdByCustomer(typeof obj.customer === "string" ? obj.customer : null));
      return revokeSubscriptionPro(userId);
    }
    case "invoice.paid":
    case "invoice.payment_succeeded": {
      // Renewal safety net: if a subscription webhook was ever missed, a
      // successful invoice payment re-asserts Pro. Both event names are
      // handled — API versions differ on which one fires.
      const customerId = typeof obj.customer === "string" ? obj.customer : null;
      const userId = await userIdByCustomer(customerId);
      if (!userId) return { applied: false, reason: "no-user" };
      await env.DB.prepare(
        "UPDATE users SET plan = 'pro', pro_source = 'subscription', " +
          "pro_interval = COALESCE(?, pro_interval) " +
          "WHERE id = ? AND (pro_source IS NULL OR pro_source = 'subscription')"
      ).bind(subscriptionInterval(obj), userId).run();
      return { applied: true, action: "grant", userId };
    }
    case "invoice.payment_failed": {
      // Grace: Stripe retries automatically. Access stays until the
      // subscription itself transitions to a terminal state.
      return { applied: false, reason: "grace-period" };
    }
    default:
      return { applied: false, reason: "unhandled-type" };
  }
}

// ── Founder lifetime grants ───────────────────────────────────────────────

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function validateGrantTarget(email) {
  const e = normalizeEmail(email);
  if (!e || e.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
    return { ok: false, message: "That doesn't look like an email address." };
  }
  return { ok: true, email: e };
}

// Permanent Pro, by the founder's hand only. No Stripe involvement — this is
// a local entitlement, which is exactly why webhooks can never revoke it.
export async function grantLifetimePro(env, email) {
  await ensureProTables(env);
  const target = await env.DB.prepare(
    "SELECT id, plan, pro_source FROM users WHERE email_lower = ?"
  ).bind(normalizeEmail(email)).first();
  if (!target) return { ok: false, code: "no-account", message: "No Cerebrum account uses that email yet." };
  await env.DB.prepare(
    "UPDATE users SET plan = 'pro', pro_source = 'lifetime', pro_granted_at = ? WHERE id = ?"
  ).bind(Date.now(), target.id).run();
  return { ok: true, userId: target.id, already: target.plan === "pro" };
}

export async function revokeLifetimePro(env, email) {
  await ensureProTables(env);
  const target = await env.DB.prepare(
    "SELECT id, plan, pro_source FROM users WHERE email_lower = ?"
  ).bind(normalizeEmail(email)).first();
  if (!target) return { ok: false, code: "no-account", message: "No Cerebrum account uses that email." };
  if (target.pro_source !== "lifetime") {
    return {
      ok: false,
      code: "not-lifetime",
      message:
        target.plan === "pro"
          ? "That account's Pro comes from a paid subscription — manage it in Stripe, not here."
          : "That account isn't Pro, so there's nothing to revoke.",
    };
  }
  await env.DB.prepare(
    "UPDATE users SET plan = NULL, pro_source = NULL, pro_granted_at = NULL WHERE id = ?"
  ).bind(target.id).run();
  return { ok: true, userId: target.id };
}

export async function listLifetimePros(env, limit = 50) {
  await ensureProTables(env);
  const rows = await env.DB.prepare(
    "SELECT email, pro_granted_at FROM users WHERE plan = 'pro' AND pro_source = 'lifetime' ORDER BY pro_granted_at DESC LIMIT ?"
  ).bind(Math.min(Math.max(limit, 1), 200)).all();
  // Normalize to the public contract { email, granted_at }: the column is
  // pro_granted_at in D1, but the API speaks granted_at.
  return ((rows && rows.results) || []).map((r) => ({
    email: r.email,
    granted_at: r.pro_granted_at || null,
  }));
}

// ── Stripe REST (raw fetch, no SDK) ────────────────────────────────────────

const STRIPE_API = "https://api.stripe.com/v1";

function stripeForm(params) {
  const body = new URLSearchParams();
  const append = (key, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => append(`${key}[${i}]`, v));
    } else if (typeof value === "object") {
      for (const k of Object.keys(value)) append(`${key}[${k}]`, value[k]);
    } else {
      body.append(key, String(value));
    }
  };
  for (const k of Object.keys(params || {})) append(k, params[k]);
  return body.toString();
}

export async function stripeRequest(env, method, path, params) {
  const key = env.STRIPE_SECRET_KEY || "";
  if (!key) throw new Error("stripe_not_configured");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(STRIPE_API + path, {
      method,
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: method === "GET" ? undefined : stripeForm(params),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || `Stripe ${res.status}`;
      throw new Error("stripe_error: " + msg);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function priceIdForPlan(env, plan) {
  if (plan === "monthly") return env.STRIPE_PRICE_MONTHLY || "";
  if (plan === "annual") return env.STRIPE_PRICE_ANNUAL || "";
  return "";
}

// Pure builder: Checkout Session params for a plan. The price ID is resolved
// server-side from the plan enum — a client can never choose its own price.
export function buildCheckoutParams({ userId, email, customerId, priceId, plan, origin }) {
  return {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": 1,
    customer: customerId || undefined,
    customer_email: customerId ? undefined : email,
    "metadata[user_id]": userId,
    "metadata[plan]": plan,
    "subscription_data[metadata][user_id]": userId,
    "subscription_data[metadata][plan]": plan,
    allow_promotion_codes: true,
    success_url: origin + "/#pro=success&session_id={CHECKOUT_SESSION_ID}",
    cancel_url: origin + "/#pro=cancelled",
  };
}
