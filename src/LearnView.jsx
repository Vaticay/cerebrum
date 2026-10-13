/* Cerebrum Learn. Short courses built from real papers, not static cards.
 *
 * Every card in a course comes from text Cerebrum actually retrieved:
 * quiz options are real findings from real papers, battles are the real
 * literature conflicts the search reported, and nothing is paraphrased
 * into existence. If a search does not return enough cited findings,
 * no course is built. That is deliberate.
 *
 * Learning mechanics, from the literature on learning itself:
 * - Question first. A short pretest opens every course (pretesting
 *   effect: a failed guess plus feedback beats equal study time).
 * - Retrieval, not rereading. Lessons ask; they do not lecture.
 * - Predict the number. Findings with a result in them become cloze
 *   cards: guess the value before you see it.
 * - Spaced review. Every answered finding becomes a tracked claim with
 *   an FSRS style schedule. Claims resurface as they start to fade.
 * - Forgiving streaks. Two freezes, no hearts, no energy limits.
 *
 * Presentation (v3): an Imprint grade lesson experience built on that
 * engine. A library of course covers, a lesson path inside each course,
 * and a full screen player with one idea per card, a check step before
 * feedback, and a feedback sheet that quotes the paper itself.
 */

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Icon } from "./designSystem.jsx";

/* ── storage ─────────────────────────────────────────────────────── */
const COURSES_KEY = "cerebrum-learn2-courses";
const CLAIMS_KEY = "cerebrum-learn2-claims";
const PROFILE_KEY = "cerebrum-learn2-profile";
const SOUND_KEY = "cerebrum-learn2-sound";

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

export function loadLearnCourses() { return loadJSON(COURSES_KEY, []); }
export function saveLearnCourse(course) {
  const all = loadLearnCourses();
  const i = all.findIndex((c) => c.id === course.id);
  if (i >= 0) all[i] = course; else all.unshift(course);
  saveJSON(COURSES_KEY, all);
  return all;
}
function loadClaims() { return loadJSON(CLAIMS_KEY, {}); }
function saveClaims(claims) { saveJSON(CLAIMS_KEY, claims); }

function loadProfile() {
  const p = loadJSON(PROFILE_KEY, null);
  if (p) return p;
  let xp = 0;
  try { xp = parseInt(localStorage.getItem("cerebrum-learn-xp") || "0", 10) || 0; } catch { xp = 0; }
  return { xp, days: [], bridged: [], freezes: 2, freezeMilestone: 0 };
}
function saveProfile(p) { saveJSON(PROFILE_KEY, p); }

