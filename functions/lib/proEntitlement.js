// Pro tier — entitlements, AI-answer metering, and Stripe webhook verification.
//
// Design (2026-09-15):
//   - Stripe is the billing ledger, NOT the entitlement source. "Is Pro"
//     lives on the users row (plan='pro'), kept in sync by Stripe webhooks.
//     Enforcement reads the row at request time — no live Stripe calls in
//     the hot path.
//   - AI synthesis is a metered resource. Free accounts get
//     FREE_AI_ANSWERS_PER_MONTH AI answers per quota period (a fixed
//     FREE_QUOTA_PERIOD_DAYS-day grid), tracked in pro_usage. Pro (paid or
//     lifetime) is unlimited. Anonymous callers get no AI synthesis at all —
//     there is no identity to meter against — and fall through to the
//     deterministic Wave-4 extractive answer.
//   - Lifetime grants (the founder handing Pro to specific people, no
//     subscription involved) are stored as plan='pro', pro_source='lifetime'.
//     Webhook handlers must NEVER downgrade or overwrite a lifetime row.
//   - Webhook signature verification is hand-rolled on Web Crypto (no stripe
//     npm dependency): HMAC-SHA256 over "<t>.<rawBody>", timing-safe compare,
//     5-minute replay tolerance. Works in Workers and in node tests.
//
// Pure functions are exported so tests/pro.mjs can exercise them with no DB.

export const FREE_AI_ANSWERS_PER_MONTH = 15;
// Notebook Mode (document analysis) and Flowchart Studio are metered the
// same way: free accounts get a small quota-period bucket, Pro is unlimited.
// These caps are product policy set by Dusty (2026-09-15): 3 document reads
// and 1 saved flowchart per quota period on the free tier.
export const FREE_DOC_READS_PER_MONTH = 3;
export const FREE_FLOWCHARTS_PER_MONTH = 1;

// ── Pro Lite ──────────────────────────────────────────────────────────────
// The middle rung, set by Dusty (2026-09-15): $3.99/mo or $39/yr for 10x
// the free usage. Metered, never unlimited, and none of Pro's perks (no PRO
// badge, no exclusive theme, no Pro reel). It is a bigger tank, not a
// smaller Pro — the upsell to full Pro stays intact.
export const LITE_AI_ANSWERS = 150;
export const LITE_DOC_READS = 30;
export const LITE_FLOWCHARTS = 10;

export function isLiteRow(row) {
  return !!row && row.plan === "lite";
}

// "pro" | "lite" | "free" — the single tier readout for a user row.
export function tierOfRow(row) {
  if (isProRow(row)) return "pro";
  if (isLiteRow(row)) return "lite";
  return "free";
}

// Per-quota-period caps for a tier. Pro is Infinity (unlimited).
export function capsForTier(tier) {
  if (tier === "pro") return { ai: Infinity, docs: Infinity, flowcharts: Infinity };
  if (tier === "lite") return { ai: LITE_AI_ANSWERS, docs: LITE_DOC_READS, flowcharts: LITE_FLOWCHARTS };
  return { ai: FREE_AI_ANSWERS_PER_MONTH, docs: FREE_DOC_READS_PER_MONTH, flowcharts: FREE_FLOWCHARTS_PER_MONTH };
}

// Checkout plan name → paid tier. Student rides the monthly price with a
// coupon but grants full Pro.
export function tierForCheckoutPlan(plan) {
  if (plan === "lite-monthly" || plan === "lite-annual") return "lite";
  return "pro";
}

// Stripe price ID → paid tier, for webhook events that only carry a price.
// Unknown IDs return null (the caller falls back to the row's existing tier,
// then to "pro" to preserve the pre-Lite behavior).
export function tierForPriceId(env, priceId) {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_LITE_MONTHLY || priceId === env.STRIPE_PRICE_LITE_ANNUAL) return "lite";
  if (priceId === env.STRIPE_PRICE_MONTHLY || priceId === env.STRIPE_PRICE_ANNUAL) return "pro";
  return null;
}

