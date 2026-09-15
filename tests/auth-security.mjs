/**
 * Auth & interaction-endpoint security tests.
 *
 * Covers the behaviours where being wrong is expensive: OTP expiry and
 * single-use, session token validation edge cases, the config endpoint's
 * no-secrets contract, and input validation on the account/interaction
 * endpoints. Unit tests against the real modules — no server, no database,
 * no network.
 *
 * Run with: node tests/auth-security.mjs
 */

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

function group(name) {
  console.log(`\n${name}`);
}

// ══════════════════════════════════════════════════════════════════════════
group("OTP — expiry, single-use, and attempt burn");

const { decideOtpAttempt, runOtpAttempt } = await import(
  join(root, "functions/api/auth.js")
);
const { hashOtp, sha256Hex, signJWT, verifyJWT } = await import(
  join(root, "functions/lib/authHelpers.js")
);

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// In-memory stand-in for the D1 otp_codes row, implementing the exact
// `store` contract runOtpAttempt expects.
function makeOtpStore() {
  const rows = new Map();
  return {
    rows,
    put(email, row) { rows.set(email, { attempts: 0, ...row }); },
    async getOtpRow(email) { return rows.get(email) || null; },
    async consumeOtpRow(email) { rows.delete(email); },
    async bumpOtpAttempts(email) {
      const r = rows.get(email);
      if (r) r.attempts += 1;
    },
  };
}

const EMAIL = "user@example.com";
const CODE = "123456";
const FLOW = "flow-token-abc";

async function pendingRow(overrides = {}) {
  return {
    email_lower: EMAIL,
    code_hash: await hashOtp({}, EMAIL, CODE), // env={} -> unkeyed fallback, same as a secretless deploy
    flow_hash: sha256(FLOW),
    attempts: 0,
    created_at: Date.now() - 1000,
    expires_at: Date.now() + 15 * 60 * 1000,
    ...overrides,
  };
}

async function attemptArgs(overrides = {}) {
  return {
    codeHash: await hashOtp({}, EMAIL, CODE),
    flowHash: sha256(FLOW),
    ...overrides,
  };
}

await test("decideOtpAttempt: correct code and cookie is valid", async () => {
  const row = await pendingRow();
  assert.equal(decideOtpAttempt(row, await attemptArgs()), "valid");
});

await test("decideOtpAttempt: no pending row", async () => {
  assert.equal(decideOtpAttempt(null, await attemptArgs()), "no_row");
});

await test("decideOtpAttempt: expired row is rejected", async () => {
  const row = await pendingRow({ expires_at: Date.now() - 1 });
  assert.equal(decideOtpAttempt(row, await attemptArgs()), "expired");
});

await test("decideOtpAttempt: a row expiring exactly now is expired", async () => {
  const now = Date.now();
  const row = await pendingRow({ expires_at: now });
  assert.equal(decideOtpAttempt(row, { ...(await attemptArgs()), now }), "expired");
});

await test("decideOtpAttempt: five wrong guesses burns the code", async () => {
  const row = await pendingRow({ attempts: 5 });
  assert.equal(decideOtpAttempt(row, await attemptArgs()), "exhausted");
});

await test("decideOtpAttempt: missing pending-auth cookie", async () => {
  const row = await pendingRow();
  assert.equal(decideOtpAttempt(row, { ...(await attemptArgs()), flowHash: null }), "no_cookie");
});

await test("decideOtpAttempt: wrong pending-auth cookie", async () => {
  const row = await pendingRow();
  assert.equal(
    decideOtpAttempt(row, { ...(await attemptArgs()), flowHash: sha256("someone-elses-cookie") }),
    "bad_flow"
  );
});

await test("decideOtpAttempt: wrong code", async () => {
  const row = await pendingRow();
  const wrongCodeHash = await hashOtp({}, EMAIL, "999999");
  assert.equal(decideOtpAttempt(row, { ...(await attemptArgs()), codeHash: wrongCodeHash }), "bad_code");
});

await test("decideOtpAttempt: comparison is not a prefix/inequality shortcut", async () => {
  const row = await pendingRow();
  // Same length, differs only in the last character — a non-constant-time
  // `startsWith`-style check or a loose comparison must still fail here.
  const tampered = (await attemptArgs()).codeHash.slice(0, -1) + "0";
  assert.equal(decideOtpAttempt(row, { ...(await attemptArgs()), codeHash: tampered }), "bad_code");
});

await test("runOtpAttempt: a correct code is consumed — it can never be replayed", async () => {
  const store = makeOtpStore();
  store.put(EMAIL, await pendingRow());
  assert.equal(await runOtpAttempt(store, EMAIL, await attemptArgs()), "valid");
  // Same correct code, same cookie, second attempt: the row is gone.
  assert.equal(await runOtpAttempt(store, EMAIL, await attemptArgs()), "no_row");
});

