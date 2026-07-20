import { gatherPapers } from "./_sources.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const question = (body?.query || "").trim();
  if (!question) return json({ error: "Empty query." }, 400);

  // 1) Gather real papers from databases (runs on the edge; no CORS issues).
  let gathered;
  try {
    gathered = await gatherPapers(question, {
      openAlexKey: env.OPENALEX_KEY || "",
      s2Key: env.SEMANTIC_SCHOLAR_KEY || "",
    });
  } catch (e) {
    return json({ error: `Could not reach paper databases: ${e.message}` }, 502);
  }

  const papers = gathered.papers;
  const sourceList = papers.map((p) => ({
    title: p.title,
    url: p.url,
    year: p.year,
    citations: p.citations,
    authors: p.authors,
    journal: p.journal,
  }));

  if (!papers.length) {
    return json({
      answer: "",
      sources: [],
      source: gathered.source,
      note: "No papers with abstracts found. Try rephrasing.",
    });
  }

  // 2) Ground Claude strictly in those papers.
  const evidence = papers
    .map(
      (p, i) =>
        `[${i + 1}] ${p.title} (${p.authors || "n/a"}, ${p.journal || "n/a"}, ${
          p.year || "n/a"
        }${typeof p.citations === "number" ? `; cited ${p.citations}x` : ""})\nAbstract: ${
          p.abstract || "not available"
        }`
    )
    .join("\n\n");

  const system = [
    "You are Cerebrum, a scientific reference engine. You are given a numbered set of real papers.",
    "Answer the user's question using ONLY these papers. Do not invent sources or facts not in them.",
    "Rules:",
    "1. State only what the abstracts support. If they conflict, present the competing findings neutrally. If they don't cover the question, say so plainly.",
    "2. Be precise; define terms briefly. Keep it tight: 2-4 short paragraphs.",
    "3. INLINE CITATIONS: mark each supported claim with [n] matching the paper numbers. Use only numbers that exist.",
    "4. Output ONLY the answer text with inline [n] markers. No preamble, no source list.",
  ].join("\n");

  const prompt = `${system}\n\nPapers:\n\n${evidence}\n\n---\nQuestion: ${question}`;

  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1100, temperature: 0.3 },
        }),
      }
    );

    if (!res.ok) {
      const detail = await res.text();
      return json({
        answer: "",
        sources: sourceList,
        source: gathered.source,
        note: `Answer generation failed (HTTP ${res.status}); sources are below.`,
        detail: detail.slice(0, 300),
      });
    }

    const data = await res.json();
    const answer = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("")
      .trim();

    return json({
      answer,
      sources: sourceList,
      source: gathered.source,
      utkCount: gathered.utkCount,
    });
  } catch (e) {
    return json({
      answer: "",
      sources: sourceList,
      source: gathered.source,
      note: `Answer generation failed (${e.message}); sources are below.`,
    });
  }
}
