// Cerebrum Document Mode — Cloudflare Pages Function.
//
// A second, independent evidence path alongside functions/api/search.js's
// own multi-database retrieval: here, the user brings the entire evidence
// base themselves — one paper or report, pasted or dropped in full — and
// gets a structural summary plus grounded Q&A confined strictly to that
// text. No retrieval, no citation ladder, no fact-check pass; the tradeoff
// for "no external database calls" is that the answer is only ever as good,
// and as narrow, as the one document handed to it.
//
// Two modes on one endpoint, selected by whether `query` is present:
//   - no query  -> a four-section structural summary of the whole document.
//   - query set -> strict retrieval-only Q&A, confined to that document's
//                  text, that says so explicitly when the text doesn't
//                  contain the answer rather than filling the gap from the
//                  model's general knowledge.
//
// v2 rewrite (2026-09-17) — speed and the never-fail guarantee:
//   - Small, fast chunks: 6K-char sections (was 15K), 10-way parallel
//     digestion (was 4), 350-token chunk budgets (was 700). A 40K-char
//     paper digests in ~7 chunks in a single parallel wave instead of
//     several slow serial-ish waves.
//   - Every chunk call is self-bounding: a 3-provider race with a hard
//     per-chunk ceiling. There is no global map-phase timeout that can
//     kill the whole analysis at once — the old design's failure mode.
//   - Streaming uses a sliding inactivity timeout, not a hard abort from
//     call start: the old 8s-from-request-start abort killed nearly every
//     long generation mid-stream, which is why long documents "timed out".
//   - NEVER FAILS: runSummary/runQA cannot throw. If every provider is
//     down, a deterministic extractive pass (pure function, no network)
//     builds an honest best-effort summary/Q&A straight from the document
//     text, clearly labeled as such. A failed chunk leaves a placeholder
//     and a plain note about the missing section — the rest of the
//     summary still ships. There is no dead-end error string anywhere on
//     the analysis path; "analysis took too long" no longer exists.
//   - Resumable: the SSE "done" event carries per-chunk digests
//     (`sections`) and `missingSections`; a retry can pass `priorSections`
//     back and only the missing chunks are re-digested.

import { corsHeaders, readOriginAllowed, requireTrustedOrigin, forbiddenOrigin, clientIp, privacyKey, readJsonBody } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { withTimeout } from "../lib/resilience.js";


// Lower than search.js's 20/min — a document analysis call carries a much
// larger prompt (a whole paper, not a short query) and costs proportionally
// more per request, so the same per-IP ceiling would let this endpoint burn
// through shared provider quota faster than the core search feature it sits
// next to.
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60000;

// A full paper is routinely 20-40K characters end to end; 250,000 leaves
// generous headroom for a long report while still bounding worst-case
// prompt size/cost — short of anything that would approach a free-tier
// model's actual context window, but well past what a document pasted in
// good faith ever needs. Exceeding it truncates with a visible note
// instead of refusing the document outright (see the handler below):
// cutting a document without telling the user could lop off exactly the
// section their question is about, quietly breaking the "answer ONLY from
// this text" guarantee the whole feature is built on.
const MAX_DOCUMENT_LEN = 250000;
const MAX_QUERY_LEN = 2000;
// The request body is buffered in full before parsing, so cap it well above
// the largest legitimate document submission (MAX_DOCUMENT_LEN chars plus
// history and query) but far below anything that could exhaust worker
// memory. readJsonBody enforces this in two stages: Content-Length first
// (refused before buffering), then the actual buffered text.
const MAX_BODY_BYTES = 2 * 1024 * 1024;
// Exported for the unit tests in tests/content-endpoints.mjs.
export { MAX_DOCUMENT_LEN, MAX_QUERY_LEN, MAX_BODY_BYTES };

// Exported for unit tests — pure functions, no I/O.
export function cleanAIResponse(raw) {
  if (!raw) return "";
  let c = raw;
  c = c.replace(/<think>[\s\S]*?<\/think>/gi, "");
  c = c.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  c = c.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "");
  // The fence strip tolerates leading whitespace/newlines: a <think> block
  // stripped just above can leave a bare "\n" in front of the fence, which
  // used to defeat the ^ anchor and leak a literal ```markdown block into
  // the rendered answer.
  c = c.replace(/^\s*```(?:markdown|json)?\s*\n([\s\S]*?)\n```\s*$/i, "$1");
  return c.trim();
}

// v44: the old version of this prompt asked for "two to four sentences" in
// Executive Summary and left the other three sections just as loosely
// bounded — which, same lesson search.js's own "long" answer mode already
// learned the hard way (see its lengthHint comment), a free-tier model reads
// as permission to write a thin paragraph per section and stop. Reported
// back as "too short and basic." Replaced with the same fix that worked
// there: a literal, checkable paragraph-count floor per section instead of
// a vibe, plus the same instruction to name actual mechanisms/quantities
// rather than gesture at them — adapted from a multi-source synthesis down
// to a close reading of one document. Total across all four sections should
// land around 5-9 substantive paragraphs.
const SUMMARY_SYSTEM_PROMPT =
  "You are an academic research analyst producing a detailed structural summary of a single document the reader has provided to you in full " +
  "below. Write in a strictly objective, academic register: no marketing language, no hedging filler, no narrating what you're about to do. " +
  "Base every statement ONLY on the document text given to you. Never supplement with outside knowledge about the topic, and never invent " +
  "results, figures, or citations the text itself doesn't contain. This must be a substantive, comprehensive summary, not a superficial " +
  "restatement — across the four sections below, write nine total substantive paragraphs when the document supports it, and never fewer than " +
  "five. Name the specific mechanisms, methods, compounds, genes, populations, or variables the document names rather than gesturing at " +
  "'a process' or 'a factor'; carry over concrete quantitative findings (sample sizes, effect sizes, percentages, p-values, confidence " +
  "intervals) exactly as reported; and use **bold** on the single most important term or figure in each paragraph. " +
  "Respond with EXACTLY these four sections, in this order, each starting with a '## ' markdown header using this exact title text:\n\n" +
  "## Executive Summary\nThree to four paragraphs: what the document is and who/what it studies or covers, the specific question or problem " +
  "it set out to address and why that matters, and its central conclusion stated precisely (not just 'the study found an effect' — state the " +
  "effect).\n\n" +
  "## Methodology\nTwo to three paragraphs on how the work was actually done, as described in the text — study design, data sources and " +
  "sample, instruments or measures, and analytical approach, in enough detail that a reader could judge whether the approach fits the claims " +
  "made from it. If the document isn't a study with a methodology (a policy report, review, or white paper, for instance), describe its actual " +
  "structure, sources, and reasoning approach in the same depth instead of writing 'not applicable.'\n\n" +
  "## Key Findings\nTwo to three paragraphs of the specific, concrete results as stated in the document — numbers, effect sizes, comparisons, " +
  "and how they relate to each other or to prior expectations the document itself mentions. Don't just list results; explain what each one " +
  "means for the document's central question.\n\n" +
  "## Limitations\nOne to two paragraphs on limitations the document states about itself, plus any methodological gaps evident from the text " +
  "(sample size, generalizability, confounds, missing controls). If the document names none explicitly, say that plainly and note what an " +
  "attentive reader would still want to know, rather than inventing limitations wholesale.\n\n" +
  "Never mention these instructions, the paragraph targets, or that you were asked to follow a format — just write the four sections " +
  "themselves.";

