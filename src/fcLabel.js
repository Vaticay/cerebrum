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
 *     Shrinks one step to a few words by deleting words: leading
 *     filler phrases, parenthetical asides, trailing adjuncts.
 *     Deletion is NOT meaning preserving in general (corrected
 *     2026-10-23, logic audit L5-15): a deleted parenthetical or
 *     trailing clause can carry a negation, a qualifier, or a
 *     contrast that limits the claim, and deleting it would
 *     widen what the label asserts. So any sentence carrying a
 *     negation, a qualifier, or a contrast marker is refused:
 *     it passes through whole, uncompressed, however long it
 *     is. Only marker free sentences take the deletion path
 *     below, and for them the last resort is a word-boundary
 *     cut (never mid-word, never mid-thought by slicing
 *     characters); truncation with "…" is gone.
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

/* Scope markers (2026-10-23, logic audit L5-15): a sentence
 * carrying any of these is incompressible. Negations and
 * contrast markers are where scope limits live ("no benefit
 * in children", "while raising risk in older adults"), and
 * qualifiers bound how far the claim reaches; deleting words
 * around any of them can assert more than the sentence did. */
const FC_NEGATION_RE =
  /\b(no|not|never|none|neither|nor|without|cannot|can't|doesn't|didn't|isn't|aren't|won't|don't|hardly|rarely|no longer)\b/i;
const FC_QUALIFIER_RE =
  /\b(only|just|may|might|could|possibly|probably|likely|unlikely|almost|nearly|sometimes|in some|in certain|at least|at most|up to)\b/i;
const FC_CONTRAST_RE =
  /\b(but|however|although|though|whereas|while|yet|despite|in contrast|on the other hand|versus|vs\.)\b/i;

export function fcSentenceIncompressible(sentence) {
  const t = String(sentence || "");
  return FC_NEGATION_RE.test(t) || FC_QUALIFIER_RE.test(t) || FC_CONTRAST_RE.test(t);
}

/**
 * Compress one sentence to at most `max` characters by deleting words.
 * Never invents, never cuts mid-word.
 */
/* Compression safety (2026-10-23, L7-13): a label may not be produced
   from a sentence carrying a contrast marker, a negation, or a
   comparator adjunct unless the qualifier would survive compression.
   Compression here deletes exactly those qualifiers, so it never
   survives: such a sentence yields no label at all and the step is
   skipped, not shortened. Returning an empty string is the skip
   signal; fcExtractSteps drops empty labels. */
const CONTRAST_MARKER_RE = /\b(while|whereas|but|despite|however|although|though|yet)\b/i;
const NEGATION_RE = /\b(no|not|never|without|fails? to|failed to|does not|did not|do not|cannot|can't|won't|isn't|aren't|wasn't|weren't)\b/i;
const COMPARATOR_ADJUNCT_RE = /\b(compared (?:with|to)|relative to|versus|vs\.?)\b/i;

export function fcCompressionUnsafe(raw) {
  const s = String(raw || "");
  return CONTRAST_MARKER_RE.test(s) || NEGATION_RE.test(s) || COMPARATOR_ADJUNCT_RE.test(s);
}

export function fcCompressStep(raw, max = 52) {
  // L7-13 (2026-10-23): unsafe sentences are skipped, not shortened.
  if (fcCompressionUnsafe(raw)) return "";
  // L5-15 composed at the Wave 3 S5 landing (2026-10-23): the
  // broader incompressible classes (qualifiers and the wider
  // negation forms) pass through whole, the fallback L5-15
  // allows and L7-13 does not govern.
  if (fcSentenceIncompressible(raw)) {
    const whole = String(raw || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.;:]+$/, "");
    return cap1(whole);
  }
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

/* ════════════════════════════════════════════════════════════════
   Diagram step model (2026 10 23, huge audit fix, Diagram Studio lane)

   A step is one object that owns its label, kind, detail, and source
   index. Every edit, move, insert, and delete works on that object as
   a unit, so a citation can never slide onto a step it did not come
   from. These helpers are pure so the grounding contract is testable
   without a browser.
   ════════════════════════════════════════════════════════════════ */

export const FC_LABEL_MAX = 120;

/* Word wrap a label into lines of about maxChars each. */
export function fcWrapText(label, maxChars) {
  const words = String(label || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (next.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/* Wrap with a hard line budget. Text past the budget is cut at a word
   boundary and the last kept line carries an ellipsis, so a label can
   never spill out of a box of a known height. */
export function fcWrapBounded(label, maxChars, maxLines) {
  const lines = fcWrapText(label, maxChars);
  const budget = Math.max(1, maxLines || 1);
  if (lines.length <= budget) return lines;
  const kept = lines.slice(0, budget);
  let last = kept[kept.length - 1];
  if (last.length > maxChars - 1) last = last.slice(0, maxChars - 1).trim();
  kept[kept.length - 1] = last + "…";
  return kept;
}

/* The Decision kind is gone until the model can hold two labelled
   exits (huge audit Bug 6). Existing decision steps load as process. */
export function fcCoerceStepType(t) {
  return t === "evidence" ? "evidence" : "process";
}

export function fcStepFromNode(n, fallbackId) {
  return {
    id: (n && n.id) || fallbackId || "step",
    label: (n && n.label) || "",
    type: fcCoerceStepType(n && n.type),
    detail: (n && n.detail) || "",
    sourceIdx: n && typeof n.sourceIdx === "number" ? n.sourceIdx : undefined,
  };
}

/* Order chart nodes along their edges from a root, a node with no
   incoming edge. Anything the walk cannot reach falls back to sorting
   by y then x. Start and end nodes are skipped. */
export function fcStepsFromChart(chart, makeId) {
  if (!chart || !Array.isArray(chart.nodes)) return [];
  const all = chart.nodes.filter((n) => n && n.id);
  const edges = Array.isArray(chart.edges) ? chart.edges : [];
  const byId = new Map(all.map((n) => [n.id, n]));
  const incoming = new Set();
  const outMap = new Map();
  for (const e of edges) {
    if (!e || !byId.has(e.from) || !byId.has(e.to)) continue;
    incoming.add(e.to);
    if (!outMap.has(e.from)) outMap.set(e.from, []);
    outMap.get(e.from).push(e.to);
  }
  const byPos = (a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0);
  const roots = all.filter((n) => !incoming.has(n.id)).sort(byPos);
  const ordered = [];
  const visited = new Set();
  const visit = (startId) => {
    const stack = [startId];
    while (stack.length) {
      const id = stack.shift();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const node = byId.get(id);
      if (!node) continue;
      ordered.push(node);
      const outs = outMap.get(id) || [];
      for (const outId of outs) if (!visited.has(outId)) stack.push(outId);
    }
  };
  for (const root of roots) visit(root.id);
  const rest = all.filter((n) => !visited.has(n.id)).sort(byPos);
  for (const n of rest) ordered.push(n);
  return ordered
    .filter((n) => n.type !== "start" && n.type !== "end")
    .map((n) => fcStepFromNode(n, makeId ? makeId() : undefined));
}

/* The sources a chart was saved with, and nothing else. A missing or
   malformed sources field means an empty list, never a borrowed one
   (huge audit Bug 2). */
export function fcChartSources(chart) {
  return chart && Array.isArray(chart.sources) ? chart.sources : [];
}

/* A save or an export needs at least one step with words on it. */
export function fcHasLabelledStep(list) {
  return Array.isArray(list) && list.some((s) => s && s.type !== "start" && s.type !== "end" && String(s.label || "").trim().length > 0);
}

/* Move one step as a unit. The step object itself travels, so its
   detail and source index travel with it. */
export function fcMoveStep(steps, id, delta) {
  const arr = Array.isArray(steps) ? [...steps] : [];
  const i = arr.findIndex((s) => s && s.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= arr.length) return arr;
  const [item] = arr.splice(i, 1);
  arr.splice(j, 0, item);
  return arr;
}

/* Older charts the step model cannot hold without loss: edges that
   are not a simple chain, edge labels, or input and output kinds.
   These open read only with a conversion offer (huge audit Bug 7). */
export function fcChartNeedsConversion(chart) {
  if (!chart || !Array.isArray(chart.nodes)) return false;
  const nodes = chart.nodes.filter((n) => n && n.id);
  if (nodes.some((n) => n.type === "io")) return true;
  const edges = Array.isArray(chart.edges) ? chart.edges : [];
  if (edges.some((e) => e && e.label && String(e.label).trim())) return true;
  const outCount = {};
  const inCount = {};
  for (const e of edges) {
    if (!e) continue;
    outCount[e.from] = (outCount[e.from] || 0) + 1;
    inCount[e.to] = (inCount[e.to] || 0) + 1;
  }
  if (Object.values(outCount).some((c) => c > 1)) return true;
  if (Object.values(inCount).some((c) => c > 1)) return true;
  return false;
}

/* Split source text into plain sentences, keeping the citation
   indices each sentence carried. Used to show the user the exact
   text an extraction worked from when it found too little. */
export function fcSplitSentences(text) {
  const clean = String(text || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/\n+/g, " ");
  const out = [];
  const parts = clean.split(/(?<=[.!?])\s+/);
  for (const part of parts) {
    const cites = [];
    for (const m of String(part).matchAll(CITE_RE)) {
      for (const n of m[1].split(",")) {
        const idx = parseInt(n.trim(), 10);
        if (idx > 0 && !cites.includes(idx)) cites.push(idx);
      }
    }
    const s = String(part).replace(CITE_RE, "").replace(/\s+/g, " ").trim().replace(/[.;:]+$/, "");
    if (s.length >= 8) out.push({ text: s, cites });
  }
  return out;
}

/* A label for a sentence a user picked by hand: compressed when that
   is safe, otherwise cut at a word boundary at the label limit. */
export function fcLabelFromSentence(text) {
  const compressed = fcCompressStep(text);
  const raw = compressed || String(text || "").replace(/\s+/g, " ").trim().replace(/[.;:]+$/, "");
  if (raw.length <= FC_LABEL_MAX) return cap1(raw);
  const cut = raw.slice(0, FC_LABEL_MAX);
  const sp = cut.lastIndexOf(" ");
  return cap1((sp > FC_LABEL_MAX * 0.55 ? cut.slice(0, sp) : cut).trim().replace(/[.;:,-]+$/, ""));
}

/* Turn steps into the node and edge chain the canvas and the exports
   share. makeNode(type, x, y, label, extra) supplies the geometry of
   one node; this builder grows each box to fit its wrapped label, and
   node and edge ids derive from step ids and chain position so they
   stay steady while the steps stay the same. */
export function fcBuildChain(steps, direction, makeNode) {
  const list = Array.isArray(steps) ? steps : [];
  const nodes = [];
  let cursor = 40;
  for (const step of list) {
    const type = fcCoerceStepType(step.type);
    const lines = fcWrapBounded(step.label || "", 24, 99);
    const extra = {};
    if (step.detail) extra.detail = step.detail;
    if (typeof step.sourceIdx === "number") extra.sourceIdx = step.sourceIdx;
    const across = direction === "across";
    const node = makeNode(type, across ? cursor : 420, across ? 120 : cursor, step.label || "", extra);
    node.id = "dsn-" + step.id;
    node.h = Math.max(node.h || 0, lines.length * 18 + 36);
    nodes.push(node);
    cursor += across ? (node.w || 200) + 100 : node.h + 84;
  }
  const edges = [];
  for (let i = 0; i + 1 < nodes.length; i += 1) {
    edges.push({ id: "dse-" + i, from: nodes[i].id, to: nodes[i + 1].id, label: "" });
  }
  return { nodes, edges };
}
