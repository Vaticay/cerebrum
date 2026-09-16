/**
 * Private Vault (zero-knowledge saved work) client crypto tests.
 *
 * Unit tests against the real module — real Argon2id, real AES-256-GCM,
 * a simulated blind server, no network. Covers vault wrap/unwrap, KEK
 * domain separation, per-item envelope round-trips for all four kinds,
 * tamper rejections (bit-flip, AAD transplants, wrong dek, truncation),
 * padding buckets, stale-dek fail-closed, server blindness, and the
 * ZkSession sync flow (enable/unlock/pull/push/rotate/drop).
 *
 * Argon2id (m=64MiB, t=3) costs ~1s per derive, so derives are kept to a
 * handful: one phrase is reused across the KDF tests.
 *
 * Run with: node tests/zk-data.mjs
 */

import { strict as assert } from "node:assert";
import { subtle } from "node:crypto";
import { argon2id } from "hash-wasm";
import { generateRecoveryPhrase } from "../src/e2ee/recovery.js";
import {
  ZK_DOMAIN,
  ZK_KINDS,
  PAD_BUCKET,
  ZK_MAX_CIPHERTEXT,
  ZK_KDF_PARAMS,
  WRONG_PHRASE_ZK,
  normalizeZkPhrase,
  deriveDataKEK,
  generateDEK,
  makeDekId,
  makeItemId,
  wrapVaultBundle,
  unwrapVaultBundle,
  buildItemAAD,
  padToBucket,
  unpadPadded,
  encryptItem,
  decryptItem,
  ZkSession,
} from "../src/zkData.js";

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

function b64flip(b64) {
  const b = Buffer.from(b64, "base64");
  b[0] ^= 1;
  return b.toString("base64");
}

/** Simulated blind server, mirroring prototype/demo.mjs's makeServer. */
function makeServer() {
  const vault = new Map(); // userId -> { dek_id, wrapped_dek }
  const items = new Map(); // `${userId}:${id}` -> row (stored as a copy, like the network)
  return {
    async post(action, body) {
      switch (action) {
        case "zk-get-vault": {
          const v = vault.get(body?.userId ?? USER);
          return v ? { dek_id: v.dek_id, wrapped_dek: v.wrapped_dek } : {};
        }
        case "zk-put-vault":
          vault.set(body?.userId ?? USER, { dek_id: body.dek_id, wrapped_dek: body.wrapped_dek });
          return { ok: true };
        case "zk-get-items": {
          const uid = body?.userId ?? USER;
          return {
            items: [...items.values()]
              .filter((r) => r.userId === uid && (!body.since || r.updated_at > body.since))
              .slice(0, body.limit ?? 500),
          };
        }
        case "zk-put-items": {
          const uid = body?.userId ?? USER;
          const v = vault.get(uid);
          for (const r of body.items) {
            if (!v || r.dek_id !== v.dek_id) {
              const e = new Error("stale dek_id");
              e.status = 409;
              e.code = "stale_dek";
              throw e;
            }
            if (r.data.length > ZK_MAX_CIPHERTEXT) {
              const e = new Error("too large");
              e.status = 413;
              throw e;
            }
            items.set(`${uid}:${r.id}`, { userId: uid, ...r });
          }
          return { stored: body.items.length };
        }
        case "zk-delete-item":
          items.delete(`${body?.userId ?? USER}:${body.id}`);
          return { ok: true };
        case "zk-drop-vault":
          vault.delete(body?.userId ?? USER);
          for (const k of [...items.keys()]) if (k.startsWith(`${body?.userId ?? USER}:`)) items.delete(k);
          return { ok: true };
        case "zk-purge-legacy":
          assert.equal(body.confirm, true);
          return { deleted: { user_saved_sources: 3, user_history: 2 } };
        default:
          throw new Error(`unknown action ${action}`);
      }
    },
    // Test-only inspection hooks (the real server has no decrypt path).
    _tamperItem: (id) => {
      const r = items.get(`${USER}:${id}`);
      r.data = b64flip(r.data);
    },
    _dump: () => JSON.stringify({ vault: [...vault.values()], items: [...items.values()] }),
  };
}

