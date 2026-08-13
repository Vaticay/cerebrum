// TTS endpoint with tiered voice engines. Tries progressively:
//   1. Cloudflare Aura (Deepgram) — most natural free voice, if available
//   2. Cloudflare MeloTTS — solid fallback, always available on Workers AI
//   3. StreamElements Polly proxy — keyless, no per-user quota, Twitch-tier
//      Amazon Polly voices (Brian, Amy, Joanna, Matthew). Used as backup
//      when Workers AI errors or hits daily limits.
//
// Frontend just hits /api/tts and gets audio/mpeg back. Whichever engine
// worked, the user experience is identical.
//
// Hardening: unlike search.js/vote.js, this endpoint had NO origin allowlist
// (wildcard "*" CORS) and NO rate limiting, despite calling paid/quota-limited
// Workers AI models plus an external proxy — any third-party site could embed
// a script hammering this for free. Brought up to the same bar as the other
// endpoints. Also fixed an ordering bug: the 4500-char cap used to be applied
// AFTER preprocessForSpeech() ran its ~20 regex passes over the full raw
// string, so an arbitrarily large `text` field got fully processed before
// ever being truncated — a cheap CPU-time DoS lever. Now capped up front.

const ALLOWED_ORIGINS = [
  "https://askcerebrum.org",
  "https://www.askcerebrum.org",
  "https://cerebrum-2pz.pages.dev",
];
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.cerebrum-2pz\.pages\.dev$/i;
function originAllowed(request) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return true; // same-origin / non-browser client
  return ALLOWED_ORIGINS.some((o) => origin === o) || PAGES_PREVIEW_RE.test(origin);
}

// Same lightweight per-isolate sliding-window limiter used in search.js/vote.js.
const RATE_BUCKET = new Map();
const RATE_LIMIT = 20;         // TTS requests
const RATE_WINDOW_MS = 60000;  // per minute
function rateLimit(ip) {
  const now = Date.now();
  const rec = RATE_BUCKET.get(ip) || [];
  const recent = rec.filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  RATE_BUCKET.set(ip, recent);
  if (RATE_BUCKET.size > 5000) {
    for (const [k, v] of RATE_BUCKET) {
      if (v.every((t) => now - t > RATE_WINDOW_MS)) RATE_BUCKET.delete(k);
    }
  }
  return recent.length <= RATE_LIMIT;
}

export async function onRequest(context) {
  const { request, env } = context;

  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin =
    ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin)
      ? reqOrigin
      : "https://askcerebrum.org";
  const cors = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }
  if (!originAllowed(request)) {
    return jsonErr(cors, 403, "Origin not allowed");
  }

  const clientIP =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown";
  if (!rateLimit(clientIP)) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }),
      { status: 429, headers: { ...cors, "Content-Type": "application/json", "Retry-After": "30" } }
    );
  }

  let body;
  try { body = await request.json(); }
  catch {
    return jsonErr(cors, 400, "Bad JSON");
  }

  // Cap the RAW input before any processing — see hardening note above.
  const raw = (body.text || "").toString().trim().slice(0, 6000);
  if (!raw) return jsonErr(cors, 400, "Missing text");

  // Preprocess text for more natural speech. Every TTS engine benefits from
  // this — abbreviations expanded, citations stripped, symbols softened,
  // sentence breaks turned into real pauses.
  const text = preprocessForSpeech(raw);
  if (!text) return jsonErr(cors, 400, "Empty after cleaning");

  const cap = text.length > 4500 ? text.slice(0, 4500) : text;
  const voice = (body.voice || "").toString();

  // Try Cloudflare Aura first if Workers AI is bound
  if (env.AI && typeof env.AI.run === "function") {
    // Aura is Deepgram's flagship voice, much more natural than MeloTTS.
    // Try it first, fall through to MeloTTS if the model isn't available.
    try {
      const auraSpeaker = voice || "aura-asteria-en"; // female warm; alt: aura-luna-en, aura-orion-en (male)
      const auraRes = await env.AI.run("@cf/deepgram/aura-1", {
        text: cap,
        speaker: auraSpeaker,
        encoding: "mp3",
      });
      const audioBytes = await extractAudioBytes(auraRes);
      if (audioBytes && audioBytes.length > 500) {
        return audioResponse(cors, audioBytes);
      }
    } catch { /* fall through to MeloTTS */ }

    // MeloTTS fallback
    try {
      const meloRes = await env.AI.run("@cf/myshell-ai/melotts", {
        prompt: cap,
        lang: "en",
      });
      const audioBytes = await extractAudioBytes(meloRes);
      if (audioBytes && audioBytes.length > 500) {
        return audioResponse(cors, audioBytes);
      }
    } catch { /* fall through to StreamElements */ }
  }

  // StreamElements: keyless Amazon Polly proxy, no per-user quota. Voice
  // options include Brian (male UK), Amy (female UK), Joanna (female US),
  // Matthew (male US), Salli, Ivy, Kimberly. Brian is the classic choice.
  try {
    const seVoice = mapVoiceToStreamElements(voice) || "Brian";
    const seUrl = "https://api.streamelements.com/kappa/v2/speech?" +
      new URLSearchParams({ voice: seVoice, text: cap });
    const seRes = await fetch(seUrl, { method: "GET" });
    if (seRes.ok) {
      const buf = new Uint8Array(await seRes.arrayBuffer());
      if (buf.length > 500) return audioResponse(cors, buf);
    }
  } catch { /* fall through */ }

  return jsonErr(cors, 502, "TTS unavailable", true);
}

