/* Cerebrum Document Mode — reader helpers.
 *
 * Pure, DOM-free functions shared by the Document Mode reader in
 * src/CerebrumApp.jsx and the unit tests in tests/docmode-reader.mjs.
 * Nothing here touches React or the DOM (localStorage access is guarded),
 * so the tests can import this module in node with no browser.
 *
 * What lives here:
 *  - docFingerprint: deterministic id for a document's text, used as the
 *    key for durable per-document state (highlights, notes, Q&A, scroll).
 *  - extractHtmlText: readable-text extraction for uploaded .html files.
 *    Uploaded HTML is rendered as this extracted text, never as raw HTML —
 *    rendering arbitrary markup would be an XSS hole.
 *  - parseDocSseLine / streamDocumentApi: the /api/document SSE client.
 *    The streamer resolves with the "done" payload and throws on backend
 *    error events, non-OK responses, aborts, and — critically — on streams
 *    that end without a "done" event. A partial answer is never returned
 *    as final; the caller clears it and says so.
 *  - canAddHighlight: overlap guard for text highlights.
 *  - docTitleOf: a human title for a document (recent-documents list).
 *  - loadDocStore / saveDocStore: localStorage persistence for
 *    per-document reading state. Failures (private mode, quota) degrade
 *    to an empty store instead of throwing.
 */

export const DOCMODE_STORE_KEY = "cb_docmode_docs_v1";
export const DOCMODE_MAX_DOCS = 8;
export const DOCMODE_MAX_TEXT = 200000;

/* Deterministic fingerprint for a document's text — FNV-1a, hex.
   The same text always maps to the same key, so highlights and notes
   reattach to exactly the document they were made on. */
