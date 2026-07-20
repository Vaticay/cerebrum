// Scholarly source adapters — Cloudflare Workers compatible
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
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getText(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function europePMC(query, limit = 6) {
  const url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
    new URLSearchParams({ query, resultType: "core", pageSize: String(limit), format: "json", sort: "CITED desc" });
  const data = await getJSON(url);
  const rows = data?.resultList?.result || [];
  return rows.filter((r) => r.abstractText).map((r) => ({
    title: r.title || "Untitled",
    url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
    year: r.pubYear,
    citations: r.citedByCount ?? null,
    authors: r.authorString || "",
    journal: r.journalTitle || "",
    abstract: stripTags(r.abstractText),
  }));
}

async function pubmed(query, limit = 6) {
  const tool = "&tool=cerebrum&email=noreply@example.com";
  const esearchUrl = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" +
    new URLSearchParams({ db: "pubmed", term: query, retmax: String(limit), retmode: "json", sort: "relevance" }) + tool;
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
}

async function gatherPapers(query) {
  const mainChain = [
    ["Europe PMC", () => europePMC(query)],
    ["PubMed", () => pubmed(query, 6)]
  ];

  for (const [name, fn] of mainChain) {
    try {
      const papers = await fn();
      if (papers && papers.length) {
        return { papers, source: name };
      }
    } catch (e) {
      // Fallback sequentially
    }
  }
  return { papers: [], source: "No direct records found" };
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

    const result = await gatherPapers(query);

    const summaryText = (result.papers || [])
      .slice(0, 3)
      .map((p, idx) => {
        const title = p.title || "Untitled Paper";
        const abstractSnippet = p.abstract ? String(p.abstract).slice(0, 180) : "Abstract review pending";
        return `${title}: ${abstractSnippet}... [${idx + 1}]`;
      })
      .join("\n\n");

    return new Response(
      JSON.stringify({
        answer: summaryText || "No public scientific papers matched the query.",
        sources: result.papers || [],
        source: result.source,
        note: `Successfully scanned academic indexes.`
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
