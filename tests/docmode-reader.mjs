/**
 * Document Mode reader — regression tests for the §7 rebuild.
 *
 * The reader's expensive guarantees live in src/docReader.js (pure, DOM-free)
 * so they can be unit tested in node with no browser:
 *  - docFingerprint: deterministic keys for durable per-document state.
 *  - extractHtmlText: uploaded HTML becomes readable text, never raw markup.
 *  - parseDocSseLine / streamDocumentApi: the /api/document SSE client —
 *    especially the rule that a stream ending without "done" throws, so a
 *    partial answer can never stand as final.
 *  - canAddHighlight: the overlap guard behind text highlights.
 *  - loadDocStore / saveDocStore: durable reading state degrades safely.
 *  - OPENROUTER key alias: functions/api/document.js honors OPENROUTER_KEY
 *    and OPENROUTER_API_KEY (Dusty's real outage: the key was set under the
 *    alias name and Document Mode silently built zero provider legs).
 *
 * Run with: node tests/docmode-reader.mjs
 */

import { strict as assert } from "node:assert";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

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
  docFingerprint,
  extractHtmlText,
  parseDocSseLine,
  streamDocumentApi,
  canAddHighlight,
  docTitleOf,
  loadDocStore,
  saveDocStore,
  DOCMODE_STORE_KEY,
  DOCMODE_MAX_DOCS,
  DOCMODE_MAX_TEXT,
} = await import(join(root, "src/docReader.js"));

// ── docFingerprint ─────────────────────────────────────────────────────
group("docFingerprint — durable per-document keys");

await test("deterministic: same text, same key", () => {
  assert.equal(docFingerprint("hello world"), docFingerprint("hello world"));
});

await test("different text, different key", () => {
  assert.notEqual(docFingerprint("paper A"), docFingerprint("paper B"));
});

await test("key is a stable hex string", () => {
  const k = docFingerprint("x".repeat(1000));
  assert.match(k, /^[0-9a-f]{8}$/);
});

// ── extractHtmlText ────────────────────────────────────────────────────
group("extractHtmlText — uploaded HTML becomes text, not markup");

await test("strips scripts, styles and chrome; keeps the reading text", () => {
  const html = `<html><head><style>.x{color:red}</style><script>alert(1)</script></head>
    <body><nav>Home About</nav><header>Site banner</header>
    <article><h1>Real Title</h1><p>First paragraph &amp; more.</p><p>Second.</p></article>
    <footer>Copyright 2026</footer></body></html>`;
  const text = extractHtmlText(html);
  assert.ok(text.includes("Real Title"), "title lost");
  assert.ok(text.includes("First paragraph & more."), "entity not decoded");
  assert.ok(text.includes("Second."), "second paragraph lost");
  assert.ok(!text.includes("alert(1)"), "script content leaked");
  assert.ok(!text.includes("color:red"), "style content leaked");
  assert.ok(!text.includes("Site banner"), "header chrome leaked");
  assert.ok(!text.includes("Copyright 2026"), "footer chrome leaked");
  assert.ok(!text.includes("<"), "raw markup leaked");
});

await test("adjacent blocks do not glue words together", () => {
  const text = extractHtmlText("<p>alpha</p><p>beta</p>");
  assert.ok(text.includes("alpha") && text.includes("beta"));
  // the output must keep whitespace between the words — removing all
  // whitespace first and then crying "glued" defeats the check.
  assert.ok(/alpha\s+beta/.test(text), "words glued: " + JSON.stringify(text));
});

await test("empty / non-string input yields empty text", () => {
  assert.equal(extractHtmlText(""), "");
  assert.equal(extractHtmlText(null), "");
  assert.equal(extractHtmlText("<script>var x=1;</script>"), "");
});

// ── parseDocSseLine ────────────────────────────────────────────────────
group("parseDocSseLine — SSE event parsing");

await test("parses a token event", () => {
  const ev = parseDocSseLine('data: {"type":"token","text":"hello"}');
  assert.deepEqual(ev, { type: "token", text: "hello" });
});

await test("ignores non-event lines, blanks and [DONE]", () => {
  assert.equal(parseDocSseLine(""), null);
  assert.equal(parseDocSseLine(": heartbeat"), null);
  assert.equal(parseDocSseLine("data: [DONE]"), null);
  assert.equal(parseDocSseLine('data: {"type":"token"'), null, "malformed JSON must not throw");
});

// ── streamDocumentApi ──────────────────────────────────────────────────
group("streamDocumentApi — the no-partial-answer contract");

