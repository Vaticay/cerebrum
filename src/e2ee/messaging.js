/**
 * E2EE messaging layer — Phase 1.4.
 *
 * Sits between the inbox UI and the API. Responsibilities:
 *
 *  - Device lifecycle: create the Olm account on first use, publish public
 *    keys + one-time prekeys to the server, top up the prekey pool.
 *  - Encrypt: fan out one envelope per peer device (each gets its own Olm
 *    session), fail closed if any device can't be reached.
 *  - Decrypt: run the inbound pipeline over a thread's cipher rows —
 *    creating inbound sessions from prekey messages, skipping rows meant
 *    for this user's other devices, and NEVER surfacing raw ciphertext or
 *    crashing the thread on a bad row.
 *  - Recovery: 24-word phrase generated at setup, sealed locally, and used
 *    to encrypt a zero-knowledge backup bundle on the server. Restore is
 *    an explicit user flow: phrase → bundle → same identity, new device.
 *  - Trust: safety numbers (per-peer fingerprints) with local verification
 *    state and change detection. A session is just math until the humans
 *    verify each other.
 *
 * What this module deliberately does NOT do:
 *  - It never sends plaintext to an encrypted thread (the server would
 *    reject it anyway — defense in depth, not trust).
 *  - It never invents key authenticity: see safety numbers above.
 *  - It never auto-recovers an account: if the local keys are gone and no
 *    phrase is offered, this device becomes a NEW device.
 *
 * All errors thrown are human-readable — the inbox toasts them directly.
 */

import {
  initCrypto,
  E2EEAccount,
  E2EESession,
  packEnvelope,
} from "./crypto.js";
import {
  loadAccountPickle,
  saveAccountPickle,
  loadSessionPickles,
  saveSessionPickles,
  loadRecoveryPhrase,
  saveRecoveryPhrase,
  loadMeta,
  saveMeta,
  wipeLocalKeys,
} from "./store.js";
import {
  generateRecoveryPhrase,
  isValidRecoveryPhrase,
  normalizePhrase,
  encryptBackupBundle,
  decryptBackupBundle,
  WRONG_PHRASE,
} from "./recovery.js";
import { parseCipherEnvelope } from "../../functions/lib/e2eeValidate.js";

// ── Tunables ──────────────────────────────────────────────────────────

const PREKEY_TARGET = 100; // pool size we try to maintain server-side
const PREKEY_LOW_WATER = 25; // top up when the server reports fewer than this
const TOPUP_CHECK_MS = 5 * 60 * 1000; // don't ask the server more than this often
const CLAIM_CACHE_MS = 60 * 1000; // peer device directory is fresh for a minute

// ── Module state (per browser profile) ────────────────────────────────

let gAccount = null; // E2EEAccount, once loaded
let gDeviceId = null; // our 22-char device id
let gIdentityKey = null; // our Curve25519 identity (base64)
const gSessionLists = new Map(); // "peerUserId:peerDeviceId" -> E2EESession[] (newest first)
const gDirCache = new Map(); // peerUserId -> { at, devices } (non-consuming directory)
const gDecryptCache = new Map(); // messageId -> { ok, text } | { ok:false, error }

function sessionKey(peerUserId, peerDeviceId) {
  return `${peerUserId}:${peerDeviceId}`;
}

function newDeviceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function defaultDeviceLabel() {
  try {
    const ua = navigator.userAgent || "";
    if (/iPhone/i.test(ua)) return "iPhone";
    if (/iPad/i.test(ua)) return "iPad";
    if (/Android/i.test(ua)) return "Android phone";
    if (/Macintosh|Mac OS/i.test(ua)) return "Mac";
    if (/Windows/i.test(ua)) return "Windows PC";
    if (/Linux/i.test(ua)) return "Linux";
  } catch {}
  return "Browser";
}

// ── Device lifecycle ──────────────────────────────────────────────────

/**
 * Make sure this device has an Olm account, published keys, and a healthy
 * prekey pool. Idempotent — safe to call on every encrypted-thread open.
 * Returns { deviceId, identityKey }. Throws a human-readable error when
 * the device can't be brought online (fail closed: the caller must not
 * fall back to plaintext).
 */
