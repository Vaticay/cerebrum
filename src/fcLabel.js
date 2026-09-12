/**
 * Flowchart label language — compress answer prose into terse node labels.
 *
 * Two pure, deterministic helpers used by FlowchartStudio's "Draft from
 * answer":
 *
 *   fcExtractSteps(text, maxSteps) -> [{ text, cites }]
 *     Pulls the answer's own steps (list items, then sequence markers,
 *     then plain sentences) without inventing any. Each step keeps the
 *     1-based citation indices it carried in the answer text so the draft
 *     can ground nodes to real papers.
 *
 *   fcCompressStep(sentence, maxChars) -> string
 *     Shrinks one step to a few words. Compression ONLY deletes words —
 *     leading filler phrases, parenthetical asides, trailing adjuncts —
 *     so the label can never say something the sentence didn't. The last
 *     resort is a word-boundary cut (never mid-word, never mid-thought
 *     by slicing characters); truncation with "…" is gone.
 *
 * No network, no model, no randomness: the same answer always drafts the
 * same chart.
 */

const LEAD_FILLER_RES = [
  /^(?:the|this|these|those)\s+(?:study|studies|trial|trials|data|evidence|analysis|analyses|review|meta-analysis|findings|results)\s+(?:found|showed|show|indicate[sd]?|suggest(?:s|ed)?|demonstrate[sd]?|reveal[ed]?|confirm[ed]?|report[ed]?)\s+that\s+/i,
  /^(?:researchers?|authors?|investigators?|scientists?|clinicians?)\s+(?:found|observed|reported|concluded|showed|demonstrate[sd]?|suggest(?:s|ed)?|note[sd]?)\s+that\s+/i,
  /^it\s+was\s+(?:found|observed|shown|reported|concluded|demonstrate[sd]?)\s+that\s+/i,
  /^(?:in\s+summary|overall|in\s+conclusion|taken\s+together|collectively|in\s+short)[,:]?\s+/i,
  /^(?:these|those|the)\s+findings\s+suggest\s+that\s+/i,
  /^this\s+(?:suggests?|indicates?|means?|implies?|demonstrates?)\s+that\s+/i,
  /* Sequence words are redundant on the canvas — the step numeral kicker
     already owns the ordering. */
  /^(?:first|next|then|after that|finally|lastly)[,:]?\s+/i,
];

const TRAIL_FILLER_RES = [
  /\s+(?:according to the authors?|in this study|in these studies|in the trial|in the trials|as reported|as noted above)\.?$/i,
  /\s+et al\.?$/i,
];

const TRAIL_ADJUNCT_RE =
  /\s+(?:in|for|with|without|among|across|between|during|over|versus|vs\.?|compared\s+(?:with|to)|relative\s+to)\s+[^,;—–()]{3,}$/i;

const STRONG_BREAK_RES = [/[;—–]/, /,\s*which\s+/i, /,\s*that\s+/i, /\s+while\s+/i, /\s+whereas\s+/i];

function cap1(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Compress one sentence to at most `max` characters by deleting words.
 * Never invents, never cuts mid-word.
 */
export function fcCompressStep(raw, max = 52) {
  let s = String(raw || "")
    .replace(/\([^()]*\)/g, " ") // parenthetical asides carry detail, not the point
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;:]+$/, "");

  // 1) Strip leading filler phrases ("the study found that …") — repeat
  //    until stable, since fillers can stack ("Overall, the data show that …").
  let prev;
  do {
    prev = s;
    for (const re of LEAD_FILLER_RES) s = s.replace(re, "");
    s = s.trim();
  } while (s !== prev);

  // 2) Strip trailing filler ("… according to the authors").
  for (const re of TRAIL_FILLER_RES) s = s.replace(re, "");
  s = s.trim().replace(/[.;:]+$/, "").trim();

  if (s.length <= max) return cap1(s);

  // 3) Keep the first clause across strong breaks ("A; B" / "A, which B").
  for (const re of STRONG_BREAK_RES) {
    const head = s.split(re)[0].trim().replace(/[.;:,]+$/, "");
    if (head.length >= 24 && head.length < s.length) {
      s = head;
      break;
    }
  }
  if (s.length <= max) return cap1(s);

  // 4) Drop trailing adjunct phrases ("… in adults with diabetes" →
  //    "… in adults"), stopping before the label would lose its core.
  let m;
  while (s.length > max && (m = s.match(TRAIL_ADJUNCT_RE))) {
    const next = s.slice(0, m.index).trim().replace(/[.;:,]+$/, "");
    if (next.length < 24) break;
    s = next;
  }
  if (s.length <= max) return cap1(s);

  // 5) Last resort: word-boundary cut. Still no mid-word slice, and no
  //    dangling "…" — the label is a compressed phrase, not a truncation.
  //    A cut can still strand a function word ("…cholesterol by an"): drop
  //    trailing danglers so the label always reads as a whole thought.
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  s = (sp > max * 0.55 ? cut.slice(0, sp) : cut).trim().replace(/[.;:,-]+$/, "");
  let dm;
  const DANGLER_RE = /\s+(a|an|the|by|to|of|in|for|with|on|at|from|and|or|via|vs\.?|versus|than|as)$/i;
  while (s.length > 20 && (dm = s.match(DANGLER_RE))) s = s.slice(0, dm.index);
  return cap1(s);
}

const CITE_RE = /\[(\d+(?:,\s*\d+)*)\]/g;

/**
 * Extract the answer's own steps. Returns at most `maxSteps` entries of
 * { text, cites } where cites are the 1-based citation indices the step
 * carried (deduped, in order of appearance).
 */
export function fcExtractSteps(text, maxSteps = 7) {
  const clean = String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#{1,4}\s+/gm, "");
  const steps = [];
  const seen = new Set();
  const push = (raw) => {
    const rawStr = String(raw || "");
    const cites = [];
    for (const m of rawStr.matchAll(CITE_RE)) {
      for (const n of m[1].split(",")) {
        const idx = parseInt(n.trim(), 10);
        if (idx > 0 && !cites.includes(idx)) cites.push(idx);
      }
    }
    const s = rawStr
      .replace(CITE_RE, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.;:]+$/, "");
    if (s.length >= 8 && s.length <= 160 && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      steps.push({ text: s, cites });
    }
  };

  // Pass 1: explicit list items.
  for (const ln of clean.split("\n")) {
    const m = ln.match(/^\s*(?:\d{1,2}[.)]|[-•*–])\s+(.+)$/);
    if (m) push(m[1]);
    if (steps.length >= maxSteps) break;
  }
  // Pass 2: sequence markers ("First, … Then, …").
  if (steps.length < 2) {
    const seqRe = /(?:^|[.!?]\s+)(first|next|then|after that|finally|lastly)[,:]?\s+([^.!?]{12,140})/gi;
    let m;
    while ((m = seqRe.exec(clean)) && steps.length < maxSteps) push(m[2]);
  }
  // Pass 3: plain sentences as a last resort.
  if (steps.length < 2) {
    const sents = clean
      .replace(/\n+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 24 && s.length <= 160);
    for (const s of sents.slice(0, 5)) push(s);
  }
  return steps;
}