// Display metadata for the two paid plans. The actual money lives in Stripe
// Price objects; these IDs come from env (STRIPE_PRICE_MONTHLY /
// STRIPE_PRICE_ANNUAL) and are whitelisted server-side — the client only ever
// sends "monthly" | "annual", never a price ID.
export const PRO_PLANS = {
  monthly: { label: "Pro Monthly", usd: 20, interval: "month", tier: "pro" },
  annual: { label: "Pro Annual", usd: 144, interval: "year", perMonth: 12, tier: "pro" },
  // Student perk: the monthly price with the STRIPE_COUPON_STUDENT coupon
  // (60.05% off, repeating 12 months) applied — $7.99/mo for 12 months, then
  // the subscription renews at the standard monthly price automatically.
  student: { label: "Pro Student", usd: 7.99, interval: "month", couponMonths: 12, tier: "pro" },
  // Pro Lite: the middle rung — 10x free usage, metered, no Pro perks.
  "lite-monthly": { label: "Lite Monthly", usd: 3.99, interval: "month", tier: "lite" },
  "lite-annual": { label: "Lite Annual", usd: 39, interval: "year", perMonth: 3.25, tier: "lite" },
};

export function isValidProPlan(plan) {
  return plan === "monthly" || plan === "annual" || plan === "student" ||
    plan === "lite-monthly" || plan === "lite-annual";
}

// ── Student verification ────────────────────────────────────────────────

// Academic domains accepted for the student perk. Kept intentionally short:
// .edu covers US colleges; ac.uk covers UK universities. Expand deliberately.
const STUDENT_DOMAIN_SUFFIXES = [".edu", ".ac.uk"];

export function isStudentEmail(email) {
  const addr = String(email || "").trim().toLowerCase();
  const at = addr.lastIndexOf("@");
  if (at < 1 || at === addr.length - 1) return false;
  if (addr.length > 254 || /\s/.test(addr)) return false;
  const domain = addr.slice(at);
  return STUDENT_DOMAIN_SUFFIXES.some((suf) => domain === suf || domain.endsWith(suf));
}

export const STUDENT_CODE_TTL_MS = 15 * 60 * 1000;
export const STUDENT_CODE_MAX_ATTEMPTS = 5;

async function sha256Hex(str) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newStudentCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += String(byte % 10);
  return out;
}

export function newStudentSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Issue (or re-issue) a verification code for a student's .edu email. Any
// previous unverified code for this user+email is replaced; a verified or
// consumed email can never be re-issued (UNIQUE(email) enforces one discount
// per academic email, and the verified check enforces one per account).
export async function issueStudentCode(env, userId, email) {
  await ensureProTables(env);
  const addr = normalizeEmail(email);
  const now = Date.now();
  const existing = await env.DB.prepare(
    "SELECT id, verified_at, used_at FROM student_verifications WHERE email = ?"
  ).bind(addr).first();
  if (existing && (existing.verified_at || existing.used_at)) {
    return { ok: false, reason: "already_verified" };
  }
  const alreadyVerifiedForUser = await env.DB.prepare(
    "SELECT id FROM student_verifications WHERE user_id = ? AND verified_at IS NOT NULL AND used_at IS NULL"
  ).bind(userId).first();
  if (alreadyVerifiedForUser) {
    return { ok: false, reason: "user_already_verified" };
  }
  await env.DB.prepare(
    "DELETE FROM student_verifications WHERE user_id = ? AND email = ? AND verified_at IS NULL"
  ).bind(userId, addr).run();
  const code = newStudentCode();
  const salt = newStudentSalt();
  const id = `stu_${salt.slice(0, 12)}`;
  try {
    await env.DB.prepare(
      "INSERT INTO student_verifications (id, user_id, email, code_hash, code_salt, attempts, expires_at, created_at) " +
        "VALUES (?, ?, ?, ?, ?, 0, ?, ?)"
    ).bind(id, userId, addr, await sha256Hex(salt + ":" + code), salt, now + STUDENT_CODE_TTL_MS, now).run();
  } catch {
    // Another account holds this email (UNIQUE race) — same opaque outcome.
    return { ok: false, reason: "already_verified" };
  }
  return { ok: true, code, id };
}