const USER = "user_abc123";
const phrase = generateRecoveryPhrase();
const wrongPhrase = generateRecoveryPhrase();
assert.ok(phrase !== wrongPhrase);

const server = makeServer();
const post = (action, body) => server.post(action, { userId: USER, ...body });

// ------------------------------------------------------------- constants ---
await check("exports the fixed contract constants", () => {
  assert.equal(ZK_DOMAIN, "cerebrum-zkdata-v1");
  assert.deepEqual(ZK_KINDS, ["paper", "investigation", "collection-meta", "annotation"]);
  assert.equal(PAD_BUCKET, 512);
  assert.equal(ZK_MAX_CIPHERTEXT, 1_400_000);
  assert.deepEqual(ZK_KDF_PARAMS, { m: 65536, t: 3, p: 1 });
});

await check("normalizeZkPhrase matches recovery.js normalization", () => {
  assert.equal(normalizeZkPhrase("  Abandon  ABILITY\nable  "), "abandon ability able");
});

// ------------------------------------------------------- vault wrap/unwrap ---
const dek = generateDEK();
const dekId = makeDekId();
const envelope = await wrapVaultBundle(phrase, dek, dekId);

await check("vault envelope has the fixed shape", () => {
  assert.equal(envelope.v, 1);
  assert.equal(envelope.kdf, "argon2id");
  assert.deepEqual(envelope.kdfParams, { m: 65536, t: 3, p: 1 });
  assert.equal(envelope.dek_id, dekId);
  for (const f of ["salt", "nonce", "data"]) assert.equal(typeof envelope[f], "string");
  assert.equal(Buffer.from(envelope.salt, "base64").length, 16);
  assert.equal(Buffer.from(envelope.nonce, "base64").length, 12);
});

await check("DEK round-trips through the opaque vault envelope", async () => {
  const { dek: back, dekId: backId } = await unwrapVaultBundle(phrase, envelope);
  assert.ok(Buffer.from(back).equals(Buffer.from(dek)), "DEK bytes identical");
  assert.equal(backId, dekId);
  back.fill(0);
});

await check("wrong (valid) phrase -> WRONG_PHRASE_ZK", async () => {
  await assert.rejects(unwrapVaultBundle(wrongPhrase, envelope), (err) => {
    assert.equal(err.code, "WRONG_PHRASE");
    assert.equal(err.message, WRONG_PHRASE_ZK);
    return true;
  });
});

await check("garbage phrase -> WRONG_PHRASE_ZK without deriving", async () => {
  await assert.rejects(unwrapVaultBundle("not a real phrase", envelope), (err) => {
    assert.equal(err.code, "WRONG_PHRASE");
    return true;
  });
});

await check("KEK is domain-separated: same phrase+salt without associatedData cannot unwrap", async () => {
  // Derive the KEK the way the messaging backup KDF would (no associatedData).
  const salt = Buffer.from(envelope.salt, "base64");
  const kekNoDomain = await argon2id({
    password: normalizeZkPhrase(phrase),
    salt: new Uint8Array(salt),
    parallelism: ZK_KDF_PARAMS.p,
    iterations: ZK_KDF_PARAMS.t,
    memorySize: ZK_KDF_PARAMS.m,
    hashLength: 32,
    outputType: "binary",
  });
  const key = await subtle.importKey("raw", kekNoDomain, "AES-GCM", false, ["decrypt"]);
  kekNoDomain.fill(0);
  const raw = Buffer.from(envelope.data, "base64");
  await assert.rejects(
    subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Buffer.from(envelope.nonce, "base64"),
        additionalData: new TextEncoder().encode(`${ZK_DOMAIN}/wrap/${dekId}`),
      },
      key,
      raw
    ),
    /./,
    "no-domain KEK must fail authentication"
  );
});

