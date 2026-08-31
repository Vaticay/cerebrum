// functions/api/search.js
// Cerebrum backend - Cloudflare Pages Function.
// Full rewrite for stability. Queries scholarly databases in parallel,
// enforces strict timeouts to prevent 80-second latency hangs, 
// and synthesizes answers with aggressive formatting sanitization.

import {
  expandViaMesh,
  classifyStudyType,
  scoreJournalTier,
  predatoryPenalty,
  extractEntities,
  classifyResearchIntent,
  intentEvidenceBonus,
  detectStatisticalRigor,
  verifyAnswerAgainstSources,
} from "../lib/knowledge.js";
import { checkRateLimit } from "../lib/rateLimit.js";

// ============ CORE UTILITIES ============

function stripTags(s) {
  // Preserve <i>, <b>, <sub>, and <sup> so species names and formulas survive.
  // Strip all other HTML tags.
  return (s || "").replace(/<\/?(?!i|b|sub|sup\b)[a-z0-9]+[^>]*>/gi, "").replace(/\s+/g, " ").trim();
}

function decodeInverted(inv) {
  if (!inv) return "";
  const words = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) words[p] = word;
  }
  return words.join(" ").replace(/\s+/g, " ").trim();
}

function paperDedupeKey(p) {
  const url = (p && p.url) || "";
  const doiMatch = url.match(/doi\.org\/(.+)$/i);
  if (doiMatch && doiMatch[1]) return "doi:" + doiMatch[1].toLowerCase().replace(/\/+$/, "").trim();
  const pmidMatch = url.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i) || url.match(/europepmc\.org\/article\/med\/(\d+)/i);
  if (pmidMatch && pmidMatch[1]) return "pmid:" + pmidMatch[1];
  const pmcMatch = url.match(/ncbi\.nlm\.nih\.gov\/pmc\/articles\/(PMC\d+)/i);
  if (pmcMatch && pmcMatch[1]) return "pmc:" + pmcMatch[1].toLowerCase();
  const arxivMatch = url.match(/arxiv\.org\/abs\/([\d.]+)/i);
  if (arxivMatch && arxivMatch[1]) return "arxiv:" + arxivMatch[1];
  const title = ((p && p.title) || "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
  return title ? "title:" + title : "";
}

export const BLOCKED_DOMAINS = ["wwpdb.org", "zenodo", "dryad", "figshare", "osf.io", "clinicaltrials.gov", "data.mendeley.com"];
export const BLOCKED_TYPES = ["dataset", "component", "posted-content", "peer-review", "grant"];

function isNonLiterature(p) {
  const url = ((p && p.url) || "").toLowerCase();
  if (BLOCKED_DOMAINS.some((m) => url.includes(m))) return true;
  const rawType = ((p && p._rawType) || "").toLowerCase();
  if (rawType && BLOCKED_TYPES.some((m) => new RegExp("\\b" + m + "\\b").test(rawType))) return true;
  if ((p && p.type || "").toLowerCase() === "dataset") return true;
  return false;
}

const CACHE_SCHEMA_VERSION = "v7";
function versionedCacheKey(rawQuery) {
  return CACHE_SCHEMA_VERSION + "::" + (rawQuery || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

const POLITE_UA = "Cerebrum/1.0 (askcerebrum.org; a free scientific literature search; mailto:contact@askcerebrum.org)";

// LATENCY FIX: Max 4000ms timeout for downstream fetch to prevent total request failure.
async function getJSON(url, headers = {}, timeoutMs = 4000, retries = 0) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": POLITE_UA, Accept: "application/json", ...headers },
        signal: c.signal,
        cf: { cacheTtl: 60, cacheEverything: true },
      });
      clearTimeout(t);
      if (res.status === 429) throw new Error("HTTP 429 rate-limited");
      if (res.status >= 502 && res.status <= 504 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    } catch (e) {
      clearTimeout(t);
      if (attempt < retries) continue;
      throw e;
    }
  }
}

async function getText(url, headers = {}, timeoutMs = 4000, retries = 0) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": POLITE_UA, ...headers },
        signal: c.signal,
        cf: { cacheTtl: 60, cacheEverything: true },
      });
      clearTimeout(t);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    } catch (e) {
      clearTimeout(t);
      if (attempt < retries) continue;
      throw e;
    }
  }
}

