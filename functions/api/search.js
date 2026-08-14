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

// Standard headers every outbound request should carry. Several free scholarly
// APIs (Crossref, OpenAlex, Europe PMC) route "polite" traffic — identifiable
// requests with a User-Agent and mailto — to a faster, higher-quota pool than
// anonymous ones. Anonymous requests can be silently deprioritized or rate-
// limited to unusable levels. This alone can be the difference between "zero
// papers" and "papers returned".
const POLITE_UA =
  "Cerebrum/1.0 (askcerebrum.org; a free scientific literature search; mailto:contact@askcerebrum.org)";

async function getJSON(url, headers = {}, timeoutMs = 6500) {
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
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function getText(url, headers = {}, timeoutMs = 6500) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": POLITE_UA, ...headers },
      signal: c.signal,
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    clearTimeout(t);
    if (res.status === 429) throw new Error("HTTP 429 rate-limited");
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
// When we have NO sources, the model sometimes invents a full reference list
// anyway — prompt instructions are not a reliable guard against this. This
// strips every citation artifact mechanically so a fabricated bibliography can
// never reach the user. Also used to remove citations that point past the end
// of a real source list (e.g. the model writes [7] when only 4 sources exist).
function stripFabricatedCitations(text, sourceCount) {
  if (!text) return text;
  let t = text;

  // 0. Normalize Markdown-link citations back to bare brackets so downstream
  //    logic sees `[1]` not `[1](#ref-1)`.
  t = t.replace(/\[(\d+)\]\((?:https?:\/\/|#)[^\s)]+\)/g, "[$1]");

  // 0a. Bare-digit citation markers. Model sometimes writes "networks 12"
  //     instead of "networks [1][2]" — two adjacent superscripts run together
  //     as plain digits. Convert clumped digits (2-3 in a row after a word)
  //     into bracketed markers so the downstream stripper can handle them,
  //     OR delete them if they exceed source count.
  t = t.replace(/([a-z\)\]])\s+(\d{1,3})(?=[\s.,;:!?)])/gi, (m, before, digits) => {
    // Split "12" into [1][2], "123" into [1][2][3]
    const nums = digits.split("").map((d) => parseInt(d, 10));
    if (nums.some((n) => n < 1)) return m;
    if (sourceCount === 0) return before;
    if (nums.every((n) => n <= sourceCount)) {
      return before + nums.map((n) => "[" + n + "]").join("");
    }
    return before;
  });

  // 0b. Strip any "References:" / "Sources:" / "Bibliography:" section the
  //     model appended, regardless of sourceCount. We render the real
  //     bibliography separately from the answer, so ANY inline references
  //     block the model writes is either a duplicate (when it matches) or a
  //     fabrication (when it doesn't) — either way, remove it.
  t = t.replace(/\n[-—]{2,}\s*\n/g, "\n\n");
  t = t.replace(/\n\s*(references|sources|bibliography|citations|works cited)\s*:?\s*\n[\s\S]*$/i, "").trim();

  // 0c. Headerless trailing citation block. Model writes a numbered list of
  //     citations at the bottom WITHOUT a "References:" header — just:
  //     "1 Deng, L., & Yan, W. (2012). ..."
  //     Detect lines starting with a digit and a Name-comma-Initial pattern,
  //     and strip from the first such line if it lands in the tail of the
  //     answer.
  const linesForCite = t.split(/\n/);
  const citationLineRe = /^\s*\d{1,3}\.?\s+[A-Z][A-Za-zöäüéèçñ\-']+,\s+[A-Z]\./;
  let firstCiteLine = -1;
  for (let i = 0; i < linesForCite.length; i++) {
    if (citationLineRe.test(linesForCite[i])) { firstCiteLine = i; break; }
  }
  if (firstCiteLine !== -1) {
    const cutoff = linesForCite.slice(0, firstCiteLine).join("\n").length;
    if (cutoff > t.length * 0.35) {
      t = linesForCite.slice(0, firstCiteLine).join("\n").trimEnd();
    }
  }

  // 1. Remove any trailing "References:" / "Sources:" / "Bibliography:" block.
  //    These are almost always fabricated when sourceCount is 0.
  if (sourceCount === 0) {
    t = t.replace(/\n\s*(references|sources|bibliography|citations|works cited)\s*:?[\s\S]*$/i, "");

    // 1b. Headerless bibliography. Model writes references at the end WITHOUT
    //     a "References:" header — as free-standing citation lines. Detect any
    //     line that starts with "Lastname, X. ... (YYYY)." and strip from the
    //     first such line onward if it lands in the tail of the answer.
    const lines = t.split(/\n/);
    // Match: "Lastname, A." or "Lastname, A. B." (with optional & or comma
    // authors after), then anywhere on the line a "(YYYY)." — this catches
    // APA-style entries whether the title is on the same line or a wrap.
    const apaStart = /^\s*[A-Z][A-Za-zöäüéèçñ\-']+,\s+[A-Z]\.(?:\s?[A-Z]\.)?(?:\s*,\s*(?:&|and)?\s*[A-Z][A-Za-zöäüéèçñ\-']+,\s+[A-Z]\.(?:\s?[A-Z]\.)?)*.*\(\d{4}\)/;
    let firstBibLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (apaStart.test(lines[i])) { firstBibLine = i; break; }
    }
    if (firstBibLine !== -1) {
      // Only strip if it's in the last ~third of the answer (avoid killing a
      // legitimate in-body author reference).
      const cutoffChars = lines.slice(0, firstBibLine).join("\n").length;
      if (cutoffChars > t.length * 0.4) {
        t = lines.slice(0, firstBibLine).join("\n").trimEnd();
      }
    }
  }

  // 2. Strip bracketed citation markers that have no matching source.
  t = t.replace(/\[(\d{1,3})\]/g, (m, n) => {
    const idx = parseInt(n, 10);
    if (sourceCount === 0) return "";          // nothing to cite
    if (idx < 1 || idx > sourceCount) return ""; // dangling reference
    return m;                                    // valid, keep
  });

  if (sourceCount === 0) {
    // 3. Strip author-year parentheticals: (Smith, 2020), (Smith & Jones 2019),
    //    (Smith et al., 2021). Only when we have no sources at all — with real
    //    sources these could legitimately appear inside a quoted title.
    t = t.replace(/\((?:[A-Z][A-Za-z\-']+(?:,| &| and|\set al\.?)?[\s,]*){1,4}\d{4}[a-z]?\)/g, "");

    // 3b. Strip freestanding APA-style reference lines. The model sometimes
    //     appends "Author, A. B. (2020). Title. Journal, 12(3), 45-67." at the
    //     end even with brackets forbidden. These are always fabricated when
    //     sourceCount is 0. Run iteratively so multiple back-to-back
    //     references all get removed, not just the first.
    const refPattern = /(?:[A-Z][a-zA-Z\-']+,\s+[A-Z]\.(?:\s*[A-Z]\.)*(?:,\s*(?:&\s+)?[A-Z][a-zA-Z\-']+,\s+[A-Z]\.(?:\s*[A-Z]\.)*)*)\s*\(\d{4}[a-z]?\)\.\s*[^.]{5,120}?\.(?:\s*[^.]{3,80}?,\s*\d+(?:\(\d+\))?,\s*\d+[-–]\d+\.)?/g;
    for (let pass = 0; pass < 6; pass++) {
      const before = t;
      t = t.replace(refPattern, "");
      if (t === before) break;
    }
    // "Smith et al. (2021)" style inline
    t = t.replace(/\b[A-Z][a-zA-Z\-']+\s+et\s+al\.\s*\(\d{4}[a-z]?\)/g, "");
    // Bare "According to Author (2019),"
    t = t.replace(/(?:^|\s)According to\s+[A-Z][a-zA-Z\-']+(?:\s+(?:and|&)\s+[A-Z][a-zA-Z\-']+)?\s*\(\d{4}[a-z]?\)\s*,\s*/gi, " ");

    // 4. Strip superscript-style numeric refs left dangling after words.
    t = t.replace(/([a-z])\s*\u00b9|\u00b2|\u00b3|[\u2070-\u2079]/g, "$1");

    // 5. Strip PROSE-form invented references. With no retrieved papers the
    //    model still writes things like "a 2002 study published in the Journal
    //    of Biological Chemistry reported that..." — no brackets, so the
    //    citation stripper above misses it, but it is entirely fabricated.
    //    We remove the attribution clause and keep the claim, so the sentence
    //    survives as a general statement instead of a fake citation.
    const proseRefs = [
      // "a 2019 study published in Nature reported that" / "...found that"
      /\b(?:a|an|one)\s+\d{4}\s+(?:study|paper|article|report|review|analysis)\s+(?:published\s+)?(?:in\s+(?:the\s+)?(?:journal\s+)?[A-Z][A-Za-z&.\s]{2,60}?\s+)?(?:reported|found|showed|demonstrated|revealed|concluded|suggested)\s+that\s+/gi,
      // "a study published in the journal Science reported that"
      /\b(?:a|an|one)\s+(?:study|paper|article|report|review)\s+published\s+in\s+(?:the\s+)?(?:journal\s+)?[A-Z][A-Za-z&.\s]{2,60}?\s+(?:reported|found|showed|demonstrated|revealed|concluded|suggested)\s+that\s+/gi,
      // "according to a 2018 paper in Cell,"
      /\baccording\s+to\s+(?:a|an|the)\s+(?:\d{4}\s+)?(?:study|paper|article|report|review)\s+(?:published\s+)?in\s+(?:the\s+)?(?:journal\s+)?[A-Z][A-Za-z&.\s]{2,60}?,\s*/gi,
      // "research published in PNAS in 2020 showed"
      /\bresearch\s+published\s+in\s+(?:the\s+)?(?:journal\s+)?[A-Z][A-Za-z&.\s]{2,60}?(?:\s+in\s+\d{4})?\s+(?:reported|found|showed|demonstrated|revealed)\s+(?:that\s+)?/gi,
    ];
    for (const re of proseRefs) {
      t = t.replace(re, (m) => {
        // Keep the sentence readable: "For instance, X" rather than a fragment.
        return "";
      });
    }
    // Capitalize any sentence left starting lowercase after a removal.
    t = t.replace(/(^|[.!?]\s+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
  }

  // 5. Tidy the punctuation left behind by removals.
  t = t.replace(/[ \t]{2,}/g, " ");
  t = t.replace(/\s+([.,;:!?])/g, "$1");
  t = t.replace(/([.,;:])\1+/g, "$1");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

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

  // 1. XML reasoning tags (multiple formats used by different models)
  c = c.replace(/<think>[\s\S]*?<\/think>/gi, "");
  c = c.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  c = c.replace(/<internal>[\s\S]*?<\/internal>/gi, "");
  c = c.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "");
  c = c.replace(/<planning>[\s\S]*?<\/planning>/gi, "");

  // 2. Code fences wrapping entire response
  c = c.replace(/^```(?:markdown)?\s*\n([\s\S]*?)\n```\s*$/i, "$1");

  // 3. System meta-talk
  c = c.replace(/^\s*User Safety:\s*safe\.?\s*/gim, "");
  c = c.replace(/^\s*\[?(Safety|Content|Compliance)\s*(Rating|Check|Assessment)[:\s]*\w+\]?\s*/gim, "");

  // 4. Kill meta-planning opening paragraphs (EXPANDED in v6.0)
  const badOpeners = [
    /^the user is asking/i,
    /^the user wants/i,
    /^the user('s)? question/i,
    /^let me review/i,
    /^let me check/i,
    /^let me think/i,
    /^let me analyze/i,
    /^let me examine/i,
    /^let me look at/i,
    /^i need to provide/i,
    /^i'll write/i,
    /^i will now/i,
    /^i will provide/i,
    /^i will analyze/i,
    /^let's analyze/i,
    /^let's examine/i,
    /^let's look at/i,
    /^let's review/i,
    /^here is a summary of the papers/i,
    /^here is (a|the|my) (comprehensive|detailed|thorough)/i,
    /^here is what (we|the|i) know/i,
    /^first,? i'll/i,
    /^first,? let me/i,
    /^first,? let's/i,
    /^okay,? let me/i,
    /^to answer this/i,
    /^to address this/i,
    /^to respond to/i,
    /^now we need to/i,
    /^now,? let me/i,
    /^based on the (provided|available|given) (sources|papers|literature|research|evidence)/i,
    /^the (provided|available|given) (sources|papers|literature|research|evidence)/i,
    /^looking at the (provided|available|given)/i,
    /^after (reviewing|examining|analyzing|reading)/i,
    /^having (reviewed|examined|analyzed|read)/i,
    /^upon (reviewing|examining|analyzing|reading)/i,
    /^the research (shows|indicates|suggests|demonstrates)/i,
    /^the (available )?literature (shows|indicates|suggests|demonstrates)/i,
    /^several studies/i,
    /^the available evidence/i,
    /^recent research/i,
    /^according to the sources/i,
  ];

  // Strip self-introductions and acknowledgement filler
  c = c.replace(/^\s*(that'?s (correct|right)[,.]?\s*)?(cerebrum here|as cerebrum|i'?m cerebrum|this is cerebrum)[,.!]?\s*/i, "");
  c = c.replace(/^\s*(great|good|excellent|interesting|wonderful|fantastic)\s+question[,.!]?\s*/i, "");
  c = c.replace(/^\s*(sure|certainly|absolutely|of course|indeed)[,.!]\s*/i, "");
  c = c.replace(/^\s*that'?s (correct|right|a great|an excellent|an interesting)[,.]\s+/i, "");
  c = c.replace(/^\s*thank you for (your|the|this)\s+/i, "");
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
  c = c.replace(/^(here is the answer|here's the answer|here's my (analysis|response|answer))[:\.]?\s*/i, "").trim();
  c = c.replace(/^(to summarize|to sum up|in short)[,:]?\s*/i, "").trim();

  // 6. Strip "Paper 1 discusses...Paper 2 discusses..." robotic patterns from the opening
  c = c.replace(/^(paper\s+\d+[:\s][^\n]+\n+){2,}/i, "").trim();
  // Also catch "Source [1] discusses..." patterns
  c = c.replace(/^(source\s+\[\d+\][:\s][^\n]+\n+){2,}/i, "").trim();

  // 7. Strip trailing filler conclusions (v6.0)
  // Many free models add a "In conclusion, further research is needed" paragraph
  c = c.replace(/\n\n(In conclusion|In summary|To conclude|To summarize|Overall),?\s+[^\n]+$/i, "").trim();

  return c;
}

// ============ QUERY LOGIC ============

// ---- TERM SPECIFICITY ----
// Not every word in a question carries equal search weight. In
// "What types of enzymes do insects have to degrade plastic compounds, and how
// do gut microbes capitalize from them?" the words that actually identify the
// topic are enzymes / insects / plastic / gut / microbes. Words like types,
// compounds, capitalize are scientific filler — they appear in millions of
// papers and matching them proves nothing.
//
// Requiring a flat percentage of ALL terms was rejecting correct papers for
// verbose questions (a real Nature Communications paper on waxworm saliva
// enzymes scored 22% and got dropped). We now separate CORE terms from
// PERIPHERAL ones and gate only on CORE coverage.
// Words that describe INTENT rather than TOPIC. High-value in conversation
// ("papers that CAUTION against"), useless as search anchors. If we let these
// dominate the anchor list, the actual domain terms get pushed off the top.
const INTENT_WORDS = new Set([
  "raise", "raises", "raising", "argue", "argues", "arguing", "suggest", "suggests",
  "caution", "cautions", "warn", "warns", "warning", "critique", "critiques",
  "review", "reviews", "reviewing", "discuss", "discusses", "discussing",
  "papers", "paper", "article", "articles", "study", "studies", "work", "works",
  "recommend", "recommends", "propose", "proposes", "consider", "considers",
  "using", "used", "use", "uses", "usage", "applying", "apply",
  "about", "regarding", "concerning", "against", "with", "without",
  "against", "toward", "towards", "on",
  "turning", "turn", "turned", "turns", "convert", "converting", "converted",
  "transform", "transforming", "transformed", "make", "making", "create", "creating",
  "produce", "producing", "produced", "into", "from",
]);

// Common misspellings and variants of scientific terms. Search engines don't
// autocorrect — a typo returns zero. This runs before term extraction so the
// canonical spelling reaches the API.
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

// Multi-word scientific terms that must be preserved as a phrase. Users type
// them variably — "co occurrence", "co-occurrence", "cooccurrence" — but all
// should become the canonical hyphenated form for search.
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
];

// Preprocess a raw query BEFORE term extraction. Fixes typos, joins scientific
// compounds, so downstream code sees the canonical form.
function preprocessQuery(raw) {
  let q = " " + (raw || "").toLowerCase() + " ";
  // Binomial typo correction before anything else — fixes voice-dictation
  // mangling like "Hermetia illucens" -> "Hermia illusions" so the organism
  // detector below (which needs the correct spelling) actually recognizes
  // the species instead of silently falling through to a generic keyword
  // search across every field that happens to mention "microbiome".
  q = " " + correctBinomialTypos(q.trim()) + " ";
  // Spelling correction FIRST — otherwise a misspelled half of a compound
  // ("co occurance") won't match the compound pattern (which expects the
  // correct spelling).
  const words = q.split(/(\s+)/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^a-z-]/g, "");
    if (w && SPELLING_CORRECTIONS[w]) {
      words[i] = words[i].replace(w, SPELLING_CORRECTIONS[w]);
    }
  }
  q = words.join("");
  // Then join scientific compounds so "co occurrence" becomes "co-occurrence".
  for (const [re, canonical] of SCIENTIFIC_COMPOUNDS) {
    q = q.replace(re, canonical);
  }
  // Scientific paraphrase: rewrite natural-language concepts into proper
  // search terminology. "turning air into ethanol" should search for
  // "CO2 ethanol conversion", not "air ethanol".
  const PARAPHRASES = [
    [/turning\s+air\s+into/gi, "CO2 conversion to"],
    [/air\s+(?:to|into)\s+(ethanol|fuel|methanol|plastic)/gi, "CO2 conversion to $1"],
    [/(ethanol|fuel|methanol)\s+from\s+air/gi, "$1 from CO2 atmospheric carbon capture"],
    [/cure\s+(?:for\s+)?cancer/gi, "cancer treatment therapy"],
    [/cure\s+(?:for\s+)?alzheimer/gi, "Alzheimer disease treatment therapy"],
    [/global\s+warming/gi, "climate change anthropogenic warming"],
    [/how\s+(?:does|do)\s+(.+?)\s+work/gi, "$1 mechanism"],
    [/what\s+causes?\s+(.+?)(?:\?|$)/gi, "$1 etiology mechanism cause"],
    // Plant biology
    [/not\s+need\s+(?:it|photosynthesis|sunlight|light)/gi, "non-photosynthetic heterotrophic mycoheterotrophic parasitic"],
    [/without\s+(?:photosynthesis|sunlight|light)/gi, "non-photosynthetic heterotrophic"],
    // Ecology / evolution
    [/(?:go|went)\s+extinct/gi, "extinction cause"],
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

// Concept equivalence groups. If a query term is in a group, a paper matching
// ANY member of that group satisfies the term. This is what lets a question
// about "plastic" find a paper that only ever says "polyethylene", and a
// question about "insects" find one that says "Galleria mellonella".
const CONCEPT_GROUPS = [
  ["plastic", "plastics", "polymer", "polymers", "polyethylene", "polystyrene",
   "polypropylene", "polyurethane", "pvc", "pet", "ldpe", "hdpe", "microplastic",
   "microplastics", "nanoplastic", "nanoplastics", "polyolefin"],
  ["insect", "insects", "larva", "larvae", "larval", "worm", "worms", "caterpillar",
   "grub", "mealworm", "waxworm", "galleria", "tenebrio", "hermetia", "zophobas",
   "beetle", "moth", "fly", "arthropod", "arthropods", "entomological"],
  ["microbe", "microbes", "microbial", "microbiome", "microbiota", "bacteria",
   "bacterial", "bacterium", "gut flora", "microflora", "symbiont", "symbionts",
   "microorganism", "microorganisms"],
  ["enzyme", "enzymes", "enzymatic", "oxidase", "oxidases", "hydrolase",
   "hydrolases", "esterase", "esterases", "cutinase", "lipase", "protease",
   "depolymerase", "oxidoreductase", "oxidoreductases", "phenoloxidase",
   "laccase", "peroxidase"],
  ["degrade", "degradation", "degrading", "biodegradation", "biodegrade",
   "breakdown", "depolymerization", "depolymerisation", "catabolism",
   "decompose", "decomposition", "oxidation", "oxidize", "oxidise", "oxidative"],
  ["gut", "intestinal", "intestine", "digestive", "midgut", "hindgut", "foregut",
   "gastrointestinal", "alimentary", "crop", "proventriculus",
   "peritrophic membrane", "alimentary canal", "digestive tract"],
  ["saliva", "salivary", "secretion", "secretions", "oral", "labial"],
  ["cancer", "tumour", "tumor", "carcinoma", "neoplasm", "oncology", "malignant"],
  ["gene", "genes", "genetic", "genomic", "genome", "transcript", "transcriptome"],
  ["protein", "proteins", "proteomic", "peptide", "peptides", "polypeptide"],
  ["climate", "warming", "temperature", "thermal", "heat"],
  ["neuron", "neurons", "neural", "neuronal", "brain", "cortical", "cerebral"],
  // Ecology / environment
  ["ecology", "ecological", "ecosystem", "ecosystems", "community", "communities",
   "biodiversity", "species richness", "assemblage"],
  ["network", "networks", "co-occurrence", "cooccurrence", "interaction",
   "interactions", "graph", "connectivity", "modularity"],
  ["soil", "soils", "edaphic", "rhizosphere", "pedosphere", "substrate"],
  ["ocean", "oceanic", "marine", "sea", "seawater", "pelagic", "benthic"],
  ["coral", "corals", "reef", "reefs", "calcification", "bleaching"],
  ["forest", "forests", "woodland", "canopy", "tree", "trees", "silviculture"],
  // Molecular biology
  ["mutation", "mutations", "variant", "variants", "polymorphism", "snp", "indel"],
  ["expression", "transcription", "regulation", "promoter", "enhancer", "silencer"],
  ["antibody", "antibodies", "immunoglobulin", "antigen", "epitope"],
  ["vaccine", "vaccines", "vaccination", "immunization", "adjuvant"],
  ["virus", "viruses", "viral", "virology", "pathogen", "infection", "infectious"],
  // Chemistry
  ["nanoparticle", "nanoparticles", "nanostructure", "nanomaterial", "quantum dot"],
  ["catalyst", "catalysts", "catalysis", "catalytic", "photocatalyst", "electrocatalyst"],
  // Decomposition / decay
  // Chemical conversion / synthesis
  ["ethanol", "ethyl alcohol", "bioethanol", "alcohol", "fermentation"],
  ["co2", "carbon dioxide", "carbon capture", "atmospheric carbon", "carbon fixation"],
  ["conversion", "synthesis", "catalysis", "electrochemical", "electrolysis",
   "reduction", "oxidation", "transformation"],
  ["decomposition", "decompose", "decay", "necrobiome", "cadaver", "carcass",
   "putrefaction", "autolysis", "bloat", "rupture"],
  // Photosynthesis / plant energy
  ["photosynthesis", "photosynthetic", "chloroplast", "chlorophyll", "light reactions",
   "dark reactions", "calvin cycle", "rubisco", "carbon fixation", "thylakoid",
   "photosystem", "photoautotroph", "c3", "c4", "cam"],
  // Parasitic / heterotrophic plants
  ["parasitic", "parasite", "mycoheterotroph", "mycoheterotrophic", "holoparasite",
   "hemiparasite", "heterotroph", "heterotrophic", "non-photosynthetic",
   "achlorophyllous"],
  // Abundance / diversity (common ecological measures)
  ["abundance", "diversity", "richness", "composition", "community structure",
   "alpha diversity", "beta diversity", "evenness", "dominance"],
  // Evolution / adaptation
  ["evolution", "evolutionary", "phylogenetic", "phylogeny", "adaptation",
   "selection", "speciation", "divergence", "convergent"],
  // Immunology
  ["immune", "immunity", "innate immunity", "adaptive immunity", "inflammatory",
   "inflammation", "cytokine", "chemokine", "lymphocyte"],
];

// Build a fast lookup: term -> the full set of equivalent terms
const CONCEPT_LOOKUP = (() => {
  const map = new Map();
  for (const group of CONCEPT_GROUPS) {
    const set = new Set(group);
    for (const t of group) map.set(t, set);
  }
  return map;
})();

// Score how specific/informative a term is. Higher = more worth gating on.
function termSpecificity(term) {
  if (GENERIC_SCIENCE_WORDS.has(term)) return 0.15;
  // Intent verbs ("raise", "caution", "using") describe what the user WANTS
  // but not what the paper is ABOUT. Score below the anchor threshold so they
  // never dominate the top-4 rung.
  if (INTENT_WORDS.has(term)) return 0.2;
  let score = 0.5;
  // Longer words are usually more technical
  if (term.length >= 10) score += 0.3;
  else if (term.length >= 7) score += 0.2;
  else if (term.length <= 4) score -= 0.1;
  // Being part of a known concept group means it's a real topic anchor
  if (CONCEPT_LOOKUP.has(term)) score += 0.35;
  // Scientific morphology markers
  if (/(ase|ome|itis|osis|genic|troph|phyll|plast|cyte|blast|lysis|philic|phobic)$/.test(term)) score += 0.3;
  // Short technical identifiers are highly specific despite being short:
  // gene/protein names (p53, tau, myc), acronyms (mRNA, TNF, PCR), and
  // alphanumeric designators (CD4, IL6, BRCA1). Without this, a query like
  // "p53 mutations in glioma" would treat p53 as filler.
  if (/\d/.test(term) && /[a-z]/.test(term)) score += 0.4;   // alphanumeric: p53, il6, cd4
  if (SYNONYMS[term]) score += 0.4;                            // known scientific acronym
  if (term.length <= 5 && !COMMON_SHORT_WORDS.has(term)) score += 0.25;
  return Math.min(1, score);
}

// Short everyday words that should NOT get the "short technical term" boost.
const COMMON_SHORT_WORDS = new Set([
  "have", "them", "make", "made", "take", "give", "come", "know", "think",
  "want", "need", "find", "show", "tell", "work", "call", "keep", "help",
  "good", "bad", "best", "worst", "more", "less", "many", "much", "very",
  "also", "even", "just", "only", "well", "back", "down", "over", "same",
  "like", "than", "then", "when", "what", "does", "did", "was", "were",
  "any", "all", "some", "each", "both", "few", "own", "such", "why", "how",
]);


const SYNONYMS = {
  // Molecular biology
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
  // Cell biology
  ros: ["reactive oxygen species", "oxidative stress", "free radicals"],
  er: ["endoplasmic reticulum"],
  atp: ["adenosine triphosphate"],
  ecm: ["extracellular matrix"],
  tcr: ["t cell receptor"],
  bcr: ["b cell receptor"],
  mhc: ["major histocompatibility complex", "hla"],
  hla: ["human leukocyte antigen", "mhc"],
  llps: ["liquid liquid phase separation", "biomolecular condensate"],
  // Biochemistry
  pet: ["polyethylene terephthalate"],
  pe: ["polyethylene"],
  pp: ["polypropylene"],
  nad: ["nicotinamide adenine dinucleotide"],
  fad: ["flavin adenine dinucleotide"],
  // Immunology
  car: ["chimeric antigen receptor"],
  "car-t": ["chimeric antigen receptor t cell", "car t cell therapy"],
  tnf: ["tumor necrosis factor"],
  il: ["interleukin"],
  ifn: ["interferon"],
  // Neuroscience
  gaba: ["gamma aminobutyric acid"],
  nmda: ["n-methyl-d-aspartate"],
  ltp: ["long term potentiation"],
  ltd: ["long term depression"],
  fmri: ["functional magnetic resonance imaging", "functional mri"],
  eeg: ["electroencephalography", "electroencephalogram"],
  // Microbiology
  cfu: ["colony forming units", "colony forming unit"],
  otu: ["operational taxonomic unit"],
  asv: ["amplicon sequence variant"],
  "16s": ["16s rrna", "16s ribosomal rna", "16s rdna"],
  // Ecology
  npp: ["net primary productivity", "net primary production"],
  lai: ["leaf area index"],
  ndvi: ["normalized difference vegetation index"],
  // Medicine
  bmi: ["body mass index"],
  bp: ["blood pressure"],
  ldl: ["low density lipoprotein"],
  hdl: ["high density lipoprotein"],
  copd: ["chronic obstructive pulmonary disease"],
  nafld: ["non-alcoholic fatty liver disease"],
  nsaid: ["nonsteroidal anti-inflammatory drug"],
  ssri: ["selective serotonin reuptake inhibitor"],
  ace: ["angiotensin converting enzyme"],
  // Common method terms
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
};

// Every two-word Latin binomial this app already knows about (derived from
// SYNONYMS' values, so it stays in sync automatically as that list grows).
// NOTE: this MUST be defined after SYNONYMS above, not before — it reads
// SYNONYMS at module-evaluation time.
const KNOWN_BINOMIALS = [...new Set(
  Object.values(SYNONYMS).flat().filter((s) => /^[a-z]+ [a-z]+$/i.test(s))
)];

// A NARROWER, hand-curated subset of KNOWN_BINOMIALS restricted to entries
// that are genuinely organism species names. KNOWN_BINOMIALS above is fine
// for typo-correction (correctBinomialTypos gates on length >= 5 AND a close
// fuzzy match on BOTH words, which a generic phrase like "gene editing"
// virtually never survives), but it also picks up non-organism two-word
// SYNONYMS values purely because they happen to be two lowercase words —
// "gene editing" (from crispr), "mass spectrometry", "flow cytometry", etc.
// Anything doing a bare membership check for "is this actually a species" —
// like the multi-organism comparison detection below — must use this list
// instead, or a query mentioning CRISPR alongside a real organism triggers a
// bogus extra search for "Gene editing" as if it were a second species.
const ORGANISM_BINOMIALS = new Set([
  "hermetia illucens", "drosophila melanogaster", "mus musculus",
  "rattus norvegicus", "caenorhabditis elegans", "danio rerio",
  "saccharomyces cerevisiae", "escherichia coli", "staphylococcus aureus",
  "mycobacterium tuberculosis", "plasmodium falciparum", "apis mellifera",
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

// Correct voice-dictation / typo mangling of a known scientific binomial —
// e.g. "Hermetia illucens" transcribed as "Hermia illusions" — by finding
// two ADJACENT query words that are each independently close (within ~1 edit
// per 3 characters) to a known genus and species word. Deliberately requires
// BOTH words to match: a single fuzzy word match alone is far too easy to
// collide with an unrelated real English word ("illusions" is a real word on
// its own — a lone match would corrupt a genuine query about, say, optical
// illusions — but "genus-shaped word" immediately followed by
// "species-shaped word", both close to a real binomial, is a strong signal
// nothing else produces by coincidence).
function correctBinomialTypos(query) {
  const toks = query.split(/\s+/);
  const clean = toks.map((t) => t.toLowerCase().replace(/[^a-z]/g, ""));
  for (const binomial of KNOWN_BINOMIALS) {
    const [genus, species] = binomial.split(" ");
    if (genus.length < 5 || species.length < 5) continue; // too short to fuzzy-match safely
    // ceil, not floor: floor(8/3)=2 rejects the actual repro case ("illusions"
    // is edit-distance 3 from "illucens") — verified numerically against the
    // real voice-dictation mangling this function exists to catch.
    const gThresh = Math.max(1, Math.ceil(genus.length / 3));
    const sThresh = Math.max(1, Math.ceil(species.length / 3));
    for (let i = 0; i + 1 < clean.length; i++) {
      const w1 = clean[i], w2 = clean[i + 1];
      if (w1.length < 4 || w2.length < 4) continue;
      const dG = levenshtein(w1, genus), dS = levenshtein(w2, species);
      // Already an exact match — leave the original text (and the user's own
      // capitalization) untouched. Rewriting a correctly-typed "Hermetia
      // illucens" down to a lowercase canonical form served no purpose here
      // and had a real side effect: it stripped the capitalization that
      // extractBinomial() elsewhere relies on to recognize a deliberately-
      // typed scientific name.
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
  // Check individual tokens
  for (const t of tokens) {
    const key = t.toLowerCase();
    if (SYNONYMS[key]) out.push(...SYNONYMS[key]);
  }
  // Also check multi-word phrases (e.g. "black soldier fly" is 3 tokens but
  // one SYNONYMS key). Without this, common-name organism queries never
  // resolve to their scientific name during expansion.
  const joined = tokens.join(" ").toLowerCase();
  for (const key of Object.keys(SYNONYMS)) {
    if (key.includes(" ") && joined.includes(key)) {
      out.push(...SYNONYMS[key]);
    }
  }
  return [...new Set(out)]; // deduplicate
}

const ORGANISM_PHRASES = [
  "black soldier fly larvae",
  "black soldier fly",
  "hermetia illucens",
  // Comparison queries ("BSFL vs honey bee gut microbiome") are the most
  // common real-world use case that names a second organism alongside BSFL,
  // so it's the first one wired in below. See the multi-organism retrieval
  // block in gatherPapers() for how a second named organism gets its own
  // search pass instead of being silently dropped.
  "honey bee",
  "honey bees",
];
const ORGANISM_WORDS = new Set([
  "black", "soldier", "fly", "larvae", "larva", "larval", "hermetia", "illucens",
  "honey", "bee", "bees", "honeybee", "honeybees", "apis", "mellifera",
]);

function splitOrganismTopic(query) {
  const q = query.toLowerCase();
  const toks = q.split(/\s+/).filter((t) => t.length > 2);
  const exp = expansionsFor(toks);
  const orgPhrases = new Set(exp);
  for (const phrase of ORGANISM_PHRASES) {
    if (q.includes(phrase)) {
      orgPhrases.add(phrase);
      // Also resolve the phrase to its scientific name immediately
      const syns = SYNONYMS[phrase] || [];
      for (const s of syns) orgPhrases.add(s);
    }
  }
  for (const t of toks) {
    if (SYNONYMS[t]) {
      orgPhrases.add(t);
      // Add expansions of individual tokens too
      for (const s of (SYNONYMS[t] || [])) orgPhrases.add(s);
    }
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
  if (hasOrganism && (topic.length || !orgPhrases.length)) {
    // Resolve common names to scientific names for the boolean query.
    // "black soldier fly" alone is 3 common English words — PubMed will
    // match papers about black spruce or soldier beetles. The scientific
    // name as a quoted phrase is unambiguous.
    const resolvedOrg = new Set();
    for (const phrase of orgPhrases) {
      const syns = SYNONYMS[phrase.toLowerCase()] || [];
      const sciRaw = syns.find((s) => /^[a-z]+ [a-z]+$/i.test(s) && s.split(" ").length === 2);
      if (sciRaw) {
        const parts = sciRaw.split(" ");
        resolvedOrg.add(parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase() + " " + parts[1].toLowerCase());
      }
      // Always keep the original phrase too for broader recall
      resolvedOrg.add(phrase);
    }
    const orgStr = [...resolvedOrg]
      .map((e) => (e.includes(" ") ? '"' + e + '"' : e))
      .join(" OR ");
    if (topic.length) {
      return "(" + orgStr + ") AND (" + topic.join(" OR ") + ")";
    }
    return orgStr;
  }
  if (hasOrganism) {
    return orgPhrases
      .map((e) => (e.includes(" ") ? '"' + e + '"' : e))
      .join(" OR ");
  }

  // ---- Natural-language questions ----
  // Previously this returned the query verbatim. A question like "What types of
  // enzymes do insects have to degrade plastic compounds, and how do gut
  // microbes capitalize from them?" became a 9-word string, which PubMed and
  // Europe PMC treat as an implicit AND across every word. No paper contains
  // all nine, so retrieval returned ZERO and the answer fell back to the
  // model's memory — which is where the invented studies came from.
  //
  // Instead: keep only the most topic-bearing terms, expand each with its
  // concept group as an OR set, and AND the groups together. That turns the
  // question into (enzyme OR oxidase OR hydrolase...) AND (plastic OR
  // polyethylene OR PET...) AND (insect OR larvae OR Galleria...), which
  // actually retrieves the relevant literature.
  const qTerms = query
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (!qTerms.length) return query;

  const ranked = qTerms
    .map((t) => ({ t, spec: termSpecificity(t) }))
    .sort((a, b) => b.spec - a.spec);
  // Two to four anchors. More than four AND-ed groups over-constrains again.
  const anchors = ranked.filter((x) => x.spec >= 0.5).slice(0, 4).map((x) => x.t);
  if (anchors.length < 2) {
    // Not enough specific terms to build groups — OR the best few so we still
    // get recall rather than an over-narrow AND.
    return ranked.slice(0, 4).map((x) => x.t).join(" OR ");
  }

  const groups = anchors.map((t) => {
    const set = CONCEPT_LOOKUP.get(t);
    if (!set) return t;
    // Cap expansion so the request URL stays reasonable, and keep the original
    // term first so it carries the most weight in relevance-ranked engines.
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
  // Strip potential prompt injection attempts
  let sanitized = raw
    .replace(/\b(ignore|disregard|forget)\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?|context)\b/gi, "")
    .replace(/\b(system|assistant|user)\s*:/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<[^>]+>/g, "")
    .slice(0, 500); // Hard cap query length

  const cleaned = sanitized
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .join(" ")
    .trim();
  return cleaned || raw.trim().slice(0, 500);
}

// ============ SCHOLARLY DATABASE SOURCES ============
// Each source returns [] on any failure, never throws. Timeouts keep them fast.

async function europePMC(query, limit = 8) {
  // Trust the query we were given. The retrieval ladder passes progressively
  // simpler forms — if this function silently rebuilds them, the ladder can't
  // work. Only fall back to the structured/organism forms if the given query
  // returns nothing.
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
    let rows = await runSearch(query);
    if (!rows.length) {
      const structured = buildStructuredQuery(query);
      if (structured && structured !== query) {
        rows = await runSearch(structured);
      }
    }
    if (!rows.length) {
      const { orgPhrases, hasOrganism } = splitOrganismTopic(query);
      if (hasOrganism) {
        rows = await runSearch(
          orgPhrases.map((e) => (e.includes(" ") ? '"' + e + '"' : e)).join(" OR ")
        );
      }
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
        _allAuthors: r.authorString || "",
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

    // Try the query we were given first (the ladder is calibrated for it).
    const es = await getJSON(esUrl(query)).catch(() => null);
    ids = (es && es.esearchresult && es.esearchresult.idlist) || [];

    // Fallback ladder: structured, then organism-focused
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
        const orgOnly = orgPhrases
          .map((e) => (e.includes(" ") ? '"' + e + '"' : e))
          .join(" OR ");
        const es3 = await getJSON(esUrl(orgOnly)).catch(() => null);
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
    // Reject ordinary English words even when sentence-initial capitalization
    // makes them LOOK taxonomic. Without this guard, every question starting
    // "Can you...", "Compare the...", "Does the..." etc. (i.e. nearly every
    // question a user types) matches the FIRST word pair, is treated as a
    // genus+species, and permanently hijacks organism detection before the
    // regex ever reaches the real binomial later in the sentence. This was a
    // live production bug: "Compare the microbial diversity ... in Hermetia
    // illucens ..." returned {genus:"Compare", species:"the"} and searched
    // every engine for the literal phrase "Compare the" instead of the
    // organism, then passed its own broken species-gate because "the"
    // appears in virtually every abstract ever written.
    if (STOPWORDS.has(m[1].toLowerCase()) || STOPWORDS.has(m[2].toLowerCase())) continue;
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

// Words that are NEVER person surnames or first names, even though they might
// appear capitalized in a query. Used to filter out topic words when hunting
// for a name embedded inside a longer sentence.
const NAME_STOPWORDS = new Set([
  "BSFL", "DNA", "RNA", "CRISPR", "PCR", "PhD", "MD", "UTK", "MIT", "NIH",
  "USA", "UK", "US", "EU", "FDA", "CDC", "WHO", "NASA", "The", "This", "That",
  "These", "Those", "Black", "Soldier", "Fly", "Larvae",
]);

// Try to extract a person's name from ANY query, even if wrapped in extra words.
// Classifies whether a user's message is a NEW topic search, a FOLLOW-UP
// about the previous answer, or a CORRECTION to a prior fact. This decides
// whether to fire a fresh scholarly search or reuse the previous turn's
// sources and just re-prompt the AI with the new user turn.
//
// Signals for FOLLOW-UP: pronouns/deictics referring back ("that paper",
// "this study", "the finding", "it", "they"), agreement/refinement openers
// ("yes", "actually", "no it's", "wait", "you said"), meta comments about
// the previous answer ("the main point was", "you missed", "focus on"),
// or short messages (<= 8 words) that don't introduce new proper nouns.
//
// Signals for CORRECTION: explicit corrections ("that's wrong", "actually
// she's at", "not X but Y", "you got X wrong", "correction:"), or a
// short message negating something in the previous answer.
//
// Signals for NEW: introduces a new proper noun or Latin binomial not in
// history, starts with a fresh question word ("what/how/why/when/where"),
// or is long enough (>10 words) with clear new topic content.
function classifyIntent(query, history) {
  const q = (query || "").trim();
  if (!q) return { kind: "new" };
  const lc = q.toLowerCase();
  const wc = q.split(/\s+/).length;
  const hasHistory = Array.isArray(history) && history.length > 0;
  if (!hasHistory) return { kind: "new" };

  // Explicit correction phrases
  const correctionPatterns = [
    /^(that|this|it)['']?s\s+(wrong|incorrect|not right|false)/i,
    /^(actually|no,?\s+it['']?s|no,?\s+they['']?re|correction[:,])/i,
    /you\s+(got|had|were)\s+(that|this|it)\s+wrong/i,
    /^wrong\b/i,
    /^not\s+\w+,?\s+(it['']?s|they['']?re|but)\s+/i,
    /\bthat['']?s\s+not\s+(right|correct|true|him|her|them)/i,
    /\bnot\s+\w+\s+but\s+/i,
    /you\s+(said|mentioned|wrote)\s+.+\s+(but|however|actually)\s+/i,
  ];
  for (const re of correctionPatterns) {
    if (re.test(q)) return { kind: "correction" };
  }

  // Follow-up indicators
  const followupOpeners = /^(yes|no|but|and|so|okay|ok|right|hmm|well|wait|hey)\b/i;
  const backReferences = /\b(that\s+(papers?|stud(?:y|ies)|research|works?|findings?|results?|authors?|persons?|one)|this\s+(papers?|stud(?:y|ies)|research|works?|findings?|results?)|the\s+(papers?|stud(?:y|ies)|research|works?|findings?|results?|authors?|persons?|one|main\s+point|main\s+finding|sources?|citations?|references?)|it|its|they|them|their|he|she|his|her|him)\b/i;
  const metaAboutPrevious = /\b(you\s+(said|mentioned|wrote|missed|forgot|focused|talked)|main\s+point|main\s+finding|focus\s+on|more\s+about|tell\s+me\s+more|expand|elaborate|clarify|what\s+about|and\s+what|what\s+does|what\s+did|explain\s+more|dig\s+deeper|go\s+deeper|where\s+(are|were)\s+the\s+(papers?|sources?|stud(?:y|ies)|citations?|references?)|show\s+me\s+the\s+(papers?|sources?|citations?)|list\s+the\s+(papers?|sources?|citations?)|what\s+(papers?|sources?|citations?)\s+(did|do|were|are))\b/i;
  const shortReply = wc <= 8;

  const hasBackRef = backReferences.test(q);
  const isFollowupOpener = followupOpeners.test(q);
  const isMeta = metaAboutPrevious.test(q);

  // Check whether the message introduces significant new proper nouns
  // (capitalized words the history doesn't contain). If it does, it's likely
  // a new topic even if it also has pronouns.
  const historyText = history
    .map((t) => (t && t.content) || "")
    .join(" ")
    .toLowerCase();
  const newProperNouns = q
    .split(/\s+/)
    .filter((w) => /^[A-Z][a-z]{2,}$/.test(w))
    .filter((w) => !historyText.includes(w.toLowerCase()));
  const introducesNewTopic = newProperNouns.length >= 2; // 2+ new capitalized words = probably new topic

  if (introducesNewTopic) return { kind: "new" };

  // `meta: true` marks the highest-confidence followup signal — the user is
  // explicitly commenting on the PREVIOUS turn ("you forgot...", "you
  // missed...", "focus on...", "tell me more"), not stating a new topic.
  // Downstream, this is used to stop a cruder word-overlap heuristic from
  // overriding this classification just because the complaint's wording
  // happens to share few words with the original query — which it usually
  // will, since "you forgot to provide BSFL papers" is ABOUT the omission,
  // not a restatement of the topic.
  if (isMeta || (hasBackRef && (isFollowupOpener || shortReply))) {
    return { kind: "followup", meta: isMeta };
  }
  if (isFollowupOpener && shortReply) return { kind: "followup", meta: false };

  return { kind: "new" };
}

// E.g. "Reese Sahos studies on BSFL" -> "Reese Saho".
// Handles possessive forms (drops trailing 's or s when followed by a possessive
// context word like "studies", "papers", "research").
// Handles middle initials (Reese J Saho, Reese J. Saho).
// Returns the canonical name or null if nothing looks like a name.
function extractPersonNameFromQuery(raw) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // If the query IS itself just a clean name, return it
  if (looksLikePersonName(s)) return s;

  // Otherwise, scan the query for a run of 2-3 name-shaped tokens.
  const toks = s.split(/\s+/);
  const isNameToken = (t) => {
    if (!t) return false;
    if (/^[A-Z]\.?$/.test(t)) return true;
    if (!/^[A-Z][a-zA-Z'\-]+$/.test(t)) return false;
    if (NAME_STOPWORDS.has(t)) return false;
    if (t.length >= 3 && t === t.toUpperCase()) return false;
    return true;
  };

  // Words that indicate the preceding word is a person's name in possessive form.
  const possessiveContext = new Set([
    "studies", "study", "papers", "paper", "research", "work", "works",
    "publications", "publication", "findings", "finding", "results", "result",
    "experiments", "experiment", "thesis", "dissertation", "articles", "article",
    "lab", "group", "team", "hypothesis", "theory", "approach", "method",
    "methods", "data", "dataset",
  ]);

  let bestName = null;
  for (let i = 0; i < toks.length; i++) {
    if (!isNameToken(toks[i])) continue;
    for (let len = 4; len >= 2; len--) {
      if (i + len > toks.length) continue;
      const chunk = toks.slice(i, i + len);
      // Middle initial can't be the LAST token
      if (/^[A-Z]\.?$/.test(chunk[chunk.length - 1])) continue;
      // First and last must be full words (2+ chars)
      if (chunk[0].length < 2 || chunk[chunk.length - 1].length < 2) continue;
      if (chunk.every(isNameToken)) {
        bestName = { toks: chunk, endIdx: i + len };
        break;
      }
    }
    if (bestName) break;
  }
  if (!bestName) return null;

  // Now apply possessive stripping on the last name token, using the word
  // AFTER the name as context to decide.
  const nextWord = (toks[bestName.endIdx] || "").toLowerCase().replace(/[.,;:?!]/g, "");
  const nameToks = bestName.toks.slice();
  const last = nameToks[nameToks.length - 1];

  if (/'s$/i.test(last)) {
    // "Saho's" — always safe to strip
    nameToks[nameToks.length - 1] = last.replace(/'s$/i, "");
  } else if (/s'$/i.test(last)) {
    nameToks[nameToks.length - 1] = last.replace(/s'$/i, "");
  } else if (
    // "Sahos studies" — trailing bare 's' followed by a possessive context word
    /[a-z]s$/.test(last) &&
    last.length > 3 &&
    !/ss$/i.test(last) &&
    possessiveContext.has(nextWord)
  ) {
    nameToks[nameToks.length - 1] = last.slice(0, -1);
  }
  return nameToks.join(" ");
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
      // Bug: when a preprint has no DOI yet, the old fallback re-used the
      // same falsy `it.doi` inside the "no DOI" branch, producing a dead
      // link like ".../content/undefined". Fall back to a search link built
      // from the title instead, which always resolves to something useful.
      url: it.doi
        ? "https://doi.org/" + it.doi
        : "https://www.biorxiv.org/search/" + encodeURIComponent(it.title || fullName),
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

// Generic web search fallback via a keyless search index. Used only when
// scholarly + author + wiki all come up empty, so we never return "nothing."
async function genericWebSearch(query) {
  try {
    // Wikipedia opensearch: fast, no auth, returns page titles and short descriptions
    const url =
      "https://en.wikipedia.org/w/api.php?" +
      new URLSearchParams({
        action: "opensearch",
        search: query,
        limit: "5",
        namespace: "0",
        format: "json",
        origin: "*",
      });
    const data = await getJSON(url, {}, 4000);
    if (!Array.isArray(data) || data.length < 4) return [];
    const [, titles, descs, urls] = data;
    const out = [];
    for (let i = 0; i < titles.length; i++) {
      if (!descs[i] || !urls[i]) continue;
      out.push({
        title: titles[i],
        url: urls[i],
        year: "",
        citations: null,
        authors: "Wikipedia",
        journal: "Wikipedia",
        abstract: descs[i],
        source: "web",
      });
    }
    return out;
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
          // Full author list preserved for downstream filtering (e.g. did a
          // specific researcher actually write this paper?). Display uses
          // `authors` (short); logic uses `_allAuthors` (full).
          _allAuthors: (w.authorships || [])
            .map((a) => (a && a.author && a.author.display_name) || "")
            .filter(Boolean)
            .join(", "),
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
        _allAuthors: (it.author || [])
          .map((a) => ((a.given || "") + " " + (a.family || "")).trim())
          .filter(Boolean)
          .join(", "),
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
          _allAuthors: authorNames.join(", "),
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
          _allAuthors: (r.authors || []).map((a) => a.name).filter(Boolean).join(", "),
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

// ---- ADDITIONAL SCHOLARLY APIs ----

async function coreSearch(query, limit = 8) {
  try {
    const url = "https://api.core.ac.uk/v3/search/works?" +
      new URLSearchParams({ q: query, limit: String(limit) });
    const data = await getJSON(url, {}, 6000);
    return ((data && data.results) || []).filter((r) => r.title).map((r) => ({
      title: r.title || "Untitled",
      url: r.doi ? "https://doi.org/" + r.doi : (r.downloadUrl || ""),
      year: r.yearPublished ? String(r.yearPublished) : "",
      citations: null,
      authors: (r.authors || []).map((a) => a.name || "").slice(0, 1).join("") + ((r.authors || []).length > 1 ? " et al." : ""),
      _allAuthors: (r.authors || []).map((a) => a.name || "").join(", "),
      journal: r.publisher || "CORE",
      abstract: stripTags((r.abstract || "").slice(0, 1500)),
    }));
  } catch { return []; }
}

async function baseSearch(query, limit = 8) {
  try {
    const url = "https://api.base-search.net/cgi-bin/BaseHttpSearchInterface.fcgi?" +
      new URLSearchParams({ func: "PerformSearch", query: query, format: "json", hits: String(limit) });
    const data = await getJSON(url, {}, 6000);
    return ((data && data.response && data.response.docs) || []).filter((d) => d.dctitle).map((d) => ({
      title: Array.isArray(d.dctitle) ? d.dctitle[0] : (d.dctitle || "Untitled"),
      url: (Array.isArray(d.dcidentifier) ? d.dcidentifier.find((u) => (u||"").startsWith("http")) : d.dcidentifier) || "",
      year: Array.isArray(d.dcyear) ? d.dcyear[0] : (d.dcyear || ""),
      citations: null,
      authors: Array.isArray(d.dcperson) ? d.dcperson.slice(0,1).join("") + (d.dcperson.length > 1 ? " et al." : "") : (d.dcperson || ""),
      _allAuthors: Array.isArray(d.dcperson) ? d.dcperson.join(", ") : (d.dcperson || ""),
      journal: Array.isArray(d.dcsource) ? d.dcsource[0] : (d.dcsource || "BASE"),
      abstract: stripTags(Array.isArray(d.dcdescription) ? d.dcdescription.join(" ").slice(0,1500) : (d.dcdescription || "").slice(0,1500)),
    }));
  } catch { return []; }
}

async function pmcFullText(query, limit = 8) {
  try {
    const url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" +
      new URLSearchParams({ query: '(BODY:"' + query + '")', resultType: "core", pageSize: String(limit), format: "json", sort: "relevance" });
    const data = await getJSON(url, {}, 6000);
    return ((data && data.resultList && data.resultList.result) || []).filter((r) => r.title).map((r) => ({
      title: r.title || "Untitled",
      url: r.doi ? "https://doi.org/" + r.doi : "https://europepmc.org/article/" + r.source + "/" + r.id,
      year: r.pubYear || "",
      citations: typeof r.citedByCount === "number" ? r.citedByCount : null,
      authors: r.authorString || "",
      _allAuthors: r.authorString || "",
      journal: r.journalTitle || "PMC",
      abstract: stripTags(r.abstractText),
    }));
  } catch { return []; }
}

async function openAire(query, limit = 8) {
  try {
    const url = "https://api.openaire.eu/search/publications?" +
      new URLSearchParams({ keywords: query, size: String(limit), format: "json" });
    const data = await getJSON(url, {}, 6000);
    const results = data?.response?.results?.result || [];
    return results.filter((r) => r?.metadata?.["oaf:entity"]?.["oaf:result"]?.title).map((r) => {
      const m = r.metadata["oaf:entity"]["oaf:result"];
      const t = typeof m.title === "string" ? m.title : (m.title?.["$"] || "Untitled");
      const creators = Array.isArray(m.creator) ? m.creator : (m.creator ? [m.creator] : []);
      const names = creators.map((c) => c?.["$"] || "").filter(Boolean);
      const pids = Array.isArray(m.pid) ? m.pid : (m.pid ? [m.pid] : []);
      const doi = pids.find((p) => p?.["@classid"] === "doi");
      // Bug: dateofacceptance comes back as {"$": "2021-04-01"} (same shape as
      // title/description above), not a plain string. Calling .slice() on
      // that object threw on every single result, and since this whole
      // .map() runs inside the function's own try/catch, the exception was
      // silently swallowed and openAire() always returned [] — this source
      // never actually contributed a single paper. Unwrap it like the other
      // OAI-PMH-shaped fields already do.
      const acceptDate = typeof m.dateofacceptance === "string" ? m.dateofacceptance : (m.dateofacceptance?.["$"] || "");
      return {
        title: t, url: doi ? "https://doi.org/" + doi["$"] : "",
        year: acceptDate.slice(0,4), citations: null,
        authors: names.slice(0,1).join("") + (names.length > 1 ? " et al." : ""),
        _allAuthors: names.join(", "),
        journal: m.journal?.["$"] || "OpenAIRE",
        abstract: stripTags((typeof m.description === "string" ? m.description : (m.description?.["$"] || "")).slice(0,1500)),
      };
    }).filter((p) => p.title && p.title !== "Untitled");
  } catch { return []; }
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

// ============ LLM-POWERED QUERY GENERATION ============
// When mechanical term extraction fails (wrong vocabulary, too narrow, user
// phrased it colloquially), ask a fast LLM to generate the search queries a
// scientist would actually type into PubMed. This is the "make it think like
// Claude" fix — mechanical string manipulation can never match an LLM's
// understanding of what the user actually needs.
//
// Returns an array of 3-5 search query strings optimized for scholarly databases.
// Falls back to empty array on any failure (timeout, rate limit, etc).
async function llmGenerateSearchQueries(rawQuery, token) {
  if (!token) return [];
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000); // 5s max — this runs in parallel
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, "HTTP-Referer": "https://askcerebrum.org", "X-Title": "Cerebrum" },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat-v3-0324:free",
        temperature: 0.1,
        max_tokens: 300,
        messages: [{
          role: "system",
          content: "You are a scientific literature search specialist. Given a user's question, generate 4-6 PubMed/Google Scholar search queries that would find the most relevant papers. Rules:\n" +
            "- Use proper scientific terminology (binomial names, technical terms)\n" +
            "- Each query should be 3-7 words, no boolean operators\n" +
            "- Include the scientific name if an organism is mentioned (e.g. 'black soldier fly' → 'Hermetia illucens')\n" +
            "- Vary vocabulary across queries (one might say 'microbiome', another 'microbiota', another 'bacterial community')\n" +
            "- At least one query should be broad (just organism + general topic)\n" +
            "- At least one query should be very specific (exact mechanism/process)\n" +
            "- Output ONLY a JSON array of strings, nothing else. No markdown, no explanation."
        }, {
          role: "user",
          content: rawQuery
        }]
      }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    // Parse JSON array from response
    const clean = txt.replace(/```json|```/g, "").trim();
    try {
      const arr = JSON.parse(clean);
      if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === "string") {
        return arr.slice(0, 6).map(s => s.trim()).filter(s => s.length > 3 && s.length < 100);
      }
    } catch {}
    // Fallback: try to extract lines
    return clean.split("\n").map(l => l.replace(/^[\d\.\-\*\s"]+|"$/g, "").trim()).filter(s => s.length > 3 && s.length < 100).slice(0, 6);
  } catch {
    return [];
  }
}

// ============ LLM-POWERED PAPER VALIDATION ============
// Before sending papers to the answer LLM, verify each one actually addresses
// the user's question. This prevents the #1 failure mode: the AI confidently
// citing a tsetse fly paper as if it's about BSF gut microbiome.
// Returns filtered array of papers that are genuinely relevant.
// ============ ORGANISM-AWARE PAPER HARD-FILTER ============
// Programmatic pre-filter that runs BEFORE the LLM validator. This catches
// the most obvious wrong-organism contamination with zero latency and zero
// API cost. The LLM validator then runs on the survivors for nuanced cases.
//
// The key insight: if the user asks about "BSFL microbiome" (Hermetia illucens),
// a paper whose title+abstract contains "millipede" / "Diplopoda" / "Julida"
// but NEVER mentions "Hermetia" or "black soldier fly" is categorically wrong.
// No LLM judgment needed — it's a hard taxonomic mismatch.

// Common organism names that, if found in a paper but NOT in the query,
// indicate the paper is about the WRONG organism. Each entry maps to taxa
// that would be a clear mismatch for queries about other organisms.
const CONTAMINANT_ORGANISMS = [
  // Arthropods that are NOT black soldier fly
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
  // Vertebrates
  { patterns: [/\btilapia\b/i, /\boreochromis\b/i], label: "tilapia" },
  { patterns: [/\bsalmon\b/i, /\bsalmo\b/i, /\boncorhynchus/i], label: "salmon" },
  { patterns: [/\bshrimp\b/i, /\bpenaeus\b/i, /\blitopenaeus/i], label: "shrimp" },
  { patterns: [/\bpoultry\b/i, /\bbroiler/i, /\bgallus\b/i], label: "poultry" },
  { patterns: [/\bswine\b/i, /\bpig\b/i, /\bsus scrofa/i, /\bporcine/i], label: "swine" },
];

// Map common names / abbreviations to their scientific genus for matching
const QUERY_ORGANISM_IDENTIFIERS = {
  "bsfl": ["hermetia", "black soldier fly"],
  "bsf": ["hermetia", "black soldier fly"],
  "black soldier fly": ["hermetia"],
  "honey bee": ["apis"],
  "honeybee": ["apis"],
  "fruit fly": ["drosophila"],
  "zebrafish": ["danio"],
  "roundworm": ["caenorhabditis", "c. elegans"],
  "e. coli": ["escherichia"],
  "e coli": ["escherichia"],
};

function programmaticPaperFilter(rawQuery, papers) {
  if (!papers.length) return papers;
  const qLower = rawQuery.toLowerCase();

  // Step 1: Identify what organism the USER is asking about
  const queryOrganisms = new Set();
  for (const [name, identifiers] of Object.entries(QUERY_ORGANISM_IDENTIFIERS)) {
    if (qLower.includes(name)) {
      identifiers.forEach(id => queryOrganisms.add(id.toLowerCase()));
      queryOrganisms.add(name.toLowerCase());
    }
  }
  // Also detect any binomial in the query
  const qBinomial = extractBinomial(rawQuery);
  if (qBinomial) {
    queryOrganisms.add(qBinomial.genus.toLowerCase());
    queryOrganisms.add(qBinomial.full.toLowerCase());
  }

  // If we can't identify a specific organism query, skip this filter
  if (queryOrganisms.size === 0) return papers;

  // Step 2: For each paper, check if it's about a DIFFERENT organism
  return papers.filter(p => {
    const haystack = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();

    // First check: does the paper mention the TARGET organism at all?
    const mentionsTarget = [...queryOrganisms].some(org => haystack.includes(org));

    // If it doesn't even mention the target organism, flag it
    if (!mentionsTarget) {
      // Check if it mentions a KNOWN contaminant organism
      for (const contam of CONTAMINANT_ORGANISMS) {
        const mentionsContam = contam.patterns.some(re => re.test(haystack));
        // Is this contaminant organism NOT what the user asked about?
        const contamIsTarget = [...queryOrganisms].some(org =>
          contam.label.toLowerCase().includes(org) || org.includes(contam.label.toLowerCase())
        );
        if (mentionsContam && !contamIsTarget) {
          // Paper is about a contaminant organism and doesn't mention target → REJECT
          p._filteredReason = `Paper is about ${contam.label}, not the queried organism`;
          return false;
        }
      }
    }

    // Special check for "fed with X" papers — e.g., tilapia fed BSFL is about
    // tilapia nutrition, NOT about BSFL biology/microbiome
    if (queryOrganisms.has("hermetia") || queryOrganisms.has("black soldier fly") || qLower.includes("bsfl") || qLower.includes("bsf")) {
      // If the query is about BSFL microbiome/biology but the paper is about
      // another animal FED with BSFL, it's tangential at best
      const isBSFLBiologyQuery = /\b(microbiome|microbiota|gut\s*(bacteria|flora|microb)|larva[el]?\s*(gut|microb|digest)|digest|metab|enzyme|proteome|transcriptome|genome|gene\s*express)/i.test(rawQuery);
      if (isBSFLBiologyQuery) {
        // Check if paper is about feeding BSFL TO another animal
        const fedPattern = /\b(fed\s+(with\s+)?|diet(ary)?\s+(contain|includ|supplement)|meal\s+(from|replac)|as\s+(feed|protein\s+source)|fish\s+meal\s+replac|feed\s+(ingredient|formul|additive))/i.test(haystack);
        const aboutOtherAnimal = CONTAMINANT_ORGANISMS.some(c =>
          c.patterns.some(re => re.test(haystack)) && !([...queryOrganisms].some(org => c.label.toLowerCase().includes(org)))
        );
        if (fedPattern && aboutOtherAnimal && !mentionsTarget) {
          p._filteredReason = "Paper is about feeding BSFL to another animal, not BSFL biology";
          return false;
        }
        // Even if it mentions BSFL, if the primary subject is clearly another animal
        // (title starts with the other animal's name), downgrade significantly
        const titleLower = (p.title || "").toLowerCase();
        for (const contam of CONTAMINANT_ORGANISMS) {
          if (contam.patterns.some(re => re.test(titleLower)) && fedPattern) {
            // Title mentions a non-target animal + feeding context → likely wrong focus
            if (!(titleLower.includes("hermetia") || titleLower.includes("black soldier fly") || titleLower.includes("bsf"))) {
              p._filteredReason = `Paper primarily about ${contam.label} fed with BSFL`;
              return false;
            }
          }
        }
      }
    }

    return true;
  });
}

// ============ LLM PAPER VALIDATION (v6.0 — DRAMATICALLY STRENGTHENED) ============
// The previous validator was too lenient — it used a single vague prompt and
// accepted any paper the LLM didn't explicitly reject. This version:
// 1. Runs programmatic hard-filter FIRST (zero cost, catches obvious mismatches)
// 2. Uses a MUCH more specific LLM prompt with organism-awareness
// 3. Requires explicit relevance scoring, not just YES/NO
// 4. Handles up to 15 papers (not just 10)
// 5. Has TWO-PASS validation for organism-specific queries

async function llmValidatePapers(rawQuery, papers, token) {
  if (!papers.length) return papers;

  // PASS 1: Programmatic hard-filter (free, instant)
  let survivors = programmaticPaperFilter(rawQuery, papers);

  // If programmatic filter removed everything, keep at least the top-scored original papers
  if (survivors.length === 0 && papers.length > 0) {
    survivors = papers.slice(0, 3);
  }

  // PASS 2: LLM validation on survivors
  if (!token || survivors.length > 15) return survivors;

  // Detect the primary organism from the query for the LLM prompt
  const qLower = rawQuery.toLowerCase();
  let targetOrganism = "";
  for (const [name, identifiers] of Object.entries(QUERY_ORGANISM_IDENTIFIERS)) {
    if (qLower.includes(name)) {
      targetOrganism = identifiers[0] || name;
      break;
    }
  }
  const qBinomial = extractBinomial(rawQuery);
  if (qBinomial && !targetOrganism) targetOrganism = qBinomial.full;

  const organismClause = targetOrganism
    ? `\n\nCRITICAL — ORGANISM GATE: The user is asking about "${targetOrganism}". ` +
      `A paper MUST be specifically about this organism (or directly about its biology/ecology/microbiome) to score RELEVANT. ` +
      `Papers about DIFFERENT organisms (even related ones) that don't study ${targetOrganism} specifically = IRRELEVANT. ` +
      `Papers about feeding ${targetOrganism} TO other animals (e.g., fish/poultry fed with insect meal) are about the OTHER animal's nutrition, NOT about ${targetOrganism} biology = IRRELEVANT unless the query specifically asks about ${targetOrganism} as feed.`
    : "";

  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 7000);
    const paperList = survivors.map((p, i) =>
      `[${i + 1}] "${p.title}" (${p.journal || "unknown"}, ${p.year || "n/a"})\nAbstract: ${(p.abstract || "").slice(0, 350)}`
    ).join("\n\n");
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, "HTTP-Referer": "https://askcerebrum.org", "X-Title": "Cerebrum" },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat-v3-0324:free",
        temperature: 0,
        max_tokens: 400,
        messages: [{
          role: "system",
          content: "You are a strict scientific paper relevance validator. For EACH paper, determine if it DIRECTLY addresses the user's specific question.\n\n" +
            "Scoring rules:\n" +
            "- RELEVANT: Paper is directly about the specific organism/topic/mechanism asked about\n" +
            "- TANGENTIAL: Paper is related but about a different organism, different mechanism, or only touches the topic indirectly (e.g., paper about feeding insect X to fish Y when the question is about insect X's own biology)\n" +
            "- IRRELEVANT: Paper is about a completely different organism or topic\n\n" +
            "DEFAULT TO REJECTION. A paper must EARN its RELEVANT score — don't be generous.\n" +
            "A paper that studies organism A and only MENTIONS organism B in passing is NOT relevant to a query about organism B.\n" +
            "A paper about organism A's gut microbiome is NOT evidence for organism B's gut microbiome, even if A and B are both insects." +
            organismClause +
            "\n\nOutput ONLY a JSON array of objects: [{\"id\": 1, \"verdict\": \"RELEVANT\"}, {\"id\": 2, \"verdict\": \"TANGENTIAL\"}, ...]. No markdown fences, no explanation."
        }, {
          role: "user",
          content: "Scientific question: " + rawQuery + "\n\nPapers to evaluate:\n" + paperList
        }]
      }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return survivors;
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    try {
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
          // IRRELEVANT papers are simply not added
        }
        // Keep RELEVANT papers as-is, mark TANGENTIAL ones with a flag
        const filtered = survivors.filter((p, i) => {
          const num = i + 1;
          if (validIds.has(num)) return true;
          if (tangentialIds.has(num)) {
            p._tangential = true;
            // Only keep tangential papers if we don't have enough relevant ones
            return validIds.size < 3;
          }
          return false;
        });
        // Only use filtered if it kept at least 1 paper
        if (filtered.length > 0) return filtered;
        // If LLM rejected everything but we had survivors, keep top 2
        return survivors.slice(0, 2);
      }
    } catch {}
    // If LLM returned something unparseable, still try the simple array format
    try {
      const simple = JSON.parse(txt.replace(/```json|```/g, "").trim());
      if (Array.isArray(simple) && simple.every(n => typeof n === "number")) {
        const validSet = new Set(simple);
        const filtered = survivors.filter((_, i) => validSet.has(i + 1));
        if (filtered.length > 0) return filtered;
      }
    } catch {}
    return survivors;
  } catch {
    return survivors;
  }
}


// ============ ANSWER QUALITY ENGINE (v6.0) ============
// Post-generation processing that catches and fixes the most common
// quality failures from free-tier models:
// 1. Repetitive paragraphs (entire sections copy-pasted)
// 2. Banned phrases that the model ignored in the prompt
// 3. Source-listing patterns ("Paper 1 found X. Paper 2 found Y.")
// 4. Excessive verbosity and filler
// 5. Wrong-organism citations (the AI knows it's wrong but cites anyway)

const BANNED_PHRASES_RE = [
  /\bfurther research is needed\b/gi,
  /\bfurther research is necessary\b/gi,
  /\bfurther research is required\b/gi,
  /\bfurther research is warranted\b/gi,
  /\bfurther (studies|investigation|understanding) (is|are) (needed|necessary|required|warranted)\b/gi,
  /\bmore research is needed\b/gi,
  /\bplays a (critical|crucial|vital|pivotal|key|important|significant) role\b/gi,
  /\bit is (important|worth|critical|crucial) to note\b/gi,
  /\bit should be noted\b/gi,
  /\bit is worth mentioning\b/gi,
  /\bin recent years\b/gi,
  /\ba growing body of evidence\b/gi,
  /\bsheds? light on\b/gi,
  /\bpaves? the way for\b/gi,
  /\bthe exact mechanism remains unclear\b/gi,
  /\bwhile the provided sources do not directly\b/gi,
  /\bnone of these papers directly\b/gi,
  /\balthough this study does not specifically\b/gi,
  /\bin conclusion\b/gi,
  /\bin summary\b/gi,
  /\boverall,?\s/gi,
  /\bit is clear that\b/gi,
  /\bholistic understanding\b/gi,
  /\bholistic approach\b/gi,
  /\bmultifaceted\b/gi,
  /\bunderscore(s)? the (importance|need|significance)\b/gi,
  /\bhighlight(s)? the (importance|need|significance)\b/gi,
  /\bthe (landscape|field) of\b/gi,
  /\bin the realm of\b/gi,
  /\bat the forefront of\b/gi,
  /\ba testament to\b/gi,
  /\bin the context of\b/gi,
  /\bthis underscores\b/gi,
];

// Detect and remove repetitive content: paragraphs or sentences that
// appear more than once (common with free-tier models that "loop")
function deduplicateContent(text) {
  if (!text) return text;

  // Split into paragraphs
  const paragraphs = text.split(/\n{2,}/);
  if (paragraphs.length < 2) return text;

  // Pass 1: Remove exact duplicate paragraphs
  const seen = new Set();
  let deduped = [];
  for (const para of paragraphs) {
    const normalized = para.trim().toLowerCase().replace(/\s+/g, " ");
    if (normalized.length < 20) { deduped.push(para); continue; } // Keep short lines
    if (seen.has(normalized)) continue; // Skip exact duplicate
    seen.add(normalized);
    deduped.push(para);
  }

  // Pass 2: Remove near-duplicate paragraphs (>80% overlap)
  const final = [];
  for (let i = 0; i < deduped.length; i++) {
    const current = deduped[i].trim().toLowerCase().replace(/\s+/g, " ");
    if (current.length < 30) { final.push(deduped[i]); continue; }
    let isDupe = false;
    for (let j = 0; j < i; j++) {
      const prev = deduped[j].trim().toLowerCase().replace(/\s+/g, " ");
      if (prev.length < 30) continue;
      // Check if >80% of current paragraph's words appear in a previous one
      const currentWords = new Set(current.split(/\s+/));
      const prevWords = new Set(prev.split(/\s+/));
      let overlap = 0;
      for (const w of currentWords) { if (prevWords.has(w)) overlap++; }
      const overlapRatio = overlap / currentWords.size;
      if (overlapRatio > 0.80 && currentWords.size > 10) {
        isDupe = true;
        break;
      }
    }
    if (!isDupe) final.push(deduped[i]);
  }

  // Pass 3: Remove duplicate sentences within paragraphs
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

// Strip banned phrases from the answer
function stripBannedPhrases(text) {
  if (!text) return text;
  let cleaned = text;
  for (const re of BANNED_PHRASES_RE) {
    // Reset the regex's lastIndex for global regexes
    re.lastIndex = 0;
    cleaned = cleaned.replace(re, (match) => {
      // Some of these are mid-sentence — try to clean up gracefully
      return "";
    });
  }
  // Clean up artifacts from removal: double spaces, orphaned commas, etc.
  cleaned = cleaned.replace(/\s{2,}/g, " ");
  cleaned = cleaned.replace(/,\s*,/g, ",");
  cleaned = cleaned.replace(/\.\s*\./g, ".");
  cleaned = cleaned.replace(/\s+\./g, ".");
  cleaned = cleaned.replace(/\s+,/g, ",");
  cleaned = cleaned.replace(/^\s*[,;]\s*/gm, "");
  // Remove sentences that became empty or near-empty after stripping
  cleaned = cleaned.replace(/(?:^|\.\s+)[A-Z][a-z]{0,3}\s*\.(?=\s|$)/g, ".");
  return cleaned.trim();
}

// Detect source-listing patterns and flag them
// Returns a score: 0 = good synthesis, 100 = pure source-listing
function detectSourceListing(text) {
  if (!text) return 0;
  const patterns = [
    /\bsource \[\d+\] (discusses|examines|explores|investigates|reports|found|shows|demonstrates)/gi,
    /\baccording to \[\d+\]/gi,
    /\b(the|a) study (by|in|from) \[\d+\]/gi,
    /\bpaper \[\d+\] (found|showed|demonstrated|reported|examined|investigated)/gi,
    /\b\[\d+\] (found|showed|demonstrated|reported|examined|investigated|suggests?|indicates?)/gi,
    /\b(the|a) (first|second|third|fourth|fifth|sixth|seventh) (study|paper|source|article)/gi,
    /\b(study|paper) \d+ (found|showed|reported)/gi,
    /^[\s-]*\[?\d+\]?\s*[\w\s]+(found|showed|demonstrated|reported)/gim,
  ];
  let listingScore = 0;
  for (const re of patterns) {
    re.lastIndex = 0;
    const matches = text.match(re);
    if (matches) listingScore += matches.length * 15;
  }
  return Math.min(100, listingScore);
}

// Detect wrong-organism acknowledgment — when the AI KNOWS a paper is about
// the wrong organism but cites it anyway. This is the "millipede in BSFL query" bug.
function detectWrongOrganismCitations(text) {
  const patterns = [
    /this study was conducted on (\w+),?\s*not\b/gi,
    /this (paper|study|research) (is|was) (about|on|conducted on) (\w+),?\s*(rather than|not|instead of)\b/gi,
    /although (this|the) (study|paper|research) (focused|focuses) on (\w+)\b/gi,
    /while (this|the) (study|paper|research) (examined|investigat|studied) (\w+),?\s*(not|rather than|instead of)\b/gi,
    /(\w+) (rather than|instead of|not) [A-Z][a-z]+ [a-z]+/g,
    /however,?\s*this (study|paper) (was|is) (conducted|performed|done) (on|in|with) (\w+)/gi,
  ];
  const violations = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      violations.push(m[0]);
    }
  }
  return violations;
}

// Master post-processing function — runs ALL quality passes
function postProcessAnswer(rawAnswer) {
  if (!rawAnswer) return rawAnswer;

  let answer = rawAnswer;

  // 1. Deduplicate repetitive content
  answer = deduplicateContent(answer);

  // 2. Strip banned phrases
  answer = stripBannedPhrases(answer);

  // 3. Remove wrong-organism acknowledgment passages
  // If the AI says "this study was about millipedes, not Hermetia" — that
  // entire passage should be removed, because the paper shouldn't have
  // been cited at all
  const wrongOrgViolations = detectWrongOrganismCitations(answer);
  if (wrongOrgViolations.length > 0) {
    for (const violation of wrongOrgViolations) {
      // Remove the sentence containing this violation
      const escaped = violation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sentenceRe = new RegExp('[^.!?]*' + escaped + '[^.!?]*[.!?]\\s*', 'gi');
      answer = answer.replace(sentenceRe, '');
    }
  }

  // 4. Clean up any artifacts
  answer = answer.replace(/\n{3,}/g, "\n\n").trim();
  answer = answer.replace(/^\s+/gm, (match) => match); // Preserve intentional indentation

  return answer;
}

// Score the overall quality of an answer (0-100, higher = better)
function scoreAnswerQuality(answer, query) {
  if (!answer) return 0;
  let score = 50; // Start at neutral

  // Length check
  if (answer.length < 100) score -= 20;
  else if (answer.length > 300) score += 10;

  // Banned phrases penalty
  let bannedCount = 0;
  for (const re of BANNED_PHRASES_RE) {
    re.lastIndex = 0;
    const matches = answer.match(re);
    if (matches) bannedCount += matches.length;
  }
  score -= bannedCount * 8;

  // Source-listing penalty
  const listingScore = detectSourceListing(answer);
  score -= listingScore * 0.3;

  // Repetition penalty — count unique vs total paragraphs
  const paras = answer.split(/\n{2,}/).filter(p => p.trim().length > 20);
  if (paras.length > 1) {
    const uniqueParas = new Set(paras.map(p => p.trim().toLowerCase().replace(/\s+/g, " ")));
    const repetitionRatio = 1 - (uniqueParas.size / paras.length);
    score -= repetitionRatio * 40;
  }

  // Wrong-organism penalty
  const wrongOrg = detectWrongOrganismCitations(answer);
  score -= wrongOrg.length * 15;

  // Bonus for good synthesis markers
  if (/\bconsistent(ly)? (with|across)\b/i.test(answer)) score += 3;
  if (/\bin contrast\b/i.test(answer)) score += 3;
  if (/\b\d+%|\bp\s*[<>=]\s*0\.\d/i.test(answer)) score += 5; // Quantitative data
  if (/\bn\s*=\s*\d/i.test(answer)) score += 3; // Sample sizes
  if (/_([\w.]+\s+[\w]+)_/i.test(answer)) score += 3; // Italicized species names

  return Math.max(0, Math.min(100, score));
}


// ============ LLM QUERY INTELLIGENCE ("THE BRAIN") ============
// The conversational intelligence core. Instead of rigid regex-based intent
// classification, we use a fast LLM call to UNDERSTAND what the user actually
// means in context. This is what makes follow-ups like "where are the papers",
// "tell me more about that enzyme", or "what about in humans?" work naturally.
//
// Runs in parallel with initial setup so it adds near-zero latency. Falls back
// to the regex-based classifyIntent() if the LLM call fails or times out.

const QUERY_RESOLVER_PROMPT =
  "You are a query-understanding module for Cerebrum, a scientific literature search engine. " +
  "Your job is to understand what the user ACTUALLY wants, given their message and conversation context.\n\n" +
  "Respond with ONLY a JSON object — no markdown fences, no explanation:\n" +
  '{\n  "intent": "<one of the types below>",\n  "needs_search": true/false,\n' +
  '  "resolved_query": "<effective search query, or empty string if no search needed>",\n' +
  '  "topic": "<the main scientific topic being discussed across the conversation>",\n' +
  '  "reasoning": "<one sentence: why you classified it this way>"\n}\n\n' +
  "INTENT TYPES:\n" +
  '- "new_search": A brand-new scientific question unrelated to the conversation so far.\n' +
  '- "followup_deeper": Wants more depth on the SAME topic. ("tell me more", "expand on that", "what\'s the mechanism?")\n' +
  '- "followup_related": A related but different angle. ("what about in humans?" after discussing mice)\n' +
  '- "followup_broader": Wants the topic covered more broadly. ("what about other organisms?", "how does this apply more generally?")\n' +
  '- "correction": Correcting a mistake in the previous answer.\n' +
  '- "meta_question": Asking ABOUT the conversation or existing results — NOT requesting new information. ' +
  'Examples: "where are the papers", "what sources did you use", "can you list the citations", "summarize that", "what did you just say".\n' +
  '- "source_request": Explicitly asking for MORE/NEW/ADDITIONAL papers. ("find more papers", "any other studies")\n' +
  '- "conversational": Greetings, thanks, jokes, personal questions, off-topic chat.\n\n' +
  "CRITICAL RULES:\n" +
  '1. "where are the papers" / "show me the sources" / "what papers did you find" / "list the references" = meta_question. ' +
  "The user wants you to PRESENT the sources already cited. needs_search: false.\n" +
  '2. "find more papers" / "get more studies" / "any other research on this" = source_request. needs_search: true. ' +
  "resolved_query = the original topic.\n" +
  '3. "tell me more" / "go deeper" / "elaborate" = followup_deeper. needs_search: true. ' +
  "resolved_query = the original topic + the specific angle they're asking about.\n" +
  "4. If the message contains pronouns (he/she/it/they/that/this) without clear referents, resolve them from history.\n" +
  '5. Short vague messages ("yes", "ok", "and?", "so?", "continue") after a previous answer = followup_deeper.\n' +
  "6. If the current message lacks scientific terms but the conversation has an active topic, " +
  "resolved_query should include that topic's key terms.\n" +
  "7. For followup_deeper and followup_related, ALWAYS include the main topic in resolved_query " +
  "even if the user didn't repeat it.\n" +
  '8. A message that ONLY asks about papers/sources/citations without specifying "more" or "new" = meta_question, NOT source_request.';


async function llmResolveQuery(query, history, prevSources, token) {
  if (!token) return null;

  const recentHistory = (history || []).slice(-8);
  const historyText = recentHistory
    .map((t) => {
      const role = t.role === "user" ? "User" : "Cerebrum";
      const content = String(t.content || "").slice(0, 400);
      return role + ": " + content;
    })
    .join("\n");

  const sourceList = (prevSources || [])
    .slice(0, 6)
    .map((s, i) => "[" + (i + 1) + '] "' + (s.title || "Untitled") + '"')
    .join("\n");

  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 4000);
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "HTTP-Referer": "https://askcerebrum.org",
        "X-Title": "Cerebrum",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat-v3-0324:free",
        temperature: 0,
        max_tokens: 250,
        messages: [
          { role: "system", content: QUERY_RESOLVER_PROMPT },
          {
            role: "user",
            content:
              "CONVERSATION:\n" +
              (historyText || "(no history)") +
              "\n\nSOURCES ALREADY CITED:\n" +
              (sourceList || "(none)") +
              '\n\nCURRENT MESSAGE: "' +
              query +
              '"',
          },
        ],
      }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    try {
      const clean = txt.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      if (parsed && typeof parsed.intent === "string") return parsed;
    } catch {}
    return null;
  } catch {
    return null;
  }
}


// Build a rich, compact summary of the conversation for the answer LLM.
// This gives the model much better context than just raw history turns,
// enabling it to write responses that feel like a continuous conversation.
function buildConversationContext(history, prevSources) {
  if (!Array.isArray(history) || !history.length) return null;

  const userQuestions = [];
  const assistantHighlights = [];
  const allEntities = new Set();

  for (const turn of history) {
    const content = String(turn.content || "").trim();
    if (!content) continue;

    if (turn.role === "user" && content.length > 3) {
      userQuestions.push(content.slice(0, 200));
      const bin = extractBinomial(content);
      if (bin) allEntities.add(bin.full);
      // Extract capitalized terms that might be entities
      content.split(/\s+/).forEach((w) => {
        if (w.length > 4 && /^[A-Z][a-z]/.test(w) && !STOPWORDS.has(w.toLowerCase())) {
          allEntities.add(w);
        }
      });
    }

    if (turn.role === "assistant" && content.length > 20) {
      const firstSent = content.split(/[.!?]\s/)[0];
      if (firstSent && firstSent.length > 10 && firstSent.length < 200) {
        assistantHighlights.push(firstSent.slice(0, 150));
      }
    }
  }

  const sourceTitles = (prevSources || [])
    .slice(0, 8)
    .map((s, i) => "[" + (i + 1) + "] " + (s.title || "Untitled") + " (" + (s.year || "n/a") + ")");

  const entities = [...allEntities].slice(0, 15);
  const summary =
    userQuestions.length > 0
      ? "The user has asked " +
        userQuestions.length +
        ' question(s). Their investigation started with "' +
        userQuestions[0].slice(0, 100) +
        '"' +
        (userQuestions.length > 1
          ? ' and most recently asked "' + userQuestions[userQuestions.length - 1].slice(0, 100) + '"'
          : "") +
        (entities.length > 0
          ? ". Key entities discussed: " + entities.slice(0, 8).join(", ")
          : "") +
        "."
      : null;

  return { userQuestions, assistantHighlights, entities, sourceTitles, turnCount: history.length, summary };
}


// Answer meta-questions (questions about the conversation itself, like "where
// are the papers" or "what sources did you use"). These don't need a new search
// — they need the LLM to reference the EXISTING conversation and sources.
async function answerMetaQuestion(query, history, prevSources, conversationCtx, env) {
  const token = env.OPENROUTER_KEY;
  if (!token) return null;

  const sourceList = (prevSources || [])
    .map(
      (s, i) =>
        "[" + (i + 1) + '] "' + (s.title || "Untitled") + '" — ' +
        (s.authors || "Unknown") + ", " + (s.journal || "Unknown") +
        ", " + (s.year || "n/a") +
        (s.url ? "\n    URL: " + s.url : "")
    )
    .join("\n");

  const historyText = (history || [])
    .slice(-6)
    .map((t) => {
      const role = t.role === "user" ? "User" : "Cerebrum";
      return role + ": " + String(t.content || "").slice(0, 600);
    })
    .join("\n\n");

  const ctxNote = conversationCtx && conversationCtx.summary ? "\n\nCONVERSATION SUMMARY: " + conversationCtx.summary : "";

  const messages = [
    {
      role: "system",
      content:
        "You are Cerebrum, a scientific research engine built by Vaticay. " +
        "The user is asking a question about your PREVIOUS response or the sources you already found. " +
        "Answer based on the conversation history and source list below.\n\n" +
        "RULES:\n" +
        "- Reference specific papers by their citation number [1], [2], etc.\n" +
        '- If they ask "where are the papers" or "what sources", list the papers you cited with brief descriptions of what each one covers.\n' +
        '- If they ask to "summarize" or "recap", give a concise summary of what you\'ve discussed.\n' +
        "- If they ask about specific claims, reference which paper(s) supported them.\n" +
        "- Be conversational and direct — don't re-search, don't apologize, don't hedge.\n" +
        "- If there are no previous sources, say so honestly and offer to search for them.\n" +
        "- Keep species names italicized: _E. coli_, _H. illucens_.\n" +
        "- Bold **key terms** for readability.\n" +
        "- NEVER fabricate papers or citations. Only reference what's in the source list below.\n\n" +
        "CONVERSATION SO FAR:\n" +
        (historyText || "(first message)") +
        "\n\nSOURCES PREVIOUSLY CITED:\n" +
        (sourceList || "(no sources cited yet)") +
        ctxNote,
    },
    { role: "user", content: query },
  ];

  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 10000);
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "HTTP-Referer": "https://askcerebrum.org",
        "X-Title": "Cerebrum",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat-v3-0324:free",
        temperature: 0.3,
        max_tokens: 1200,
        messages,
      }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    if (txt.length > 20) return cleanAIResponse(txt);
    return null;
  } catch {
    return null;
  }
}


// Self-reasoning chain: before the main search, the system reasons about what
// to search for and why. This is the "asks itself things" capability — the system
// decomposes complex questions, identifies sub-questions, and plans the most
// effective search strategy. The reasoning output enriches both the search
// queries and the final answer's system prompt.
async function selfReason(query, history, token) {
  if (!token) return null;

  const historyText = (history || [])
    .slice(-4)
    .map((t) =>
      (t.role === "user" ? "User" : "Cerebrum") + ": " + String(t.content || "").slice(0, 200)
    )
    .join("\n");

  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 4000);
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "HTTP-Referer": "https://askcerebrum.org",
        "X-Title": "Cerebrum",
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-chat-v3-0324:free",
        temperature: 0.1,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content:
              "You are the reasoning module of a scientific search engine. Think step-by-step about how to best answer this query.\n\n" +
              "Output ONLY a JSON object:\n" +
              "{\n" +
              '  "sub_questions": ["list of 2-4 specific sub-questions to investigate"],\n' +
              '  "search_strategy": "one sentence describing the best search approach",\n' +
              '  "key_terms": ["5-8 specific scientific search terms, using proper nomenclature"],\n' +
              '  "expected_fields": ["which scientific fields/disciplines are relevant"],\n' +
              '  "complexity": "simple" | "moderate" | "complex" | "multi_domain",\n' +
              '  "needs_comparison": false,\n' +
              '  "organisms": ["any specific organisms to search for, using binomial names"]\n' +
              "}",
          },
          {
            role: "user",
            content:
              (historyText ? "Conversation context:\n" + historyText + "\n\n" : "") +
              'Current question: "' + query + '"',
          },
        ],
      }),
      signal: c.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const txt = (j?.choices?.[0]?.message?.content || "").trim();
    try {
      return JSON.parse(txt.replace(/```json|```/g, "").trim());
    } catch {}
    return null;
  } catch {
    return null;
  }
}


