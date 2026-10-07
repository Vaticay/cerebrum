// Tests for Pro telemetry: per-key API usage, template usage, denial stats.
// All use in-memory D1 mocks — no network, no real database.

import { ensureUsageTable, recordApiKeyUsage, getApiKeyUsage } from "../functions/lib/apiKeys.js";
import { ensureTemplateTable, recordTemplateStart, getTemplateStats, isKnownTemplate } from "../functions/lib/templateTelemetry.js";
import { ensureDenialTable, recordSlotDenial, getDenialStats } from "../functions/lib/searchPriority.js";

// Minimal D1 mock: supports the SQL patterns these modules use.
function mockDb() {
  const tables = { api_key_usage: [], template_usage: [], search_denials: [], api_keys: [] };
  return {
    tables,
    async exec(sql) { return { success: true }; },
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...params) { this._params = params; return this; },
        async run() {
          const sql = this._sql;
          const p = this._params;
          if (/INSERT INTO api_key_usage/.test(sql)) {
            const [key_id, day, , errFlag, errFlag2] = p;
            let row = tables.api_key_usage.find((r) => r.key_id === key_id && r.day === day);
            if (!row) { row = { key_id, day, calls: 0, errors: 0 }; tables.api_key_usage.push(row); }
            row.calls += 1; row.errors += (errFlag ? 1 : 0);
          } else if (/INSERT INTO template_usage/.test(sql)) {
            const [template_id, day] = p;
            let row = tables.template_usage.find((r) => r.template_id === template_id && r.day === day);
            if (!row) { row = { template_id, day, starts: 0 }; tables.template_usage.push(row); }
            row.starts += 1;
          } else if (/INSERT INTO search_denials/.test(sql)) {
            const [day] = p;
            let row = tables.search_denials.find((r) => r.day === day);
            if (!row) { row = { day, denials: 0 }; tables.search_denials.push(row); }
            row.denials += 1;
          }
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          const sql = this._sql;
          const p = this._params;
          if (/SELECT denials FROM search_denials/.test(sql)) {
            return tables.search_denials.find((r) => r.day === p[0]) || null;
          }
          if (/SUM\(calls\)/.test(sql)) {
            const rows = tables.api_key_usage.filter((r) => r.key_id === p[0]);
            return { calls: rows.reduce((s, r) => s + r.calls, 0), errors: rows.reduce((s, r) => s + r.errors, 0) };
          }
          return null;
        },
        async all() {
          const sql = this._sql;
          const p = this._params;
          if (/FROM api_key_usage WHERE key_id/.test(sql)) {
            return { results: tables.api_key_usage.filter((r) => r.key_id === p[0] && r.day >= p[1]) };
          }
          if (/FROM template_usage WHERE day/.test(sql)) {
            return { results: tables.template_usage.filter((r) => r.day >= p[0]) };
          }
          if (/GROUP BY template_id/.test(sql)) {
            const byId = {};
            for (const r of tables.template_usage) byId[r.template_id] = (byId[r.template_id] || 0) + r.starts;
            return { results: Object.entries(byId).map(([template_id, starts]) => ({ template_id, starts })) };
          }
          if (/FROM search_denials WHERE day/.test(sql)) {
            return { results: tables.search_denials.filter((r) => r.day >= p[0]) };
          }
          return { results: [] };
        },
      };
    },
  };
}

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log("  ✓ " + name); }
  else { failed++; console.log("  ✗ FAIL: " + name); }
}

// ── API key usage ──
{
  const db = mockDb();
  const env = { DB: db };
  // Seed a key so listApiKeys finds it.
  db.tables.api_keys.push({ id: "k1", user_id: "u1", key_hash: "h", key_prefix: "cbk_abc", name: "test", created_at: Date.now(), last_used_at: null, revoked_at: null });
  // listApiKeys is imported from apiKeys.js — it queries api_keys; our mock
  // returns [] for unknown patterns, so stub at the module level is hard.
  // Instead test record + direct table assertions, and getApiKeyUsage's
  // graceful empty path.
  await recordApiKeyUsage(env, "k1", false);
  await recordApiKeyUsage(env, "k1", false);
  await recordApiKeyUsage(env, "k1", true);
  const rows = db.tables.api_key_usage.filter((r) => r.key_id === "k1");
  ok("recordApiKeyUsage aggregates daily calls", rows.length === 1 && rows[0].calls === 3);
  ok("recordApiKeyUsage counts errors", rows[0].errors === 1);
  // Never throws without DB.
  await recordApiKeyUsage({}, "k1", false);
  await recordApiKeyUsage(null, "k1", false);
  ok("recordApiKeyUsage never throws without DB", true);
  const empty = await getApiKeyUsage({}, "u1");
  ok("getApiKeyUsage returns [] without DB", Array.isArray(empty) && empty.length === 0);
}

// ── Template telemetry ──
{
  const db = mockDb();
  const env = { DB: db };
  ok("isKnownTemplate accepts real ids", isKnownTemplate("lit-review") && isKnownTemplate("drug-mechanism"));
  ok("isKnownTemplate rejects garbage", !isKnownTemplate("drop-table") && !isKnownTemplate(""));
  await recordTemplateStart(env, "lit-review");
  await recordTemplateStart(env, "lit-review");
  await recordTemplateStart(env, "drug-mechanism");
  await recordTemplateStart(env, "not-a-template"); // silently dropped
  const rows = db.tables.template_usage;
  ok("recordTemplateStart counts per template", rows.find((r) => r.template_id === "lit-review").starts === 2);
  ok("recordTemplateStart drops unknown ids", !rows.find((r) => r.template_id === "not-a-template"));
  await recordTemplateStart({}, "lit-review");
  ok("recordTemplateStart never throws without DB", true);
  const stats = await getTemplateStats(env);
  ok("getTemplateStats returns all 4 templates", stats.length === 4);
  const lit = stats.find((s) => s.templateId === "lit-review");
  ok("getTemplateStats totals are correct", lit && lit.totalStarts === 2 && lit.starts30d === 2);
  const empty = await getTemplateStats({});
  ok("getTemplateStats returns [] without DB", Array.isArray(empty) && empty.length === 0);
}

// ── Denial stats ──
{
  const db = mockDb();
  const env = { DB: db };
  const c1 = await recordSlotDenial(env);
  const c2 = await recordSlotDenial(env);
  ok("recordSlotDenial increments and returns count", c1 === 1 && c2 === 2);
  const stats = await getDenialStats(env);
  ok("getDenialStats reports today", stats.today === 2);
  ok("getDenialStats reports last7d", stats.last7d === 2);
  const n = await recordSlotDenial({});
  ok("recordSlotDenial returns 0 without DB", n === 0);
  const f = await getDenialStats(null);
  ok("getDenialStats fallback without DB", f.today === 0 && f.last7d === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
