// Push notification regression tests (2026-10-08)
// Tests the Web Push last mile: validation, payload building, dispatch
// no-ops, and the dead-subscription contract. Pure functions and fakes —
// no network, no real push service.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validatePushSubscription,
  buildMessagePushPayload,
  sendPushMessage,
} from "../functions/lib/webpush.js";
import {
  getPushDisplayName,
  sendPushToUsers,
  buildCallPushPayload,
  buildNewMessagePushPayload,
} from "../functions/lib/pushNotify.js";

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log("  ✓ " + name); },
    (e) => { failed++; console.log("  ✗ " + name + ": " + (e && e.message)); }
  );
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

console.log("push-notifications:");

const VALID_SUB = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: {
    // 65-byte uncompressed P-256 point (starts 0x04), 16-byte auth
    p256dh: "BNkVJMCVa6LUAYd7O5lMdgZcfyLQir-roz4E_vAyJ0dYgKEOFD4K-bIguz9dm65DNFJ618EPnO5T7itboMs56PY",
    auth: "T7zruWYyOwFvESzYbt_dwgfUzcKZuGbXZPUqqPdKfP0".slice(0, 22) + "==", // placeholder, fixed below
  },
};
// Build a genuinely valid auth (16 bytes base64url)
{
  const raw = Buffer.alloc(16, 7);
  VALID_SUB.keys.auth = raw.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

await test("validatePushSubscription accepts a well-formed subscription", () => {
  const out = validatePushSubscription(VALID_SUB);
  assert(out.endpoint === VALID_SUB.endpoint, "endpoint preserved");
  assert(out.p256dh === VALID_SUB.keys.p256dh, "p256dh preserved");
  assert(out.auth === VALID_SUB.keys.auth, "auth preserved");
});

await test("validatePushSubscription rejects http endpoints", () => {
  let threw = false;
  try {
    validatePushSubscription({ endpoint: "http://evil.example/push", keys: VALID_SUB.keys });
  } catch (e) { threw = /https/.test(e.message); }
  assert(threw, "http endpoint rejected");
});

await test("validatePushSubscription rejects malformed p256dh", () => {
  let threw = false;
  try {
    validatePushSubscription({ endpoint: VALID_SUB.endpoint, keys: { p256dh: "aGVsbG8=", auth: VALID_SUB.keys.auth } });
  } catch (e) { threw = true; }
  assert(threw, "bad p256dh rejected");
});

await test("validatePushSubscription rejects malformed auth", () => {
  let threw = false;
  try {
    validatePushSubscription({ endpoint: VALID_SUB.endpoint, keys: { p256dh: VALID_SUB.keys.p256dh, auth: "aGVsbG8=" } });
  } catch (e) { threw = true; }
  assert(threw, "bad auth rejected");
});

await test("buildMessagePushPayload never leaks content for encrypted threads", () => {
  const bytes = buildMessagePushPayload({ threadId: "t1", title: "Alice", body: "secret plans", encrypted: true });
  const payload = JSON.parse(Buffer.from(bytes).toString());
  assert(payload.body === "New message", "encrypted body is generic, got: " + payload.body);
  assert(payload.threadId === "t1", "thread id preserved");
  assert(payload.title === "Alice", "sender name preserved");
  // The click through URL is a contract, not a courtesy: the app
  // consumes exactly this parameter name on load (pinned below).
  assert(payload.url === "/?inbox-thread=t1", "click-through url names the thread, got: " + payload.url);
});

await test("buildNewMessagePushPayload is content-free", () => {
  const bytes = buildNewMessagePushPayload({ threadId: "t2", senderName: "Bob", encrypted: false });
  const payload = JSON.parse(Buffer.from(bytes).toString());
  assert(payload.body === "New message", "body is generic even for plaintext");
  assert(payload.kind === "message", "kind is message");
  assert(payload.url === "/?inbox-thread=t2", "click-through url names the thread, got: " + payload.url);
});

await test("buildCallPushPayload has the call kind and a deep link", () => {
  const bytes = buildCallPushPayload({ callerName: "Carol" });
  const payload = JSON.parse(Buffer.from(bytes).toString());
  assert(payload.kind === "call", "kind is call");
  assert(payload.title === "Incoming call", "title correct");
  assert(/Carol/.test(payload.body), "caller named in body");
  // This assertion used to read "payload.url is a non empty string",
  // which passed for years while NOTHING in the app parsed the
  // parameter: a push tap landed on the default view and the suite
  // that should have caught it was asserting the shape of the hiding
  // place. The URL is now pinned exactly, and its consumption is
  // pinned by the group at the end of this suite.
  assert(payload.url === "/?inbox-open=true", "call click-through url is the inbox-open deep link, got: " + payload.url);
});

await test("getPushDisplayName prefers name, then username, then email", async () => {
  const db = {
    prepare: (sql) => ({
      bind: (...args) => ({
        first: async () => {
          const id = args[0];
          if (id === "u1") return { name: "Alice A", username: "alice", email: "alice@example.com" };
          if (id === "u2") return { name: "", username: "bob", email: "bob@example.com" };
          if (id === "u3") return { name: null, username: null, email: "carol@example.com" };
          return null;
        },
      }),
    }),
  };
  assert((await getPushDisplayName({ DB: db }, "u1")) === "Alice A", "name wins");
  assert((await getPushDisplayName({ DB: db }, "u2")) === "bob", "username fallback");
  assert((await getPushDisplayName({ DB: db }, "u3")) === "carol", "email local part fallback");
  assert((await getPushDisplayName({ DB: db }, "u9")) === "Someone", "unknown user fallback");
});

await test("sendPushToUsers no-ops when VAPID is not configured", async () => {
  let dbTouched = false;
  const env = { DB: { exec: async () => { dbTouched = true; } } }; // no VAPID keys
  await sendPushToUsers(env, ["u1"], () => new Uint8Array([1, 2, 3]));
  assert(!dbTouched, "does not touch the DB without VAPID configured");
});

await test("sendPushToUsers no-ops with no user ids", async () => {
  let dbTouched = false;
  const env = {
    DB: { exec: async () => { dbTouched = true; } },
    VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: "y",
  };
  await sendPushToUsers(env, [], () => new Uint8Array([1]));
  assert(!dbTouched, "does not touch the DB with no recipients");
});

await test("sendPushMessage reports vapid_not_configured without keys", async () => {
  const res = await sendPushMessage({}, { endpoint: "https://example.com/push", p256dh: "x", auth: "y" }, new Uint8Array([1]));
  assert(res.ok === false && res.error === "vapid_not_configured", "reports missing VAPID");
});

// ── The other half of the deep link contract: the app consumes it ──
// The payload tests above pin what the server SENDS. This group pins
// what the app DOES with it on arrival, because that half was missing
// entirely until 2026-10-14: the service worker navigated the tab to
// /?inbox-thread=... or /?inbox-open=true and no code in src parsed
// either parameter, so a push tap landed on the default view while
// sw.js's comment claimed the app consumed the link. A payload shape
// pin alone cannot catch that class of defect again; the consumption
// has to be asserted in the app source itself.
console.log("\npush deep links — the app consumes what the payloads carry:");

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = readFileSync(join(appRoot, "src/CerebrumApp.jsx"), "utf8");
const swSrc = readFileSync(join(appRoot, "public/sw.js"), "utf8");

await test("the service worker navigates the tab to the payload url on tap", () => {
  assert(/c\.navigate\(url\)/.test(swSrc), "sw.js does not navigate an open tab to the payload url");
  assert(/clients\.openWindow\(url\)/.test(swSrc), "sw.js does not open a window at the payload url");
});

await test("the app parses both push parameters on load", () => {
  assert(/params\.get\("inbox-thread"\)/.test(appSrc), "app never reads the inbox-thread parameter");
  assert(/params\.get\("inbox-open"\)/.test(appSrc), "app never reads the inbox-open parameter");
});

await test("a thread link selects the thread through the pending thread machinery", () => {
  assert(/if \(threadId\) setPendingThreadId\(threadId\);/.test(appSrc), "thread link does not hand the thread id to pendingThreadId");
  assert(/setView\("inbox"\)/.test(appSrc), "push link handling never opens the inbox view");
  // The hand off target exists: InboxView receives the pending id and
  // consumes it once the thread is selected.
  assert(/initialThreadId=\{pendingThreadId\}/.test(appSrc), "InboxView is not wired to pendingThreadId");
  assert(/onConsumeInitialThread=\{\(\) => setPendingThreadId\(null\)\}/.test(appSrc), "the pending thread id is never consumed");
});

await test("both parameters are stripped from the URL after consumption", () => {
  assert(/url\.searchParams\.delete\("inbox-thread"\)/.test(appSrc), "inbox-thread is not stripped after consumption");
  assert(/url\.searchParams\.delete\("inbox-open"\)/.test(appSrc), "inbox-open is not stripped after consumption");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