export async function ensureE2EEDevice(apiAction) {
  await initCrypto();
  let isNewAccount = false;
  let recoveryPhrase = null;
  if (!gAccount) {
    const pickle = await loadAccountPickle().catch(() => null);
    if (pickle) {
      gAccount = await E2EEAccount.fromPickle(pickle);
    } else {
      // First run on this browser profile: brand-new device, brand-new
      // identity. The 24-word recovery phrase is generated here — it is
      // the ONLY way to move this identity to another device. Email login
      // and password resets can never recover it.
      gAccount = await E2EEAccount.create();
      gAccount.generateOneTimeKeys(PREKEY_TARGET);
      gAccount.generateFallbackKey();
      gDeviceId = newDeviceId();
      isNewAccount = true;
      recoveryPhrase = generateRecoveryPhrase();
      await saveAccountPickle(gAccount.pickle());
      await saveMeta("e2ee:deviceId", gDeviceId);
      await saveRecoveryPhrase(recoveryPhrase);
    }
    if (!gDeviceId) {
      gDeviceId = await loadMeta("e2ee:deviceId").catch(() => null);
    }
    if (!gDeviceId) {
      // Defensive: an account pickle survived but the device id didn't.
      // Mint a fresh device id rather than running with none — the server
      // keys rows by (user, device), so a missing id is a hard stop.
      gDeviceId = newDeviceId();
      await saveMeta("e2ee:deviceId", gDeviceId);
    }
    gIdentityKey = gAccount.identityKeys().curve25519;
  }

  // The signed prekey is the account's fallback key, Matrix-style: a
  // long-lived Curve25519 key whose public half is signed by the Ed25519
  // identity key. Scheme (documented so peers can verify it later):
  //   prekey_sig = base64(Ed25519(signing_key, ascii(identity_b64 + "." + prekey_b64)))
  // The server checks the FORMAT of this signature only — it cannot vouch
  // for authenticity against our threat model, so it doesn't pretend to.
  // Real authentication is peer-to-peer via safety numbers (Phase 1.4).
  let fallback = gAccount.unpublishedFallbackKey();
  if (Object.keys(fallback).length === 0) {
    // Accounts minted before the fallback existed (Phase 1.1 testing).
    gAccount.generateFallbackKey();
    fallback = gAccount.unpublishedFallbackKey();
  }
  const fallbackPubkey = Object.values(fallback)[0];
  const identityKeys = gAccount.identityKeys();
  const prekeySig = gAccount.sign(`${identityKeys.curve25519}.${fallbackPubkey}`);

  // Ship any unpublished one-time keys, topping up when the pool is low.
  // generateOneTimeKeys APPENDS (verified empirically), so topping up
  // never discards keys that haven't reached the server yet.
  let unpublished = gAccount.unpublishedOneTimeKeys();
  const lastCheck = (await loadMeta("e2ee:lastTopupCheck").catch(() => 0)) || 0;
  if (Date.now() - lastCheck > TOPUP_CHECK_MS) {
    let serverCount = 0;
    try {
      const res = await apiAction("e2ee-prekey-count", { device_id: gDeviceId });
      serverCount = res?.prekeyCount || 0;
    } catch {
      // Brand-new device: no row yet, count endpoint 404s. Publish below
      // creates it; treat the pool as empty and upload what we have.
      serverCount = 0;
    }
    const have = serverCount + Object.keys(unpublished).length;
    if (have < PREKEY_LOW_WATER) {
      gAccount.generateOneTimeKeys(Math.min(PREKEY_TARGET - have, PREKEY_TARGET));
      unpublished = gAccount.unpublishedOneTimeKeys();
    }
    await saveMeta("e2ee:lastTopupCheck", Date.now()).catch(() => {});
  }

  const oneTimePrekeys = Object.entries(unpublished).map(([id, pubkey]) => ({ id, pubkey }));
  // Zero-knowledge backup: the account pickle encrypted with the recovery
  // phrase (Argon2id), stored opaquely on the server — the server can never
  // decrypt it. Best-effort: a failed upload sets backupPending and retries
  // on the next ensure. Device setup never fails over the backup.
  if (isNewAccount || (await loadMeta("e2ee:backupPending").catch(() => 0))) {
    const ok = await uploadBackupBundle(apiAction).then(() => true, () => false);
    await saveMeta("e2ee:backupPending", ok ? 0 : 1).catch(() => {});
  }
  // The inbox poll calls this on every tick: skip the network publish when
  // there is nothing new to announce and we published recently. A failed
  // publish leaves keys unpublished, so it always retries — this throttle
  // can never swallow a first publish or a top-up.
  const lastPublish = (await loadMeta("e2ee:lastPublish").catch(() => 0)) || 0;
  if (oneTimePrekeys.length === 0 && Date.now() - lastPublish < 60000) {
    return { deviceId: gDeviceId, identityKey: gIdentityKey, recoveryPhrase };
  }
  const pub = await apiAction("e2ee-publish-device", {
    device_id: gDeviceId,
    identity_key: identityKeys.curve25519,
    signing_key: identityKeys.ed25519,
    signed_prekey: fallbackPubkey,
    prekey_sig: prekeySig,
    fallback_key: fallbackPubkey,
    fallback_sig: prekeySig,
    label: defaultDeviceLabel(),
    one_time_prekeys: oneTimePrekeys,
  });

  // Revocation is sticky server-side: re-publishing a revoked device id
  // never resurrects it. Fail closed here instead of sending into the
  // void — the user re-enables encrypted messaging explicitly, which
  // mints a brand-new device id. The revoked id stays stored locally so
  // this state persists (and never silently rotates into a new identity
  // the user didn't approve).
  if (pub && pub.revoked) {
    throw new Error("This device was removed from encrypted messaging. Re-enable it in settings to set up encryption again.");
  }

  // Only now are the keys durably on the server — mark them published and
  // re-pickle. If the publish threw, the keys stay "unpublished" and ride
  // along on the next attempt (the server's INSERT OR IGNORE makes that
  // convergent rather than duplicative).
  gAccount.markKeysAsPublished();
  await saveAccountPickle(gAccount.pickle());
  await saveMeta("e2ee:lastPublish", Date.now()).catch(() => {});
  return { deviceId: gDeviceId, identityKey: gIdentityKey, recoveryPhrase };
}

