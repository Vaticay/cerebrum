/**
 * E2EE server-side validation (Phase 1).
 *
 * Pure functions, no dependencies — imported by functions/api/data.js AND
 * by tests/e2ee-server.mjs. The server never decrypts: these validators only
 * check *shape* (is this a well-formed ciphertext envelope? are these
 * plausible keys?), so a client bug or a malicious client can't smuggle
 * plaintext into an encrypted thread or garbage into the key directory.
 *
 * The envelope shape here must stay in lockstep with
 * src/e2ee/crypto.js packEnvelope()/parseEnvelope().
 */

export const E2EE_ENVELOPE_VERSION = 1;

/** Max ciphertext envelope the server will store (Olm messages are small). */
export const MAX_ENVELOPE_LEN = 20000;

/** Max one-time prekeys accepted in a single upload batch. */
export const MAX_PREKEY_BATCH = 200;

/** Device ids are client-generated: 16 random bytes, base64url, no padding. */
export function isDeviceId(s) {
  return typeof s === "string" && /^[A-Za-z0-9_-]{22}$/.test(s);
}

/**
 * Public key format check: standard base64, decodes to exactly `byteLen`
 * bytes. Curve25519 keys are 32 bytes; Ed25519 keys are 32 bytes;
 * Ed25519 signatures are 64 bytes.
 */
export function isBase64Key(s, byteLen) {
  if (typeof s !== "string" || s.length === 0 || s.length > 200) return false;
  // The vodozemac bridge emits standard-alphabet base64 WITHOUT padding
  // (43 chars for a 32-byte key); accept padded form too.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return false;
  const unpadded = s.replace(/=+$/, "");
  const full = Math.floor(byteLen / 3);
  const rem = byteLen % 3;
  const expected = full * 4 + (rem === 0 ? 0 : rem + 1);
  return unpadded.length === expected;
}

/**
 * Shape-validate a ciphertext envelope WITHOUT decrypting it.
 * Returns the parsed envelope on success, null on any failure.
 * Mirrors src/e2ee/crypto.js parseEnvelope().
 */
export function parseCipherEnvelope(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_ENVELOPE_LEN) {
    return null;
  }
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    return null;
  }
  if (!env || typeof env !== "object") return null;
  if (
    env.v !== E2EE_ENVELOPE_VERSION ||
    env.kind !== "olm" ||
    (env.type !== 0 && env.type !== 1) ||
    typeof env.body !== "string" ||
    env.body.length === 0 ||
    env.body.length > MAX_ENVELOPE_LEN ||
    !isDeviceId(env.sd) ||
    !isBase64Key(env.sk, 32)
  ) {
    return null;
  }
  return env;
}

/**
 * Validate one uploaded one-time prekey: `{ id, pubkey }`.
 * Key ids are client-generated; cap the shape, don't interpret it.
 */
export function isPrekeyEntry(e) {
  return (
    e &&
    typeof e === "object" &&
    typeof e.id === "string" &&
    e.id.length >= 1 &&
    e.id.length <= 64 &&
    isBase64Key(e.pubkey, 32)
  );
}

/** User-supplied device label, e.g. "Dusty's iPhone". Never trusted for logic. */
export function cleanDeviceLabel(s) {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, 60);
}
