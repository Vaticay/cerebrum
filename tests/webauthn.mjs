/**
 * WebAuthn (passkey) verification tests.
 *
 * Covers the crypto in functions/lib/webauthn.js where being wrong is
 * expensive: a signature that verifies when it shouldn't is an account
 * takeover, and a challenge that isn't bound is a replay. Unit tests
 * against the real module — no server, no database, no network.
 *
 * Run with: node tests/webauthn.mjs
 */

import { strict as assert } from "node:assert";
import { webcrypto } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { verifyRegistration, verifyAuthentication, rpIdHashB64, randomChallengeB64, b64urlToBytes, bytesToB64url } =
  await import(join(root, "functions/lib/webauthn.js"));

// Node 24 has WebCrypto global; the lib uses the global `crypto`.
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = webcrypto;

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push({ name, error: e }); console.log(`  ✗ ${name}\n      ${e.message}`); }
}

// ── Test helpers: build authenticator-shaped structures ──

function cborEncodeCoseKey(xB, yB) {
  const parts = [0xa5];
  const encInt = (n) => (n >= 0 ? [n] : [0x20 + (-1 - n)]);
  const encBytes = (b) => (b.length < 24 ? [0x40 + b.length, ...b] : [0x58, b.length, ...b]);
  for (const [k, v] of [[1, 2], [3, -7], [-1, 1]]) parts.push(...encInt(k), ...encInt(v));
  parts.push(...encInt(-2), ...encBytes(xB));
  parts.push(...encInt(-3), ...encBytes(yB));
  return new Uint8Array(parts);
}

function cborStr(s) { const b = new TextEncoder().encode(s); return [0x60 + b.length, ...b]; }

async function makeKeypair() {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  return { kp, pubJwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y } };
}

function rawToDer(raw) {
  const strip = (v) => { let i = 0; while (i < v.length - 1 && v[i] === 0) i++; return v.slice(i); };
  const pad = (v) => (v[0] & 0x80 ? new Uint8Array([0, ...v]) : v);
  const rb = pad(strip(raw.slice(0, 32))), sb = pad(strip(raw.slice(32)));
  const out = new Uint8Array(6 + rb.length + sb.length);
  out[0] = 0x30; out[1] = 4 + rb.length + sb.length; out[2] = 0x02; out[3] = rb.length;
  out.set(rb, 4); out[4 + rb.length] = 0x02; out[5 + rb.length] = sb.length; out.set(sb, 6 + rb.length);
  return out;
}

async function makeAttestation({ rpId, challenge, origin, kp, fmt = "none" }) {
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const rpIdHashBytes = b64urlToBytes(await rpIdHashB64(rpId));
  const credId = new Uint8Array(32); crypto.getRandomValues(credId);
  const coseKey = cborEncodeCoseKey(b64urlToBytes(jwk.x), b64urlToBytes(jwk.y));
  const authData = new Uint8Array(32 + 1 + 4 + 16 + 2 + 32 + coseKey.length);
  let o = 0;
  authData.set(rpIdHashBytes, o); o += 32;
  authData[o++] = 0x41; o += 4; o += 16;
  authData[o++] = 0; authData[o++] = 32;
  authData.set(credId, o); o += 32;
  authData.set(coseKey, o);
  const attObj = new Uint8Array([0xa3, ...cborStr("fmt"), ...cborStr(fmt),
    ...cborStr("authData"), 0x58, authData.length, ...authData, ...cborStr("attStmt"), 0xa0]);
  const clientData = { type: "webauthn.create", challenge, origin };
  return {
    attestationObjectB64: bytesToB64url(attObj),
    clientDataJSONB64: bytesToB64url(new TextEncoder().encode(JSON.stringify(clientData))),
    credIdB64: bytesToB64url(credId),
    pubJwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
  };
}

async function makeAssertion({ kp, rpId, challenge, origin, signCount = 1 }) {
  const rpIdHashBytes = b64urlToBytes(await rpIdHashB64(rpId));
  const authData = new Uint8Array(37);
  authData.set(rpIdHashBytes, 0);
  authData[32] = 0x01;
  authData[33] = (signCount >>> 24) & 0xff; authData[34] = (signCount >>> 16) & 0xff;
  authData[35] = (signCount >>> 8) & 0xff; authData[36] = signCount & 0xff;
  const clientData = { type: "webauthn.get", challenge, origin };
  const clientDataBytes = new TextEncoder().encode(JSON.stringify(clientData));
  const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataBytes));
  const signed = new Uint8Array(authData.length + clientDataHash.length);
  signed.set(authData); signed.set(clientDataHash, authData.length);
  const rawSig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, signed));
  return {
    authenticatorDataB64: bytesToB64url(authData),
    clientDataJSONB64: bytesToB64url(clientDataBytes),
    signatureB64: bytesToB64url(rawToDer(rawSig)),
  };
}

// ── Tests ──

console.log("\nWebAuthn verification");

await test("b64url round-trips binary data", () => {
  const orig = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
  const dec = b64urlToBytes(bytesToB64url(orig));
  assert.deepEqual([...dec], [...orig]);
});

await test("registration verifies a well-formed none attestation", async () => {
  const { kp } = await makeKeypair();
  const rpId = "askcerebrum.org", challenge = randomChallengeB64(), origin = "https://askcerebrum.org";
  const att = await makeAttestation({ rpId, challenge, origin, kp });
  const result = verifyRegistration({
    attestationObjectB64: att.attestationObjectB64,
    clientDataJSONB64: att.clientDataJSONB64,
    expectedChallengeB64: challenge,
    expectedRpId: rpId,
    expectedOrigin: origin,
  });
  assert.equal(result.credentialIdB64url, att.credIdB64);
  assert.equal(result.publicKeyJwk.x, att.pubJwk.x);
  assert.equal(result.publicKeyJwk.y, att.pubJwk.y);
});