await check("unsupported envelope version rejected", async () => {
  await assert.rejects(unwrapVaultBundle(phrase, { ...envelope, v: 2 }), /unsupported/);
});

// ------------------------------------------------------------------ items ---
const payloads = {
  paper: {
    title: "Quantum coherence in photosynthetic complexes at room temperature",
    authors: ["Engel", "Calhoun", "Read"],
    journal: "Nature",
    year: 2007,
    abstract: "Evidence for wavelike energy transfer through quantum coherence...",
    notes: "Read before the grant proposal. Key figure 3.",
    rating: 5,
  },
  investigation: {
    question: "Why does soil crack into patterns as it dries?",
    answer: "Differential shrinkage creates tensile stress relieved by polygonal cracks...",
    sources: 12,
  },
  "collection-meta": { name: "Lignin degradation pathways" },
  annotation: { text: "Figure 3 contradicts the 2019 review", page: 4 },
};

const dek2 = generateDEK();
const itemDekId = makeDekId();

for (const kind of ZK_KINDS) {
  await check(`item round-trip: kind "${kind}"`, async () => {
    const itemId = makeItemId("zk");
    const env = await encryptItem(dek2, {
      userId: USER,
      itemId,
      dekId: itemDekId,
      kind,
      payload: payloads[kind],
      rev: 3,
    });
    assert.equal(env.id, itemId);
    assert.equal(env.kind, kind);
    assert.equal(env.dek_id, itemDekId);
    assert.equal(env.rev, 3);
    assert.ok(typeof env.nonce === "string" && typeof env.data === "string");
    assert.ok(typeof env.updated_at === "number");
    const row = { dek_id: env.dek_id, kind: env.kind, nonce: env.nonce, data: env.data };
    const back = await decryptItem(dek2, { userId: USER, itemId, row });
    assert.deepEqual(back, payloads[kind]);
  });
}

await check("unknown kind rejected at encrypt time", async () => {
  await assert.rejects(
    encryptItem(dek2, { userId: USER, itemId: "x", dekId: itemDekId, kind: "nope", payload: {} }),
    /unknown kind/
  );
});

const victimId = makeItemId("zk");
const victimEnv = await encryptItem(dek2, {
  userId: USER,
  itemId: victimId,
  dekId: itemDekId,
  kind: "paper",
  payload: payloads.paper,
});
const victimRow = () => ({
  dek_id: victimEnv.dek_id,
  kind: victimEnv.kind,
  nonce: victimEnv.nonce,
  data: victimEnv.data,
});

await check("tamper: bit-flipped ciphertext rejected", async () => {
  const row = victimRow();
  row.data = b64flip(row.data);
  await assert.rejects(decryptItem(dek2, { userId: USER, itemId: victimId, row }), /authentication failed/);
});

await check("tamper: ciphertext moved to another item id rejected (AAD bind)", async () => {
  await assert.rejects(
    decryptItem(dek2, { userId: USER, itemId: victimId + "x", row: victimRow() }),
    /authentication failed/
  );
});

await check("tamper: ciphertext moved to another user rejected (AAD bind)", async () => {
  await assert.rejects(
    decryptItem(dek2, { userId: "user_evil", itemId: victimId, row: victimRow() }),
    /authentication failed/
  );
});

await check("tamper: cross-kind transplant rejected", async () => {
  const row = victimRow();
  row.kind = "annotation"; // AAD now binds "annotation", envelope still says "paper"
  await assert.rejects(decryptItem(dek2, { userId: USER, itemId: victimId, row }), /./);
});

await check("tamper: wrong dek_id rejected", async () => {
  const row = victimRow();
  row.dek_id = makeDekId();
  await assert.rejects(decryptItem(dek2, { userId: USER, itemId: victimId, row }), /./);
});

