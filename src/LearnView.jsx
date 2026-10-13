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
    // Cortex claims inherit the answer's markdown, where species names
    // are underscore wrapped. This cleaner predates that convention, so
    // the underscore marks survived literally on cards.
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
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

/* ── built in curriculum ───────────────────────────────────────────
   Paths a visitor can learn from with no search and no papers: the
   concepts are taught directly, in small steps, with activities.
   Papers become optional depth at the end of a lesson, never a gate.
   Content is standard textbook knowledge, written for a curious
   twelve year old, in plain words. Card factories keep the data
   compact; the validators below keep it honest. */

const BUILTIN_PROGRESS_KEY = "cerebrum-learn2-progress";

function loadBuiltinProgress() {
  const p = loadJSON(BUILTIN_PROGRESS_KEY, null);
  if (p && p.lessons) return p;
  return { lessons: {}, lastPathId: "", lastLessonId: "" };
}
function saveBuiltinProgress(p) { saveJSON(BUILTIN_PROGRESS_KEY, p); }

const mkNote = (kicker, title, text) => ({ kind: "note", kicker, title, text });
const mkQuiz = (question, options, correct, why) => ({ kind: "quiz", question, options, correct, why });
const mkTrueFalse = (statement, answer, why) => ({
  kind: "truefalse", statement, answer, correct: answer ? 0 : 1,
  options: ["True", "False"], why,
});
const mkMatch = (prompt, pairs, why) => ({
  kind: "match", question: prompt, prompt, why,
  pairs: pairs.map(([left, right]) => ({ left, right })),
});
const mkOrder = (prompt, items, why) => ({ kind: "order", question: prompt, prompt, items, why });
const mkDeepen = (text) => ({ kind: "deepen", text });

