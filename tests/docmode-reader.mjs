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
  evictOldestDocs,
  docEvictionNote,
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

// ── Persistence honesty: saves report, cuts and evictions are named ──
group("persistence honesty — a failed save, a cut copy, and an eviction are never silent");

await test("saveDocStore reports success and failure as different outcomes", () => {
  const restore = stubLocalStorage();
  try {
    assert.equal(saveDocStore({ docs: {}, lastOpened: null }), true, "a landed save must report true");
    const throwing = {
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => {},
    };
    Object.defineProperty(globalThis, "localStorage", { value: throwing, configurable: true, writable: true });
    assert.equal(saveDocStore({ docs: {}, lastOpened: null }), false,
      "a failed save must report false, never look identical to a success");
  } finally {
    restore();
  }
});

await test("evictOldestDocs removes the oldest past the cap and names them", () => {
  const docs = {};
  for (let i = 0; i < DOCMODE_MAX_DOCS + 2; i++) {
    docs["fp" + i] = { title: "Doc " + i, text: "t", updatedAt: 1000 + i };
  }
  const store = { docs, lastOpened: null };
  const evicted = evictOldestDocs(store);
  assert.equal(evicted.length, 2, "exactly the overflow is evicted");
  assert.deepEqual(evicted.map((e) => e.title), ["Doc 0", "Doc 1"], "the oldest go first, in order");
  assert.equal(Object.keys(store.docs).length, DOCMODE_MAX_DOCS, "the shelf is left at the cap");
  assert.ok(!store.docs.fp0 && !store.docs.fp1, "evicted entries are gone from the store");
  assert.deepEqual(evictOldestDocs(store), [], "at the cap nothing more is evicted");
  assert.deepEqual(evictOldestDocs(null), [], "a malformed store evicts nothing");
  assert.deepEqual(evictOldestDocs({}), [], "a store without docs evicts nothing");
});

await test("the eviction note names what was removed and carries no dashes", () => {
  assert.equal(docEvictionNote([]), "", "no eviction, no note");
  assert.equal(docEvictionNote([{ fp: "a", title: "Frogs" }]),
    "The oldest document was removed to make room: Frogs.");
  assert.equal(docEvictionNote([{ fp: "a", title: "Frogs" }, { fp: "b", title: "Bees" }]),
    "The 2 oldest documents were removed to make room: Frogs, Bees.");
  assert.ok(!/[-\u2010-\u2015]/.test(docEvictionNote([{ fp: "a", title: "Frogs" }])),
    "eviction copy must contain no dash characters");
});

await test("the desk reads the save outcome and shows the failure instead of swallowing it", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /const savedOk = saveDocStore\(store\);/, "the durable save does not capture the outcome");
  assert.match(src, /setSaveFailed\(!savedOk\);/, "the save outcome never reaches reader facing state");
  assert.match(src, /const \[saveFailed, setSaveFailed\] = useState\(false\);/, "no state carries the save failure");
  assert.ok(src.includes("This document could not be saved on this device, so it will not be here when you come back."),
    "save failure notice copy missing");
  assert.match(src, /hasDoc && saveFailed && \(/, "the failure notice is not gated on the failure state");
});

await test("a stored copy cut to the cap is flagged on the entry and named on reopen", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // The save effect records the cut on the entry it writes, computed
  // from the cap constant, and keeps it true while the open text is
  // the stored cut text itself.
  const saveAt = src.indexOf("store.docs[fp] = {");
  assert.ok(saveAt > 0, "durable save assignment missing");
  const saveBlock = src.slice(saveAt - 600, saveAt + 400);
  assert.match(saveBlock, /const wasCut = text\.length > DOCMODE_MAX_TEXT/, "the cut is not computed from the cap constant");
  assert.match(saveBlock, /store\.docs\[fp\]\.storedShortened && store\.docs\[fp\]\.text === text/, "the cut is not sticky for a reopened cut document");
  assert.match(saveBlock, /storedShortened: wasCut/, "the entry does not carry the cut flag");
  // Reopening restores the flag into state, and the notice names the
  // cap from the constant rather than a second hardcoded number.
  assert.match(src, /setStoredShortened\(!!\(saved && saved\.storedShortened\)\);/, "reopening does not restore the cut flag");
  assert.ok(src.includes("What is stored on this device is shortened to the first {DOCMODE_MAX_TEXT.toLocaleString()} characters of this document."),
    "shortened storage notice missing, or its number is not computed from DOCMODE_MAX_TEXT");
  assert.match(src, /hasDoc && \(storedShortened \|\| docTextTrimmed\.length > DOCMODE_MAX_TEXT\) && \(/, "the shortened notice is not gated on the cut");
});