await check("tamper: truncated envelope rejected", async () => {
  const row = victimRow();
  row.data = row.data.slice(0, -8);
  await assert.rejects(decryptItem(dek2, { userId: USER, itemId: victimId, row }), /./);
});

await check("tamper: wrong DEK rejected", async () => {
  await assert.rejects(
    decryptItem(generateDEK(), { userId: USER, itemId: victimId, row: victimRow() }),
    /authentication failed/
  );
});

await check("buildItemAAD uses the prototype construction", () => {
  assert.equal(buildItemAAD("u", "i", "d", "paper"), "u|i|d|paper");
});

// ----------------------------------------------------------------- padding ---
await check("padding: 1 byte -> 512, 513 bytes -> 1024", () => {
  assert.equal(padToBucket(new Uint8Array([1])).length, 512);
  assert.equal(padToBucket(new Uint8Array(513)).length, 1024);
  assert.equal(padToBucket(new Uint8Array(512)).length, 1024); // exact bucket still unambiguous
  assert.equal(padToBucket(new Uint8Array(0)).length, 512);
});

await check("padding round-trip returns the exact original bytes", () => {
  for (const n of [1, 511, 512, 513, 1024, 2000]) {
    const orig = Buffer.from(Array.from({ length: n }, (_, i) => i % 251));
    const back = unpadPadded(padToBucket(orig));
    assert.ok(Buffer.from(back).equals(orig), `n=${n}`);
  }
});

await check("corrupt padding rejected", () => {
  const bad = padToBucket(new Uint8Array([9]));
  bad[bad.length - 2] = 0x00;
  bad[bad.length - 1] = 0x01; // pad length 1 is impossible (minimum 2)
  assert.throws(() => unpadPadded(bad), /bad padding/);
  assert.throws(() => unpadPadded(new Uint8Array([1, 2, 3])), /bad padded length/);
});

// -------------------------------------------------------------------- ids ---
await check("makeDekId / makeItemId shapes and uniqueness", () => {
  assert.match(makeDekId(), /^dek_[0-9a-f]{12}$/);
  assert.match(makeItemId(), /^zk_[0-9a-f]{24}$/);
  assert.match(makeItemId("src"), /^src_[0-9a-f]{24}$/);
  const ids = new Set(Array.from({ length: 200 }, () => makeItemId()));
  assert.equal(ids.size, 200);
});

// ------------------------------------------------------------ stale dek ---
await check("server rejects writes under a rotated-out dek_id (fail-closed)", async () => {
  const s = makeServer();
  const p = (a, b) => s.post(a, b);
  await p("zk-put-vault", { dek_id: "dek_one", wrapped_dek: "{}" });
  const row = await encryptItem(dek2, { userId: USER, itemId: "x", dekId: "dek_one", kind: "paper", payload: {} });
  assert.equal((await p("zk-put-items", { items: [row] })).stored, 1);
  await p("zk-put-vault", { dek_id: "dek_two", wrapped_dek: "{}" }); // rotation
  const stale = await encryptItem(dek2, { userId: USER, itemId: "y", dekId: "dek_one", kind: "paper", payload: {} });
  await assert.rejects(p("zk-put-items", { items: [stale] }), (err) => err.code === "stale_dek");
});

// ------------------------------------------------------- server blindness ---
await check("server store contains zero plaintext content", async () => {
  const dump = server._dump();
  const secrets = [
    payloads.paper.title,
    "Engel",
    payloads.paper.abstract.slice(0, 20),
    payloads.investigation.question,
    payloads["collection-meta"].name,
    phrase.split(" ")[0],
  ];
  const leaks = secrets.filter((s) => dump.includes(s));
  assert.equal(leaks.length, 0, `leaked: ${leaks.join(",")}`);
});

