/**
 * functions/lib/templateTelemetry.js — investigation template usage telemetry.
 *
 * Pro investigation templates (lit-review, drug-mechanism, trial-analysis,
 * methods-compare — see src/investigationTemplates.js)
 * are a headline Pro feature, but until now nobody could say whether anyone
 * actually starts one. This module records template starts as daily
 * aggregate counters — no user content, no topics, just "template X was
 * started N times on day Y".
 *
 * Table: template_usage (template_id TEXT, day TEXT, starts INTEGER,
 *   PRIMARY KEY (template_id, day)). Tiny by design: 4 templates x 365
 *   days = ~1.5k rows/year. Rows older than 90 days are fair game for
 *   retention sweeps (see functions/lib/retention.js).
 *
 * All functions are fail-safe: telemetry must never break the request it
 * measures.
 */

let tableReady = null;
export function ensureTemplateTable(env) {
  if (!env || !env.DB) return Promise.resolve(false);
  if (!tableReady) {
    tableReady = env.DB.exec(
      "CREATE TABLE IF NOT EXISTS template_usage (" +
        "template_id TEXT NOT NULL, " +
        "day TEXT NOT NULL, " +
        "starts INTEGER NOT NULL DEFAULT 0, " +
        "PRIMARY KEY (template_id, day)" +
        "); " +
        "CREATE INDEX IF NOT EXISTS idx_template_usage_day ON template_usage(day);"
    ).then(
      () => true,
      (e) => { tableReady = null; throw e; }
    );
  }
  return tableReady;
}

function utcDay(ts) {
  return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD
}

// Template ids are allowlisted — a garbage id from a tampered client
// doesn't create a garbage row. Must match src/investigationTemplates.js.
const KNOWN_TEMPLATES = new Set([
  "lit-review",
  "drug-mechanism",
  "trial-analysis",
  "methods-compare",
]);

export function isKnownTemplate(id) {
  return KNOWN_TEMPLATES.has(String(id || ""));
}

/**
 * Record one template start. Never throws — callers should run this via
 * waitUntil so it never delays the response.
 */
export async function recordTemplateStart(env, templateId) {
  try {
    if (!env || !env.DB || !isKnownTemplate(templateId)) return;
    await ensureTemplateTable(env);
    const day = utcDay(Date.now());
    await env.DB.prepare(
      "INSERT INTO template_usage (template_id, day, starts) VALUES (?, ?, 1) " +
      "ON CONFLICT(template_id, day) DO UPDATE SET starts = starts + 1"
    ).bind(String(templateId), day).run();
  } catch (cbErr) {
    console.error("[Cerebrum] templateTelemetry.js recordTemplateStart:", cbErr);
  }
}

/**
 * Template stats: per-template totals + 30-day window. Operator/Pro
 * dashboard fuel — "which templates earn their keep".
 * Returns [{ templateId, totalStarts, starts30d, daily: [{day, starts}] }]
 */
export async function getTemplateStats(env) {
  const fallback = [];
  try {
    if (!env || !env.DB) return fallback;
    await ensureTemplateTable(env);
    const monthAgo = utcDay(Date.now() - 29 * 86400000);
    const totals = await env.DB.prepare(
      "SELECT template_id, COALESCE(SUM(starts), 0) AS starts FROM template_usage GROUP BY template_id"
    ).all();
    const recent = await env.DB.prepare(
      "SELECT template_id, day, starts FROM template_usage WHERE day >= ? ORDER BY day DESC"
    ).bind(monthAgo).all();
    const totalById = {};
    for (const r of (totals && totals.results) || []) totalById[r.template_id] = r.starts || 0;
    const dailyById = {};
    for (const r of (recent && recent.results) || []) {
      (dailyById[r.template_id] = dailyById[r.template_id] || []).push({ day: r.day, starts: r.starts || 0 });
    }
    return [...KNOWN_TEMPLATES].map((id) => ({
      templateId: id,
      totalStarts: totalById[id] || 0,
      starts30d: (dailyById[id] || []).reduce((s, x) => s + x.starts, 0),
      daily: dailyById[id] || [],
    }));
  } catch (cbErr) {
    console.error("[Cerebrum] templateTelemetry.js getTemplateStats:", cbErr);
    return fallback;
  }
}