await test("the save effect evicts through the shared helper and the shelf names the eviction", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /const evicted = evictOldestDocs\(store\);/, "the save effect does not evict through evictOldestDocs");
  assert.match(src, /if \(evicted\.length\) setEvictedNote\(docEvictionNote\(evicted\)\);/, "an eviction never becomes a reader facing note");
  assert.match(src, /\{evictedNote && \(/, "the shelf does not render the eviction note");
  const copies = [
    "This document could not be saved on this device, so it will not be here when you come back.",
    "What is stored on this device is shortened to the first",
    "characters of this document.",
  ];
  for (const c of copies) {
    assert.ok(src.includes(c), "persistence notice copy missing: " + c);
    assert.ok(!/[-\u2010-\u2015]/.test(c), "persistence notice copy contains a dash character: " + c);
  }
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
  assert.match(src, /documentText:\s*text,\s*stream:\s*true/, "analyze must send documentText and stream: true");
  assert.match(src, /priorSections:\s*resumeSections/, "analyze must carry priorSections on a resume");
  // Corrected contract (2026-10-14): the text sent is the text
  // displayed, untrimmed, at all three send sites. The backend no
  // longer trims what it receives and the evidence offsets it returns
  // index the exact text it was sent, which the reader renders as
  // documentText itself; a send time trim shifted every offset by the
  // paste's leading whitespace. This assertion used to pin the trimmed
  // Q&A shape (documentText: documentText.trim()); it now pins the
  // untrimmed one, and the analyze and compare sites are pinned with
  // it. The whitespace only guards are untouched: analyze still
  // refuses on !text.trim() and Q&A on !documentText.trim().
  assert.match(src, /documentText,\s*query:\s*q,\s*history:\s*historyForRequest,\s*stream:\s*true/, "Q&A must send { documentText, query, history, stream: true } with the text untrimmed");
  assert.ok(!/documentText:\s*documentText\.trim\(\)/.test(src), "a send site still trims documentText at send time");
  assert.match(src, /const text = documentText;\s*\n\s*if \(!text\.trim\(\) \|\| analyzing\) return;/, "analyze must bind its payload text untrimmed and keep the whitespace only guard");
  assert.match(src, /"DOCUMENT A:\\n" \+ documentText/, "compare must build its payload from the untrimmed first document");
  assert.match(src, /DOCUMENT B:\\n" \+ docB/, "compare must build its payload from the untrimmed second document");
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
group("investigations — New search is always one tap away");

await test("header New search renders with records present", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const headAt = src.indexOf('title="Investigations" count={history.length}');
  const headBlock = src.slice(headAt, headAt + 1200);
  assert.match(headBlock, />New search</, "header New search button missing");
  // It must not be gated on history length — the old defect was that the
  // header only showed "Compare two" once records existed.
  assert.ok(!/history\.length >= 2 \?[\s\S]{0,300}New search/.test(headBlock), "New search gated on history length");
  assert.match(headBlock, /newSession\(\); setView\("search"\)/, "New search does not start a fresh session on Search");
  // The empty-state CTA is untouched.
  assert.match(src, /\}>\s*Ask something\s*</, "empty-state Ask something CTA missing");
});

await test("sidebar carries a labeled New search action row", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // Reader feedback (2026-10-13): starting a new search was
  // undiscoverable, so the fresh start is a labeled sidebar row now,
  // named New search like everywhere else the action appears.
  const navAt = src.indexOf('["investigations", "Investigations", "history"');
  assert.ok(navAt > 0, "Investigations nav item missing");
  const navBlock = src.slice(src.indexOf("const NAV_ITEMS"), src.indexOf("const NAV_ITEMS") + 900);
  assert.ok(navBlock.includes('["new", "New search", "plus"]'), "flat nav must carry the New search row");
  for (const item of ['["search", "Search"', '["document", "Document Reader"', '["library", "Library"', '["learn", "Cortex"']) {
    assert.ok(navBlock.includes(item), `flat nav missing ${item}`);
  }
  // All nav rows get 44px targets via S.sidebarItem (no per-row override needed).
  assert.match(src, /sidebarItem: \{[^}]*minHeight: 44/, "sidebar rows missing 44px target");
  // The nav key stays wired for the header button and command palette:
  // handleSidebarNavigate runs newSession + Search.
  assert.match(src, /case "new": newSession\(\); setView\("search"\); break;/, '"new" nav case missing');
});

