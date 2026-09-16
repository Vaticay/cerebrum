/**
 * Cerebrum Private Vault — zero-knowledge saved-work crypto (Phase 1).
 *
 * The deal, stated plainly:
 *  - Saved papers, investigations, collection names and annotations are
 *    encrypted on the device with a random 256-bit Data Encryption Key
 *    (DEK). The server stores only opaque ciphertext rows plus item ids,
 *    kinds, collection membership and timestamps. It cannot read content.
 *  - The DEK itself is wrapped by a key derived from the user's 24-word
 *    recovery phrase via Argon2id and stored as one opaque vault row.
 *    Email/password login alone yields ciphertext — never plaintext.
 *  - The DEK is deliberately separate from the messaging Olm identity key:
 *    rotation (new DEK, re-encrypt everything, old writes rejected
 *    server-side) would be impossible with a phrase-derived key encrypting
 *    data directly.
 *  - The data KEK is domain-separated from the messaging backup KEK
 *    (associatedData "cerebrum-zkdata-v1"): the same phrase yields two
 *    cryptographically independent keys.
 *  - Search across saved work is local-only: an inverted index built from
 *    decrypted items, sealed at rest with a device key, queried on-device.
 *
 * Honest note: this integration has not been independently audited. The
 * primitives (Argon2id, AES-256-GCM, BIP39) are standard; the way they are
 * wired together here is Cerebrum's own code. Do not describe it as audited.
 *
 * No DOM access, no WASM imports. Runs in Node (tests) and browsers via
 * globalThis.crypto (WebCrypto).
 */

import { argon2id } from "hash-wasm";
import {
  isValidRecoveryPhrase,
  normalizePhrase as normalizeZkPhrase,
} from "./e2ee/recovery.js";

export { isValidRecoveryPhrase, normalizeZkPhrase };

export const ZK_DOMAIN = "cerebrum-zkdata-v1";
export const ZK_KINDS = ["paper", "investigation", "collection-meta", "annotation"];
export const PAD_BUCKET = 512;
export const ZK_MAX_CIPHERTEXT = 1_400_000; // matches the server-side cap
export const ZK_KDF_PARAMS = { m: 65536, t: 3, p: 1 }; // memory KiB, iterations, parallelism

/** Message on the typed wrong-phrase error; err.code is "WRONG_PHRASE". */
export const WRONG_PHRASE_ZK = "zkData: wrong recovery phrase";

const LS_FLAG = "cb_zk_enabled";

// ------------------------------------------------------------ primitives ---

function subtleCrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle || !c.getRandomValues) {
    throw new Error("zkData: WebCrypto unavailable");
  }
  return c;
}

function b64encode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function b64decode(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function randomBytes(n) {
  return subtleCrypto().getRandomValues(new Uint8Array(n));
}

function randomHex(byteCount) {
  return [...randomBytes(byteCount)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function wrongPhraseError() {
  const err = new Error(WRONG_PHRASE_ZK);
  err.code = "WRONG_PHRASE";
  return err;
}

async function importAesKey(keyBytes, usages) {
  return subtleCrypto().subtle.importKey("raw", keyBytes, "AES-GCM", false, usages);
}

function setFlag() {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LS_FLAG, "1");
  } catch {
    // Storage may be unavailable (private mode, Node); the flag is a hint, not a gate.
  }
}

function clearFlag() {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(LS_FLAG);
  } catch {
    /* best-effort */
  }
}

// ------------------------------------------------------------------- KDF ---

/**
 * Argon2id(phrase, salt) -> 32-byte data KEK.
 *
 * Domain separation from the messaging backup KEK (recovery.js): the same
 * phrase MUST yield a different key here. This is carried by Argon2's
 * `secret` parameter (mixed into H0 per RFC 9106) — NOT the `associatedData`
 * option, which hash-wasm 4.12.0 silently ignores (verified against its
 * bundled source: it hardcodes a zero-length AD). Do not pass
 * `associatedData` here: if a future hash-wasm ever honored it, derived
 * keys would change and existing vaults would stop unwrapping.
 */
