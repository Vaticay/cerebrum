// --- Core Utility Helpers ---
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

// --- Global Index Adapters ---
async function europePMC(query, limit = 5) {
  const url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
    new URLSearchParams({ query, resultType: "core", pageSize: String(limit), format: "json", sort: "CITED desc" });
  try {
    const data = await getJSON(url);
    const rows = data?.resultList?.result || [];
    return rows.filter((r) => r.abstractText).map((r) => ({
      title: r.title || "Untitled",
      url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
      year: r.pubYear || "N/A",
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
      const year = (a.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/) || [])[1] || "N/A";
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

// --- Expanded University OAI-PMH Network Harvester ---
const UNIVERSITY_REPOSITORIES = [
  { name: "UTK TRACE", url: "https://trace.tennessee.edu/do/oai/" },
  { name: "MIT DSpace", url: "https://dspace.mit.edu/oai/request" },
  { name: "CaltechTHESIS", url: "https://thesis.caltech.edu/cgi/oai2" }
];

function extractUniversityRecords(xmlText, sourceName) {
  const records = [];
  const recRe = /<record\b[\s\S]*?<\/record>/g;
  
  const tag = (block, name) => {
    const re = new RegExp(`<([^>:]+:)?${name}\\b[^>]*>([\\s\\S]*?)</([^>:]+:)?${name}>`, "i");
    const m = block.match(re);
    return m ? m[2].trim() : "";
  };

  let rm;
  while ((rm = recRe.exec(xmlText))) {
    const block = rm[0];
    const title = tag(block, "title");
    const abstract = tag(block, "abstract") || tag(block, "description");
    const url = (block.match(/<identifier[^>]*>(http[\s\S]*?)<\/identifier>/i) || [])[1] || "";
    const year = (tag(block, "date") || "").slice(0, 4);
    
    if (title && abstract) {
      records.push({
        title: stripTags(title),
        url: url.trim(),
        year: year || "2026",
        citations: null,
        authors: "University Scholar",
        journal: sourceName,
        abstract: stripTags(abstract)
      });
    }
  }
  return records;
}

async function scanUniversityNetworks(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
  if (terms.length === 0) return [];

  const searchPromises = UNIVERSITY_REPOSITORIES.map(async (repo) => {
    try {
      const url = `${repo.url}?verb=ListRecords&metadataPrefix=oai_dc`;
      const text = await getText(url);
      const records = extractUniversityRecords(text, repo.name);
      
      return records.map(r => {
        const hay = `${r.title} ${r.abstract}`.toLowerCase();
        const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
        return { ...r, score };
      }).filter(r => r.score > 0);
    } catch {
      return [];
    }
  });

  const aggregateResults = await Promise.all(searchPromises);
  return aggregateResults.flat().sort((a, b) => b.score - a.score).slice(0, 5);
}

// --- Hardened Master Paper Collection logic ---
async function gatherPapers(query) {
  const currentYear = new Date().getFullYear();
  
  // Enforces time weights on standard queries to bypass stale 2020 caches
  const modernQuery = `${query} AND (y:[2023 TO ${currentYear}] OR ${currentYear})`;

  const [ePMCResults, pubmedResults, collegeResults] = await Promise.all([
    europePMC(modernQuery, 4),
    pubmed(query, 4),
    scanUniversityNetworks(query)
  ]);

  const masterList = [...collegeResults, ...ePMCResults, ...pubmedResults];
  
  const distinctPapers = [];
  const trackedTitles = new Set();

  for (const paper of masterList) {
    const normalizedTitle = paper.title.toLowerCase().trim();
    if (!trackedTitles.has(normalizedTitle)) {
      trackedTitles.add(normalizedTitle);
      distinctPapers.push(paper);
    }
  }

  let activeSource = "Global Literature Indexes";
  if (collegeResults.length > 0) {
    const names = collegeResults.map(c => c.journal).filter((v, i, a) => a.indexOf(v) === i);
    activeSource = `Academic Repositories (${names.join(", ")})`;
  } else if (ePMCResults.length > 0) {
    activeSource = "Europe PMC";
  } else if (pubmedResults.length > 0) {
    activeSource = "PubMed";
  }

  return {
    papers: distinctPapers.slice(0, 6),
    source: activeSource
  };
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
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // 1. Parallel gather across global & university endpoints
    const result = await gatherPapers(query);
    const papers = result.papers || [];

    if (papers.length === 0) {
      return new Response(JSON.stringify({
        answer: "No fresh academic literature or university records found matching your query.",
        sources: [],
        source: result.source
      }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    // 2. Build explicit context layout for Gemini injection
    const literatureContext = papers.map((p, i) => 
      `Source [${i + 1}]:\nTitle: ${p.title}\nYear: ${p.year}\nRepository: ${p.journal}\nAbstract: ${p.abstract}\n`
    ).join("\n");

    // 3. Contact Gemini using production v1 endpoints
    const geminiKey = context.env.GEMINI_API_KEY;
    let systemGeneratedAnswer = "";

    if (!geminiKey) {
      systemGeneratedAnswer = "Error: GEMINI_API_KEY environment variable is missing from the Cloudflare dashboard settings.";
    } else {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
      
      const prompt = {
        contents: [{
          parts: [{
            text: `You are Cerebrum, an advanced, objective scientific AI search assistant.
Your goal is to answer the user's scientific question using ONLY the provided primary university literature and recent journal abstracts.

Query: "${query}"

Provided Literature Context:
${literatureContext}

Instructions:
1. Provide a clean, insightful explanation answering the user's question directly using the context.
2. Prioritize up-to-date information and explicitly mention findings from recent university repositories if available.
3. Maintain strict scientific objectivity. If theories conflict, map out the perspectives neutrally.
4. You MUST include numeric bracket citations like [1], [2] immediately following the specific statement or data point to tie it directly back to its source container.
5. Keep your output readable and organized—aim for 2 to 3 concise paragraphs.`
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
        systemGeneratedAnswer = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "Unable to parse response matrix.";
      } else {
        const errText = await geminiResponse.text().catch(() => "");
        systemGeneratedAnswer = `Synthesis engine connection issue (Status: ${geminiResponse.status}). Technical details: ${errText}`;
      }
    }

    // 4. Return unified JSON back to layout client
    return new Response(
      JSON.stringify({
        answer: systemGeneratedAnswer,
        sources: papers,
        source: result.source,
        note: `Scanned global networks and university grids successfully.`
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
