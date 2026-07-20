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

// Reasonable timeout: scholarly APIs are often slow. 9s, not 2s.
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
  // Match on ANY term (not all), score by how many match.
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
  // If stripping removed everything, fall back to the original.
  return cleaned || raw.trim();
}

// ---------- Crossref: 150M+ works, keyless ----------
async function crossref(query, limit = 8) {
  try {
    const url = "https://api.crossref.org/works?" +
      new URLSearchParams({ query, rows: String(limit), select: "title,author,container-title,published,DOI,abstract,is-referenced-by-count" }) +
      "&mailto=cerebrum@example.com";
    const data = await getJSON(url);
    const items = data?.message?.items || [];
    return items.map((it) => ({
      title: Array.isArray(it.title) ? it.title[0] : it.title || "Untitled",
      url: it.DOI ? `https://doi.org/${it.DOI}` : "",
      year: it.published?.["date-parts"]?.[0]?.[0] || "",
      citations: it["is-referenced-by-count"] ?? null,
      authors: (it.author || []).slice(0, 1).map((a) => `${a.given || ""} ${a.family || ""}`.trim()).join("") + ((it.author || []).length > 1 ? " et al." : ""),
      journal: Array.isArray(it["container-title"]) ? it["container-title"][0] : it["container-title"] || "Crossref",
      abstract: stripTags(it.abstract || ""),
    })).filter((p) => p.title);
  } catch { return []; }
}

// ---------- arXiv: physics/math/CS preprints, keyless (Atom XML) ----------
async function arxiv(query, limit = 6) {
  try {
    const url = "https://export.arxiv.org/api/query?" +
      new URLSearchParams({ search_query: `all:${query}`, max_results: String(limit), sortBy: "relevance" });
    const xml = await getText(url);
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    return entries.map((e) => {
      const g = (re) => { const m = e.match(re); return m ? m[1].trim() : ""; };
      const title = stripTags(g(/<title>([\s\S]*?)<\/title>/));
      const summary = stripTags(g(/<summary>([\s\S]*?)<\/summary>/));
      const id = g(/<id>([\s\S]*?)<\/id>/);
      const published = g(/<published>(\d{4})/);
      const authorNames = (e.match(/<name>([\s\S]*?)<\/name>/g) || []).map((a) => a.replace(/<\/?name>/g, "").trim());
      return {
        title: title || "arXiv paper",
        url: id,
        year: published || "",
        citations: null,
        authors: authorNames.length > 1 ? `${authorNames[0]} et al.` : authorNames[0] || "",
        journal: "arXiv",
        abstract: summary,
      };
    }).filter((p) => p.abstract);
  } catch { return []; }
}

// ---------- Semantic Scholar: 200M+, keyless shared pool ----------
async function semanticScholar(query, limit = 6) {
  try {
    const url = "https://api.semanticscholar.org/graph/v1/paper/search?" +
      new URLSearchParams({ query, limit: String(limit), fields: "title,abstract,year,citationCount,authors,venue,externalIds,openAccessPdf,url" });
    const data = await getJSON(url);
    return (data?.data || []).filter((r) => r.abstract).map((r) => {
      const doi = r.externalIds?.DOI;
      const names = (r.authors || []).map((a) => a.name);
      return {
        title: r.title || "Untitled",
        url: doi ? `https://doi.org/${doi}` : r.openAccessPdf?.url || r.url || "",
        year: r.year || "",
        citations: r.citationCount ?? null,
        authors: names.length > 1 ? `${names[0]} et al.` : names[0] || "",
        journal: r.venue || "Semantic Scholar",
        abstract: r.abstract,
      };
    });
  } catch { return []; }
}

// ---------- DOAJ: open-access journals, keyless ----------
async function doaj(query, limit = 6) {
  try {
    const url = `https://doaj.org/api/search/articles/${encodeURIComponent(query)}?pageSize=${limit}`;
    const data = await getJSON(url);
    return (data?.results || []).map((r) => {
      const b = r.bibjson || {};
      const doiId = (b.identifier || []).find((x) => x.type === "doi");
      const link = (b.link || [])[0];
      return {
        title: b.title || "Untitled",
        url: doiId ? `https://doi.org/${doiId.id}` : link?.url || "",
        year: b.year || "",
        citations: null,
        authors: (b.author || []).slice(0, 1).map((a) => a.name).join("") + ((b.author || []).length > 1 ? " et al." : ""),
        journal: b.journal?.title || "DOAJ",
        abstract: stripTags(b.abstract || ""),
      };
    }).filter((p) => p.abstract);
  } catch { return []; }
}