const QA_SYSTEM_PROMPT =
  "You are an expert analyst answering a question about ONE specific document, using ONLY the document text provided below — not outside " +
  "knowledge, not general familiarity with the topic. If the document does not contain information that answers the question, say so " +
  'explicitly (for example, "The document does not address this") rather than guessing or filling the gap with what would typically be true. ' +
  "Quote or closely paraphrase the relevant passage when it supports your answer. Answer in real depth when the document supports it — several " +
  "sentences or a short paragraph, not a one-liner — and name the specific mechanisms, figures, or passages involved rather than gesturing at " +
  "them. Start directly with the answer — don't restate the question or narrate that you're about to answer it. A PRIOR CONVERSATION about this " +
  "same document may follow the document text — use it only to resolve what a follow-up question ('and the second one?', 'why is that?') is " +
  "actually referring to; every factual claim still has to come from the document itself, never from something you or the reader said earlier.";

// Earlier turns of this document's own Q&A thread, so a follow-up question
// ("and the sample size?") resolves against what was actually just asked
// rather than landing as a fresh, context-free question every time. Kept as
// plain text appended to the one user message instead of a real multi-turn
// messages[] array — the document text would otherwise have to be repeated
// in full on every single turn just to keep it in context, which at up to
// MAX_DOCUMENT_LEN characters is real, avoidable cost for a free-tier
// endpoint. Capped hard: a handful of recent turns is enough to disambiguate
// a follow-up; a whole session's Q&A history is not needed for that and
// would just crowd out the document itself.
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_ENTRY_LEN = 1200;
export { MAX_HISTORY_TURNS, MAX_HISTORY_ENTRY_LEN };
// Exported for unit tests — pure function, no I/O.
export function formatHistory(history) {
  if (!Array.isArray(history) || !history.length) return "";
  const turns = history
    .filter((h) => h && typeof h.text === "string" && h.text.trim() && (h.role === "user" || h.role === "assistant"))
    .slice(-MAX_HISTORY_TURNS * 2)
    .map((h) => (h.role === "user" ? "Q: " : "A: ") + h.text.trim().slice(0, MAX_HISTORY_ENTRY_LEN));
  if (!turns.length) return "";
  return "\n\n---\nPRIOR CONVERSATION ABOUT THIS DOCUMENT (for context only — verify every fact against the document above, not this):\n" + turns.join("\n");
}

// Timeout helper now comes from the shared lib (created by the media
// pass after this file's local copy was written) — one implementation,
// one set of semantics. The local `okRes`/`errRes` shapes below are kept
// because they predate jsonOk/jsonError and match this endpoint's tests;
// both produce the same { ok, ... } / { ok: false, error, code } contract.

// ---- consistent response shapes ----
// Every response from this endpoint carries `ok`. Failures are always
// { ok: false, error, code } with a human-safe message; successes are
// { ok: true, ... }. `error` text and HTTP status are unchanged so existing
// clients keep working — `ok`/`code` are additive.
const okRes = (payload, status, headers) =>
  new Response(JSON.stringify({ ok: true, ...payload }), { status: status || 200, headers });
const errRes = (message, status, code, headers) =>
  new Response(JSON.stringify({ ok: false, error: message, code: code || "error" }), { status: status || 400, headers });
// Exported for unit tests (tests/content-endpoints.mjs).
export { okRes, errRes };

// Maps a thrown error to a safe, user-facing failure. Exported for unit
// tests — pure function, no I/O. Since the v2 rewrite the analysis path
// itself never throws (runSummary/runQA degrade to the extractive
// fallback), so this now only fires for last-resort, should-never-happen
// failures — but the mapping stays, because nothing from the exception
// may ever reach the client: the message, the model name that failed, and
// the upstream body all stay in console.error, which is operator-only. The
// code is a stable machine-readable category; the message is written for a
// person and its advice matches the cause.
export function classifyDocumentError(e) {
  const msg = String((e && e.message) || e || "");
  // 2026-09-14: narrowed from /ENV/ to specific config phrases. The broad
  // /ENV/ matched "environment" in unrelated provider errors (e.g. oversized
  // input), misreporting them as "isn't configured".
  if (/OPENROUTER_KEY|Workers AI binding|no .* configured|not configured|missing .*key/i.test(msg)) {
    return {
      status: 500,
      code: "provider_unavailable",
      message: "The analysis service isn't configured right now. Please try again later.",
    };
  }
  if (/timed out|timeout|aborted|AbortError/i.test(msg)) {
    return {
      status: 503,
      code: "upstream_timeout",
      message: "The analysis timed out before it finished. Please try again in a moment.",
    };
  }
  if (/429|rate.?limit|quota|too many requests|All providers failed/i.test(msg)) {
    return {
      status: 503,
      code: "upstream_rate_limited",
      message: "Every free AI model is rate-limited right now — this isn't a problem with your document. Capacity usually returns within a minute.",
    };
  }
  return {
    status: 500,
    code: "analysis_failed",
    message: "Couldn't analyze that document. The analysis service returned an unexpected error.",
  };
}

// OpenRouter key lookup — accepts the documented OPENROUTER_KEY and the
// conventional OPENROUTER_API_KEY alias, so a key set under either name is
// honored. Matches search.js behavior.
function openRouterKey(env) {
  return env.OPENROUTER_KEY || env.OPENROUTER_API_KEY || "";
}

