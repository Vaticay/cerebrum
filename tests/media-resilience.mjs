/**
 * Media resilience tests — shared primitives in functions/lib/resilience.js
 * and their wiring into the media endpoints (videos.js, image.js, tts.js).
 *
 * Pure unit tests: no network, no database, no Cloudflare bindings. The
 * global fetch is stubbed where a timeout needs exercising.
 *
 * Standalone: run with `node tests/media-resilience.mjs`. (Not yet wired
 * into tests/run — that file is owned by another pass.)
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

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

const {
  withTimeout,
  neverFail,
  raceFirst,
  fetchWithTimeout,
  safeErr,
  jsonOk,
  jsonError,
  clampText,
  isSafeUrl,
  isSafeHttpsUrl,
} = await import(join(root, "functions/lib/resilience.js"));

// ══════════════════════════════════════════════════════════════════════════
group("withTimeout — every outbound wait has an explicit deadline");

await test("withTimeout rejects in time on a never-settling promise", async () => {
  const never = new Promise(() => {});
  const t0 = Date.now();
  await assert.rejects(() => withTimeout(never, 60, "test-op"), /timeout:test-op:60ms/);
  assert.ok(Date.now() - t0 < 1000, "timeout took far longer than requested");
});

await test("withTimeout passes through a fast success", async () => {
  const v = await withTimeout(Promise.resolve("fine"), 1000, "test-op");
  assert.equal(v, "fine");
});

await test("withTimeout passes through a fast rejection", async () => {
  await assert.rejects(() => withTimeout(Promise.reject(new Error("boom")), 1000, "test-op"), /boom/);
});

await test("withTimeout error carries the label, not internals", async () => {
  const err = await withTimeout(new Promise(() => {}), 10, "aura-model").catch((e) => e);
  assert.ok(String(err.message).includes("aura-model"), "label missing from timeout error");
});

// ══════════════════════════════════════════════════════════════════════════
group("neverFail — provider failures degrade to the fallback, never throw");

await test("neverFail returns the value on success", async () => {
  assert.equal(await neverFail(Promise.resolve(42), -1, "x"), 42);
});

await test("neverFail returns the fallback on rejection", async () => {
  assert.deepEqual(
    await neverFail(Promise.reject(new Error("provider down")), { videos: [] }, "videos"),
    { videos: [] }
  );
});

await test("neverFail returns the fallback on timeout", async () => {
  const slow = new Promise((r) => setTimeout(() => r("late"), 500));
  assert.equal(await neverFail(withTimeout(slow, 30, "slow"), "fallback", "x"), "fallback");
});

// ══════════════════════════════════════════════════════════════════════════
group("raceFirst — first healthy answer wins, fast failures never do");

await test("raceFirst returns the fastest successful leg", async () => {
  const legs = [
    new Promise((r) => setTimeout(() => r("slow"), 200)),
    new Promise((r) => setTimeout(() => r("fast"), 20)),
  ];
  assert.equal(await raceFirst(legs, { timeoutMs: 2000, label: "t" }), "fast");
});

await test("raceFirst ignores a fast rejection in favour of a slow success", async () => {
  const legs = [
    Promise.reject(new Error("instant fail")),
    new Promise((r) => setTimeout(() => r("eventual"), 30)),
  ];
  assert.equal(await raceFirst(legs, { timeoutMs: 2000, label: "t" }), "eventual");
});

await test("raceFirst resolves the fallback when every leg fails", async () => {
  const legs = [Promise.reject(new Error("a")), Promise.reject(new Error("b"))];
  assert.deepEqual(await raceFirst(legs, { timeoutMs: 300, label: "t", fallback: [] }), []);
});

await test("raceFirst resolves the fallback on deadline instead of hanging", async () => {
  const legs = [new Promise(() => {})];
  const t0 = Date.now();
  const v = await raceFirst(legs, { timeoutMs: 60, label: "t", fallback: "fb" });
  assert.equal(v, "fb");
  assert.ok(Date.now() - t0 < 1000, "race hung past its deadline");
});

// ══════════════════════════════════════════════════════════════════════════
group("fetchWithTimeout — no bare fetch against third parties");

await test("fetchWithTimeout aborts a hanging upstream in time", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {}); // hangs forever
  try {
    const t0 = Date.now();
    await assert.rejects(() => fetchWithTimeout("https://example.invalid/", {}, 60));
    assert.ok(Date.now() - t0 < 1000, "hanging fetch was not aborted in time");
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test("fetchWithTimeout passes options and returns the response", async () => {
  const realFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, opts) => {
    seen = { url, opts };
    return new Response("ok");
  };
  try {
    const res = await fetchWithTimeout("https://example.invalid/x", { method: "HEAD" }, 1000);
    assert.equal(await res.text(), "ok");
    assert.equal(seen.url, "https://example.invalid/x");
    assert.equal(seen.opts.method, "HEAD");
    assert.ok(seen.opts.signal instanceof AbortSignal, "no AbortSignal attached");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ══════════════════════════════════════════════════════════════════════════
group("safeErr — nothing internal ever leaves the server");

await test("safeErr drops stack frames to a single line", () => {
  const e = new Error("short message");
  e.stack = "Error: short message\n    at foo (/internal/path/x.js:1:1)\n    at bar (/internal/path/y.js:2:2)";
  assert.equal(safeErr(e), "short message");
});

await test("safeErr redacts API keys and tokens", () => {
  const out = safeErr(new Error("call failed api_key=sk-SECRET1234567890 bad"));
  assert.ok(!out.includes("SECRET"), "key leaked");
  assert.ok(out.includes("[redacted]"), "redaction marker missing");
});

await test("safeErr redacts credentials embedded in URLs", () => {
  const out = safeErr(new Error("fetch https://admin:hunter2@internal.host/x failed"));
  assert.ok(!out.includes("hunter2"), "credential leaked");
});

// ══════════════════════════════════════════════════════════════════════════
group("jsonOk / jsonError — one consistent response shape");

await test("jsonError produces {ok:false, error:{code,message}}", async () => {
  const res = jsonError(429, "rate_limited", "Too many requests.", { "X-Test": "1" });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await res.json(), {
    ok: false,
    error: { code: "rate_limited", message: "Too many requests." },
  });
  assert.equal(res.headers.get("x-test"), "1", "custom headers lost");
});

await test("jsonOk produces {ok:true, ...data}", async () => {
  const res = jsonOk({ videos: [{ id: "abc" }] });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, videos: [{ id: "abc" }] });
});

await test("jsonError never embeds the raw exception text", async () => {
  const raw = new Error("Error: connect ECONNREFUSED 10.0.0.7:5432 at TCPConnectWrap");
  const res = jsonError(502, "tts_unavailable", "TTS unavailable.");
  const body = await res.text();
  assert.ok(!body.includes("ECONNREFUSED") && !body.includes("10.0.0.7"), "internal detail leaked");
});

// ══════════════════════════════════════════════════════════════════════════
group("input validation — bad values rejected before any work");

await test("clampText caps length before processing", () => {
  assert.equal(clampText("x".repeat(9999), 160).length, 160);
  assert.equal(clampText("  padded  ", 160), "padded");
});

await test("clampText coerces non-strings safely", () => {
  assert.equal(clampText(null, 10), "");
  assert.equal(clampText(undefined, 10), "");
  assert.equal(clampText(12345, 3), "123");
  assert.equal(clampText({}, 100), "[object Object]".slice(0, 100));
});

await test("isSafeUrl rejects dangerous schemes", () => {
  assert.equal(isSafeUrl("javascript:alert(1)"), false);
  assert.equal(isSafeUrl("data:image/png;base64,AAA"), false);
  assert.equal(isSafeUrl("file:///etc/passwd"), false);
  assert.equal(isSafeUrl("not a url at all"), false);
  assert.equal(isSafeUrl(""), false);
  assert.equal(isSafeUrl(null), false);
});

await test("isSafeUrl rejects embedded credentials", () => {
  assert.equal(isSafeUrl("https://user:pass@example.com/x.jpg"), false);
});

await test("isSafeUrl accepts plain http(s) URLs", () => {
  assert.equal(isSafeUrl("https://i.ytimg.com/vi/abc/hqdefault.jpg"), true);
  assert.equal(isSafeUrl("http://example.com/x.jpg"), true);
});

await test("isSafeHttpsUrl requires https", () => {
  assert.equal(isSafeHttpsUrl("https://example.com/x.jpg"), true);
  assert.equal(isSafeHttpsUrl("http://example.com/x.jpg"), false);
  assert.equal(isSafeHttpsUrl("javascript:alert(1)"), false);
});

// ══════════════════════════════════════════════════════════════════════════
group("endpoint wiring — media files use the shared primitives");

const videosSrc = readFileSync(join(root, "functions/api/videos.js"), "utf8");
const imageSrc = readFileSync(join(root, "functions/api/image.js"), "utf8");
const ttsSrc = readFileSync(join(root, "functions/api/tts.js"), "utf8");

await test("all three endpoints import lib/resilience.js", () => {
  for (const [name, src] of [["videos", videosSrc], ["image", imageSrc], ["tts", ttsSrc]]) {
    assert.ok(src.includes('from "../lib/resilience.js"'), `${name}.js does not import resilience`);
  }
});

await test("no endpoint hand-rolls its own AbortController anymore", () => {
  for (const [name, src] of [["videos", videosSrc], ["image", imageSrc], ["tts", ttsSrc]]) {
    assert.ok(!src.includes("new AbortController"), `${name}.js still hand-rolls an AbortController`);
  }
});

await test("videos.js races with a hard deadline and degrades to []", () => {
  assert.ok(videosSrc.includes("raceFirst"), "videos.js does not use raceFirst");
  assert.ok(videosSrc.includes("fallback: []"), "videos.js has no [] fallback");
});

await test("videos.js validates provider video ids before forwarding", () => {
  assert.ok(videosSrc.includes("YT_ID_RE"), "youtube id validation missing");
});

await test("image.js requires https on every forwarded image url", () => {
  assert.ok(imageSrc.includes("isSafeHttpsUrl"), "image.js does not enforce https-safe urls");
});

await test("tts.js has no local jsonErr/withTimeout copies left", () => {
  assert.ok(!/function\s+jsonErr\s*\(/.test(ttsSrc), "local jsonErr still present");
  assert.ok(!/function\s+withTimeout\s*\(/.test(ttsSrc), "local withTimeout still present");
});

await test("no endpoint echoes a raw exception to the client", () => {
  for (const [name, src] of [["videos", videosSrc], ["image", imageSrc], ["tts", ttsSrc]]) {
    assert.ok(!src.includes("String(e)"), `${name}.js echoes a raw exception`);
  }
});

await test("media endpoints keep origin allowlist + rate limiting", () => {
  for (const [name, src] of [["videos", videosSrc], ["image", imageSrc], ["tts", ttsSrc]]) {
    assert.ok(src.includes("readOriginAllowed"), `${name}.js lost its origin check`);
    assert.ok(src.includes("checkRateLimit"), `${name}.js lost rate limiting`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