export function docFingerprint(text) {
  let h = 2166136261;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/* Extract readable text from an uploaded HTML file. Scripts, styles and
   page chrome (nav/header/footer/aside) are dropped whole; block-level
   tags become paragraph breaks so words from adjacent elements never glue
   together; the common entities are decoded. The result is plain text for
   analysis and typeset reading — not rendered HTML. */
export function extractHtmlText(html) {
  if (!html || typeof html !== "string") return "";
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style\s*>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript\s*>/gi, " ");
  s = s.replace(/<nav[\s\S]*?<\/nav\s*>/gi, " ");
  s = s.replace(/<header[\s\S]*?<\/header\s*>/gi, " ");
  s = s.replace(/<footer[\s\S]*?<\/footer\s*>/gi, " ");
  s = s.replace(/<aside[\s\S]*?<\/aside\s*>/gi, " ");
  s = s.replace(/<\/(p|div|section|article|h[1-6]|li|tr|blockquote|dd|dt)>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  // Entities: &amp; decodes last so "&amp;lt;" stays a literal "&lt;".
  s = s.replace(/&nbsp;/gi, " ");
  s = s.replace(/&lt;/gi, "<");
  s = s.replace(/&gt;/gi, ">");
  s = s.replace(/&quot;/gi, '"');
  s = s.replace(/&#39;|&apos;/gi, "'");
  s = s.replace(/&amp;/gi, "&");
  s = s.replace(/&#(\d+);/g, (_, n) => {
    const c = Number(n);
    return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : "";
  });
  s = s.replace(/[ \t\f\v\u00a0]+/g, " ");
  s = s.replace(/ ?\n ?/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/* Parse one SSE "data:" line from /api/document into an event object.
   Returns null for anything that isn't a JSON event line — heartbeats,
   blank lines, and malformed payloads are skipped, never fatal. */
export function parseDocSseLine(line) {
  if (!line) return null;
  const t = String(line).trim();
  if (!t.startsWith("data:")) return null;
  const payload = t.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const ev = JSON.parse(payload);
    return ev && typeof ev === "object" ? ev : null;
  } catch {
    return null;
  }
}

/* Stream /api/document over SSE. `body` is the JSON request body, in the
 * backend's contract: { documentText, query?, history?, stream: true }.
 * The presence of `query` selects Q&A mode; its absence selects analysis.
 * `stream: true` selects the SSE transport parsed here (without it the
 * backend answers plain JSON). There is no `mode` field — one by that
 * name would be silently ignored, so callers must not send it.
 * Resolves with the "done" event payload. Throws when:
 *  - the response is not OK (err.code carries the backend's code, e.g.
 *    "auth_required" or "doc_quota_exhausted", so the UI can route the
 *    person to sign-in or Pro instead of showing a dead error),
 *  - the backend sends an "error" event mid-stream,
 *  - the request is aborted,
 *  - the stream ends without a "done" event (err.code =
 *    "incomplete_stream") — the caller must discard any partial text,
 *    because a half-written answer must never stand as the final one.
 */
export async function streamDocumentApi(body, opts = {}) {
  const { onToken, onQuota, signal, timeoutMs = 60000 } = opts;
  // Abort wiring: the caller's signal (user pressed cancel) and an
  // internal timeout (hung connection — the old frontend used 60s) both
  // abort the fetch, with distinct codes so the UI can say "canceled"
  // instead of "took too long" and vice versa.
  const ctrl = new AbortController();
  let timer = null;
  const forwardAbort = () => { try { ctrl.abort(signal.reason); } catch {} };
  if (signal) {
    if (signal.aborted) forwardAbort();
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      try { ctrl.abort(new DOMException("The request took too long.", "TimeoutError")); } catch {}
    }, timeoutMs);
  }
  const settled = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (signal) signal.removeEventListener("abort", forwardAbort);
  };
  const abortError = () => {
    const reason = ctrl.signal.reason;
    const e = new Error(
      reason && reason.name === "TimeoutError"
        ? "The request took too long. Please try again."
        : "The request was canceled."
    );
    e.code = reason && reason.name === "TimeoutError" ? "timeout" : "aborted";
    return e;
  };
  let res;
  try {
    res = await fetch("/api/document", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    settled();
    throw abortError();
  }
  if (!res.ok) {
    settled();
    const data = await res.json().catch(() => ({}));
    const err = new Error(
      (data && data.error) || "The document service didn't respond. Please try again."
    );
    err.code = (data && data.code) || null;
    throw err;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const ev = parseDocSseLine(line);
        if (!ev) continue;
        if (ev.type === "token") {
          if (ev.text && onToken) onToken(ev.text);
        } else if (ev.type === "quota") {
          if (onQuota) onQuota();
        } else if (ev.type === "done") {
          donePayload = ev;
        } else if (ev.type === "error") {
          const e = new Error(
            ev.error || "The document service reported an error. Please try again."
          );
          e.code = ev.code || null;
          throw e;
        }
      }
    }
  } catch (e) {
    try { reader.releaseLock(); } catch {}
    settled();
    // An abort mid-stream (user cancel or the 60s timeout) surfaces here
    // as the read rejects; backend "error" events rethrow untouched.
    if (ctrl.signal.aborted) throw abortError();
    throw e;
  }
  try { reader.releaseLock(); } catch {}
  settled();
  if (!donePayload) {
    const e = new Error(
      "The response stopped before it was finished, so nothing is shown as final. Please try again."
    );
    e.code = "incomplete_stream";
    throw e;
  }
  return donePayload;
}

/* Highlight overlap guard: a new highlight must not overlap an existing
   one (adjacent, touching at exactly one edge, is fine). Overlapping
   ranges would make the marked-text renderer ambiguous. */
export function canAddHighlight(highlights, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  return !(highlights || []).some((h) => start < h.end && end > h.start);
}

/* A human title for a document: the first substantial line, capped. */
export function docTitleOf(text) {
  const line = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 12);
  if (!line) return "Untitled document";
  return line.length > 80 ? line.slice(0, 77) + "…" : line;
}

/* Durable per-document reading state. Shape:
 *   { docs: { [fingerprint]: { title, text, summary, qaHistory, rightTab,
 *     highlights, docB, compareResult, scrollY, updatedAt } },
 *     lastOpened: fingerprint|null }
 * Streaming (unfinished) payloads are never persisted — callers strip
 * them before saving, so a reload can never resurrect a partial answer
 * as if it were final. */
export function loadDocStore() {
  try {
    const raw = localStorage.getItem(DOCMODE_STORE_KEY);
    if (!raw) return { docs: {}, lastOpened: null };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.docs || typeof parsed.docs !== "object") {
      return { docs: {}, lastOpened: null };
    }
    return parsed;
  } catch {
    return { docs: {}, lastOpened: null };
  }
}

export function saveDocStore(store) {
  try {
    localStorage.setItem(DOCMODE_STORE_KEY, JSON.stringify(store));
  } catch {
    /* Private mode / quota: reading still works, it just won't persist. */
  }
}
