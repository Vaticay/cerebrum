// --- Core Utility Helpers with Timeouts ---
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

// --- Live Web Search Engine Adapter (Google CSE / Programmable Search) ---
async function liveWebSearch(query, apiKey, cxId) {
  if (!apiKey || !cxId) return [];
  const url = `https://www.googleapis.com/customsearch/v1?` + 
    new URLSearchParams({ q: query, key: apiKey, cx: cxId, num: "3" });
  try {
    const data = await getJSON(url);
    return (data.items || []).map(item => ({
      title: item.title || "Web Result",
      url: item.link || "",
      year: "2026",
      citations: null,
      authors: "Web Resource",
      journal: "Google Live Search",
      abstract: item.snippet || ""
    }));
  } catch { return []; }
}

// --- Global Academic Index Adapters ---
async function europePMC(query, limit = 2) {
  const currentYear = new Date().getFullYear();
  const fastUrl = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
    new URLSearchParams({
      query: `${query} AND PUB_YEAR:[2024 TO ${currentYear}]`,
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
      journal: "Europe PMC",
      abstract: stripTags(r.abstractText),
    }));
  } catch { return []; }
}

// --- High-Speed Date-Bounded University OAI-PMH Scraper ---
const UNIVERSITY_REPOSITORIES = [
  { name: "UTK TRACE", url: "https://trace.tennessee.edu/do/oai/?verb=ListRecords&metadataPrefix=oai_dc&set=publication:utk_graddiss" },
  { name: "MIT DSpace", url: "https://dspace.mit.edu/oai/request?verb=ListRecords&metadataPrefix=oai_dc" }
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
  while ((rm = recRe.exec(xmlText)) && count < 1) {
    const block = rm[0];
    const title = tag(block, "title");
    const abstract = tag(block, "abstract") || tag(block, "description");
    if (!title || !abstract) continue;
    const hay = `${title} ${abstract}`.toLowerCase();
    if (!terms.some(t => hay.includes(t))) continue;
    records.push({
      title: stripTags(title),
      url: (block.match(/<identifier[^>]*>(http[\s\S]*?)<\/identifier>/i) || [])[1] || "",
      year: (tag(block, "date") || "").slice(0, 4) || "2026",
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
      const text = await getText(`${repo.url}&from=2025-01-01`);
      return fastExtractUniversityRecords(text, repo.name, terms);
    } catch { return []; }
  });
  const aggregateResults = await Promise.all(searchPromises);
  return aggregateResults.flat();
}

// --- Master Aggregator Pipeline ---
async function gatherAllData(query, googleKey, googleCx) {
  const [webResults, ePMCResults, collegeResults] = await Promise.all([
    liveWebSearch(query, googleKey, googleCx),
    europePMC(query, 2),
    scanUniversityNetworks(query)
  ]);

  const masterList = [...webResults, ...collegeResults, ...ePMCResults];
  const distinctSources = [];
  const trackedTitles = new Set();

  for (const item of masterList) {
    const normalizedTitle = item.title.toLowerCase().trim();
    if (!trackedTitles.has(normalizedTitle)) {
      trackedTitles.add(normalizedTitle);
      distinctSources.push(item);
    }
  }
  return distinctSources.slice(0, 6);
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
      return new Response(JSON.stringify({ error: "No query text provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // 1. Fetch credentials securely from environment
    const googleKey = context.env.GOOGLE_SEARCH_API_KEY || "";
    const googleCx = context.env.GOOGLE_SEARCH_CX || "";
    const geminiKey = context.env.GEMINI_API_KEY;

    // 2. Scan web grids, indexes, and networks simultaneously
    const sources = await gatherAllData(query, googleKey, googleCx);

    if (sources.length === 0) {
      return new Response(JSON.stringify({
        answer: "No valid internet resources or university records returned matching your query.",
        sources: []
      }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    // 3. Compile the comprehensive context prompt
    const knowledgeContext = sources.map((s, i) => 
      `Resource [${i + 1}]:\nTitle: ${s.title}\nSource Location: ${s.journal}\nInformation/Abstract: ${s.abstract}\n`
    ).join("\n");

    let systemGeneratedAnswer = "";

    if (!geminiKey) {
      systemGeneratedAnswer = "Configuration error: GEMINI_API_KEY is not bound inside the dashboard variables grid.";
    } else {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash:generateContent?key=${geminiKey}`;
      
      const prompt = {
        contents: [{
          parts: [{
            text: `You are Cerebrum, a powerful, multi-modal AI search assistant exactly like Gemini. 
Your goal is to fulfill the user's request comprehensively by synthesizing the live web data and academic records provided.

User Request: "${query}"

Knowledge Context Matrix:
${knowledgeContext}

Instructions:
1. Provide a fluid, expert, and deeply informative response answering the user directly. Do not sound like a simple index; sound like an intelligent companion.
2. Blend current web knowledge with rigorous scientific data seamlessly.
3. You MUST use simple numeric brackets like [1], [2] immediately following a fact to attribute it to the specific source index from the matrix.
4. Keep the presentation highly clean, engaging, and clear.`
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
        systemGeneratedAnswer = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "Unable to extract synthesis stream.";
      } else {
        const errText = await geminiResponse.text().catch(() => "");
        systemGeneratedAnswer = `Synthesis failure (Status: ${geminiResponse.status}). Details: ${errText}`;
      }
    }

    return new Response(
      JSON.stringify({
        answer: systemGeneratedAnswer,
        sources: sources,
        source: googleKey && googleCx ? "Google Hybrid Search Engine" : "Multi-Repository Network",
        note: "Successfully fetched cross-platform context pools."
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Engine runtime alert: ${error.message}` }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
}
