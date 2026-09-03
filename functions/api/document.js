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

import { checkRateLimit } from "../lib/rateLimit.js";

const ALLOWED_ORIGINS = [
  "https://askcerebrum.org",
  "https://www.askcerebrum.org",
  "https://cerebrum-2pz.pages.dev",
];
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.cerebrum-2pz\.pages\.dev$/i;
function originAllowed(request) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return true;
  return ALLOWED_ORIGINS.some((o) => origin === o) || PAGES_PREVIEW_RE.test(origin);
}

// Lower than search.js's 20/min — a document analysis call carries a much
// larger prompt (a whole paper, not a short query) and costs proportionally
// more per request, so the same per-IP ceiling would let this endpoint burn
// through shared provider quota faster than the core search feature it sits
// next to.
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60000;

// A full paper is routinely 20-40K characters end to end; 120,000 leaves
// generous headroom for a long report while still bounding worst-case
// prompt size/cost — short of anything that would approach a free-tier
// model's actual context window, but well past what a document pasted in
// good faith ever needs. Rejected outright rather than silently truncated:
// cutting a document without telling the user could lop off exactly the
// section their question is about, quietly breaking the "answer ONLY from
// this text" guarantee the whole feature is built on.
// Raised from 120k now that exceeding it truncates with a visible note
// instead of refusing the document outright (see the handler below).
const MAX_DOCUMENT_LEN = 250000;
const MAX_QUERY_LEN = 2000;

function cleanAIResponse(raw) {
  if (!raw) return "";
  let c = raw;
  c = c.replace(/<think>[\s\S]*?<\/think>/gi, "");
  c = c.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  c = c.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "");
  c = c.replace(/^```(?:markdown|json)?\s*\n([\s\S]*?)\n```\s*$/i, "$1");
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
function formatHistory(history) {
  if (!Array.isArray(history) || !history.length) return "";
  const turns = history
    .filter((h) => h && typeof h.text === "string" && h.text.trim() && (h.role === "user" || h.role === "assistant"))
    .slice(-MAX_HISTORY_TURNS * 2)
    .map((h) => (h.role === "user" ? "Q: " : "A: ") + h.text.trim().slice(0, MAX_HISTORY_ENTRY_LEN));
  if (!turns.length) return "";
  return "\n\n---\nPRIOR CONVERSATION ABOUT THIS DOCUMENT (for context only — verify every fact against the document above, not this):\n" + turns.join("\n");
}

