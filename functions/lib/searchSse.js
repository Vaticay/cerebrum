/**
 * functions/lib/searchSse.js — Server-Sent Events path for search answers
 * (nuance #23).
 *
 * The single-fetch path (/api/search POST) stays the default and the
 * fallback. Appending ?stream=1 switches the response to an SSE stream
 * that emits the pipeline's real stage transitions as they happen:
 *
 *   question_understood → finding_papers → screening_sources →
 *   synthesizing → checking_citations → done
 *
 * Each event carries a per-event JSON payload (see STAGE_PAYLOADS in the
 * search.js wiring for the exact shapes) and a monotonically increasing
 * `id:`. The client renders staged progress from these instead of staring
 * at one long spinner, and batches DOM updates on its own ~50ms cadence.
 *
 * LAST-EVENT-ID RESUME. EventSource reconnects automatically and sends the
 * last id it saw as Last-Event-ID. The server does NOT checkpoint mid-
 * pipeline (the pipeline is not restartable halfway) — instead it replays
 * nothing: events with id <= the resume id are suppressed from the fresh
 * stream, because the client already has them. The fresh run re-executes
 * the same deterministic stage sequence, so ids line up and the client
 * receives exactly the stages it hasn't seen. A reconnect with no
 * Last-Event-ID (or an id of 0) gets the full stream.
 *
 * TRANSPORT. Content-Type: text/event-stream, no-store, and an initial
 * `: ping` comment so intermediaries flush headers immediately. The stream
 * is a WHATWG TransformStream; the handler returns the readable side
 * immediately and the pipeline writes as phases complete. A final `done`
 * event carries the same JSON body the single-fetch path would have
 * returned, so the client needs no second request.
 */

export const STREAM_STAGES = [
  "question_understood",
  "finding_papers",
  "screening_sources",
  "synthesizing",
  "checking_citations",
  "done",
];

/** Parse Last-Event-ID into a non-negative int, or 0 when absent/invalid. */
export function parseLastEventId(request) {
  try {
    const raw = request && request.headers && request.headers.get("Last-Event-ID");
    const n = Number(String(raw || "").trim());
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function encodeEvent(id, event, data) {
  const lines = [`id: ${id}`, `event: ${event}`];
  const json = JSON.stringify(data == null ? {} : data);
  // data: lines must not contain raw newlines per the SSE spec.
  for (const chunk of json.split("\n")) lines.push(`data: ${chunk}`);
  return lines.join("\n") + "\n\n";
}

/**
 * Create an SSE sink. Returns { readable, emit(event, data), close }.
 * emit() is async (backpressure-safe) and no-ops after close(). Events
 * with id <= resumeFrom are suppressed (Last-Event-ID resume).
 */
export function createSseStream({ resumeFrom = 0 } = {}) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let id = 0;
  let closed = false;
  const resume = Math.max(0, Math.floor(Number(resumeFrom) || 0));

  // Flush headers through proxies/CDNs that buffer otherwise.
  const hello = writer.write(enc.encode(": connected\n\n")).catch(() => { closed = true; });

  async function emit(event, data) {
    if (closed) return false;
    id += 1;
    if (id <= resume) return true; // client already saw this stage
    try {
      await hello;
      await writer.write(enc.encode(encodeEvent(id, event, data)));
      return true;
    } catch {
      closed = true;
      return false;
    }
  }

  async function close() {
    if (closed) return;
    closed = true;
    try { await writer.close(); } catch { /* already errored */ }
  }

  return { readable, emit, close, get lastId() { return id; } };
}

/** Response headers for the SSE stream, merged over the route's CORS set. */
export function sseHeaders(baseHeaders) {
  return {
    ...(baseHeaders || {}),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // nginx: don't buffer the stream
  };
}

/** Is this request asking for the SSE path? POST + ?stream=1. */
export function wantsStream(request) {
  try {
    if (!request || request.method !== "POST") return false;
    return new URL(request.url).searchParams.get("stream") === "1";
  } catch {
    return false;
  }
}