export async function deriveDataKEK(phrase, saltBytes) {
  const key = await argon2id({
    password: normalizeZkPhrase(phrase),
    salt: saltBytes,
    secret: ZK_DOMAIN,
    parallelism: ZK_KDF_PARAMS.p,
    iterations: ZK_KDF_PARAMS.t,
    memorySize: ZK_KDF_PARAMS.m,
    hashLength: 32,
    outputType: "binary",
  });
  return key; // Uint8Array(32)
}

/** Fresh random 256-bit Data Encryption Key. */
export function generateDEK() {
  return randomBytes(32);
}

/** "dek_" + 12 random hex chars — the DEK generation id. */
export function makeDekId() {
  return "dek_" + randomHex(6);
}

/** Stable client-generated item id: prefix + "_" + 24 random hex chars. */
export function makeItemId(prefix = "zk") {
  return `${prefix}_${randomHex(12)}`;
}

// ------------------------------------------------------- vault wrap/unwrap ---

function wrapAAD(dekId) {
  return new TextEncoder().encode(`${ZK_DOMAIN}/wrap/${dekId}`);
}

/**
 * Wrap a DEK under the phrase-derived KEK for the opaque server vault row.
 * Envelope: { v, kdf, kdfParams, dek_id, salt, nonce, data } (all base64
 * except the scalars). AAD binds the wrap to this dek_id.
 */
export async function wrapVaultBundle(phrase, dekBytes, dekId) {
  if (!(dekBytes instanceof Uint8Array) || dekBytes.length !== 32) {
    throw new Error("zkData: DEK must be 32 bytes");
  }
  if (!dekId || typeof dekId !== "string") throw new Error("zkData: dekId required");
  const s = subtleCrypto().subtle;
  const salt = randomBytes(16);
  const kek = await deriveDataKEK(phrase, salt);
  const key = await importAesKey(kek, ["encrypt"]);
  kek.fill(0);
  const nonce = randomBytes(12);
  const aad = wrapAAD(dekId);
  let ct;
  try {
    ct = new Uint8Array(
      await s.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, key, dekBytes)
    );
  } finally {
    aad.fill(0);
  }
  return {
    v: 1,
    kdf: "argon2id",
    kdfParams: { ...ZK_KDF_PARAMS },
    dek_id: dekId,
    salt: b64encode(salt),
    nonce: b64encode(nonce),
    data: b64encode(ct),
  };
}

/**
 * Unwrap a vault envelope with the recovery phrase.
 * Returns { dek: Uint8Array(32), dekId }. Throws a typed WRONG_PHRASE error
 * when the phrase is wrong (GCM auth failure) or not a valid phrase.
 */
export async function unwrapVaultBundle(phrase, envelope) {
  if (!envelope || envelope.v !== 1 || envelope.kdf !== "argon2id") {
    throw new Error("zkData: unsupported vault envelope");
  }
  if (!isValidRecoveryPhrase(phrase)) throw wrongPhraseError();
  const s = subtleCrypto().subtle;
  const salt = b64decode(envelope.salt);
  const kek = await deriveDataKEK(phrase, salt);
  salt.fill(0);
  const key = await importAesKey(kek, ["decrypt"]);
  kek.fill(0);
  const dekId = envelope.dek_id;
  if (!dekId || typeof dekId !== "string") throw new Error("zkData: vault envelope missing dek_id");
  const aad = wrapAAD(dekId);
  let pt;
  try {
    pt = new Uint8Array(
      await s.decrypt(
        { name: "AES-GCM", iv: b64decode(envelope.nonce), additionalData: aad },
        key,
        b64decode(envelope.data)
      )
    );
  } catch {
    throw wrongPhraseError();
  } finally {
    aad.fill(0);
  }
  if (pt.length !== 32) {
    pt.fill(0);
    throw new Error("zkData: unwrapped DEK has wrong length");
  }
  return { dek: pt, dekId };
}

// --------------------------------------------------------------- padding ---

/**
 * Pad up to the next 512-byte bucket (minimum one bucket). The final two
 * bytes store the pad length as uint16BE so unpadding is unambiguous even
 * when the plaintext exactly fills a bucket.
 */