export const LEARNING_PATHS = [
  {
    id: "how-science-works",
    title: "How Science Works",
    blurb: "How we know what we know: questions, tests, and evidence.",
    category: "Mind and Brain",
    units: [
      {
        id: "sci-asking", title: "Asking Good Questions", subtitle: "The start of every discovery",
        lessons: [
          {
            id: "sci-questions", title: "Questions That Can Be Tested", subtitle: "Science starts with a question the world can answer",
            cards: [
              mkNote("The big idea", "Science starts with a question",
                "Science begins when someone asks a question the world can answer. Not every question works. A good science question points at something you can observe, count, or measure, so the answer can be checked by anyone who repeats the work."),
              mkQuiz("Which of these questions can science test directly?",
                ["Which song is the most beautiful ever written?", "Do plants grow faster in sunlight or in shade?", "What is the meaning of life?", "Which color is the luckiest?"],
                1,
                "Growth can be measured, so the plant question can be tested. Beauty, meaning, and luck rest on opinion, so no test can settle them."),
              mkMatch("Match each word to what it means.",
                [["Observe", "Watch or measure something carefully"], ["Evidence", "Facts that support an idea"], ["Test", "A check that can be repeated"], ["Question", "Something you want to find out"]],
                "These four words run the whole of science: a question, a test, careful observing, and the evidence that comes back."),
              mkTrueFalse("A scientific test only counts if it works one time.",
                false,
                "A result you can trust can be repeated. If a test works once and never again, scientists suspect luck, an error, or a hidden difference in how it was done."),
              mkQuiz("A claim is testable when...",
                ["everyone already agrees with it", "an observation could show it is wrong", "it sounds impressive", "it has been believed for a long time"],
                1,
                "If nothing you could observe would ever count against a claim, there is no way to test it. Testable claims stick their neck out."),
              mkDeepen("Go deeper: the findings in Cortex courses come from real papers, and the pretesting effect is one of them. Guessing before you study makes the answer stick. Build a course from a search to see the evidence yourself."),
            ],
          },
          {
            id: "sci-hypothesis", title: "Guesses You Can Check", subtitle: "What a hypothesis really is",
            cards: [
              mkNote("Key idea", "A hypothesis is a careful guess",
                "A hypothesis is a possible answer stated clearly enough to be tested. It is more than a hunch. It says what you expect to happen, and what you expect not to happen, before the test begins."),
              mkQuiz("Which of these is a hypothesis?",
                ["Plants are wonderful.", "Fertilizer will make these tomato plants grow taller than plants without it.", "Maybe something will happen.", "Science is hard."],
                1,
                "The fertilizer statement predicts a result that a test can confirm or rule out. The others are feelings or maybes, and a test cannot touch them."),
              mkOrder("Put the steps of a simple investigation in order.",
                ["Ask a question", "Make a hypothesis", "Run a test", "Compare the result with the hypothesis", "Share what you found"],
                "Question first, then a guess, then a test, then a comparison, then sharing, so other people can check the work for themselves."),
              mkTrueFalse("A hypothesis that turns out to be wrong was a waste of time.",
                false,
                "A wrong hypothesis still teaches something real: that explanation is not the one. Ruling out wrong answers is progress, not failure."),
              mkQuiz("Why do scientists write the hypothesis down before the test?",
                ["To make the report longer", "So the prediction cannot be quietly changed after the results arrive", "Because journals like long documents", "To impress other scientists"],
                1,
                "Writing it first keeps everyone honest. A prediction invented after seeing the results is not a prediction at all."),
              mkDeepen("Go deeper: real papers state their hypotheses up front, in the introduction, before a single result appears. Build a course from a search and watch for that pattern in the findings."),
            ],
          },
        ],
      },
      {
        id: "sci-evidence", title: "Evidence and Proof", subtitle: "What the world says back",
        lessons: [
          {
            id: "sci-what-counts", title: "What Counts as Evidence", subtitle: "Observations beat opinions",
            cards: [
              mkNote("The big idea", "Evidence is what the world says back",
                "Evidence is information gathered by observing and measuring: counts, weights, times, photographs, records. A strong opinion is not evidence, and neither is a good story by itself. Evidence is the part anyone else can go and check."),
              mkMatch("Match each word to what it means.",
                [["Claim", "A statement that could be true or false"], ["Data", "Measurements and observations you collect"], ["Anecdote", "A single story about what happened once"], ["Conclusion", "What the evidence points to, in the end"]],
                "Claims are cheap. Data is what you gather. A conclusion is what the data supports once you have it."),
              mkQuiz("Which is the strongest evidence that a new medicine works?",
                ["A famous actor says it helped him", "One patient felt better after taking it", "A large study where similar patients took the medicine or a dummy pill, and more of the medicine group recovered", "The company that sells it says it works"],
                2,
                "Big groups and fair comparisons win. A single story can be luck, and a seller has a reason to praise the product."),
              mkTrueFalse("One personal story can be true and still be weak evidence.",
                true,
                "Both can hold at once. One story might be exactly what happened, but a single case cannot show what usually happens."),
              mkQuiz("Two friends disagree about whether it rained more this year than last year. What settles it?",
                ["Whoever argues loudest", "Rainfall records for both years", "Whoever is older", "A coin toss"],
                1,
                "Records beat memories. Measurements written down at the time do not depend on who remembers best."),
              mkDeepen("Go deeper: Cortex courses are built from study findings, and each finding is a small piece of evidence with its paper attached. Build one and judge the strength of each piece yourself."),
            ],
          },
          {
            id: "sci-repeat", title: "Why Scientists Repeat Tests", subtitle: "Once is a hint, twice is a pattern",
            cards: [
              mkNote("Key idea", "Once is a hint, twice is a pattern",
                "A single study can be a fluke, a mistake, or plain luck. When other scientists repeat the test and get the same result, confidence grows. Science trusts results that survive repetition, not results that happened once."),
              mkQuiz("A study finds a surprising result. What should happen next?",
                ["It becomes fact forever", "Other scientists try to repeat it and check the result", "It is kept secret", "The scientists celebrate and stop"],
                1,
                "Surprising results get the most checking, not the least. Repetition by other teams is how a finding earns trust."),
              mkTrueFalse("Before a study is published in a good journal, other scientists usually read it and look for problems.",
                true,
                "That checking is called peer review. It does not catch everything, but it removes many errors before the work reaches the public."),
              mkOrder("Put the life of a typical study in order.",
                ["A scientist runs a study", "Other scientists review the write up", "The study is published", "Other teams try to repeat it", "The result becomes trusted or fades"],
                "Review comes before publishing, and repetition comes after. Trust is the last step, not the first."),
              mkQuiz("A result that many teams have repeated is...",
                ["less trustworthy", "more trustworthy", "a coincidence", "forbidden"],
                1,
                "Every successful repetition makes luck a weaker explanation. Repeated results are the closest science gets to settled."),
              mkDeepen("Go deeper: some famous findings failed when teams tried to repeat them, and the papers about those failures are some of the most useful reading in science. Search for replication studies and build a course from what you find."),
            ],
          },
        ],
      },
    ],
  },
  {
    id: "the-human-body",
    title: "The Human Body",
    blurb: "The pump, the plumbing, and the wiring that run you.",
    category: "Body and Health",
    units: [
      {
        id: "body-heart-blood", title: "The Heart and Blood", subtitle: "A delivery service that never stops",
        lessons: [
          {
            id: "body-heart", title: "Your Heart, the Pump", subtitle: "A fist sized muscle with a nonstop job",
            cards: [
              mkNote("The big idea", "A pump that never clocks out",
                "Your heart is a muscle about the size of your fist. It squeezes about once a second, all day and all night, pushing blood around your body. Each squeeze sends blood out carrying oxygen and food, and welcomes back blood the body is done with."),
              mkQuiz("What does blood carry to the cells of your body?",
                ["Only water", "Oxygen and nutrients", "Electricity", "Bones"],
                1,
                "Blood is the delivery system. It brings oxygen and nutrients to every cell and carries waste products away."),
              mkMatch("Match each part to its job.",
                [["Heart", "The muscle that pumps blood"], ["Artery", "A vessel that carries blood away from the heart"], ["Vein", "A vessel that carries blood back to the heart"], ["Oxygen", "The gas your cells use to release energy"]],
                "Arteries head out, veins head back, and the heart keeps the whole loop moving."),
              mkTrueFalse("Your heart stops to rest between beats for most of the day.",
                false,
                "The heart rests only in the short pauses between beats. It beats about 100,000 times a day without ever taking a real break."),
              mkQuiz("When you run, your heart beats faster because...",
                ["it is frightened", "your muscles need more oxygen, faster", "running shakes it loose", "your blood gets thinner"],
                1,
                "Working muscles burn oxygen faster. The heart speeds up to deliver more blood per minute and keep up."),
              mkDeepen("Go deeper: papers on exercise and the heart measure exactly how much fitter hearts can do. Build a course from a search on exercise and longevity to read the findings."),
            ],
          },
          {
            id: "body-blood", title: "Blood Does the Carrying", subtitle: "What is actually in the red stuff",
            cards: [
              mkNote("The big idea", "A delivery service in your veins",
                "Blood is mostly a pale liquid called plasma, with cells floating in it. Red cells carry oxygen. White cells fight germs. Tiny pieces called platelets help seal leaks when you are cut. Each part has one job and does it everywhere, all the time."),
              mkQuiz("Which part of blood carries oxygen?",
                ["Plasma", "Red blood cells", "Platelets", "White blood cells"],
                1,
                "Red blood cells are packed with a protein that grabs oxygen in the lungs and lets go of it where the body needs it."),
              mkTrueFalse("A scab is the body sealing a leak in a blood vessel.",
                true,
                "When skin is cut, platelets and proteins in the blood build a clot that plugs the leak. The dry top of that clot is the scab."),
              mkMatch("Match each part of blood to its job.",
                [["Plasma", "The liquid part of blood"], ["Red blood cells", "Carry oxygen around the body"], ["White blood cells", "Hunt and destroy germs"], ["Platelets", "Help blood clot when you are cut"]],
                "One liquid, three crews: carriers, defenders, and repairers."),
              mkQuiz("Why does blood look red?",
                ["Food dyes it red", "Red cells hold an iron rich protein that turns bright red when it carries oxygen", "It reflects the color of skin", "It is always hot"],
                1,
                "The protein is called hemoglobin. The iron at its center binds oxygen, and hemoglobin loaded with oxygen is bright red."),
              mkDeepen("Go deeper: blood is one of the most studied tissues in medicine. Search for a blood topic that interests you and Cortex will build a course from the real findings."),
            ],
          },
        ],
      },
      {
        id: "body-nerves-senses", title: "Senses and Nerves", subtitle: "Messages, shortcuts, and useful illusions",
        lessons: [
          {
            id: "body-nerves", title: "Messages at Lightning Speed", subtitle: "The wiring inside you",
            cards: [
              mkNote("The big idea", "Your wiring",
                "Your nervous system is a network of long thin cells called neurons. They carry tiny electrical signals from your senses to your brain, and back out to your muscles. That round trip is how you can catch a ball you barely saw moving."),
              mkQuiz("What carries messages around your body?",
                ["Bones", "Neurons", "Only blood cells", "Hair"],
                1,
                "Neurons are the wiring. Signals travel along them as small pulses of electricity, then jump to the next cell as chemical messages."),
              mkOrder("Put the steps of catching a ball in order.",
                ["Your eyes spot the ball moving", "Signals travel from your eyes to your brain", "Your brain works out where the ball is going", "Signals travel to the muscles in your arms", "Your hands close around the ball"],
                "Seeing comes first and grabbing comes last, with a lot of very fast signaling in between."),
              mkTrueFalse("The brain itself can feel pain when it is injured.",
                false,
                "Brain tissue has no pain sensors of its own. Headaches come from the blood vessels and membranes around the brain, not from the brain itself."),
              mkQuiz("A reflex, like pulling your hand off a hot pan, is fast because...",
                ["the signal takes a shortcut through the spinal cord", "your hand is brave", "hot things glow", "the brain works slowly on purpose"],
                0,
                "Many reflex signals loop through the spinal cord and straight back to the muscle, without waiting for the brain to decide."),
              mkDeepen("Go deeper: reaction time is a favorite measurement in sports science papers. Search for it and build a course to see what actually makes people faster."),
            ],
          },
          {
            id: "body-senses", title: "Tricking Your Senses", subtitle: "Your brain builds what you experience",
            cards: [
              mkNote("The big idea", "Your senses report, your brain decides",
                "Your eyes and ears gather raw signals, but your brain builds what you actually experience. That is why optical illusions work. The brain uses shortcuts to make sense of the signals, and shortcuts can be fooled."),
              mkQuiz("In an optical illusion, the mistake happens mostly in...",
                ["the paper", "the brain, as it interprets the signals", "the light", "your hands"],
                1,
                "The eyes report honestly. The brain guesses what the signals mean, and an illusion is a case where the guess is wrong."),
              mkTrueFalse("Two people can taste the same food differently.",
                true,
                "Taste depends on your taste buds, your sense of smell, and even your genes. Some people carry a gene that makes certain green vegetables taste very bitter."),
              mkMatch("Match each sense to what it gathers.",
                [["Sight", "Light entering the eyes"], ["Hearing", "Vibrations reaching the ears"], ["Smell", "Tiny particles landing in the nose"], ["Touch", "Pressure, heat, and cold felt by the skin"]],
                "Five senses, five kinds of signal, one brain putting it all together."),
              mkQuiz("Most of what we call taste actually comes from...",
                ["the tongue alone", "smell, working with the tongue", "the teeth", "memory"],
                1,
                "Hold your nose and an apple and an onion start to taste alike. Smell does most of the work we credit to taste."),
              mkDeepen("Go deeper: studies of Homo sapiens show taste and smell acting as one system, and super tasters carrying extra taste buds. Search for either topic and build a course from the findings."),
            ],
          },
        ],
      },
    ],
  },
  {
    id: "space-and-the-solar-system",
    title: "Space and the Solar System",
    blurb: "Our star, its planets, and the pull that holds them.",
    category: "Space and Physics",
    units: [
      {
        id: "space-neighborhood", title: "Our Neighborhood", subtitle: "The Sun and its eight planets",
        lessons: [
          {
            id: "space-planets", title: "The Planets in Order", subtitle: "Four rocky worlds, four giants",
            cards: [
              mkNote("The big idea", "Eight planets, one star",
                "Our solar system is the Sun plus everything its gravity holds: eight planets, their moons, and crowds of rocky and icy leftovers. The four planets nearest the Sun are small and rocky. The four far ones are giants made mostly of gas and liquid."),
              mkOrder("Put these planets in order from the Sun.",
                ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn"],
                "Mercury is closest, then Venus, Earth, and Mars, and then the giants Jupiter and Saturn. Uranus and Neptune come after Saturn."),
              mkQuiz("Which planet is known as the red planet?",
                ["Venus", "Mars", "Jupiter", "Mercury"],
                1,
                "Mars looks red because its rocks and dust are rich in iron that has rusted."),
              mkMatch("Match each body to its description.",
                [["Sun", "The star at the center of our system"], ["Earth", "The only planet known to have life"], ["Jupiter", "The largest planet"], ["Moon", "The natural satellite that orbits Earth"]],
                "One star, one home, one giant, and one faithful moon."),
              mkTrueFalse("The Sun is a star.",
                true,
                "The Sun is a medium sized star. It only looks huge and bright because it is so much closer than every other star."),
              mkDeepen("Go deeper: the first photograph of a black hole and the newest exoplanet papers all start from this neighborhood. Search for a space topic and Cortex will build a course from the real research."),
            ],
          },
          {
            id: "space-day-year", title: "Day, Night, and the Year", subtitle: "Spinning and circling at the same time",
            cards: [
              mkNote("The big idea", "Spinning and circling",
                "Earth spins on its axis once a day, and that spin gives us day and night. At the same time Earth travels all the way around the Sun, taking one year for the full trip. The seasons come from Earth's tilt, not from being closer to the Sun."),
              mkQuiz("What causes day and night?",
                ["The Sun moving around Earth", "Earth spinning on its axis", "Clouds covering the Sun", "The Moon blocking the light"],
                1,
                "As Earth spins, your side turns to face the Sun, then turns away again. Facing the Sun is day; facing away is night."),
              mkTrueFalse("Summer happens because Earth is closest to the Sun in July.",
                false,
                "Earth is actually near its farthest from the Sun in early July. Summer comes from your half of Earth tilting toward the Sun, so sunlight lands on it more directly."),
              mkQuiz("One full trip of Earth around the Sun takes...",
                ["One day", "One month", "One year", "Ten years"],
                2,
                "That trip is the year. The day comes from the spin, the year from the journey around the Sun."),
              mkOrder("Put these in order from shortest to longest.",
                ["One spin of Earth, a day", "One trip of the Moon around Earth, about a month", "One trip of Earth around the Sun, a year"],
                "A day is one spin, a month is roughly one lap of the Moon, and a year is one full lap around the Sun."),
              mkDeepen("Go deeper: papers on other planets track days that last longer than their years. Venus is the famous case. Search for it and build a course from what you find."),
            ],
          },
        ],
      },
      {
        id: "space-outward", title: "Looking Outward", subtitle: "Gravity and the lives of stars",
        lessons: [
          {
            id: "space-gravity", title: "Gravity Holds It All", subtitle: "The pull between everything",
            cards: [
              mkNote("The big idea", "The invisible pull",
                "Gravity is a pull between anything that has mass. Bigger masses pull harder, and the pull weakens with distance. Gravity holds you to Earth, holds the Moon near Earth, and holds every planet in its path around the Sun."),
              mkQuiz("Why does the Moon stay near Earth instead of drifting away?",
                ["The oceans hold it", "Earth's gravity keeps pulling it in", "It has no way to move", "Space is completely empty"],
                1,
                "The Moon is always falling toward Earth and always missing, because it also moves sideways fast. That endless fall is its orbit."),
              mkTrueFalse("Astronauts on the space station float because there is no gravity up there.",
                false,
                "Gravity at the station is nearly as strong as on the ground. The astronauts float because they and the station are falling around Earth together, in an endless fall that keeps missing the ground."),
              mkMatch("Match each word to what it means.",
                [["Mass", "How much stuff something is made of"], ["Orbit", "The curved path of one object around another"], ["Gravity", "The pull between masses"], ["Telescope", "A tool that gathers light from far away"]],
                "Mass makes gravity, gravity bends paths into orbits, and telescopes let us watch it all happen."),
              mkQuiz("If the Sun's gravity suddenly vanished, Earth would...",
                ["stop moving at once", "fly off in a straight line", "fall into the Moon", "spin twice as fast"],
                1,
                "Earth keeps the speed it already has. With nothing pulling it into a curve, it would travel straight, like a ball leaving a swinging string when the string is cut."),
              mkDeepen("Go deeper: gravity waves were predicted a century before detectors finally heard them. Search for gravitational waves and Cortex will build a course from the papers."),
            ],
          },
          {
            id: "space-stars", title: "Stars and Their Lives", subtitle: "Born in clouds, shining for ages",
            cards: [
              mkNote("The big idea", "Stars are born, shine, and fade",
                "A star begins as a cold cloud of gas that gravity squeezes until the center grows hot enough to fuse atoms together. That fusion pours out light and heat for billions of years. When the fuel runs low, the star changes, swelling up or fading away depending on its size."),
              mkQuiz("What powers a star's light?",
                ["Burning wood", "Atoms fusing in its hot core", "Reflected sunlight", "Lightning in space"],
                1,
                "Deep in the core, hydrogen atoms are squeezed together into helium, and a little mass becomes a lot of energy. That energy is the light."),
              mkTrueFalse("All stars are the same color.",
                false,
                "A star's color tells its temperature. Blue white stars are the hottest, yellow stars like the Sun sit in between, and red stars are the coolest of all."),
              mkOrder("Put the life of a star like the Sun in order.",
                ["A cloud of gas squeezes together", "The core gets hot enough for fusion", "The star shines steadily for billions of years", "The fuel runs low and the star swells", "The star fades into a small dense ember"],
                "The last stage is called a white dwarf: a hot, dense ember that slowly cools over ages."),
              mkQuiz("Sunlight takes about eight minutes to reach Earth. That means we see the Sun...",
                ["as it will be in eight minutes", "as it was eight minutes ago", "instantly, with no delay", "only at night"],
                1,
                "Light is fast, but space is big. Everything we see is the past, and the farther away it is, the older the light that reaches us."),
              mkDeepen("Go deeper: astronomers read a star's whole life story from its light. Search for how stars are classified and build a course from the research."),
            ],
          },
        ],
      },
    ],
  },
  {
    id: "earth-and-weather",
    title: "Earth and Weather",
    blurb: "Water on the move, and the air above it all.",
    category: "Earth and Climate",
    units: [
      {
        id: "earth-water", title: "Water on the Move", subtitle: "The loop that never ends",
        lessons: [
          {
            id: "earth-water-cycle", title: "The Water Cycle", subtitle: "The same water, round and round",
            cards: [
              mkNote("The big idea", "The same water, round and round",
                "The water in your glass is ancient. It has been in oceans, clouds, rain, rivers, and living things, over and over again. The Sun powers the whole loop by lifting water into the air as invisible vapor."),
              mkOrder("Put the water cycle in order.",
                ["Sunlight warms the ocean", "Water rises into the air as vapor", "The vapor cools and forms clouds", "Water falls as rain or snow", "Rivers carry it back to the ocean"],
                "Warmth lifts the water, cooling gathers it into clouds, gravity brings it down, and rivers return it to the sea."),
              mkQuiz("Water rising from the sea into the air has...",
                ["evaporated", "frozen", "condensed", "rained"],
                0,
                "Evaporation is liquid water turning into vapor. It happens at the surface of oceans, lakes, and even wet soil."),
              mkMatch("Match each word to what it means.",
                [["Evaporation", "Liquid water turning into vapor"], ["Condensation", "Vapor turning back into liquid drops"], ["Precipitation", "Rain, snow, or hail falling from clouds"], ["Collection", "Water gathering in oceans, lakes, and the ground"]],
                "Up as vapor, back as drops, down as rain, gathered in the sea. Then it starts again."),
              mkTrueFalse("Rain over land is a brand new supply of water made by clouds.",
                false,
                "Clouds move water around; they do not create it. Rain is ocean and lake water that evaporated, traveled on the wind, and fell again."),
              mkDeepen("Go deeper: scientists trace water through whole landscapes in papers on the water cycle and climate. Search for a river or ocean topic and build a course from the findings."),
            ],
          },
          {
            id: "earth-clouds", title: "Clouds and Rain", subtitle: "Water you can see in the sky",
            cards: [
              mkNote("The big idea", "Clouds are water you can see",
                "Air always holds some invisible water vapor. When air rises and cools, the vapor condenses onto tiny specks of dust, forming droplets so small they float. Billions of those droplets together make a cloud."),
              mkQuiz("A cloud forms when water vapor...",
                ["disappears", "cools and condenses into tiny droplets", "boils", "turns into oxygen"],
                1,
                "Cooling is the trigger. Cold air holds less vapor, so the extra vapor gathers into droplets around specks of dust."),
              mkTrueFalse("Fog is a cloud that forms at ground level.",
                true,
                "Same recipe, different height. When air at the surface cools until its vapor condenses, the cloud simply sits on the ground, and we call it fog."),
              mkQuiz("Raindrops begin to fall when the droplets...",
                ["grow heavy enough that the air cannot hold them up", "turn blue", "freeze solid", "hear thunder"],
                0,
                "Droplets grow by joining together. Once they are too heavy for the rising air inside the cloud to support, down they come."),
              mkMatch("Match each cloud to its description.",
                [["Cumulus", "Puffy clouds with flat bottoms"], ["Cirrus", "Thin wispy clouds high in the sky"], ["Stratus", "Gray sheets of cloud that cover the sky"], ["Fog", "A cloud resting on the ground"]],
                "Sailors and farmers read the sky with these four shapes long before satellites existed."),
              mkDeepen("Go deeper: cloud research decides big questions about how fast the planet warms. Search for clouds and climate and Cortex will build a course from the real papers."),
            ],
          },
        ],
      },
      {
        id: "earth-skies", title: "Weather and Climate", subtitle: "Today versus the usual",
        lessons: [
          {
            id: "earth-weather", title: "Reading the Weather", subtitle: "What the air is doing right now",
            cards: [
              mkNote("The big idea", "Weather is what is happening now",
                "Weather is the state of the air right now and over the next few days: temperature, wind, rain, and storms. It changes fast because air is always moving, pushed along by the Sun heating some places more than others."),
              mkQuiz("Wind blows because...",
                ["trees wave it into being", "air moves from where pressure is high to where it is low", "the Earth pauses its spin", "birds push the air along"],
                1,
                "Uneven heating makes pressure differences, and air flows to even them out. That flow is the wind."),
              mkTrueFalse("A thermometer measures air pressure.",
                false,
                "A thermometer measures temperature. Air pressure is measured with a different tool, a barometer."),
              mkMatch("Match each tool to its job.",
                [["Thermometer", "Measures temperature"], ["Barometer", "Measures air pressure"], ["Rain gauge", "Measures how much rain fell"], ["Weather vane", "Shows where the wind comes from"]],
                "Four simple tools, and a person with all four can describe a day of weather completely."),
              mkOrder("Put the life of a thunderstorm in order.",
                ["Warm wet air rises quickly", "A tall storm cloud builds", "Lightning and thunder arrive as the storm peaks", "Heavy rain falls and the storm weakens"],
                "Rising warm air builds the tower, the storm spends itself in lightning and rain, and then it runs out of energy."),
              mkDeepen("Go deeper: forecasters test their predictions against what actually happened, and the scorekeeping papers are fascinating. Search for weather forecast accuracy and build a course."),
            ],
          },
          {
            id: "earth-climate", title: "Weather Is Not Climate", subtitle: "One week versus thirty years",
            cards: [
              mkNote("The big idea", "Two different questions",
                "Weather asks what this week looks like. Climate asks what a place is usually like over thirty years or more. One cold week does not change a climate, just as one hot day does not prove one either. They are different questions with different evidence."),
              mkQuiz("Which statement is about climate?",
                ["It will rain on Thursday", "Winters here are usually cold and dry", "A storm knocked out power last night", "Today is windy"],
                1,
                "Climate is the usual pattern. The others are single moments of weather, lasting hours or days."),
              mkTrueFalse("A single snowstorm proves the planet is not warming.",
                false,
                "Climate is the long pattern, and weather swings up and down inside that pattern. One storm, or one cold week, cannot settle a question about decades."),
              mkQuiz("Scientists describe a climate using averages over about...",
                ["one afternoon", "one week", "thirty years", "one hour"],
                2,
                "Thirty years is the standard span for climate averages. It is long enough for the year to year wiggles to smooth out."),
              mkMatch("Match each word to what it means.",
                [["Weather", "What the air is doing this week"], ["Climate", "The usual pattern over decades"], ["Forecast", "A prediction of weather ahead"], ["Season", "A yearly period with its own typical weather"]],
                "Weather is the day, climate is the habit, and a forecast is our best guess at tomorrow."),
              mkDeepen("Go deeper: the papers behind climate averages are public and readable. Search for a climate question of your own and Cortex will build a course from the evidence."),
            ],
          },
        ],
      },
    ],
  },
];

