// --- Core Utility Helpers with Timeouts & Token Trimming ---
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
      abstract: (item.snippet || "").slice(0, 400) 
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
      abstract: stripTags(r.abstractText).slice(0, 400), 
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
      abstract: stripTags(abstract).slice(0, 400) 
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
  return distinctSources.slice(0, 5);
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

    const envGrid = context.env || {};
    const googleKey = envGrid.GOOGLE_SEARCH_API_KEY || "";
    const googleCx = envGrid.GOOGLE_SEARCH_CX || "";
    const openRouterToken = envGrid.OPENROUTER_API_KEY;

    const sources = await gatherAllData(query, googleKey, googleCx);

    if (sources.length === 0) {
      return new Response(JSON.stringify({
        answer: "No valid internet resources or university records returned matching your query.",
        sources: []
      }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    const knowledgeContext = sources.map((s, i) => 
      `Source [${i + 1}]:\nTitle: ${s.title}\nLocation: ${s.journal}\nData: ${s.abstract}\n`
    ).join("\n");

    let systemGeneratedAnswer = "";

    if (!openRouterToken) {
      systemGeneratedAnswer = `Configuration error: OPENROUTER_API_KEY environment variable is not set in the Cloudflare dashboard.`;
    } else {
      const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";
      
      const promptPayload = {
        // Utilizing highly stable and fast open-source Llama 3 8B through OpenRouter
        model: "meta-llama/llama-3-8b-instruct:free",
        messages: [
          {
            role: "system",
            content: "You are Cerebrum, an objective, advanced scientific research assistant. Your task is to accurately synthesize the provided search documents to fully answer the user's question. Use numeric brackets like [1], [2] right after statements to credit your sources. Keep the answer clear and under 3 short paragraphs."
          },
          {
            role: "user",
            content: `Question: "${query}"\n\nScanned Sources Context Matrix:\n${knowledgeContext}`
          }
        ],
        temperature: 0.2,
        max_tokens: 500
      };

      const orResponse = await fetch(openRouterUrl, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openRouterToken}`,
          "HTTP-Referer": "https://cerebrum.pages.dev", 
          "X-Title": "Cerebrum Search"
        },
        body: JSON.stringify(promptPayload)
      });

      if (orResponse.ok) {
        const orData = await orResponse.json();
        systemGeneratedAnswer = orData?.choices?.[0]?.message?.content || "Unable to read synthesis stream.";
      } else {
        const errText = await orResponse.text().catch(() => "");
        systemGeneratedAnswer = `Inference engine dropped connection (Status: ${orResponse.status}). Details: ${errText}`;
      }
    }

    return new Response(
      JSON.stringify({
        answer: systemGeneratedAnswer.trim(),
        sources: sources,
        source: "Open-Source Knowledge Grid",
        note: "Processed via OpenRouter successfully."
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