// Build a real Response whose body is an SSE byte stream, so the streamer
// runs its true code path (reader, decoder, buffering) in node.
function sseResponse(chunks, { ok = true, status = 200, jsonBody = null } = {}) {
  const enc = new TextEncoder();
  if (!ok) {
    return new Response(JSON.stringify(jsonBody || {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
  const stream = new ReadableStream({
    start(controller) {
      // Split chunks adversarially: emit in uneven pieces so the
      // streamer's line buffering is genuinely exercised.
      for (const c of chunks) {
        const bytes = enc.encode(c);
        const mid = Math.max(1, Math.floor(bytes.length / 2));
        controller.enqueue(bytes.slice(0, mid));
        controller.enqueue(bytes.slice(mid));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const realFetch = globalThis.fetch;
function stubFetch(fn) {
  globalThis.fetch = fn;
  return () => { globalThis.fetch = realFetch; };
}

await test("accumulates tokens and resolves with the done payload", async () => {
  const restore = stubFetch(async () =>
    sseResponse([
      'data: {"type":"token","text":"Hel"}\n\n',
      'data: {"type":"token","text":"lo"}\n\n',
      'data: {"type":"done","mode":"qa","answer":"Hello"}\n\n',
    ])
  );
  try {
    const seen = [];
    const done = await streamDocumentApi(
      { documentText: "doc", query: "q", stream: true },
      { onToken: (t) => seen.push(t) }
    );
    assert.equal(seen.join(""), "Hello");
    assert.equal(done.answer, "Hello");
    assert.equal(done.mode, "qa");
  } finally {
    restore();
  }
});

await test("a stream that ends without done throws incomplete_stream", async () => {
  const restore = stubFetch(async () =>
    sseResponse(['data: {"type":"token","text":"half an answer"}\n\n'])
  );
  try {
    let threw = null;
    try {
      await streamDocumentApi({ documentText: "doc", stream: true }, { onToken: () => {} });
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, "stream ending without done did not throw");
    assert.equal(threw.code, "incomplete_stream");
  } finally {
    restore();
  }
});

await test("a backend error event throws with its message", async () => {
  const restore = stubFetch(async () =>
    sseResponse(['data: {"type":"error","error":"Model overloaded","code":"provider_error"}\n\n'])
  );
  try {
    let threw = null;
    try {
      await streamDocumentApi({ documentText: "doc", stream: true });
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, "error event did not throw");
    assert.equal(threw.message, "Model overloaded");
    assert.equal(threw.code, "provider_error");
  } finally {
    restore();
  }
});

await test("non-OK responses throw with the backend code", async () => {
  for (const code of ["auth_required", "doc_quota_exhausted"]) {
    const restore = stubFetch(async () =>
      sseResponse([], { ok: false, status: code === "auth_required" ? 401 : 402, jsonBody: { error: "nope", code } })
    );
    try {
      let threw = null;
      try {
        await streamDocumentApi({ documentText: "doc", stream: true });
      } catch (e) {
        threw = e;
      }
      assert.ok(threw, `${code} did not throw`);
      assert.equal(threw.code, code, `${code} code was not carried on the error`);
    } finally {
      restore();
    }
  }
});

await test("user abort throws with code aborted (not a generic error)", async () => {
  // A fetch stub that honors abort like a real one.
  const hanging = (url, opts) =>
    new Promise((resolve, reject) => {
      if (opts.signal.aborted) return reject(new DOMException("aborted", "AbortError"));
      opts.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  const restore = stubFetch(hanging);
  try {
    const ctrl = new AbortController();
    const p = streamDocumentApi({ documentText: "doc", stream: true }, { signal: ctrl.signal, timeoutMs: 0 });
    ctrl.abort();
    let threw = null;
    try { await p; } catch (e) { threw = e; }
    assert.ok(threw, "abort did not throw");
    assert.equal(threw.code, "aborted");
  } finally {
    restore();
  }
});

await test("a hung connection trips the internal timeout with code timeout", async () => {
  const hanging = (url, opts) =>
    new Promise((resolve, reject) => {
      if (opts.signal.aborted) return reject(new DOMException("aborted", "AbortError"));
      opts.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  const restore = stubFetch(hanging);
  try {
    let threw = null;
    try {
      await streamDocumentApi({ documentText: "doc", stream: true }, { timeoutMs: 30 });
    } catch (e) { threw = e; }
    assert.ok(threw, "timeout did not throw");
    assert.equal(threw.code, "timeout");
  } finally {
    restore();
  }
});

await test("request body is posted as JSON to /api/document", async () => {
  let seenUrl, seenBody;
  const restore = stubFetch(async (url, init) => {
    seenUrl = url;
    seenBody = JSON.parse(init.body);
    return sseResponse(['data: {"type":"done","mode":"summary"}\n\n']);
  });
  try {
    await streamDocumentApi({ documentText: "abc", stream: true });
    assert.equal(seenUrl, "/api/document");
    assert.equal(seenBody.documentText, "abc");
  } finally {
    restore();
  }
});

// ── canAddHighlight ────────────────────────────────────────────────────
group("canAddHighlight — overlap guard");

await test("non-overlapping ranges are allowed", () => {
  assert.equal(canAddHighlight([], 0, 10), true);
  assert.equal(canAddHighlight([{ start: 0, end: 10 }], 10, 20), true, "adjacent must be allowed");
  assert.equal(canAddHighlight([{ start: 0, end: 10 }], 20, 30), true);
});

await test("overlapping ranges are rejected", () => {
  const existing = [{ start: 10, end: 20 }];
  assert.equal(canAddHighlight(existing, 15, 25), false);
  assert.equal(canAddHighlight(existing, 5, 15), false);
  assert.equal(canAddHighlight(existing, 12, 18), false, "contained must be rejected");
  assert.equal(canAddHighlight(existing, 5, 25), false, "containing must be rejected");
});

await test("degenerate ranges are rejected", () => {
  assert.equal(canAddHighlight([], 5, 5), false);
  assert.equal(canAddHighlight([], 10, 5), false);
});

// ── docTitleOf ─────────────────────────────────────────────────────────
group("docTitleOf — human titles for the recent list");

await test("uses the first substantial line, capped", () => {
  assert.equal(docTitleOf("\n\nSAMPLE PAPER: for trying Document Mode\n\nAbstract"), "SAMPLE PAPER: for trying Document Mode");
  const long = docTitleOf("a".repeat(200));
  assert.ok(long.length <= 81, "title not capped");
  assert.equal(docTitleOf(""), "Untitled document");
});

// ── loadDocStore / saveDocStore ────────────────────────────────────────
group("durable reading state — degrades safely");

function stubLocalStorage() {
  const map = new Map();
  const fake = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  const real = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: fake, configurable: true, writable: true });
  return () => {
    Object.defineProperty(globalThis, "localStorage", { value: real, configurable: true, writable: true });
  };
}

await test("round-trips a document entry", () => {
  const restore = stubLocalStorage();
  try {
    saveDocStore({ docs: { abc12345: { title: "T", text: "hello", highlights: [{ start: 0, end: 5 }] } }, lastOpened: "abc12345" });
    const store = loadDocStore();
    assert.equal(store.lastOpened, "abc12345");
    assert.equal(store.docs.abc12345.highlights.length, 1);
    assert.equal(globalThis.localStorage.getItem(DOCMODE_STORE_KEY).length > 0, true);
  } finally {
    restore();
  }
});

await test("corrupt storage degrades to an empty store", () => {
  const restore = stubLocalStorage();
  try {
    globalThis.localStorage.setItem(DOCMODE_STORE_KEY, "not json{{{");
    assert.deepEqual(loadDocStore(), { docs: {}, lastOpened: null });
  } finally {
    restore();
  }
});

await test("storage constants are sane", () => {
  assert.ok(DOCMODE_MAX_DOCS >= 1 && DOCMODE_MAX_DOCS <= 50);
  assert.ok(DOCMODE_MAX_TEXT >= 50000, "text cap must hold a real paper");
});

// ── OpenRouter key alias (document.js) ─────────────────────────────────
group("OPENROUTER key alias — functions/api/document.js");

await test("document.js honors OPENROUTER_KEY and OPENROUTER_API_KEY", async () => {
  const src = await readFile(join(root, "functions/api/document.js"), "utf8");
  assert.match(src, /env\.OPENROUTER_KEY\s*\|\|\s*env\.OPENROUTER_API_KEY/, "alias lookup missing from document.js");
});

await test("CerebrumApp wires the reader helpers into Document Mode", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /from "\.\/docReader\.js"/, "docReader.js not imported");
  assert.match(src, /streamDocumentApi\(/, "streamer not used in the reader");
  assert.match(src, /incomplete_stream/, "incomplete-stream failure path not handled");
});

await test("frontend sends the backend's field names (no phantom mode field)", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // The backend reads body.documentText / body.query / body.history and
  // branches on body.stream; a `mode` or `document`/`question` field would
  // be ignored and analysis would 400 as "missing_document".
  assert.match(src, /\{\s*documentText:\s*text,\s*stream:\s*true\s*\}/, "analyze must send { documentText, stream: true }");
  assert.match(src, /documentText:\s*documentText\.trim\(\),\s*query:\s*q,\s*history:\s*historyForRequest,\s*stream:\s*true/, "Q&A must send { documentText, query, history, stream: true }");
  assert.match(src, /documentText:\s*combined,\s*stream:\s*true,\s*query:/, "compare must send { documentText, stream: true, query }");
  assert.ok(!/streamDocumentApi\(\s*\{\s*document:/.test(src), "phantom `document` field sent to /api/document");
  assert.ok(!/mode:\s*"(qa|analyze)"/.test(src), "phantom `mode` field sent to /api/document");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
