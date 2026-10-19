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
 *    Event protocol (backend: functions/api/document.js):
 *      quota    — { quota } usage info, sent first.
 *      start    — { mode, chunks, phase } the work plan up front; when
 *                 chunks > 0 the client seeds its progress bar via
 *                 onProgress(0, chunks, "map") immediately instead of
 *                 discovering the total mid-stream.
 *      progress — { phase: "map"|"reduce", done, total }; forwarded as
 *                 onProgress(done, total, phase). "map" ticks per settled
 *                 chunk ("Reading section X of Y"); "reduce" brackets the
 *                 final synthesis.
 *      token    — { text } Q&A answer tokens (summaries arrive whole).
 *      done     — the final payload. The backend never fails an analysis:
 *                 a degraded result arrives as done with partial:true,
 *                 missingSections:[...], and per-chunk `sections` digests
 *                 the client can pass back as `priorSections` to resume
 *                 only the missing chunks.
 *      error    — last resort only; throws with the backend's message/code.
 *  - canAddHighlight: overlap guard for text highlights.
 *  - docTitleOf: a human title for a document (recent-documents list).
 *  - loadDocStore / saveDocStore: localStorage persistence for
 *    per-document reading state. Loads degrade to an empty store
 *    instead of throwing; saves report success or failure so the
 *    caller can tell the reader when a document did not persist.
 *  - evictOldestDocs / docEvictionNote: the shelf's size cap, and the
 *    plain words that name an eviction instead of letting a document
 *    vanish silently.
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
  const { onToken, onQuota, onProgress, signal, timeoutMs = 60000 } = opts;
  // Abort wiring: the caller's signal (user pressed cancel) and an
  // internal timeout (hung connection — the old frontend used 60s) both
  // abort the fetch, with distinct codes so the UI can say "canceled"
  // instead of "took too long" and vice versa.
  const ctrl = new AbortController();
  let timer = null;
  const forwardAbort = () => { try { ctrl.abort(signal.reason); } catch (cbErr) { console.error("[Cerebrum] docReader.js forwardAbort: ctrl.abort(signal.reason); }:", cbErr); } };
  if (signal) {
    if (signal.aborted) forwardAbort();
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }
  // Sliding idle timeout, not a deadline: the timer re arms on every
  // chunk that arrives, so a long answer that is streaming steadily is
  // never killed mid flow, while a genuinely hung connection still
  // dies timeoutMs after its last byte. The old code armed one fixed
  // timer at call start, so a healthy 120 second stream was cut at
  // exactly 120 seconds from the first byte.
  const armTimer = () => {
    if (!(timeoutMs > 0)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try { ctrl.abort(new DOMException("The request took too long.", "TimeoutError")); } catch (cbErr) { console.error("[Cerebrum] docReader.js armTimer: ctrl.abort TimeoutError:", cbErr); }
    }, timeoutMs);
  };
  armTimer();
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
  armTimer();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armTimer();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const ev = parseDocSseLine(line);
        if (!ev) continue;
        if (ev.type === "token") {
          if (ev.text && onToken) onToken(ev.text);
        } else if (ev.type === "quota") {
          // The quota event carries usage info sent first by the backend;
          // forward it so callers can update their quota display.
          if (onQuota) onQuota(ev.quota ?? ev);
        } else if (ev.type === "start") {
          // The backend announces the work plan before any chunk lands:
          // seed the progress bar with the real total immediately, so the
          // "Reading section X of Y" UI never starts from an unknown.
          // phase is forwarded as a third onProgress arg (additive — the
          // existing (done, total) callers are unaffected).
          if (onProgress && Number.isFinite(ev.chunks) && ev.chunks > 0) onProgress(0, ev.chunks, ev.phase || "map");
        } else if (ev.type === "progress") {
          // Long-document map/reduce: the backend digests the document
          // section by section before writing the summary. Forward the
          // counts so the UI can show real progress instead of a spinner.
          if (onProgress && Number.isFinite(ev.done) && Number.isFinite(ev.total)) onProgress(ev.done, ev.total, ev.phase);
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
    try { reader.releaseLock(); } catch (cbErr) { console.error("[Cerebrum] docReader.js catch: reader.releaseLock(); }:", cbErr); }
    settled();
    // An abort mid-stream (user cancel or the 60s timeout) surfaces here
    // as the read rejects; backend "error" events rethrow untouched.
    if (ctrl.signal.aborted) throw abortError();
    throw e;
  }
  try { reader.releaseLock(); } catch (cbErr) { console.error("[Cerebrum] docReader.js catch: reader.releaseLock(); }:", cbErr); }
  settled();
  if (!donePayload) {
    const e = new Error(
      "The response stopped before it finished. Nothing is shown as final. Please try again."
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

/* Rebase a saved Q&A history onto the trimmed text basis.
   The durable store keeps the document text TRIMMED, while a live
   session's evidence offsets index the text exactly as pasted,
   leading whitespace included. Highlights are rebased by the trim
   delta at save time; the Q&A history's evidence entries need the
   same treatment, or a reopened document's trail prints offsets
   into a basis the reader no longer shows (every offset too large
   by the paste's leading whitespace). Only verified entries carry
   real offsets (unverified ones are -1, and stay -1); each offset
   shifts by leadTrim and clamps into the stored text, the same
   arithmetic the highlight rebase uses. Entries and evidence are
   copied, never mutated. */
export function rebaseQaHistoryOffsets(qaHistory, leadTrim, textLength) {
  const lead = Number.isFinite(leadTrim) && leadTrim > 0 ? leadTrim : 0;
  const len = Number.isFinite(textLength) && textLength >= 0 ? textLength : 0;
  if (!lead) return qaHistory;
  return (qaHistory || []).map((h) => {
    if (!h || !Array.isArray(h.evidence) || h.evidence.length === 0) return h;
    return {
      ...h,
      evidence: h.evidence.map((e) => {
        if (!e || !e.verified || !Number.isFinite(e.start) || !Number.isFinite(e.end) || e.start < 0 || e.end < 0) return e;
        return { ...e, start: Math.max(0, e.start - lead), end: Math.max(0, Math.min(e.end - lead, len)) };
      }),
    };
  });
}

/* A human title for a document: the first substantial line, capped. */
/* Journal front matter lines (2026-10-17): a submission history
   line ("Received: 7 October 2025. Revised: 24 February 2026.
   Accepted: 12 March 2026"), a copyright or DOI line, or a keyword
   line is metadata about the paper, never its title. PDF extraction
   often places these ahead of the title, and the first long line
   won by default — the owner's 2026-10-16 photo shows the analysis
   masthead headlined by the submission dates. The screen mirrors
   the backend extractive fallback's (functions/api/document.js,
   isFrontMatterSentence), in the line shapes a title hunt meets. */
function isFrontMatterLine(l) {
  if (/^(copyright|©|all rights reserved|doi\s*:|https?:\/\/doi\.org\/|issn\b|keywords?\b)/i.test(l)) return true;
  if (/^(received|revised|accepted|available online|published online|first published)\s*:/i.test(l)) return true;
  const labels = l.match(/\b(received|revised|accepted)\b/gi);
  if (labels && labels.length >= 2 && /\d{4}/.test(l)) return true;
  if (/\bwas published by\b/i.test(l) && /\bon behalf of\b/i.test(l)) return true;
  if (/^the (study|paper|article|work) was published\b/i.test(l)) return true;
  return false;
}

export function docTitleOf(text) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim());
  const idx = lines.findIndex((l) => l.length > 12 && !isFrontMatterLine(l));
  if (idx < 0) return "Untitled document";
  let title = lines[idx];
  /* Wrapped titles (2026-10-19, M35): PDF text wraps a real title
     across lines, and taking the first surviving line only left
     titles cut mid phrase, the bundled sample's own two line title
     among them, ending at its colon. When the title line ends in a
     colon or a comma, or the next line plainly continues it by
     starting lowercase, join the lines before display. The front
     matter screen above still decides which line may headline at
     all, and a metadata line is never joined in. A joined title is
     shown whole rather than capped, since capping it would cut the
     very title the join recovered. */
  let joined = false;
  for (let i = idx + 1; i < lines.length && i <= idx + 2; i++) {
    const next = lines[i];
    if (!next || isFrontMatterLine(next)) break;
    const continues = /[:,]$/.test(title) || (/^[a-z]/.test(next) && !/[.!?]$/.test(title));
    if (!continues) break;
    title = `${title} ${next}`;
    joined = true;
  }
  if (joined) return title;
  return title.length > 80 ? title.slice(0, 77) + "…" : title;
}