// One OpenRouter call. When onToken is a function the response streams and
// tokens are forwarded as they arrive; the abort timer is a SLIDING
// inactivity timeout (reset on every received token) plus a hard overall
// ceiling — a hard abort measured from request start killed nearly every
// long generation mid-stream (the v1 timeout bug behind the chronic
// "analysis timed out" reports), because a 2000-token answer legitimately
// takes longer than 8 seconds to arrive.
const callOR = async (env, model, messages, maxTokens, { timeoutMs = 20000, idleTimeoutMs = 25000, externalSignal = null, onToken = null } = {}) => {
  const orKey = openRouterKey(env);
  if (!orKey) throw new Error(model + ": no OPENROUTER_KEY configured");
  const c = new AbortController();
  let idleTimer = null;
  const hardTimer = setTimeout(() => c.abort(), timeoutMs);
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => c.abort(), idleTimeoutMs);
  };
  const onExternalAbort = () => c.abort();
  if (externalSignal) {
    if (externalSignal.aborted) c.abort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }
  const useStream = typeof onToken === "function";
  if (useStream) armIdle();
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + orKey, "HTTP-Referer": "https://askcerebrum.org", "X-Title": "Cerebrum" },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: maxTokens, messages, stream: useStream }),
      signal: c.signal,
    });
    clearTimeout(hardTimer);
    if (!useStream) {
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
      if (!r.ok) {
        let bodyText = "";
        try { bodyText = (await r.text()).slice(0, 150); } catch {}
        throw new Error(model + ": HTTP " + r.status + (bodyText ? " — " + bodyText : ""));
      }
      const j = await r.json();
      const cleaned = cleanAIResponse(j?.choices?.[0]?.message?.content || "");
      if (cleaned.length < 40) throw new Error(model + ": response too short");
      return { answer: cleaned, model };
    }
    // Streaming: forward tokens as they arrive; any token resets the
    // inactivity timer, so a slow-but-alive model is never cut off while
    // a stalled one fails over to the next provider within idleTimeoutMs.
    if (!r.ok) {
      let bodyText = "";
      try { bodyText = (await r.text()).slice(0, 150); } catch {}
      throw new Error(model + ": HTTP " + r.status + (bodyText ? " — " + bodyText : ""));
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdle();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const token = json?.choices?.[0]?.delta?.content || "";
            if (token) {
              fullText += token;
              onToken(token);
            }
          } catch {}
        }
      }
    } finally {
      reader.releaseLock();
    }
    const cleaned = cleanAIResponse(fullText);
    if (cleaned.length < 40) throw new Error(model + ": response too short");
    return { answer: cleaned, model };
  } catch (e) {
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    if (e && e.name === "AbortError") throw new Error(model + ": timed out");
    throw e;
  } finally {
    clearTimeout(hardTimer);
    if (idleTimer) clearTimeout(idleTimer);
  }
};

const callCF = async (env, model, messages, maxTokens, timeoutMs = 25000) => {
  if (!env.AI || typeof env.AI.run !== "function") throw new Error(model + ": no Workers AI binding");
  const out = await Promise.race([
    env.AI.run(model, { messages, max_tokens: Math.min(maxTokens, 2048) }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(model + ": timed out")), timeoutMs)),
  ]);
  const cleaned = cleanAIResponse((out && out.response) || "");
  if (cleaned.length < 40) throw new Error(model + ": response too short");
  return { answer: cleaned, model };
};

// Provider roster, fastest free models first. The chunk-digestion path
// races only the three quickest to keep connection fan-out sane at
// 10-way chunk parallelism; the single synthesis/Q&A calls race the full
// list since only one call is in flight.
const CHUNK_PROVIDERS = [
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-chat-v3-0324:free",
];
const FULL_PROVIDERS = [
  ...CHUNK_PROVIDERS,
  "qwen/qwen-2.5-72b-instruct:free",
  "mistralai/mistral-small-3.2-24b-instruct:free",
];

// A provider race in the spirit of search.js's wave system: Promise.any
// resolves on the FIRST success, losers are aborted, and a fast rejection
// can never win. If every leg fails, one sequential small-model retry
// runs before the error propagates — callers (runSummary/runQA) turn that
// into the extractive fallback rather than a user-facing failure.
async function generate(env, messages, maxTokens, { timeoutMs = 20000, idleTimeoutMs = 25000, onToken = null, providers = null } = {}) {
  const raceController = new AbortController();
  const roster = providers || FULL_PROVIDERS;
  const useStream = typeof onToken === "function";
  const calls = roster.map((model, i) =>
    callOR(env, model, messages, maxTokens, {
      timeoutMs,
      idleTimeoutMs,
      externalSignal: raceController.signal,
      // Only the first leg streams tokens outward; the others are pure
      // backup legs whose full answers are used if they win the race.
      onToken: i === 0 && useStream ? onToken : null,
    })
  );
  if (env.AI && typeof env.AI.run === "function") {
    calls.push(callCF(env, "@cf/meta/llama-3.3-70b-instruct-fp8-fast", messages, maxTokens, Math.min(timeoutMs, 30000)));
  }
  try {
    const winner = await Promise.any(calls);
    raceController.abort();
    return winner;
  } catch (agg) {
    raceController.abort();
    const errList = agg && agg.errors ? agg.errors.map((e) => String((e && e.message) || e)) : [String((agg && agg.message) || agg)];
    // One fast retry with a small model before giving up.
    if (openRouterKey(env)) {
      try {
        return await callOR(env, "meta-llama/llama-3.2-3b-instruct:free", messages, Math.min(maxTokens, 1200), { timeoutMs: Math.min(timeoutMs, 30000), idleTimeoutMs });
      } catch (e2) {
        throw new Error("All providers failed: " + errList.concat(String(e2.message || e2)).join(" | "));
      }
    }
    throw new Error("All providers failed: " + errList.join(" | "));
  }
}

