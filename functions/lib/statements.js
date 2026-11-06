/* Citation statements pipeline (2026-11-06, statements lane, Scite audit
 * Standard build, phase 1).
 *
 * What this is: an off path, cached store of citation statements for the
 * papers Cerebrum cites. For each anchor DOI we hold the citing sentences
 * Semantic Scholar parsed out of citing papers' full text (contexts), the
 * citing paper for each sentence, S2's purpose label (intents), and our
 * own stance label from functions/lib/stance.js.
 *
 * Data flow, stated plainly because the budget depends on it:
 *
 *   answer path (functions/api/search.js)     NEVER touches this module.
 *                                             Zero added subrequests.
 *   client, after an answer renders           POSTs the bibliography's
 *                                             DOIs to /api/statements,
 *                                             exactly like /api/tallies.
 *   /api/statements                           reads D1 only. For DOIs
 *                                             that are missing or stale
 *                                             it schedules ingestion in
 *                                             waitUntil and answers
 *                                             "collecting" for them.
 *   ingestion (this module, off path)         one S2 citations call per
 *                                             anchor DOI, batched across
 *                                             requests, classified at
 *                                             write time, cached in D1
 *                                             for 30 days.
 *
 * Why never live per answer: S2 throttles hard. Verification on
 * 2026-11-06 hit HTTP 429 on unauthenticated calls seconds apart, and
 * production retrieval sees the same. A cached store is the only shape
 * that survives that; the repo's own plan (docs/citation-statements-
 * data-sources.md, 2026-10-09) says the same.
 *
 * Coverage honesty: contexts exist only where S2 parsed the citing
 * paper's full text. Many citations carry no sentence at all. The store
 * records how many citations S2 reports for the anchor and how many
 * sentences it actually holds, so the UI and the record can say what
 * share is real instead of implying full coverage.
 */

import { fetchWithTimeout, safeErr } from "./resilience.js";
import { classifyStatement } from "./stance.js";

export const STATEMENTS_PER_ANCHOR_CAP = 120;
export const STATEMENTS_RESPONSE_CAP = 40;
export const STATEMENTS_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
export const STATEMENTS_THROTTLE_RETRY_MS = 15 * 60 * 1000;
export const INGEST_PER_REQUEST_CAP = 5;

const S2_BASE = "https://api.semanticscholar.org/graph/v1";
const S2_FIELDS = "contexts,intents,isInfluential,citingPaper.paperId,citingPaper.title,citingPaper.year,citingPaper.externalIds";

export function normalizeDoi(raw) {
  const d = String(raw || "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/\/+$/, "")
    .trim()
    .replace(/[.,;:!?)\]]+$/, "");
  return /^10\.\d{4,9}\//.test(d) ? d.toLowerCase() : null;
}

let tablesReady = false;
export async function ensureStatementTables(env) {
  if (!env || !env.DB || tablesReady) return Boolean(env && env.DB);
  try {
    await env.DB.exec(
      "CREATE TABLE IF NOT EXISTS citation_statements (" +
      "anchor_doi TEXT NOT NULL, citing_id TEXT NOT NULL, ctx_idx INTEGER NOT NULL, " +
      "citing_doi TEXT, citing_title TEXT, citing_year INTEGER, " +
      "context TEXT NOT NULL, intents TEXT, influential INTEGER NOT NULL DEFAULT 0, " +
      "stance TEXT NOT NULL, section TEXT, " +
      "PRIMARY KEY (anchor_doi, citing_id, ctx_idx));" +
      "CREATE INDEX IF NOT EXISTS idx_citation_statements_anchor ON citation_statements(anchor_doi);" +
      "CREATE TABLE IF NOT EXISTS statement_ingest (" +
      "anchor_doi TEXT PRIMARY KEY, status TEXT NOT NULL, fetched_at INTEGER NOT NULL DEFAULT 0, " +
      "next_try INTEGER NOT NULL DEFAULT 0, citations_seen INTEGER NOT NULL DEFAULT 0, " +
      "statements_kept INTEGER NOT NULL DEFAULT 0, error TEXT);"
    );
    tablesReady = true;
  } catch (e) {
    console.error("statements ensure tables:", safeErr(e));
  }
  return tablesReady;
}

