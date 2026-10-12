// /api/cortex — Cortex creators and the shared course catalog.
//
//   POST {action:"access"}          → who the caller is (signed in, founder, creator)
//   POST {action:"grant-creator"}   → founder only: allow an email to create Cortex content
//   POST {action:"revoke-creator"}  → founder only: remove that allowance
//   POST {action:"list-creators"}    → founder only: the current creator list
//   POST {action:"catalog-list"}     → published catalog entries (any caller)
//   POST {action:"catalog-create"}   → creator or founder: publish a catalog entry
//   POST {action:"catalog-delete"}   → creator (own entries) or founder (any entry)
//
// The founder gate is the same one the rest of the site uses: FOUNDER_EMAIL
// is the entire allowlist, and the 403 shape is identical for signed-out,
// wrong-user, and unset, so the gate is not probeable. Creator status is
// keyed by email, not by account id, because the founder grants it before
// (or after) the person signs up: type an email, and the account with that
// email can create. Granting creator also grants the Cortex Contributor
// accolade when an account with that email already exists; the profile
// path grants it on first load for accounts created after the grant.

import {
  corsHeaders, requireTrustedOrigin, forbiddenOrigin, errorResponse,
  tooManyRequests, unauthorized, json, readJsonBody, clientIp, privacyKey,
} from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { getSessionUser } from "../lib/authHelpers.js";
import { normalizeEmail } from "../lib/proEntitlement.js";

async function ensureTables(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS cortex_creators (email TEXT PRIMARY KEY, granted_by TEXT, created_at INTEGER NOT NULL)"
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS cortex_catalog (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, query TEXT NOT NULL, blurb TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL)"
  ).run();
}

async function sessionUser(request, env) {
  try { return await getSessionUser(request, env); } catch { return null; }
}

async function founderCheck(request, env) {
  const founderEmail = (env.FOUNDER_EMAIL || "").trim().toLowerCase();
  const user = await sessionUser(request, env);
  const isFounder =
    !!user && !!founderEmail &&
    String(user.email || "").trim().toLowerCase() === founderEmail;
  return { user, isFounder };
}

async function isCreator(env, emailLower) {
  if (!emailLower) return false;
  try {
    const row = await env.DB.prepare(
      "SELECT email FROM cortex_creators WHERE email = ?"
    ).bind(emailLower).first();
    return !!row;
  } catch { return false; }
}

function validEmail(email) {
  return !!email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

// The Cortex Contributor accolade, granted the moment creator status lands
// on an existing account. INSERT OR IGNORE keeps the first grant date.
async function grantContributorAccolade(env, emailLower) {
  try {
    const user = await env.DB.prepare(
      "SELECT id FROM users WHERE email_lower = ? OR LOWER(email) = ?"
    ).bind(emailLower, emailLower).first();
    if (!user) return false;
    await env.DB.prepare(
      "INSERT OR IGNORE INTO accolades (id, user_id, badge_type, granted_at) VALUES (?, ?, ?, ?)"
    ).bind("acc_" + crypto.randomUUID(), user.id, "cortex_contributor", Date.now()).run();
    return true;
  } catch { return false; }
}

// ── Handlers ─────────────────────────────────────────────────────────────

async function handleAccess(request, env, cors) {
  const { user, isFounder } = await founderCheck(request, env);
  if (!user) return json({ ok: true, signedIn: false, isFounder: false, isCreator: false }, 200, cors);
  await ensureTables(env);
  const email = String(user.email || "").trim().toLowerCase();
  const creator = isFounder || (await isCreator(env, email));
  return json({ ok: true, signedIn: true, email, isFounder, isCreator: creator }, 200, cors);
}

async function handleGrantCreator(request, env, cors, body) {
  const { user, isFounder } = await founderCheck(request, env);
  if (!isFounder) {
    return new Response(JSON.stringify({ error: "Not authorized." }), { status: 403, headers: cors });
  }
  const rlKey = await privacyKey("cortex-grant", clientIp(request), env);
  if (!(await checkRateLimit(env, rlKey, 20, 60000))) return tooManyRequests(cors, 60);
  const email = normalizeEmail(body && body.email);
  if (!validEmail(email)) return errorResponse(400, "invalid_email", "Enter a valid email address.", cors);
  await ensureTables(env);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO cortex_creators (email, granted_by, created_at) VALUES (?, ?, ?)"
  ).bind(email, String(user.email || "").trim().toLowerCase(), Date.now()).run();
  const badgeGranted = await grantContributorAccolade(env, email);
  const creators = await listCreators(env);
  return json({ ok: true, email, badgeGranted, creators }, 200, cors);
}

async function handleRevokeCreator(request, env, cors, body) {
  const { isFounder } = await founderCheck(request, env);
  if (!isFounder) {
    return new Response(JSON.stringify({ error: "Not authorized." }), { status: 403, headers: cors });
  }
  const rlKey = await privacyKey("cortex-grant", clientIp(request), env);
  if (!(await checkRateLimit(env, rlKey, 20, 60000))) return tooManyRequests(cors, 60);
  const email = normalizeEmail(body && body.email);
  if (!validEmail(email)) return errorResponse(400, "invalid_email", "Enter a valid email address.", cors);
  await ensureTables(env);
  await env.DB.prepare("DELETE FROM cortex_creators WHERE email = ?").bind(email).run();
  const creators = await listCreators(env);
  return json({ ok: true, email, creators }, 200, cors);
}