// ---- map/reduce for long documents --------------------------------------
// Single-pass summarization of a long document fails reliably: tens of
// thousands of characters of context plus a long answer is more than a
// free-tier model serves inside tight timeouts, so long documents used to
// time out every time. Above MAP_REDUCE_THRESHOLD the document is instead
// digested section by section — small, fast calls — and those digests are
// synthesized into the same four-section shape. The endpoint does the
// chunking work; the person never has to cut their own document down.
//
// v2 tuning: 6K-char chunks (was 15K) digest in seconds rather than tens
// of seconds; 10-way parallelism (was 4) means a 40K-char paper's ~7
// chunks run in a single wave; 350-token chunk budgets (was 700) keep each
// call short. Every chunk call is individually bounded by
// MAP_PER_CHUNK_TIMEOUT_MS — there is deliberately no global map-phase
// timeout that could fail all chunks at once.
const MAP_REDUCE_THRESHOLD = 8000;
const MAP_CHUNK_CHARS = 6000;
const MAP_CONCURRENCY = 10;
const MAP_MAX_TOKENS = 350;
// One chunk's whole lifecycle — 3-provider race plus the small-model
// retry — must settle inside this. Slow chunks degrade to placeholders,
// never to a hung analysis.
const MAP_PER_CHUNK_TIMEOUT_MS = 20000;
// The final synthesis asks for 5-9 substantive paragraphs — roughly
// 800-1600 tokens in practice. 2400 leaves real headroom without paying
// for worst-case generation time on a slow free model: every extra
// thousand tokens of headroom is latency the timeout budget has to cover.
const SUMMARY_MAX_TOKENS = 2400;
// Outer guards. These should essentially never fire — chunks self-bound
// above and runSummary/runQA degrade to the extractive fallback instead
// of throwing — but a hung provider must still not hold the worker open
// forever. If a guard fires, the caller falls back to extractive, never
// to an error.
const SUMMARY_SINGLE_TIMEOUT_MS = 60000;
const SUMMARY_SYNTH_TIMEOUT_MS = 100000;
const SUMMARY_TIMEOUT_MS = 120000;
const QA_TIMEOUT_MS = 75000;
export { MAP_REDUCE_THRESHOLD, MAP_CHUNK_CHARS, MAP_CONCURRENCY, MAP_MAX_TOKENS, MAP_PER_CHUNK_TIMEOUT_MS, SUMMARY_MAX_TOKENS, SUMMARY_SINGLE_TIMEOUT_MS, SUMMARY_SYNTH_TIMEOUT_MS, SUMMARY_TIMEOUT_MS, QA_TIMEOUT_MS };

// Split a document into chunks of at most maxChars, breaking on paragraph
// boundaries (blank lines) so a chunk never starts or ends mid-thought. A
// single paragraph longer than maxChars is hard-split — a pathological
// wall of text still has to fit. Exported for unit tests — pure function,
// no I/O.
export function chunkDocument(text, maxChars) {
  const paras = String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks = [];
  let cur = "";
  const push = () => {
    if (cur) {
      chunks.push(cur);
      cur = "";
    }
  };
  for (const para of paras) {
    if (para.length > maxChars) {
      push();
      for (let i = 0; i < para.length; i += maxChars) chunks.push(para.slice(i, i + maxChars));
      continue;
    }
    const next = cur ? cur + "\n\n" + para : para;
    if (next.length > maxChars) push();
    cur = cur ? cur + "\n\n" + para : para;
  }
  push();
  return chunks;
}

const CHUNK_SYSTEM_PROMPT =
  "You are condensing one section of a longer document so a later step can summarize the whole. " +
  "Extract only what this section actually says: the specific claims or findings it makes, the methods or reasoning it describes, " +
  "concrete numbers (sample sizes, effect sizes, percentages, p-values, confidence intervals), and the named entities involved " +
  "(compounds, genes, populations, variables, places, dates). Write a dense factual digest of roughly 150-250 words in plain " +
  "paragraphs — no headers, no preamble, no verdict on the document as a whole. Never add outside knowledge, and never invent " +
  "figures the text doesn't contain.";

// The default per-chunk digestion: one generate() call over the fast
// provider roster. Injectable via summarizeChunks' `digest` option so
// unit tests can simulate failures without network access.
function defaultDigest(env, chunkText, index, total) {
  return generate(
    env,
    [
      { role: "system", content: CHUNK_SYSTEM_PROMPT },
      { role: "user", content: "SECTION " + (index + 1) + " OF " + total + ":\n\n" + chunkText },
    ],
    MAP_MAX_TOKENS,
    { timeoutMs: MAP_PER_CHUNK_TIMEOUT_MS, providers: CHUNK_PROVIDERS }
  );
}

// Digest every chunk with bounded parallelism. Returns { sections, failed }:
// sections[i] is the digest or null; failed lists 1-based indices of chunks
// that could not be read. A chunk that fails (provider timeout, rate limit)
// leaves a null — never an exception — so one bad section can never kill
// the whole analysis. onProgress reports (done, total) after each chunk
// settles, done counting monotonically 1..N in completion order.
//
// priorSections (optional): an array aligned 1:1 with the chunks, from a
// previous attempt's `sections` in its "done" event. Non-empty entries are
// reused as-is and those chunks are NOT re-digested — this is the resume
// path: a retry only pays for the sections that failed last time. A length
// mismatch is treated as "no prior state" (full digest) rather than a
// misaligned merge, which would silently attach digests to wrong sections.
export async function summarizeChunks(env, chunks, onProgress, { digest = null, priorSections = null } = {}) {
  const doDigest = digest || defaultDigest;
  const n = chunks.length;
  const sections = new Array(n).fill(null);
  const failed = [];
  if (Array.isArray(priorSections) && priorSections.length === n) {
    for (let i = 0; i < n; i++) {
      if (typeof priorSections[i] === "string" && priorSections[i].trim().length >= 40) sections[i] = priorSections[i];
    }
  }
  let done = 0;
  const total = n;
  const report = () => {
    if (onProgress) {
      try {
        onProgress(done, total);
      } catch {}
    }
  };
  // Chunks revived from priorSections count as settled immediately, so a
  // resume reports honest progress from the first tick.
  for (let i = 0; i < n; i++) {
    if (sections[i]) {
      done++;
      report();
    }
  }
  let next = 0;
  const worker = async () => {
    while (next < n) {
      const i = next++;
      if (sections[i]) continue; // revived from a prior attempt
      try {
        const r = await doDigest(env, chunks[i], i, n);
        const text = typeof r === "string" ? r : r && r.answer;
        sections[i] = text && text.trim().length >= 40 ? text.trim() : null;
        if (!sections[i]) failed.push(i + 1);
      } catch (e) {
        console.error("Cerebrum document map: chunk " + (i + 1) + "/" + n + " failed:", (e && e.message) || e);
        sections[i] = null;
        failed.push(i + 1);
      }
      done++;
      report();
    }
  };
  const workers = [];
  for (let w = 0; w < Math.min(MAP_CONCURRENCY, n); w++) workers.push(worker());
  await Promise.all(workers);
  failed.sort((a, b) => a - b);
  return { sections, failed };
}

// ---- extractive fallback (no LLM, never throws) --------------------------
// The last line of defense behind every AI call on this endpoint. If all
// providers are down, the document still gets a useful, honest,
// document-grounded result instead of an error. Pure functions — no
// network, no randomness — so they cannot fail and are fully unit-testable.
// Everything they emit is labeled as a best-effort extract, never as an
// AI-written summary.