// ── promptTruncation: the reader is told what was left out ────────────
group("promptTruncation — Q&A and compare disclose a shortened document");

await test("Q&A and compare results carry promptTruncation off the result", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // streamDocumentApi resolves with the whole done payload, and the
  // backend puts promptTruncation on it (null when nothing was cut).
  // The desk must keep the field on its answer state the way it keeps
  // the model name, or the structural disclosure dies at the state
  // boundary and the reader is never told. Exactly two landings exist:
  // askFollowUp's final history entry and runCompare's final result.
  const hits = src.split("promptTruncation: (result && result.promptTruncation) || null").length - 1;
  assert.equal(hits, 2, "askFollowUp and runCompare must both carry result.promptTruncation; found " + hits);
});

await test("the disclosure renders under Q&A answers in both reader surfaces and under the comparison", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // qaHistory renders twice (the ask first panel and the notebook Q&A
  // tab); the note must appear in both, or one surface stays silent.
  const qaNotes = src.split('promptTruncationNote(h.promptTruncation, "answer")').length - 1;
  assert.equal(qaNotes, 2, "both Q&A render sites must render the truncation note; found " + qaNotes);
  assert.match(src, /promptTruncationNote\(compareResult\.promptTruncation, "comparison"\)/, "compare result does not render the truncation note");
  // Every render is gated on the field itself, so a null field (nothing
  // cut) renders nothing anywhere. Four sites: the two Q&A surfaces,
  // the comparison, and the summary masthead.
  const gates = src.split("promptTruncation.documentShortened ? (").length - 1;
  assert.equal(gates, 4, "all four render sites must gate on documentShortened; found " + gates);
});

await test("the note is gated on documentShortened, names the omitted count, and is dash free", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const at = src.indexOf("function promptTruncationNote");
  assert.ok(at > 0, "promptTruncationNote helper missing");
  const fn = src.slice(at, at + 700);
  assert.match(fn, /if \(!pt \|\| !pt\.documentShortened\) return null;/, "note must return null when nothing was shortened");
  assert.match(fn, /pt\.omittedChars/, "note must read the omitted character count off the field");
  assert.match(fn, /toLocaleString\(\)/, "the count must be formatted the way the surface formats counts");
  assert.match(fn, /Part of the document was left out of this/, "note wording missing");
  assert.match(fn, /characters were not read/, "note must say the left out characters were not read");
  // Owner rule: no dashes of any kind in reader facing copy. The slice
  // covers the whole helper (body plus its returns), so any hyphen,
  // en dash, or em dash in the wording fails here.
  assert.ok(!/[-\u2010-\u2015]/.test(fn), "note copy must contain no dash characters");
});

// ── answerTruncated + evidence: cut short text and the claim trail ──
group("answerTruncated and evidence — the desk renders the backend's honesty flags");

await test("Q&A entries carry answerTruncated and evidence off the result", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // streamDocumentApi resolves with the whole done payload; the
  // backend puts answerTruncated and evidence on Q&A results. The
  // desk's history entry must keep both the way it keeps
  // promptTruncation, or the flags die at the state boundary.
  // askFollowUp is the one landing for Q&A entries; the comparison
  // keeps its own narrower shape (its evidence offsets index the
  // combined two document text, which neither pane displays).
  assert.ok(src.includes("answerTruncated: !!(result && result.answerTruncated), evidence: (result && Array.isArray(result.evidence)) ? result.evidence : []"),
    "askFollowUp entry drops answerTruncated or evidence");
});

await test("the summary needs no state change: its result is stored whole and the masthead reads the flags off it", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /setSummary\(result\);/, "analyze does not store the whole summary result");
  assert.match(src, /answerTruncatedNote\(summary\.answerTruncated, "summary"\)/, "summary masthead does not render the cut short note");
  assert.match(src, /promptTruncationNote\(summary\.promptTruncation, "summary"\)/, "summary masthead does not render the prompt truncation note");
  // The cut short summary notice wears the same notice dress as the
  // masthead's other completeness disclosures.
  assert.match(src, /\{summary\.answerTruncated && \(\s*<div role="note"/, "summary cut short notice is not a masthead note");
});