export const INTERACTIVE_KINDS = ["quiz", "cloze", "battle", "truefalse", "match", "order"];
export function isInteractiveCard(card) {
  return !!card && INTERACTIVE_KINDS.includes(card.kind);
}

/* Flatten a path into its lessons in teaching order, each tagged
   with its unit so views can group them back. */
export function flattenPathLessons(path) {
  const out = [];
  (path.units || []).forEach((unit, ui) => {
    (unit.lessons || []).forEach((lesson) => {
      out.push({ ...lesson, unitId: unit.id, unitTitle: unit.title, unitIndex: ui, flatIndex: out.length });
    });
  });
  return out;
}

/* A lesson is unlocked when it is first in its path, or when the
   lesson before it is complete. Paths are staircases, not shelves. */
export function isLessonUnlocked(path, lessonId, progress) {
  const flat = flattenPathLessons(path);
  const i = flat.findIndex((l) => l.id === lessonId);
  if (i <= 0) return true;
  const prev = (progress && progress.lessons || {})[flat[i - 1].id];
  return !!(prev && prev.done);
}

export function pathProgress(path, progress) {
  const flat = flattenPathLessons(path);
  const store = (progress && progress.lessons) || {};
  const done = flat.filter((l) => store[l.id] && store[l.id].done).length;
  const next = flat.find((l) => !(store[l.id] && store[l.id].done)) || null;
  return {
    done, total: flat.length,
    pct: flat.length ? Math.round((done / flat.length) * 100) : 0,
    complete: flat.length > 0 && done === flat.length,
    nextLessonId: next ? next.id : null,
  };
}