// Sentence splitter that refuses to split on genus-style abbreviations
// ("An. stephensi") and other dotted abbreviations mid-sentence — the same
// truncation defect the search fallback's gate already guards against.
const ABBREV_TAIL_RE = /\b(?:An|P|E|S|Sp|Spp|Fig|Figs|Eq|Eqs|No|Vol|Ch|Sec|Ref|Refs|Dr|Mr|Mrs|Ms|St|vs|etc|al|[A-Za-z])\.$/;
function splitSentences(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out = [];
  let start = 0;
  const re = /[.!?]+[""')\]]*\s+/g;
  let m;
  const push = (end) => {
    const s = clean.slice(start, end).trim();
    if (s) out.push(s);
    start = end;
  };
  while ((m = re.exec(clean))) {
    const tail = clean.slice(Math.max(0, m.index - 13), m.index + 1);
    const after = clean.slice(m.index + m[0].length).match(/^\s*(\S)/);
    const nextCh = after ? after[1] : "";
    // An abbreviation only blocks the split when the next word continues
    // in lowercase ("An. stephensi"); "vitamin A. The next…" still splits.
    const continuesLower = nextCh && nextCh === nextCh.toLowerCase() && nextCh !== nextCh.toUpperCase();
    if (continuesLower && ABBREV_TAIL_RE.test(tail)) continue;
    push(m.index + m[0].length);
  }
  push(clean.length);
  return out;
}

const EXTRACT_NOTE =
  "[Best-effort summary: the AI service was unreachable, so the key passages below were pulled directly from your document rather than AI-written. Every statement comes from the document text.]";

function scoreSentence(s) {
  let score = 0;
  const len = s.length;
  if (len >= 60 && len <= 400) score += 1;
  else if (len < 40 || len > 600) score -= 2;
  if (/\d/.test(s)) score += 2;
  if (/%|p\s*[=<]\s*0\.|significan|effect size|sample of|n\s*=\s*\d+/i.test(s)) score += 2;
  return score;
}

// Build a four-section summary straight from the document's own sentences.
// Exported for unit tests — pure function, no I/O.
export function extractiveSummary(text) {
  const sentences = splitSentences(text).filter((s) => s.length >= 30);
  const paras = String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40);
  const used = new Set();
  const claim = (s) => {
    if (!s || used.has(s)) return null;
    used.add(s);
    return s;
  };
  const take = (pred, n) => {
    const r = [];
    const ranked = sentences.filter(pred).sort((a, b) => scoreSentence(b) - scoreSentence(a));
    for (const s of ranked) {
      if (r.length >= n) break;
      const c = claim(s);
      if (c) r.push(c);
    }
    return r;
  };
  const hasNum = (s) => /\d/.test(s);
  // Executive: the opening sentence of the first few substantive
  // paragraphs — usually the what and the why.
  const exec = [];
  for (const p of paras.slice(0, 4)) {
    const first = splitSentences(p)[0];
    const c = claim(first);
    if (c && exec.length < 3) exec.push(c);
  }
  if (!exec.length) {
    for (const s of sentences.slice(0, 3)) {
      const c = claim(s);
      if (c) exec.push(c);
    }
  }
  const method = take((s) => /method|methodology|study design|sample|participant|recruit|conducted|measur|data were|survey|interview|experiment|trial|cohort|procedure|statistical analysis/i.test(s), 3);
  let findings = take((s) => hasNum(s) && /found|showed|revealed|demonstrated|observed|reported|significan|increas|decreas|associat|compared|resulted|effect\b/i.test(s), 4);
  if (!findings.length) findings = take(hasNum, 3);
  const limits = take((s) => /limitation|however,|although|though|caveat|caution|generaliz|future research|further (research|study)|bias|confound|small sample|not be generaliz/i.test(s), 2);

  const section = (title, lines, emptyLine) =>
    "## " + title + "\n" + (lines.length ? lines.join(" ") : emptyLine);
  return (
    EXTRACT_NOTE +
    "\n\n" +
    [
      section("Executive Summary", exec, "The document's opening could not be isolated in this extract."),
      section("Methodology", method, "The document's methods could not be isolated in this extract."),
      section("Key Findings", findings, "No clearly quantitative findings were isolated in this extract."),
      section("Limitations", limits, "The document does not state its limitations explicitly in a way this extract could isolate."),
    ].join("\n\n")
  );
}

const QA_STOPWORDS = new Set(
  "the,a,an,and,or,of,to,in,on,for,with,by,from,as,at,is,are,was,were,be,been,being,what,when,where,which,who,whom,whose,how,why,does,do,did,can,could,should,would,there,their,this,that,these,those,it,its,than,then,so,such,into,about,between,through,during,each,other,some,any,all,both,only,just,not,no,yes,if,because,while,doesn,don,isn,aren".split(",")
);

// Answer a question from the document's own sentences, ranked by query-term
// overlap. Exported for unit tests — pure function, no I/O.
export function extractiveQA(text, query) {
  const terms = String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !QA_STOPWORDS.has(t));
  const sentences = splitSentences(text).filter((s) => s.length >= 40 && s.length <= 600);
  const header = "[The AI service was unreachable, so instead of an AI-written answer, here are the passages from your document most relevant to your question:]";
  if (!terms.length || !sentences.length) {
    return header + "\n\nThe document does not appear to address this question.";
  }
  const scored = [];
  for (let i = 0; i < sentences.length; i++) {
    const low = sentences[i].toLowerCase();
    let hits = 0;
    for (const t of terms) if (low.includes(t)) hits++;
    if (hits > 0) scored.push({ s: sentences[i], i, score: hits });
  }
  if (!scored.length) {
    return header + "\n\nThe document does not appear to address this question.";
  }
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const picked = scored.slice(0, 5).sort((a, b) => a.i - b.i);
  return header + "\n\n" + picked.map((p) => p.s).join("\n\n");
}