const callOR = async (env, model, messages, maxTokens, timeoutMs = 25000) => {
  if (!env.OPENROUTER_KEY) throw new Error(model + ": no OPENROUTER_KEY configured");
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.OPENROUTER_KEY, "HTTP-Referer": "https://askcerebrum.org", "X-Title": "Cerebrum" },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: maxTokens, messages }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) {
      let bodyText = "";
      try { bodyText = (await r.text()).slice(0, 150); } catch {}
      throw new Error(model + ": HTTP " + r.status + (bodyText ? " — " + bodyText : ""));
    }
    const j = await r.json();
    const cleaned = cleanAIResponse(j?.choices?.[0]?.message?.content || "");
    if (cleaned.length < 40) throw new Error(model + ": response too short");
    return { answer: cleaned, model };
  } catch (e) {
    clearTimeout(t);
    if (e && e.name === "AbortError") throw new Error(model + ": timed out");
    throw e;
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

// A small provider race, same spirit as functions/api/search.js's wave
// system but scoped down for a lower-traffic endpoint: one OpenRouter
// outage still shouldn't take Document Mode down entirely when Workers AI
// is bound, and a full-wave failure gets one sequential smaller-model retry
// rather than an immediate dead end.
async function generate(env, messages, maxTokens) {
  // Commit 64 — more racers, shorter leash. Promise.any resolves on the
  // FIRST success, so adding models makes the common case faster (more
  // chances that one is not currently throttled) rather than slower, and
  // trimming the per-call timeout from 25s to 15s means a wedged provider
  // stops holding the whole request hostage. The old configuration could
  // sit for 25 seconds and then report a generic failure.
  const calls = [
    callOR(env, "deepseek/deepseek-chat-v3-0324:free", messages, maxTokens, 15000),
    callOR(env, "google/gemini-2.0-flash-exp:free", messages, maxTokens, 15000),
    callOR(env, "meta-llama/llama-3.3-70b-instruct:free", messages, maxTokens, 15000),
    callOR(env, "qwen/qwen-2.5-72b-instruct:free", messages, maxTokens, 15000),
    callOR(env, "mistralai/mistral-small-3.2-24b-instruct:free", messages, maxTokens, 15000),
  ];
  if (env.AI && typeof env.AI.run === "function") {
    calls.push(callCF(env, "@cf/meta/llama-3.3-70b-instruct-fp8-fast", messages, maxTokens));
  }
  try {
    return await Promise.any(calls);
  } catch (agg) {
    const errList = agg && agg.errors ? agg.errors.map((e) => String((e && e.message) || e)) : [String((agg && agg.message) || agg)];
    if (env.OPENROUTER_KEY) {
      try {
        return await callOR(env, "meta-llama/llama-3.2-3b-instruct:free", messages, maxTokens, 25000);
      } catch (e2) {
        throw new Error("All providers failed: " + errList.concat(String(e2.message || e2)).join(" | "));
      }
    }
    throw new Error("All providers failed: " + errList.join(" | "));
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
function splitSummarySections(text) {
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

export async function onRequest(context) {
  const { request, env } = context;
  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin = ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin) ? reqOrigin : "https://askcerebrum.org";
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: cors });
  if (!originAllowed(request)) return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers: cors });

  const clientIP = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  if (!(await checkRateLimit(env, `document:${clientIP}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }), { status: 429, headers: { ...cors, "Retry-After": "30" } });
  }

  try {
    const body = await request.json().catch(() => ({}));
    let documentText = typeof body.documentText === "string" ? body.documentText.trim() : "";
    const query = typeof body.query === "string" ? body.query.trim().slice(0, MAX_QUERY_LEN) : "";
    const historyBlock = formatHistory(body.history);

    if (!documentText) {
      return new Response(JSON.stringify({ error: "No document text provided." }), { status: 400, headers: cors });
    }
    // Commit 64 — a long document is no longer refused. It used to return
    // a 413 telling the person to go and cut their own paper down, which is
    // work the tool should be doing for them. There is still a real ceiling
    // (the model's context window), so what changes is the response to
    // hitting it: analyze what fits and say plainly that the tail wasn't
    // read, rather than analyzing nothing and blaming the input.
    let truncatedNote = "";
    if (documentText.length > MAX_DOCUMENT_LEN) {
      truncatedNote = `\n\n[Note: this document is ${documentText.length.toLocaleString()} characters; the first ${MAX_DOCUMENT_LEN.toLocaleString()} were analyzed. Sections beyond that point were not read.]`;
      documentText = documentText.slice(0, MAX_DOCUMENT_LEN);
    }

    const isQA = query.length > 0;
    const messages = isQA
      ? [
          { role: "system", content: QA_SYSTEM_PROMPT },
          { role: "user", content: "DOCUMENT:\n\n" + documentText + historyBlock + "\n\n---\nQUESTION: " + query },
        ]
      : [
          { role: "system", content: SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: "DOCUMENT:\n\n" + documentText },
        ];

    // v44: 2200 was tight even for the old, shorter summary shape — the
    // same anti-truncation lesson as search.js's "long" mode (see that
    // maxTokens comment): a real 5-9 paragraph structured summary needs
    // more headroom than a target that only just covers the minimum, or it
    // gets cut off approaching its own closing section.
    const maxTokens = isQA ? 1400 : 4000;
    const result = await generate(env, messages, maxTokens);

    if (isQA) {
      return new Response(JSON.stringify({ mode: "qa", answer: result.answer + truncatedNote, model: result.model }), { status: 200, headers: cors });
    }
    const sectioned = splitSummarySections(result.answer);
    // The truncation note is appended to what the reader actually sees —
    // a summary that silently covers only part of a document is worse than
    // no summary, because nothing on screen says so.
    const raw = result.answer + truncatedNote;
    return new Response(JSON.stringify({ mode: "summary", raw, ...sectioned, truncated: !!truncatedNote, model: result.model }), { status: 200, headers: cors });
  } catch (e) {
    console.error("Cerebrum document endpoint error:", e);
    // Commit 64 — "Something went wrong. Please try again." was shown for
    // every failure, including the one that actually happens: every free-tier
    // model being rate-limited at once. Retrying immediately is the WORST
    // response to that, and the message advised exactly that. A 3,400-character
    // paper was being refused with a message implying the document was at
    // fault. Distinguish the cases so the advice matches the cause.
    const msg = String((e && e.message) || e);
    const rateLimited = /429|rate.?limit|quota|too many requests|All providers failed/i.test(msg);
    return new Response(JSON.stringify({
      error: rateLimited
        ? "Every free AI model is rate-limited right now — this isn't a problem with your document. Capacity usually returns within a minute."
        : "Couldn't analyze that document. " + (msg.length < 160 ? msg : "The analysis service returned an unexpected error."),
    }), { status: rateLimited ? 503 : 500, headers: cors });
  }
}
