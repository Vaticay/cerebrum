/**
 * functions/lib/docJobs.js — durable job layer for very long document
 * analyses (nuance #31).
 *
 * Document Mode already streams progress over SSE, but SSE is a live
 * connection: if the client disconnects, the work is lost and the retry
 * starts over. For very long documents the honest pattern is a DURABLE
 * job: enqueue → 202 + job_id immediately → GET status polls → idempotent
 * steps advance → done/failed. A dropped connection loses nothing; the
 * client re-polls and finds the job where it left it.
 *
 * TABLES (lazily created):
 * - doc_jobs(job_id PK, user_id, kind, status, step, total_steps, note,
 *   payload_json, result_json, error, created_at, updated_at)
 *   status ∈ queued | running | done | failed
 * - doc_dlq(job_id PK, user_id, kind, error, failed_at): the dead-letter
 *   queue. A job lands here exactly once, when it transitions to failed —
 *   and logDlqAlert() writes a structured operator alert at the same
 *   moment, because a DLQ nobody watches is a second trash can.
 *
 * IDEMPOTENCY. advanceJob() only moves step FORWARD (a retried worker
 * reporting step 3 after step 5 was recorded is ignored, not applied).
 * completeJob() is a no-op when the job is already done/failed, so a
 * double-delivered worker can't overwrite a final state.
 */

import { jsonLog } from "./requestLog.js";

const STEPS = ["queued", "running", "done", "failed"];

let jobsTableReady = null;
let dlqTableReady = null;

function ensureJobsTable(db) {
  if (!jobsTableReady) {
    jobsTableReady = db.exec(
      "CREATE TABLE IF NOT EXISTS doc_jobs (" +
        "job_id TEXT NOT NULL PRIMARY KEY, " +
        "user_id TEXT NOT NULL, " +
        "kind TEXT NOT NULL, " +
        "status TEXT NOT NULL, " +
        "step INTEGER NOT NULL DEFAULT 0, " +
        "total_steps INTEGER NOT NULL DEFAULT 1, " +
        "note TEXT, " +
        "payload_json TEXT, " +
        "result_json TEXT, " +
        "error TEXT, " +
        "created_at INTEGER NOT NULL, " +
        "updated_at INTEGER NOT NULL)"
    ).then(
      () => db.exec("CREATE INDEX IF NOT EXISTS idx_doc_jobs_user ON doc_jobs(user_id, updated_at)").then(() => true),
      (e) => { jobsTableReady = null; throw e; }
    );
  }
  return jobsTableReady;
}

function ensureDlqTable(db) {
  if (!dlqTableReady) {
    dlqTableReady = db.exec(
      "CREATE TABLE IF NOT EXISTS doc_dlq (" +
        "job_id TEXT NOT NULL PRIMARY KEY, " +
        "user_id TEXT NOT NULL, " +
        "kind TEXT NOT NULL, " +
        "error TEXT, " +
        "failed_at INTEGER NOT NULL)"
    ).then(() => true, (e) => { dlqTableReady = null; throw e; });
  }
  return dlqTableReady;
}

function newJobId() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return "dj_" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Enqueue a job. Returns { jobId }. The payload (document text, query,
 * options) is stored so a worker — even a retried one — can run without
 * the original request. Callers should keep payloads bounded (the route
 * enforces MAX_DOCUMENT_LEN before enqueueing).
 */
export async function enqueueJob(env, { userId, kind, payload }) {
  if (!env || !env.DB) throw new Error("no_db");
  await ensureJobsTable(env.DB);
  const jobId = newJobId();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO doc_jobs (job_id, user_id, kind, status, step, total_steps, note, payload_json, result_json, error, created_at, updated_at) " +
      "VALUES (?, ?, ?, 'queued', 0, 1, ?, ?, NULL, NULL, ?, ?)"
  ).bind(jobId, String(userId), String(kind || "document"), "queued — waiting for a worker", JSON.stringify(payload || {}), now, now).run();
  jsonLog("info", "doc_job_enqueued", { jobId, userId: String(userId), kind: String(kind || "document") });
  return { jobId };
}