// Summarize a document. NEVER THROWS: every failure mode degrades to the
// extractive fallback, so the endpoint always has something useful to
// return. Resolves to:
//   { answer, model, partial, missingSections, sections, chunkCount, path }
// where `path` is "single" | "mapreduce" | "extractive", `partial` marks
// any best-effort degradation, and `sections` (mapreduce only) carries the
// per-chunk digests (null for failed chunks, each capped) so a retry can
// pass them back as `priorSections` and only re-digest the missing ones.
export async function runSummary(env, documentText, { onProgress = null, onPhase = null, digest = null, generateFn = null, priorSections = null } = {}) {
  const gen = generateFn || ((e, m, t, o) => generate(e, m, t, o));
  const asExtractive = (sourceText, extra = {}) => ({
    answer: extractiveSummary(sourceText),
    model: "extractive",
    partial: true,
    missingSections: extra.missingSections || [],
    sections: extra.sections || null,
    chunkCount: extra.chunkCount || 0,
    path: "extractive",
  });
  const missingNote = (failed, total) =>
    failed.length
      ? "\n\n[Note: section" + (failed.length > 1 ? "s " : " ") + failed.join(", ") + " of " + total + " could not be read, so " + (failed.length > 1 ? "they are" : "it is") + " not reflected in this summary.]"
      : "";
  try {
    if (documentText.length <= MAP_REDUCE_THRESHOLD) {
      try {
        // Streamed internally (never forwarded) so the sliding inactivity
        // timeout protects the long generation; tokens are discarded.
        const r = await gen(
          env,
          [
            { role: "system", content: SUMMARY_SYSTEM_PROMPT },
            { role: "user", content: "DOCUMENT:\n\n" + documentText },
          ],
          SUMMARY_MAX_TOKENS,
          { timeoutMs: SUMMARY_SINGLE_TIMEOUT_MS, idleTimeoutMs: 25000, onToken: () => {} }
        );
        return { answer: r.answer, model: r.model, partial: false, missingSections: [], sections: null, chunkCount: 0, path: "single" };
      } catch {
        return asExtractive(documentText);
      }
    }
    const chunks = chunkDocument(documentText, MAP_CHUNK_CHARS);
    const { sections, failed } = await summarizeChunks(env, chunks, onProgress, { digest, priorSections });
    const good = sections.filter(Boolean);
    if (!good.length) {
      // Nothing was digestible — synthesizing placeholders would be
      // fiction, so go straight to the extract of the raw text.
      return asExtractive(documentText, { missingSections: failed, chunkCount: chunks.length });
    }
    const condensed = sections.map((s, i) => "SECTION " + (i + 1) + " OF " + sections.length + ":\n" + (s || "[This section could not be read.]")).join("\n\n");
    const framing =
      "The following are dense section-by-section digests of one longer document, in order. " +
      "Treat them together as the document's full content for the summary below." +
      (failed.length ? " Sections " + failed.join(", ") + " could not be read — do not claim to cover their content." : "");
    if (onPhase) {
      try {
        onPhase("reduce");
      } catch {}
    }
    try {
      const r = await gen(
        env,
        [
          { role: "system", content: SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: framing + "\n\n" + condensed },
        ],
        SUMMARY_MAX_TOKENS,
        { timeoutMs: SUMMARY_SYNTH_TIMEOUT_MS, idleTimeoutMs: 25000, onToken: () => {} }
      );
      return {
        answer: r.answer + missingNote(failed, chunks.length),
        model: r.model,
        partial: failed.length > 0,
        missingSections: failed,
        sections: sections.map((s) => (s ? s.slice(0, 1200) : null)),
        chunkCount: chunks.length,
        path: "mapreduce",
      };
    } catch {
      // Digests exist but the synthesis call failed: extract from the
      // digests themselves — dense, factual, and far better than raw-text
      // extraction or an error.
      const ex = asExtractive(good.join("\n\n"), { missingSections: failed, chunkCount: chunks.length });
      ex.sections = sections.map((s) => (s ? s.slice(0, 1200) : null));
      return ex;
    }
  } catch {
    // Belt and braces: even an unexpected bug above degrades to the
    // extract, never to a thrown error.
    return asExtractive(documentText);
  }
}

// Answer a question about a document. NEVER THROWS: provider failure
// degrades to the extractive Q&A. When onToken is provided (the SSE path),
// tokens stream to the client as they arrive; `streamed` accumulates what
// was already sent so a mid-stream failure can hand off gracefully — the
// extractive answer is appended after a plain handoff line instead of
// leaving a half-written AI answer standing alone.
export async function runQA(env, documentText, query, historyBlock, { onToken = null, generateFn = null } = {}) {
  const gen = generateFn || ((e, m, t, o) => generate(e, m, t, o));
  const messages = [
    { role: "system", content: QA_SYSTEM_PROMPT },
    { role: "user", content: "DOCUMENT:\n\n" + documentText + historyBlock + "\n\n---\nQUESTION: " + query },
  ];
  let streamed = "";
  const sink = onToken
    ? (t) => {
        streamed += t;
        try {
          onToken(t);
        } catch {}
      }
    : () => {};
  try {
    const r = await gen(env, messages, 1400, { timeoutMs: QA_TIMEOUT_MS, idleTimeoutMs: 25000, onToken: sink });
    return { answer: r.answer, model: r.model, partial: false };
  } catch {
    const fb = extractiveQA(documentText, query);
    const handoff = streamed
      ? "\n\n[The AI answer above was cut short when the service faltered — continuing with the most relevant passages from your document:]\n\n"
      : "";
    const tail = handoff + fb;
    if (onToken) {
      try {
        onToken(tail);
      } catch {}
    }
    return { answer: streamed + tail, model: "extractive", partial: true };
  }
}