/**
 * Encrypt the current account pickle with the recovery phrase and store the
 * opaque bundle on the server. Throws on failure — callers decide whether
 * to retry (ensure) or surface (manual "back up now").
 */
async function uploadBackupBundle(apiAction) {
  const phrase = await loadRecoveryPhrase().catch(() => null);
  if (!phrase || !gAccount) throw new Error("No recovery phrase or account to back up.");
  const bundle = await encryptBackupBundle(gAccount.pickle(), phrase);
  await apiAction("e2ee-backup-put", { bundle, device_id: gDeviceId, label: defaultDeviceLabel() });
  await saveMeta("e2ee:backupAt", Date.now()).catch(() => {});
}

/**
 * My backup bundles (metadata only — labels + timestamps, no ciphertext).
 * The restore UI lists these so the user picks WHICH device to restore.
 */
export async function listBackups(apiAction) {
  const res = await apiAction("e2ee-backup-get", {});
  return ((res && res.backups) || []).map((b) => ({
    deviceId: b.deviceId,
    label: b.label || "Device",
    updatedAt: b.updatedAt,
  }));
}

/** Manual "back up now" for Settings. Fails loudly — the user asked for it. */
export async function uploadBackupNow(apiAction) {
  await ensureE2EEDevice(apiAction);
  await uploadBackupBundle(apiAction);
  await saveMeta("e2ee:backupPending", 0).catch(() => {});
  return { backedUp: true };
}

/** The sealed recovery phrase, or null when this device never set one up. */
export async function getRecoveryPhrase() {
  await initCrypto();
  return loadRecoveryPhrase().catch(() => null);
}

export async function isRecoveryPhraseConfirmed() {
  return !!(await loadMeta("e2ee:phraseConfirmed").catch(() => 0));
}

/** The user wrote the phrase down — stop nagging them about it. */
export async function confirmRecoveryPhrase() {
  await saveMeta("e2ee:phraseConfirmed", 1).catch(() => {});
}

export async function getBackupInfo() {
  return {
    at: (await loadMeta("e2ee:backupAt").catch(() => 0)) || 0,
    pending: !!(await loadMeta("e2ee:backupPending").catch(() => 0)),
    phraseConfirmed: await isRecoveryPhraseConfirmed(),
  };
}

// ── Sentbox: our own sent plaintext, per device ─────────────────────────
// A session cannot decrypt its own sent messages (verified: it throws),
// so history readability for sent rows comes from a small local journal:
// mid -> plaintext, capped and pruned. This is per-device on purpose —
// what another of my devices sent is genuinely not readable here (the UI
// says so instead of pretending).

const SENTBOX_MAX = 200;

