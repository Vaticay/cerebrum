/**
 * Cerebrum E2EE — Olm crypto core (Phase 1: 1:1 DMs).
 *
 * Thin, owned wrapper over the vendored vodozemac WASM bridge
 * (`@dtelecom/vodozemac-wasm`, Rust source vendored at
 * `vendor/vodozemac-wasm/`). vodozemac is maintained by Matrix.org and was
 * audited by Least Authority (May 2022); we use its Olm (Double Ratchet +
 * X3DH-style handshake) for 1:1 threads. Megolm arrives in Phase 2.
 *
 * What this module does NOT do:
 *  - It never persists keys. Persistence (with at-rest encryption) lives in
 *    `store.js`; zero-knowledge backup lives in `recovery.js`.
 *  - `Account.pickle()` below returns PLAINTEXT key material (the bridge
 *    serializes the raw pickle struct). Callers must encrypt the pickle
 *    before it touches any storage. This is enforced by `store.js`, which
 *    refuses to write an unencrypted pickle.
 *
 * Environment: works in Node (pkg-node auto-initializes on import; used by
 * `tests/e2ee-crypto.mjs`) and in the browser (pkg-web; call `initCrypto()`
 * once — it fetches `/wasm/vodozemac_bg.wasm` from this origin, so no extra
 * CSP is needed beyond `script-src 'self'` + `'wasm-unsafe-eval'`).
 */

import wasmInit, {
  Account as WasmAccount,
  Session as WasmSession,
} from "@dtelecom/vodozemac-wasm";

const WASM_URL = "/wasm/vodozemac_bg.wasm";

let readyPromise = null;

/**
 * Initialize the WASM module. Idempotent — safe to call on every entry.
 * In Node this is a no-op (the pkg-node build initializes on import).
 */
export function initCrypto() {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (typeof wasmInit === "function") {
        await wasmInit(WASM_URL);
      }
    })();
  }
  return readyPromise;
}

/** Number of one-time keys to keep published per device. */
export const ONE_TIME_KEY_COUNT = 50;

/** Envelope version for ciphertext messages sent through the server. */
export const ENVELOPE_VERSION = 1;

/**
 * Pack an encrypted Olm message into the wire envelope the server stores.
 * The server treats `body` as opaque bytes — it can route and count, but
 * never read.
 */
export function packEnvelope({ type, body, senderDevice, senderIdentityKey, recipientDevice, messageId }) {
  const env = {
    v: ENVELOPE_VERSION,
    kind: "olm",
    type, // 0 = prekey (new session), 1 = normal (existing session)
    body, // base64, from Session.encrypt()
    sd: senderDevice, // sender device_id (routing / device-change warnings)
    sk: senderIdentityKey, // sender Curve25519 identity (verification)
  };
  // Recipient device_id: lets a multi-device peer skip rows meant for their
  // other devices instead of showing "couldn't decrypt" for them. Optional
  // (older envelopes lack it) — receivers treat a missing rd as "try me".
  if (recipientDevice) env.rd = recipientDevice;
  // Client-generated message id, shared by every envelope of one send
  // (one per recipient device). Lets the sender collapse their own
  // fan-out rows into a single bubble and look sent plaintext up locally.
  if (messageId) env.mid = messageId;
  return JSON.stringify(env);
}

/** Parse and minimally validate a received envelope. Throws on malformed. */
export function parseEnvelope(raw) {
  let env;
  try {
    env = JSON.parse(raw);
  } catch {
    throw new Error("e2ee: malformed message envelope");
  }
  if (
    !env ||
    env.v !== ENVELOPE_VERSION ||
    env.kind !== "olm" ||
    (env.type !== 0 && env.type !== 1) ||
    typeof env.body !== "string" ||
    typeof env.sd !== "string" ||
    typeof env.sk !== "string"
  ) {
    throw new Error("e2ee: malformed message envelope");
  }
  return env;
}

/**
 * An Olm account: this device's identity. Wraps the WASM Account with a
 * smaller, documented surface.
 */