export function padToBucket(bytes) {
  const plain = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const paddedLen = Math.max(
    PAD_BUCKET,
    Math.ceil((plain.length + 2) / PAD_BUCKET) * PAD_BUCKET
  );
  const out = new Uint8Array(paddedLen);
  out.set(plain);
  const padLen = paddedLen - plain.length;
  out[paddedLen - 2] = (padLen >>> 8) & 0xff;
  out[paddedLen - 1] = padLen & 0xff;
  return out;
}

export function unpadPadded(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (buf.length < PAD_BUCKET || buf.length % PAD_BUCKET !== 0) {
    throw new Error("zkData: bad padded length");
  }
  const padLen = (buf[buf.length - 2] << 8) | buf[buf.length - 1];
  if (padLen < 2 || padLen > buf.length) throw new Error("zkData: bad padding");
  return buf.slice(0, buf.length - padLen);
}

// ---------------------------------------------------------- item envelopes ---

/** AAD binds ciphertext to (user, item, key generation, kind). */
export function buildItemAAD(userId, itemId, dekId, kind) {
  return `${userId}|${itemId}|${dekId}|${kind}`;
}

/**
 * Encrypt one saved-work item under the DEK.
 * Plaintext framing: JSON.stringify({ kind, payload }), padded to 512-byte
 * buckets, AES-256-GCM with a random 96-bit nonce. `data` is base64(ct||tag).
 */
export async function encryptItem(dek, { userId, itemId, dekId, kind, payload, rev = 0 }) {
  if (!(dek instanceof Uint8Array) || dek.length !== 32) {
    throw new Error("zkData: DEK must be 32 bytes");
  }
  if (!ZK_KINDS.includes(kind)) throw new Error(`zkData: unknown kind "${kind}"`);
  if (!userId || !itemId || !dekId) throw new Error("zkData: userId/itemId/dekId required");
  const s = subtleCrypto().subtle;
  const plaintext = new TextEncoder().encode(JSON.stringify({ kind, payload }));
  const padded = padToBucket(plaintext);
  plaintext.fill(0);
  const nonce = randomBytes(12);
  const aad = new TextEncoder().encode(buildItemAAD(userId, itemId, dekId, kind));
  const key = await importAesKey(dek, ["encrypt"]);
  let ct;
  try {
    ct = new Uint8Array(
      await s.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad }, key, padded)
    );
  } finally {
    padded.fill(0);
    aad.fill(0);
  }
  const data = b64encode(ct);
  if (data.length > ZK_MAX_CIPHERTEXT) {
    throw new Error("zkData: item exceeds server ciphertext cap");
  }
  return {
    id: itemId,
    kind,
    dek_id: dekId,
    nonce: b64encode(nonce),
    data,
    updated_at: Date.now(),
    rev,
  };
}

/**
 * Decrypt one item row. Rebuilds the AAD from the row's own (dek_id, kind)
 * so a transplanted row fails authentication; the embedded kind must also
 * match the row's declared kind. Returns the payload object.
 */
export async function decryptItem(dek, { userId, itemId, row }) {
  if (!(dek instanceof Uint8Array) || dek.length !== 32) {
    throw new Error("zkData: DEK must be 32 bytes");
  }
  if (!row || typeof row.data !== "string" || typeof row.nonce !== "string") {
    throw new Error("zkData: bad item row");
  }
  const s = subtleCrypto().subtle;
  const aad = new TextEncoder().encode(buildItemAAD(userId, itemId, row.dek_id, row.kind));
  const key = await importAesKey(dek, ["decrypt"]);
  let padded;
  try {
    padded = new Uint8Array(
      await s.decrypt(
        { name: "AES-GCM", iv: b64decode(row.nonce), additionalData: aad },
        key,
        b64decode(row.data)
      )
    );
  } catch {
    const err = new Error("zkData: item authentication failed");
    err.code = "DECRYPT_FAILED";
    throw err;
  } finally {
    aad.fill(0);
  }
  const plain = unpadPadded(padded);
  padded.fill(0);
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plain));
  } finally {
    plain.fill(0);
  }
  if (!parsed || parsed.kind !== row.kind) {
    throw new Error("zkData: kind mismatch inside envelope");
  }
  return parsed.payload;
}

// ------------------------------------------------------- local search index ---

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

function collectStrings(value, out, depth = 0) {
  if (depth > 4 || out.length > 400) return;
  if (typeof value === "string") {
    if (value.length) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out, depth + 1);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
  }
}