async function saveSentText(mid, text) {
  if (!mid) return;
  const box = (await loadMeta("e2ee:sentbox").catch(() => null)) || {};
  box[mid] = { text, at: Date.now() };
  const keys = Object.keys(box);
  if (keys.length > SENTBOX_MAX) {
    keys
      .sort((a, b) => box[a].at - box[b].at)
      .slice(0, keys.length - SENTBOX_MAX)
      .forEach((k) => delete box[k]);
  }
  await saveMeta("e2ee:sentbox", box).catch(() => {});
}

async function loadSentText(mid) {
  if (!mid) return null;
  const box = (await loadMeta("e2ee:sentbox").catch(() => null)) || {};
  const entry = box[mid];
  return entry && typeof entry.text === "string" ? entry.text : null;
}

// ── Sessions ──────────────────────────────────────────────────────────

/**
 * Sessions per (peer user, peer device), newest first. A small LIST, not a
 * single session, because Olm sessions can legitimately fork: if both sides
 * send their first message before either receives (our inbox polls every
 * few seconds, so this happens), each side ends up with an outbound session
 * AND an inbound-created session for the same peer device. Decrypt tries
 * each in turn; the one that opens the message is promoted to primary.
 * The list is capped so a pathological peer can't grow it without bound.
 */
const MAX_SESSIONS_PER_PEER_DEVICE = 5;

/** @type {Map<string, E2EESession[]>} */
async function loadSessions(peerUserId, peerDeviceId) {
  const key = sessionKey(peerUserId, peerDeviceId);
  if (gSessionLists.has(key)) return gSessionLists.get(key);
  const pickles = await loadSessionPickles(key).catch(() => null);
  const out = [];
  if (pickles) {
    for (const p of pickles.slice(0, MAX_SESSIONS_PER_PEER_DEVICE)) {
      try {
        out.push(await E2EESession.fromPickle(p));
      } catch {
        // Corrupt pickle — skip it; the caller builds a fresh session.
      }
    }
  }
  gSessionLists.set(key, out);
  return out;
}

async function storeSessions(peerUserId, peerDeviceId, sessions) {
  const key = sessionKey(peerUserId, peerDeviceId);
  const capped = sessions.slice(0, MAX_SESSIONS_PER_PEER_DEVICE);
  gSessionLists.set(key, capped);
  // Olm sessions are stateful (the ratchet advances on every message), so
  // pickles are re-saved after every use, not just at creation.
  const pickles = [];
  for (const s of capped) {
    try {
      pickles.push(s.pickle());
    } catch {
      // Unpicklable session — drop it rather than failing the send.
    }
  }
  await saveSessionPickles(key, pickles).catch(() => {});
}

/**
 * The peer's public device directory (e2ee-peer-devices): device ids,
 * identity keys, labels, revocation state. Consumes NOTHING server-side,
 * so readiness checks, safety numbers, and the send path's session
 * inventory all go through here. Cached briefly; pass { fresh: true }
 * when revocation state must be current (the send path does).
 */
async function listPeerDevices(apiAction, peerUserId, { fresh = false } = {}) {
  const cached = gDirCache.get(peerUserId);
  if (cached && !fresh && Date.now() - cached.at < CLAIM_CACHE_MS) return cached.devices;
  const res = await apiAction("e2ee-peer-devices", { target_user_id: peerUserId });
  const devices = res?.devices || [];
  gDirCache.set(peerUserId, { at: Date.now(), devices });
  return devices;
}

/**
 * Claim one-time keys for the given devices ONLY (e2ee-claim-keys with
 * device_ids). Always fresh — a cached one-time key may already be
 * consumed (the peer deletes each one-time key after its single use),
 * and building a session on a dead key produces a prekey message nobody
 * can open: silent message loss. Callers pass ONLY the devices that need
 * a NEW outbound session, so a send to N known devices consumes ZERO
 * one-time keys.
 */
async function claimKeys(apiAction, peerUserId, deviceIds) {
  const res = await apiAction("e2ee-claim-keys", {
    target_user_id: peerUserId,
    device_ids: deviceIds,
  });
  return res?.devices || [];
}

// ── Encrypt ───────────────────────────────────────────────────────────

/**
 * Encrypt `plaintext` for every active device of `peerUserId`.
 * Returns { envelopes: [{ text, recipientDeviceId }], deviceId } — the
 * caller sends ONE send-message per envelope (each row is addressed to a
 * single device via the envelope's `rd` field).
 *
 * Fail-closed: zero reachable devices, or any device that can't produce a
 * session, throws. The caller must surface the error, never downgrade.
 */
