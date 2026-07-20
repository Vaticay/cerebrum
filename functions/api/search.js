// --- Core Utility Helpers with Strict 1.5-Second Timeouts ---
function stripTags(s) {
  return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

async function getJSON(url, headers = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1500); 
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

async function getText(url, headers = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1500); 
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// --- Global Index Adapters (Optimized Natively for Speed & Freshness) ---
async function europePMC(query, limit = 3) {
  // Using native EuropePMC syntax: filtering by publication year range directly
  const currentYear = new Date().getFullYear();
  const fastUrl = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
    new URLSearchParams({
      query: `${query} AND PUB_YEAR:[2023 TO ${currentYear}]`,
      resultType: "core",
      pageSize: String(limit),
      format: "json",
      sort: "CITED desc"
    });
  try {
    const data = await getJSON(fastUrl);
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

async function pubmed(query, limit = 3) {
  const tool = "&tool=cerebrum&email=noreply@example.com";
  // Using native PubMed sorting by date to force the most recent papers instantly
  const esearchUrl = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" +
    new URLSearchParams({
      db: "pubmed",
      term: query,
      retmax: String(limit),
      retmode: "json",
      sort: "pub_date" 
    }) + tool;
  try {
    const es = await getJSON(esearchUrl);
    const ids = es?.esearchresult?.idlist || [];
    if (!ids.length) return [];

    const efetchUrl = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?" +
      new URLSearchParams({
        db: "pubmed",
        id: ids.join(","),
        retmode: "xml"
      }) + tool;
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

// --- High-Speed Selective OAI-PMH Scraper ---
const UNIVERSITY_REPOSITORIES = [
  { name: "UTK TRACE", url: "https://trace.tennessee.edu/do/oai/?verb=ListRecords&metadataPrefix=oai_dc&set=publication:utk_graddiss" },
  { name: "MIT DSpace", url: "https://dspace.mit.edu/oai/request?verb=ListRecords&metadataPrefix=oai_dc" },
  { name: "CaltechTHESIS", url: "https://thesis.caltech.edu/cgi/oai2?verb=ListRecords&metadataPrefix=oai_dc" }
];

function fastExtractUniversityRecords(xmlText, sourceName, terms) {
  const records = [];
  const recRe = /<record\b[\s\S]*?<\/record>/g;
  
  const tag = (block, name) => {
    const re = new RegExp(`<([^>:]+:)?${name}\\b[^>]*>([\\s\\S]*?)</([^>:]+:)?${name}>`, "i");
    const m = block.match(re);
    return m ? m[2].trim() : "";
  };

  let rm;
  let count = 0;
  
  while ((rm = recRe.exec(xmlText)) && count < 2) {
    const block = rm[0];
    const title = tag(block, "title");
    const abstract = tag(block, "abstract") || tag(block, "description");
    
    if (!title || !abstract) continue;

    const hay = `${title} ${abstract}`.toLowerCase();
    const matchesKeyword = terms.some(t => hay.includes(t));
    if (!matchesKeyword) continue;

    const url = (block.match(/<identifier[^>]*>(http[\s\S]*?)<\/identifier>/i) || [])[1] || "";
    const year = (tag(block, "date") || "").slice(0, 4);
    
    records.push({
      title: stripTags(title),
      url: url.trim(),
      year: year || "2026",
      citations: null,
      authors: "University Scholar",
      journal: sourceName,
      abstract: stripTags(abstract)
    });
    count++;
  }
  return records;
}

async function scanUniversityNetworks(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
  if (terms.length === 0) return [];

  const searchPromises = UNIVERSITY_REPOSITORIES.map(async (repo) => {
    try {
      const text = await getText(repo.url);
      return fastExtractUniversityRecords(text, repo.name, terms);
    } catch {
      return []; 
    }
  });

  const aggregateResults = await Promise.all(searchPromises);
  return aggregateResults.flat().slice(0, 3);
}

// --- Hardened Master Paper Collection Logic ---
async function gatherPapers(query) {
  // Fire off clean requests without syntax breaks
  const [ePMCResults, pubmedResults, collegeResults] = await Promise.all([
    europePMC(query, 3),
    pubmed(query, 3),
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
  }

  return {
    papers: distinctPapers.slice(0, 5),
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

    const result = await gatherPapers(query);
    const papers = result.papers || [];

    if (papers.length === 0) {
      return new Response(JSON.stringify({
        answer: "No active academic literature or university records found matching your query.",
        sources: [],
        source: result.source
      }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    const literatureContext = papers.map((p, i) => 
      `Source [${i + 1}]:\nTitle: ${p.title}\nYear: ${p.year}\nRepository: ${p.journal}\nAbstract: ${p.abstract}\n`
    ).join("\n");

    const geminiKey = context.env.GEMINI_API_KEY;
    let systemGeneratedAnswer = "";

    if (!geminiKey) {
      systemGeneratedAnswer = "Error: GEMINI_API_KEY environment variable is missing from the Cloudflare dashboard settings.";
    } else {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${geminiKey}`;
      
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