/** Kind-aware text extraction; falls back to every string in the payload. */
function extractSearchText(kind, payload) {
  const texts = [];
  const push = (v) => {
    if (typeof v === "string" && v.length) texts.push(v);
    else if (Array.isArray(v)) for (const s of v) if (typeof s === "string" && s.length) texts.push(s);
  };
  if (payload && typeof payload === "object") {
    if (kind === "paper") {
      push(payload.title); push(payload.authors); push(payload.abstract); push(payload.notes);
    } else if (kind === "investigation") {
      push(payload.question); push(payload.title); push(payload.answer);
    } else if (kind === "collection-meta") {
      push(payload.name);
    } else if (kind === "annotation") {
      push(payload.text); push(payload.note);
    }
    collectStrings(payload, texts); // fallback: index everything textual
  }
  return texts.join("\n");
}

function createIndex() {
  return { docs: new Map(), tokens: new Map() };
}

function indexUpsert(idx, item) {
  indexRemove(idx, item.id);
  const text = extractSearchText(item.kind, item.payload);
  idx.docs.set(item.id, {
    kind: item.kind,
    collectionId: item.collectionId ?? null,
    updatedAt: item.updatedAt ?? Date.now(),
  });
  for (const tok of new Set(tokenize(text))) {
    let set = idx.tokens.get(tok);
    if (!set) {
      set = new Set();
      idx.tokens.set(tok, set);
    }
    set.add(item.id);
  }
}

function indexRemove(idx, id) {
  if (!idx.docs.has(id)) return;
  idx.docs.delete(id);
  for (const [tok, set] of idx.tokens) {
    set.delete(id);
    if (set.size === 0) idx.tokens.delete(tok);
  }
}

// ------------------------------------------- sealed IndexedDB persistence ---

const ZK_DB = "cerebrum-zk";
const ZK_DB_VERSION = 1;

function zkIdbAvailable() {
  return (
    typeof indexedDB !== "undefined" &&
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.subtle !== "undefined"
  );
}

function openZkDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ZK_DB, ZK_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("zk-index")) db.createObjectStore("zk-index", { keyPath: "id" });
      if (!db.objectStoreNames.contains("device")) db.createObjectStore("device", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function zkIdbPut(store, value) {
  return openZkDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, "readwrite");
        const r = t.objectStore(store).put(value);
        r.onsuccess = () => {
          db.close();
          resolve();
        };
        r.onerror = () => {
          db.close();
          reject(r.error);
        };
      })
  );
}

function zkIdbGet(store, key) {
  return openZkDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, "readonly");
        const r = t.objectStore(store).get(key);
        r.onsuccess = () => {
          db.close();
          resolve(r.result ?? null);
        };
        r.onerror = () => {
          db.close();
          reject(r.error);
        };
      })
  );
}