export class E2EEAccount {
  /** @private */
  constructor(wasmAccount) {
    this.a = wasmAccount;
  }

  /** Create a brand-new account (fresh identity keys). */
  static async create() {
    await initCrypto();
    return new E2EEAccount(new WasmAccount());
  }

  /** Restore from a JSON pickle string (must have been decrypted first). */
  static async fromPickle(pickleJson) {
    await initCrypto();
    return new E2EEAccount(WasmAccount.fromPickle(pickleJson));
  }

  /** Public identity keys: `{ curve25519, ed25519 }` (base64). Safe to publish. */
  identityKeys() {
    return JSON.parse(this.a.identityKeys());
  }

  /** Sign bytes (utf-8 string) with the Ed25519 identity key. Returns base64. */
  sign(message) {
    return this.a.sign(message);
  }

  /** Generate `n` fresh one-time keys (Curve25519). */
  generateOneTimeKeys(n = ONE_TIME_KEY_COUNT) {
    this.a.generateOneTimeKeys(n);
  }

  /**
   * Unpublished one-time keys as `{ keyId: base64pubkey }`.
   * Publish these to the server, then call `markKeysAsPublished()`.
   */
  unpublishedOneTimeKeys() {
    const parsed = JSON.parse(this.a.oneTimeKeys());
    return parsed.curve25519 || {};
  }

  markKeysAsPublished() {
    this.a.markKeysAsPublished();
  }

  maxOneTimeKeys() {
    return this.a.maxNumberOfOneTimeKeys();
  }

  /** Generate a fallback one-time key (used when the pool is exhausted). */
  generateFallbackKey() {
    this.a.generateFallbackKey();
  }

  /** Unpublished fallback key as `{ keyId: base64pubkey }` (may be empty). */
  unpublishedFallbackKey() {
    const parsed = JSON.parse(this.a.fallbackKey());
    return parsed.curve25519 || {};
  }

  /**
   * Serialize the account. WARNING: the returned string contains PRIVATE
   * key material in the clear. Encrypt before persisting (see store.js).
   */
  pickle() {
    return this.a.pickle();
  }

  /**
   * Start an outbound Olm session to a peer device, given their published
   * identity key and one of their one-time keys (both base64).
   */
  createOutboundSession(theirIdentityKey, theirOneTimeKey) {
    return new E2EESession(
      this.a.createOutboundSession(theirIdentityKey, theirOneTimeKey)
    );
  }

  /**
   * Accept an inbound session from a received prekey message body.
   * Returns `{ session, plaintext, senderIdentityKey }` — the first message
   * is decrypted as part of session creation (Olm semantics).
   */
  createInboundSession(prekeyBody) {
    const res = this.a.createInboundSession(prekeyBody);
    const out = {
      session: new E2EESession(res.takeSession()),
      plaintext: res.plaintext,
      senderIdentityKey: res.senderIdentityKey,
    };
    res.free();
    return out;
  }

  free() {
    this.a.free();
  }
}

/** An Olm session with one peer device. */
export class E2EESession {
  /** @private */
  constructor(wasmSession) {
    this.s = wasmSession;
  }

  /** Restore from a JSON pickle string (must have been decrypted first). */
  static async fromPickle(pickleJson) {
    await initCrypto();
    return new E2EESession(WasmSession.fromPickle(pickleJson));
  }

  /**
   * Encrypt a plaintext string.
   * Returns `{ type: 0|1, body: base64 }` — pass straight to packEnvelope().
   */
  encrypt(plaintext) {
    const raw = this.s.encrypt(plaintext);
    return JSON.parse(raw);
  }

  /** Decrypt a message of the given type (0 = prekey, 1 = normal). */
  decrypt(type, body) {
    return this.s.decrypt(type, body);
  }

  sessionId() {
    return this.s.sessionId();
  }

  hasReceivedMessage() {
    return this.s.hasReceivedMessage();
  }

  /**
   * Serialize the session. WARNING: contains session key material in the
   * clear. Encrypt before persisting (see store.js).
   */
  pickle() {
    return this.s.pickle();
  }

  free() {
    this.s.free();
  }
}