await test("runOtpAttempt: five wrong guesses burn the code, the sixth finds nothing", async () => {
  const store = makeOtpStore();
  store.put(EMAIL, await pendingRow());
  const wrong = await hashOtp({}, EMAIL, "999999");
  for (let i = 0; i < 5; i++) {
    assert.equal(
      await runOtpAttempt(store, EMAIL, { ...(await attemptArgs()), codeHash: wrong }),
      "bad_code",
      `wrong guess ${i + 1} should be bad_code`
    );
  }
  assert.equal(store.rows.get(EMAIL).attempts, 5, "attempt counter did not reach 5");
  assert.equal(
    await runOtpAttempt(store, EMAIL, { ...(await attemptArgs()), codeHash: wrong }),
    "exhausted",
    "the attempt after five wrong guesses should burn the code"
  );
  assert.ok(!store.rows.has(EMAIL), "burned row was not deleted");
});

await test("runOtpAttempt: four wrong guesses still leave a working code", async () => {
  const store = makeOtpStore();
  store.put(EMAIL, await pendingRow());
  const wrong = await hashOtp({}, EMAIL, "999999");
  for (let i = 0; i < 4; i++) {
    await runOtpAttempt(store, EMAIL, { ...(await attemptArgs()), codeHash: wrong });
  }
  assert.equal(await runOtpAttempt(store, EMAIL, await attemptArgs()), "valid");
});

await test("runOtpAttempt: an expired code is rejected and swept", async () => {
  const store = makeOtpStore();
  store.put(EMAIL, await pendingRow({ expires_at: Date.now() - 60_000 }));
  assert.equal(await runOtpAttempt(store, EMAIL, await attemptArgs()), "expired");
  assert.ok(!store.rows.has(EMAIL), "expired row was not swept");
});

await test("runOtpAttempt: a failed cookie check leaves the pending code untouched", async () => {
  const store = makeOtpStore();
  store.put(EMAIL, await pendingRow());
  assert.equal(
    await runOtpAttempt(store, EMAIL, { ...(await attemptArgs()), flowHash: sha256("wrong-cookie") }),
    "bad_flow"
  );
  const row = store.rows.get(EMAIL);
  assert.ok(row, "a bad_flow attempt must not delete the pending code");
  assert.equal(row.attempts, 0, "a bad_flow attempt must not burn a guess");
});

// ══════════════════════════════════════════════════════════════════════════
group("Session tokens — validation edge cases");

