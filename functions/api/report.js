// Bad-data / hallucination reporting endpoint.
//
// Accepts POST requests with a JSON body describing a data quality issue
// (incorrect citation, hallucinated claim, broken source link, etc.) and
// acknowledges receipt. When env.DB is available, reports are persisted to
// the `reports` table for later triage; without DB they're logged to the
// worker console (visible in Cloudflare's real-time log stream) and the
// user still gets a success response — reporting should never fail from
// the reporter's perspective.

const ALLOWED_ORIGINS = [
  "https://askcerebrum.org",
  "https://www.askcerebrum.org",
  "https://cerebrum-2pz.pages.dev",
];
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.cerebrum-2pz\.pages\.dev$/i;

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin =
    ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin)
      ? reqOrigin
      : "https://askcerebrum.org";
  const cors = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };

  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });

  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, 405, cors);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object")
    return json({ error: "Invalid request body." }, 400, cors);

  const query = typeof body.query === "string" ? body.query.slice(0, 2000) : "";
  const description =
    typeof body.description === "string" ? body.description.slice(0, 5000) : "";
  const category =
    typeof body.category === "string" ? body.category.slice(0, 100) : "general";
  const sourceUrl =
    typeof body.sourceUrl === "string" ? body.sourceUrl.slice(0, 2000) : "";

  // Persist to DB if available
  if (env && env.DB) {
    try {
      await env.DB.prepare(
        "INSERT INTO reports (query, description, category, source_url, created_at, ip) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(
          query,
          description,
          category,
          sourceUrl,
          Date.now(),
          request.headers.get("CF-Connecting-IP") || "unknown"
        )
        .run();
    } catch (e) {
      // Table might not exist yet — log and continue, still return success
      console.error("Report DB write failed (table may not exist yet):", e);
    }
  } else {
    // No DB — log to worker console for real-time tailing
    console.log("DATA_REPORT", JSON.stringify({ query, description, category, sourceUrl, ts: Date.now() }));
  }

  return json({ success: true }, 200, cors);
}