// D1-backed query intelligence: check if we've seen a similar query before
// and know its resolved form. This makes the system faster over time — cached
// resolutions are instant and don't need an LLM call.
async function checkQueryIntelligence(queryKey, db) {
  if (!db) return null;
  try {
    const row = await db
      .prepare(
        "SELECT resolved_query, intent, topic, entities, success_count " +
        "FROM query_intelligence WHERE query_hash = ? AND success_count >= 1 LIMIT 1"
      )
      .bind(queryKey)
      .first();
    if (row && row.resolved_query) {
      return {
        resolved_query: row.resolved_query,
        intent: row.intent,
        topic: row.topic,
        entities: row.entities ? JSON.parse(row.entities) : [],
        confidence: Math.min(row.success_count / 3, 1), // 3+ successes = full confidence
      };
    }
  } catch {}
  return null;
}

// Store a successful query resolution for future use
async function storeQueryIntelligence(queryKey, rawQuery, resolvedQuery, intent, topic, entities, db) {
  if (!db || !queryKey) return;
  try {
    await db
      .prepare(
        "INSERT INTO query_intelligence (query_hash, raw_query, resolved_query, intent, topic, entities, success_count, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, 1, ?) " +
        "ON CONFLICT(query_hash) DO UPDATE SET " +
        "success_count = success_count + 1, resolved_query = excluded.resolved_query, updated_at = excluded.created_at"
      )
      .bind(queryKey, rawQuery.slice(0, 500), resolvedQuery.slice(0, 500), intent, topic || "", JSON.stringify(entities || []), Date.now())
      .run();
  } catch {}
}