/* Pure decision, exported for tests: given the ingest row (or null) and
 * the clock, does this DOI need an ingestion run now? */
export function needsIngest(row, now) {
  if (!row) return true;
  if (row.status === "ready" || row.status === "empty") {
    return now - (row.fetched_at || 0) > STATEMENTS_FRESH_MS;
  }
  if (row.status === "throttled" || row.status === "error") {
    return now >= (row.next_try || 0);
  }
  return false; /* "collecting" rows are owned by a live run */
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* One S2 citations page for an anchor. Returns { ok, total, rows } or
 * { ok: false, throttled } / { ok: false, error }. Retries a 429 twice
 * with growing waits: ingestion runs off path in waitUntil, so it can
 * afford patience the answer path cannot. */
export async function fetchS2Citations(doi, env, fetchImpl) {
  const doFetch = fetchImpl || ((url, opts, ms) => fetchWithTimeout(url, opts, ms));
  const headers = { Accept: "application/json" };
  const key = env && env.SEMANTIC_SCHOLAR_KEY ? String(env.SEMANTIC_SCHOLAR_KEY) : "";
  if (key) headers["x-api-key"] = key;
  const url = S2_BASE + "/paper/DOI:" + encodeURIComponent(doi) +
    "/citations?fields=" + S2_FIELDS + "&limit=1000";
  const waits = [0, 2000, 5000];
  for (let attempt = 0; attempt < waits.length; attempt++) {
    if (waits[attempt]) await sleep(waits[attempt]);
    let res = null;
    try {
      res = await doFetch(url, { headers }, 20000);
    } catch (e) {
      if (attempt === waits.length - 1) return { ok: false, error: safeErr(e) };
      continue;
    }
    if (res && res.status === 429) {
      if (attempt === waits.length - 1) return { ok: false, throttled: true };
      continue;
    }
    if (!res || !res.ok) {
      return { ok: false, error: "s2 http " + (res ? res.status : "no response") };
    }
    let j = null;
    try { j = await res.json(); } catch { return { ok: false, error: "s2 bad json" }; }
    const rows = Array.isArray(j && j.data) ? j.data : [];
    /* The citations response carries no total, so the count of citations
     * S2 lists for the anchor comes from the paper record instead (see
     * fetchS2CitationCount). Null here means "page size is all we know". */
    return { ok: true, total: Number(j && j.total) || null, rows };
  }
  return { ok: false, throttled: true };
}

/* The anchor paper's own citationCount from S2, used for the coverage
 * line ("sentences held from N citing papers, of M citations listed").
 * One extra call at ingest time only; failure returns null and the
 * caller falls back to the fetched page size. */
export async function fetchS2CitationCount(doi, env, fetchImpl) {
  const doFetch = fetchImpl || ((url, opts, ms) => fetchWithTimeout(url, opts, ms));
  const headers = { Accept: "application/json" };
  const key = env && env.SEMANTIC_SCHOLAR_KEY ? String(env.SEMANTIC_SCHOLAR_KEY) : "";
  if (key) headers["x-api-key"] = key;
  try {
    const res = await doFetch(S2_BASE + "/paper/DOI:" + encodeURIComponent(doi) + "?fields=citationCount", { headers }, 12000);
    if (!res || !res.ok) return null;
    const j = await res.json();
    const n = Number(j && j.citationCount);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/* Turn one S2 citations payload into storable statement rows. Pure and
 * exported for tests: dedupe identical sentences from the same citing
 * paper, classify each at write time, order influential first then
 * newest citing paper, cap the store per anchor. */
export function shapeStatementRows(doi, payload) {
  const rows = [];
  const seen = new Set();
  const list = Array.isArray(payload && payload.rows) ? payload.rows : [];
  for (const edge of list) {
    const cp = (edge && edge.citingPaper) || {};
    const citingId = String(cp.paperId || (cp.externalIds && cp.externalIds.CorpusId) || "");
    if (!citingId) continue;
    const contexts = Array.isArray(edge.contexts) ? edge.contexts : [];
    const intents = Array.isArray(edge.intents) ? edge.intents.map((i) => String(i || "").toLowerCase()).filter(Boolean) : [];
    contexts.forEach((ctx, idx) => {
      const text = String(ctx || "").replace(/\s+/g, " ").trim();
      if (!text) return;
      const dedupeKey = citingId + "|" + text.toLowerCase();
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      const { stance } = classifyStatement(text, intents);
      rows.push({
        anchor_doi: doi,
        citing_id: citingId,
        ctx_idx: idx,
        citing_doi: cp.externalIds && cp.externalIds.DOI ? String(cp.externalIds.DOI).toLowerCase() : null,
        citing_title: cp.title ? String(cp.title).replace(/\s+/g, " ").trim().slice(0, 400) : null,
        citing_year: Number(cp.year) || null,
        context: text.slice(0, 1200),
        intents,
        influential: edge.isInfluential ? 1 : 0,
        stance,
        section: null,
      });
    });
  }
  rows.sort((a, b) => (b.influential - a.influential) || ((b.citing_year || 0) - (a.citing_year || 0)));
  return rows.slice(0, STATEMENTS_PER_ANCHOR_CAP);
}

/* Ingest one anchor DOI end to end. Safe to call concurrently for
 * different DOIs; the ingest row's "collecting" claim keeps two runs
 * from working the same DOI at once. */
export async function ingestAnchor(env, doi, opts = {}) {
  if (!env || !env.DB) return { doi, status: "unavailable" };
  await ensureStatementTables(env);
  const now = Date.now();
  try {
    await env.DB.prepare(
      "INSERT INTO statement_ingest (anchor_doi, status, fetched_at, next_try) VALUES (?1, 'collecting', ?2, 0) " +
      "ON CONFLICT(anchor_doi) DO UPDATE SET status = 'collecting'"
    ).bind(doi, now).run();
  } catch (e) {
    console.error("statements claim failed:", safeErr(e));
  }
  const payload = await fetchS2Citations(doi, env, opts.fetchImpl);
  const doneAt = Date.now();
  if (!payload.ok) {
    const status = payload.throttled ? "throttled" : "error";
    try {
      await env.DB.prepare(
        "UPDATE statement_ingest SET status = ?1, next_try = ?2, error = ?3 WHERE anchor_doi = ?4"
      ).bind(status, doneAt + STATEMENTS_THROTTLE_RETRY_MS, payload.throttled ? "s2 429" : String(payload.error || "error"), doi).run();
    } catch {}
    return { doi, status };
  }
  const rows = shapeStatementRows(doi, payload);
  const listed = await fetchS2CitationCount(doi, env, opts.fetchImpl);
  const citationsSeen = listed != null ? listed : (payload.total != null ? payload.total : payload.rows.length);
  try {
    await env.DB.prepare("DELETE FROM citation_statements WHERE anchor_doi = ?1").bind(doi).run();
    const stmt = env.DB.prepare(
      "INSERT OR REPLACE INTO citation_statements (anchor_doi, citing_id, ctx_idx, citing_doi, citing_title, citing_year, context, intents, influential, stance, section) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"
    );
    const batch = rows.map((r) => stmt.bind(
      r.anchor_doi, r.citing_id, r.ctx_idx, r.citing_doi, r.citing_title, r.citing_year,
      r.context, JSON.stringify(r.intents), r.influential, r.stance, r.section
    ));
    if (batch.length) await env.DB.batch(batch);
    await env.DB.prepare(
      "UPDATE statement_ingest SET status = ?1, fetched_at = ?2, next_try = 0, citations_seen = ?3, statements_kept = ?4, error = NULL WHERE anchor_doi = ?5"
    ).bind(rows.length ? "ready" : "empty", doneAt, citationsSeen, rows.length, doi).run();
  } catch (e) {
    console.error("statements store failed:", safeErr(e));
    try {
      await env.DB.prepare(
        "UPDATE statement_ingest SET status = 'error', next_try = ?1, error = ?2 WHERE anchor_doi = ?3"
      ).bind(doneAt + STATEMENTS_THROTTLE_RETRY_MS, safeErr(e), doi).run();
    } catch {}
    return { doi, status: "error" };
  }
  return { doi, status: rows.length ? "ready" : "empty", kept: rows.length, total: citationsSeen };
}

/* Read the store for a set of DOIs. Returns, per DOI: the ingest state
 * plus up to STATEMENTS_RESPONSE_CAP statements and our own counts over
 * everything held (counts describe the full stored set, not the page). */
export async function readStatements(env, dois, now = Date.now()) {
  const out = {};
  if (!env || !env.DB || !dois.length) {
    for (const doi of dois) out[doi] = { status: "unavailable", counts: null, citingPapers: 0, totalCitations: 0, kept: 0, items: [] };
    return out;
  }
  await ensureStatementTables(env);
  const placeholders = dois.map((_, i) => "?" + (i + 1)).join(",");
  let ingestRows = [];
  let stmtRows = [];
  try {
    const a = await env.DB.prepare(
      `SELECT anchor_doi, status, fetched_at, next_try, citations_seen, statements_kept FROM statement_ingest WHERE anchor_doi IN (${placeholders})`
    ).bind(...dois).all();
    ingestRows = (a && a.results) || [];
    const b = await env.DB.prepare(
      `SELECT anchor_doi, citing_id, citing_doi, citing_title, citing_year, context, intents, influential, stance, section FROM citation_statements WHERE anchor_doi IN (${placeholders}) ORDER BY influential DESC, citing_year DESC`
    ).bind(...dois).all();
    stmtRows = (b && b.results) || [];
  } catch (e) {
    console.error("statements read failed:", safeErr(e));
    for (const doi of dois) out[doi] = { status: "unavailable", counts: null, citingPapers: 0, totalCitations: 0, kept: 0, items: [] };
    return out;
  }
  const ingestBy = new Map(ingestRows.map((r) => [r.anchor_doi, r]));
  const itemsBy = new Map();
  for (const r of stmtRows) {
    if (!itemsBy.has(r.anchor_doi)) itemsBy.set(r.anchor_doi, []);
    itemsBy.get(r.anchor_doi).push(r);
  }
  for (const doi of dois) {
    const ing = ingestBy.get(doi) || null;
    const all = itemsBy.get(doi) || [];
    const counts = { supporting: 0, contradicting: 0, mentioning: 0 };
    for (const r of all) if (counts[r.stance] != null) counts[r.stance]++;
    const citingPapers = new Set(all.map((r) => r.citing_id)).size;
    const items = all.slice(0, STATEMENTS_RESPONSE_CAP).map((r) => {
      let intents = [];
      try { intents = JSON.parse(r.intents || "[]"); } catch {}
      return {
        sentence: r.context,
        stance: r.stance,
        intents,
        influential: Boolean(r.influential),
        section: r.section || null,
        citing: { title: r.citing_title || null, year: r.citing_year || null, doi: r.citing_doi || null },
      };
    });
    let status;
    if (!ing) status = "collecting";
    else if (ing.status === "ready") status = "ready";
    else if (ing.status === "empty") status = "empty";
    else if (ing.status === "collecting") status = "collecting";
    else status = "collecting"; /* throttled or error: a retry is due or running */
    out[doi] = {
      status,
      counts: all.length ? counts : null,
      citingPapers: all.length ? citingPapers : 0,
      totalCitations: ing ? Number(ing.citations_seen) || 0 : 0,
      kept: ing ? Number(ing.statements_kept) || 0 : all.length,
      fetchedAt: ing ? Number(ing.fetched_at) || null : null,
      items,
    };
  }
  return out;
}
