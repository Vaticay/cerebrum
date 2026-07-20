// --- Advanced Text & Query Cleaning Utilities ---
function stripTags(s) {
  return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Strips conversational filler to distill the query down to high-value keywords
 * for the underlying search indexes.
 */
function refineSearchQuery(query) {
  return query
    .toLowerCase()
    .replace(/\b(can you)?\b\s*\b(find|search|tell me about|look up|show me|what is|how does)\b/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function getJSON(url, headers = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000); 
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
  const timeoutId = setTimeout(() => controller.abort(), 2000); 
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

// --- High-Fidelity Data Ingestion Adapters ---
async function liveWebSearch(refinedQuery, apiKey, cxId) {
  if (!apiKey || !cxId) return [];
  const url = `https://www.googleapis.com/customsearch/v1?` + 
    new URLSearchParams({ q: refinedQuery, key: apiKey, cx: cxId, num: "4" });
  try {
    const data = await getJSON(url);
    return (data.items || []).map(item => ({
      title: item.title || "Web Resource",
      url: item.link || "",
      year: "2026",
      authors: "Web Network",
      journal: "Live Web Search",
      abstract: (item.snippet || "").slice(0, 500),
      type: "web",
      score: 1.0 
    }));
  } catch { return []; }
}

async function europePMC(refinedQuery, limit = 3) {
  const currentYear = new Date().getFullYear();
  const fastUrl = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
    new URLSearchParams({
      query: `${refinedQuery} AND PUB_YEAR:[2020 TO ${currentYear}]`,
      resultType: "core",
      pageSize: String(limit),
      format: "json",
      sort: "CITED desc"
    });
  try {
    const data = await getJSON(fastUrl);
    const rows = data?.resultList?.result || [];
    return rows.filter((r) => r.abstractText).map((r) => ({
      title: r.title || "Untitled Publication",
      url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
      year: r.pubYear || "N/A",
      authors: r.authorString || "Academic Author",
      journal: r.journalInfo?.journal?.title || "Europe PMC",
      abstract: stripTags(r.abstractText).slice(0, 500),
      type: "publication",
      score: 1.5 
    }));
  } catch { return []; }
}

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
  while ((rm = recRe.exec(xmlText)) && count < 2) {
    const block = rm[0];
    const title = tag(block, "title");
    const abstract = tag(block, "abstract") || tag(block, "description");
    if (!title || !abstract) continue;
    
    const hay = `${title} ${abstract}`.toLowerCase();
    const matchesAll = terms.every(t => hay.includes(t));
    if (!matchesAll) continue; 

    records.push({
      title: stripTags(title),
      url: (block.match(/<identifier[^>]*>(http[\s\S]*?)<\/identifier>/i) || [])[1] || "",
      year: (tag(block, "date") || "").slice(0, 4) || "2026",
      authors: tag(block, "creator") || "University Researcher",
      journal: sourceName,
      abstract: stripTags(abstract).slice(0, 500),
      type: "publication",
      score: 1.4
    });
    count++;
  }
  return records;
}

async function scanUniversityNetworks(refinedQuery) {
  const terms = refinedQuery.split(/\s+/).filter(t => t.length > 3);
  if (terms.length === 0) return [];
  const searchPromises = UNIVERSITY_REPOSITORIES.map(async (repo) => {
    try {
      const text = await getText(`${repo.url}&from=2024-01-01`);
      return fastExtractUniversityRecords(text, repo.name, terms);
    } catch { return []; }
  });
  const aggregateResults = await Promise.all(searchPromises);
  return aggregateResults.flat();
}

// --- Intelligent Context Aggregator & Relevance Ranker ---
async function gatherAndRankData(rawQuery, googleKey, googleCx) {
  const refinedQuery = refineSearchQuery(rawQuery);
  if (!refinedQuery) return [];

  const [webResults, ePMCResults, collegeResults] = await Promise.all([
    liveWebSearch(refinedQuery, googleKey, googleCx),
    europePMC(refinedQuery, 3),
    scanUniversityNetworks(refinedQuery)
  ]);

  const masterList = [...ePMCResults, ...collegeResults, ...webResults];
  const distinctSources = [];
  const trackedTitles = new Set();

  const searchTerms = refinedQuery.split(/\s+/);

  for (const item of masterList) {
    const normalizedTitle = item.title.toLowerCase().trim();
    if (!trackedTitles.has(normalizedTitle)) {
      trackedTitles.add(normalizedTitle);

      const textPool = `${item.title} ${item.abstract}`.toLowerCase();
      let matchCount = 0;
      searchTerms.forEach(term => {
        if (textPool.includes(term)) matchCount += 1;
      });

      item.score = item.score * (1 + matchCount * 0.2);
      distinctSources.push(item);
    }
  }

  return distinctSources.sort((a, b) => b.score - a.score).slice(0, 5);
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

    const sources = await gatherAndRankData(query, googleKey, googleCx);

    if (sources.length === 0) {
      return new Response(JSON.stringify({
        answer: "### No Direct References Found\n\nI couldn't locate precise live documents or academic records matching those exact parameters. Please try broadening your keywords slightly.",
        sources: []
      }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }

    const knowledgeContext = sources.map((s, i) => 
      `[Source Block ${i + 1}] (${s.type.toUpperCase()})\nTitle: ${s.title}\nPublisher/Location: ${s.journal}\nAuthors/Credits: ${s.authors}\nData Extract: ${s.abstract}\n`
    ).join("\n");

    let systemGeneratedAnswer = "";

    if (!openRouterToken) {
      systemGeneratedAnswer = `### System Integration Error\n\nThe environment key \`OPENROUTER_API_KEY\` is missing from your hosting console grid. Please update your variables configuration layer.`;
    } else {
      const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";
      
      // Fixed cascade list using OpenRouter's official dynamic free router fallback string
      const modelsToTry = [
        "meta-llama/llama-3.3-70b-instruct:free",
        "openrouter/free"
      ];
      
      let orResponse;

      for (const model of modelsToTry) {
        const promptPayload = {
          model: model,
          messages: [
            {
              role: "system",
              content: `You are Cerebrum, a premium, hyper-intelligent AI search assistant designed to compete directly with leading modern AI platforms. Your task is to analyze the user's inquiry and provide a beautifully structured, authoritative response based exclusively on the provided context matrix.

CRITICAL INSTRUCTIONS:
1. Do NOT speak like a simple search bot. Sound incredibly sharp, sophisticated, and polished.
2. Structure your output clearly using clean Markdown: utilize bold paragraph headers (e.g., '### Core Analysis') and clean lists to make information scannable. Avoid plain walls of text.
3. You MUST ground every insight with inline source brackets pointing to the correct source block number (e.g., [1], [2]) directly following the fact or metric.
4. If the sources contain contradictory info, balance them intelligently. Seamlessly weave formal academic publications and live web data together.`
            },
            {
              role: "user",
              content: `User Inquiry: "${query}"\n\nScanned Sources Context Matrix:\n${knowledgeContext}`
            }
          ],
          temperature: 0.2,
          max_tokens: 650
        };

        try {
          orResponse = await fetch(openRouterUrl, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "Authorization": `Bearer ${openRouterToken}`,
              "HTTP-Referer": "https://cerebrum.pages.dev", 
              "X-Title": "Cerebrum Engine"
            },
            body: JSON.stringify(promptPayload)
          });

          if (orResponse.ok) break;
        } catch (e) {
          // Fall through to openrouter/free catch-all on network dropout
        }
      }

      if (orResponse && orResponse.ok) {
        const orData = await orResponse.json();
        systemGeneratedAnswer = orData?.choices?.[0]?.message?.content || "Unable to extract synthesis stream.";
      } else {
        const statusVal = orResponse ? orResponse.status : "unknown";
        const errText = orResponse ? await orResponse.text().catch(() => "") : "Network level timeout";
        systemGeneratedAnswer = `### Search Pipeline Interrupted\n\nAn upstream error occurred during synthesis processing. (Status: ${statusVal}). Details: ${errText}`;
      }
    }

    return new Response(
      JSON.stringify({
        answer: systemGeneratedAnswer.trim(),
        sources: sources.map(({ title, url, journal, authors, year, type }) => ({ title, url, journal, authors, year, type })),
        source: "Cerebrum Intelligent Knowledge Grid",
        note: "Data synthesis complete."
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
