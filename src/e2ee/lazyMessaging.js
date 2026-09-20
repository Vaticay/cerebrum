/**
 * Lazy-loading facade over the E2EE messaging subsystem.
 *
 * WHY THIS FILE EXISTS
 * src/CerebrumApp.jsx statically imported ./e2ee/messaging.js, which pulls in
 * ./crypto.js → @dtelecom/vodozemac-wasm and (via ./recovery.js) bip39 with
 * all of its wordlists plus hash-wasm (Argon2id). None of that is needed to
 * render the search UI — it is only used inside the Private Vault / encrypted
 * messaging flows — yet it sat in the initial JS bundle every visitor
 * downloads. This module re-exports the exact same named functions with the
 * exact same signatures; each one dynamic-imports the real implementation on
 * first call, so the crypto stack becomes its own on-demand chunk.
 *
 * The only intentional semantic difference: clearE2EEMemory() was
 * synchronous. The lazy version fires the module load and clears on the next
 * microtask (the module is always already loaded at the one call site, which
 * runs right after a successful revokeDevice()). Everything else was already
 * async, so call sites (all `await`ed) are unaffected.
 *
 * Wiring: vite.config.js aliases "./e2ee/messaging.js" to this file, so the
 * monolith's import line is untouched. Node-side tests import the real module
 * directly and are unaffected.
 */
const load = () => import("./messaging.js");

export async function ensureE2EEDevice(...args) {
  return (await load()).ensureE2EEDevice(...args);
}
export async function listBackups(...args) {
  return (await load()).listBackups(...args);
}
export async function uploadBackupNow(...args) {
  return (await load()).uploadBackupNow(...args);
}
export async function getRecoveryPhrase(...args) {
  return (await load()).getRecoveryPhrase(...args);
}
export async function isRecoveryPhraseConfirmed(...args) {
  return (await load()).isRecoveryPhraseConfirmed(...args);
}
export async function confirmRecoveryPhrase(...args) {
  return (await load()).confirmRecoveryPhrase(...args);
}
export async function getBackupInfo(...args) {
  return (await load()).getBackupInfo(...args);
}
export async function encryptMessage(...args) {
  return (await load()).encryptMessage(...args);
}
export async function decryptThreadMessages(...args) {
  return (await load()).decryptThreadMessages(...args);
}
export async function restoreFromPhrase(...args) {
  return (await load()).restoreFromPhrase(...args);
}
export async function listDevices(...args) {
  return (await load()).listDevices(...args);
}
export async function revokeDevice(...args) {
  return (await load()).revokeDevice(...args);
}
export async function upgradeThread(...args) {
  return (await load()).upgradeThread(...args);
}
export async function isPeerEncryptionReady(...args) {
  return (await load()).isPeerEncryptionReady(...args);
}
export async function getSafetyNumber(...args) {
  return (await load()).getSafetyNumber(...args);
}
export async function markSafetyNumberVerified(...args) {
  return (await load()).markSafetyNumberVerified(...args);
}
export async function clearSafetyNumberVerified(...args) {
  return (await load()).clearSafetyNumberVerified(...args);
}

/**
 * Fire-and-forget variant of the real (synchronous) clearE2EEMemory.
 * Returns a promise that resolves once the in-memory crypto material has
 * been wiped. The one call site runs immediately after revokeDevice(), so
 * the module is already loaded and the clear lands on the next microtask.
 */
export function clearE2EEMemory() {
  return load()
    .then((m) => m.clearE2EEMemory())
    .catch((err) => {
      // A failed module load here means crypto state could not be reached
      // at all; surface it loudly rather than silently keeping keys.
      console.error("e2ee: clearE2EEMemory failed to load the crypto module", err);
      throw err;
    });
}