export async function encryptMessage({ apiAction, peerUserId, plaintext }) {
  if (!peerUserId) throw new Error("Couldn't encrypt: the conversation has no one else in it.");
  if (!plaintext) throw new Error("Couldn't encrypt an empty message.");
  const { deviceId } = await ensureE2EEDevice(apiAction);
  // Fresh directory: revocation state must be current on the send path.
  const dir = await listPeerDevices(apiAction, peerUserId, { fresh: true });
  const active = dir.filter((d) => !d.revokedAt);
  if (active.length === 0) {
    throw new Error("The other person hasn't set up encrypted messaging yet.");
  }
  // Inventory sessions first: devices we already talk to need NO new keys.
  const needKeys = [];
  const sessions = new Map();
  for (const d of active) {
    const list = await loadSessions(peerUserId, d.deviceId);
    if (list.length > 0) sessions.set(d.deviceId, list);
    else needKeys.push(d.deviceId);
  }
  // One targeted claim for exactly the devices lacking a session. Never
  // mint a session from a cached one-time key — a consumed key means an
  // undecryptable prekey message (silent loss).
  let claimed = new Map();
  if (needKeys.length > 0) {
    const fresh = await claimKeys(apiAction, peerUserId, needKeys);
    for (const c of fresh) claimed.set(c.deviceId, c);
  }
  const payload = JSON.stringify({ text: plaintext });
  // One mid per send: every envelope of this fan-out shares it, so the
  // sender's own rows collapse into a single bubble and the sentbox can
  // restore the plaintext after a reload.
  const mid = crypto.randomUUID();
  const envelopes = [];
  for (const device of active) {
    let list = sessions.get(device.deviceId);
    let session = list ? list[0] : null;
    if (!session) {
      const c = claimed.get(device.deviceId);
      if (!c) {
        throw new Error("Couldn't start an encrypted session with one of their devices. Try again.");
      }
      const otk = c.oneTimeKey?.pubkey || c.fallbackKey;
      if (!otk) {
        throw new Error("Couldn't start an encrypted session with one of their devices — no keys available.");
      }
      session = gAccount.createOutboundSession(c.identityKey, otk);
      list = [session];
    }
    let msg;
    try {
      msg = session.encrypt(payload);
    } catch {
      throw new Error("Couldn't encrypt that message. Try again.");
    }
    // Re-save: the ratchet advanced, and the primary may have changed.
    await storeSessions(peerUserId, device.deviceId, list);
    envelopes.push({
      text: packEnvelope({
        type: msg.type,
        body: msg.body,
        senderDevice: deviceId,
        senderIdentityKey: gIdentityKey,
        recipientDevice: device.deviceId,
        messageId: mid,
      }),
      recipientDeviceId: device.deviceId,
    });
  }
  await saveSentText(mid, plaintext);
  return { envelopes, deviceId, mid };
}

// ── Decrypt ───────────────────────────────────────────────────────────

/**
 * Run the inbound pipeline over a thread's messages. Returns a NEW array;
 * each cipher message gains an `e2ee` field:
 *  - { ok: true, text }            decrypted plaintext
 *  - { ok: false, error }          couldn't decrypt — UI shows the error,
 *                                  never raw ciphertext, never a crash
 *  - { skipped: true }             addressed to another of my devices
 * Plaintext-legacy rows pass through untouched (the 1.4 UI labels them).
 *
 * Results are cached by message id so the 5s inbox poll doesn't redo
 * public-key work on every tick.
 */
export async function decryptThreadMessages({ messages, myDeviceId, peerUserId }) {
  await initCrypto();
  if (!gAccount) {
    // Decrypting implies this device was set up; if somehow it wasn't
    // (restored profile, wiped storage), bring it online first so inbound
    // prekey messages have an account to land on.
    await ensureE2EEDevice(() => {
      throw new Error("Couldn't reach the server to set up encryption.");
    }).catch(() => {});
  }
  const out = [];
  for (const m of messages || []) {
    if (m.msgKind !== "cipher" || typeof m.text !== "string") {
      out.push(m);
      continue;
    }
    const cached = gDecryptCache.get(m.id);
    if (cached) {
      out.push({ ...m, e2ee: cached });
      continue;
    }
    const result = await decryptOne(m, myDeviceId, peerUserId).catch(() => ({
      ok: false,
      error: "Couldn't decrypt this message.",
    }));
    gDecryptCache.set(m.id, result.e2ee);
    out.push(result);
  }
  // Collapse the sender's fan-out: my N rows for one send share a mid —
  // the first renders, the rest are skipped, so one send is one bubble.
  const seenMids = new Set();
  return out.map((msg) => {
    const e = msg.e2ee;
    if (e && e.isOwnEcho && e.mid) {
      if (seenMids.has(e.mid)) return { ...msg, e2ee: { ...e, skipped: true } };
      seenMids.add(e.mid);
    }
    return msg;
  });
}

