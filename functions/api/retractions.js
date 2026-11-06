import { corsHeaders, readOriginAllowed, readJsonBody, clientIp, privacyKey } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { fetchWithTimeout, safeErr, jsonOk, jsonError, clampText } from "../lib/resilience.js";
import { normalizeRetractionDoi, resolveRetractionStatuses } from "../lib/retraction.js";

// Retraction and editorial notice status per DOI.
// GET /api/retractions?dois=<doi1,doi2> or POST {dois: [...]}
//
// The verdict rule lives in functions/lib/retraction.js: a paper is
// only ever presented as retracted when two of the three channels
// (Crossref updated-by, Europe PMC plus PubMed types, OpenAlex)
// independently report a retraction class event. One channel alone
// yields "reported", worded as reported, never as settled fact.
//
// This endpoint is deliberately OFF the search path: the search
// handler's subrequest ledger is already spoken for, so clients ask
// here after rendering, batched per surface, exactly the way
// /api/tallies is asked. Server side cost per cold batch of 20 DOIs
// is 20 Crossref calls plus one Europe PMC, one PubMed and one
// OpenAlex call; the two level cache below (isolate memory in front
// of a D1 table) makes the steady state cost near zero, because a
// paper's notice status changes rarely. Cache TTL is 24 hours, the
// same conservatism as tallies: a retraction posted today can take
// up to a day to appear here, and the surfaces say "no notice found"
// by printing nothing, never "not retracted".
//
// Failures are silent by design, matching tallies: an unreachable
// channel narrows the verdict (possibly to "unknown"), never an
// error state on a reading surface.

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60000;
const MAX_DOIS = 20;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const memCache = new Map(); // doi -> { data, expiresAt }

// Serialize cold resolutions so concurrent surfaces asking for the
// same fresh DOIs share one upstream batch instead of stampeding.
let coldChain = Promise.resolve();

let tableReady = null;
function ensureTable(db) {
  if (!db) return Promise.resolve(false);
  if (!tableReady) {
    tableReady = db
      .exec(
        "CREATE TABLE IF NOT EXISTS retraction_cache (" +
          "doi TEXT PRIMARY KEY, " +
          "payload TEXT NOT NULL, " +
          "expires_at INTEGER NOT NULL)"
      )
      .then(
        () => true,
        () => { tableReady = null; return false; }
      );
  }
  return tableReady;
}

async function readD1Cache(db, dois, now) {
  const found = {};
  if (!db || !dois.length) return found;
  try {
    if (!(await ensureTable(db))) return found;
    const placeholders = dois.map(() => "?").join(",");
    const rows = await db
      .prepare(`SELECT doi, payload, expires_at FROM retraction_cache WHERE doi IN (${placeholders})`)
      .bind(...dois)
      .all();
    for (const row of (rows && rows.results) || []) {
      if (!row || row.expires_at <= now) continue;
      try {
        const data = JSON.parse(row.payload);
        if (data && typeof data === "object") found[row.doi] = data;
      } catch { /* a corrupt row is a cache miss, never an error */ }
    }
  } catch (e) {
    console.error("Retraction D1 cache read failed:", safeErr(e));
  }
  return found;
}

async function writeD1Cache(db, entries, now) {
  if (!db || !entries.length) return;
  try {
    if (!(await ensureTable(db))) return;
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO retraction_cache (doi, payload, expires_at) VALUES (?, ?, ?)"
    );
    await db.batch(entries.map(([doi, data]) => stmt.bind(doi, JSON.stringify(data), now + CACHE_TTL_MS)));
  } catch (e) {
    console.error("Retraction D1 cache write failed:", safeErr(e));
  }
}

async function fetchJson(url) {
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { Accept: "application/json", "User-Agent": "Cerebrum retraction check (https://askcerebrum.org)" } },
      12000
    );
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function resolveCold(env, dois) {
  const run = async () => {
    const now = Date.now();
    const stillCold = dois.filter((doi) => {
      const hit = memCache.get(doi);
      return !(hit && hit.expiresAt > now);
    });
    if (!stillCold.length) return;
    const resolved = await resolveRetractionStatuses(stillCold, fetchJson);
    const entries = [];
    for (const doi of stillCold) {
      const verdict = resolved[doi] || { status: "unknown", namedBy: [], channels: [], notices: [] };
      const data = { ...verdict, checkedAt: now };
      memCache.set(doi, { data, expiresAt: now + CACHE_TTL_MS });
      entries.push([doi, data]);
    }
    await writeD1Cache(env && env.DB, entries, now);
  };
  const p = coldChain.then(run, run);
  coldChain = p.catch(() => {});
  await p;
}

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
  const rlKey = await privacyKey("retractions-ip", clientIp(request), env);
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
      const doi = normalizeRetractionDoi(raw);
      if (doi && !seen.has(doi)) { seen.add(doi); dois.push(doi); }
      if (dois.length >= MAX_DOIS) break;
    }

    const now = Date.now();
    const retractions = {};
    const cold = [];
    for (const doi of dois) {
      const hit = memCache.get(doi);
      if (hit && hit.expiresAt > now) retractions[doi] = hit.data;
      else cold.push(doi);
    }
    if (cold.length) {
      const fromD1 = await readD1Cache(env && env.DB, cold, now);
      const remaining = [];
      for (const doi of cold) {
        if (fromD1[doi]) {
          retractions[doi] = fromD1[doi];
          memCache.set(doi, { data: fromD1[doi], expiresAt: now + CACHE_TTL_MS });
        } else remaining.push(doi);
      }
      if (remaining.length) {
        await resolveCold(env, remaining);
        for (const doi of remaining) {
          const hit = memCache.get(doi);
          if (hit) retractions[doi] = hit.data;
        }
      }
    }

    return jsonOk({ retractions }, cors);
  } catch (e) {
    console.error("Cerebrum retractions endpoint error:", safeErr(e));
    // Never a 500: an unresolved status renders as no flag.
    return jsonOk({ retractions: {} }, cors);
  }
}