/** Public status shape for GET /api/document?job_id=. Null when not found / not yours. */
export async function getJobStatus(env, userId, jobId) {
  if (!env || !env.DB) return null;
  await ensureJobsTable(env.DB);
  const row = await env.DB.prepare(
    "SELECT job_id, kind, status, step, total_steps, note, result_json, error, created_at, updated_at " +
      "FROM doc_jobs WHERE job_id = ? AND user_id = ?"
  ).bind(String(jobId), String(userId)).first();
  if (!row) return null;
  let result = null;
  try { result = row.result_json ? JSON.parse(row.result_json) : null; } catch { result = null; }
  return {
    job_id: row.job_id,
    kind: row.kind,
    status: row.status,
    step: row.step | 0,
    total_steps: row.total_steps | 0,
    note: row.note || null,
    result,
    error: row.error || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Read the stored payload for a worker. Null when missing. */
export async function getJobPayload(env, jobId) {
  if (!env || !env.DB) return null;
  await ensureJobsTable(env.DB);
  const row = await env.DB.prepare("SELECT payload_json FROM doc_jobs WHERE job_id = ?").bind(String(jobId)).first();
  if (!row || !row.payload_json) return null;
  try { return JSON.parse(row.payload_json); } catch { return null; }
}

/** Mark running. Idempotent: a job already running/done/failed is untouched. */
export async function startJob(env, jobId, totalSteps, note) {
  if (!env || !env.DB) return;
  await ensureJobsTable(env.DB);
  await env.DB.prepare(
    "UPDATE doc_jobs SET status = 'running', total_steps = ?, step = 0, note = ?, updated_at = ? " +
      "WHERE job_id = ? AND status = 'queued'"
  ).bind(Math.max(1, totalSteps | 0 || 1), String(note || "").slice(0, 300), Date.now(), String(jobId)).run();
}

/**
 * Advance the step counter. IDEMPOTENT: only forward motion is applied —
 * a retried worker reporting an older step is ignored.
 */
export async function advanceJob(env, jobId, step, totalSteps, note) {
  if (!env || !env.DB) return { advanced: false };
  await ensureJobsTable(env.DB);
  const res = await env.DB.prepare(
    "UPDATE doc_jobs SET step = ?, total_steps = ?, note = ?, updated_at = ? " +
      "WHERE job_id = ? AND status = 'running' AND ? > step"
  ).bind(step | 0, Math.max(1, totalSteps | 0 || 1), String(note || "").slice(0, 300), Date.now(), String(jobId), step | 0).run();
  const changed = res && res.meta ? res.meta.changes | 0 : 0;
  return { advanced: changed > 0 };
}

/** Terminal success. No-op when already done/failed (double delivery). */
export async function completeJob(env, jobId, result) {
  if (!env || !env.DB) return { completed: false };
  await ensureJobsTable(env.DB);
  const res = await env.DB.prepare(
    "UPDATE doc_jobs SET status = 'done', step = total_steps, result_json = ?, updated_at = ? " +
      "WHERE job_id = ? AND status IN ('queued', 'running')"
  ).bind(JSON.stringify(result == null ? {} : result).slice(0, 500_000), Date.now(), String(jobId)).run();
  const changed = res && res.meta ? res.meta.changes | 0 : 0;
  if (changed > 0) jsonLog("info", "doc_job_done", { jobId });
  return { completed: changed > 0 };
}

/**
 * Terminal failure → DLQ + operator alert. The alert is the point: a
 * dead-letter queue nobody watches is just a second trash can.
 */
export async function failJob(env, jobId, error) {
  if (!env || !env.DB) return { failed: false };
  await ensureJobsTable(env.DB);
  await ensureDlqTable(env.DB);
  const errText = String((error && error.message) || error || "unknown").slice(0, 500);
  const res = await env.DB.prepare(
    "UPDATE doc_jobs SET status = 'failed', error = ?, updated_at = ? " +
      "WHERE job_id = ? AND status IN ('queued', 'running')"
  ).bind(errText, Date.now(), String(jobId)).run();
  const changed = res && res.meta ? res.meta.changes | 0 : 0;
  if (changed > 0) {
    const meta = await env.DB.prepare("SELECT user_id, kind FROM doc_jobs WHERE job_id = ?").bind(String(jobId)).first().catch(() => null);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO doc_dlq (job_id, user_id, kind, error, failed_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(String(jobId), (meta && meta.user_id) || "", (meta && meta.kind) || "", errText, Date.now()).run().catch(() => {});
    logDlqAlert({ jobId, userId: (meta && meta.user_id) || "", kind: (meta && meta.kind) || "", error: errText });
  }
  return { failed: changed > 0 };
}

/** Structured operator alert on every DLQ arrival. */
export function logDlqAlert({ jobId, userId, kind, error }) {
  jsonLog("error", "doc_dlq_arrival", {
    jobId,
    userId,
    kind,
    error: String(error || "").slice(0, 300),
    action: "inspect doc_dlq row; re-enqueue or contact user",
  });
}

/** Recent DLQ rows for the operator (newest first). */
export async function listDlq(env, limit = 50) {
  if (!env || !env.DB) return [];
  await ensureDlqTable(env.DB);
  const rows = await env.DB.prepare(
    "SELECT job_id, user_id, kind, error, failed_at FROM doc_dlq ORDER BY failed_at DESC LIMIT ?"
  ).bind(Math.max(1, Math.min(200, limit | 0 || 50))).all().catch(() => null);
  return (rows && rows.results) || [];
}

export { STEPS };
