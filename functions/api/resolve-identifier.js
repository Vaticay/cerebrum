// Identifier resolver for Document Mode.
//
// Paste a DOI, PMID, or arXiv ID and get back real metadata — title,
// authors, journal, year, abstract — instead of a dead identifier chip.
// Only three fixed upstream hosts are ever fetched, and the identifier
// is strictly validated per kind first, so this cannot be turned into an
// open proxy: a URL kind is refused outright, never fetched.

import { corsHeaders, readOriginAllowed, errorResponse, tooManyRequests, forbiddenOrigin, clientIp, privacyKey } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";

const FETCH_TIMEOUT_MS = 8000;
const UA = "Cerebrum/1.0 (mailto:hello@askcerebrum.org)";

const PATTERNS = {
  "DOI": /^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i,
  "PMID": /^\d{1,8}$/,
  "arXiv ID": /^\d{4}\.\d{4,5}(v\d+)?$/,
};

function stripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

async function fetchText(url, accept) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": UA, ...(accept ? { Accept: accept } : {}) },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function resolveDOI(value) {
  const raw = await fetchText(
    `https://api.crossref.org/works/${encodeURIComponent(value)}`,
    "application/json"
  );
  if (!raw) return null;
  let m;
  try { m = JSON.parse(raw).message; } catch { return null; }
  if (!m) return null;
  const authors = Array.isArray(m.author)
    ? m.author.map((a) => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean)
    : [];
  const year = m.published && m.published["date-parts"] && m.published["date-parts"][0]
    ? String(m.published["date-parts"][0][0] || "") : "";
  return {
    title: (Array.isArray(m.title) ? m.title[0] : m.title) || "",
    authors,
    journal: (Array.isArray(m["container-title"]) ? m["container-title"][0] : "") || "",
    year,
    abstract: stripTags(m.abstract).slice(0, 6000),
    url: m.URL || `https://doi.org/${value}`,
  };
}

async function resolvePMID(value) {
  const raw = await fetchText(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${encodeURIComponent(value)}&retmode=json`
  );
  if (!raw) return null;
  let doc;
  try { doc = JSON.parse(raw); } catch { return null; }
  const rec = doc && doc.result && doc.result[doc.result.uids && doc.result.uids[0]];
  if (!rec) return null;
  // Abstract lives in efetch, not esummary — one more cheap call.
  let abstract = "";
  const efetch = await fetchText(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${encodeURIComponent(value)}&retmode=xml&rettype=abstract`
  );
  if (efetch) {
    const am = efetch.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/i);
    if (am) abstract = stripTags(am[1]).slice(0, 6000);
  }
  const year = String(rec.pubdate || "").match(/\b((?:19|20)\d{2})\b/);
  return {
    title: rec.title || "",
    authors: Array.isArray(rec.authors) ? rec.authors.map((a) => a.name).filter(Boolean) : [],
    journal: rec.source || "",
    year: year ? year[1] : "",
    abstract,
    url: `https://pubmed.ncbi.nlm.nih.gov/${value}/`,
  };
}

async function resolveArxiv(value) {
  const raw = await fetchText(
    `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(value)}&max_results=1`
  );
  if (!raw || !/<entry>/i.test(raw)) return null;
  const entry = raw.match(/<entry>([\s\S]*?)<\/entry>/i);
  const xml = entry ? entry[1] : raw;
  const title = stripTags((xml.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
  const names = [...xml.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/gi)].map((m) => stripTags(m[1]));
  const published = (xml.match(/<published>([\s\S]*?)<\/published>/i) || [])[1] || "";
  const summary = stripTags((xml.match(/<summary>([\s\S]*?)<\/summary>/i) || [])[1]).slice(0, 6000);
  const idLink = (xml.match(/<id>([\s\S]*?)<\/id>/i) || [])[1] || "";
  return {
    title,
    authors: names,
    journal: "arXiv (preprint)",
    year: (published.match(/^(\d{4})/) || [])[1] || "",
    abstract: summary,
    url: stripTags(idLink).trim() || `https://arxiv.org/abs/${value}`,
  };
}

const RESOLVERS = { "DOI": resolveDOI, "PMID": resolvePMID, "arXiv ID": resolveArxiv };

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env, { methods: "POST, OPTIONS" });
  if (!readOriginAllowed(request, env)) return forbiddenOrigin(cors);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Method not allowed.", cors);
  }

  // Metadata lookup is cheap and unauthenticated; budget it per client so
  // one actor cannot hammer the upstream registries through us.
  const ip = clientIp(request);
  const rlKey = await privacyKey("resolve-ident", ip || "unknown", env);
  if (!(await checkRateLimit(env, rlKey, 30, 60000))) {
    return tooManyRequests(cors, 30);
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const kind = String((body && body.kind) || "");
  const value = String((body && body.value) || "").trim().slice(0, 200);

  const pattern = PATTERNS[kind];
  const resolver = RESOLVERS[kind];
  if (!pattern || !resolver || !pattern.test(value)) {
    return errorResponse(400, "bad_identifier", "That identifier isn't one we can resolve. Try a DOI, PMID, or arXiv ID.", cors);
  }

  let meta = null;
  try { meta = await resolver(value); } catch { meta = null; }
  if (!meta || !meta.title) {
    return errorResponse(404, "not_found", "No record found for that identifier.", cors);
  }
  return new Response(JSON.stringify({ ok: true, kind, value, ...meta }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" },
  });
}
