import { corsHeaders, readOriginAllowed, readJsonBody, clientIp, privacyKey } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { fetchWithTimeout, safeErr, jsonOk, jsonError } from "../lib/resilience.js";
import { parseReferenceLines, resolveReferenceChecks, orderRefCheckResults } from "../lib/refcheck.js";

// Reference Check, DOI list first (2026-11-06, Scite audit wave,
// ballot decision 6).
// POST /api/refcheck { text } or { lines: [...] }
//
// Each pasted reference line gets three answers: whether its DOI
// resolves at Crossref and what paper it names (bibliography
// integrity), the retraction and editorial notice verdict under
// the multi signal rule in functions/lib/retraction.js
// (publication integrity), and nothing else. Reception tallies
// stay with the client, which asks /api/tallies for the resolved
// DOIs the way the answer bibliography already does.
//
// Results come back ordered by editorial concern, most concerning
// first (the ordering rule lives in functions/lib/refcheck.js).
// No claim level matching and no manuscript upload in this wave:
// those are later ballot steps, not silent gaps.
//
// Cost per cold check of N distinct DOIs: N Crossref calls plus
// one Europe PMC, one PubMed and one OpenAlex call, upstream of
// the per DOI memory cache below (24 hour TTL, matching tallies:
// notice status changes rarely, and a check is a reading surface,
// never part of the search handler's subrequest budget).

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60000;
const MAX_REFS = 60;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const memCache = new Map(); // doi -> { data, expiresAt }

async function fetchWithStatus(url) {
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { Accept: "application/json", "User-Agent": "Cerebrum reference check (https://askcerebrum.org)" } },
      12000
    );
    if (!res) return null;
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, json };
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return jsonError(405, "method_not_allowed", "Method not allowed.", cors);
  }
  if (!readOriginAllowed(request, env)) {
    return jsonError(403, "origin_not_allowed", "Origin not allowed.", cors);
  }
  const rlKey = await privacyKey("refcheck-ip", clientIp(request), env);
  if (!(await checkRateLimit(env, rlKey, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonError(429, "rate_limited", "Too many checks in a row. Please wait a moment and try again.", {
      ...cors, "Retry-After": "30",
    });
  }
  try {
    const parsed = await readJsonBody(request, cors, 256 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body || {};
    const text = typeof body.text === "string"
      ? body.text
      : Array.isArray(body.lines) ? body.lines.map((s) => String(s || "")).join("\n") : "";

    const entries = parseReferenceLines(text).slice(0, MAX_REFS);
    const now = Date.now();

    const byKey = new Map(); // index in entries -> result
    const coldEntries = [];
    entries.forEach((entry, i) => {
      if (entry.doi) {
        const hit = memCache.get(entry.doi);
        if (hit && hit.expiresAt > now) { byKey.set(i, { ...hit.data, line: entry.line }); return; }
      }
      coldEntries.push({ entry, i });
    });

    if (coldEntries.length) {
      const coldDois = [...new Set(coldEntries.map(({ entry }) => entry.doi).filter(Boolean))];
      const coldResults = await resolveReferenceChecks(
        coldDois.map((doi) => ({ line: "", doi })),
        fetchWithStatus
      );
      const coldByDoi = {};
      for (const r of coldResults) if (r && r.doi) coldByDoi[r.doi] = r;
      for (const { entry, i } of coldEntries) {
        if (!entry.doi) {
          byKey.set(i, { line: entry.line, doi: null, resolves: false, meta: null, verdict: null, status: "unresolved" });
          continue;
        }
        const r = coldByDoi[entry.doi] || { doi: entry.doi, resolves: null, meta: null, verdict: null, status: "unknown" };
        const data = { doi: r.doi, resolves: r.resolves, meta: r.meta, verdict: r.verdict, status: r.status };
        memCache.set(entry.doi, { data, expiresAt: now + CACHE_TTL_MS });
        byKey.set(i, { ...data, line: entry.line });
      }
    }

    const inOrder = entries.map((_, i) => byKey.get(i)).filter(Boolean);
    const results = orderRefCheckResults(inOrder);
    const counts = {};
    for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
    return jsonOk({ results, counts, checked: results.length }, cors);
  } catch (e) {
    console.error("Cerebrum refcheck endpoint error:", safeErr(e));
    return jsonError(500, "check_failed", "The check could not run. Please try again.", cors);
  }
}
