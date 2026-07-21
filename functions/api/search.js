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

async function getJSON(url, headers = {}, timeoutMs = 6000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
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

async function getText(url, headers = {}, timeoutMs = 6000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
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

// ---------- Query Helpers & Constants ----------
const SYNONYMS = {
  bsfl: ["black soldier fly larvae", "hermetia illucens"],
  bsf: ["black soldier fly", "hermetia illucens"],
  crispr: ["clustered regularly interspaced short palindromic repeats"],
  pcr: ["polymerase chain reaction"],
  dna: ["deoxyribonucleic acid"],
  rna: ["ribonucleic acid"],
  mrna: ["messenger rna"],
  utr: ["untranslated region"],
  gwas: ["genome wide association"],
  qtl: ["quantitative trait loci"],
  ros: ["reactive oxygen species"],
  er: ["endoplasmic reticulum"],
  atp: ["adenosine triphosphate"],
  ecm: ["extracellular matrix"],
  tcr: ["t cell receptor"],
  llps: ["liquid liquid phase separation"],
  pet: ["polyethylene terephthalate"],
  pe: ["polyethylene"],
  pp: ["polypropylene"],
};

function expansionsFor(tokens) {
  const out = [];
  for (const t of tokens) {
    const key = t.toLowerCase();
    if (SYNONYMS[key]) out.push(...SYNONYMS[key]);
  }
  return out;
}

const ORGANISM_PHRASES = [
  "black soldier fly larvae", "black soldier fly", "hermetia illucens",
];
const ORGANISM_WORDS = new Set(["black", "soldier", "fly", "larvae", "larva", "hermetia", "illucens"]);

function splitOrganismTopic(query) {
  const q = query.toLowerCase();
  const toks = q.split(/\s+/).filter((t) => t.length > 2);
  const exp = expansionsFor(toks);
  const orgPhrases = new Set(exp);
  for (const phrase of ORGANISM_PHRASES) { if (q.includes(phrase)) orgPhrases.add(phrase); }
  for (const t of toks) { if (SYNONYMS[t]) orgPhrases.add(t); }
  const topic = toks.filter((t) => !ORGANISM_WORDS.has(t) && !SYNONYMS[t]);
  return { orgPhrases: [...orgPhrases], topic, hasOrganism: orgPhrases.size > 0 };
}

function buildStructuredQuery(query) {
  const { orgPhrases, topic, hasOrganism } = splitOrganismTopic(query);
  if (hasOrganism && topic.length) {
    const org = orgPhrases.map((e) => (e.includes(" ") ? `"${e}"` : e)).join(" OR ");
    return `(${org}) AND (${topic.join(" OR ")})`;
  }
  if (hasOrganism) {
    return orgPhrases.map((e) => (e.includes(" ") ? `"${e}"` : e)).join(" OR ");
  }
  return query;
}

const STOPWORDS = new Set([
  "what","whats","how","does","do","did","is","are","was","were","the","a","an",
  "of","in","on","for","to","and","or","with","by","about","tell","me","explain",
  "why","when","where","which","who","can","you","please","give","show","find",
  "search","look","up","that","this","these","those","it","its","work","works",
  "happen","happens","mean","means","between","into","from","as","at","be","been",
  "get","got","i","my","we","our","use","used","using","there","their","they",
  "responding","respond","level","levels","basis","role","effect","effects",
]);

function cleanQuery(raw) {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .join(" ")
    .trim();
  return cleaned || raw.trim();
}

// ---------- Source: Europe PMC ----------
async function europePMC(query, limit = 6) {
  const q = buildStructuredQuery(query);
  const runSearch = async (queryStr) => {
    const url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
      new URLSearchParams({ query: queryStr, resultType: "core", pageSize: String(limit), format: "json", sort: "relevance" });
    const data = await getJSON(url);
    return data?.resultList?.result || [];
  };
  try {
    let rows = await runSearch(q);
    if (!rows.length && q !== query) {
      const { orgPhrases, hasOrganism } = splitOrganismTopic(query);
      if (hasOrganism) {
        const orgOnly = orgPhrases.map((e) => (e.includes(" ") ? `"${e}"` : e)).join(" OR ");
        rows = await runSearch(orgOnly);
      }
      if (!rows.length) rows = await runSearch(query);
    }
    return rows
      .filter((r) => r.title)
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
        pmcid: r.pmcid || (r.source === "PMC" ? r.id : "") || "",
      }));
  } catch {
    return [];
  }
}

