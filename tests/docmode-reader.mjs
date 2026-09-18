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

await test("progress events are forwarded to onProgress and do not end the stream", async () => {
  const restore = stubFetch(async () =>
    sseResponse([
      'data: {"type":"progress","done":1,"total":4}\n\n',
      'data: {"type":"progress","done":4,"total":4}\n\n',
      'data: {"type":"done","mode":"summary","raw":"full summary"}\n\n',
    ])
  );
  try {
    const seen = [];
    const done = await streamDocumentApi(
      { documentText: "doc", stream: true },
      { onProgress: (d, t) => seen.push([d, t]) }
    );
    assert.deepEqual(seen, [[1, 4], [4, 4]]);
    assert.equal(done.raw, "full summary");
  } finally {
    restore();
  }
});

await test("malformed progress events never crash the stream", async () => {
  const restore = stubFetch(async () =>
    sseResponse([
      'data: {"type":"progress","done":"many","total":4}\n\n',
      'data: {"type":"progress"}\n\n',
      'data: {"type":"done","mode":"summary","raw":"ok"}\n\n',
    ])
  );
  try {
    let calls = 0;
    const done = await streamDocumentApi(
      { documentText: "doc", stream: true },
      { onProgress: () => { calls++; } }
    );
    assert.equal(calls, 0);
    assert.equal(done.raw, "ok");
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

// ── Read-view highlight action: never sticky ──────────────────────────
group("read-view Highlight action — clears everywhere, never sticks");

await test("pendingHL clears on outside pointer, Escape, and view change", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // The fixed "Highlight" action is tagged so the outside-pointer handler
  // can tell it apart from the rest of the page.
  assert.match(src, /data-hl-action/, "Highlight action missing data-hl-action tag");
  assert.match(src, /closest\("\[data-hl-action\]\"\)/, "outside-pointer handler does not spare the action itself");
  assert.match(src, /document\.addEventListener\("pointerdown", onPointerDown\)/, "no outside-pointer cleanup for pendingHL");
  assert.match(src, /document\.addEventListener\("keydown", onKey\)/, "no Escape cleanup for pendingHL");
  // Flipping between Source and Read drops a stale action.
  assert.match(src, /onChange=\{\(v\) => \{ setPendingHL\(null\); setSourceView\(v\); \}\}/, "view change does not clear pendingHL");
  // Completing the highlight still clears the action and the selection.
  const addBlock = src.slice(src.indexOf("const addPendingHighlight"));
  assert.match(addBlock.slice(0, 900), /setPendingHL\(null\)/, "addPendingHighlight does not clear pendingHL");
});

await test("read body is contained: no overflow past its card", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const bodyAt = src.indexOf("ref={readBodyRef}");
  const bodyBlock = src.slice(bodyAt, bodyAt + 900);
  assert.match(bodyBlock, /minWidth: 0/, "read body missing min-width:0");
  assert.match(bodyBlock, /width: "100%"/, "read body missing width:100%");
  assert.match(bodyBlock, /overflowWrap: "break-word"/, "read body does not break long tokens");
  assert.match(bodyBlock, /whiteSpace: "pre-wrap"/, "read body lost pre-wrap");
  assert.match(src, /\.cb-doc-reader \{ min-width: 0; overflow-wrap: break-word; \}/, "reader CSS missing containment");
});

// ── Document Mode breathing room ──────────────────────────────────────
group("document mode — the analysis gets room to breathe");

await test("wider page and roomier analysis card", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /maxWidth: 1280/, "document page not widened to 1280");
  assert.match(src, /className="cb-doc-analysis-card"/, "analysis card missing hook class");
  assert.match(src, /\.cb-doc-analysis-card \.cb-doc-reader p,/, "analysis leading rule missing");
  assert.match(src, /line-height: 1\.75 !important/, "analysis leading not set to 1.75");
});

await test("Q&A and findings sections have section spacing", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /marginTop: i === 0 \? 0 : 28, paddingTop: i === 0 \? 0 : 24/, "Q&A entries still tight");
  assert.match(src, /marginTop: hasFindings \? 28 : 0, marginBottom: 12/, "findings/limitations still tight");
});

// ── Investigations: always-visible fresh start ────────────────────────
group("investigations — New investigation is always one tap away");

await test("header New investigation renders with records present", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const headAt = src.indexOf('title="Investigations" count={history.length}');
  const headBlock = src.slice(headAt, headAt + 1200);
  assert.match(headBlock, />New investigation</, "header New investigation button missing");
  // It must not be gated on history length — the old defect was that the
  // header only showed "Compare two" once records existed.
  assert.ok(!/history\.length >= 2 \?[\s\S]{0,300}New investigation/.test(headBlock), "New investigation gated on history length");
  assert.match(headBlock, /newSession\(\); setView\("search"\)/, "New investigation does not start a fresh session on Search");
  // The empty-state CTA is untouched.
  assert.match(src, /\}>\s*Ask something\s*</, "empty-state Ask something CTA missing");
});

await test("sidebar carries New investigation next to Investigations", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const navAt = src.indexOf('["investigations", "Investigations", "history"');
  const navBlock = src.slice(navAt, navAt + 400);
  assert.match(navBlock, /\["new", "New investigation", "plus", null\]/, "sidebar New investigation item missing or misplaced");
  // The action row gets a full 44px target.
  assert.match(src, /minHeight: key === "new" \? 44 : 38/, "sidebar action row missing 44px target");
  // The nav key is wired: handleSidebarNavigate runs newSession + Search.
  assert.match(src, /case "new": newSession\(\); setView\("search"\); break;/, '"new" nav case missing');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
