// Cerebrum backend — Cloudflare Pages Function.
// Gathers real papers from scholarly databases, then asks OpenRouter to write
// a grounded, cited answer. Runs on the edge (no CORS problems).

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

// ---------- Source: Europe PMC (bio/chem, keyless) ----------
async function europePMC(query, limit = 6) {
  const url =
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
    new URLSearchParams({
      query,
      resultType: "core",
      pageSize: String(limit),
      format: "json",
      sort: "CITED desc",
    });
  try {
    const data = await getJSON(url);
    const rows = data?.resultList?.result || [];
    return rows
      .filter((r) => r.abstractText)
      .map((r) => ({
        title: r.title || "Untitled",
        url: r.doi
          ? `https://doi.org/${r.doi}`
          : `https://europepmc.org/article/${r.source}/${r.id}`,
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

// ---------- Source: PubMed (NCBI E-utilities, keyless) ----------
function firstMatch(block, re) {
  const m = block.match(re);
  return m ? m[1] : "";
}
function parsePubmedXML(xmlText) {
  const arts = xmlText.match(/<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/g) || [];
  return arts.map((a) => {
    const pmid = firstMatch(a, /<PMID[^>]*>(\d+)<\/PMID>/);
    const title = stripTags(
      firstMatch(a, /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)
    );
    const absParts = a.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g) || [];
    const abstract = stripTags(absParts.join(" "));
    const journal = stripTags(
      firstMatch(a, /<Title>([\s\S]*?)<\/Title>/) ||
        firstMatch(a, /<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/)
    );
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
      url: doi
        ? `https://doi.org/${doi}`
        : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      year,
      citations: null,
      authors,
      journal: journal || "PubMed",
      abstract,
    };
  });
}
async function pubmed(query, limit = 6) {
  const tool = "&tool=cerebrum&email=noreply@example.com";
  try {
    const es = await getJSON(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" +
        new URLSearchParams({
          db: "pubmed",
          term: query,
          retmax: String(limit),
          retmode: "json",
          sort: "relevance",
        }) +
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

// ---------- Source: OpenAlex (needs key) ----------
async function openAlex(query, limit = 6, key = "") {
  if (!key) return [];
  try {
    const params = new URLSearchParams({
      search: query,
      filter: "is_oa:true",
      sort: "relevance_score:desc",
      per_page: String(limit),
      select:
        "title,doi,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships",
      api_key: key,
    });
    const data = await getJSON(`https://api.openalex.org/works?${params}`);
    return (data.results || [])
      .map((w) => {
        const first = w.authorships?.[0]?.author?.display_name || "";
        return {
          title: w.title || "Untitled",
          url:
            w.doi ||
            w.primary_location?.landing_page_url ||
            w.primary_location?.pdf_url ||
            "",
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

// ---------- Source: UTK TRACE (OAI-PMH, harvest + filter) ----------
function extractTraceRecords(xmlText) {
  const records = [];
  const recRe = /<record\b[\s\S]*?<\/record>/g;
  const tag = (block, name) => {
    const re = new RegExp(
      `<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`,
      "i"
    );
    const m = block.match(re);
    return m ? m[1].trim() : "";
  };
  const tagAll = (block, name) => {
    const re = new RegExp(
      `<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`,
      "gi"
    );
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
          new URLSearchParams({
            verb: "ListRecords",
            metadataPrefix: "dcq",
            set,
          })
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

// ---------- Gather + rank ----------
async function gatherPapers(query, { openAlexKey }) {
  const [epmc, pm, trace, oa] = await Promise.all([
    europePMC(query, 6),
    pubmed(query, 6),
    traceUTK(query),
    openAlex(query, 6, openAlexKey),
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
  const ranked = merged
    .map((p) => {
      const hay = `${p.title} ${p.abstract}`.toLowerCase();
      let score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      if (typeof p.citations === "number") score += Math.min(p.citations / 500, 2);
      return { ...p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const usedUTK = ranked.some((p) => p.journal === "UTK TRACE");
  return { papers: ranked, utk: usedUTK };
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
      return new Response(JSON.stringify({ error: "No query provided." }), {
        status: 400,
        headers: cors,
      });
    }

    const { papers, utk } = await gatherPapers(query, {
      openAlexKey: env.OPENALEX_KEY || "",
    });

    const sourceList = papers.map(
      ({ title, url, journal, authors, year, citations }) => ({
        title,
        url,
        journal,
        authors,
        year,
        citations,
      })
    );

    if (!papers.length) {
      return new Response(
        JSON.stringify({
          answer:
            "I searched the scientific databases but found no papers with abstracts for that query. Try rephrasing or using more specific terms.",
          sources: [],
          source: "no results",
        }),
        { status: 200, headers: cors }
      );
    }

    const evidence = papers
      .map(
        (p, i) =>
          `[${i + 1}] ${p.title} (${p.authors || "n/a"}, ${p.journal}, ${
            p.year || "n/a"
          }${typeof p.citations === "number" ? `, cited ${p.citations}x` : ""})\nAbstract: ${p.abstract}`
      )
      .join("\n\n");

    const systemPrompt =
      "You are Cerebrum, a scientific reference engine. Answer the user's question using ONLY the numbered papers provided. Do not invent facts or sources. State only what the abstracts support; if they conflict, say so neutrally; if they don't cover the question, say so plainly. Be precise and concise: 2 to 4 short paragraphs. Mark every supported claim with an inline citation like [1] or [2] matching the paper numbers. Output only the answer text with inline [n] markers, no preamble and no source list.";

    let answer = "";
    let aiOK = false;

    const token = env.OPENROUTER_API_KEY;
    if (token) {
      const models = [
        "meta-llama/llama-3.3-70b-instruct:free",
        "google/gemini-2.0-flash-exp:free",
        "deepseek/deepseek-chat",
      ];
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
              temperature: 0.2,
              max_tokens: 900,
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content: `Papers:\n\n${evidence}\n\n---\nQuestion: ${query}`,
                },
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
      answer =
        "Showing the most relevant papers found. (The answer writer is unavailable right now, so these are the raw sources.)\n\n" +
        papers
          .map(
            (p, i) =>
              `[${i + 1}] ${p.title}\n${p.journal}${p.year ? `, ${p.year}` : ""}. ${p.abstract.slice(0, 280)}...`
          )
          .join("\n\n");
    }

    const dbUsed = utk ? "Databases + UTK TRACE" : "Scientific databases";
    return new Response(
      JSON.stringify({
        answer,
        sources: sourceList,
        source: aiOK ? `${dbUsed} + OpenRouter` : dbUsed,
      }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `Runtime error: ${e.message}` }),
      { status: 500, headers: cors }
    );
  }
}