async function checkRetraction(doi) {
  if (!doi) return { retracted: false, concern: false, updateType: null };
  try {
    const clean = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
    const res = await getJSON("https://api.crossref.org/works/" + encodeURIComponent(clean), {}, 2500);
    const msg = res && res.message;
    if (!msg) return { retracted: false, concern: false, updateType: null };
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

async function flagRetractions(papers, topN = 8) {
  const targets = papers.slice(0, topN).filter((p) => extractDoi(p.url));
  await Promise.allSettled(targets.map(async (p) => {
    const flag = await checkRetraction(extractDoi(p.url));
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
function stripFabricatedCitations(text, sourceCount) {
  if (!text) return text;
  let t = text.replace(/\[(\d+)\]\((?:https?:\/\/|#)[^\s)]+\)/g, "[$1]");
  t = t.replace(/\n[-—]{2,}\s*\n/g, "\n\n");
  t = t.replace(/\n\s*(references|sources|bibliography|citations|works cited)\s*:?\s*\n[\s\S]*$/i, "").trim();

  const linesForCite = t.split(/\n/);
  const citationLineRe = /^\s*\d{1,3}\.?\s+[A-Z][A-Za-zöäüéèçñ\-']+,\s+[A-Z]\./;
  let firstCiteLine = -1;
  for (let i = 0; i < linesForCite.length; i++) {
    if (citationLineRe.test(linesForCite[i])) { firstCiteLine = i; break; }
  }
  if (firstCiteLine !== -1 && linesForCite.slice(0, firstCiteLine).join("\n").length > t.length * 0.35) {
    t = linesForCite.slice(0, firstCiteLine).join("\n").trimEnd();
  }

  if (sourceCount === 0) {
    t = t.replace(/\n\s*(references|sources|bibliography|citations|works cited)\s*:?[\s\S]*$/i, "");
    const apaStart = /^\s*[A-Z][A-Za-zöäüéèçñ\-']+,\s+[A-Z]\.(?:\s?[A-Z]\.)?(?:\s*,\s*(?:&|and)?\s*[A-Z][A-Za-zöäüéèçñ\-']+,\s+[A-Z]\.(?:\s?[A-Z]\.)?)*.*\(\d{4}\)/;
    let firstBibLine = -1;
    const lines = t.split(/\n/);
    for (let i = 0; i < lines.length; i++) {
      if (apaStart.test(lines[i])) { firstBibLine = i; break; }
    }
    if (firstBibLine !== -1 && lines.slice(0, firstBibLine).join("\n").length > t.length * 0.4) {
      t = lines.slice(0, firstBibLine).join("\n").trimEnd();
    }
  }

  t = t.replace(/\[(\d{1,3})\]/g, (m, n) => {
    const idx = parseInt(n, 10);
    if (sourceCount === 0 || idx < 1 || idx > sourceCount) return "";
    return m;
  });

  if (sourceCount === 0) {
    t = t.replace(/\((?:[A-Z][A-Za-z\-']+(?:,| &| and|\set al\.?)?[\s,]*){1,4}\d{4}[a-z]?\)/g, "");
    const refPattern = /(?:[A-Z][a-zA-Z\-']+,\s+[A-Z]\.(?:\s*[A-Z]\.)*(?:,\s*(?:&\s+)?[A-Z][a-zA-Z\-']+,\s+[A-Z]\.(?:\s*[A-Z]\.)*)*)\s*\(\d{4}[a-z]?\)\.\s*[^.]{5,120}?\.(?:\s*[^.]{3,80}?,\s*\d+(?:\(\d+\))?,\s*\d+[-–]\d+\.)?/g;
    for (let pass = 0; pass < 6; pass++) {
      const before = t;
      t = t.replace(refPattern, "");
      if (t === before) break;
    }
    t = t.replace(/\b[A-Z][a-zA-Z\-']+\s+et\s+al\.\s*\(\d{4}[a-z]?\)/g, "");
    t = t.replace(/(?:^|\s)According to\s+[A-Z][a-zA-Z\-']+(?:\s+(?:and|&)\s+[A-Z][a-zA-Z\-']+)?\s*\(\d{4}[a-z]?\)\s*,\s*/gi, " ");
    t = t.replace(/([a-z])\s*[\u00b9\u00b2\u00b3\u2070-\u2079]/g, "$1");
    const proseRefs = [
      /\b(?:a|an|one)\s+\d{4}\s+(?:study|paper|article|report|review|analysis)\s+(?:published\s+)?(?:in\s+(?:the\s+)?(?:journal\s+)?[A-Z][A-Za-z&.\s]{2,60}?\s+)?(?:reported|found|showed|demonstrated|revealed|concluded|suggested)\s+that\s+/gi,
      /\b(?:a|an|one)\s+(?:study|paper|article|report|review)\s+published\s+in\s+(?:the\s+)?(?:journal\s+)?[A-Z][A-Za-z&.\s]{2,60}?\s+(?:reported|found|showed|demonstrated|revealed|concluded|suggested)\s+that\s+/gi,
      /\baccording\s+to\s+(?:a|an|the)\s+(?:\d{4}\s+)?(?:study|paper|article|report|review)\s+(?:published\s+)?in\s+(?:the\s+)?(?:journal\s+)?[A-Z][A-Za-z&.\s]{2,60}?,\s*/gi,
      /\bresearch\s+published\s+in\s+(?:the\s+)?(?:journal\s+)?[A-Z][A-Za-z&.\s]{2,60}?(?:\s+in\s+\d{4})?\s+(?:reported|found|showed|demonstrated|revealed)\s+(?:that\s+)?/gi,
    ];
    for (const re of proseRefs) { t = t.replace(re, ""); }
    t = t.replace(/(^|[.!?]\s+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
  }
  t = t.replace(/[ \t]{2,}/g, " ");
  t = t.replace(/\s+([.,;:!?])/g, "$1");
  t = t.replace(/([.,;:])\1+/g, "$1");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

function correctNameVariants(text, canonicalName) {
  if (!text || !canonicalName) return text;
  const tokens = canonicalName.trim().split(/\s+/);
  let out = text;
  for (const token of tokens) {
    if (token.length < 3) continue;
    const stem = token.slice(0, 3);
    const min = Math.max(3, token.length - 1);
    const max = token.length + 3;
    const re = new RegExp(`\\b(${stem}[a-zA-Z]{${min - 3},${max - 3}})\\b`, "g");
    out = out.replace(re, (match) => {
      if (match.toLowerCase() === token.toLowerCase()) return match;
      return token.charAt(0).toUpperCase() + token.slice(1);
    });
  }
  return out;
}

function cleanAIResponse(raw) {
  if (!raw) return "";
  let c = raw;
  c = c.replace(/<think>[\s\S]*?<\/think>/gi, "");
  c = c.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  c = c.replace(/<internal>[\s\S]*?<\/internal>/gi, "");
  c = c.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "");
  c = c.replace(/<planning>[\s\S]*?<\/planning>/gi, "");
  c = c.replace(/^```(?:markdown)?\s*\n([\s\S]*?)\n```\s*$/i, "$1");
  c = c.replace(/^\s*User Safety:\s*safe\.?\s*/gim, "");
  c = c.replace(/^\s*\[?(Safety|Content|Compliance)\s*(Rating|Check|Assessment)[:\s]*\w+\]?\s*/gim, "");

  const badOpeners = [
    /^the user is asking/i, /^the user wants/i, /^the user('s)? question/i,
    /^let me review/i, /^let me check/i, /^let me think/i, /^let me analyze/i,
    /^let me examine/i, /^let me look at/i, /^i need to provide/i, /^i'll write/i,
    /^i will now/i, /^i will provide/i, /^i will analyze/i, /^let's analyze/i,
    /^let's examine/i, /^let's look at/i, /^let's review/i, /^here is a summary of the papers/i,
    /^here is (a|the|my) (comprehensive|detailed|thorough)/i, /^here is what (we|the|i) know/i,
    /^first,? i'll/i, /^first,? let me/i, /^first,? let's/i, /^okay,? let me/i,
    /^to answer this/i, /^to address this/i, /^to respond to/i, /^now we need to/i,
    /^now,? let me/i, /^based on the (provided|available|given) (sources|papers|literature|research|evidence)/i,
    /^the (provided|available|given) (sources|papers|literature|research|evidence)/i,
    /^looking at the (provided|available|given)/i, /^after (reviewing|examining|analyzing|reading)/i,
    /^having (reviewed|examined|analyzed|read)/i, /^upon (reviewing|examining|analyzing|reading)/i,
    /^the research (shows|indicates|suggests|demonstrates)/i, /^the (available )?literature (shows|indicates|suggests|demonstrates)/i,
    /^several studies/i, /^the available evidence/i, /^recent research/i, /^according to the sources/i,
  ];

  c = c.replace(/^\s*(that'?s (correct|right)[,.]?\s*)?(cerebrum here|as cerebrum|i'?m cerebrum|this is cerebrum)[,.!]?\s*/i, "");
  c = c.replace(/^\s*(great|good|excellent|interesting|wonderful|fantastic)\s+question[,.!]?\s*/i, "");
  c = c.replace(/^\s*(sure|certainly|absolutely|of course|indeed)[,.!]\s*/i, "");
  c = c.replace(/^\s*that'?s (correct|right|a great|an excellent|an interesting)[,.]\s+/i, "");
  c = c.replace(/^\s*thank you for (your|the|this)\s+/i, "");
  const paras = c.split(/\n{2,}/);
  while (paras.length > 1) {
    const first = paras[0].trim();
    if (badOpeners.some((re) => re.test(first))) paras.shift();
    else break;
  }
  c = paras.join("\n\n").trim();
  c = c.replace(/^(here is the answer|here's the answer|here's my (analysis|response|answer))[:\.]?\s*/i, "").trim();
  c = c.replace(/^(to summarize|to sum up|in short)[,:]?\s*/i, "").trim();
  c = c.replace(/^(paper\s+\d+[:\s][^\n]+\n+){2,}/i, "").trim();
  c = c.replace(/^(source\s+\[\d+\][:\s][^\n]+\n+){2,}/i, "").trim();
  c = c.replace(/\n\n(In conclusion|In summary|To conclude|To summarize|Overall),?\s+[^\n]+$/i, "").trim();
  c = c.replace(/\n\n(?:It(?:'s| is) (?:important|worth|crucial) to (?:note|mention|emphasize) that|Please (?:note|consult|be aware)|Note: |Disclaimer:)[^\n]+$/i, "").trim();
  c = c.replace(/\n\n(?:Sources? (?:used|cited|referenced|consulted):?\s*\n(?:\s*\[?\d+\]?[^\n]+\n?)+)$/i, "").trim();
  c = c.replace(/\n\n?(?:I hope this (?:helps|answers|provides|clarifies)|Let me know if you (?:have|need|want|would like)|Feel free to (?:ask|reach|let me know)|Happy to (?:elaborate|explain|help))[^\n]*$/i, "").trim();

  return c;
}

const INTENT_WORDS = new Set(["raise", "raises", "raising", "argue", "argues", "arguing", "suggest", "suggests", "caution", "cautions", "warn", "warns", "warning", "critique", "critiques", "review", "reviews", "reviewing", "discuss", "discusses", "discussing", "papers", "paper", "article", "articles", "study", "studies", "work", "works", "recommend", "recommends", "propose", "proposes", "consider", "considers", "using", "used", "use", "uses", "usage", "applying", "apply", "about", "regarding", "concerning", "against", "with", "without", "against", "toward", "towards", "on", "turning", "turn", "turned", "turns", "convert", "converting", "converted", "transform", "transforming", "transformed", "make", "making", "create", "creating", "produce", "producing", "produced", "into", "from"]);

const SPELLING_CORRECTIONS = {
  "occurance": "occurrence", "occurances": "occurrences",
  "co-occurance": "co-occurrence", "cooccurance": "co-occurrence",
  "cooccurrence": "co-occurrence",
  "seperate": "separate", "recieve": "receive", "acheive": "achieve",
  "definately": "definitely", "occured": "occurred",
  "flourescent": "fluorescent", "flourescence": "fluorescence",
  "phylogenic": "phylogenetic", "millenia": "millennia",
  "existance": "existence", "concious": "conscious",
  "genomewide": "genome-wide", "genemwide": "genome-wide",
  "microbiom": "microbiome",
  "decomp": "decomposition", "biodegredation": "biodegradation",
  "photosythesis": "photosynthesis", "photosynthisis": "photosynthesis",
  "mitocondria": "mitochondria", "mitocondrial": "mitochondrial",
  "enviroment": "environment", "enviromental": "environmental",
  "resistnace": "resistance", "resistence": "resistance",
  "palstic": "plastic", "platsic": "plastic",
  "anlaysis": "analysis", "anaylsis": "analysis",
  "calicification": "calcification", "calcificaiton": "calcification",
  "neruon": "neuron", "nuerotransmitter": "neurotransmitter",
  "protien": "protein", "protiens": "proteins",
  "bateria": "bacteria", "baterium": "bacterium",
  "symbotic": "symbiotic",
  "metabalic": "metabolic", "metablism": "metabolism",
  "pathogensis": "pathogenesis", "carcinognesis": "carcinogenesis",
};

const SCIENTIFIC_COMPOUNDS = [
  [/\bco[\s-]?occurr?ence[s]?\b/gi, "co-occurrence"],
  [/\bmachine[\s-]?learning\b/gi, "machine-learning"],
  [/\bdeep[\s-]?learning\b/gi, "deep-learning"],
  [/\bgene[\s-]?expression\b/gi, "gene-expression"],
  [/\bwhole[\s-]?genome\b/gi, "whole-genome"],
  [/\bhigh[\s-]?throughput\b/gi, "high-throughput"],
  [/\bnext[\s-]?generation\b/gi, "next-generation"],
  [/\bcell[\s-]?free\b/gi, "cell-free"],
  [/\bsingle[\s-]?cell\b/gi, "single-cell"],
  [/\bloss[\s-]?of[\s-]?function\b/gi, "loss-of-function"],
  [/\bgain[\s-]?of[\s-]?function\b/gi, "gain-of-function"],
  [/\bin[\s-]?vivo\b/gi, "in-vivo"],
  [/\bin[\s-]?vitro\b/gi, "in-vitro"],
  [/\bin[\s-]?silico\b/gi, "in-silico"],
  [/\bdouble[\s-]?stranded?\b/gi, "double-stranded"],
  [/\bsingle[\s-]?stranded?\b/gi, "single-stranded"],
  [/\blong[\s-]?non[\s-]?coding\b/gi, "long-non-coding"],
  [/\banti[\s-]?microbial\b/gi, "antimicrobial"],
  [/\banti[\s-]?biotic\b/gi, "antibiotic"],
  [/\banti[\s-]?fungal\b/gi, "antifungal"],
  [/\banti[\s-]?viral\b/gi, "antiviral"],
  [/\banti[\s-]?oxidant\b/gi, "antioxidant"],
  [/\banti[\s-]?inflammatory\b/gi, "anti-inflammatory"],
  [/\bmulti[\s-]?drug\b/gi, "multidrug"],
  [/\bmulti[\s-]?omics\b/gi, "multi-omics"],
  [/\bcrispr[\s-]?cas9?\b/gi, "CRISPR-Cas9"],
  [/\bopen[\s-]?access\b/gi, "open-access"],
  [/\blong[\s-]?term\b/gi, "long-term"],
  [/\bshort[\s-]?term\b/gi, "short-term"],
  [/\bdose[\s-]?response\b/gi, "dose-response"],
  [/\bex[\s-]?vivo\b/gi, "ex-vivo"],
  [/\bde[\s-]?novo\b/gi, "de-novo"],
  [/\bgut[\s-]?brain\b/gi, "gut-brain"],
  [/\bblood[\s-]?brain[\s-]?barrier\b/gi, "blood-brain-barrier"],
  [/\bhost[\s-]?pathogen\b/gi, "host-pathogen"],
  [/\bstructure[\s-]?activity\b/gi, "structure-activity"],
  [/\bgenome[\s-]?editing\b/gi, "genome-editing"],
  [/\bstem[\s-]?cell\b/gi, "stem-cell"],
];

function preprocessQuery(raw) {
  let q = " " + (raw || "").toLowerCase() + " ";
  q = " " + correctBinomialTypos(q.trim()) + " ";
  const words = q.split(/(\s+)/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^a-z-]/g, "");
    if (w && SPELLING_CORRECTIONS[w]) {
      words[i] = words[i].replace(w, SPELLING_CORRECTIONS[w]);
    }
  }
  q = words.join("");
  for (const [re, canonical] of SCIENTIFIC_COMPOUNDS) {
    q = q.replace(re, canonical);
  }
  const PARAPHRASES = [
    [/turning\s+air\s+into/gi, "CO2 conversion to"],
    [/air\s+(?:to|into)\s+(ethanol|fuel|methanol|plastic)/gi, "CO2 conversion to $1"],
    [/(ethanol|fuel|methanol)\s+from\s+air/gi, "$1 from CO2 atmospheric carbon capture"],
    [/cure\s+(?:for\s+)?cancer/gi, "cancer treatment therapy"],
    [/cure\s+(?:for\s+)?alzheimer/gi, "Alzheimer disease treatment therapy"],
    [/global\s+warming/gi, "climate change anthropogenic warming"],
    [/how\s+(?:does|do)\s+(.+?)\s+work/gi, "$1 mechanism"],
    [/what\s+causes?\s+(.+?)(?:\?|$)/gi, "$1 etiology mechanism cause"],
    [/not\s+need\s+(?:it|photosynthesis|sunlight|light)/gi, "non-photosynthetic heterotrophic mycoheterotrophic parasitic"],
    [/without\s+(?:photosynthesis|sunlight|light)/gi, "non-photosynthetic heterotrophic"],
    [/(?:go|went)\s+extinct/gi, "extinction cause"],
    [/why\s+(?:do|did)\s+dinosaurs?\s+(?:go|die)/gi, "dinosaur extinction Cretaceous-Paleogene"],
    [/cure\s+(?:for\s+)?diabetes/gi, "diabetes treatment therapy glycemic control"],
    [/cure\s+(?:for\s+)?parkinson/gi, "Parkinson disease treatment therapy neuroprotection"],
    [/cure\s+(?:for\s+)?depression/gi, "major depressive disorder treatment antidepressant therapy"],
    [/side\s+effects?\s+of\s+(.+?)(?:\?|$)/gi, "$1 adverse effects toxicity safety"],
    [/is\s+(.+?)\s+safe/gi, "$1 safety toxicity adverse effects"],
    [/(?:good|bad)\s+(?:for\s+)?(?:your?\s+)?health/gi, "health effects benefits risks"],
    [/what\s+(?:does|do)\s+(.+?)\s+do\s+(?:to|in|for)\s+(?:the\s+)?body/gi, "$1 physiological effects mechanism of action"],
    [/how\s+is\s+(.+?)\s+made/gi, "$1 biosynthesis production pathway"],
    [/gene\s+for\s+(.+?)(?:\?|$)/gi, "$1 genetic basis gene locus"],
    [/is\s+(.+?)\s+(?:hereditary|genetic|inherited)/gi, "$1 heritability genetic predisposition inheritance"],
    [/how\s+(?:does|do)\s+(?:the\s+)?brain\s+(.+?)(?:\?|$)/gi, "brain $1 neural mechanism neuroscience"],
    [/what\s+happens?\s+(?:to|in)\s+(?:the\s+)?brain\s+(?:when|during)\s+(.+?)(?:\?|$)/gi, "brain $1 neural activity neurophysiology"],
    [/(?:good|beneficial)\s+bacteria/gi, "probiotic commensal microbiome beneficial microbiota"],
    [/(?:bad|harmful)\s+bacteria/gi, "pathogenic bacteria virulence infection"],
    [/superbugs?/gi, "antimicrobial resistance multidrug-resistant bacteria"],
    [/(?:save|saving)\s+(?:the\s+)?(?:planet|earth|environment)/gi, "environmental conservation sustainability"],
    [/clean\s+energy/gi, "renewable energy solar wind sustainable"],
    [/greenhouse\s+gas(?:es)?/gi, "greenhouse gas emissions CO2 methane climate"],
  ];
  for (const [re, repl] of PARAPHRASES) {
    q = q.replace(re, repl);
  }
  return q.trim();
}

const GENERIC_SCIENCE_WORDS = new Set([
  "types", "type", "kinds", "kind", "sort", "sorts", "form", "forms",
  "compound", "compounds", "substance", "substances", "material", "materials",
  "capitalize", "utilize", "utilise", "leverage", "involve", "involves",
  "process", "processes", "method", "methods", "approach", "approaches",
  "effect", "effects", "impact", "impacts", "influence", "role", "roles",
  "function", "functions", "mechanism", "mechanisms", "system", "systems",
  "factor", "factors", "level", "levels", "amount", "amounts", "rate", "rates",
  "result", "results", "outcome", "outcomes", "finding", "findings",
  "study", "studies", "research", "paper", "papers", "article", "articles",
  "analysis", "data", "evidence", "review", "reviews", "report", "reports",
  "different", "various", "several", "many", "much", "high", "low", "large",
  "small", "new", "novel", "recent", "current", "important", "significant",
  "possible", "potential", "specific", "general", "common", "main", "major",
  "help", "helps", "make", "makes", "made", "get", "gets", "give", "gives",
  "produce", "produces", "produced", "production",
  "related", "associated", "based", "including", "such", "well", "known",
  "information", "info", "detail", "details", "aspect", "aspects",
  "question", "answer", "example", "examples", "case", "cases",
  "air", "water", "light", "heat", "cold", "food", "plant", "plants",
  "time", "life", "cell", "cells", "model", "models", "group", "groups",
]);

const CONCEPT_GROUPS = [
  ["plastic", "plastics", "polymer", "polymers", "polyethylene", "polystyrene", "polypropylene", "polyurethane", "pvc", "pet", "ldpe", "hdpe", "microplastic", "microplastics", "nanoplastic", "nanoplastics", "polyolefin"],
  ["insect", "insects", "larva", "larvae", "larval", "worm", "worms", "caterpillar", "grub", "mealworm", "waxworm", "galleria", "tenebrio", "hermetia", "zophobas", "beetle", "moth", "fly", "arthropod", "arthropods", "entomological"],
  ["microbe", "microbes", "microbial", "microbiome", "microbiota", "bacteria", "bacterial", "bacterium", "gut flora", "microflora", "symbiont", "symbionts", "microorganism", "microorganisms"],
  ["enzyme", "enzymes", "enzymatic", "oxidase", "oxidases", "hydrolase", "hydrolases", "esterase", "esterases", "cutinase", "lipase", "protease", "depolymerase", "oxidoreductase", "oxidoreductases", "phenoloxidase", "laccase", "peroxidase"],
  ["degrade", "degradation", "degrading", "biodegradation", "biodegrade", "breakdown", "depolymerization", "depolymerisation", "catabolism", "decompose", "decomposition", "oxidation", "oxidize", "oxidise", "oxidative"],
  ["gut", "intestinal", "intestine", "digestive", "midgut", "hindgut", "foregut", "gastrointestinal", "alimentary", "crop", "proventriculus", "peritrophic membrane", "alimentary canal", "digestive tract"],
  ["saliva", "salivary", "secretion", "secretions", "oral", "labial"],
  ["cancer", "tumour", "tumor", "carcinoma", "neoplasm", "oncology", "malignant"],
  ["gene", "genes", "genetic"],
  ["genome", "genomic", "genomics"],
  ["transcript", "transcripts", "transcriptome", "transcriptomic"],
  ["transposon", "transposons", "transposable element", "transposable elements", "plasmid", "plasmids", "horizontal gene transfer", "prophage", "prophages", "insertion sequence", "insertion sequences", "integron", "integrons", "conjugative transposon", "mobile genetic element", "mobile genetic elements", "bacteriophage", "bacteriophages", "phage", "phages"],
  ["protein", "proteins", "proteomic", "peptide", "peptides", "polypeptide"],
  ["climate", "warming", "temperature", "thermal", "heat"],
  ["neuron", "neurons", "neural", "neuronal", "brain", "cortical", "cerebral"],
  ["ecology", "ecological", "ecosystem", "ecosystems", "community", "communities", "biodiversity", "species richness", "assemblage"],
  ["network", "networks", "co-occurrence", "cooccurrence", "interaction", "interactions", "graph", "connectivity", "modularity"],
  ["soil", "soils", "edaphic", "rhizosphere", "pedosphere", "substrate"],
  ["ocean", "oceanic", "marine", "sea", "seawater", "pelagic", "benthic"],
  ["coral", "corals", "reef", "reefs", "calcification", "bleaching"],
  ["forest", "forests", "woodland", "canopy", "tree", "trees", "silviculture"],
  ["mutation", "mutations", "variant", "variants", "polymorphism", "snp", "indel"],
  ["expression", "transcription", "regulation", "promoter", "enhancer", "silencer"],
  ["antibody", "antibodies", "immunoglobulin", "antigen", "epitope"],
  ["vaccine", "vaccines", "vaccination", "immunization", "adjuvant"],
  ["virus", "viruses", "viral", "virology", "pathogen", "infection", "infectious"],
  ["nanoparticle", "nanoparticles", "nanostructure", "nanomaterial", "quantum dot"],
  ["catalyst", "catalysts", "catalysis", "catalytic", "photocatalyst", "electrocatalyst"],
  ["ethanol", "ethyl alcohol", "bioethanol", "alcohol", "fermentation"],
  ["co2", "carbon dioxide", "carbon capture", "atmospheric carbon", "carbon fixation"],
  ["conversion", "synthesis", "catalysis", "electrochemical", "electrolysis", "reduction", "oxidation", "transformation"],
  ["decomposition", "decompose", "decay", "necrobiome", "cadaver", "carcass", "putrefaction", "autolysis", "bloat", "rupture"],
  ["photosynthesis", "photosynthetic", "chloroplast", "chlorophyll", "light reactions", "dark reactions", "calvin cycle", "rubisco", "carbon fixation", "thylakoid", "photosystem", "photoautotroph", "c3", "c4", "cam"],
  ["parasitic", "parasite", "mycoheterotroph", "mycoheterotrophic", "holoparasite", "hemiparasite", "heterotroph", "heterotrophic", "non-photosynthetic", "achlorophyllous"],
  ["abundance", "diversity", "richness", "composition", "community structure", "alpha diversity", "beta diversity", "evenness", "dominance"],
  ["evolution", "evolutionary", "phylogenetic", "phylogeny", "adaptation", "selection", "speciation", "divergence", "convergent"],
  ["immune", "immunity", "innate immunity", "adaptive immunity", "inflammatory", "inflammation", "cytokine", "chemokine", "lymphocyte"],
  ["stem cell", "stem cells", "pluripotent", "multipotent", "ipsc", "ips cell", "embryonic stem cell", "progenitor", "differentiation", "reprogramming"],
  ["epigenetic", "epigenetics", "methylation", "histone", "chromatin", "acetylation", "imprinting", "epigenome", "chromatin remodeling"],
  ["drug", "drugs", "pharmaceutical", "pharmacological", "therapeutic", "therapy", "treatment", "medication", "compound", "inhibitor"],
  ["apoptosis", "apoptotic", "programmed cell death", "necrosis", "necroptosis", "pyroptosis", "ferroptosis", "autophagy", "autophagic", "cell death"],
  ["metabolism", "metabolic", "metabolite", "metabolites", "metabolome", "glycolysis", "krebs cycle", "tca cycle", "oxidative phosphorylation", "fatty acid oxidation", "beta oxidation"],
  ["aging", "ageing", "senescence", "senescent", "longevity", "lifespan", "telomere", "telomerase", "gerontology"],
  ["biofilm", "biofilms", "quorum sensing", "planktonic", "sessile", "extracellular polymeric substance", "eps", "biofouling"],
  ["antibiotic resistance", "antimicrobial resistance", "amr", "multidrug resistant", "mdr", "drug resistant", "beta-lactamase", "efflux pump", "resistance gene"],
  ["crispr", "cas9", "cas12", "cas13", "gene editing", "genome editing", "guide rna", "sgrna", "base editing", "prime editing"],
  ["microscopy", "microscope", "imaging", "fluorescence", "confocal", "electron microscopy", "sem", "tem", "super-resolution", "cryo-em"],
  ["bioinformatics", "computational biology", "sequence analysis", "alignment", "phylogenetics", "homology", "blast", "pipeline", "annotation"],
  ["diabetes", "diabetic", "insulin", "glucose", "glycemic", "hyperglycemia", "type 2 diabetes", "type 1 diabetes", "insulin resistance", "metabolic syndrome"],
  ["cardiovascular", "cardiac", "heart", "myocardial", "coronary", "atherosclerosis", "hypertension", "ischemia", "arrhythmia"],
  ["lung", "lungs", "pulmonary", "respiratory", "airway", "alveolar", "bronchial", "asthma", "copd", "pneumonia"],
  ["gut-brain", "gut brain axis", "microbiome brain", "enteric nervous system", "vagus nerve", "psychobiotic", "neuroinflammation"],
  ["nutrition", "nutritional", "dietary", "diet", "nutrient", "nutrients", "bioavailability", "fortification", "supplementation", "nutraceutical"],
];

const CONCEPT_LOOKUP = (() => {
  const map = new Map();
  for (const group of CONCEPT_GROUPS) {
    const set = new Set(group);
    for (const t of group) map.set(t, set);
  }
  return map;
})();

function termSpecificity(term) {
  if (GENERIC_SCIENCE_WORDS.has(term)) return 0.15;
  if (INTENT_WORDS.has(term)) return 0.2;
  let score = 0.5;
  if (term.length >= 10) score += 0.3;
  else if (term.length >= 7) score += 0.2;
  else if (term.length <= 4) score -= 0.1;
  if (CONCEPT_LOOKUP.has(term)) score += 0.35;
  if (/(ase|ome|itis|osis|genic|troph|phyll|plast|cyte|blast|lysis|philic|phobic)$/.test(term)) score += 0.3;
  if (/\d/.test(term) && /[a-z]/.test(term)) score += 0.4;
  if (SYNONYMS[term]) score += 0.4;
  if (term.length <= 5 && !COMMON_SHORT_WORDS.has(term)) score += 0.25;
  return Math.min(1, score);
}

const COMMON_SHORT_WORDS = new Set([
  "have", "them", "make", "made", "take", "give", "come", "know", "think",
  "want", "need", "find", "show", "tell", "work", "call", "keep", "help",
  "good", "bad", "best", "worst", "more", "less", "many", "much", "very",
  "also", "even", "just", "only", "well", "back", "down", "over", "same",
  "like", "than", "then", "when", "what", "does", "did", "was", "were",
  "any", "all", "some", "each", "both", "few", "own", "such", "why", "how",
]);

const SYNONYMS = {
  bsfl: ["black soldier fly larvae", "hermetia illucens"],
  bsf: ["black soldier fly", "hermetia illucens"],
  "black soldier fly": ["hermetia illucens"],
  "black soldier fly larvae": ["hermetia illucens"],
  "black soldier fly larva": ["hermetia illucens"],
  "fruit fly": ["drosophila melanogaster"],
  "house mouse": ["mus musculus"],
  "lab rat": ["rattus norvegicus"],
  "lab mouse": ["mus musculus"],
  "roundworm": ["caenorhabditis elegans"],
  "zebrafish": ["danio rerio"],
  "honey bee": ["apis mellifera"],
  "honey bees": ["apis mellifera"],
  "honeybee": ["apis mellifera"],
  "honeybees": ["apis mellifera"],
  "baker's yeast": ["saccharomyces cerevisiae"],
  "brewer's yeast": ["saccharomyces cerevisiae"],
  "e coli": ["escherichia coli"],
  "e. coli": ["escherichia coli"],
  "staph": ["staphylococcus aureus"],
  "mrsa": ["methicillin-resistant staphylococcus aureus"],
  "tb": ["mycobacterium tuberculosis"],
  "malaria": ["plasmodium falciparum"],
  crispr: ["clustered regularly interspaced short palindromic repeats", "cas9", "gene editing"],
  pcr: ["polymerase chain reaction"],
  qpcr: ["quantitative pcr", "real-time pcr", "rt-pcr", "quantitative polymerase chain reaction"],
  "rt-pcr": ["reverse transcription pcr", "qpcr", "real-time pcr"],
  dna: ["deoxyribonucleic acid"],
  rna: ["ribonucleic acid"],
  mrna: ["messenger rna", "messenger ribonucleic acid"],
  sirna: ["small interfering rna"],
  mirna: ["microrna", "micro rna"],
  utr: ["untranslated region"],
  orf: ["open reading frame"],
  gwas: ["genome wide association study", "genome-wide association"],
  qtl: ["quantitative trait loci", "quantitative trait locus"],
  snp: ["single nucleotide polymorphism"],
  ros: ["reactive oxygen species", "oxidative stress", "free radicals"],
  er: ["endoplasmic reticulum"],
  atp: ["adenosine triphosphate"],
  ecm: ["extracellular matrix"],
  tcr: ["t cell receptor"],
  bcr: ["b cell receptor"],
  mhc: ["major histocompatibility complex", "hla"],
  hla: ["human leukocyte antigen", "mhc"],
  llps: ["liquid liquid phase separation", "biomolecular condensate"],
  pet: ["polyethylene terephthalate", "positron emission tomography"],
  pe: ["polyethylene"],
  pp: ["polypropylene"],
  nad: ["nicotinamide adenine dinucleotide"],
  fad: ["flavin adenine dinucleotide"],
  car: ["chimeric antigen receptor"],
  "car-t": ["chimeric antigen receptor t cell", "car t cell therapy"],
  tnf: ["tumor necrosis factor"],
  il: ["interleukin"],
  ifn: ["interferon"],
  gaba: ["gamma aminobutyric acid"],
  nmda: ["n-methyl-d-aspartate"],
  ltp: ["long term potentiation"],
  ltd: ["long term depression"],
  fmri: ["functional magnetic resonance imaging", "functional mri"],
  eeg: ["electroencephalography", "electroencephalogram"],
  cfu: ["colony forming units", "colony forming unit"],
  otu: ["operational taxonomic unit"],
  asv: ["amplicon sequence variant"],
  "16s": ["16s rrna", "16s ribosomal rna", "16s rdna"],
  npp: ["net primary productivity", "net primary production"],
  lai: ["leaf area index"],
  ndvi: ["normalized difference vegetation index"],
  bmi: ["body mass index"],
  bp: ["blood pressure"],
  ldl: ["low density lipoprotein"],
  hdl: ["high density lipoprotein"],
  copd: ["chronic obstructive pulmonary disease"],
  nafld: ["non-alcoholic fatty liver disease"],
  nsaid: ["nonsteroidal anti-inflammatory drug"],
  ssri: ["selective serotonin reuptake inhibitor"],
  ace: ["angiotensin converting enzyme"],
  elisa: ["enzyme-linked immunosorbent assay"],
  "western blot": ["immunoblot", "protein blot"],
  "flow cytometry": ["facs", "fluorescence activated cell sorting"],
  facs: ["flow cytometry", "fluorescence activated cell sorting"],
  "mass spec": ["mass spectrometry", "ms", "proteomics"],
  rnaseq: ["rna sequencing", "rna-seq", "transcriptomics"],
  "rna-seq": ["rna sequencing", "rnaseq", "transcriptomics"],
  chipseq: ["chip-seq", "chromatin immunoprecipitation sequencing"],
  atacseq: ["atac-seq", "assay for transposase accessible chromatin"],
  metabolomics: ["metabolome", "metabolite profiling"],
  proteomics: ["proteome", "protein profiling", "mass spectrometry"],
  metagenomics: ["metagenomic", "shotgun sequencing", "microbiome sequencing"],
  "thale cress": ["arabidopsis thaliana"],
  "arabidopsis": ["arabidopsis thaliana"],
  "nematode": ["caenorhabditis elegans"],
  "corn": ["zea mays", "maize"],
  "maize": ["zea mays"],
  "rice": ["oryza sativa"],
  "wheat": ["triticum aestivum"],
  "tobacco": ["nicotiana tabacum"],
  "tomato": ["solanum lycopersicum"],
  "potato": ["solanum tuberosum"],
  "soybean": ["glycine max"],
  "cotton": ["gossypium hirsutum"],
  "silkworm": ["bombyx mori"],
  "mosquito": ["aedes aegypti", "anopheles gambiae"],
  "frog": ["xenopus laevis"],
  "chicken": ["gallus gallus"],
  "pig": ["sus scrofa"],
  "cow": ["bos taurus"],
  "sheep": ["ovis aries"],
  "dog": ["canis lupus familiaris"],
  "cat": ["felis catus"],
  "chimpanzee": ["pan troglodytes"],
  "rhesus macaque": ["macaca mulatta"],
  "cryo-em": ["cryo-electron microscopy", "cryogenic electron microscopy"],
  "nmr": ["nuclear magnetic resonance", "nuclear magnetic resonance spectroscopy"],
  "xrd": ["x-ray diffraction", "x-ray crystallography"],
  "sem": ["scanning electron microscopy", "scanning electron microscope"],
  "tem": ["transmission electron microscopy", "transmission electron microscope"],
  "afm": ["atomic force microscopy", "atomic force microscope"],
  "spd": ["severe plastic deformation"],
  "hplc": ["high performance liquid chromatography"],
  "gc-ms": ["gas chromatography mass spectrometry"],
  "lc-ms": ["liquid chromatography mass spectrometry"],
  "icp-ms": ["inductively coupled plasma mass spectrometry"],
  "xps": ["x-ray photoelectron spectroscopy"],
  "rct": ["randomized controlled trial", "randomised controlled trial"],
  "icu": ["intensive care unit"],
  "cbc": ["complete blood count"],
  "ct scan": ["computed tomography"],
  "mri": ["magnetic resonance imaging"],
  "pet scan": ["positron emission tomography"],
  "ecg": ["electrocardiogram", "electrocardiography"],
  "ekg": ["electrocardiogram", "electrocardiography"],
  "gfr": ["glomerular filtration rate"],
  "hba1c": ["glycated hemoglobin", "hemoglobin a1c"],
  "alt": ["alanine aminotransferase", "alanine transaminase"],
  "ast": ["aspartate aminotransferase", "aspartate transaminase"],
  "crp": ["c-reactive protein"],
  "esr": ["erythrocyte sedimentation rate"],
  "psa": ["prostate specific antigen"],
  "pdb": ["protein data bank"],
  "go": ["gene ontology"],
  "kegg": ["kyoto encyclopedia of genes and genomes"],
  "ncbi": ["national center for biotechnology information"],
  "gis": ["geographic information system", "geospatial"],
  "enso": ["el nino southern oscillation"],
  "ipcc": ["intergovernmental panel on climate change"],
  "epa": ["environmental protection agency"],
  "wgs": ["whole genome sequencing"],
  "wes": ["whole exome sequencing"],
  "ngs": ["next generation sequencing", "next-generation sequencing"],
  "scrnaseq": ["single cell rna sequencing", "single-cell rna-seq"],
  "chip": ["chromatin immunoprecipitation"],
  "talen": ["transcription activator-like effector nuclease"],
  "zfn": ["zinc finger nuclease"],
  "ipsc": ["induced pluripotent stem cell", "induced pluripotent stem cells"],
  "esc": ["embryonic stem cell", "embryonic stem cells"],
  "tms": ["transcranial magnetic stimulation"],
  "tdcs": ["transcranial direct current stimulation"],
  "meg": ["magnetoencephalography"],
  "bbb": ["blood brain barrier", "blood-brain barrier"],
  "csf": ["cerebrospinal fluid"],
  "cns": ["central nervous system"],
  "pns": ["peripheral nervous system"],
  "ans": ["autonomic nervous system"],
};

const KNOWN_BINOMIALS = [...new Set(Object.values(SYNONYMS).flat().filter((s) => /^[a-z]+ [a-z]+$/i.test(s)))];

const ORGANISM_BINOMIALS = new Set([
  "hermetia illucens", "drosophila melanogaster", "mus musculus", "rattus norvegicus", "caenorhabditis elegans", "danio rerio",
  "saccharomyces cerevisiae", "escherichia coli", "staphylococcus aureus", "mycobacterium tuberculosis", "plasmodium falciparum", "apis mellifera",
  "arabidopsis thaliana", "oryza sativa", "zea mays", "triticum aestivum", "nicotiana tabacum", "solanum lycopersicum", "solanum tuberosum",
  "glycine max", "gossypium hirsutum", "bombyx mori", "aedes aegypti", "anopheles gambiae", "tenebrio molitor", "zophobas morio", "galleria mellonella", "tribolium castaneum",
  "manduca sexta", "spodoptera frugiperda", "locusta migratoria", "xenopus laevis", "xenopus tropicalis", "gallus gallus", "sus scrofa",
  "bos taurus", "ovis aries", "canis lupus familiaris", "felis catus", "pan troglodytes", "macaca mulatta", "oryzias latipes",
  "bacillus subtilis", "pseudomonas aeruginosa", "salmonella typhimurium", "vibrio cholerae", "clostridioides difficile", "helicobacter pylori",
  "streptococcus pneumoniae", "candida albicans", "aspergillus niger", "neurospora crassa", "schizosaccharomyces pombe",
]);

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function correctBinomialTypos(query) {
  const toks = query.split(/\s+/);
  const clean = toks.map((t) => t.toLowerCase().replace(/[^a-z]/g, ""));
  for (const binomial of KNOWN_BINOMIALS) {
    const [genus, species] = binomial.split(" ");
    if (genus.length < 5 || species.length < 5) continue;
    const gThresh = Math.max(1, Math.ceil(genus.length / 3));
    const sThresh = Math.max(1, Math.ceil(species.length / 3));
    for (let i = 0; i + 1 < clean.length; i++) {
      const w1 = clean[i], w2 = clean[i + 1];
      if (w1.length < 4 || w2.length < 4) continue;
      const dG = levenshtein(w1, genus), dS = levenshtein(w2, species);
      if (dG === 0 && dS === 0) continue;
      if (dG <= gThresh && dS <= sThresh) {
        const before = toks.slice(0, i).join(" ");
        const after = toks.slice(i + 2).join(" ");
        return [before, genus + " " + species, after].filter(Boolean).join(" ");
      }
    }
  }
  return query;
}

function expansionsFor(tokens) {
  const out = [];
  for (const t of tokens) {
    const key = t.toLowerCase();
    if (SYNONYMS[key]) out.push(...SYNONYMS[key]);
  }
  const joined = tokens.join(" ").toLowerCase();
  for (const key of Object.keys(SYNONYMS)) {
    if (key.includes(" ") && joined.includes(key)) {
      out.push(...SYNONYMS[key]);
    }
  }
  return [...new Set(out)];
}

const ORGANISM_PHRASES = [
  "black soldier fly larvae", "black soldier fly", "hermetia illucens", "honey bee", "honey bees", "fruit fly", "fruit flies",
  "lab rat", "lab mouse", "guinea pig", "house mouse", "baker's yeast", "brewer's yeast", "thale cress", "rhesus macaque",
  "zebra fish", "zebrafish", "roundworm", "nematode", "silk worm", "silkworm", "mealworm", "meal worm", "wax worm", "waxworm",
];

const ORGANISM_WORDS = new Set([
  "black", "soldier", "fly", "larvae", "larva", "larval", "hermetia", "illucens", "honey", "bee", "bees", "honeybee", "honeybees", "apis", "mellifera",
  "fruit", "flies", "drosophila", "melanogaster", "mouse", "mice", "mus", "musculus", "rat", "rats", "rattus", "norvegicus",
  "zebrafish", "danio", "rerio", "roundworm", "nematode", "caenorhabditis", "elegans", "silkworm", "bombyx", "mori",
  "mealworm", "tenebrio", "molitor", "waxworm", "galleria", "mellonella", "mosquito", "aedes", "aegypti", "anopheles", "gambiae",
  "arabidopsis", "thaliana", "yeast", "saccharomyces", "cerevisiae",
]);

function splitOrganismTopic(query) {
  const q = query.toLowerCase();
  const toks = q.split(/\s+/).filter((t) => t.length > 2);
  const exp = expansionsFor(toks);
  const orgPhrases = new Set(exp);
  for (const phrase of ORGANISM_PHRASES) {
    if (q.includes(phrase)) {
      orgPhrases.add(phrase);
      const syns = SYNONYMS[phrase] || [];
      for (const s of syns) orgPhrases.add(s);
    }
  }
  for (const t of toks) {
    if (SYNONYMS[t]) {
      orgPhrases.add(t);
      for (const s of (SYNONYMS[t] || [])) orgPhrases.add(s);
    }
  }
  const topic = toks.filter((t) => !ORGANISM_WORDS.has(t) && !SYNONYMS[t]);
  return { orgPhrases: [...orgPhrases], topic, hasOrganism: orgPhrases.size > 0 };
}

function buildStructuredQuery(query) {
  const bin = extractBinomial(query);
  if (bin) {
    const rest = query.toLowerCase().replace(new RegExp(bin.full, "gi"), "").replace(/\s+/g, " ").trim();
    const restTerms = rest.split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
    if (restTerms.length) return '"' + bin.full + '" AND (' + restTerms.join(" OR ") + ')';
    return '"' + bin.full + '"';
  }
  const { orgPhrases, topic, hasOrganism } = splitOrganismTopic(query);
  if (hasOrganism && (topic.length || !orgPhrases.length)) {
    const resolvedOrg = new Set();
    for (const phrase of orgPhrases) {
      const syns = SYNONYMS[phrase.toLowerCase()] || [];
      const sciRaw = syns.find((s) => /^[a-z]+ [a-z]+$/i.test(s) && s.split(" ").length === 2);
      if (sciRaw) {
        const parts = sciRaw.split(" ");
        resolvedOrg.add(parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase() + " " + parts[1].toLowerCase());
      }
      resolvedOrg.add(phrase);
    }
    const orgStr = [...resolvedOrg].map((e) => (e.includes(" ") ? '"' + e + '"' : e)).join(" OR ");
    if (topic.length) return "(" + orgStr + ") AND (" + topic.join(" OR ") + ")";
    return orgStr;
  }
  if (hasOrganism) {
    return orgPhrases.map((e) => (e.includes(" ") ? '"' + e + '"' : e)).join(" OR ");
  }

  const qTerms = query.toLowerCase().replace(/[^\w\s-]/g, " ").split(/[\s-]+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (!qTerms.length) return query;

  const ranked = qTerms.map((t) => ({ t, spec: termSpecificity(t) })).sort((a, b) => b.spec - a.spec);
  const anchors = ranked.filter((x) => x.spec >= 0.5).slice(0, 4).map((x) => x.t);
  if (anchors.length < 2) return ranked.slice(0, 4).map((x) => x.t).join(" OR ");

  const groups = anchors.map((t) => {
    const set = CONCEPT_LOOKUP.get(t);
    if (!set) return t;
    const members = [t, ...[...set].filter((m) => m !== t)].slice(0, 7);
    return "(" + members.map((m) => (m.includes(" ") ? '"' + m + '"' : m)).join(" OR ") + ")";
  });
  return groups.join(" AND ");
}

const STOPWORDS = new Set([
  "what","whats","how","does","do","did","is","are","was","were","the","a","an",
  "of","in","on","for","to","and","or","with","by","about","tell","me","explain",
  "why","when","where","which","who","can","you","please","give","show","find",
  "search","look","up","that","this","these","those","it","its","work","works",
  "happen","happens","mean","means","between","into","from","as","at","be","been",
  "get","got","i","my","we","our","use","used","using","there","their","they",
  "responding","respond","level","levels","basis","role","effect","effects",
  "each","every","change","changes","through","throughout","section","sections",
  "different","part","parts","type","types","kind","example","within",
  "some","other","most","many","much","very","just","also","still","really",
  "would","could","should","might","may","will","shall","must","need",
]);

function cleanQuery(raw) {
  let sanitized = raw.replace(/\b(ignore|disregard|forget)\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?|context)\b/gi, "")
    .replace(/\b(system|assistant|user)\s*:/gi, "").replace(/```[\s\S]*?```/g, "").replace(/<[^>]+>/g, "").slice(0, 500);
  const cleaned = sanitized.toLowerCase().replace(/[^\w\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w)).join(" ").trim();
  return cleaned || raw.trim().slice(0, 500);
}

// ============ SCHOLARLY DATABASE SOURCES ============

async function europePMC(query, limit = 8) {
  const runSearch = async (qs) => {
    const url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" + new URLSearchParams({ query: qs, resultType: "core", pageSize: String(limit), format: "json", sort: "relevance" });
    const data = await getJSON(url);
    return data && data.resultList && data.resultList.result ? data.resultList.result : [];
  };
  try {
    let rows = await runSearch(query);
    if (!rows.length) {
      const structured = buildStructuredQuery(query);
      if (structured && structured !== query) rows = await runSearch(structured);
    }
    if (!rows.length) {
      const { orgPhrases, hasOrganism } = splitOrganismTopic(query);
      if (hasOrganism) rows = await runSearch(orgPhrases.map((e) => (e.includes(" ") ? '"' + e + '"' : e)).join(" OR "));
    }
    return rows.filter((r) => r.title).map((r) => ({
      title: r.title || "Untitled",
      url: r.doi ? "https://doi.org/" + r.doi : "https://europepmc.org/article/" + r.source + "/" + r.id,
      year: r.pubYear || "", citations: typeof r.citedByCount === "number" ? r.citedByCount : null,
      authors: r.authorString || "", _allAuthors: r.authorString || "",
      journal: r.journalTitle || "Europe PMC", abstract: stripTags(r.abstractText),
      pmcid: r.pmcid || (r.source === "PMC" ? r.id : "") || "",
      _rawType: (r.pubTypeList && Array.isArray(r.pubTypeList.pubType) ? r.pubTypeList.pubType.join(",") : "") || r.pubType || "",
    }));
  } catch { return []; }
}

function firstMatch(block, re) { const m = block.match(re); return m ? m[1] : ""; }

function parsePubmedXML(xmlText) {
  const arts = xmlText.match(/<PubmedArticle\b[\s\S]*?<\/PubmedArticle>/g) || [];
  return arts.map((a) => {
    const pmid = firstMatch(a, /<PMID[^>]*>(\d+)<\/PMID>/);
    const title = stripTags(firstMatch(a, /<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/));
    const abstract = stripTags((a.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g) || []).join(" "));
    const journal = stripTags(firstMatch(a, /<Title>([\s\S]*?)<\/Title>/) || firstMatch(a, /<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/));
    const year = firstMatch(a, /<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/);
    const authorBlocks = a.match(/<Author\b[\s\S]*?<\/Author>/g) || [];
    const names = authorBlocks.map((b) => [firstMatch(b, /<LastName>([\s\S]*?)<\/LastName>/), firstMatch(b, /<Initials>([\s\S]*?)<\/Initials>/)].filter(Boolean).join(" ")).filter(Boolean);
    const authors = names.length > 1 ? names[0] + " et al." : names[0] || "";
    const doi = firstMatch(a, /<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/);
    return { title: title || "Untitled", url: doi ? "https://doi.org/" + doi : "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/", year, citations: null, authors, journal: journal || "PubMed", abstract, pmid };
  });
}

async function pubmed(query, limit = 10, apiKey = "") {
  const tool = "&tool=cerebrum&email=contact@askcerebrum.org" + (apiKey ? "&api_key=" + apiKey : "");
  try {
    let ids = [];
    const esUrl = (t) => "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?" + new URLSearchParams({ db: "pubmed", term: t, retmax: String(limit), retmode: "json", sort: "relevance" }) + tool;
    const es = await getJSON(esUrl(query)).catch(() => null);
    ids = (es && es.esearchresult && es.esearchresult.idlist) || [];
    if (!ids.length) {
      const structured = buildStructuredQuery(query);
      if (structured && structured !== query) {
        const es2 = await getJSON(esUrl(structured)).catch(() => null);
        ids = (es2 && es2.esearchresult && es2.esearchresult.idlist) || [];
      }
    }
    if (!ids.length) {
      const { orgPhrases, hasOrganism } = splitOrganismTopic(query);
      if (hasOrganism) {
        const es3 = await getJSON(esUrl(orgPhrases.map((e) => (e.includes(" ") ? '"' + e + '"' : e)).join(" OR "))).catch(() => null);
        ids = (es3 && es3.esearchresult && es3.esearchresult.idlist) || [];
      }
    }
    if (!ids.length) return [];
    const idStr = ids.join(",");
    const [xml, summaryJson] = await Promise.all([
      getText("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?" + new URLSearchParams({ db: "pubmed", id: idStr, retmode: "xml" }) + tool).catch(() => ""),
      getJSON("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?" + new URLSearchParams({ db: "pubmed", id: idStr, retmode: "json" }) + tool).catch(() => null),
    ]);
    const fetched = xml ? parsePubmedXML(xml) : [];
    const byPmid = new Map(fetched.map((p) => [p.pmid, p]));
    const sumResult = (summaryJson && summaryJson.result) || {};
    const merged = [];
    for (const pmid of ids) {
      const s = sumResult[pmid];
      let rec = byPmid.get(pmid) || null;
      if (s && !rec) {
        rec = { title: s.title || "Untitled", url: "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/", year: (s.pubdate || "").slice(0, 4), citations: null, authors: (s.authors || []).slice(0, 1).map((a) => a.name).join("") + ((s.authors || []).length > 1 ? " et al." : ""), journal: s.fulljournalname || s.source || "PubMed", abstract: "", pmid };
      } else if (rec && s) {
        if (!rec.year && s.pubdate) rec.year = (s.pubdate || "").slice(0, 4);
        if (!rec.authors && s.authors) rec.authors = s.authors.slice(0, 1).map((a) => a.name).join("") + (s.authors.length > 1 ? " et al." : "");
      }
      if (rec && rec.title) merged.push(rec);
    }
    for (const p of fetched) { if (!merged.some((m) => m.pmid === p.pmid)) merged.push(p); }
    return merged;
  } catch { return []; }
}

function extractBinomial(raw) {
  const s = raw.trim();
  const commonNonTaxonomic = new Set(["black soldier", "climate change", "gene expression", "cell division", "protein folding", "public health", "food security", "human genome", "narrow leafed", "cotton wood", "peer reviewed", "open source"]);
  const re = /\b([A-Z][a-z]{2,}|[a-z]{3,})\s+([a-z]{3,})\b/g;
  const hasTaxMarker = /\b(species|genus|subsp\.|var\.|cultivar|strain|clade|sp\.)\b/i.test(s);
  let m;
  while ((m = re.exec(s)) !== null) {
    const test = m[0].toLowerCase();
    if (commonNonTaxonomic.has(test)) continue;
    if (STOPWORDS.has(m[1].toLowerCase()) || STOPWORDS.has(m[2].toLowerCase())) continue;
    const looksTaxonomic = /^[A-Z]/.test(m[1]) || hasTaxMarker;
    if (!looksTaxonomic) continue;
    const genus = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    return { genus, species: m[2], full: genus + " " + m[2] };
  }
  return null;
}

function looksLikePersonName(raw) {
  const s = raw.trim();
  if (!s || extractBinomial(raw)) return false;
  const toks = s.split(/\s+/);
  if (toks.length < 2 || toks.length > 4) return false;
  const isNamey = toks.every((t) => /^[A-Z][a-zA-Z'\-]+\.?$/.test(t) || /^[A-Z]\.?$/.test(t));
  const q = ["how", "what", "why", "when", "where", "who", "which", "does", "is", "are", "can", "the"];
  if (q.includes(toks[0].toLowerCase())) return false;
  return isNamey;
}

const NAME_STOPWORDS = new Set(["BSFL", "DNA", "RNA", "CRISPR", "PCR", "PhD", "MD", "UTK", "MIT", "NIH", "USA", "UK", "US", "EU", "FDA", "CDC", "WHO", "NASA", "The", "This", "That", "These", "Those", "Black", "Soldier", "Fly", "Larvae"]);

function extractPersonNameFromQuery(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (looksLikePersonName(s)) return s;
  const toks = s.split(/\s+/);
  const isNameToken = (t) => {
    if (!t || /^[A-Z]\.?$/.test(t)) return true;
    if (!/^[A-Z][a-zA-Z'\-]+$/.test(t) || NAME_STOPWORDS.has(t) || (t.length >= 3 && t === t.toUpperCase())) return false;
    return true;
  };
  const possessiveContext = new Set(["studies", "study", "papers", "paper", "research", "work", "works", "publications", "publication", "findings", "finding", "results", "result", "experiments", "experiment", "thesis", "dissertation", "articles", "article", "lab", "group", "team", "hypothesis", "theory", "approach", "method", "methods", "data", "dataset"]);
  let bestName = null;
  for (let i = 0; i < toks.length; i++) {
    if (!isNameToken(toks[i])) continue;
    for (let len = 4; len >= 2; len--) {
      if (i + len > toks.length) continue;
      const chunk = toks.slice(i, i + len);
      if (/^[A-Z]\.?$/.test(chunk[chunk.length - 1]) || chunk[0].length < 2 || chunk[chunk.length - 1].length < 2) continue;
      if (chunk.every(isNameToken)) { bestName = { toks: chunk, endIdx: i + len }; break; }
    }
    if (bestName) break;
  }
  if (!bestName) return null;
  const nextWord = (toks[bestName.endIdx] || "").toLowerCase().replace(/[.,;:?!]/g, "");
  const nameToks = bestName.toks.slice();
  const last = nameToks[nameToks.length - 1];
  if (/'s$/i.test(last)) nameToks[nameToks.length - 1] = last.replace(/'s$/i, "");
  else if (/s'$/i.test(last)) nameToks[nameToks.length - 1] = last.replace(/s'$/i, "");
  else if (/[a-z]s$/.test(last) && last.length > 3 && !/ss$/i.test(last) && possessiveContext.has(nextWord)) nameToks[nameToks.length - 1] = last.slice(0, -1);
  return nameToks.join(" ");
}

function classifyIntent(query, history) {
  const q = (query || "").trim();
  if (!q) return { kind: "new" };
  const lc = q.toLowerCase();
  const wc = q.split(/\s+/).length;
  const hasHistory = Array.isArray(history) && history.length > 0;
  if (!hasHistory) return { kind: "new" };

  const correctionPatterns = [/^(that|this|it)['']?s\s+(wrong|incorrect|not right|false)/i, /^(actually|no,?\s+it['']?s|no,?\s+they['']?re|correction[:,])/i, /you\s+(got|had|were)\s+(that|this|it)\s+wrong/i, /^wrong\b/i, /^not\s+\w+,?\s+(it['']?s|they['']?re|but)\s+/i, /\bthat['']?s\s+not\s+(right|correct|true|him|her|them)/i, /\bnot\s+\w+\s+but\s+/i, /you\s+(said|mentioned|wrote)\s+.+\s+(but|however|actually)\s+/i];
  for (const re of correctionPatterns) { if (re.test(q)) return { kind: "correction" }; }

  const followupOpeners = /^(yes|no|but|and|so|okay|ok|right|hmm|well|wait|hey)\b/i;
  const backReferences = /\b(that\s+(papers?|stud(?:y|ies)|research|works?|findings?|results?|authors?|persons?|one)|this\s+(papers?|stud(?:y|ies)|research|works?|findings?|results?)|the\s+(papers?|stud(?:y|ies)|research|works?|findings?|results?|authors?|persons?|one|main\s+point|main\s+finding|sources?|citations?|references?)|it|its|they|them|their|he|she|his|her|him)\b/i;
  const metaAboutPrevious = /\b(you\s+(said|mentioned|wrote|missed|forgot|focused|talked)|main\s+point|main\s+finding|focus\s+on|more\s+about|tell\s+me\s+more|expand|elaborate|clarify|what\s+about|and\s+what|what\s+does|what\s+did|explain\s+more|dig\s+deeper|go\s+deeper|where\s+(are|were)\s+the\s+(papers?|sources?|stud(?:y|ies)|citations?|references?)|show\s+me\s+the\s+(papers?|sources?|citations?)|list\s+the\s+(papers?|sources?|citations?)|what\s+(papers?|sources?|citations?)\s+(did|do|were|are))\b/i;
  const shortReply = wc <= 8;

  const hasBackRef = backReferences.test(q);
  const isFollowupOpener = followupOpeners.test(q);
  const isMeta = metaAboutPrevious.test(q);

  const historyText = history.map((t) => (t && t.content) || "").join(" ").toLowerCase();
  const newProperNouns = q.split(/\s+/).filter((w) => /^[A-Z][a-z]{2,}$/.test(w)).filter((w) => !historyText.includes(w.toLowerCase()));
  const introducesNewTopic = newProperNouns.length >= 2;

  if (introducesNewTopic) return { kind: "new" };
  if (isMeta || (hasBackRef && (isFollowupOpener || shortReply))) return { kind: "followup", meta: isMeta };
  if (isFollowupOpener && shortReply) return { kind: "followup", meta: false };
  return { kind: "new" };
}

async function preprintServerAuthor(server, fullName) {
  try {
    const now = new Date();
    const six = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    const iso = (d) => d.toISOString().slice(0, 10);
    const url = "https://api.biorxiv.org/details/" + server + "/" + iso(six) + "/" + iso(now) + "/0";
    const data = await getJSON(url, {}, 5000);
    const items = (data && data.collection) || [];
    const tokens = fullName.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = items.filter((it) => tokens.every((t) => (it.authors || "").toLowerCase().includes(t)));
    return hits.slice(0, 10).map((it) => ({
      title: it.title || "Untitled",
      url: it.doi ? "https://doi.org/" + it.doi : "https://www.biorxiv.org/search/" + encodeURIComponent(it.title || fullName),
      year: (it.date || "").slice(0, 4), citations: null, authors: it.authors || "",
      journal: server === "biorxiv" ? "bioRxiv (preprint)" : "medRxiv (preprint)", abstract: it.abstract || "",
    }));
  } catch { return []; }
}
async function biorxivDirectAuthor(fullName) { return preprintServerAuthor("biorxiv", fullName); }
async function medrxivDirectAuthor(fullName) { return preprintServerAuthor("medrxiv", fullName); }

async function genericWebSearch(query) {
  try {
    const url = "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({ action: "opensearch", search: query, limit: "5", namespace: "0", format: "json", origin: "*" });
    const data = await getJSON(url, {}, 4000);
    if (!Array.isArray(data) || data.length < 4) return [];
    const [, titles, descs, urls] = data;
    const out = [];
    for (let i = 0; i < titles.length; i++) {
      if (!descs[i] || !urls[i]) continue;
      out.push({ title: titles[i], url: urls[i], year: "", citations: null, authors: "Wikipedia", journal: "Wikipedia", abstract: descs[i], source: "web" });
    }
    return out;
  } catch { return []; }
}

async function openAlex(query, limit = 10, key = "") {
  try {
    const params = new URLSearchParams({ search: query, filter: "type:article|preprint", sort: "relevance_score:desc", per_page: String(limit), select: "title,doi,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships,ids,type", mailto: "contact@askcerebrum.org" });
    if (key) params.set("api_key", key);
    const data = await getJSON("https://api.openalex.org/works?" + params, {}, 4000);
    return (data.results || []).map((w) => {
      const first = (w.authorships && w.authorships[0] && w.authorships[0].author && w.authorships[0].author.display_name) || "";
      const rawPmcid = (w.ids && w.ids.pmcid) || "";
      const pmcid = rawPmcid.replace(/^https?:\/\/.*?\/(PMC\d+)$/i, "$1").replace(/[^0-9]/g, "");
      return {
        title: w.title || "Untitled",
        url: w.doi || (w.primary_location && (w.primary_location.landing_page_url || w.primary_location.pdf_url)) || "",
        year: w.publication_year || "", citations: typeof w.cited_by_count === "number" ? w.cited_by_count : null,
        authors: w.authorships && w.authorships.length > 1 ? first + " et al." : first,
        _allAuthors: (w.authorships || []).map((a) => (a && a.author && a.author.display_name) || "").filter(Boolean).join(", "),
        journal: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || "OpenAlex",
        abstract: decodeInverted(w.abstract_inverted_index), pmcid: pmcid || "", _rawType: w.type || "",
      };
    }).filter((p) => p.title);
  } catch { return []; }
}

async function crossref(query, limit = 8) {
  try {
    const url = "https://api.crossref.org/works?" + new URLSearchParams({ query, rows: String(limit), filter: "type:journal-article", select: "title,author,container-title,published,DOI,abstract,is-referenced-by-count,type" }) + "&mailto=contact@askcerebrum.org";
    const data = await getJSON(url, {}, 4000);
    const items = (data && data.message && data.message.items) || [];
    return items.map((it) => ({
      title: Array.isArray(it.title) ? it.title[0] : it.title || "Untitled",
      url: it.DOI ? "https://doi.org/" + it.DOI : "",
      year: (it.published && it.published["date-parts"] && it.published["date-parts"][0] && it.published["date-parts"][0][0]) || "",
      citations: typeof it["is-referenced-by-count"] === "number" ? it["is-referenced-by-count"] : null,
      authors: (it.author || []).slice(0, 1).map((a) => ((a.given || "") + " " + (a.family || "")).trim()).join("") + ((it.author || []).length > 1 ? " et al." : ""),
      _allAuthors: (it.author || []).map((a) => ((a.given || "") + " " + (a.family || "")).trim()).filter(Boolean).join(", "),
      journal: Array.isArray(it["container-title"]) ? it["container-title"][0] : it["container-title"] || "Crossref",
      abstract: stripTags(it.abstract || ""), _rawType: it.type || "",
    })).filter((p) => p.title);
  } catch { return []; }
}

async function arxiv(query, limit = 6) {
  try {
    const url = "https://export.arxiv.org/api/query?" + new URLSearchParams({ search_query: "all:" + query, max_results: String(limit), sortBy: "relevance" });
    const xml = await getText(url, {}, 4000);
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    return entries.map((e) => {
      const g = (re) => { const m = e.match(re); return m ? m[1].trim() : ""; };
      const title = stripTags(g(/<title>([\s\S]*?)<\/title>/));
      const summary = stripTags(g(/<summary>([\s\S]*?)<\/summary>/));
      const authorNames = (e.match(/<name>([\s\S]*?)<\/name>/g) || []).map((a) => a.replace(/<\/?name>/g, "").trim());
      return { title: title || "arXiv paper", url: g(/<id>([\s\S]*?)<\/id>/), year: g(/<published>(\d{4})/), citations: null, authors: authorNames.length > 1 ? authorNames[0] + " et al." : authorNames[0] || "", _allAuthors: authorNames.join(", "), journal: "arXiv", abstract: summary };
    }).filter((p) => p.title);
  } catch { return []; }
}

async function semanticScholar(query, limit = 8) {
  try {
    const S2_LITERATURE_TYPES = ["JournalArticle", "Review", "MetaAnalysis", "CaseReport", "ClinicalTrial", "Conference", "Study", "Book", "BookSection"].join(",");
    const url = "https://api.semanticscholar.org/graph/v1/paper/search?" + new URLSearchParams({ query, limit: String(limit), publicationTypes: S2_LITERATURE_TYPES, fields: "title,abstract,tldr,year,citationCount,authors,venue,externalIds,openAccessPdf,url,publicationTypes" });
    const data = await getJSON(url, {}, 4000);
    return ((data && data.data) || []).filter((r) => r.title).map((r) => {
      const doi = r.externalIds && r.externalIds.DOI;
      return {
        title: r.title || "Untitled", url: doi ? "https://doi.org/" + doi : (r.openAccessPdf && r.openAccessPdf.url) || r.url || "",
        year: r.year || "", citations: typeof r.citationCount === "number" ? r.citationCount : null,
        authors: (r.authors || []).slice(0, 1).map((a) => a.name).join("") + ((r.authors || []).length > 1 ? " et al." : ""),
        _allAuthors: (r.authors || []).map((a) => a.name).filter(Boolean).join(", "),
        journal: r.venue || "Semantic Scholar", abstract: r.abstract || "", tldr: (r.tldr && r.tldr.text) || "",
        _rawType: Array.isArray(r.publicationTypes) ? r.publicationTypes.join(",") : "",
      };
    });
  } catch { return []; }
}

async function doaj(query, limit = 6) {
  try {
    const url = "https://doaj.org/api/search/articles/" + encodeURIComponent(query) + "?pageSize=" + limit;
    const data = await getJSON(url, {}, 4000);
    return ((data && data.results) || []).map((r) => {
      const b = r.bibjson || {};
      const doiId = (b.identifier || []).find((x) => x.type === "doi");
      const link = (b.link || [])[0];
      return { title: b.title || "Untitled", url: doiId ? "https://doi.org/" + doiId.id : (link && link.url) || "", year: b.year || "", citations: null, authors: (b.author || []).slice(0, 1).map((a) => a.name).join("") + ((b.author || []).length > 1 ? " et al." : ""), journal: (b.journal && b.journal.title) || "DOAJ", abstract: stripTags(b.abstract || "") };
    }).filter((p) => p.title);
  } catch { return []; }
}

async function biorxiv(query, limit = 6) {
  try {
    const params = new URLSearchParams({ search: query, filter: "type:preprint", sort: "relevance_score:desc", per_page: String(limit), select: "title,doi,publication_year,cited_by_count,abstract_inverted_index,primary_location,authorships", mailto: "contact@askcerebrum.org" });
    const data = await getJSON("https://api.openalex.org/works?" + params, {}, 4000);
    const out = [];
    for (const w of (data.results || [])) {
      if (!w.title) continue;
      const first = (w.authorships && w.authorships[0] && w.authorships[0].author && w.authorships[0].author.display_name) || "";
      out.push({ title: w.title, url: w.doi || (w.primary_location && w.primary_location.landing_page_url) || "", year: w.publication_year || "", citations: typeof w.cited_by_count === "number" ? w.cited_by_count : null, authors: w.authorships && w.authorships.length > 1 ? first + " et al." : first, journal: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || "Preprint", abstract: decodeInverted(w.abstract_inverted_index) });
    }
    return out;
  } catch { return []; }
}

async function zenodo(query, limit = 4) {
  try {
    const url = "https://zenodo.org/api/records?" + new URLSearchParams({ q: query, size: String(limit), sort: "mostrecent" });
    const data = await getJSON(url, {}, 4000);
    return ((data && data.hits && data.hits.hits) || []).map((r) => {
      const md = r.metadata || {};
      return { title: md.title || "Untitled", url: r.doi_url || (md.doi ? "https://doi.org/" + md.doi : "") || (r.links && r.links.self_html) || "", year: (md.publication_date || "").slice(0, 4), citations: null, authors: (md.creators || []).slice(0, 1).map((a) => a.name).join("") + ((md.creators || []).length > 1 ? " et al." : ""), journal: "Zenodo", abstract: stripTags(md.description || "") };
    }).filter((p) => p.title);
  } catch { return []; }
}

async function plos(query, limit = 6) {
  try {
    const url = "https://api.plos.org/search?" + new URLSearchParams({ q: query, fl: "id,title_display,author_display,journal,publication_date,abstract", wt: "json", rows: String(limit) });
    const data = await getJSON(url, {}, 4000);
    return ((data && data.response && data.response.docs) || []).map((d) => ({ title: Array.isArray(d.title_display) ? d.title_display[0] : d.title_display || "Untitled", url: d.id ? "https://doi.org/" + d.id : "", year: (d.publication_date || "").slice(0, 4), citations: null, authors: (d.author_display || []).slice(0, 1).join("") + ((d.author_display || []).length > 1 ? " et al." : ""), journal: d.journal || "PLOS", abstract: stripTags(Array.isArray(d.abstract) ? d.abstract.join(" ") : d.abstract || "") })).filter((p) => p.title);
  } catch { return []; }
}

async function coreSearch(query, limit = 8) {
  try {
    const url = "https://api.core.ac.uk/v3/search/works?" + new URLSearchParams({ q: query, limit: String(limit) });
    const data = await getJSON(url, {}, 4000);
    return ((data && data.results) || []).filter((r) => r.title).map((r) => ({ title: r.title || "Untitled", url: r.doi ? "https://doi.org/" + r.doi : (r.downloadUrl || ""), year: r.yearPublished ? String(r.yearPublished) : "", citations: null, authors: (r.authors || []).map((a) => a.name || "").slice(0, 1).join("") + ((r.authors || []).length > 1 ? " et al." : ""), _allAuthors: (r.authors || []).map((a) => a.name || "").join(", "), journal: r.publisher || "CORE", abstract: stripTags((r.abstract || "").slice(0, 1500)) }));
  } catch { return []; }
}

async function baseSearch(query, limit = 8) {
  try {
    const url = "https://api.base-search.net/cgi-bin/BaseHttpSearchInterface.fcgi?" + new URLSearchParams({ func: "PerformSearch", query: query, format: "json", hits: String(limit) });
    const data = await getJSON(url, {}, 4000);
    return ((data && data.response && data.response.docs) || []).filter((d) => d.dctitle).map((d) => ({ title: Array.isArray(d.dctitle) ? d.dctitle[0] : (d.dctitle || "Untitled"), url: (Array.isArray(d.dcidentifier) ? d.dcidentifier.find((u) => (u||"").startsWith("http")) : d.dcidentifier) || "", year: Array.isArray(d.dcyear) ? d.dcyear[0] : (d.dcyear || ""), citations: null, authors: Array.isArray(d.dcperson) ? d.dcperson.slice(0,1).join("") + (d.dcperson.length > 1 ? " et al." : "") : (d.dcperson || ""), _allAuthors: Array.isArray(d.dcperson) ? d.dcperson.join(", ") : (d.dcperson || ""), journal: Array.isArray(d.dcsource) ? d.dcsource[0] : (d.dcsource || "BASE"), abstract: stripTags(Array.isArray(d.dcdescription) ? d.dcdescription.join(" ").slice(0,1500) : (d.dcdescription || "").slice(0,1500)) }));
  } catch { return []; }
}

async function pmcFullText(query, limit = 8) {
  try {
    const url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" + new URLSearchParams({ query: '(BODY:"' + query + '")', resultType: "core", pageSize: String(limit), format: "json", sort: "relevance" });
    const data = await getJSON(url, {}, 4000);
    return ((data && data.resultList && data.resultList.result) || []).filter((r) => r.title).map((r) => ({ title: r.title || "Untitled", url: r.doi ? "https://doi.org/" + r.doi : "https://europepmc.org/article/" + r.source + "/" + r.id, year: r.pubYear || "", citations: typeof r.citedByCount === "number" ? r.citedByCount : null, authors: r.authorString || "", _allAuthors: r.authorString || "", journal: r.journalTitle || "PMC", abstract: stripTags(r.abstractText) }));
  } catch { return []; }
}

async function openAire(query, limit = 8) {
  try {
    const url = "https://api.openaire.eu/search/publications?" + new URLSearchParams({ keywords: query, size: String(limit), format: "json" });
    const data = await getJSON(url, {}, 4000);
    const results = data?.response?.results?.result || [];
    return results.filter((r) => r?.metadata?.["oaf:entity"]?.["oaf:result"]?.title).map((r) => {
      const m = r.metadata["oaf:entity"]["oaf:result"];
      const t = typeof m.title === "string" ? m.title : (m.title?.["$"] || "Untitled");
      const creators = Array.isArray(m.creator) ? m.creator : (m.creator ? [m.creator] : []);
      const names = creators.map((c) => c?.["$"] || "").filter(Boolean);
      const pids = Array.isArray(m.pid) ? m.pid : (m.pid ? [m.pid] : []);
      const doi = pids.find((p) => p?.["@classid"] === "doi");
      const acceptDate = typeof m.dateofacceptance === "string" ? m.dateofacceptance : (m.dateofacceptance?.["$"] || "");
      return { title: t, url: doi ? "https://doi.org/" + doi["$"] : "", year: acceptDate.slice(0,4), citations: null, authors: names.slice(0,1).join("") + (names.length > 1 ? " et al." : ""), _allAuthors: names.join(", "), journal: m.journal?.["$"] || "OpenAIRE", abstract: stripTags((typeof m.description === "string" ? m.description : (m.description?.["$"] || "")).slice(0,1500)) };
    }).filter((p) => p.title && p.title !== "Untitled");
  } catch { return []; }
}

async function duckduckgo(query) {
  try {
    const url = "https://api.duckduckgo.com/?" + new URLSearchParams({ q: query, format: "json", no_html: "1", skip_disambig: "1" });
    const data = await getJSON(url, {}, 4000);
    const abstract = ((data && data.AbstractText) || "").trim();
    if (!abstract) return [];
    return [{ title: (data.Heading || query) + " (" + (data.AbstractSource || "Web") + ")", url: data.AbstractURL || "", year: "", citations: null, authors: data.AbstractSource || "Web", journal: data.AbstractSource || "Web", abstract: abstract.slice(0, 1200), isEncyclopedia: true }];
  } catch { return []; }
}

async function wikipedia(query, limit = 2) {
  try {
    const searchUrl = "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({ action: "query", list: "search", srsearch: query, srlimit: String(limit), format: "json", origin: "*" });
    const sdata = await getJSON(searchUrl, {}, 4000);
    const hits = (sdata && sdata.query && sdata.query.search) || [];
    const out = [];
    for (const h of hits) {
      const title = h.title;
      try {
        const exUrl = "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({ action: "query", prop: "extracts", exintro: "1", explaintext: "1", titles: title, format: "json", origin: "*" });
        const ex = await getJSON(exUrl, {}, 4000);
        const pages = (ex && ex.query && ex.query.pages) || {};
        const page = Object.values(pages)[0] || {};
        const extract = (page.extract || "").replace(/\s+/g, " ").trim();
        if (extract) out.push({ title: title + " (Wikipedia)", url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")), year: "", citations: null, authors: "Wikipedia contributors", journal: "Wikipedia", abstract: extract.slice(0, 1500), isEncyclopedia: true });
      } catch {}
    }
    return out;
  } catch { return []; }
}

const VIDEO_INSTANCES = [
  { type: "piped", url: "https://pipedapi.kavin.rocks" }, { type: "piped", url: "https://api.piped.projectsegfau.lt" },
  { type: "piped", url: "https://pipedapi.adminforge.de" }, { type: "invidious", url: "https://inv.nadeko.net" },
  { type: "invidious", url: "https://iv.ggtyler.dev" }
];

function shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

async function tryVideoInstance(inst, query, timeoutMs) {
  const qs = encodeURIComponent(query + " lecture explained");
  const url = inst.type === "piped" ? inst.url + "/search?q=" + qs + "&filter=videos" : inst.url + "/api/v1/search?q=" + qs + "&type=video";
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: c.signal, headers: { "User-Agent": "Mozilla/5.0 Cerebrum" } });
    clearTimeout(t);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const items = Array.isArray(data) ? data : data.items || [];
    if (!items.length) throw new Error("empty");
    const seen = new Set();
    const out = [];
    for (const item of items) {
      let vId = "";
      if (item.videoId) vId = item.videoId;
      else if (item.url && item.url.indexOf("/watch?v=") !== -1) vId = item.url.replace(/^.*\/watch\?v=/, "").split("&")[0];
      if (!vId || seen.has(vId)) continue;
      seen.add(vId);
      out.push({ title: item.title || "Video", url: "https://www.youtube.com/watch?v=" + vId, author: item.author || item.uploaderName || item.channel || "Channel", thumbnail: "https://i.ytimg.com/vi/" + vId + "/hqdefault.jpg", id: vId });
      if (out.length >= 6) break;
    }
    if (!out.length) throw new Error("no valid items");
    return out;
  } catch (e) { clearTimeout(t); throw e; }
}

async function youtubeDirectSearch(query, limit = 6) {
  const url = "https://www.youtube.com/results?" + new URLSearchParams({ search_query: query + " lecture explained" });
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const res = await fetch(url, { signal: c.signal, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Accept-Language": "en-US,en;q=0.9" } });
    clearTimeout(t);
    if (!res.ok) return [];
    const html = await res.text();
    const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
    if (!m) return [];
    const data = JSON.parse(m[1]);
    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
    const out = [];
    const seen = new Set();
    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const v = item?.videoRenderer;
        if (!v || !v.videoId || seen.has(v.videoId)) continue;
        seen.add(v.videoId);
        const thumbs = v.thumbnail?.thumbnails || [];
        out.push({ title: v.title?.runs?.map((r) => r.text).join("") || v.title?.simpleText || "Video", url: "https://www.youtube.com/watch?v=" + v.videoId, author: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || "Channel", thumbnail: thumbs[thumbs.length - 1]?.url || "https://i.ytimg.com/vi/" + v.videoId + "/hqdefault.jpg", id: v.videoId });
        if (out.length >= limit) return out;
      }
    }
    return out;
  } catch { return []; }
}

async function fetchVideos(query, maxMs = 3000) {
  const cleaned = cleanQuery(query) || query;
  const timedRace = new Promise((resolve) => setTimeout(() => resolve([]), maxMs));
  const doFetch = async () => {
    const direct = await youtubeDirectSearch(cleaned, 6).catch(() => []);
    if (direct.length) return direct;
    const shuffled = shuffle(VIDEO_INSTANCES);
    for (let i = 0; i < shuffled.length; i += 4) {
      const batch = shuffled.slice(i, i + 4);
      try { const result = await Promise.any(batch.map((inst) => tryVideoInstance(inst, cleaned, 2000))); if (result && result.length) return result; } catch {}
    }
    return [];
  };
  return Promise.race([doFetch(), timedRace]);
}

async function llmGenerateSearchQueries(rawQuery, token) {
  if (!token) return [];
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ model: "deepseek/deepseek-chat-v3-0324:free", temperature: 0.1, max_tokens: 300, messages: [{ role: "system", content: "Generate 4-6 PubMed/Google Scholar search queries (3-7 words each, no booleans) based on the user's question. Output ONLY a JSON array of strings." }, { role: "user", content: rawQuery }] }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    const clean = txt.replace(/```json|```/g, "").trim();
    try { const arr = JSON.parse(clean); if (Array.isArray(arr) && arr.length > 0) return arr.slice(0, 6).map(s => s.trim()).filter(s => s.length > 3 && s.length < 100); } catch {}
    return clean.split("\n").map(l => l.replace(/^[\d\.\-\*\s"]+|"$/g, "").trim()).filter(s => s.length > 3 && s.length < 100).slice(0, 6);
  } catch { return []; }
}

const CONTAMINANT_ORGANISMS = [
  { patterns: [/\bmillipede/i, /\bdiplopoda/i, /\bjulida\b/i, /\bmyriapod/i], label: "millipede" },
  { patterns: [/\bcentipede/i, /\bchilopoda/i], label: "centipede" },
  { patterns: [/\bcockroach/i, /\bblattodea/i, /\bperiplaneta/i, /\bblattella/i], label: "cockroach" },
  { patterns: [/\btsetse/i, /\bglossina\b/i], label: "tsetse fly" },
  { patterns: [/\bmosquito/i, /\banopheles\b/i, /\baedes\b/i, /\bculex\b/i], label: "mosquito" },
  { patterns: [/\bsilkworm/i, /\bbombyx\b/i], label: "silkworm" },
  { patterns: [/\bspruce budworm/i, /\bchoristoneura/i], label: "spruce budworm" },
  { patterns: [/\bcricket/i, /\bacheta\b/i, /\bgryllus\b/i], label: "cricket" },
  { patterns: [/\bmealworm/i, /\btenebrio\b/i], label: "mealworm" },
  { patterns: [/\bwaxworm/i, /\bgalleria\b/i], label: "waxworm" },
  { patterns: [/\btermite/i, /\bisoptera/i, /\breticulitermes/i], label: "termite" },
  { patterns: [/\bbeetle\b/i, /\bcoleoptera/i], label: "beetle" },
  { patterns: [/\bbutterfly/i, /\blepidoptera/i, /\bmonarch\b/i], label: "butterfly" },
  { patterns: [/\bant\b/i, /\bformicidae/i], label: "ant" },
  { patterns: [/\btilapia\b/i, /\boreochromis\b/i], label: "tilapia" },
  { patterns: [/\bsalmon\b/i, /\bsalmo\b/i, /\boncorhynchus/i], label: "salmon" },
  { patterns: [/\bshrimp\b/i, /\bpenaeus\b/i, /\blitopenaeus/i], label: "shrimp" },
  { patterns: [/\bpoultry\b/i, /\bbroiler/i, /\bgallus\b/i], label: "poultry" },
  { patterns: [/\bswine\b/i, /\bpig\b/i, /\bsus scrofa/i, /\bporcine/i], label: "swine" },
];

const QUERY_ORGANISM_IDENTIFIERS = {
  "bsfl": ["hermetia", "black soldier fly"], "bsf": ["hermetia", "black soldier fly"], "black soldier fly": ["hermetia"],
  "honey bee": ["apis"], "honeybee": ["apis"], "fruit fly": ["drosophila"], "zebrafish": ["danio"],
  "roundworm": ["caenorhabditis", "c. elegans"], "e. coli": ["escherichia"], "e coli": ["escherichia"],
};

function programmaticPaperFilter(rawQuery, papers) {
  if (!papers.length) return papers;
  const qLower = rawQuery.toLowerCase();
  const queryOrganisms = new Set();
  for (const [name, identifiers] of Object.entries(QUERY_ORGANISM_IDENTIFIERS)) {
    if (qLower.includes(name)) { identifiers.forEach(id => queryOrganisms.add(id.toLowerCase())); queryOrganisms.add(name.toLowerCase()); }
  }
  const qBinomial = extractBinomial(rawQuery);
  if (qBinomial) { queryOrganisms.add(qBinomial.genus.toLowerCase()); queryOrganisms.add(qBinomial.full.toLowerCase()); }
  if (queryOrganisms.size === 0) return papers;

  return papers.filter(p => {
    const haystack = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
    const mentionsTarget = [...queryOrganisms].some(org => haystack.includes(org));
    if (!mentionsTarget) {
      for (const contam of CONTAMINANT_ORGANISMS) {
        const mentionsContam = contam.patterns.some(re => re.test(haystack));
        const contamIsTarget = [...queryOrganisms].some(org => contam.label.toLowerCase().includes(org) || org.includes(contam.label.toLowerCase()));
        if (mentionsContam && !contamIsTarget) { p._filteredReason = `Paper is about ${contam.label}, not the queried organism`; return false; }
      }
    }
    if (queryOrganisms.has("hermetia") || queryOrganisms.has("black soldier fly") || qLower.includes("bsfl") || qLower.includes("bsf")) {
      const isBSFLBiologyQuery = /\b(microbiome|microbiota|gut\s*(bacteria|flora|microb)|larva[el]?\s*(gut|microb|digest)|digest|metab|enzyme|proteome|transcriptome|genome|gene\s*express)/i.test(rawQuery);
      if (isBSFLBiologyQuery) {
        const fedPattern = /\b(fed\s+(with\s+)?|diet(ary)?\s+(contain|includ|supplement)|meal\s+(from|replac)|as\s+(feed|protein\s+source)|fish\s+meal\s+replac|feed\s+(ingredient|formul|additive))/i.test(haystack);
        const aboutOtherAnimal = CONTAMINANT_ORGANISMS.some(c => c.patterns.some(re => re.test(haystack)) && !([...queryOrganisms].some(org => c.label.toLowerCase().includes(org))));
        if (fedPattern && aboutOtherAnimal && !mentionsTarget) { p._filteredReason = "Paper is about feeding BSFL to another animal, not BSFL biology"; return false; }
        const titleLower = (p.title || "").toLowerCase();
        for (const contam of CONTAMINANT_ORGANISMS) {
          if (contam.patterns.some(re => re.test(titleLower)) && fedPattern) {
            if (!(titleLower.includes("hermetia") || titleLower.includes("black soldier fly") || titleLower.includes("bsf"))) { p._filteredReason = `Paper primarily about ${contam.label} fed with BSFL`; return false; }
          }
        }
      }
    }
    return true;
  });
}

function topicOverlapFilter(rawQuery, papers) {
  if (!papers.length) return papers;
  const qLower = rawQuery.toLowerCase();
  const qTerms = qLower.replace(/[^\w\s-]/g, " ").split(/[\s-]+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (!qTerms.length) return papers;
  const rankedQ = qTerms.map((t) => ({ t, spec: termSpecificity(t) })).sort((a, b) => b.spec - a.spec);
  let coreQTerms = rankedQ.filter((x) => x.spec >= 0.5).map((x) => x.t);
  if (coreQTerms.length === 0) coreQTerms = rankedQ.slice(0, 3).map((x) => x.t);
  coreQTerms = coreQTerms.slice(0, 6);
  const acceptSetsRaw = coreQTerms.map((t) => CONCEPT_LOOKUP.get(t) || new Set([t]));
  for (const group of CONCEPT_GROUPS) {
    for (const phrase of group) {
      if (phrase.indexOf(" ") !== -1 && qLower.includes(phrase)) { acceptSetsRaw.push(new Set(group)); break; }
    }
  }
  const seenSetRefs = new Set();
  const acceptSets = [];
  for (const s of acceptSetsRaw) { if (!seenSetRefs.has(s)) { seenSetRefs.add(s); acceptSets.push(s); } }

  const survivors = papers.filter((p) => {
    const hay = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
    const hitCount = acceptSets.filter((set) => { for (const term of set) if (hay.includes(term)) return true; return false; }).length;
    if (hitCount === 0) { p._filteredReason = "No topic overlap"; return false; }
    const required = acceptSets.length >= 2 ? Math.max(2, Math.ceil(acceptSets.length / 2)) : 1;
    if (hitCount < required) { p._filteredReason = "Insufficient topic overlap"; return false; }
    return true;
  });
  if (survivors.length === 0) return papers.slice(0, 3);
  return survivors;
}

async function llmValidatePapers(rawQuery, papers, token) {
  if (!papers.length) return papers;
  let survivors = programmaticPaperFilter(rawQuery, papers);
  if (survivors.length === 0 && papers.length > 0) survivors = papers.slice(0, 3);
  survivors = topicOverlapFilter(rawQuery, survivors);
  if (!token || survivors.length > 20) return survivors;
  const qLower = rawQuery.toLowerCase();
  let targetOrganism = "";
  for (const [name, identifiers] of Object.entries(QUERY_ORGANISM_IDENTIFIERS)) { if (qLower.includes(name)) { targetOrganism = identifiers[0] || name; break; } }
  const qBinomial = extractBinomial(rawQuery);
  if (qBinomial && !targetOrganism) targetOrganism = qBinomial.full;

  const organismClause = targetOrganism ? `\n\nCRITICAL — ORGANISM GATE: The user is asking about "${targetOrganism}". A paper MUST be specifically about this organism to score RELEVANT.` : "";

  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 7000);
    const paperList = survivors.map((p, i) => `[${i + 1}] "${p.title}" (${p.journal || "unknown"})\nAbstract: ${(p.abstract || "").slice(0, 350)}`).join("\n\n");
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat-v3-0324:free", temperature: 0, max_tokens: 400,
        messages: [{ role: "system", content: "You are a strict scientific paper relevance validator. Return a JSON array: [{\"id\": 1, \"verdict\": \"RELEVANT\"}, ...]. Rules: RELEVANT = directly answers question. TANGENTIAL = related. IRRELEVANT = off-topic." + organismClause }, { role: "user", content: "Question: " + rawQuery + "\n\nPapers:\n" + paperList }]
      }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return survivors;
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    const parsed = JSON.parse(txt.replace(/```json|```/g, "").trim());
    if (Array.isArray(parsed) && parsed.length > 0) {
      const validIds = new Set();
      const tangentialIds = new Set();
      for (const entry of parsed) {
        const id = typeof entry === "number" ? entry : (entry.id || entry.number || entry.n);
        const verdict = typeof entry === "string" ? "RELEVANT" : (entry.verdict || entry.score || "RELEVANT");
        const idNum = typeof id === "number" ? id : parseInt(id, 10);
        if (isNaN(idNum)) continue;
        if (/^relevant$/i.test(verdict)) validIds.add(idNum);
        else if (/^tangential$/i.test(verdict)) tangentialIds.add(idNum);
      }
      const filtered = survivors.filter((p, i) => {
        const num = i + 1;
        if (validIds.has(num)) return true;
        if (tangentialIds.has(num)) { p._tangential = true; return validIds.size < 3; }
        return false;
      });
      if (filtered.length > 0) return filtered;
      return survivors.slice(0, 2);
    }
  } catch {}
  return survivors;
}

const DEEP_FACT_CHECK_SYSTEM_PROMPT = "You are a rigorous scientific fact-checker. You will be given an AI-generated answer and the numbered sources. Extract 3 to 5 specific claims and verify them against the abstract text. Output JSON: {\"claims\": [{\"claim\": \"...\", \"source_index\": 1, \"quote\": \"...\", \"status\": \"supported|thin|unsupported\", \"justification\": \"...\"}]}";

function buildFactCheckSourceBlock(papers) { return papers.slice(0, 20).map((p, i) => `[${i + 1}] ${p.title || "Untitled"}\nAbstract: ${(p.abstract || "").slice(0, 600)}`).join("\n\n"); }

function parseDeepFactCheckJSON(raw) {
  const txt = (raw || "").replace(/```json|```/g, "").trim();
  const start = txt.indexOf("{"), end = txt.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(txt.slice(start, end + 1));
    if (!parsed || !Array.isArray(parsed.claims)) return null;
    const VALID_STATUS = new Set(["supported", "thin", "unsupported"]);
    const claims = parsed.claims.map((c) => {
      const claim = String((c && c.claim) || "").trim().slice(0, 400);
      const status = VALID_STATUS.has((c && c.status || "").toLowerCase()) ? c.status.toLowerCase() : null;
      const justification = String((c && c.justification) || "").trim().slice(0, 900);
      const quote = String((c && c.quote) || "").trim().slice(0, 400);
      const sourceIndex = Number.isFinite(c && c.source_index) ? c.source_index : null;
      if (!claim || !status || !justification) return null;
      return { claim, status, justification, quote, sourceIndex };
    }).filter(Boolean);
    if (claims.length < 2) return null;
    return claims;
  } catch { return null; }
}

async function deepFactCheck(answer, papers, env) {
  if (!answer || !papers || papers.length === 0) return null;
  const sourceBlock = buildFactCheckSourceBlock(papers);
  const userContent = "ANSWER:\n" + answer.slice(0, 4000) + "\n\nSOURCES:\n" + sourceBlock;
  const messages = [{ role: "system", content: DEEP_FACT_CHECK_SYSTEM_PROMPT }, { role: "user", content: userContent }];
  if (env.AI && typeof env.AI.run === "function") {
    try {
      const out = await Promise.race([env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8", { messages, max_tokens: 1900 }), new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 5000))]);
      const claims = parseDeepFactCheckJSON((out && out.response) || "");
      if (claims) return claims;
    } catch {}
  }
  if (env.OPENROUTER_KEY) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 6000);
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.OPENROUTER_KEY }, body: JSON.stringify({ model: "deepseek/deepseek-chat-v3-0324:free", temperature: 0, max_tokens: 1900, messages }), signal: c.signal });
      clearTimeout(t);
      if (r.ok) { const j = await r.json(); const claims = parseDeepFactCheckJSON(j?.choices?.[0]?.message?.content || ""); if (claims) return claims; }
    } catch {}
  }
  return null;
}

const BANNED_PHRASES_RE = [
  /\bfurther research is needed\b/gi, /\bfurther research is necessary\b/gi, /\bfurther research is required\b/gi, /\bfurther research is warranted\b/gi,
  /\bfurther (studies|investigation|understanding) (is|are) (needed|necessary|required|warranted)\b/gi, /\bmore research is needed\b/gi,
  /\bplays a (critical|crucial|vital|pivotal|key|important|significant) role\b/gi, /\bit is (important|worth|critical|crucial) to note\b/gi,
  /\bit should be noted\b/gi, /\bit is worth mentioning\b/gi, /\bin recent years\b/gi, /\ba growing body of evidence\b/gi, /\bsheds? light on\b/gi,
  /\bpaves? the way for\b/gi, /\bthe exact mechanism remains unclear\b/gi, /\bwhile the provided sources do not directly\b/gi, /\bnone of these papers directly\b/gi,
  /\balthough this study does not specifically\b/gi, /\bin conclusion\b/gi, /\bin summary\b/gi, /^overall,\s*/gim, /\bit is clear that\b/gi,
  /\bholistic understanding\b/gi, /\bholistic approach\b/gi, /\bmultifaceted\b/gi, /\bunderscore(s)? the (importance|need|significance)\b/gi,
  /\bhighlight(s)? the (importance|need|significance)\b/gi, /\bthe (landscape|field) of\b/gi, /\bin the realm of\b/gi, /\bat the forefront of\b/gi,
  /\ba testament to\b/gi, /\bin the context of\b/gi, /\bthis underscores\b/gi, /\bwarrants further investigation\b/gi, /\bopens (?:up )?new avenues\b/gi,
  /\bremains (?:an )?area of active (?:research|investigation|study)\b/gi, /\bhold(?:s)? great promise\b/gi, /\bhas garnered (?:significant |considerable |increasing )?(?:attention|interest)\b/gi,
  /\bhas emerged as a promising\b/gi, /\bhas attracted (?:significant |considerable |growing )?(?:attention|interest)\b/gi, /\btaken together,?\s*/gi,
  /\bcollectively,?\s+these (?:findings|results|studies|data)\b/gi, /\bnotwithstanding,?\s*/gi, /\bin light of (?:the (?:above|foregoing)|these findings)\b/gi,
  /\bparadigm shift\b/gi, /\bgame[\s-]?changer\b/gi, /\bcutting[\s-]?edge\b/gi, /\bstate[\s-]?of[\s-]?the[\s-]?art\b/gi, /\bgroundbreaking\b/gi,
  /\brevolutionary\b/gi, /\bpioneering\b/gi, /\bunprecedented\b/gi, /\bit (?:is|remains) (?:imperative|essential|crucial) (?:to|that)\b/gi,
  /\bthe (?:present|current) (?:review|study) (?:aims|seeks) to\b/gi,
];

function deduplicateContent(text) {
  if (!text) return text;
  const paragraphs = text.split(/\n{2,}/);
  if (paragraphs.length < 2) return text;
  const seen = new Set();
  let deduped = [];
  for (const para of paragraphs) {
    const normalized = para.trim().toLowerCase().replace(/\s+/g, " ");
    if (normalized.length < 20) { deduped.push(para); continue; }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(para);
  }
  const final = [];
  for (let i = 0; i < deduped.length; i++) {
    const current = deduped[i].trim().toLowerCase().replace(/\s+/g, " ");
    if (current.length < 30) { final.push(deduped[i]); continue; }
    const currentWords = new Set(current.split(/\s+/));
    let isDupe = false;
    for (let j = 0; j < i; j++) {
      const prev = deduped[j].trim().toLowerCase().replace(/\s+/g, " ");
      if (prev.length < 30) continue;
      const prevWords = new Set(prev.split(/\s+/));
      let overlap = 0;
      for (const w of currentWords) { if (prevWords.has(w)) overlap++; }
      if (overlap / currentWords.size > 0.80 && currentWords.size > 10) { isDupe = true; break; }
    }
    if (!isDupe) final.push(deduped[i]);
  }
  const result = final.map(para => {
    const sentences = para.split(/(?<=[.!?])\s+/);
    if (sentences.length < 2) return para;
    const seenSentences = new Set();
    const uniqueSentences = [];
    for (const sent of sentences) {
      const norm = sent.trim().toLowerCase().replace(/\s+/g, " ");
      if (norm.length < 15) { uniqueSentences.push(sent); continue; }
      if (seenSentences.has(norm)) continue;
      seenSentences.add(norm);
      uniqueSentences.push(sent);
    }
    return uniqueSentences.join(" ");
  });
  return result.join("\n\n");
}

function stripLeakedMetaCommentary(text) {
  if (!text) return text;
  let cleaned = text.replace(/\[[^\[\]]{0,400}?\b(mechanical(?:ly)?(?: enforcement)?|post-?processed?|banned phrase|will be (?:stripped|revised|removed)|to comply with (?:the )?rules?|enforcement note)\b[^\[\]]{0,400}?\]/gi, "");
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

function stripBannedPhrases(text) {
  if (!text) return text;
  let cleaned = text;
  for (const re of BANNED_PHRASES_RE) { re.lastIndex = 0; cleaned = cleaned.replace(re, ""); }
  cleaned = cleaned.replace(/\s{2,}/g, " ").replace(/,\s*,/g, ",").replace(/\.\s*\./g, ".").replace(/\s+\./g, ".").replace(/\s+,/g, ",").replace(/^\s*[,;]\s*/gm, "");
  return cleaned.replace(/(?:^|\.\s+)[A-Z][a-z]{0,3}\s*\.(?=\s|$)/g, ".").trim();
}

function detectSourceListing(text) {
  if (!text) return 0;
  const patterns = [
    /\bsource \[\d+\] (discusses|examines|explores|investigates|reports|found|shows|demonstrates)/gi, /\baccording to \[\d+\]/gi,
    /\b(the|a) study (by|in|from) \[\d+\]/gi, /\bpaper \[\d+\] (found|showed|demonstrated|reported|examined|investigated)/gi,
    /\b\[\d+\] (found|showed|demonstrated|reported|examined|investigated|suggests?|indicates?)/gi, /\b(the|a) (first|second|third|fourth|fifth|sixth|seventh) (study|paper|source|article)/gi,
    /\b(study|paper) \d+ (found|showed|reported)/gi, /^[\s-]*\[?\d+\]?\s*[\w\s]+(found|showed|demonstrated|reported)/gim,
  ];
  let listingScore = 0;
  for (const re of patterns) { re.lastIndex = 0; const matches = text.match(re); if (matches) listingScore += matches.length * 15; }
  return Math.min(100, listingScore);
}

function detectWrongOrganismCitations(text) {
  const patterns = [
    /this study was conducted on (\w+),?\s*not\b/gi, /this (paper|study|research) (is|was) (about|on|conducted on) (\w+),?\s*(rather than|not|instead of)\b/gi,
    /although (this|the) (study|paper|research) (focused|focuses) on (\w+)\b/gi, /while (this|the) (study|paper|research) (examined|investigat|studied) (\w+),?\s*(not|rather than|instead of)\b/gi,
    /(\w+) (rather than|instead of|not) [A-Z][a-z]+ [a-z]+/g, /however,?\s*this (study|paper) (was|is) (conducted|performed|done) (on|in|with) (\w+)/gi,
  ];
  const violations = [];
  for (const re of patterns) { re.lastIndex = 0; let m; while ((m = re.exec(text)) !== null) { violations.push(m[0]); } }
  return violations;
}

// FIX: markdown headers leaking into UI
function postProcessAnswer(rawAnswer) {
  if (!rawAnswer) return rawAnswer;
  let answer = rawAnswer;
  answer = stripLeakedMetaCommentary(answer);
  answer = deduplicateContent(answer);
  answer = stripBannedPhrases(answer);

  const wrongOrgViolations = detectWrongOrganismCitations(answer);
  if (wrongOrgViolations.length > 0) {
    for (const violation of wrongOrgViolations) {
      const escaped = violation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sentenceRe = new RegExp('[^.!?]*' + escaped + '[^.!?]*[.!?]\\s*', 'gi');
      answer = answer.replace(sentenceRe, '');
    }
  }

  // Force isolated markdown headers to avoid sticking to previous paragraphs.
  answer = answer.replace(/([^\n])\s*(#{2,3}\s+[A-Z])/gi, "$1\n\n$2");
  answer = answer.replace(/(#{2,3}\s+[A-Za-z &]+[^\n]+)\n([^\n])/gi, "$1\n\n$2");

  return answer.replace(/\n{3,}/g, "\n\n").trim();
}

function extractLiteratureConflicts(answer, sources) {
  const conflicts = [];
  if (!answer || !sources || sources.length < 2) return conflicts;
  const contrastRe = /\[(\d+)\][^.]*?(?:found|showed|reported|demonstrated|observed|suggested|concluded)[^.]*?[.;,]\s*(?:however|in contrast|conversely|on the other hand|yet|but|whereas|while|although|despite this|nonetheless|nevertheless)[,]?\s*(?:[^[]*?)\[(\d+)\][^.]*?(?:found|showed|reported|demonstrated|observed|suggested|concluded|indicated)[^.]*?\./gi;
  let m;
  while ((m = contrastRe.exec(answer)) !== null) {
    const idxA = parseInt(m[1], 10) - 1, idxB = parseInt(m[2], 10) - 1;
    if (idxA >= 0 && idxA < sources.length && idxB >= 0 && idxB < sources.length && idxA !== idxB) {
      const halves = m[0].split(/(?:however|in contrast|conversely|on the other hand|yet|but|whereas|while|although|despite this|nonetheless|nevertheless)/i);
      if (halves.length >= 2) {
        conflicts.push({ claimA: halves[0].replace(/\[\d+\]/g, "").replace(/[,;]\s*$/, "").trim(), claimB: halves[1].replace(/\[\d+\]/g, "").replace(/^\s*,?\s*/, "").replace(/\.\s*$/, "").trim(), sourceA: sources[idxA].title || `Source ${idxA + 1}`, sourceB: sources[idxB].title || `Source ${idxB + 1}`, idxA: idxA + 1, idxB: idxB + 1 });
      }
    }
  }
  const conflictTermRe = /(?:conflict(?:ing|s)?|contradict(?:ory|s|ed)?|inconsisten(?:t|cy|cies)|disagree(?:s|ment)?|at odds|opposing|diverge(?:nt|s)?)\s+(?:with\s+)?[^.]*?\[(\d+)\][^.]*?\[(\d+)\][^.]*?\./gi;
  while ((m = conflictTermRe.exec(answer)) !== null) {
    const idxA = parseInt(m[1], 10) - 1, idxB = parseInt(m[2], 10) - 1;
    if (idxA >= 0 && idxA < sources.length && idxB >= 0 && idxB < sources.length && idxA !== idxB) {
      if (!conflicts.some((c) => (c.idxA === idxA + 1 && c.idxB === idxB + 1) || (c.idxA === idxB + 1 && c.idxB === idxA + 1))) {
        conflicts.push({ claimA: m[0].replace(/\[\d+\]/g, "").trim(), claimB: "", sourceA: sources[idxA].title || `Source ${idxA + 1}`, sourceB: sources[idxB].title || `Source ${idxB + 1}`, idxA: idxA + 1, idxB: idxB + 1 });
      }
    }
  }
  return conflicts.slice(0, 5);
}

function scoreAnswerQuality(answer, query) {
  if (!answer) return 0;
  let score = 50;
  if (answer.length < 100) score -= 20;
  else if (answer.length > 300) score += 10;
  let bannedCount = 0;
  for (const re of BANNED_PHRASES_RE) { re.lastIndex = 0; const matches = answer.match(re); if (matches) bannedCount += matches.length; }
  score -= bannedCount * 8;
  score -= detectSourceListing(answer) * 0.3;
  const paras = answer.split(/\n{2,}/).filter(p => p.trim().length > 20);
  if (paras.length > 1) { const uniqueParas = new Set(paras.map(p => p.trim().toLowerCase().replace(/\s+/g, " "))); score -= (1 - (uniqueParas.size / paras.length)) * 40; }
  score -= detectWrongOrganismCitations(answer).length * 15;
  if (/\bconsistent(ly)? (with|across)\b/i.test(answer)) score += 3;
  if (/\bin contrast\b/i.test(answer)) score += 3;
  if (/\bhowever\b/i.test(answer)) score += 2;
  if (/\bconversely\b/i.test(answer)) score += 2;
  if (/\b\d+%|\bp\s*[<>=]\s*0\.\d/i.test(answer)) score += 5;
  if (/\bn\s*=\s*\d/i.test(answer)) score += 3;
  if (/_([\w.]+\s+[\w]+)_/i.test(answer)) score += 3;
  if (/\b(in vitro|in vivo|ex vivo|in silico)\b/i.test(answer)) score += 2;
  if (/\bmeta-analysis\b/i.test(answer)) score += 2;
  const citCount = (answer.match(/\[\d+\]/g) || []).length;
  if (citCount >= 5 && citCount <= 30) score += 5;
  else if (citCount >= 3) score += 3;
  if (citCount > 40) score -= 5;
  const multiCiteMatches = answer.match(/\[\d+\]\[\d+\]/g);
  if (multiCiteMatches && multiCiteMatches.length >= 2) score += 5;
  return Math.max(0, Math.min(100, score));
}

const QUERY_RESOLVER_PROMPT = "You are a query-understanding module for Cerebrum. Understand what the user ACTUALLY wants. Output JSON ONLY: {\"intent\":\"new_search|followup_deeper|followup_related|followup_broader|correction|meta_question|source_request|conversational\", \"needs_search\": boolean, \"resolved_query\": \"...\", \"topic\": \"...\", \"reasoning\": \"...\"}. Replace pronouns using history. Expand acronyms. Do NOT use booleans in resolved_query.";

async function llmResolveQuery(query, history, prevSources, token) {
  if (!token) return null;
  const historyText = (history || []).slice(-8).map((t) => (t.role === "user" ? "User: " : "Cerebrum: ") + String(t.content || "").slice(0, 400)).join("\n");
  const sourceList = (prevSources || []).slice(0, 6).map((s, i) => "[" + (i + 1) + '] "' + (s.title || "Untitled") + '"').join("\n");
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 4000);
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ model: "deepseek/deepseek-chat-v3-0324:free", temperature: 0, max_tokens: 250, messages: [{ role: "system", content: QUERY_RESOLVER_PROMPT }, { role: "user", content: "CONVERSATION:\n" + (historyText || "(no history)") + "\n\nSOURCES CITED:\n" + (sourceList || "(none)") + '\n\nCURRENT MESSAGE: "' + query + '"' }] }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    try { const parsed = JSON.parse(txt.replace(/```json|```/g, "").trim()); if (parsed && typeof parsed.intent === "string") return parsed; } catch {}
  } catch {}
  return null;
}

function buildConversationContext(history, prevSources) {
  if (!Array.isArray(history) || !history.length) return null;
  const userQuestions = []; const assistantHighlights = []; const allEntities = new Set();
  for (const turn of history) {
    const content = String(turn.content || "").trim();
    if (!content) continue;
    if (turn.role === "user" && content.length > 3) {
      userQuestions.push(content.slice(0, 200));
      const bin = extractBinomial(content);
      if (bin) allEntities.add(bin.full);
      content.split(/\s+/).forEach((w) => { if (w.length > 4 && /^[A-Z][a-z]/.test(w) && !STOPWORDS.has(w.toLowerCase())) allEntities.add(w); });
    }
    if (turn.role === "assistant" && content.length > 20) {
      const firstSent = content.split(/[.!?]\s/)[0];
      if (firstSent && firstSent.length > 10 && firstSent.length < 200) assistantHighlights.push(firstSent.slice(0, 150));
    }
  }
  const sourceTitles = (prevSources || []).slice(0, 8).map((s, i) => "[" + (i + 1) + "] " + (s.title || "Untitled") + " (" + (s.year || "n/a") + ")");
  const entities = [...allEntities].slice(0, 15);
  const summary = userQuestions.length > 0 ? "The user has asked " + userQuestions.length + " question(s). Their investigation started with \"" + userQuestions[0].slice(0, 100) + "\"" + (userQuestions.length > 1 ? " and most recently asked \"" + userQuestions[userQuestions.length - 1].slice(0, 100) + "\"" : "") + (entities.length > 0 ? ". Key entities discussed: " + entities.slice(0, 8).join(", ") : "") + "." : null;
  return { userQuestions, assistantHighlights, entities, sourceTitles, turnCount: history.length, summary };
}

async function answerMetaQuestion(query, history, prevSources, conversationCtx, env) {
  const token = env.OPENROUTER_KEY;
  if (!token) return null;
  const sourceList = (prevSources || []).map((s, i) => "[" + (i + 1) + '] "' + (s.title || "Untitled") + '" — ' + (s.authors || "Unknown") + ", " + (s.journal || "Unknown") + ", " + (s.year || "n/a") + (s.url ? "\n    URL: " + s.url : "")).join("\n");
  const historyText = (history || []).slice(-6).map((t) => (t.role === "user" ? "User: " : "Cerebrum: ") + String(t.content || "").slice(0, 600)).join("\n\n");
  const ctxNote = conversationCtx && conversationCtx.summary ? "\n\nCONVERSATION SUMMARY: " + conversationCtx.summary : "";
  const messages = [
    { role: "system", content: "You are Cerebrum. The user is asking about your PREVIOUS response or sources. Answer based on the history and source list below. Rules: Reference specific papers by citation [N]. Keep species names italicized. Bold key terms. NEVER fabricate sources.\n\nCONVERSATION:\n" + (historyText || "(first message)") + "\n\nSOURCES:\n" + (sourceList || "(none)") + ctxNote },
    { role: "user", content: query },
  ];
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 10000);
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ model: "deepseek/deepseek-chat-v3-0324:free", temperature: 0.3, max_tokens: 1200, messages }), signal: c.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    if (txt.length > 20) return cleanAIResponse(txt);
    return null;
  } catch { return null; }
}

async function selfReason(query, history, token) {
  if (!token) return null;
  const historyText = (history || []).slice(-4).map((t) => (t.role === "user" ? "User: " : "Cerebrum: ") + String(t.content || "").slice(0, 200)).join("\n");
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ model: "deepseek/deepseek-chat-v3-0324:free", temperature: 0.1, max_tokens: 420, messages: [{ role: "system", content: "You are Cerebrum Intelligence. Output JSON only: {\"sub_questions\":[], \"search_strategy\":\"...\", \"key_terms\":[], \"expected_fields\":[], \"complexity\":\"...\", \"organisms\":[], \"alternative_explanations\":[], \"what_would_change_the_answer\":\"...\", \"answer_approach\":\"...\"}" }, { role: "user", content: (historyText ? "Context:\n" + historyText + "\n\n" : "") + 'Question: "' + query + '"' }] }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return JSON.parse((j?.choices?.[0]?.message?.content || "").trim().replace(/```json|```/g, ""));
  } catch { return null; }
}

async function describeImage(dataUrl, question, token) {
  if (!token || !dataUrl) return null;
  const visionModels = ["google/gemini-2.0-flash-exp:free", "meta-llama/llama-3.2-11b-vision-instruct:free", "qwen/qwen2.5-vl-32b-instruct:free"];
  for (const model of visionModels) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 9000);
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ model, temperature: 0.1, max_tokens: 500, messages: [{ role: "system", content: "You are a vision module. Describe the image with scientific precision. Do not answer the question." }, { role: "user", content: [{ type: "text", text: question ? `Question: "${question}". Describe image.` : "Describe image." }, { type: "image_url", image_url: { url: dataUrl } }] }] }),
        signal: c.signal,
      });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = await r.json();
      const txt = (j?.choices?.[0]?.message?.content || "").trim();
      if (txt.length > 10) return txt.slice(0, 2000);
    } catch {}
  }
  return null;
}

async function checkQueryIntelligence(queryKey, db) {
  if (!db) return null;
  try {
    const row = await db.prepare("SELECT resolved_query, intent, topic, entities, success_count FROM query_intelligence WHERE query_hash = ? AND success_count >= 1 LIMIT 1").bind(queryKey).first();
    if (row && row.resolved_query) return { resolved_query: row.resolved_query, intent: row.intent, topic: row.topic, entities: row.entities ? JSON.parse(row.entities) : [], confidence: Math.min(row.success_count / 3, 1) };
  } catch {}
  return null;
}

async function storeQueryIntelligence(queryKey, rawQuery, resolvedQuery, intent, topic, entities, db) {
  if (!db || !queryKey) return;
  try { await db.prepare("INSERT INTO query_intelligence (query_hash, raw_query, resolved_query, intent, topic, entities, success_count, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(query_hash) DO UPDATE SET success_count = success_count + 1, resolved_query = excluded.resolved_query, updated_at = excluded.created_at").bind(queryKey, rawQuery.slice(0, 500), resolvedQuery.slice(0, 500), intent, topic || "", JSON.stringify(entities || []), Date.now()).run(); } catch {}
}

async function updateTopicMemory(topic, searchTerms, paperCount, db) {
  if (!db || !topic) return;
  const topicKey = topic.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!topicKey) return;
  try { await db.prepare("INSERT INTO topic_memory (topic_key, related_terms, best_search_terms, avg_paper_count, search_count, updated_at) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(topic_key) DO UPDATE SET search_count = search_count + 1, avg_paper_count = (avg_paper_count * search_count + excluded.avg_paper_count) / (search_count + 1), best_search_terms = CASE WHEN excluded.avg_paper_count > avg_paper_count THEN excluded.best_search_terms ELSE best_search_terms END, updated_at = excluded.updated_at").bind(topicKey, JSON.stringify([]), JSON.stringify(searchTerms || []), paperCount || 0, Date.now()).run(); } catch {}
}

