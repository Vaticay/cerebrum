// Bad-data / hallucination reporting endpoint.
//
// Accepts POST requests with a JSON body describing a data quality issue
// (incorrect citation, hallucinated claim, broken source link, etc.) and
// acknowledges receipt. When env.DB is available, reports are persisted to
// the `reports` table for later triage; without DB they're logged to the
// worker console (visible in Cloudflare's real-time log stream) and the
// user still gets a success response — reporting should never fail from
// the reporter's perspective.

import { corsHeaders, requireTrustedOrigin, forbiddenOrigin, errorResponse, tooManyRequests, unauthorized, json, readJsonBody, clientIp, privacyKey } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { cleanString, safeUrl, LIMITS } from "../lib/validate.js";
import { getSessionUser } from "../lib/authHelpers.js";

// The `reports` table was never in schema.sql at all — every report this
// endpoint "successfully" received was actually being thrown away the
// instant env.DB was bound, since the INSERT below throws against a table
// that doesn't exist and the catch around it was written to swallow that
// silently (on purpose: a missing table shouldn't turn into a visible
// failure for someone filing a report). schema.sql now documents the table
// properly, but a table definition sitting in a file the person running
// this has to remember to separately run against their live database is
// exactly the kind of manual step that's easy to skip — so this creates it
// itself, once per isolate, the first time it's actually needed. Cheap
// (CREATE TABLE IF NOT EXISTS is a no-op once the table exists) and means a
// report is never silently lost just because a migration step got missed.
let _reportsTableEnsured = false;
async function ensureReportsTable(env) {
  if (_reportsTableEnsured) return;
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT, description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general', source_url TEXT, created_at INTEGER NOT NULL, ip TEXT, user_id TEXT, dedupe_hash TEXT)"
  );
  // user_id + dedupe_hash postdate the live table: attempt-and-swallow the
  // duplicate-column error so existing deployments pick them up on the
  // first request after deploy, the same self-heal pattern used everywhere
  // else in this codebase.
  for (const sql of [
    "ALTER TABLE reports ADD COLUMN user_id TEXT",
    "ALTER TABLE reports ADD COLUMN dedupe_hash TEXT",
  ]) {
    try { await env.DB.exec(sql); }
    catch (e) { if (!/duplicate column name/i.test(String(e && e.message))) throw e; }
  }
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_reports_dedupe ON reports(user_id, dedupe_hash, created_at)");
  _reportsTableEnsured = true;
}

/* Pure input validation, exported so tests can exercise it without a DB.
 * Returns { ok: true, query, description, category, sourceUrl } or
 * { ok: false, code, message }. */
export function validateReport(body) {
  const b = body && typeof body === "object" ? body : {};
  const query = cleanString(b.query, LIMITS.QUERY, { allowNewlines: true });
  const description = cleanString(b.description, LIMITS.REPORT_DESCRIPTION, { allowNewlines: true });
  const category = cleanString(b.category, 100);
  const sourceUrl = safeUrl(b.sourceUrl) || "";
  if (!description) {
    return { ok: false, code: "missing_description", message: "Tell us what's wrong so we can act on it." };
  }
  return { ok: true, query, description, category, sourceUrl };
}

/* Idempotency key for a report: the same signed-in user filing the same
 * report twice (double-tap, retry after a dropped response) is stored once.
 * A keyed hash, not the raw text, so the index row reveals nothing. */
export async function reportDedupeHash(env, userId, { query, description, category }) {
  return privacyKey("report-dedupe", `${userId}\n${query}\n${description}\n${category}`, env);
}

// Duplicate window: a repeat within ten minutes is treated as the same
// report rather than a new one.
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;

export async function onRequest(context) {
  const { request, env } = context;

  const cors = corsHeaders(request, env, { methods: "POST, OPTIONS" });

  /* This file defined ALLOWED_ORIGINS and then never used it to reject
   * anything — it only picked which origin to echo back. Combined with
   * Access-Control-Allow-Credentials: true, that made it the weakest endpoint
   * in the set: an unauthenticated, unthrottled, any-origin writer of
   * arbitrary text into the database, tagged with the reporter's IP. */
  if (request.method === "OPTIONS") {
    if (!requireTrustedOrigin(request, env)) return forbiddenOrigin(cors);
    return new Response(null, { status: 204, headers: cors });
  }
  if (!requireTrustedOrigin(request, env)) return forbiddenOrigin(cors);
  if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "Method not allowed.", cors);

  /* Reports are free-text writes into the operator's database. An
   * unauthenticated, unthrottled writer of arbitrary text is a spam and
   * injection primitive, so sign-in is required and every report is charged
   * to the account that filed it. */
  const user = await getSessionUser(request, env).catch(() => null);
  if (!user) return unauthorized(cors);

  const rlUser = await privacyKey("report-user", user.id, env);
  if (!(await checkRateLimit(env, rlUser, 5, 10 * 60000))) return tooManyRequests(cors, 120);
  const rlIp = await privacyKey("report", clientIp(request), env);
  if (!(await checkRateLimit(env, rlIp, 5, 10 * 60000))) return tooManyRequests(cors, 120);

  const parsed = await readJsonBody(request, cors, 32_000);
  if (!parsed.ok) return parsed.response;
  const vr = validateReport(parsed.body);
  if (!vr.ok) return errorResponse(400, vr.code, vr.message, cors);
  const { query, description, category, sourceUrl } = vr;

  // Persist to DB if available
  if (env && env.DB) {
    try {
      await ensureReportsTable(env);
      const now = Date.now();
      const dedupe = await reportDedupeHash(env, user.id, { query, description, category });
      const dup = await env.DB.prepare(
        "SELECT 1 FROM reports WHERE user_id = ? AND dedupe_hash = ? AND created_at > ?"
      ).bind(user.id, dedupe, now - DEDUPE_WINDOW_MS).first();
      if (dup) {
        // Idempotent: the same report twice is stored once, but the caller
        // still gets the success it is waiting for.
        return json({ success: true, duplicate: true }, 200, cors);
      }
      await env.DB.prepare(
        "INSERT INTO reports (query, description, category, source_url, created_at, ip, user_id, dedupe_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(
          query,
          description,
          category,
          sourceUrl,
          now,
          /* The raw IP used to be stored here, in the same row as the user's
           * research question — a direct query-to-person join, kept forever,
           * on a table nobody prunes. A rotating one-way hash still lets an
           * operator see that twenty reports came from one source without
           * recording who that source is. */
          await privacyKey("reporter", clientIp(request), env),
          user.id,
          dedupe
        )
        .run();
    } catch (e) {
      // Table might not exist yet — log and continue, still return success
      console.error("Report DB write failed (table may not exist yet):", e);
    }
  } else {
    // No DB — log to worker console for real-time tailing
    console.log("DATA_REPORT", JSON.stringify({ category, sourceUrl, ts: Date.now() }));
  }

  return json({ success: true }, 200, cors);
}