// Craft tokens by hand (HMAC-SHA256, like signJWT) to hit the cases the
// honest signer never produces.
const b64url = (input) => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function craftToken(secret, header, payload) {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

const SECRET = "test-jwt-secret";
const goodPayload = () => {
  const now = Math.floor(Date.now() / 1000);
  return { sub: "u_1", email: "user@example.com", epoch: 0, iat: now, exp: now + 3600 };
};

await test("verifyJWT: an honestly signed token verifies", async () => {
  const env = { JWT_SECRET: SECRET };
  const token = await signJWT({ sub: "u_1", email: "user@example.com", epoch: 0 }, env);
  const payload = await verifyJWT(token, env);
  assert.ok(payload, "valid token rejected");
  assert.equal(payload.sub, "u_1");
});

await test("verifyJWT: a tampered payload is rejected", async () => {
  const env = { JWT_SECRET: SECRET };
  const token = await signJWT({ sub: "u_1", email: "user@example.com", epoch: 0 }, env);
  const [h, p, s] = token.split(".");
  const tampered = `${h}.${p.slice(0, -2)}xx.${s}`;
  assert.equal(await verifyJWT(tampered, env), null, "tampered token accepted");
});

await test("verifyJWT: alg=none is rejected even with a plausible payload", async () => {
  const token = await craftToken(SECRET, { alg: "none", typ: "JWT" }, goodPayload());
  assert.equal(await verifyJWT(token, { JWT_SECRET: SECRET }), null, "alg=none accepted");
});

await test("verifyJWT: a token with no exp is rejected", async () => {
  const { exp, ...noExp } = goodPayload();
  const token = await craftToken(SECRET, { alg: "HS256", typ: "JWT" }, noExp);
  assert.equal(await verifyJWT(token, { JWT_SECRET: SECRET }), null, "expiry-less token accepted");
});

await test("verifyJWT: an expired token is rejected", async () => {
  const past = { ...goodPayload(), exp: Math.floor(Date.now() / 1000) - 60 };
  const token = await craftToken(SECRET, { alg: "HS256", typ: "JWT" }, past);
  assert.equal(await verifyJWT(token, { JWT_SECRET: SECRET }), null, "expired token accepted");
});

await test("verifyJWT: a token dated in the future is rejected", async () => {
  const future = { ...goodPayload(), iat: Math.floor(Date.now() / 1000) + 600 };
  const token = await craftToken(SECRET, { alg: "HS256", typ: "JWT" }, future);
  assert.equal(await verifyJWT(token, { JWT_SECRET: SECRET }), null, "future-dated token accepted");
});

await test("verifyJWT: a token signed under a different secret is rejected", async () => {
  const token = await craftToken("attacker-secret", { alg: "HS256", typ: "JWT" }, goodPayload());
  assert.equal(await verifyJWT(token, { JWT_SECRET: SECRET }), null, "wrong-secret token accepted");
});

await test("verifyJWT: garbage and truncated tokens are rejected", async () => {
  const env = { JWT_SECRET: SECRET };
  for (const bad of ["", "abc", "a.b", "a.b.c.d", "...."]) {
    assert.equal(await verifyJWT(bad, env), null, `garbage token accepted: ${JSON.stringify(bad)}`);
  }
});

await test("signJWT/verifyJWT: no JWT_SECRET means no sessions, not unsigned sessions", async () => {
  await assert.rejects(() => signJWT({ sub: "u_1" }, {}), "signJWT minted a token without a secret");
  const token = await craftToken("whatever", { alg: "HS256", typ: "JWT" }, goodPayload());
  assert.equal(await verifyJWT(token, {}), null, "a token verified without a secret");
});

// ══════════════════════════════════════════════════════════════════════════
group("Config endpoint — the no-secrets contract");

const { buildConfigReport } = await import(join(root, "functions/api/config.js"));

await test("buildConfigReport: no secret VALUE ever appears in the output", () => {
  const secrets = {
    RESEND_API_KEY: "sk-live-re-abc123xyz",
    JWT_SECRET: "jwt-secret-value-999",
    TURN_KEY_API_TOKEN: "turn-token-very-secret",
    OTP_PEPPER: "pepper-secret-42",
    IP_HASH_SECRET: "ip-hash-secret-7",
  };
  const report = buildConfigReport({ ...secrets });
  const serialised = JSON.stringify(report);
  for (const [name, value] of Object.entries(secrets)) {
    assert.ok(!serialised.includes(value), `the value of ${name} leaked into the report`);
  }
});

await test("buildConfigReport: presence and trimmedDiffers are reported honestly", () => {
  const report = buildConfigReport({
    RESEND_API_KEY: "real-key",
    RESEND_FROM: "  padded@example.com  ",
  });
  const byName = Object.fromEntries(report.vars.map((v) => [v.name, v]));
  assert.equal(byName.RESEND_API_KEY.present, true);
  assert.equal(byName.RESEND_API_KEY.trimmedDiffers, false);
  assert.equal(byName.RESEND_FROM.present, true);
  assert.equal(byName.RESEND_FROM.trimmedDiffers, true, "padded value not flagged");
  assert.equal(byName.GROQ_KEY.present, false, "unset variable reported present");
  assert.equal(byName.GROQ_KEY.trimmedDiffers, false);
});

await test("buildConfigReport: output carries no values, only names and booleans", () => {
  const report = buildConfigReport({ RESEND_API_KEY: "sk-live-re-abc123xyz", JWT_SECRET: "jwt-secret-value-999" });
  for (const v of report.vars) {
    for (const key of ["group", "name", "does", "breaks"]) {
      assert.equal(typeof v[key], "string", `${v.name}.${key} is not a string`);
    }
    assert.equal(typeof v.present, "boolean");
    assert.equal(typeof v.trimmedDiffers, "boolean");
    assert.ok(!("value" in v) && !("secret" in v) && !("length" in v), `${v.name} carries a value-like field`);
  }
});

await test("buildConfigReport: binding presence is reported, bindings are not", () => {
  const report = buildConfigReport({
    DB: { prepare() {} },
    AI: { run() {} },
  });
  assert.equal(report.bindings.DB, true);
  assert.equal(report.bindings.AI, true);
  assert.equal(report.bindings.RATE_LIMIT_D1, true, "D1-backed shared limiter was reported absent");
  assert.equal(typeof report.checkedAt, "number");
});

// ══════════════════════════════════════════════════════════════════════════
group("Input validation — vote, call signaling, reports");

const { validateVote, voteDelta } = await import(join(root, "functions/api/vote.js"));
const { validateSignalGet, validateSignalPost } = await import(
  join(root, "functions/api/callsignal.js")
);
const { validateReport, reportDedupeHash } = await import(join(root, "functions/api/report.js"));

await test("validateVote: accepts a well-formed vote", () => {
  assert.deepEqual(validateVote({ answerId: "a1", vote: "up" }), { ok: true, answerId: "a1", vote: "up" });
});

await test("validateVote: rejects missing answerId, bad vote, and oversized ids", () => {
  assert.equal(validateVote(null).ok, false, "null body accepted");
  assert.equal(validateVote({}).ok, false, "empty body accepted");
  assert.equal(validateVote({ answerId: "a1" }).ok, false, "missing vote accepted");
  assert.equal(validateVote({ answerId: "a1", vote: "sideways" }).ok, false, "bad vote value accepted");
  assert.equal(validateVote({ answerId: "x".repeat(101), vote: "up" }).ok, false, "oversized answerId accepted");
  assert.equal(validateVote({ answerId: 42, vote: "up" }).ok, false, "non-string answerId accepted");
});

await test("voteDelta: first vote, repeat, and flip", () => {
  assert.equal(voteDelta(null, "up"), 1, "first upvote should be +1");
  assert.equal(voteDelta(null, "down"), -1, "first downvote should be -1");
  assert.equal(voteDelta("up", "up"), 0, "repeat upvote should be idempotent");
  assert.equal(voteDelta("down", "down"), 0, "repeat downvote should be idempotent");
  assert.equal(voteDelta("up", "down"), -2, "flip to down should be -2");
  assert.equal(voteDelta("down", "up"), 2, "flip to up should be +2");
});

await test("validateSignalGet: accepts well-formed poll params", () => {
  const r = validateSignalGet(new URLSearchParams("threadId=t1&clientId=c1&since=12"));
  assert.deepEqual(r, { ok: true, threadId: "t1", clientId: "c1", since: 12 });
});

await test("validateSignalGet: rejects missing ids and overlong thread ids", () => {
  assert.equal(validateSignalGet(new URLSearchParams("threadId=t1")).ok, false, "missing clientId accepted");
  assert.equal(validateSignalGet(new URLSearchParams("clientId=c1")).ok, false, "missing threadId accepted");
  assert.equal(
    validateSignalGet(new URLSearchParams(`threadId=${"t".repeat(129)}&clientId=c1`)).ok,
    false,
    "overlong threadId accepted"
  );
  const negative = validateSignalGet(new URLSearchParams("threadId=t1&clientId=c1&since=-50"));
  assert.equal(negative.since, 0, "negative cursor not clamped");
});

await test("validateSignalPost: accepts a well-formed signal", () => {
  const r = validateSignalPost({ threadId: "t1", clientId: "c1", type: "offer", payload: { sdp: "v=0" } });
  assert.equal(r.ok, true);
  assert.equal(r.type, "offer");
  assert.ok(r.payloadStr.includes("v=0"));
});

await test("validateSignalPost: rejects unknown types, missing ids, and oversized payloads", () => {
  assert.equal(validateSignalPost({ threadId: "t1", clientId: "c1", type: "exec" }).ok, false, "unknown type accepted");
  assert.equal(validateSignalPost({ threadId: "", clientId: "c1", type: "ice" }).ok, false, "empty threadId accepted");
  assert.equal(validateSignalPost(null).ok, false, "null body accepted");
  const big = validateSignalPost({ threadId: "t1", clientId: "c1", type: "offer", payload: { sdp: "x".repeat(9000) } });
  assert.equal(big.ok, false, "oversized payload accepted");
  assert.equal(big.code, "payload_too_large");
  assert.equal(
    validateSignalPost({ threadId: "t".repeat(129), clientId: "c1", type: "ice" }).ok,
    false,
    "overlong threadId accepted"
  );
});

await test("validateReport: requires a description, sanitises the rest", () => {
  assert.equal(validateReport({}).ok, false, "empty body accepted");
  assert.equal(validateReport({ description: "   " }).ok, false, "blank description accepted");
  const r = validateReport({
    query: "what is TP53",
    description: "The citation does not exist.",
    category: "hallucination",
    sourceUrl: "javascript:alert(1)",
  });
  assert.equal(r.ok, true);
  assert.equal(r.sourceUrl, "", "unsafe URL was not stripped");
});

await test("reportDedupeHash: stable per user+text, blind to the text itself", async () => {
  const env = {};
  const fields = { query: "what is TP53", description: "the cited paper does not exist", category: "hallucination" };
  const h1 = await reportDedupeHash(env, "u1", fields);
  const h2 = await reportDedupeHash(env, "u1", fields);
  const h3 = await reportDedupeHash(env, "u2", fields);
  assert.equal(h1, h2, "same report hashed differently");
  assert.notEqual(h1, h3, "different users share a dedupe key");
  assert.ok(!h1.includes("TP53"), "report text leaked into the dedupe key");
  assert.ok(!h1.includes("hallucination"), "report text leaked into the dedupe key");
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
