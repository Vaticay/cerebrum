/**
 * E2EE crypto core tests (Phase 1: 1:1 DMs).
 *
 * Unit tests against the real modules — real vodozemac WASM, real Argon2id,
 * no server, no network. Covers the Olm handshake, session persistence,
 * envelope integrity, the zero-knowledge recovery bundle, and the first
 * adversarial cases (wrong-session decrypt, replay, wrong phrase).
 *
 * Run with: node tests/e2ee-crypto.mjs
 */

import { strict as assert } from "node:assert";
import {
  initCrypto,
  E2EEAccount,
  E2EESession,
  packEnvelope,
  parseEnvelope,
  ONE_TIME_KEY_COUNT,
} from "../src/e2ee/crypto.js";
import {
  generateRecoveryPhrase,
  isValidRecoveryPhrase,
  normalizePhrase,
  encryptBackupBundle,
  decryptBackupBundle,
  WRONG_PHRASE,
} from "../src/e2ee/recovery.js";

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

/** Two accounts with one published one-time key each; returns {alice, bob, ...}. */
async function makePair() {
  const alice = await E2EEAccount.create();
  const bob = await E2EEAccount.create();
  bob.generateOneTimeKeys(5);
  const bobId = bob.identityKeys();
  const bobOtk = Object.values(bob.unpublishedOneTimeKeys())[0];
  const sAB = alice.createOutboundSession(bobId.curve25519, bobOtk);
  return { alice, bob, bobId, sAB };
}

await test("initCrypto is idempotent", async () => {
  await initCrypto();
  await initCrypto();
});

await test("accounts have distinct identity keys", async () => {
  const a = await E2EEAccount.create();
  const b = await E2EEAccount.create();
  const ka = a.identityKeys();
  const kb = b.identityKeys();
  assert.ok(ka.curve25519.length >= 43 && ka.ed25519.length >= 43);
  assert.notEqual(ka.curve25519, kb.curve25519);
  assert.notEqual(ka.ed25519, kb.ed25519);
});

await test("one-time key publish flow", async () => {
  const a = await E2EEAccount.create();
  a.generateOneTimeKeys(ONE_TIME_KEY_COUNT);
  const unpublished = a.unpublishedOneTimeKeys();
  assert.equal(Object.keys(unpublished).length, ONE_TIME_KEY_COUNT);
  a.markKeysAsPublished();
  assert.equal(Object.keys(a.unpublishedOneTimeKeys()).length, 0);
});

await test("fallback key generation", async () => {
  const a = await E2EEAccount.create();
  a.generateFallbackKey();
  const fb = a.unpublishedFallbackKey();
  assert.equal(Object.keys(fb).length, 1);
});

await test("ed25519 signatures are deterministic per key", async () => {
  const a = await E2EEAccount.create();
  const b = await E2EEAccount.create();
  const s1 = a.sign("device-binding");
  const s2 = a.sign("device-binding");
  assert.equal(s1, s2);
  assert.ok(s1.length > 40);
  assert.notEqual(s1, b.sign("device-binding"));
});

await test("full Olm handshake both directions", async () => {
  const { alice, bob, sAB } = await makePair();
  // Alice -> Bob (prekey message, type 0)
  const m1 = sAB.encrypt("hello bob");
  assert.equal(m1.type, 0);
  const inbound = bob.createInboundSession(m1.body);
  assert.equal(inbound.plaintext, "hello bob");
  assert.equal(
    inbound.senderIdentityKey,
    alice.identityKeys().curve25519,
    "sender identity must match Alice"
  );
  const sBA = inbound.session;
  // Bob -> Alice (normal message, type 1)
  const m2 = sBA.encrypt("hi alice");
  assert.equal(m2.type, 1);
  assert.equal(sAB.decrypt(m2.type, m2.body), "hi alice");
  // Ratchet keeps working
  const m3 = sAB.encrypt("second message");
  assert.equal(sBA.decrypt(m3.type, m3.body), "second message");
});

await test("replayed message is rejected, not silently accepted", async () => {
  const { bob, sAB } = await makePair();
  const m1 = sAB.encrypt("once");
  const inbound = bob.createInboundSession(m1.body);
  const sBA = inbound.session;
  const m2 = sBA.encrypt("reply");
  assert.equal(sAB.decrypt(m2.type, m2.body), "reply");
  assert.throws(() => sAB.decrypt(m2.type, m2.body), /./, "replay must throw");
});

await test("decrypt with the wrong session throws", async () => {
  const { sAB } = await makePair();
  const eve = await E2EEAccount.create();
  eve.generateOneTimeKeys(5);
  const eveId = eve.identityKeys();
  const eveOtk = Object.values(eve.unpublishedOneTimeKeys())[0];
  const sAE = (await E2EEAccount.create()).createOutboundSession(
    eveId.curve25519,
    eveOtk
  );
  const m = sAE.encrypt("for eve only");
  assert.throws(() => sAB.decrypt(m.type, m.body), /./);
});

