/**
 * WebAuthn (passkey) verification primitives for Cloudflare Workers.
 *
 * Implements the server side of the WebAuthn ceremony without external
 * dependencies, using only WebCrypto (available in Workers) plus a minimal
 * CBOR decoder. Design decisions, stated plainly:
 *
 * - Registration requests `attestation: "none"` client-side, so the server
 *   only accepts `fmt: "none"` attestations. No certificate chain
 *   verification is needed because there is no chain. This is the standard
 *   approach for passkeys (as opposed to enterprise attestation).
 * - Only ES256 (COSE alg -7) credentials are accepted. This is what every
 *   major platform authenticator produces for passkeys.
 * - Assertion signatures are verified with WebCrypto ECDSA. WebAuthn ships
 *   DER-encoded signatures; WebCrypto wants IEEE P1363 raw (r||s), so a
 *   DER-to-raw conversion runs first.
 * - signCount is tracked: a decreased-or-equal counter on a credential that
 *   previously reported a nonzero counter rejects the assertion (cloned
 *   authenticator signal), per the spec's guidance.
 *
 * Nothing here is security-through-obscurity: every check below maps to a
 * step in the W3C WebAuthn spec's registration and authentication
 * verification procedures.
 */

function b64urlToBytes(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9\-_]*$/.test(s)) throw new Error("bad base64url");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  const padded = pad ? b64 + "=".repeat(4 - pad) : b64;
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

/* ── Minimal CBOR decoder ──
   Supports exactly what attestation objects and COSE keys need: unsigned
   ints, negative ints, byte strings, text strings, arrays, maps, and the
   small constants (false/true/null). Anything else throws. */
function cborDecode(bytes) {
  let pos = 0;
  function readArg(ai) {
    if (ai < 24) return ai;
    if (ai === 24) return bytes[pos++];
    if (ai === 25) { const v = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; return v; }
    if (ai === 26) {
      const v = (bytes[pos] * 16777216) + ((bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]);
      pos += 4; return v;
    }
    throw new Error("cbor: unsupported integer width");
  }
  function decode() {
    if (pos >= bytes.length) throw new Error("cbor: truncated");
    const ib = bytes[pos++];
    const major = ib >> 5;
    const ai = ib & 31;
    if (major === 0) return readArg(ai);
    if (major === 1) return -1 - readArg(ai);
    if (major === 2) { const n = readArg(ai); const v = bytes.slice(pos, pos + n); pos += n; return v; }
    if (major === 3) {
      const n = readArg(ai);
      const v = bytes.slice(pos, pos + n); pos += n;
      return new TextDecoder().decode(v);
    }
    if (major === 4) { const n = readArg(ai); const arr = []; for (let i = 0; i < n; i++) arr.push(decode()); return arr; }
    if (major === 5) {
      const n = readArg(ai); const obj = new Map();
      for (let i = 0; i < n; i++) { const k = decode(); obj.set(k, decode()); }
      return obj;
    }
    if (major === 7) {
      if (ai === 20) return false;
      if (ai === 21) return true;
      if (ai === 22) return null;
      throw new Error("cbor: unsupported simple value");
    }
    throw new Error("cbor: unsupported major type " + major);
  }
  const val = decode();
  return val;
}

/* ── Authenticator data ──
   Layout: rpIdHash(32) | flags(1) | signCount(4) | [attestedCredentialData] | [extensions] */
function parseAuthenticatorData(authData) {
  if (!(authData instanceof Uint8Array) || authData.length < 37) throw new Error("authData too short");
  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32];
  const signCount = (authData[33] * 16777216) + ((authData[34] << 16) | (authData[35] << 8) | authData[36]);
  return {
    rpIdHash,
    flags,
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    attestedData: (flags & 0x40) !== 0,
    signCount,
  };
}

/* Attested credential data follows the 37-byte header when the AT flag is
   set: aaguid(16) | credIdLen(2) | credId | credentialPublicKey (CBOR). */
function parseAttestedCredentialData(authData) {
  const parsed = parseAuthenticatorData(authData);
  if (!parsed.attestedData) throw new Error("no attested credential data");
  let pos = 37;
  pos += 16; // aaguid
  const credIdLen = (authData[pos] << 8) | authData[pos + 1];
  pos += 2;
  if (credIdLen <= 0 || credIdLen > 1024) throw new Error("bad credential id length");
  const credentialId = authData.slice(pos, pos + credIdLen);
  pos += credIdLen;
  const coseKey = cborDecode(authData.slice(pos));
  if (!(coseKey instanceof Map)) throw new Error("cose key is not a map");
  return { credentialId, coseKey, signCount: parsed.signCount };
}

/* COSE_Key (EC2, ES256) -> JWK. Map keys: 1=kty, 3=alg, -1=crv, -2=x, -3=y. */
function coseKeyToJwk(coseKey) {
  const kty = coseKey.get(1);
  const alg = coseKey.get(3);
  const crv = coseKey.get(-1);
  const x = coseKey.get(-2);
  const y = coseKey.get(-3);
  if (kty !== 2 || alg !== -7 || crv !== 1) throw new Error("only ES256 P-256 keys accepted");
  if (!(x instanceof Uint8Array) || x.length !== 32 || !(y instanceof Uint8Array) || y.length !== 32) {
    throw new Error("bad EC coordinates");
  }
  return { kty: "EC", crv: "P-256", x: bytesToB64url(x), y: bytesToB64url(y) };
}

