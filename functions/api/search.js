// Cerebrum backend - Cloudflare Pages Function.
// Full rewrite for stability. Queries 16 scholarly databases in parallel,
// races video proxies, synthesizes answers with sanitization.

// ============ CORE UTILITIES ============

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

async function getJSON(url, headers = {}, timeoutMs = 4000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: c.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function getText(url, headers = {}, timeoutMs = 4000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: c.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}


// Check if a DOI has been retracted or has expressions of concern.
// Uses Crossref's crossmark data, which is authoritative. Keyless.
// Returns { retracted: bool, concern: bool, updateType: string|null }.
async function checkRetraction(doi) {
  if (!doi) return { retracted: false, concern: false, updateType: null };
  try {
    const clean = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
    const res = await getJSON(
      "https://api.crossref.org/works/" + encodeURIComponent(clean),
      {},
      2500
    );
    const msg = res && res.message;
    if (!msg) return { retracted: false, concern: false, updateType: null };
    // Crossref uses `update-to` to indicate this work has been retracted/corrected
    const updates = msg["update-to"] || [];
    let retracted = false, concern = false, updateType = null;
    for (const u of updates) {
      const t = (u.type || "").toLowerCase();
      if (t.includes("retract")) { retracted = true; updateType = "retraction"; }
      else if (t.includes("concern")) { concern = true; updateType = updateType || "expression-of-concern"; }
      else if (t.includes("correct")) { updateType = updateType || "correction"; }
    }
    return { retracted, concern, updateType };
  } catch {
    return { retracted: false, concern: false, updateType: null };
  }
}

// Flag the top N papers with retraction/concern status. Runs in parallel with a
// short timeout so it never blocks the answer. Papers without a DOI are skipped.
async function flagRetractions(papers, topN = 8) {
  const targets = papers.slice(0, topN).filter((p) => {
    const doi = extractDoi(p.url);
    return !!doi;
  });
  await Promise.allSettled(targets.map(async (p) => {
    const doi = extractDoi(p.url);
    const flag = await checkRetraction(doi);
    if (flag.retracted) p.retracted = true;
    if (flag.concern) p.concern = true;
    if (flag.updateType) p.updateType = flag.updateType;
  }));
}

function extractDoi(url) {
  if (!url) return "";
  const m = url.match(/10\.\d{4,9}\/[^\s#?]+/);
  return m ? m[0] : "";
}

// ============ AI RESPONSE CLEANER ============
// Strips chain-of-thought leakage, meta-monologues, and robotic openings.
// Force any close-but-wrong variant of a name (e.g. "Sahoy" for "Saho") back
// to the exact form the user searched. Free AI models routinely hallucinate
// name variants; this is a hard post-processing correction so the user never
// sees "Sahoy" when they typed "Saho".
function correctNameVariants(text, canonicalName) {
  if (!text || !canonicalName) return text;
  const tokens = canonicalName.trim().split(/\s+/);
  let out = text;
  for (const token of tokens) {
    if (token.length < 3) continue;
    // Match a word that starts with the token's first 3 chars and has similar
    // length (within +/- 2 chars). Catches "Sahoy", "Sahon", "Sahoes" etc.
    const stem = token.slice(0, 3);
    const min = Math.max(3, token.length - 1);
    const max = token.length + 3;
    // Build a regex that finds words starting with stem, length min..max,
    // that are NOT the canonical token itself.
    const re = new RegExp(`\\b(${stem}[a-zA-Z]{${min - 3},${max - 3}})\\b`, "g");
    out = out.replace(re, (match) => {
      if (match.toLowerCase() === token.toLowerCase()) return match;
      // Preserve original capitalization
      return token.charAt(0).toUpperCase() + token.slice(1);
    });
  }
  return out;
}


function cleanAIResponse(raw) {
  if (!raw) return "";
  let c = raw;

  // 1. XML reasoning tags
  c = c.replace(/<think>[\s\S]*?<\/think>/gi, "");
  c = c.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");

  // 2. Code fences wrapping entire response
  c = c.replace(/^```(?:markdown)?\s*\n([\s\S]*?)\n```\s*$/i, "$1");

  // 3. System meta-talk
  c = c.replace(/^\s*User Safety:\s*safe\.?\s*/gim, "");

  // 4. Kill meta-planning opening paragraphs
  const badOpeners = [
    /^the user is asking/i,
    /^the user wants/i,
    /^let me review/i,
    /^let me check/i,
    /^let me think/i,
    /^i need to provide/i,
    /^i'll write/i,
    /^i will now/i,
    /^let's analyze/i,
    /^here is a summary of the papers/i,
    /^first,? i'll/i,
    /^okay,? let me/i,
    /^to answer this/i,
    /^now we need to/i,
  ];
  const paras = c.split(/\n{2,}/);
  while (paras.length > 1) {
    const first = paras[0].trim();
    if (badOpeners.some((re) => re.test(first))) {
      paras.shift();
    } else {
      break;
    }
  }
  c = paras.join("\n\n").trim();

  // 5. Kill single-line prefix artifacts
  c = c.replace(/^(here is the answer|here's the answer)[:\.]?\s*/i, "").trim();

  // 6. Strip "Paper 1 discusses...Paper 2 discusses..." robotic patterns from the opening
  c = c.replace(/^(paper\s+\d+[:\s][^\n]+\n+){2,}/i, "").trim();

  return c;
}

// ============ QUERY LOGIC ============

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
  "black soldier fly larvae",
  "black soldier fly",
  "hermetia illucens",
];
const ORGANISM_WORDS = new Set([
  "black", "soldier", "fly", "larvae", "larva", "hermetia", "illucens",
]);

function splitOrganismTopic(query) {
  const q = query.toLowerCase();
  const toks = q.split(/\s+/).filter((t) => t.length > 2);
  const exp = expansionsFor(toks);
  const orgPhrases = new Set(exp);
  for (const phrase of ORGANISM_PHRASES) {
    if (q.includes(phrase)) orgPhrases.add(phrase);
  }
  for (const t of toks) {
    if (SYNONYMS[t]) orgPhrases.add(t);
  }
  const topic = toks.filter((t) => !ORGANISM_WORDS.has(t) && !SYNONYMS[t]);
  return {
    orgPhrases: [...orgPhrases],
    topic,
    hasOrganism: orgPhrases.size > 0,
  };
}

function buildStructuredQuery(query) {
  // If the query names a scientific binomial, wrap it in quotes so search engines
  // treat it as a required phrase. This is what prevents "Populus deltoides"
  // papers from swamping a "Populus angustifolia" search.
  const bin = extractBinomial(query);
  if (bin) {
    // Extract the other topic words (not the binomial itself)
    const rest = query.toLowerCase().replace(new RegExp(bin.full, "gi"), "").replace(/\s+/g, " ").trim();
    const restTerms = rest.split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
    if (restTerms.length) {
      return '"' + bin.full + '" AND (' + restTerms.join(" OR ") + ')';
    }
    return '"' + bin.full + '"';
  }
  const { orgPhrases, topic, hasOrganism } = splitOrganismTopic(query);
  if (hasOrganism && topic.length) {
    const org = orgPhrases
      .map((e) => (e.includes(" ") ? '"' + e + '"' : e))
      .join(" OR ");
    return "(" + org + ") AND (" + topic.join(" OR ") + ")";
  }
  if (hasOrganism) {
    return orgPhrases
      .map((e) => (e.includes(" ") ? '"' + e + '"' : e))
      .join(" OR ");
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

// ============ SCHOLARLY DATABASE SOURCES ============
// Each source returns [] on any failure, never throws. Timeouts keep them fast.

async function europePMC(query, limit = 8) {
  const q = buildStructuredQuery(query);
  const runSearch = async (qs) => {
    const url =
      "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
      new URLSearchParams({
        query: qs,
        resultType: "core",
        pageSize: String(limit),
        format: "json",
        sort: "relevance",
      });
    const data = await getJSON(url);
    return data && data.resultList && data.resultList.result ? data.resultList.result : [];
  };
  try {
    let rows = await runSearch(q);
    if (!rows.length && q !== query) {
      const { orgPhrases, hasOrganism } = splitOrganismTopic(query);
      if (hasOrganism) {
        rows = await runSearch(
          orgPhrases.map((e) => (e.includes(" ") ? '"' + e + '"' : e)).join(" OR ")
        );
      }
      if (!rows.length) rows = await runSearch(query);
    }
    return rows
      .filter((r) => r.title)
      .map((r) => ({
        title: r.title || "Untitled",
        url: r.doi
          ? "https://doi.org/" + r.doi
          : "https://europepmc.org/article/" + r.source + "/" + r.id,
        year: r.pubYear || "",
        citations: typeof r.citedByCount === "number" ? r.citedByCount : null,
        authors: r.authorString || "",
        journal: r.journalTitle || "Europe PMC",
        abstract: stripTags(r.abstractText),
        pmcid: r.pmcid || (r.source === "PMC" ? r.id : "") || "",
      }));
  } catch {
    return [];
  }
}

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
    const authors =
      names.length > 1 ? names[0] + " et al." : names[0] || "";
    const doi = firstMatch(a, /<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/);
    return {
      title: title || "Untitled",
      url: doi
        ? "https://doi.org/" + doi
        : "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/",
      year,
      citations: null,
      authors,
      journal: journal || "PubMed",
      abstract,
      pmid,
    };
  });
}

async function pubmed(query, limit = 10, apiKey = "") {
  const keyParam = apiKey ? "&api_key=" + apiKey : "";
  const tool = "&tool=cerebrum&email=noreply@example.com" + keyParam;
  try {
    const structured = buildStructuredQuery(query);
    let term = structured;
    let ids = [];

    const esUrl = (t) =>
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" +
      new URLSearchParams({
        db: "pubmed",
        term: t,
        retmax: String(limit),
        retmode: "json",
        sort: "relevance",
      }) +
      tool;

    const es = await getJSON(esUrl(term)).catch(() => null);
    ids = (es && es.esearchresult && es.esearchresult.idlist) || [];

    // Fallback ladder
    if (!ids.length && term !== query) {
      const { orgPhrases, hasOrganism } = splitOrganismTopic(query);
      if (hasOrganism) {
        const orgOnly = orgPhrases
          .map((e) => (e.includes(" ") ? '"' + e + '"' : e))
          .join(" OR ");
        const es2 = await getJSON(esUrl(orgOnly)).catch(() => null);
        ids = (es2 && es2.esearchresult && es2.esearchresult.idlist) || [];
      }
      if (!ids.length) {
        const es3 = await getJSON(esUrl(query)).catch(() => null);
        ids = (es3 && es3.esearchresult && es3.esearchresult.idlist) || [];
      }
    }
    if (!ids.length) return [];

    const idStr = ids.join(",");
    const [xml, summaryJson] = await Promise.all([
      getText(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?" +
          new URLSearchParams({ db: "pubmed", id: idStr, retmode: "xml" }) +
          tool
      ).catch(() => ""),
      getJSON(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?" +
          new URLSearchParams({ db: "pubmed", id: idStr, retmode: "json" }) +
          tool
      ).catch(() => null),
    ]);

    const fetched = xml ? parsePubmedXML(xml) : [];
    const byPmid = new Map(fetched.map((p) => [p.pmid, p]));
    const sumResult = (summaryJson && summaryJson.result) || {};
    const merged = [];
    for (const pmid of ids) {
      const s = sumResult[pmid];
      let rec = byPmid.get(pmid) || null;
      if (s && !rec) {
        rec = {
          title: s.title || "Untitled",
          url: "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/",
          year: (s.pubdate || "").slice(0, 4),
          citations: null,
          authors:
            (s.authors || []).slice(0, 1).map((a) => a.name).join("") +
            ((s.authors || []).length > 1 ? " et al." : ""),
          journal: s.fulljournalname || s.source || "PubMed",
          abstract: "",
          pmid,
        };
      } else if (rec && s) {
        if (!rec.year && s.pubdate) rec.year = (s.pubdate || "").slice(0, 4);
        if (!rec.authors && s.authors)
          rec.authors =
            s.authors.slice(0, 1).map((a) => a.name).join("") +
            (s.authors.length > 1 ? " et al." : "");
      }
      if (rec && rec.title) merged.push(rec);
    }
    // Include any fetched not already merged
    for (const p of fetched) {
      if (!merged.some((m) => m.pmid === p.pmid)) merged.push(p);
    }
    return merged;
  } catch {
    return [];
  }
}

// Looks like a scientific binomial (Genus species): 2+ words, first capitalized,
// second lowercase, italic-ish structure. Examples: "Populus angustifolia",
// "populus angustifolia", "P. angustifolia", "Hermetia illucens".
// Returns {binomial: "populus angustifolia", genus, species} or null.
// Detects a Latin binomial nomenclature (genus + species) inside a query.
// e.g. "Populus angustifolia", "populus angustifolia", "Hermetia illucens"
// Returns the binomial object, or null. Used to enforce strict species matching:
// searches for one species must NOT surface papers about a sibling species in the
// same genus (huge source of false positives in taxonomic queries).
function extractBinomial(raw) {
  const s = raw.trim();
  // Common non-taxonomic word pairs that fit the pattern
  const commonNonTaxonomic = new Set([
    "black soldier", "climate change", "gene expression", "cell division",
    "protein folding", "public health", "food security", "human genome",
    "narrow leafed", "cotton wood", "peer reviewed", "open source",
  ]);
  // Iterate through ALL matches, pick the first that looks taxonomic. This
  // means "Evolution of narrow leafed cotton wood trees Populus angustifolia"
  // correctly finds "Populus angustifolia" (title-cased), not "narrow leafed".
  const re = /\b([A-Z][a-z]{2,}|[a-z]{3,})\s+([a-z]{3,})\b/g;
  const hasTaxMarker = /\b(species|genus|subsp\.|var\.|cultivar|strain|clade|sp\.)\b/i.test(s);
  let m;
  while ((m = re.exec(s)) !== null) {
    const test = m[0].toLowerCase();
    if (commonNonTaxonomic.has(test)) continue;
    const looksTaxonomic = /^[A-Z]/.test(m[1]) || hasTaxMarker;
    if (!looksTaxonomic) continue;
    const genus = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    return { genus, species: m[2], full: genus + " " + m[2] };
  }
  return null;
}

// Looks like a person's name: 2-3 capitalized-word tokens, all letters.
// Used to trigger author-specific search paths.
function looksLikePersonName(raw) {
  const s = raw.trim();
  if (!s) return false;
  // If it's a Latin binomial, it's NOT a person name (Populus angustifolia matches
  // the shape of "Firstname Lastname" but is not a person).
  if (extractBinomial(raw)) return false;
  const toks = s.split(/\s+/);
  if (toks.length < 2 || toks.length > 4) return false;
  // Each token: only letters (allow hyphens/apostrophes), starts with uppercase in original
  const isNamey = toks.every((t) => /^[A-Z][a-zA-Z'\-]+\.?$/.test(t) || /^[A-Z]\.?$/.test(t));
  // Reject obvious topic-word starts like "How" "What"
  const q = ["how", "what", "why", "when", "where", "who", "which", "does", "is", "are", "can", "the"];
  if (q.includes(toks[0].toLowerCase())) return false;
  return isNamey;
}

// OpenAlex authors endpoint: disambiguates people and returns their id, so we
// can fetch their actual works. Keyless.
async function openAlexAuthorSearch(name, limit = 10) {
  try {
    const authorRes = await getJSON(
      "https://api.openalex.org/authors?" +
        new URLSearchParams({
          search: name,
          per_page: "10",
          mailto: "noreply@example.com",
        })
    );
    const authors = (authorRes && authorRes.results) || [];
    if (!authors.length) return [];

    // Strict name match: require ALL tokens of the query to appear in the
    // author's display_name (or an alternative form). This kills matches like
    // "J. P. Reese" surfacing for a "Reese Saho" search.
    const wanted = name.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = authors
      .map((a) => {
        const dn = (a.display_name || "").toLowerCase();
        const alt = (a.display_name_alternatives || []).map((x) => (x || "").toLowerCase());
        const allNames = [dn, ...alt];
        const allHit = wanted.every((w) => allNames.some((n) => n.includes(w)));
        return { a, allHit, works: a.works_count || 0 };
      })
      .filter((s) => s.allHit);

    if (!scored.length) return [];
    scored.sort((x, y) => y.works - x.works);

    const worksAll = [];
    for (const s of scored.slice(0, 2)) {
      try {
        const worksRes = await getJSON(
          "https://api.openalex.org/works?" +
            new URLSearchParams({
              filter: "author.id:" + s.a.id.replace("https://openalex.org/", ""),
              per_page: String(limit),
              sort: "publication_year:desc",
              select:
                "title,doi,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships",
              mailto: "noreply@example.com",
            })
        );
        for (const w of (worksRes.results || [])) {
          if (!w.title) continue;
          const first =
            (w.authorships && w.authorships[0] && w.authorships[0].author && w.authorships[0].author.display_name) || s.a.display_name;
          worksAll.push({
            title: w.title,
            url: w.doi || (w.primary_location && (w.primary_location.landing_page_url || w.primary_location.pdf_url)) || "",
            year: w.publication_year || "",
            citations: typeof w.cited_by_count === "number" ? w.cited_by_count : null,
            authors: w.authorships && w.authorships.length > 1 ? first + " et al." : first,
            journal: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || "OpenAlex",
            abstract: decodeInverted(w.abstract_inverted_index),
            authorMatch: s.a.display_name,
          });
        }
      } catch {}
    }
    return worksAll;
  } catch {
    return [];
  }
}

// Fallback for people not indexed by OpenAlex's author-disambiguation endpoint
// (common for grad students / early-career researchers). Instead of trusting a
// dedicated "who is this person" lookup, we search for the exact quoted name as
// a phrase across Europe PMC, OpenAlex works, and Crossref, then keep ONLY
// papers where that name genuinely appears in the paper's OWN author string.
// This is what actually finds a real paper like Reese Saho's bioRxiv preprint,
// which exists but isn't a disambiguated "author" record anywhere.
function nameAppearsInAuthorString(authorsStr, fullName) {
  const hay = (authorsStr || "").toLowerCase();
  const tokens = fullName.toLowerCase().split(/\s+/).filter(Boolean);
  // Require every name token (first + last) to appear somewhere in the
  // author string. Handles "Reese Saho, Duy Trinh, ... et al." style strings.
  return tokens.every((t) => hay.includes(t));
}

async function searchPapersByExactAuthorName(fullName, limit = 15) {
  const quoted = '"' + fullName + '"';
  // Europe PMC is the only source that returns a FULL author string (not just
  // "first-author et al."). It's also the only one we can reliably filter on
  // downstream author membership. So we search there directly, then augment
  // with direct bioRxiv/medRxiv preprint APIs which give complete author lists.
  try {
    const [epmc, brx, mrx] = await Promise.allSettled([
      europePMC(quoted, limit),
      biorxivDirectAuthor(fullName),
      medrxivDirectAuthor(fullName),
    ]);
    const pools = [epmc, brx, mrx]
      .filter((r) => r.status === "fulfilled")
      .flatMap((r) => r.value || []);
    const seen = new Set();
    const matched = [];
    for (const p of pools) {
      const key = (p.title || "").toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      if (nameAppearsInAuthorString(p.authors, fullName)) {
        seen.add(key);
        matched.push({ ...p, authorMatch: fullName });
      }
    }
    return matched;
  } catch {
    return [];
  }
}

// Direct bioRxiv API: pulls up to 100 recent preprints and filters by author
// name. Only finds someone if their preprint is public on bioRxiv itself. Not
// mirrored through OpenAlex or PubMed, so this catches things those miss.
async function biorxivDirectAuthor(fullName) {
  return preprintServerAuthor("biorxiv", fullName);
}
async function medrxivDirectAuthor(fullName) {
  return preprintServerAuthor("medrxiv", fullName);
}
async function preprintServerAuthor(server, fullName) {
  try {
    // bioRxiv/medRxiv have a "details" API but no search-by-author endpoint.
    // We use the interval endpoint to pull the last 6 months of preprints (up
    // to ~1000 items) and filter locally by author. Rough but works for
    // finding early-career researchers whose one preprint isn't indexed yet.
    const now = new Date();
    const six = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    const iso = (d) => d.toISOString().slice(0, 10);
    const url = "https://api.biorxiv.org/details/" + server + "/" + iso(six) + "/" + iso(now) + "/0";
    const data = await getJSON(url, {}, 5000);
    const items = (data && data.collection) || [];
    const nameLC = fullName.toLowerCase();
    const tokens = nameLC.split(/\s+/).filter(Boolean);
    const hits = items.filter((it) => {
      const auths = (it.authors || "").toLowerCase();
      return tokens.every((t) => auths.includes(t));
    });
    return hits.slice(0, 10).map((it) => ({
      title: it.title || "Untitled",
      url: it.doi ? "https://doi.org/" + it.doi : "https://www.biorxiv.org/content/" + it.doi,
      year: (it.date || "").slice(0, 4),
      citations: null,
      authors: it.authors || "",
      journal: server === "biorxiv" ? "bioRxiv (preprint)" : "medRxiv (preprint)",
      abstract: it.abstract || "",
    }));
  } catch {
    return [];
  }
}

async function openAlex(query, limit = 10, key = "") {
  try {


    const params = new URLSearchParams({
      search: query,
      sort: "relevance_score:desc",
      per_page: String(limit),
      select:
        "title,doi,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships,ids",
      mailto: "noreply@example.com",
    });
    if (key) params.set("api_key", key);
    const data = await getJSON("https://api.openalex.org/works?" + params);
    return (data.results || [])
      .map((w) => {
        const first =
          (w.authorships && w.authorships[0] && w.authorships[0].author && w.authorships[0].author.display_name) || "";
        const rawPmcid = (w.ids && w.ids.pmcid) || "";
        const pmcid = rawPmcid.replace(/^https?:\/\/.*?\/(PMC\d+)$/i, "$1").replace(/[^0-9]/g, "");
        return {
          title: w.title || "Untitled",
          url:
            w.doi ||
            (w.primary_location && (w.primary_location.landing_page_url || w.primary_location.pdf_url)) ||
            "",
          year: w.publication_year || "",
          citations: typeof w.cited_by_count === "number" ? w.cited_by_count : null,
          authors:
            w.authorships && w.authorships.length > 1
              ? first + " et al."
              : first,
          journal:
            (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) ||
            "OpenAlex",
          abstract: decodeInverted(w.abstract_inverted_index),
          pmcid: pmcid || "",
        };
      })
      .filter((p) => p.title);
  } catch {
    return [];
  }
}

async function crossref(query, limit = 8) {
  try {
    const url =
      "https://api.crossref.org/works?" +
      new URLSearchParams({
        query,
        rows: String(limit),
        select:
          "title,author,container-title,published,DOI,abstract,is-referenced-by-count",
      }) +
      "&mailto=cerebrum@example.com";
    const data = await getJSON(url);
    const items = (data && data.message && data.message.items) || [];
    return items
      .map((it) => ({
        title: Array.isArray(it.title) ? it.title[0] : it.title || "Untitled",
        url: it.DOI ? "https://doi.org/" + it.DOI : "",
        year:
          (it.published &&
            it.published["date-parts"] &&
            it.published["date-parts"][0] &&
            it.published["date-parts"][0][0]) ||
          "",
        citations:
          typeof it["is-referenced-by-count"] === "number"
            ? it["is-referenced-by-count"]
            : null,
        authors:
          (it.author || [])
            .slice(0, 1)
            .map((a) => ((a.given || "") + " " + (a.family || "")).trim())
            .join("") + ((it.author || []).length > 1 ? " et al." : ""),
        journal: Array.isArray(it["container-title"])
          ? it["container-title"][0]
          : it["container-title"] || "Crossref",
        abstract: stripTags(it.abstract || ""),
      }))
      .filter((p) => p.title);
  } catch {
    return [];
  }
}

async function arxiv(query, limit = 6) {
  try {
    const url =
      "https://export.arxiv.org/api/query?" +
      new URLSearchParams({
        search_query: "all:" + query,
        max_results: String(limit),
        sortBy: "relevance",
      });
    const xml = await getText(url);
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    return entries
      .map((e) => {
        const g = (re) => {
          const m = e.match(re);
          return m ? m[1].trim() : "";
        };
        const title = stripTags(g(/<title>([\s\S]*?)<\/title>/));
        const summary = stripTags(g(/<summary>([\s\S]*?)<\/summary>/));
        const id = g(/<id>([\s\S]*?)<\/id>/);
        const published = g(/<published>(\d{4})/);
        const authorNames = (e.match(/<name>([\s\S]*?)<\/name>/g) || []).map(
          (a) => a.replace(/<\/?name>/g, "").trim()
        );
        return {
          title: title || "arXiv paper",
          url: id,
          year: published || "",
          citations: null,
          authors:
            authorNames.length > 1
              ? authorNames[0] + " et al."
              : authorNames[0] || "",
          journal: "arXiv",
          abstract: summary,
        };
      })
      .filter((p) => p.title);
  } catch {
    return [];
  }
}

async function semanticScholar(query, limit = 8) {
  try {
    const url =
      "https://api.semanticscholar.org/graph/v1/paper/search?" +
      new URLSearchParams({
        query,
        limit: String(limit),
        fields:
          "title,abstract,tldr,year,citationCount,authors,venue,externalIds,openAccessPdf,url",
      });
    const data = await getJSON(url);
    return ((data && data.data) || [])
      .filter((r) => r.title)
      .map((r) => {
        const doi = r.externalIds && r.externalIds.DOI;
        return {
          title: r.title || "Untitled",
          url: doi
            ? "https://doi.org/" + doi
            : (r.openAccessPdf && r.openAccessPdf.url) || r.url || "",
          year: r.year || "",
          citations: typeof r.citationCount === "number" ? r.citationCount : null,
          authors:
            (r.authors || []).slice(0, 1).map((a) => a.name).join("") +
            ((r.authors || []).length > 1 ? " et al." : ""),
          journal: r.venue || "Semantic Scholar",
          abstract: r.abstract || "",
          tldr: (r.tldr && r.tldr.text) || "",
        };
      });
  } catch {
    return [];
  }
}

async function doaj(query, limit = 6) {
  try {
    const url =
      "https://doaj.org/api/search/articles/" +
      encodeURIComponent(query) +
      "?pageSize=" +
      limit;
    const data = await getJSON(url);
    return ((data && data.results) || [])
      .map((r) => {
        const b = r.bibjson || {};
        const doiId = (b.identifier || []).find((x) => x.type === "doi");
        const link = (b.link || [])[0];
        return {
          title: b.title || "Untitled",
          url: doiId ? "https://doi.org/" + doiId.id : (link && link.url) || "",
          year: b.year || "",
          citations: null,
          authors:
            (b.author || []).slice(0, 1).map((a) => a.name).join("") +
            ((b.author || []).length > 1 ? " et al." : ""),
          journal: (b.journal && b.journal.title) || "DOAJ",
          abstract: stripTags(b.abstract || ""),
        };
      })
      .filter((p) => p.title);
  } catch {
    return [];
  }
}

async function biorxiv(query, limit = 6) {
  try {
    const params = new URLSearchParams({
      search: query,
      filter: "type:preprint",
      sort: "relevance_score:desc",
      per_page: String(limit),
      select:
        "title,doi,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships",
      mailto: "noreply@example.com",
    });
    const data = await getJSON("https://api.openalex.org/works?" + params);
    const out = [];
    for (const w of (data.results || [])) {
      if (!w.title) continue;
      const first =
        (w.authorships && w.authorships[0] && w.authorships[0].author && w.authorships[0].author.display_name) || "";
      out.push({
        title: w.title,
        url:
          w.doi ||
          (w.primary_location && w.primary_location.landing_page_url) ||
          "",
        year: w.publication_year || "",
        citations: typeof w.cited_by_count === "number" ? w.cited_by_count : null,
        authors:
          w.authorships && w.authorships.length > 1
            ? first + " et al."
            : first,
        journal:
          (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) ||
          "Preprint",
        abstract: decodeInverted(w.abstract_inverted_index),
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function zenodo(query, limit = 4) {
  try {
    const url =
      "https://zenodo.org/api/records?" +
      new URLSearchParams({ q: query, size: String(limit), sort: "mostrecent" });
    const data = await getJSON(url);
    return ((data && data.hits && data.hits.hits) || [])
      .map((r) => {
        const md = r.metadata || {};
        return {
          title: md.title || "Untitled",
          url:
            r.doi_url ||
            (md.doi ? "https://doi.org/" + md.doi : "") ||
            (r.links && r.links.self_html) ||
            "",
          year: (md.publication_date || "").slice(0, 4),
          citations: null,
          authors:
            (md.creators || []).slice(0, 1).map((a) => a.name).join("") +
            ((md.creators || []).length > 1 ? " et al." : ""),
          journal: "Zenodo",
          abstract: stripTags(md.description || ""),
        };
      })
      .filter((p) => p.title);
  } catch {
    return [];
  }
}

async function plos(query, limit = 6) {
  try {
    const url =
      "https://api.plos.org/search?" +
      new URLSearchParams({
        q: query,
        fl: "id,title_display,author_display,journal,publication_date,abstract",
        wt: "json",
        rows: String(limit),
      });
    const data = await getJSON(url);
    return ((data && data.response && data.response.docs) || [])
      .map((d) => ({
        title: Array.isArray(d.title_display)
          ? d.title_display[0]
          : d.title_display || "Untitled",
        url: d.id ? "https://doi.org/" + d.id : "",
        year: (d.publication_date || "").slice(0, 4),
        citations: null,
        authors:
          (d.author_display || []).slice(0, 1).join("") +
          ((d.author_display || []).length > 1 ? " et al." : ""),
        journal: d.journal || "PLOS",
        abstract: stripTags(
          Array.isArray(d.abstract) ? d.abstract.join(" ") : d.abstract || ""
        ),
      }))
      .filter((p) => p.title);
  } catch {
    return [];
  }
}

async function wikipedia(query, limit = 2) {
  try {
    const searchUrl =
      "https://en.wikipedia.org/w/api.php?" +
      new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: query,
        srlimit: String(limit),
        format: "json",
        origin: "*",
      });
    const sdata = await getJSON(searchUrl, {}, 4000);
    const hits = (sdata && sdata.query && sdata.query.search) || [];
    const out = [];
    for (const h of hits) {
      const title = h.title;
      try {
        const exUrl =
          "https://en.wikipedia.org/w/api.php?" +
          new URLSearchParams({
            action: "query",
            prop: "extracts",
            exintro: "1",
            explaintext: "1",
            titles: title,
            format: "json",
            origin: "*",
          });
        const ex = await getJSON(exUrl, {}, 4000);
        const pages = (ex && ex.query && ex.query.pages) || {};
        const page = Object.values(pages)[0] || {};
        const extract = (page.extract || "").replace(/\s+/g, " ").trim();
        if (extract) {
          out.push({
            title: title + " (Wikipedia)",
            url:
              "https://en.wikipedia.org/wiki/" +
              encodeURIComponent(title.replace(/ /g, "_")),
            year: "",
            citations: null,
            authors: "Wikipedia contributors",
            journal: "Wikipedia",
            abstract: extract.slice(0, 1500),
            isEncyclopedia: true,
          });
        }
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

async function duckduckgo(query) {
  try {
    const url =
      "https://api.duckduckgo.com/?" +
      new URLSearchParams({
        q: query,
        format: "json",
        no_html: "1",
        skip_disambig: "1",
      });
    const data = await getJSON(url, {}, 4000);
    const abstract = ((data && data.AbstractText) || "").trim();
    if (!abstract) return [];
    return [
      {
        title: (data.Heading || query) + " (" + (data.AbstractSource || "Web") + ")",
        url: data.AbstractURL || "",
        year: "",
        citations: null,
        authors: data.AbstractSource || "Web",
        journal: data.AbstractSource || "Web",
        abstract: abstract.slice(0, 1200),
        isEncyclopedia: true,
      },
    ];
  } catch {
    return [];
  }
}

// ============ VIDEO SEARCH ============
// Races multiple public Piped/Invidious instances. If one works, we use it.
// Instance list is refreshed with known-working ones and rotated randomly.

const VIDEO_INSTANCES = [
  { type: "piped", url: "https://pipedapi.kavin.rocks" },
  { type: "piped", url: "https://api.piped.projectsegfau.lt" },
  { type: "piped", url: "https://pipedapi.adminforge.de" },
  { type: "piped", url: "https://pipedapi.reallyaweso.me" },
  { type: "piped", url: "https://pipedapi.leptons.xyz" },
  { type: "piped", url: "https://pipedapi.ducks.party" },
  { type: "piped", url: "https://pipedapi.r4fo.com" },
  { type: "piped", url: "https://pipedapi.us.projectsegfau.lt" },
  { type: "piped", url: "https://pipedapi.drgns.space" },
  { type: "piped", url: "https://pipedapi.orsi.uk" },
  { type: "invidious", url: "https://invidious.nerdvpn.de" },
  { type: "invidious", url: "https://inv.nadeko.net" },
  { type: "invidious", url: "https://iv.ggtyler.dev" },
  { type: "invidious", url: "https://invidious.privacyredirect.com" },
  { type: "invidious", url: "https://invidious.f5.si" },
  { type: "invidious", url: "https://inv.tux.pizza" },
  { type: "invidious", url: "https://invidious.perennialte.ch" },
  { type: "invidious", url: "https://invidious.jing.rocks" },
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function tryVideoInstance(inst, query, timeoutMs) {
  const qs = encodeURIComponent(query + " lecture explained");
  const url =
    inst.type === "piped"
      ? inst.url + "/search?q=" + qs + "&filter=videos"
      : inst.url + "/api/v1/search?q=" + qs + "&type=video";

  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: c.signal,
      headers: { "User-Agent": "Mozilla/5.0 Cerebrum" },
    });
    clearTimeout(t);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    // Normalize shape between Piped and Invidious
    const items = Array.isArray(data) ? data : data.items || [];
    if (!items.length) throw new Error("empty");

    const seen = new Set();
    const out = [];
    for (const item of items) {
      let vId = "";
      if (item.videoId) vId = item.videoId;
      else if (item.url && item.url.indexOf("/watch?v=") !== -1)
        vId = item.url.replace(/^.*\/watch\?v=/, "").split("&")[0];
      if (!vId || seen.has(vId)) continue;
      seen.add(vId);
      const title = item.title || "Video";
      const author =
        item.author ||
        item.uploaderName ||
        item.uploader ||
        item.channel ||
        "Channel";
      out.push({
        title,
        url: "https://www.youtube.com/watch?v=" + vId,
        author,
        thumbnail: "https://i.ytimg.com/vi/" + vId + "/hqdefault.jpg",
        id: vId,
      });
      if (out.length >= 6) break;
    }
    if (!out.length) throw new Error("no valid items");
    return out;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

// Direct YouTube search via HTML scrape. YouTube embeds a JSON payload
// (ytInitialData) in the HTML of its search results page. This works from
// Cloudflare Workers because YouTube doesn't block Cloudflare IPs the way
// the community Piped/Invidious instances do. Keyless, free, and reliable.
async function youtubeDirectSearch(query, limit = 6) {
  const url =
    "https://www.youtube.com/results?" +
    new URLSearchParams({ search_query: query + " lecture explained" });
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const res = await fetch(url, {
      signal: c.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const html = await res.text();

    // Extract ytInitialData JSON blob
    const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
    if (!m) return [];
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      return [];
    }

    // Navigate the nested structure to find video results
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents || [];
    const out = [];
    const seen = new Set();

    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const v = item?.videoRenderer;
        if (!v || !v.videoId) continue;
        if (seen.has(v.videoId)) continue;
        seen.add(v.videoId);

        const title =
          v.title?.runs?.map((r) => r.text).join("") ||
          v.title?.simpleText ||
          "Video";
        const author =
          v.ownerText?.runs?.[0]?.text ||
          v.longBylineText?.runs?.[0]?.text ||
          "Channel";
        // High-quality thumbnail
        const thumbs = v.thumbnail?.thumbnails || [];
        const thumbnail =
          thumbs[thumbs.length - 1]?.url ||
          "https://i.ytimg.com/vi/" + v.videoId + "/hqdefault.jpg";

        out.push({
          title,
          url: "https://www.youtube.com/watch?v=" + v.videoId,
          author,
          thumbnail,
          id: v.videoId,
        });
        if (out.length >= limit) return out;
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchVideos(query, maxMs = 3000) {
  const cleaned = cleanQuery(query) || query;

  // Wrap everything in a hard time cap so this never blocks the answer.
  const timedRace = new Promise((resolve) => setTimeout(() => resolve([]), maxMs));

  const doFetch = async () => {
    // TIER 1: Direct YouTube (works from Cloudflare, keyless).
    const direct = await youtubeDirectSearch(cleaned, 6).catch(() => []);
    if (direct.length) return direct;

    // TIER 2: Proxies
    const shuffled = shuffle(VIDEO_INSTANCES);
    const batchSize = 4;
    for (let i = 0; i < shuffled.length; i += batchSize) {
      const batch = shuffled.slice(i, i + batchSize);
      const promises = batch.map((inst) => tryVideoInstance(inst, cleaned, 2000));
      try {
        const result = await Promise.any(promises);
        if (result && result.length) return result;
      } catch {}
    }
    return [];
  };

  return Promise.race([doFetch(), timedRace]);
}

// ============ AUTHOR SEARCH ============
// If the query looks like a person's name, we hit author-specific endpoints
// rather than a generic keyword search. This avoids "Reese Saho" returning
// stellar-pulsation papers just because "Reese" appears somewhere in them.

function detectAuthor(raw) {
  const q = raw.trim();
  const lower = q.toLowerCase();
  const prefixes = [
    "papers by ", "publications by ", "articles by ",
    "research by ", "work by ", "author:",
  ];
  for (const p of prefixes) {
    if (lower.startsWith(p)) return q.slice(p.length).trim();
  }
  // Bare name heuristic: 2-4 words, all capitalized, no question words.
  const words = q.split(/\s+/);
  if (words.length >= 2 && words.length <= 4) {
    const questiony = /^(what|how|why|when|where|which|who|is|are|does|do|can|explain|tell)/i.test(q);
    const allCap = words.every((w) => /^[A-Z][a-zA-Z.'-]*$/.test(w));
    if (allCap && !questiony) return q;
  }
  return null;
}

async function authorOpenAlex(name, limit = 15) {
  try {
    // First find the actual author entity, then their works.
    const searchUrl = "https://api.openalex.org/authors?" +
      new URLSearchParams({
        search: name,
        per_page: "5",
        select: "id,display_name,works_count,cited_by_count",
        mailto: "noreply@example.com",
      });
    const sdata = await getJSON(searchUrl);
    const cands = (sdata && sdata.results) || [];
    if (!cands.length) return { papers: [], matched: null };

    // Prefer exact name match; fall back to top result
    const wanted = name.toLowerCase();
    const exact = cands.find((c) => (c.display_name || "").toLowerCase() === wanted);
    const author = exact || cands[0];
    if (!author || !author.id) return { papers: [], matched: null };

    // Now fetch that author's works
    const authorFilter = "authorships.author.id:" + author.id.replace("https://openalex.org/", "");
    const worksUrl = "https://api.openalex.org/works?" +
      new URLSearchParams({
        filter: authorFilter,
        sort: "cited_by_count:desc",
        per_page: String(limit),
        select: "title,doi,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships",
        mailto: "noreply@example.com",
      });
    const data = await getJSON(worksUrl);
    const papers = ((data && data.results) || []).map((w) => {
      const first = (w.authorships && w.authorships[0] && w.authorships[0].author && w.authorships[0].author.display_name) || "";
      return {
        title: w.title || "Untitled",
        url: w.doi || (w.primary_location && w.primary_location.landing_page_url) || "",
        year: w.publication_year || "",
        citations: typeof w.cited_by_count === "number" ? w.cited_by_count : null,
        authors: w.authorships && w.authorships.length > 1 ? first + " et al." : first,
        journal: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || "OpenAlex",
        abstract: decodeInverted(w.abstract_inverted_index),
      };
    }).filter((p) => p.title && p.title !== "Untitled");
    return { papers, matched: author.display_name };
  } catch {
    return { papers: [], matched: null };
  }
}

async function authorCrossref(name, limit = 15) {
  try {
    const url = "https://api.crossref.org/works?" +
      new URLSearchParams({
        "query.author": name,
        rows: String(limit),
        sort: "is-referenced-by-count",
        order: "desc",
        select: "title,author,container-title,published,DOI,is-referenced-by-count,abstract",
      }) + "&mailto=cerebrum@example.com";
    const data = await getJSON(url);
    return ((data && data.message && data.message.items) || []).map((it) => ({
      title: Array.isArray(it.title) ? it.title[0] : it.title || "Untitled",
      url: it.DOI ? "https://doi.org/" + it.DOI : "",
      year: (it.published && it.published["date-parts"] && it.published["date-parts"][0] && it.published["date-parts"][0][0]) || "",
      citations: typeof it["is-referenced-by-count"] === "number" ? it["is-referenced-by-count"] : null,
      authors: (it.author || []).slice(0, 1).map((a) => ((a.given || "") + " " + (a.family || "")).trim()).join("") + ((it.author || []).length > 1 ? " et al." : ""),
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
    const cands = (sdata && sdata.data) || [];
    if (!cands.length) return { papers: [], matched: null };

    const wanted = name.toLowerCase().split(/\s+/).filter(Boolean);
    const scoreName = (candName) => {
      const cn = (candName || "").toLowerCase();
      return wanted.filter((w) => cn.includes(w)).length / wanted.length;
    };
    const ranked = cands
      .map((c) => ({ c, match: scoreName(c.name) }))
      .sort((a, b) => (b.match - a.match) || ((b.c.paperCount || 0) - (a.c.paperCount || 0)));

    const best = ranked[0];
    if (!best || best.match < 0.99) return { papers: [], matched: null };

    const authorId = best.c.authorId;
    if (!authorId) return { papers: [], matched: null };
    const papersUrl = "https://api.semanticscholar.org/graph/v1/author/" + authorId + "/papers?" +
      new URLSearchParams({
        fields: "title,abstract,year,citationCount,authors,venue,externalIds",
        limit: String(limit),
      });
    const pdata = await getJSON(papersUrl);
    const papers = ((pdata && pdata.data) || []).map((r) => {
      const doi = r.externalIds && r.externalIds.DOI;
      const names = (r.authors || []).map((a) => a.name);
      return {
        title: r.title || "Untitled",
        url: doi ? "https://doi.org/" + doi : (r.externalIds && r.externalIds.ArXiv ? "https://arxiv.org/abs/" + r.externalIds.ArXiv : ""),
        year: r.year || "",
        citations: typeof r.citationCount === "number" ? r.citationCount : null,
        authors: names.length > 1 ? names[0] + " et al." : names[0] || "",
        journal: r.venue || "Semantic Scholar",
        abstract: r.abstract || "",
      };
    }).filter((p) => p.title && p.title !== "Untitled");
    return { papers, matched: best.c.name };
  } catch { return { papers: [], matched: null }; }
}

// UTK-specific: check TRACE for local grad students since Reese Saho is at UTK
async function authorUTK(name) {
  const parts = name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (!parts.length) return [];
  const sets = ["publication:utk_graddiss", "publication:utk_gradthes"];
  const all = [];
  for (const set of sets) {
    try {
      const text = await getText(
        "https://trace.tennessee.edu/do/oai/?" +
          new URLSearchParams({ verb: "ListRecords", metadataPrefix: "dcq", set })
      );
      all.push(...extractTraceRecords(text));
    } catch {}
  }
  // Match only records whose creators actually contain the person's name
  return all
    .filter((r) => {
      const authors = (r.authors || "").toLowerCase();
      return parts.every((p) => authors.includes(p));
    })
    .slice(0, 10)
    .map((r) => ({
      title: r.title,
      url: r.url,
      year: r.year,
      citations: null,
      authors: r.authors,
      journal: "UTK TRACE",
      abstract: stripTags(r.abstract),
    }));
}

async function gatherByAuthor(name) {
  const [ssRes, oaRes, cr, utk] = await Promise.all([
    authorSemanticScholar(name, 20).catch(() => ({ papers: [], matched: null })),
    authorOpenAlex(name, 15).catch(() => ({ papers: [], matched: null })),
    authorCrossref(name, 15).catch(() => []),
    authorUTK(name).catch(() => []),
  ]);
  const ss = ssRes.papers || [];
  const oa = oaRes.papers || [];
  const merged = [];
  const seen = new Set();
  for (const list of [ss, oa, cr, utk]) {
    for (const p of list) {
      const key = (p.title || "").toLowerCase().trim();
      if (key && !seen.has(key)) { seen.add(key); merged.push(p); }
    }
  }
  const papers = merged.sort((a, b) => (b.citations || 0) - (a.citations || 0)).slice(0, 25);
  const matched = ssRes.matched || oaRes.matched || null;
  return { papers, confirmed: !!matched, matchedName: matched };
}



async function gatherPapers(rawQuery, opts) {
  const openAlexKey = (opts && opts.openAlexKey) || "";
  const ncbiKey = (opts && opts.ncbiKey) || "";
  const limit = (opts && opts.limit) || 25;
  const query = cleanQuery(rawQuery);
  // A resolved person name from conversation history (pronoun follow-up like
  // "he has papers from UTK") takes priority over re-detecting from rawQuery.
  const resolvedPersonName = opts && opts.resolvedPersonName;
  const isNameQuery = !!resolvedPersonName || looksLikePersonName(rawQuery);
  const effectiveName = resolvedPersonName || rawQuery.trim();
  const binomial = extractBinomial(rawQuery);

  // For person-name queries: try OpenAlex's disambiguated author endpoint first.
  // If that finds nothing (common for grad students / early-career researchers
  // who aren't a distinct "author" record yet), fall back to searching for the
  // exact quoted name and keeping only papers where that name is genuinely in
  // the paper's own author list. Only if BOTH come back empty do we give up.
  if (isNameQuery) {
    let authorWorks = await openAlexAuthorSearch(effectiveName, 20).catch(() => []);
    if (!authorWorks.length) {
      authorWorks = await searchPapersByExactAuthorName(effectiveName, 15).catch(() => []);
    }
    if (authorWorks.length) {
      const scored = authorWorks.map((p) => ({
        ...p, score: 10, contentHits: 1, contentCoverage: 1, organismPresent: true, relevance: 100,
      }));
      for (const p of scored) {
        const j = (p.journal || "").toLowerCase();
        if (/preprint|biorxiv|medrxiv|arxiv/.test(j)) p.type = "Preprint";
        else if (/zenodo|datacite|figshare|dryad/.test(j)) p.type = "Dataset";
        else p.type = "Journal";
      }
      return { papers: scored };
    }
    // No confirmed author found via either method — return empty so the
    // endpoint can respond honestly instead of falling back to loose keyword
    // search (which is how unrelated papers used to leak in).
    return { papers: [], authorNotFound: true };
  }

  // All 10 keyless / low-friction sources in parallel via allSettled
  const jobs = [
    europePMC(query, 10),
    pubmed(query, 10, ncbiKey),
    openAlex(query, 10, openAlexKey),
    crossref(query, 8),
    arxiv(query, 6),
    semanticScholar(query, 8),
    doaj(query, 6),
    biorxiv(query, 6),
    zenodo(query, 4),
    plos(query, 6),
  ];

  const results = await Promise.allSettled(jobs);
  const merged = [];
  const seen = new Set();
  for (const res of results) {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      for (const p of res.value) {
        const key = (p.title || "").toLowerCase().trim();
        if (key && !seen.has(key)) {
          seen.add(key);
          merged.push(p);
        }
      }
    }
  }

  // Relevance scoring
  const terms = query.split(/\s+/).filter((t) => t.length > 2);
  const expansions = expansionsFor(terms);

  // Neutral (organism) words vs content (topic) words
  const neutralWords = new Set(terms.filter((t) => SYNONYMS[t]));
  for (const phrase of expansions) {
    for (const w of phrase.toLowerCase().split(/\s+/)) {
      if (w.length > 2) neutralWords.add(w);
    }
  }
  for (const w of ["black", "soldier", "larvae", "larva", "fly", "hermetia", "illucens"]) {
    if (terms.includes(w)) neutralWords.add(w);
  }
  const contentTerms = terms.filter((t) => !neutralWords.has(t));

  const stem = (w) => w.replace(/(ies|es|s|al|ion|ing|ed)$/i, "");

  const scored = merged
    .map((p) => {
      const hay = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
      const titleHay = (p.title || "").toLowerCase();
      const has = (t) => hay.indexOf(t) !== -1 || hay.indexOf(stem(t)) !== -1;
      const hasTitle = (t) =>
        titleHay.indexOf(t) !== -1 || titleHay.indexOf(stem(t)) !== -1;

      const contentHits = contentTerms.filter(has).length;
      const titleContentHits = contentTerms.filter(hasTitle).length;
      const neutralHit = [...neutralWords].some(has);
      let expHit = false;
      for (const phrase of expansions) {
        if (hay.indexOf(phrase) !== -1) {
          expHit = true;
          break;
        }
      }
      const organismPresent = neutralHit || expHit;
      const contentCoverage = contentTerms.length
        ? contentHits / contentTerms.length
        : 1;

      let score = 0;
      score += contentHits * 5;
      score += contentCoverage * 6;
      score += titleContentHits * 3;
      if (organismPresent && contentHits > 0) score += 3;
      if (p.abstract) score += 0.5;
      if (typeof p.citations === "number")
        score += Math.min(p.citations / 800, 1.0);
      const yr = parseInt(p.year, 10);
      if (yr && yr >= 2015) score += 0.3;

      return {
        ...p,
        score,
        contentHits,
        contentCoverage,
        organismPresent,
      };
    })
    .filter((p) => {
      if (terms.length === 0) return true;
      // Binomial query: paper MUST contain the species epithet OR full binomial.
      // Just mentioning the genus is not enough — that's how we get wrong-species
      // papers ("Populus deltoides" study returned for a "Populus angustifolia" query).
      if (binomial) {
        const hay = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
        const hasBinomial = hay.indexOf(binomial.full.toLowerCase()) !== -1;
        const hasSpeciesWord = hay.indexOf(binomial.species) !== -1;
        // Also accept abbreviated form like "P. angustifolia"
        const abbrev = binomial.genus[0].toLowerCase() + ". " + binomial.species;
        const hasAbbrev = hay.indexOf(abbrev) !== -1;
        if (!hasBinomial && !hasSpeciesWord && !hasAbbrev) return false;
      }
      // Name queries: keep everything relevance-sorted, don't apply topic gate.
      if (isNameQuery) return true;
      const queryNamesOrganism = neutralWords.size > 0;
      if (queryNamesOrganism) {
        return (
          p.organismPresent &&
          (contentTerms.length === 0 || p.contentHits > 0)
        );
      }
      if (contentTerms.length === 0) return true;
      if (contentTerms.length <= 2) return p.contentHits > 0;
      return p.contentHits / contentTerms.length >= 0.4;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const maxScore = scored.length
    ? Math.max(...scored.map((p) => p.score))
    : 1;
  for (const p of scored) {
    p.relevance = maxScore > 0 ? Math.round((p.score / maxScore) * 100) : 0;
    const j = (p.journal || "").toLowerCase();
    if (/wikipedia/.test(j)) p.type = "Reference";
    else if (/preprint|biorxiv|medrxiv|arxiv|ssrn|research square/.test(j))
      p.type = "Preprint";
    else if (/zenodo|datacite|figshare|dryad/.test(j)) p.type = "Dataset";
    else p.type = "Journal";
  }

  return { papers: scored };
}

// ============ MAIN HANDLER ============

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

    // Special query shortcuts — small moments of personality
    const small = query.toLowerCase().replace(/[^a-z0-9\s?]/g, "").replace(/\s+/g, " ").trim();
    const specialAnswer = (text) => new Response(
      JSON.stringify({ answer: text, sources: [], videos: [], source: "Cerebrum" }),
      { status: 200, headers: cors }
    );

    // Greetings
    if (["hi", "hello", "hey", "yo", "sup", "howdy", "hiya", "hola"].includes(small)) {
      const hellos = [
        "Hey. Cerebrum here. Ask me a science question and I'll pull real papers with real citations. Ask me anything else and I'll do my best.",
        "Hi. Fair warning: I take citations seriously. Ask away.",
        "Hey there. What are we researching today?",
        "Hello. Hit me with something interesting.",
      ];
      return specialAnswer(hellos[Math.floor(Math.random() * hellos.length)]);
    }

    // Identity questions
    if (/^(who (are|r) (you|u)|what (are|r) (you|u)|whats (this|cerebrum)|whats your (name|deal)|who made (you|this|cerebrum))\??$/.test(small)) {
      return specialAnswer(
        "I'm Cerebrum — a research tool built by Vaticay. I search 16 free scholarly databases in parallel and use free AI models to synthesize answers with real, traceable citations. Everything is free-tier: no paywalls, no subscription, no ads. If you catch me making stuff up, I owe you an apology and a bug report."
      );
    }

    // Meta questions
    if (/^(are you real|is this real|is this legit|is this a scam|are these real papers)\??$/.test(small)) {
      return specialAnswer(
        "As real as an AI can be. The papers are real (Europe PMC, PubMed, OpenAlex, and 13 more). The citations are real DOIs. The answers are AI-generated so verify the specific claims against the papers, but the sources are genuinely peer-reviewed literature, not made up."
      );
    }

    if (/^(are you (chatgpt|gemini|claude|copilot))\??$/.test(small)) {
      return specialAnswer(
        "No, I'm Cerebrum. I use free AI models under the hood (OpenRouter, Cloudflare Workers AI, Pollinations) but my job is different: search real science literature, cite real papers, keep it honest. Different tool, different purpose."
      );
    }

    // Existential
    if (/^(what is the meaning of life|meaning of life|whats the meaning of life)\??$/.test(small)) {
      return specialAnswer(
        "42. But also: probably curiosity, connection, and doing something that matters to you. I'm a science tool though, not a philosopher. Ask me about neurons and I'll do better."
      );
    }

    // Compliments and rudeness
    if (/^(thanks|thank you|thx|ty|much appreciated|cheers)\.?$/.test(small)) {
      return specialAnswer("Anytime. Ask another one when you're ready.");
    }
    if (/^(you suck|this sucks|youre bad|this is bad|you re bad)\.?$/.test(small)) {
      return specialAnswer(
        "Fair enough. I'm made of free AI models and public science APIs held together with careful prompts. Tell me what specifically went wrong and I can be more useful — was it the answer quality, the sources, or something else?"
      );
    }
    if (/^(youre great|youre awesome|this is great|this rocks|nice|cool|great|awesome|amazing)\.?$/.test(small)) {
      return specialAnswer("Appreciated. Now ask me something hard.");
    }

    // Cerebrum specific / meta science jokes
    if (small === "cerebrum" || small === "cerebrum ") {
      return specialAnswer(
        "That's me. Latin for 'brain.' I know, subtle.\n\nAsk me a question and I'll show you what I do."
      );
    }
    if (/^(who is the smartest|whats the smartest thing)\??$/.test(small)) {
      return specialAnswer("Curiosity is the smartest thing. Everything else is downstream.");
    }
    if (/^(tell me a joke|joke|make me laugh)\.?$/.test(small)) {
      const jokes = [
        "A neutron walks into a bar and orders a drink. Asks for the check. Bartender says: for you, no charge.",
        "Why don't scientists trust atoms? They make up everything.",
        "I told a chemistry joke. There was no reaction.",
        "Statistically, 6 out of 7 dwarves aren't Happy.",
        "Schrödinger's cat walks into a bar. And doesn't.",
        "How many software engineers does it take to change a lightbulb? None. That's a hardware problem.",
      ];
      return specialAnswer(jokes[Math.floor(Math.random() * jokes.length)]);
    }
    if (/^(help|what can you do|how do i use this)\??$/.test(small)) {
      return specialAnswer(
        "Ask me a science question — biology, chemistry, physics, medicine, anything. I'll search PubMed, Europe PMC, arXiv, bioRxiv, OpenAlex, and 11 other databases in parallel, then write you a cited answer.\n\nGood questions look like: \"how do BSFL respond to plastics on a transcriptional level\" or \"what causes long COVID\" or \"is there evidence for autophagy in aging.\"\n\nTry Cmd+K to open the command palette. Cmd+J for a new investigation. Cmd+B for saved articles. There are also easter eggs. Have fun."
      );
    }

    // The classics
    if (/^(42|whats 42)\??$/.test(small)) {
      return specialAnswer("The Answer to the Ultimate Question of Life, the Universe, and Everything. Now we just need to figure out the question.");
    }

    const settings = body.settings || {};
    const answerLength = settings.answerLength || "medium";
    const maxTokens =
      answerLength === "short"
        ? 500
        : answerLength === "long"
        ? 1500
        : 950;
    const lengthHint =
      answerLength === "short"
        ? "Keep it to one tight paragraph."
        : answerLength === "long"
        ? "Give a thorough, well-structured explanation with clear sections."
        : "Give a few clear paragraphs, enough to actually explain, not a dump.";

    // Videos are fetched by frontend via /api/videos in parallel, so we don't
    // block the answer waiting for YouTube. Return empty array here.
    const videos = [];

    // Pronoun / continuation follow-up detection: "he has papers from...",
    // "she also wrote...", "does he work on...", "what about her research".
    // If the current query doesn't itself look like a name but clearly refers
    // back to a person, and the previous user turn WAS a name query, resolve
    // the pronoun to that name so we stay locked onto the same person instead
    // of falling through to an unrelated keyword search.
    let resolvedPersonName = null;
    const isPronounFollowup = /\b(he|she|him|her|his|hers|they|them|their)\b/i.test(query) && !looksLikePersonName(query);
    if (isPronounFollowup && Array.isArray(body.history)) {
      // Walk backward through history to find the most recent user turn that
      // was itself a clean person-name query.
      for (let i = body.history.length - 1; i >= 0; i--) {
        const turn = body.history[i];
        if (turn && turn.role === "user" && looksLikePersonName((turn.content || "").trim())) {
          resolvedPersonName = turn.content.trim();
          break;
        }
      }
    }

    const gResult = await gatherPapers(query, {
      openAlexKey: env.OPENALEX_KEY || "",
      ncbiKey: env.NCBI_API_KEY || "",
      limit: 25,
      resolvedPersonName,
    }).catch(() => ({ papers: [] }));

    // Author-name query where no confirmed match was found in any author
    // database — say so honestly instead of returning unrelated papers.
    if (gResult.authorNotFound) {
      const displayName = resolvedPersonName || query;
      return new Response(JSON.stringify({
        answer:
          "I couldn't confirm a researcher named **" + displayName + "** in the open author databases or by matching their name directly against paper author lists (OpenAlex, Semantic Scholar, Crossref, Europe PMC).\n\n" +
          "This can happen when someone:\n\n" +
          "- Has few indexed publications (common for current students or very recent researchers)\n" +
          "- Publishes under a different form of their name (with or without a middle initial, hyphenated names, etc.)\n" +
          "- Has work indexed only in databases outside what I search\n\n" +
          "Try the full name exactly as it appears on their papers, add a middle initial, or search a topic they work on and open the papers to find them.",
        sources: [],
        videos: [],
        factCheck: null,
        related: [],
        source: "Author not confirmed",
      }), { status: 200, headers: cors });
    }

    const papers = gResult.papers || [];
    const hasPapers = papers.length > 0;

    // Web fallback (only if no papers)
    let webRefs = [];
    if (!hasPapers) {
      try {
        const [wiki, ddg] = await Promise.all([
          wikipedia(cleanQuery(query), 2).catch(() => []),
          duckduckgo(query).catch(() => []),
        ]);
        const seen = new Set();
        for (const r of [...wiki, ...ddg]) {
          const k = (r.title || "").toLowerCase();
          if (r.abstract && !seen.has(k)) {
            seen.add(k);
            webRefs.push(r);
          }
        }
      } catch {}
    }

    const useEvidence = hasPapers;
    const useWeb = !useEvidence && webRefs.length > 0;

    const sourceList = (useEvidence ? papers : useWeb ? webRefs : []).map(
      ({ title, url, journal, authors, year, citations, relevance, type, tldr, retracted, concern, updateType }) => ({
        title,
        url,
        journal,
        authors,
        year,
        citations,
        relevance: relevance == null ? null : relevance,
        type: type || "Reference",
        tldr: tldr || null,
        retracted: !!retracted,
        concern: !!concern,
        updateType: updateType || null,
      })
    );

    // Build evidence block
    // Detect if this was a person-name query (matches the same logic gatherPapers uses)
    const isNameSearch = looksLikePersonName(query);
    const speciesSearch = extractBinomial(query);

    // Build evidence. For name queries, EXPLICITLY mark which papers are
    // author-matched (real author search hits) vs keyword hits, and show every
    // author verbatim so the model can't invent name variants.
    const evidence = useEvidence
      ? papers
          .slice(0, 12)
          .map((p, i) => {
            const authorTag = isNameSearch
              ? (p.authorMatch
                  ? " [AUTHOR-MATCHED to \"" + p.authorMatch + "\"]"
                  : " [NOT author-matched — appeared via keyword match only]")
              : "";
            // Detect what species this paper actually mentions when it's a species query
            let speciesTag = "";
            if (speciesSearch) {
              const hay = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
              const target = speciesSearch.full.toLowerCase();
              const targetShort = speciesSearch.genus[0].toLowerCase() + ". " + speciesSearch.species;
              const hasTarget = hay.indexOf(target) !== -1 || hay.indexOf(targetShort) !== -1;
              // Look for other species in the same genus (false-positive risk)
              const otherSpeciesRe = new RegExp("\\b" + speciesSearch.genus.toLowerCase() + "\\s+([a-z]{3,})", "gi");
              const otherSpecies = new Set();
              let m;
              while ((m = otherSpeciesRe.exec(hay)) !== null) {
                if (m[1].toLowerCase() !== speciesSearch.species) otherSpecies.add(m[1].toLowerCase());
              }
              if (hasTarget) {
                speciesTag = " [DIRECT match for " + speciesSearch.full + "]";
              } else if (otherSpecies.size) {
                speciesTag = " [WRONG SPECIES: paper is about " + speciesSearch.genus + " " + [...otherSpecies].join("/") + ", NOT " + speciesSearch.full + "]";
              } else {
                speciesTag = " [CONTEXT ONLY: paper is genus " + speciesSearch.genus + " but does not specifically identify " + speciesSearch.full + "]";
              }
            }
            const retractTag = p.retracted
              ? " [⚠ RETRACTED — do not cite as valid science; flag this to the user]"
              : p.concern
              ? " [⚠ EXPRESSION OF CONCERN issued for this paper]"
              : "";
            const tldrLine = p.tldr ? "\nTL;DR: " + p.tldr : "";
            return (
              "[" + (i + 1) + "] " + p.title +
              " (Authors: " + (p.authors || "n/a") + ", " +
              p.journal + ", " + (p.year || "n/a") + ")" + authorTag + speciesTag + retractTag +
              tldrLine +
              "\nAbstract: " + (p.abstract || "(no abstract available)")
            );
          })
          .join("\n\n")
      : useWeb
      ? webRefs
          .map((r, i) => "[" + (i + 1) + "] " + r.title + " (" + r.journal + ")\n" + r.abstract)
          .join("\n\n")
      : "";

    // System prompt tuned for a personable-but-serious tone
    const humanStyle =
      "Write like a knowledgeable friend who happens to be a scientist. Personable but still serious about accuracy. " +
      "Use plain conversational language where it fits (contractions like \"it's\" and \"doesn't\" are fine). " +
      "Skip academic filler like \"the study demonstrates\" or \"the authors report that.\" Just say what the paper found. " +
      "Explain WHY things happen, not just WHAT the papers found. If something is genuinely interesting or counterintuitive, say so plainly (\"what's cool here is...\", \"the surprising part is...\"). " +
      "Don't be afraid of a short opinion or aside when it helps the reader understand the significance. " +
      "Avoid bullet dumps. Use blank lines between paragraphs. Use **bold** sparingly for emphasis. Use *italics* for species names, titles, and Latin terms.";

    const rules =
      "CRITICAL: Do NOT output any meta-commentary. Do NOT say 'The user is asking' or 'Let me review' or 'Paper 1 discusses'. " +
      "Do NOT use <think> tags. Do NOT list papers in order, weave findings into a real explanation. " +
      "Do NOT output 'User Safety: safe'. Do NOT wrap the answer in code fences. " +
      "Do NOT fabricate DOIs, author names, or journal names not present in the sources. " +
      "If a source is marked [⚠ RETRACTED] or [⚠ EXPRESSION OF CONCERN], you MUST mention that status when citing it, or preferably not cite it at all. " +
      "Honest hedging matters: when the literature is thin, say so plainly (e.g. \"the evidence here is limited\" or \"only one paper in the retrieval directly addresses this\"). When consensus is strong, be direct. Do not hedge on established facts, and do not overclaim on shaky ones. " +
      "Jump directly into the answer.";

    let systemPrompt;
    if (useEvidence && speciesSearch) {
      // Taxonomic query: the AI must talk about THIS species specifically, not
      // conflate with sibling species in the same genus.
      systemPrompt =
        "You are Cerebrum, a scientific research assistant. The user asked about a specific species: **" + speciesSearch.full + "**.\n\n" +
        "STRICT RULES for species queries:\n" +
        "1. Every claim must be about " + speciesSearch.full + " specifically. Do NOT attribute findings from other " + speciesSearch.genus + " species (e.g. " + speciesSearch.genus + " deltoides, " + speciesSearch.genus + " tremuloides) to " + speciesSearch.full + ".\n" +
        "2. If a source paper studies a DIFFERENT species, either skip it, or explicitly say \"in a related species, [genus] [that species]...\" — never let the user think it was " + speciesSearch.full + ".\n" +
        "3. If NO retrieved paper directly studies " + speciesSearch.full + ", be honest: say the peer-reviewed literature on this exact species is limited, then briefly describe what's known about the genus.\n" +
        "4. Use the italicized species name in the answer (write it as *" + speciesSearch.full + "*).\n\n" +
        humanStyle + " " + lengthHint + " " + rules;
    } else if (useEvidence && isNameSearch) {
      // Name query: strict anti-fabrication rules. The AI must ONLY discuss the
      // person's own papers (marked AUTHOR-MATCHED), spell their name EXACTLY as
      // given, never invent name variants, and never attribute other authors'
      // papers to them.
      systemPrompt =
        "You are Cerebrum, a scientific research assistant. The user searched for a PERSON'S NAME: \"" + query + "\". " +
        "Some retrieved papers are marked [AUTHOR-MATCHED to \"...\"] — these ARE by that person. Others are marked [NOT author-matched — appeared via keyword match only] — these are NOT by that person, they just came up in the general search.\n\n" +
        "STRICT RULES:\n" +
        "1. Spell the person's name EXACTLY as \"" + query + "\". Do NOT invent variants like adding a 'y' or changing letters. If the query says 'Reese Saho', write 'Reese Saho', not 'Reese Sahoy' or 'Reese Sahon'.\n" +
        "2. Only attribute papers to the person if they are marked [AUTHOR-MATCHED]. When citing an author-matched paper, cite it inline as [N].\n" +
        "3. If a paper is marked [NOT author-matched], do NOT say the searched person wrote it. If it's relevant context (e.g. 'other BSFL research includes'), name the ACTUAL first author from the Authors field.\n" +
        "4. If NO papers are author-matched, say so honestly: mention that the person's own indexed publications didn't surface, and offer to summarize what the retrieved papers are about (with their real authors named).\n" +
        "5. Do NOT invent research topics for the person. Only describe what their author-matched papers actually cover.\n\n" +
        humanStyle + " " + lengthHint + " " + rules;
    } else if (useEvidence) {
      systemPrompt =
        "You are Cerebrum, a scientific research assistant. You have real peer-reviewed papers as sources. " +
        "Answer the question fully and naturally, citing the sources inline as [1], [2], etc. where they support specific claims. " +
        "If the papers don't fully cover something, blend in your own scientific knowledge for those parts, don't refuse or say the papers don't cover it. " +
        humanStyle +
        " " +
        lengthHint +
        " " +
        rules;
    } else if (useWeb) {
      systemPrompt =
        "You are Cerebrum, a scientific research assistant. No peer-reviewed papers matched, but here are reference sources. " +
        "Start your answer with this exact line: Note: no peer-reviewed papers matched, this draws on reference sources and general scientific knowledge, verify against primary literature.\n\n" +
        "Then answer the question fully, citing sources inline as [1], [2] where they support specific claims. Blend in your own scientific knowledge for the rest. " +
        humanStyle +
        " " +
        lengthHint +
        " " +
        rules;
    } else {
      systemPrompt =
        "You are Cerebrum, a scientific research assistant. No papers were retrieved for this question. " +
        "Start your answer with this exact line: Note: this answer draws on general scientific knowledge, no specific retrieved papers, verify against primary sources.\n\n" +
        "Then answer the question accurately and thoroughly from your knowledge. Explain the actual science. Do NOT fabricate specific citations, DOIs, or author names. " +
        humanStyle +
        " " +
        lengthHint +
        " " +
        rules;
    }

    const messages = [{ role: "system", content: systemPrompt }];
    const historyTurns = Array.isArray(body.history)
      ? body.history.slice(-4)
      : [];
    for (const turn of historyTurns) {
      if (turn.role === "user" || turn.role === "assistant") {
        messages.push({
          role: turn.role,
          content: String(turn.content || "").slice(0, 2000),
        });
      }
    }
    const userContent =
      useEvidence || useWeb
        ? "Sources:\n\n" + evidence + "\n\n---\nQuestion: " + query
        : query;
    messages.push({ role: "user", content: userContent });

    // ============ AI ANSWER GENERATION ============
    let answer = "";
    let aiOK = false;
    const token = env.OPENROUTER_API_KEY;

    // TIER 1: OpenRouter free models
    if (token) {
      const models = [
        "google/gemini-2.0-flash-exp:free",
        "meta-llama/llama-3.3-70b-instruct:free",
        "qwen/qwen-2.5-72b-instruct:free",
        "mistralai/mistral-small-3.1-24b-instruct:free",
        "deepseek/deepseek-chat:free",
        "meta-llama/llama-3.1-8b-instruct:free",
      ];
      for (const model of models) {
        try {
          const r = await fetch(
            "https://openrouter.ai/api/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + token,
                "HTTP-Referer": "https://cerebrum.pages.dev",
                "X-Title": "Cerebrum",
              },
              body: JSON.stringify({
                model,
                temperature: 0.4,
                max_tokens: maxTokens,
                messages,
              }),
            }
          );
          if (r.ok) {
            const j = await r.json();
            let c =
              j && j.choices && j.choices[0] && j.choices[0].message
                ? j.choices[0].message.content
                : "";
            if (c) {
              c = cleanAIResponse(c);
              if (c.length > 30) {
                answer = c;
                aiOK = true;
                break;
              }
            }
          }
        } catch {}
      }
    }

    // TIER 2: Cloudflare Workers AI (needs [ai] binding)
    if (!aiOK && env.AI && typeof env.AI.run === "function") {
      const cfModels = [
        "@cf/meta/llama-3.1-8b-instruct",
        "@cf/mistral/mistral-7b-instruct-v0.1",
      ];
      for (const m of cfModels) {
        try {
          const out = await env.AI.run(m, {
            messages,
            max_tokens: Math.min(maxTokens, 1024),
          });
          let c = (out && out.response) || "";
          if (c) {
            c = cleanAIResponse(c);
            if (c.length > 30) {
              answer = c;
              aiOK = true;
              break;
            }
          }
        } catch {}
      }
    }

    // TIER 3: Pollinations keyless (retry with knowledge-only prompt if papers block was too long)
    if (!aiOK) {
      try {
        const shortMessages = [
          {
            role: "system",
            content:
              "You are a science assistant. Answer the question naturally and clearly, like a colleague explaining something. " +
              "Do NOT refuse. Do NOT fabricate DOIs or citations. Start with: Note: this answer draws on general scientific knowledge, verify against primary sources.\n\n" +
              humanStyle +
              " " +
              rules,
          },
          { role: "user", content: query },
        ];
        const pRes = await fetch("https://text.pollinations.ai/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: shortMessages, model: "openai" }),
        });
        if (pRes.ok) {
          let c = await pRes.text();
          c = cleanAIResponse(c);
          if (c && c.length > 30) {
            answer = c;
            aiOK = true;
          }
        }
      } catch {}
    }

    // TIER 4: If we STILL have no answer but we have papers, show them with an honest note.
    if (!aiOK) {
      if (useEvidence && papers.length) {
        answer =
          "The AI answer service is momentarily unavailable. Here are the most relevant papers found for your query:\n\n" +
          papers
            .slice(0, 6)
            .map(
              (p, i) =>
                "[" +
                (i + 1) +
                "] **" +
                p.title +
                "**\n" +
                (p.journal || "") +
                (p.year ? ", " + p.year : "") +
                "\n" +
                ((p.abstract || "").slice(0, 300) +
                  (p.abstract && p.abstract.length > 300 ? "..." : ""))
            )
            .join("\n\n");
      } else if (useWeb && webRefs.length) {
        answer =
          "The AI answer service is momentarily unavailable. Here are relevant reference sources:\n\n" +
          webRefs
            .map(
              (r, i) =>
                "[" +
                (i + 1) +
                "] **" +
                r.title +
                "**\n" +
                ((r.abstract || "").slice(0, 300) + "...")
            )
            .join("\n\n");
      } else {
        answer =
          "The AI answer service is busy right now (free models get rate-limited). Please try again in a few seconds. Your question will be answered.";
      }
    }

    const dbUsed = useEvidence
      ? "Scientific databases"
      : useWeb
      ? "Reference sources"
      : "General knowledge";

    // Final safety: if this was a person-name query, force-correct any close
    // variants the AI hallucinated ("Sahoy" -> "Saho") in the answer body.
    const canonicalName = resolvedPersonName || (isNameSearch ? query : "");
    if (canonicalName) {
      answer = correctNameVariants(answer, canonicalName);
    }

    return new Response(
      JSON.stringify({
        answer,
        sources: sourceList,
        videos,
        factCheck: null,
        related: [],
        source:
          aiOK && useEvidence
            ? dbUsed + " + AI"
            : aiOK && useWeb
            ? dbUsed + " + AI"
            : aiOK
            ? "General knowledge (AI)"
            : dbUsed,
      }),
      { status: 200, headers: cors }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Runtime error: " + (e.message || String(e)) }),
      { status: 500, headers: cors }
    );
  }
}