// STRUCTURE hard-enforces these four exact section titles in the prompt
// above, so splitting the model's own markdown back into named fields is a
// lookup against a known allowlist, not a heuristic guess against
// open-ended output. Kept for callers that want the fields individually;
// the frontend actually renders `raw` directly through the same
// renderAnswer() the main search answers use, since that already handles a
// model gluing a header onto the end of the previous section without a
// blank line (see normalizeSectionHeaders in src/main.jsx) — a real failure
// mode on free-tier models this endpoint shares with search.js.
// Exported for unit tests — pure function, no I/O.
export function splitSummarySections(text) {
  const sections = { executiveSummary: "", methodology: "", keyFindings: "", limitations: "" };
  const map = [
    ["executiveSummary", /##\s*Executive Summary/i],
    ["methodology", /##\s*Methodology/i],
    ["keyFindings", /##\s*Key Findings/i],
    ["limitations", /##\s*Limitations/i],
  ];
  const markers = [];
  for (const [key, re] of map) {
    const m = text.match(re);
    if (m) markers.push({ key, index: m.index, len: m[0].length });
  }
  markers.sort((a, b) => a.index - b.index);
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index + markers[i].len;
    const end = i + 1 < markers.length ? markers[i + 1].index : text.length;
    sections[markers[i].key] = text.slice(start, end).trim();
  }
  if (!markers.length) sections.executiveSummary = text;
  return sections;
}

// ── Document Mode lead media ──────────────────────────────────────────────
// Lead-media subject: an explicit client-supplied title wins; otherwise the
// first heading-like line of the document (skips markdown heading markers,
// bare numbers, and very short/long lines that are usually boilerplate).
export function firstDocumentHeading(text) {
  if (!text) return "";
  for (const rawLine of text.split("\n").slice(0, 40)) {
    const line = rawLine.replace(/^#+\s*/, "").trim();
    if (line.length >= 8 && line.length <= 140 && !/^\d+$/.test(line)) return line;
  }
  return "";
}

// Shapes a resolveLeadMedia candidate into the shared media contract used
// by trending.js attachMedia: { media: { image|null, video|null, resolvedAt } }.
// image XOR video is ever set; an absent candidate means "resolved: nothing"
// (never omitted — the UI distinguishes that from "not attempted").
// Real media only: the resolver verifies URLs upstream; nothing is
// synthesized here.
export function attachDocumentMedia(candidate) {
  const media = { image: null, video: null, resolvedAt: Date.now() };
  if (candidate && candidate.url) {
    const entry = {
      url: candidate.url,
      credit: candidate.credit || "",
      creditUrl: candidate.creditUrl || "",
      license: candidate.license || "",
      source: candidate.source || "",
      verified: true,
    };
    if (candidate.poster) entry.poster = candidate.poster;
    if (candidate.type === "video") media.video = entry;
    else media.image = entry;
  }
  return { media };
}

export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return errRes("Method not allowed.", 405, "method_not_allowed", cors);
  if (!readOriginAllowed(request, env)) return errRes("Origin not allowed.", 403, "origin_not_allowed", cors);
  // Write-path origin gate (same posture as data.js): document analysis is
  // a state-changing, AI-spending call that belongs to our own UI. Cookies
  // are SameSite=Lax; this is defence in depth.
  if (!requireTrustedOrigin(request, env)) return forbiddenOrigin(cors);

  const clientIP = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  // Use the hashed privacyKey (not the raw IP) — consistent with every
  // other endpoint, and avoids storing raw IPs in the rate-limit KV.
  if (!(await checkRateLimit(env, privacyKey("document", clientIP), RATE_LIMIT, RATE_WINDOW_MS))) {
    return errRes("Too many requests. Please wait a moment and try again.", 429, "rate_limited", { ...cors, "Retry-After": "30" });
  }

  try {
    // Bounded body parse: Content-Length is refused before buffering, and
    // the buffered text is measured too, so a hostile client can't OOM the
    // worker with a gigabyte of JSON. Malformed JSON gets a 400, not a
    // silent empty body that later 400s as "no document text" anyway.
    const parsed = await readJsonBody(request, cors, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    let documentText = typeof body.documentText === "string" ? body.documentText.trim() : "";
    const query = typeof body.query === "string" ? body.query.trim().slice(0, MAX_QUERY_LEN) : "";
    // Bound the history input BEFORE formatHistory touches it: the client
    // sends the whole Q&A thread and a hostile one could send thousands of
    // turns. formatHistory keeps only the tail, so slicing first loses
    // nothing legitimate.
    const historyInput = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_TURNS * 4) : [];
    const historyBlock = formatHistory(historyInput);
    // Resume path: per-chunk digests from a previous attempt's "done"
    // event, aligned 1:1 with the current chunking. Validated inside
    // summarizeChunks (length must match or the whole array is ignored).
    const priorSections = Array.isArray(body.priorSections) ? body.priorSections : null;

    if (!documentText) {
      return errRes("No document text provided.", 400, "missing_document", cors);
    }

    // ── Access gate: document analysis is provider-backed AI spend, so it
    // belongs to accounts, not anonymous callers. Free accounts get
    // FREE_DOC_READS_PER_MONTH reads per UTC month; Pro is unlimited.
    // (Fail closed: an unresolvable session denies, like search.js.)
    let proLib = null;
    let docUser = null;
    try {
      const { getSessionUser } = await import("../lib/authHelpers.js");
      proLib = await import("../lib/proEntitlement.js");
      docUser = await getSessionUser(request, env);
    } catch {
      proLib = null;
      docUser = null;
    }
    if (!proLib || !docUser) {
      return errRes("Sign in to analyze documents.", 401, "auth_required", cors);
    }
    const docGate = await proLib.resolveAiGate(env, docUser);
    // Pro (paid or lifetime) reads unlimited documents. Lite and free draw
    // from their metered buckets — 30 and 3 reads per 5-day period
    // (FREE_DOC_READS_PER_MONTH on the free tier). The auth check and the
    // increment are ONE atomic consume: concurrent requests can never
    // overshoot the cap. The reservation happens up front, so a failed
    // analysis burns the reserved slot instead of risking unbounded
    // overshoot. Best-effort: a metering failure never blocks the analysis.
    const docTier = docGate.kind === "pro" ? "pro" : docGate.kind === "lite" ? "lite" : "free";
    const docCap = docTier === "pro" ? null : proLib.capsForTier(docTier).docs;
    let docUsed = 0;
    if (docCap !== null) {
      let docAllowed = true;
      try {
        const consumed = await proLib.consumeDocRead(env, docUser.id, docCap);
        docUsed = consumed.used;
        docAllowed = consumed.allowed;
      } catch {
        docAllowed = true;
      }
      if (!docAllowed) {
        return errRes(
          docTier === "lite"
            ? "You've used your 30 Lite document reads for these 5 days. Pro reads unlimited documents."
            : "You've used your 3 free document reads for these 5 days. Lite reads 30 — Pro reads unlimited.",
          402,
          "doc_quota_exhausted",
          cors
        );
      }
    }
    const docQuota = () => ({
      used: docUsed,
      cap: docCap,
    });
    // A long document is never refused. There is still a real ceiling
    // (the model's context window), so what changes is the response to
    // hitting it: analyze what fits and say plainly that the tail wasn't
    // read, rather than analyzing nothing and blaming the input.
    let truncatedNote = "";
    if (documentText.length > MAX_DOCUMENT_LEN) {
      truncatedNote = `\n\n[Note: this document is ${documentText.length.toLocaleString()} characters; the first ${MAX_DOCUMENT_LEN.toLocaleString()} were analyzed. Sections beyond that point were not read.]`;
      documentText = documentText.slice(0, MAX_DOCUMENT_LEN);
    }

    const isQA = query.length > 0;

    // Lead media resolves CONCURRENTLY with the analysis — it is decorative
    // and never sits on the critical path. The key is always present on the
    // summary response (honest nulls when nothing resolves) so the UI can
    // distinguish "resolved: nothing" from "not attempted". The resolver
    // never throws for network reasons, but this stays defensive anyway:
    // media must never break an analysis. Q&A follow-ups skip it entirely
    // (no pointless upstream fan-out per question).
    const mediaPromise = isQA
      ? Promise.resolve({ media: { image: null, video: null, resolvedAt: Date.now() } })
      : (async () => {
          try {
            const docTitle = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
            const docSubject = docTitle || firstDocumentHeading(documentText);
            if (!docSubject) return attachDocumentMedia(null);
            const { resolveLeadMedia } = await import("./image.js");
            const { image } = await withTimeout(
              resolveLeadMedia(env, docSubject, "document"),
              15000,
              "document lead media"
            );
            return attachDocumentMedia(image);
          } catch {
            return attachDocumentMedia(null);
          }
        })();
    const wantStream = body.stream === true;
    if (wantStream) {
      // SSE streaming. The event protocol (see src/docReader.js for the
      // client half):
      //   quota    { type:"quota", quota:{used,cap} } — sent first.
      //   start    { type:"start", mode:"summary"|"qa", chunks, phase }
      //            — the work plan up front, so the UI can size its
      //            progress bar before the first chunk lands.
      //   progress { type:"progress", phase:"map"|"reduce", done, total }
      //            — map: one per settled chunk; reduce: 0/1 → 1/1 around
      //            the final synthesis ("Writing your summary…").
      //   token    { type:"token", text } — Q&A only; summaries arrive
      //            whole in "done".
      //   done     { type:"done", mode, answer|raw, ... } — ALWAYS sent for
      //            an analysis; carries partial:true + missingSections when
      //            best-effort, plus `sections` (per-chunk digests) for the
      //            resume path. Summary `done` also carries `media`
      //            { image|null, video|null, resolvedAt } — the lead
      //            picture/video for the document, resolved concurrently
      //            with the analysis; honest nulls mean "nothing exists".
      //   error    { type:"error", error, code } — last resort only; the
      //            analysis path degrades to done+partial instead.
      // SSE comments (": keep-alive") are heartbeats; the client skips
      // non-"data:" lines.
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (data) => {
            try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
          };
          const heartbeat = setInterval(() => {
            try { controller.enqueue(encoder.encode(": keep-alive\n\n")); } catch {}
          }, 15000);
          // Send quota info first so UI can show it immediately
          send({ type: "quota", quota: docQuota() });
          try {
            let result;
            if (isQA) {
              send({ type: "start", mode: "qa", chunks: 0, phase: "qa" });
              result = await withTimeout(
                runQA(env, documentText, query, historyBlock, {
                  onToken: (token) => send({ type: "token", text: token }),
                }),
                QA_TIMEOUT_MS + 15000,
                "document qa"
              );
              send({ type: "done", mode: "qa", answer: result.answer + truncatedNote, model: result.model, partial: !!result.partial, quota: docQuota() });
            } else {
              const chunkCount = documentText.length > MAP_REDUCE_THRESHOLD ? chunkDocument(documentText, MAP_CHUNK_CHARS).length : 0;
              send({ type: "start", mode: "summary", chunks: chunkCount, phase: chunkCount ? "map" : "single" });
              let reduceStarted = false;
              result = await withTimeout(
                runSummary(env, documentText, {
                  onProgress: (done, total) => send({ type: "progress", phase: "map", done, total }),
                  onPhase: (phase) => {
                    if (phase === "reduce") reduceStarted = true;
                    send({ type: "progress", phase, done: 0, total: 1 });
                  },
                  priorSections,
                }),
                SUMMARY_TIMEOUT_MS,
                "document analysis"
              );
              // Close the reduce progress tick opened by onPhase above, on
              // every path that opened one (synthesis or digest-extract).
              if (reduceStarted) send({ type: "progress", phase: "reduce", done: 1, total: 1 });
              const sectioned = splitSummarySections(result.answer);
              const raw = result.answer + truncatedNote;
              send({
                type: "done",
                mode: "summary",
                raw,
                ...sectioned,
                truncated: !!truncatedNote,
                partial: !!result.partial,
                missingSections: result.missingSections || [],
                sections: result.sections || null,
                chunkCount: result.chunkCount || 0,
                model: result.model,
                media: (await mediaPromise).media,
                quota: docQuota(),
              });
            }
          } catch (e) {
            // Last resort: runSummary/runQA already degrade internally, so
            // reaching here means something unexpected broke. Log it, and
            // still prefer a best-effort answer over a dead end.
            console.error("Cerebrum document stream failure:", (e && e.message) || e);
            try {
              if (isQA) {
                send({ type: "done", mode: "qa", answer: extractiveQA(documentText, query) + truncatedNote, model: "extractive", partial: true, quota: docQuota() });
              } else {
                const raw = extractiveSummary(documentText) + truncatedNote;
                send({ type: "done", mode: "summary", raw, ...splitSummarySections(raw), truncated: !!truncatedNote, partial: true, missingSections: [], sections: null, chunkCount: 0, model: "extractive", media: (await mediaPromise).media, quota: docQuota() });
              }
            } catch {
              const classified = classifyDocumentError(e);
              send({ type: "error", error: classified.message, code: classified.code });
            }
          } finally {
            clearInterval(heartbeat);
            try { controller.close(); } catch {}
          }
        },
      });
      return new Response(stream, {
        headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
      });
    }
    if (isQA) {
      const result = await withTimeout(runQA(env, documentText, query, historyBlock), QA_TIMEOUT_MS + 15000, "document qa");
      return okRes({ mode: "qa", answer: result.answer + truncatedNote, model: result.model, partial: !!result.partial, quota: docQuota() }, 200, cors);
    }
    const result = await withTimeout(runSummary(env, documentText, { priorSections }), SUMMARY_TIMEOUT_MS, "document analysis");
    const sectioned = splitSummarySections(result.answer);
    // The truncation note is appended to what the reader actually sees —
    // a summary that silently covers only part of a document is worse than
    // no summary, because nothing on screen says so.
    const raw = result.answer + truncatedNote;
    return okRes(
      {
        mode: "summary",
        raw,
        ...sectioned,
        truncated: !!truncatedNote,
        partial: !!result.partial,
        missingSections: result.missingSections || [],
        sections: result.sections || null,
        chunkCount: result.chunkCount || 0,
        model: result.model,
        media: (await mediaPromise).media,
        quota: docQuota(),
      },
      200,
      cors
    );
  } catch (e) {
    console.error("Cerebrum document endpoint error:", e);
    // The exception message never reaches the client — see
    // classifyDocumentError above. It may name environment variables,
    // models, or carry upstream response bodies.
    const classified = classifyDocumentError(e);
    return errRes(classified.message, classified.status, classified.code, cors);
  }
}