/* DER ECDSA signature -> IEEE P1363 raw (r || s, 64 bytes for P-256). */
function derToRaw(der) {
  if (der[0] !== 0x30) throw new Error("not a DER sequence");
  let pos = 2;
  if (der[1] & 0x80) pos = 2 + (der[1] & 0x7f); // long form length
  if (der[pos++] !== 0x02) throw new Error("bad DER integer marker (r)");
  let rLen = der[pos++];
  let r = der.slice(pos, pos + rLen); pos += rLen;
  if (der[pos++] !== 0x02) throw new Error("bad DER integer marker (s)");
  let sLen = der[pos++];
  let s = der.slice(pos, pos + sLen);
  // Strip leading zero padding, then left-pad to 32 bytes each.
  const strip = (v) => { let i = 0; while (i < v.length - 1 && v[i] === 0) i++; return v.slice(i); };
  r = strip(r); s = strip(s);
  if (r.length > 32 || s.length > 32) throw new Error("bad DER integer size");
  const out = new Uint8Array(64);
  out.set(r, 32 - r.length);
  out.set(s, 64 - s.length);
  return out;
}

/**
 * Verify a registration ceremony's attestationObject.
 * Returns { credentialIdB64url, publicKeyJwk }.
 * Only fmt "none" is accepted (client requests attestation: "none").
 */
export function verifyRegistration({ attestationObjectB64, clientDataJSONB64, expectedChallengeB64, expectedRpId, expectedOrigin }) {
  const attObjBytes = b64urlToBytes(attestationObjectB64);
  const attObj = cborDecode(attObjBytes);
  if (!(attObj instanceof Map)) throw new Error("bad attestation object");
  const fmt = attObj.get("fmt");
  if (fmt !== "none") throw new Error("only none attestation accepted");
  const authData = attObj.get("authData");
  if (!(authData instanceof Uint8Array)) throw new Error("bad authData");

  const clientDataBytes = b64urlToBytes(clientDataJSONB64);
  let clientData;
  try { clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)); }
  catch { throw new Error("bad clientDataJSON"); }
  if (clientData.type !== "webauthn.create") throw new Error("wrong ceremony type");
  if (clientData.challenge !== expectedChallengeB64) throw new Error("challenge mismatch");
  if (clientData.origin !== expectedOrigin) throw new Error("origin mismatch");

  const parsed = parseAuthenticatorData(authData);
  if (!parsed.userPresent) throw new Error("user not present");
  const rpIdHash = bytesToB64url(parsed.rpIdHash);

  const { credentialId, coseKey } = parseAttestedCredentialData(authData);
  const publicKeyJwk = coseKeyToJwk(coseKey);
  return { credentialIdB64url: bytesToB64url(credentialId), publicKeyJwk, rpIdHash };
}

/**
 * Verify an authentication ceremony's assertion.
 * Returns the new signCount on success; throws otherwise.
 */
export async function verifyAuthentication({ publicKeyJwk, authenticatorDataB64, clientDataJSONB64, signatureB64, expectedChallengeB64, expectedRpIdHashB64, storedSignCount }) {
  const authData = b64urlToBytes(authenticatorDataB64);
  const clientDataBytes = b64urlToBytes(clientDataJSONB64);
  const signatureDer = b64urlToBytes(signatureB64);

  let clientData;
  try { clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)); }
  catch { throw new Error("bad clientDataJSON"); }
  if (clientData.type !== "webauthn.get") throw new Error("wrong ceremony type");
  if (clientData.challenge !== expectedChallengeB64) throw new Error("challenge mismatch");

  const parsed = parseAuthenticatorData(authData);
  if (bytesToB64url(parsed.rpIdHash) !== expectedRpIdHashB64) throw new Error("rpId mismatch");
  if (!parsed.userPresent) throw new Error("user not present");
  // Cloned-authenticator signal: a counter that went backwards (or stayed
  // at zero while previously nonzero) means something is wrong.
  if (storedSignCount > 0 && parsed.signCount > 0 && parsed.signCount <= storedSignCount) {
    throw new Error("sign counter did not advance");
  }

  const clientDataHash = await sha256(clientDataBytes);
  const signed = new Uint8Array(authData.length + clientDataHash.length);
  signed.set(authData, 0);
  signed.set(clientDataHash, authData.length);

  const key = await crypto.subtle.importKey(
    "jwk", publicKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false, ["verify"]
  );
  const rawSig = derToRaw(signatureDer);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, rawSig, signed);
  if (!ok) throw new Error("signature invalid");
  return parsed.signCount;
}

export async function rpIdHashB64(rpId) {
  const hash = await sha256(new TextEncoder().encode(rpId));
  return bytesToB64url(hash);
}

export function randomChallengeB64() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToB64url(bytes);
}

export { b64urlToBytes, bytesToB64url };
