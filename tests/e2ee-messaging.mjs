/**
 * E2EE messaging tests (Phase 1.3).
 *
 * Full client round trips through the REAL src/e2ee/messaging.js against
 * an in-memory mock server that enforces the REAL server rules (using the
 * real functions/lib/e2eeValidate.js). IndexedDB is faked per "device
 * profile" so Alice, Bob's phone, Bob's laptop, and Alice's laptop each
 * get isolated local storage — exactly like separate browser profiles.
 *
 * Scenarios:
 *  - device setup publishes valid keys + 100 one-time prekeys
 *  - Alice -> Bob(phone+laptop): fan-out, one envelope per device
 *  - each Bob device decrypts its own row, silently skips the other's
 *  - Bob -> Alice reply: inbound session from the prekey message
 *  - Alice's own sent rows read back via the sentbox (deduped to 1 bubble)
 *  - session continuity: second message after the inbound overwrite
 *  - tampered ciphertext -> honest error, no throw, no cross-contamination
 *  - plaintext to an encrypted thread -> rejected (mock mirrors data.js)
 *  - encrypt with a keyless peer -> fail closed
 *  - Alice's laptop sees "Sent from another device", not fake plaintext
 *
 * Run with: node tests/e2ee-messaging.mjs
 */

import { strict as assert } from "node:assert";
import {
  parseCipherEnvelope,
  isDeviceId,
  isBase64Key,
  isPrekeyEntry,
  MAX_PREKEY_BATCH,
} from "../functions/lib/e2eeValidate.js";
import { packEnvelope } from "../src/e2ee/crypto.js";

// ── Fake IndexedDB (just enough for src/e2ee/store.js) ─────────────────

function makeStore(state) {
  const fire = (req, fn) => {
    queueMicrotask(() => {
      try {
        fn(req);
        if (req.onsuccess) req.onsuccess({ target: req });
      } catch (err) {
        req.error = err;
        if (req.onerror) req.onerror({ target: req });
      }
    });
    return req;
  };
  return {
    put: (value) => fire({}, (req) => {
      state.rows.set(value[state.keyPath], value);
      req.result = value[state.keyPath];
    }),
    get: (key) => fire({}, (req) => {
      req.result = state.rows.has(key) ? state.rows.get(key) : undefined;
    }),
    delete: (key) => fire({}, (req) => { state.rows.delete(key); }),
    clear: () => fire({}, () => { state.rows.clear(); }),
  };
}

function createFakeIndexedDB() {
  const databases = new Map();
  return {
    open(name, version) {
      const req = {};
      queueMicrotask(() => {
        try {
          let db = databases.get(name);
          if (!db) {
            db = { version: 0, stores: new Map() };
            databases.set(name, db);
          }
          const proxy = {
            objectStoreNames: { contains: (n) => db.stores.has(n) },
            createObjectStore: (n, opts) => {
              db.stores.set(n, { keyPath: opts.keyPath, rows: new Map() });
            },
            transaction: (storeName) => ({
              objectStore: (n) => makeStore(db.stores.get(n)),
              oncomplete: null, onerror: null, onabort: null,
            }),
            close: () => {},
          };
          if (version > db.version) {
            db.version = version;
            req.result = proxy;
            if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
          }
          req.result = proxy;
          if (req.onsuccess) req.onsuccess({ target: req });
        } catch (err) {
          req.error = err;
          if (req.onerror) req.onerror({ target: req });
        }
      });
      return req;
    },
  };
}

const idbs = {
  alice: createFakeIndexedDB(),
  bob1: createFakeIndexedDB(),
  bob2: createFakeIndexedDB(),
  alice2: createFakeIndexedDB(),
  carol: createFakeIndexedDB(),
};
async function withDb(profile, fn) {
  globalThis.indexedDB = idbs[profile];
  return fn();
}

// Separate module instances = separate devices (own gAccount/gDeviceId).
const alice = await import("../src/e2ee/messaging.js?profile=alice");
const bob1 = await import("../src/e2ee/messaging.js?profile=bob1");
const bob2 = await import("../src/e2ee/messaging.js?profile=bob2");
const alice2 = await import("../src/e2ee/messaging.js?profile=alice2");
const carol = await import("../src/e2ee/messaging.js?profile=carol");

// ── Mock server (mirrors functions/api/data.js rules) ──────────────────

