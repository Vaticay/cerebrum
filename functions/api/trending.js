// Cerebrum "Trending in Science" digest — Cloudflare Pages Function.
//
// This ships as an honest preview, never as a verified news feed. Every
// card is a real paper pulled live from OpenAlex — nothing here is invented,
// but nothing here has gone through Cerebrum's own fact-check pass either
// (that pass runs against a specific answer's claims; there's no equivalent
// "verify a whole paper" step to run against a digest of eight of them). The
// "summary" on each card is a literal excerpt from that paper's own OpenAlex
// abstract record, reconstructed below, not a model-written blurb — so
// there's no synthesis step that could introduce a claim the paper itself
// doesn't make. See TrendingModal in src/main.jsx for how this is labeled
// on screen: "Preview," not "Fact-Checked."
//
// "Trending" here means "highly cited among papers published in the last
// three weeks" — a real, computable signal, not editorial judgment about
// what's culturally significant. That's a narrower claim than a human
// science editor's "trending," and it's a fair one: OpenAlex's citation
// graph is the actual data, not a guess.

import { checkRateLimit } from "../lib/rateLimit.js";

const ALLOWED_ORIGINS = [
  "https://askcerebrum.org",
  "https://www.askcerebrum.org",
  "https://cerebrum-2pz.pages.dev",
];
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.cerebrum-2pz\.pages\.dev$/i;
function originAllowed(request) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return true;
  return ALLOWED_ORIGINS.some((o) => origin === o) || PAGES_PREVIEW_RE.test(origin);
}

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60000;

// Same "polite pool" identification search.js uses for every OpenAlex/
// Crossref/Europe PMC call — an identifiable User-Agent with a contact
// email routes to a faster, higher-quota pool than anonymous traffic on
// these free scholarly APIs.
const POLITE_UA =
  "Cerebrum/1.0 (askcerebrum.org; a free scientific literature search; mailto:contact@askcerebrum.org)";

async function getJSON(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": POLITE_UA, Accept: "application/json" },
      signal: controller.signal,
      // Cached at Cloudflare's edge on top of this endpoint's own
      // Cache-Control below — two layers, since the outbound OpenAlex call
      // and Cerebrum's own response are cached independently.
      cf: { cacheTtl: 1800, cacheEverything: true },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// OpenAlex doesn't return plain abstract text — publisher agreements only
// let it redistribute the "inverted index" (word -> the positions it
// appears at), which is enough to reconstruct the original text without
// OpenAlex itself hosting a verbatim copy. This is the standard rebuild.
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== "object") return "";
  const positions = [];
  for (const word of Object.keys(invertedIndex)) {
    const idxs = invertedIndex[word];
    if (!Array.isArray(idxs)) continue;
    for (const i of idxs) {
      if (typeof i === "number" && i >= 0 && i < 4000) positions[i] = word;
    }
  }
  return positions.filter(Boolean).join(" ");
}

function cleanDoiLink(doi, fallbackId) {
  if (typeof doi === "string" && doi) {
    return doi.startsWith("http") ? doi : `https://doi.org/${doi}`;
  }
  return typeof fallbackId === "string" ? fallbackId : "";
}

export async function onRequest(context) {
  const { request, env } = context;
  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin = ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin) ? reqOrigin : "https://askcerebrum.org";
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: cors });
  if (!originAllowed(request)) return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers: cors });

  const clientIP = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  if (!(await checkRateLimit(env, `trending:${clientIP}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }), { status: 429, headers: { ...cors, "Retry-After": "30" } });
  }

  try {
    const since = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const params = new URLSearchParams({
      filter: `from_publication_date:${since},type:article,has_abstract:true`,
      sort: "cited_by_count:desc",
      per_page: "8",
      select: "id,doi,display_name,abstract_inverted_index,cited_by_count,publication_date,primary_location,concepts",
    });
    const data = await getJSON("https://api.openalex.org/works?" + params.toString());
    const raw = Array.isArray(data && data.results) ? data.results : [];

    const items = raw
      .map((w) => {
        const abstract = reconstructAbstract(w.abstract_inverted_index).trim();
        const summary = abstract
          ? (abstract.length > 280 ? abstract.slice(0, 277).trim() + "…" : abstract)
          : "";
        const venue = w.primary_location && w.primary_location.source && w.primary_location.source.display_name;
        const topic = Array.isArray(w.concepts) && w.concepts[0] ? w.concepts[0].display_name : null;
        return {
          title: (w.display_name || "").trim(),
          summary,
          citedByCount: typeof w.cited_by_count === "number" ? w.cited_by_count : 0,
          publicationDate: w.publication_date || null,
          venue: venue || null,
          topic: topic || null,
          link: cleanDoiLink(w.doi, w.id),
        };
      })
      .filter((it) => it.title && it.summary);

    return new Response(JSON.stringify({ items, generatedAt: Date.now() }), {
      status: 200,
      headers: { ...cors, "Cache-Control": "public, max-age=1800" },
    });
  } catch (e) {
    console.error("Cerebrum trending endpoint error:", e);
    return new Response(JSON.stringify({ error: "Couldn't load the trending digest right now. Please try again shortly.", items: [] }), { status: 502, headers: cors });
  }
}