async function decryptOne(m, myDeviceId, peerUserId) {
  const fail = (error) => ({ ...m, e2ee: { ok: false, error } });
  const env = parseCipherEnvelope(m.text);
  if (!env) return fail("This message is damaged and can't be opened.");

  // My own sent rows: a session cannot decrypt its own sent messages, so
  // the plaintext comes from the per-device sentbox journal instead.
  if (env.sd === myDeviceId) {
    const text = await loadSentText(env.mid);
    if (text != null) {
      return { ...m, e2ee: { ok: true, text, isOwnEcho: true, mid: env.mid || null } };
    }
    return fail("This message was sent from this device but is no longer available here.");
  }

  // Mine, but sent from another of my devices: genuinely unreadable here.
  // An honest placeholder, not a fake decryption and not a silent hole.
  if (m.mine) {
    return { ...m, e2ee: { ok: false, error: "Sent from another device.", otherDevice: true } };
  }

  // Addressed to a different device of mine — skip silently. Showing
  // "couldn't decrypt" here would be a lie: the message is fine, it's
  // just not for this device.
  if (env.rd && env.rd !== myDeviceId) {
    return { ...m, e2ee: { skipped: true } };
  }

  const senderUserId = m.senderId;
  const senderDeviceId = env.sd;

  // Try every known session for this sender device, newest first. This
  // handles normal messages AND repeated prekey (type 0) messages from the
  // same sender session: a vodozemac outbound session keeps emitting
  // prekey messages until it receives a reply, and all of them open with
  // the one session — no new one-time key is consumed.
  let sessions = await loadSessions(senderUserId, senderDeviceId);
  for (let i = 0; i < sessions.length; i++) {
    try {
      const pt = sessions[i].decrypt(env.type, env.body);
      // Promote the working session to primary for future encrypts.
      if (i !== 0) {
        sessions = [sessions[i], ...sessions.filter((_, j) => j !== i)];
      }
      await storeSessions(senderUserId, senderDeviceId, sessions);
      return okWithText(m, pt);
    } catch {
      // Not this session — try the next, or fall through to inbound.
    }
  }

  // No known session opened it. A prekey message can start a session —
  // this is the new-device, reinstall, and simultaneous-first-message path.
  // (Feeding a prekey from a DIFFERENT session into an existing session
  // throws, verified empirically; hence the try-each loop above.)
  if (env.type === 0) {
    // The bridge returns the sender's identity key from inside the
    // message; it must match the envelope's claimed key.
    try {
      const inbound = gAccount.createInboundSession(env.body);
      if (inbound.senderIdentityKey !== env.sk) {
        return fail("This message failed verification and wasn't opened.");
      }
      await storeSessions(senderUserId, senderDeviceId, [inbound.session, ...sessions]);
      return okWithText(m, inbound.plaintext);
    } catch {
      return fail("Couldn't decrypt this message.");
    }
  }

  return fail("Couldn't decrypt this message — the sender may have reset their keys.");
}

function okWithText(m, plaintext) {
  let text = null;
  try {
    const parsed = JSON.parse(plaintext);
    if (parsed && typeof parsed.text === "string") text = parsed.text;
  } catch {}
  if (text == null) {
    return { ...m, e2ee: { ok: false, error: "This message is damaged and can't be opened." } };
  }
  return { ...m, e2ee: { ok: true, text } };
}

// ── Recovery: restore this identity on a new device ───────────────────

/**
 * Restore the Olm identity from the zero-knowledge server backup using the
 * user's 24-word recovery phrase. This device becomes a NEW device id with
 * the SAME identity keys — peers will see a new device from a familiar
 * identity (their safety number for you does not change).
 *
 * Key hygiene: the imported pickle may contain one-time keys the ORIGINAL
 * device already published under its own device id. Re-publishing them here
 * would let two devices advertise the same one-time key, so they are marked
 * published-without-publishing and a fresh pool is minted for this device.
 */
