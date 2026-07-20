// Scholarly source adapters — Cloudflare Workers compatible
function stripTags(s) {
  return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getText(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function europePMC(query, limit = 5) {
  const url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
    new URLSearchParams({ query, resultType: "core", pageSize: String(limit), format: "json", sort: "CITED desc" });
  try {
    const data = await getJSON(url);
    const rows = data?.resultList?.result || [];
    return rows.filter((r) => r.abstractText).map((r) => ({
      title: r.title || "Untitled",
      url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
      year: r.pubYear,
      citations: r.citedByCount ?? null,
      authors: r.authorString || "Academic Source",
      journal: r.journalTitle || "Scientific Journal",
      abstract: stripTags(r.abstractText),
    }));
  } catch { return []; }
}

async function pubmed(query, limit = 5) {
  const tool = "&tool=cerebrum&email=noreply@example.com";
  const esearchUrl = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" +
    new URLSearchParams({ db: "pubmed", term: query, retmax: String(limit), retmode: "json", sort: "relevance" }) + tool;
  try {
    const es = await getJSON(esearchUrl);
    const ids = es?.esearchresult?.idlist || [];
    if (!ids.length) return [];

    const efetchUrl = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?" +
      new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "xml" }) + tool;
    const xml = await getText(efetchUrl);
    
    const arts = xml.match(/<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/g) || [];
    return arts.map((a) => {
      const pmid = (a.match(/<PMID[^>]*>(\d+)<\/PMID>/) || [])[1] || "";
      const title = stripTags((a.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/) || [])[1] || "");
      const absParts = a.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g) || [];
      const abstract = stripTags(absParts.join(" "));
      const journal = stripTags((a.match(/<Title>([\s\S]*?)<\/Title>/) || a.match(/<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/) || [])[1] || "");
      const year = (a.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/) || [])[1] || "";
      const doi = (a.match(/<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/) || [])[1] || "";
      return {
        title: title || "Untitled",
        url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        year,
        citations: null,
        authors: "Academic Source",
        journal,
        abstract,
      };
    }).filter((r) => r.abstract);
  } catch { return []; }
}

async function gatherPapers(query) {
  const ePMCResults = await europePMC(query);
  if (ePMCResults.length) return { papers: ePMCResults, source: "Europe PMC" };
  
  const pubmedResults = await pubmed(query);
  if (pubmedResults.length) return { papers: pubmedResults, source: "PubMed" };

  return { papers: [], source: "No active records found" };
}

// --- CLOUDFLARE MAIN OPERATION PIPELINE ---
export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
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
    const body = await context.request.json().catch(() => ({}));
    const query = (body.query || "").trim();
    
    if (!query) {
      return new Response(JSON.stringify({ error: "No search term provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 1. Gather the papers first
    const result = await gatherPapers(query);
    const papers = result.papers || [];

    if (papers.length === 0) {
      return new Response(JSON.stringify({
        answer: "No academic literature found matching your search term.",
        sources: [],
        source: result.source
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // 2. Format the context for Gemini
    const literatureContext = papers.map((p, i) => 
      `Source [${i + 1}]:\nTitle: ${p.title}\nAbstract: ${p.abstract}\n`
    ).join("\n");

    // 3. Call Gemini API directly via fetch
    const geminiKey = context.env.GEMINI_API_KEY;
    let systemGeneratedAnswer = "";

    if (!geminiKey) {
      systemGeneratedAnswer = "Error: GEMINI_API_KEY environment variable is not set in Cloudflare dashboard.";
    } else {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
      
      const prompt = {
        contents: [{
          parts: [{
            text: `You are Cerebrum, an unbiased, objective scientific AI assistant. 
Your goal is to answer the user's scientific query using ONLY the provided primary literature abstracts. 

Query: "${query}"

Provided Literature Context:
${literatureContext}

Instructions:
1. Provide a clean, direct explanation to the user's question.
2. Maintain strict objectivity. If a topic is actively debated or unsettled in science, lay out both perspectives neutrally.
3. You MUST use small bracketed citations like [1], [2] right after a fact to tie it back to its specific source index.
4. Keep your response fast and punchy—aim for 2 to 3 short paragraphs max.`
          }]
        }]
      };

      const geminiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prompt)
      });

      if (geminiResponse.ok) {
        const geminiData = await geminiResponse.json();
        systemGeneratedAnswer = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "Unable to parse synthesis engine.";
      } else {
        systemGeneratedAnswer = `Failed to contact synthesis engine (Status: ${geminiResponse.status})`;
      }
    }

    return new Response(
      JSON.stringify({
        answer: systemGeneratedAnswer,
        sources: papers,
        source: result.source,
        note: `Synthesized analysis from ${papers.length} academic indexes.`
      }),
      {
        status: 200,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Engine runtime alert: ${error.message}` }),
      {
        status: 500,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      }
    );
  }
}