function todayKey(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function dayKeyOffset(days) {
  const d = new Date(); d.setDate(d.getDate() + days); return todayKey(d);
}

/* Touch today, bridge a single missed day with a freeze when one is
   available, and return the current streak length. */
function touchStreak(profile) {
  const today = todayKey();
  const set = new Set(profile.days);
  if (!set.has(today)) {
    const yesterday = dayKeyOffset(-1);
    const dayBefore = dayKeyOffset(-2);
    if (!set.has(yesterday) && set.has(dayBefore) && profile.freezes > 0) {
      profile.freezes -= 1;
      profile.bridged = [...(profile.bridged || []), yesterday];
      set.add(yesterday);
    }
    set.add(today);
    profile.days = [...set].sort();
  }
  let streak = 0;
  const cursor = set.has(today) ? 0 : -1;
  for (let i = cursor; ; i--) {
    if (set.has(dayKeyOffset(i))) streak++;
    else break;
  }
  // A 7 day streak earns a freeze back, up to the cap of 2.
  if (streak >= 7 && streak % 7 === 0 && profile.freezeMilestone !== streak) {
    profile.freezeMilestone = streak;
    profile.freezes = Math.min(2, profile.freezes + 1);
  }
  profile.streak = streak;
  saveProfile(profile);
  return profile;
}

/* ── claim scheduling (FSRS lite) ────────────────────────────────── */
const DAY_MS = 86400000;
function gradeClaim(claims, id, correct) {
  const c = claims[id];
  if (!c) return;
  const now = Date.now();
  c.reps = (c.reps || 0) + 1;
  c.last = now;
  if (correct) {
    c.stability = c.stability > 0 ? c.stability * 2.4 : 1;
    c.due = now + c.stability * DAY_MS;
  } else {
    c.lapses = (c.lapses || 0) + 1;
    c.stability = 0.25;
    c.due = now + 0.25 * DAY_MS;
  }
}
function retrievability(c, now = Date.now()) {
  if (!c || !c.last || !c.stability) return 0;
  const t = (now - c.last) / DAY_MS;
  return Math.pow(1 + t / (9 * c.stability), -1);
}
function dueClaims(claims) {
  const now = Date.now();
  return Object.values(claims)
    .filter((c) => c.reps > 0 && c.due && c.due <= now)
    .sort((a, b) => retrievability(a, now) - retrievability(b, now));
}

/* ── text helpers ────────────────────────────────────────────────── */
function cleanText(s) {
  return String(s || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[(\d+)\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}
function formatYearValue(y) {
  if (y == null || y === "") return "";
  if (typeof y === "number" && Number.isFinite(y)) return String(Math.trunc(y));
  const s = String(y).trim();
  const m = s.match(/\b(?:19|20)\d{2}\b/);
  if (m) return m[0];
  const n = Number(s);
  return Number.isFinite(n) ? String(Math.trunc(n)) : s;
}
function citeCountOf(source) {
  if (!source) return null;
  const raw = source.citations ?? source.citationCount ?? source.citedByCount ?? source.cited_by_count;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function shortCite(source) {
  if (!source) return "the paper";
  const a = String(source.authors || "").trim();
  let name = "";
  if (a) {
    const first = a.includes(",") ? a.split(",")[0].trim() : a.replace(/\s*et al\.?.*$/, "").trim();
    const words = first.split(/\s+/).filter(Boolean);
    // A token is initials, not a surname, when it is one letter, or a
    // short all caps run ("Q", "AR") in a string whose first word is
    // a real mixed case surname.
    const looksInitial = (tok) => {
      const clean = String(tok || "").replace(/[^A-Za-z]/g, "");
      if (clean.length <= 1) return true;
      return clean.length <= 3 && /^[A-Z]+$/.test(clean);
    };
    if (words.length === 0) name = "";
    else if (words.length === 1) name = looksInitial(words[0]) ? "" : words[0];
    else {
      // Author strings come in two shapes: "Firstname Surname" and
      // "Surname F" (surname followed by initials). Taking the last
      // word of the second shape yields the initials, which read as
      // nonsense in a question ("What did Q et al. report?", "What
      // did AR. report?"). When the last word is initials and the
      // first word is a plausible surname, the surname is word one.
      const last = words[words.length - 1];
      name = looksInitial(last) && /[a-z]/.test(words[0]) ? words[0] : last;
    }
    if (name && a.includes(",") || /et al/.test(a)) name += " et al.";
    if (name && name.replace(/[^A-Za-z]/g, "").length < 2) name = "";
  }
  const y = formatYearValue(source.year);
  const yr = y ? " (" + y + ")" : "";
  return (name || "This paper") + yr;
}
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function seededShuffle(arr, seed) {
  const out = [...arr];
  let s = seed || 1;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function normKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/* Pull cited findings out of an answer's markdown. Each claim keeps
   the index of the source it cites. Sections that are not findings
   (Sources, Try asking, Related topics) are skipped. */
/* A cited sentence is not automatically a finding. Citation fragments
   travel with real answers: attribution stacked sentences that name
   three papers and report nothing, stats debris that is mostly digits
   and brackets, and lines carrying a DOI or URL. As quiz options they
   read as garbled fragments, because they are. This guard keeps them
   out of the claim pool, which is also the distractor pool. */
/* The sentence splitter breaks on every period, including the ones
   inside "et al.", DOIs, URLs, initials, and decimals. That is where
   the garbled quiz options actually came from: "Smith et al. (2023)
   found..." lost its head and shipped as "(2023) found...". Protect
   those periods before splitting, restore them after. */
function protectPeriods(s) {
  let out = s.replace(/\S*(?:https?:\/\/|doi\.org\/|www\.)\S*/g, (m) => m.replace(/\./g, "\u0001"));
  out = out.replace(/\b(?:e\.g\.|i\.e\.|et al\.|vs\.|Fig\.|Dr\.|Mr\.|Mrs\.|Ms\.|St\.|approx\.)/gi, (m) => m.replace(/\./g, "\u0001"));
  out = out.replace(/\b([A-Z])\./g, "$1\u0001");
  out = out.replace(/(\d)\.(\d)/g, "$1\u0001$2").replace(/(\d)\.(\d)/g, "$1\u0001$2");
  return out;
}

function looksLikeFragment(text) {
  if (/https?:\/\/|doi\.org|\bdoi:/i.test(text)) return true;
  const years = text.match(/\b(?:19|20)\d{2}\b/g) || [];
  if (years.length >= 3) return true;
  const etAls = text.match(/\bet al\b/g) || [];
  if (etAls.length >= 2) return true;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  if (letters / text.length < 0.52) return true;
  if (/^\(?\d{4}\)?[.,]/.test(text) || /^\[\d+\]/.test(text)) return true;
  return false;
}

function extractClaims(answerMd) {
  const claims = [];
  if (!answerMd) return claims;
  let skip = false;
  // Some answers arrive flattened onto one line with the headings
  // inline. Give each heading its own line first, or the whole
  // answer reads as a single heading and yields no claims at all.
  const flattened = String(answerMd).replace(/\s+(#{1,6}\s+)/g, "\n$1");
  for (const rawLine of flattened.split("\n")) {
    let line = rawLine.trim();
    const head = line.match(/^#{1,4}\s+(.*)$/);
    if (head) {
      // Only the heading's own words decide skipping. On flattened
      // lines the remainder carries body text, and a body mention of
      // the word sources must not skip the whole section.
      const headWords = head[1].split(/\s+/).slice(0, 8).join(" ");
      if (/sources|references|try asking|related topics/i.test(headWords)) { skip = true; continue; }
      skip = false;
      // A flattened heading can share its line with real cited
      // sentences. Keep the remainder; the bare heading words carry
      // no citation and are filtered out below on their own.
      line = head[1].trim();
      if (!line) continue;
    }
    if (skip || !line) continue;
    const isBullet = /^[-•]\s+/.test(line);
    const text0 = line.replace(/^[-•]\s+/, "");
    const cites = [...text0.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10));
    if (cites.length === 0) continue;
    // Split long paragraphs into sentences, each keeping the citation.
    // Periods inside abbreviations, DOIs, URLs, and decimals are
    // protected first so a sentence is never sawn in half mid-token.
    const protectedText = protectPeriods(text0);
    const sentences = protectedText.match(/[^.!?]+[.!?]+["']?\s*(?:\[\d+\]\s*)*/g) || [protectedText];
    for (const sent of sentences) {
      const sc = [...sent.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10));
      const useCites = sc.length ? sc : (isBullet ? cites : []);
      if (!useCites.length) continue;
      let text = cleanText(sent.replace(/\u0001/g, "."));
      const beforeScaffold = text;
      text = text.replace(/^(the short answer|what the research shows|where researchers disagree|how solid is the evidence)(?:\s+is)?\s*[:.]?\s+/i, "");
      if (text !== beforeScaffold && text) text = text.charAt(0).toUpperCase() + text.slice(1);
      if (text.length < 42 || text.length > 340) continue;
      if (/^(this|the) (answer|search|section)\b/i.test(text)) continue;
      // Publisher page furniture sometimes travels with a citation
      // (author page boilerplate, sign in prompts, rights lines). It
      // is never a finding, so it never becomes a claim.
      if (/oxford academic|all rights reserved|copyright|sign in|privacy policy|terms of use|cookie/i.test(text)) continue;
      if (looksLikeFragment(text)) continue;
      claims.push({ text, sourceIdx: useCites[0] });
    }
  }
  const seen = new Set();
  return claims.filter((c) => {
    const k = c.text.slice(0, 60).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const NUMBER_RE = /(\d[\d,]*(?:\.\d+)?\s?%|\d[\d,]*(?:\.\d+)?\s?-fold|p\s?<\s?0\.\d+|\d[\d,]*(?:\.\d+)?\s?(?:mg\/kg|mg|kg|°C|days|weeks|months|hours|participants|patients|subjects|volunteers|athletes|adults|children|men|women)|\d[\d,]*(?:\.\d+)?-(?:day|week|month|year|hour|minute))/;
function numbersIn(claims) {
  const out = [];
  for (const c of claims) {
    const m = c.text.match(NUMBER_RE);
    if (m) out.push(m[1].replace(/\s+/g, " ").trim());
  }
  return [...new Set(out)];
}

/* ── course generation ───────────────────────────────────────────── */
let claimSeq = 0;

/* Distractors used to be other papers' findings, so the right answer
   was the one whose words matched the topic: a word matching game,
   not recall. Distractors now come from the claim itself with one
   fact changed (a scaled number, a flipped direction), so every
   option shares the same words and only knowledge separates them.
   Real findings remain as fallback, preferring the ones that share
   the claim's vocabulary so topic matching still fails there. */
const FLIP_WORDS = {
  increased: "decreased", decreased: "increased", higher: "lower", lower: "higher",
  more: "less", less: "more", improved: "declined", declined: "improved",
  worsened: "improved", reduced: "increased", greater: "smaller", smaller: "greater",
  stronger: "weaker", weaker: "stronger", faster: "slower", slower: "faster",
  before: "after", after: "before", above: "below", below: "above",
  rose: "fell", fell: "rose", gained: "lost", lost: "gained",
};
function flipDirection(text) {
  const m = text.match(new RegExp("\\b(" + Object.keys(FLIP_WORDS).join("|") + ")\\b", "i"));
  if (!m) return null;
  const word = m[1];
  const flipped = FLIP_WORDS[word.toLowerCase()];
  const repl = word[0] === word[0].toUpperCase() ? flipped[0].toUpperCase() + flipped.slice(1) : flipped;
  return text.replace(m[0], repl);
}
function scaleNumberIn(text, factor, salt) {
  const m = text.match(NUMBER_RE);
  if (!m) return null;
  const raw = m[1];
  const numMatch = raw.match(/[\d,]+(?:\.\d+)?/);
  if (!numMatch) return null;
  const orig = parseFloat(numMatch[0].replace(/,/g, ""));
  if (!isFinite(orig) || orig === 0) return null;
  let next = orig < 5 ? orig + 2 : orig * factor;
  const decimals = (numMatch[0].split(".")[1] || "").length;
  let formatted = decimals ? next.toFixed(decimals) : String(Math.round(next));
  if (numMatch[0].includes(",") && next >= 1000) formatted = Number(formatted).toLocaleString("en-US");
  if (formatted === numMatch[0]) return null;
  return text.replace(raw, raw.replace(numMatch[0], formatted)) + (salt ? "" : "");
}
function mutatedVariants(claim, allClaims) {
  const out = [];
  const flipped = flipDirection(claim.text);
  if (flipped && flipped !== claim.text) out.push(flipped);
  const s1 = scaleNumberIn(claim.text, 1.5);
  if (s1 && s1 !== claim.text && !out.includes(s1)) out.push(s1);
  const s2 = scaleNumberIn(claim.text, 0.6);
  if (s2 && s2 !== claim.text && !out.includes(s2)) out.push(s2);
  return out;
}
function nearestClaims(claim, allClaims, n) {
  const words = new Set((claim.text.toLowerCase().match(/[a-z]{5,}/g) || []));
  const scored = allClaims
    .filter((c) => c.text !== claim.text)
    .map((c) => ({
      c,
      overlap: (c.text.toLowerCase().match(/[a-z]{5,}/g) || []).filter((w) => words.has(w)).length,
    }))
    .sort((a, b) => b.overlap - a.overlap);
  const top = scored.slice(0, 6).map((x) => x.c);
  return seededShuffle(top, hashStr(claim.text) + 3).slice(0, n).map((c) => c.text);
}
function quizCard(claim, allClaims, sources, opts = {}) {
  const source = sources[claim.sourceIdx - 1];
  const variants = mutatedVariants(claim, allClaims);
  let distract;
  if (variants.length >= 3) distract = variants.slice(0, 3);
  else if (variants.length > 0) distract = [...variants, ...nearestClaims(claim, allClaims, 3 - variants.length)];
  else distract = nearestClaims(claim, allClaims, 3);
  const options = seededShuffle([claim.text, ...distract], hashStr(claim.text) + 7);
  return {
    kind: "quiz",
    claimId: "cl" + hashStr(claim.text) + "-" + (claimSeq++),
    question: "Which of these matches what the evidence actually found?",
    options,
    correct: options.indexOf(claim.text),
    why: claim.text,
    cite: shortCite(source),
    paperTitle: source ? source.title : "",
    pretest: !!opts.pretest,
    lessonHint: opts.lessonHint || "",
  };
}
function clozeCard(claim, allClaims, sources) {
  const m = claim.text.match(NUMBER_RE);
  if (!m) return null;
  const source = sources[claim.sourceIdx - 1];
  const value = m[1].replace(/\s+/g, " ").trim();
  // Distractor values mix numbers from sibling claims with scaled
  // variants of the true value, so recognizing a familiar number is
  // not enough; the value itself has to be recalled.
  const scaled = [scaleNumberIn(claim.text, 1.5), scaleNumberIn(claim.text, 0.6)]
    .filter(Boolean)
    .map((t) => { const mm = t.match(NUMBER_RE); return mm ? mm[1].replace(/\s+/g, " ").trim() : null; })
    .filter((v) => v && v !== value);
  const others = numbersIn(allClaims).filter((n) => n !== value && !scaled.includes(n));
  const pool = [...new Set([...scaled, ...seededShuffle(others, hashStr(claim.text))])];
  if (pool.length < 2) return null;
  const picks = pool.slice(0, 3);
  const options = seededShuffle([value, ...picks], hashStr(claim.text) + 13);
  return {
    kind: "cloze",
    claimId: "cl" + hashStr(claim.text) + "-" + (claimSeq++),
    prompt: claim.text.replace(m[1], "_____"),
    question: "Predict the result: what value completes this finding?",
    options,
    correct: options.indexOf(value),
    why: claim.text,
    cite: shortCite(source),
    paperTitle: source ? source.title : "",
  };
}
/* Vocabulary, honestly: no invented definitions. Terms are pulled
   from the findings themselves (capitalized names mid sentence,
   scientific suffix words), and each is taught inside the sentence
   that used it. The course complete screen lists them with their
   findings, which is the context that makes a term stick. */
const VOCAB_STOP = new Set([
  "study", "studies", "results", "result", "effects", "group", "groups",
  "compared", "analysis", "research", "patients", "participants",
  "treatment", "control", "significant", "significantly", "however",
  "showed", "found", "using", "based", "model", "models", "data",
]);
function extractVocab(claims) {
  const byTerm = new Map();
  const add = (term, claim) => {
    const t = (term || "").trim();
    if (t.length < 4 || t.length > 34) return;
    if (VOCAB_STOP.has(t.toLowerCase())) return;
    const key = t.toLowerCase();
    if (!byTerm.has(key)) byTerm.set(key, { term: t, claim });
  };
  for (const claim of claims) {
    for (const m of claim.text.matchAll(/(?<=[a-z,;] )([A-Z][a-z]{3,})(?:\s([A-Z][a-z]{3,}))?/g)) {
      add(m[2] ? m[1] + " " + m[2] : m[1], claim);
    }
    for (const m of claim.text.matchAll(/\b([a-z]{5,}(?:tion|sis|ome|ase|itis|gen|some|phagy))\b/gi)) {
      add(m[1].toLowerCase(), claim);
    }
  }
  return [...byTerm.values()].slice(0, 6);
}
function vocabCard(entry, allTerms, sources) {
  const claim = entry.claim;
  const source = sources[claim.sourceIdx - 1];
  const esc = entry.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blanked = claim.text.replace(new RegExp(esc, "i"), "_____");
  if (blanked === claim.text) return null;
  const others = seededShuffle(
    allTerms.filter((t) => t.term !== entry.term).map((t) => t.term),
    hashStr(entry.term) + 5
  ).slice(0, 3);
  if (others.length < 2) return null;
  const options = seededShuffle([entry.term, ...others], hashStr(entry.term) + 21);
  return {
    kind: "quiz",
    claimId: "voc" + hashStr(entry.term + claim.text) + "-" + (claimSeq++),
    question: "Which term completes this finding?",
    prompt: blanked,
    options,
    correct: options.indexOf(entry.term),
    why: claim.text,
    cite: shortCite(source),
    paperTitle: source ? source.title : "",
    vocab: entry.term,
  };
}

/* Hex accent at an alpha, for soft fills. Falls back to the raw
   colour when it is not a plain hex value. */
function withAlphaSafe(hex, a) {
  const m = String(hex || "").match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return "rgba(" + ((n >> 16) & 255) + ", " + ((n >> 8) & 255) + ", " + (n & 255) + ", " + a + ")";
}

/* Finding text with its numbers lifted out in the accent colour:
   the values are what the learner will be asked to recall, so the
   eye should land on them while reading. */
function emphasizeFinding(text, accent) {
  const parts = String(text || "").split(NUMBER_RE);
  return parts.map((part, i) => {
    if (i % 2 === 1) return <strong key={i} style={{ color: accent, fontWeight: 800 }}>{part}</strong>;
    return part;
  });
}

function paperCard(source, claim) {
  const year = formatYearValue(source && source.year);
  return {
    kind: "paper",
    title: source.title || "Untitled paper",
    meta: [source.authors, source.journal, year].filter(Boolean).join(" · "),
    year,
    citations: citeCountOf(source),
    text: claim ? claim.text : (source.tldr ? cleanText(source.tldr) : ""),
  };
}

/* Build a course from a finished search. Returns null when the search
   did not produce enough cited findings to teach from honestly. */
export function createCourseFromResults(query, sources, answerMd, conflicts) {
  const srcs = (sources || []).filter((s) => s && s.title);
  if (srcs.length < 2) return null;
  // A paper's own title is not a finding. Answers sometimes restate a
  // title as a cited sentence, and it reads as nonsense when it turns
  // up as a quiz option, so title matches never become claims.
  const titleKeys = new Set(srcs.map((s) => normKey(s.title)).filter((t) => t.length > 12));
  const claims = extractClaims(answerMd).filter((c) => {
    const k = normKey(c.text);
    if (titleKeys.has(k)) return false;
    for (const t of titleKeys) if (k.length > 12 && t.includes(k)) return false;
    return true;
  });
  if (claims.length < 3) return null;

  const bySource = new Map();
  for (const c of claims) {
    if (!bySource.has(c.sourceIdx)) bySource.set(c.sourceIdx, []);
    bySource.get(c.sourceIdx).push(c);
  }
  const taught = srcs
    .map((s, i) => ({ source: s, idx: i + 1, claims: bySource.get(i + 1) || [] }))
    .filter((p) => p.claims.length > 0);
  if (taught.length < 2) return null;

  const yearNum = (s) => { const y = parseInt(formatYearValue(s && s.year), 10); return Number.isFinite(y) ? y : 9999; };
  const byYear = [...taught].sort((a, b) => yearNum(a.source) - yearNum(b.source));
  const byCites = [...taught].sort((a, b) => (citeCountOf(b.source) || 0) - (citeCountOf(a.source) || 0));
  const usedClaims = new Set();
  const take = (c) => { usedClaims.add(c.text); return c; };

  const lessons = [];

  // Lesson 1: pretest, questions before teaching.
  if (claims.length >= 6) {
    const picks = seededShuffle(claims, hashStr(query)).slice(0, 2);
    lessons.push({
      id: "pretest", title: "Before you read", subtitle: "Guess first. Being wrong here makes the answer stick.",
      cards: picks.map((c) => quizCard(take(c), claims, srcs, { pretest: true, lessonHint: "the evidence lessons" })),
    });
  }

  // Lesson 2: foundations, the earliest work.
  {
    const cards = [{ kind: "note", kicker: "Foundations", title: "Where this started", text: "The earliest papers in the set, and what each one actually found." }];
    for (const p of byYear.slice(0, 3)) {
      const c = p.claims.find((x) => !usedClaims.has(x.text)) || p.claims[0];
      cards.push(paperCard(p.source, c));
      cards.push(quizCard(take(c), claims, srcs));
    }
    lessons.push({ id: "foundations", title: "Foundations", subtitle: "The earliest evidence", cards });
  }

  // Lesson 3: the strongest evidence, by citation weight.
  {
    const rest = byCites.filter((p) => !byYear.slice(0, 3).includes(p));
    const poolPapers = (rest.length ? rest : byCites).slice(0, 4);
    const cards = [{ kind: "note", kicker: "Key evidence", title: "What the research shows", text: "The most cited work in the set. Read the finding, then prove you can recall it." }];
    for (const p of poolPapers) {
      const c = p.claims.find((x) => !usedClaims.has(x.text)) || p.claims[0];
      cards.push(paperCard(p.source, c));
      const cz = clozeCard(c, claims, srcs);
      if (cz && !usedClaims.has(c.text + "|cloze")) { usedClaims.add(c.text + "|cloze"); cards.push(cz); }
      else cards.push(quizCard(take(c), claims, srcs));
    }
    lessons.push({ id: "evidence", title: "Key Evidence", subtitle: "The most cited findings", cards });
  }

  // Vocabulary lesson: the field's terms, in the findings that use them.
  const vocab = extractVocab(claims);
  if (vocab.length >= 3) {
    const cards = [{ kind: "note", kicker: "Vocabulary", title: "The language of the field", text: "Every field has words that carry whole ideas. These are this course's terms, each one inside the finding that used it. Fill in the term from the sense of the sentence." }];
    for (const entry of vocab.slice(0, 4)) {
      const vc = vocabCard(entry, vocab, srcs);
      if (vc) cards.push(vc);
    }
    if (cards.length > 1) lessons.push({ id: "vocab", title: "Vocabulary", subtitle: "Terms in context", cards });
  }

  // Lesson 4: real disagreements only.
  const realConflicts = (conflicts || []).filter((c) => c && c.claimA && c.claimB);
  if (realConflicts.length > 0) {
    const cards = [{ kind: "note", kicker: "Claim battles", title: "Where scientists disagree", text: "These are real conflicting findings from this search, quoted as reported. Pick the side you find stronger, then see both." }];
    for (const c of realConflicts.slice(0, 3)) {
      cards.push({
        kind: "battle",
        claimA: cleanText(c.claimA), sourceA: c.sourceA || "One study",
        claimB: cleanText(c.claimB), sourceB: c.sourceB || "Another study",
        question: "Which finding do you find more convincing?",
      });
    }
    lessons.push({ id: "battles", title: "Debates", subtitle: "Real conflicting findings", cards });
  }

  // Lesson 5: open questions and the wrap.
  {
    const open = claims.filter((c) => /unknown|unclear|remains? (to|un)|not yet|future (work|research|studies)|further research|gap/i.test(c.text)).slice(0, 2);
    const cards = open.map((c) => ({
      kind: "note", kicker: "Open question", title: "What we still do not know",
      text: c.text, cite: shortCite(srcs[c.sourceIdx - 1]),
    }));
    const years = taught.map((p) => parseInt(formatYearValue(p.source.year), 10)).filter((y) => Number.isFinite(y));
    cards.push({
      kind: "summary",
      title: "Course complete",
      text: "You worked through " + taught.length + " papers" +
        (years.length ? " spanning " + Math.min(...years) + " to " + Math.max(...years) : "") +
        ". The findings you answered are now on a review schedule. They will come back as they start to fade, which is when review does the most good.",
    });
    lessons.push({ id: "wrap", title: "Open Questions", subtitle: "The edge of the field", cards });
  }

  const course = {
    id: "course-" + Date.now(),
    query: query || "",
    title: query || "Course",
    createdAt: new Date().toISOString(),
    sourceCount: srcs.length,
    lessons,
    doneLessons: [],
    xpEarned: 0,
    vocab: vocab.map((v) => ({ term: v.term, text: v.claim.text, cite: shortCite(srcs[v.claim.sourceIdx - 1]) })),
  };

  // Register every interactive card's claim for spaced review.
  const claimsStore = loadClaims();
  for (const lesson of lessons) {
    for (const card of lesson.cards) {
      if (card.claimId && (card.kind === "quiz" || card.kind === "cloze")) {
        claimsStore[card.claimId] = {
          id: card.claimId, courseId: course.id, courseTitle: course.title,
          card: { kind: card.kind, question: card.question, prompt: card.prompt, options: card.options, correct: card.correct, why: card.why, cite: card.cite },
          stability: 0, due: 0, reps: 0, lapses: 0, last: 0,
        };
      }
    }
  }
  saveClaims(claimsStore);
  return course;
}

/* ── sound: three small synth notes, no audio assets ─────────────── */
let audioCtx = null;
function blip(freq, at, dur = 0.09, type = "sine", gain = 0.05) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime + at;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  } catch { /* sound is decoration; never break the lesson */ }
}
function playSound(kind, enabled) {
  if (!enabled) return;
  if (kind === "correct") { blip(660, 0); blip(880, 0.09); }
  else if (kind === "wrong") { blip(170, 0, 0.16, "triangle", 0.06); }
  else if (kind === "complete") { blip(523, 0); blip(659, 0.1); blip(784, 0.2, 0.14); }
  else blip(520, 0, 0.05, "sine", 0.03);
}

/* ── shared styles ───────────────────────────────────────────────── */
const SERIF = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
const CSS = `
.lv-rise { animation: lvRise .45s cubic-bezier(.05,.7,.1,1) both; }
@keyframes lvRise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
.lv-sheet { animation: lvSheet .38s cubic-bezier(.05,.7,.1,1) both; }
@keyframes lvSheet { from { transform: translateY(102%); } to { transform: none; } }
.lv-btn { transition: transform 80ms linear, box-shadow 80ms linear, background .15s, opacity .15s; }
.lv-btn-primary { box-shadow: 0 4px 0 rgba(0,0,0,.38); }
.lv-btn-primary:active { transform: translateY(4px); box-shadow: 0 0 0 rgba(0,0,0,0); }
.lv-opt { transition: border-color .15s, background .15s, transform .15s; }
.lv-opt:not(:disabled):hover { transform: translateY(-1px); }
.lv-shake { animation: lvShake .4s ease both; }
@keyframes lvShake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
.lv-pop { animation: lvPop .3s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes lvPop { from { transform: scale(0); } to { transform: scale(1); } }
.lv-fill { transition: width .5s cubic-bezier(.05,.7,.1,1); }
.lv-pulse { animation: lvPulse 1.8s ease-in-out infinite; }
@keyframes lvPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(255,255,255,.28); } 50% { box-shadow: 0 0 0 9px rgba(255,255,255,0); } }
.lv-node { transition: transform .15s; }
.lv-node:hover { transform: translateY(-2px); }
.lv-catalog { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: 16px; }
.lv-topic { transition: transform .15s, border-color .15s; }
.lv-topic:hover { transform: translateY(-2px); }
.lv-chip { transition: background .15s, color .15s, border-color .15s; }
@media (max-width: 680px) {
  .lv-home { padding: 22px 16px 44px !important; }
  .lv-head { flex-direction: column !important; gap: 12px !important; }
  .lv-h1 { font-size: 29px !important; }
  .lv-sub { font-size: 14.5px !important; }
  .lv-pills { flex-wrap: nowrap !important; overflow-x: auto; padding-bottom: 6px; scrollbar-width: none; }
  .lv-pills::-webkit-scrollbar { display: none; }
  .lv-catalog { grid-template-columns: 1fr 1fr; gap: 12px; }
  .lv-hero-title { font-size: 21px !important; }
}
@media (max-width: 430px) {
  .lv-catalog { grid-template-columns: 1fr; }
}
`;

/* Deterministic cover art for a course: deep paired tones chosen by a
   hash of the title, a soft radial glow, and the topic's first letter
   set in large serif. No images, nothing invented, always available. */
const COVER_PAIRS = [
  ["#1d3b2a", "#0e2417"], ["#27354d", "#131e30"], ["#3d2c1e", "#241708"],
  ["#33233f", "#1c1226"], ["#173d3a", "#0a2422"], ["#42252b", "#281116"],
  ["#2c3a1c", "#18230c"], ["#1e3a4d", "#0e2432"], ["#3f3418", "#261e08"],
];
function Cover({ title, height, radius = 16, fontSize, cat, img }) {
  const [imgOk, setImgOk] = useState(true);
  if (img && imgOk) {
    return (
      <div aria-hidden="true" style={{ height, borderRadius: radius, position: "relative", overflow: "hidden", flexShrink: 0, background: "#14161c" }}>
        <img src={img} alt="" loading="lazy" onError={() => setImgOk(false)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "40%", background: "linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.20))" }} />
      </div>
    );
  }
  if (cat) return <CategoryArt motif={cat.motif} pair={cat.pair} height={height} radius={radius} />;
  const h = hashStr(String(title || "Course"));
  const pair = COVER_PAIRS[h % COVER_PAIRS.length];
  const letter = String(title || "C").trim().replace(/^[^A-Za-z0-9]+/, "").charAt(0).toUpperCase() || "C";
  return (
    <div aria-hidden="true" style={{
      height, borderRadius: radius, position: "relative", overflow: "hidden", flexShrink: 0,
      background: "radial-gradient(120% 150% at 18% 0%, " + pair[0] + " 0%, " + pair[1] + " 72%)",
    }}>
      <div style={{
        position: "absolute", right: -28, top: -38, fontFamily: SERIF, fontWeight: 600,
        fontSize: fontSize || Math.round(height * 1.5), lineHeight: 1, color: "rgba(255,255,255,.13)",
        userSelect: "none",
      }}>{letter}</div>
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 0, height: "46%",
        background: "linear-gradient(rgba(255,255,255,.07), rgba(255,255,255,0))",
      }} />
      <div style={{
        position: "absolute", left: 16, bottom: 12, width: 34, height: 3, borderRadius: 999,
        background: "rgba(255,255,255,.55)",
      }} />
    </div>
  );
}

/* ── the catalog ─────────────────────────────────────────────────────
   Shelves of science a visitor can start without inventing a query,
   the Imprint lesson applied to a literature engine: the catalog is
   curated, but every course on it is built live from real papers when
   tapped. Art is a small flat illustration system drawn in SVG, one
   motif per shelf, in the shelf's own deep tones. */
const CATALOG = [
  { name: "Mind and Brain", motif: "brain", pair: ["#27354d", "#131e30"], topics: [
    { t: "Sleep and Memory", q: "sleep memory consolidation", b: "Why a night of sleep decides what you keep.", img: "/assets/cortex/sleep-memory.jpg" },
    { t: "The Predicting Brain", q: "predictive processing brain perception", b: "Your brain guesses the world first, then checks.", img: "/assets/cortex/predicting-brain.jpg" },
    { t: "Attention Under Siege", q: "attention focus distraction cognition", b: "What focus actually is, and what steals it.", img: "/assets/cortex/attention.jpg" },
    { t: "Why We Dream", q: "dreaming REM sleep function", b: "The oldest open question in sleep science.", img: "/assets/cortex/dreams.jpg" },
  ]},
  { name: "Body and Health", motif: "pulse", pair: ["#42252b", "#281116"], topics: [
    { t: "Exercise and Longevity", q: "exercise longevity mortality", b: "How much movement buys how much life, per the data.", img: "/assets/cortex/exercise-longevity.jpg" },
    { t: "The Gut Immune Alliance", q: "gut microbiome immune system", b: "Your microbes are negotiating with your immune system.", img: "/assets/cortex/gut-immune.jpg" },
    { t: "Fasting and Metabolism", q: "intermittent fasting metabolism", b: "What skipping meals does, and what it does not.", img: "/assets/cortex/fasting.jpg" },
    { t: "Pain, Explained", q: "pain perception neuroscience", b: "Pain is an opinion the brain can revise.", img: "/assets/cortex/pain.jpg" },
  ]},
  { name: "Life and Evolution", motif: "helix", pair: ["#1d3b2a", "#0e2417"], topics: [
    { t: "Editing the Code of Life", q: "CRISPR gene editing", b: "Gene editing, from the first papers to the fights.", img: "/assets/cortex/crispr.jpg" },
    { t: "Why We Age", q: "cellular aging senescence", b: "Cells keep time. Here is what the clocks look like.", img: "/assets/cortex/aging.jpg" },
    { t: "Minds of Other Animals", q: "animal cognition consciousness", b: "Which animals know what, and how we can tell.", img: "/assets/cortex/animal-minds.jpg" },
    { t: "The First Life", q: "origin of life abiogenesis", b: "Chemistry that learned to copy itself.", img: "/assets/cortex/first-life.jpg" },
  ]},
  { name: "Earth and Climate", motif: "earth", pair: ["#173d3a", "#0a2422"], topics: [
    { t: "Oceans in Motion", q: "ocean currents climate", b: "The conveyor that sets the weather.", img: "/assets/cortex/oceans.jpg" },
    { t: "The Soil Beneath Us", q: "soil microbiome carbon", b: "A teaspoon of soil holds a civilization.", img: "/assets/cortex/soil.jpg" },
    { t: "Forests and Carbon", q: "forests carbon sequestration", b: "What trees actually do with carbon, measured.", img: "/assets/cortex/forests.jpg" },
    { t: "Extreme Weather", q: "extreme weather attribution climate change", b: "How scientists pin a storm to a warming world.", img: "/assets/cortex/extreme-weather.jpg" },
  ]},
  { name: "Space and Physics", motif: "orbit", pair: ["#33233f", "#1c1226"], topics: [
    { t: "Black Holes", q: "black hole event horizon", b: "The edge where physics files its complaints.", img: "/assets/cortex/black-holes.jpg" },
    { t: "The Shape of Spacetime", q: "space time general relativity", b: "Gravity is geometry. The papers that proved it.", img: "/assets/cortex/spacetime.jpg" },
    { t: "Quantum Machines", q: "quantum computing error correction", b: "Computers that borrow probability itself.", img: "/assets/cortex/quantum.jpg" },
    { t: "Worlds Around Other Stars", q: "exoplanet atmospheres habitability", b: "Reading the air of planets we will never touch.", img: "/assets/cortex/exoplanets.jpg" },
  ]},
  { name: "The Living World", motif: "microbe", pair: ["#2c3a1c", "#18230c"], topics: [
    { t: "The Insect Gut", q: "insect gut microbiome", b: "Tiny stomachs running serious chemistry.", img: "/assets/cortex/insect-gut.jpg" },
    { t: "Fermentation", q: "fermentation microbes food", b: "The oldest food technology is alive.", img: "/assets/cortex/fermentation.jpg" },
    { t: "Microbes and Crops", q: "plant microbiome agriculture", b: "Farms are ecosystems, roots first.", img: "/assets/cortex/crops.jpg" },
    { t: "The Ocean's Smallest", q: "marine microbes phytoplankton", b: "Half your oxygen comes from these.", img: "/assets/cortex/ocean-smallest.jpg" },
  ]},
];

function CategoryArt({ motif, pair, height, radius = 16 }) {
  const line = "rgba(255,255,255,0.55)";
  const soft = "rgba(255,255,255,0.26)";
  let art = null;
  if (motif === "helix") {
    const pts = (phase) => Array.from({ length: 41 }, (_, i) => {
      const x = 30 + i * 8.5;
      const y = 120 + Math.sin(i / 4.6 + phase) * 52;
      return x + "," + y.toFixed(1);
    }).join(" ");
    const rungs = [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const x = 62 + i * 46;
      const t = (x - 30) / 8.5 / 4.6;
      return <line key={i} x1={x} y1={120 + Math.sin(t) * 52} x2={x} y2={120 + Math.sin(t + Math.PI) * 52} stroke={soft} strokeWidth="2" />;
    });
    art = (<>{rungs}<polyline points={pts(0)} fill="none" stroke={line} strokeWidth="2.5" /><polyline points={pts(Math.PI)} fill="none" stroke={soft} strokeWidth="2.5" /></>);
  } else if (motif === "orbit") {
    art = (<>
      <ellipse cx="200" cy="120" rx="150" ry="52" fill="none" stroke={line} strokeWidth="2" />
      <ellipse cx="200" cy="120" rx="150" ry="52" fill="none" stroke={soft} strokeWidth="2" transform="rotate(58 200 120)" />
      <ellipse cx="200" cy="120" rx="150" ry="52" fill="none" stroke={soft} strokeWidth="2" transform="rotate(122 200 120)" />
      <circle cx="200" cy="120" r="13" fill="#fff" opacity="0.85" />
      <circle cx="308" cy="76" r="6" fill="#fff" opacity="0.8" />
    </>);
  } else if (motif === "pulse") {
    art = (<>
      <polyline points="10,120 118,120 146,120 168,72 198,170 220,120 390,120" fill="none" stroke={line} strokeWidth="3" strokeLinejoin="round" />
      <circle cx="168" cy="72" r="6" fill="#fff" opacity="0.85" />
      <circle cx="316" cy="120" r="3.5" fill="#fff" opacity="0.5" />
    </>);
  } else if (motif === "earth") {
    art = (<>
      <circle cx="176" cy="120" r="86" fill="none" stroke={line} strokeWidth="2.5" />
      <path d="M96 96 Q176 132 256 92" fill="none" stroke={soft} strokeWidth="2.5" />
      <path d="M92 150 Q180 108 260 148" fill="none" stroke={soft} strokeWidth="2.5" />
      <circle cx="318" cy="60" r="17" fill="none" stroke={line} strokeWidth="2.5" />
    </>);
  } else if (motif === "microbe") {
    const dots = [[90, 80, 26], [180, 140, 17], [262, 76, 21], [322, 150, 13], [130, 178, 11], [228, 190, 8], [70, 150, 8], [302, 202, 6]];
    art = (<>{dots.map(([cx, cy, r], i) => (
      <g key={i}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={i % 2 ? soft : line} strokeWidth="2.5" />
        <circle cx={cx} cy={cy} r={Math.max(3, r / 3.4)} fill="#fff" opacity="0.5" />
      </g>
    ))}</>);
  } else if (motif === "peaks") {
    art = (<>
      <polyline points="0,196 90,96 150,160 236,66 400,196" fill="none" stroke={line} strokeWidth="2.5" strokeLinejoin="round" />
      <polyline points="0,214 120,140 210,196 300,128 400,214" fill="none" stroke={soft} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="330" cy="52" r="11" fill="#fff" opacity="0.8" />
    </>);
  } else {
    art = (<>
      <path d="M261 47 A95 95 0 1 0 261 193" fill="none" stroke={line} strokeWidth="3" strokeLinecap="round" />
      <path d="M240 79 A62 62 0 1 0 240 161" fill="none" stroke={soft} strokeWidth="3" strokeLinecap="round" />
      <circle cx="196" cy="120" r="11" fill="#fff" opacity="0.9" />
      <circle cx="86" cy="70" r="3.5" fill="#fff" opacity="0.6" />
      <circle cx="66" cy="168" r="3" fill="#fff" opacity="0.45" />
    </>);
  }
  return (
    <div aria-hidden="true" style={{
      height, borderRadius: radius, position: "relative", overflow: "hidden", flexShrink: 0,
      background: "radial-gradient(120% 150% at 18% 0%, " + pair[0] + " 0%, " + pair[1] + " 74%)",
    }}>
      <svg viewBox="0 0 400 240" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ display: "block" }}>{art}</svg>
      <div style={{ position: "absolute", left: 16, bottom: 12, width: 34, height: 3, borderRadius: 999, background: "rgba(255,255,255,.55)" }} />
    </div>
  );
}

/* ── lesson player (full screen) ─────────────────────────────────── */
function Player({ course, startLesson, P, accent, at, soundOn, onExit, onProgress }) {
  const [lessonIdx, setLessonIdx] = useState(startLesson || 0);
  const [cardIdx, setCardIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [checked, setChecked] = useState(false);
  const [sessionXp, setSessionXp] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [right, setRight] = useState(0);
  const [finished, setFinished] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [showLessonDone, setShowLessonDone] = useState(false);
  const [misses, setMisses] = useState([]);
  const [reviewCards, setReviewCards] = useState(null);
  const xpAtLessonStart = useRef(0);
  const claimsRef = useRef(null);
  if (!claimsRef.current) claimsRef.current = loadClaims();

  const lesson = reviewCards
    ? { id: "missed-review", title: "Review what you missed", cards: reviewCards }
    : course.lessons[lessonIdx];
  const card = lesson ? lesson.cards[cardIdx] : null;
  const interactive = card && (card.kind === "quiz" || card.kind === "cloze" || card.kind === "battle");
  const isRight = interactive && card.kind !== "battle" && picked === card.correct;
  const lessonPct = lesson ? Math.round(((cardIdx + (checked ? 1 : 0)) / lesson.cards.length) * 100) : 0;

  const award = (xp) => { setSessionXp((x) => x + xp); };

  const pick = (i) => {
    if (checked || !interactive) return;
    setPicked(i);
    playSound("tick", soundOn);
  };

  const check = () => {
    if (!interactive || picked === null || checked) return;
    setChecked(true);
    setAnswered((n) => n + 1);
    if (card.kind === "battle") {
      award(6);
      playSound("tick", soundOn);
      onProgress && onProgress(6, course);
      return;
    }
    const correct = picked === card.correct;
    if (correct) setRight((n) => n + 1);
    if (!correct) {
      const origin = course.lessons[lessonIdx];
      setMisses((ms) => (ms.some((m) => m.card === card) ? ms : [...ms, { card, lessonTitle: origin ? origin.title : "" }]));
    }
    award(correct ? 10 : 4);
    playSound(correct ? "correct" : "wrong", soundOn);
    if (card.claimId && claimsRef.current[card.claimId]) {
      gradeClaim(claimsRef.current, card.claimId, correct);
      saveClaims(claimsRef.current);
    }
    onProgress && onProgress(correct ? 10 : 4, course);
  };

  const finishLesson = (markDone) => {
    if (markDone) {
      const done = [...new Set([...(course.doneLessons || []), lesson.id])];
      onProgress && onProgress(20, course, done);
    }
    setShowLessonDone(true);
  };

  const advance = () => {
    if (interactive && !checked) return;
    if (!interactive) { award(2); onProgress && onProgress(2, course); }
    setPicked(null); setChecked(false);
    if (cardIdx < lesson.cards.length - 1) { setCardIdx(cardIdx + 1); return; }
    if (reviewCards) { setReviewCards(null); setCardIdx(0); setShowLessonDone(true); return; }
    finishLesson(true);
  };

  const startMissReview = (cards) => {
    setReviewCards(cards);
    setCardIdx(0); setPicked(null); setChecked(false);
    setShowLessonDone(false); setShowIntro(false);
  };

  const nextLesson = () => {
    setShowLessonDone(false);
    if (lessonIdx < course.lessons.length - 1) {
      xpAtLessonStart.current = sessionXp;
      setLessonIdx(lessonIdx + 1); setCardIdx(0); setShowIntro(true);
    } else {
      setFinished(true);
      playSound("complete", soundOn);
    }
  };

  const btnPrimary = {
    background: accent, color: at, border: "none", borderRadius: 14,
    padding: "15px 30px", fontSize: 16, fontWeight: 700, cursor: "pointer",
    fontFamily: "var(--cb-font)", minHeight: 54,
  };

  const shell = (children) => (
    <div style={{
      position: "fixed", inset: 0, zIndex: 210, background: P.bg, color: P.ink,
      overflowY: "auto", fontFamily: "var(--cb-font)", WebkitOverflowScrolling: "touch",
    }}>
      <style>{CSS}</style>
      {children}
    </div>
  );

  if (finished) {
    return shell(
      <div style={{ maxWidth: 620, margin: "0 auto", padding: "72px 24px 48px", textAlign: "center" }}>
        <div className="lv-rise">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ margin: "0 auto 20px" }}>
            <circle cx="12" cy="12" r="11" stroke={accent} strokeWidth="1.6" />
            <path d="M7 12.5 L10.5 16 L17 8.5" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="lv-pop" />
          </svg>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", color: accent, marginBottom: 10 }}>COURSE COMPLETE</div>
          <h2 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 600, margin: "0 0 12px", lineHeight: 1.2 }}>{course.title}</h2>
          <p style={{ color: P.muted, fontSize: 16, lineHeight: 1.6, margin: "0 auto 30px", maxWidth: 440 }}>
            Every finding you answered is on your review schedule now. It comes back when it starts to fade, not before.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", marginBottom: 36, flexWrap: "wrap" }}>
            <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: 16, padding: "16px 26px" }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: accent }}>+{sessionXp}</div>
              <div style={{ fontSize: 12, color: P.muted }}>XP this session</div>
            </div>
            <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: 16, padding: "16px 26px" }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{answered ? Math.round((right / answered) * 100) + "%" : "·"}</div>
              <div style={{ fontSize: 12, color: P.muted }}>First try accuracy</div>
            </div>
          </div>
          {misses.length > 0 ? (
            <div style={{ textAlign: "left", maxWidth: 520, margin: "0 auto 34px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 12, textAlign: "center" }}>WORTH ANOTHER LOOK</div>
              {misses.map((m, i) => (
                <div key={i} style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: 16, padding: "16px 18px", marginBottom: 10 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.45, marginBottom: 6 }}>{m.card.question}</div>
                  <div style={{ fontSize: 14.5, lineHeight: 1.55, color: P.muted }}>
                    The finding: <span style={{ color: P.ink }}>{m.card.why}</span>
                  </div>
                  {m.card.paperTitle && (
                    <div style={{ fontSize: 12.5, color: P.muted, marginTop: 6 }}>{m.card.cite} · {m.card.paperTitle}</div>
                  )}
                </div>
              ))}
              <p style={{ fontSize: 13.5, color: P.muted, lineHeight: 1.55, textAlign: "center", margin: "14px 0 0" }}>
                These are already on your review schedule, so they will come back while they are still fresh enough to fix.
              </p>
            </div>
          ) : (
            <p style={{ color: P.muted, fontSize: 14.5, margin: "0 auto 34px" }}>Clean run. Nothing missed.</p>
          )}
          {course.vocab && course.vocab.length > 0 && (
            <div style={{ textAlign: "left", maxWidth: 520, margin: "0 auto 34px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 12, textAlign: "center" }}>WORDS FROM THIS COURSE</div>
              {course.vocab.map((v, i) => (
                <div key={i} style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: 16, padding: "14px 18px", marginBottom: 10 }}>
                  <span style={{ fontFamily: SERIF, fontSize: 16.5, fontWeight: 700 }}>{v.term}</span>
                  <div style={{ fontSize: 14, lineHeight: 1.55, color: P.muted, marginTop: 4 }}>{v.text}</div>
                  {v.cite && <div style={{ fontSize: 12, color: P.muted, marginTop: 5 }}>{v.cite}</div>}
                </div>
              ))}
            </div>
          )}
          <button className="lv-btn lv-btn-primary" style={btnPrimary} onClick={onExit}>Back to your courses</button>
        </div>
      </div>
    );
  }
  if (!lesson || !card) return null;

  /* Lesson intro: one screen that names the idea before the cards. */
  if (showIntro) {
    return shell(
      <div style={{ maxWidth: 620, margin: "0 auto", padding: "26px 24px 48px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 40 }}>
          <button onClick={onExit} aria-label="Close lesson" style={{ background: "none", border: "none", color: P.muted, cursor: "pointer", fontSize: 22, lineHeight: 1, padding: 6 }}>✕</button>
          <span style={{ fontSize: 12.5, color: P.muted, letterSpacing: "0.05em" }}>LESSON {lessonIdx + 1} OF {course.lessons.length}</span>
          <span style={{ width: 34 }} />
        </div>
        <div className="lv-rise" style={{ textAlign: "center", paddingTop: "6vh" }}>
          <Cover title={course.title} height={150} radius={20} cat={CATALOG.find((c) => c.name === course.category) || null} img={course.img} />
          <h2 style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, lineHeight: 1.2, margin: "30px 0 12px" }}>{lesson.title}</h2>
          <p style={{ color: P.muted, fontSize: 16.5, lineHeight: 1.6, margin: "0 auto 14px", maxWidth: 420 }}>{lesson.subtitle}</p>
          <p style={{ color: P.muted, fontSize: 13.5, margin: "0 0 22px" }}>{lesson.cards.length} cards · about {Math.max(1, Math.round(lesson.cards.length * 0.4))} min</p>
          {(() => {
            const purpose = {
              pretest: "You guess before anything is taught. Wrong guesses here are the point: they make the real findings land harder when they arrive.",
              foundations: "The earliest papers in this course, in the order the field itself learned them.",
              evidence: "The most cited findings in the set. This is the core of what the field currently believes, and the part worth memorizing.",
              vocab: "The field's own terms, each inside the finding that used it. Know the words and the papers get easier to read.",
              battles: "Real published findings that do not agree. There is no correct side to pick; the skill is seeing why honest studies collide.",
              wrap: "What the field still does not know, stated plainly by the papers themselves.",
              "missed-review": "The questions you missed, once more while they are still fresh. This pass is where the correction happens.",
            }[lesson.id] || "";
            const papers = [...new Set(lesson.cards.map((c) => c.paperTitle || (c.kind === "paper" ? c.title : "")).filter(Boolean))].slice(0, 3);
            if (!purpose && !papers.length) return null;
            return (
              <div style={{ textAlign: "left", background: P.raised, border: "1px solid " + P.line, borderRadius: 18, padding: "18px 20px", margin: "0 auto 30px", maxWidth: 440 }}>
                {purpose && <p style={{ fontSize: 15, lineHeight: 1.6, color: P.ink, margin: "0 0 14px" }}>{purpose}</p>}
                {papers.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: P.muted, marginBottom: 8 }}>FROM THESE PAPERS</div>
                    {papers.map((t, i) => (
                      <div key={i} style={{ fontFamily: SERIF, fontSize: 14.5, lineHeight: 1.45, color: P.muted, marginBottom: i < papers.length - 1 ? 6 : 0 }}>{t}</div>
                    ))}
                  </>
                )}
              </div>
            );
          })()}
          <button className="lv-btn lv-btn-primary" style={{ ...btnPrimary, width: "100%", maxWidth: 340 }}
            onClick={() => { xpAtLessonStart.current = sessionXp; setShowIntro(false); }}>
            Start lesson
          </button>
        </div>
      </div>
    );
  }

  /* Lesson complete interstitial. */
  if (showLessonDone) {
    const lessonXp = sessionXp - xpAtLessonStart.current + 20;
    return shell(
      <div style={{ maxWidth: 620, margin: "0 auto", padding: "72px 24px 48px", textAlign: "center" }}>
        <div className="lv-rise">
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ margin: "0 auto 18px" }}>
            <circle cx="12" cy="12" r="11" stroke={accent} strokeWidth="1.6" />
            <path d="M7 12.5 L10.5 16 L17 8.5" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="lv-pop" />
          </svg>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", color: accent, marginBottom: 10 }}>LESSON COMPLETE</div>
          <h2 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, margin: "0 0 10px", lineHeight: 1.25 }}>{lesson.title}</h2>
          <p style={{ color: P.muted, fontSize: 16, lineHeight: 1.6, margin: "0 auto 30px", maxWidth: 400 }}>
            +{lessonXp} XP. The findings from this lesson are on your review schedule now.
          </p>
          {(() => {
            const lessonMisses = misses.filter((m) => m.lessonTitle === lesson.title);
            if (!lessonMisses.length) return null;
            return (
              <button className="lv-btn" onClick={() => startMissReview(lessonMisses.map((m) => m.card))}
                style={{
                  width: "100%", maxWidth: 340, marginBottom: 12, background: "transparent",
                  border: "1.5px solid " + accent, color: accent, borderRadius: 14,
                  padding: "13px 20px", fontSize: 15, fontWeight: 700, cursor: "pointer",
                  fontFamily: "var(--cb-font)", minHeight: 50,
                }}>
                Review what you missed ({lessonMisses.length})
              </button>
            );
          })()}
          <button className="lv-btn lv-btn-primary" style={{ ...btnPrimary, width: "100%", maxWidth: 340 }} onClick={nextLesson}>
            {lessonIdx === course.lessons.length - 1 ? "Finish course" : "Next lesson"}
          </button>
          <div style={{ marginTop: 16 }}>
            <button onClick={onExit} style={{ background: "none", border: "none", color: P.muted, cursor: "pointer", fontSize: 14.5, fontFamily: "var(--cb-font)", padding: 8 }}>
              Back to the path
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* Richness data for the card stage: everything below is computed
     from the course's own cards, never invented. */
  const lessonPapers = lesson.cards.filter((c) => c.kind === "paper");
  const followingPapers = lesson.cards.slice(cardIdx + 1).filter((c) => c.kind === "paper");
  const lessonChecks = lesson.cards.filter((c) => c.kind === "quiz" || c.kind === "cloze" || c.kind === "battle").length;
  const maxCites = Math.max(1, ...lessonPapers.map((c) => c.citations || 0));
  const paperYearOf = (c) => { const y = parseInt(formatYearValue(c && c.year), 10); if (Number.isFinite(y)) return y; const m = String((c && c.meta) || "").match(/\b(?:19|20)\d{2}\b/); return m ? parseInt(m[0], 10) : null; };
  const displayMeta = (meta) => String(meta || "").replace(/\b((?:19|20)\d{2})\.0\b/g, "$1");
  const lessonYears = lessonPapers.map(paperYearOf).filter((y) => y != null);
  const cardKindLabel = (c) => c.kind === "paper" ? "Read" : c.kind === "cloze" ? "Predict" : c.kind === "battle" ? "Debate" : c.kind === "note" ? "Intro" : c.kind === "summary" ? "Wrap" : c.vocab ? "Vocab" : "Recall";

  const sheetGood = checked && (card.kind === "battle" || isRight);
  const sheet = checked ? (
    <div className="lv-sheet" style={{
      position: "sticky", bottom: 0, marginTop: 28,
      background: sheetGood ? "#D7FFB8" : "#FFDFE0",
      borderTop: "2px solid " + (sheetGood ? "#58CC02" : "#FF4B4B"),
      borderRadius: "20px 20px 0 0", padding: "20px 22px 24px", color: "#14240a",
    }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ fontSize: 16.5, fontWeight: 800, marginBottom: 6, color: sheetGood ? "#2c5a00" : "#8f1216" }}>
          {card.kind === "battle" ? "Both sides are real. That is the point."
            : card.pretest ? (isRight ? "Right, before you even read it." : "Good guess. Here is what the paper says.")
            : isRight ? "Right." : "Not quite."}
          <span style={{ float: "right", fontSize: 14, fontWeight: 700, color: sheetGood ? "#2c5a00" : "#8f1216" }}>
            {card.kind === "battle" ? "+6 XP" : isRight ? "+10 XP" : "+4 XP"}
          </span>
        </div>
        {card.kind === "battle" ? (
          <p style={{ fontSize: 15, lineHeight: 1.6, margin: 0, color: "#24300f" }}>
            Both of these are real published findings, and they do not agree. There is no correct side to pick here. Disagreement at this level usually means the answer depends on conditions neither study fully controlled.
          </p>
        ) : (
          <>
            {!isRight && card.options && picked !== null && picked !== undefined && (
              <p style={{ fontSize: 14.5, lineHeight: 1.55, margin: "0 0 10px", color: "#5a2a2a" }}>
                You picked: <span style={{ fontWeight: 600 }}>{card.options[picked]}</span>
              </p>
            )}
            <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#4a5a38", margin: "0 0 4px" }}>THE FINDING</p>
            <p style={{ fontFamily: SERIF, fontSize: 16.5, lineHeight: 1.6, margin: 0, color: "#1d2a10" }}>{card.why}</p>
            <p style={{ fontSize: 12.5, color: "#4a5a38", margin: "10px 0 0" }}>{card.cite}{card.paperTitle ? " · " + card.paperTitle : ""}</p>
          </>
        )}
        <button className="lv-btn" onClick={advance}
          style={{
            marginTop: 18, width: "100%", background: sheetGood ? "#58CC02" : "#FF4B4B", color: "#fff",
            border: "none", borderRadius: 14, padding: "15px 24px", fontSize: 16, fontWeight: 800,
            cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 54, boxShadow: "0 4px 0 rgba(0,0,0,.25)",
          }}>
          {cardIdx === lesson.cards.length - 1 ? "Finish lesson" : "Continue"}
        </button>
      </div>
    </div>
  ) : null;

  return shell(
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
      {/* top bar: close, segmented course progress, session XP */}
      <div style={{ maxWidth: 680, width: "100%", margin: "0 auto", padding: "20px 24px 0", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={onExit} aria-label="Close lesson" style={{ background: "none", border: "none", color: P.muted, cursor: "pointer", fontSize: 21, lineHeight: 1, padding: 4 }}>✕</button>
          <div style={{ display: "flex", gap: 5, flex: 1 }}>
            {course.lessons.map((l, li) => (
              <div key={l.id} style={{ flex: 1, height: 10, borderRadius: 999, background: P.line, overflow: "hidden" }}>
                <div className="lv-fill" style={{
                  height: "100%", borderRadius: 999,
                  width: (li < lessonIdx || (li === lessonIdx && showLessonDone) ? 100 : li === lessonIdx ? lessonPct : 0) + "%",
                  background: "linear-gradient(rgba(255,255,255,.38), rgba(255,255,255,0) 48%), " + accent,
                }} />
              </div>
            ))}
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: accent, minWidth: 52, textAlign: "right" }}>{sessionXp > 0 ? "+" + sessionXp + " XP" : ""}</span>
        </div>
        <div style={{ fontSize: 12, color: P.muted, letterSpacing: "0.05em", marginTop: 12 }}>
          {lesson.title.toUpperCase()} · CARD {cardIdx + 1} OF {lesson.cards.length}
        </div>
      </div>

      {/* card stage */}
      <div style={{ flex: 1, width: "100%", maxWidth: 680, margin: "0 auto", padding: "26px 24px 8px", boxSizing: "border-box" }}>
        <div key={lessonIdx + "-" + cardIdx} className="lv-rise">
          {(card.kind === "quiz" || card.kind === "cloze" || card.kind === "battle") && course.img && (
            <div style={{ position: "relative", height: 92, borderRadius: 18, overflow: "hidden", marginBottom: 22, border: "1px solid " + P.line }}>
              <img src={course.img} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(6,10,6,0.05), rgba(6,10,6,0.72))" }} />
              <span style={{ position: "absolute", left: 16, bottom: 10, color: "#fff", fontFamily: SERIF, fontSize: 16, fontWeight: 600 }}>{lesson.title}</span>
            </div>
          )}
          {card.kind === "note" && (
            <div>
              {/* Chapter opener: the course photo carries the top of the
                  screen, then what this chapter actually holds. */}
              <div style={{ position: "relative", borderRadius: 22, overflow: "hidden", marginBottom: 24, border: "1px solid " + P.line, background: P.raised }}>
                {course.img && <img src={course.img} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
                <div style={{ position: "absolute", inset: 0, background: course.img ? "linear-gradient(180deg, rgba(6,10,6,0.16), rgba(6,10,6,0.85))" : "linear-gradient(135deg, " + withAlphaSafe(accent, 0.22) + ", transparent 65%)" }} />
                <div style={{ position: "relative", padding: "64px 22px 20px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.13em", color: course.img ? "#cfe8b8" : accent, marginBottom: 10 }}>{(card.kicker || "").toUpperCase()}</div>
                  <h2 style={{ fontFamily: SERIF, fontSize: 31, fontWeight: 600, lineHeight: 1.22, margin: 0, color: course.img ? "#fff" : P.ink }}>{card.title}</h2>
                </div>
              </div>
              {card.cite ? (
                <div style={{ background: P.raised, border: "1px solid " + P.line, borderLeft: "4px solid " + accent, borderRadius: 16, padding: "18px 20px" }}>
                  <p style={{ fontFamily: SERIF, fontSize: 18.5, lineHeight: 1.6, margin: 0 }}>{card.text}</p>
                  <p style={{ fontSize: 13, color: P.muted, margin: "12px 0 0" }}>{card.cite}</p>
                </div>
              ) : (
                <p style={{ fontSize: 17.5, color: P.ink2 || P.muted, lineHeight: 1.65, margin: 0 }}>{card.text}</p>
              )}
              {followingPapers.length > 0 && (
                <div style={{ marginTop: 28 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.12em", color: P.muted, marginBottom: 12 }}>COMING UP IN THIS CHAPTER</div>
                  {followingPapers.slice(0, 3).map((p, i) => (
                    <div key={i} style={{ display: "flex", gap: 13, alignItems: "flex-start", background: P.raised, border: "1px solid " + P.line, borderRadius: 16, padding: "14px 16px", marginBottom: 9 }}>
                      <span style={{ flexShrink: 0, width: 27, height: 27, borderRadius: 9, background: withAlphaSafe(accent, 0.16), color: accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13.5, fontWeight: 800 }}>{i + 1}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontFamily: SERIF, fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>{p.title}</span>
                        <span style={{ display: "block", fontSize: 12.5, color: P.muted, marginTop: 3 }}>{displayMeta(p.meta)}{p.citations != null ? " · " + p.citations + " citations" : " · citation count not reported"}</span>
                      </span>
                    </div>
                  ))}
                  <p style={{ fontSize: 14, color: P.muted, lineHeight: 1.55, margin: "14px 0 0" }}>
                    In this chapter: read {lessonPapers.length} {lessonPapers.length === 1 ? "finding" : "findings"}, answer {lessonChecks} {lessonChecks === 1 ? "check" : "checks"}.
                  </p>
                </div>
              )}
              {lesson.id === "vocab" && course.vocab && course.vocab.length > 0 && (
                <div style={{ marginTop: 26 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.12em", color: P.muted, marginBottom: 12 }}>THE WORDS AHEAD</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {course.vocab.map((v, i) => (
                      <span key={i} style={{ fontFamily: SERIF, fontSize: 15.5, fontWeight: 600, color: P.ink, background: P.raised, border: "1px solid " + P.line, borderRadius: 999, padding: "7px 14px" }}>{v.term}</span>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ marginTop: 28 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.12em", color: P.muted, marginBottom: 12 }}>THE SHAPE OF THIS LESSON</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center" }}>
                  {lesson.cards.map((c, i) => (
                    <span key={i} style={{
                      fontSize: 12.5, fontWeight: i === cardIdx ? 800 : 600, borderRadius: 999, padding: "6px 12px",
                      color: i === cardIdx ? "#14240a" : P.muted,
                      background: i === cardIdx ? accent : "transparent",
                      border: "1.5px solid " + (i === cardIdx ? accent : P.line),
                    }}>{cardKindLabel(c)}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {card.kind === "paper" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.13em", color: accent }}>FROM THE LITERATURE</span>
                {lessonPapers.length > 1 && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: P.muted, background: P.raised, border: "1px solid " + P.line, borderRadius: 999, padding: "4px 11px" }}>
                    Paper {lessonPapers.indexOf(card) + 1} of {lessonPapers.length} in this lesson
                  </span>
                )}
                {paperYearOf(card) != null && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: P.muted, background: P.raised, border: "1px solid " + P.line, borderRadius: 999, padding: "4px 11px" }}>{paperYearOf(card)}</span>
                )}
              </div>
              <h2 style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 600, lineHeight: 1.35, margin: "0 0 10px" }}>{card.title}</h2>
              <p style={{ fontSize: 13.5, color: P.muted, margin: "0 0 22px" }}>{displayMeta(card.meta)}</p>
              {card.text && (
                <div style={{ position: "relative", background: P.raised, border: "1px solid " + P.line, borderRadius: 18, padding: "24px 24px 22px", overflow: "hidden" }}>
                  <span aria-hidden="true" style={{ position: "absolute", top: -14, right: 14, fontFamily: SERIF, fontSize: 110, lineHeight: 1, color: withAlphaSafe(accent, 0.14), pointerEvents: "none" }}>”</span>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: P.muted, marginBottom: 10 }}>THE FINDING</div>
                  <p style={{ fontFamily: SERIF, fontSize: 20, lineHeight: 1.62, margin: 0, position: "relative" }}>{emphasizeFinding(card.text, accent)}</p>
                </div>
              )}
              {card.citations != null && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: P.muted, marginBottom: 7 }}>
                    <span>Cited {card.citations} times</span>
                    <span>{card.citations >= maxCites && maxCites > 1 ? "The most cited paper in this lesson" : "Relative to this lesson"}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: P.line, overflow: "hidden" }}>
                    <div className="lv-fill" style={{ height: "100%", width: (card.citations === 0 ? 0 : Math.max(5, Math.round((card.citations / maxCites) * 100))) + "%", background: accent, borderRadius: 999 }} />
                  </div>
                </div>
              )}
              {card.citations == null && (
                <p style={{ fontSize: 12.5, color: P.muted, lineHeight: 1.5, margin: "18px 0 0" }}>Citation count was not reported for this record. Its date and place in the lesson still come from the record itself.</p>
              )}
              {lessonYears.length >= 2 && Math.max(...lessonYears) > Math.min(...lessonYears) && paperYearOf(card) != null && (
                <div style={{ marginTop: 22 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: P.muted, marginBottom: 8 }}>
                    <span>{Math.min(...lessonYears)}</span>
                    <span>Where this paper sits in the lesson</span>
                    <span>{Math.max(...lessonYears)}</span>
                  </div>
                  <div style={{ position: "relative", height: 4, borderRadius: 999, background: P.line, margin: "0 5px" }}>
                    <span style={{
                      position: "absolute", top: "50%", left: ((paperYearOf(card) - Math.min(...lessonYears)) / (Math.max(...lessonYears) - Math.min(...lessonYears))) * 100 + "%",
                      transform: "translate(-50%, -50%)", width: 15, height: 15, borderRadius: "50%",
                      background: accent, border: "3px solid " + P.bg, boxSizing: "border-box",
                    }} />
                  </div>
                </div>
              )}
              <p style={{ fontSize: 14, color: P.muted, lineHeight: 1.55, margin: "24px 0 0" }}>Read it once, slowly. The next card asks you to recall it.</p>
            </div>
          )}

          {(card.kind === "quiz" || card.kind === "cloze") && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>
                {card.pretest ? "PRETEST · GUESS FIRST" : card.vocab ? "VOCABULARY · TERMS IN CONTEXT" : card.kind === "cloze" ? "PREDICT THE RESULT" : "RECALL"}
              </div>
              <h2 style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 600, lineHeight: 1.4, margin: "0 0 10px" }}>{card.question}</h2>
              {card.prompt && (
                <div style={{ background: P.raised, border: "1px solid " + P.line, borderLeft: "4px solid " + accent, borderRadius: 16, padding: "17px 19px", margin: "4px 0 10px" }}>
                  <p style={{ fontFamily: SERIF, fontSize: 19, lineHeight: 1.6, margin: 0 }}>{card.prompt}</p>
                </div>
              )}
              {card.pretest && !checked && (
                <p style={{ fontSize: 14, color: P.muted, margin: "0 0 6px", lineHeight: 1.55 }}>You have not been taught this yet. That is the point. A real guess now makes the finding stick later.</p>
              )}
              <div style={card.vocab
                ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }
                : { display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
                {card.options.map((opt, i) => {
                  let bg = P.dark ? "#242b24" : "#ffffff", border = P.line, color = P.ink;
                  if (checked && i === card.correct) { bg = "#D7FFB8"; border = "#58CC02"; color = "#224d00"; }
                  else if (checked && i === picked) { bg = "#FFDFE0"; border = "#FF4B4B"; color = "#6e0f13"; }
                  else if (!checked && picked === i) { bg = P.dark ? "#274b63" : "#DDF4FF"; border = "#84D8FF"; color = P.ink; }
                  return (
                    <button key={i} className={"lv-opt" + (checked && picked === i && i !== card.correct ? " lv-shake" : "")}
                      onClick={() => pick(i)} disabled={checked}
                      style={{
                        appearance: "none", WebkitAppearance: "none", width: "100%", boxSizing: "border-box",
                        background: bg, backgroundColor: bg, border: "2px solid " + border, borderRadius: 16,
                        padding: "15px 18px", fontSize: card.kind === "cloze" ? 17.5 : 15.5, lineHeight: 1.5,
                        color, cursor: checked ? "default" : "pointer", textAlign: "left",
                        fontFamily: "var(--cb-font)", minHeight: 54, display: "flex", gap: 12, alignItems: "flex-start",
                      }}>
                      <span aria-hidden="true" style={{
                        flexShrink: 0, width: 26, height: 26, borderRadius: 8, marginTop: 1,
                        border: "1.5px solid " + (checked && i === card.correct ? "#58CC02" : checked && i === picked ? "#FF4B4B" : border),
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 700, color: checked && i === card.correct ? "#2c5a00" : color, opacity: 0.9,
                      }}>{checked && i === card.correct ? "✓" : "ABCD"[i] || ""}</span>
                      <span style={{ minWidth: 0, overflowWrap: "break-word" }}>{opt}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {card.kind === "battle" && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>CLAIM BATTLE · REAL FINDINGS</div>
              <h2 style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 600, lineHeight: 1.4, margin: "0 0 20px" }}>{card.question}</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {[{ claim: card.claimA, src: card.sourceA, tag: "POSITION A" }, { claim: card.claimB, src: card.sourceB, tag: "POSITION B" }].flatMap((side, i) => {
                  const btn = (
                    <button key={"side" + i} onClick={() => pick(i)} disabled={checked}
                      className="lv-opt"
                      style={{
                        width: "100%", boxSizing: "border-box", textAlign: "left",
                        background: P.raised, border: "2px solid " + (!checked && picked === i ? accent : P.line), borderRadius: 18,
                        padding: "18px 20px", cursor: checked ? "default" : "pointer", fontFamily: "var(--cb-font)",
                      }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.1em", color: accent, marginBottom: 9 }}>{side.tag}</div>
                      <p style={{ fontFamily: SERIF, fontSize: 17.5, lineHeight: 1.55, margin: 0 }}>{side.claim}</p>
                      <p style={{ fontSize: 12.5, color: P.muted, margin: "10px 0 0" }}>{side.src}</p>
                    </button>
                  );
                  if (i === 0) return [btn];
                  return [(
                    <div key="vs" style={{ display: "flex", justifyContent: "center", margin: "-13px 0", position: "relative", zIndex: 1 }}>
                      <span style={{
                        width: 40, height: 40, borderRadius: "50%", background: accent, color: "#14240a",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13.5, fontWeight: 800, border: "3px solid " + P.bg, boxSizing: "border-box",
                      }}>VS</span>
                    </div>
                  ), btn];
                })}
              </div>
            </div>
          )}

          {card.kind === "summary" && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>WRAP UP</div>
              <h2 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, lineHeight: 1.25, margin: "0 0 16px" }}>{card.title}</h2>
              <p style={{ fontSize: 17.5, color: P.ink2 || P.muted, lineHeight: 1.65, margin: 0 }}>{card.text}</p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 24 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: P.ink, background: P.raised, border: "1px solid " + P.line, borderRadius: 999, padding: "8px 15px" }}>{course.sourceCount} papers in this course</span>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: P.ink, background: P.raised, border: "1px solid " + P.line, borderRadius: 999, padding: "8px 15px" }}>{course.lessons.length} lessons</span>
                {course.vocab && course.vocab.length > 0 && (
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: P.ink, background: P.raised, border: "1px solid " + P.line, borderRadius: 999, padding: "8px 15px" }}>{course.vocab.length} terms met</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* bottom action bar / feedback sheet */}
      {checked ? sheet : (
        <div style={{ position: "sticky", bottom: 0, padding: "14px 24px 22px", background: "linear-gradient(rgba(0,0,0,0), " + P.bg + " 34%)" }}>
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            <button className="lv-btn lv-btn-primary"
              style={{
                ...btnPrimary, width: "100%",
                opacity: interactive && picked === null ? 0.45 : 1,
                cursor: interactive && picked === null ? "default" : "pointer",
              }}
              onClick={interactive ? check : advance} disabled={interactive && picked === null}>
              {interactive ? "Check" : cardIdx === lesson.cards.length - 1 ? "Finish lesson" : "Continue"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── course path + library ───────────────────────────────────────── */
function memoryState(course, claims) {
  const mine = Object.values(claims).filter((c) => c.courseId === course.id && c.reps > 0);
  if (mine.length === 0) return { label: "Not started", pct: 0 };
  const now = Date.now();
  const avg = mine.reduce((sum, c) => sum + retrievability(c, now), 0) / mine.length;
  const due = mine.filter((c) => c.due <= now).length;
  if (due > 0) return { label: due + " fading", pct: Math.round(avg * 100) };
  return { label: "Holding", pct: Math.round(avg * 100) };
}

function PathView({ course, claims, P, accent, at, onPlay, onBack, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const done = new Set(course.doneLessons || []);
  const nextIdx = course.lessons.findIndex((l) => !done.has(l.id));
  const mem = memoryState(course, claims);
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "26px 24px 56px", fontFamily: "var(--cb-font)" }}>
      <style>{CSS}</style>
      <button onClick={onBack} style={{ background: "none", border: "none", color: P.muted, cursor: "pointer", fontSize: 14.5, fontFamily: "var(--cb-font)", padding: "4px 0", marginBottom: 16 }}>
        ← All courses
      </button>
      <div className="lv-rise">
        <Cover title={course.title} height={168} radius={22} cat={CATALOG.find((c) => c.name === course.category) || null} img={course.img} />
        <h2 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, lineHeight: 1.22, margin: "22px 0 8px", color: P.ink }}>{course.title}</h2>
        <p style={{ color: P.muted, fontSize: 14.5, margin: "0 0 6px" }}>
          {course.lessons.length} lessons · {course.sourceCount || 0} papers · {course.xpEarned || 0} XP earned
        </p>
        <div style={{ margin: "14px 0 30px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: P.muted, marginBottom: 6 }}>
            <span>Memory strength</span><span>{mem.label}</span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: P.line, overflow: "hidden" }}>
            <div className="lv-fill" style={{ width: mem.pct + "%", height: "100%", background: accent, borderRadius: 999 }} />
          </div>
        </div>
      </div>

      {/* the path: one node per lesson, in the order the field built it */}
      <div style={{ position: "relative", marginLeft: 27 }}>
        <div style={{ position: "absolute", left: 0, top: 12, bottom: 12, width: 2, background: P.line }} aria-hidden="true" />
        {course.lessons.map((lesson, i) => {
          const isDone = done.has(lesson.id);
          const isNext = i === nextIdx;
          return (
            <div key={lesson.id} style={{ position: "relative", padding: "0 0 26px 34px" }}>
              <div aria-hidden="true" style={{
                position: "absolute", left: -27, top: 0, transform: "translateX(-50%)",
                width: 46, height: 46, borderRadius: "50%",
                background: isDone ? accent : P.raised,
                border: "2px solid " + (isDone || isNext ? accent : P.line),
                display: "flex", alignItems: "center", justifyContent: "center",
                color: isDone ? at : isNext ? accent : P.muted,
                fontWeight: 800, fontSize: 16, fontFamily: "var(--cb-font)",
              }} className={isNext ? "lv-pulse" : ""}>
                {isDone ? (
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none"><path d="M5 12.5 L10 17 L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                ) : i + 1}
              </div>
              <button className="lv-node" onClick={() => onPlay(i)}
                style={{
                  display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                  background: P.raised, border: "1px solid " + (isNext ? accent : P.line), borderRadius: 18,
                  padding: "16px 18px", fontFamily: "var(--cb-font)", color: P.ink,
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <span style={{ fontFamily: SERIF, fontSize: 19.5, fontWeight: 600, lineHeight: 1.3 }}>{lesson.title}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: isDone ? accent : P.muted, flexShrink: 0 }}>
                    {isDone ? "DONE" : isNext ? "UP NEXT" : lesson.cards.length + " CARDS"}
                  </span>
                </div>
                <p style={{ color: P.muted, fontSize: 14, lineHeight: 1.5, margin: "5px 0 0" }}>{lesson.subtitle}</p>
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 8, borderTop: "1px solid " + P.line, paddingTop: 20 }}>
        {confirmDelete ? (
          <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 14, color: P.muted }}>Delete this course and its review schedule?</span>
            <button onClick={onDelete} style={{ background: "#FF4B4B", color: "#fff", border: "none", borderRadius: 9, padding: "8px 14px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)" }}>Delete</button>
            <button onClick={() => setConfirmDelete(false)} style={{ background: "transparent", color: P.muted, border: "1px solid " + P.line, borderRadius: 9, padding: "8px 14px", fontSize: 13.5, cursor: "pointer", fontFamily: "var(--cb-font)" }}>Keep</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDelete(true)} style={{ background: "none", border: "none", color: P.muted, cursor: "pointer", fontSize: 13.5, fontFamily: "var(--cb-font)", padding: 0 }}>
            Delete course
          </button>
        )}
      </div>
    </div>
  );
}