// ---- helpers ----

function jsonErr(cors, status, msg, useBrowserFallback) {
  const body = { error: msg };
  if (useBrowserFallback) body.useBrowserFallback = true;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function audioResponse(cors, audioBytes) {
  return new Response(audioBytes, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audioBytes.length),
    },
  });
}

async function extractAudioBytes(result) {
  if (!result) return null;
  if (result.audio) {
    // base64 string
    const binary = atob(result.audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  if (result instanceof ReadableStream) {
    const reader = result.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    return bytes;
  }
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result instanceof Uint8Array) return result;
  return null;
}

// Map a generic voice name coming from the frontend to the closest available
// StreamElements voice. Lets users pick "male/female" without knowing the
// specific engine.
function mapVoiceToStreamElements(voice) {
  const v = (voice || "").toLowerCase();
  if (v.includes("male") && !v.includes("female")) return "Brian";
  if (v.includes("female")) return "Amy";
  if (v.includes("luna") || v.includes("asteria")) return "Amy";
  if (v.includes("orion") || v.includes("perseus")) return "Brian";
  return null; // caller will use default
}

// Preprocess raw markdown text into speech-friendly prose:
//   - strip [1] [2] citation markers so they aren't spelled out
//   - remove markdown asterisks, backticks, headers
//   - strip URLs (spoken URLs are nightmarish)
//   - expand a handful of scientific abbreviations
//   - normalize whitespace and add sentence pauses via punctuation
function preprocessForSpeech(raw) {
  let s = raw;
  // Kill markdown syntax
  s = s.replace(/\[\d+\]/g, "");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*\n]+)\*/g, "$1");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/_([^_\n]+)_/g, "$1");
  s = s.replace(/^#+\s+/gm, "");
  // URLs — reading these aloud is awful
  s = s.replace(/https?:\/\/\S+/g, "");
  s = s.replace(/doi:\s*\S+/gi, "");
  // Expand common scientific abbreviations so the voice pronounces them right
  const expansions = [
    [/\bDr\.\s+/g, "Doctor "],
    [/\bMr\.\s+/g, "Mister "],
    [/\bMrs\.\s+/g, "Missus "],
    [/\bMs\.\s+/g, "Miss "],
    [/\bProf\.\s+/g, "Professor "],
    [/\bSt\.\s+/g, "Saint "],
    [/\betc\./g, "etcetera"],
    [/\be\.g\./g, "for example"],
    [/\bi\.e\./g, "that is"],
    [/\bvs\.?\s+/g, "versus "],
    [/\bp\s*<\s*0\.05\b/gi, "p less than zero point zero five"],
    [/\bp\s*<\s*0\.01\b/gi, "p less than zero point zero one"],
    [/\bCO2\b/g, "carbon dioxide"],
    [/\bH2O\b/g, "water"],
    [/\bDNA\b/g, "D N A"],
    [/\bRNA\b/g, "R N A"],
    [/\bmRNA\b/g, "messenger R N A"],
    [/\bPCR\b/g, "P C R"],
    [/\bCRISPR\b/g, "crisper"],
    [/\bfMRI\b/g, "functional M R I"],
    [/\bMRI\b/g, "M R I"],
    [/\bBSFL\b/g, "B S F L"],
    [/\bUTK\b/g, "U T K"],
    [/\bNIH\b/g, "N I H"],
    [/\bFDA\b/g, "F D A"],
    [/\bCDC\b/g, "C D C"],
    [/\bWHO\b/g, "World Health Organization"],
    [/\bAI\b/g, "A I"],
    [/\bLLM\b/g, "large language model"],
    [/\bLLMs\b/g, "large language models"],
  ];
  for (const [re, replacement] of expansions) s = s.replace(re, replacement);
  // Bullet dashes at line start become sentence starts
  s = s.replace(/^\s*[-•*]\s+/gm, ". ");
  // Multiple blank lines become a period-space so voice inserts a pause
  s = s.replace(/\n{2,}/g, ". ");
  s = s.replace(/\n/g, " ");
  // Semicolons become periods for a firmer pause
  s = s.replace(/;/g, ".");
  // Excess whitespace and stray double punctuation
  s = s.replace(/\s+/g, " ");
  s = s.replace(/\.\s*\./g, ".");
  s = s.replace(/,\s*,/g, ",");
  s = s.trim();
  return s;
}