await test("the cut short note renders under Q&A answers in both reader surfaces", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const hits = src.split('answerTruncatedNote(h.answerTruncated, "answer")').length - 1;
  assert.equal(hits, 2, "both Q&A render sites must render the cut short note; found " + hits);
  const gates = src.split("h.answer && h.answerTruncated ? (").length - 1;
  assert.equal(gates, 2, "both Q&A cut short renders must gate on the entry's flag; found " + gates);
});

await test("the cut short note is gated on the flag and dash free", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const at = src.indexOf("function answerTruncatedNote");
  assert.ok(at > 0, "answerTruncatedNote helper missing");
  const fn = src.slice(at, src.indexOf("\n}", at) + 2);
  assert.match(fn, /if \(!flag\) return null;/, "note must return null when the flag is off");
  assert.match(fn, /cut short at the length limit/, "note wording missing");
  assert.match(fn, /may end abruptly/, "note must say the text may end abruptly");
  assert.ok(!/[-\u2010-\u2015]/.test(fn), "note copy must contain no dash characters");
});

await test("the evidence trail renders under Q&A answers in both reader surfaces", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const hits = src.split("<DocEvidenceTrail evidence={h.evidence}").length - 1;
  assert.equal(hits, 2, "both Q&A render sites must render the evidence trail; found " + hits);
});

await test("the trail component is honest: empty renders nothing, unverified never shows a location", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const at = src.indexOf("function DocEvidenceTrail");
  assert.ok(at > 0, "DocEvidenceTrail component missing");
  const fn = src.slice(at, src.indexOf("\nfunction NotebookMode", at));
  // The empty contract: no entries, no section (the negative case).
  assert.match(fn, /if \(!Array\.isArray\(evidence\) \|\| evidence\.length === 0\) return null;/, "trail must render nothing for an empty or absent trail");
  // Verified entries show the backend's offsets; the unverified
  // branch is a separate arm that names the quote as not found.
  assert.match(fn, /e\.verified \? \(/, "trail must branch on the backend's verified flag");
  assert.match(fn, /Found in the document, characters/, "verified entries must show their passage location");
  assert.match(fn, /e\.match === "normalized"/, "normalized matches must be disclosed as spacing differences");
  assert.match(fn, /Not found in the document\. Treat this quote with care\./, "unverified entries must be labelled as not found");
  // The rendered output of this component, including that the
  // unverified arm prints no offsets and the empty trail prints
  // nothing at all, is pinned at render level in tests/ui-render.cjs.
});

// ── stageHealth: the run's per stage record reaches the reader ─────
group("stageHealth — the desk renders the backend's per stage record");

await test("Q&A entries carry stageHealth off the result", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // The backend ships stageHealth on Q&A results too (one "answer"
  // stage). The history entry must keep it the way it keeps evidence,
  // or the record dies at the state boundary.
  assert.ok(src.includes("stageHealth: (result && Array.isArray(result.stageHealth)) ? result.stageHealth : []"),
    "askFollowUp entry drops stageHealth");
});

await test("the summary masthead renders the stage record off the stored result", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // setSummary(result) stores the payload whole, so the record is in
  // state already; the masthead must render it next to the other
  // completeness disclosures.
  assert.match(src, /<DocStageHealth stageHealth=\{summary\.stageHealth\}/, "summary masthead does not render the stage record");
});

await test("the stage record renders under Q&A answers in both reader surfaces", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const hits = src.split("<DocStageHealth stageHealth={h.stageHealth}").length - 1;
  assert.equal(hits, 2, "both Q&A render sites must render the stage record; found " + hits);
  const gates = src.split("h.answer ? <DocStageHealth").length - 1;
  assert.equal(gates, 2, "both Q&A stage record renders must gate on the entry's answer; found " + gates);
});

