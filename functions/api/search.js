// Scholarly source adapters — Workers/edge runtime compatible.
// No Node-only APIs; XML parsed with lightweight regex extraction.

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

// --- Europe PMC: keyless, strong bio/chem, includes abstracts ---
export async function europePMC(query, limit = 6) {
  const url =
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
    new URLSearchParams({
      query,
      resultType: "core",
      pageSize: String(limit),
      format: "json",
      sort: "CITED desc",
    });
  const data = await getJSON(url);
  const rows = data?.resultList?.result || [];
  return rows
    .filter((r) => r.abstractText)
    .map((r) => ({
      title: r.title || "Untitled",
      url: r.doi
        ? `https://doi.org/${r.doi}`
        : `https://europepmc.org/article/${r.source}/${r.id}`,
      year: r.pubYear,
      citations: r.citedByCount ?? null,
      authors: r.authorString || "",
      journal: r.journalTitle || "",
      abstract: stripTags(r.abstractText),
    }));
}

// --- Semantic Scholar: keyless (shared pool), all fields ---
export async function semanticScholar(query, limit = 6, key = "") {
  const fields =
    "title,abstract,year,citationCount,authors,venue,externalIds,openAccessPdf,url";
  const url =
    "https://api.semanticscholar.org/graph/v1/paper/search?" +
    new URLSearchParams({ query, limit: String(limit), fields });
  const headers = key ? { "x-api-key": key } : {};
  const data = await getJSON(url, headers);
  const rows = data?.data || [];
  return rows
    .filter((r) => r.abstract)
    .map((r) => {
      const doi = r.externalIds?.DOI;
      const names = (r.authors || []).map((a) => a.name);
      return {
        title: r.title || "Untitled",
        url: doi
          ? `https://doi.org/${doi}`
          : r.openAccessPdf?.url || r.url || "",
        year: r.year,
        citations: r.citationCount ?? null,
        authors: names.length > 1 ? `${names[0]} et al.` : names[0] || "",
        journal: r.venue || "",
        abstract: r.abstract,
      };
    });
}

// --- OpenAlex: needs free key since Feb 2026 ---
export async function openAlex(query, limit = 6, key = "") {
  if (!key) throw new Error("OpenAlex skipped (no key)");
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
        year: w.publication_year,
        citations: w.cited_by_count ?? null,
        authors: w.authorships?.length > 1 ? `${first} et al.` : first,
        journal: w.primary_location?.source?.display_name || "",
        abstract: decodeInverted(w.abstract_inverted_index),
      };
    })
    .filter((p) => p.abstract);
}

// --- PubMed: NCBI E-utilities (keyless). esearch -> efetch, XML parsed. ---
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
    // Abstract may be split into multiple labeled sections.
    const absParts =
      a.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g) || [];
    const abstract = stripTags(absParts.join(" "));
    const journal = stripTags(
      firstMatch(a, /<Title>([\s\S]*?)<\/Title>/) ||
        firstMatch(a, /<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/)
    );
    const year = firstMatch(a, /<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/);
    // Authors: collect LastName + Initials, show first + et al.
    const authorBlocks = a.match(/<Author\b[\s\S]*?<\/Author>/g) || [];
    const names = authorBlocks
      .map((b) => {
        const last = firstMatch(b, /<LastName>([\s\S]*?)<\/LastName>/);
        const ini = firstMatch(b, /<Initials>([\s\S]*?)<\/Initials>/);
        return [last, ini].filter(Boolean).join(" ");
      })
      .filter(Boolean);
    const authors =
      names.length > 1 ? `${names[0]} et al.` : names[0] || "";
    const doi = firstMatch(
      a,
      /<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/
    );
    return {
      pmid,
      title: title || "Untitled",
      abstract,
      journal,
      year,
      authors,
      url: doi
        ? `https://doi.org/${doi}`
        : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    };
  });
}

