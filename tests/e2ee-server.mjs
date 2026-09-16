/**
 * E2EE server tests (Phase 1.2).
 *
 * Unit tests against the real functions/lib/e2eeValidate.js — no server,
 * no database — plus static source assertions on functions/api/data.js,
 * functions/lib/authHelpers.js, and schema.sql pinning the security-critical
 * behaviors: fail-closed send-message gating, atomic one-time-key claims,
 * anti-enumeration in claim-keys, and no plaintext previews for encrypted
 * threads.
 *
 * The lockstep test builds a REAL Olm envelope with src/e2ee/crypto.js and
 * feeds it to the server-side validator: if the two ever drift, this fails.
 *
 * Run with: node tests/e2ee-server.mjs
 */

import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isDeviceId,
  isBase64Key,
  isPrekeyEntry,
  parseCipherEnvelope,
  cleanDeviceLabel,
  MAX_PREKEY_BATCH,
} from "../functions/lib/e2eeValidate.js";
import {
  initCrypto,
  E2EEAccount,
  packEnvelope,
} from "../src/e2ee/crypto.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataJs = await readFile(join(root, "functions/api/data.js"), "utf8");
const authHelpers = await readFile(join(root, "functions/lib/authHelpers.js"), "utf8");
const schemaSql = await readFile(join(root, "schema.sql"), "utf8");

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL - ${name}: ${err.message}`);
  }
}

function srcHas(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `missing: ${label || needle}`);
}

// ── e2eeValidate.js unit tests ──────────────────────────────────────────

await test("isDeviceId accepts 22-char base64url, rejects the rest", async () => {
  assert.ok(isDeviceId("ABCDEFGHIJKLMNOPQRSTUV")); // 22 chars
  assert.ok(isDeviceId("abc_def-ghi12345678901")); // 22 chars, url-safe alphabet
  assert.ok(!isDeviceId("short"));
  assert.ok(!isDeviceId("ABCDEFGHIJKLMNOPQRSTUVW")); // 23
  assert.ok(!isDeviceId("ABCDEF+GHIJ/KLMNOPQRST")); // + and / are not url-safe
  assert.ok(!isDeviceId(""));
  assert.ok(!isDeviceId(null));
});

await test("isBase64Key accepts the bridge's unpadded output", async () => {
  await initCrypto();
  const a = await E2EEAccount.create();
  const keys = a.identityKeys();
  assert.equal(keys.curve25519.length, 43, "bridge emits unpadded base64");
  assert.ok(isBase64Key(keys.curve25519, 32));
  assert.ok(isBase64Key(keys.ed25519, 32));
  assert.ok(isBase64Key(a.sign("x"), 64));
  // Padded form also accepted (forward-compat, other producers).
  assert.ok(isBase64Key(keys.curve25519 + "=", 32));
  assert.ok(!isBase64Key(keys.curve25519, 64), "wrong byte length rejected");
  assert.ok(!isBase64Key(keys.curve25519.slice(0, 40), 32), "truncated rejected");
  assert.ok(!isBase64Key("not base64!!!", 32));
  assert.ok(!isBase64Key("", 32));
});

await test("server validator accepts a REAL client envelope (lockstep)", async () => {
  await initCrypto();
  const alice = await E2EEAccount.create();
  const bob = await E2EEAccount.create();
  bob.generateOneTimeKeys(5);
  const bobId = bob.identityKeys();
  const otk = Object.values(bob.unpublishedOneTimeKeys())[0];
  const s = alice.createOutboundSession(bobId.curve25519, otk);
  const msg = s.encrypt("lockstep");
  // device id: 16 random bytes, base64url, unpadded
  const deviceId = Buffer.from(crypto.getRandomValues(new Uint8Array(16)))
    .toString("base64url");
  const raw = packEnvelope({
    ...msg,
    senderDevice: deviceId,
    senderIdentityKey: alice.identityKeys().curve25519,
  });
  const env = parseCipherEnvelope(raw);
  assert.ok(env, "server must accept what the client produces");
  assert.equal(env.type, 0);
  assert.equal(env.sd, deviceId);
});

await test("parseCipherEnvelope rejects malformed envelopes", async () => {
  const good = JSON.stringify({
    v: 1, kind: "olm", type: 1, body: "Ym9keQ",
    sd: "ABCDEFGHIJKLMNOPQRSTUV", sk: "A".repeat(43),
  });
  assert.ok(parseCipherEnvelope(good));
  const bad = [
    "not json at all",
    "",
    JSON.stringify({ v: 2, kind: "olm", type: 1, body: "e", sd: "ABCDEFGHIJKLMNOPQRSTUV", sk: "A".repeat(43) }),
    JSON.stringify({ v: 1, kind: "plaintext", type: 1, body: "e", sd: "ABCDEFGHIJKLMNOPQRSTUV", sk: "A".repeat(43) }),
    JSON.stringify({ v: 1, kind: "olm", type: 5, body: "e", sd: "ABCDEFGHIJKLMNOPQRSTUV", sk: "A".repeat(43) }),
    JSON.stringify({ v: 1, kind: "olm", type: 1, body: "", sd: "ABCDEFGHIJKLMNOPQRSTUV", sk: "A".repeat(43) }),
    JSON.stringify({ v: 1, kind: "olm", type: 1, body: "e", sd: "short", sk: "A".repeat(43) }),
    JSON.stringify({ v: 1, kind: "olm", type: 1, body: "e", sd: "ABCDEFGHIJKLMNOPQRSTUV", sk: "tooshort" }),
    "x".repeat(20001),
  ];
  for (const b of bad) {
    assert.equal(parseCipherEnvelope(b), null, `must reject: ${String(b).slice(0, 50)}`);
  }
});

await test("isPrekeyEntry / cleanDeviceLabel", async () => {
  assert.ok(isPrekeyEntry({ id: "k1", pubkey: "A".repeat(43) }));
  assert.ok(!isPrekeyEntry({ id: "k1" }));
  assert.ok(!isPrekeyEntry({ id: "k1", pubkey: "short" }));
  assert.ok(!isPrekeyEntry(null));
  assert.equal(cleanDeviceLabel("  Dusty's iPhone  ", ), "Dusty's iPhone");
  assert.equal(cleanDeviceLabel("x".repeat(100)).length, 60);
  assert.equal(cleanDeviceLabel(null), "");
});

// ── data.js static security assertions ──────────────────────────────────

await test("send-message rejects plaintext into encrypted threads", async () => {
  srcHas(dataJs, "e2ee_plaintext_rejected");
  srcHas(dataJs, "msgKind = \"cipher\"");
  srcHas(dataJs, "e2ee_unexpected_cipher", "cipher into plaintext thread rejected");
});

await test("send-message gates encrypted threads fully", async () => {
  srcHas(dataJs, "e2ee_bad_device");
  srcHas(dataJs, "e2ee_unknown_device", "sender device must be registered");
  srcHas(dataJs, "e2ee_attachments_unsupported", "no plaintext attachments in Phase 1");
  srcHas(dataJs, "e2ee_device_mismatch", "envelope device must match sender");
  srcHas(dataJs, "sender_device_id", "device recorded on the row");
});

await test("claim-keys is atomic and anti-enumerating", async () => {
  srcHas(dataJs, "e2ee-claim-keys");
  srcHas(dataJs, "AND claimed_at IS NULL", "claim guarded");
  srcHas(dataJs, "upd.meta", "changes checked");
  srcHas(dataJs, "changes > 0", "lost race detected");
  srcHas(dataJs, "e2ee-claim:${user.id}", "dedicated rate-limit key");
  srcHas(dataJs, "body.device_ids", "targeted claims accepted");
  srcHas(dataJs, "onlyIds.has(d.device_id)", "unlisted devices skipped — no wasted one-time keys");
  // One identical empty shape for missing/self/undiscoverable/blocked/keyless.
  const claimBlock = dataJs.slice(dataJs.indexOf('action === "e2ee-claim-keys"'));
  const emptyCount = (claimBlock.match(/return empty\(\)/g) || []).length;
  assert.ok(emptyCount >= 3, `expected ≥3 anti-enumeration exits, found ${emptyCount}`);
  srcHas(dataJs, "target.discoverable === 0", "undiscoverable covered");
  srcHas(dataJs, "isBlockedPair(env, user.id, targetId)) return empty()", "blocked covered");
});

await test("peer-devices directory is non-consuming and exposes revocation", async () => {
  srcHas(dataJs, "e2ee-peer-devices", "directory endpoint");
  const at = dataJs.indexOf('action === "e2ee-peer-devices"');
  const end = dataJs.indexOf('action === "e2ee-claim-keys"', at);
  const blk = dataJs.slice(at, end);
  assert.ok(!/one_time_prekeys/i.test(blk), "directory never touches the one-time-key pool");
  assert.ok(blk.includes("revoked_at"), "revoked devices visible with revokedAt");
  assert.ok(blk.includes("revokedAt"), "revokedAt in the response shape");
  assert.ok(/return empty\(\)/.test(blk), "anti-enumeration preserved");
});

await test("publish-device validates key formats", async () => {
  srcHas(dataJs, "e2ee-publish-device");
  srcHas(dataJs, "isBase64Key(identityKey, 32)");
  srcHas(dataJs, "isBase64Key(prekeySig, 64)");
  srcHas(dataJs, "MAX_PREKEY_BATCH");
  srcHas(dataJs, "INSERT OR IGNORE INTO e2ee_one_time_prekeys", "idempotent prekey upload");
});

await test("revoke-device destroys unclaimed prekeys", async () => {
  srcHas(dataJs, "e2ee-revoke-device");
  srcHas(dataJs, "SET revoked_at = ?", "revocation timestamped");
  srcHas(dataJs, "DELETE FROM e2ee_one_time_prekeys", "unclaimed keys destroyed");
});

await test("revocation is sticky: re-publish never resurrects a device", async () => {
  // A stolen device re-publishing its own id must stay dead. The upsert
  // updates keys/labels but must not touch revoked_at.
  const at = dataJs.indexOf("ON CONFLICT(user_id, device_id) DO UPDATE SET");
  const upsert = dataJs.slice(at, at + 700);
  assert.ok(!upsert.includes("revoked_at ="), "upsert must not assign revoked_at");
  // The client needs to know it is revoked so it can fail closed.
  srcHas(dataJs, "revoked:", "publish response surfaces the revoked flag");
});

await test("upgrade-thread refuses to strand the peer", async () => {
  srcHas(dataJs, "e2ee-upgrade-thread");
  srcHas(dataJs, "e2ee_peer_not_ready");
  srcHas(dataJs, "e2ee_self_not_ready");
});

await test("start-thread auto-encrypts new DMs when both are ready", async () => {
  srcHas(dataJs, "INSERT OR IGNORE INTO e2ee_threads");
  srcHas(dataJs, "encrypted", "encrypted flag in start-thread response");
});

await test("inbox suppresses previews for encrypted threads", async () => {
  srcHas(dataJs, "encryptedSet", "bulk encrypted-thread lookup");
  srcHas(dataJs, "encrypted: true", "preview replaced, not redacted-in-place");
});

await test("thread passes ciphertext through with kind + device", async () => {
  srcHas(dataJs, "msg_kind, sender_device_id, envelope_version", "columns selected");
  srcHas(dataJs, "msgKind:", "kind surfaced to client");
  srcHas(dataJs, "senderDeviceId:", "device surfaced to client");
  srcHas(dataJs, "e2eeProtocol", "protocol surfaced to client");
});

// ── schema + self-heal ──────────────────────────────────────────────────

await test("schema.sql documents the E2EE tables", async () => {
  srcHas(schemaSql, "CREATE TABLE IF NOT EXISTS e2ee_devices");
  srcHas(schemaSql, "CREATE TABLE IF NOT EXISTS e2ee_one_time_prekeys");
  srcHas(schemaSql, "CREATE TABLE IF NOT EXISTS e2ee_threads");
  srcHas(schemaSql, "msg_kind", "column semantics documented");
  srcHas(schemaSql, "NEVER sees private keys", "threat model stated");
});

await test("ensureSocialTables self-heals the E2EE schema", async () => {
  srcHas(authHelpers, "e2ee_devices", "devices table");
  srcHas(authHelpers, "e2ee_one_time_prekeys", "prekey table");
  srcHas(authHelpers, "e2ee_threads", "thread state table");
  srcHas(authHelpers, "ADD COLUMN msg_kind", "messages columns");
  srcHas(authHelpers, "ADD COLUMN sender_device_id");
});

await test("MAX_PREKEY_BATCH is sane", async () => {
  assert.ok(MAX_PREKEY_BATCH >= 50 && MAX_PREKEY_BATCH <= 500);
});

// ── Phase 1.4: backup + device list ─────────────────────────────────────

await test("backup endpoints store the bundle opaquely, never interpreting it", async () => {
  const schema = schemaSql;
  const helpers = authHelpers;
  srcHas(dataJs, "e2ee-backup-put");
  srcHas(dataJs, "e2ee-backup-get", "fetch own bundles");
  srcHas(dataJs, "e2ee_backups", "backups table");
  srcHas(schema, "PRIMARY KEY (user_id, device_id)", "one backup per device — no silent overwrite");
  srcHas(helpers, "PRIMARY KEY (user_id, device_id)", "self-heal matches schema");
  srcHas(dataJs, "ON CONFLICT(user_id, device_id)", "upsert targets the per-device row");
  // The server must never decrypt or parse the plaintext of the bundle —
  // shape + size validation only. (Comments are stripped first so the
  // "never decrypt" policy comment itself can't trip the check.)
  const at = dataJs.indexOf('if (action === "e2ee-backup-put")');
  const end = dataJs.indexOf('if (action === "e2ee-backup-get")', at);
  const blk = dataJs.slice(at, end).replace(/\/\/[^\n]*/g, "");
  assert.ok(blk.includes("ciphertext"), "bundle shape validated");
  assert.ok(blk.includes("32768"), "size cap enforced");
  assert.ok(blk.includes("isDeviceId(deviceId)"), "device_id validated");
  assert.ok(!/decrypt/i.test(blk), "no decryption server-side, ever");
});

await test("backup rows are bounded per user; updating your own row is always allowed", async () => {
  const at = dataJs.indexOf('if (action === "e2ee-backup-put")');
  const end = dataJs.indexOf('if (action === "e2ee-backup-get")', at);
  const blk = dataJs.slice(at, end).replace(/\/\/[^\n]*/g, "");
  assert.ok(blk.includes("MAX_BACKUPS_PER_USER"), "per-user cap defined");
  assert.ok(blk.includes("too_many_backups"), "cap enforced with a typed error");
  // The count excludes the device's OWN row: re-uploading your backup
  // (the normal case) never trips the cap.
  assert.ok(blk.includes("device_id != ?"), "own row excluded from the count");
});

await test("list-devices exposes own devices with revocation state", async () => {
  srcHas(dataJs, "e2ee-list-devices");
  srcHas(dataJs, "revoked_at", "revocation state surfaced");
  srcHas(dataJs, "signingKey: d.signing_key", "Ed25519 keys exposed for symmetric safety numbers");
});

await test("schema.sql + self-heal cover the backups table", async () => {
  srcHas(schemaSql, "CREATE TABLE IF NOT EXISTS e2ee_backups");
  srcHas(authHelpers, "e2ee_backups", "backups table self-heals");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n${f.name}\n  ${f.err.stack}`);
  process.exit(1);
}