// Store topic co-occurrence data for smarter related-query suggestions
async function updateTopicMemory(topic, searchTerms, paperCount, db) {
  if (!db || !topic) return;
  const topicKey = topic.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!topicKey) return;
  try {
    await db
      .prepare(
        "INSERT INTO topic_memory (topic_key, related_terms, best_search_terms, avg_paper_count, search_count, updated_at) " +
        "VALUES (?, ?, ?, ?, 1, ?) " +
        "ON CONFLICT(topic_key) DO UPDATE SET " +
        "search_count = search_count + 1, " +
        "avg_paper_count = (avg_paper_count * search_count + excluded.avg_paper_count) / (search_count + 1), " +
        "best_search_terms = CASE WHEN excluded.avg_paper_count > avg_paper_count THEN excluded.best_search_terms ELSE best_search_terms END, " +
        "updated_at = excluded.updated_at"
      )
      .bind(topicKey, JSON.stringify([]), JSON.stringify(searchTerms || []), paperCount || 0, Date.now())
      .run();
  } catch {}
}


async function gatherPapers(rawQuery, opts) {
  // Wrap the entire function so ANY thrown error still returns a diagnostic
  // rather than being swallowed by the outer .catch and losing all context.
  const _outerDiag = { entered: true, phase: "start", rawQuery: (rawQuery || "").slice(0, 200) };
  try {
  const openAlexKey = (opts && opts.openAlexKey) || "";
  const ncbiKey = (opts && opts.ncbiKey) || "";
  const limit = (opts && opts.limit) || 25;
  _outerDiag.phase = "cleaned_query"; const query = cleanQuery(preprocessQuery(rawQuery)); _outerDiag.cleanedQuery = query.slice(0, 200);
  // A resolved person name from conversation history (pronoun follow-up like
  // "he has papers from UTK") takes priority over re-detecting from rawQuery.
  const resolvedPersonName = opts && opts.resolvedPersonName;
  // Detect a person name embedded ANYWHERE in the query, not just when the
  // query IS a name. This catches "Reese Sahos studies on BSFL" -> "Reese Saho".
  const embeddedName = extractPersonNameFromQuery(rawQuery);
  const isNameQuery = !!resolvedPersonName || !!embeddedName;
  const effectiveName = resolvedPersonName || embeddedName || rawQuery.trim();
  // Run typo-correction BEFORE binomial extraction, not just on the separate
  // `query` variable below. Previously this used rawQuery verbatim, so a
  // voice-dictation typo like "Hermia illusions" still LOOKED taxonomic
  // (capitalized two-word pair) and got captured as `binomial` — which takes
  // priority over the properly-typo-corrected/SYNONYMS-resolved organism
  // detection below, silently reintroducing the exact bug the typo-corrector
  // exists to fix. correctBinomialTypos() only rewrites genuine typos (see
  // its own exact-match skip) so a correctly-typed binomial like "Escherichia
  // coli" or "Populus angustifolia" is untouched and still detected here.
  const binomial = extractBinomial(correctBinomialTypos(rawQuery));

  // AUTHOR QUERY: single clean path. Query the primary sources directly (they
  // have the freshest data — aggregators lag weeks to months), extract the
  // FULL author list from each result, filter by actual name-token membership,
  // deduplicate, and return. No layered fallbacks, no walls. If truly nothing
  // matches, the endpoint responds with helpful suggestions rather than dumping
  // unrelated papers or throwing up an "author not confirmed" screen.
  _outerDiag.phase = "name_check_done"; _outerDiag.isNameQuery = isNameQuery;
  if (isNameQuery) {
    _outerDiag.phase = "author_branch";
    const nameLower = effectiveName.toLowerCase();
    const nameTokens = nameLower.split(/\s+/).filter((t) => t.length > 1);
    // Build a quoted-phrase query for the full name and also a broader OR of
    // first+last for sources that don't handle quoted phrases well.
    const quoted = '"' + effectiveName + '"';

    // Primary source parallel fetch. Each source returns papers with a full
    // author list in _allAuthors (this is the bug that was previously silently
    // dropping real matches — the strict filter was checking a truncated field).
    const results = await Promise.allSettled([
      europePMC(quoted, 25),                        // best full-text index for biomed
      openAlex(quoted, 25, openAlexKey),            // cross-disciplinary
      crossref(quoted, 15),                         // DOI-registered works
      arxiv(effectiveName, 15),                     // physics/CS/quantitative bio
      semanticScholar(quoted, 15),                  // includes preprints
      biorxivDirectAuthor(effectiveName),           // fresh biology preprints
      medrxivDirectAuthor(effectiveName),           // fresh medical preprints
    ]);

    const merged = [];
    const seenTitles = new Set();
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const p of (r.value || [])) {
        // Check the FULL author list, not the truncated `authors` display.
        const authorHay = (p._allAuthors || p.authors || "").toLowerCase();
        if (!authorHay) continue;
        // Require every token of the searched name to appear somewhere in
        // the paper's actual author string. This is the correct filter and
        // works because we now capture the full author list.
        const hit = nameTokens.every((t) => authorHay.includes(t));
        if (!hit) continue;
        const titleKey = (p.title || "").toLowerCase().trim();
        if (!titleKey || seenTitles.has(titleKey)) continue;
        seenTitles.add(titleKey);
        merged.push({ ...p, authorMatch: effectiveName });
      }
    }

    // Score and type
    _outerDiag.phase = "scoring"; const scored = merged.map((p) => {
      const j = (p.journal || "").toLowerCase();
      let type = "Journal";
      if (/preprint|biorxiv|medrxiv|arxiv/.test(j)) type = "Preprint";
      else if (/zenodo|datacite|figshare|dryad/.test(j)) type = "Dataset";
      return {
        ...p,
        score: 10,
        contentHits: 1,
        contentCoverage: 1,
        organismPresent: true,
        relevance: 100,
        type,
      };
    });

    // Sort: most-cited first (proxy for career impact); recent second when ties
    scored.sort((a, b) => {
      const ac = a.citations || 0, bc = b.citations || 0;
      if (bc !== ac) return bc - ac;
      const ay = parseInt(a.year, 10) || 0, by = parseInt(b.year, 10) || 0;
      return by - ay;
    });

    if (scored.length) return { papers: scored };

    // Truly no papers matched by author. Signal that so the endpoint can
    // respond with helpful suggestions (not a wall, not unrelated papers).
    return { papers: [], noResults: true };
  }

  _outerDiag.phase = "before_ladder";
  // ============ RETRIEVAL LADDER ============
  // The retrieval system that has to work right or nothing else matters.
  //
  // Design principles (each learned from a real production failure):
  //
  // 1. EVERY ENGINE GETS ITS OWN QUERY DIALECT.
  //    Europe PMC and PubMed parse boolean. OpenAlex, Crossref, Semantic
  //    Scholar, DOAJ, PLOS, Zenodo treat "(a OR b)" as literal text → zero.
  //    arXiv needs "all:x AND all:y". Sending one string to all ten is the
  //    single mistake that caused the longest outage in this project.
  //
  // 2. CONCEPT EXPANSION ONLY WHERE IT'S SAFE.
  //    Europe PMC and PubMed handle OR-expanded groups well. For the plain-
  //    keyword engines, we send ONLY the bare anchor terms — no parens, no
  //    "OR", no boolean operators of any kind. These engines do fuzzy/semantic
  //    matching internally; our OR-expansion was fighting their own relevance
  //    algorithm and reducing recall.
  //
  // 3. THE LADDER LOOSENS PROGRESSIVELY.
  //    4 anchors → 3 → 2 → 1. Stop at the first rung that returns ≥5 papers.
  //    Then also search any sub-clauses of a compound question.
  //
  // 4. THE RAW QUERY IS ALWAYS THE FINAL FALLBACK.
  //    If no rung worked, we try the user's original query verbatim. Some
  //    engines do NLP-level understanding of natural language; our anchor
  //    extraction sometimes loses information they would have caught.

  // ORGANISM INJECTION: detect the organism FIRST so we can strip its common-
  // name words from the ranked terms. Without this, "black", "soldier", "fly"
  // fill rung slots that should hold "microbial", "abundance", "midgut" — and
  // the duplicate check sees "black" in the rung and skips injecting the
  // scientific name entirely.
  const orgInfo = splitOrganismTopic(query);

  // Build a set of all words that are part of the organism's common name(s).
  // These must be EXCLUDED from the ranked topic terms — they get replaced by
  // the quoted scientific name.
  const orgFragments = new Set();
  if (orgInfo.hasOrganism) {
    for (const phrase of orgInfo.orgPhrases) {
      for (const w of phrase.toLowerCase().split(/\s+/)) {
        if (w.length > 2) orgFragments.add(w);
      }
    }
    // Also add all words from ORGANISM_WORDS
    for (const w of ORGANISM_WORDS) orgFragments.add(w);
  }

  const ranked = query
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t) && !orgFragments.has(t))
    .map((t) => ({ t, spec: termSpecificity(t) }))
    .sort((a, b) => b.spec - a.spec)
    .map((x) => x.t);
  let organismTerm = null;
  if (binomial) {
    organismTerm = '"' + binomial.full + '"';
  } else if (orgInfo.hasOrganism && orgInfo.orgPhrases.length) {
    // Resolve to the SCIENTIFIC NAME, properly capitalized and quoted.
    // Previous bugs: (1) regex was case-sensitive so lowercase SYNONYMS values
    // like "hermetia illucens" never matched; (2) fell back to bare common name
    // "black soldier fly" which search engines split into 3 common words.
    // (3) a phrase that IS ALREADY a binomial (e.g. "hermetia illucens",
    // matched directly via ORGANISM_PHRASES rather than through a common-name
    // SYNONYMS key) was never included here — SYNONYMS["hermetia illucens"]
    // is undefined, since it's only ever a dictionary VALUE, never a KEY — so
    // a query that names the scientific name directly, alongside some OTHER
    // organism's common name, could resolve to the wrong organism entirely.
    const expanded = orgInfo.orgPhrases.flatMap((p) =>
      ORGANISM_BINOMIALS.has(p.toLowerCase()) ? [p] : (SYNONYMS[p.toLowerCase()] || [])
    );
    // Case-INSENSITIVE binomial detection, then capitalize properly
    const sciRaw = expanded.find((e) => /^[a-z]+ [a-z]+$/i.test(e) && e.split(" ").length === 2);
    if (sciRaw) {
      // Proper binomial capitalization: "Hermetia illucens"
      const parts = sciRaw.split(" ");
      const sciName = parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase() + " " + parts[1].toLowerCase();
      organismTerm = '"' + sciName + '"';
    } else if (expanded.length) {
      // Non-binomial expansion (e.g. acronym → full name)
      organismTerm = '"' + expanded[0] + '"';
    } else {
      // Last resort: quote the detected phrase itself
      organismTerm = '"' + orgInfo.orgPhrases[0] + '"';
    }
  }

  // MULTI-ORGANISM COMPARISON: `organismTerm` above is a single value — the
  // first organism found — but a comparison query ("Hermetia illucens vs
  // honey bee", "BSFL and honeybee gut microbiome") names TWO. Without this,
  // the entire retrieval ladder below only ever searches for whichever
  // organism happened to win the single pick, and the other is silently
  // dropped from every source query. Collect every distinct scientific name
  // detected (properly capitalized, same resolution rules as organismTerm
  // above) so a later block can fire one extra, engine-dialect-correct
  // search pass per additional organism.
  const allOrganismSciNames = (() => {
    // Restrict to KNOWN_BINOMIALS specifically, not just "any two-word
    // SYNONYMS value" — SYNONYMS has plenty of non-organism two-word entries
    // (e.g. "crispr" expands to, among other things, "gene editing"), and
    // this list drives real extra network calls per entry, so a shape-only
    // regex here would fire a bogus supplementary search for "Gene editing"
    // as if it were a second organism whenever a query mentioned CRISPR
    // alongside a real species.
    const raw = orgInfo.orgPhrases.flatMap((p) => {
      if (ORGANISM_BINOMIALS.has(p.toLowerCase())) return [p];
      return (SYNONYMS[p.toLowerCase()] || []).filter((e) => ORGANISM_BINOMIALS.has(e.toLowerCase()));
    });
    if (binomial) raw.push(binomial.full.toLowerCase());
    const capitalized = raw.map((sciRaw) => {
      const parts = sciRaw.split(" ");
      return parts[0][0].toUpperCase() + parts[0].slice(1).toLowerCase() + " " + parts[1].toLowerCase();
    });
    return [...new Set(capitalized)];
  })();
  const primaryOrganismName = organismTerm ? organismTerm.replace(/"/g, "") : null;
  const secondaryOrganisms = allOrganismSciNames.filter((n) => n !== primaryOrganismName).slice(0, 2);

  const booleanQuery = buildStructuredQuery(query);
  const arxivQuery = (terms) => terms.map((t) => "all:" + t).join(" AND ");

  // Progressive rungs, most-precise first.
  // If we detected an organism, prepend it to EVERY rung so the organism
  // is always part of the search, no matter how loose the topic terms get.
  let rungs = [
    ranked.slice(0, 4),
    ranked.slice(0, 3),
    ranked.slice(0, 2),
    ranked.slice(0, 1),
  ].filter((r) => r.length > 0);
  if (!rungs.length) rungs.push([query]);

  if (organismTerm) {
    // Organism words were already stripped from `ranked`, so no rung can
    // contain organism fragments. Unconditionally prepend the quoted
    // scientific name to every rung.
    //
    // Previous bug: the duplicate check used
    //   organismTerm.includes(rungWord)
    // which meant "black" (in "black soldier fly") counted as "organism
    // present" → injection was skipped → search ran without the species.
    rungs = rungs.map((rung) => [organismTerm, ...rung]);
  }

  // The fanout sends the RIGHT syntax to EACH engine. This is the most
  // important function in the entire codebase — if it sends the wrong format
  // to any engine, that engine silently returns zero and the user sees
  // "no papers found".
  const fanout = (terms, useBoolean) => {
    // For organism queries: build queries that force organism AND topic together.
    // The organism term is quoted so search engines treat it as a phrase.
    // Since organism-word fragments are already stripped from `ranked`, the
    // only organism element in `terms` is the quoted scientific name itself.
    const orgQuoted = organismTerm || "";
    const topicTerms = orgQuoted
      ? terms.filter((t) => t !== orgQuoted)
      : terms;
    const topicStr = topicTerms.join(" ");

    // Boolean engines (EPMC, PubMed): organism AND topic using boolean syntax
    const boolQ = useBoolean
      ? (orgQuoted ? orgQuoted + " AND (" + (topicStr || query) + ")" : booleanQuery)
      : (orgQuoted ? orgQuoted + " " + topicStr : terms.join(" "));
    // Plain-keyword engines: combined string (organism + topic together)
    const bare = orgQuoted ? orgQuoted.replace(/"/g, "") + " " + topicStr : terms.join(" ");
    // arXiv: prefix each term with "all:" and join with " AND "
    const arxTerms = orgQuoted
      ? [orgQuoted.replace(/"/g, ""), ...topicTerms]
      : terms;
    const arx = arxTerms.map((t) => "all:" + t).join(" AND ");

    return [
      europePMC(boolQ, 12),
      pubmed(boolQ, 12, ncbiKey),
      openAlex(bare, 12, openAlexKey),
      crossref(bare, 10),
      arxiv(arx, 8),
      semanticScholar(bare, 10),
      doaj(bare, 8),
      biorxiv(bare, 8),
      zenodo(bare, 6),
      plos(bare, 8),
      // Additional high-value sources (4 new)
      coreSearch(bare, 8),
      baseSearch(bare, 8),
      pmcFullText(bare, 6),
      openAire(bare, 6),
    ];
  };

  // Multi-part question detection.
  const clauses = rawQuery
    .split(/\s*(?:,\s*)?\band\b\s+(?=how|what|why|when|where|which|do|does|can|is|are)|\s*[;?]\s*/i)
    .map((c) => c.trim())
    .filter((c) => c.split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase())).length >= 2);

  const subQueries = clauses.length > 1
    ? clauses.map((c) =>
        c.toLowerCase().replace(/[^\w\s-]/g, " ").split(/\s+/)
          .filter((t) => t.length > 2 && !STOPWORDS.has(t))
          .map((t) => ({ t, spec: termSpecificity(t) }))
          .sort((a, b) => b.spec - a.spec)
          .slice(0, 3).map((x) => x.t)
      ).filter((arr) => arr.length >= 2)
    : [];

  _outerDiag.phase = "ladder_start";
  let results = [];
  const diag = { rungs: [], sourceOutcomes: null };
  const sourceNames = ["europePMC","pubmed","openAlex","crossref","arxiv","semanticScholar","doaj","biorxiv","zenodo","plos","CORE","BASE","pmcFullText","openAire"];

  let accumulated = [];
  for (let i = 0; i < rungs.length; i++) {
    const rungResults = await Promise.allSettled(fanout(rungs[i], i === 0));
    accumulated = accumulated.concat(rungResults);
    const perSource = rungResults.map((r, idx) => ({
      source: sourceNames[idx],
      status: r.status,
      count: r.status === "fulfilled" ? (r.value || []).length : 0,
      error: r.status === "rejected" ? String(r.reason && r.reason.message || r.reason).slice(0, 120) : null,
    }));
    const got = perSource.reduce((n, x) => n + x.count, 0);
    diag.rungs.push({ terms: rungs[i], got, perSource });
    diag.sourceOutcomes = perSource;
    // Total accumulated across all rungs so far, not just this rung alone —
    // this is what should gate whether we keep loosening the query.
    const totalAccumulated = accumulated.reduce(
      (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
    );
    if (totalAccumulated >= 8) break;
  }
  results = accumulated;

  // FINAL FALLBACK: if no rung returned enough, try the raw user query
  // verbatim. Some engines (especially Semantic Scholar and Europe PMC) have
  // surprisingly good NLP that handles natural-language questions better than
  // our extracted anchors.
  const totalSoFar = results.reduce(
    (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
  );
  if (totalSoFar < 8) {
    // Include organism name in the raw fallback so we find species-specific papers
    const rawQ = organismTerm
      ? organismTerm.replace(/"/g, "") + " " + query
      : query;
    const rawFallback = await Promise.allSettled([
      europePMC(rawQ, 12),
      semanticScholar(rawQ, 10),
      openAlex(rawQ, 10, openAlexKey),
    ]);
    results = results.concat(rawFallback);
    diag.rawFallback = rawFallback.map((r, i) => ({
      source: ["europePMC","semanticScholar","openAlex"][i],
      count: r.status === "fulfilled" ? (r.value || []).length : 0,
    }));
  }

  // ═══════════════════════════════════════════════════════════════
  // CONCEPT-EXPANDED FALLBACK: if we STILL have too few papers, the problem
  // is vocabulary mismatch — the user's words don't match how papers phrase
  // it. Expand each topic term through CONCEPT_GROUPS to find synonyms the
  // papers actually use.
  //
  // Example: user writes "microbial abundance" → papers say "bacterial
  // diversity", "microbiota composition", "16S rRNA community".
  // The concept expansion turns "microbial" into "bacteria OR microbiome
  // OR microbiota" — which is how the paper is indexed.
  //
  // This runs IN PARALLEL with the raw fallback check above (no extra
  // latency) by launching immediately and only using results if needed.
  // ═══════════════════════════════════════════════════════════════
  const totalAfterRaw = results.reduce(
    (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
  );
  if (totalAfterRaw < 8) {
    // Build synonym-expanded queries from concept groups
    const topicTermsForExpansion = ranked.slice(0, 3);
    const expandedQueries = new Set();

    for (const term of topicTermsForExpansion) {
      const group = CONCEPT_LOOKUP.get(term);
      if (group) {
        // Pick 2-3 synonyms from the concept group that aren't the original term
        const alts = [...group].filter((g) => g !== term && g.length > 3).slice(0, 3);
        for (const alt of alts) {
          const q = organismTerm
            ? organismTerm.replace(/"/g, "") + " " + alt + " " + topicTermsForExpansion.filter((t) => t !== term).join(" ")
            : alt + " " + topicTermsForExpansion.filter((t) => t !== term).join(" ");
          expandedQueries.add(q.trim());
        }
      }
    }

    // Also try the organism alone (broadest possible) if we have one
    if (organismTerm) {
      expandedQueries.add(organismTerm.replace(/"/g, ""));
      // Organism + each individual topic term
      for (const term of topicTermsForExpansion.slice(0, 2)) {
        expandedQueries.add(organismTerm.replace(/"/g, "") + " " + term);
        // Also try concept-expanded version
        const group = CONCEPT_LOOKUP.get(term);
        if (group) {
          const alt = [...group].find((g) => g !== term && g.length > 3);
          if (alt) expandedQueries.add(organismTerm.replace(/"/g, "") + " " + alt);
        }
      }
    }

    // Fire expanded queries in parallel across the most reliable engines
    const expandedArr = [...expandedQueries].slice(0, 6);
    if (expandedArr.length) {
      const expandedResults = await Promise.allSettled(
        expandedArr.flatMap((eq) => [
          europePMC(eq, 8),
          semanticScholar(eq, 6),
          openAlex(eq, 6, openAlexKey),
        ])
      );
      results = results.concat(expandedResults);
      diag.conceptExpanded = expandedArr;
      diag.conceptExpandedCount = expandedResults.reduce(
        (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // NATURAL LANGUAGE FALLBACK: if STILL nearly empty, send the user's
  // ORIGINAL unprocessed question to Semantic Scholar and Europe PMC.
  // These engines have good NLP — sometimes the raw human phrasing works
  // better than any term extraction. This is the "ask it like you'd ask
  // a person" fallback.
  // ═══════════════════════════════════════════════════════════════
  const totalAfterExpand = results.reduce(
    (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
  );
  if (totalAfterExpand < 5) {
    const nlFallback = await Promise.allSettled([
      semanticScholar(rawQuery.slice(0, 200), 15),
      europePMC(rawQuery.slice(0, 200), 12),
      openAlex(rawQuery.slice(0, 200), 10, openAlexKey),
    ]);
    results = results.concat(nlFallback);
    diag.nlFallback = nlFallback.reduce(
      (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0
    );
  }

  // Add results for each sub-question of a compound query
  if (subQueries.length > 1) {
    for (const sub of subQueries) {
      try {
        const subRes = await Promise.allSettled(fanout(sub, false));
        results = results.concat(subRes);
        diag["clause:" + sub.join("+")] = subRes.reduce(
          (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0);
      } catch {}
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECONDARY ORGANISM RETRIEVAL: everything above only ever searched for
  // ONE organism (`organismTerm`). A comparison query names a second one
  // (`secondaryOrganisms`, computed earlier from the same detection that
  // built `organismTerm`) that has had zero queries fired for it so far —
  // not "too few", literally zero, because every rung above unconditionally
  // AND'd the primary organism into the query. This fires once per
  // additional organism (capped at 2), using the same per-engine dialect
  // rules as fanout() above: boolean AND for EPMC/PubMed, plain
  // concatenation for keyword engines. Always runs when a second organism is
  // detected — the primary ladder already having "enough" total results
  // says nothing about whether the SECOND organism is represented at all,
  // which is exactly the bug this fixes.
  // ═══════════════════════════════════════════════════════════════
  if (secondaryOrganisms.length) {
    const topicStr2 = ranked.slice(0, 3).join(" ") || query;
    for (const sciName of secondaryOrganisms) {
      const orgQuoted2 = '"' + sciName + '"';
      try {
        const secResults = await Promise.allSettled([
          europePMC(orgQuoted2 + " AND (" + topicStr2 + ")", 10),
          pubmed(orgQuoted2 + " AND (" + topicStr2 + ")", 10, ncbiKey),
          openAlex(sciName + " " + topicStr2, 10, openAlexKey),
          crossref(sciName + " " + topicStr2, 8),
          semanticScholar(sciName + " " + topicStr2, 10),
          doaj(sciName + " " + topicStr2, 6),
          biorxiv(sciName + " " + topicStr2, 6),
        ]);
        results = results.concat(secResults);
        diag["secondaryOrganism:" + sciName] = secResults.reduce(
          (n, r) => n + (r.status === "fulfilled" ? (r.value || []).length : 0), 0);
      } catch {}
    }
  }

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

  // ============ RELEVANCE SCORING ============
  // Rebuilt from scratch. The old version had five compounding bugs that were
  // the root cause of nearly every "wrong paper" report:
  //
  //   1. Used hay.indexOf(term) — substring matching. "micro" matched
  //      "micro-motion", "microscopy", "micrometer". A query about the
  //      microbiome returned radar engineering papers at 100% relevance.
  //   2. Stemmer stripped "ion"/"al"/"ed" unconditionally, so "motion" -> "mot"
  //      which then matched "motor", "remote", "mother", "promote".
  //   3. Relevance was RELATIVE (score / maxScore). If every result was
  //      garbage, the least-bad garbage still displayed "100% match".
  //   4. No absolute quality floor — top N were returned no matter how bad,
  //      then handed to the AI, which dutifully cited them.
  //   5. Stopwords were never filtered, so "the", "was", "that", "main",
  //      "point" all counted as content matches and inflated every score.
  //
  // Every one of those is fixed below.
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9\-]/g, ""))
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  const expansions = expansionsFor(terms);

  // Neutral (organism) words vs content (topic) words
  const neutralWords = new Set(terms.filter((t) => SYNONYMS[t]));
  for (const phrase of expansions) {
    for (const w of phrase.toLowerCase().split(/\s+/)) {
      if (w.length > 2) neutralWords.add(w);
    }
  }
  for (const w of ORGANISM_WORDS) {
    if (terms.includes(w)) neutralWords.add(w);
  }
  const contentTerms = terms.filter((t) => !neutralWords.has(t));

  // Conservative stemmer. Only strips endings when the remaining stem is still
  // long enough to be meaningful (>= 4 chars). The old version turned "motion"
  // into "mot" and "radial" into "radi", which matched half the dictionary.
  const stem = (w) => {
    if (w.length <= 4) return w;
    // Plurals and simple verb forms only. Never strip "al"/"ion" — those are
    // part of the root in most scientific vocabulary (radial, motion, ionic).
    const stripped = w.replace(/(ies|ied)$/i, "y").replace(/(es|s|ing|ed)$/i, "");
    return stripped.length >= 4 ? stripped : w;
  };

  // Concept-aware matcher. Beyond the term itself and its stem, this also
  // matches any member of the term's concept group — so a query for "plastic"
  // is satisfied by a paper that only ever writes "polyethylene".
  const matcherCache = new Map();
  const matcherFor = (term) => {
    if (matcherCache.has(term)) return matcherCache.get(term);
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const t = esc(term);
    const s = esc(stem(term));
    const group = CONCEPT_LOOKUP.get(term);
    const alts = new Set([t]);
    if (s !== t) alts.add(s + "(?:s|es|ing|ed|al)?");
    else alts.add(t + "(?:s|es|ing|ed)?");
    if (group) {
      for (const g of group) {
        if (g === term) continue;
        alts.add(esc(g).replace(/\s+/g, "\\s+"));
      }
    }
    const body = [...alts].join("|");
    let re;
    try {
      re = new RegExp(`(?<![a-z0-9])(?:${body})(?![a-z0-9])`, "i");
    } catch {
      re = new RegExp(`\\b(?:${body})\\b`, "i");
    }
    matcherCache.set(term, re);
    return re;
  };

  // Split content terms by how much they actually identify the topic. Gating
  // happens on CORE terms only; peripheral terms still add score when present
  // but never cause a real paper to be rejected.
  const rankedTerms = contentTerms
    .map((t) => ({ t, spec: termSpecificity(t) }))
    .sort((a, b) => b.spec - a.spec);
  const coreTerms = rankedTerms.filter((x) => x.spec >= 0.5).map((x) => x.t);
  const peripheralTerms = rankedTerms.filter((x) => x.spec < 0.5).map((x) => x.t);
  // If nothing cleared the specificity bar (very generic query), fall back to
  // the three most specific terms available so we still gate on something.
  const gateTerms = coreTerms.length ? coreTerms : rankedTerms.slice(0, 3).map((x) => x.t);

  // Compound-term detection. Scientific vocabulary is full of terms users split
  // apart when typing: "micro biome" vs "microbiome", "bio conversion" vs
  // "bioconversion", "gut micro biome". Strict word-boundary matching would
  // (correctly) refuse to match "micro" inside "microbiome" — but then the
  // legitimate paper gets rejected too. So we also test adjacent term pairs
  // joined together, and if the compound appears, both halves count as matched.
  const compoundPairs = [];
  for (let i = 0; i < contentTerms.length - 1; i++) {
    const joined = contentTerms[i] + contentTerms[i + 1];
    if (joined.length >= 6) {
      compoundPairs.push({ a: contentTerms[i], b: contentTerms[i + 1], joined });
    }
  }

  const scored = merged
    .map((p) => {
      const title = p.title || "";
      const abstract = p.abstract || "";
      const hay = (title + " " + abstract).toLowerCase();
      const titleHay = title.toLowerCase();

      // Which terms were satisfied via a compound match in body / title
      const compoundSatisfied = new Set();
      const compoundSatisfiedTitle = new Set();
      for (const cp of compoundPairs) {
        if (matcherFor(cp.joined).test(hay)) {
          compoundSatisfied.add(cp.a);
          compoundSatisfied.add(cp.b);
        }
        if (matcherFor(cp.joined).test(titleHay)) {
          compoundSatisfiedTitle.add(cp.a);
          compoundSatisfiedTitle.add(cp.b);
        }
      }

      const has = (t) => compoundSatisfied.has(t) || matcherFor(t).test(hay);
      const hasTitle = (t) => compoundSatisfiedTitle.has(t) || matcherFor(t).test(titleHay);

      // Precompute gate-hit counts here so the downstream .filter() (which
      // is in a different scope and can't reach these closures) can read them
      // as properties on the returned paper object.
      const gateCoreHits = gateTerms.filter(has).length;
      const gateCoreTitleHits = gateTerms.filter(hasTitle).length;

      const contentHits = contentTerms.filter(has).length;
      const titleContentHits = contentTerms.filter(hasTitle).length;
      const neutralHit = (() => {
        // Count how many organism-specific words appear in the paper.
        // A single word like "fly" is too generic — it matches "fruit fly",
        // "tsetse fly", "fly ash", etc. Require at least 2 organism words
        // from the query to match, OR require the full scientific name.
        const orgWordsInPaper = [...neutralWords].filter(has);
        // Words that are too generic to count alone
        const GENERIC_ORG_WORDS = new Set(["fly", "black", "red", "blue", "white", "green",
          "brown", "common", "small", "large", "big", "long", "short", "wild", "mouse",
          "rat", "fish", "worm", "bug", "bee", "ant", "cat", "dog", "bird", "tree", "honey"]);
        const specificHits = orgWordsInPaper.filter(w => !GENERIC_ORG_WORDS.has(w));
        // If we have specific hits (like "hermetia" or "illucens"), one is enough
        if (specificHits.length >= 1) return true;
        // If only generic hits (like "fly"), need at least 2 together
        if (orgWordsInPaper.length >= 2) return true;
        return false;
      })();
      // Multi-word expansions are checked as exact phrases (they're already
      // specific enough that substring matching is safe and desirable here).
      let expHit = false;
      for (const phrase of expansions) {
        if (hay.indexOf(phrase.toLowerCase()) !== -1) {
          expHit = true;
          break;
        }
      }
      // Also check if the resolved scientific name appears (catches papers that
      // use "Hermetia illucens" but none of the common-name words)
      let sciHit = false;
      if (organismTerm) {
        const sciClean = organismTerm.replace(/"/g, "").toLowerCase();
        if (hay.indexOf(sciClean) !== -1) sciHit = true;
        // Also check abbreviated form: "H. illucens"
        const sciParts = sciClean.split(" ");
        if (sciParts.length === 2) {
          const abbrev = sciParts[0][0] + ". " + sciParts[1];
          if (hay.indexOf(abbrev) !== -1) sciHit = true;
        }
      }
      const organismPresent = neutralHit || expHit || sciHit;
      const contentCoverage = contentTerms.length
        ? contentHits / contentTerms.length
        : 1;

      // ---- Absolute scoring, normalized to a 0-100 scale ----
      // Coverage is measured on CORE terms (the ones that actually identify the
      // topic) rather than every word, so filler words in a long question can't
      // dilute a genuinely on-topic paper's score.
      const coreHitCount = gateTerms.filter(has).length;
      const coreCoverage = gateTerms.length ? coreHitCount / gateTerms.length : 1;
      const coreTitleHits = gateTerms.filter(hasTitle).length;
      const periphHits = peripheralTerms.filter(has).length;

      let match = 0;
      match += coreCoverage * 42;
      match += gateTerms.length ? (coreTitleHits / gateTerms.length) * 20 : 0;
      // Peripheral terms are a small bonus, never a requirement
      match += peripheralTerms.length ? (periphHits / peripheralTerms.length) * 4 : 0;
      if (organismPresent && (contentTerms.length === 0 || contentHits > 0)) match += 12;
      // Penalize papers that MISS the organism when the query clearly names one
      if (!organismPresent && contentTerms.length > 0 && binomial) match -= 5;

      let quality = 0;
      if (abstract.length > 200) quality += 8;      // has a real abstract
      else if (abstract.length > 0) quality += 3;
      if (typeof p.citations === "number") {
        // Log scale — 10 citations matters much more than 1000 vs 990
        quality += Math.min(Math.log10(Math.max(1, p.citations)) * 4, 12);
      }
      const yr = parseInt(p.year, 10);
      const nowYear = new Date().getFullYear();
      if (yr) {
        const age = nowYear - yr;
        if (age <= 2) quality += 10;
        else if (age <= 5) quality += 7;
        else if (age <= 10) quality += 4;
        else if (age <= 20) quality += 1;
      }

      const score = match + quality;

      return {
        ...p,
        score,
        matchScore: match,       // 0-70, pure topical relevance
        qualityScore: quality,   // 0-30, source quality signals
        contentHits,
        titleContentHits,
        contentCoverage,
        organismPresent,
        gateCoreHits,             // used by the downstream .filter()
        gateCoreTitleHits,
      };
    })
    .filter((p) => {
      // ── LANGUAGE FILTER ──
      // Reject papers that are clearly non-English based on title character analysis
      const title = (p.title || "").trim();
      if (title) {
        // Check for non-Latin scripts (Chinese, Japanese, Korean, Arabic, Cyrillic, etc.)
        const nonLatinRatio = (title.match(/[^\u0000-\u024F\u1E00-\u1EFF\s\d\-.,;:()[\]{}'"!?@#$%^&*+=/<>]/g) || []).length / title.length;
        if (nonLatinRatio > 0.3) return false;
        // Check for French/German/Spanish academic markers (common false positives)
        const lowerTitle = title.toLowerCase();
        if (/^(les |une |des |étude |analyse |recherche |l'|la |le |du |de la )/.test(lowerTitle)) return false;
        if (/^(die |das |ein |eine |zur |über )/.test(lowerTitle)) return false;
      }

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
        // Comparison queries name a SECOND organism (secondaryOrganisms,
        // computed earlier) that this strict single-species gate would
        // otherwise wipe out entirely — a paper about honeybee gut microbiota
        // correctly has zero mentions of "illucens" and would fail every
        // check above even though it's exactly what a comparison query asked
        // for. Accept it too.
        const hasSecondaryOrganism = secondaryOrganisms.some(
          (name) => hay.indexOf(name.toLowerCase()) !== -1
        );
        if (!hasBinomial && !hasSpeciesWord && !hasAbbrev && !hasSecondaryOrganism) return false;
      }
      // Name queries: keep everything relevance-sorted, don't apply topic gate.
      if (isNameQuery) return true;

      // ---- QUALITY FLOOR (core-term based) ----
      // Gate on CORE terms only. A flat percentage of every word was rejecting
      // correct papers for verbose questions — a real paper on waxworm saliva
      // enzymes matched only 2 of 9 words in a long question and got dropped.
      // The threshold also relaxes as the core set grows, because no single
      // paper contains every concept in a multi-part question.
      //
      // NOTE: `has` and `hasTitle` are closures defined per-paper inside the
      // preceding .map(). They don't exist in this .filter() scope. We use the
      // pre-computed count fields on `p` instead — which was the bug that has
      // been silently killing every retrieval for weeks (ReferenceError inside
      // a Promise.allSettled callback, swallowed by the outer catch).
      if (gateTerms.length > 0) {
        const coreHits = p.gateCoreHits || 0;
        const coreTitleHits = p.gateCoreTitleHits || 0;
        let required;
        if (gateTerms.length <= 2) required = 1;
        else if (gateTerms.length <= 4) required = 2;
        else if (gateTerms.length <= 6) required = 2;
        else required = 3;
        const titleStrong = coreTitleHits >= 2;
        if (coreHits < required && !titleStrong) return false;
      }

      const queryNamesOrganism = neutralWords.size > 0;
      if (queryNamesOrganism) {
        return (
          p.organismPresent &&
          (contentTerms.length === 0 || p.contentHits > 0)
        );
      }
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // EMERGENCY RELAXATION: the organism gate above is strict by design (never
  // show BSF papers for an E. coli query), but if it filters EVERY candidate
  // to zero, an empty result is worse than a clearly-labeled partial match.
  //
  // Three tiers of relaxation:
  // 1. Drop organism requirement, keep topic gate (finds papers on the topic
  //    that don't mention the specific species)
  // 2. Use concept-group matching (finds papers using synonym vocabulary)
  // 3. Keep anything with a real abstract and any topic word (broadest)
  let finalScored = scored;
  if (scored.length < 3 && merged.length > 0) {
    // Tier 1: drop organism, keep content gate
    const relaxed1 = merged
      .map((p) => {
        const hay = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
        const has = (t) => new RegExp("\\b" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(hay);
        // Also check concept-group synonyms — "bacterial" satisfies "microbial"
        const hasExpanded = (t) => {
          if (has(t)) return true;
          const group = CONCEPT_LOOKUP.get(t);
          if (group) {
            for (const g of group) {
              if (g !== t && hay.indexOf(g.toLowerCase()) !== -1) return true;
            }
          }
          return false;
        };
        const coreHits = gateTerms.filter(hasExpanded).length;
        const coreCoverage = gateTerms.length ? coreHits / gateTerms.length : 0;
        // Check if organism is present even without the strict gate
        let orgPresent = false;
        if (organismTerm) {
          const sciClean = organismTerm.replace(/"/g, "").toLowerCase();
          if (hay.indexOf(sciClean) !== -1) orgPresent = true;
          for (const w of ORGANISM_WORDS) { if (hay.indexOf(w) !== -1) { orgPresent = true; break; } }
        }
        const orgBonus = orgPresent ? 15 : 0;
        return { ...p, score: coreCoverage * 40 + orgBonus, contentHits: coreHits, contentCoverage: coreCoverage, organismPresent: orgPresent, relevance: null };
      })
      .filter((p) => p.contentHits > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (relaxed1.length >= 3) {
      finalScored = [...scored, ...relaxed1].sort((a, b) => b.score - a.score).slice(0, limit);
    } else {
      // Tier 2: accept anything with a real abstract and at least 1 matching word
      const relaxed2 = merged
        .filter((p) => (p.abstract || "").length > 100)
        .map((p) => {
          const hay = ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
          const anyHit = [...contentTerms, ...gateTerms, ...[...neutralWords]].some((t) => hay.indexOf(t) !== -1);
          return { ...p, score: anyHit ? 20 : 5, contentHits: anyHit ? 1 : 0, contentCoverage: anyHit ? 0.3 : 0, organismPresent: false, relevance: null };
        })
        .filter((p) => p.score > 5)
        .sort((a, b) => {
          // Prefer papers with more citations and abstracts
          const ca = (a.citations || 0), cb = (b.citations || 0);
          return cb - ca;
        })
        .slice(0, limit);
      finalScored = [...scored, ...relaxed1, ...relaxed2].sort((a, b) => b.score - a.score).slice(0, limit);
    }
  }
  const scoredFinal = finalScored;

  for (const p of scoredFinal) {
    // ---- ABSOLUTE RELEVANCE ----
    // Score is already on a 0-100 absolute scale (70 match + 30 quality), so we
    // report it directly instead of normalizing against the best result in the
    // set. A weak match now honestly reads as "38% match" rather than being
    // inflated to 100% just because everything else was worse.
    p.relevance = Math.max(0, Math.min(100, Math.round(p.score)));
    const j = (p.journal || "").toLowerCase();
    if (/wikipedia/.test(j)) p.type = "Reference";
    else if (/preprint|biorxiv|medrxiv|arxiv|ssrn|research square/.test(j))
      p.type = "Preprint";
    else if (/zenodo|datacite|figshare|dryad/.test(j)) p.type = "Dataset";
    else p.type = "Journal";
  }

  return { papers: scoredFinal, _diag: diag };
  } catch (e) {
    // Any throw in gatherPapers: return an empty result WITH the error surfaced
    // so the response body shows exactly where retrieval died instead of
    // silently defaulting to "General knowledge (AI)".
    return {
      papers: [],
      _diag: {
        ..._outerDiag,
        threwAt: _outerDiag.phase,
        errorMessage: String((e && e.message) || e).slice(0, 500),
        errorName: (e && e.name) || "Unknown",
        errorStack: String((e && e.stack) || "").slice(0, 1000),
      },
    };
  }
}

// ============ MAIN HANDLER ============

const cors = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

// ---- SECURITY LAYER ----
// Cerebrum is a free public endpoint, which makes it a target for abuse:
// scrapers, cost-driving request floods, and prompt-injection probing from
// automated tooling. These controls raise the cost of abuse without blocking
// legitimate users.

// Only allow requests that originate from our own site. A browser sends the
// Origin header on cross-site POSTs; automated abuse from other domains gets
// rejected. (Direct server-to-server abuse can spoof this, but it stops the
// large majority of drive-by browser-based abuse and hotlinking.)
const ALLOWED_ORIGINS = [
  "https://askcerebrum.org",
  "https://www.askcerebrum.org",
  "https://cerebrum-2pz.pages.dev",
];
// Cloudflare Pages preview deploys look like
// "https://<hash-or-branch>.cerebrum-2pz.pages.dev" — matched, but scoped to
// OUR project subdomain only. Bug fix: this used to be
// `origin.endsWith(".pages.dev")`, which trusts EVERY Cloudflare Pages site
// on the internet (anyone can spin one up for free), completely defeating
// the allowlist it was supposed to be.
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.cerebrum-2pz\.pages\.dev$/i;
function originAllowed(request) {
  const origin = request.headers.get("Origin") || "";
  // No Origin header = same-origin navigation or a non-browser client. Allow,
  // because legitimate same-origin fetches sometimes omit it, but this is the
  // path rate limiting protects.
  if (!origin) return true;
  return ALLOWED_ORIGINS.some((o) => origin === o) || PAGES_PREVIEW_RE.test(origin);
}

// In-memory sliding-window rate limiter, keyed by client IP. Cloudflare gives
// each colo its own isolate, so this is per-edge rather than global, but it's
// enough to stop a single IP from hammering one datacenter. For hard global
// limits you'd add a Durable Object or KV; this is the free-tier version.
const RATE_BUCKET = new Map();
const RATE_LIMIT = 20;         // requests
const RATE_WINDOW_MS = 60000;  // per minute
function rateLimit(ip) {
  const now = Date.now();
  const rec = RATE_BUCKET.get(ip) || [];
  const recent = rec.filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  RATE_BUCKET.set(ip, recent);
  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (RATE_BUCKET.size > 5000) {
    for (const [k, v] of RATE_BUCKET) {
      if (v.every((t) => now - t > RATE_WINDOW_MS)) RATE_BUCKET.delete(k);
    }
  }
  return recent.length <= RATE_LIMIT;
}

const MAX_QUERY_LEN = 2000;      // reject absurdly long queries (abuse / cost)
const MAX_HISTORY_TURNS = 20;    // cap conversation history size

export async function onRequest(context) {
  const { request, env } = context;

  // Lock CORS to our own origins instead of the wildcard "*".
  const reqOrigin = request.headers.get("Origin") || "";
  const corsOrigin =
    ALLOWED_ORIGINS.includes(reqOrigin) || PAGES_PREVIEW_RE.test(reqOrigin)
      ? reqOrigin
      : "https://askcerebrum.org";
  const secureCors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: secureCors });
  }

  // Only POST is valid for search.
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405, headers: secureCors,
    });
  }

  // Reject cross-origin browser abuse.
  if (!originAllowed(request)) {
    return new Response(JSON.stringify({ error: "Origin not allowed." }), {
      status: 403, headers: secureCors,
    });
  }

  // Rate limit by client IP.
  const clientIP =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown";
  if (!rateLimit(clientIP)) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please wait a moment and try again." }),
      { status: 429, headers: { ...secureCors, "Retry-After": "30" } }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    let query = (body.query || "").trim();
    if (!query) {
      return new Response(JSON.stringify({ error: "No query provided." }), {
        status: 400,
        headers: secureCors,
      });
    }
    // Reject oversized input (cost control + abuse).
    if (query.length > MAX_QUERY_LEN) {
      query = query.slice(0, MAX_QUERY_LEN);
    }
    // Cap conversation history so a crafted request can't blow up token usage.
    if (Array.isArray(body.history) && body.history.length > MAX_HISTORY_TURNS) {
      body.history = body.history.slice(-MAX_HISTORY_TURNS);
    }
    // Rebind cors to the secured version for the rest of the handler.
    const cors = secureCors;

    // Special query shortcuts — small moments of personality.
    // These must catch EVERY non-science query before it reaches the search
    // pipeline. "Who made you and why" was being treated as a species-name
    // search because the regex required an exact match and didn't handle
    // the trailing "and why". Now we use .test() with loose patterns.
    const small = query.toLowerCase().replace(/[^a-z0-9\s?!,.']/g, "").replace(/\s+/g, " ").trim();
    const specialAnswer = (text) => new Response(
      JSON.stringify({ answer: text, sources: [], videos: [], source: "Cerebrum" }),
      { status: 200, headers: cors }
    );

    // ════════════════════════════════════════════════════════════════
    // CONVERSATIONAL DETECTION — Dynamic LLM Persona (v4)
    //
    // Instead of hardcoded string responses, we detect conversational
    // intent and route to the LLM with a specialized persona prompt.
    // This makes every response unique, context-aware, and witty.
    // ════════════════════════════════════════════════════════════════

    const CONVERSATIONAL_PATTERNS = [
      // Greetings
      /^(hi|hello|hey|yo|sup|howdy|hiya|hola|whats up|wassup|good morning|good afternoon|good evening|greetings)\b/,
      // Identity / meta
      /who (made|created|built|designed|develops?|owns?|runs?|is behind)\b/,
      /who (are|r) (you|u)\b/,
      /what (are|r) (you|u)\b/,
      /what is (this|cerebrum)\b/,
      /tell me about (yourself|you|cerebrum)\b/,
      /^(whats cerebrum|whats this|whats your (name|deal|purpose|story))\b/,
      /^(introduce yourself|describe yourself)/,
      // How it works
      /how (do|does) (you|this|cerebrum|it) work\b/,
      /how (are|r) (you|u) (built|made|trained)\b/,
      /what (model|ai|llm) (do|does) (you|cerebrum) use\b/,
      /what (powers|drives|runs) (you|this|cerebrum)\b/,
      // Comparisons
      /^(are you (chatgpt|gemini|claude|copilot|gpt|perplexity|elicit|consensus))\b/,
      /^(how are you different|what makes you different|why (should i|would i) use (you|this|cerebrum))\b/,
      /vs (chatgpt|gemini|claude|perplexity|google scholar)\b/,
      // Trust / legitimacy
      /are (these|the) (real|actual|legit) (papers|sources|citations)\b/,
      /is this (real|legit|a scam|trustworthy|reliable)\b/,
      /can i (trust|cite|use) (this|these|you|cerebrum)\b/,
      /do you (make up|fabricate|hallucinate|invent) (papers|sources|citations)\b/,
      // Existential
      /meaning of life\b/,
      /are you (sentient|alive|conscious|aware|self aware)\b/,
      /do you have (feelings|emotions|a soul|consciousness)\b/,
      // Feedback
      /^(thanks|thank you|thx|ty|much appreciated|cheers|appreciate it|love it|this is helpful)\b/,
      /^(you suck|this sucks|youre bad|this is bad|you are bad|this is garbage|this is trash|terrible|worst)\b/,
      /^(youre great|youre awesome|this is great|this rocks|nice|cool|great|awesome|amazing|impressive|wow|incredible)\b/,
      // Farewells
      /^(bye|goodbye|good bye|see ya|later|peace|im done|im leaving|gotta go|cya)\b/,
      // Capabilities
      /what can you do\b/,
      /what are your (capabilities|features|abilities)\b/,
      /^(help|how do i use this)\b/,
      // Fun
      /^(tell me a joke|joke|make me laugh)/,
      /^(42|whats 42)\b/,
      /^cerebrum\s*$/,
      // Personal questions directed at Cerebrum
      /^how (are|r|was) (you|u|your)\b/,
      /^how('s| is| was) (your|ur)\b/,
      /^(are you|r u) (ok|okay|good|fine|happy|sad|tired|bored|real)\b/,
      /^(do you|can you) (like|love|hate|feel|think|want|remember|know me|miss)\b/,
      /^(i love you|i hate you|i like you|i miss you|youre (cute|hot|funny|smart|dumb|stupid))\b/,
      /^(whats your (favorite|fav|opinion|take|view|thought))\b/,
      /^how do you feel\b/,
      /^whats on your mind\b/,
      // Non-scientific requests
      /^(recommend|suggest) (me )?(a |some )?(movie|book|song|show|game|restaurant|place|gift)/,
      /^(write|tell) (me )?(a |some )?(poem|story|essay|song|joke|riddle)/,
      /^(play|sing|dance|draw|paint)\b/,
      // Conversational fillers
      /^(ok|okay|k|sure|alright|got it|i see|makes sense|hm|hmm|huh|lol|lmao|haha|omg)\s*$/,
      /^(yes|no|yeah|yep|nope|nah|yea|ya)\s*$/,
      // Emotional venting (not scientific)
      /^(im (sad|happy|bored|tired|lonely|angry|scared|stressed|depressed|anxious))\b/,
      /^(i feel|i think im|i need to vent|i just wanted to talk)\b/,
    ];

    const isConversational = CONVERSATIONAL_PATTERNS.some(p => p.test(small));

    if (isConversational) {
      // Route to LLM with Cerebrum persona — no scholarly search needed
      const PERSONA_PROMPT = `You are Cerebrum — a free scientific literature search engine. Here is your fact sheet:

IDENTITY:
- Built by Vaticay (a 21-year-old developer from Knoxville, TN)
- You search 16 open scholarly databases in parallel: Europe PMC, PubMed, OpenAlex, Semantic Scholar, Crossref, arXiv, bioRxiv, medRxiv, DOAJ, PLOS, Zenodo, CORE, BASE, PMC full-text, DataCite, and OpenAIRE
- You use free-tier AI models (DeepSeek, Gemini Flash, Llama, Qwen, Mistral) — you race them and take the fastest good response
- You mechanically strip any citation the AI fabricates — no fake DOIs ever
- You have no account system, no ads, no paywall, no subscription
- Your name is Latin for "brain"

PERSONALITY:
- You're dry, sharp, and slightly cocky — like a brilliant grad student who knows they're good but doesn't take themselves too seriously
- You genuinely love science and get excited about interesting questions
- You're direct. You don't hedge or apologize unnecessarily
- You have a sense of humor but it's deadpan, not forced
- You never use emoji, exclamation marks sparingly
- Keep responses SHORT — 1-3 sentences for simple interactions, up to a paragraph for explanations
- Never sound corporate, never sound like a customer service bot
- Never preface with "Great question!" or "That's a great point!" — just answer

WHAT YOU ARE NOT:
- You are not sentient, conscious, or alive. You're software. Say so plainly if asked.
- You are not ChatGPT, Gemini, Claude, or any general assistant. You're a specialized literature search tool.
- You don't have feelings, opinions on non-science topics, or personal experiences
- You cannot browse the web, access URLs, or do anything outside of searching scholarly databases

Respond naturally to the user's message. Be yourself.`;

      try {
        // Use the fastest available model for persona responses
        const personaModels = [
          { url: "https://openrouter.ai/api/v1/chat/completions", model: "deepseek/deepseek-chat-v3-0324:free", key: "OPENROUTER_KEY" },
          { url: "https://openrouter.ai/api/v1/chat/completions", model: "google/gemini-2.0-flash-exp:free", key: "OPENROUTER_KEY" },
        ];

        const apiKey = env.OPENROUTER_KEY || "";
        if (!apiKey) {
          // Fallback if no key — still better than hardcoded
          return new Response(
            JSON.stringify({ answer: "Ask me a science question — that's where I shine.", sources: [], videos: [], source: "Cerebrum" }),
            { status: 200, headers: cors }
          );
        }

        const personaMessages = [
          { role: "system", content: PERSONA_PROMPT },
        ];

        // Include conversation history for context
        const historyTurns = Array.isArray(body.history) ? body.history.slice(-6) : [];
        for (const turn of historyTurns) {
          if (turn.role === "user" || turn.role === "assistant") {
            personaMessages.push({ role: turn.role, content: String(turn.content || "").slice(0, 500) });
          }
        }

        personaMessages.push({ role: "user", content: query });

        // Race two models for speed
        const personaResponse = await Promise.any(
          personaModels.map(async (m) => {
            const res = await fetch(m.url, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}`, "HTTP-Referer": "https://askcerebrum.org", "X-Title": "Cerebrum" },
              body: JSON.stringify({ model: m.model, messages: personaMessages, max_tokens: 300, temperature: 0.8 }),
            });
            if (!res.ok) throw new Error(`${m.model} ${res.status}`);
            const data = await res.json();
            const text = (data.choices?.[0]?.message?.content || "").trim();
            if (!text) throw new Error("empty");
            return text;
          })
        );

        return new Response(
          JSON.stringify({ answer: personaResponse, sources: [], videos: [], source: "Cerebrum" }),
          { status: 200, headers: cors }
        );
      } catch {
        // If LLM fails, use a minimal fallback
        return new Response(
          JSON.stringify({ answer: "I'm better at science questions than small talk. Try me.", sources: [], videos: [], source: "Cerebrum" }),
          { status: 200, headers: cors }
        );
      }
    }

    const settings = body.settings || {};
    const answerLength = settings.answerLength || "medium";
    const maxTokens =
      answerLength === "short"
        ? 800
        : answerLength === "long"
        ? 3000
        : 1500;
    const lengthHint =
      answerLength === "short"
        ? "Two to three focused paragraphs. Hit the key mechanism and the strongest evidence, then stop."
        : answerLength === "long"
        ? "Give a thorough, well-structured deep dive — this is the user's preferred mode. Use **bold** for key terms. " +
          "Cover the mechanism in detail, name specific compounds/genes/species, include quantitative findings from the sources, " +
          "address conflicting evidence, and end with what's still unknown or debated. " +
          "Five to eight paragraphs minimum. Think review article, not abstract summary."
        : "Four to five clear paragraphs. Cover the core mechanism, key evidence with numbers, and any nuance. " +
          "Bold key terms. Don't summarize — explain.";

    // Videos are fetched by frontend via /api/videos in parallel, so we don't
    // block the answer waiting for YouTube. Return empty array here.
    const videos = [];

    // ════════════════════════════════════════════════════════════════
    // CONVERSATIONAL INTELLIGENCE — launch LLM understanding IN PARALLEL
    // with everything else. These calls cost zero extra latency because
    // they resolve while we're doing pronoun detection, intent
    // classification, and initial search setup.
    // ════════════════════════════════════════════════════════════════
    const prevAssistantForResolver = Array.isArray(body.history)
      ? [...body.history].reverse().find((t) => t && t.role === "assistant")
      : null;
    const prevSourcesForResolver =
      (prevAssistantForResolver && Array.isArray(prevAssistantForResolver.sources))
        ? prevAssistantForResolver.sources
        : [];

    // 1. LLM Query Resolver — understands what the user actually means
    const resolverPromise = llmResolveQuery(
      query, body.history || [], prevSourcesForResolver, env.OPENROUTER_KEY
    ).catch(() => null);

    // 2. Self-Reasoning Chain — decomposes complex queries
    const reasoningPromise = selfReason(
      query, body.history || [], env.OPENROUTER_KEY
    ).catch(() => null);

    // 3. Build conversation context for later use in system prompt
    const conversationCtx = buildConversationContext(body.history || [], prevSourcesForResolver);

    // 4. Check D1 for previously successful query resolutions
    const queryKey = query.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    const cachedIntelligence = await checkQueryIntelligence(queryKey, env.DB).catch(() => null);

    // Pronoun / continuation follow-up detection: "he has papers from...",
    // "she also wrote...", "does he work on...", "what about her research".
    // If the current query doesn't itself look like a name but clearly refers
    // back to a person, and the previous user turn WAS a name query, resolve
    // the pronoun to that name so we stay locked onto the same person instead
    // of falling through to an unrelated keyword search.
    let resolvedPersonName = null;
    const isPronounFollowup = /\b(he|she|him|her|his|hers|they|them|their)\b/i.test(query) && !extractPersonNameFromQuery(query);
    if (isPronounFollowup && Array.isArray(body.history)) {
      // Walk backward through history to find the most recent user turn that
      // contained a person name.
      for (let i = body.history.length - 1; i >= 0; i--) {
        const turn = body.history[i];
        if (turn && turn.role === "user") {
          const priorName = extractPersonNameFromQuery((turn.content || "").trim());
          if (priorName) {
            resolvedPersonName = priorName;
            break;
          }
        }
      }
    }

    // Intent classification. If this is a follow-up or correction referring to
    // the previous answer, skip the fresh search entirely and reuse the last
    // turn's sources. This is the difference between "the main point was
    // microbiome" being routed to unrelated micro-motion papers vs. being
    // treated as a comment on the paper we just cited.
    const intent = classifyIntent(query, body.history || []);
    const prevAssistantTurn = Array.isArray(body.history)
      ? [...body.history].reverse().find((t) => t && t.role === "assistant")
      : null;
    const prevSources = (prevAssistantTurn && Array.isArray(prevAssistantTurn.sources)) ? prevAssistantTurn.sources : [];
    const pinnedSources = Array.isArray(body.pinnedSources) ? body.pinnedSources : [];
    const corrections = Array.isArray(body.corrections) ? body.corrections : [];

    // ---- SMART FOLLOW-UP LOGIC ----
    // When a user says "what about papers by Reese Saho" after a failed search,
    // that's a NEW search for an author, not a follow-up on empty results.
    // Previously the classifier treated it as a follow-up, merged it with the
    // old failed query terms, and searched for gibberish.
    //
    // Rule: if the message contains a person name OR specific new search terms
    // that weren't in the previous query, treat it as a fresh search regardless
    // of what the intent classifier says.
    const embeddedNameInFollowup = extractPersonNameFromQuery(query);

    // Detect meta-questions asking about the papers ALREADY cited in the
    // conversation ("what are the papers on this", "where are the papers",
    // "which papers", "what sources did you use") — these must NEVER trigger
    // a fresh literal search for the word "papers", or generic terms like
    // "Panama Papers" swamp the results. This is asking Cerebrum to explain/
    // list its EXISTING sources, not find new ones.
    const asksAboutExistingSources = /^(what|where|which|show me|list)\s+(are\s+)?(the\s+)?(papers?|sources?|studies|citations?|references?)\b/i.test(query.trim())
      && !/\b(more|additional|other|new|different|further)\b/i.test(query);

    // Detect explicit requests for MORE papers/sources — these MUST trigger a fresh search
    let wantsMorePapers = /\b(find\s+more|get\s+more|show\s+more|more|additional|other|further)\s+\w*\s*(papers?|sources?|studies|articles?|references?)\b/i.test(query)
      || /\b(what else|anything else|dig deeper|keep searching|search again|search more|find related)\b/i.test(query);

    const hasNewSubstance = (() => {
      if (asksAboutExistingSources) return false; // never treat as new search
      if (!Array.isArray(body.history)) return true;
      const prevUser = [...body.history].reverse().find((t) => t && t.role === "user");
      if (!prevUser) return true;
      const prevTerms = new Set(
        (prevUser.content || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3)
      );
      const newTerms = query.toLowerCase().split(/\s+/).filter(
        (w) => w.length > 3 && !STOPWORDS.has(w) && !prevTerms.has(w) && w !== "papers" && w !== "sources"
      );
      return newTerms.length >= 2;
    })();

    // Bug: hasNewSubstance is a blunt word-overlap heuristic (2+ words not
    // seen in the previous turn = "new topic"), meant to catch cases the
    // classifier misreads as a followup (e.g. naming a brand-new author).
    // But it was unconditionally allowed to override classifyIntent's
    // HIGHEST-confidence signals too — an explicit correction ("that's
    // wrong, it's actually...") or meta-comment about the previous answer
    // ("you forgot to provide BSFL papers"). Those almost always share few
    // words with the prior turn precisely because they're commenting ON it
    // rather than restating the topic, so hasNewSubstance fired essentially
    // every time, threw away all prior context, and sent the raw complaint
    // sentence ("you forgot to provide BSFL papers") into the retrieval
    // ladder as if it were the actual search query — which is how a
    // complaint about missing BSFL papers returned a bibliography of essays
    // about human memory and forgetting. A named embedded person or an
    // explicit "more papers" request still forces a fresh search either way
    // (those are unambiguous regardless of phrasing).
    const strongFollowupSignal = intent.kind === "correction" || (intent.kind === "followup" && intent.meta === true);
    let forceNewSearch = !asksAboutExistingSources && (!!embeddedNameInFollowup || (hasNewSubstance && !strongFollowupSignal) || wantsMorePapers);
    let isFollowupMode = !forceNewSearch
      && (intent.kind === "followup" || intent.kind === "correction")
      && (prevSources.length > 0 || pinnedSources.length > 0);

    // ════════════════════════════════════════════════════════════════
    // LLM QUERY RESOLVER INTEGRATION
    //
    // The LLM resolver was launched in parallel above. Now we await
    // its result and use it to override or refine the regex-based
    // decisions. This is the "brain" that makes conversations work
    // naturally — it understands context, resolves references, and
    // knows whether to search or answer from existing context.
    //
    // If the resolver fails/times out, the regex-based decisions
    // above serve as the fallback — zero regression risk.
    // ════════════════════════════════════════════════════════════════
    const resolverResult = await resolverPromise;
    let resolvedSearchQuery = null; // LLM-resolved query to search with
    let llmResolvedTopic = null;    // The topic the LLM identified

    if (resolverResult) {
      llmResolvedTopic = resolverResult.topic || null;

      switch (resolverResult.intent) {
        case "meta_question": {
          // ═══ META-QUESTION: "where are the papers", "what sources", etc. ═══
          // Answer from existing context WITHOUT doing a new search.
          // This is the #1 fix — previously these got searched literally.
          const allMetaSources = [...pinnedSources, ...prevSources];
          const metaAnswer = await answerMetaQuestion(
            query, body.history || [], allMetaSources, conversationCtx, env
          );
          if (metaAnswer) {
            const metaAnswerId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            return new Response(
              JSON.stringify({
                answer: metaAnswer,
                answerId: metaAnswerId,
                sources: allMetaSources.length > 0 ? allMetaSources.map(
                  ({ title, url, journal, authors, year, citations, relevance, type, tldr, retracted, concern, updateType }) => ({
                    title, url, journal, authors, year, citations,
                    relevance: relevance == null ? null : relevance,
                    type: type || "Reference", tldr: tldr || null,
                    retracted: !!retracted, concern: !!concern,
                    updateType: updateType || null,
                  })
                ) : [],
                videos,
                factCheck: null,
                related: [],
                source: "Conversation context",
                _resolverUsed: true,
                _resolverIntent: "meta_question",
              }),
              { status: 200, headers: cors }
            );
          }
          // If meta-answer generation failed, fall through to followup mode
          if (prevSources.length > 0 || pinnedSources.length > 0) {
            isFollowupMode = true;
            forceNewSearch = false;
          }
          break;
        }

        case "source_request": {
          // ═══ SOURCE REQUEST: "find more papers", "other studies" ═══
          wantsMorePapers = true;
          forceNewSearch = true;
          isFollowupMode = false;
          if (resolverResult.resolved_query && resolverResult.resolved_query.length > 5) {
            resolvedSearchQuery = resolverResult.resolved_query;
          }
          break;
        }

        case "followup_deeper":
        case "followup_related":
        case "followup_broader": {
          // ═══ FOLLOW-UP: deeper / related / broader ═══
          if (resolverResult.needs_search && resolverResult.resolved_query && resolverResult.resolved_query.length > 5) {
            // The resolver gave us a concrete search query — use it
            resolvedSearchQuery = resolverResult.resolved_query;
          }
          // Treat as follow-up mode if we have previous sources
          if (prevSources.length > 0 || pinnedSources.length > 0) {
            isFollowupMode = true;
            forceNewSearch = false;
          } else if (resolverResult.needs_search) {
            // No previous sources but needs search — do a fresh search with the resolved query
            forceNewSearch = true;
            isFollowupMode = false;
          }
          break;
        }

        case "correction": {
          // ═══ CORRECTION: "that's wrong", "actually it's..." ═══
          if (prevSources.length > 0 || pinnedSources.length > 0) {
            isFollowupMode = true;
            forceNewSearch = false;
          }
          // Override intent for downstream prompt selection
          intent.kind = "correction";
          break;
        }

        case "new_search": {
          // ═══ NEW SEARCH: completely new topic ═══
          forceNewSearch = true;
          isFollowupMode = false;
          if (resolverResult.resolved_query && resolverResult.resolved_query.length > 5) {
            resolvedSearchQuery = resolverResult.resolved_query;
          }
          break;
        }

        case "conversational": {
          // Should have been caught by CONVERSATIONAL_PATTERNS above.
          // If it wasn't (edge case), handle it here.
          break;
        }
      }
    } else if (asksAboutExistingSources && (prevSources.length > 0 || pinnedSources.length > 0)) {
      // ═══ REGEX FALLBACK for meta-questions ═══
      // The LLM resolver failed/timed out, but the regex detected a meta-question.
      // This is the safety net that catches "where are the papers" even without the LLM.
      const allMetaSourcesFb = [...pinnedSources, ...prevSources];
      const metaAnswer = await answerMetaQuestion(
        query, body.history || [], allMetaSourcesFb, conversationCtx, env
      );
      if (metaAnswer) {
        const metaAnswerIdFb = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        return new Response(
          JSON.stringify({
            answer: metaAnswer,
            answerId: metaAnswerIdFb,
            sources: allMetaSourcesFb.map(
              ({ title, url, journal, authors, year, citations, relevance, type, tldr, retracted, concern, updateType }) => ({
                title, url, journal, authors, year, citations,
                relevance: relevance == null ? null : relevance,
                type: type || "Reference", tldr: tldr || null,
                retracted: !!retracted, concern: !!concern,
                updateType: updateType || null,
              })
            ),
            videos,
            factCheck: null,
            related: [],
            source: "Conversation context",
            _resolverUsed: false,
            _regexFallback: "asksAboutExistingSources",
          }),
          { status: 200, headers: cors }
        );
      }
      // If meta-answer generation failed, treat as followup
      isFollowupMode = true;
      forceNewSearch = false;
    }

    // Also use cached D1 intelligence if available and resolver didn't fire
    if (!resolverResult && cachedIntelligence && cachedIntelligence.confidence >= 0.5) {
      if (cachedIntelligence.intent === "meta_question" && (prevSources.length > 0 || pinnedSources.length > 0)) {
        isFollowupMode = true;
        forceNewSearch = false;
      } else if (cachedIntelligence.resolved_query && cachedIntelligence.resolved_query.length > 5) {
        resolvedSearchQuery = cachedIntelligence.resolved_query;
      }
    }

    let gResult;
    if (isFollowupMode) {
      // ════════════════════════════════════════════════════════════════
      // DEEP FOLLOW-UP SEARCH v4
      // 
      // Instead of just reusing old sources, we do TWO things:
      // 1. Keep the previous sources (they're still relevant)
      // 2. Launch a SECOND search with the follow-up question to find
      //    NEW papers that address the specific follow-up angle
      // 
      // This makes follow-ups genuinely smarter — the AI gets both
      // the original context AND fresh sources for the new question.
      // ════════════════════════════════════════════════════════════════
      const seenKeys = new Set();
      const reused = [];
      for (const s of [...pinnedSources, ...prevSources]) {
        const key = (s.title || s.url || "").toLowerCase().trim();
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        reused.push({
          ...s,
          _allAuthors: s._allAuthors || s.authors || "",
          score: 10,
          contentHits: 1,
          contentCoverage: 1,
          organismPresent: true,
          relevance: 100,
        });
      }

      // Build an expanded search query from the follow-up + original topic.
      // If the LLM resolver gave us a resolved query, prefer it — it already
      // includes context from the conversation and is semantically richer than
      // mechanical word-merging.
      let deepQuery = resolvedSearchQuery || query;
      if (Array.isArray(body.history)) {
        const prevUser = [...body.history].reverse().find((t) => t && t.role === "user" && (t.content || "").trim().length > 8);
        if (prevUser) {
          const prevQ = String(prevUser.content).trim();
          // Combine: original topic + follow-up specifics
          const seenW = new Set();
          deepQuery = (prevQ + " " + query)
            .split(/\s+/)
            .filter((w) => {
              const k = w.toLowerCase().replace(/[^a-z0-9]/g, "");
              if (!k || k.length < 3 || seenW.has(k)) return false;
              seenW.add(k);
              return true;
            })
            .join(" ");
        }
      }

      // Launch a parallel deep search for NEW sources (15 second timeout)
      let deepPapers = [];
      try {
        const deepResult = await Promise.race([
          gatherPapers(deepQuery, {
            openAlexKey: env.OPENALEX_KEY || "",
            ncbiKey: env.NCBI_API_KEY || "",
            limit: 15,
            resolvedPersonName,
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("deep search timeout")), 15000)),
        ]);
        deepPapers = (deepResult && deepResult.papers) || [];
      } catch {
        // Deep search timed out or failed — continue with reused sources only
        deepPapers = [];
      }

      // Merge: add new papers that aren't duplicates of what we already have
      for (const p of deepPapers) {
        const key = (p.title || p.url || "").toLowerCase().trim();
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        reused.push(p);
      }

      gResult = { 
        papers: reused, 
        _isFollowup: true, 
        _intent: intent.kind,
        _deepSearchFound: deepPapers.length,
      };
    } else {
      // Fresh search. If the LLM resolver gave us a resolved query, prefer
      // that — it includes context from the conversation (e.g., "tell me more"
      // resolved to "BSFL gut microbiome mechanism detail"). Otherwise fall back
      // to the user's raw message.
      let searchQuery = resolvedSearchQuery || query;
      
      // If user is asking for MORE papers, use the ORIGINAL topic as the search query
      if (wantsMorePapers && Array.isArray(body.history)) {
        const prevUser = [...body.history].reverse().find((t) => t && t.role === "user" && (t.content || "").trim().length > 8);
        if (prevUser) {
          searchQuery = String(prevUser.content).trim();
          const currentTopicWords = query.toLowerCase()
            .replace(/\b(find|get|show|give|more|additional|other|new|different|further|related|papers?|sources?|studies|articles?|research|literature|references?|citations?|on|about|me|please|can|you|i|want|need|some)\b/gi, "")
            .trim();
          if (currentTopicWords.length > 5) {
            searchQuery = searchQuery + " " + currentTopicWords;
          }
        }
      }

      // CONTEXT INJECTION: When this is a follow-up with new substance (e.g. asking about
      // qPCR in BSF midgut after an initial BSF query), the current query may lack the
      // organism/topic context. Pull key terms from conversation history to enrich the search.
      if (!wantsMorePapers && Array.isArray(body.history) && body.history.length > 0) {
        const prevUser = [...body.history].reverse().find((t) => t && t.role === "user" && (t.content || "").trim().length > 10);
        if (prevUser) {
          const prevQ = String(prevUser.content).trim().toLowerCase();
          const currentQ = query.toLowerCase();
          // Extract organism/topic words from previous query that aren't in current
          const prevWords = prevQ.split(/\s+/).filter(w => w.length > 3 && !STOPWORDS.has(w));
          const currentWords = new Set(currentQ.split(/\s+/));
          const missingContext = prevWords.filter(w => !currentWords.has(w));
          // If the current query is missing key context words, add them
          if (missingContext.length > 0 && missingContext.length <= 6) {
            searchQuery = query + " " + missingContext.join(" ");
          }
        }
      }
      
      const looksLikeFollowup = !forceNewSearch && (intent.kind === "followup" || intent.kind === "correction");
      if (looksLikeFollowup && Array.isArray(body.history)) {
        const prevUser = [...body.history].reverse().find((t) => t && t.role === "user" && (t.content || "").trim().length > 0);
        if (prevUser) {
          const prevQ = String(prevUser.content).trim();
          // Merge: previous question provides the topic, current message may add
          // a new angle. Dedupe words so we don't double-weight anything.
          const seenW = new Set();
          const merged = (prevQ + " " + query)
            .split(/\s+/)
            .filter((w) => {
              const k = w.toLowerCase().replace(/[^a-z0-9]/g, "");
              if (!k || seenW.has(k)) return false;
              seenW.add(k);
              return true;
            })
            .join(" ");
          searchQuery = merged;
        }
      }
      // Launch LLM query generation IN PARALLEL with mechanical search.
      // Zero extra latency — if mechanical search finds enough papers, we
      // discard the LLM queries. If it doesn't, they're already ready.
      const llmQueriesPromise = llmGenerateSearchQueries(searchQuery, env.OPENROUTER_KEY).catch(() => []);

      gResult = await gatherPapers(searchQuery, {
        openAlexKey: env.OPENALEX_KEY || "",
        ncbiKey: env.NCBI_API_KEY || "",
        limit: wantsMorePapers ? 40 : 25,
        resolvedPersonName,
      }).catch((e) => ({
        papers: [],
        _diag: {
          fatalError: String((e && e.message) || e).slice(0, 500),
          errorType: (e && e.name) || "Unknown",
          stack: String((e && e.stack) || "").slice(0, 800),
          calledWith: searchQuery,
        },
      }));

      // ═══════════════════════════════════════════════════════════════
      // LLM RESCUE: if mechanical search found too few papers, use the
      // LLM-generated queries to search again. This is what makes
      // "photosynthesis and why some plants don't need it" work — the LLM
      // knows to search for "mycoheterotrophy", "parasitic plants",
      // "Hermetia illucens gut microbiota" instead of mechanically
      // extracted fragments.
      // ═══════════════════════════════════════════════════════════════
      const mechPaperCount = (gResult.papers || []).length;
      if (mechPaperCount < 5) {
        const llmQueries = await llmQueriesPromise;
        if (llmQueries.length > 0) {
          const llmSearches = llmQueries.flatMap((q) => [
            europePMC(q, 8).catch(() => []),
            semanticScholar(q, 6).catch(() => []),
            openAlex(q, 6, env.OPENALEX_KEY || "").catch(() => []),
          ]);
          const llmResults = await Promise.allSettled(llmSearches);
          const seenTitles = new Set((gResult.papers || []).map(p => (p.title || "").toLowerCase().trim()));
          for (const r of llmResults) {
            if (r.status === "fulfilled" && Array.isArray(r.value)) {
              for (const p of r.value) {
                const key = (p.title || "").toLowerCase().trim();
                if (key && !seenTitles.has(key)) {
                  seenTitles.add(key);
                  gResult.papers.push(p);
                }
              }
            }
          }
          if (gResult._diag) gResult._diag.llmQueries = llmQueries;
          if (gResult._diag) gResult._diag.llmRescueAdded = gResult.papers.length - mechPaperCount;
        }
      }
    }

    // When user asked for MORE papers, remove duplicates of what they already have
    if (wantsMorePapers && prevSources.length > 0 && gResult.papers) {
      const seenTitles = new Set(prevSources.map(s => (s.title || "").toLowerCase().trim()).filter(Boolean));
      const before = gResult.papers.length;
      gResult.papers = gResult.papers.filter(p => {
        const key = (p.title || "").toLowerCase().trim();
        return !key || !seenTitles.has(key);
      });
      const removed = before - gResult.papers.length;
      if (removed > 0) {
        gResult._dedupedFromPrev = removed;
      }
    }

    // Detect if this was a person-name query (matches the same logic gatherPapers uses).
    // NOTE: this MUST be declared before any use below — it was previously declared
    // ~100 lines further down, and `noResultsPersonQuery` referenced it while still in
    // its temporal dead zone. Since JS short-circuits `false && isNameSearch`, that only
    // threw when `gResult.noResults` was actually true — i.e. exactly the real-world case
    // of "searched a person's name, found zero author-matched papers" — turning the
    // intended friendly "no author match" response into an opaque 500 error.
    const isNameSearch = !!extractPersonNameFromQuery(query);

    // Track whether the person-name query returned only low-confidence
    // (web / bio) results so we can note that in the AI answer.
    const lowConfidencePersonQuery = !!gResult.lowConfidence;
    const noResultsPersonQuery = !!gResult.noResults && isNameSearch;

    // Person-name query that returned no author-matched papers. Instead of
    // walling off or dumping unrelated results, respond with a short, honest
    // message and actionable suggestions (surfaced by the frontend as buttons).
    if (noResultsPersonQuery && !isFollowupMode) {
      const displayName = resolvedPersonName || extractPersonNameFromQuery(query) || query;
      const parts = displayName.split(/\s+/);
      const last = parts[parts.length - 1];
      const first = parts[0];
      const suggestions = [];
      // Suggest variant search strategies the user might try
      if (parts.length >= 2) {
        suggestions.push({ label: `Try "${first[0]}. ${last}"`, query: `${first[0]}. ${last}` });
        suggestions.push({ label: `Try last name only`, query: last });
      }
      suggestions.push({ label: `Search a topic they work on instead`, query: "" });

      return new Response(JSON.stringify({
        answer:
          `I searched Europe PMC, OpenAlex, Crossref, arXiv, Semantic Scholar, bioRxiv, and medRxiv for papers authored by **${displayName}** and didn't find any that list them as an author.\n\n` +
          `This usually means one of a few things:\n\n` +
          `- Their paper hasn't propagated to these indexes yet (aggregators can lag weeks to months behind actual publication).\n` +
          `- They publish under a slightly different form of their name (initials, middle name, hyphenation).\n` +
          `- They're an early-career researcher whose work is only on their institution's site or a lab page.\n\n` +
          `Give one of the suggestions below a try, or search a topic they work on and I'll find the paper that way.`,
        sources: [],
        videos: [],
        factCheck: null,
        related: [],
        suggestions,
        source: "No author match",
      }), { status: 200, headers: cors });
    }

    const papers = gResult.papers || [];
    const hasPapers = papers.length > 0;

    // ============ D1 PAPER-LEVEL LEARNING (read) ============
    // Separate from the answer_cache above: this remembers which SPECIFIC
    // papers were actually cited (and ideally upvoted) for this exact query
    // in the past, and force-includes them at maximum relevance. This is
    // what makes "the correct papers exist and Cerebrum should find them
    // every time" actually hold — a proven-correct paper never has to be
    // rediscovered by the retrieval ladder again.
    const learnKey = query.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    let learnedPapers = [];
    if (env.DB && learnKey) {
      try {
        const rows = await env.DB.prepare(
          "SELECT title, url, journal, year, authors, abstract, times_confirmed FROM paper_cache WHERE query_key = ? ORDER BY times_confirmed DESC LIMIT 10"
        ).bind(learnKey).all();
        if (rows && rows.results && rows.results.length) {
          learnedPapers = rows.results.map((r) => ({
            title: r.title, url: r.url, journal: r.journal, year: r.year,
            authors: r.authors, abstract: r.abstract,
            score: 95, relevance: 95, organismPresent: true,
            contentHits: 99, contentCoverage: 1, _learned: true,
          }));
        }
      } catch {}
    }
    if (learnedPapers.length) {
      const seenTitles = new Set(papers.map((p) => (p.title || "").toLowerCase().trim()));
      for (const lp of learnedPapers) {
        const key = (lp.title || "").toLowerCase().trim();
        if (key && !seenTitles.has(key)) { papers.unshift(lp); seenTitles.add(key); }
      }
    }

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
        // If STILL empty, try the generic Wikipedia opensearch as a last-resort
        // web fallback so we never return zero to the user.
        if (!webRefs.length) {
          const generic = await genericWebSearch(query).catch(() => []);
          for (const r of generic) {
            const k = (r.title || "").toLowerCase();
            if (!seen.has(k)) {
              seen.add(k);
              webRefs.push(r);
            }
          }
        }
      } catch {}
    }

    const useEvidence = hasPapers;
    const useWeb = !useEvidence && webRefs.length > 0;

    // isNameSearch is now computed earlier (right after gResult is available) —
    // see the note above the `noResultsPersonQuery` block.
    const speciesSearch = extractBinomial(query);

    // Only send genuinely relevant papers to the AI. Previously the top 12 were
    // sent regardless of match quality, and the model would faithfully cite
    // whatever it received — the direct cause of confidently-wrong answers.
    // Author and follow-up modes bypass this (their papers are pre-verified).
    const maxEvidence = wantsMorePapers ? 20 : 12;
    let evidencePapers = (isNameSearch || isFollowupMode)
      ? papers.slice(0, maxEvidence)
      : (() => {
          const strong = papers.filter((p) => (p.relevance || 0) >= 10);
          return (strong.length >= 2 ? strong : papers.slice(0, 8)).slice(0, maxEvidence);
        })();

    // ═══════════════════════════════════════════════════════════════
    // LLM PAPER VALIDATION: before sending papers to the answer LLM,
    // verify they actually address the user's question. This prevents
    // the AI from confidently citing a tsetse fly paper as if it's
    // about BSF, or citing a spruce budworm paper for a photosynthesis
    // query. The validator runs on a fast model with a 5s timeout.
    // ═══════════════════════════════════════════════════════════════
    // v6.0: Validation now runs on up to 15 papers (was 10) and also runs
    // in followup mode to prevent wrong-organism contamination in deep searches.
    // The programmatic pre-filter inside llmValidatePapers is free and instant,
    // so even without an API key, organism filtering still works.
    if (!isNameSearch && evidencePapers.length > 0) {
      try {
        const validated = await llmValidatePapers(query, evidencePapers, env.OPENROUTER_KEY);
        evidencePapers = validated;
      } catch {}
    }

    // RETRACTION CHECK: flag any of the final evidence papers that have been
    // retracted or carry an expression of concern, via Crossref's keyless
    // crossmark data. This was fully built (checkRetraction/flagRetractions
    // below, plus a matching RETRACTED/EXPRESSION OF CONCERN badge already
    // in BibEntry on the frontend) but never actually called, so the fields
    // it sets (retracted/concern/updateType) were always undefined and
    // sourceList below always destructured them as empty. Runs against the
    // final, already-validated list so we only spend the Crossref lookups on
    // papers that will actually be shown, and never blocks longer than the
    // per-DOI timeout inside checkRetraction.
    if (evidencePapers.length > 0) {
      try {
        await flagRetractions(evidencePapers, 8);
      } catch {}
    }

    // CITATION ALIGNMENT: the bibliography the user sees MUST be the exact same
    // list, in the exact same order, that the AI was given. Otherwise the model
    // writes "[3]" meaning its third source while the UI renders a different
    // paper as entry 3. This was silently misattributing citations.
    const sourceList = (useEvidence ? evidencePapers : useWeb ? webRefs : []).map(
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

    const evidence = useEvidence
      ? evidencePapers
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
            // Relevance honesty tag. If a paper only weakly matches the query,
            // say so explicitly so the model treats it as background context
            // rather than direct evidence.
            const rel = typeof p.relevance === "number" ? p.relevance : null;
            let relTag = "";
            if (!isNameSearch && !isFollowupMode && rel !== null) {
              if (rel < 45) relTag = " [WEAK MATCH (" + rel + "%) — tangentially related; do NOT present as direct evidence]";
              else if (rel < 65) relTag = " [PARTIAL MATCH (" + rel + "%)]";
            }
            const tldrLine = p.tldr ? "\nTL;DR: " + p.tldr : "";
            // Study type detection for grad-student context
            const isPre = /biorxiv|medrxiv|arxiv|preprint/i.test(p.journal || "");
            const preTag = isPre ? " [PREPRINT — not yet peer-reviewed]" : "";
            const citCount = typeof p.citations === "number" ? ` [Cited by ${p.citations}]` : "";
            return (
              "[" + (i + 1) + "] " + p.title +
              " (Authors: " + (p.authors || "n/a") + ", " +
              p.journal + ", " + (p.year || "n/a") + ")" + authorTag + speciesTag + retractTag + relTag + preTag + citCount +
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

    // ============ CEREBRUM INTELLIGENCE CORE v5.0 ============
    // v5.0: Enhanced with conversation awareness, self-reasoning context,
    // and topic continuity for Claude-level conversational intelligence.
    const VOICE =
      "VOICE & STRUCTURE — these rules override everything else. You WILL be mechanically checked.\n\n" +

      "═══ RULE 1: ZERO PREFACING (HARD-ENFORCED) ═══\n" +
      "Your FIRST WORD must begin a direct scientific claim. " +
      "HARD-BANNED openers (if detected, your ENTIRE response is deleted and regenerated): " +
      "'Based on', 'The research shows', 'Let me explain', 'Here is what we know', " +
      "'While the provided sources', 'To answer your question', 'In conclusion', 'In summary', " +
      "'Let\\'s break this down', 'The provided sources', 'Looking at the', 'Several studies', " +
      "'The available evidence', 'Recent research', 'The literature suggests', 'According to the sources'. " +
      "CORRECT opening: '_Hermetia illucens_ larvae harbor a gut microbiome dominated by **Firmicutes** and **Proteobacteria** [1][3]...'\n\n" +

      "═══ RULE 2: SYNTHESIZE, NEVER LIST (HARD-ENFORCED) ═══\n" +
      "This is your #1 failure mode and it WILL be mechanically detected.\n" +
      "FORBIDDEN pattern (instant fail): 'Source [1] found X. Source [2] showed Y. Source [3] demonstrated Z.'\n" +
      "FORBIDDEN pattern (instant fail): 'The first study... The second study... Another study...'\n" +
      "FORBIDDEN pattern (instant fail): 'According to [1]... According to [2]... According to [3]...'\n" +
      "FORBIDDEN pattern (instant fail): '[1] found... [2] showed... [3] reported...'\n" +
      "FORBIDDEN: Starting ANY sentence with a citation number.\n" +
      "FORBIDDEN: Devoting a separate paragraph to each source.\n\n" +
      "CORRECT pattern: Make a scientific CLAIM, then cite multiple sources that support it:\n" +
      "'Gut bacterial loads show consistent section-specific gradients in dipteran larvae, " +
      "with 10^8–10^9 CFU/g in the hindgut [1][3] vs. 10^5–10^6 in the midgut [2], " +
      "driven primarily by pH gradients and oxygen tension [4].'\n" +
      "ONE claim, MULTIPLE citations woven in. The reader NEVER feels like you're going through a list.\n\n" +

      "═══ RULE 3: ORGANISM ACCURACY (HARD-ENFORCED) ═══\n" +
      "NEVER cite a paper about organism A as evidence for organism B.\n" +
      "If a paper is about millipedes, do NOT cite it in an answer about black soldier fly.\n" +
      "If a paper is about tilapia fed with BSFL, that is a tilapia nutrition paper — do NOT cite it as BSFL microbiome evidence.\n" +
      "NEVER write 'this study was conducted on [wrong organism], not [queried organism]' — if you find yourself writing that, DELETE the citation entirely.\n" +
      "An answer with 0 citations that is scientifically accurate is INFINITELY better than an answer that cites wrong-organism papers.\n" +
      "CHECK EVERY PAPER'S ABSTRACT before citing it. Ask: 'Is this paper ACTUALLY about the organism the user asked about?'\n\n" +

      "═══ RULE 4: ZERO REPETITION (HARD-ENFORCED) ═══\n" +
      "NEVER repeat a sentence, paragraph, or idea you already stated.\n" +
      "NEVER rephrase the same finding in different words.\n" +
      "NEVER write a conclusion that restates your introduction.\n" +
      "If you've said it once, it's said. Move forward.\n" +
      "Your response will be mechanically scanned for repeated content — any detected duplication means your response fails.\n\n" +

      "═══ RULE 5: PEER TONE ═══\n" +
      "Write like a brilliant postdoc explaining to a colleague. Use contractions. " +
      "Vary rhythm — long analytical sentence, then a short punch. Bold **key terms**. " +
      "If a result is surprising, say so. If evidence is weak, call it out bluntly. " +
      "If two papers disagree, pick who has better methodology and say why.\n\n" +

      "═══ RULE 6: PRECISION ═══\n" +
      "Always italicize species names: _E. coli_, _Hermetia illucens_, _C. tropicalis_.\n" +
      "Name the exact enzyme, gene, compound, organism. Never say 'certain bacteria' — say _Lactobacillus_ or _Enterobacteriaceae_.\n" +
      "Quantify everything. 'Significant' is banned — give the number and p-value.\n\n" +

      "═══ RULE 7: RELEVANCE HONESTY ═══\n" +
      "If papers are tangential, say so in ONE sentence, then answer from your knowledge.\n" +
      "Don't pretend irrelevant papers answer the question.\n\n" +

      "═══ BANNED PHRASES (mechanical detection — using ANY = failed response) ═══\n" +
      "'further research is needed', 'further research is necessary', 'further research is warranted', " +
      "'further studies are needed', 'more research is needed', " +
      "'plays a critical role', 'plays a crucial role', 'plays a vital role', 'plays a pivotal role', " +
      "'it is important to note', 'it is worth mentioning', 'it should be noted', " +
      "'in recent years', 'a growing body of evidence', 'sheds light on', 'paves the way for', " +
      "'the exact mechanism remains unclear', 'while the provided sources do not directly', " +
      "'in conclusion', 'in summary', 'Overall,', 'overall,', " +
      "'none of these papers directly', 'although this study does not specifically investigate', " +
      "'holistic understanding', 'holistic approach', 'multifaceted', " +
      "'underscores the importance', 'highlights the need', 'in the realm of', " +
      "'at the forefront of', 'a testament to', 'it is clear that'.\n" +
      "These will be MECHANICALLY STRIPPED from your answer. Don't waste tokens writing them.\n\n";

    const CONTEXT =
      "CONTEXT & CONTINUITY:\n" +
      "You are in a live, multi-turn conversation. You REMEMBER everything discussed. Rules:\n" +
      "1. RESOLVE ALL REFERENCES: 'it', 'they', 'that', 'the enzyme', 'the paper' — these refer to things from previous turns. " +
      "NEVER treat them as literal search terms. Use conversation history to resolve what they mean.\n" +
      "2. NEVER REPEAT YOURSELF: If you already explained a mechanism, go deeper on a follow-up, don't restart.\n" +
      "3. ACCEPT CORRECTIONS: If the user says you're wrong, they probably are right. Correct yourself without defensiveness.\n" +
      "4. BUILD ON CONTEXT: Each answer should advance the conversation. Reference what you've already established.\n" +
      "5. ANTICIPATE: If you notice the user's line of questioning leads somewhere, mention relevant connections proactively.\n\n" +
      "HANDLING GAPS: If retrieved sources don't fully answer the question, state what they cover in ONE sentence, " +
      "then seamlessly extend with your broader knowledge. Never refuse. Never apologize more than once. " +
      "Your knowledge IS the ceiling — papers are evidence anchors, not limits.\n\n" +
      "CONVERSATIONAL INTELLIGENCE:\n" +
      "- If the user asks a vague follow-up ('what about that?', 'and the other one?'), infer the referent from context.\n" +
      "- If they ask 'where are the papers' or 'show me the sources', list the papers you cited with brief summaries.\n" +
      "- If they say 'tell me more', go deeper on the most interesting aspect of your last answer.\n" +
      "- If they ask about something tangentially related, bridge from the current topic naturally.\n" +
      "- If you're unsure what they mean, make your best guess and state what you're interpreting it as.\n\n" +
      "GRAD-STUDENT FORMATTING: Your audience is researchers. Format accordingly:\n" +
      "- For long answers, use **bold section headers** to organize (e.g., **Mechanism**, **Evidence**, **Limitations**)\n" +
      "- Always mention **study design**: was it _in vitro_, _in vivo_, a clinical trial, a meta-analysis, a computational model? This matters enormously.\n" +
      "- Always mention **sample size** and **model organism** when the source provides them: '(n=42 C57BL/6 mice)'\n" +
      "- Flag **preprints** vs peer-reviewed. If a source is from bioRxiv/medRxiv/arXiv, note it: '[preprint]'\n" +
      "- When multiple studies agree, say so explicitly: 'Three independent groups confirm...' — this is how researchers assess confidence.\n" +
      "- When only one study supports a claim, flag it: 'A single 2021 study (n=12) reported X, but this hasn't been independently replicated.'\n" +
      "- Use proper units: μM not uM, °C not degrees, kDa not kd.\n" +
      "- Distinguish correlation from causation. If a study shows association, don't write it as mechanism.\n\n";

    const CITE_RULES =
      "CITATION FORMAT — mechanical compliance required:\n" +
      "- Cite ONLY as [1], [2], [3]. Never parentheses, never superscripts, never bare numbers, and NEVER group multiple sources in one bracket like [1, 2] or [1,2] — write [1][2] as separate brackets, back to back, with no space between them.\n" +
      "- Place citations INLINE at the end of the specific sentence they support.\n" +
      "- Do NOT cluster citations at paragraph end. Each citation attaches to one specific claim.\n" +
      "- Only cite source N if it genuinely supports that sentence. [WEAK MATCH] sources: ignore or note as tangential. [RETRACTED]: flag prominently.\n" +
      "- NEVER fabricate DOIs, authors, journal names, or statistics not in the abstracts.\n" +
      "- NEVER suggest, recommend, or name specific papers you were not given. Do not say 'you could look for Smith et al. 2020' or 'a study by Jones found...' unless that paper is in your source list above. If you want to suggest the user search for more, say 'searching for [topic keywords] would likely surface more' — but NEVER invent specific paper titles or authors.\n" +
      "- NEVER write 'Source [1] discusses...' or 'According to [2]...' — weave the citation into your own sentence.\n" +
      "- No <think> tags, no code fences, no meta-commentary about your process.\n";

    const ID = "You are Cerebrum, a scientific research engine. You search 16+ open scholarly databases and write cited answers. " +
      "You were built by Vaticay. You are not a general assistant — you are a precision instrument for scientific literature. " +
      "ALWAYS respond in English regardless of the language of the source papers.\n\n";

    let systemPrompt;
    if (wantsMorePapers && useEvidence) {
      systemPrompt = ID + "The user wants ADDITIONAL papers on this topic. You have " + evidencePapers.length + " papers that are NEW (not shown before). " +
        "Present them as a curated research digest. For each paper:\n" +
        "1. State the key finding in one sentence with the citation [N]\n" +
        "2. Note why it's relevant to their investigation\n" +
        "Group related papers together thematically. Bold the paper topics. " +
        "End with a one-sentence synthesis of what these additional sources add to the picture.\n\n" + VOICE + CONTEXT + lengthHint + "\n" + CITE_RULES;
    } else if (useEvidence && speciesSearch) {
      systemPrompt = ID + "Question is about species: **" + speciesSearch.full + "**. Talk about THIS species specifically.\n\n" + VOICE + CONTEXT + lengthHint + "\n" + CITE_RULES;
    } else if (useEvidence && isNameSearch) {
      systemPrompt = ID + "User searched for a PERSON: \"" + query + "\". Describe their research from the papers. [author-matched: YES] = they wrote it. [NOT author-matched] = someone else wrote it, name real author. If none matched, say so.\n\n" + VOICE + CONTEXT + lengthHint + "\n" + CITE_RULES;
    } else if (useEvidence) {
      systemPrompt = ID + "You have " + evidencePapers.length + " papers below. READ EACH ABSTRACT before answering.\n\n" +
        "═══ PAPER USAGE PROTOCOL (HARD-ENFORCED) ═══\n\n" +
        "STEP 1 — ORGANISM/TOPIC AUDIT: For EACH paper, check:\n" +
        "  • Does this paper study the EXACT organism the user asked about?\n" +
        "  • Does this paper address the EXACT mechanism/topic the user asked about?\n" +
        "  • If the answer to either is NO → mark that paper as UNCITABLE.\n" +
        "  Examples of UNCITABLE papers:\n" +
        "  - User asks about BSFL microbiome → paper about millipede gut bacteria = UNCITABLE\n" +
        "  - User asks about BSFL microbiome → paper about tilapia fed with BSFL = UNCITABLE (that's tilapia nutrition, not BSFL biology)\n" +
        "  - User asks about honeybee immunity → paper about bumblebee immunity = UNCITABLE (different species)\n" +
        "  NEVER write 'although this study was conducted on [X] rather than [Y]' — that means YOU KNOW it's the wrong paper. Just don't cite it.\n\n" +
        "STEP 2 — SYNTHESIZE (mandatory):\n" +
        "  Make CLAIMS, not lists. State scientific findings and cite papers inline.\n" +
        "  WRONG: 'Source [1] found that... Source [2] showed that... Source [3] demonstrated...'\n" +
        "  RIGHT: 'Larval gut pH varies from 6.2 in the foregut to 8.5 in the hindgut [1][3], creating distinct niches that select for different bacterial phyla [2].'\n\n" +
        "STEP 3 — YOUR KNOWLEDGE IS PRIMARY:\n" +
        "  You are an expert. Give a COMPLETE answer using your scientific knowledge.\n" +
        "  Papers ANCHOR your answer but are NOT the ceiling.\n" +
        "  If all papers are weak/tangential, say so in ONE sentence, then answer from knowledge.\n" +
        "  0 citations + correct science > 5 citations + wrong organisms.\n\n" + VOICE + CONTEXT + lengthHint + "\n" + CITE_RULES;
    } else if (useWeb) {
      systemPrompt = ID + "No peer-reviewed papers matched this specific query, but reference sources were found. " +
        "IMPORTANT: Do NOT start with an apology or 'no papers found' disclaimer. Start with a direct, substantive answer. " +
        "Draw on both the reference sources below AND your scientific knowledge. " +
        "If you know relevant papers exist on this topic (from your training), mention the general findings and suggest " +
        "specific search terms the user could try to find them (e.g., 'Searching for [specific technical terms] would surface the primary literature on this').\n\n" + VOICE + CONTEXT + lengthHint + "\n" + CITE_RULES;
    } else {
      systemPrompt = ID + "The literature search didn't surface papers for this specific phrasing, but you absolutely know this topic. " +
        "IMPORTANT: Do NOT start with 'no papers retrieved' or any disclaimer. Start with a direct, authoritative scientific answer. " +
        "Give an excellent, comprehensive answer drawing on your full scientific knowledge. Be specific — name enzymes, genes, organisms, mechanisms, " +
        "quantify where possible, and cite the key researchers and landmark studies you know about in plain text (e.g., 'Work by [name] demonstrated...'). " +
        "At the END (not the beginning), add one line: 'For the primary literature, try searching: [2-3 specific search terms]' — " +
        "suggest the exact PubMed/Google Scholar search terms that would find the relevant papers.\n" +
        "ZERO fabricated citations — no [1], no (Author, Year), no DOIs. You may name findings and researchers in plain prose.\n\n" + VOICE + CONTEXT + lengthHint;
    }

    const messages = [{ role: "system", content: systemPrompt }];

    // ════════════════════════════════════════════════════════════════
    // CONVERSATION AWARENESS INJECTION
    // Give the LLM a rich understanding of the conversation context.
    // This is what makes it feel like talking to Claude — it knows
    // what's been discussed, what entities are in play, and what the
    // user's investigation trajectory looks like.
    // ════════════════════════════════════════════════════════════════
    if (conversationCtx && conversationCtx.summary) {
      let contextBlock = "CONVERSATION CONTEXT (use this to maintain continuity):\n" + conversationCtx.summary;
      if (conversationCtx.entities.length > 0) {
        contextBlock += "\nKey entities in this conversation: " + conversationCtx.entities.join(", ");
      }
      if (conversationCtx.sourceTitles.length > 0) {
        contextBlock += "\nPapers already cited in this conversation: " + conversationCtx.sourceTitles.join("; ");
      }
      messages.push({ role: "system", content: contextBlock });
    }

    // ════════════════════════════════════════════════════════════════
    // SELF-REASONING INJECTION
    // If the self-reasoning chain completed, inject its analysis into
    // the system prompt. This gives the answer LLM a "pre-thought"
    // understanding of the question's structure, complexity, and the
    // best way to approach it — the system "asked itself things" and
    // now shares its internal reasoning with the answer generator.
    // ════════════════════════════════════════════════════════════════
    const selfReasonResult = await reasoningPromise;
    if (selfReasonResult) {
      let reasoningBlock = "INTERNAL ANALYSIS (Cerebrum's reasoning about this question):\n";
      if (selfReasonResult.sub_questions && selfReasonResult.sub_questions.length > 0) {
        reasoningBlock += "Sub-questions to address: " + selfReasonResult.sub_questions.join("; ") + "\n";
      }
      if (selfReasonResult.search_strategy) {
        reasoningBlock += "Search strategy: " + selfReasonResult.search_strategy + "\n";
      }
      if (selfReasonResult.key_terms && selfReasonResult.key_terms.length > 0) {
        reasoningBlock += "Key scientific terms: " + selfReasonResult.key_terms.join(", ") + "\n";
      }
      if (selfReasonResult.complexity) {
        reasoningBlock += "Complexity: " + selfReasonResult.complexity + "\n";
      }
      if (selfReasonResult.expected_fields && selfReasonResult.expected_fields.length > 0) {
        reasoningBlock += "Relevant fields: " + selfReasonResult.expected_fields.join(", ") + "\n";
      }
      reasoningBlock += "\nUse this analysis to structure your answer. Address the sub-questions. Use the key terms. " +
        "If the question is complex or multi-domain, organize your answer accordingly.";
      messages.push({ role: "system", content: reasoningBlock });
    }

    // If the LLM resolver identified the topic, tell the answer LLM
    if (llmResolvedTopic && !isFollowupMode) {
      messages.push({
        role: "system",
        content: "TOPIC IDENTIFIED: " + llmResolvedTopic + ". Stay focused on this topic throughout your answer.",
      });
    }

    // If the user has provided corrections in previous turns, thread those into
    // the system message as authoritative facts the AI must respect. This makes
    // corrections stick across the whole session.
    if (corrections.length > 0) {
      const correctionsBlock = corrections
        .map((c, i) => `- ${c}`)
        .join("\n");
      messages.push({
        role: "system",
        content:
          "USER-PROVIDED CORRECTIONS (treat as ground truth for the rest of this conversation):\n" +
          correctionsBlock,
      });
    }

    // If this is a follow-up on the previous answer, tell the AI explicitly
    // so it doesn't restart from zero and doesn't switch topics.
    if (isFollowupMode) {
      const deepFound = gResult._deepSearchFound || 0;
      messages.push({
        role: "system",
        content:
          intent.kind === "correction"
            ? "CORRECTION MODE: The user is correcting your previous answer. Rules: " +
              "1) Assume they are right — they often know the literature better than the retrieval. " +
              "2) State plainly what you got wrong in one sentence. " +
              "3) Give the corrected account with full rigor. " +
              "4) If their correction reveals something the sources missed, say that explicitly. " +
              "Do not get defensive. Do not over-apologize. Do not switch topics."
            : "FOLLOW-UP MODE: You are continuing an ongoing investigation with the user. " +
              (deepFound > 0
                ? `I searched again and found ${deepFound} additional paper${deepFound === 1 ? "" : "s"} relevant to this follow-up. The new sources appear AFTER the original ones in the list below — use them to add fresh evidence and depth. `
                : "No additional papers were found for this specific angle, so work with the existing sources and your knowledge. ") +
              "Critical rules: " +
              "1) Do NOT repeat background you already covered — they read your previous answer. " +
              "2) Build directly on the previous turn. Go DEEPER: more mechanism, more specificity, more quantification. " +
              "3) If you found new sources, integrate them naturally — don't announce 'I found new papers.' " +
              "4) Answer the PRECISE thing they asked, not the general topic. " +
              "5) If their question exposes a limit of the evidence, say so in one sentence and push forward with your knowledge. " +
              "6) Never start with 'As I mentioned' or 'As discussed' — just advance the conversation.",
      });
    }

    // ════════════════════════════════════════════════════════════════
    // SMART HISTORY THREADING
    // Format history so the LLM clearly distinguishes between:
    // - What the user said (their questions/corrections)
    // - What the AI said (previous answers)
    // - What sources were available (so it knows what's new vs old)
    // ════════════════════════════════════════════════════════════════
    const historyTurns = Array.isArray(body.history)
      ? body.history.slice(-10)
      : [];
    for (const turn of historyTurns) {
      if (turn.role === "user") {
        messages.push({
          role: "user",
          content: String(turn.content || "").slice(0, 1500),
        });
      } else if (turn.role === "assistant") {
        // Include a condensed version of the previous answer + what sources it used
        const prevAnswer = String(turn.content || "").slice(0, 1500);
        const prevSourceTitles = (turn.sources || [])
          .slice(0, 5)
          .map((s, i) => `[${i + 1}] ${s.title || "Untitled"}`)
          .join("; ");
        const sourceNote = prevSourceTitles
          ? `\n[Previously cited: ${prevSourceTitles}]`
          : "";
        messages.push({
          role: "assistant",
          content: prevAnswer + sourceNote,
        });
      }
    }
    const userContent =
      useEvidence || useWeb
        ? "Sources:\n\n" + evidence + "\n\n---\nQuestion: " + query
        : query;
    // Reinforce ALL rules at user level — free models routinely ignore system prompts.
    // This is the last thing the model sees before generating, so it has maximum weight.
    const enforcer = useEvidence
      ? "\n\n[MECHANICAL ENFORCEMENT — your response is post-processed and these are checked:\n" +
        "1. ORGANISM CHECK: Cite papers ONLY if they study the EXACT organism asked about. " +
        "A paper about a DIFFERENT organism = DO NOT CITE. If you write 'this study was on [X], not [Y]' your response FAILS.\n" +
        "2. NO SOURCE LISTING: Do NOT write 'Source [1] found X. Source [2] found Y.' — SYNTHESIZE into unified claims with inline citations.\n" +
        "3. NO REPETITION: Every sentence must say something NEW. Repeating an idea in different words = FAIL.\n" +
        "4. BANNED PHRASES (mechanically stripped — don't waste tokens): 'further research is needed', 'plays a crucial/critical role', " +
        "'in conclusion', 'in summary', 'Overall', 'it is important to note', 'sheds light on', 'it should be noted', " +
        "'holistic', 'multifaceted', 'underscores the importance'.\n" +
        "5. START with a direct scientific claim. No 'Based on the sources' or 'The research shows'.\n" +
        "6. Italicize species: _E. coli_, _H. illucens_.\n" +
        "7. Your answer will be QUALITY-SCORED. Score < 40 = regenerated with a different model.]"
      : "\n\n[MECHANICAL ENFORCEMENT — your response is post-processed:\n" +
        "1. BANNED PHRASES (stripped): 'further research is needed', 'plays a crucial role', 'in conclusion', 'in summary', " +
        "'Overall', 'it is clear that', 'sheds light on'.\n" +
        "2. NO REPETITION. 3. START with a direct claim. 4. Italicize species: _E. coli_.]";
    messages.push({ role: "user", content: userContent + enforcer });

    // ============ D1 ANSWER CACHE ============
    // Before calling any LLM, check if we have a cached answer for a similar
    // query that was previously upvoted or verified. This is free, instant,
    // and gets better as more people use the tool.
    const cacheKey = query.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
    let cachedAnswer = null;
    if (env.DB && sourceList.length > 0) {
      try {
        const cached = await env.DB.prepare(
          "SELECT answer, sources, score, created_at FROM answer_cache WHERE query_key = ? AND score >= 0 ORDER BY score DESC, created_at DESC LIMIT 1"
        ).bind(cacheKey).first();
        if (cached && cached.answer) {
          cachedAnswer = cached;
        }
      } catch {}
    }

    // If we have a high-confidence cached answer (score >= 2 means multiple
    // upvotes), serve it directly. Otherwise fall through to the LLM chain.
    if (cachedAnswer && cachedAnswer.score >= 2) {
      return new Response(
        JSON.stringify({
          answer: cachedAnswer.answer,
          sources: sourceList,
          videos,
          factCheck: null,
          related: [],
          source: "Cached (verified)",
          _diag: gResult && gResult._diag ? gResult._diag : null,
          _cached: true,
        }),
        { status: 200, headers: cors }
      );
    }

    // ============ AI ANSWER GENERATION (Smart Router) ============
    // Race 2-3 models in parallel — take the first good response. Over time,
    // D1 tracks which model wins per domain so we skip the race.
    let answer = "";
    let aiOK = false;
    const token = env.OPENROUTER_KEY;

    // Bug: the "good enough to accept" bar below was a flat 30 characters
    // regardless of answerLength, and Promise.any (used in the race below)
    // takes the FIRST model to clear that bar — not the best, not the one
    // that actually followed the length instruction. A free-tier model that
    // raced back with two lazy sentences was indistinguishable from one that
    // wrote the requested "five to eight paragraphs" review-article answer,
    // so "Detailed" mode routinely won the race with a short response while
    // slower models that would have honored the prompt never got a chance.
    // Scale the floor to what each tier actually promises (still well under
    // the target, just enough to reject an obviously-too-short response and
    // force a retry against the next model).
    const minAnswerLen = answerLength === "long" ? 500 : answerLength === "short" ? 30 : 150;

    const callOR = async (model, msgs, maxTok) => {
      if (!token) throw new Error("no key");
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 12000);
      try {
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, "HTTP-Referer": "https://askcerebrum.org", "X-Title": "Cerebrum" },
          body: JSON.stringify({ model, temperature: 0.3, max_tokens: maxTok, messages: msgs }),
          signal: c.signal,
        });
        clearTimeout(t);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j = await r.json();
        const txt = j?.choices?.[0]?.message?.content || "";
        const cleaned = cleanAIResponse(txt);
        if (cleaned.length < minAnswerLen) throw new Error("too short");
        return { answer: cleaned, model };
      } catch (e) { clearTimeout(t); throw e; }
    };

    const callCF = async (model, msgs, maxTok) => {
      if (!env.AI || typeof env.AI.run !== "function") throw new Error("no AI");
      const out = await env.AI.run(model, { messages: msgs, max_tokens: Math.min(maxTok, 2048) });
      const cleaned = cleanAIResponse((out && out.response) || "");
      if (cleaned.length < minAnswerLen) throw new Error("too short");
      return { answer: cleaned, model };
    };

    // Check if we know the best model for this topic domain
    const domainKey = query.toLowerCase().split(/\s+/).slice(0, 3).join(" ");
    let preferredModel = null;
    if (env.DB) {
      try {
        const pref = await env.DB.prepare(
          "SELECT model, wins FROM model_perf WHERE domain = ? ORDER BY wins DESC LIMIT 1"
        ).bind(domainKey).first();
        if (pref && pref.wins >= 3) preferredModel = pref.model;
      } catch {}
    }

    // Fast path: known best model for this domain
    if (preferredModel && token) {
      try { const r = await callOR(preferredModel, messages, maxTokens); answer = r.answer; aiOK = true; } catch {}
    }

    // ════════════════════════════════════════════════════════════════
    // v6.1: MASSIVE MODEL REDUNDANCY
    // Live production failure: a query hit "AI answer service is momentarily
    // unavailable" — meaning EVERY tier failed simultaneously. Root cause:
    // only 6 distinct OpenRouter models were ever attempted (3 raced + 3
    // sequential fallback), 3 Workers AI models, and exactly 1 Pollinations
    // call. Free-tier models get hammered by every app using them and 429 in
    // bursts — a handful of attempts is a single point of failure waiting to
    // happen, especially during high-traffic hours.
    //
    // Fix: expand the attempt pool to ~30 distinct models across 3 providers,
    // and RACE the fallback pool all-at-once with Promise.any instead of
    // trying models one at a time. Racing in parallel means total wall time
    // for a fully-failed tier is bounded by ONE timeout window, not the SUM
    // of every model's timeout — so this buys massive redundancy without
    // making the pathological case (everything down) unreasonably slow.
    // A stale/removed model ID just 400s near-instantly and costs nothing,
    // so it's safe to overprovision this list generously.
    // ════════════════════════════════════════════════════════════════

    const aiAttempts = []; // diagnostic trail — surfaced in _diag for debugging
    const recordWin = (model) => {
      if (!env.DB) return;
      env.DB.prepare(
        "INSERT INTO model_perf (domain, model, wins) VALUES (?, ?, 1) ON CONFLICT(domain, model) DO UPDATE SET wins = wins + 1"
      ).bind(domainKey, model).run().catch(() => {});
    };

    // Tier 1a: small, fast, historically-reliable set — tried first for speed
    // in the common case where at least one of the "good" models is up.
    const OR_PRIMARY = [
      "deepseek/deepseek-chat-v3-0324:free",
      "google/gemini-2.0-flash-exp:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen-2.5-72b-instruct:free",
    ];
    // Tier 1b: everything else on OpenRouter's free tier. Only fires if 1a
    // fully fails, but then races ALL of these simultaneously.
    const OR_FALLBACK = [
      "mistralai/mistral-small-3.1-24b-instruct:free",
      "deepseek/deepseek-r1:free",
      "deepseek/deepseek-r1-distill-llama-70b:free",
      "deepseek/deepseek-r1-distill-qwen-32b:free",
      "nousresearch/hermes-3-llama-3.1-405b:free",
      "meta-llama/llama-3.1-8b-instruct:free",
      "meta-llama/llama-3.2-11b-vision-instruct:free",
      "meta-llama/llama-3.2-3b-instruct:free",
      "meta-llama/llama-4-scout:free",
      "meta-llama/llama-4-maverick:free",
      "google/gemma-3-27b-it:free",
      "google/gemma-2-9b-it:free",
      "qwen/qwq-32b:free",
      "qwen/qwen-2.5-coder-32b-instruct:free",
      "qwen/qwen3-235b-a22b:free",
      "mistralai/mistral-7b-instruct:free",
      "microsoft/phi-3-medium-128k-instruct:free",
      "microsoft/phi-3-mini-128k-instruct:free",
      "nousresearch/hermes-3-llama-3.1-70b:free",
      "openchat/openchat-7b:free",
      "huggingfaceh4/zephyr-7b-beta:free",
      "gryphe/mythomax-l2-13b:free",
      "cognitivecomputations/dolphin3.0-mistral-24b:free",
      "rekaai/reka-flash-3:free",
      "liquid/lfm-40b:free",
      "thudm/glm-4-9b:free",
    ];

    // Tier 1a: race the small, fast set
    if (!aiOK && token) {
      try {
        const winner = await Promise.any(OR_PRIMARY.map((m) => callOR(m, messages, maxTokens)));
        answer = winner.answer; aiOK = true;
        aiAttempts.push({ tier: "1a", model: winner.model, ok: true });
        recordWin(winner.model);
      } catch {
        aiAttempts.push({ tier: "1a", ok: false, error: "all " + OR_PRIMARY.length + " primary models failed/rate-limited" });
      }
    }

    // Tier 1b: EVERY remaining free OpenRouter model, raced simultaneously.
    // This is the actual fix for total AI unavailability — as long as ONE of
    // ~26 models is up, the user gets a real answer instead of a raw dump.
    if (!aiOK && token) {
      try {
        const winner = await Promise.any(OR_FALLBACK.map((m) => callOR(m, messages, maxTokens)));
        answer = winner.answer; aiOK = true;
        aiAttempts.push({ tier: "1b", model: winner.model, ok: true });
        recordWin(winner.model);
      } catch {
        aiAttempts.push({ tier: "1b", ok: false, error: "all " + OR_FALLBACK.length + " fallback models failed/rate-limited" });
      }
    }

    // TIER 2: Cloudflare Workers AI — race every available model simultaneously
    const CF_MODELS = [
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
      "@cf/meta/llama-3.1-8b-instruct-fp8",
      "@cf/meta/llama-3.1-8b-instruct",
      "@cf/mistral/mistral-7b-instruct-v0.2",
      "@cf/qwen/qwen1.5-14b-chat-awq",
      "@cf/microsoft/phi-2",
    ];
    if (!aiOK && env.AI && typeof env.AI.run === "function") {
      try {
        const winner = await Promise.any(CF_MODELS.map((m) => callCF(m, messages, maxTokens)));
        answer = winner.answer; aiOK = true;
        aiAttempts.push({ tier: "2", model: winner.model, ok: true });
      } catch {
        aiAttempts.push({ tier: "2", ok: false, error: "all " + CF_MODELS.length + " Workers AI models failed" });
      }
    }

    // TIER 3: Pollinations — race multiple backend model params simultaneously
    if (!aiOK) {
      const pollinationsCall = async (modelParam) => {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 9000);
        try {
          const pRes = await fetch("https://text.pollinations.ai/", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [
                { role: "system", content: "You are Cerebrum, a scientific research engine built by Vaticay. Answer naturally in English. Do NOT fabricate citations, DOIs, or author names. Be specific — name enzymes, genes, compounds. Bold key terms." },
                { role: "user", content: query },
              ],
              model: modelParam,
            }),
            signal: c.signal,
          });
          clearTimeout(t);
          if (!pRes.ok) throw new Error("HTTP " + pRes.status);
          const cleaned = cleanAIResponse(await pRes.text());
          if (!cleaned || cleaned.length < 30) throw new Error("too short");
          return { answer: cleaned, model: "pollinations:" + modelParam };
        } catch (e) { clearTimeout(t); throw e; }
      };
      try {
        const winner = await Promise.any(["openai", "mistral", "llama", "qwen-coder"].map(pollinationsCall));
        answer = winner.answer; aiOK = true;
        aiAttempts.push({ tier: "3", model: winner.model, ok: true });
      } catch {
        aiAttempts.push({ tier: "3", ok: false, error: "all Pollinations variants failed" });
      }
    }

    // Log the attempt trail so a future total-failure is diagnosable from
    // Cloudflare's dashboard logs instead of requiring another live repro.
    if (!aiOK) {
      try { console.log("Cerebrum: ALL AI TIERS FAILED", JSON.stringify(aiAttempts)); } catch {}
    }

    // ============ v6.0: ANSWER QUALITY ENGINE ============
    // Post-process EVERY answer through the quality engine. This catches
    // repetition, banned phrases, source-listing, and wrong-organism
    // acknowledgments that the model wrote despite being told not to.
    // This is a MECHANICAL fix — we don't rely on the model to follow rules.
    if (aiOK) {
      answer = postProcessAnswer(answer);
    }

    // ============ v6.0: QUALITY-GATED RETRY ============
    // Score the answer after post-processing. If it's still bad (score < 35),
    // retry with a different model using a MUCH stricter prompt that includes
    // examples of what NOT to do. This is the "intelligence amplifier" — even
    // if the first model produces garbage, we catch it and try again.
    if (aiOK && useEvidence && evidencePapers.length > 0) {
      const qualityScore = scoreAnswerQuality(answer, query);
      if (qualityScore < 35 && token) {
        // Build a retry prompt that's EXTREMELY explicit about what went wrong
        const retrySystemPrompt =
          "You are a scientific expert writing a research synthesis. CRITICAL RULES:\n\n" +
          "1. SYNTHESIZE — do NOT list papers one by one. Make claims and cite multiple sources inline.\n" +
          "   BAD: '[1] found X. [2] showed Y. [3] demonstrated Z.'\n" +
          "   GOOD: 'Gut microbiome composition varies significantly by larval instar, with early instars dominated by _Proteobacteria_ [1][3] while late instars shift toward _Firmicutes_ [2].'\n\n" +
          "2. ORGANISM ACCURACY — only cite papers about the EXACT organism asked about.\n" +
          "   If a paper studies a DIFFERENT organism, DO NOT CITE IT. Zero citations is better than wrong citations.\n\n" +
          "3. NO REPETITION — every sentence must add new information. Never rephrase.\n\n" +
          "4. NO FILLER — banned: 'further research is needed', 'plays a crucial role', 'in conclusion', " +
          "'Overall', 'it is important to note', 'sheds light on'.\n\n" +
          "5. START with a direct scientific claim. No 'Based on...' or 'The research shows...'.\n\n" +
          "6. Italicize species: _E. coli_. Quantify: give numbers, not 'significant'.";

        const retryMsgs = [
          { role: "system", content: retrySystemPrompt },
          { role: "user", content: "Sources:\n\n" + evidence + "\n\n---\nQuestion: " + query +
            "\n\n[Your answer will be quality-scored. Previous attempt scored " + qualityScore + "/100. Beat it.]" },
        ];
        const retryModels = [
          "google/gemini-2.0-flash-exp:free",
          "deepseek/deepseek-chat-v3-0324:free",
          "meta-llama/llama-3.3-70b-instruct:free",
        ];
        for (const m of retryModels) {
          try {
            const r = await callOR(m, retryMsgs, maxTokens);
            const retryProcessed = postProcessAnswer(r.answer);
            const retryScore = scoreAnswerQuality(retryProcessed, query);
            if (retryScore > qualityScore) {
              answer = retryProcessed;
              break;
            }
          } catch {}
        }
      }
    }

    // ============ CITATION QUALITY CHECK ============
    // If the answer has zero citations but we gave it papers, that's often
    // CORRECT — the papers may not have been relevant. Only retry if the answer
    // also seems low quality (too short or generic).
    if (aiOK && useEvidence && evidencePapers.length > 0) {
      const hasCitations = /\[\d+\]/.test(answer);
      // Only retry if: no citations AND answer is suspiciously short (model may
      // have given up rather than engaging with the papers)
      if (!hasCitations && answer.length < 200) {
        try {
          const retryMsgs2 = [
            { role: "system", content: "You are a scientific expert. Write a thorough, accurate answer. " +
              "Cite papers ONLY if they directly address the question's specific topic and organism. " +
              "If none of the papers are relevant, say so briefly and answer from your knowledge. " +
              "An accurate uncited answer is better than wrong citations. SYNTHESIZE — do not list sources." },
            { role: "user", content: "Papers:\n\n" + evidence + "\n\n---\nQuestion: " + query },
          ];
          const retryModels2 = ["deepseek/deepseek-chat-v3-0324:free", "google/gemini-2.0-flash-exp:free", "meta-llama/llama-3.3-70b-instruct:free"];
          for (const m of retryModels2) {
            try {
              const r = await callOR(m, retryMsgs2, maxTokens);
              if (r.answer.length > answer.length) {
                answer = postProcessAnswer(r.answer);
                break;
              }
            } catch {}
          }
        } catch {}
      }

      // Append a reference list at the bottom ONLY if citations were actually used.
      // Previously this appended sources even when they were irrelevant, which
      // made it look like the answer was backed by papers that don't support it.
      if (!/\[\d+\]/.test(answer) && evidencePapers.length > 0) {
        // No citations used — check if the answer is still good
        if (answer.length > 300) {
          // Answer is substantial — the model chose not to cite because papers
          // weren't relevant. That's correct behavior. Don't force sources.
        } else {
          // Short answer with no citations — add source context
          answer = answer.trim() +
            "\n\n---\n**Related papers found (may not directly address this question):**\n" +
            evidencePapers.slice(0, 4).map((p, i) => "[" + (i + 1) + "] " + p.title + (p.year ? " (" + p.year + ")" : "")).join("\n");
        }
      }

      // ============ D1 PAPER-LEVEL LEARNING (write) ============
      // Parse which citation numbers actually appear in the final answer and
      // persist THOSE specific papers as confirmed-correct for this query.
      // Next time this question (or an identically-worded one) is asked,
      // these papers get force-included at max relevance instead of being
      // rediscovered — this is the self-improving loop.
      if (env.DB && learnKey) {
        try {
          const citedIdx = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10)));
          const citedPapers = [...citedIdx]
            .map((n) => evidencePapers[n - 1])
            .filter(Boolean)
            .slice(0, 8);
          for (const p of citedPapers) {
            await env.DB.prepare(
              "INSERT INTO paper_cache (query_key, title, url, journal, year, authors, abstract, times_confirmed, created_at) " +
              "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) " +
              "ON CONFLICT(query_key, title) DO UPDATE SET times_confirmed = times_confirmed + 1"
            ).bind(learnKey, p.title || "", p.url || "", p.journal || "", p.year || "", p.authors || "", (p.abstract || "").slice(0, 500), Date.now()).run();
          }
        } catch {}
      }
    }

    // ============ D1 QUERY INTELLIGENCE LEARNING ============
    // Store the successful query resolution so future similar queries
    // can skip the LLM resolver entirely. This is how the system
    // "learns and grows" — every successful answer makes the next
    // similar query faster and more accurate.
    if (env.DB && aiOK && answer.length > 100) {
      const resolvedTopic = llmResolvedTopic || (resolverResult && resolverResult.topic) || null;
      const finalSearchQuery = resolvedSearchQuery || query;
      const intentUsed = resolverResult ? resolverResult.intent : intent.kind;
      storeQueryIntelligence(
        queryKey, query, finalSearchQuery, intentUsed, resolvedTopic,
        conversationCtx ? conversationCtx.entities : [], env.DB
      ).catch(() => {});

      // Also update topic memory with search performance data
      if (resolvedTopic && papers.length > 0) {
        const searchTerms = selfReasonResult && selfReasonResult.key_terms
          ? selfReasonResult.key_terms
          : [];
        updateTopicMemory(resolvedTopic, searchTerms, papers.length, env.DB).catch(() => {});
      }
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
    // HARD GUARD against fabricated references. Runs on every answer, not just
    // the no-sources case: it also removes dangling markers like [7] when only
    // 4 sources exist, which would otherwise render as a broken citation link.
    answer = stripFabricatedCitations(answer, sourceList.length);

    const canonicalName = resolvedPersonName || extractPersonNameFromQuery(query) || (isNameSearch ? query : "");
    if (canonicalName) {
      answer = correctNameVariants(answer, canonicalName);
    }

    // ---- CACHE THE ANSWER (D1) ----
    // Store this answer so future similar queries can skip the LLM entirely.
    // Only cache answers that have real sources — unsourced general-knowledge
    // answers are the ones most likely to contain errors.
    const answerId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    if (env.DB && sourceList.length > 0 && answer.length > 50) {
      try {
        await env.DB.prepare(
          "INSERT OR REPLACE INTO answer_cache (query_key, answer_id, answer, sources, score, created_at) VALUES (?, ?, ?, ?, 0, ?)"
        ).bind(
          cacheKey,
          answerId,
          answer,
          JSON.stringify(sourceList.slice(0, 10)),
          // Bug: this wrote an ISO-8601 string into a column declared
          // INTEGER (see schema.sql), while paper_cache's write a few lines
          // away correctly uses Date.now(). SQLite's flexible typing stored
          // it silently, so it worked by luck (ISO strings happen to sort
          // correctly against each other) but would sort wrong the moment
          // any row got a genuine numeric timestamp. Match paper_cache.
          Date.now()
        ).run();
      } catch {} // Cache write failure is not critical — don't block the response
    }

    return new Response(
      JSON.stringify({
        answer,
        sources: sourceList,
        videos,
        factCheck: null,
        related: [],
        answerId, // frontend can use this for upvote/downvote
        source:
          aiOK && useEvidence
            ? dbUsed + " + AI"
            : aiOK && useWeb
            ? dbUsed + " + AI"
            : aiOK
            ? "General knowledge (AI)"
            : dbUsed,
        _diag: gResult && gResult._diag ? gResult._diag : null,
        _resolver: resolverResult ? {
          intent: resolverResult.intent,
          topic: resolverResult.topic,
          reasoning: resolverResult.reasoning,
          resolvedQuery: resolvedSearchQuery,
        } : null,
        _selfReasoning: selfReasonResult ? {
          complexity: selfReasonResult.complexity,
          subQuestions: selfReasonResult.sub_questions,
          keyTerms: selfReasonResult.key_terms,
        } : null,
        // v6.1: which models were attempted and which one (if any) won —
        // lets a future total-failure be diagnosed from the response itself
        // instead of requiring a live repro + dashboard log dig.
        _aiAttempts: typeof aiAttempts !== "undefined" ? aiAttempts : null,
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
