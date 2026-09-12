/**
 * answerInsights.js — deterministic, UI-free helpers behind the answer
 * instruments: QueryAutopsy (how the answer was built), AnswerArc (the
 * narrative arc of the cited literature), and OpenQuestions (research gaps).
 *
 * Every function here is pure and invents nothing: each line it produces is
 * traceable to the turn data passed in. Anything it cannot substantiate it
 * omits, and the components render honest empty states for the rest.
 *
 * Imported by src/CerebrumApp.jsx (Vite) and by tests/answer-insights.mjs
 * (node) — so: no JSX, no browser APIs, no React.
 */

/* ── Retrieval funnel ─────────────────────────────────────────────── */

const funnelNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
};

/* Validate the backend's `_funnel` payload. Returns the six numbers, or
 * null when the backend didn't ship them (older cached answers, paths that
 * never ran retrieval) — the funnel section then hides instead of guessing. */
export function sanitizeFunnel(raw) {
  if (!raw || typeof raw !== "object") return null;
  const gathered = funnelNum(raw.gathered);
  const deduped = funnelNum(raw.deduped);
  const excludedWeak = funnelNum(raw.excludedWeak);
  const excludedNonEnglish = funnelNum(raw.excludedNonEnglish);
  const excludedRetracted = funnelNum(raw.excludedRetracted);
  const cited = funnelNum(raw.cited);
  const all = [gathered, deduped, excludedWeak, excludedNonEnglish, excludedRetracted, cited];
  if (all.some((v) => v === null)) return null;
  return { gathered, deduped, excludedWeak, excludedNonEnglish, excludedRetracted, cited };
}

/* The four funnel stages for the stage strip: gathered → deduped → ranked → cited.
 * "Ranked" is derived, not shipped: what the relevance floor kept. */
export function funnelStages(f) {
  const ranked = Math.max(0, f.deduped - f.excludedWeak);
  return [
    { key: "gathered", label: "Gathered", count: f.gathered, note: "Raw records returned by the databases" },
    { key: "deduped", label: "Deduped", count: f.deduped, note: "Unique papers after dedup" },
    { key: "ranked", label: "Ranked", count: ranked, note: "Kept by the relevance floor" },
    { key: "cited", label: "Cited", count: f.cited, note: "Numbered in the bibliography" },
  ];
}

/* Exclusion counts by reason. "Duplicates" is gathered − deduped, which folds
 * in the rare dataset/deposit records the pre-ranking filter drops at the
 * same stage — disclosed in the note rather than hidden. */
export function funnelExclusions(f) {
  return [
    {
      reason: "Duplicates",
      count: Math.max(0, f.gathered - f.deduped),
      note: "Same paper returned by more than one database — includes dataset and deposit records removed before ranking",
    },
    {
      reason: "Weak match",
      count: f.excludedWeak,
      note: "Below the relevance floor for this question",
    },
    {
      reason: "Non-English",
      count: f.excludedNonEnglish,
      note: "Not checkable by an English-language reader",
    },
    {
      reason: "Retracted",
      count: f.excludedRetracted,
      note: f.excludedRetracted > 0
        ? "Removed before synthesis"
        : "Flagged on the paper instead — never silently dropped",
    },
  ];
}

/* ── Answer section parsing ───────────────────────────────────────── */

export function splitAnswerSections(answer) {
  const text = String(answer || "");
  const out = [];
  const re = /^##\s+(.+?)\s*$/gm;
  let m;
  let lastHeading = null;
  let lastIdx = 0;
  while ((m = re.exec(text)) !== null) {
    if (lastHeading !== null) out.push({ heading: lastHeading, body: text.slice(lastIdx, m.index).trim() });
    lastHeading = m[1].trim();
    lastIdx = m.index + m[0].length;
  }
  if (lastHeading !== null) out.push({ heading: lastHeading, body: text.slice(lastIdx).trim() });
  return out;
}

/* 1-based citation indices present in a text, deduped, bounded by the
 * bibliography length so a stray [99] can never point at nothing. */
export function extractCitedIndices(text, maxN) {
  const idx = [];
  const seen = new Set();
  for (const m of String(text || "").matchAll(/\[(\d{1,2})\]/g)) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && (!maxN || n <= maxN) && !seen.has(n)) {
      seen.add(n);
      idx.push(n);
    }
  }
  return idx;
}