/* Heading detection for plain document text, used to give the Read
   view an outline and typeset sections. Conservative on purpose: a
   line only counts when it is short, set off by a blank line or the
   start of the document, and shaped like a heading (a markdown
   marker, a numbered section, all caps, or mostly title case). A
   missed heading costs little; a sentence promoted to a heading
   costs trust. Returns [{ title, start, end }] with character
   offsets into the original text. */
export function detectDocHeadings(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const start = offset;
    offset += raw.length + 1;
    if (!line || line.length < 3 || line.length > 78) continue;
    const prevBlank = i === 0 || lines[i - 1].trim() === "";
    if (!prevBlank) continue;
    if (/[.!?]$/.test(line) && !/^#{1,4}\s/.test(line)) continue;
    let title = null;
    const md = line.match(/^#{1,4}\s+(.+)$/);
    if (md) title = md[1].trim();
    else if (/^\d+(\.\d+){0,3}\s+[A-Z]/.test(line)) title = line;
    else if (/^[A-Z0-9][A-Z0-9 ,&'’\-:()]{2,}$/.test(line) && /[A-Z]{3,}/.test(line)) title = line;
    else {
      const words = line.split(/\s+/).filter(Boolean);
      if (words.length === 1 && /^[A-Z][A-Za-z]{2,29}$/.test(words[0])) {
        // A lone capitalized word on its own blank separated line is
        // a section head in paper text: Abstract, Introduction,
        // References. Sentences do not sit alone like that.
        title = line;
      } else if (words.length >= 2 && words.length <= 9) {
        const capped = words.filter((w) => /^[A-Z0-9]/.test(w)).length;
        if (capped / words.length >= 0.7) title = line;
      }
    }
    if (title) out.push({ title, start, end: start + raw.length });
  }
  return out;
}

/* Split a document into segments at its headings. The segments
   partition the text exactly (heading lines are their own segments,
   every other character lands in a body segment), so character
   offsets measured across the rendered segments still match offsets
   in the original text, which is what highlights are stored against. */
export function buildDocSegments(text, headings) {
  const t = String(text || "");
  if (!headings || !headings.length) return [{ start: 0, text: t, heading: null }];
  const segs = [];
  let pos = 0;
  for (const h of headings) {
    if (h.start > pos) segs.push({ start: pos, text: t.slice(pos, h.start), heading: null });
    segs.push({ start: h.start, text: t.slice(h.start, h.end), heading: h.title });
    pos = h.end;
  }
  if (pos < t.length) segs.push({ start: pos, text: t.slice(pos), heading: null });
  return segs;
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

/* Persist the store. Returns true when the write landed and false
   when it did not (private mode, quota): a failed save must not look
   identical to a successful one, because the reader is owed the
   difference. Reading still works either way; it just won't persist. */
export function saveDocStore(store) {
  try {
    localStorage.setItem(DOCMODE_STORE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/* Enforce the shelf cap on a store, oldest first by updatedAt, and
   report what was removed as [{ fp, title }] so the caller can name
   the eviction to the reader. A document must never disappear from
   the shelf without a word. Mutates the store it is given. */
export function evictOldestDocs(store, maxDocs = DOCMODE_MAX_DOCS) {
  if (!store || typeof store !== "object" || !store.docs || typeof store.docs !== "object") return [];
  const fps = Object.keys(store.docs).sort((a, b) => (store.docs[a].updatedAt || 0) - (store.docs[b].updatedAt || 0));
  const evicted = [];
  while (fps.length > maxDocs) {
    const fp = fps.shift();
    const entry = store.docs[fp];
    evicted.push({ fp, title: entry && entry.title ? entry.title : "Untitled document" });
    delete store.docs[fp];
  }
  return evicted;
}

/* Reader facing words for an eviction, in the shelf's own voice.
   Empty string when nothing was evicted, so render sites can show
   the result only when it says something. No dashes, house rule. */
export function docEvictionNote(evicted) {
  if (!Array.isArray(evicted) || evicted.length === 0) return "";
  if (evicted.length === 1) return `The oldest document was removed to make room: ${evicted[0].title}.`;
  return `The ${evicted.length} oldest documents were removed to make room: ${evicted.map((e) => e.title).join(", ")}.`;
}

/* Delete one document from the shelf. Returns true when something was
   removed. There was previously no way to delete a document at all — a
   pasted confidential draft sat in plaintext localStorage until LRU
   eviction displaced it. */
export function deleteDocFromStore(fp) {
  try {
    const store = loadDocStore();
    if (!store.docs || !store.docs[fp]) return false;
    delete store.docs[fp];
    if (store.lastOpened === fp) store.lastOpened = null;
    saveDocStore(store);
    return true;
  } catch {
    return false;
  }
}
