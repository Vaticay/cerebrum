// TTS endpoint powered by Cloudflare Workers AI.
// Uses MeloTTS (@cf/myshell-ai/melotts), which runs on Cloudflare's infra with
// no per-request API cost within your Workers AI free tier (10,000 neurons/day).
// Returns audio/mpeg directly to the browser.
//
// The frontend calls this endpoint instead of shipping any TTS key.
// Everyone using the site gets the same free voice.

export async function onRequest(context) {
  const { request, env } = context;
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Bad JSON" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const raw = (body.text || "").toString().trim();
  if (!raw) {
    return new Response(JSON.stringify({ error: "Missing text" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Strip markdown, citation markers, and other artifacts so the voice reads
  // clean prose. Otherwise MeloTTS will pronounce "[3]" as "bracket three".
  const clean = raw
    .replace(/\[\d+\]/g, "")                 // citation markers [1] [2]
    .replace(/\*\*([^*]+)\*\*/g, "$1")        // bold
    .replace(/\*([^*\n]+)\*/g, "$1")          // italic
    .replace(/`([^`]+)`/g, "$1")              // inline code
    .replace(/https?:\/\/\S+/g, "")           // URLs
    .replace(/^#+\s+/gm, "")                  // header markers
    .replace(/\n{2,}/g, ". ")                  // paragraph breaks -> pause
    .replace(/\s+/g, " ")
    .trim();

  // MeloTTS accepts up to ~5000 chars per call. Cap it defensively.
  const text = clean.length > 4800 ? clean.slice(0, 4800) : clean;

  // If Workers AI isn't bound in this deployment, fall back to a 501 so the
  // frontend knows to use browser TTS.
  if (!env.AI || typeof env.AI.run !== "function") {
    return new Response(JSON.stringify({ error: "TTS unavailable", useBrowserFallback: true }), {
      status: 501,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    // Language codes MeloTTS supports: en, es, fr, zh, jp, kr
    const lang = (body.lang || "en").toString().toLowerCase().slice(0, 2);
    const result = await env.AI.run("@cf/myshell-ai/melotts", {
      prompt: text,
      lang: lang === "en" ? "en" : "en", // stick to en for now
    });

    // Workers AI returns either an object with `audio` (base64) or a raw stream
    // depending on how the runtime is configured. Handle both.
    let audioBytes;
    if (result && result.audio) {
      // base64
      const binary = atob(result.audio);
      audioBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) audioBytes[i] = binary.charCodeAt(i);
    } else if (result instanceof ReadableStream) {
      const reader = result.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
      audioBytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) { audioBytes.set(c, offset); offset += c.length; }
    } else {
      throw new Error("Unexpected TTS response shape");
    }

    return new Response(audioBytes, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBytes.length),
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: "TTS synthesis failed",
      detail: (err && err.message) || String(err),
      useBrowserFallback: true,
    }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
}