export async function restoreFromPhrase(apiAction, phrase, deviceId = null) {
  await initCrypto();
  if (!isValidRecoveryPhrase(phrase)) {
    throw new Error("That recovery phrase doesn't look right — check each of the 24 words and try again.");
  }
  const res = await apiAction("e2ee-backup-get", {});
  const all = (res && res.backups) || [];
  // Explicit device when the UI offered a picker; otherwise the newest.
  const pick = deviceId
    ? all.find((b) => b.deviceId === deviceId)
    : [...all].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!pick || !pick.bundle) {
    throw new Error("No encrypted backup found for this account. The phrase can only restore a device that was backed up.");
  }
  let pickle;
  try {
    pickle = await decryptBackupBundle(pick.bundle, normalizePhrase(phrase));
  } catch (e) {
    if (e && (e.code === "WRONG_PHRASE" || e.message === WRONG_PHRASE)) {
      throw new Error("That phrase didn't unlock the backup. Check the words and try again.");
    }
    throw e;
  }
  const account = await E2EEAccount.fromPickle(pickle);
  account.markKeysAsPublished(); // never re-advertise the backup's key pool
  account.generateOneTimeKeys(PREKEY_TARGET);
  account.generateFallbackKey();
  gAccount = account;
  gDeviceId = newDeviceId();
  gIdentityKey = gAccount.identityKeys().curve25519;
  await saveAccountPickle(gAccount.pickle());
  await saveMeta("e2ee:deviceId", gDeviceId);
  await saveRecoveryPhrase(normalizePhrase(phrase));
  await saveMeta("e2ee:phraseConfirmed", 1).catch(() => {});
  await saveMeta("e2ee:lastPublish", 0).catch(() => {});
  // Publish this new device's keys, then refresh the backup to the current
  // pickle (same identity, current key pool state).
  await ensureE2EEDevice(apiAction);
  await uploadBackupNow(apiAction).catch(() => {});
  return { deviceId: gDeviceId, restored: true };
}

// ── Device management ─────────────────────────────────────────────────

/** My devices from the server, newest activity first, with `current` marked. */
export async function listDevices(apiAction) {
  const { deviceId } = await ensureE2EEDevice(apiAction);
  const res = await apiAction("e2ee-list-devices", {});
  const devices = (res && res.devices) || [];
  return {
    currentDeviceId: deviceId,
    devices: devices.map((d) => ({ ...d, current: d.deviceId === deviceId })),
  };
}

/**
 * Revoke one of my devices. If it's THIS device, local state is wiped too —
 * an explicit user action, so the next ensureE2EEDevice starts clean instead
 * of failing closed forever on the revoked id.
 */
export async function revokeDevice(apiAction, deviceId) {
  const { deviceId: ownId } = await ensureE2EEDevice(apiAction);
  await apiAction("e2ee-revoke-device", { device_id: deviceId });
  if (deviceId === ownId) {
    clearE2EEMemory();
    await wipeLocalKeys().catch(() => {});
  }
  return { revoked: true, wasCurrent: deviceId === ownId };
}

// ── Per-thread upgrade ────────────────────────────────────────────────

/**
 * Flip a DM to encrypted. The server refuses unless both sides have active
 * devices; its human-readable errors propagate (peer not ready / self not
 * ready). Returns { upgraded: true } or { upgraded: true, already: true }.
 */
export async function upgradeThread(apiAction, threadId) {
  await ensureE2EEDevice(apiAction);
  return apiAction("e2ee-upgrade-thread", { thread_id: threadId });
}

/**
 * Has the peer set up encrypted messaging (any active device)? Used to
 * decide whether to offer the "Enable encryption" affordance. The device
 * directory consumes no one-time keys, so checking readiness is free, and
 * it returns [] identically for missing/undiscoverable/blocked/keyless —
 * a false here never leaks which one it is.
 */
export async function isPeerEncryptionReady(apiAction, peerUserId) {
  if (!peerUserId) return false;
  const devices = await listPeerDevices(apiAction, peerUserId).catch(() => []);
  return devices.some((d) => !d.revokedAt);
}