await test("registration rejects non-none attestation formats", async () => {
  const { kp } = await makeKeypair();
  const rpId = "askcerebrum.org", challenge = randomChallengeB64(), origin = "https://askcerebrum.org";
  const att = await makeAttestation({ rpId, challenge, origin, kp, fmt: "packed" });
  assert.throws(() => verifyRegistration({
    attestationObjectB64: att.attestationObjectB64,
    clientDataJSONB64: att.clientDataJSONB64,
    expectedChallengeB64: challenge,
    expectedRpId: rpId,
    expectedOrigin: origin,
  }), /only none attestation/);
});

await test("registration rejects a mismatched challenge", async () => {
  const { kp } = await makeKeypair();
  const rpId = "askcerebrum.org", origin = "https://askcerebrum.org";
  const att = await makeAttestation({ rpId, challenge: randomChallengeB64(), origin, kp });
  assert.throws(() => verifyRegistration({
    attestationObjectB64: att.attestationObjectB64,
    clientDataJSONB64: att.clientDataJSONB64,
    expectedChallengeB64: randomChallengeB64(),
    expectedRpId: rpId,
    expectedOrigin: origin,
  }), /challenge mismatch/);
});

await test("registration rejects a mismatched origin", async () => {
  const { kp } = await makeKeypair();
  const rpId = "askcerebrum.org", challenge = randomChallengeB64();
  const att = await makeAttestation({ rpId, challenge, origin: "https://evil.example", kp });
  assert.throws(() => verifyRegistration({
    attestationObjectB64: att.attestationObjectB64,
    clientDataJSONB64: att.clientDataJSONB64,
    expectedChallengeB64: challenge,
    expectedRpId: rpId,
    expectedOrigin: "https://askcerebrum.org",
  }), /origin mismatch/);
});

await test("authentication verifies a well-formed assertion", async () => {
  const { kp, pubJwk } = await makeKeypair();
  const rpId = "askcerebrum.org", challenge = randomChallengeB64(), origin = "https://askcerebrum.org";
  const a = await makeAssertion({ kp, rpId, challenge, origin, signCount: 7 });
  const newCount = await verifyAuthentication({
    publicKeyJwk: pubJwk,
    authenticatorDataB64: a.authenticatorDataB64,
    clientDataJSONB64: a.clientDataJSONB64,
    signatureB64: a.signatureB64,
    expectedChallengeB64: challenge,
    expectedRpIdHashB64: await rpIdHashB64(rpId),
    storedSignCount: 0,
  });
  assert.equal(newCount, 7);
});

await test("authentication rejects a forged signature", async () => {
  const { pubJwk } = await makeKeypair();
  const { kp: otherKp } = await makeKeypair();
  const rpId = "askcerebrum.org", challenge = randomChallengeB64(), origin = "https://askcerebrum.org";
  const a = await makeAssertion({ kp: otherKp, rpId, challenge, origin });
  const rpHash = await rpIdHashB64(rpId);
  await assert.rejects(() => verifyAuthentication({
    publicKeyJwk: pubJwk,
    authenticatorDataB64: a.authenticatorDataB64,
    clientDataJSONB64: a.clientDataJSONB64,
    signatureB64: a.signatureB64,
    expectedChallengeB64: challenge,
    expectedRpIdHashB64: rpHash,
    storedSignCount: 0,
  }), /signature invalid/);
});

await test("authentication rejects a non-advancing sign counter (clone signal)", async () => {
  const { kp, pubJwk } = await makeKeypair();
  const rpId = "askcerebrum.org", challenge = randomChallengeB64(), origin = "https://askcerebrum.org";
  const a = await makeAssertion({ kp, rpId, challenge, origin, signCount: 3 });
  const rpHash2 = await rpIdHashB64(rpId);
  await assert.rejects(() => verifyAuthentication({
    publicKeyJwk: pubJwk,
    authenticatorDataB64: a.authenticatorDataB64,
    clientDataJSONB64: a.clientDataJSONB64,
    signatureB64: a.signatureB64,
    expectedChallengeB64: challenge,
    expectedRpIdHashB64: rpHash2,
    storedSignCount: 9,
  }), /counter did not advance/);
});

await test("authentication rejects a wrong rpId", async () => {
  const { kp, pubJwk } = await makeKeypair();
  const challenge = randomChallengeB64(), origin = "https://askcerebrum.org";
  const a = await makeAssertion({ kp, rpId: "askcerebrum.org", challenge, origin });
  const evilHash = await rpIdHashB64("evil.example");
  await assert.rejects(() => verifyAuthentication({
    publicKeyJwk: pubJwk,
    authenticatorDataB64: a.authenticatorDataB64,
    clientDataJSONB64: a.clientDataJSONB64,
    signatureB64: a.signatureB64,
    expectedChallengeB64: challenge,
    expectedRpIdHashB64: evilHash,
    storedSignCount: 0,
  }), /rpId mismatch/);
});

await test("challenges are unique and URL-safe", () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const c = randomChallengeB64();
    assert.match(c, /^[A-Za-z0-9\-_]+$/);
    assert.ok(!seen.has(c), "duplicate challenge");
    seen.add(c);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