async function recallTopicMemory(topic, db) {
  if (!db || !topic) return null;
  const topicKey = topic.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!topicKey) return null;
  try {
    const row = await db.prepare("SELECT best_search_terms, avg_paper_count, search_count FROM topic_memory WHERE topic_key = ? AND search_count >= 2 LIMIT 1").bind(topicKey).first();
    if (row && row.best_search_terms) {
      const terms = JSON.parse(row.best_search_terms);
      if (Array.isArray(terms) && terms.length > 0) return { bestTerms: terms, avgPaperCount: row.avg_paper_count || 0, searchCount: row.search_count || 0 };
    }
  } catch {}
  return null;
}

// LATENCY FIX: Strict 12000ms bound for gatherPapers to prevent 80s hang
const GATHER_PAPERS_BUDGET_MS = 12000;
async function gatherPapers(rawQuery, opts) {
  const _searchStart = Date.now();
  const _budgetLeft = () => GATHER_PAPERS_BUDGET_MS - (Date.now() - _searchStart) > 0;
  const _outerDiag = { entered: true, phase: "start", rawQuery: (rawQuery || "").slice(0, 200) };

  try {
    const openAlexKey = (opts && opts.openAlexKey) || "";
    const ncbiKey = (opts && opts.ncbiKey) || "";
    const limit = (opts && opts.limit) || 25;
    
    _outerDiag.phase = "cleaned_query"; 
    const query = cleanQuery(preprocessQuery(rawQuery)); 
    _outerDiag.cleanedQuery = query.slice(0, 200);
    
    const resolvedPersonName = opts && opts.resolvedPersonName;
    const embeddedName = extractPersonNameFromQuery(rawQuery);
    const isNameQuery = !!resolvedPersonName || !!embeddedName;
    const effectiveName = resolvedPersonName || embeddedName || rawQuery.trim();
    const binomial = extractBinomial(correctBinomialTypos(rawQuery));

    if (isNameQuery) {
      _outerDiag.phase = "author_branch";
      const nameLower = effectiveName.toLowerCase();
      const nameTokens = nameLower.split(/\s+/).filter((t) => t.length > 1);
      const quoted = '"' + effectiveName + '"';

      const results = await Promise.allSettled([
        europePMC(quoted, 25), openAlex(quoted, 25, openAlexKey), crossref(quoted, 15),
        arxiv(effectiveName, 15), semanticScholar(quoted, 15),
        biorxivDirectAuthor(effectiveName), medrxivDirectAuthor(effectiveName),
      ]);

      const merged = [];
      const seenTitles = new Set();
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        for (const p of (r.value || [])) {
          const authorHay = (p._allAuthors || p.authors || "").toLowerCase();
          if (!authorHay || !nameTokens.every((t) => authorHay.includes(t))) continue;
          const titleKey = (p.title || "").toLowerCase().trim();
          if (!titleKey || seenTitles.has(titleKey) || isNonLiterature(p)) continue;
          seenTitles.add(titleKey);
          merged.push({ ...p, authorMatch: effectiveName });
        }
      }
      
      const scored = merged.map((p) => {
        const j = (p.journal || "").toLowerCase();
        let type = "Journal";
        if (/preprint|biorxiv|medrxiv|arxiv/.test(j)) type = "Preprint";
        else if (/zenodo|datacite|figshare|dryad/.test(j)) type = "Dataset";
        return { ...p, score: 10, contentHits: 1, contentCoverage: 1, organismPresent: true, relevance: 100, type };
      }).sort((a, b) => (b.citations || 0) - (a.citations || 0) || (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));

      if (scored.length) return { papers: scored };
      return { papers: [], noResults: true };
    }

    _outerDiag.phase = "before_ladder";
    const orgInfo = splitOrganismTopic(query);
    const orgFragments = new Set();
    if (orgInfo.hasOrganism) {
      for (const phrase of orgInfo.orgPhrases) for (const w of phrase.toLowerCase().split(/\s+/)) if (w.length > 2) orgFragments.add(w);
      for (const w of ORGANISM_WORDS) orgFragments.add(w);
    }

    const ranked = query.split(/[\s-]+/).filter((t) => t.length > 2 && !STOPWORDS.has(t) && !orgFragments.has(t)).map((t) => ({ t, spec: termSpecificity(t) })).sort((a, b) => b.spec - a.spec).map((x) => x.t);
    let organismTerm = null;
    if (binomial) {
      organismTerm = '"' + binomial.full + '"';
    } else if (orgInfo.hasOrganism && orgInfo.orgPhrases.length) {
      const expanded = orgInfo.orgPhrases.flatMap((p) => ORGANISM_BINOMIALS.has(p.toLowerCase()) ? [p] : (SYNONYMS[p.toLowerCase()] || []));
      const sciRaw = expanded.find((e) => /^[a-z]+ [a-z]+$/i.test(e) && e.split(" ").length === 2);
      if (sciRaw) {
        const parts = sciRaw.split(" ");
        organismTerm = '"' + parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase() + " " + parts[1].toLowerCase() + '"';
      } else if (expanded.length) organismTerm = '"' + expanded[0] + '"';
      else organismTerm = '"' + orgInfo.orgPhrases[0] + '"';
    }

    const allOrganismSciNames = (() => {
      const raw = orgInfo.orgPhrases.flatMap((p) => ORGANISM_BINOMIALS.has(p.toLowerCase()) ? [p] : (SYNONYMS[p.toLowerCase()] || []).filter((e) => ORGANISM_BINOMIALS.has(e.toLowerCase())));
      if (binomial) raw.push(binomial.full.toLowerCase());
      return [...new Set(raw.map((sciRaw) => { const parts = sciRaw.split(" "); return parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase() + " " + parts[1].toLowerCase(); }))];
    })();
    const primaryOrganismName = organismTerm ? organismTerm.replace(/"/g, "") : null;
    const secondaryOrganisms = allOrganismSciNames.filter((n) => n !== primaryOrganismName).slice(0, 2);

    const booleanQuery = buildStructuredQuery(query);

    let rungs = [ranked.slice(0, 4), ranked.slice(0, 3)].filter((r) => r.length > 0);
    if (!rungs.length) rungs.push([query]);
    if (organismTerm) rungs = rungs.map((rung) => [organismTerm, ...rung]);

    const fanout = (terms, useBoolean) => {
      const orgQuoted = organismTerm || "";
      const topicTerms = orgQuoted ? terms.filter((t) => t !== orgQuoted) : terms;
      const topicStr = topicTerms.join(" ");
      const boolQ = useBoolean ? (orgQuoted ? orgQuoted + " AND (" + (topicStr || query) + ")" : booleanQuery) : (orgQuoted ? orgQuoted + " " + topicStr : terms.join(" "));
      const bare = orgQuoted ? orgQuoted.replace(/"/g, "") + " " + topicStr : terms.join(" ");
      const arx = (orgQuoted ? [orgQuoted.replace(/"/g, ""), ...topicTerms] : terms).map((t) => "all:" + t).join(" AND ");

      return [
        europePMC(boolQ, 12), pubmed(boolQ, 12, ncbiKey), openAlex(bare, 12, openAlexKey),
        crossref(bare, 10), arxiv(arx, 8), semanticScholar(bare, 10), doaj(bare, 8),
        biorxiv(bare, 8), plos(bare, 8), coreSearch(bare, 8), baseSearch(bare, 8),
        pmcFullText(bare, 6), openAire(bare, 6),
      ];
    };

    // LATENCY FIX: Flattened fanout. Execute top 2 rungs + raw fallback simultaneously to limit sequential waiting to max ~4s.
    _outerDiag.phase = "ladder_start";
    let results = [];
    const diag = { rungs: [], sourceOutcomes: null };
    
    const combinedCalls = [
        ...fanout(rungs[0], true), 
        ...(rungs.length > 1 ? fanout(rungs[1], false) : [])
    ];
    
    // Send raw fallback in parallel just in case
    const rawQ = organismTerm ? organismTerm.replace(/"/g, "") + " " + query : query;
    combinedCalls.push(europePMC(rawQ, 12), semanticScholar(rawQ, 10), openAlex(rawQ, 10, openAlexKey));
    
    const allResults = await Promise.allSettled(combinedCalls);
    results = allResults;
    
    if (!_budgetLeft() || results.reduce((n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0) >= 8) {
      // Done.
    } else {
      // Secondary fallback if still thin, but check budget.
      if (_budgetLeft()) {
        const topicTermsForExpansion = ranked.slice(0, 3);
        const expandedQueries = new Set();
        for (const term of topicTermsForExpansion) {
          const group = CONCEPT_LOOKUP.get(term);
          if (group) {
            for (const alt of [...group].filter((g) => g !== term && g.length > 3).slice(0, 3)) {
              expandedQueries.add((organismTerm ? organismTerm.replace(/"/g, "") + " " + alt + " " + topicTermsForExpansion.filter((t) => t !== term).join(" ") : alt + " " + topicTermsForExpansion.filter((t) => t !== term).join(" ")).trim());
            }
          }
        }
        const expandedArr = [...expandedQueries].slice(0, 4);
        if (expandedArr.length) {
          const expandedResults = await Promise.allSettled(expandedArr.flatMap((eq) => [europePMC(eq, 8), semanticScholar(eq, 6)]));
          results = results.concat(expandedResults);
        }
      }
    }

    const merged = [];
    const seen = new Set();
    for (const res of results) {
      if (res.status === "fulfilled" && Array.isArray(res.value)) {
        for (const p of res.value) {
          if (isNonLiterature(p)) continue;
          const key = paperDedupeKey(p);
          if (key && !seen.has(key)) { seen.add(key); merged.push(p); }
        }
      }
    }

    const terms = query.toLowerCase().split(/[\s-]+/).map((t) => t.replace(/[^a-z0-9\-]/g, "")).filter((t) => t.length > 2 && !STOPWORDS.has(t));
    const expansions = expansionsFor(terms);
    const researchIntents = classifyResearchIntent(rawQuery);
    const neutralWords = new Set(terms.filter((t) => SYNONYMS[t]));
    for (const phrase of expansions) for (const w of phrase.toLowerCase().split(/\s+/)) if (w.length > 2) neutralWords.add(w);
    for (const w of ORGANISM_WORDS) if (terms.includes(w)) neutralWords.add(w);
    const contentTerms = terms.filter((t) => !neutralWords.has(t));

    const stem = (w) => {
      if (w.length <= 4) return w;
      const stripped = w.replace(/(ies|ied)$/i, "y").replace(/(es|s|ing|ed)$/i, "");
      return stripped.length >= 4 ? stripped : w;
    };

    const matcherCache = new Map();
    const matcherFor = (term) => {
      if (matcherCache.has(term)) return matcherCache.get(term);
      const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const t = esc(term), s = esc(stem(term));
      const group = CONCEPT_LOOKUP.get(term);
      const alts = new Set([t]);
      if (s !== t) alts.add(s + "(?:s|es|ing|ed|al)?"); else alts.add(t + "(?:s|es|ing|ed)?");
      if (group) for (const g of group) if (g !== term) alts.add(esc(g).replace(/\s+/g, "\\s+"));
      const body = [...alts].join("|");
      let re; try { re = new RegExp(`(?<![a-z0-9])(?:${body})(?![a-z0-9])`, "i"); } catch { re = new RegExp(`\\b(?:${body})\\b`, "i"); }
      matcherCache.set(term, re); return re;
    };

    const rankedTerms = contentTerms.map((t) => ({ t, spec: termSpecificity(t) })).sort((a, b) => b.spec - a.spec);
    const coreTerms = rankedTerms.filter((x) => x.spec >= 0.5).map((x) => x.t);
    const peripheralTerms = rankedTerms.filter((x) => x.spec < 0.5).map((x) => x.t);
    const gateTerms = coreTerms.length ? coreTerms : rankedTerms.slice(0, 3).map((x) => x.t);

    const compoundPairs = [];
    for (let i = 0; i < contentTerms.length - 1; i++) {
      const joined = contentTerms[i] + contentTerms[i + 1];
      if (joined.length >= 6) compoundPairs.push({ a: contentTerms[i], b: contentTerms[i + 1], joined });
    }

    const scored = merged.map((p) => {
      const title = p.title || "", abstract = p.abstract || "";
      const hay = (title + " " + abstract).toLowerCase(), titleHay = title.toLowerCase();
      const compoundSatisfied = new Set(), compoundSatisfiedTitle = new Set();
      for (const cp of compoundPairs) {
        if (matcherFor(cp.joined).test(hay)) { compoundSatisfied.add(cp.a); compoundSatisfied.add(cp.b); }
        if (matcherFor(cp.joined).test(titleHay)) { compoundSatisfiedTitle.add(cp.a); compoundSatisfiedTitle.add(cp.b); }
      }
      const has = (t) => compoundSatisfied.has(t) || matcherFor(t).test(hay);
      const hasTitle = (t) => compoundSatisfiedTitle.has(t) || matcherFor(t).test(titleHay);

      const gateCoreHits = gateTerms.filter(has).length, gateCoreTitleHits = gateTerms.filter(hasTitle).length;
      const contentHits = contentTerms.filter(has).length, titleContentHits = contentTerms.filter(hasTitle).length;
      
      const neutralHit = (() => {
        const orgWordsInPaper = [...neutralWords].filter(has);
        const GENERIC_ORG_WORDS = new Set(["fly", "black", "red", "blue", "white", "green", "brown", "common", "small", "large", "big", "long", "short", "wild", "mouse", "rat", "fish", "worm", "bug", "bee", "ant", "cat", "dog", "bird", "tree", "honey"]);
        const specificHits = orgWordsInPaper.filter(w => !GENERIC_ORG_WORDS.has(w));
        if (specificHits.length >= 1) return true;
        if (orgWordsInPaper.length >= 2) return true;
        return false;
      })();
      
      let expHit = false; for (const phrase of expansions) if (hay.indexOf(phrase.toLowerCase()) !== -1) { expHit = true; break; }
      let sciHit = false;
      if (organismTerm) {
        const sciClean = organismTerm.replace(/"/g, "").toLowerCase();
        if (hay.indexOf(sciClean) !== -1) sciHit = true;
        const sciParts = sciClean.split(" ");
        if (sciParts.length === 2 && hay.indexOf(sciParts[0][0] + ". " + sciParts[1]) !== -1) sciHit = true;
      }
      const organismPresent = neutralHit || expHit || sciHit;
      const contentCoverage = contentTerms.length ? contentHits / contentTerms.length : 1;
      const coreHitCount = gateTerms.filter(has).length, coreCoverage = gateTerms.length ? coreHitCount / gateTerms.length : 1;
      const coreTitleHits = gateTerms.filter(hasTitle).length, periphHits = peripheralTerms.filter(has).length;

      let match = (coreCoverage * 42) + (gateTerms.length ? (coreTitleHits / gateTerms.length) * 20 : 0) + (peripheralTerms.length ? (periphHits / peripheralTerms.length) * 4 : 0);
      if (organismPresent && (contentTerms.length === 0 || contentHits > 0)) match += 12;
      if (!organismPresent && contentTerms.length > 0 && binomial) match -= 5;

      let quality = (abstract.length > 200 ? 8 : abstract.length > 0 ? 3 : 0);
      if (typeof p.citations === "number") quality += Math.min(Math.log10(Math.max(1, p.citations)) * 4, 12);
      const yr = parseInt(p.year, 10);
      if (yr) { const age = new Date().getFullYear() - yr; quality += (age <= 2 ? 10 : age <= 5 ? 7 : age <= 10 ? 4 : age <= 20 ? 1 : 0); }

      const journalBonus = scoreJournalTier(p.journal); quality += journalBonus;
      const predPenalty = predatoryPenalty(p.journal, p.url); quality += predPenalty;
      const studyType = classifyStudyType(title, abstract);
      if (studyType) quality += studyType.weight + intentEvidenceBonus(studyType.key, researchIntents);
      quality += detectStatisticalRigor(abstract).rigorBonus;

      return { ...p, score: match + quality, matchScore: match, qualityScore: quality, journalTier: journalBonus > 0 ? journalBonus : undefined, studyType: studyType ? studyType.label : undefined, flaggedPublisher: predPenalty < 0 || undefined, contentHits, titleContentHits, contentCoverage, organismPresent, gateCoreHits, gateCoreTitleHits };
    }).filter((p) => {
      const title = (p.title || "").trim();
      if (title && (title.match(/[^\u0000-\u024F\u1E00-\u1EFF\s\d\-.,;:()[\]{}'"!?@#$%^&*+=/<>]/g) || []).length / title.length > 0.3) return false;
      if (terms.length === 0) return true;
      if (binomial) {
        const hay = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
        if (hay.indexOf(binomial.full.toLowerCase()) === -1 && hay.indexOf(binomial.species) === -1 && hay.indexOf(binomial.genus[0].toLowerCase() + ". " + binomial.species) === -1 && !secondaryOrganisms.some((name) => hay.indexOf(name.toLowerCase()) !== -1)) return false;
      }
      if (isNameQuery) return true;
      if (gateTerms.length > 0) {
        let required = gateTerms.length <= 2 ? 1 : gateTerms.length <= 6 ? 2 : 3;
        if ((p.gateCoreHits || 0) < required && (p.gateCoreTitleHits || 0) < 2) return false;
      }
      if (neutralWords.size > 0) return p.organismPresent && (contentTerms.length === 0 || p.contentHits > 0);
      return true;
    }).sort((a, b) => b.score - a.score).slice(0, limit);

    let finalScored = scored;
    if (scored.length < 3 && merged.length > 0) {
      const relaxed1 = merged.map((p) => {
        const hay = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
        const hasExpanded = (t) => { if (new RegExp("\\b" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(hay)) return true; const group = CONCEPT_LOOKUP.get(t); if (group) for (const g of group) if (g !== t && hay.indexOf(g.toLowerCase()) !== -1) return true; return false; };
        const coreHits = gateTerms.filter(hasExpanded).length;
        let orgPresent = false;
        if (organismTerm) { const sciClean = organismTerm.replace(/"/g, "").toLowerCase(); if (hay.indexOf(sciClean) !== -1) orgPresent = true; for (const w of ORGANISM_WORDS) if (hay.indexOf(w) !== -1) { orgPresent = true; break; } }
        return { ...p, score: (gateTerms.length ? coreHits / gateTerms.length : 0) * 40 + (orgPresent ? 15 : 0), contentHits: coreHits, organismPresent: orgPresent, relevance: null };
      }).filter((p) => p.contentHits > 0).sort((a, b) => b.score - a.score).slice(0, limit);
      if (relaxed1.length >= 3) finalScored = [...scored, ...relaxed1].sort((a, b) => b.score - a.score).slice(0, limit);
      else finalScored = [...scored, ...relaxed1, ...merged.filter((p) => (p.abstract || "").length > 100).map((p) => { const anyHit = [...contentTerms, ...gateTerms, ...[...neutralWords]].some((t) => ((p.title || "") + " " + (p.abstract || "")).toLowerCase().indexOf(t) !== -1); return { ...p, score: anyHit ? 20 : 5, contentHits: anyHit ? 1 : 0, organismPresent: false, relevance: null }; }).filter((p) => p.score > 5).sort((a, b) => (b.citations || 0) - (a.citations || 0)).slice(0, limit)].sort((a, b) => b.score - a.score).slice(0, limit);
    }
    
    for (const p of finalScored) {
      p.relevance = Math.max(0, Math.min(100, Math.round(p.score)));
      const j = (p.journal || "").toLowerCase();
      if (/wikipedia/.test(j)) p.type = "Reference";
      else if (/preprint|biorxiv|medrxiv|arxiv|ssrn|research square/.test(j)) p.type = "Preprint";
      else if (/zenodo|datacite|figshare|dryad/.test(j)) p.type = "Dataset";
      else p.type = "Journal";
    }

    return { papers: finalScored, _diag: diag };
  } catch (e) {
    console.error("Cerebrum gatherPapers threw:", _outerDiag.phase, e && e.stack ? e.stack : e);
    return { papers: [], _diag: { ..._outerDiag, threwAt: _outerDiag.phase, errorName: (e && e.name) || "Unknown" } };
  }
}

const ALLOWED_ORIGINS = ["https://askcerebrum.org", "https://www.askcerebrum.org", "https://cerebrum-2pz.pages.dev"];
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.cerebrum-2pz\.pages\.dev$/i;
function originAllowed(request) { const origin = request.headers.get("Origin") || ""; if (!origin) return true; return ALLOWED_ORIGINS.some((o) => origin === o) || PAGES_PREVIEW_RE.test(origin); }

const RATE_LIMIT = 20; const RATE_WINDOW_MS = 60000; const MAX_QUERY_LEN = 2000; const MAX_HISTORY_TURNS = 20;

export async function onRequest(context) {
  const { request, env, waitUntil } = context;
  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin = ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin) ? reqOrigin : "https://askcerebrum.org";
  const secureCors = { "Content-Type": "application/json", "Access-Control-Allow-Origin": corsOrigin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin", "X-Content-Type-Options": "nosniff" };

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: secureCors });
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: secureCors });
  if (!originAllowed(request)) return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers: secureCors });

  const clientIP = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  if (!(await checkRateLimit(env, `search:${clientIP}`, RATE_LIMIT, RATE_WINDOW_MS))) return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }), { status: 429, headers: { ...secureCors, "Retry-After": "30" } });

  try {
    const body = await request.json().catch(() => ({}));
    let query = (body.query || "").trim();
    const hasImage = typeof body.image === "string" && body.image.startsWith("data:image/");
    if (!query && !hasImage) return new Response(JSON.stringify({ error: "No query provided." }), { status: 400, headers: secureCors });
    if (!query && hasImage) query = "Identify and explain what this image shows, scientifically.";
    if (query.length > MAX_QUERY_LEN) query = query.slice(0, MAX_QUERY_LEN);
    if (Array.isArray(body.history) && body.history.length > MAX_HISTORY_TURNS) body.history = body.history.slice(-MAX_HISTORY_TURNS);
    const cors = secureCors;

    let imageContext = null;
    if (hasImage && body.image.length < 8_000_000 && env.OPENROUTER_KEY) {
      imageContext = await describeImage(body.image, query, env.OPENROUTER_KEY).catch(() => null);
      if (imageContext) query = (query + " " + imageContext).slice(0, MAX_QUERY_LEN);
    }

    const settings = body.settings || {};
    const answerLength = settings.answerLength || "medium";
    
    // FIX: Strict length enforcement
    const lengthHint = answerLength === "short"
        ? "Two to three focused paragraphs. Hit the key mechanism and the strongest evidence, then stop."
        : answerLength === "long"
        ? "MANDATORY LENGTH ENFORCEMENT: You MUST write a comprehensive academic synthesis EXCEEDING 800 WORDS. Dive deeply into effector genes, exact molecular pathways, and quantitative data. Name specific proteins and enzymes. Short, superficial summaries will be rejected. Five to eight substantive paragraphs minimum."
        : "Four to five clear paragraphs. Cover the core mechanism, key evidence with numbers, and any nuance. Explain thoroughly.";

    const maxTokens = answerLength === "short" ? 1200 : answerLength === "long" ? 4200 : 1800;
    const videos = [];

    if (env.DB) {
      try {
        const earlyCacheKey = versionedCacheKey(query);
        const earlyHit = await env.DB.prepare("SELECT answer, sources FROM answer_cache WHERE query_key = ? AND score >= 2 ORDER BY score DESC, created_at DESC LIMIT 1").bind(earlyCacheKey).first();
        if (earlyHit && earlyHit.answer) return new Response(JSON.stringify({ answer: earlyHit.answer, sources: JSON.parse(earlyHit.sources || "[]"), videos, factCheck: null, related: [], source: "Cached (verified)", _cached: true }), { status: 200, headers: cors });
      } catch {}
    }

    const prevAssistantForResolver = Array.isArray(body.history) ? [...body.history].reverse().find((t) => t && t.role === "assistant") : null;
    const prevSourcesForResolver = (prevAssistantForResolver && Array.isArray(prevAssistantForResolver.sources)) ? prevAssistantForResolver.sources : [];

    const resolverPromise = llmResolveQuery(query, body.history || [], prevSourcesForResolver, env.OPENROUTER_KEY).catch(() => null);
    const reasoningPromise = selfReason(query, body.history || [], env.OPENROUTER_KEY).catch(() => null);
    const conversationCtx = buildConversationContext(body.history || [], prevSourcesForResolver);
    const queryKey = query.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    const cachedIntelligence = await checkQueryIntelligence(queryKey, env.DB).catch(() => null);

    let resolvedPersonName = null;
    if (/\b(he|she|him|her|his|hers|they|them|their)\b/i.test(query) && !extractPersonNameFromQuery(query) && Array.isArray(body.history)) {
      for (let i = body.history.length - 1; i >= 0; i--) { if (body.history[i] && body.history[i].role === "user") { const priorName = extractPersonNameFromQuery((body.history[i].content || "").trim()); if (priorName) { resolvedPersonName = priorName; break; } } }
    }

    const intent = classifyIntent(query, body.history || []);
    const prevSources = prevSourcesForResolver;
    const pinnedSources = (Array.isArray(body.pinnedSources) ? body.pinnedSources : []).slice(0, 20);
    const corrections = (Array.isArray(body.corrections) ? body.corrections : []).slice(0, 15).map((c) => String(c == null ? "" : c).slice(0, 400)).filter(Boolean);

    const embeddedNameInFollowup = extractPersonNameFromQuery(query);
    const asksAboutExistingSources = /^(what|where|which|show me|list)\s+(are\s+)?(the\s+)?(papers?|sources?|studies|citations?|references?)\b/i.test(query.trim()) && !/\b(more|additional|other|new|different|further)\b/i.test(query);
    let wantsMorePapers = /\b(find\s+more|get\s+more|show\s+more|more|additional|other|further)\s+\w*\s*(papers?|sources?|studies|articles?|references?)\b/i.test(query) || /\b(what else|anything else|dig deeper|keep searching|search again|search more|find related)\b/i.test(query);
    const hasNewSubstance = !asksAboutExistingSources && Array.isArray(body.history) && [...body.history].reverse().find((t) => t && t.role === "user") && query.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !STOPWORDS.has(w) && !new Set([...body.history].reverse().find((t) => t && t.role === "user").content.toLowerCase().split(/\s+/).filter((w) => w.length > 3)).has(w) && w !== "papers" && w !== "sources").length >= 2;

    let forceNewSearch = !asksAboutExistingSources && (!!embeddedNameInFollowup || (hasNewSubstance && !(intent.kind === "correction" || (intent.kind === "followup" && intent.meta === true))) || wantsMorePapers);
    let isFollowupMode = !forceNewSearch && (intent.kind === "followup" || intent.kind === "correction") && (prevSources.length > 0 || pinnedSources.length > 0);

    const resolverResult = await resolverPromise;
    let resolvedSearchQuery = null; let llmResolvedTopic = null;

    if (resolverResult) {
      llmResolvedTopic = resolverResult.topic || null;
      switch (resolverResult.intent) {
        case "meta_question":
          const allMetaSources = [...pinnedSources, ...prevSources];
          const metaAnswer = await answerMetaQuestion(query, body.history || [], allMetaSources, conversationCtx, env);
          if (metaAnswer) return new Response(JSON.stringify({ answer: metaAnswer, answerId: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), sources: allMetaSources, videos, factCheck: null, related: [], source: "Conversation context", _resolverUsed: true, _resolverIntent: "meta_question" }), { status: 200, headers: cors });
          if (prevSources.length > 0 || pinnedSources.length > 0) { isFollowupMode = true; forceNewSearch = false; }
          break;
        case "source_request": wantsMorePapers = true; forceNewSearch = true; isFollowupMode = false; if (resolverResult.resolved_query && resolverResult.resolved_query.length > 5) resolvedSearchQuery = resolverResult.resolved_query; break;
        case "followup_deeper": case "followup_related": case "followup_broader":
          if (resolverResult.needs_search && resolverResult.resolved_query && resolverResult.resolved_query.length > 5) resolvedSearchQuery = resolverResult.resolved_query;
          if (prevSources.length > 0 || pinnedSources.length > 0) { isFollowupMode = true; forceNewSearch = false; } else if (resolverResult.needs_search) { forceNewSearch = true; isFollowupMode = false; }
          break;
        case "correction":
          if (prevSources.length > 0 || pinnedSources.length > 0) { isFollowupMode = true; forceNewSearch = false; } intent.kind = "correction"; break;
        case "new_search":
          forceNewSearch = true; isFollowupMode = false; if (resolverResult.resolved_query && resolverResult.resolved_query.length > 5) resolvedSearchQuery = resolverResult.resolved_query; break;
      }
    } else if (asksAboutExistingSources && (prevSources.length > 0 || pinnedSources.length > 0)) {
      const metaAnswerFb = await answerMetaQuestion(query, body.history || [], [...pinnedSources, ...prevSources], conversationCtx, env);
      if (metaAnswerFb) return new Response(JSON.stringify({ answer: metaAnswerFb, answerId: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), sources: [...pinnedSources, ...prevSources], videos, factCheck: null, related: [], source: "Conversation context", _resolverUsed: false }), { status: 200, headers: cors });
      isFollowupMode = true; forceNewSearch = false;
    }

    if (!resolverResult && cachedIntelligence && cachedIntelligence.confidence >= 0.5) {
      if (cachedIntelligence.intent === "meta_question" && (prevSources.length > 0 || pinnedSources.length > 0)) { isFollowupMode = true; forceNewSearch = false; }
      else if (cachedIntelligence.resolved_query && cachedIntelligence.resolved_query.length > 5) resolvedSearchQuery = cachedIntelligence.resolved_query;
    }

    let gResult;
    if (isFollowupMode) {
      const seenKeys = new Set(); const reused = [];
      for (const s of [...pinnedSources, ...prevSources]) { const key = (s.title || s.url || "").toLowerCase().trim(); if (!key || seenKeys.has(key)) continue; seenKeys.add(key); reused.push({ ...s, _allAuthors: s._allAuthors || s.authors || "", score: 10, contentHits: 1, contentCoverage: 1, organismPresent: true, relevance: 100 }); }
      let deepQuery = resolvedSearchQuery || query;
      if (!resolvedSearchQuery && Array.isArray(body.history)) {
        const prevUser = [...body.history].reverse().find((t) => t && t.role === "user" && (t.content || "").trim().length > 8);
        if (prevUser) deepQuery = (String(prevUser.content).trim() + " " + query).split(/\s+/).filter((w) => { const k = w.toLowerCase().replace(/[^a-z0-9]/g, ""); if (!k || k.length < 3 || seenKeys.has(k)) return false; seenKeys.add(k); return true; }).join(" ");
      }
      let deepPapers = [];
      try {
        const deepResult = await Promise.race([gatherPapers(deepQuery, { openAlexKey: env.OPENALEX_KEY || "", ncbiKey: env.NCBI_API_KEY || "", limit: 15, resolvedPersonName, db: env.DB }), new Promise((_, reject) => setTimeout(() => reject(new Error("deep search timeout")), 12000))]);
        deepPapers = (deepResult && deepResult.papers) || [];
      } catch { deepPapers = []; }
      for (const p of deepPapers) { const key = (p.title || p.url || "").toLowerCase().trim(); if (!key || seenKeys.has(key)) continue; seenKeys.add(key); reused.push(p); }
      gResult = { papers: reused, _isFollowup: true, _intent: intent.kind, _deepSearchFound: deepPapers.length };
    } else {
      let searchQuery = resolvedSearchQuery || query;
      if (wantsMorePapers && Array.isArray(body.history)) {
        const prevUser = [...body.history].reverse().find((t) => t && t.role === "user" && (t.content || "").trim().length > 8);
        if (prevUser) searchQuery = String(prevUser.content).trim() + " " + query.toLowerCase().replace(/\b(find|get|show|give|more|additional|other|new|different|further|related|papers?|sources?|studies|articles?|research|literature|references?|citations?|on|about|me|please|can|you|i|want|need|some)\b/gi, "").trim();
      }
      const llmQueriesPromise = llmGenerateSearchQueries(searchQuery, env.OPENROUTER_KEY).catch(() => []);
      gResult = await gatherPapers(searchQuery, { openAlexKey: env.OPENALEX_KEY || "", ncbiKey: env.NCBI_API_KEY || "", limit: wantsMorePapers ? 40 : 25, resolvedPersonName, db: env.DB }).catch((e) => { console.error("gatherPapers call rejected:", searchQuery, e); return { papers: [], _diag: { fatalError: String((e && e.message) || e).slice(0, 200), errorType: (e && e.name) || "Unknown" } }; });
      if ((gResult.papers || []).length < 5) {
        const llmQueries = await llmQueriesPromise;
        if (llmQueries.length > 0) {
          const llmSearches = llmQueries.flatMap((q) => [europePMC(q, 8).catch(() => []), semanticScholar(q, 6).catch(() => []), openAlex(q, 6, env.OPENALEX_KEY || "").catch(() => [])]);
          const llmResults = await Promise.allSettled(llmSearches);
          const seenTitles = new Set((gResult.papers || []).map(p => (p.title || "").toLowerCase().trim()));
          for (const r of llmResults) {
            if (r.status === "fulfilled" && Array.isArray(r.value)) {
              for (const p of r.value) { const key = (p.title || "").toLowerCase().trim(); if (key && !seenTitles.has(key)) { seenTitles.add(key); gResult.papers.push(p); } }
            }
          }
        }
      }
    }

    if (wantsMorePapers && prevSources.length > 0 && gResult.papers) {
      const seenTitles = new Set(prevSources.map(s => (s.title || "").toLowerCase().trim()).filter(Boolean));
      gResult.papers = gResult.papers.filter(p => !seenTitles.has((p.title || "").toLowerCase().trim()));
    }

    const isNameSearch = !!extractPersonNameFromQuery(query);
    if (gResult.noResults && isNameSearch && !isFollowupMode) return new Response(JSON.stringify({ answer: "I searched the databases and couldn't find any papers matching that author name. They may publish under a different initial or their work is not indexed yet.", sources: [], videos: [], factCheck: null, related: [], source: "No author match" }), { status: 200, headers: cors });

    const papers = gResult.papers || [];
    const hasPapers = papers.length > 0;

    const learnKey = versionedCacheKey(query);
    if (env.DB && learnKey && !isNameSearch) {
      try {
        const rows = await env.DB.prepare("SELECT title, url, journal, year, authors, abstract, times_confirmed FROM paper_cache WHERE query_key = ? ORDER BY times_confirmed DESC LIMIT 10").bind(learnKey).all();
        if (rows && rows.results && rows.results.length) {
          const seenTitles = new Set(papers.map((p) => (p.title || "").toLowerCase().trim()));
          for (const lp of rows.results) {
            const key = (lp.title || "").toLowerCase().trim();
            if (key && !seenTitles.has(key)) { papers.unshift({ ...lp, score: 95, relevance: 95, organismPresent: true, contentHits: 99, contentCoverage: 1, _learned: true }); seenTitles.add(key); }
          }
        }
      } catch {}
    }

    let webRefs = [];
    if (!hasPapers) {
      const [wiki, ddg] = await Promise.all([wikipedia(cleanQuery(query), 2).catch(() => []), duckduckgo(query).catch(() => [])]);
      const seen = new Set();
      for (const r of [...wiki, ...ddg]) { const k = (r.title || "").toLowerCase(); if (r.abstract && !seen.has(k)) { seen.add(k); webRefs.push(r); } }
      if (!webRefs.length) { const generic = await genericWebSearch(query).catch(() => []); for (const r of generic) { const k = (r.title || "").toLowerCase(); if (!seen.has(k)) { seen.add(k); webRefs.push(r); } } }
    }

    const useEvidence = hasPapers;
    const useWeb = !useEvidence && webRefs.length > 0;
    const speciesSearch = extractBinomial(query);
    const maxEvidence = wantsMorePapers ? 20 : 12;
    let evidencePapers = (isNameSearch || isFollowupMode) ? papers.slice(0, maxEvidence) : (() => { const strong = papers.filter((p) => (p.relevance || 0) >= 10); return (strong.length >= 2 ? strong : papers.slice(0, 8)).slice(0, maxEvidence); })();

    if (!isNameSearch && evidencePapers.length > 0) { try { evidencePapers = await llmValidatePapers(query, evidencePapers, env.OPENROUTER_KEY); } catch {} }
    if (evidencePapers.length > 0) { try { await flagRetractions(evidencePapers, 8); } catch {} }
    if (useEvidence && evidencePapers.length > 1) {
      const seenKeys = new Set();
      evidencePapers = evidencePapers.filter((p) => { const key = paperDedupeKey(p); if (!key) return true; if (seenKeys.has(key)) return false; seenKeys.add(key); return true; });
    }

    const sourceList = (useEvidence ? evidencePapers : useWeb ? webRefs : []).map(({ title, url, journal, authors, year, citations, relevance, type, tldr, retracted, concern, updateType }) => ({ title, url, journal, authors, year, citations, relevance: relevance == null ? null : relevance, type: type || "Reference", tldr: tldr || null, retracted: !!retracted, concern: !!concern, updateType: updateType || null }));
    const evidence = useEvidence ? evidencePapers.map((p, i) => "[" + (i + 1) + "] " + p.title + " (Authors: " + (p.authors || "n/a") + ", " + p.journal + ", " + (p.year || "n/a") + ")" + (p.retracted ? " [⚠ RETRACTED]" : "") + "\nAbstract: " + (p.abstract || "(no abstract available)")).join("\n\n") : useWeb ? webRefs.map((r, i) => "[" + (i + 1) + "] " + r.title + " (" + r.journal + ")\n" + r.abstract).join("\n\n") : "";

    const STRUCTURE = "═══ REQUIRED OUTPUT STRUCTURE (HARD-ENFORCED) ═══\nFormat the ENTIRE answer as exactly these four Markdown H2 sections, in this exact order: ## Core Synthesis, ## Evidence & Mechanisms, ## Divergent Findings & Gaps, ## Methodological Confidence. Every header MUST sit on its own line with a completely blank line before and after it.\n\n";
    const ID = "You are Cerebrum, a scientific research engine.\n\n";
    const PERSONALITY = "PERSONALITY: You are a sharp, curious researcher. State findings plainly. Do not hedge unnecessarily. Vary sentence length. Be concise.\n\n";

    let systemPrompt;
    if (wantsMorePapers && useEvidence) {
      systemPrompt = ID + PERSONALITY + "The user wants ADDITIONAL papers. Present the " + evidencePapers.length + " papers as a curated digest. State key finding with citation [N].\n\n" + lengthHint;
    } else if (useEvidence && speciesSearch) {
      systemPrompt = ID + PERSONALITY + "Question is about species: **" + speciesSearch.full + "**. Talk about THIS species specifically.\n\n" + lengthHint + "\n" + STRUCTURE;
    } else if (useEvidence) {
      systemPrompt = ID + PERSONALITY + "You have " + evidencePapers.length + " papers below. READ EACH ABSTRACT before answering. SYNTHESIZE findings, DO NOT LIST papers individually. Ground claims with inline citations [1][2].\n\n" + lengthHint + "\n" + STRUCTURE;
    } else {
      systemPrompt = ID + PERSONALITY + "No peer-reviewed papers matched. Answer from your knowledge directly without a disclaimer. Suggest search terms at the end.\n\n" + lengthHint + "\n" + STRUCTURE;
    }

    const messages = [{ role: "system", content: systemPrompt }];
    if (imageContext) messages.push({ role: "system", content: "The user attached an image. Vision description: " + imageContext });
    if (useEvidence && evidencePapers.length > 0) messages.push({ role: "system", content: "EVIDENCE PROFILE: Mixed-tier sources. Calibrate confidence." });
    if (conversationCtx && conversationCtx.summary) messages.push({ role: "system", content: "CONVERSATION CONTEXT:\n" + conversationCtx.summary });
    
    let selfReasonResult = await reasoningPromise;
    if (!selfReasonResult) { const fb = extractEntities(query); const fbT = [...fb.drugs, ...fb.pathways, ...fb.genes]; if (fbT.length) selfReasonResult = { key_terms: fbT }; }
    if (selfReasonResult) messages.push({ role: "system", content: "INTERNAL ANALYSIS: Focus on these key terms: " + (selfReasonResult.key_terms || []).join(", ") });
    if (corrections.length > 0) messages.push({ role: "system", content: "USER CORRECTIONS (treat as truth):\n" + corrections.map(c => `- ${c}`).join("\n") });
    if (isFollowupMode) messages.push({ role: "system", content: "FOLLOW-UP MODE: Build directly on previous turn. Do not repeat background. Answer the specific follow-up." });

    for (const turn of Array.isArray(body.history) ? body.history.slice(-10) : []) {
      if (turn.role === "user") messages.push({ role: "user", content: String(turn.content || "").slice(0, 1500) });
      else if (turn.role === "assistant") messages.push({ role: "assistant", content: String(turn.content || "").slice(0, 1500) });
    }

    const enforcer = useEvidence ? "\n\n[MECHANICAL ENFORCEMENT: 1. Cite only on exact organism. 2. Synthesize, DO NOT list sources. 3. Strip filler. 4. Italicize species names. 5. Bold key terms.]" : "";
    messages.push({ role: "user", content: (useEvidence || useWeb ? "Sources:\n\n" + evidence + "\n\n---\nQuestion: " + query : query) + enforcer });

    const cacheKey = versionedCacheKey(query);
    let cachedAnswer = null;
    if (env.DB && sourceList.length > 0) {
      try { const cached = await env.DB.prepare("SELECT answer, sources, score, created_at FROM answer_cache WHERE query_key = ? AND score >= 0 ORDER BY score DESC, created_at DESC LIMIT 1").bind(cacheKey).first(); if (cached && cached.answer) cachedAnswer = cached; } catch {}
    }
    if (cachedAnswer && cachedAnswer.score >= 2) return new Response(JSON.stringify({ answer: cachedAnswer.answer, sources: sourceList, videos, factCheck: null, related: [], source: "Cached (verified)", _cached: true }), { status: 200, headers: cors });

    let answer = "";
    let aiOK = false;
    const token = env.OPENROUTER_KEY;
    const minAnswerLen = answerLength === "long" ? 2500 : answerLength === "short" ? 30 : 150;

    const callOR = async (model, msgs, maxTok, timeoutMs = 15000) => {
      if (!token) throw new Error("No KEY");
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), timeoutMs);
      try {
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ model, temperature: 0.3, max_tokens: maxTok, messages: msgs }), signal: c.signal });
        clearTimeout(t);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        const txt = j?.choices?.[0]?.message?.content || "";
        const cleaned = cleanAIResponse(txt);
        if (cleaned.length < minAnswerLen) throw new Error("too short");
        return { answer: cleaned, model };
      } catch (e) { clearTimeout(t); throw e; }
    };

    const callCF = async (model, msgs, maxTok, timeoutMs = 15000) => {
      if (!env.AI) throw new Error("No env.AI");
      try {
        const out = await Promise.race([env.AI.run(model, { messages: msgs, max_tokens: Math.min(maxTok, 2048) }), new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), timeoutMs))]);
        const cleaned = cleanAIResponse((out && out.response) || "");
        if (cleaned.length < minAnswerLen) throw new Error("too short");
        return { answer: cleaned, model };
      } catch (e) { throw e; }
    };

    const aiAttempts = [];
    const OR_WAVE1 = ["deepseek/deepseek-chat-v3-0324:free", "google/gemini-2.0-flash-exp:free", "meta-llama/llama-3.3-70b-instruct:free"];
    const CF_WAVE1 = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"];
    
    // Wave 1 execution
    const wave1Calls = [...(token ? OR_WAVE1.map((m) => callOR(m, messages, maxTokens)) : []), ...(env.AI ? CF_WAVE1.map((m) => callCF(m, messages, maxTokens)) : [])];
    try {
      const winner = await Promise.any(wave1Calls);
      answer = winner.answer; aiOK = true;
    } catch (e) {
      aiAttempts.push("Wave 1 failed");
    }

    if (!aiOK) {
      answer = sourceList.length > 0 ? "Cerebrum's AI synthesis timed out or failed to complete, but the sources below were found and are ready to read directly." : "Cerebrum's AI synthesis didn't complete for this question, and no sources were found either. Please try again in a moment.";
    }

    // FIX: Apply isolated formatting replacements to the answer text
    if (aiOK) {
      answer = postProcessAnswer(answer);
    }

    if (env.DB && aiOK && sourceList.length > 0 && answer.length > 50) {
      const answerId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const cacheWrite = env.DB.prepare("INSERT OR REPLACE INTO answer_cache (query_key, answer_id, answer, sources, score, created_at) VALUES (?, ?, ?, ?, 0, ?)").bind(cacheKey, answerId, answer, JSON.stringify(sourceList.slice(0, 10)), Date.now()).run().catch(() => {});
      if (typeof waitUntil === "function") waitUntil(cacheWrite); else await cacheWrite;
    }

    let factCheckResult = null;
    if (settings.factCheck && useEvidence && evidencePapers.length > 0) {
      const deepClaims = await deepFactCheck(answer, evidencePapers, env).catch(() => null);
      if (deepClaims) {
        const unsupportedCount = deepClaims.filter((c) => c.status === "unsupported").length;
        const supportedCount = deepClaims.filter((c) => c.status === "supported").length;
        const thinCount = deepClaims.filter((c) => c.status === "thin").length;
        const overall = unsupportedCount === 0 ? "supported" : (supportedCount > 0 || thinCount > 0) ? "partly" : "unsupported";
        factCheckResult = { overall, summary: `Checked ${deepClaims.length} claims.`, claims: deepClaims };
      } else {
        const fc = verifyAnswerAgainstSources(answer, evidencePapers);
        if (fc.checked) {
          const overall = fc.unsupported.length === 0 ? "supported" : (fc.supported.length > 0 || fc.thin.length > 0) ? "partly" : "unsupported";
          const claims = [...fc.supported.map((term) => ({ claim: `References "${term}"`, status: "supported" })), ...fc.thin.map((term) => ({ claim: `References "${term}"`, status: "thin" })), ...fc.unsupported.map((term) => ({ claim: `References "${term}"`, status: "unsupported" }))];
          factCheckResult = { overall, summary: fc.note, claims };
        }
      }
    }

    const literatureConflicts = extractLiteratureConflicts(answer, sourceList);

    return new Response(JSON.stringify({
      answer, sources: sourceList, videos, factCheck: factCheckResult,
      literature_conflicts: literatureConflicts.length > 0 ? literatureConflicts : null,
      related: [], answerId: Date.now().toString(36),
      source: aiOK && useEvidence ? "Scientific databases + AI" : aiOK && useWeb ? "Reference sources + AI" : aiOK ? "General knowledge (AI)" : "Scientific databases",
      _diag: gResult && gResult._diag ? gResult._diag : null, _aiAttempts: aiAttempts,
    }), { status: 200, headers: cors });

  } catch (e) {
    console.error("Cerebrum /api/search top-level error:", e && e.stack ? e.stack : e);
    const msg = (e.message || String(e)).toLowerCase();
    let userMessage = "Something went wrong on our end. Please try again in a moment.";
    let status = 500;
    if (msg.includes("rate") || msg.includes("429") || msg.includes("quota")) { userMessage = "Our AI providers are temporarily rate-limited. Try again in 30 seconds."; status = 503; }
    else if (msg.includes("timeout") || msg.includes("abort") || msg.includes("timed out")) { userMessage = "The search took too long. Try a simpler query or try again shortly."; status = 504; }
    else if (msg.includes("network") || msg.includes("fetch")) { userMessage = "Couldn't reach one of our data sources. Give it a moment and retry."; status = 502; }
    return new Response(JSON.stringify({ error: userMessage }), { status, headers: secureCors });
  }
}