export async function checkStudentCode(env, userId, email, code) {
  await ensureProTables(env);
  const addr = normalizeEmail(email);
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT id, code_hash, code_salt, attempts, expires_at, verified_at FROM student_verifications " +
      "WHERE user_id = ? AND email = ?"
  ).bind(userId, addr).first();
  if (!row || row.verified_at) return { ok: false, reason: "no_pending_code" };
  if (row.expires_at <= now) {
    await env.DB.prepare("DELETE FROM student_verifications WHERE id = ?").bind(row.id).run();
    return { ok: false, reason: "expired" };
  }
  if (row.attempts >= STUDENT_CODE_MAX_ATTEMPTS) {
    await env.DB.prepare("DELETE FROM student_verifications WHERE id = ?").bind(row.id).run();
    return { ok: false, reason: "too_many_attempts" };
  }
  const guess = await sha256Hex(row.code_salt + ":" + String(code || "").trim());
  if (guess !== row.code_hash) {
    await env.DB.prepare(
      "UPDATE student_verifications SET attempts = attempts + 1 WHERE id = ?"
    ).bind(row.id).run();
    return { ok: false, reason: "wrong_code" };
  }
  await env.DB.prepare(
    "UPDATE student_verifications SET verified_at = ? WHERE id = ?"
  ).bind(now, row.id).run();
  return { ok: true };
}

// Fetch the caller's verified, unused student verification (for checkout).
export async function getUsableStudentVerification(env, userId) {
  await ensureProTables(env);
  return await env.DB.prepare(
    "SELECT id, email, verified_at FROM student_verifications " +
      "WHERE user_id = ? AND verified_at IS NOT NULL AND used_at IS NULL " +
      "ORDER BY verified_at DESC LIMIT 1"
  ).bind(userId).first();
}

