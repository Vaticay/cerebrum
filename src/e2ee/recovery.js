/**
 * Cerebrum E2EE — recovery & zero-knowledge backup (Phase 1).
 *
 * The deal, stated plainly:
 *  - Your encryption keys live on your devices. Cerebrum's servers only ever
 *    see public keys and opaque ciphertext.
 *  - The 24-word recovery phrase is the ONLY way to move your identity to a
 *    new device. Email login, password reset, and support can NEVER recover
 *    your keys — anyone who tells you otherwise is lying or confused.
 *  - The backup bundle stored on our server is encrypted with a key derived
 *    from your phrase via Argon2id. We store salt + ciphertext; we cannot
 *    decrypt it. Lose the phrase and the backup is random noise to everyone,
 *    including us.
 *
 * KDF: Argon2id (m=64MiB, t=3, p=1) via hash-wasm. Bundle cipher:
 * AES-GCM-256 via WebCrypto. Wrong phrase → GCM auth failure, surfaced as a
 * typed error so the UI can say "that phrase didn't work" instead of
 * crashing.
 */

import { generateMnemonic, validateMnemonic } from "bip39";
import { argon2id } from "hash-wasm";

export const BACKUP_VERSION = 1;
const KDF_PARAMS = { m: 65536, t: 3, p: 1 }; // memory KiB, iterations, parallelism
const WRONG_PHRASE = "e2ee/recovery: wrong recovery phrase";

function b64encodeBytes(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decodeBytes(b64) {
  if (typeof Buffer !== "undefined")
    return new Uint8Array(Buffer.from(b64, "base64"));
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function randomBytes(n) {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) {
    throw new Error("e2ee/recovery: secure randomness unavailable");
  }
  return crypto.getRandomValues(new Uint8Array(n));
}

async function subtle() {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("e2ee/recovery: WebCrypto unavailable");
  }
  return crypto.subtle;
}

/** Generate a fresh 24-word BIP39 recovery phrase (256-bit entropy). */
export function generateRecoveryPhrase() {
  return generateMnemonic(256);
}

/** Validate a user-entered phrase (wordlist + checksum). */
export function isValidRecoveryPhrase(phrase) {
  if (typeof phrase !== "string") return false;
  return validateMnemonic(phrase.trim().toLowerCase().replace(/\s+/g, " "));
}

/** Normalize user input before use: lowercase, single spaces. */
export function normalizePhrase(phrase) {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Argon2id(phrase, salt) → 32-byte backup key. */
async function deriveBackupKey(phrase, saltBytes) {
  const key = await argon2id({
    password: normalizePhrase(phrase),
    salt: saltBytes,
    parallelism: KDF_PARAMS.p,
    iterations: KDF_PARAMS.t,
    memorySize: KDF_PARAMS.m,
    hashLength: 32,
    outputType: "binary",
  });
  return key; // Uint8Array
}

/**
 * Encrypt an Olm account pickle into a server-storable backup bundle.
 * Returns a plain JSON-able object: `{ v, kdf, kdfParams, salt, iv, ciphertext }`.
 */
export async function encryptBackupBundle(pickleJson, phrase) {
  if (!isValidRecoveryPhrase(phrase)) throw new Error("e2ee/recovery: invalid phrase");
  const s = await subtle();
  const salt = randomBytes(16);
  const keyBytes = await deriveBackupKey(phrase, salt);
  const key = await s.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  keyBytes.fill(0);
  const iv = randomBytes(12);
  const ct = await s.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(pickleJson)
  );
  return {
    v: BACKUP_VERSION,
    kdf: "argon2id",
    kdfParams: { ...KDF_PARAMS },
    salt: b64encodeBytes(salt),
    iv: b64encodeBytes(iv),
    ciphertext: b64encodeBytes(new Uint8Array(ct)),
  };
}

/**
 * Decrypt a backup bundle with the recovery phrase.
 * Returns the account pickle JSON. Throws WRONG_PHRASE when the phrase is
 * wrong (or the bundle is corrupt) — callers should catch and show a
 * human message, never the raw error.
 */
export async function decryptBackupBundle(bundle, phrase) {
  if (!bundle || bundle.v !== BACKUP_VERSION || bundle.kdf !== "argon2id") {
    throw new Error("e2ee/recovery: unsupported backup bundle");
  }
  if (!isValidRecoveryPhrase(phrase)) {
    const err = new Error(WRONG_PHRASE);
    err.code = "WRONG_PHRASE";
    throw err;
  }
  const s = await subtle();
  const salt = b64decodeBytes(bundle.salt);
  const keyBytes = await deriveBackupKey(phrase, salt);
  const key = await s.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  keyBytes.fill(0);
  try {
    const pt = await s.decrypt(
      { name: "AES-GCM", iv: b64decodeBytes(bundle.iv) },
      key,
      b64decodeBytes(bundle.ciphertext)
    );
    return new TextDecoder().decode(pt);
  } catch {
    const err = new Error(WRONG_PHRASE);
    err.code = "WRONG_PHRASE";
    throw err;
  }
}

export { WRONG_PHRASE };