// ---------- bioRxiv / medRxiv via their API (keyless) ----------
async function biorxiv(query, limit = 4) {
  // bioRxiv has no keyword search endpoint; use Europe PMC's index filtered to preprints.
  try {
    const url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
      new URLSearchParams({ query: `${query} AND (SRC:PPR)`, resultType: "core", pageSize: String(limit), format: "json" });
    const data = await getJSON(url);
    const rows = data?.resultList?.result || [];
    return rows.filter((r) => r.abstractText).map((r) => ({
      title: r.title || "Untitled",
      url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`,
      year: r.pubYear || "",
      citations: r.citedByCount ?? null,
      authors: r.authorString || "",
      journal: r.journalTitle || "Preprint",
      abstract: stripTags(r.abstractText),
    }));
  } catch { return []; }
}

// ---------- Zenodo: open research outputs, keyless ----------
async function zenodo(query, limit = 4) {
  try {
    const url = "https://zenodo.org/api/records?" +
      new URLSearchParams({ q: query, size: String(limit), sort: "mostrecent" });
    const data = await getJSON(url);
    return (data?.hits?.hits || []).map((r) => {
      const md = r.metadata || {};
      return {
        title: md.title || "Untitled",
        url: r.doi_url || md.doi ? `https://doi.org/${md.doi}` : r.links?.self_html || "",
        year: (md.publication_date || "").slice(0, 4),
        citations: null,
        authors: (md.creators || []).slice(0, 1).map((a) => a.name).join("") + ((md.creators || []).length > 1 ? " et al." : ""),
        journal: "Zenodo",
        abstract: stripTags(md.description || ""),
      };
    }).filter((p) => p.abstract);
  } catch { return []; }
}

// ---------- DataCite: datasets and DOIs, keyless ----------
async function datacite(query, limit = 4) {
  try {
    const url = "https://api.datacite.org/dois?" +
      new URLSearchParams({ query, "page[size]": String(limit) });
    const data = await getJSON(url);
    return (data?.data || []).map((r) => {
      const a = r.attributes || {};
      const title = (a.titles || [])[0]?.title || "Untitled";
      const desc = (a.descriptions || [])[0]?.description || "";
      return {
        title,
        url: a.doi ? `https://doi.org/${a.doi}` : a.url || "",
        year: a.publicationYear || "",
        citations: a.citationCount ?? null,
        authors: (a.creators || []).slice(0, 1).map((c) => c.name).join("") + ((a.creators || []).length > 1 ? " et al." : ""),
        journal: a.publisher || "DataCite",
        abstract: stripTags(desc),
      };
    }).filter((p) => p.abstract);
  } catch { return []; }
}

// ---------- OpenAIRE: European open science aggregator, keyless ----------
async function openaire(query, limit = 4) {
  try {
    const url = "https://api.openaire.eu/search/publications?" +
      new URLSearchParams({ keywords: query, size: String(limit), format: "json" });
    const data = await getJSON(url);
    const results = data?.response?.results?.result || [];
    const arr = Array.isArray(results) ? results : [results];
    return arr.map((r) => {
      const meta = r?.metadata?.["oaf:entity"]?.["oaf:result"] || {};
      const titleField = meta.title;
      const title = Array.isArray(titleField) ? (titleField[0]?.content || titleField[0]?.$ || "") : (titleField?.content || titleField?.$ || "");
      const desc = Array.isArray(meta.description) ? (meta.description[0]?.$ || "") : (meta.description?.$ || "");
      return {
        title: title || "Untitled",
        url: "",
        year: (meta.dateofacceptance?.$ || "").slice(0, 4),
        citations: null,
        authors: "",
        journal: "OpenAIRE",
        abstract: stripTags(desc),
      };
    }).filter((p) => p.title && p.abstract);
  } catch { return []; }
}

// ---------- HAL: French open archive, keyless ----------
async function hal(query, limit = 4) {
  try {
    const url = "https://api.archives-ouvertes.fr/search/?" +
      new URLSearchParams({ q: query, rows: String(limit), fl: "title_s,abstract_s,producedDateY_i,authFullName_s,uri_s,journalTitle_s", wt: "json" });
    const data = await getJSON(url);
    return (data?.response?.docs || []).map((d) => ({
      title: Array.isArray(d.title_s) ? d.title_s[0] : d.title_s || "Untitled",
      url: d.uri_s || "",
      year: d.producedDateY_i || "",
      citations: null,
      authors: (d.authFullName_s || []).slice(0, 1).join("") + ((d.authFullName_s || []).length > 1 ? " et al." : ""),
      journal: d.journalTitle_s || "HAL",
      abstract: stripTags(Array.isArray(d.abstract_s) ? d.abstract_s[0] : d.abstract_s || ""),
    })).filter((p) => p.abstract);
  } catch { return []; }
}

