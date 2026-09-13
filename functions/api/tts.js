import { corsHeaders, readOriginAllowed, readJsonBody } from "../lib/http.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { withTimeout, neverFail, fetchWithTimeout, jsonError, clampText } from "../lib/resilience.js";

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


const RATE_LIMIT = 20;         // TTS requests
const RATE_WINDOW_MS = 60000;  // per minute

export async function onRequest(context) {
  const { request, env } = context;

  const cors = corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return jsonError(405, "method_not_allowed", "Method not allowed.", cors);
  }
  if (!readOriginAllowed(request, env)) {
    return jsonError(403, "origin_not_allowed", "Origin not allowed.", cors);
  }

  const clientIP =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown";
  if (!(await checkRateLimit(env, `tts:${clientIP}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonError(429, "rate_limited", "Too many requests. Please wait a moment and try again.", {
      ...cors, "Retry-After": "30",
    });
  }

  let body;
  // 2026-09-12: bounded body read — request.json() alone buffers any size.
  const parsed = await readJsonBody(request, cors, 256 * 1024);
  if (!parsed.ok) return parsed.response;
  body = parsed.body;
  // Bug: a request body of the literal 4 bytes `null` is valid JSON, so it
  // parses successfully to `body = null` with no exception — the catch
  // above never fires. The next line used to dereference `.text` on that
  // null unguarded, throwing a TypeError with no try/catch around it, so
  // the client got Cloudflare's generic platform error page (no CORS
  // headers attached, since those are only added by this file's own
  // Response construction) instead of this file's normal JSON error shape.
  if (!body || typeof body !== "object") {
    return jsonError(400, "invalid_body", "Bad request body.", cors);
  }

  // Cap the RAW input before any processing — see hardening note above.
  // clampText also coerces non-string input safely, so a numeric or object
  // `text` can't reach the regex passes in an unexpected form.
  const raw = clampText(body.text, 6000);
  if (!raw) return jsonError(400, "missing_text", "Missing text.", cors);

  // Preprocess text for more natural speech. Every TTS engine benefits from
  // this — abbreviations expanded, citations stripped, symbols softened,
  // sentence breaks turned into real pauses.
  const text = preprocessForSpeech(raw);
  if (!text) return jsonError(400, "empty_after_cleaning", "Empty after cleaning.", cors);

  const cap = text.length > 4500 ? text.slice(0, 4500) : text;
  const voice = clampText(body.voice, 64);

  // ------------------------------------------------------------------
  // Commit 85 — why this narration sounded robotic.
  //
  // The Aura call below used to pass speaker: "aura-asteria-en". That is
  // Deepgram's OWN model naming, not the speaker name Workers AI expects:
  // @cf/deepgram/aura-1 takes a BARE voice name (asteria, luna, orion,
  // angus...). An unknown speaker made the call fail, the failure was
  // swallowed by a bare `catch {}`, and every single request quietly fell
  // through to MeloTTS — which is the flat, synthetic voice actually being
  // heard. Aura was in the code but had never once produced audio.
  //
  // Fixed, and the fallback order changed with it. StreamElements' keyless
  // Polly proxy now sits AHEAD of MeloTTS rather than behind it: Polly's
  // Brian/Joanna are markedly more human than MeloTTS, and both are free,
  // so there is no reason MeloTTS should ever have been the one people got.
  // MeloTTS is now the last resort before the browser's own synthesizer.
  //
  // Aura itself is NOT free — 1,364 neurons per 1k characters against a
  // 10,000/day allocation, which is roughly two or three answers per day
  // across the whole site before it starts billing. So it is opt-in: set
  // TTS_PREMIUM=1 in the Pages environment to put it at the front of the
  // chain, and TTS_PREMIUM=2 to use aura-2-en (better again, and twice the
  // price). Unset — the default — means nothing here can ever cost money.
  //
  // Every response now carries X-Cerebrum-Voice naming the engine that
  // actually produced it, because "which of the four tiers am I hearing"
  // was previously unanswerable from outside.
  // ------------------------------------------------------------------
  const premium = String((env && env.TTS_PREMIUM) || "").trim();
  const wantsMale = /\bmale\b/.test(voice.toLowerCase()) && !/female/.test(voice.toLowerCase());

  if (premium && env.AI && typeof env.AI.run === "function") {
    // Paid tier (Deepgram Aura via Workers AI bills per neuron): only for
    // signed-in users. Anonymous callers fall through to the free tiers
    // below instead of burning the site's daily allocation.
    let signedIn = false;
    try {
      const { getSessionUser } = await import("../lib/authHelpers.js");
      signedIn = !!(await getSessionUser(request, env));
    } catch { signedIn = false; }
    if (!signedIn) {
      console.log("[tts] premium tier skipped: anonymous caller");
    } else {
    const tiers = premium === "2"
      ? [["@cf/deepgram/aura-2-en", wantsMale ? "orion" : "luna"],
         ["@cf/deepgram/aura-1", wantsMale ? "orion" : "asteria"]]
      : [["@cf/deepgram/aura-1", wantsMale ? "orion" : "asteria"]];
    for (const [model, speaker] of tiers) {
      try {
        const res = await withTimeout(
          env.AI.run(model, { text: cap, speaker, encoding: "mp3" }),
          8000, model
        );
        const audioBytes = await extractAudioBytes(res);
        if (looksLikeAudio(audioBytes)) {
          return audioResponse(cors, audioBytes, model.split("/").pop());
        }
      } catch { /* next tier */ }
      }
    }
  }

  // StreamElements: keyless Amazon Polly proxy, no key, no quota, free.
  // Brian (male UK), Amy (female UK), Joanna (female US), Matthew (male US).
  // Its URL is a GET with the text in the query string, so it has a much
  // shorter practical length limit than the 4500 the tiers above accept —
  // long answers are sent as sequential chunks and the MP3 frames
  // concatenated, which players handle fine, rather than being truncated
  // mid-sentence the way a single over-long request would be.
  // Sequential per chunk, in order: concatenation preserves narration order,
  // and all-or-nothing (below) means a missing chunk never leaves an audible
  // gap mid-sentence — the tier simply yields and the next one is tried.
  try {
    const seVoice = mapVoiceToStreamElements(voice) || "Brian";
    const chunks = chunkForPolly(sanitizeForPolly(cap), 540).slice(0, 8);
    const parts = [];
    let bytes = 0;
    let failed = false;
    for (const piece of chunks) {
      const seUrl = "https://api.streamelements.com/kappa/v2/speech?" +
        new URLSearchParams({ voice: seVoice, text: piece });
      // fetchWithTimeout: an explicit deadline on every upstream call, so a
      // hanging proxy can never stall the whole tier.
      const seRes = await neverFail(
        fetchWithTimeout(seUrl, { method: "GET" }, 8000),
        null,
        "streamelements"
      );
      if (!seRes || !seRes.ok) { failed = true; break; }
      const buf = new Uint8Array(await seRes.arrayBuffer());
      if (!looksLikeAudio(buf, seRes.headers.get("Content-Type"))) { failed = true; break; }
      parts.push(buf);
      bytes += buf.length;
    }
    if (!failed && parts.length) {
      if (parts.length === 1) return audioResponse(cors, parts[0], "polly");
      const joined = new Uint8Array(bytes);
      let off = 0;
      for (const p of parts) { joined.set(p, off); off += p.length; }
      return audioResponse(cors, joined, "polly");
    }
  } catch { /* fall through */ }

  // MeloTTS — always available on Workers AI, effectively free (18.63
  // neurons per audio minute), and the flattest of the lot. Last resort.
  if (env.AI && typeof env.AI.run === "function") {
    try {
      const meloRes = await withTimeout(
        env.AI.run("@cf/myshell-ai/melotts", { prompt: cap, lang: "en" }),
        8000, "MeloTTS"
      );
      const audioBytes = await extractAudioBytes(meloRes);
      if (looksLikeAudio(audioBytes)) {
        return audioResponse(cors, audioBytes, "melotts");
      }
    } catch { /* fall through to the browser synthesizer */ }
  }

  return jsonError(502, "tts_unavailable", "TTS unavailable.", cors);
}

// ---- helpers ----
// withTimeout / safe HTTP / response-shape helpers now live in
// ../lib/resilience.js and are shared across the media endpoints, so a
// timeout-semantics fix lands everywhere at once.

/* Commit 85 — "unable to synthesize".

   StreamElements' Polly proxy answers a request it cannot voice with HTTP
   200 and a short PLAIN TEXT body saying so. The old code accepted any 200
   whose body was over 500 bytes as audio and handed it to the browser with
   Content-Type: audio/mpeg, so an error string could be served as a sound
   file — the player then failed on garbage instead of falling through to
   the next engine, and the upstream's own words leaked to the user. Nothing
   leaves this endpoint now unless it actually looks like audio: an ID3 tag,
   an MPEG frame sync, or a RIFF/OGG container. */
function looksLikeAudio(bytes, contentType) {
  if (!bytes || bytes.length < 512) return false;
  const ct = (contentType || "").toLowerCase();
  if (ct && !ct.startsWith("audio/") && !ct.includes("octet-stream") && !ct.includes("mpeg")) return false;
  const b = bytes;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true;             // "ID3"
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return true;                      // MPEG frame sync
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return true; // "OggS"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return true; // "RIFF"
  if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return true; // "fLaC"
  return false;
}

/* Polly's proxy rejects some characters outright rather than skipping them,
   which is the other way a request comes back unvoiced. Speech text needs
   none of them. */
function sanitizeForPolly(s) {
  return String(s)
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/["<>&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// withTimeout, jsonErr: moved to ../lib/resilience.js and shared across the
// media endpoints, so timeout semantics and the error shape stay identical
// everywhere instead of drifting per file again.

function audioResponse(cors, audioBytes, engine) {
  return new Response(audioBytes, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audioBytes.length),
      // Which of the four tiers actually spoke. Previously impossible to
      // tell from outside, which is how a broken Aura call went unnoticed
      // for as long as it did.
      "X-Cerebrum-Voice": String(engine || "unknown"),
      "Access-Control-Expose-Headers": "X-Cerebrum-Voice",
    },
  });
}

// Split speech-ready prose into pieces small enough for a GET query string,
// breaking on sentence ends so no chunk boundary lands mid-clause (which is
// audible as a swallowed word). Falls back to a hard slice for a single
// sentence longer than the limit.
function chunkForPolly(text, limit) {
  const sentences = String(text).match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [text];
  const out = [];
  let cur = "";
  for (const raw of sentences) {
    let piece = raw.trim();
    if (!piece) continue;
    while (piece.length > limit) {
      if (cur) { out.push(cur); cur = ""; }
      out.push(piece.slice(0, limit));
      piece = piece.slice(limit);
    }
    if (!cur) cur = piece;
    else if (cur.length + 1 + piece.length <= limit) cur += " " + piece;
    else { out.push(cur); cur = piece; }
  }
  if (cur) out.push(cur);
  return out;
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

  // ---- structure -------------------------------------------------------
  // Commit 85 — a heading used to be flattened to a bare word butted
  // against the sentence after it ("The short answer The concept of..."),
  // which is a large part of why the narration sounded like a machine
  // reading a file rather than a person reading an answer. A heading is now
  // spoken as its own short sentence with a full stop, so the voice drops
  // pitch and takes a real breath before the section starts.
  s = s.replace(/^[ \t]*#{1,6}[ \t]+([^\n]+)$/gm, (m, t) => {
    const clean = t.replace(/[*_`#]/g, "").replace(/[:?.]+$/, "").trim();
    return clean ? "\n\n" + clean + ". \n\n" : "";
  });

  // Kill remaining markdown syntax
  s = s.replace(/\[\d+\]/g, "");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*\n]+)\*/g, "$1");
  s = s.replace(/`([^`\n]+)`/g, "$1");
  s = s.replace(/_([^_\n]+)_/g, "$1");
  s = s.replace(/#{1,6}/g, "");
  // URLs and identifiers — reading these aloud is awful
  s = s.replace(/https?:\/\/\S+/g, "");
  s = s.replace(/doi:\s*\S+/gi, "");
  s = s.replace(/\bdoi\.org\/\S+/gi, "");

  // ---- numbers, units and symbols -------------------------------------
  // Commit 85 — none of this existed, so an answer full of measurements
  // (which is most of them) was read as a stream of symbol names or, worse,
  // silently skipped: "4°C to 54°C" came out as "4C to 54C", and
  // "3.076 × 10^3" as "3.076 x 10 3".
  s = s.replace(/(\d)\s*°\s*C\b/g, "$1 degrees Celsius");
  s = s.replace(/(\d)\s*°\s*F\b/g, "$1 degrees Fahrenheit");
  s = s.replace(/(\d)\s*°/g, "$1 degrees");
  s = s.replace(/(\d)\s*%/g, "$1 percent");
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*[×x]\s*10\s*\^?\s*(-?\d+)/gi, "$1 times ten to the power of $2");
  s = s.replace(/(\d)\s*[×]\s*(\d)/g, "$1 by $2");
  s = s.replace(/±/g, " plus or minus ");
  s = s.replace(/(\d)\s*[–—-]\s*(\d)/g, "$1 to $2");
  // "n = 1,830 samples" must not become "a sample of 1,830 samples".
  s = s.replace(/\bn\s*=\s*([\d,]+)\s*samples?\b/gi, "a sample of $1");
  s = s.replace(/\bn\s*=\s*([\d,]+)\s*(participants?|patients?|subjects?|cases?|animals?)\b/gi, "a sample of $1 $2");
  s = s.replace(/\bn\s*=\s*([\d,]+)/gi, "a sample of $1");
  s = s.replace(/\s*≥\s*/g, " at least ");
  s = s.replace(/\s*≤\s*/g, " at most ");
  s = s.replace(/\s*→\s*/g, " leading to ");
  s = s.replace(/\s*~\s*(\d)/g, " approximately $1");
  s = s.replace(/\bµ/g, "micro");
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*mg\b/g, "$1 milligrams");
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*kg\b/g, "$1 kilograms");
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*ml\b/gi, "$1 millilitres");
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*mm\b/g, "$1 millimetres");
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*cm\b/g, "$1 centimetres");
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*km\b/g, "$1 kilometres");
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*h\b/g, "$1 hours");

  // Expand common scientific abbreviations so the voice pronounces them right
  const expansions = [
    [/\bet\s+al\.?/gi, "and colleagues"],
    [/\bDr\.\s+/g, "Doctor "],
    [/\bMr\.\s+/g, "Mister "],
    [/\bMrs\.\s+/g, "Missus "],
    [/\bMs\.\s+/g, "Miss "],
    [/\bProf\.\s+/g, "Professor "],
    [/\bSt\.\s+/g, "Saint "],
    [/\betc\./g, "etcetera"],
    [/\be\.g\.,?/g, "for example"],
    [/\bi\.e\.,?/g, "that is"],
    [/\bcf\./gi, "compare"],
    [/\bvs\.?\s+/g, "versus "],
    [/\bp\s*<\s*0\.001\b/gi, "p less than zero point zero zero one"],
    [/\bp\s*<\s*0\.05\b/gi, "p less than zero point zero five"],
    [/\bp\s*<\s*0\.01\b/gi, "p less than zero point zero one"],
    [/\bCI\b/g, "confidence interval"],
    [/\bSD\b/g, "standard deviation"],
    [/\bRCTs\b/g, "randomized controlled trials"],
    [/\bRCT\b/g, "randomized controlled trial"],
    [/\bin vivo\b/gi, "in vee-vo"],
    [/\bin vitro\b/gi, "in vee-tro"],
    [/\bCO2\b/g, "carbon dioxide"],
    [/\bH2O\b/g, "water"],
    [/\bDNA\b/g, "D N A"],
    [/\bRNA\b/g, "R N A"],
    [/\bmRNA\b/g, "messenger R N A"],
    [/\bPCR\b/g, "P C R"],
    [/\bCRISPR\b/g, "crisper"],
    [/\bfMRI\b/g, "functional M R I"],
    [/\bMRI\b/g, "M R I"],
    [/\bEEG\b/g, "E E G"],
    [/\bBMI\b/g, "B M I"],
    [/\bBSFL\b/g, "B S F L"],
    [/\bUTK\b/g, "U T K"],
    [/\bNIH\b/g, "N I H"],
    [/\bFDA\b/g, "F D A"],
    [/\bCDC\b/g, "C D C"],
    [/\bWHO\b/g, "World Health Organization"],
    [/\bAI\b/g, "A I"],
    [/\bLLMs\b/g, "large language models"],
    [/\bLLM\b/g, "large language model"],
  ];
  for (const [re, replacement] of expansions) s = s.replace(re, replacement);

  // ---- phrasing --------------------------------------------------------
  // Commit 85 — pauses. Every TTS engine takes its breathing entirely from
  // punctuation, and academic prose is full of constructions that carry no
  // punctuation the engine understands: em-dash asides, parenthetical
  // clauses, colons introducing a list. Left alone they are read as one
  // unbroken breath, which is the single most machine-like thing a
  // synthesized voice does. Each becomes a comma or a full stop.
  s = s.replace(/\s*[—–]\s*/g, ", ");
  s = s.replace(/\s*\(\s*/g, ", ").replace(/\s*\)\s*/g, ", ");
  s = s.replace(/\s*:\s*/g, ". ");
  s = s.replace(/;/g, ".");
  // Bullet dashes at line start become sentence starts
  s = s.replace(/^\s*[-•*]\s+/gm, ". ");
  // Blank lines become a full stop so the voice inserts a real pause
  s = s.replace(/\n{2,}/g, ". ");
  s = s.replace(/\n/g, " ");

  // ---- tidy ------------------------------------------------------------
  s = s.replace(/\s+/g, " ");
  s = s.replace(/\s+([.,])/g, "$1");
  s = s.replace(/(?:\.\s*){2,}/g, ". ");
  s = s.replace(/(?:,\s*){2,}/g, ", ");
  s = s.replace(/,\s*\./g, ".");
  s = s.replace(/\.\s*,/g, ". ");
  s = s.replace(/^[\s.,]+/, "");
  s = s.trim();
  // Re-capitalise sentence starts. The rewrites above turn colons,
  // semicolons and blank lines into full stops, which leaves a lot of
  // lowercase words sitting at the head of a sentence; several engines use
  // capitalisation as a cue for where a new intonation contour begins.
  s = s.replace(/(^|[.!?]\s+)([a-z])/g, (m, lead, ch) => lead + ch.toUpperCase());
  // A trailing clause with no terminator makes the voice trail off flatly.
  if (s && !/[.!?]$/.test(s)) s += ".";
  return s;
}