// --------------------------------------------------------------- session ---
const session = new ZkSession({ userId: USER, post, getPhrase: async () => phrase });

await check("session: no vault yet -> exists=false, unlock -> no-vault", async () => {
  assert.deepEqual(await session.getVaultState(), { exists: false, dekId: null });
  assert.deepEqual(await session.unlock(), { status: "no-vault" });
});

await check("session: unlock with no phrase provider -> NO_PHRASE", async () => {
  const s2 = new ZkSession({ userId: USER, post, getPhrase: async () => null });
  await assert.rejects(s2.unlock(), (err) => err.code === "NO_PHRASE");
});

await check("session: enable rejects an invalid phrase", async () => {
  await assert.rejects(session.enable("too short"), /valid 24-word/);
});

let liveDekId;
await check("session: enable wraps and publishes the vault", async () => {
  const { dekId: id } = await session.enable(phrase);
  liveDekId = id;
  assert.match(id, /^dek_[0-9a-f]{12}$/);
  assert.ok(session.isUnlocked());
  assert.deepEqual(await session.getVaultState(), { exists: true, dekId: id });
});

await check("session: new device unlocks from the server vault row", async () => {
  const s2 = new ZkSession({ userId: USER, post, getPhrase: async () => phrase });
  const res = await s2.unlock();
  assert.equal(res.status, "ok");
  assert.equal(res.dekId, liveDekId);
  assert.ok(s2.isUnlocked());
});

await check("session: new device with wrong phrase -> WRONG_PHRASE_ZK", async () => {
  const s2 = new ZkSession({ userId: USER, post, getPhrase: async () => wrongPhrase });
  await assert.rejects(s2.unlock(), (err) => err.code === "WRONG_PHRASE");
});

const seedRows = ZK_KINDS.map((kind, i) => ({
  id: makeItemId("zk"),
  kind,
  collectionId: i < 2 ? "col_alpha" : null,
  payload: payloads[kind],
  rev: 0,
}));

await check("session: pushItems encrypts and stores all four kinds", async () => {
  const stored = await session.pushItems(seedRows);
  assert.equal(stored, 4);
});

await check("session: pullItems decrypts rows with metadata", async () => {
  const { items, quarantined } = await session.pullItems();
  assert.equal(quarantined.length, 0);
  assert.equal(items.length, 4);
  const paper = items.find((i) => i.kind === "paper");
  assert.equal(paper.payload.title, payloads.paper.title);
  assert.equal(paper.collectionId, "col_alpha");
  assert.equal(paper.dekId, liveDekId);
  assert.equal(typeof paper.updatedAt, "number");
});

await check("session: tampered row is quarantined, batch survives", async () => {
  server._tamperItem(seedRows[0].id);
  const { items, quarantined } = await session.pullItems();
  assert.deepEqual(quarantined, [seedRows[0].id]);
  assert.equal(items.length, 3);
});

await check("session: local index answers queries without the network", async () => {
  const hits = session.queryLocalIndex("quantum coherence");
  assert.ok(hits.includes(seedRows[0].id), `hits=${hits}`);
  const inv = session.queryLocalIndex("polygonal cracks");
  assert.ok(inv.includes(seedRows[1].id), `hits=${inv}`);
  assert.deepEqual(session.queryLocalIndex("zzz-no-such-term"), []);
  assert.deepEqual(session.queryLocalIndex(""), []);
});

await check("session: deleteItem removes row and index entry", async () => {
  // seedRows[3] was already deleted; deleting the quarantined row's id is a no-op server-side
  await session.deleteItem(seedRows[0].id);
  const { items, quarantined } = await session.pullItems();
  assert.ok(!items.some((i) => i.id === seedRows[0].id));
  assert.deepEqual(quarantined, []);
  assert.deepEqual(session.queryLocalIndex("quantum"), []);
});

