/**
 * Pro tier regressions (2026-09-15).
 *
 * The expensive mistakes live here: webhook signature verification, the
 * subscription → entitlement transitions, the lifetime-grant protection
 * clause, and the free-tier metering. Unit tests against the real exports
 * with a mock D1 — no server, no network, no Stripe.
 *
 * Run with: node tests/pro.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  FREE_AI_ANSWERS_PER_MONTH,
  isValidProPlan,
  monthKey,
  isProRow,
  resolveAiGate,
  aiSynthesisAllowed,
  recordAiAnswer,
  verifyStripeWebhookSignature,
  subscriptionTransition,
  subscriptionInterval,
  intervalToPlan,
  applyStripeEvent,
  normalizeEmail,
  validateGrantTarget,
  grantLifetimePro,
  revokeLifetimePro,
  listLifetimePros,
  priceIdForPlan,
  buildCheckoutParams,
} from "../functions/lib/proEntitlement.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

// ── Mock D1 ─────────────────────────────────────────────────────────────
// Handles exactly the SQL shapes functions/lib/proEntitlement.js issues.
// Anything else throws, so a query change that the mock doesn't know about
// fails loudly instead of silently passing.

function mockDB() {
  const users = new Map();
  const usage = new Map();
  const events = new Set();
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  return {
    _users: users,
    _usage: usage,
    _events: events,
    addUser(row) {
      users.set(row.id, {
        plan: null, pro_source: null, pro_granted_at: null, pro_interval: null,
        stripe_customer_id: null, email_lower: (row.email || "").toLowerCase(),
        ...row,
      });
    },
    async exec() {},
    prepare(sql) {
      const q = norm(sql);
      return {
        bind(...args) {
          const first = async () => {
            if (q.startsWith("SELECT plan, pro_source, pro_interval, stripe_customer_id FROM users WHERE id = ?")) {
              const r = users.get(args[0]);
              return r ? { plan: r.plan, pro_source: r.pro_source, pro_interval: r.pro_interval, stripe_customer_id: r.stripe_customer_id } : null;
            }
            if (q.startsWith("SELECT ai_answers FROM pro_usage WHERE user_id = ? AND month = ?")) {
              const n = usage.get(args[0] + "|" + args[1]);
              return n == null ? null : { ai_answers: n };
            }
            if (q.startsWith("SELECT id FROM users WHERE stripe_customer_id = ?")) {
              for (const [id, r] of users) if (r.stripe_customer_id === args[0]) return { id };
              return null;
            }
            if (q.startsWith("SELECT id, plan, pro_source FROM users WHERE email_lower = ?")) {
              for (const [id, r] of users) if (r.email_lower === args[0]) return { id, plan: r.plan, pro_source: r.pro_source };
              return null;
            }
            if (q.startsWith("INSERT INTO pro_usage") && q.includes("RETURNING ai_answers")) {
              const k = args[0] + "|" + args[1];
              const n = (usage.get(k) || 0) + 1;
              usage.set(k, n);
              return { ai_answers: n };
            }
            throw new Error("mockDB.first: unhandled: " + q.slice(0, 80));
          };
          const all = async () => {
            if (q.startsWith("SELECT email, pro_granted_at FROM users WHERE plan = 'pro'")) {
              return {
                results: [...users.values()]
                  .filter((r) => r.plan === "pro" && r.pro_source === "lifetime")
                  .map((r) => ({ email: r.email, pro_granted_at: r.pro_granted_at })),
              };
            }
            throw new Error("mockDB.all: unhandled: " + q.slice(0, 80));
          };
          const run = async () => {
            if (q === "UPDATE users SET plan = 'pro', pro_source = 'subscription', pro_interval = COALESCE(?, pro_interval) WHERE id = ? AND (pro_source IS NULL OR pro_source = 'subscription')") {
              const r = users.get(args[1]);
              if (r && (r.pro_source == null || r.pro_source === "subscription")) {
                r.plan = "pro"; r.pro_source = "subscription";
                if (args[0] != null) r.pro_interval = args[0];
              }
              return { meta: { changes: 1 } };
            }
            if (q === "UPDATE users SET plan = NULL, pro_source = NULL, pro_interval = NULL WHERE id = ? AND pro_source = 'subscription'") {
              const r = users.get(args[0]);
              if (r && r.pro_source === "subscription") { r.plan = null; r.pro_source = null; r.pro_interval = null; }
              return { meta: { changes: 1 } };
            }
            if (q === "UPDATE users SET stripe_customer_id = ? WHERE id = ?") {
              const r = users.get(args[1]);
              if (r) r.stripe_customer_id = args[0];
              return { meta: { changes: 1 } };
            }
            if (q === "UPDATE users SET plan = 'pro', pro_source = 'lifetime', pro_granted_at = ? WHERE id = ?") {
              const r = users.get(args[1]);
              if (r) { r.plan = "pro"; r.pro_source = "lifetime"; r.pro_granted_at = args[0]; }
              return { meta: { changes: 1 } };
            }
            if (q === "UPDATE users SET plan = NULL, pro_source = NULL, pro_granted_at = NULL WHERE id = ?") {
              const r = users.get(args[0]);
              if (r) { r.plan = null; r.pro_source = null; r.pro_granted_at = null; }
              return { meta: { changes: 1 } };
            }
            if (q === "INSERT OR IGNORE INTO stripe_events (event_id, received_at) VALUES (?, ?)") {
              const added = !events.has(args[0]);
              events.add(args[0]);
              return { meta: { changes: added ? 1 : 0 } };
            }
            throw new Error("mockDB.run: unhandled: " + q.slice(0, 80));
          };
          return { first, all, run };
        },
      };
    },
  };
}

const envOf = (db) => ({ DB: db });

// ── Pure helpers ──────────────────────────────────────────────────────────

await test("free cap is 15 AI answers a month", () => {
  assert.equal(FREE_AI_ANSWERS_PER_MONTH, 15);
});

await test("monthKey is UTC YYYY-MM", () => {
  assert.match(monthKey(new Date("2026-09-15T10:00:00Z")), /^\d{4}-\d{2}$/);
  assert.equal(monthKey(new Date("2026-09-15T10:00:00Z")), "2026-09");
  assert.equal(monthKey(new Date("2026-01-01T00:30:00+05:00")), "2025-12");
});

await test("plan enum is closed: monthly | annual only", () => {
  assert.ok(isValidProPlan("monthly"));
  assert.ok(isValidProPlan("annual"));
  assert.ok(!isValidProPlan("price_123"));
  assert.ok(!isValidProPlan(""));
  assert.ok(!isValidProPlan(null));
});

await test("price IDs resolve server-side from env, never from the client", () => {
  const env = { STRIPE_PRICE_MONTHLY: "price_m", STRIPE_PRICE_ANNUAL: "price_a" };
  assert.equal(priceIdForPlan(env, "monthly"), "price_m");
  assert.equal(priceIdForPlan(env, "annual"), "price_a");
  assert.equal(priceIdForPlan(env, "price_123"), "");
  assert.equal(priceIdForPlan({}, "monthly"), "");
});

await test("checkout params carry no client-chosen price", () => {
  const p = buildCheckoutParams({
    userId: "u1", email: "a@b.c", customerId: "cus_1",
    priceId: "price_m", plan: "monthly", origin: "https://askcerebrum.org",
  });
  assert.equal(p["line_items[0][price]"], "price_m");
  assert.equal(p.mode, "subscription");
  assert.equal(p["metadata[user_id]"], "u1");
  assert.equal(p["subscription_data[metadata][user_id]"], "u1");
  assert.match(p.success_url, /^https:\/\/askcerebrum\.org\/#pro=success/);
  assert.ok(p.success_url.includes("{CHECKOUT_SESSION_ID}"));
  assert.ok(p.allow_promotion_codes);
});

await test("subscription status transitions: grace on past_due, revoke only when terminal", () => {
  assert.equal(subscriptionTransition("active"), "grant");
  assert.equal(subscriptionTransition("trialing"), "grant");
  assert.equal(subscriptionTransition("past_due"), "grant");
  assert.equal(subscriptionTransition("canceled"), "revoke");
  assert.equal(subscriptionTransition("unpaid"), "revoke");
  assert.equal(subscriptionTransition("incomplete_expired"), "revoke");
  assert.equal(subscriptionTransition("incomplete"), "ignore");
  assert.equal(subscriptionTransition("paused"), "ignore");
  assert.equal(subscriptionTransition("weird_future_status"), "ignore");
});

await test("grant email validation normalizes and rejects junk", () => {
  assert.deepEqual(validateGrantTarget("  Boss@Example.COM "), { ok: true, email: "boss@example.com" });
  assert.equal(normalizeEmail("A@B.C"), "a@b.c");
  assert.ok(!validateGrantTarget("not-an-email").ok);
  assert.ok(!validateGrantTarget("").ok);
  assert.ok(!validateGrantTarget(null).ok);
  assert.ok(!validateGrantTarget("a@b").ok);
});

// ── Webhook signature ─────────────────────────────────────────────────────

function stripeTestHeader(raw, secret, t) {
  const v1 = createHmac("sha256", secret).update(t + "." + raw).digest("hex");
  return `t=${t},v1=${v1}`;
}

await test("webhook signature verifies a genuine Stripe payload", async () => {
  const secret = "whsec_test_abc";
  const raw = JSON.stringify({ id: "evt_123", type: "invoice.paid" });
  const t = Math.floor(Date.now() / 1000);
  assert.equal(await verifyStripeWebhookSignature(raw, stripeTestHeader(raw, secret, t), secret), true);
});

await test("webhook signature rejects tampered body, wrong secret, replay", async () => {
  const secret = "whsec_test_abc";
  const raw = JSON.stringify({ id: "evt_123", type: "invoice.paid" });
  const t = Math.floor(Date.now() / 1000);
  const good = stripeTestHeader(raw, secret, t);
  assert.equal(await verifyStripeWebhookSignature(raw + "tampered", good, secret), false);
  assert.equal(await verifyStripeWebhookSignature(raw, good, "whsec_wrong"), false);
  const oldT = t - 3600;
  assert.equal(await verifyStripeWebhookSignature(raw, stripeTestHeader(raw, secret, oldT), secret), false);
  assert.equal(await verifyStripeWebhookSignature(raw, "t=abc", secret), false);
  assert.equal(await verifyStripeWebhookSignature(raw, good, ""), false);
});

// ── Entitlement reads + metering ──────────────────────────────────────────

await test("anonymous caller gets no AI", async () => {
  const db = mockDB();
  const gate = await resolveAiGate(envOf(db), null);
  assert.equal(gate.kind, "anonymous");
  assert.equal(aiSynthesisAllowed(gate), false);
});

await test("pro user is unlimited", async () => {
  const db = mockDB();
  db.addUser({ id: "u1", email: "pro@x.com", plan: "pro", pro_source: "subscription" });
  const gate = await resolveAiGate(envOf(db), { id: "u1", email: "pro@x.com" });
  assert.equal(gate.kind, "pro");
  assert.equal(gate.aiCap, Infinity);
  assert.equal(aiSynthesisAllowed(gate), true);
});

await test("lifetime pro is unlimited too", async () => {
  const db = mockDB();
  db.addUser({ id: "u9", email: "vip@x.com", plan: "pro", pro_source: "lifetime" });
  const gate = await resolveAiGate(envOf(db), { id: "u9", email: "vip@x.com" });
  assert.equal(gate.kind, "pro");
  assert.equal(gate.proSource, "lifetime");
  assert.equal(aiSynthesisAllowed(gate), true);
});

await test("free user meters against the monthly bucket, cap enforced", async () => {
  const db = mockDB();
  db.addUser({ id: "u2", email: "free@x.com" });
  const env = envOf(db);
  const me = { id: "u2", email: "free@x.com" };
  let gate = await resolveAiGate(env, me);
  assert.equal(gate.kind, "free");
  assert.equal(gate.aiUsed, 0);
  assert.equal(gate.aiCap, 15);
  assert.equal(aiSynthesisAllowed(gate), true);
  for (let i = 0; i < 15; i++) await recordAiAnswer(env, "u2");
  gate = await resolveAiGate(env, me);
  assert.equal(gate.aiUsed, 15);
  assert.equal(aiSynthesisAllowed(gate), false);
});

await test("usage buckets are per-month: a new month resets", async () => {
  const db = mockDB();
  db.addUser({ id: "u3", email: "m@x.com" });
  const env = envOf(db);
  db._usage.set("u3|2026-08", 99);
  const gate = await resolveAiGate(env, { id: "u3", email: "m@x.com" });
  assert.equal(gate.aiUsed, 0);
  assert.equal(aiSynthesisAllowed(gate), true);
});

await test("isProRow only trusts plan='pro'", () => {
  assert.ok(isProRow({ plan: "pro" }));
  assert.ok(!isProRow({ plan: "free" }));
  assert.ok(!isProRow({ plan: null }));
  assert.ok(!isProRow(null));
});

// ── Webhook → entitlement transitions ─────────────────────────────────────

await test("checkout.session.completed (paid) grants Pro and links the customer", async () => {
  const db = mockDB();
  db.addUser({ id: "u4", email: "buyer@x.com" });
  const out = await applyStripeEvent(envOf(db), {
    id: "evt_1", type: "checkout.session.completed",
    data: { object: { payment_status: "paid", customer: "cus_9", metadata: { user_id: "u4" } } },
  });
  assert.equal(out.applied, true);
  const r = db._users.get("u4");
  assert.equal(r.plan, "pro");
  assert.equal(r.pro_source, "subscription");
  assert.equal(r.stripe_customer_id, "cus_9");
});

await test("subscription.deleted revokes subscription Pro", async () => {
  const db = mockDB();
  db.addUser({ id: "u5", email: "cancel@x.com", plan: "pro", pro_source: "subscription", stripe_customer_id: "cus_5" });
  const out = await applyStripeEvent(envOf(db), {
    id: "evt_2", type: "customer.subscription.deleted",
    data: { object: { customer: "cus_5", metadata: {} } },
  });
  assert.equal(out.action, "revoke");
  const r = db._users.get("u5");
  assert.equal(r.plan, null);
});

await test("subscription.created records the billing interval", async () => {
  const db = mockDB();
  db.addUser({ id: "u7", email: "annual@x.com" });
  const out = await applyStripeEvent(envOf(db), {
    id: "evt_6", type: "customer.subscription.created",
    data: { object: {
      customer: "cus_7", status: "active", metadata: { user_id: "u7" },
      items: { data: [{ price: { recurring: { interval: "year" } } }] },
    } },
  });
  assert.equal(out.applied, true);
  const r = db._users.get("u7");
  assert.equal(r.plan, "pro");
  assert.equal(r.pro_interval, "year");
  assert.equal(intervalToPlan(r.pro_interval), "annual");
});

await test("interval survives event-order races via COALESCE", async () => {
  const db = mockDB();
  // Webhook arrives first with the interval…
  db.addUser({ id: "u8", email: "race@x.com" });
  await applyStripeEvent(envOf(db), {
    id: "evt_7", type: "customer.subscription.created",
    data: { object: {
      customer: "cus_8", status: "active", metadata: { user_id: "u8" },
      items: { data: [{ price: { recurring: { interval: "month" } } }] },
    } },
  });
  // …then checkout.session.completed lands with no interval: must not wipe it.
  await applyStripeEvent(envOf(db), {
    id: "evt_8", type: "checkout.session.completed",
    data: { object: { payment_status: "paid", customer: "cus_8", metadata: { user_id: "u8" } } },
  });
  const r = db._users.get("u8");
  assert.equal(r.pro_interval, "month");
  assert.equal(intervalToPlan(r.pro_interval), "monthly");
});

await test("subscription.deleted clears the interval too", async () => {
  const db = mockDB();
  db.addUser({ id: "u9", email: "gone@x.com", plan: "pro", pro_source: "subscription", pro_interval: "year", stripe_customer_id: "cus_9" });
  await applyStripeEvent(envOf(db), {
    id: "evt_9", type: "customer.subscription.deleted",
    data: { object: { customer: "cus_9", metadata: {} } },
  });
  const r = db._users.get("u9");
  assert.equal(r.plan, null);
  assert.equal(r.pro_interval, null);
});

await test("subscriptionInterval reads subscriptions, invoices, and sessions; rejects junk", () => {
  assert.equal(subscriptionInterval({ items: { data: [{ price: { recurring: { interval: "month" } } }] } }), "month");
  assert.equal(subscriptionInterval({ items: { data: [{ price: { recurring: { interval: "year" } } }] } }), "year");
  assert.equal(subscriptionInterval({ lines: { data: [{ price: { recurring: { interval: "year" } } }] } }), "year");
  assert.equal(subscriptionInterval({ line_items: { data: [{ price: { recurring: { interval: "month" } } }] } }), "month");
  assert.equal(subscriptionInterval({ items: { data: [{ price: { recurring: { interval: "week" } } }] } }), null);
  assert.equal(subscriptionInterval({}), null);
  assert.equal(subscriptionInterval(null), null);
  assert.equal(intervalToPlan("month"), "monthly");
  assert.equal(intervalToPlan("year"), "annual");
  assert.equal(intervalToPlan(null), null);
  assert.equal(intervalToPlan("week"), null);
});

await test("webhooks can NEVER touch a lifetime grant", async () => {
  const db = mockDB();
  db.addUser({ id: "u6", email: "vip@x.com", plan: "pro", pro_source: "lifetime" });
  const env = envOf(db);
  await applyStripeEvent(env, {
    id: "evt_3", type: "customer.subscription.deleted",
    data: { object: { customer: "cus_6", metadata: { user_id: "u6" } } },
  });
  await applyStripeEvent(env, {
    id: "evt_4", type: "customer.subscription.updated",
    data: { object: { customer: "cus_6", status: "canceled", metadata: { user_id: "u6" } } },
  });
  await applyStripeEvent(env, {
    id: "evt_5", type: "invoice.paid",
    data: { object: { customer: "cus_6" } },
  });
  const r = db._users.get("u6");
  assert.equal(r.plan, "pro");
  assert.equal(r.pro_source, "lifetime");
});

await test("invoice.payment_failed keeps Pro (grace, Stripe retries)", async () => {
  const db = mockDB();
  db.addUser({ id: "u7", email: "late@x.com", plan: "pro", pro_source: "subscription", stripe_customer_id: "cus_7" });
  const out = await applyStripeEvent(envOf(db), {
    id: "evt_6", type: "invoice.payment_failed",
    data: { object: { customer: "cus_7" } },
  });
  assert.equal(out.reason, "grace-period");
  assert.equal(db._users.get("u7").plan, "pro");
});

await test("invoice.paid re-asserts Pro after a missed subscription event", async () => {
  const db = mockDB();
  db.addUser({ id: "u8", email: "renew@x.com", stripe_customer_id: "cus_8" });
  await applyStripeEvent(envOf(db), {
    id: "evt_7", type: "invoice.payment_succeeded",
    data: { object: { customer: "cus_8" } },
  });
  const r = db._users.get("u8");
  assert.equal(r.plan, "pro");
  assert.equal(r.pro_source, "subscription");
});

await test("unknown webhook types are ignored, not fatal", async () => {
  const out = await applyStripeEvent(envOf(mockDB()), { id: "evt_8", type: "charge.refunded", data: { object: {} } });
  assert.equal(out.applied, false);
});

// ── Founder lifetime grants ───────────────────────────────────────────────

await test("founder can grant and revoke permanent Pro", async () => {
  const db = mockDB();
  db.addUser({ id: "u10", email: "friend@x.com" });
  const env = envOf(db);
  const g = await grantLifetimePro(env, "Friend@X.com");
  assert.equal(g.ok, true);
  assert.equal(db._users.get("u10").pro_source, "lifetime");
  const list = await listLifetimePros(env);
  assert.equal(list.length, 1);
  assert.equal(list[0].email, "friend@x.com");
  const r = await revokeLifetimePro(env, "friend@x.com");
  assert.equal(r.ok, true);
  assert.equal(db._users.get("u10").plan, null);
});

await test("grant fails cleanly for unknown email; revoke refuses subscription Pro", async () => {
  const db = mockDB();
  db.addUser({ id: "u11", email: "sub@x.com", plan: "pro", pro_source: "subscription" });
  const env = envOf(db);
  const g = await grantLifetimePro(env, "nobody@x.com");
  assert.equal(g.ok, false);
  assert.equal(g.code, "no-account");
  const r = await revokeLifetimePro(env, "sub@x.com");
  assert.equal(r.ok, false);
  assert.equal(r.code, "not-lifetime");
  assert.equal(db._users.get("u11").plan, "pro");
});

// ── Structural: the wiring exists where it must ───────────────────────────

await test("search.js gates all three AI waves on the Pro gate", async () => {
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  const waveGuards = src.match(/if \(!aiOK && aiSynthesisAllowed[^\n]*\)/g) || [];
  assert.equal(waveGuards.length, 3, `expected 3 gated wave guards, found ${waveGuards.length}`);
  assert.match(src, /aiQuota:\s*\{/, "search response missing aiQuota");
  assert.match(src, /recordAiAnswer\(env, aiGate\.userId\)/, "AI answers not metered");
  // Wave 4 (deterministic fallback) must stay ungated — everyone gets it.
  assert.match(src, /WAVE 4 — DETERMINISTIC EXTRACTIVE SYNTHESIS/, "wave 4 marker moved?");
});

await test("pro.js verifies webhooks before parsing the body, and gates grants on the founder", async () => {
  const src = await readFile(join(root, "functions/api/pro.js"), "utf8");
  const sigBranch = src.indexOf('request.headers.get("stripe-signature")');
  const bodyParse = src.indexOf("readJsonBody(request");
  assert.ok(sigBranch !== -1 && sigBranch < bodyParse, "webhook branch must precede body parsing");
  assert.match(src, /INSERT OR IGNORE INTO stripe_events/, "webhook idempotency claim missing");
  assert.match(src, /DELETE FROM stripe_events WHERE event_id = \?/, "failed apply must release the idempotency claim so Stripe retries re-apply");
  assert.match(src, /FOUNDER_EMAIL/, "founder gate missing");
  assert.match(src, /grantLifetimePro|revokeLifetimePro/, "lifetime grant wiring missing");
  assert.match(src, /case "list-lifetime"/, "list-lifetime action missing");
  assert.match(src, /listLifetimePros\(env\)/, "list-lifetime must call listLifetimePros(env)");
  assert.ok(!src.includes("isFounderEmail"), "undefined isFounderEmail must not be referenced");
});

await test("all three founder actions deny non-founders with 403", async () => {
  const src = await readFile(join(root, "functions/api/pro.js"), "utf8");
  for (const fn of ["handleGrant", "handleRevoke", "handleListLifetime"]) {
    const start = src.indexOf(`async function ${fn}`);
    assert.ok(start !== -1, fn + " missing");
    const next = src.indexOf("async function ", start + 1);
    const body = next === -1 ? src.slice(start) : src.slice(start, next);
    assert.match(body, /founderCheck/, `${fn} must use founderCheck`);
    assert.match(body, /403/, `${fn} must deny with 403`);
  }
});

await test("auth.js GET enriches the session with isPro + isFounder", async () => {
  const src = await readFile(join(root, "functions/api/auth.js"), "utf8");
  assert.match(src, /user\.isPro/, "isPro missing from auth GET");
  assert.match(src, /user\.isFounder/, "isFounder missing from auth GET");
});

await test("schema carries the Pro columns and tables", async () => {
  const schema = await readFile(join(root, "schema.sql"), "utf8");
  for (const col of ["plan", "pro_source", "pro_granted_at", "pro_interval", "stripe_customer_id"]) {
    assert.match(schema, new RegExp(col + "\\s+TEXT|INTEGER"), `users.${col} missing from schema.sql`);
  }
  assert.match(schema, /CREATE TABLE IF NOT EXISTS pro_usage/, "pro_usage missing");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS stripe_events/, "stripe_events missing");
  const helpers = await readFile(join(root, "functions/lib/authHelpers.js"), "utf8");
  assert.match(helpers, /ADD COLUMN plan TEXT/, "self-healing ALTER for plan missing");
});

await test("frontend carries aiQuota from the search response into each turn", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /aiQuota: data\.aiQuota \|\| null/, "turn construction drops aiQuota");
});

await test("answer footnote nudges gated users toward Pro or sign-in", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /t\.aiQuota && t\.aiQuota\.gated === "free-cap"/, "free-cap nudge missing");
  assert.match(src, /t\.aiQuota && t\.aiQuota\.gated === "signin-required"/, "signin-required nudge missing");
  assert.match(src, /cb:open-pro/, "pro modal opener event missing");
  assert.match(src, /cb:open-auth/, "auth opener event missing");
});

await test("Pro palette exists and is gated to Pro members", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /Pro:\s+\{ dark: true/, "Pro palette missing from PALETTES");
  assert.match(src, /pn !== "Pro" \|\| \(user && user\.isPro\)/, "theme picker does not gate the Pro palette");
  assert.match(src, /paletteName === "Pro" && !\(user && user\.isPro\) \? "Dark" : paletteName/, "P resolution does not fall back for non-Pro");
});

await test("Pro badge renders on profile and in the account menu", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /function ProBadge/, "ProBadge component missing");
  assert.match(src, /\{user\?\.isPro && <ProBadge/, "profile badge wiring missing");
  assert.match(src, /\{user\.isPro && <ProBadge/, "account menu badge wiring missing");
});

await test("Pro reel is exclusive clips plus a gated toggle", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /FILM_CLIPS_PRO_LANDSCAPE/, "Pro landscape list missing");
  assert.match(src, /FILM_CLIPS_PRO_PORTRAIT/, "Pro portrait list missing");
  assert.match(src, /function filmReel\(pro\)/, "filmReel does not take the pro flag");
  assert.match(src, /proReel=\{\!\!\(user && user\.isPro && proReel\)\}/, "workspace film does not gate the Pro reel");
  assert.match(src, /Pro cinematic reel/, "reel toggle missing from appearance settings");
  assert.match(src, /\}, \[blocked, proReel\]\);/, "reel effect must re-run on proReel so the switch is immediate");
});

await test("settings account tab hosts the Pro section and founder grant panel", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /<ProAccountSection/, "ProAccountSection not rendered in settings");
  assert.match(src, /user\.isFounder && \(/, "founder grant panel not gated on isFounder");
  assert.match(src, /<ProGrantPanel/, "ProGrantPanel not rendered");
  assert.match(src, /function ProModal/, "ProModal missing");
});

await test("pro.js GET exposes quota and billing shapes the UI reads", async () => {
  const src = await readFile(join(root, "functions/api/pro.js"), "utf8");
  assert.match(src, /quota: \{ used: gate\.aiUsed, cap:/, "quota shape missing from GET");
  assert.match(src, /billing: \{/, "billing shape missing from GET");
  assert.match(src, /intervalToPlan\(/, "intervalToPlan not used in GET");
});

await test("checkout return is verified server-side, never trusted", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /#pro=/, "pro return hash handling missing");
  assert.match(src, /apiProPost\("verify-session"/, "verify-session not called on return");
});

await test("frontend grant panel reads the backend's { ok, email } shape", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.ok(!src.includes("${r.user.email}"), "grant panel must not interpolate r.user.email (backend returns r.email)");
  assert.match(src, /Permanent Pro granted to \$\{r\.email\}/, "grant success message must use r.email");
});

await test("search.js resolves the AI gate BEFORE every early AI path", async () => {
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  const gateAt = src.indexOf("await proLib.resolveAiGate");
  assert.ok(gateAt !== -1, "gate resolution missing");
  for (const marker of ["respondFromContext", "await answerConversationally(", "earlyHit && earlyHit.answer", "describeImage(body.image"]) {
    const at = src.indexOf(marker);
    assert.ok(at !== -1, marker + " missing");
    assert.ok(gateAt < at, `gate must precede ${marker} (quota bypass)`);
  }
  assert.match(src, /const meterAiAnswer = async/, "meterAiAnswer helper missing");
  assert.match(src, /const aiQuotaPayload = \(\)/, "aiQuotaPayload helper missing");
});

await test("search.js early AI paths are gated and metered, never a bypass", async () => {
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  // Cached answers: served only when allowed, metered when served.
  assert.match(src, /if \(earlyHit && earlyHit\.answer && aiSynthesisAllowed\)/, "early cache hit must check the gate");
  assert.match(src, /if \(cachedAnswer && cachedAnswer\.score >= 2 && aiSynthesisAllowed\)/, "pipeline cache hit must check the gate");
  // Follow-up transforms: the pure-formatting 'sources' action stays free; the rest gate + meter.
  assert.match(src, /burnsInference = action !== "sources"/, "context-action inference split missing");
  assert.match(src, /if \(burnsInference && !aiSynthesisAllowed\)/, "context follow-ups must gate");
  // Persona chat (both entry points) gates + meters.
  const personaGates = src.match(/if \(!aiSynthesisAllowed\) \{/g) || [];
  assert.ok(personaGates.length >= 2, `persona paths must gate (found ${personaGates.length})`);
  // Vision description is provider-backed AI: gated.
  assert.match(src, /openRouterKey\(env\) && aiSynthesisAllowed/, "describeImage must be gated");
});

await test("Pro badge is exposed on public identity surfaces", async () => {
  const dataSrc = await readFile(join(root, "functions/api/data.js"), "utf8");
  assert.match(dataSrc, /isPro: row\.plan === "pro"/, "public-profile must expose isPro");
  assert.match(dataSrc, /isPro: r\.plan === "pro"/, "people search must expose isPro");
  assert.match(dataSrc, /isPro: fr\.plan === "pro"/, "founder card must expose isPro");
  const uiSrc = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(uiSrc, /\{u\.isPro && <ProBadge/, "PublicProfile must render the badge");
  assert.match(uiSrc, /\{r\.isPro && <ProBadge/, "people search cards must render the badge");
  assert.match(uiSrc, /\{founder\.isPro && <ProBadge/, "founder card must render the badge");
});

await test("founder is Pro by definition via a one-time self-grant", async () => {
  const src = await readFile(join(root, "functions/api/auth.js"), "utf8");
  assert.match(src, /pro_source = 'lifetime'/, "founder self-grant must be lifetime");
  assert.match(src, /plan != 'pro'/, "self-grant must be idempotent (no-op when already pro)");
  assert.match(src, /COALESCE\(pro_granted_at/, "self-grant must not clobber an existing grant timestamp");
});

await test("Pro surfaces stay inside 320px: no fixed-width traps", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // Grant panel input: fluid, wraps with its button.
  assert.ok(!src.includes('fontFamily: "var(--cb-body)", width: 200'), "grant email input must not be a fixed 200px");
  assert.match(src, /flex: "1 1 160px"[\s\S]{0,80}maxWidth: 260/, "grant input must flex within a max width");
  // Pricing plan cards: stack on narrow screens.
  assert.match(src, /flex: "1 1 200px"/, "plan cards must wrap at 200px basis");
  // Usage meter row: wraps instead of overflowing.
  assert.match(src, /flexWrap: "wrap", justifyContent: "flex-end"/, "usage meter must wrap");
  // Theme picker: five palettes must wrap on 320px.
  assert.match(src, /flex: "1 1 100px"[\s\S]{0,220}PALETTES\[pn\]\.bg/, "theme swatches must wrap");
  // Settings rows: long emails wrap instead of pushing controls off-screen.
  assert.match(src, /overflowWrap: "anywhere"/, "UIRow labels must wrap long strings");
});

await test("lifetime list API speaks { email, granted_at }", async () => {
  const src = await readFile(join(root, "functions/lib/proEntitlement.js"), "utf8");
  assert.match(src, /granted_at: r\.pro_granted_at \|\| null/, "listLifetimePros must normalize the column to granted_at");
});

// ── Behavioral quota edges ──────────────────────────────────────────────

await test("free 14/15 allows one more; 15/15 denies (exact boundary)", async () => {
  const db = mockDB();
  db.addUser({ id: "u20", email: "edge@x.com" });
  const env = envOf(db);
  const me = { id: "u20", email: "edge@x.com" };
  for (let i = 0; i < 14; i++) await recordAiAnswer(env, "u20");
  let gate = await resolveAiGate(env, me);
  assert.equal(gate.aiUsed, 14);
  assert.equal(aiSynthesisAllowed(gate), true, "14/15 must still allow AI");
  await recordAiAnswer(env, "u20");
  gate = await resolveAiGate(env, me);
  assert.equal(gate.aiUsed, 15);
  assert.equal(aiSynthesisAllowed(gate), false, "15/15 must deny AI");
});

await test("concurrent recordAiAnswer calls never lose increments", async () => {
  const db = mockDB();
  db.addUser({ id: "u21", email: "race@x.com" });
  const env = envOf(db);
  await Promise.all(Array.from({ length: 20 }, () => recordAiAnswer(env, "u21")));
  const gate = await resolveAiGate(env, { id: "u21", email: "race@x.com" });
  assert.equal(gate.aiUsed, 20, "atomic upsert must not drop parallel increments");
  assert.equal(aiSynthesisAllowed(gate), false, "20/15 must be over the cap");
});

await test("cached AI answers are gated and charged, never a quota bypass", async () => {
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  const hit = src.indexOf("if (earlyHit && earlyHit.answer && aiSynthesisAllowed)");
  assert.ok(hit !== -1, "cache-hit serve must require aiSynthesisAllowed");
  const block = src.slice(hit, hit + 1200);
  assert.match(block, /await meterAiAnswer\(\)/, "served cache hit must charge the free bucket");
});

await test("context follow-ups (summary/explain/translate) are gated and metered", async () => {
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  assert.match(src, /const burnsInference = action !== "sources"/, "follow-up burn classification missing");
  assert.match(src, /if \(burnsInference && !aiSynthesisAllowed\)/, "follow-ups must gate on the Pro gate");
});

await test("Wave 4 never throws on a missing query: searchQuery is hoisted (regression)", async () => {
  const src = await readFile(join(root, "functions/api/search.js"), "utf8");
  // The 2026-09-15 incident: searchQuery was block-scoped inside the
  // fresh-search branch, so Wave 4's no-results path threw ReferenceError
  // whenever the AI waves were skipped (anonymous gate) or all failed.
  assert.match(src, /let searchQuery = query;/, "searchQuery must be hoisted to function scope");
  assert.ok(!src.includes("let searchQuery = resolvedSearchQuery || query;"), "block-scoped shadow must be gone");
});

await test("lifetime Pro survives EVERY Stripe event type, not just three", async () => {
  const db = mockDB();
  db.addUser({ id: "u22", email: "vip2@x.com", plan: "pro", pro_source: "lifetime" });
  const env = envOf(db);
  const events = [
    { id: "evt_20", type: "checkout.session.completed", data: { object: { payment_status: "paid", metadata: { user_id: "u22" }, customer: "cus_22" } } },
    { id: "evt_21", type: "customer.subscription.created", data: { object: { status: "active", metadata: { user_id: "u22" } } } },
    { id: "evt_22", type: "customer.subscription.updated", data: { object: { status: "past_due", metadata: { user_id: "u22" } } } },
    { id: "evt_23", type: "customer.subscription.deleted", data: { object: { metadata: { user_id: "u22" } } } },
    { id: "evt_24", type: "invoice.paid", data: { object: { customer: "cus_22" } } },
    { id: "evt_25", type: "invoice.payment_failed", data: { object: { customer: "cus_22" } } },
  ];
  for (const e of events) await applyStripeEvent(env, e);
  const r = db._users.get("u22");
  assert.equal(r.plan, "pro");
  assert.equal(r.pro_source, "lifetime");
  const gate = await resolveAiGate(env, { id: "u22", email: "vip2@x.com" });
  assert.equal(gate.kind, "pro", "lifetime grant must keep unlimited AI after every webhook");
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