/** Device key for sealing the local index — generated once, kept in the DB. */
async function getZkDeviceKey() {
  const row = await zkIdbGet("device", "device-key");
  const s = subtleCrypto().subtle;
  if (row) {
    return s.importKey("raw", b64decode(row.raw), "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  const key = await s.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const raw = await s.exportKey("raw", key);
  await zkIdbPut("device", { id: "device-key", raw: b64encode(raw) });
  return key;
}

async function sealZkIndex(serialJson) {
  const key = await getZkDeviceKey();
  const iv = randomBytes(12);
  const ct = await subtleCrypto().subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(serialJson)
  );
  return { iv: b64encode(iv), ciphertext: b64encode(ct) };
}

async function openZkIndex(sealed) {
  const key = await getZkDeviceKey();
  const pt = await subtleCrypto().subtle.decrypt(
    { name: "AES-GCM", iv: b64decode(sealed.iv) },
    key,
    b64decode(sealed.ciphertext)
  );
  return new TextDecoder().decode(pt);
}

function serializeIndex(idx) {
  return JSON.stringify({
    v: 1,
    docs: [...idx.docs.entries()],
    tokens: [...idx.tokens.entries()].map(([t, set]) => [t, [...set]]),
  });
}

function deserializeIndex(json) {
  const raw = JSON.parse(json);
  const idx = createIndex();
  for (const [id, doc] of raw.docs || []) idx.docs.set(id, doc);
  for (const [tok, ids] of raw.tokens || []) idx.tokens.set(tok, new Set(ids));
  return idx;
}

// ----------------------------------------------------------------- session ---

/**
 * Stateful Private Vault client. `post(action, body)` is an injected fetch
 * wrapper returning parsed JSON (throws on !ok); `getPhrase()` is an
 * injected async phrase provider. The DEK lives in memory only — it is
 * never written to localStorage or IndexedDB.
 */
export class ZkSession {
  constructor({ userId, post, getPhrase }) {
    if (!userId) throw new Error("zkData: userId required");
    if (typeof post !== "function") throw new Error("zkData: post(action, body) required");
    this.userId = userId;
    this._post = post;
    this._getPhrase = getPhrase;
    this._dek = null;
    this._dekId = null;
    this._rows = new Map(); // id -> last-known server row (ciphertext)
    this._index = null;
  }

  _requireUnlocked() {
    if (!this._dek) {
      const err = new Error("zkData: vault is locked");
      err.code = "NOT_UNLOCKED";
      throw err;
    }
  }

  _setDek(dek, dekId) {
    this.lock();
    this._dek = dek;
    this._dekId = dekId;
  }

  /** The opaque vault row, or null when this user never enabled the vault. */
  async _fetchVaultRow() {
    const res = await this._post("zk-get-vault");
    // The server answers { row: { dekId, wrappedDek, updatedAt } | null };
    // accept the snake_case and bare shapes too so the session never
    // depends on one serialization of the same row.
    const raw = res && typeof res === "object" ? (res.row ?? res.vault ?? res) : null;
    if (!raw || typeof raw !== "object") return null;
    const row = {
      dek_id: raw.dek_id ?? raw.dekId ?? null,
      wrapped_dek: raw.wrapped_dek ?? raw.wrappedDek ?? "",
      updated_at: raw.updated_at ?? raw.updatedAt ?? 0,
    };
    if (typeof row.wrapped_dek === "string" && row.wrapped_dek.length > 0) return row;
    return null;
  }

  /** { exists, dekId } — reveals nothing about content. */
  async getVaultState() {
    const row = await this._fetchVaultRow();
    return { exists: !!row, dekId: row ? row.dek_id ?? null : null };
  }

  /**
   * Unlock with an explicit phrase or the injected getPhrase(). Returns
   * { status: "no-vault" } when nothing was ever enabled, or
   * { status: "ok", dekId }. Wrong phrase -> WRONG_PHRASE typed error.
   */
  async unlock(phrase) {
    const p = phrase ?? (typeof this._getPhrase === "function" ? await this._getPhrase() : null);
    if (!p) {
      const err = new Error("zkData: no recovery phrase available");
      err.code = "NO_PHRASE";
      throw err;
    }
    const row = await this._fetchVaultRow();
    if (!row) return { status: "no-vault" };
    let envelope;
    try {
      envelope = JSON.parse(row.wrapped_dek);
    } catch {
      throw new Error("zkData: corrupt vault envelope");
    }
    const { dek, dekId } = await unwrapVaultBundle(p, envelope);
    if (row.dek_id && row.dek_id !== dekId) {
      dek.fill(0);
      throw new Error("zkData: vault dek_id mismatch");
    }
    this._setDek(dek, dekId);
    setFlag();
    await this._rebuildIndex();
    return { status: "ok", dekId };
  }

  /**
   * First-time enable: generate DEK, wrap it, publish the vault row.
   * Precondition: the phrase must be a valid 24-word recovery phrase.
   */
  async enable(phrase) {
    if (!isValidRecoveryPhrase(phrase)) {
      throw new Error("zkData: a valid 24-word recovery phrase is required to enable the vault");
    }
    const dek = generateDEK();
    const dekId = makeDekId();
    const envelope = await wrapVaultBundle(phrase, dek, dekId);
    await this._post("zk-put-vault", { dek_id: dekId, wrapped_dek: JSON.stringify(envelope) });
    this._setDek(dek, dekId);
    setFlag();
    await this._rebuildIndex();
    return { dekId };
  }

  isUnlocked() {
    return this._dek !== null;
  }

  /** Zeroize the DEK and drop decrypted state. */
  lock() {
    if (this._dek) {
      this._dek.fill(0);
      this._dek = null;
    }
    this._dekId = null;
    this._rows.clear();
    this._index = null;
  }

  /**
   * Pull rows changed since `since`, decrypt each, quarantine rows that
   * fail authentication (never throw the whole batch).
   */
  async pullItems(since = 0) {
    this._requireUnlocked();
    const res = await this._post("zk-get-items", { since, limit: 500 });
    const rows = (res && res.items) || (Array.isArray(res) ? res : []);
    const items = [];
    const quarantined = [];
    for (const rawRow of rows) {
      // The server serializes rows camelCase ({ dekId, collectionId,
      // updatedAt }); accept snake_case too — the AAD bind must see the
      // exact dek_id/kind the row was written with either way.
      const row = rawRow && typeof rawRow === "object" ? {
        ...rawRow,
        dek_id: rawRow.dek_id ?? rawRow.dekId,
        collection_id: rawRow.collection_id ?? rawRow.collectionId ?? null,
        updated_at: rawRow.updated_at ?? rawRow.updatedAt,
        created_at: rawRow.created_at ?? rawRow.createdAt,
      } : rawRow;
      try {
        const payload = await decryptItem(this._dek, {
          userId: this.userId,
          itemId: row.id,
          row,
        });
        const item = {
          id: row.id,
          kind: row.kind,
          collectionId: row.collection_id ?? null,
          payload,
          updatedAt: row.updated_at ?? Date.now(),
          rev: row.rev ?? 0,
          dekId: row.dek_id,
        };
        items.push(item);
        // Defensive copy: the row object belongs to the post() layer and may
        // be reused or mutated by it; the cache must be our own snapshot.
        this._rows.set(row.id, { ...row });
        this._indexUpsert(item);
      } catch {
        quarantined.push(row.id);
      }
    }
    this._persistIndexSoon();
    return { items, quarantined };
  }

  /**
   * Encrypt rows [{ id, kind, collectionId, payload, rev }] and upload.
   * Returns the stored count. A 409/stale_dek from the server becomes a
   * typed STALE_DEK error ("re-enable vault").
   */
  async pushItems(rows) {
    this._requireUnlocked();
    const serverRows = [];
    for (const r of rows || []) {
      const env = await encryptItem(this._dek, {
        userId: this.userId,
        itemId: r.id,
        dekId: this._dekId,
        kind: r.kind,
        payload: r.payload,
        rev: r.rev ?? 0,
      });
      const serverRow = { ...env, collection_id: r.collectionId ?? null };
      serverRows.push(serverRow);
      this._rows.set(r.id, serverRow);
      this._indexUpsert({
        id: r.id,
        kind: r.kind,
        collectionId: r.collectionId ?? null,
        payload: r.payload,
        updatedAt: env.updated_at,
        rev: r.rev ?? 0,
        dekId: this._dekId,
      });
    }
    let res;
    try {
      res = await this._post("zk-put-items", { items: serverRows });
    } catch (err) {
      if (err && (err.code === "stale_dek" || err.status === 409)) {
        const typed = new Error("zkData: vault key rotated — re-enable the vault to continue syncing");
        typed.code = "STALE_DEK";
        throw typed;
      }
      throw err;
    }
    this._persistIndexSoon();
    return res && typeof res.stored === "number" ? res.stored : serverRows.length;
  }

  async deleteItem(id) {
    this._requireUnlocked();
    await this._post("zk-delete-item", { id });
    this._rows.delete(id);
    if (this._index) indexRemove(this._index, id);
    this._persistIndexSoon();
  }

  /**
   * Rotate the DEK: new id + key, re-encrypt every cached row locally,
   * publish the new vault row then the re-encrypted rows. Old-dek writes
   * are rejected server-side from that point (fail-closed). Rows that no
   * longer authenticate are skipped and reported, never silently dropped
   * from the server — they stay quarantined under the old dek_id.
   * Returns { dekId, reencrypted, skipped: [ids] }.
   */
  async rotate(phrase) {
    this._requireUnlocked();
    if (!isValidRecoveryPhrase(phrase)) {
      throw new Error("zkData: a valid 24-word recovery phrase is required to rotate");
    }
    const newDek = generateDEK();
    const newDekId = makeDekId();
    const oldDek = this._dek;
    const items = [];
    const reencrypted = [];
    const skipped = [];
    for (const [id, row] of this._rows) {
      let payload;
      try {
        payload = await decryptItem(oldDek, { userId: this.userId, itemId: id, row });
      } catch {
        skipped.push(id); // corrupt/tampered: cannot re-encrypt what we cannot read
        continue;
      }
      const env = await encryptItem(newDek, {
        userId: this.userId,
        itemId: id,
        dekId: newDekId,
        kind: row.kind,
        payload,
        rev: (row.rev ?? 0) + 1,
      });
      const serverRow = { ...env, collection_id: row.collection_id ?? null };
      reencrypted.push(serverRow);
      items.push({
        id,
        kind: row.kind,
        collectionId: row.collection_id ?? null,
        payload,
        updatedAt: env.updated_at,
        rev: (row.rev ?? 0) + 1,
        dekId: newDekId,
      });
    }
    const envelope = await wrapVaultBundle(phrase, newDek, newDekId);
    await this._post("zk-put-vault", { dek_id: newDekId, wrapped_dek: JSON.stringify(envelope) });
    // Chunked: the server caps a batch (and silently truncating a rotation
    // would strand rows under the old dek_id after the vault row moves on).
    if (reencrypted.length > 0) {
      for (let i = 0; i < reencrypted.length; i += 400) {
        await this._post("zk-put-items", { items: reencrypted.slice(i, i + 400) });
      }
    }
    for (const r of reencrypted) this._rows.set(r.id, r);
    oldDek.fill(0);
    this._dek = newDek;
    this._dekId = newDekId;
    this.buildLocalIndex(items);
    return { dekId: newDekId, reencrypted: reencrypted.length, skipped };
  }

  /** Delete the server vault + all item rows, clear the flag, lock. */
  async dropAll() {
    await this._post("zk-drop-vault");
    clearFlag();
    this.lock();
  }

  /** Ask the server to delete pre-migration plaintext rows; returns counts. */
  async purgeLegacy() {
    const res = await this._post("zk-purge-legacy", { confirm: true });
    return (res && res.deleted) || res || {};
  }

  // ------------------------------------------------------------ search ---

  /** Build the in-memory inverted index from decrypted items. */
  buildLocalIndex(items) {
    const idx = createIndex();
    for (const item of items || []) indexUpsert(idx, item);
    this._index = idx;
    this._persistIndexSoon();
    return idx.docs.size;
  }

  /** Local-only query: tokenize, intersect posting lists, return item ids. */
  queryLocalIndex(query) {
    if (!this._index) return [];
    const toks = tokenize(query);
    if (toks.length === 0) return [];
    let result = null;
    for (const t of toks) {
      const ids = this._index.tokens.get(t);
      if (!ids) return [];
      result = result === null ? new Set(ids) : new Set([...result].filter((id) => ids.has(id)));
      if (result.size === 0) return [];
    }
    return [...result];
  }

  _indexUpsert(item) {
    if (!this._index) this._index = createIndex();
    indexUpsert(this._index, item);
  }

  async _rebuildIndex() {
    this._index = createIndex();
    try {
      const persisted = await loadPersistedIndex();
      if (persisted) this._index = persisted;
    } catch {
      // IndexedDB unavailable or corrupt — in-memory only, rebuilt from sync.
    }
  }

  _persistIndexSoon() {
    // Fire-and-forget: persistence is best-effort, queries stay in memory.
    if (!this._index) return;
    persistIndex(this._index).catch(() => {});
  }
}

// ------------------------------------------- sealed index persistence ---

async function persistIndex(idx) {
  if (!zkIdbAvailable()) return; // graceful in-memory-only fallback
  const sealed = await sealZkIndex(serializeIndex(idx));
  await zkIdbPut("zk-index", { id: "index", ...sealed, updatedAt: Date.now() });
}

async function loadPersistedIndex() {
  if (!zkIdbAvailable()) return null;
  const row = await zkIdbGet("zk-index", "index");
  if (!row) return null;
  return deserializeIndex(await openZkIndex(row));
}