await test("the stage health component is honest: empty renders nothing, skips and details are printed", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const at = src.indexOf("function DocStageHealth");
  assert.ok(at > 0, "DocStageHealth component missing");
  const fn = src.slice(at, src.indexOf("\nfunction NotebookMode", at));
  assert.match(fn, /if \(!Array\.isArray\(stageHealth\) \|\| stageHealth\.length === 0\) return null;/, "stage health must render nothing for an empty or absent record");
  // The classification is the search answer's own helper, so the
  // three states cannot drift apart between the two products.
  assert.match(fn, /stageState\(s\)/, "stage health must classify through stageState");
  assert.match(fn, /s\.skipReason/, "skipped stages must show their skip reason");
  assert.match(fn, /s\.detail/, "stage details must be printed, not dropped");
  // The rendered output of this component, including the empty
  // record printing nothing at all, is pinned at render level in
  // tests/ui-render.cjs.
});

// ── Evidence notes, parked legs, the comparison's cut short flag ───
group("evidence notes, skipped legs, and the comparison's cut short flag");

await test("note carrying evidence renders as not checked, never as not found", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const at = src.indexOf("function DocEvidenceTrail");
  assert.ok(at > 0, "DocEvidenceTrail component missing");
  const fn = src.slice(at, src.indexOf("\nfunction NotebookMode", at));
  // The backend marks quotes it never checked with a note (document.js:
  // "too-long" past the per quote checking limit, "over-cap" past the
  // trail's checked slots). Until 2026-10-14 the trail never read the
  // field and printed those entries as not found, the opposite of what
  // the backend knew. The branch order is the contract: verified,
  // then the note arm, then the not found arm.
  assert.match(fn, /e\.note/, "trail never reads the backend's note field");
  assert.match(fn, /This quote was not checked: it is longer than the checking limit\./, "too-long entries must render as not checked");
  assert.match(fn, /This quote was not checked: there are more quotes than the trail can check\./, "over-cap entries must render as not checked");
  const noteAt = fn.indexOf("e.note ? (");
  const notFoundAt = fn.indexOf("Not found in the document");
  assert.ok(noteAt > 0 && notFoundAt > noteAt, "the note arm must come before the not found arm, or noted entries fall through to not found");
  // Owner rule: the new reader copy carries no dash characters. The
  // check runs on the two rendered sentences themselves (extracted
  // whole), not on a raw source slice: the code between them names
  // the backend's own note values, which are data, not copy.
  for (const sentence of fn.match(/This quote was not checked:[^"]*/g) || []) {
    assert.ok(!/[-\u2010-\u2015]/.test(sentence), "not checked copy must contain no dash characters: " + sentence);
  }
});

await test("the stage record renders parked legs with their reasons", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const at = src.indexOf("function DocStageHealth");
  assert.ok(at > 0, "DocStageHealth component missing");
  const fn = src.slice(at, src.indexOf("\nfunction NotebookMode", at));
  // Stage entries carry the legs the call never fired as skippedLegs:
  // [{ model, reason }] (functions/api/document.js). The component
  // used to drop the field, so a stage line said "ok" and nothing
  // about the legs it won without racing.
  assert.match(fn, /s\.skippedLegs/, "stage health drops the stage's skippedLegs");
  assert.match(fn, /l\.model/, "parked legs must print their model");
  assert.match(fn, /l\.reason/, "parked legs must print their reason");
});

await test("the comparison keeps answerTruncated and renders the cut short note", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // The comparison's state shape is its own (see the Q&A test above),
  // and until 2026-10-14 it dropped the backend's answerTruncated
  // flag at setCompareResult, so a comparison cut short at the length
  // limit read as complete. Pin the flag on the compare setter's own
  // line, not just anywhere in the file.
  assert.match(src, /setCompareResult\(\{ streaming: false,[^\n]*answerTruncated: !!\(result && result\.answerTruncated\)/, "setCompareResult drops answerTruncated");
  // And the compare view renders the note, the way the summary view does.
  assert.match(src, /answerTruncatedNote\(compareResult\.answerTruncated, "comparison"\)/, "compare view does not render the cut short note");
});

// ── Edited documents: reading state goes stale, never resurrects ────
group("edited documents — analysis state is flagged stale and never saved under a new fingerprint");

await test("every piece of reading state tracks the text it was computed from", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /const \[analysisText, setAnalysisText\] = useState\(null\);/, "no tracker for the summary and Q&A");
  assert.match(src, /const \[marksText, setMarksText\] = useState\(null\);/, "no tracker for the marks");
  assert.match(src, /const \[comparePair, setComparePair\] = useState\(null\);/, "no tracker for the comparison");
  // Staleness is derived from the live text on every render, so any
  // edit flips it and an exact undo clears it.
  assert.match(src, /const analysisStale = !!summary && analysisText !== documentText;/, "summary staleness not derived from the tracker");
  assert.match(src, /const qaStale = qaHistory\.length > 0 && analysisText !== documentText;/, "Q&A staleness not derived from the tracker");
  assert.match(src, /const marksStale = highlights\.length > 0 && marksText !== documentText;/, "marks staleness not derived from the tracker");
  assert.match(src, /const compareStale = !!compareResult && !compareResult\.streaming && comparePair !== compareKeyOf\(documentText\.trim\(\), docB\.trim\(\)\);/, "comparison staleness not derived from the pair key");
});

