/**
 * Cerebrum E2EE — local key store (Phase 1).
 *
 * IndexedDB persistence for the Olm account pickle and per-peer session
 * pickles. Every pickle is encrypted with AES-GCM-256 before it is written:
 * the device key lives in a separate object store from the ciphertext.
 *
 * Honest threat model (do not oversell this): the device key and the
 * ciphertext live on the same device, so this does NOT protect against a
 * local attacker with full device access. What it does is keep private key
 * material out of casual reach — DevTools inspection, disk forensics on an
 * unlocked-but-borrowed machine, crash dumps. The real security boundary is
 * the device itself plus browser origin isolation. The zero-knowledge
 * guarantee (server cannot read anything) lives in `recovery.js`: the backup
 * bundle is encrypted with a key derived from the user's recovery phrase,
 * which the server never sees.
 *
 * Browser only — IndexedDB does not exist in Node, and this module throws a
 * clear error there instead of silently no-op'ing.
 */

const DB_NAME = "cerebrum-e2ee";
const DB_VERSION = 1;

function assertBrowser() {
  if (typeof indexedDB === "undefined" || typeof crypto?.subtle === "undefined") {
    throw new Error("e2ee/store: IndexedDB/WebCrypto unavailable (browser only)");
  }
}

function openDb() {
  assertBrowser();
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("device"))
        db.createObjectStore("device", { keyPath: "id" });
      if (!db.objectStoreNames.contains("accounts"))
        db.createObjectStore("accounts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sessions"))
        db.createObjectStore("sessions", { keyPath: "peerDevice" });
      if (!db.objectStoreNames.contains("meta"))
        db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    // Resolve with the store; callers await tx() only after their request
    // completes, so completion ordering is safe.
    resolve(s);
  });
}

async function put(store, value) {
  const db = await openDb();
  const s = await tx(db, store, "readwrite");
  await new Promise((resolve, reject) => {
    const r = s.put(value);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  db.close();
}

async function get(store, key) {
  const db = await openDb();
  const s = await tx(db, store, "readonly");
  const value = await new Promise((resolve, reject) => {
    const r = s.get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return value ?? null;
}

async function del(store, key) {
  const db = await openDb();
  const s = await tx(db, store, "readwrite");
  await new Promise((resolve, reject) => {
    const r = s.delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
  db.close();
}

function b64encode(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

/** The AES-GCM device key, generated once and kept in its own store. */
async function getDeviceKey() {
  const row = await get("device", "device-key");
  if (row) {
    return crypto.subtle.importKey("raw", b64decode(row.raw), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const raw = await crypto.subtle.exportKey("raw", key);
  await put("device", { id: "device-key", raw: b64encode(raw) });
  return key;
}

async function seal(plaintext) {
  const key = await getDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { iv: b64encode(iv.buffer), ciphertext: b64encode(ct) };
}

async function open(sealed) {
  const key = await getDeviceKey();
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(b64decode(sealed.iv)) },
    key,
    b64decode(sealed.ciphertext)
  );
  return new TextDecoder().decode(pt);
}

/** Persist the Olm account pickle (plaintext key material — encrypted here). */
export async function saveAccountPickle(pickleJson) {
  if (typeof pickleJson !== "string" || !pickleJson.startsWith("{")) {
    throw new Error("e2ee/store: refusing to store a non-pickle value");
  }
  const sealed = await seal(pickleJson);
  await put("accounts", { id: "olm-account", ...sealed, updatedAt: Date.now() });
}

/** Returns the decrypted account pickle, or null when this device has none. */
export async function loadAccountPickle() {
  const row = await get("accounts", "olm-account");
  if (!row) return null;
  return open(row);
}

/** Persist one peer-device session pickle (encrypted). */
export async function saveSessionPickle(peerDeviceId, pickleJson) {
  if (!peerDeviceId || typeof pickleJson !== "string") {
    throw new Error("e2ee/store: bad session persist arguments");
  }
  const sealed = await seal(pickleJson);
  await put("sessions", {
    peerDevice: peerDeviceId,
    ...sealed,
    updatedAt: Date.now(),
  });
}

/** Returns the decrypted session pickle for a peer device, or null. */
export async function loadSessionPickle(peerDeviceId) {
  const row = await get("sessions", peerDeviceId);
  if (!row) return null;
  return open(row);
}

export async function deleteSessionPickle(peerDeviceId) {
  await del("sessions", peerDeviceId);
}

/** Small unencrypted metadata: our device_id, schema flags, etc. */
export async function saveMeta(key, value) {
  await put("meta", { key, value });
}

export async function loadMeta(key) {
  const row = await get("meta", key);
  return row ? row.value : null;
}

/**
 * Irreversible local wipe: deletes the device key, account, sessions, meta.
 * Used for "log out everywhere / forget this device". The server-side backup
 * bundle (recovery.js) is untouched — the phrase still restores.
 */
export async function wipeLocalKeys() {
  assertBrowser();
  const db = await openDb();
  for (const store of ["device", "accounts", "sessions", "meta"]) {
    await new Promise((resolve, reject) => {
      const t = db.transaction(store, "readwrite");
      const r = t.objectStore(store).clear();
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }
  db.close();
}