let rotatedDekId;
await check("session: rotate re-encrypts everything under a new DEK", async () => {
  const res = await session.rotate(phrase);
  rotatedDekId = res.dekId;
  assert.notEqual(rotatedDekId, liveDekId);
  assert.equal(res.reencrypted, 3); // seedRows[1..3]; seedRows[0] was deleted
  assert.deepEqual(res.skipped, []);
  assert.ok(session.isUnlocked());
  const { items, quarantined } = await session.pullItems();
  assert.equal(quarantined.length, 0);
  assert.equal(items.length, 3);
  assert.ok(items.every((i) => i.dekId === rotatedDekId));
  const inv = items.find((i) => i.kind === "investigation");
  assert.equal(inv.payload.question, payloads.investigation.question);
  assert.ok(session.queryLocalIndex("polygonal").includes(seedRows[1].id));
});

await check("session: rotate skips rows that no longer authenticate", async () => {
  server._tamperItem(seedRows[1].id);
  const q1 = await session.pullItems(); // quarantines the tampered server row
  assert.deepEqual(q1.quarantined, [seedRows[1].id]);
  // Corrupt the cached copy of another row (cache-only: the server copy stays
  // pristine, exactly like a bit-rotted local snapshot would).
  const cached = session._rows.get(seedRows[2].id);
  cached.data = b64flip(cached.data);
  const res = await session.rotate(phrase);
  assert.equal(res.reencrypted, 2); // seedRows[1] + seedRows[3]
  assert.deepEqual(res.skipped, [seedRows[2].id]);
  const { items, quarantined } = await session.pullItems();
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.dekId === res.dekId));
  // seedRows[2]'s server row still carries the old dek_id -> quarantined, fail-closed
  assert.deepEqual(quarantined, [seedRows[2].id]);
});

await check("session: pushItems under a stale dek -> STALE_DEK", async () => {
  // Someone else rotated the vault out from under this session.
  await server.post("zk-put-vault", { dek_id: "dek_elsewhere", wrapped_dek: "{}" });
  await assert.rejects(
    session.pushItems([{ id: makeItemId("zk"), kind: "paper", payload: { title: "x" } }]),
    (err) => {
      assert.equal(err.code, "STALE_DEK");
      assert.match(err.message, /re-enable the vault/);
      return true;
    }
  );
});

await check("session: purgeLegacy returns deleted counts", async () => {
  const deleted = await session.purgeLegacy();
  assert.deepEqual(deleted, { user_saved_sources: 3, user_history: 2 });
});

await check("session: dropAll clears server state and locks", async () => {
  await session.dropAll();
  assert.ok(!session.isUnlocked());
  assert.deepEqual(await session.getVaultState(), { exists: false, dekId: null });
  const dump = JSON.parse(server._dump());
  assert.equal(dump.vault.length, 0);
  assert.equal(dump.items.length, 0);
});

await check("session: lock() zeroes the DEK and clears state", async () => {
  const s3 = new ZkSession({ userId: USER, post, getPhrase: async () => phrase });
  await s3.enable(phrase);
  assert.ok(s3.isUnlocked());
  s3.lock();
  assert.ok(!s3.isUnlocked());
  await assert.rejects(s3.pullItems(), (err) => err.code === "NOT_UNLOCKED");
  await s3.dropAll(); // tidy up
});

await check("session: index persistence degrades gracefully without IndexedDB", async () => {
  // Node has no IndexedDB — persist must no-op, queries still work in memory.
  const s4 = new ZkSession({ userId: USER, post, getPhrase: async () => phrase });
  await s4.enable(phrase);
  s4.buildLocalIndex([{ id: "a", kind: "paper", collectionId: null, payload: { title: "Memory only index" } }]);
  assert.deepEqual(s4.queryLocalIndex("memory"), ["a"]);
  await s4.dropAll();
});

// ------------------------------------------------------------------ report ---
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`\n${f.name}\n  ${f.err.stack}`);
  process.exit(1);
}