/* Record a finished built in lesson: best score kept, the path's
   continue pointer moved to the next unfinished lesson. Pure: takes
   a progress object, returns the next one. */
export function applyLessonResult(progress, path, lessonId, pct) {
  const next = {
    lessons: { ...((progress && progress.lessons) || {}) },
    lastPathId: path.id,
    lastLessonId: lessonId,
  };
  const prev = next.lessons[lessonId] || {};
  next.lessons[lessonId] = {
    done: true,
    best: Math.max(prev.best || 0, Math.round(pct || 0)),
    completedAt: prev.completedAt || new Date().toISOString(),
  };
  const pp = pathProgress(path, next);
  if (pp.nextLessonId) next.lastLessonId = pp.nextLessonId;
  return next;
}

/* Daily practice: due review cards first in spirit, then activities
   sampled from lessons already finished in paths the learner has
   started. Deterministic for a given seed, so a day is stable. */
export function buildDailyPracticeCards({ progress, dueCards = [], seed = 1, limit = 8, paths = LEARNING_PATHS } = {}) {
  const store = (progress && progress.lessons) || {};
  const pool = [];
  for (const path of paths) {
    const flat = flattenPathLessons(path);
    const started = flat.some((l) => store[l.id] && store[l.id].done);
    if (!started) continue;
    for (const l of flat) {
      if (store[l.id] && store[l.id].done) {
        for (const c of l.cards) if (isInteractiveCard(c)) pool.push(c);
      }
    }
  }
  const duePart = dueCards.slice(0, 6);
  const picks = seededShuffle(pool, seed || 1).slice(0, Math.max(0, limit - duePart.length));
  return seededShuffle([...duePart, ...picks], (seed || 1) + 13).slice(0, limit);
}

/* The honesty gate for authored content: every interactive card must
   be answerable exactly as written, and every lesson must carry
   enough activity to be worth the name. Returns problems, never
   throws, so tests can list them all. */
export function validateCurriculum(paths = LEARNING_PATHS) {
  const problems = [];
  const lessonIds = new Set();
  const cardCheck = (card, where) => {
    if (!card || !card.kind) { problems.push(where + ": card without a kind"); return; }
    if (card.kind === "quiz" || card.kind === "cloze") {
      if (!Array.isArray(card.options) || card.options.length < 2) problems.push(where + ": " + card.kind + " needs at least 2 options");
      else if (!(card.correct >= 0 && card.correct < card.options.length)) problems.push(where + ": " + card.kind + " correct index is outside its options");
      if (!card.why) problems.push(where + ": " + card.kind + " has no explanation");
    } else if (card.kind === "truefalse") {
      if (typeof card.answer !== "boolean") problems.push(where + ": truefalse answer is not a boolean");
      if (!card.statement) problems.push(where + ": truefalse has no statement");
      if (!card.why) problems.push(where + ": truefalse has no explanation");
      if (card.correct !== (card.answer ? 0 : 1)) problems.push(where + ": truefalse correct index disagrees with its answer");
    } else if (card.kind === "match") {
      if (!Array.isArray(card.pairs) || card.pairs.length < 3 || card.pairs.length > 6) problems.push(where + ": match needs 3 to 6 pairs");
      else {
        const lefts = card.pairs.map((p) => p.left);
        const rights = card.pairs.map((p) => p.right);
        if (new Set(lefts).size !== lefts.length) problems.push(where + ": match left sides repeat");
        if (new Set(rights).size !== rights.length) problems.push(where + ": match right sides repeat");
        if (card.pairs.some((p) => !p.left || !p.right)) problems.push(where + ": match has an empty side");
      }
    } else if (card.kind === "order") {
      if (!Array.isArray(card.items) || card.items.length < 3 || card.items.length > 6) problems.push(where + ": order needs 3 to 6 items");
      else if (new Set(card.items).size !== card.items.length) problems.push(where + ": order items repeat");
      if (!card.why) problems.push(where + ": order has no explanation");
    } else if (card.kind === "note") {
      if (!card.title || !card.text) problems.push(where + ": note needs a title and text");
    } else if (card.kind === "deepen") {
      if (!card.text || card.text.length < 20) problems.push(where + ": deepen line is missing or too short");
    } else if (card.kind === "summary" || card.kind === "paper") {
      if (!card.title) problems.push(where + ": " + card.kind + " has no title");
    } else {
      problems.push(where + ": unknown card kind " + card.kind);
    }
  };
  for (const path of paths || []) {
    if (!path.id || !path.title) problems.push("a path is missing its id or title");
    if (!Array.isArray(path.units) || path.units.length < 2) problems.push(path.title + ": needs at least 2 units");
    for (const unit of path.units || []) {
      if (!Array.isArray(unit.lessons) || unit.lessons.length < 2) problems.push(path.title + " / " + unit.title + ": needs at least 2 lessons");
      for (const lesson of unit.lessons || []) {
        const where = path.title + " / " + lesson.title;
        if (!lesson.id) problems.push(where + ": lesson has no id");
        else if (lessonIds.has(lesson.id)) problems.push(where + ": lesson id repeats across the curriculum");
        lessonIds.add(lesson.id);
        if (!Array.isArray(lesson.cards) || lesson.cards.length < 5 || lesson.cards.length > 8) {
          problems.push(where + ": lesson needs 5 to 8 cards, has " + (lesson.cards || []).length);
        }
        const interactive = (lesson.cards || []).filter(isInteractiveCard).length;
        if (interactive < 3) problems.push(where + ": lesson needs at least 3 interactive cards, has " + interactive);
        (lesson.cards || []).forEach((c, i) => cardCheck(c, where + " card " + (i + 1)));
      }
    }
  }
  return problems;
}

