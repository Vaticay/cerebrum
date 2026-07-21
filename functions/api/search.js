// Cerebrum backend — Cloudflare Pages Function.
// Gathers real papers from scholarly databases, then generates a grounded answer
// using OpenRouter, Cloudflare Workers AI (keyless), or Pollinations AI (keyless).

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
    return (data?.data || []).filter((r) => r.title).map((r) => ({ title: r.title || "Untitled", url: r.externalIds?.DOI ? `https://doi.org/${r.externalIds.DOI}` : r.openAccessPdf?.url || r.url || "", year: r.year || "", citations: r.citationCount ?? null, authors: (r.authors || []).slice(0, 1).map((a) => a.name).join("") + ((r.authors || []).length > 1 ? " et al." : ""), journal: r.venue || "Semantic Scholar", abstract: r.abstract }));
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

export default function App() {
  const isMobile = useIsMobile();
  const [entered, setEntered] = useState(false);
  const [currentView, setCurrentView] = useState("app");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [allSources, setAllSources] = useState([]);
  const [saved, setSaved] = useState(() => { try { return JSON.parse(localStorage.getItem("cb_saved") || "[]"); } catch { return []; } });
  const [savedOpen, setSavedOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [suggestions, setSuggestions] = useState(pick());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState("");
  const [zoteroOpen, setZoteroOpen] = useState(false);
  const [panelTab, setPanelTab] = useState("sources");
  const [srcSort, setSrcSort] = useState("relevance");
  const [srcFilter, setSrcFilter] = useState("");
  const [zKey, setZKey] = useState(""); const [zUser, setZUser] = useState(""); const [zMsg, setZMsg] = useState("");
  const [answerLength, setAnswerLength] = useState(() => getCookie("cb_len") || "medium");
  const [factCheck, setFactCheck] = useState(() => getCookie("cb_fc") === "1");
  const [muted, setMuted] = useState(() => getCookie("cb_muted") === "1");
  const [soundMode, setSoundMode] = useState(() => getCookie("cb_snd") || "pulse");
  const [typewriter, setTypewriter] = useState(() => getCookie("cb_tw") !== "0");
  const [paletteName, setPaletteName] = useState(() => getCookie("cb_pal") || "Light");
  const [accentName, setAccentName] = useState(() => getCookie("cb_accent") || "Emerald");
  const [customAccent, setCustomAccent] = useState(() => getCookie("cb_ca") || "");
  const [hover, setHover] = useState("");
  const [hoverCite, setHoverCite] = useState(0);
  const inputRef = useRef(null);
  const cmdRef = useRef(null);
  const threadRef = useRef(null);
  const mutedRef = useRef(false);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const P = PALETTES[paletteName] || PALETTES.Light;
  const accent = customAccent && /^#[0-9a-fA-F]{6}$/.test(customAccent) ? customAccent : (ACCENTS[accentName] || ACCENTS.Emerald);
  const at = accentText(accent);
  const S = makeStyles(P, accent, at, isMobile);
  const sfx = () => { if (!mutedRef.current) Audio.click(); };

  const ask = useCallback(async (q) => {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    if (!mutedRef.current) Audio.click();
    setInput(""); setBusy(true); setError(""); setCmdOpen(false); if (isMobile) setMobilePanel(false);
    const prior = [];
    turns.forEach((t) => { prior.push({ role: "user", content: t.q }); prior.push({ role: "assistant", content: t.answer }); });
    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: question, history: prior, settings: { answerLength, factCheck } }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Search failed."); setBusy(false); return; }

      let rawAnswer = data.answer || "";
      rawAnswer = rawAnswer.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      rawAnswer = rawAnswer.replace(/^.*?(Here is the answer|Protons are|Note:).*?[\r\n]+/i, (match) => match.includes("Note:") ? match : "").trim();

      // Fetch Highly Relevant Related Videos
      const videos = await fetchVideosMultiSource(question);

      const nt = { 
        q: question, 
        answer: rawAnswer, 
        sources: data.sources || [], 
        videos, 
        source: data.source || "", 
        factCheck: data.factCheck || null, 
        related: data.related || [], 
        fresh: typewriter 
      };
      setTurns((t) => [...t, nt]);
      setAllSources((prev) => { const seen = new Set(prev.map((s) => (s.title || "").toLowerCase())); return [...prev, ...(data.sources || []).filter((s) => !seen.has((s.title || "").toLowerCase()))]; });
      if (!mutedRef.current) Audio.pop();
    } catch (e) { setError(`Could not reach the backend. (${e.message})`); }
    finally { setBusy(false); }
  }, [input, busy, turns, answerLength, factCheck, typewriter, isMobile]);

  useEffect(() => { if (entered && !isMobile && !cmdOpen) inputRef.current?.focus(); }, [entered, isMobile, cmdOpen]);
  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [turns, busy]);
  useEffect(() => { if (busy && !muted) Audio.startAmbient(soundMode); else Audio.stopAmbient(); return () => Audio.stopAmbient(); }, [busy, muted, soundMode]);
  useEffect(() => { document.body.style.background = P.bg; }, [P]);

  if (!entered) return <Intro accent={accent} P={P} onEnter={() => { sfx(); setEntered(true); }} />;
  if (currentView === "faq") return <FAQView P={P} accent={accent} at={at} onBack={() => setCurrentView("app")} />;

  const started = turns.length > 0 || busy;
  const exportList = saved.length ? saved : allSources;
  const currentVideos = turns.length > 0 ? (turns[turns.length - 1].videos || []) : [];

  const filteredSources = allSources.filter((s) => {
    if (!srcFilter.trim()) return true;
    const f = srcFilter.toLowerCase();
    return (s.title || "").toLowerCase().includes(f) || (s.authors || "").toLowerCase().includes(f) || (s.journal || "").toLowerCase().includes(f);
  });
  const sortedSources = [...filteredSources].sort((a, b) => {
    if (srcSort === "date") return (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0);
    if (srcSort === "database") return (a.journal || "").localeCompare(b.journal || "");
    return (b.relevance ?? 0) - (a.relevance ?? 0);
  });

  const SourceCard = (s, i) => (
    <div key={i} style={{ ...S.srcItem, background: hoverCite === i + 1 ? withAlpha(accent, 0.07) : "transparent" }} onMouseEnter={() => setHover("src" + i)} onMouseLeave={() => setHover("")}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, flexWrap: "wrap" }}>
        {s.type && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: typeColor(s.type), background: withAlpha(typeColor(s.type), 0.12), padding: "2px 6px", borderRadius: 5 }}>{s.type}</span>}
        {typeof s.relevance === "number" && <span style={{ fontSize: 9.5, fontWeight: 700, color: relColor(s.relevance), background: withAlpha(relColor(s.relevance), 0.12), padding: "2px 6px", borderRadius: 5 }}>{s.relevance}% match</span>}
        {s.year && <span style={{ fontSize: 10, color: P.faint }}>{s.year}</span>}
      </div>
      <a href={s.url} target="_blank" rel="noreferrer" style={{ ...S.srcTitle, color: hover === "src" + i ? accent : P.ink }}>{s.title || s.url}</a>
      <div style={S.srcMeta}>{[s.authors, s.journal].filter(Boolean).join(" · ")}</div>
      <div style={S.srcRow}>
        <button style={{ ...S.chipMini, color: isSaved(s) ? at : P.ink2, background: isSaved(s) ? accent : "transparent", borderColor: isSaved(s) ? accent : P.line2 }} onClick={() => toggleSave(s)}>{isSaved(s) ? "★ Saved" : "☆ Save"}</button>
      </div>
    </div>
  );

  const SourcesInner = (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button style={{ ...S.sortTab, ...(panelTab === "sources" ? S.sortTabActive : {}) }} onClick={() => setPanelTab("sources")}>
          Sources ({allSources.length})
        </button>
        <button style={{ ...S.sortTab, ...(panelTab === "videos" ? S.sortTabActive : {}) }} onClick={() => setPanelTab("videos")}>
          Videos ({currentVideos.length})
        </button>
      </div>

      {panelTab === "sources" ? (
        <>
          <input style={S.srcFilterInput} placeholder="Filter sources…" value={srcFilter} onChange={(e) => setSrcFilter(e.target.value)} />
          <div style={S.srcList}>
            {allSources.length === 0 ? <div style={S.empty}>Sources will collect here as you research.</div> :
              sortedSources.map((s) => SourceCard(s, allSources.indexOf(s)))}
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {currentVideos.length === 0 ? (
            <div style={S.empty}>No related educational videos found for this query.</div>
          ) : (
            currentVideos.map((vid, i) => (
              <a key={i} href={vid.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", background: P.raised, borderRadius: 12, overflow: "hidden", border: `1px solid ${P.line2}`, boxShadow: S.shadowSm || "none", transition: "transform 0.15s, border-color 0.15s" }}>
                <div style={{ position: "relative", width: "100%", height: 130, background: "#000" }}>
                  <img src={vid.thumbnail} alt={vid.title} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.9 }} onError={(e) => e.target.style.display = 'none'} />
                  <div style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.75)", color: "#fff", fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.04em" }}>
                    LECTURE
                  </div>
                </div>
                <div style={{ padding: "12px 14px" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 650, color: P.ink, lineHeight: 1.35, marginBottom: 6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{vid.title}</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, color: accent, fontWeight: 600 }}>{vid.author}</span>
                    <span style={{ fontSize: 10, color: P.faint }}>Watch →</span>
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      )}
    </>
  );

  return (
    <div style={S.page}>
      <div style={S.grain} />
      <header style={S.header}>
        <div style={S.headInner}>
          <div style={S.brandRow} onClick={() => { sfx(); newSession(); }}><Mark size={22} accent={accent} glow={P.dark} /><span style={S.brand}>Cerebrum</span></div>
          <div style={S.headActions}>
            <button style={S.ghostBtn} onClick={() => { sfx(); newSession(); }}>New</button>
            <button style={S.ghostBtn} onClick={() => { sfx(); setCurrentView("faq"); }}>FAQ</button>
            <button style={S.iconBtn} onClick={() => setMuted(!muted)}>{muted ? "🔇" : "🔊"}</button>
            <button style={S.ghostBtn} onClick={() => { sfx(); setSettingsOpen(true); }}>Settings</button>
          </div>
        </div>
      </header>

      <div style={S.scroll} ref={threadRef}>
        <div style={S.container}>
          {!started ? (
            <div style={S.hero} className="cb-hero">
              <div style={S.heroGlow} />
              <div style={S.heroMark}><Mark size={44} accent={accent} glow={P.dark} /></div>
              <h1 style={S.heroTitle}>Cerebrum</h1>
              <p style={S.heroSub}>Your research sidekick.</p>
              <div style={{ ...S.searchShell, ...(hover === "in" ? S.searchShellActive : {}) }} onMouseEnter={() => setHover("in")} onMouseLeave={() => setHover("")}>
                <input ref={inputRef} style={S.searchInput} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder="Ask a research question..." />
                <button style={S.searchBtn} onClick={() => ask()}>Inquire</button>
              </div>
              <div style={S.chips}>
                {suggestions.map((s, i) => (<button key={s} className="cb-fade" style={S.chip} onClick={() => ask(s)}>{s}</button>))}
              </div>
            </div>
          ) : (
            <div style={S.workspace}>
              <div style={S.thread}>
                {turns.map((t, ti) => (
                  <Turn key={ti} t={t} P={P} accent={accent} at={at} S={S} typewriter={typewriter && ti === turns.length - 1} hoverCite={hoverCite} setHoverCite={setHoverCite} onRelated={(q) => ask(q)} />
                ))}
                {busy && (
                  <div style={S.turn}>
                    <div style={S.qLabel}><span style={S.qDot} />Searching</div>
                    <Skeleton P={P} />
                    <LoadingLine P={P} />
                  </div>
                )}
              </div>
              <aside style={S.panel}>{SourcesInner}</aside>
            </div>
          )}
        </div>
      </div>
      {settingsOpen && <Settings {...{ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, sfx, setSaved, close: () => setSettingsOpen(false) }} />}
    </div>
  );
}

function Turn({ t, P, accent, at, S, typewriter, hoverCite, setHoverCite, onRelated }) {
  const shown = useTypewriter(t.answer, typewriter && t.fresh);
  const done = shown === t.answer;
  return (
    <div style={S.turn} className="cb-rise">
      <div style={S.qLabel}><span style={S.qDot} />Inquiry</div>
      <h2 style={S.headline}>{t.q}</h2>
      <div style={S.answerCard}>
        {renderAnswer(shown, t.sources, P, accent, hoverCite, setHoverCite)}
      </div>
      {done && t.related && t.related.length > 0 && (
        <div style={S.relatedWrap} className="cb-fade">
          <div style={S.relatedLabel}>Continue the investigation</div>
          <div style={S.relatedList}>
            {t.related.map((r, i) => (
              <button key={i} style={S.relatedBtn} onClick={() => onRelated(r)}>
                <span>{r}</span><span style={{ color: accent }}>→</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Settings({ P, accent, at, S, PALETTES, ACCENTS, paletteName, setPaletteName, accentName, setAccentName, customAccent, setCustomAccent, answerLength, setAnswerLength, factCheck, setFactCheck, muted, setMuted, typewriter, setTypewriter, soundMode, setSoundMode, sfx, setSaved, close }) {
  return (
    <div style={S.modalWrap} onClick={close} className="cb-fade">
      <div style={S.modal} onClick={(e) => e.stopPropagation()} className="cb-pop">
        <div style={S.modalTitle}>Settings</div>
        <div style={S.setLabel}>Appearance</div>
        <div style={S.palRow}>
          {Object.keys(PALETTES).map((pn) => (
            <button key={pn} style={{ ...S.palCard, background: PALETTES[pn].bg, borderColor: paletteName === pn ? accent : PALETTES[pn].line2 }} onClick={() => { sfx(); setPaletteName(pn); }}>
              <span style={{ fontSize: 12, color: PALETTES[pn].ink, fontWeight: 550 }}>{pn}</span>
            </button>
          ))}
        </div>
        <button style={S.modalClose} onClick={close}>Done</button>
      </div>
    </div>
  );
}

function makeStyles(P, accent, at, isMobile = false) {
  const font = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  const pad = isMobile ? 16 : 24;
  return {
    page: { minHeight: "100vh", height: "100vh", background: P.bg, color: P.ink, fontFamily: font, display: "flex", flexDirection: "column", position: "relative" },
    grain: { position: "fixed", inset: 0, pointerEvents: "none", opacity: P.grain, zIndex: 100, backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" },
    header: { flexShrink: 0, borderBottom: `1px solid ${P.line}`, background: withAlpha(P.bg, 0.8), backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 20 },
    headInner: { maxWidth: 1080, margin: "0 auto", padding: `0 ${pad}px`, height: 58, display: "flex", alignItems: "center", justifyContent: "space-between" },
    brandRow: { display: "flex", alignItems: "center", gap: 10, cursor: "pointer" },
    brand: { fontWeight: 700, fontSize: 19, color: P.ink },
    headActions: { display: "flex", alignItems: "center", gap: 6 },
    ghostBtn: { background: "transparent", border: "none", color: P.ink2, padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, fontWeight: 550 },
    iconBtn: { background: "transparent", border: "none", color: P.ink2, width: 36, height: 36, borderRadius: 8, cursor: "pointer", fontSize: 15 },
    scroll: { flex: 1, overflowY: "auto" },
    container: { maxWidth: 1080, margin: "0 auto", padding: `0 ${pad}px`, minHeight: "100%", display: "flex", flexDirection: "column" },
    hero: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "40px 0 60px", position: "relative" },
    heroGlow: { position: "absolute", width: 520, height: 520, borderRadius: "50%", background: `radial-gradient(circle, ${withAlpha(accent, 0.08)}, transparent 65%)`, top: "8%", filter: "blur(40px)", pointerEvents: "none" },
    heroMark: { marginBottom: 26, position: "relative" },
    heroTitle: { fontSize: 68, fontWeight: 750, color: P.ink, marginBottom: 12, lineHeight: 1 },
    heroSub: { fontSize: 17, color: P.ink2, maxWidth: 480, lineHeight: 1.6, marginBottom: 36 },
    searchShell: { display: "flex", alignItems: "center", gap: 10, width: "100%", maxWidth: 580, background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 14, padding: "7px 7px 7px 14px", boxShadow: P.shadow },
    searchShellActive: { borderColor: accent, boxShadow: `${P.shadow}, 0 0 0 3px ${withAlpha(accent, 0.12)}` },
    searchInput: { flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 16, color: P.ink },
    searchBtn: { fontSize: 14, fontWeight: 600, background: accent, color: at, border: "none", padding: "11px 20px", borderRadius: 9, cursor: "pointer", boxShadow: `0 2px 8px ${withAlpha(accent, 0.3)}` },
    chips: { display: "flex", flexWrap: "wrap", gap: 9, justifyContent: "center", marginTop: 22, maxWidth: 600 },
    chip: { fontSize: 13.5, color: P.ink2, background: P.surface, border: `1px solid ${P.line}`, borderRadius: 20, padding: "9px 15px", cursor: "pointer" },
    workspace: { display: "grid", gridTemplateColumns: "1fr 320px", gap: 40, alignItems: "start", padding: "36px 0 20px", flex: 1 },
    thread: { minWidth: 0 },
    turn: { marginBottom: 40 },
    qLabel: { fontSize: 12, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: accent, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 },
    qDot: { width: 6, height: 6, borderRadius: "50%", background: accent },
    headline: { fontWeight: 700, fontSize: 27, lineHeight: 1.2, marginBottom: 18, color: P.ink },
    answerCard: { background: P.surface, border: `1px solid ${P.line}`, borderRadius: 16, padding: "22px 26px", boxShadow: P.shadow },
    relatedWrap: { marginTop: 18 },
    relatedLabel: { fontSize: 11.5, fontWeight: 650, letterSpacing: "0.06em", textTransform: "uppercase", color: P.faint, marginBottom: 10 },
    relatedList: { display: "flex", flexDirection: "column", gap: 8 },
    relatedBtn: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, textAlign: "left", padding: "12px 16px", fontSize: 14, background: P.surface, color: P.ink2, border: `1px solid ${P.line2}`, borderRadius: 11, cursor: "pointer", boxShadow: P.shadowSm },
    panel: { position: "sticky", top: 24, background: P.surface, border: `1px solid ${P.line}`, borderRadius: 16, padding: "18px", boxShadow: P.shadow, maxHeight: "calc(100vh - 130px)", overflowY: "auto" },
    sortTab: { flex: 1, padding: "6px", fontSize: 11.5, background: "transparent", color: P.ink2, border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 550 },
    sortTabActive: { background: P.surface, color: P.ink, boxShadow: P.shadowSm, fontWeight: 600 },
    srcFilterInput: { width: "100%", padding: "8px 11px", fontSize: 12.5, border: `1px solid ${P.line2}`, background: P.bg, color: P.ink, borderRadius: 8, outline: "none", marginBottom: 12 },
    srcList: { display: "flex", flexDirection: "column", gap: 4 },
    empty: { fontSize: 13, color: P.faint, padding: "12px 0", textAlign: "center" },
    srcItem: { padding: "13px 12px", borderRadius: 12, borderBottom: `1px solid ${P.line}` },
    srcTitle: { fontSize: 13.5, textDecoration: "none", fontWeight: 550, display: "block", marginBottom: 5 },
    srcMeta: { fontSize: 12, color: P.ink2 },
    srcRow: { display: "flex", gap: 7, marginTop: 9 },
    chipMini: { fontSize: 11.5, padding: "5px 10px", border: "1px solid", borderRadius: 7, cursor: "pointer", background: "transparent" },
    foot: { marginTop: "auto", padding: "20px 0 26px", textAlign: "center" },
    modalWrap: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 40, padding: 16 },
    modal: { background: P.surface, border: `1px solid ${P.line2}`, borderRadius: 20, padding: 28, width: 440, maxWidth: "100%" },
    modalTitle: { fontSize: 21, fontWeight: 700, color: P.ink, marginBottom: 22 },
    setLabel: { fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.08em", color: P.faint, marginBottom: 10, fontWeight: 650 },
    palRow: { display: "flex", gap: 10, marginBottom: 22 },
    palCard: { flex: 1, padding: "12px", borderRadius: 12, cursor: "pointer", border: "1px solid" },
    modalClose: { width: "100%", padding: "13px", fontSize: 14.5, fontWeight: 600, background: accent, color: at, border: "none", borderRadius: 11, cursor: "pointer" }
  };
}

createRoot(document.getElementById("root")).render(<App />);