// ── Safety numbers ────────────────────────────────────────────────────
// A session is just math until the humans verify each other. The safety
// number fingerprints the UNION of both users' active device Ed25519 keys,
// Safety numbers v3: a symmetric fingerprint of BOTH users' device
// records — active AND revoked. Every known device contributes one record:
//
//   deviceId | signingKey | revokedAt-or-empty
//
// sorted canonically: Alice's set {her records + his records} is the same
// set Bob computes {his records + her records}, so both sides derive the
// SAME number. A new device, a revoked device, or a replaced key changes
// the set — which is exactly the event verification is meant to catch.
//
// Crucially, REVOKED devices stay in the fingerprint (as revoked). Add-
// then-revoke must NOT silently return to the previously verified number:
// otherwise an attacker could briefly add a device, read messages, revoke
// it, and cover their tracks with the number looking "verified" again.
// (This requires the server to retain revoked device rows — it does;
// revocation is a timestamp, never a delete.)
//
// Display: 60 digits in 12 groups of 5 (from 30 bytes of SHA-256, each byte
// rendered as two decimal digits — ~199 bits of fingerprint).
// Verification state is local-only: "e2ee:verified:<peerUserId>" = full hex
// digest. A stored value that no longer matches the live digest surfaces as
// `changed: true` — the UI must show that loudly, never silently.
//
// The number is per DEVICE PAIR in a multi-device world: Alice's phone and
// her laptop derive different numbers (different key in the union), and
// each must be verified separately. That is honest — they ARE different
// key material.

async function safetyDigest(apiAction, peerUserId) {
  await ensureE2EEDevice(apiAction);
  const [mineRes, peerDevices] = await Promise.all([
    apiAction("e2ee-list-devices", {}).catch(() => ({ devices: [] })),
    listPeerDevices(apiAction, peerUserId, { fresh: true }),
  ]);
  const peerAll = peerDevices || [];
  const peerActive = peerAll.filter((d) => !d.revokedAt);
  if (peerActive.length === 0) {
    throw new Error("The other person hasn't set up encrypted messaging yet.");
  }
  const records = new Set();
  const allMine = mineRes?.devices || [];
  const selfRow = allMine.find((d) => d.deviceId === gDeviceId);
  for (const d of allMine) {
    if (d.deviceId && d.signingKey) {
      records.add([d.deviceId, d.signingKey, d.revokedAt || ""].join("|"));
    }
  }
  for (const d of peerAll) {
    if (d.deviceId && d.signingKey) {
      records.add([d.deviceId, d.signingKey, d.revokedAt || ""].join("|"));
    }
  }
  // Our own current key, but ONLY if this device isn't in the directory
  // yet (just created; the list is a beat behind). A revoked self
  // contributes its revoked record above — never a fake "active" one.
  if (!selfRow) {
    records.add([gDeviceId, gAccount.identityKeys().ed25519, ""].join("|"));
  }
  const input = ["cerebrum-safety-v3", ...[...records].sort()].join("||");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return { digest: new Uint8Array(hash), deviceCount: peerActive.length };
}

function formatSafetyNumber(digest) {
  let digits = "";
  for (let i = 0; i < 30; i++) digits += String(digest[i] % 100).padStart(2, "0");
  return digits.replace(/(\d{5})(?=\d)/g, "$1 ").trim();
}

/**
 * Returns { number, deviceCount, verified, changed }.
 *  - verified: the user previously verified THIS exact number.
 *  - changed: the user verified a DIFFERENT number before — treat as a
 *    possible device change / attack until re-verified out of band.
 */
export async function getSafetyNumber(apiAction, peerUserId) {
  const { digest, deviceCount } = await safetyDigest(apiAction, peerUserId);
  const hex = Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
  const stored = await loadMeta(`e2ee:verified:${peerUserId}`).catch(() => null);
  return {
    number: formatSafetyNumber(digest),
    deviceCount,
    verified: stored === hex,
    changed: !!stored && stored !== hex,
  };
}

/** The user compared numbers with the peer out of band and they matched. */
export async function markSafetyNumberVerified(apiAction, peerUserId) {
  const { digest } = await safetyDigest(apiAction, peerUserId);
  const hex = Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
  await saveMeta(`e2ee:verified:${peerUserId}`, hex).catch(() => {});
  return { verified: true };
}

/** Forget the verification (the UI offers this next to the number). */
export async function clearSafetyNumberVerified(peerUserId) {
  await saveMeta(`e2ee:verified:${peerUserId}`, null).catch(() => {});
}

/** Forget cached sessions/claims (used on sign-out). Memory only — the
 *  encrypted IndexedDB rows are wiped by the account layer. */
export function clearE2EEMemory() {
  gSessionLists.clear();
  gDirCache.clear();
  gDecryptCache.clear();
  gAccount = null;
  gDeviceId = null;
  gIdentityKey = null;
}