/* Shape a built in path as a course the Player already understands. */
function courseFromPath(path, progress) {
  const store = (progress && progress.lessons) || {};
  const flat = flattenPathLessons(path);
  return {
    id: "path-" + path.id,
    builtin: true,
    pathId: path.id,
    title: path.title,
    category: path.category,
    sourceCount: 0,
    lessons: flat,
    doneLessons: flat.filter((l) => store[l.id] && store[l.id].done).map((l) => l.id),
    xpEarned: 0,
    vocab: [],
  };
}

/* ── lesson player (full screen) ─────────────────────────────────── */
function Player({ course, startLesson, P, accent, at, soundOn, onExit, onProgress, onLessonDone }) {
  const [lessonIdx, setLessonIdx] = useState(startLesson || 0);
  const [cardIdx, setCardIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [checked, setChecked] = useState(false);
  const [matchSel, setMatchSel] = useState(null);
  const [matchDone, setMatchDone] = useState([]);
  const [matchMistakes, setMatchMistakes] = useState(0);
  const [matchFlash, setMatchFlash] = useState(null);
  const [orderPlaced, setOrderPlaced] = useState([]);
  const [orderCorrect, setOrderCorrect] = useState(false);
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
  const interactive = isInteractiveCard(card);
  const isRight = interactive && card.kind !== "battle" && (
    card.kind === "match" ? matchMistakes === 0
    : card.kind === "order" ? orderCorrect
    : picked === card.correct
  );
  const lessonPct = lesson ? Math.round(((cardIdx + (checked ? 1 : 0)) / lesson.cards.length) * 100) : 0;

  /* Display orders for the tap activities, shuffled once per card so
     the right column and the item pool are not just the answer key
     read aloud. */
  const matchRights = useMemo(() => {
    if (!card || card.kind !== "match") return [];
    return seededShuffle(card.pairs.map((_, i) => i), hashStr(card.prompt || "") + 31);
  }, [card]);
  const orderDisplay = useMemo(() => {
    if (!card || card.kind !== "order") return [];
    return seededShuffle(card.items, hashStr(card.prompt || "") + 47);
  }, [card]);

  const resetCardState = () => {
    setPicked(null); setChecked(false);
    setMatchSel(null); setMatchDone([]); setMatchMistakes(0); setMatchFlash(null);
    setOrderPlaced([]); setOrderCorrect(false);
  };

  const award = (xp) => { setSessionXp((x) => x + xp); };

  const noteMiss = () => {
    const origin = course.lessons[lessonIdx];
    setMisses((ms) => (ms.some((m) => m.card === card) ? ms : [...ms, { card, lessonTitle: origin ? origin.title : "" }]));
  };

  const pick = (i) => {
    if (checked || !interactive) return;
    setPicked(i);
    playSound("tick", soundOn);
  };

  /* Match play: tap a left item, then the right item that belongs to
     it. A right pair locks in green; a wrong one flashes and counts
     as a mistake. Completing the card scores it like a quiz: full
     marks for a clean run, partial marks otherwise. */
  const matchLeftTap = (i) => {
    if (checked || matchDone.includes(i)) return;
    setMatchSel(i);
    playSound("tick", soundOn);
  };
  const matchRightTap = (pairIdx) => {
    if (checked || matchSel === null || matchDone.includes(pairIdx)) return;
    if (pairIdx === matchSel) {
      const doneNow = [...matchDone, pairIdx];
      setMatchDone(doneNow);
      setMatchSel(null);
      playSound("correct", soundOn);
      if (doneNow.length === card.pairs.length) {
        const clean = matchMistakes === 0;
        setChecked(true);
        setAnswered((n) => n + 1);
        if (clean) setRight((n) => n + 1); else noteMiss();
        award(clean ? 10 : 4);
        onProgress && onProgress(clean ? 10 : 4, course);
      }
    } else {
      setMatchMistakes((m) => m + 1);
      setMatchFlash(pairIdx);
      playSound("wrong", soundOn);
      setTimeout(() => setMatchFlash(null), 480);
    }
  };

  /* Order play: tap items in the sequence you believe, tap a placed
     item to take it back, then check. The whole sequence is scored
     at once, and the explanation carries the right order. */
  const orderTap = (item) => {
    if (checked) return;
    setOrderPlaced((placed) => placed.includes(item) ? placed.filter((x) => x !== item) : [...placed, item]);
    playSound("tick", soundOn);
  };
  const checkOrder = () => {
    if (!card || card.kind !== "order" || checked) return;
    if (orderPlaced.length !== card.items.length) return;
    const ok = orderPlaced.every((v, i) => v === card.items[i]);
    setOrderCorrect(ok);
    setChecked(true);
    setAnswered((n) => n + 1);
    if (ok) setRight((n) => n + 1); else noteMiss();
    award(ok ? 10 : 4);
    playSound(ok ? "correct" : "wrong", soundOn);
    onProgress && onProgress(ok ? 10 : 4, course);
  };

  const check = () => {
    if (!interactive || picked === null || checked) return;
    if (card.kind === "match" || card.kind === "order") return;
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
      if (onLessonDone) {
        onLessonDone(lesson, answered ? Math.round((right / answered) * 100) : 100);
      }
    }
    setShowLessonDone(true);
  };

  const advance = () => {
    if (interactive && !checked) return;
    if (!interactive) { award(2); onProgress && onProgress(2, course); }
    resetCardState();
    if (cardIdx < lesson.cards.length - 1) { setCardIdx(cardIdx + 1); return; }
    if (reviewCards) { setReviewCards(null); setCardIdx(0); setShowLessonDone(true); return; }
    finishLesson(true);
  };

  const startMissReview = (cards) => {
    setReviewCards(cards);
    setCardIdx(0);
    resetCardState();
    setShowLessonDone(false); setShowIntro(false);
  };

  const nextLesson = () => {
    setShowLessonDone(false);
    resetCardState();
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
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", color: accent, marginBottom: 10 }}>{course.builtin ? "PATH COMPLETE" : "COURSE COMPLETE"}</div>
          <h2 style={{ fontFamily: SERIF, fontSize: 32, fontWeight: 600, margin: "0 0 12px", lineHeight: 1.2 }}>{course.title}</h2>
          <p style={{ color: P.muted, fontSize: 16, lineHeight: 1.6, margin: "0 auto 30px", maxWidth: 440 }}>
            {course.builtin
              ? "Every lesson on this path is done. Your progress is saved on the path, and daily practice will keep pulling activities from it so the ideas stay fresh."
              : "Every finding you answered is on your review schedule now. It comes back when it starts to fade, not before."}
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
                  <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.45, marginBottom: 6 }}>{m.card.question || m.card.statement}</div>
                  <div style={{ fontSize: 14.5, lineHeight: 1.55, color: P.muted }}>
                    {m.card.cite || m.card.paperTitle ? "The finding: " : "The idea: "}<span style={{ color: P.ink }}>{m.card.why}</span>
                  </div>
                  {m.card.paperTitle && (
                    <div style={{ fontSize: 12.5, color: P.muted, marginTop: 6 }}>{m.card.cite} · {m.card.paperTitle}</div>
                  )}
                </div>
              ))}
              <p style={{ fontSize: 13.5, color: P.muted, lineHeight: 1.55, textAlign: "center", margin: "14px 0 0" }}>
                {course.builtin
                  ? "Daily practice pulls from lessons you have finished, so these will come back around."
                  : "These are already on your review schedule, so they will come back while they are still fresh enough to fix."}
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
          <button className="lv-btn lv-btn-primary" style={btnPrimary} onClick={onExit}>{course.builtin ? "Back to the path" : "Back to your courses"}</button>
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
            {course.builtin
              ? "+" + lessonXp + " XP. This lesson is marked on your path, and the next one is unlocked."
              : "+" + lessonXp + " XP. The findings from this lesson are on your review schedule now."}
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
  const lessonChecks = lesson.cards.filter(isInteractiveCard).length;
  const maxCites = Math.max(1, ...lessonPapers.map((c) => c.citations || 0));
  const paperYearOf = (c) => { const y = parseInt(formatYearValue(c && c.year), 10); if (Number.isFinite(y)) return y; const m = String((c && c.meta) || "").match(/\b(?:19|20)\d{2}\b/); return m ? parseInt(m[0], 10) : null; };
  const displayMeta = (meta) => String(meta || "").replace(/\b((?:19|20)\d{2})\.0\b/g, "$1");
  const lessonYears = lessonPapers.map(paperYearOf).filter((y) => y != null);
  const cardKindLabel = (c) => c.kind === "paper" ? "Read" : c.kind === "cloze" ? "Predict" : c.kind === "battle" ? "Debate" : c.kind === "note" ? "Intro" : c.kind === "summary" ? "Wrap" : c.kind === "match" ? "Match" : c.kind === "order" ? "Order" : c.kind === "truefalse" ? "True or false" : c.kind === "deepen" ? "Go deeper" : c.vocab ? "Vocab" : "Recall";

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
            : card.kind === "match" ? (isRight ? "Every pair, first try." : "All pairs matched.")
            : card.kind === "order" ? (isRight ? "In the right order." : "Not the right order.")
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
            <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#4a5a38", margin: "0 0 4px" }}>{card.cite || card.paperTitle ? "THE FINDING" : "WHY"}</p>
            <p style={{ fontFamily: SERIF, fontSize: 16.5, lineHeight: 1.6, margin: 0, color: "#1d2a10" }}>{card.why}</p>
            {(card.cite || card.paperTitle) && (
              <p style={{ fontSize: 12.5, color: "#4a5a38", margin: "10px 0 0" }}>{card.cite}{card.paperTitle ? " · " + card.paperTitle : ""}</p>
            )}
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

          {card.kind === "truefalse" && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>TRUE OR FALSE</div>
              <div style={{ background: P.raised, border: "1px solid " + P.line, borderLeft: "4px solid " + accent, borderRadius: 16, padding: "19px 21px", marginBottom: 20 }}>
                <p style={{ fontFamily: SERIF, fontSize: 21, lineHeight: 1.55, margin: 0 }}>{card.statement}</p>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {["True", "False"].map((label, i) => {
                  let bg = P.dark ? "#242b24" : "#ffffff", border = P.line, color = P.ink;
                  if (checked && i === card.correct) { bg = "#D7FFB8"; border = "#58CC02"; color = "#224d00"; }
                  else if (checked && i === picked) { bg = "#FFDFE0"; border = "#FF4B4B"; color = "#6e0f13"; }
                  else if (!checked && picked === i) { bg = P.dark ? "#274b63" : "#DDF4FF"; border = "#84D8FF"; color = P.ink; }
                  return (
                    <button key={label} className={"lv-opt" + (checked && picked === i && i !== card.correct ? " lv-shake" : "")}
                      onClick={() => pick(i)} disabled={checked}
                      style={{
                        appearance: "none", WebkitAppearance: "none", background: bg, backgroundColor: bg,
                        border: "2px solid " + border, borderRadius: 16, padding: "18px 12px",
                        fontSize: 18, fontWeight: 700, color, cursor: checked ? "default" : "pointer",
                        fontFamily: "var(--cb-font)", minHeight: 62,
                      }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {card.kind === "match" && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>MATCH THE PAIRS</div>
              <h2 style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 600, lineHeight: 1.4, margin: "0 0 8px" }}>{card.prompt}</h2>
              <p style={{ fontSize: 14.5, color: P.muted, margin: "0 0 4px", lineHeight: 1.55 }}>Tap a word on the left, then tap the meaning it belongs with on the right.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {card.pairs.map((pair, i) => {
                    const donePair = matchDone.includes(i);
                    const selected = matchSel === i;
                    return (
                      <button key={"l" + i} onClick={() => matchLeftTap(i)} disabled={donePair || checked}
                        className="lv-opt"
                        style={{
                          appearance: "none", WebkitAppearance: "none", width: "100%", boxSizing: "border-box",
                          background: donePair ? "#D7FFB8" : selected ? (P.dark ? "#274b63" : "#DDF4FF") : (P.dark ? "#242b24" : "#ffffff"),
                          border: "2px solid " + (donePair ? "#58CC02" : selected ? "#84D8FF" : P.line), borderRadius: 14,
                          padding: "13px 14px", fontSize: 15.5, fontWeight: 700, lineHeight: 1.45, textAlign: "left",
                          color: donePair ? "#224d00" : P.ink, cursor: donePair || checked ? "default" : "pointer",
                          fontFamily: "var(--cb-font)", minHeight: 52,
                        }}>
                        {pair.left}{donePair ? " ✓" : ""}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {matchRights.map((pairIdx) => {
                    const donePair = matchDone.includes(pairIdx);
                    const flash = matchFlash === pairIdx;
                    return (
                      <button key={"r" + pairIdx} onClick={() => matchRightTap(pairIdx)} disabled={donePair || checked}
                        className={"lv-opt" + (flash ? " lv-shake" : "")}
                        style={{
                          appearance: "none", WebkitAppearance: "none", width: "100%", boxSizing: "border-box",
                          background: donePair ? "#D7FFB8" : flash ? "#FFDFE0" : (P.dark ? "#242b24" : "#ffffff"),
                          border: "2px solid " + (donePair ? "#58CC02" : flash ? "#FF4B4B" : P.line), borderRadius: 14,
                          padding: "13px 14px", fontSize: 15, lineHeight: 1.5, textAlign: "left",
                          color: donePair ? "#224d00" : flash ? "#6e0f13" : P.ink, cursor: donePair || checked ? "default" : "pointer",
                          fontFamily: "var(--cb-font)", minHeight: 52,
                        }}>
                        {card.pairs[pairIdx].right}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p style={{ fontSize: 13.5, color: P.muted, margin: "16px 0 0" }}>
                {matchDone.length} of {card.pairs.length} matched{matchMistakes > 0 ? " · " + matchMistakes + (matchMistakes === 1 ? " miss" : " misses") : ""}
              </p>
            </div>
          )}

          {card.kind === "order" && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>PUT IT IN ORDER</div>
              <h2 style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 600, lineHeight: 1.4, margin: "0 0 8px" }}>{card.prompt}</h2>
              <p style={{ fontSize: 14.5, color: P.muted, margin: "0 0 4px", lineHeight: 1.55 }}>Tap the steps in the order they happen. Tap a placed step to take it back.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, margin: "20px 0 18px" }}>
                {orderPlaced.length === 0 && (
                  <p style={{ fontSize: 14.5, color: P.muted, margin: 0, border: "1.5px dashed " + P.line, borderRadius: 14, padding: "15px 16px" }}>Your order will appear here.</p>
                )}
                {orderPlaced.map((item, i) => {
                  const rightHere = checked && card.items[i] === item;
                  const wrongHere = checked && card.items[i] !== item;
                  return (
                    <button key={"p" + i} onClick={() => orderTap(item)} disabled={checked}
                      className="lv-opt"
                      style={{
                        appearance: "none", WebkitAppearance: "none", width: "100%", boxSizing: "border-box",
                        display: "flex", gap: 12, alignItems: "center", textAlign: "left",
                        background: rightHere ? "#D7FFB8" : wrongHere ? "#FFDFE0" : withAlphaSafe(accent, P.dark ? 0.2 : 0.12),
                        border: "2px solid " + (rightHere ? "#58CC02" : wrongHere ? "#FF4B4B" : accent), borderRadius: 14,
                        padding: "12px 15px", fontSize: 15.5, lineHeight: 1.45,
                        color: rightHere ? "#224d00" : wrongHere ? "#6e0f13" : P.ink,
                        cursor: checked ? "default" : "pointer", fontFamily: "var(--cb-font)", minHeight: 52,
                      }}>
                      <span aria-hidden="true" style={{
                        flexShrink: 0, width: 26, height: 26, borderRadius: "50%",
                        background: rightHere ? "#58CC02" : wrongHere ? "#FF4B4B" : accent, color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13.5, fontWeight: 800,
                      }}>{i + 1}</span>
                      <span style={{ minWidth: 0 }}>{item}</span>
                    </button>
                  );
                })}
              </div>
              {orderDisplay.filter((item) => !orderPlaced.includes(item)).length > 0 && (
                <>
                  <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.12em", color: P.muted, marginBottom: 10 }}>THE STEPS</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
                    {orderDisplay.filter((item) => !orderPlaced.includes(item)).map((item) => (
                      <button key={"pool" + item} onClick={() => orderTap(item)} disabled={checked}
                        className="lv-opt"
                        style={{
                          appearance: "none", WebkitAppearance: "none", boxSizing: "border-box",
                          background: P.dark ? "#242b24" : "#ffffff", border: "2px solid " + P.line, borderRadius: 999,
                          padding: "10px 16px", fontSize: 15, fontWeight: 600, lineHeight: 1.4,
                          color: P.ink, cursor: checked ? "default" : "pointer", fontFamily: "var(--cb-font)", minHeight: 46,
                        }}>
                        {item}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {checked && !orderCorrect && (
                <p style={{ fontSize: 14.5, color: P.muted, margin: "18px 0 0", lineHeight: 1.6 }}>
                  The right order: {card.items.join(", then ")}.
                </p>
              )}
            </div>
          )}

          {card.kind === "deepen" && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>GO DEEPER · OPTIONAL</div>
              <div style={{ background: P.raised, border: "1px solid " + P.line, borderLeft: "4px solid " + accent, borderRadius: 16, padding: "20px 22px" }}>
                <p style={{ fontSize: 17, lineHeight: 1.65, margin: 0 }}>{card.text}</p>
              </div>
              <p style={{ fontSize: 14, color: P.muted, lineHeight: 1.55, margin: "16px 0 0" }}>
                This lesson stands on its own. The papers are there when you want them, under Courses from your searches on the Cortex home.
              </p>
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
            {card.kind === "match" ? (
              <button className="lv-btn" disabled
                style={{ ...btnPrimary, width: "100%", opacity: 0.45, cursor: "default" }}>
                Match every pair to finish
              </button>
            ) : card.kind === "order" ? (
              <button className="lv-btn lv-btn-primary"
                style={{
                  ...btnPrimary, width: "100%",
                  opacity: orderPlaced.length !== card.items.length ? 0.45 : 1,
                  cursor: orderPlaced.length !== card.items.length ? "default" : "pointer",
                }}
                onClick={checkOrder} disabled={orderPlaced.length !== card.items.length}>
                Check order
              </button>
            ) : (
              <button className="lv-btn lv-btn-primary"
                style={{
                  ...btnPrimary, width: "100%",
                  opacity: interactive && picked === null ? 0.45 : 1,
                  cursor: interactive && picked === null ? "default" : "pointer",
                }}
                onClick={interactive ? check : advance} disabled={interactive && picked === null}>
                {interactive ? "Check" : cardIdx === lesson.cards.length - 1 ? "Finish lesson" : "Continue"}
              </button>
            )}
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

/* ── built in path view ────────────────────────────────────────────
   A path is a staircase: units stack, lessons inside a unit wind
   down the page with a gentle zigzag, and a lesson stays locked
   until the one before it is done. */
function BuiltinPathView({ path, progress, P, accent, at, onPlay, onBack }) {
  const pp = pathProgress(path, progress);
  const store = (progress && progress.lessons) || {};
  const offsets = [0, 38, 56, 38, 0];
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "26px 24px 56px", fontFamily: "var(--cb-font)" }}>
      <style>{CSS}</style>
      <button onClick={onBack} style={{ background: "none", border: "none", color: P.muted, cursor: "pointer", fontSize: 14.5, fontFamily: "var(--cb-font)", padding: "4px 0", marginBottom: 16 }}>
        ← Cortex home
      </button>
      <div className="lv-rise">
        <Cover title={path.title} height={168} radius={22} cat={CATALOG.find((c) => c.name === path.category) || null} />
        <h2 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, lineHeight: 1.22, margin: "22px 0 8px", color: P.ink }}>{path.title}</h2>
        <p style={{ color: P.muted, fontSize: 15, lineHeight: 1.55, margin: "0 0 6px" }}>{path.blurb}</p>
        <p style={{ color: P.muted, fontSize: 14, margin: 0 }}>
          {pp.total} lessons · {path.units.length} units · taught directly, no papers needed
        </p>
        <div style={{ margin: "16px 0 6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: P.muted, marginBottom: 6 }}>
            <span>Path progress</span><span>{pp.done} of {pp.total} lessons</span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: P.line, overflow: "hidden" }}>
            <div className="lv-fill" style={{ width: pp.pct + "%", height: "100%", background: accent, borderRadius: 999 }} />
          </div>
        </div>
      </div>

      {path.units.map((unit, ui) => (
        <div key={unit.id} style={{ marginTop: 34 }}>
          <div style={{
            background: withAlphaSafe(accent, P.dark ? 0.16 : 0.1), border: "1px solid " + P.line,
            borderRadius: 18, padding: "16px 20px", marginBottom: 26,
          }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 5 }}>UNIT {ui + 1}</div>
            <div style={{ fontFamily: SERIF, fontSize: 21, fontWeight: 600, lineHeight: 1.3, color: P.ink }}>{unit.title}</div>
            <p style={{ color: P.muted, fontSize: 14, lineHeight: 1.5, margin: "4px 0 0" }}>{unit.subtitle}</p>
          </div>
          {unit.lessons.map((lesson, li) => {
            const flatIdx = flattenPathLessons(path).findIndex((l) => l.id === lesson.id);
            const rec = store[lesson.id];
            const isDone = !!(rec && rec.done);
            const unlocked = isLessonUnlocked(path, lesson.id, progress);
            const isCurrent = unlocked && !isDone;
            const offset = offsets[(flatIdx + li) % offsets.length];
            return (
              <div key={lesson.id} style={{ display: "flex", gap: 16, alignItems: "flex-start", marginLeft: offset, marginBottom: 22, maxWidth: 520 }}>
                <div aria-hidden="true" className={isCurrent ? "lv-pulse" : ""}
                  style={{
                    flexShrink: 0, width: 56, height: 56, borderRadius: "50%",
                    background: isDone ? accent : P.raised,
                    border: "2px solid " + (isDone || isCurrent ? accent : P.line),
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: isDone ? at : isCurrent ? accent : P.muted,
                    fontWeight: 800, fontSize: 17, fontFamily: "var(--cb-font)",
                  }}>
                  {isDone ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 12.5 L10 17 L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  ) : unlocked ? flatIdx + 1 : (
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" stroke="currentColor" strokeWidth="2" />
                      <path d="M8 10.5 V7.8 a4 4 0 0 1 8 0 v2.7" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  )}
                </div>
                <button className="lv-node" onClick={() => unlocked && onPlay(flatIdx)} disabled={!unlocked}
                  style={{
                    flex: 1, minWidth: 0, display: "block", textAlign: "left",
                    cursor: unlocked ? "pointer" : "default",
                    background: P.raised, border: "1px solid " + (isCurrent ? accent : P.line), borderRadius: 18,
                    padding: "15px 18px", fontFamily: "var(--cb-font)", color: P.ink,
                    opacity: unlocked ? 1 : 0.55,
                  }}>
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <span style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, lineHeight: 1.3 }}>{lesson.title}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", color: isDone || isCurrent ? accent : P.muted, flexShrink: 0 }}>
                      {isDone ? "DONE" : isCurrent ? "UP NEXT" : "LOCKED"}
                    </span>
                  </span>
                  <span style={{ display: "block", color: P.muted, fontSize: 14, lineHeight: 1.5, marginTop: 5 }}>{lesson.subtitle}</span>
                  <span style={{ display: "block", fontSize: 12.5, color: P.muted, marginTop: 8 }}>
                    {isDone
                      ? "Best score " + (rec.best || 0) + "% · tap to play again"
                      : unlocked
                        ? lesson.cards.length + " cards · about " + Math.max(1, Math.round(lesson.cards.length * 0.4)) + " min"
                        : "Finish the lesson before this one to unlock it"}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      ))}
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
  const [builtinProgress, setBuiltinProgress] = useState(() => loadBuiltinProgress());
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

  /* Daily practice: one mixed session. Due findings from search
     courses come back first in spirit, and activities are sampled
     from built in lessons already finished, so practice is always
     review of things actually learned. */
  const startDaily = () => {
    const dueCards = due.slice(0, 10).map((c) => ({ ...c.card, claimId: c.id, kind: c.card.kind || "quiz" }));
    const seed = Number(todayKey().replace(/[^0-9]/g, "")) || 1;
    const cards = buildDailyPracticeCards({ progress: builtinProgress, dueCards, seed });
    if (!cards.length) return;
    setScreen({
      name: "player", fromPath: false,
      course: { id: "daily", title: "Daily practice", lessons: [{ id: "daily", title: "Daily practice", subtitle: "Fading findings and activities from your paths, mixed together", cards }], doneLessons: [] },
      startLesson: 0,
    });
  };

  /* Built in paths: starting a lesson points the continue row at
     it; finishing one records the score through the Player's
     onLessonDone callback. */
  const startBuiltinLesson = (path, flatIdx) => {
    const course = courseFromPath(path, builtinProgress);
    const lesson = course.lessons[flatIdx];
    if (!lesson) return;
    const cur = loadBuiltinProgress();
    cur.lastPathId = path.id;
    cur.lastLessonId = lesson.id;
    saveBuiltinProgress(cur);
    setBuiltinProgress(cur);
    setScreen({ name: "player", course, startLesson: flatIdx, fromPath: false, pathId: path.id });
  };
  const handleBuiltinLessonDone = (pathId, lesson, pct) => {
    const path = LEARNING_PATHS.find((p) => p.id === pathId);
    if (!path || !lesson) return;
    const next = applyLessonResult(loadBuiltinProgress(), path, lesson.id, pct);
    saveBuiltinProgress(next);
    setBuiltinProgress(next);
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
          setBuiltinProgress(loadBuiltinProgress());
          if (screen.pathId) setScreen({ name: "bpath", pathId: screen.pathId });
          else if (screen.fromPath && screen.course.id !== "review") setScreen({ name: "path", courseId: screen.course.id });
          else setScreen({ name: "home" });
        }}
        onProgress={handleProgress}
        onLessonDone={screen.course && screen.course.builtin
          ? (lesson, pct) => handleBuiltinLessonDone(screen.course.pathId, lesson, pct)
          : undefined}
      />
    );
  }

  if (screen.name === "bpath") {
    const path = LEARNING_PATHS.find((p) => p.id === screen.pathId);
    if (path) {
      return (
        <BuiltinPathView
          path={path} progress={builtinProgress} P={P} accent={accent} at={at || "#101408"}
          onPlay={(flatIdx) => startBuiltinLesson(path, flatIdx)}
          onBack={() => setScreen({ name: "home" })}
        />
      );
    }
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

  /* Continue: the last built in lesson touched wins, then an
     unfinished search course, then the first path as an invitation. */
  const lastPath = LEARNING_PATHS.find((p) => p.id === builtinProgress.lastPathId) || null;
  const lastLesson = lastPath
    ? flattenPathLessons(lastPath).find((l) => l.id === builtinProgress.lastLessonId) || null
    : null;
  const lastPathProg = lastPath ? pathProgress(lastPath, builtinProgress) : null;
  const startedPaths = LEARNING_PATHS.filter((p) => pathProgress(p, builtinProgress).done > 0);
  const dailyReady = due.length > 0 || startedPaths.length > 0;
  const totalPathLessons = LEARNING_PATHS.reduce((n, p) => n + flattenPathLessons(p).length, 0);
  const totalPathDone = LEARNING_PATHS.reduce((n, p) => n + pathProgress(p, builtinProgress).done, 0);

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
            Where papers become memory, and where anyone can simply learn. Follow a path and Cortex teaches the subject in small steps, with activities. Or build a course from real papers, where every question is a real finding and reviews come back when your memory starts to fade.
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

      {/* continue hero: last built in lesson, else an unfinished
          search course, else the first path as an invitation */}
      {(() => {
        const hero = lastPath && lastLesson ? {
          kicker: "CONTINUE · " + lastPath.title.toUpperCase(),
          title: lastLesson.title,
          sub: lastLesson.unitTitle + " · " + lastPath.title,
          pct: lastPathProg.pct,
          count: lastPathProg.done + " of " + lastPathProg.total + " lessons",
          coverTitle: lastPath.title,
          cat: CATALOG.find((c) => c.name === lastPath.category) || null,
          img: null,
          go: () => setScreen({ name: "bpath", pathId: lastPath.id }),
        } : nextCourse ? {
          kicker: (nextCourse.doneLessons || []).length > 0 ? "CONTINUE" : "START HERE",
          title: nextCourse.title,
          sub: "",
          pct: nextCourse.lessons.length ? Math.round(((nextCourse.doneLessons || []).length / nextCourse.lessons.length) * 100) : 0,
          count: (nextCourse.doneLessons || []).length + " of " + nextCourse.lessons.length + " lessons",
          coverTitle: nextCourse.title,
          cat: CATALOG.find((c) => c.name === nextCourse.category) || null,
          img: nextCourse.img,
          go: () => setScreen({ name: "path", courseId: nextCourse.id }),
        } : {
          kicker: "START A PATH",
          title: LEARNING_PATHS[0].title,
          sub: LEARNING_PATHS[0].blurb,
          pct: 0,
          count: flattenPathLessons(LEARNING_PATHS[0]).length + " lessons · no papers needed",
          coverTitle: LEARNING_PATHS[0].title,
          cat: CATALOG.find((c) => c.name === LEARNING_PATHS[0].category) || null,
          img: null,
          go: () => setScreen({ name: "bpath", pathId: LEARNING_PATHS[0].id }),
        };
        return (
          <button onClick={hero.go}
            style={{
              display: "block", width: "100%", textAlign: "left", cursor: "pointer", padding: 0,
              background: P.raised, border: "1px solid " + P.line, borderRadius: 22, overflow: "hidden",
              fontFamily: "var(--cb-font)", color: P.ink, marginBottom: 24,
            }}>
            <Cover title={hero.coverTitle} height={128} radius={0} cat={hero.cat} img={hero.img} />
            <span style={{ display: "block", padding: "18px 22px 20px" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.12em", color: accent, display: "block", marginBottom: 7 }}>
                {hero.kicker}
              </span>
              <span className="lv-hero-title" style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 600, lineHeight: 1.28, display: "block" }}>{hero.title}</span>
              {hero.sub && <span style={{ display: "block", fontSize: 13.5, color: P.muted, marginTop: 5 }}>{hero.sub}</span>}
              <span style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 13 }}>
                <span style={{ flex: 1, height: 8, borderRadius: 999, background: P.line, overflow: "hidden", display: "block" }}>
                  <span className="lv-fill" style={{ display: "block", height: "100%", background: accent, borderRadius: 999, width: hero.pct + "%" }} />
                </span>
                <span style={{ fontSize: 13, color: P.muted }}>{hero.count}</span>
              </span>
            </span>
          </button>
        );
      })()}

      {/* daily practice */}
      <div style={{ border: "1px solid " + (dailyReady ? accent : P.line), borderRadius: 20, padding: 22, marginBottom: 24, background: P.raised }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>DAILY PRACTICE</div>
        <p style={{ fontSize: 15, color: P.ink, lineHeight: 1.55, margin: "0 0 6px" }}>
          {dailyReady
            ? "A short mixed session: " + (due.length > 0 ? due.length + " fading finding" + (due.length === 1 ? "" : "s") + " and " : "") + "activities from the paths you have started."
            : "Finish any lesson on a path and daily practice unlocks: a short mixed session that keeps what you learned from fading."}
        </p>
        <p style={{ fontSize: 13.5, color: P.muted, lineHeight: 1.5, margin: "0 0 14px" }}>
          {totalPathDone} of {totalPathLessons} path lessons done so far.
        </p>
        <button className="lv-btn lv-btn-primary" onClick={startDaily} disabled={!dailyReady}
          style={{
            background: accent, color: at || "#101408", border: "none", borderRadius: 12,
            padding: "13px 24px", fontSize: 15, fontWeight: 700,
            cursor: dailyReady ? "pointer" : "default", fontFamily: "var(--cb-font)",
            opacity: dailyReady ? 1 : 0.5,
          }}>
          Start daily practice
        </button>
      </div>

      {/* learning paths */}
      <div style={{ marginBottom: 30 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>LEARNING PATHS</div>
        <p style={{ fontSize: 14.5, color: P.muted, lineHeight: 1.55, margin: "0 0 16px" }}>
          Whole subjects, taught step by step. Lessons are short, the activities are the teaching, and nothing here needs a paper or a search. Papers wait at the end of a lesson, as a way deeper, never as a gate.
        </p>
        <div className="lv-catalog">
          {LEARNING_PATHS.map((path) => {
            const pp = pathProgress(path, builtinProgress);
            const cat = CATALOG.find((c) => c.name === path.category) || null;
            return (
              <button key={path.id} className="lv-topic" onClick={() => setScreen({ name: "bpath", pathId: path.id })}
                style={{
                  textAlign: "left", cursor: "pointer", padding: 0, overflow: "hidden",
                  background: P.raised, border: "1px solid " + P.line, borderRadius: 20,
                  fontFamily: "var(--cb-font)", color: P.ink,
                }}>
                <Cover title={path.title} height={104} radius={0} cat={cat} />
                <span style={{ display: "block", padding: "14px 16px 16px" }}>
                  <span style={{ fontFamily: SERIF, fontSize: 17.5, fontWeight: 600, lineHeight: 1.3, display: "block" }}>{path.title}</span>
                  <span style={{ fontSize: 13, color: P.muted, lineHeight: 1.5, display: "block", marginTop: 5, minHeight: 39 }}>{path.blurb}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                    <span style={{ flex: 1, height: 7, borderRadius: 999, background: P.line, overflow: "hidden", display: "block" }}>
                      <span className="lv-fill" style={{ display: "block", height: "100%", background: accent, borderRadius: 999, width: pp.pct + "%" }} />
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: accent }}>
                      {pp.complete ? "Complete" : pp.done > 0 ? pp.done + " of " + pp.total : pp.total + " lessons"}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* courses from searches: heading for everything below */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: accent, marginBottom: 8 }}>COURSES FROM YOUR SEARCHES</div>
        <p style={{ fontSize: 14.5, color: P.muted, lineHeight: 1.55, margin: "0 0 18px" }}>
          The other way Cortex teaches: pick a topic and it builds a course from the real literature, findings, debates, and all.
        </p>
      </div>

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