await test("opening a document binds its restored state to its own text", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const openAt = src.indexOf("const openDocument");
  const openBlock = src.slice(openAt, openAt + 4200);
  assert.match(openBlock, /setAnalysisText\(saved && \(saved\.summary \|\|/, "restored summary and Q&A not bound to the opened text");
  assert.match(openBlock, /setMarksText\(saved && Array\.isArray\(saved\.highlights\)/, "restored marks not bound to the opened text");
  assert.match(openBlock, /setComparePair\(saved && saved\.compareResult/, "restored comparison not bound to the opened pair");
});

await test("an edit stops the desk calling the document Analyzed", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // The stale label wins over every standing label, including Analyzed.
  assert.match(src, /analysisStale \? "Edited since analysis" : summary\.model === "extractive"/, "desk chip does not prefer the stale label");
});

await test("the durable save writes state only under the fingerprint it belongs to", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const saveAt = src.indexOf("store.docs[fp] = {");
  assert.ok(saveAt > 0, "durable save assignment missing");
  const saveBlock = src.slice(saveAt, saveAt + 1200);
  assert.match(saveBlock, /summary: summary && !summary\.streaming && analysisText === documentText \? summary : null/, "summary saved without checking its text");
  assert.match(saveBlock, /qaHistory: analysisText === documentText \?/, "Q&A saved without checking its text");
  assert.match(saveBlock, /highlights: marksText === documentText \? storedHighlights : \[\]/, "marks saved without checking their text");
  assert.match(saveBlock, /compareResult: compareResult && !compareResult\.streaming && comparePair === compareKeyOf\(text, docB\.trim\(\)\) \? compareResult : null/, "comparison saved without checking its pair");
});

await test("analysis records its text, and resume digests are offered only for that text", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /setSummary\(result\);\s+setAnalysisText\(srcText\);/, "a finished analysis does not record the text it read");
  assert.match(src, /const resumeSections = summary && analysisText === documentText && summary\.partial/, "resume digests not gated on the text they describe");
});

await test("asking about an edited document sends no stale context and retires the old thread", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  assert.match(src, /const retireStaleQa = analysisText !== srcText;/, "ask does not detect a stale thread");
  assert.match(src, /const historyForRequest = retireStaleQa\s+\? \[\]/, "stale turns still ride along as request context");
  assert.match(src, /retireStaleQa \? \[entry\] : h\.map/, "a new answer joins the stale thread instead of retiring it");
  assert.match(src, /if \(retireStaleQa\) setAnalysisText\(srcText\);/, "the fresh thread is not bound to the asked text");
});

await test("stale marks are not painted, and a new mark retires them", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const rangeAt = src.indexOf("const renderMarkedRange");
  assert.match(src.slice(rangeAt, rangeAt + 300), /if \(marksStale\) return text;/, "segment renderer paints stale marks");
  const textAt = src.indexOf("const renderMarkedText");
  assert.match(src.slice(textAt, textAt + 500), /if \(marksStale\) return text;/, "plain renderer paints stale marks");
  const addAt = src.indexOf("const addPendingHighlight");
  const addBlock = src.slice(addAt, addAt + 1800);
  assert.match(addBlock, /if \(marksText !== documentText\) setHighlights\(\[mark\]\);/, "a new mark mixes with stale marks instead of retiring them");
  assert.match(addBlock, /setMarksText\(documentText\);/, "a new mark does not bind the marks to the current text");
});

