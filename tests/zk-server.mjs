/**
 * Zero-knowledge saved work ("Private Vault", Phase 1) — server tests.
 *
 * Unit tests against the real functions/lib/validate.js plus static source
 * assertions on functions/api/data.js, functions/lib/authHelpers.js, and
 * schema.sql pinning the blind-storage contract: the server validates shape
 * and size only, never decrypts, and rejects stale-dek writes fail-closed
 * with 409. No server, no database, no network.
 *
 * Run with: node tests/zk-server.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIMITS,
  ZK_KINDS,
  safeZkKind,
  safeZkBase64,
} from "../functions/lib/validate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataJs = await readFile(join(root, "functions/api/data.js"), "utf8");
const authHelpers = await readFile(join(root, "functions/lib/authHelpers.js"), "utf8");
const schemaSql = await readFile(join(root, "schema.sql"), "utf8");
const validateJs = await readFile(join(root, "functions/lib/validate.js"), "utf8");

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

function group(name) {
  console.log(`\n${name}`);
}

// ══════════════════════════════════════════════════════════════════
group("Validators — shape of the blind-storage contract");

await test("ZK_KINDS is exactly the four designed kinds", () => {
  assert.deepEqual([...ZK_KINDS].sort(), ["annotation", "collection-meta", "investigation", "paper"]);
});

for (const kind of ["paper", "investigation", "collection-meta", "annotation"]) {
  await test(`safeZkKind accepts '${kind}'`, () => {
    assert.equal(safeZkKind(kind), kind);
  });
}

for (const bad of ["Paper", "PAPER", "note", "", null, undefined, 42, "paper ", "collection_meta"]) {
  await test(`safeZkKind rejects ${JSON.stringify(bad)}`, () => {
    assert.equal(safeZkKind(bad), null);
  });
}

await test("safeZkBase64 accepts well-formed base64 within the cap", () => {
  const good = Buffer.from("twelve-bytes!").toString("base64"); // 12 bytes -> 16 chars
  assert.equal(safeZkBase64(good, 64), good);
  assert.equal(safeZkBase64("QUJD", 64), "QUJD");
  assert.equal(safeZkBase64("QUJDRA==", 64), "QUJDRA==");
  assert.equal(safeZkBase64("QUJD=", 64), "QUJD="); // single padding is valid base64
});

for (const bad of ["", "not base64!!", "QUJD\n", "QU JD", "QUJD===", 42, null, undefined]) {
  await test(`safeZkBase64 rejects ${JSON.stringify(bad)}`, () => {
    assert.equal(safeZkBase64(bad, 64), null);
  });
}

await test("safeZkBase64 enforces the length cap", () => {
  const s = "QUJD".repeat(20); // 80 chars, valid alphabet
  assert.equal(safeZkBase64(s, 64), null);
  assert.equal(safeZkBase64(s, 80), s);
});

await test("LIMITS carry the zk size bounds", () => {
  assert.ok(LIMITS.ZK_VAULT_JSON > 0, "ZK_VAULT_JSON");
  assert.ok(LIMITS.ZK_NONCE >= 16, "ZK_NONCE fits a 12-byte nonce");
  assert.equal(LIMITS.ZK_DATA, 1_400_000, "ZK_DATA matches the client cap");
  assert.ok(LIMITS.ZK_BATCH >= 1 && LIMITS.ZK_BATCH <= 1000, "ZK_BATCH sane");
});

// ══════════════════════════════════════════════════════════════════
group("data.js — blind-storage endpoints exist");

for (const action of ["zk-put-vault", "zk-get-vault", "zk-put-items", "zk-get-items", "zk-delete-item", "zk-drop-vault", "zk-purge-legacy"]) {
  await test(`action '${action}' is handled`, () => {
    assert.ok(dataJs.includes(`action === "${action}"`), `missing handler for ${action}`);
  });
}

await test("stale dek_id writes are rejected with 409/stale_dek", () => {
  assert.ok(dataJs.includes('"stale_dek"'), "no stale_dek code");
  assert.ok(/stale_dek.{0,200}409|409.{0,200}stale_dek/s.test(dataJs) || dataJs.includes('409, "stale_dek"'), "stale_dek not a 409");
});

await test("oversized batches are rejected, never truncated", () => {
  const idx = dataJs.indexOf('action === "zk-put-items"');
  const block = dataJs.slice(idx, idx + 1200);
  assert.ok(block.includes("body.items.length > LIMITS.ZK_BATCH"), "batch cap check missing");
  assert.ok(block.includes('"too_large"'), "oversized batch must be a 413/too_large");
});

await test("item upsert is last-writer-wins on updated_at", () => {
  assert.ok(
    dataJs.includes("excluded.updated_at >= zk_saved_items.updated_at"),
    "LWW guard missing from the ON CONFLICT upsert"
  );
});

await test("put-items is gated on the vault's current dek_id before any write", () => {
  const idx = dataJs.indexOf('action === "zk-put-items"');
  const block = dataJs.slice(idx, idx + 6000);
  assert.ok(block.includes("SELECT dek_id FROM zk_data_vault"), "vault lookup missing");
  assert.ok(block.includes("dekId !== vault.dek_id"), "generation comparison missing");
  // The gate must run before the first statement is pushed.
  assert.ok(block.indexOf("stale_dek") < block.indexOf("stmts.push"), "gate must precede writes");
});

await test("purge-legacy requires explicit confirm:true", () => {
  const idx = dataJs.indexOf('action === "zk-purge-legacy"');
  const block = dataJs.slice(idx, idx + 1500);
  assert.ok(block.includes("body.confirm !== true"), "confirm gate missing");
  assert.ok(block.includes("user_saved_sources") && block.includes("user_history") && block.includes("user_collections"),
    "must delete all three plaintext tables");
});

await test("drop-vault never writes plaintext back", () => {
  const start = dataJs.indexOf('action === "zk-drop-vault"');
  const end = dataJs.indexOf('action === "zk-purge-legacy"', start);
  const block = dataJs.slice(start, end);
  assert.ok(!/user_saved_sources|user_history|user_collections/.test(block), "drop-vault must not touch plaintext tables");
});

await test("no decryption anywhere in the Private Vault handlers", () => {
  const start = dataJs.indexOf("Zero-knowledge saved work (\"Private Vault\"");
  const end = dataJs.indexOf("// Public device directory", start);
  const block = dataJs.slice(start, end);
  // Call-shaped decryption only — the words "decrypted"/"never decrypts"
  // appear in the blind-storage comments themselves, which is the point.
  assert.ok(!/\bdecrypt\s*\(|createDecipheriv|\.decrypt\b/.test(block), "zk handlers must never decrypt");
});

await test("wrapped_dek is never parsed for content beyond shape", () => {
  const idx = dataJs.indexOf('action === "zk-put-vault"');
  const block = dataJs.slice(idx, idx + 2500);
  // Shape fields only: v, kdf, salt, nonce, data — no payload/content access.
  assert.ok(!/payload|plaintext|title|abstract/i.test(block), "vault handler must not interpret content");
});

// ══════════════════════════════════════════════════════════════════
group("DDL — vault and items tables");

await test("schema.sql defines zk_data_vault keyed one row per user", () => {
  assert.ok(schemaSql.includes("CREATE TABLE IF NOT EXISTS zk_data_vault"), "missing table");
  assert.ok(/CREATE TABLE IF NOT EXISTS zk_data_vault \([\s\S]*?user_id\s+TEXT PRIMARY KEY/.test(schemaSql), "must be PRIMARY KEY (user_id)");
});

await test("schema.sql defines zk_saved_items keyed per (user_id, id)", () => {
  assert.ok(schemaSql.includes("CREATE TABLE IF NOT EXISTS zk_saved_items"), "missing table");
  assert.ok(/CREATE TABLE IF NOT EXISTS zk_saved_items \([\s\S]*?PRIMARY KEY \(user_id, id\)/.test(schemaSql), "must be PRIMARY KEY (user_id, id)");
  for (const col of ["collection_id", "kind", "dek_id", "nonce", "data", "rev", "created_at", "updated_at"]) {
    assert.ok(schemaSql.includes(col), `missing column ${col}`);
  }
});

await test("authHelpers self-heal creates both zk tables", () => {
  assert.ok(authHelpers.includes("CREATE TABLE IF NOT EXISTS zk_data_vault"), "vault self-heal missing");
  assert.ok(authHelpers.includes("CREATE TABLE IF NOT EXISTS zk_saved_items"), "items self-heal missing");
  assert.ok(authHelpers.includes("idx_zk_saved_items_updated"), "items index missing");
});

await test("schema.sql documents the blind-storage rule", () => {
  assert.ok(/never decrypt/i.test(schemaSql), "the never-decrypt rule must be written in the DDL comments");
});

await test("validate.js never claims an audit", () => {
  assert.ok(!/audit/i.test(validateJs), "no audit claims in validate.js");
  const zkCommentBlock = dataJs.slice(dataJs.indexOf("Private Vault"), dataJs.indexOf("Private Vault") + 1200);
  assert.ok(!/audit/i.test(zkCommentBlock), "no audit claims in zk comments");
});

// ══════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
