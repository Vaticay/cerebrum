/**
 * Lazy-loading facade over the E2EE recovery helpers.
 *
 * WHY THIS FILE EXISTS
 * src/CerebrumApp.jsx statically imported { normalizePhrase } from
 * ./e2ee/recovery.js. That single named import dragged the whole recovery
 * module — and with it bip39 (all wordlists) and hash-wasm (Argon2id) — into
 * the initial JS bundle. normalizePhrase itself is three pure string
 * operations, so it is re-implemented here byte-for-byte (see
 * tests/e2ee-lazy.mjs, which asserts the two agree on a battery of inputs).
 * Everything else in recovery.js is only needed inside the Private Vault
 * flows and is dynamic-imported on first call.
 *
 * Wiring: vite.config.js aliases "./e2ee/recovery.js" to this file, so the
 * monolith's import line is untouched. Node-side tests import the real module
 * directly and are unaffected.
 */
const load = () => import("./recovery.js");

/**
 * Normalize user input before use: lowercase, single spaces.
 * Identical to e2ee/recovery.js normalizePhrase — do not let the two drift
 * (tests/e2ee-lazy.mjs fails the build if they do).
 */
export function normalizePhrase(phrase) {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function generateRecoveryPhrase(...args) {
  return (await load()).generateRecoveryPhrase(...args);
}

export async function isValidRecoveryPhrase(...args) {
  return (await load()).isValidRecoveryPhrase(...args);
}

export async function encryptBackupBundle(...args) {
  return (await load()).encryptBackupBundle(...args);
}

export async function decryptBackupBundle(...args) {
  return (await load()).decryptBackupBundle(...args);
}