/* Run the search the same way the main search box does: streamed.
   A streamed search sends stage frames while it works, which keeps
   the connection warm; a silent single fetch can be cut by the
   network path before a long search finishes, and the builder then
   reports a failure for a search that was fine. Falls back to the
   plain fetch once when the stream path is unavailable. */
async function searchForCourse(query) {
  const body = { query, settings: { answerLength: "standard", factCheck: true } };
  try {
    const res = await fetch("/api/search?stream=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const e = new Error("http"); e.status = res.status; throw e; }
    const ctype = res.headers.get("content-type") || "";
    if (!ctype.includes("text/event-stream") || !res.body) throw new Error("nostream");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let doneData = null;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      buf += decoder.decode(part.value, { stream: true });
      let cut = buf.search(/\r?\n\r?\n/);
      while (cut >= 0) {
        const frame = buf.slice(0, cut);
        buf = buf.slice(cut + (buf[cut] === "\r" ? 4 : 2));
        let ev = "message";
        const lines = [];
        for (const rawLine of frame.split(/\r?\n/)) {
          if (rawLine.startsWith("event:")) ev = rawLine.slice(6).trim();
          else if (rawLine.startsWith("data:")) lines.push(rawLine.slice(5).trim());
        }
        if (ev === "done" && lines.length) doneData = lines.join("\n");
        else if (ev === "error") throw new Error("backend");
        cut = buf.search(/\r?\n\r?\n/);
      }
    }
    if (!doneData) throw new Error("nodone");
    return JSON.parse(doneData);
  } catch (e) {
    if (e && e.status) throw e;
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const e2 = new Error("http"); e2.status = res.status; throw e2; }
    return res.json();
  }
}