export function splitSentences(body) {
  return String(body || "")
    .split(/(?<=[.!?])\s+(?=[A-Z("])/)
    .map((s) => s.replace(/^#+\s*/, "").replace(/^(?:[-*•]\s+|\d{1,2}[.)]\s+)/, "").trim())
    .filter((s) => s.length >= 40);
}

/* ── The Arc: narrative eras ──────────────────────────────────────── */

const ERA_NAMES = ["Foundations", "Building", "Current"];

const truncateTitle = (t, max = 90) => {
  const s = String(t || "Untitled").replace(/\s+/g, " ").trim() || "Untitled";
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > 40 ? cut.slice(0, sp) : cut) + "…";
};

/* Group cited sources into narrative eras from the actual year span.
 * Returns null when there are fewer than 2 distinct years — the caller
 * hides the Arc toggle rather than drawing a one-point "timeline". */
export function groupSourcesIntoEras(sources) {
  const nowYear = new Date().getFullYear();
  const dated = [];
  (Array.isArray(sources) ? sources : []).forEach((s, i) => {
    const year = parseInt(s && s.year, 10);
    if (Number.isFinite(year) && year > 1500 && year <= nowYear + 1) dated.push({ source: s, index: i, year });
  });
  const distinct = [...new Set(dated.map((d) => d.year))].sort((a, b) => a - b);
  if (distinct.length < 2) return null;
  const minY = distinct[0];
  const maxY = distinct[distinct.length - 1];
  const span = maxY - minY; // >= 1, since at least two distinct years
  const cut1 = minY + span / 3;
  const cut2 = minY + (2 * span) / 3;
  const buckets = [[], [], []];
  for (const d of dated) buckets[d.year <= cut1 ? 0 : d.year <= cut2 ? 1 : 2].push(d);

  const eras = [];
  buckets.forEach((papers, bi) => {
    if (!papers.length) return;
    const years = papers.map((p) => p.year).sort((a, b) => a - b);
    const hasCites = papers.some((p) => Number(p.source.citations) > 0);
    const anchor = papers.slice().sort((a, b) => {
      if (hasCites) {
        const c = (Number(b.source.citations) || 0) - (Number(a.source.citations) || 0);
        if (c !== 0) return c;
      }
      const r = (Number(b.source.relevance) || 0) - (Number(a.source.relevance) || 0);
      if (r !== 0) return r;
      return a.year - b.year;
    })[0];
    eras.push({
      name: ERA_NAMES[bi],
      startYear: years[0],
      endYear: years[years.length - 1],
      papers,
      anchor,
      anchorCitations: hasCites ? Number(anchor.source.citations) || 0 : null,
      claimCount: 0,
      claimFirstYear: null,
      disagreementCount: 0,
    });
  });
  return eras;
}

/* Citation indices used inside the disagreement section, bounded by the
 * bibliography so they always resolve to a real paper. */
export function disagreementCitedIndices(answer, sourceCount) {
  const sec = splitAnswerSections(answer).find((s) => /where researchers disagree|where they actually differ/i.test(s.heading));
  if (!sec) return [];
  return extractCitedIndices(sec.body, sourceCount);
}

/* Fill each era with: how many core (fact-checked) claims its papers back,
 * the earliest year a core claim's evidence appears, and how many
 * disagreement-cited papers it holds. Also computes the convergence read:
 * the share of supported claims that cite the most recent era. */
export function annotateEras(eras, opts = {}) {
  if (!eras) return null;
  const { factCheck = null, disagreementIndices = [], sources = [] } = opts;
  const srcArr = Array.isArray(sources) ? sources : [];
  const idxToEra = new Map();
  eras.forEach((era, ei) => {
    for (const p of era.papers) idxToEra.set(p.index, ei);
  });
  const eraOf = (n) => idxToEra.get(n - 1); // n is a 1-based citation

  const claims = factCheck && Array.isArray(factCheck.claims) ? factCheck.claims : [];
  const newest = eras.length - 1;
  let supportedTotal = 0;
  let supportedRecent = 0;

  for (const c of claims) {
    const idx = extractCitedIndices(String(c.claim || "") + " " + String(c.note || ""), srcArr.length);
    const erasHit = [...new Set(idx.map(eraOf).filter((v) => v !== undefined))];
    for (const ei of erasHit) {
      const era = eras[ei];
      era.claimCount += 1;
      for (const n of idx) {
        if (eraOf(n) !== ei) continue;
        const y = parseInt(srcArr[n - 1] && srcArr[n - 1].year, 10);
        if (Number.isFinite(y) && (era.claimFirstYear === null || y < era.claimFirstYear)) era.claimFirstYear = y;
      }
    }
    if (c.status === "supported" && erasHit.length > 0) {
      supportedTotal += 1;
      if (erasHit.includes(newest)) supportedRecent += 1;
    }
  }
  for (const n of disagreementIndices) {
    const ei = eraOf(n);
    if (ei !== undefined) eras[ei].disagreementCount += 1;
  }
  return {
    eras,
    claimsTotal: claims.length,
    convergence: supportedTotal > 0 ? { supportedTotal, supportedRecent, share: supportedRecent / supportedTotal } : null,
  };
}

const HEDGE = "based on cited sources only";

/* One deterministic line per era:
 * "{range} · {n} papers · anchored by {title} ({c} citations) · {k} back core claims{; 2 cited in disagreements}" */
export function describeEra(era, hasFactCheck) {
  const range = era.startYear === era.endYear ? String(era.startYear) : `${era.startYear}–${era.endYear}`;
  const n = era.papers.length;
  const bits = [`${range}`, `${n} paper${n === 1 ? "" : "s"}`];
  const title = truncateTitle(era.anchor.source.title);
  bits.push(
    era.anchorCitations === null || era.anchorCitations === undefined
      ? `anchored by ${title} (highest relevance match)`
      : `anchored by ${title} (${era.anchorCitations} citation${era.anchorCitations === 1 ? "" : "s"})`
  );
  if (hasFactCheck) bits.push(`${era.claimCount} back core claim${era.claimCount === 1 ? "" : "s"}`);
  if (era.claimFirstYear !== null) bits.push(`first evidence for a core claim appears in ${era.claimFirstYear}`);
  if (era.disagreementCount > 0) bits.push(`${era.disagreementCount} cited in disagreements`);
  return bits.join(" · ") + ` — ${HEDGE}.`;
}

export function describeConvergence(convergence, newestEra) {
  if (!convergence || !newestEra) return null;
  const pct = Math.round(convergence.share * 100);
  const base = `${pct}% of supported claims cite the ${newestEra.name} era`;
  const read = convergence.share >= 0.5
    ? "the literature converges on recent work"
    : "the core claims still rest on earlier work";
  return `${base} — ${read}, ${HEDGE}.`;
}

/* ── Open questions: research gap finder ──────────────────────────── */

const GAP_SIGNALS = [
  {
    key: "unclear",
    re: /\bremains?\s+unclear\b/i,
    why: "The answer explicitly marks this as unresolved.",
    close: "A study designed to resolve it directly.",
  },
  {
    key: "nostudies",
    re: /\bno\s+studies\b/i,
    why: "The answer reports that no studies address this yet.",
    close: "The first study designed to test it.",
  },
  {
    key: "notyet",
    re: /\bnot\s+yet\b/i,
    why: "The answer notes this has not yet been established.",
    close: "Direct evidence the current literature doesn't yet contain.",
  },
  {
    key: "unknown",
    re: /\bunknown\b/i,
    why: "The answer describes this as unknown.",
    close: "Direct evidence the current literature doesn't yet contain.",
  },
  {
    key: "unanswered",
    re: /\bunanswered\b/i,
    why: "The answer leaves this unanswered.",
    close: "A study built to answer it.",
  },
];

const ANGLE_STOPWORDS = new Set(
  "what which does have with from that this these those there their about into under over between among how why when are was were been being does do does and the for are has had can could would should will shall may might must than then than such only also very more most other than its its".split(" ")
);

const cleanCiteText = (s) => String(s || "").replace(/\[\d{1,2}\]/g, "").replace(/\s+([.,;])/g, "$1").trim();

/* A sub-question counts as covered when at least half of its significant
 * terms appear in the answer. Nothing to judge (no significant terms) means
 * covered — never invent a gap. */
export function isCoveredByAnswer(subQ, answerLower) {
  const terms = String(subQ || "").toLowerCase().match(/[a-z]{4,}/g) || [];
  const sig = [...new Set(terms.filter((t) => !ANGLE_STOPWORDS.has(t)))];
  if (sig.length === 0) return true;
  const hits = sig.filter((t) => String(answerLower || "").includes(t)).length;
  return hits >= Math.max(1, Math.ceil(sig.length / 2));
}

const MAX_CARDS = 6;

/* Deterministic gap extraction. Sources, in priority order:
 *  1. gap sentences from the answer's 3rd–4th sections (and map mode's
 *     "What is still open"), matched against fixed hedge patterns;
 *  2. thin/unsupported fact-check claims ("single-study claim" fragility);
 *  3. query-plan sub-questions the answer never takes up.
 * Every card quotes its source sentence. Returns [] when nothing surfaces —
 * the caller hides the button entirely in that case. */
export function extractOpenQuestions(answer, factCheck, sources, selfReasoning) {
  const cards = [];
  const seenQ = new Set();
  const srcArr = Array.isArray(sources) ? sources : [];
  const push = (card) => {
    const key = card.question.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seenQ.has(key) || cards.length >= MAX_CARDS) return;
    seenQ.add(key);
    cards.push(card);
  };
  const entryPapers = (sentence) =>
    extractCitedIndices(sentence, srcArr.length)
      .map((n) => ({
        n,
        title: (srcArr[n - 1] && srcArr[n - 1].title) || "Untitled",
        year: (srcArr[n - 1] && srcArr[n - 1].year) || "",
      }))
      .filter((e) => e.title && e.title !== "Untitled");

  // 1 — gap sentences. Sections 3–4 (0-based 2–3) carry the disagreement /
  // confidence / falsification material in every mode; map mode's "What is
  // still open" is the dedicated gap section.
  const sections = splitAnswerSections(answer);
  const targets = sections.slice(2, 4);
  const stillOpen = sections.find((s) => /what is still open/i.test(s.heading));
  if (stillOpen && !targets.includes(stillOpen)) targets.push(stillOpen);
  for (const sec of targets) {
    for (const sent of splitSentences(sec.body)) {
      const sig = GAP_SIGNALS.find((g) => g.re.test(sent));
      if (!sig) continue;
      push({
        kind: "gap",
        question: cleanCiteText(sent),
        whyOpen: sig.why,
        whatWouldCloseIt: sig.close,
        startWith: entryPapers(sent),
        sourceSentence: sent,
        sourceLabel: `From “${sec.heading}”`,
      });
    }
  }

  // 2 — fragile claims. Terms-mode checks verify names, not claims, so they
  // can't produce a research gap.
  const claims = factCheck && Array.isArray(factCheck.claims) && factCheck.mode !== "terms" ? factCheck.claims : [];
  for (const c of claims) {
    if (c.status !== "thin" && c.status !== "unsupported") continue;
    const text = String(c.claim || "").trim();
    if (text.length < 12) continue;
    const thin = c.status === "thin";
    push({
      kind: "fragile",
      question: cleanCiteText(text),
      whyOpen: thin
        ? "Single-study claim — only thinly backed by the cited literature."
        : "Not backed by any cited paper — the answer reaches past its sources here.",
      whatWouldCloseIt: thin
        ? "An independent replication in a second study."
        : "A cited source that actually states this.",
      startWith: entryPapers(text + " " + String(c.note || "")),
      sourceSentence: text,
      sourceLabel: "From the fact-check",
    });
  }

  // 3 — angles the query plan raised that the answer never takes up.
  const subQs = selfReasoning && Array.isArray(selfReasoning.subQuestions) ? selfReasoning.subQuestions : [];
  const answerLower = String(answer || "").toLowerCase();
  for (const sq of subQs) {
    const q = String(sq || "").trim();
    if (q.length < 12) continue;
    if (isCoveredByAnswer(q, answerLower)) continue;
    push({
      kind: "angle",
      question: q,
      whyOpen: "The pipeline raised this angle while planning the search, but the answer doesn't take it up.",
      whatWouldCloseIt: "Evidence addressing this angle directly.",
      startWith: [],
      sourceSentence: q,
      sourceLabel: "From the query plan",
    });
  }

  return cards;
}
