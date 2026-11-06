import { corsHeaders, readOriginAllowed, readJsonBody, clientIp, privacyKey } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { safeErr, jsonOk, jsonError, clampText } from "../lib/resilience.js";
import {
  normalizeDoi, readStatements, needsIngest, ingestAnchor,
  INGEST_PER_REQUEST_CAP,
} from "../lib/statements.js";
import { ensureStatementTables } from "../lib/statements.js";

// Citation statements per paper (2026-11-06, statements lane).
// GET /api/statements?dois=<doi1,doi2> or POST {dois: [...]}
//
// Serves the cached store built by functions/lib/statements.js: for each
// DOI, the citing sentences Semantic Scholar parsed from citing papers,
// S2's purpose label per sentence, and Cerebrum's own stance label.
// This endpoint READS D1 only on the request path. DOIs that are missing
// or stale are ingested in waitUntil, off path, and reported as
// "collecting" until the store holds them; the client polls once more
// shortly after. Nothing here is ever fetched live per answer, and the
// search handler never calls this module: the answer path's subrequest
// cost for statements is zero.
//
// Failures are silent by design, same as /api/tallies: a missing entry
// renders as no panel, never an error state.

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60000;
const MAX_DOIS = 20;

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonError(405, "method_not_allowed", "Method not allowed.", cors);
  }
  if (!readOriginAllowed(request, env)) {
    return jsonError(403, "origin_not_allowed", "Origin not allowed.", cors);
  }
  const rlKey = await privacyKey("statements-ip", clientIp(request), env);
  if (!(await checkRateLimit(env, rlKey, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonError(429, "rate_limited", "Too many requests. Please wait a moment and try again.", {
      ...cors, "Retry-After": "30",
    });
  }
  try {
    let rawDois = [];
    if (request.method === "GET") {
      const q = clampText(new URL(request.url).searchParams.get("dois"), 4000);
      rawDois = String(q || "").split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      const parsed = await readJsonBody(request, cors, 64 * 1024);
      if (!parsed.ok) return parsed.response;
      const body = parsed.body;
      rawDois = Array.isArray(body && body.dois) ? body.dois.map((s) => String(s || "").trim()).filter(Boolean) : [];
    }

    const dois = [];
    const seen = new Set();
    for (const raw of rawDois) {
      const doi = normalizeDoi(raw);
      if (doi && !seen.has(doi)) { seen.add(doi); dois.push(doi); }
      if (dois.length >= MAX_DOIS) break;
    }

    const statements = await readStatements(env, dois);

    /* Schedule ingestion for whatever the store cannot serve yet. The
     * read above already told us the state; needsIngest is rechecked
     * against the ingest rows inside the batch runner so a DOI claimed
     * by a concurrent run is skipped. Cap per request keeps one burst
     * from monopolising the S2 pool; later views pick up the rest. */
    if (env && env.DB && dois.length) {
      const due = dois.filter((doi) => {
        const s = statements[doi];
        return s && s.status === "collecting";
      }).slice(0, INGEST_PER_REQUEST_CAP);
      if (due.length && typeof context.waitUntil === "function") {
        context.waitUntil((async () => {
          await ensureStatementTables(env);
          for (const doi of due) {
            try {
              const rows = await env.DB.prepare(
                "SELECT status, fetched_at, next_try FROM statement_ingest WHERE anchor_doi = ?1"
              ).bind(doi).first();
              if (!needsIngest(rows, Date.now())) continue;
              await ingestAnchor(env, doi);
            } catch (e) {
              console.error("statements ingest scheduling failed:", safeErr(e));
            }
            /* One breath between anchors: the unauthenticated S2 pool
             * is shared and throttles at roughly 100 calls per 5
             * minutes; with a key the ceiling is higher but manners
             * cost nothing off path. */
            await new Promise((r) => setTimeout(r, 700));
          }
        })());
      }
    }

    return jsonOk({ statements }, cors);
  } catch (e) {
    console.error("Cerebrum statements endpoint error:", safeErr(e));
    // Never a 500: missing statements render as no panel on the frontend.
    return jsonOk({ statements: {} }, cors);
  }
}