// ---------- Source: PubMed ----------
function firstMatch(block, re) {
  const m = block.match(re);
  return m ? m[1] : "";
}
function parsePubmedXML(xmlText) {
  const arts = xmlText.match(/<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/g) || [];
  return arts.map((a) => {
    const pmid = firstMatch(a, /<PMID[^>]*>(\d+)<\/PMID>/);
    const title = stripTags(firstMatch(a, /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/));
    const absParts = a.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g) || [];
    const abstract = stripTags(absParts.join(" "));
    const journal = stripTags(firstMatch(a, /<Title>([\s\S]*?)<\/Title>/) || firstMatch(a, /<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/));
    const year = firstMatch(a, /<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/);
    const authorBlocks = a.match(/<Author\b[\s\S]*?<\/Author>/g) || [];
    const names = authorBlocks.map((b) => {
      const last = firstMatch(b, /<LastName>([\s\S]*?)<\/LastName>/);
      const ini = firstMatch(b, /<Initials>([\s\S]*?)<\/Initials>/);
      return [last, ini].filter(Boolean).join(" ");
    }).filter(Boolean);
    const authors = names.length > 1 ? `${names[0]} et al.` : names[0] || "";
    const doi = firstMatch(a, /<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/);
    return {
      title: title || "Untitled",
      url: doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      year, citations: null, authors, journal: journal || "PubMed", abstract,
    };
  });
}
async function pubmed(query, limit = 6, apiKey = "") {
  const keyParam = apiKey ? `&api_key=${apiKey}` : "";
  const tool = "&tool=cerebrum&email=noreply@example.com" + keyParam;
  try {
    const structured = buildStructuredQuery(query);
    let term = structured;
    const es = await getJSON("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" + new URLSearchParams({ db: "pubmed", term, retmax: String(limit), retmode: "json", sort: "relevance" }) + tool);
    let ids = es?.esearchresult?.idlist || [];
    if (!ids.length && term !== query) {
      const { orgPhrases, hasOrganism } = splitOrganismTopic(query);
      if (hasOrganism) {
        const orgOnly = orgPhrases.map((e) => (e.includes(" ") ? `"${e}"` : e)).join(" OR ");
        const es2 = await getJSON("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" + new URLSearchParams({ db: "pubmed", term: orgOnly, retmax: String(limit), retmode: "json", sort: "relevance" }) + tool);
        ids = es2?.esearchresult?.idlist || [];
      }
      if (!ids.length) {
        const es3 = await getJSON("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" + new URLSearchParams({ db: "pubmed", term: query, retmax: String(limit), retmode: "json", sort: "relevance" }) + tool);
        ids = es3?.esearchresult?.idlist || [];
      }
    }
    if (!ids.length) return [];
    const idStr = ids.join(",");

    const [xml, summaryJson, citeJson] = await Promise.all([
      getText("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?" + new URLSearchParams({ db: "pubmed", id: idStr, retmode: "xml" }) + tool).catch(() => ""),
      getJSON("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?" + new URLSearchParams({ db: "pubmed", id: idStr, retmode: "json" }) + tool).catch(() => null),
      getJSON("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi?" + new URLSearchParams({ dbfrom: "pubmed", db: "pubmed", id: idStr, linkname: "pubmed_pubmed_citedin", retmode: "json" }) + tool).catch(() => null),
    ]);

    const fetched = xml ? parsePubmedXML(xml) : [];
    const byTitle = new Map(fetched.map((p) => [(p.title || "").toLowerCase().trim(), p]));
    const sumResult = summaryJson?.result || {};
    const merged = [];
    for (const pmid of ids) {
      const s = sumResult[pmid];
      let rec = null;
      if (s) {
        const title = s.title || "";
        rec = byTitle.get(title.toLowerCase().trim()) || null;
        if (!rec) {
          rec = { title: title || "Untitled", url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, year: (s.pubdate || "").slice(0, 4), citations: null, authors: (s.authors || []).slice(0, 1).map((a) => a.name).join("") + ((s.authors || []).length > 1 ? " et al." : ""), journal: s.fulljournalname || s.source || "PubMed", abstract: "", pmid };
        } else {
          rec.pmid = pmid;
          if (!rec.year && s.pubdate) rec.year = (s.pubdate || "").slice(0, 4);
          if ((!rec.authors || !rec.authors.length) && s.authors) rec.authors = (s.authors || []).slice(0, 1).map((a) => a.name).join("") + ((s.authors || []).length > 1 ? " et al." : "");
        }
      }
      if (rec && rec.title) merged.push(rec);
    }
    for (const p of fetched) {
      if (!merged.some((m) => (m.title || "").toLowerCase() === (p.title || "").toLowerCase())) merged.push(p);
    }
    try {
      const linksets = citeJson?.linksets || [];
      const countByPmid = {};
      for (const ls of linksets) {
        const src = (ls.ids || [])[0] || ls.id;
        const dbs = ls.linksetdbs || [];
        const citedin = dbs.find((d) => d.linkname === "pubmed_pubmed_citedin");
        if (src && citedin) countByPmid[src] = (citedin.links || []).length;
      }
      for (const rec of merged) {
        if (rec.pmid && typeof countByPmid[rec.pmid] === "number") rec.citations = countByPmid[rec.pmid];
      }
    } catch {}
    return merged;
  } catch { return []; }
}

// ---------- Source: OpenAlex ----------
async function openAlex(query, limit = 6, key = "") {
  try {
    const params = new URLSearchParams({ search: query, sort: "relevance_score:desc", per_page: String(limit), select: "title,doi,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships,ids", mailto: "noreply@example.com" });
    if (key) params.set("api_key", key);
    const data = await getJSON(`https://api.openalex.org/works?${params}`);
    return (data.results || []).map((w) => {
      const first = w.authorships?.[0]?.author?.display_name || "";
      const pmcid = (w.ids?.pmcid || "").replace(/^https?:\/\/.*?\/(PMC\d+)$/i, "$1").replace(/[^0-9]/g, "");
      return { title: w.title || "Untitled", url: w.doi || w.primary_location?.landing_page_url || w.primary_location?.pdf_url || "", year: w.publication_year || "", citations: w.cited_by_count ?? null, authors: w.authorships?.length > 1 ? `${first} et al.` : first, journal: w.primary_location?.source?.display_name || "OpenAlex", abstract: decodeInverted(w.abstract_inverted_index), pmcid: pmcid || "" };
    }).filter((p) => p.title);
  } catch { return []; }
}