await test("the comparison keeps the model and budget fields and labels degradation like Q&A does", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  // This pin names the setter's field list exactly, so it was updated
  // when the answerTruncated field joined the shape (2026-10-14,
  // fifth panel Document Reader remainder): the pin now covers the
  // corrected contract, model, budget, and both truncation fields.
  assert.match(src, /setCompareResult\(\{ streaming: false, text: result && result\.answer \? result\.answer : "", model: \(result && result\.model\) \|\| null, budgetExhausted: !!\(result && result\.budgetExhausted\), promptTruncation: \(result && result\.promptTruncation\) \|\| null, answerTruncated: !!\(result && result\.answerTruncated\) \}\);/, "compare result drops the model, budget, or truncation fields");
  assert.match(src, /setComparePair\(compareKeyOf\(a, b\)\);/, "a finished comparison does not record its text pair");
  assert.match(src, /compareResult\.model === "extractive"/, "compare view never checks for an extractive result");
});

await test("the stale notices are present on every surface and carry no dashes", async () => {
  const src = await readFile(join(root, "src/CerebrumApp.jsx"), "utf8");
  const notices = [
    "This document has been edited since this analysis was run, so the analysis describes the earlier text. Run the analysis again to bring it up to date.",
    "These answers describe the earlier version of this document. The text has been edited since they were written.",
    "This document has been edited since these marks were made, so they are no longer placed in the text. The passages below are the words as they were marked.",
    "One of these documents has been edited since this comparison was run, so it describes the earlier texts. Compare again to update it.",
    "Basic extract · the monthly AI budget is used up, so this comparison is passages from the documents.",
    "Basic extract · the AI service was unreachable, so this comparison is passages from the documents.",
  ];
  for (const n of notices) {
    assert.ok(src.includes(n), "stale or degradation notice missing: " + n);
    assert.ok(!/[-\u2010-\u2015]/.test(n), "notice copy contains a dash character: " + n);
  }
  // The Q&A stale notice renders on both surfaces that list answers
  // (the ask first panel and the notebook Q&A tab).
  const qaNotices = src.split("These answers describe the earlier version of this document.").length - 1;
  assert.equal(qaNotices, 2, "both Q&A surfaces must carry the stale notice; found " + qaNotices);
});

// ── document.js user visible strings: no dashes of any kind ───────────
// The third rescore found an em dash surviving in the rate limit error
// message in functions/api/document.js, a file the client copy checks
// never reach. The owner's rule covers backend strings a reader can be
// shown, so the check lives here now: the classified error messages are
// tested behaviorally, and every user facing literal in the file is
// scanned for em and en dashes.
group("document.js user visible strings — no dashes of any kind");

const documentApi = await import(join(root, "functions/api/document.js"));

await test("every classified error message is dash free", () => {
  const cases = [
    new Error("deepseek/deepseek-chat-v3:free: no OPENROUTER_KEY configured"),
    new Error("qwen/qwen-2.5: timed out"),
    new Error("All providers failed: a: HTTP 429 | b: HTTP 429"),
    new Error("something entirely unexpected"),
  ];
  for (const e of cases) {
    const c = documentApi.classifyDocumentError(e);
    assert.ok(!/[-\u2010-\u2015]/.test(c.message), "classified message contains a dash character: " + c.message);
  }
  const rl = documentApi.classifyDocumentError(new Error("All providers failed: a: HTTP 429"));
  assert.equal(rl.message, "Every free AI model is rate limited right now. This is not a problem with your document. Capacity usually returns within a minute.");
});

await test("no user facing literal in document.js carries an em or en dash", async () => {
  const src = await readFile(join(root, "functions/api/document.js"), "utf8");
  const literals = [];
  for (const m of src.matchAll(/message:\s*"([^"]*)"/g)) literals.push(m[1]);
  for (const m of src.matchAll(/errRes\(\s*"([^"]*)"/g)) literals.push(m[1]);
  assert.ok(literals.length >= 10, "the scan found too few user facing literals to trust: " + literals.length);
  for (const lit of literals) {
    assert.ok(!/[\u2013\u2014]/.test(lit), "user facing literal contains an em or en dash: " + lit);
  }
  // The quota messages ride in a ternary, not a bare errRes literal, so
  // they are pinned directly.
  assert.ok(src.includes("Lite reads 30. Pro reads unlimited."), "fixed quota wording missing");
  assert.ok(!src.includes("Lite reads 30 \u2014"), "the quota message still carries an em dash");
  assert.ok(!src.includes("rate-limited right now \u2014"), "the rate limit message still carries an em dash");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