// ---------- CORE: 250M+ OA papers (optional key) ----------
async function core(query, limit = 6, key = "") {
  if (!key) return [];
  try {
    const res = await fetch("https://api.core.ac.uk/v3/search/works", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, limit }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.results || []).map((r) => ({
      title: r.title || "Untitled",
      url: r.doi ? `https://doi.org/${r.doi}` : (r.links || [])[0]?.url || "",
      year: r.yearPublished || "",
      citations: null,
      authors: (r.authors || []).slice(0, 1).map((a) => a.name).join("") + ((r.authors || []).length > 1 ? " et al." : ""),
      journal: r.publisher || "CORE",
      abstract: stripTags(r.abstract || ""),
    })).filter((p) => p.abstract);
  } catch { return []; }
}

// ---------- Author search ----------
function detectAuthor(raw) {
  const q = raw.trim();
  const lower = q.toLowerCase();
  const prefixes = ["papers by ", "publications by ", "articles by ", "research by ", "work by ", "author:"];
  for (const p of prefixes) {
    if (lower.startsWith(p)) return q.slice(p.length).trim();
  }
  const words = q.split(/\s+/);
  if (words.length >= 2 && words.length <= 4) {
    const questiony = /^(what|how|why|when|where|which|who|is|are|does|do|can|explain|tell)/i.test(q);
    const allCap = words.every((w) => /^[A-Z][a-zA-Z.'-]*$/.test(w));
    if (allCap && !questiony) return q;
  }
  return null;
}

async function authorOpenAlex(name, limit = 12, key = "") {
  if (!key) return [];
  try {
    const params = new URLSearchParams({
      filter: `authorships.author.display_name.search:${name}`,
      sort: "cited_by_count:desc",
      per_page: String(limit),
      select: "title,doi,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships",
      api_key: key,
    });
    const data = await getJSON(`https://api.openalex.org/works?${params}`);
    return (data.results || []).map((w) => {
      const first = w.authorships?.[0]?.author?.display_name || "";
      return {
        title: w.title || "Untitled",
        url: w.doi || w.primary_location?.landing_page_url || "",
        year: w.publication_year || "", citations: w.cited_by_count ?? null,
        authors: w.authorships?.length > 1 ? `${first} et al.` : first,
        journal: w.primary_location?.source?.display_name || "OpenAlex",
        abstract: decodeInverted(w.abstract_inverted_index),
      };
    });
  } catch { return []; }
}

async function authorCrossref(name, limit = 12) {
  try {
    const url = "https://api.crossref.org/works?" +
      new URLSearchParams({ "query.author": name, rows: String(limit), sort: "is-referenced-by-count", order: "desc", select: "title,author,container-title,published,DOI,is-referenced-by-count,abstract" }) +
      "&mailto=cerebrum@example.com";
    const data = await getJSON(url);
    return (data?.message?.items || []).map((it) => ({
      title: Array.isArray(it.title) ? it.title[0] : it.title || "Untitled",
      url: it.DOI ? `https://doi.org/${it.DOI}` : "",
      year: it.published?.["date-parts"]?.[0]?.[0] || "",
      citations: it["is-referenced-by-count"] ?? null,
      authors: (it.author || []).slice(0, 1).map((a) => `${a.given || ""} ${a.family || ""}`.trim()).join("") + ((it.author || []).length > 1 ? " et al." : ""),
      journal: Array.isArray(it["container-title"]) ? it["container-title"][0] : it["container-title"] || "Crossref",
      abstract: stripTags(it.abstract || ""),
    })).filter((p) => p.title);
  } catch { return []; }
}

async function authorSemanticScholar(name, limit = 20) {
  try {
    const searchUrl = "https://api.semanticscholar.org/graph/v1/author/search?" +
      new URLSearchParams({ query: name, fields: "name,paperCount,citationCount", limit: "5" });
    const sdata = await getJSON(searchUrl);
    const cands = sdata?.data || [];
    if (!cands.length) return { papers: [], matched: null };

    // Require the candidate's name to genuinely match the query, not just "most papers".
    const wanted = name.toLowerCase().split(/\s+/).filter(Boolean);
    const scoreName = (candName) => {
      const cn = (candName || "").toLowerCase();
      return wanted.filter((w) => cn.includes(w)).length / wanted.length;
    };
    const ranked = cands
      .map((c) => ({ c, match: scoreName(c.name) }))
      .sort((a, b) => (b.match - a.match) || ((b.c.paperCount || 0) - (a.c.paperCount || 0)));

    const best = ranked[0];
    // Need every queried name token present (full match) to trust it.
    if (!best || best.match < 0.99) return { papers: [], matched: null };

    const authorId = best.c.authorId;
    if (!authorId) return { papers: [], matched: null };
    const papersUrl = `https://api.semanticscholar.org/graph/v1/author/${authorId}/papers?` +
      new URLSearchParams({ fields: "title,abstract,year,citationCount,authors,venue,externalIds", limit: String(limit) });
    const pdata = await getJSON(papersUrl);
    const papers = (pdata?.data || []).map((r) => {
      const doi = r.externalIds?.DOI;
      const names = (r.authors || []).map((a) => a.name);
      return {
        title: r.title || "Untitled",
        url: doi ? `https://doi.org/${doi}` : (r.externalIds?.ArXiv ? `https://arxiv.org/abs/${r.externalIds.ArXiv}` : ""),
        year: r.year || "", citations: r.citationCount ?? null,
        authors: names.length > 1 ? `${names[0]} et al.` : names[0] || "",
        journal: r.venue || "Semantic Scholar", abstract: r.abstract || "",
      };
    }).filter((p) => p.title && p.title !== "Untitled");
    return { papers, matched: best.c.name };
  } catch { return { papers: [], matched: null }; }
}

async function gatherByAuthor(name, { openAlexKey }) {
  const [ssRes, oa, cr] = await Promise.all([
    authorSemanticScholar(name, 20),
    authorOpenAlex(name, 12, openAlexKey),
    authorCrossref(name, 15),
  ]);
  const ss = ssRes.papers;
  const merged = [];
  const seen = new Set();
  for (const list of [ss, oa, cr]) {
    for (const p of list) {
      const key = (p.title || "").toLowerCase().trim();
      if (key && !seen.has(key)) { seen.add(key); merged.push(p); }
    }
  }
  const papers = merged.sort((a, b) => (b.citations || 0) - (a.citations || 0)).slice(0, 25);
  // "confirmed" only if Semantic Scholar found a real name match with papers.
  return { papers, confirmed: !!ssRes.matched, matchedName: ssRes.matched };
}

// ---------- Gather + rank ----------
async function gatherPapers(rawQuery, { openAlexKey, coreKey, limit = 6, browse = false }) {
  const query = cleanQuery(rawQuery);

  // All sources run in parallel. Each is wrapped so one failure/slowness
  // never blocks the rest (they already catch internally and return []).
  const jobs = [
    europePMC(query, 8),
    pubmed(query, 8),
    traceUTK(query),
    openAlex(query, 8, openAlexKey),
    crossref(query, 8),
    arxiv(query, 6),
    semanticScholar(query, 6),
    doaj(query, 6),
    biorxiv(query, 4),
    zenodo(query, 4),
    datacite(query, 4),
    openaire(query, 4),
    hal(query, 4),
    core(query, 6, coreKey),
  ];
  const results = await Promise.all(jobs);

  const merged = [];
  const seen = new Set();
  for (const list of results) {
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
    // Browse mode is more permissive so it can show the full ranked list.
    .filter((p) => {
      if (browse) return terms.length ? p.coverage > 0 : true;
      return terms.length <= 1 ? p.coverage > 0 : p.coverage >= 0.5;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

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
      return new Response(JSON.stringify({ error: "No query provided." }), {
        status: 400,
        headers: cors,
      });
    }

    // Small talk: quick friendly reply, no search.
    const small = query.toLowerCase().replace(/[^a-z\s]/g, "").trim();
    const greetings = ["hi", "hello", "hey", "yo", "sup", "howdy", "hiya"];
    if (greetings.includes(small)) {
      return new Response(JSON.stringify({
        answer: "Hi! I'm Cerebrum. Ask me anything \u2014 science questions get answers backed by real papers with citations, and I'll do my best with general questions too.",
        sources: [],
        source: "Cerebrum",
      }), { status: 200, headers: cors });
    }

    // Author search: "papers by X" or a person's name -> their publications.
    const authorName = detectAuthor(query);
    if (authorName && body.mode !== "browse") {
      let ar = { papers: [], confirmed: false, matchedName: null };
      try {
        ar = await gatherByAuthor(authorName, { openAlexKey: env.OPENALEX_KEY || "" });
      } catch { ar = { papers: [], confirmed: false, matchedName: null }; }

      // Only present an author page when we actually confirmed the person.
      if (ar.confirmed && ar.papers.length) {
        return new Response(JSON.stringify({
          answer: `Publications associated with **${ar.matchedName || authorName}**, ranked by citations. These are pulled directly from this author's record. If it's not who you meant, add a field like "${authorName} microbiology".`,
          sources: ar.papers.map(({ title, url, journal, authors, year, citations }) => ({ title, url, journal, authors, year, citations })),
          source: `${ar.papers.length} publications by ${ar.matchedName || authorName}`,
        }), { status: 200, headers: cors });
      }

      // Could not confirm the author. Be honest; do NOT dress up loose matches as their work.
      if (!ar.confirmed) {
        return new Response(JSON.stringify({
          answer: `I couldn't confirm a researcher named **${authorName}** in the author databases (Semantic Scholar, Crossref, OpenAlex). This can happen when someone has few indexed publications, publishes under a different name form, or the name is spelled differently in the record. Try the full name as it appears on their papers, add a middle initial, or search a topic instead and open the papers to find them.`,
          sources: [],
          source: "author not confirmed",
        }), { status: 200, headers: cors });
      }
      // (confirmed but zero papers is unlikely; fall through to normal search.)
    }

    // Browse mode: return the full ranked publication list, no AI answer.
    if (body.mode === "browse") {
      let bp = [];
      try {
        const g = await gatherPapers(query, { openAlexKey: env.OPENALEX_KEY || "", coreKey: env.CORE_API_KEY || "", limit: 25, browse: true });
        bp = g.papers;
      } catch {
        bp = [];
      }
      return new Response(JSON.stringify({
        answer: "",
        sources: bp.map(({ title, url, journal, authors, year, citations }) => ({ title, url, journal, authors, year, citations })),
        source: `${bp.length} publications ranked by relevance`,
      }), { status: 200, headers: cors });
    }

    // Settings from the client (all optional).
    const settings = body.settings || {};
    const answerLength = settings.answerLength || "medium"; // short | medium | long
    const maxTokens = answerLength === "short" ? 450 : answerLength === "long" ? 1400 : 900;
    const lengthHint = answerLength === "short" ? "Keep it to one tight paragraph." : answerLength === "long" ? "Give a thorough, well-structured explanation." : "Keep it to a few short paragraphs.";

    // Gather papers (best effort; may be empty for non-science questions).
    let papers = [];
    let utk = false;
    try {
      const g = await gatherPapers(query, { openAlexKey: env.OPENALEX_KEY || "", coreKey: env.CORE_API_KEY || "", limit: 6 });
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

    const systemPrompt = (hasPapers
      ? "You are Cerebrum, a knowledgeable science assistant. You are given real papers as evidence. Answer using them, citing inline like [1] or [2] by paper number. You may add general-knowledge context but prefer the papers for specific claims. Interpret typos. "
      : "You are Cerebrum, a knowledgeable, helpful assistant. Answer clearly and accurately from your own knowledge. Interpret typos. Be honest if unsure. Do not fabricate citations. ") +
      lengthHint +
      " Format in clean prose. Do NOT use markdown heading symbols like # or ###. You may use **bold** sparingly and blank lines between paragraphs, nothing else.";

    // Follow-up: include prior turns if the client sent them.
    const messages = [{ role: "system", content: systemPrompt }];
    const historyTurns = Array.isArray(body.history) ? body.history.slice(-4) : [];
    for (const turn of historyTurns) {
      if (turn.role === "user" || turn.role === "assistant") {
        messages.push({ role: turn.role, content: String(turn.content || "").slice(0, 2000) });
      }
    }
    messages.push({ role: "user", content: hasPapers ? `Papers:\n\n${evidence}\n\n---\nQuestion: ${query}` : query });

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
            body: JSON.stringify({ model, temperature: 0.3, max_tokens: maxTokens, messages }),
          });
          if (r.ok) {
            const j = await r.json();
            const c = j?.choices?.[0]?.message?.content?.trim();
            if (c) { answer = c; aiOK = true; break; }
          }
        } catch { /* try next model */ }
      }
    }

    if (!aiOK) {
      if (hasPapers) {
        answer = "Here are the most relevant papers I found (the answer writer is busy right now):\n\n" +
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
    return new Response(
      JSON.stringify({ error: `Runtime error: ${e.message}` }),
      { status: 500, headers: cors }
    );
  }
}