/* ── Learn home ──────────────────────────────────────────────────── */
/* ── the tour ────────────────────────────────────────────────────────
   Thirty seconds, four steps, shown once on a first visit and
   replayable from the header. It teaches the loop, not the buttons:
   pick, guess first, check against the paper, review on schedule. */
const TOUR_STEPS = [
  {
    icon: "grid",
    title: "Pick a course, or build one",
    body: "Start from the catalog shelves, or type any topic and Cortex builds a course from the real literature on the spot. Every question in it is a finding from a real paper, never filler written to look like one.",
  },
  {
    icon: "zap",
    title: "Questions come first",
    body: "Every course opens by asking before it teaches. A wrong guess here is not a failure. It is the thing that makes the right answer stick when it arrives seconds later.",
  },
  {
    icon: "check",
    title: "Check, then read why",
    body: "Pick an answer, press Check, and Cortex grades you against the paper itself, quoting the finding with its citation. The debates are real disagreements between published papers, never staged for drama.",
  },
  {
    icon: "history",
    title: "Reviews find you",
    body: "Every finding you answer becomes a memory claim. It comes back right as it starts to fade, and two minutes clears the pile. Streaks forgive here: you get freezes, not guilt.",
  },
];
function CortexTour({ P, accent, at, onClose }) {
  const [step, setStep] = useState(0);
  const s = TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 260, background: "rgba(5,6,8,0.72)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 18,
    }} onClick={onClose}>
      <div className="lv-rise" onClick={(e) => e.stopPropagation()} style={{
        background: P.raised, border: "1px solid " + P.line, borderRadius: 24,
        maxWidth: 470, width: "100%", padding: "30px 28px 24px", color: P.ink,
        fontFamily: "var(--cb-font)", boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
        maxHeight: "88vh", overflowY: "auto",
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%", marginBottom: 18,
          background: "rgba(255,255,255,0.06)", color: accent,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon name={s.icon} size={26} />
        </div>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.12em", color: P.muted, marginBottom: 8 }}>
          HOW CORTEX WORKS · {step + 1} OF {TOUR_STEPS.length}
        </div>
        <h2 style={{ fontFamily: SERIF, fontSize: 25, fontWeight: 600, margin: "0 0 10px", lineHeight: 1.25 }}>{s.title}</h2>
        <p style={{ fontSize: 15.5, lineHeight: 1.65, color: P.muted, margin: "0 0 24px" }}>{s.body}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
          {TOUR_STEPS.map((_, i) => (
            <span key={i} style={{
              width: i === step ? 22 : 8, height: 8, borderRadius: 999,
              background: i === step ? accent : P.line, transition: "all .25s",
            }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {step > 0 && (
            <button className="lv-btn" onClick={() => setStep(step - 1)}
              style={{ background: "transparent", border: "1px solid " + P.line, color: P.ink, borderRadius: 12, padding: "13px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 50 }}>
              Back
            </button>
          )}
          <button className="lv-btn lv-btn-primary" onClick={() => (last ? onClose() : setStep(step + 1))}
            style={{ flex: 1, background: accent, color: at || "#101408", border: "none", borderRadius: 12, padding: "13px 20px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", minHeight: 50 }}>
            {last ? "Start learning" : "Next"}
          </button>
        </div>
        {!last && (
          <button onClick={onClose} style={{ background: "none", border: "none", color: P.muted, cursor: "pointer", fontSize: 13.5, fontFamily: "var(--cb-font)", padding: "12px 0 0", display: "block", margin: "0 auto" }}>
            Skip the tour
          </button>
        )}
      </div>
    </div>
  );
}

export default function LearnView({ P, accent, at, onNavigate }) {
  const [courses, setCourses] = useState([]);
  const [claims, setClaims] = useState({});
  const [profile, setProfile] = useState(null);
  const [screen, setScreen] = useState({ name: "home" }); // home | path | player
  const [topic, setTopic] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState("");
  const [soundOn, setSoundOn] = useState(() => loadJSON(SOUND_KEY, false));
  const [tourOpen, setTourOpen] = useState(() => {
    try { return !localStorage.getItem("cerebrum-cortex-tour"); } catch { return false; }
  });
  const closeTour = () => {
    try { localStorage.setItem("cerebrum-cortex-tour", "done"); } catch { /* private mode */ }
    setTourOpen(false);
  };
  const [access, setAccess] = useState({ signedIn: false, isFounder: false, isCreator: false, email: "" });
  const [published, setPublished] = useState([]);
  const [catFilter, setCatFilter] = useState("All");
  const [buildingLabel, setBuildingLabel] = useState("");
  const [creators, setCreators] = useState([]);
  const [creatorEmail, setCreatorEmail] = useState("");
  const [ownerMsg, setOwnerMsg] = useState("");
  const [studio, setStudio] = useState({ title: "", category: "Mind and Brain", query: "", blurb: "" });
  const [studioMsg, setStudioMsg] = useState("");

  const refresh = () => {
    setCourses(loadLearnCourses());
    setClaims(loadClaims());
  };
  useEffect(() => {
    refresh();
    setProfile(touchStreak(loadProfile()));
  }, []);

  const cortexApi = async (action, body) => {
    try {
      const r = await fetch("/api/cortex", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(body || {}) }),
      });
      return await r.json().catch(() => ({}));
    } catch { return {}; }
  };
  useEffect(() => {
    cortexApi("access").then((d) => { if (d && d.ok) setAccess(d); });
    cortexApi("catalog-list").then((d) => { if (d && d.ok) setPublished(d.entries || []); });
  }, []);
  useEffect(() => {
    if (access.isFounder) cortexApi("list-creators").then((d) => { if (d && d.ok) setCreators(d.creators || []); });
  }, [access.isFounder]);

  const grantCreator = async () => {
    const d = await cortexApi("grant-creator", { email: creatorEmail });
    if (d && d.ok) { setCreators(d.creators || []); setCreatorEmail(""); setOwnerMsg(d.email + " can now create for Cortex."); }
    else setOwnerMsg("That did not go through. Check the email and try again.");
  };
  const revokeCreator = async (email) => {
    const d = await cortexApi("revoke-creator", { email });
    if (d && d.ok) setCreators(d.creators || []);
  };
  const publishEntry = async () => {
    const d = await cortexApi("catalog-create", studio);
    if (d && d.ok) {
      setPublished((p) => [d.entry, ...p]);
      setStudio({ title: "", category: studio.category, query: "", blurb: "" });
      setStudioMsg("Published. It is on the shelf for everyone now.");
    } else setStudioMsg("Publishing failed. " + ((d && d.message) || "Try again."));
  };
  const deleteEntry = async (id) => {
    const d = await cortexApi("catalog-delete", { id });
    if (d && d.ok) setPublished((p) => p.filter((e) => e.id !== id));
  };

  const due = useMemo(() => dueClaims(claims), [claims]);

  const handleProgress = (xpGain, course, doneLessons) => {
    setProfile((prev) => {
      const p = { ...(prev || loadProfile()), xp: (prev ? prev.xp : 0) + xpGain };
      saveProfile(p);
      return p;
    });
    if (course && course.id !== "review") {
      const all = loadLearnCourses();
      const found = all.find((c) => c.id === course.id);
      if (found) {
        found.xpEarned = (found.xpEarned || 0) + xpGain;
        if (doneLessons) found.doneLessons = doneLessons;
        saveJSON(COURSES_KEY, all);
        setCourses(all);
      }
    }
    setClaims(loadClaims());
  };

  const buildCourseFrom = async (q, displayTitle, categoryName, img) => {
    if (!q || building) return;
    setBuilding(true);
    setBuildingLabel(displayTitle || q);
    setBuildError("");
    try {
      const data = await searchForCourse(q);
      const course = createCourseFromResults(q, data.sources || [], data.answer || "", data.literature_conflicts || []);
      if (!course) {
        setBuildError("That search did not return enough cited findings to build an honest course. Try a broader topic.");
        return;
      }
      if (displayTitle) course.title = displayTitle;
      if (categoryName) course.category = categoryName;
      if (img) course.img = img;
      saveLearnCourse(course);
      refresh();
      setTopic("");
      setScreen({ name: "path", courseId: course.id });
    } catch (e) {
      if (e && e.status === 429) setBuildError("The literature databases are rate limiting right now. Wait a minute and try again.");
      else if (e && e.status) setBuildError("The search hit a server error (status " + e.status + "). Try again in a moment.");
      else setBuildError("The search did not come back. Check your connection and try again.");
    } finally {
      setBuilding(false);
      setBuildingLabel("");
    }
  };
  const buildCourse = () => buildCourseFrom(topic.trim());

  const startReview = () => {
    const cards = due.slice(0, 12).map((c) => ({ ...c.card, claimId: c.id, kind: c.card.kind || "quiz" }));
    if (!cards.length) return;
    setScreen({
      name: "player", fromPath: false,
      course: { id: "review", title: "Review: findings that are fading", lessons: [{ id: "review", title: "Review", subtitle: "Findings that are starting to fade", cards }], doneLessons: [] },
      startLesson: 0,
    });
  };

  const removeCourse = (id) => {
    const all = loadLearnCourses().filter((c) => c.id !== id);
    saveJSON(COURSES_KEY, all);
    const store = loadClaims();
    for (const k of Object.keys(store)) if (store[k].courseId === id) delete store[k];
    saveClaims(store);
    refresh();
    setScreen({ name: "home" });
  };

  if (screen.name === "player") {
    return (
      <Player
        course={screen.course}
        startLesson={screen.startLesson}
        P={P} accent={accent} at={at || "#101408"}
        soundOn={soundOn}
        onExit={() => {
          refresh();
          setProfile(touchStreak(loadProfile()));
          if (screen.fromPath && screen.course.id !== "review") setScreen({ name: "path", courseId: screen.course.id });
          else setScreen({ name: "home" });
        }}
        onProgress={handleProgress}
      />
    );
  }

  if (screen.name === "path") {
    const course = courses.find((c) => c.id === screen.courseId);
    if (course) {
      return (
        <PathView
          course={course} claims={claims} P={P} accent={accent} at={at || "#101408"}
          onPlay={(i) => setScreen({ name: "player", course, startLesson: i, fromPath: true })}
          onBack={() => setScreen({ name: "home" })}
          onDelete={() => removeCourse(course.id)}
        />
      );
    }
  }

  const pill = (icon, value, label) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, background: P.raised, border: "1px solid " + P.line, borderRadius: 999, padding: "8px 14px", fontSize: 14, color: P.ink }}>
      {icon}
      <strong style={{ fontWeight: 700 }}>{value}</strong>
      <span style={{ color: P.muted, fontSize: 13 }}>{label}</span>
    </span>
  );
  const flame = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 C12 3 5.5 9.6 5.5 14.2 C5.5 18 8.4 21 12 21 C15.6 21 18.5 18 18.5 14.2 C18.5 11.8 17.2 9.7 15.8 8.2 C15.4 10 14.4 11.2 13.2 11.6 C13.8 8.8 13.2 5.4 12 3 Z" fill={accent} />
    </svg>
  );
  const nextCourse = courses.find((c) => (c.doneLessons || []).length < c.lessons.length) || courses[0];

  return (
    <div className="lv-home" style={{ maxWidth: 880, margin: "0 auto", padding: "30px 24px 56px", fontFamily: "var(--cb-font)" }}>
      <style>{CSS}</style>
      {tourOpen && <CortexTour P={P} accent={accent} at={at} onClose={closeTour} />}
      <div className="lv-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: accent, display: "inline-flex", flexShrink: 0 }}><Icon name="cortex" size={36} /></span>
            <h1 className="lv-h1" style={{ fontFamily: SERIF, fontSize: 36, fontWeight: 600, color: P.ink, margin: "0 0 8px" }}>Cortex</h1>
          </div>
          <p className="lv-sub" style={{ color: P.muted, fontSize: 15.5, lineHeight: 1.55, margin: 0, maxWidth: 520 }}>
            Where papers become memory. Short courses built from the papers themselves. Every question is a real finding, every debate is a real disagreement, and reviews come back when your memory starts to fade.
          </p>
          <button onClick={() => setTourOpen(true)}
            style={{ background: "none", border: "none", color: accent, cursor: "pointer", fontSize: 13.5, fontWeight: 600, fontFamily: "var(--cb-font)", padding: "8px 0 0", display: "inline-flex", alignItems: "center", gap: 6 }}>
            How Cortex works <Icon name="arrowRight" size={13} />
          </button>
        </div>
        <button onClick={() => { const v = !soundOn; setSoundOn(v); saveJSON(SOUND_KEY, v); }}
          aria-label={soundOn ? "Mute lesson sounds" : "Unmute lesson sounds"}
          style={{ background: "transparent", border: "1px solid " + P.line, borderRadius: 999, color: P.muted, cursor: "pointer", padding: "8px 14px", fontSize: 13, fontFamily: "var(--cb-font)", flexShrink: 0 }}>
          Sound {soundOn ? "on" : "off"}
        </button>
      </div>

      <div className="lv-pills" style={{ display: "flex", gap: 9, flexWrap: "wrap", margin: "20px 0 26px" }}>
        {pill(flame, profile ? profile.streak || 0 : 0, "day streak" + (profile && profile.freezes ? " · " + profile.freezes + " freeze" + (profile.freezes === 1 ? "" : "s") : ""))}
        {pill(null, profile ? profile.xp : 0, "XP")}
        {pill(null, due.length, "due for review")}
        {pill(null, courses.length, "courses")}
      </div>

      {/* continue hero */}
      {nextCourse && (
        <button onClick={() => setScreen({ name: "path", courseId: nextCourse.id })}
          style={{
            display: "block", width: "100%", textAlign: "left", cursor: "pointer", padding: 0,
            background: P.raised, border: "1px solid " + P.line, borderRadius: 22, overflow: "hidden",
            fontFamily: "var(--cb-font)", color: P.ink, marginBottom: 24,
          }}>
          <Cover title={nextCourse.title} height={128} radius={0} cat={CATALOG.find((c) => c.name === nextCourse.category) || null} img={nextCourse.img} />
          <span style={{ display: "block", padding: "18px 22px 20px" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.12em", color: accent, display: "block", marginBottom: 7 }}>
              {(nextCourse.doneLessons || []).length > 0 ? "CONTINUE" : "START HERE"}
            </span>
            <span className="lv-hero-title" style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 600, lineHeight: 1.28, display: "block" }}>{nextCourse.title}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 13 }}>
              <span style={{ flex: 1, height: 8, borderRadius: 999, background: P.line, overflow: "hidden", display: "block" }}>
                <span className="lv-fill" style={{
                  display: "block", height: "100%", background: accent, borderRadius: 999,
                  width: (nextCourse.lessons.length ? Math.round(((nextCourse.doneLessons || []).length / nextCourse.lessons.length) * 100) : 0) + "%",
                }} />
              </span>
              <span style={{ fontSize: 13, color: P.muted }}>{(nextCourse.doneLessons || []).length} of {nextCourse.lessons.length} lessons</span>
            </span>
          </span>
        </button>
      )}

      {/* the catalog */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>THE CATALOG</div>
        <p style={{ fontSize: 14.5, color: P.muted, lineHeight: 1.55, margin: "0 0 16px" }}>
          Shelves of science, ready when you are. Tap a course and Cortex builds it from the literature on the spot, papers and all.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {["All", ...CATALOG.map((c) => c.name), ...(published.length ? ["From contributors"] : [])].map((name) => (
            <button key={name} className="lv-chip" onClick={() => setCatFilter(name)}
              style={{
                borderRadius: 999, padding: "9px 15px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "var(--cb-font)",
                background: catFilter === name ? accent : "transparent",
                color: catFilter === name ? (at || "#101408") : P.ink,
                border: "1px solid " + (catFilter === name ? accent : P.line),
              }}>
              {name}
            </button>
          ))}
        </div>
        <div className="lv-catalog">
          {CATALOG.filter((c) => catFilter === "All" || catFilter === c.name).flatMap((cat) => cat.topics.map((t) => ({ cat, t }))).map(({ cat, t }) => {
            const existing = courses.find((c) => c.title === t.t);
            const isBuilding = building && buildingLabel === t.t;
            return (
              <button key={cat.name + t.t} className="lv-topic" disabled={building}
                onClick={() => { if (existing) setScreen({ name: "path", courseId: existing.id }); else buildCourseFrom(t.q, t.t, cat.name, t.img); }}
                style={{
                  textAlign: "left", cursor: building ? "wait" : "pointer", padding: 0, overflow: "hidden",
                  background: P.raised, border: "1px solid " + P.line, borderRadius: 20,
                  fontFamily: "var(--cb-font)", color: P.ink, opacity: building && !isBuilding ? 0.55 : 1,
                }}>
                <Cover title={t.t} height={104} radius={0} cat={cat} img={t.img} />
                <span style={{ display: "block", padding: "14px 16px 16px" }}>
                  <span style={{ fontFamily: SERIF, fontSize: 17.5, fontWeight: 600, lineHeight: 1.3, display: "block" }}>{t.t}</span>
                  <span style={{ fontSize: 13, color: P.muted, lineHeight: 1.5, display: "block", marginTop: 5, minHeight: 39 }}>{t.b}</span>
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: P.muted }}>{cat.name.toUpperCase()}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>{existing ? "Open" : isBuilding ? "Searching..." : "Build course"}</span>
                  </span>
                </span>
              </button>
            );
          })}
          {published.filter((e) => catFilter === "All" || catFilter === "From contributors" || catFilter === e.category).map((e) => {
            const cat = CATALOG.find((c) => c.name === e.category);
            const existing = courses.find((c) => c.title === e.title);
            const isBuilding = building && buildingLabel === e.title;
            return (
              <button key={e.id} className="lv-topic" disabled={building}
                onClick={() => { if (existing) setScreen({ name: "path", courseId: existing.id }); else buildCourseFrom(e.query, e.title, e.category); }}
                style={{
                  textAlign: "left", cursor: building ? "wait" : "pointer", padding: 0, overflow: "hidden",
                  background: P.raised, border: "1px solid " + P.line, borderRadius: 20,
                  fontFamily: "var(--cb-font)", color: P.ink, opacity: building && !isBuilding ? 0.55 : 1,
                }}>
                {cat ? <CategoryArt motif={cat.motif} pair={cat.pair} height={104} radius={0} /> : <Cover title={e.title} height={104} radius={0} />}
                <span style={{ display: "block", padding: "14px 16px 16px" }}>
                  <span style={{ fontFamily: SERIF, fontSize: 17.5, fontWeight: 600, lineHeight: 1.3, display: "block" }}>{e.title}</span>
                  <span style={{ fontSize: 13, color: P.muted, lineHeight: 1.5, display: "block", marginTop: 5, minHeight: 39 }}>{e.blurb || e.query}</span>
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <span style={{ fontSize: 11.5, color: P.muted, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ color: accent, display: "inline-flex" }}><Icon name="cortex" size={12} /></span>
                      by {String(e.createdBy || "").split("@")[0]}
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>{existing ? "Open" : isBuilding ? "Searching..." : "Build course"}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 12, color: P.muted, margin: "14px 0 0" }}>Cover photos are free stock matched to each topic, from Pexels, Unsplash, and Wikimedia Commons.</p>
        {buildError && catFilter !== null && buildingLabel === "" && (
          <p style={{ color: "#FF8A8A", fontSize: 14, margin: "14px 0 0" }}>{buildError}</p>
        )}
      </div>

      {/* topic builder */}
      <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: 20, padding: 22, marginBottom: 24 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>BUILD A COURSE</div>
        <p style={{ fontSize: 14.5, color: P.muted, lineHeight: 1.55, margin: "0 0 14px" }}>
          Name a topic. Cerebrum searches the literature and turns the findings into a course on the spot.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") buildCourse(); }}
            placeholder="e.g. black soldier fly larvae gut microbiome"
            aria-label="Course topic"
            style={{
              flex: "1 1 320px", background: P.bg, border: "1px solid " + P.line, borderRadius: 14,
              padding: "14px 16px", fontSize: 15.5, color: P.ink, fontFamily: "var(--cb-font)", minHeight: 54, boxSizing: "border-box",
            }}
          />
          <button className="lv-btn lv-btn-primary" onClick={buildCourse} disabled={building || !topic.trim()}
            style={{
              background: accent, color: at || "#101408", border: "none", borderRadius: 14,
              padding: "14px 26px", fontSize: 15.5, fontWeight: 700, cursor: building ? "wait" : "pointer",
              fontFamily: "var(--cb-font)", minHeight: 54, opacity: building || !topic.trim() ? 0.55 : 1,
            }}>
            {building ? "Searching the literature..." : "Build course"}
          </button>
        </div>
        {buildError && <p style={{ color: "#FF8A8A", fontSize: 14, margin: "12px 0 0" }}>{buildError}</p>}
      </div>

      {/* review queue */}
      {due.length > 0 && (
        <div style={{ border: "1px solid " + accent, borderRadius: 20, padding: 22, marginBottom: 24, background: P.raised }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>DUE FOR REVIEW</div>
          <p style={{ fontSize: 15, color: P.ink, lineHeight: 1.55, margin: "0 0 14px" }}>
            {due.length} finding{due.length === 1 ? " is" : "s are"} starting to fade. Reviewing now, while they are cheap to relearn, is what makes them permanent.
          </p>
          <button className="lv-btn lv-btn-primary" onClick={startReview}
            style={{ background: accent, color: at || "#101408", border: "none", borderRadius: 12, padding: "13px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)" }}>
            Start review
          </button>
        </div>
      )}

      {/* contributor studio */}
      {access.isCreator && (
        <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: 20, padding: 22, marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>CONTRIBUTOR STUDIO</div>
          <p style={{ fontSize: 14.5, color: P.muted, lineHeight: 1.55, margin: "0 0 14px" }}>
            You can publish to the catalog. A published course is a topic and a promise: when someone taps it, Cortex builds it from the real literature, same as every course here.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input value={studio.title} onChange={(e) => setStudio({ ...studio, title: e.target.value })}
              placeholder="Course title" aria-label="Catalog course title"
              style={{ flex: "1 1 220px", background: P.bg, border: "1px solid " + P.line, borderRadius: 12, padding: "12px 14px", fontSize: 15, color: P.ink, fontFamily: "var(--cb-font)", minHeight: 48, boxSizing: "border-box" }} />
            <select value={studio.category} onChange={(e) => setStudio({ ...studio, category: e.target.value })}
              aria-label="Catalog category"
              style={{ flex: "0 1 200px", background: P.bg, border: "1px solid " + P.line, borderRadius: 12, padding: "12px 14px", fontSize: 15, color: P.ink, fontFamily: "var(--cb-font)", minHeight: 48, boxSizing: "border-box" }}>
              {CATALOG.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <input value={studio.query} onChange={(e) => setStudio({ ...studio, query: e.target.value })}
              placeholder="Topic the course is built from, e.g. tardigrade desiccation" aria-label="Catalog course topic"
              style={{ flex: "1 1 220px", background: P.bg, border: "1px solid " + P.line, borderRadius: 12, padding: "12px 14px", fontSize: 15, color: P.ink, fontFamily: "var(--cb-font)", minHeight: 48, boxSizing: "border-box" }} />
            <input value={studio.blurb} onChange={(e) => setStudio({ ...studio, blurb: e.target.value })}
              placeholder="One line that sells it honestly" aria-label="Catalog course blurb"
              style={{ flex: "1 1 220px", background: P.bg, border: "1px solid " + P.line, borderRadius: 12, padding: "12px 14px", fontSize: 15, color: P.ink, fontFamily: "var(--cb-font)", minHeight: 48, boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14, flexWrap: "wrap" }}>
            <button className="lv-btn lv-btn-primary" onClick={publishEntry} disabled={!studio.title.trim() || !studio.query.trim()}
              style={{ background: accent, color: at || "#101408", border: "none", borderRadius: 12, padding: "12px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", opacity: !studio.title.trim() || !studio.query.trim() ? 0.55 : 1 }}>
              Publish to catalog
            </button>
            {studioMsg && <span style={{ fontSize: 13.5, color: P.muted }}>{studioMsg}</span>}
          </div>
          {published.filter((e) => access.isFounder || e.createdBy === access.email).length > 0 && (
            <div style={{ marginTop: 18, borderTop: "1px solid " + P.line, paddingTop: 14 }}>
              {published.filter((e) => access.isFounder || e.createdBy === access.email).map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title} <span style={{ color: P.muted }}>· {e.category}</span></span>
                  <button onClick={() => deleteEntry(e.id)}
                    style={{ background: "transparent", border: "1px solid " + P.line, borderRadius: 999, color: P.muted, cursor: "pointer", padding: "6px 12px", fontSize: 12.5, fontFamily: "var(--cb-font)" }}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* owner: creator access */}
      {access.isFounder && (
        <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: 20, padding: 22, marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>CREATORS</div>
          <p style={{ fontSize: 14.5, color: P.muted, lineHeight: 1.55, margin: "0 0 14px" }}>
            Type an email and that account can create for Cortex: publishing catalog courses from the studio above. Creators also receive the Cortex Contributor badge on their profile.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input value={creatorEmail} onChange={(e) => setCreatorEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") grantCreator(); }}
              placeholder="creator@example.com" aria-label="Creator email" type="email"
              style={{ flex: "1 1 260px", background: P.bg, border: "1px solid " + P.line, borderRadius: 12, padding: "12px 14px", fontSize: 15, color: P.ink, fontFamily: "var(--cb-font)", minHeight: 48, boxSizing: "border-box" }} />
            <button className="lv-btn lv-btn-primary" onClick={grantCreator} disabled={!creatorEmail.trim()}
              style={{ background: accent, color: at || "#101408", border: "none", borderRadius: 12, padding: "12px 24px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "var(--cb-font)", opacity: !creatorEmail.trim() ? 0.55 : 1 }}>
              Allow creator
            </button>
          </div>
          {ownerMsg && <p style={{ fontSize: 13.5, color: P.muted, margin: "12px 0 0" }}>{ownerMsg}</p>}
          {creators.length > 0 && (
            <div style={{ marginTop: 16, borderTop: "1px solid " + P.line, paddingTop: 12 }}>
              {creators.map((c) => (
                <div key={c.email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
                  <span style={{ color: accent, display: "inline-flex" }}><Icon name="cortex" size={15} /></span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email}</span>
                  <button onClick={() => revokeCreator(c.email)}
                    style={{ background: "transparent", border: "1px solid " + P.line, borderRadius: 999, color: P.muted, cursor: "pointer", padding: "6px 12px", fontSize: 12.5, fontFamily: "var(--cb-font)" }}>
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* library */}
      {courses.length === 0 ? (
        <div style={{ border: "1px dashed " + P.line, borderRadius: 20, padding: "38px 28px", textAlign: "center" }}>
          <h3 style={{ fontFamily: SERIF, color: P.ink, fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>No courses yet</h3>
          <p style={{ color: P.muted, fontSize: 14.5, lineHeight: 1.6, margin: "0 auto 20px", maxWidth: 430 }}>
            Build one above, or open any answer in Search and choose Turn into course. Either way, the course is made from the papers that search found.
          </p>
          <button onClick={() => onNavigate && onNavigate("search")}
            style={{ background: "transparent", border: "1px solid " + P.line, borderRadius: 12, padding: "12px 22px", color: P.ink, fontSize: 15, cursor: "pointer", fontFamily: "var(--cb-font)" }}>
            Go to Search
          </button>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: P.muted, margin: "6px 0 14px" }}>YOUR COURSES</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
            {courses.map((course) => {
              const mem = memoryState(course, claims);
              const doneCount = (course.doneLessons || []).length;
              return (
                <button key={course.id} onClick={() => setScreen({ name: "path", courseId: course.id })}
                  style={{
                    textAlign: "left", cursor: "pointer", padding: 0, overflow: "hidden",
                    background: P.raised, border: "1px solid " + P.line, borderRadius: 20,
                    fontFamily: "var(--cb-font)", color: P.ink,
                  }}>
                  <Cover title={course.title} height={96} radius={0} fontSize={150} cat={CATALOG.find((c) => c.name === course.category) || null} img={course.img} />
                  <span style={{ display: "block", padding: "15px 18px 17px" }}>
                    <span style={{ fontFamily: SERIF, fontSize: 18.5, fontWeight: 600, lineHeight: 1.3, display: "block", minHeight: 48 }}>{course.title}</span>
                    <span style={{ fontSize: 12.5, color: P.muted, display: "block", marginTop: 4 }}>
                      {course.lessons.length} lessons · {course.sourceCount || 0} papers
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                      <span style={{ flex: 1, height: 7, borderRadius: 999, background: P.line, overflow: "hidden", display: "block" }}>
                        <span className="lv-fill" style={{ display: "block", height: "100%", background: accent, borderRadius: 999, width: (course.lessons.length ? Math.round((doneCount / course.lessons.length) * 100) : 0) + "%" }} />
                      </span>
                      <span style={{ fontSize: 12, color: mem.pct > 0 || doneCount > 0 ? accent : P.muted, fontWeight: 600 }}>{mem.label}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