await test("prekey message for another account cannot be opened", async () => {
  const { sAB } = await makePair();
  const mallory = await E2EEAccount.create();
  const m = sAB.encrypt("secret");
  assert.equal(m.type, 0);
  assert.throws(() => mallory.createInboundSession(m.body), /./);
});

await test("session pickle round-trips across 'restarts'", async () => {
  const { bob, sAB } = await makePair();
  const m1 = sAB.encrypt("pick me up");
  const inbound = bob.createInboundSession(m1.body);
  const sBA = inbound.session;
  // "Restart" both sides from pickles
  const sAB2 = await E2EESession.fromPickle(sAB.pickle());
  const sBA2 = await E2EESession.fromPickle(sBA.pickle());
  const m2 = sBA2.encrypt("after restart");
  assert.equal(sAB2.decrypt(m2.type, m2.body), "after restart");
  assert.equal(sAB2.sessionId(), sAB.sessionId(), "session id must survive pickle");
});

await test("account pickle round-trips identity", async () => {
  const a = await E2EEAccount.create();
  const before = a.identityKeys();
  const b = await E2EEAccount.fromPickle(a.pickle());
  assert.deepEqual(b.identityKeys(), before);
});

await test("envelope pack/parse round-trip", async () => {
  const { sAB } = await makePair();
  const m = sAB.encrypt("envelope test");
  const raw = packEnvelope({
    ...m,
    senderDevice: "dev-alice-1",
    senderIdentityKey: "aGVsbG8=",
  });
  const env = parseEnvelope(raw);
  assert.equal(env.v, 1);
  assert.equal(env.kind, "olm");
  assert.equal(env.type, m.type);
  assert.equal(env.body, m.body);
  assert.equal(env.sd, "dev-alice-1");
});

await test("envelope parse rejects malformed input", async () => {
  for (const bad of [
    "not json",
    "{}",
    JSON.stringify({ v: 999, kind: "olm", type: 0, body: "x", sd: "d", sk: "k" }),
    JSON.stringify({ v: 1, kind: "plaintext", type: 0, body: "x", sd: "d", sk: "k" }),
    JSON.stringify({ v: 1, kind: "olm", type: 7, body: "x", sd: "d", sk: "k" }),
    JSON.stringify({ v: 1, kind: "olm", type: 0, sd: "d", sk: "k" }),
  ]) {
    assert.throws(() => parseEnvelope(bad), /malformed/, `should reject: ${bad.slice(0, 40)}`);
  }
});

await test("recovery phrase is 24 valid words", async () => {
  const phrase = generateRecoveryPhrase();
  assert.equal(phrase.split(" ").length, 24);
  assert.ok(isValidRecoveryPhrase(phrase));
  assert.ok(!isValidRecoveryPhrase("abandon abandon abandon"));
  assert.ok(!isValidRecoveryPhrase(""));
  assert.equal(normalizePhrase("  ABANDON   ability  "), "abandon ability");
});

await test("backup bundle round-trips with the right phrase", async () => {
  const a = await E2EEAccount.create();
  const pickle = a.pickle();
  const phrase = generateRecoveryPhrase();
  const bundle = await encryptBackupBundle(pickle, phrase);
  assert.equal(bundle.v, 1);
  assert.equal(bundle.kdf, "argon2id");
  assert.ok(bundle.salt && bundle.iv && bundle.ciphertext);
  // Bundle must not contain key material in the clear
  const bundleStr = JSON.stringify(bundle);
  assert.ok(!bundleStr.includes(a.identityKeys().curve25519.slice(0, 20)));
  const recovered = await decryptBackupBundle(bundle, phrase);
  assert.equal(recovered, pickle);
  // ...and the recovered pickle actually restores the account
  const b = await E2EEAccount.fromPickle(recovered);
  assert.deepEqual(b.identityKeys(), a.identityKeys());
});

await test("wrong phrase fails closed with WRONG_PHRASE", async () => {
  const a = await E2EEAccount.create();
  const bundle = await encryptBackupBundle(a.pickle(), generateRecoveryPhrase());
  const wrong = generateRecoveryPhrase();
  let code = null;
  try {
    await decryptBackupBundle(bundle, wrong);
  } catch (err) {
    code = err.code;
  }
  assert.equal(code, "WRONG_PHRASE");
});

await test("tampered bundle fails closed", async () => {
  const a = await E2EEAccount.create();
  const phrase = generateRecoveryPhrase();
  const bundle = await encryptBackupBundle(a.pickle(), phrase);
  const tampered = { ...bundle, ciphertext: bundle.ciphertext.slice(0, -4) + "AAAA" };
  let threw = false;
  try {
    await decryptBackupBundle(tampered, phrase);
  } catch {
    threw = true;
  }
  assert.ok(threw, "tampered ciphertext must not decrypt");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n${f.name}\n  ${f.err.stack}`);
  process.exit(1);
}