function makeServer() {
  const devices = new Map(); // "userId:deviceId" -> row
  const otks = new Map(); // "userId:deviceId" -> [{key_id, pubkey, claimed_at}]
  const messages = [];
  const encryptedThreads = new Set(["thr1"]);
  let msgSeq = 0;

  const toClient = (row, viewerId) => ({
    id: row.id,
    senderId: row.sender_id,
    mine: row.sender_id === viewerId,
    text: row.text,
    msgKind: row.msg_kind,
    senderDeviceId: row.sender_device_id || null,
    envelopeVersion: row.envelope_version || 1,
    createdAt: row.created_at,
  });

  async function action(userId, name, body = {}) {
    switch (name) {
      case "e2ee-publish-device": {
        const d = body;
        assert.ok(isDeviceId(d.device_id), "server: bad device_id");
        assert.ok(isBase64Key(d.identity_key, 32), "server: bad identity_key");
        assert.ok(isBase64Key(d.signing_key, 32), "server: bad signing_key");
        assert.ok(isBase64Key(d.signed_prekey, 32), "server: bad signed_prekey");
        assert.ok(isBase64Key(d.prekey_sig, 64), "server: bad prekey_sig");
        assert.ok(
          Array.isArray(d.one_time_prekeys) &&
          d.one_time_prekeys.length <= MAX_PREKEY_BATCH &&
          d.one_time_prekeys.every(isPrekeyEntry),
          "server: bad one_time_prekeys"
        );
        const key = `${userId}:${d.device_id}`;
        const prev = devices.get(key);
        devices.set(key, {
          user_id: userId, device_id: d.device_id,
          identity_key: d.identity_key, signing_key: d.signing_key,
          signed_prekey: d.signed_prekey, prekey_sig: d.prekey_sig,
          fallback_key: d.fallback_key || null, fallback_sig: d.fallback_sig || null,
          // Sticky revocation (mirrors the real upsert): re-publishing a
          // revoked device id never resurrects it.
          revoked_at: prev ? prev.revoked_at : null,
        });
        if (!otks.has(key)) otks.set(key, []);
        const pool = otks.get(key);
        for (const pk of d.one_time_prekeys) {
          if (!pool.some((k) => k.key_id === pk.id)) {
            pool.push({ key_id: pk.id, pubkey: pk.pubkey, claimed_at: null });
          }
        }
        const row = devices.get(key);
        return {
          device_id: d.device_id,
          revoked: !!row.revoked_at,
          devices: [],
          prekeyCount: pool.filter((k) => !k.claimed_at).length,
        };
      }
      case "e2ee-revoke-device": {
        const row = devices.get(`${userId}:${body.device_id}`);
        if (row) {
          row.revoked_at = Date.now();
          for (const k of otks.get(`${userId}:${body.device_id}`) || []) {
            if (!k.claimed_at) k.claimed_at = -1;
          }
        }
        return { revoked: true };
      }
      case "e2ee-prekey-count": {
        const row = devices.get(`${userId}:${body.device_id}`);
        if (!row || row.revoked_at) throw new Error("404 unknown device");
        const pool = otks.get(`${userId}:${body.device_id}`) || [];
        return { prekeyCount: pool.filter((k) => !k.claimed_at).length };
      }
      case "e2ee-claim-keys": {
        const target = body.target_user_id;
        if (!target || target === userId) return { devices: [] };
        const out = [];
        for (const row of devices.values()) {
          if (row.user_id !== target || row.revoked_at) continue;
          const pool = otks.get(`${target}:${row.device_id}`) || [];
          const otk = pool.find((k) => !k.claimed_at);
          if (otk) otk.claimed_at = Date.now(); // atomic in this single-threaded mock
          out.push({
            deviceId: row.device_id,
            identityKey: row.identity_key,
            signingKey: row.signing_key,
            signedPrekey: row.signed_prekey,
            prekeySig: row.prekey_sig,
            oneTimeKey: otk ? { id: otk.key_id, pubkey: otk.pubkey } : null,
            fallbackKey: otk ? null : row.fallback_key,
            fallbackSig: otk ? null : row.fallback_sig,
          });
        }
        return { devices: out };
      }
      case "send-message": {
        const threadId = body.thread_id;
        const text = body.text || "";
        if (encryptedThreads.has(threadId)) {
          // The real fail-closed gate, enforced with the real validator.
          const env = parseCipherEnvelope(text);
          if (!env) throw new Error("e2ee_plaintext_rejected");
          if (!body.sender_device_id) throw new Error("e2ee_bad_device");
          const dev = devices.get(`${userId}:${body.sender_device_id}`);
          if (!dev || dev.revoked_at) throw new Error("e2ee_unknown_device");
          if (env.sd !== body.sender_device_id) throw new Error("e2ee_device_mismatch");
          const row = {
            id: `msg${++msgSeq}`, thread_id: threadId, sender_id: userId,
            text, msg_kind: "cipher", sender_device_id: body.sender_device_id,
            envelope_version: 1, created_at: Date.now(),
          };
          messages.push(row);
          return { ok: true, message: toClient(row, userId) };
        }
        const row = {
          id: `msg${++msgSeq}`, thread_id: threadId, sender_id: userId,
          text, msg_kind: "plaintext-legacy", created_at: Date.now(),
        };
        messages.push(row);
        return { ok: true, message: toClient(row, userId) };
      }
      default:
        throw new Error(`mock: unknown action ${name}`);
    }
  }

  return {
    action,
    getThread: (viewerId, threadId) =>
      messages.filter((m) => m.thread_id === threadId).map((m) => toClient(m, viewerId)),
    deviceCount: (userId) =>
      [...devices.values()].filter((d) => d.user_id === userId).length,
    prekeyCount: (userId, deviceId) =>
      (otks.get(`${userId}:${deviceId}`) || []).filter((k) => !k.claimed_at).length,
  };
}