// ---------- Source: UTK TRACE ----------
function extractTraceRecords(xmlText) {
  const records = [];
  const recRe = /<record\b[\s\S]*?<\/record>/g;
  const tag = (block, name) => {
    const re = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "i");
    const m = block.match(re);
    return m ? m[1].trim() : "";
  };
  const tagAll = (block, name) => {
    const re = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "gi");
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
      const text = await getText("https://trace.tennessee.edu/do/oai/?" + new URLSearchParams({ verb: "ListRecords", metadataPrefix: "dcq", set }));
      all.push(...extractTraceRecords(text));
    } catch {}
  }
  const scored = all.map((r) => {
    const hay = `${r.title} ${r.abstract}`.toLowerCase();
    const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
    return { ...r, score };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  return scored.map((r) => ({ title: r.title, url: r.url, year: r.year, citations: null, authors: r.authors, journal: "UTK TRACE", abstract: stripTags(r.abstract) }));
}

// ---------- Additional Scholarly Databases ----------
async function crossref(query, limit = 8) {
  try {
    const url = "https://api.crossref.org/works?" + new URLSearchParams({ query, rows: String(limit), select: "title,author,container-title,published,DOI,abstract,is-referenced-by-count" }) + "&mailto=cerebrum@example.com";
    const data = await getJSON(url);
    return (data?.message?.items || []).map((it) => ({ title: Array.isArray(it.title) ? it.title[0] : it.title || "Untitled", url: it.DOI ? `https://doi.org/${it.DOI}` : "", year: it.published?.["date-parts"]?.[0]?.[0] || "", citations: it["is-referenced-by-count"] ?? null, authors: (it.author || []).slice(0, 1).map((a) => `${a.given || ""} ${a.family || ""}`.trim()).join("") + ((it.author || []).length > 1 ? " et al." : ""), journal: Array.isArray(it["container-title"]) ? it["container-title"][0] : it["container-title"] || "Crossref", abstract: stripTags(it.abstract || "") })).filter((p) => p.title);
  } catch { return []; }
}

async function arxiv(query, limit = 6) {
  try {
    const url = "https://export.arxiv.org/api/query?" + new URLSearchParams({ search_query: `all:${query}`, max_results: String(limit), sortBy: "relevance" });
    const xml = await getText(url);
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    return entries.map((e) => {
      const g = (re) => { const m = e.match(re); return m ? m[1].trim() : ""; };
      const title = stripTags(g(/<title>([\s\S]*?)<\/title>/));
      const summary = stripTags(g(/<summary>([\s\S]*?)<\/summary>/));
      const id = g(/<id>([\s\S]*?)<\/id>/);
      const published = g(/<published>(\d{4})/);
      const authorNames = (e.match(/<name>([\s\S]*?)<\/name>/g) || []).map((a) => a.replace(/<\/?name>/g, "").trim());
      return { title: title || "arXiv paper", url: id, year: published || "", citations: null, authors: authorNames.length > 1 ? `${authorNames[0]} et al.` : authorNames[0] || "", journal: "arXiv", abstract: summary };
    }).filter((p) => p.title);
  } catch { return []; }
}

async function semanticScholar(query, limit = 6) {
  try {
    const url = "https://api.semanticscholar.org/graph/v1/paper/search?" + new URLSearchParams({ query, limit: String(limit), fields: "title,abstract,year,citationCount,authors,venue,externalIds,openAccessPdf,url" });
    const data = await getJSON(url);
    return (data?.data || []).filter((r) => r.title).map((r) => {
      const doi = r.externalIds?.DOI;
      const names = (r.authors || []).map((a) => a.name);
      return { title: r.title || "Untitled", url: doi ? `https://doi.org/${doi}` : r.openAccessPdf?.url || r.url || "", year: r.year || "", citations: r.citationCount ?? null, authors: names.length > 1 ? `${names[0]} et al.` : names[0] || "", journal: r.venue || "Semantic Scholar", abstract: r.abstract };
    });
  } catch { return []; }
}

async function doaj(query, limit = 6) {
  try {
    const url = `https://doaj.org/api/search/articles/${encodeURIComponent(query)}?pageSize=${limit}`;
    const data = await getJSON(url);
    return (data?.results || []).map((r) => {
      const b = r.bibjson || {};
      const doiId = (b.identifier || []).find((x) => x.type === "doi");
      const link = (b.link || [])[0];
      return { title: b.title || "Untitled", url: doiId ? `https://doi.org/${doiId.id}` : link?.url || "", year: b.year || "", citations: null, authors: (b.author || []).slice(0, 1).map((a) => a.name).join("") + ((b.author || []).length > 1 ? " et al." : ""), journal: b.journal?.title || "DOAJ", abstract: stripTags(b.abstract || "") };
    }).filter((p) => p.title);
  } catch { return []; }
}

async function biorxiv(query, limit = 4) {
  const out = [];
  try {
    const params = new URLSearchParams({ search: query, filter: "type:preprint", sort: "relevance_score:desc", per_page: String(limit), select: "title,doi,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships", mailto: "noreply@example.com" });
    const data = await getJSON(`https://api.openalex.org/works?${params}`);
    for (const w of (data.results || [])) {
      const first = w.authorships?.[0]?.author?.display_name || "";
      if (!w.title) continue;
      out.push({ title: w.title, url: w.doi || w.primary_location?.landing_page_url || "", year: w.publication_year || "", citations: w.cited_by_count ?? null, authors: w.authorships?.length > 1 ? `${first} et al.` : first, journal: w.primary_location?.source?.display_name || "Preprint", abstract: decodeInverted(w.abstract_inverted_index) });
    }
  } catch {}
  try {
    const url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" + new URLSearchParams({ query: `${query} AND (SRC:PPR)`, resultType: "core", pageSize: String(limit), format: "json", sort: "relevance" });
    const data = await getJSON(url);
    for (const r of (data?.resultList?.result || [])) {
      if (!r.title) continue;
      out.push({ title: r.title, url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source}/${r.id}`, year: r.pubYear || "", citations: r.citedByCount ?? null, authors: r.authorString || "", journal: r.journalTitle || "Preprint", abstract: stripTags(r.abstractText) });
    }
  } catch {}
  return out;
}

async function zenodo(query, limit = 4) {
  try {
    const url = "https://zenodo.org/api/records?" + new URLSearchParams({ q: query, size: String(limit), sort: "mostrecent" });
    const data = await getJSON(url);
    return (data?.hits?.hits || []).map((r) => {
      const md = r.metadata || {};
      return { title: md.title || "Untitled", url: r.doi_url || md.doi ? `https://doi.org/${md.doi}` : r.links?.self_html || "", year: (md.publication_date || "").slice(0, 4), citations: null, authors: (md.creators || []).slice(0, 1).map((a) => a.name).join("") + ((md.creators || []).length > 1 ? " et al." : ""), journal: "Zenodo", abstract: stripTags(md.description || "") };
    }).filter((p) => p.title);
  } catch { return []; }
}

async function datacite(query, limit = 4) {
  try {
    const url = "https://api.datacite.org/dois?" + new URLSearchParams({ query, "page[size]": String(limit) });
    const data = await getJSON(url);
    return (data?.data || []).map((r) => {
      const a = r.attributes || {};
      return { title: (a.titles || [])[0]?.title || "Untitled", url: a.doi ? `https://doi.org/${a.doi}` : a.url || "", year: a.publicationYear || "", citations: a.citationCount ?? null, authors: (a.creators || []).slice(0, 1).map((c) => c.name).join("") + ((a.creators || []).length > 1 ? " et al." : ""), journal: a.publisher || "DataCite", abstract: stripTags((a.descriptions || [])[0]?.description || "") };
    }).filter((p) => p.title);
  } catch { return []; }
}

async function openaire(query, limit = 4) {
  try {
    const url = "https://api.openaire.eu/search/publications?" + new URLSearchParams({ keywords: query, size: String(limit), format: "json" });
    const data = await getJSON(url);
    const results = data?.response?.results?.result || [];
    const arr = Array.isArray(results) ? results : [results];
    return arr.map((r) => {
      const meta = r?.metadata?.["oaf:entity"]?.["oaf:result"] || {};
      const titleField = meta.title;
      const title = Array.isArray(titleField) ? (titleField[0]?.content || titleField[0]?.$ || "") : (titleField?.content || titleField?.$ || "");
      const desc = Array.isArray(meta.description) ? (meta.description[0]?.$ || "") : (meta.description?.$ || "");
      return { title: title || "Untitled", url: "", year: (meta.dateofacceptance?.$ || "").slice(0, 4), citations: null, authors: "", journal: "OpenAIRE", abstract: stripTags(desc) };
    }).filter((p) => p.title);
  } catch { return []; }
}

async function hal(query, limit = 4) {
  try {
    const url = "https://api.archives-ouvertes.fr/search/?" + new URLSearchParams({ q: query, rows: String(limit), fl: "title_s,abstract_s,producedDateY_i,authFullName_s,uri_s,journalTitle_s", wt: "json" });
    const data = await getJSON(url);
    return (data?.response?.docs || []).map((d) => ({ title: Array.isArray(d.title_s) ? d.title_s[0] : d.title_s || "Untitled", url: d.uri_s || "", year: d.producedDateY_i || "", citations: null, authors: (d.authFullName_s || []).slice(0, 1).join("") + ((d.authFullName_s || []).length > 1 ? " et al." : ""), journal: d.journalTitle_s || "HAL", abstract: stripTags(Array.isArray(d.abstract_s) ? d.abstract_s[0] : d.abstract_s || "") })).filter((p) => p.title);
  } catch { return []; }
}

async function plos(query, limit = 6) {
  try {
    const url = "https://api.plos.org/search?" + new URLSearchParams({ q: query, fl: "id,title_display,author_display,journal,publication_date,abstract", wt: "json", rows: String(limit) });
    const data = await getJSON(url);
    return (data?.response?.docs || []).map((d) => ({ title: Array.isArray(d.title_display) ? d.title_display[0] : (d.title_display || "Untitled"), url: d.id ? `https://doi.org/${d.id}` : "", year: (d.publication_date || "").slice(0, 4), citations: null, authors: (d.author_display || []).slice(0, 1).join("") + ((d.author_display || []).length > 1 ? " et al." : ""), journal: d.journal || "PLOS", abstract: stripTags(Array.isArray(d.abstract) ? d.abstract.join(" ") : (d.abstract || "")) })).filter((p) => p.title);
  } catch { return []; }
}

async function base(query, limit = 6) {
  try {
    const url = "https://www.base-search.net/cgi-bin/BaseHttpSearchInterface.fcgi?" + new URLSearchParams({ func: "PerformSearch", query, format: "json", hits: String(limit) });
    const data = await getJSON(url);
    return (data?.response?.docs || []).map((d) => ({ title: d.dctitle || "Untitled", url: d.dclink || (d.dcidentifier ? d.dcidentifier : ""), year: (d.dcyear || "").toString().slice(0, 4), citations: null, authors: Array.isArray(d.dccreator) ? (d.dccreator[0] + (d.dccreator.length > 1 ? " et al." : "")) : (d.dccreator || ""), journal: d.dcpublisher || "BASE", abstract: stripTags(Array.isArray(d.dcdescription) ? d.dcdescription.join(" ") : (d.dcdescription || "")) })).filter((p) => p.title);
  } catch { return []; }
}

// ---------- Source: Educational Video Search (Invidious + Piped) ----------
async function searchInvidiousVideos(query, limit = 4) {
  const academicQuery = `${cleanQuery(query)} science lecture`;

  const invidiousInstances = [
    "https://inv.nadeko.net",
    "https://invidious.nerdvpn.de",
    "https://iv.ggtyler.dev",
    "https://invidious.protokolla.fi",
    "https://invidious.perennialte.ch",
    "https://vid.puffyan.us"
  ];

  for (const instance of invidiousInstances) {
    try {
      const url = `${instance}/api/v1/search?` + new URLSearchParams({ q: academicQuery, type: "video", sort: "relevance" });
      const data = await getJSON(url, {}, 3000);
      if (Array.isArray(data) && data.length > 0) {
        const valid = data.filter(v => v.videoId && v.title);
        if (valid.length > 0) {
          return valid.slice(0, limit).map((v) => ({
            title: v.title || "Untitled Video",
            videoId: v.videoId,
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            author: v.author || "Educational Source",
            viewCount: v.viewCount || 0,
            thumbnail: v.videoThumbnails?.find(t => t.quality === "medium")?.url || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
          }));
        }
      }
    } catch { continue; }
  }

  const pipedInstances = [
    "https://pipedapi.kavin.rocks",
    "https://api.piped.privacydev.net",
    "https://pipedapi.tokhmi.xyz"
  ];

  for (const instance of pipedInstances) {
    try {
      const url = `${instance}/search?` + new URLSearchParams({ q: academicQuery, filter: "videos" });
      const data = await getJSON(url, {}, 3000);
      const items = data?.items || [];
      if (Array.isArray(items) && items.length > 0) {
        return items.slice(0, limit).map((v) => {
          const id = v.url?.replace("/watch?v=", "") || "";
          return {
            title: v.title || "Untitled Video",
            videoId: id,
            url: `https://www.youtube.com/watch?v=${id}`,
            author: v.uploaderName || "Educational Source",
            viewCount: v.views || 0,
            thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
          };
        });
      }
    } catch { continue; }
  }

  return [];
}

async function wikipedia(query, limit = 2) {
  try {
    const searchUrl = "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({ action: "query", list: "search", srsearch: query, srlimit: String(limit), format: "json", origin: "*" });
    const sdata = await getJSON(searchUrl, {}, 5000);
    const hits = sdata?.query?.search || [];
    const out = [];
    for (const h of hits) {
      const title = h.title;
      try {
        const exUrl = "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({ action: "query", prop: "extracts", exintro: "1", explaintext: "1", titles: title, format: "json", origin: "*" });
        const ex = await getJSON(exUrl, {}, 5000);
        const pages = ex?.query?.pages || {};
        const page = Object.values(pages)[0] || {};
        const extract = (page.extract || "").replace(/\s+/g, " ").trim();
        out.push({ title: `${title} (Wikipedia)`, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`, year: "", citations: null, authors: "Wikipedia contributors", journal: "Wikipedia", abstract: extract.slice(0, 1200), isEncyclopedia: true });
      } catch {}
    }
    return out;
  } catch { return []; }
}

async function duckduckgo(query) {
  try {
    const url = "https://api.duckduckgo.com/?" + new URLSearchParams({ q: query, format: "json", no_html: "1", skip_disambig: "1" });
    const data = await getJSON(url, {}, 5000);
    const out = [];
    const abstract = (data?.AbstractText || "").trim();
    if (abstract) {
      out.push({ title: `${data.Heading || query} (${data.AbstractSource || "Web"})`, url: data.AbstractURL || "", year: "", citations: null, authors: data.AbstractSource || "Web", journal: data.AbstractSource || "Web", abstract: abstract.slice(0, 1000), isEncyclopedia: true });
    }
    return out;
  } catch { return []; }
}

async function biocFullText(pmcid) {
  if (!pmcid) return "";
  const id = String(pmcid).replace(/^PMC/i, "");
  try {
    const data = await getJSON(`https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_json/PMC${id}/unicode`, {}, 4000);
    const collections = Array.isArray(data) ? data : [data];
    const parts = [];
    for (const coll of collections) {
      const docs = coll?.documents || [];
      for (const doc of docs) {
        for (const pass of (doc.passages || [])) {
          const sec = pass?.infons?.section_type || "";
          if (["REF", "FIG", "TABLE"].includes(sec)) continue;
          if (pass.text && pass.text.length > 1) parts.push(pass.text);
        }
      }
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  } catch { return ""; }
}

async function core(query, limit = 6, key = "") {
  if (!key) return [];
  try {
    const res = await fetch("https://api.core.ac.uk/v3/search/works", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ q: query, limit }) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.results || []).map((r) => ({ title: r.title || "Untitled", url: r.doi ? `https://doi.org/${r.doi}` : (r.links || [])[0]?.url || "", year: r.yearPublished || "", citations: null, authors: (r.authors || []).slice(0, 1).map((a) => a.name).join("") + ((r.authors || []).length > 1 ? " et al." : ""), journal: r.publisher || "CORE", abstract: stripTags(r.abstract || "") })).filter((p) => p.title);
  } catch { return []; }
}

// ---------- Author Search ----------
function detectAuthor(raw) {
  const q = raw.trim();
  const lower = q.toLowerCase();
  const prefixes = ["papers by ", "publications by ", "articles by ", "research by ", "work by ", "author:"];
  for (const p of prefixes) { if (lower.startsWith(p)) return q.slice(p.length).trim(); }
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
    const params = new URLSearchParams({ filter: `authorships.author.display_name.search:${name}`, sort: "cited_by_count:desc", per_page: String(limit), select: "title,doi,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships", api_key: key });
    const data = await getJSON(`https://api.openalex.org/works?${params}`);
    return (data.results || []).map((w) => {
      const first = w.authorships?.[0]?.author?.display_name || "";
      return { title: w.title || "Untitled", url: w.doi || w.primary_location?.landing_page_url || "", year: w.publication_year || "", citations: w.cited_by_count ?? null, authors: w.authorships?.length > 1 ? `${first} et al.` : first, journal: w.primary_location?.source?.display_name || "OpenAlex", abstract: decodeInverted(w.abstract_inverted_index) };
    });
  } catch { return []; }
}

async function authorCrossref(name, limit = 12) {
  try {
    const url = "https://api.crossref.org/works?" + new URLSearchParams({ "query.author": name, rows: String(limit), sort: "is-referenced-by-count", order: "desc", select: "title,author,container-title,published,DOI,is-referenced-by-count,abstract" }) + "&mailto=cerebrum@example.com";
    const data = await getJSON(url);
    return (data?.message?.items || []).map((it) => ({ title: Array.isArray(it.title) ? it.title[0] : it.title || "Untitled", url: it.DOI ? `https://doi.org/${it.DOI}` : "", year: it.published?.["date-parts"]?.[0]?.[0] || "", citations: it["is-referenced-by-count"] ?? null, authors: (it.author || []).slice(0, 1).map((a) => `${a.given || ""} ${a.family || ""}`.trim()).join("") + ((it.author || []).length > 1 ? " et al." : ""), journal: Array.isArray(it["container-title"]) ? it["container-title"][0] : it["container-title"] || "Crossref", abstract: stripTags(it.abstract || "") })).filter((p) => p.title);
  } catch { return []; }
}

async function authorSemanticScholar(name, limit = 20) {
  try {
    const searchUrl = "https://api.semanticscholar.org/graph/v1/author/search?" + new URLSearchParams({ query: name, fields: "name,paperCount,citationCount", limit: "5" });
    const sdata = await getJSON(searchUrl);
    const cands = sdata?.data || [];
    if (!cands.length) return { papers: [], matched: null };

    const wanted = name.toLowerCase().split(/\s+/).filter(Boolean);
    const scoreName = (candName) => {
      const cn = (candName || "").toLowerCase();
      return wanted.filter((w) => cn.includes(w)).length / wanted.length;
    };
    const ranked = cands.map((c) => ({ c, match: scoreName(c.name) })).sort((a, b) => (b.match - a.match) || ((b.c.paperCount || 0) - (a.c.paperCount || 0)));
    const best = ranked[0];
    if (!best || best.match < 0.99) return { papers: [], matched: null };

    const authorId = best.c.authorId;
    if (!authorId) return { papers: [], matched: null };
    const papersUrl = `https://api.semanticscholar.org/graph/v1/author/${authorId}/papers?` + new URLSearchParams({ fields: "title,abstract,year,citationCount,authors,venue,externalIds", limit: String(limit) });
    const pdata = await getJSON(papersUrl);
    const papers = (pdata?.data || []).map((r) => {
      const doi = r.externalIds?.DOI;
      const names = (r.authors || []).map((a) => a.name);
      return { title: r.title || "Untitled", url: doi ? `https://doi.org/${doi}` : (r.externalIds?.ArXiv ? `https://arxiv.org/abs/${r.externalIds.ArXiv}` : ""), year: r.year || "", citations: r.citationCount ?? null, authors: names.length > 1 ? `${names[0]} et al.` : names[0] || "", journal: r.venue || "Semantic Scholar", abstract: r.abstract || "" };
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
  return { papers, confirmed: !!ssRes.matched, matchedName: ssRes.matched };
}

// ---------- Gather & Rank Papers ----------
async function gatherPapers(rawQuery, { openAlexKey, coreKey, ncbiKey = "", limit = 6, browse = false }) {
  const query = cleanQuery(rawQuery);
  const jobs = [
    europePMC(query, 12), pubmed(query, 12, ncbiKey), traceUTK(query), openAlex(query, 12, openAlexKey),
    crossref(query, 10), arxiv(query, 8), semanticScholar(query, 10), doaj(query, 8), biorxiv(query, 10),
    zenodo(query, 6), datacite(query, 6), openaire(query, 6), hal(query, 6), plos(query, 6), base(query, 6),
    core(query, 8, coreKey),
  ];
  const results = await Promise.all(jobs);

  const merged = [];
  const seen = new Set();
  for (const list of results) {
    for (const p of list) {
      const key = (p.title || "").toLowerCase().trim();
      if (key && !seen.has(key)) { seen.add(key); merged.push(p); }
    }
  }

  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const expansions = expansionsFor(terms);
  const neutralWords = new Set(terms.filter((t) => SYNONYMS[t.toLowerCase()]));
  for (const phrase of expansions) {
    for (const w of phrase.toLowerCase().split(/\s+/)) { if (w.length > 2) neutralWords.add(w); }
  }
  ["black", "soldier", "larvae", "larva", "fly", "hermetia", "illucens"].forEach((w) => {
    if (terms.includes(w)) neutralWords.add(w);
  });
  const neutralTerms = neutralWords;
  const contentTerms = terms.filter((t) => !neutralTerms.has(t));
  const scored = merged.map((p) => {
    const hay = `${p.title || ""} ${p.abstract || ""}`.toLowerCase();
    const titleHay = (p.title || "").toLowerCase();
    const stem = (w) => w.replace(/(ies|es|s|al|ion|ing|ed)$/i, "");
    const has = (t) => hay.includes(t) || hay.includes(stem(t));
    const contentHits = contentTerms.filter(has).length;
    const neutralHit = [...neutralTerms].some(has);
    const titleContentHits = contentTerms.filter((t) => titleHay.includes(t) || titleHay.includes(stem(t))).length;
    let expHit = false;
    for (const phrase of expansions) { if (hay.includes(phrase)) expHit = true; }
    const organismPresent = neutralHit || expHit;
    const contentCoverage = contentTerms.length ? contentHits / contentTerms.length : 1;

    let score = 0;
    score += contentHits * 5;
    score += contentCoverage * 6;
    score += titleContentHits * 3;
    if (organismPresent && contentHits > 0) score += 3;
    if (p.abstract) score += 0.5;
    if (typeof p.citations === "number") score += Math.min(p.citations / 800, 1.0);
    const yr = parseInt(p.year, 10);
    if (yr && yr >= 2015) score += 0.3;

    return { ...p, score, contentHits, contentCoverage, organismPresent };
  }).filter((p) => {
    if (terms.length === 0) return true;
    const queryNamesOrganism = neutralTerms.size > 0;
    if (queryNamesOrganism) {
      return p.organismPresent && (contentTerms.length === 0 || p.contentHits > 0);
    }
    if (contentTerms.length === 0) return true;
    if (contentTerms.length <= 2) return p.contentHits > 0;
    return p.contentHits / contentTerms.length >= 0.4;
  }).sort((a, b) => b.score - a.score).slice(0, limit);

  const maxScore = scored.length ? Math.max(...scored.map((p) => p.score)) : 1;
  for (const p of scored) {
    p.relevance = maxScore > 0 ? Math.round((p.score / maxScore) * 100) : 0;
    const j = (p.journal || "").toLowerCase();
    if (/wikipedia/.test(j)) p.type = "Reference";
    else if (/preprint|biorxiv|medrxiv|arxiv|ssrn|research square/.test(j)) p.type = "Preprint";
    else if (/zenodo|datacite|figshare|dryad/.test(j)) p.type = "Dataset";
    else p.type = "Journal";
  }

  const usedUTK = scored.some((p) => p.journal === "UTK TRACE");
  return { papers: scored, utk: usedUTK };
}

// ---------- Request Handler ----------
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
      return new Response(JSON.stringify({ error: "No query provided." }), { status: 400, headers: cors });
    }

    const small = query.toLowerCase().replace(/[^a-z\s]/g, "").trim();
    const greetings = ["hi", "hello", "hey", "yo", "sup", "howdy", "hiya"];
    if (greetings.includes(small)) {
      return new Response(JSON.stringify({
        answer: "Hi! I'm Cerebrum. Ask me anything — science questions get answers backed by real papers with citations, and I'll do my best with general questions too.",
        sources: [], videos: [], source: "Cerebrum",
      }), { status: 200, headers: cors });
    }

    const authorName = detectAuthor(query);
    if (authorName && body.mode !== "browse") {
      let ar = { papers: [], confirmed: false, matchedName: null };
      try { ar = await gatherByAuthor(authorName, { openAlexKey: env.OPENALEX_KEY || "" }); } catch {}

      if (ar.confirmed && ar.papers.length) {
        return new Response(JSON.stringify({
          answer: `Publications associated with **${ar.matchedName || authorName}**, ranked by citations. These are pulled directly from this author's record. If it's not who you meant, add a field like "${authorName} microbiology".`,
          sources: ar.papers.map(({ title, url, journal, authors, year, citations }) => ({ title, url, journal, authors, year, citations })),
          videos: [], source: `${ar.papers.length} publications by ${ar.matchedName || authorName}`,
        }), { status: 200, headers: cors });
      }

      if (!ar.confirmed) {
        return new Response(JSON.stringify({
          answer: `I couldn't confirm a researcher named **${authorName}** in the author databases (Semantic Scholar, Crossref, OpenAlex). This can happen when someone has few indexed publications, publishes under a different name form, or the name is spelled differently in the record. Try the full name as it appears on their papers, add a middle initial, or search a topic instead and open the papers to find them.`,
          sources: [], videos: [], source: "author not confirmed",
        }), { status: 200, headers: cors });
      }
    }

    if (body.mode === "browse") {
      let bp = [];
      try {
        const g = await gatherPapers(query, { openAlexKey: env.OPENALEX_KEY || "", coreKey: env.CORE_API_KEY || "", ncbiKey: env.NCBI_API_KEY || "", limit: 25, browse: true });
        bp = g.papers;
      } catch { bp = []; }
      return new Response(JSON.stringify({
        answer: "",
        sources: bp.map(({ title, url, journal, authors, year, citations }) => ({ title, url, journal, authors, year, citations })),
        videos: [], source: `${bp.length} publications ranked by relevance`,
      }), { status: 200, headers: cors });
    }

    const settings = body.settings || {};
    const answerLength = settings.answerLength || "medium";
    const maxTokens = answerLength === "short" ? 450 : answerLength === "long" ? 1400 : 900;
    const lengthHint = answerLength === "short" ? "Keep it to one tight paragraph." : answerLength === "long" ? "Give a thorough, well-structured explanation." : "Keep it to a few short paragraphs.";

    let papers = [];
    let videos = [];
    let utk = false;
    try {
      const [g, vList] = await Promise.all([
        gatherPapers(query, { openAlexKey: env.OPENALEX_KEY || "", coreKey: env.CORE_API_KEY || "", ncbiKey: env.NCBI_API_KEY || "", limit: 25 }),
        searchInvidiousVideos(query, 4).catch(() => [])
      ]);
      papers = g.papers;
      utk = g.utk;
      videos = vList;
    } catch {
      papers = [];
      videos = [];
    }

    const hasPapers = papers.length > 0;
    const qToks = cleanQuery(query).toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const qExp = expansionsFor(qToks);
    const qNeutral = new Set(qToks.filter((t) => SYNONYMS[t.toLowerCase()]));
    for (const phrase of qExp) { for (const w of phrase.toLowerCase().split(/\s+/)) { if (w.length > 2) qNeutral.add(w); } }
    ["black", "soldier", "larvae", "larva", "fly", "hermetia", "illucens"].forEach((w) => { if (qToks.includes(w)) qNeutral.add(w); });
    const qContent = qToks.filter((t) => !qNeutral.has(t));
    const stemW = (w) => w.replace(/(ies|es|s|al|ion|ing|ed)$/i, "");
    const queryNamesOrganism = qNeutral.size > 0;
    
    const paperOnTopic = (p) => {
      const hay = `${p.title || ""} ${p.abstract || ""}`.toLowerCase();
      const hitsTopic = qContent.length === 0 || qContent.some((t) => hay.includes(t) || hay.includes(stemW(t)));
      if (!queryNamesOrganism) return hitsTopic;
      const orgHere = [...qNeutral].some((w) => hay.includes(w)) || qExp.some((ph) => hay.includes(ph));
      return orgHere && hitsTopic;
    };
    const papersHitTopic = hasPapers && (qContent.length > 0 || queryNamesOrganism) ? papers.some(paperOnTopic) : hasPapers;
    let useEvidence = hasPapers && papersHitTopic;

    let webRefs = [];
    if (!useEvidence) {
      try {
        const [wiki, ddg] = await Promise.all([
          wikipedia(cleanQuery(query), 2).catch(() => []),
          duckduckgo(query).catch(() => []),
        ]);
        const seen = new Set();
        for (const r of [...wiki, ...ddg]) {
          const k = (r.title || "").toLowerCase();
          if (r.abstract && !seen.has(k)) { seen.add(k); webRefs.push(r); }
        }
      } catch { webRefs = []; }
    }
    const useWeb = !useEvidence && webRefs.length > 0;
    const sourceList = (useEvidence ? papers : useWeb ? webRefs : []).map(({ title, url, journal, authors, year, citations, relevance, type }) => ({ title, url, journal, authors, year, citations, relevance: relevance ?? null, type: type || "Reference" }));

    if (useEvidence) {
      const toEnrich = papers.filter((p) => p.pmcid).slice(0, 3);
      await Promise.all(toEnrich.map(async (p) => {
        const ft = await biocFullText(p.pmcid);
        if (ft && ft.length > (p.abstract || "").length) p.fullText = ft.slice(0, 6000);
      }));
    }

    const evidence = useEvidence
      ? papers.map((p, i) => `[${i + 1}] ${p.title} (${p.authors || "n/a"}, ${p.journal}, ${p.year || "n/a"}${typeof p.citations === "number" ? `, cited ${p.citations}x` : ""})\n${p.fullText ? "Full text: " + p.fullText : "Abstract: " + (p.abstract || "(no abstract available for this record)")}`).join("\n\n")
      : useWeb
      ? webRefs.map((r, i) => `[${i + 1}] ${r.title} (${r.journal})\n${r.abstract}`).join("\n\n")
      : "";

    const systemPrompt = (useEvidence
      ? "You are Cerebrum, a knowledgeable science assistant. You are given real papers as evidence. Answer using them, citing inline like [1] or [2] by paper number. You may add general-knowledge context but prefer the papers for specific claims. Interpret typos. "
      : useWeb
      ? "You are Cerebrum, a knowledgeable science assistant. No peer-reviewed papers matched, but here are reference sources (encyclopedic/web). Answer using them, citing inline like [1] or [2] by source number. Begin your answer with this exact sentence on its own line: \"Note: no peer-reviewed papers matched this query — this answer draws on reference sources, verify against primary literature.\" Then answer fully. Do NOT fabricate journal citations or DOIs. Interpret typos. "
      : "You are Cerebrum, a knowledgeable science assistant. No directly relevant papers were retrieved for this question, so answer accurately and thoroughly from your own scientific knowledge. Give the real, substantive answer — do NOT say that papers are missing or that you cannot answer. Do NOT fabricate specific citations, DOIs, or author names. You may mention that the field exists and name well-known findings generally. Begin your answer with this exact sentence on its own line: \"Note: this answer is from general scientific knowledge, not from retrieved papers — verify against primary sources.\" Then answer the question fully. Interpret typos. ") +
      lengthHint +
      " Format in clean prose. CRITICAL RULE: Provide ONLY the final answer. Do NOT narrate your thought process, do NOT use <think> tags, and do NOT use phrases like 'Now I will' or 'I need to'. Do NOT use markdown heading symbols like # or ###. You may use **bold** sparingly and blank lines between paragraphs, nothing else.";

    const messages = [{ role: "system", content: systemPrompt }];
    const historyTurns = Array.isArray(body.history) ? body.history.slice(-4) : [];
    for (const turn of historyTurns) {
      if (turn.role === "user" || turn.role === "assistant") {
        messages.push({ role: turn.role, content: String(turn.content || "").slice(0, 2000) });
      }
    }
    messages.push({ role: "user", content: (useEvidence || useWeb) ? `Sources:\n\n${evidence}\n\n---\nQuestion: ${query}` : query });

    let answer = "";
    let aiOK = false;

    const token = env.OPENROUTER_API_KEY;
    if (token) {
      const models = [
        "openrouter/free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "google/gemini-2.0-flash-exp:free",
        "qwen/qwen-2.5-72b-instruct:free",
        "mistralai/mistral-small-3.1-24b-instruct:free",
        "deepseek/deepseek-chat:free",
        "meta-llama/llama-3.1-8b-instruct:free",
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
            body: JSON.stringify({ model, temperature: 0.3, max_tokens: maxTokens, messages }),
          });
          if (r.ok) {
            const j = await r.json();
            let c = j?.choices?.[0]?.message?.content?.trim();
            if (c) { 
              c = c.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
              c = c.replace(/^(Okay, let me think|Now we need to|I will now|Here is the answer|First, I'll).*?[\r\n]+/i, '').trim();

              if (c) { answer = c; aiOK = true; break; }
            }
          }
        } catch {}
      }
    }

    if (!aiOK && env.AI && typeof env.AI.run === "function") {
      const cfModels = ["@cf/meta/llama-3.1-8b-instruct", "@cf/meta/llama-3-8b-instruct", "@cf/mistral/mistral-7b-instruct-v0.1"];
      for (const m of cfModels) {
        try {
          const out = await env.AI.run(m, { messages, max_tokens: Math.min(maxTokens, 1024) });
          const c = (out?.response || "").trim();
          if (c) { answer = c; aiOK = true; break; }
        } catch {}
      }
    }

    if (!aiOK) {
      if (useEvidence) {
        answer = "Here are the most relevant papers I found (the answer writer is busy right now):\n\n" +
          papers.map((p, i) => `[${i + 1}] ${p.title}\n${p.journal}${p.year ? `, ${p.year}` : ""}. ${(p.abstract || "").slice(0, 280)}${p.abstract ? "..." : ""}`).join("\n\n");
      } else {
        answer = "The answer service is temporarily unavailable. Please try again in a moment.";
      }
    }

    async function runFactCheck() {
      if (!(settings.factCheck && aiOK && useEvidence && token)) return null;
      const fcSystem = "You are a strict scientific fact-checker. You are given an ANSWER and the SOURCE ABSTRACTS it cites. Your only job is to judge whether each factual claim in the answer is actually supported by the provided abstracts. You do NOT judge whether claims are true in the real world, only whether these sources back them up. Return ONLY valid JSON, no prose, no markdown, in this exact shape: {\"overall\":\"supported\"|\"partly\"|\"unsupported\",\"summary\":\"one plain sentence\",\"claims\":[{\"claim\":\"short quote or paraphrase\",\"status\":\"supported\"|\"thin\"|\"unsupported\",\"note\":\"why, one short sentence\"}]}. Mark 'thin' when a source loosely relates but doesn't directly state the claim. Mark 'unsupported' when no provided abstract backs it. Be skeptical; flag confident claims that the abstracts don't actually establish.";
      const fcUser = `ANSWER:\n${answer}\n\nSOURCE ABSTRACTS:\n${evidence}`;
      const fcModels = ["google/gemini-2.0-flash-exp:free", "meta-llama/llama-3.3-70b-instruct:free", "openrouter/free"];
      for (const model of fcModels) {
        try {
          const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "HTTP-Referer": "https://cerebrum.pages.dev", "X-Title": "Cerebrum" },
            body: JSON.stringify({ model, temperature: 0, max_tokens: 700, messages: [{ role: "system", content: fcSystem }, { role: "user", content: fcUser }] }),
          });
          if (r.ok) {
            const j = await r.json();
            let c = j?.choices?.[0]?.message?.content?.trim() || "";
            c = c.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
            try { const parsed = JSON.parse(c); if (parsed && parsed.overall) return parsed; } catch {}
          }
        } catch {}
      }
      return null;
    }

    async function runRelated() {
      if (!(aiOK && token)) return [];
      try {
        const rq = await fetch("[https://openrouter.ai/api/v1/chat/completions](https://openrouter.ai/api/v1/chat/completions)", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "HTTP-Referer": "[https://cerebrum.pages.dev](https://cerebrum.pages.dev)", "X-Title": "Cerebrum" },
          body: JSON.stringify({
            model: "google/gemini-2.0-flash-exp:free",
            temperature: 0.5,
            max_tokens: 160,
            messages: [
              { role: "system", content: "Given a science question and its answer, propose exactly 3 natural follow-up questions a curious researcher would ask next. Return ONLY a JSON array of 3 short strings, no prose, no markdown. Example: [\"...\",\"...\",\"...\"]" },
              { role: "user", content: `Question: ${query}\n\nAnswer: ${answer.slice(0, 1200)}` },
            ],
          }),
        });
        if (rq.ok) {
          const j = await rq.json();
          let c = j?.choices?.[0]?.message?.content?.trim() || "";
          c = c.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
          const arr = JSON.parse(c);
          if (Array.isArray(arr)) return arr.filter((x) => typeof x === "string").slice(0, 3);
        }
      } catch {}
      return [];
    }

    const [factCheck, related] = await Promise.all([runFactCheck(), runRelated()]);

    const dbUsed = utk ? "Databases + UTK TRACE" : useEvidence ? "Scientific databases" : useWeb ? "Reference sources (Wikipedia/web)" : "General knowledge";
    return new Response(JSON.stringify({
      answer,
      sources: sourceList,
      videos,
      factCheck,
      related,
      source: aiOK && useEvidence ? `${dbUsed} + OpenRouter` : aiOK && useWeb ? `${dbUsed} + AI` : aiOK ? "General knowledge (AI)" : dbUsed,
    }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `Runtime error: ${e.message}` }),
      { status: 500, headers: cors }
    );
  }
}
