import { corsHeaders, readOriginAllowed, readJsonBody, clientIp, privacyKey } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { fetchWithTimeout, safeErr, jsonOk, jsonError, clampText } from "../lib/resilience.js";

// Citation stance tallies via scite.ai's free unauthenticated API.
// GET /api/tallies?dois=<doi1,doi2> or POST {dois: [...]}
//
// Each DOI maps to { supporting, contradicting, mentioning, total, citingPublications }
// from https://api.scite.ai/tallies/{doi}. We display the raw numbers as-is —
// never converted to verdicts or percentages (that's how we lost trust once;
// the fabricated 70%/5% reception dots were arithmetic fiction).
//
// 2026-10-10: scite.ai is a third-party data source. Responses carry
// "Citation counts via scite.ai" attribution on the frontend. Failures are
// silent by design: missing tallies render as dashes, never an error state.

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60000;
const MAX_DOIS = 20;

// In-memory cache. Tallies change slowly (they're per-paper citation
// statements); 24h TTL is conservative. Module-level so it persists across
// warm requests on the same isolate.
const cache = new Map(); // doi -> { data, expiresAt }
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// In-flight dedupe: concurrent rows asking for the same DOI share one fetch.
const inflight = new Map();

function normalizeDoi(raw) {
  const d = String(raw || "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/\/+$/, "")
    .trim()
    .replace(/[.,;:!?)\]]+$/, "");
  return /^10\.\d{4,9}\//.test(d) ? d.toLowerCase() : null;
}

async function fetchTally(doi) {
  const now = Date.now();
  const hit = cache.get(doi);
  if (hit && hit.expiresAt > now) return hit.data;

  if (inflight.has(doi)) return inflight.get(doi);

  const p = (async () => {
    try {
      const res = await fetchWithTimeout(
        "https://api.scite.ai/tallies/" + encodeURIComponent(doi),
        { headers: { Accept: "application/json" } },
        12000
      );
      if (!res || !res.ok) return null;
      const j = await res.json();
      if (!j || typeof j !== "object") return null;
      const tally = {
        supporting: Number(j.supporting) || 0,
        contradicting: Number(j.contradicting) || 0,
        mentioning: Number(j.mentioning) || 0,
        total: Number(j.total) || 0,
        citingPublications: Number(j.citingPublications) || 0,
      };
      cache.set(doi, { data: tally, expiresAt: now + CACHE_TTL_MS });
      return tally;
    } catch (e) {
      console.error("Tallies fetch failed for", doi, safeErr(e));
      return null;
    } finally {
      inflight.delete(doi);
    }
  })();
  inflight.set(doi, p);
  return p;
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
  const rlKey = await privacyKey("tallies-ip", clientIp(request), env);
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

    const tallies = {};
    await Promise.all(dois.map(async (doi) => {
      const t = await fetchTally(doi);
      if (t) tallies[doi] = t;
    }));

    return jsonOk({ tallies }, cors);
  } catch (e) {
    console.error("Cerebrum tallies endpoint error:", safeErr(e));
    // Never a 500: missing tallies render as dashes on the frontend.
    return jsonOk({ tallies: {} }, cors);
  }
}