// Single-use: mark the verification consumed only if still unused. Returns
// true when this call actually consumed it (conditional UPDATE ⇒ the
// check-and-consume is atomic under SQLite's write serialization).
export async function consumeStudentVerification(env, verificationId) {
  await ensureProTables(env);
  const res = await env.DB.prepare(
    "UPDATE student_verifications SET used_at = ? WHERE id = ? AND used_at IS NULL"
  ).bind(Date.now(), verificationId).run();
  return (res.meta.changes || 0) > 0;
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
      "doc_reads INTEGER NOT NULL DEFAULT 0, " +
      "flowcharts INTEGER NOT NULL DEFAULT 0, " +
      "PRIMARY KEY (user_id, month))"
  );
  // Self-healing: databases created before the doc_reads / flowcharts
  // columns existed get them here. A duplicate-column error means the
  // column is already there — swallow it like the users-table ALTERs below.
  for (const ddl of [
    "ALTER TABLE pro_usage ADD COLUMN doc_reads INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE pro_usage ADD COLUMN flowcharts INTEGER NOT NULL DEFAULT 0",
  ]) {
    try { await env.DB.exec(ddl); } catch { /* already exists */ }
  }
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS stripe_events (" +
      "event_id TEXT PRIMARY KEY, " +
      "received_at INTEGER NOT NULL)"
  );
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS student_verifications (" +
      "id TEXT PRIMARY KEY, " +
      "user_id TEXT NOT NULL, " +
      "email TEXT NOT NULL UNIQUE, " +
      "code_hash TEXT NOT NULL, " +
      "code_salt TEXT NOT NULL, " +
      "attempts INTEGER NOT NULL DEFAULT 0, " +
      "expires_at INTEGER NOT NULL, " +
      "verified_at INTEGER, " +
      "used_at INTEGER, " +
      "created_at INTEGER NOT NULL)"
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

// UTC calendar month. Kept as a pure utility; the free-quota buckets below
// no longer use it (they run on the 5-day period grid instead).
export function monthKey(d = new Date()) {
  const iso = d instanceof Date ? d.toISOString() : new Date(d).toISOString();
  return iso.slice(0, 7);
}

// ── Quota period ──────────────────────────────────────────────────────────

// Free-tier buckets (AI answers, document reads, flowchart saves) refill
// every FREE_QUOTA_PERIOD_DAYS days on a fixed grid anchored to the Unix
// epoch — not per-user, not calendar months — so every free account refills
// at the same instant and the client can show one honest countdown.
// The pro_usage.month column stores these period keys; the column name is
// kept to avoid a migration, but it no longer means "calendar month".
export const FREE_QUOTA_PERIOD_DAYS = 5;
const QUOTA_PERIOD_MS = FREE_QUOTA_PERIOD_DAYS * 24 * 3600 * 1000;

export function periodKey(nowMs = Date.now()) {
  return "p" + Math.floor(nowMs / QUOTA_PERIOD_MS);
}

// Milliseconds until the current free-quota period ends — the refill
// countdown the client shows on the Usage tab.
export function quotaResetsInMs(nowMs = Date.now()) {
  return (Math.floor(nowMs / QUOTA_PERIOD_MS) + 1) * QUOTA_PERIOD_MS - nowMs;
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
//   "lite"      — AI synthesis until aiUsed >= aiCap this quota period (150)
//   "free"      — AI synthesis until aiUsed >= aiCap this quota period (15)
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
  // Lite is metered like free, at 10x the caps. It shares the same
  // pro_usage buckets — only the ceiling differs.
  const lite = isLiteRow(row);
  let used = 0;
  try {
    await ensureProTables(env);
    const u = await env.DB.prepare(
      "SELECT ai_answers FROM pro_usage WHERE user_id = ? AND month = ?"
    ).bind(sessionUser.id, periodKey()).first();
    used = u && typeof u.ai_answers === "number" ? u.ai_answers : 0;
  } catch {
    used = 0;
  }
  return {
    ...base,
    kind: lite ? "lite" : "free",
    userId: sessionUser.id,
    aiUsed: used,
    aiCap: lite ? LITE_AI_ANSWERS : FREE_AI_ANSWERS_PER_MONTH,
    proSource: lite ? row.pro_source || "subscription" : null,
  };
}

export function aiSynthesisAllowed(gate) {
  if (!gate) return false;
  if (gate.kind === "pro") return true;
  if (gate.kind === "free" || gate.kind === "lite") return gate.aiUsed < gate.aiCap;
  return false;
}

// Atomically consume one AI answer from the caller's monthly bucket.
// Returns the new count. Check-then-act racy by design: worst case under
// heavy concurrency a free user lands one or two answers over the cap —
// immaterial for a soft product cap, and the atomic upsert means the count
// itself never loses increments.
// NOTE: quota-gated call sites now use consumeAiAnswer (cap check folded
// into the increment); this remains for unconditional increments only.
export async function recordAiAnswer(env, userId) {
  await ensureProTables(env);
  const row = await env.DB.prepare(
    "INSERT INTO pro_usage (user_id, month, ai_answers) VALUES (?, ?, 1) " +
      "ON CONFLICT (user_id, month) DO UPDATE SET ai_answers = ai_answers + 1 " +
      "RETURNING ai_answers"
  ).bind(userId, periodKey()).first();
  return row && typeof row.ai_answers === "number" ? row.ai_answers : 1;
}

// ── Document-read metering (Notebook Mode) ───────────────────────────────
// Same atomic upsert as AI answers: free accounts get
// FREE_DOC_READS_PER_MONTH document analyses per quota period, Pro unlimited.

export async function getDocReads(env, userId) {
  await ensureProTables(env);
  try {
    const u = await env.DB.prepare(
      "SELECT doc_reads FROM pro_usage WHERE user_id = ? AND month = ?"
    ).bind(userId, periodKey()).first();
    return u && typeof u.doc_reads === "number" ? u.doc_reads : 0;
  } catch {
    return 0;
  }
}

export async function recordDocRead(env, userId) {
  await ensureProTables(env);
  const row = await env.DB.prepare(
    "INSERT INTO pro_usage (user_id, month, doc_reads) VALUES (?, ?, 1) " +
      "ON CONFLICT (user_id, month) DO UPDATE SET doc_reads = doc_reads + 1 " +
      "RETURNING doc_reads"
  ).bind(userId, periodKey()).first();
  return row && typeof row.doc_reads === "number" ? row.doc_reads : 1;
}

// ── Flowchart metering (Flowchart Studio saves) ──────────────────────────
// Free accounts get FREE_FLOWCHARTS_PER_MONTH *new* flowcharts per UTC
// month; re-saving an existing chart never counts. Pro unlimited.

export async function getFlowchartCount(env, userId) {
  await ensureProTables(env);
  try {
    const u = await env.DB.prepare(
      "SELECT flowcharts FROM pro_usage WHERE user_id = ? AND month = ?"
    ).bind(userId, periodKey()).first();
    return u && typeof u.flowcharts === "number" ? u.flowcharts : 0;
  } catch {
    return 0;
  }
}

export async function recordFlowchart(env, userId) {
  await ensureProTables(env);
  const row = await env.DB.prepare(
    "INSERT INTO pro_usage (user_id, month, flowcharts) VALUES (?, ?, 1) " +
      "ON CONFLICT (user_id, month) DO UPDATE SET flowcharts = flowcharts + 1 " +
      "RETURNING flowcharts"
  ).bind(userId, periodKey()).first();
  return row && typeof row.flowcharts === "number" ? row.flowcharts : 1;
}

// ── Atomic quota consumption (2026-09-15) ───────────────────────────────
// Race-safe replacement for check-then-increment: the cap check and the
// increment are ONE D1 statement, so concurrent requests can never
// overshoot a cap or drive usage negative.
//
//   INSERT INTO pro_usage (user_id, month, <col>) VALUES (?, ?, 1)
//   ON CONFLICT (user_id, month) DO UPDATE SET <col> = <col> + 1 WHERE <col> < ?
//
// A missing row inserts 1 (always within a cap ≥ 1); an existing row only
// increments while below the cap. meta.changes === 1 means this call
// consumed a unit; 0 means the bucket was already at the cap. Returns
// { allowed, used } — used is the post-consume count (or the current count
// when denied) for the quota payloads the endpoints return.
//
// Pro is the fast path: a null/Infinity cap skips the DB write entirely
// (allowed, used 0). Caps ≤ 0 are denied without touching the DB.
const QUOTA_COLUMNS = { ai: "ai_answers", docs: "doc_reads", flowcharts: "flowcharts" };

async function consumeQuota(env, kind, userId, cap) {
  const column = QUOTA_COLUMNS[kind];
  if (!column || !env || !env.DB || !userId) return { allowed: false, used: 0 };
  if (cap == null || cap === Infinity) return { allowed: true, used: 0 };
  if (!(cap > 0)) return { allowed: false, used: 0 };
  await ensureProTables(env);
  const pk = periodKey();
  // Column names are internal constants, never caller input — the whitelist
  // above is the guard. The cap rides as a bound parameter.
  const res = await env.DB.prepare(
    "INSERT INTO pro_usage (user_id, month, " + column + ") VALUES (?, ?, 1) " +
      "ON CONFLICT (user_id, month) DO UPDATE SET " + column + " = " + column + " + 1 " +
      "WHERE " + column + " < ?"
  ).bind(userId, pk, cap).run();
  const allowed = ((res && res.meta && res.meta.changes) || 0) === 1;
  let used = 0;
  try {
    const row = await env.DB.prepare(
      "SELECT " + column + " FROM pro_usage WHERE user_id = ? AND month = ?"
    ).bind(userId, pk).first();
    used = row && typeof row[column] === "number" ? row[column] : 0;
  } catch {
    used = 0;
  }
  return { allowed, used };
}

// Atomically consume one AI answer from a metered bucket (free or Lite).
// Pro passes cap null/Infinity and never touches the DB.
export const consumeAiAnswer = (env, userId, cap) => consumeQuota(env, "ai", userId, cap);

// Atomically consume one Notebook Mode document read.
export const consumeDocRead = (env, userId, cap) => consumeQuota(env, "docs", userId, cap);

// Atomically consume one Flowchart Studio save.
export const consumeFlowchart = (env, userId, cap) => consumeQuota(env, "flowcharts", userId, cap);

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

// Verify a webhook payload against any of the configured endpoint secrets.
// Stripe signs test-mode events with the test secret and live events with
// the live secret; trying each in order lets one endpoint serve both modes
// without weakening anything — a valid HMAC against a configured secret is
// still required.
export async function verifyWebhookSignatureAny(rawBody, sigHeader, secrets) {
  for (const secret of secrets || []) {
    if (secret && (await verifyStripeWebhookSignature(rawBody, sigHeader, secret))) return true;
  }
  return false;
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
  const grantSubscriptionPro = async (userId, interval, tier) => {
    if (!userId) return { applied: false, reason: "no-user" };
    // tier is "pro" or "lite" — which paid rung the money bought. Unknown
    // defaults to "pro" to preserve the pre-Lite behavior exactly.
    const paidTier = tier === "lite" ? "lite" : "pro";
    // The pro_source guard is the lifetime-protection clause: a row the
    // founder granted by hand is never overwritten by billing events.
    // COALESCE keeps a known interval when an event arrives without one
    // (checkout.session.completed fires before subscription.created).
    await env.DB.prepare(
      "UPDATE users SET plan = ?, pro_source = 'subscription', " +
        "pro_interval = COALESCE(?, pro_interval) WHERE id = ? " +
        "AND (pro_source IS NULL OR pro_source = 'subscription')"
    ).bind(paidTier, interval || null, userId).run();
    return { applied: true, action: "grant", tier: paidTier, userId };
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
      // verify-session check. The tier comes from the checkout metadata the
      // server itself wrote — the client never chooses it.
      if (userId && obj.payment_status === "paid") {
        return grantSubscriptionPro(userId, null, tierForCheckoutPlan(obj.metadata && obj.metadata.plan));
      }
      return { applied: !!userId, action: "link-customer", userId };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const userId =
        (obj.metadata && obj.metadata.user_id) ||
        (await userIdByCustomer(typeof obj.customer === "string" ? obj.customer : null));
      const t = subscriptionTransition(obj.status);
      const tier = tierForCheckoutPlan(obj.metadata && obj.metadata.plan);
      if (t === "grant") return grantSubscriptionPro(userId, subscriptionInterval(obj), tier);
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
      // successful invoice payment re-asserts the paid tier. Both event
      // names are handled — API versions differ on which one fires.
      // The tier comes from the invoice's price (Lite renewals must not
      // mint Pro). Fallbacks preserve the pre-Lite behavior: the row's
      // existing paid tier, then "pro".
      const customerId = typeof obj.customer === "string" ? obj.customer : null;
      const userId = await userIdByCustomer(customerId);
      if (!userId) return { applied: false, reason: "no-user" };
      let tier = null;
      try {
        const lines = obj.lines && Array.isArray(obj.lines.data) ? obj.lines.data : [];
        const priceId = lines.length && lines[0].price
          ? (typeof lines[0].price === "string" ? lines[0].price : lines[0].price.id)
          : null;
        tier = tierForPriceId(env, priceId);
      } catch { tier = null; }
      if (!tier) {
        const existing = await env.DB.prepare(
          "SELECT plan FROM users WHERE id = ?"
        ).bind(userId).first().catch(() => null);
        if (existing && (existing.plan === "lite" || existing.plan === "pro")) tier = existing.plan;
      }
      if (!tier) tier = "pro";
      await env.DB.prepare(
        "UPDATE users SET plan = ?, pro_source = 'subscription', " +
          "pro_interval = COALESCE(?, pro_interval) " +
          "WHERE id = ? AND (pro_source IS NULL OR pro_source = 'subscription')"
      ).bind(tier, subscriptionInterval(obj), userId).run();
      return { applied: true, action: "grant", tier, userId };
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

export async function stripeRequest(env, method, path, params, opts) {
  const key = env.STRIPE_SECRET_KEY || "";
  if (!key) throw new Error("stripe_not_configured");
  const headers = {
    Authorization: "Bearer " + key,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  // Nuance #26 — Stripe-side idempotency: a retried POST (client double-tap,
  // dropped response retried by our own retry layer) must not mint a second
  // Checkout Session or portal session. Callers pass a deterministic key;
  // Stripe dedupes on it for 24h. GETs never carry it.
  if (opts && opts.idempotencyKey && method !== "GET") {
    headers["Idempotency-Key"] = String(opts.idempotencyKey).slice(0, 255);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(STRIPE_API + path, {
      method,
      headers,
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
  if (plan === "lite-monthly") return env.STRIPE_PRICE_LITE_MONTHLY || "";
  if (plan === "lite-annual") return env.STRIPE_PRICE_LITE_ANNUAL || "";
  return "";
}

// Pure builder: Checkout Session params for a plan. The price ID is resolved
// server-side from the plan enum — a client can never choose its own price.
// An optional couponId (the student perk) is applied as a subscription
// discount; it comes from env, never from the client.
export function buildCheckoutParams({ userId, email, customerId, priceId, plan, origin, couponId }) {
  const params = {
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
  if (couponId) params["discounts[0][coupon]"] = couponId;
  return params;
}
