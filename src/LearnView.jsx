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
    .trim();
}
function shortCite(source) {
  if (!source) return "the paper";
  const a = String(source.authors || "").trim();
  let name = "";
  if (a) {
    const first = a.includes(",") ? a.split(",")[0].trim() : a.replace(/\s*et al\.?.*$/, "").trim();
    const words = first.split(/\s+/).filter(Boolean);
    if (words.length === 0) name = "";
    else if (words.length === 1) name = words[0];
    else {
      // Author strings come in two shapes: "Firstname Surname" and
      // "Surname F" (surname followed by a bare initial). Taking the
      // last word of the second shape yields the initial, which reads
      // as nonsense in a question ("What did Q et al. report?"). When
      // the last word is a lone initial, the surname is the first word.
      const last = words[words.length - 1];
      name = last.replace(/[^A-Za-z]/g, "").length <= 1 ? words[0] : last;
    }
    if (name && a.includes(",") || /et al/.test(a)) name += " et al.";
    if (name && name.replace(/[^A-Za-z]/g, "").length < 2) name = "";
  }
  const yr = source.year ? " (" + source.year + ")" : "";
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
function extractClaims(answerMd) {
  const claims = [];
  if (!answerMd) return claims;
  let skip = false;
  for (const rawLine of String(answerMd).split("\n")) {
    const line = rawLine.trim();
    const head = line.match(/^#{1,4}\s+(.*)$/);
    if (head) {
      skip = /sources|references|try asking|related topics/i.test(head[1]);
      continue;
    }
    if (skip || !line) continue;
    const isBullet = /^[-•]\s+/.test(line);
    const text0 = line.replace(/^[-•]\s+/, "");
    const cites = [...text0.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10));
    if (cites.length === 0) continue;
    // Split long paragraphs into sentences, each keeping the citation.
    const sentences = text0.match(/[^.!?]+[.!?]+["']?\s*(?:\[\d+\]\s*)*/g) || [text0];
    for (const sent of sentences) {
      const sc = [...sent.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10));
      const useCites = sc.length ? sc : (isBullet ? cites : []);
      if (!useCites.length) continue;
      const text = cleanText(sent);
      if (text.length < 42 || text.length > 340) continue;
      if (/^(this|the) (answer|search|section)\b/i.test(text)) continue;
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

const NUMBER_RE = /(\d+(?:\.\d+)?\s?%|\d+(?:\.\d+)?\s?-fold|p\s?<\s?0\.\d+|\d+(?:\.\d+)?\s?(?:mg\/kg|mg|kg|°C|days|weeks|months|hours))/;
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
function quizCard(claim, allClaims, sources, opts = {}) {
  const source = sources[claim.sourceIdx - 1];
  // Options are read at a glance, so distractors prefer the shorter
  // real findings in the pool. The correct finding is never shortened:
  // options quote papers, they do not paraphrase them.
  const pool = allClaims
    .filter((c) => c.sourceIdx !== claim.sourceIdx && c.text !== claim.text)
    .sort((a, b) => a.text.length - b.text.length);
  const shortPool = pool.filter((c) => c.text.length <= 230);
  const distract = seededShuffle(shortPool.length >= 3 ? shortPool : pool, hashStr(claim.text))
    .slice(0, 3).map((c) => c.text);
  const options = seededShuffle([claim.text, ...distract], hashStr(claim.text) + 7);
  return {
    kind: "quiz",
    claimId: "cl" + hashStr(claim.text) + "-" + (claimSeq++),
    question: "What did " + shortCite(source) + " report?",
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
  const others = numbersIn(allClaims).filter((n) => n !== value);
  if (others.length < 2) return null;
  const picks = seededShuffle(others, hashStr(claim.text)).slice(0, 3);
  const options = seededShuffle([value, ...picks], hashStr(claim.text) + 13);
  return {
    kind: "cloze",
    claimId: "cl" + hashStr(claim.text) + "-" + (claimSeq++),
    prompt: claim.text.replace(m[1], "_____"),
    question: "Predict the result. What value did " + shortCite(source) + " report?",
    options,
    correct: options.indexOf(value),
    why: claim.text,
    cite: shortCite(source),
    paperTitle: source ? source.title : "",
  };
}
function paperCard(source, claim) {
  return {
    kind: "paper",
    title: source.title || "Untitled paper",
    meta: [source.authors, source.journal, source.year].filter(Boolean).join(" · "),
    citations: typeof source.citations === "number" ? source.citations : null,
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

  const byYear = [...taught].sort((a, b) => (a.source.year || 9999) - (b.source.year || 9999));
  const byCites = [...taught].sort((a, b) => (b.source.citations || 0) - (a.source.citations || 0));
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
    const years = taught.map((p) => p.source.year).filter(Boolean);
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
`;

/* Deterministic cover art for a course: deep paired tones chosen by a
   hash of the title, a soft radial glow, and the topic's first letter
   set in large serif. No images, nothing invented, always available. */
const COVER_PAIRS = [
  ["#1d3b2a", "#0e2417"], ["#27354d", "#131e30"], ["#3d2c1e", "#241708"],
  ["#33233f", "#1c1226"], ["#173d3a", "#0a2422"], ["#42252b", "#281116"],
  ["#2c3a1c", "#18230c"], ["#1e3a4d", "#0e2432"], ["#3f3418", "#261e08"],
];
function Cover({ title, height, radius = 16, fontSize }) {
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
  const xpAtLessonStart = useRef(0);
  const claimsRef = useRef(null);
  if (!claimsRef.current) claimsRef.current = loadClaims();

  const lesson = course.lessons[lessonIdx];
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
    finishLesson(true);
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
          <Cover title={course.title} height={150} radius={20} />
          <h2 style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, lineHeight: 1.2, margin: "30px 0 12px" }}>{lesson.title}</h2>
          <p style={{ color: P.muted, fontSize: 16.5, lineHeight: 1.6, margin: "0 auto 14px", maxWidth: 420 }}>{lesson.subtitle}</p>
          <p style={{ color: P.muted, fontSize: 13.5, margin: "0 0 38px" }}>{lesson.cards.length} cards · about {Math.max(1, Math.round(lesson.cards.length * 0.4))} min</p>
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
          {card.kind === "note" && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>{(card.kicker || "").toUpperCase()}</div>
              <h2 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, lineHeight: 1.25, margin: "0 0 16px" }}>{card.title}</h2>
              <p style={{ fontSize: 17.5, color: P.ink2 || P.muted, lineHeight: 1.65, margin: 0 }}>{card.text}</p>
              {card.cite && <p style={{ fontSize: 13, color: P.muted, marginTop: 16 }}>{card.cite}</p>}
            </div>
          )}

          {card.kind === "paper" && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>FROM THE LITERATURE</div>
              <h2 style={{ fontFamily: SERIF, fontSize: 25, fontWeight: 600, lineHeight: 1.35, margin: "0 0 10px" }}>{card.title}</h2>
              <p style={{ fontSize: 13.5, color: P.muted, margin: "0 0 22px" }}>
                {card.meta}{card.citations != null ? " · " + card.citations + " citations" : ""}
              </p>
              {card.text && (
                <div style={{ background: P.raised, border: "1px solid " + P.line, borderRadius: 18, padding: "22px 22px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: P.muted, marginBottom: 10 }}>THE FINDING</div>
                  <p style={{ fontFamily: SERIF, fontSize: 19.5, lineHeight: 1.6, margin: 0 }}>{card.text}</p>
                </div>
              )}
            </div>
          )}

          {(card.kind === "quiz" || card.kind === "cloze") && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>
                {card.pretest ? "PRETEST · GUESS FIRST" : card.kind === "cloze" ? "PREDICT THE RESULT" : "RECALL"}
              </div>
              <h2 style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 600, lineHeight: 1.4, margin: "0 0 10px" }}>{card.question}</h2>
              {card.kind === "cloze" && card.prompt && (
                <p style={{ fontFamily: SERIF, fontSize: 18.5, lineHeight: 1.6, margin: "0 0 8px", color: P.ink2 || P.muted }}>{card.prompt}</p>
              )}
              {card.pretest && !checked && (
                <p style={{ fontSize: 14, color: P.muted, margin: "0 0 6px", lineHeight: 1.55 }}>You have not been taught this yet. That is the point. A real guess now makes the finding stick later.</p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
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
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[{ claim: card.claimA, src: card.sourceA, tag: "POSITION A" }, { claim: card.claimB, src: card.sourceB, tag: "POSITION B" }].map((side, i) => (
                  <button key={i} onClick={() => pick(i)} disabled={checked}
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
                ))}
              </div>
            </div>
          )}

          {card.kind === "summary" && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.13em", color: accent, marginBottom: 14 }}>WRAP UP</div>
              <h2 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 600, lineHeight: 1.25, margin: "0 0 16px" }}>{card.title}</h2>
              <p style={{ fontSize: 17.5, color: P.ink2 || P.muted, lineHeight: 1.65, margin: 0 }}>{card.text}</p>
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
        <Cover title={course.title} height={168} radius={22} />
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

/* ── Learn home ──────────────────────────────────────────────────── */
export default function LearnView({ P, accent, at, onNavigate }) {
  const [courses, setCourses] = useState([]);
  const [claims, setClaims] = useState({});
  const [profile, setProfile] = useState(null);
  const [screen, setScreen] = useState({ name: "home" }); // home | path | player
  const [topic, setTopic] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState("");
  const [soundOn, setSoundOn] = useState(() => loadJSON(SOUND_KEY, false));

  const refresh = () => {
    setCourses(loadLearnCourses());
    setClaims(loadClaims());
  };
  useEffect(() => {
    refresh();
    setProfile(touchStreak(loadProfile()));
  }, []);

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

  const buildCourse = async () => {
    const q = topic.trim();
    if (!q || building) return;
    setBuilding(true);
    setBuildError("");
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, settings: { answerLength: "standard", factCheck: true } }),
      });
      if (!res.ok) throw new Error("search failed");
      const data = await res.json();
      const course = createCourseFromResults(q, data.sources || [], data.answer || "", data.literature_conflicts || []);
      if (!course) {
        setBuildError("That search did not return enough cited findings to build an honest course. Try a broader topic.");
        return;
      }
      saveLearnCourse(course);
      refresh();
      setTopic("");
      setScreen({ name: "path", courseId: course.id });
    } catch {
      setBuildError("The search did not come back. Check your connection and try again.");
    } finally {
      setBuilding(false);
    }
  };

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
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "30px 24px 56px", fontFamily: "var(--cb-font)" }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 style={{ fontFamily: SERIF, fontSize: 36, fontWeight: 600, color: P.ink, margin: "0 0 8px" }}>Learn</h1>
          <p style={{ color: P.muted, fontSize: 15.5, lineHeight: 1.55, margin: 0, maxWidth: 520 }}>
            Short courses built from the papers themselves. Every question is a real finding, every debate is a real disagreement, and reviews come back when your memory starts to fade.
          </p>
        </div>
        <button onClick={() => { const v = !soundOn; setSoundOn(v); saveJSON(SOUND_KEY, v); }}
          aria-label={soundOn ? "Mute lesson sounds" : "Unmute lesson sounds"}
          style={{ background: "transparent", border: "1px solid " + P.line, borderRadius: 999, color: P.muted, cursor: "pointer", padding: "8px 14px", fontSize: 13, fontFamily: "var(--cb-font)", flexShrink: 0 }}>
          Sound {soundOn ? "on" : "off"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", margin: "20px 0 26px" }}>
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
          <Cover title={nextCourse.title} height={128} radius={0} />
          <span style={{ display: "block", padding: "18px 22px 20px" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.12em", color: accent, display: "block", marginBottom: 7 }}>
              {(nextCourse.doneLessons || []).length > 0 ? "CONTINUE" : "START HERE"}
            </span>
            <span style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 600, lineHeight: 1.28, display: "block" }}>{nextCourse.title}</span>
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
                  <Cover title={course.title} height={96} radius={0} fontSize={150} />
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