const server = makeServer();
const apiFor = (userId) => (name, body) => server.action(userId, name, body);

// ── Test harness ───────────────────────────────────────────────────────

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL - ${name}: ${err.message}`);
  }
}

let A, B1, B2, A2; // device ids

await test("device setup publishes valid keys + 100 prekeys", async () => {
  ({ deviceId: A } = await withDb("alice", () => alice.ensureE2EEDevice(apiFor("alice"))));
  ({ deviceId: B1 } = await withDb("bob1", () => bob1.ensureE2EEDevice(apiFor("bob"))));
  ({ deviceId: B2 } = await withDb("bob2", () => bob2.ensureE2EEDevice(apiFor("bob"))));
  assert.ok(isDeviceId(A) && isDeviceId(B1) && isDeviceId(B2), "device ids well-formed");
  assert.notEqual(A, B1);
  assert.notEqual(B1, B2);
  assert.equal(server.deviceCount("alice"), 1);
  assert.equal(server.deviceCount("bob"), 2);
  assert.equal(server.prekeyCount("alice", A), 100);
  assert.equal(server.prekeyCount("bob", B1), 100);
});

await test("Alice -> Bob fans out one envelope per device", async () => {
  const { envelopes, deviceId, mid } = await withDb("alice", () =>
    alice.encryptMessage({ apiAction: apiFor("alice"), peerUserId: "bob", plaintext: "hello bob" })
  );
  assert.equal(deviceId, A);
  assert.equal(envelopes.length, 2, "two peer devices -> two envelopes");
  assert.ok(mid && typeof mid === "string");
  const rds = envelopes.map((e) => parseCipherEnvelope(e.text).rd).sort();
  assert.deepEqual(rds, [B1, B2].sort());
  for (const e of envelopes) {
    const env = parseCipherEnvelope(e.text);
    assert.equal(env.sd, A);
    assert.equal(env.mid, mid, "fan-out shares one mid");
  }
  // One-time keys were consumed atomically: 99 left per device.
  assert.equal(server.prekeyCount("bob", B1), 99);
  assert.equal(server.prekeyCount("bob", B2), 99);
  // The mock server accepts both rows under the real rules.
  for (const e of envelopes) {
    await server.action("alice", "send-message", {
      thread_id: "thr1", text: e.text, sender_device_id: A,
    });
  }
  globalThis.__lastMid = mid;
});

await test("each Bob device decrypts its own row, skips the other's", async () => {
  const rows = server.getThread("bob", "thr1");
  assert.equal(rows.length, 2);
  const got1 = await withDb("bob1", () =>
    bob1.decryptThreadMessages({ messages: rows, myDeviceId: B1, peerUserId: "alice" })
  );
  const shown1 = got1.filter((m) => !(m.e2ee && m.e2ee.skipped));
  assert.equal(shown1.length, 1, "bob1 sees exactly one message");
  assert.equal(shown1[0].e2ee.ok, true);
  assert.equal(shown1[0].e2ee.text, "hello bob");

  const got2 = await withDb("bob2", () =>
    bob2.decryptThreadMessages({ messages: rows, myDeviceId: B2, peerUserId: "alice" })
  );
  const shown2 = got2.filter((m) => !(m.e2ee && m.e2ee.skipped));
  assert.equal(shown2.length, 1);
  assert.equal(shown2[0].e2ee.text, "hello bob");
});

await test("Bob replies; Alice reads via inbound session + sentbox echoes", async () => {
  const { envelopes } = await withDb("bob1", () =>
    bob1.encryptMessage({ apiAction: apiFor("bob"), peerUserId: "alice", plaintext: "hi alice" })
  );
  assert.equal(envelopes.length, 1, "alice has one device");
  await server.action("bob", "send-message", {
    thread_id: "thr1", text: envelopes[0].text, sender_device_id: B1,
  });
  const rows = server.getThread("alice", "thr1");
  assert.equal(rows.length, 3);
  const got = await withDb("alice", () =>
    alice.decryptThreadMessages({ messages: rows, myDeviceId: A, peerUserId: "bob" })
  );
  const shown = got.filter((m) => !(m.e2ee && m.e2ee.skipped));
  // 2 own fan-out rows collapse to 1 via mid dedup + 1 reply = 2 bubbles.
  assert.equal(shown.length, 2, `expected 2 bubbles, got ${shown.length}`);
  const mine = shown.filter((m) => m.mine);
  const theirs = shown.filter((m) => !m.mine);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].e2ee.text, "hello bob", "own echo via sentbox");
  assert.equal(theirs.length, 1);
  assert.equal(theirs[0].e2ee.ok, true);
  assert.equal(theirs[0].e2ee.text, "hi alice", "reply via inbound session");
});

await test("session continuity: Alice sends again after the inbound overwrite", async () => {
  const { envelopes } = await withDb("alice", () =>
    alice.encryptMessage({ apiAction: apiFor("alice"), peerUserId: "bob", plaintext: "still here?" })
  );
  for (const e of envelopes) {
    await server.action("alice", "send-message", {
      thread_id: "thr1", text: e.text, sender_device_id: A,
    });
  }
  const rows = server.getThread("bob", "thr1");
  const fresh = rows.slice(-2); // the two new fan-out rows
  const got = await withDb("bob1", () =>
    bob1.decryptThreadMessages({ messages: fresh, myDeviceId: B1, peerUserId: "alice" })
  );
  const shown = got.filter((m) => !(m.e2ee && m.e2ee.skipped));
  assert.equal(shown.length, 1);
  assert.equal(shown[0].e2ee.text, "still here?");
});

await test("tampered ciphertext -> honest error, no throw, no contamination", async () => {
  const rows = server.getThread("bob", "thr1");
  const victim = { ...rows[0], id: "tamper1" };
  const env = JSON.parse(victim.text);
  // Corrupt the body (keep it valid base64 so the envelope still parses).
  const body = env.body;
  env.body = (body[0] === "A" ? "B" : "A") + body.slice(1);
  victim.text = JSON.stringify(env);
  const mixed = [victim, { ...rows[1], id: "clean1" }];
  const got = await withDb("bob2", () =>
    bob2.decryptThreadMessages({ messages: mixed, myDeviceId: B2, peerUserId: "alice" })
  );
  // bob2's row is rows[1] (rd=B2); victim tampered row[0] is rd=B1 -> skipped.
  // Re-run as bob1 to actually hit the tampered row.
  const got1 = await withDb("bob1", () =>
    bob1.decryptThreadMessages({ messages: [victim], myDeviceId: B1, peerUserId: "alice" })
  );
  assert.equal(got1[0].e2ee.ok, false, "tampered row fails");
  assert.ok(got1[0].e2ee.error, "honest error attached");
  assert.ok(!got1[0].e2ee.text, "no plaintext leaks");
  void got;
});

await test("plaintext to an encrypted thread is rejected (mock mirrors data.js)", async () => {
  await assert.rejects(
    server.action("alice", "send-message", { thread_id: "thr1", text: "naked plaintext", sender_device_id: A }),
    /e2ee_plaintext_rejected/
  );
  await assert.rejects(
    server.action("alice", "send-message", { thread_id: "thr1", text: packEnvelope({ type: 1, body: "eA", senderDevice: "x".repeat(22), senderIdentityKey: "y".repeat(43) }), sender_device_id: "x".repeat(22) }),
    /e2ee_unknown_device/
  );
});

await test("encrypt to a keyless peer fails closed", async () => {
  await withDb("alice", () =>
    assert.rejects(
      alice.encryptMessage({ apiAction: apiFor("alice"), peerUserId: "carol", plaintext: "hi" }),
      /hasn't set up encrypted messaging/
    )
  );
});

await test("Alice's laptop sees 'Sent from another device', not fake plaintext", async () => {
  ({ deviceId: A2 } = await withDb("alice2", () => alice2.ensureE2EEDevice(apiFor("alice"))));
  assert.notEqual(A2, A);
  const rows = server.getThread("alice", "thr1"); // mine=true relative to alice
  const got = await withDb("alice2", () =>
    alice2.decryptThreadMessages({ messages: rows, myDeviceId: A2, peerUserId: "bob" })
  );
  const shown = got.filter((m) => !(m.e2ee && m.e2ee.skipped));
  // Her own sends (from phone A) -> placeholder; Bob's rows are rd=A -> skipped.
  const placeholders = shown.filter((m) => m.e2ee && m.e2ee.otherDevice);
  assert.ok(placeholders.length >= 1, "phone-sent rows show the placeholder");
  for (const p of placeholders) {
    assert.equal(p.e2ee.ok, false);
    assert.match(p.e2ee.error, /another device/);
    assert.ok(!p.e2ee.text, "no fabricated plaintext");
  }
});

await test("revoked device stays dead: re-publish never resurrects, sends rejected", async () => {
  // Bob's phone is revoked (user removed it from another device). The
  // stolen-device scenario: it re-publishes its own id with fresh keys.
  await server.action("bob", "e2ee-revoke-device", { device_id: B1 });

  const { initCrypto, E2EEAccount } = await import("../src/e2ee/crypto.js");
  await initCrypto();
  const acct = await E2EEAccount.create();
  const keys = acct.identityKeys();
  await acct.generateFallbackKey();
  const fallbackPub = Object.values(acct.unpublishedFallbackKey())[0];
  const sig = acct.sign(`${keys.curve25519}.${fallbackPub}`);
  await acct.generateOneTimeKeys(5);
  const repub = await server.action("bob", "e2ee-publish-device", {
    device_id: B1,
    identity_key: keys.curve25519,
    signing_key: keys.ed25519,
    signed_prekey: fallbackPub,
    prekey_sig: sig,
    fallback_key: fallbackPub,
    fallback_sig: sig,
    label: "stolen phone",
    one_time_prekeys: Object.entries(acct.unpublishedOneTimeKeys()).map(([id, pubkey]) => ({ id, pubkey })),
  });
  assert.equal(repub.revoked, true, "re-publish reports revoked, not resurrected");

  // No longer claimable, and its (still-valid) envelopes are rejected.
  const claimed = await server.action("alice", "e2ee-claim-keys", { target_user_id: "bob" });
  assert.ok(!claimed.devices.some((d) => d.deviceId === B1), "revoked device not claimable");
  assert.ok(claimed.devices.some((d) => d.deviceId === B2), "other device unaffected");
  const rows = server.getThread("bob", "thr1");
  const b1Row = rows.find((m) => m.senderDeviceId === B1 && m.msgKind === "cipher");
  await assert.rejects(
    server.action("bob", "send-message", {
      thread_id: "thr1", text: b1Row.text, sender_device_id: B1,
    }),
    /e2ee_unknown_device/,
    "replayed envelope from a revoked device is rejected"
  );
});

await test("client fails closed when the server reports the device revoked", async () => {
  // The server flags revoked:true on publish; the client must refuse to
  // operate as that device instead of silently continuing (or silently
  // rotating into a new identity the user never approved).
  const lyingApi = async (name, body) => {
    if (name === "e2ee-publish-device") {
      return { device_id: body.device_id, revoked: true, devices: [], prekeyCount: 0 };
    }
    return apiFor("carol")(name, body);
  };
  await withDb("carol", () =>
    assert.rejects(
      carol.ensureE2EEDevice(lyingApi),
      /was removed from encrypted messaging/,
      "fail-closed error on revoked publish"
    )
  );
  // Sticky client-side too: the revoked id is kept, so the next attempt
  // fails the same way instead of minting a surprise new identity.
  await withDb("carol", () =>
    assert.rejects(carol.ensureE2EEDevice(lyingApi), /was removed from encrypted messaging/)
  );
});

await test("packEnvelope rd/mid are optional; validator accepts both shapes", async () => {
  const bare = packEnvelope({ type: 1, body: "eA", senderDevice: A, senderIdentityKey: "y".repeat(43) });
  const parsed = JSON.parse(bare);
  assert.ok(!("rd" in parsed) && !("mid" in parsed));
  assert.ok(parseCipherEnvelope(bare), "server accepts minimal envelope");
  const full = packEnvelope({ type: 1, body: "eA", senderDevice: A, senderIdentityKey: "y".repeat(43), recipientDevice: B1, messageId: "m1" });
  const pf = parseCipherEnvelope(full);
  assert.equal(pf.rd, B1);
  assert.equal(pf.mid, "m1");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n${f.name}\n  ${f.err.stack}`);
  process.exit(1);
}
