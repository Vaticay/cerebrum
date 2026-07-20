// Cerebrum backend — Cloudflare Pages Function.
// Hybrid: answers any question like an AI, cites real papers when found.

function stripTags(s) {
  return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function decodeInverted(inv) {
  if (!inv) return "";
  const words = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) words[p] = word;
  }
  return words.join(" ").replace(/\s+/g, " ").trim();
}

async function getJSON(url, headers = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 9000);
  try {
    const res = await fetch(url, { headers, signal: c.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function getText(url, headers = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 9000);
  try {
    const res = await fetch(url, { headers, signal: c.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

// ---------- Source: Europe PMC ----------
async function europePMC(query, limit = 8) {
  const url =
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
    new URLSearchParams({ query, resultType: "core", pageSize: String(limit), format: "json", sort: "CITED desc" });
  try {
    const data = await getJSON(url);
    const rows = data?.resultList?.result || [];
    return rows
      .filter((r) => r.abstractText)
      .map((r) => ({
        title: r.title || "Untitled",
        url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
        year: r.pubYear || "",
        citations: r.citedByCount ?? null,
        authors: r.authorString || "",
        journal: r.journalTitle || "Europe PMC",
        abstract: stripTags(r.abstractText),
      }));
  } catch {
    return [];
  }
}

// ---------- Source: PubMed ----------
function firstMatch(block, re) {
  const m = block.match(re);
  return m ? m[1] : "";
}
function parsePubmedXML(xmlText) {
  const arts = xmlText.match(/<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/g) || [];
  return arts.map((a) => {
    const pmid = firstMatch(a, /<PMID[^>]*>(\d+)<\/PMID>/);
    const title = stripTags(firstMatch(a, /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/));
    const absParts = a.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g) || [];
    const abstract = stripTags(absParts.join(" "));
    const journal = stripTags(firstMatch(a, /<Title>([\s\S]*?)<\/Title>/) || firstMatch(a, /<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/));
    const year = firstMatch(a, /<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/);
    const authorBlocks = a.match(/<Author\b[\s\S]*?<\/Author>/g) || [];
    const names = authorBlocks
      .map((b) => {
        const last = firstMatch(b, /<LastName>([\s\S]*?)<\/LastName>/);
        const ini = firstMatch(b, /<Initials>([\s\S]*?)<\/Initials>/);
        return [last, ini].filter(Boolean).join(" ");
      })
      .filter(Boolean);
    const authors = names.length > 1 ? `${names[0]} et al.` : names[0] || "";
    const doi = firstMatch(a, /<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/);
    return {
      title: title || "Untitled",
      url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      year,
      citations: null,
      authors,
      journal: journal || "PubMed",
      abstract,
    };
  });
}
async function pubmed(query, limit = 8) {
  const tool = "&tool=cerebrum&email=noreply@example.com";
  try {
    const es = await getJSON(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" +
        new URLSearchParams({ db: "pubmed", term: query, retmax: String(limit), retmode: "json", sort: "relevance" }) +
        tool
    );
    const ids = es?.esearchresult?.idlist || [];
    if (!ids.length) return [];
    const xml = await getText(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?" +
        new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "xml" }) +
        tool
    );
    return parsePubmedXML(xml).filter((r) => r.abstract);
  } catch {
    return [];
  }
}

// ---------- Source: OpenAlex ----------
async function openAlex(query, limit = 8, key = "") {
  if (!key) return [];
  try {
    const params = new URLSearchParams({
      search: query,
      filter: "is_oa:true",
      sort: "relevance_score:desc",
      per_page: String(limit),
      select: "title,doi,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships",
      api_key: key,
    });
    const data = await getJSON(`https://api.openalex.org/works?${params}`);
    return (data.results || [])
      .map((w) => {
        const first = w.authorships?.[0]?.author?.display_name || "";
        return {
          title: w.title || "Untitled",
          url: w.doi || w.primary_location?.landing_page_url || w.primary_location?.pdf_url || "",
          year: w.publication_year || "",
          citations: w.cited_by_count ?? null,
          authors: w.authorships?.length > 1 ? `${first} et al.` : first,
          journal: w.primary_location?.source?.display_name || "OpenAlex",
          abstract: decodeInverted(w.abstract_inverted_index),
        };
      })
      .filter((p) => p.abstract);
  } catch {
    return [];
  }
}

// ---------- Source: UTK TRACE ----------
function extractTraceRecords(xmlText) {
  const records = [];
  const recRe = /<record\b[\s\S]*?<\/record>/g;
  const tag = (block, name) => {
    const re = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "i");
    const m = block.match(re);
    return m ? m[1].trim() : "";
  };
  const tagAll = (block, name) => {
    const re = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "gi");
    const out = [];
    let m;
    while ((m = re.exec(block))) out.push(m[1].trim());
    return out;
  };
  let rm;
  while ((rm = recRe.exec(xmlText))) {
    const block = rm[0];
    const title = tag(block, "title");
    const abstract = tag(block, "abstract") || tag(block, "description");
    const ids = tagAll(block, "identifier");
    const url = ids.find((x) => x.startsWith("http")) || ids[0] || "";
    const authors = tagAll(block, "creator").join(", ");
    const year = (tag(block, "date") || "").slice(0, 4);
    if (title && abstract) records.push({ title, abstract, url, authors, year });
  }
  return records;
}
async function traceUTK(query) {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
  if (!terms.length) return [];
  const sets = ["publication:utk_graddiss", "publication:utk_gradthes"];
  const all = [];
  for (const set of sets) {
    try {
      const text = await getText(
        "https://trace.tennessee.edu/do/oai/?" +
          new URLSearchParams({ verb: "ListRecords", metadataPrefix: "dcq", set })
      );
      all.push(...extractTraceRecords(text));
    } catch {
      /* best effort */
    }
  }
  const scored = all
    .map((r) => {
      const hay = `${r.title} ${r.abstract}`.toLowerCase();
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { ...r, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return scored.map((r) => ({
    title: r.title,
    url: r.url,
    year: r.year,
    citations: null,
    authors: r.authors,
    journal: "UTK TRACE",
    abstract: stripTags(r.abstract),
  }));
}

// Strip filler/question words so only real topic terms hit the databases.
const STOPWORDS = new Set([
  "what","whats","how","does","do","did","is","are","was","were","the","a","an",
  "of","in","on","for","to","and","or","with","by","about","tell","me","explain",
  "why","when","where","which","who","can","you","please","give","show","find",
  "search","look","up","that","this","these","those","it","its","work","works",
  "happen","happens","mean","means","between","into","from","as","at","be","been",
  "get","got","i","my","we","our","use","used","using","there","their","they",
]);

function cleanQuery(raw) {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .join(" ")
    .trim();
  return cleaned || raw.trim();
}

// ---------- Gather + rank ----------
async function gatherPapers(rawQuery, { openAlexKey }) {
  const query = cleanQuery(rawQuery);
  const [epmc, pm, trace, oa] = await Promise.all([
    europePMC(query, 8),
    pubmed(query, 8),
    traceUTK(query),
    openAlex(query, 8, openAlexKey),
  ]);

  const merged = [];
  const seen = new Set();
  for (const list of [epmc, pm, oa, trace]) {
    for (const p of list) {
      const key = (p.title || "").toLowerCase().trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push(p);
      }
    }
  }

  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const scored = merged
    .map((p) => {
      const hay = `${p.title} ${p.abstract}`.toLowerCase();
      const hits = terms.filter((t) => hay.includes(t)).length;
      const coverage = terms.length ? hits / terms.length : 0;
      let score = hits + coverage * 2;
      if (typeof p.citations === "number") score += Math.min(p.citations / 500, 1.5);
      return { ...p, score, coverage };
    })
    .filter((p) => (terms.length <= 1 ? p.coverage > 0 : p.coverage >= 0.5))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const usedUTK = scored.some((p) => p.journal === "UTK TRACE");
  return { papers: scored, utk: usedUTK };
}

// ---------- The endpoint ----------
const cors = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const query = (body.query || "").trim();
    if (!query) {
      return new Response(JSON.stringify({ error: "No query provided." }), { status: 400, headers: cors });
    }

    // Small talk: quick friendly reply, no search.
    const small = query.toLowerCase().replace(/[^a-z\s]/g, "").trim();
    const greetings = ["hi", "hello", "hey", "yo", "sup", "howdy", "hiya"];
    if (greetings.includes(small)) {
      return new Response(JSON.stringify({
        answer: "Hi! I'm Cerebrum. Ask me anything — science questions get answers backed by real papers with citations, and I'll do my best with general questions too.",
        sources: [],
        source: "Cerebrum",
      }), { status: 200, headers: cors });
    }

    // Gather papers (best effort; may be empty for non-science questions).
    let papers = [];
    let utk = false;
    try {
      const g = await gatherPapers(query, { openAlexKey: env.OPENALEX_KEY || "" });
      papers = g.papers;
      utk = g.utk;
    } catch {
      papers = [];
    }

    const sourceList = papers.map(({ title, url, journal, authors, year, citations }) => ({ title, url, journal, authors, year, citations }));

    const hasPapers = papers.length > 0;
    const evidence = hasPapers
      ? papers.map((p, i) => `[${i + 1}] ${p.title} (${p.authors || "n/a"}, ${p.journal}, ${p.year || "n/a"}${typeof p.citations === "number" ? `, cited ${p.citations}x` : ""})\nAbstract: ${p.abstract}`).join("\n\n")
      : "";

    const systemPrompt = hasPapers
      ? "You are Cerebrum, a knowledgeable science assistant. You are given real papers as evidence. Answer the user's question clearly and helpfully. When a claim is supported by one of the papers, cite it inline like [1] or [2] using the paper numbers. You may also use your own general knowledge for context, but prefer the papers for specific scientific claims. If the wording has typos, interpret the intent. Keep it clear and well structured, a few short paragraphs."
      : "You are Cerebrum, a knowledgeable and helpful assistant. Answer the user's question clearly and accurately using your own knowledge. If the wording has typos, interpret what they meant. Be honest if unsure. Keep it clear and well structured. Do not fabricate citations or references.";

    const userContent = hasPapers
      ? `Papers:\n\n${evidence}\n\n---\nQuestion: ${query}`
      : query;

    let answer = "";
    let aiOK = false;

    const token = env.OPENROUTER_API_KEY;
    if (token) {
      const models = ["openrouter/free", "meta-llama/llama-3.3-70b-instruct:free", "google/gemini-2.0-flash-exp:free"];
      for (const model of models) {
        try {
          const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "HTTP-Referer": "https://cerebrum.pages.dev",
              "X-Title": "Cerebrum",
            },
            body: JSON.stringify({
              model,
              temperature: 0.3,
              max_tokens: 900,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent },
              ],
            }),
          });
          if (r.ok) {
            const j = await r.json();
            const c = j?.choices?.[0]?.message?.content?.trim();
            if (c) {
              answer = c;
              aiOK = true;
              break;
            }
          }
        } catch {
          /* try next model */
        }
      }
    }

    if (!aiOK) {
      if (hasPapers) {
        answer =
          "Here are the most relevant papers I found (the answer writer is busy right now):\n\n" +
          papers.map((p, i) => `[${i + 1}] ${p.title}\n${p.journal}${p.year ? `, ${p.year}` : ""}. ${p.abstract.slice(0, 280)}...`).join("\n\n");
      } else {
        answer = "The answer service is temporarily unavailable. Please try again in a moment.";
      }
    }

    const dbUsed = utk ? "Databases + UTK TRACE" : hasPapers ? "Scientific databases" : "Cerebrum AI";
    return new Response(JSON.stringify({
      answer,
      sources: sourceList,
      source: aiOK && hasPapers ? `${dbUsed} + OpenRouter` : aiOK ? "Cerebrum AI" : dbUsed,
    }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: `Runtime error: ${e.message}` }), { status: 500, headers: cors });
  }
}