async function listCreators(env) {
  const rows = await env.DB.prepare(
    "SELECT email, granted_by, created_at FROM cortex_creators ORDER BY created_at ASC"
  ).all();
  return (rows.results || []).map((r) => ({ email: r.email, grantedBy: r.granted_by, createdAt: r.created_at }));
}

async function handleListCreators(request, env, cors) {
  const { isFounder } = await founderCheck(request, env);
  if (!isFounder) {
    return new Response(JSON.stringify({ error: "Not authorized." }), { status: 403, headers: cors });
  }
  await ensureTables(env);
  return json({ ok: true, creators: await listCreators(env) }, 200, cors);
}

async function handleCatalogList(request, env, cors) {
  await ensureTables(env);
  const rows = await env.DB.prepare(
    "SELECT id, title, category, query, blurb, created_by, created_at FROM cortex_catalog ORDER BY created_at DESC LIMIT 200"
  ).all();
  const entries = (rows.results || []).map((r) => ({
    id: r.id, title: r.title, category: r.category, query: r.query,
    blurb: r.blurb || "", createdBy: r.created_by, createdAt: r.created_at,
  }));
  return json({ ok: true, entries }, 200, cors);
}

function cleanField(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

async function handleCatalogCreate(request, env, cors, body) {
  const { user, isFounder } = await founderCheck(request, env);
  if (!user) return unauthorized(cors);
  await ensureTables(env);
  const email = String(user.email || "").trim().toLowerCase();
  if (!isFounder && !(await isCreator(env, email))) {
    return errorResponse(403, "not_a_creator", "This account is not a Cortex creator.", cors);
  }
  const rlKey = await privacyKey("cortex-catalog", user.id, env);
  if (!(await checkRateLimit(env, rlKey, 10, 60000))) return tooManyRequests(cors, 60);
  const title = cleanField(body && body.title, 90);
  const category = cleanField(body && body.category, 40);
  const query = cleanField(body && body.query, 160);
  const blurb = cleanField(body && body.blurb, 240);
  if (title.length < 3) return errorResponse(400, "invalid_title", "Give the course a title of at least 3 characters.", cors);
  if (category.length < 2) return errorResponse(400, "invalid_category", "Pick a category.", cors);
  if (query.length < 3) return errorResponse(400, "invalid_query", "Give the topic the course is built from.", cors);
  const entry = {
    id: "cat_" + crypto.randomUUID(),
    title, category, query, blurb,
    createdBy: email, createdAt: Date.now(),
  };
  await env.DB.prepare(
    "INSERT INTO cortex_catalog (id, title, category, query, blurb, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(entry.id, entry.title, entry.category, entry.query, entry.blurb, entry.createdBy, entry.createdAt).run();
  await grantContributorAccolade(env, email);
  return json({ ok: true, entry }, 200, cors);
}

async function handleCatalogDelete(request, env, cors, body) {
  const { user, isFounder } = await founderCheck(request, env);
  if (!user) return unauthorized(cors);
  await ensureTables(env);
  const id = cleanField(body && body.id, 80);
  if (!id) return errorResponse(400, "invalid_id", "Missing entry id.", cors);
  const row = await env.DB.prepare("SELECT created_by FROM cortex_catalog WHERE id = ?").bind(id).first();
  if (!row) return errorResponse(404, "not_found", "That entry is already gone.", cors);
  const email = String(user.email || "").trim().toLowerCase();
  if (!isFounder && row.created_by !== email) {
    return errorResponse(403, "not_yours", "You can only remove entries you published.", cors);
  }
  await env.DB.prepare("DELETE FROM cortex_catalog WHERE id = ?").bind(id).run();
  return json({ ok: true, id }, 200, cors);
}

// ── Dispatcher (same shape as /api/pro) ──────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env, { methods: "GET, POST, OPTIONS" });
  if (request.method === "OPTIONS") {
    if (!requireTrustedOrigin(request, env)) return forbiddenOrigin(cors);
    return new Response(null, { status: 204, headers: cors });
  }
  if (!requireTrustedOrigin(request, env)) return forbiddenOrigin(cors);
  if (request.method === "GET") return handleCatalogList(request, env, cors);
  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Method not allowed.", cors);
  }
  const parsed = await readJsonBody(request, cors, 32_000);
  if (!parsed.ok) return parsed.response;
  const action = parsed.body && parsed.body.action;
  switch (action) {
    case "access": return handleAccess(request, env, cors);
    case "grant-creator": return handleGrantCreator(request, env, cors, parsed.body);
    case "revoke-creator": return handleRevokeCreator(request, env, cors, parsed.body);
    case "list-creators": return handleListCreators(request, env, cors);
    case "catalog-list": return handleCatalogList(request, env, cors);
    case "catalog-create": return handleCatalogCreate(request, env, cors, parsed.body);
    case "catalog-delete": return handleCatalogDelete(request, env, cors, parsed.body);
    default:
      return errorResponse(400, "unknown_action", "Unknown action.", cors);
  }
}