export async function pubmed(query, limit = 6) {
  const tool = "&tool=cerebrum&email=noreply@example.com";
  // Step 1: esearch -> PMIDs, sorted by relevance.
  const esearchUrl =
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" +
    new URLSearchParams({
      db: "pubmed",
      term: query,
      retmax: String(limit),
      retmode: "json",
      sort: "relevance",
    }) +
    tool;
  const es = await getJSON(esearchUrl);
  const ids = es?.esearchresult?.idlist || [];
  if (!ids.length) return [];

  // Step 2: efetch -> full records as XML.
  const efetchUrl =
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?" +
    new URLSearchParams({
      db: "pubmed",
      id: ids.join(","),
      retmode: "xml",
    }) +
    tool;
  const xml = await getText(efetchUrl);
  return parsePubmedXML(xml)
    .filter((r) => r.abstract)
    .map((r) => ({
      title: r.title,
      url: r.url,
      year: r.year,
      citations: null, // PubMed doesn't provide citation counts here
      authors: r.authors,
      journal: r.journal,
      abstract: r.abstract,
    }));
}

// --- UTK TRACE: bepress Digital Commons OAI-PMH (XML, no keyword search) ---
// Harvest a batch and filter client-side. Regex extraction keeps it edge-safe.
function extractRecords(xmlText) {
  const records = [];
  const recRe = /<record\b[\s\S]*?<\/record>/g;
  const tag = (block, name) => {
    // matches <name ...>...</name> ignoring namespace prefix
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
    if (title && abstract) {
      records.push({ title, abstract, url, authors, year });
    }
  }
  return records;
}

export async function traceUTK(
  query,
  sets = ["publication:utk_graddiss", "publication:utk_gradthes"]
) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3);
  if (terms.length === 0) return [];

  const all = [];
  for (const set of sets) {
    try {
      const url =
        "https://trace.tennessee.edu/do/oai/?" +
        new URLSearchParams({
          verb: "ListRecords",
          metadataPrefix: "dcq",
          set,
        });
      const text = await getText(url);
      all.push(...extractRecords(text));
    } catch {
      // best-effort per set
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
    .slice(0, 4);

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

// Main source with fallback, merged with TRACE (best-effort).
export async function gatherPapers(query, { openAlexKey, s2Key } = {}) {
  const mainChain = [
    ["Europe PMC", () => europePMC(query)],
    ["PubMed", () => pubmed(query, 6)],
    ["Semantic Scholar", () => semanticScholar(query, 6, s2Key)],
    ["OpenAlex", () => openAlex(query, 6, openAlexKey)],
  ];

  let main = null;
  const errors = [];
  for (const [name, fn] of mainChain) {
    try {
      const papers = await fn();
      if (papers.length) {
        main = { papers, source: name };
        break;
      }
      errors.push(`${name}: no results`);
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  if (!main) throw new Error(errors.join(" | "));

  let trace = [];
  try {
    trace = await traceUTK(query);
  } catch {
    trace = [];
  }

  const merged = [...main.papers];
  const seen = new Set(merged.map((p) => (p.title || "").toLowerCase()));
  for (const t of trace) {
    const k = (t.title || "").toLowerCase();
    if (!seen.has(k)) {
      merged.push(t);
      seen.add(k);
    }
  }

  return {
    papers: merged,
    source: trace.length ? `${main.source} + UTK TRACE` : main.source,
    utkCount: trace.length,
  };
}
// --- Cloudflare Pages Serverless Function Entry Point ---
export async function onRequestPost(context) {
  try {
    // 1. Parse the query sent by your React frontend
    const { query } = await context.request.json();
    
    if (!query) {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 2. Fetch the environment keys if you have configured them in the dashboard
    const openAlexKey = context.env.OPENALEX_API_KEY || "";
    const s2Key = context.env.SEMANTIC_SCHOLAR_API_KEY || "";

    // 3. Execute the paper gathering chain already built above
    const result = await gatherPapers(query, { openAlexKey, s2Key });

    // 4. Return a mock answer text built from the abstracts since we aren't calling LLM yet
    // (Or this can be wired directly into an AI endpoint using context.env.ANTHROPIC_API_KEY)
    const summaryText = result.papers
      .slice(0, 3)
      .map((p, idx) => `${p.title}: ${p.abstract.slice(0, 150)}... [${idx + 1}]`)
      .join("\n\n");

    return new Response(
      JSON.stringify({
        answer: summaryText || "No matching literature found.",
        sources: result.papers,
        source: result.source,
        note: `Retrieved ${result.papers.length} papers successfully.`
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: `Backend processing failed: ${error.message}` }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
