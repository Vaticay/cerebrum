/**
 * E2EE messaging layer — Phase 1.3.
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
 *
 * What this module deliberately does NOT do:
 *  - It never sends plaintext to an encrypted thread (the server would
 *    reject it anyway — defense in depth, not trust).
 *  - It never invents key authenticity: a session is just math until the
 *    safety-number UI (Phase 1.4) lets the humans verify each other.
 *  - It never auto-recovers an account: if the local keys are gone, this
 *    device becomes a NEW device. Recovery is a user-driven flow (1.4).
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
  loadSessionPickle,
  saveSessionPickle,
  loadMeta,
  saveMeta,
} from "./store.js";
import { parseCipherEnvelope } from "../../functions/lib/e2eeValidate.js";

// ── Tunables ──────────────────────────────────────────────────────────

const PREKEY_TARGET = 100; // pool size we try to maintain server-side
const PREKEY_LOW_WATER = 25; // top up when the server reports fewer than this
const TOPUP_CHECK_MS = 5 * 60 * 1000; // don't ask the server more than this often
const CLAIM_CACHE_MS = 60 * 1000; // peer key bundles are fresh for a minute

// ── Module state (per browser profile) ────────────────────────────────

let gAccount = null; // E2EEAccount, once loaded
let gDeviceId = null; // our 22-char device id
let gIdentityKey = null; // our Curve25519 identity (base64)
const gSessions = new Map(); // "peerUserId:peerDeviceId" -> E2EESession
const gClaimCache = new Map(); // peerUserId -> { at, devices }
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
  if (!gAccount) {
    const pickle = await loadAccountPickle().catch(() => null);
    if (pickle) {
      gAccount = await E2EEAccount.fromPickle(pickle);
    } else {
      // First run on this browser profile: brand-new device, brand-new
      // identity. This is NOT recovery — if the user had keys elsewhere,
      // those stay where they are until the recovery flow (1.4) runs.
      gAccount = await E2EEAccount.create();
      gAccount.generateOneTimeKeys(PREKEY_TARGET);
      gAccount.generateFallbackKey();
      gDeviceId = newDeviceId();
      await saveAccountPickle(gAccount.pickle());
      await saveMeta("e2ee:deviceId", gDeviceId);
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
  // The inbox poll calls this on every tick: skip the network publish when
  // there is nothing new to announce and we published recently. A failed
  // publish leaves keys unpublished, so it always retries — this throttle
  // can never swallow a first publish or a top-up.
  const lastPublish = (await loadMeta("e2ee:lastPublish").catch(() => 0)) || 0;
  if (oneTimePrekeys.length === 0 && Date.now() - lastPublish < 60000) {
    return { deviceId: gDeviceId, identityKey: gIdentityKey };
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
  return { deviceId: gDeviceId, identityKey: gIdentityKey };
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

async function loadSession(peerUserId, peerDeviceId) {
  const key = sessionKey(peerUserId, peerDeviceId);
  if (gSessions.has(key)) return gSessions.get(key);
  const pickle = await loadSessionPickle(key).catch(() => null);
  if (!pickle) return null;
  try {
    const s = await E2EESession.fromPickle(pickle);
    gSessions.set(key, s);
    return s;
  } catch {
    return null; // corrupt pickle — caller builds a fresh session
  }
}

async function storeSession(peerUserId, peerDeviceId, session) {
  const key = sessionKey(peerUserId, peerDeviceId);
  gSessions.set(key, session);
  // Olm sessions are stateful (the ratchet advances on every message), so
  // the pickle is re-saved after every use, not just at creation.
  await saveSessionPickle(key, session.pickle()).catch(() => {});
}

/**
 * Peer key bundles, cached briefly. Returns the device array from
 * e2ee-claim-keys as-is.
 */
async function claimKeys(apiAction, peerUserId) {
  const cached = gClaimCache.get(peerUserId);
  if (cached && Date.now() - cached.at < CLAIM_CACHE_MS) return cached.devices;
  const res = await apiAction("e2ee-claim-keys", { target_user_id: peerUserId });
  const devices = res?.devices || [];
  gClaimCache.set(peerUserId, { at: Date.now(), devices });
  return devices;
}

async function getOutboundSession(apiAction, peerUserId, device) {
  const existing = await loadSession(peerUserId, device.deviceId);
  if (existing) return existing;
  const otk = device.oneTimeKey?.pubkey || device.fallbackKey;
  if (!otk) {
    throw new Error("Couldn't start an encrypted session with one of their devices — no keys available.");
  }
  const session = gAccount.createOutboundSession(device.identityKey, otk);
  await storeSession(peerUserId, device.deviceId, session);
  return session;
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
  const devices = await claimKeys(apiAction, peerUserId);
  if (devices.length === 0) {
    throw new Error("The other person hasn't set up encrypted messaging yet.");
  }
  const payload = JSON.stringify({ text: plaintext });
  // One mid per send: every envelope of this fan-out shares it, so the
  // sender's own rows collapse into a single bubble and the sentbox can
  // restore the plaintext after a reload.
  const mid = crypto.randomUUID();
  const envelopes = [];
  for (const device of devices) {
    const session = await getOutboundSession(apiAction, peerUserId, device);
    let msg;
    try {
      msg = session.encrypt(payload);
    } catch {
      throw new Error("Couldn't encrypt that message. Try again.");
    }
    await storeSession(peerUserId, device.deviceId, session);
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

  if (env.type === 0) {
    // A prekey message ALWAYS establishes a fresh inbound session — even
    // when an outbound session to this sender already exists. Feeding a
    // foreign prekey into an existing session throws (verified
    // empirically), and the Olm spec agrees: prekey means new session.
    // The bridge returns the sender's identity key from inside the
    // message; it must match the envelope's claimed key.
    try {
      const inbound = gAccount.createInboundSession(env.body);
      if (inbound.senderIdentityKey !== env.sk) {
        return fail("This message failed verification and wasn't opened.");
      }
      const session = inbound.session;
      await storeSession(senderUserId, senderDeviceId, session);
      return okWithText(m, inbound.plaintext);
    } catch {
      return fail("Couldn't decrypt this message.");
    }
  }

  const session = await loadSession(senderUserId, senderDeviceId);
  if (!session) {
    return fail("Couldn't decrypt this message — the sender may have reset their keys.");
  }
  try {
    const pt = session.decrypt(env.type, env.body);
    await storeSession(senderUserId, senderDeviceId, session);
    return okWithText(m, pt);
  } catch {
    return fail("Couldn't decrypt this message.");
  }
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

/** Forget cached sessions/claims (used on sign-out). Memory only — the
 *  encrypted IndexedDB rows are wiped by the account layer. */
export function clearE2EEMemory() {
  gSessions.clear();
  gClaimCache.clear();
  gDecryptCache.clear();
  gAccount = null;
  gDeviceId = null;
  gIdentityKey = null;
}
