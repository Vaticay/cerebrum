// Bad-data / hallucination reporting endpoint.
//
// Accepts POST requests with a JSON body describing a data quality issue
// (incorrect citation, hallucinated claim, broken source link, etc.) and
// acknowledges receipt. When env.DB is available, reports are persisted to
// the `reports` table for later triage; without DB they're logged to the
// worker console (visible in Cloudflare's real-time log stream) and the
// user still gets a success response — reporting should never fail from
// the reporter's perspective.

import { corsHeaders, requireTrustedOrigin, forbiddenOrigin, errorResponse, tooManyRequests, json, readJsonBody, clientIp, privacyKey } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { cleanString, safeUrl, LIMITS } from "../lib/validate.js";

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
    "CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, query TEXT, description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general', source_url TEXT, created_at INTEGER NOT NULL, ip TEXT)"
  );
  _reportsTableEnsured = true;
}

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

  const rlKey = await privacyKey("report", clientIp(request), env);
  if (!(await checkRateLimit(env, rlKey, 5, 10 * 60000))) return tooManyRequests(cors, 120);

  const parsed = await readJsonBody(request, cors, 32_000);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const query = cleanString(body.query, LIMITS.QUERY, { allowNewlines: true });
  const description = cleanString(body.description, LIMITS.REPORT_DESCRIPTION, { allowNewlines: true });
  const category = cleanString(body.category, 100);
  const sourceUrl = safeUrl(body.sourceUrl) || "";
  if (!description) return errorResponse(400, "missing_description", "Tell us what's wrong so we can act on it.", cors);

  // Persist to DB if available
  if (env && env.DB) {
    try {
      await ensureReportsTable(env);
      await env.DB.prepare(
        "INSERT INTO reports (query, description, category, source_url, created_at, ip) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(
          query,
          description,
          category,
          sourceUrl,
          Date.now(),
          /* The raw IP used to be stored here, in the same row as the user's
           * research question — a direct query-to-person join, kept forever,
           * on a table nobody prunes. A rotating one-way hash still lets an
           * operator see that twenty reports came from one source without
           * recording who that source is. */
          await privacyKey("reporter", clientIp(request), env)
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
